'use strict';

// ─── Game State ───────────────────────────────────────────────────────────────

const SAVE_KEY = 'cyberracing_idle_save';
const SAVE_INTERVAL_MS = 30000;
const TICK_INTERVAL_MS = 100;
const MAX_OFFLINE_SEC = 8 * 60 * 60; // cap at 8h of offline progress

let G = null; // active game state

function createDefaultState() {
  return {
    version: '0.1.0',
    lastSave: Date.now(),
    money: 5000,
    reputation: 0,
    prestigePoints: 0,
    season: 1,
    totalEarned: 0,
    nextCarId: 2,
    nextDriverId: 1,
    cars: [
      {
        id: 'car_1',
        classId: 'GT4',
        name: 'GT4 #1',
        upgrades: { engine: 0, aero: 0, tyres: 0, brakes: 0, reliability: 0 },
        driverId: null,
        championshipId: null,
      },
    ],
    drivers: [],
    activeChampionships: [],
    completedChampionships: [],
    prestige: {
      totalResets: 0,
      permanentBonuses: {
        incomeMultiplier: 1.0,
        sponsorBonus: 0,
        headStartLevels: 0,
      },
      purchased: [],
    },
    notifications: [],
  };
}

// ─── Income Calculations ──────────────────────────────────────────────────────

function calcCarIncomePerSec(car) {
  const cls = getCarClassById(car.classId);
  if (!cls) return 0;

  const upg = car.upgrades;
  const engMult   = UPGRADES.engine.getIncomeMult(upg.engine);
  const aeroMult  = UPGRADES.aero.getIncomeMult(upg.aero);
  const tyresMult = UPGRADES.tyres.getIncomeMult(upg.tyres);
  const brakeMult = UPGRADES.brakes.getIncomeMult(upg.brakes);
  const reliMult  = UPGRADES.reliability.getIncomeMult(upg.reliability);

  let driverMult = 1.0;
  if (car.driverId !== null) {
    const driver = G.drivers.find(d => d.id === car.driverId);
    if (driver) driverMult = 1 + driver.pace / 100;
  }

  let champBonus = 1.0;
  if (car.championshipId !== null) {
    const activeChamp = G.activeChampionships.find(c => c.id === car.championshipId);
    if (activeChamp) {
      const champDef = getChampionshipById(activeChamp.definitionId);
      if (champDef) champBonus = 1 + champDef.incomeBonus;
    }
  }

  const basePerSec = cls.baseIncomePerLap / cls.lapTimeSec;
  return basePerSec * engMult * aeroMult * tyresMult * brakeMult * reliMult
    * driverMult * champBonus * G.prestige.permanentBonuses.incomeMultiplier;
}

function calcTotalIncomePerSec() {
  return G.cars.reduce((sum, car) => sum + calcCarIncomePerSec(car), 0);
}

// ─── Upgrade Logic ────────────────────────────────────────────────────────────

function canAffordUpgrade(car, upgradeId) {
  const cost = getUpgradeCost(upgradeId, car.upgrades[upgradeId]);
  return G.money >= cost;
}

function isUpgradeMaxed(car, upgradeId) {
  return car.upgrades[upgradeId] >= UPGRADES[upgradeId].maxLevel;
}

function buyUpgrade(carId, upgradeId) {
  const car = G.cars.find(c => c.id === carId);
  if (!car) return { ok: false, msg: 'Car not found.' };
  if (isUpgradeMaxed(car, upgradeId)) return { ok: false, msg: 'Already maxed.' };

  const cost = getUpgradeCost(upgradeId, car.upgrades[upgradeId]);
  if (G.money < cost) return { ok: false, msg: 'Not enough money.' };

  G.money -= cost;
  car.upgrades[upgradeId]++;
  return { ok: true };
}

// ─── Buy Car ──────────────────────────────────────────────────────────────────

function buyCar(classId) {
  const cls = getCarClassById(classId);
  if (!cls) return { ok: false, msg: 'Unknown car class.' };
  if (G.reputation < cls.repRequired) return { ok: false, msg: `Need ${cls.repRequired} REP.` };
  if (cls.ppRequired && G.prestigePoints < cls.ppRequired) return { ok: false, msg: `Need ${cls.ppRequired} PP.` };

  const ownedOfClass = G.cars.filter(c => c.classId === classId).length;
  if (ownedOfClass >= cls.maxOwned) return { ok: false, msg: `Max ${cls.maxOwned} cars of this class.` };

  if (G.money < cls.baseCost) return { ok: false, msg: 'Not enough money.' };

  G.money -= cls.baseCost;
  const id = 'car_' + G.nextCarId++;
  const count = ownedOfClass + 1;
  G.cars.push({
    id,
    classId,
    name: `${cls.name} #${count}`,
    upgrades: { engine: 0, aero: 0, tyres: 0, brakes: 0, reliability: 0 },
    driverId: null,
    championshipId: null,
  });
  return { ok: true, carId: id };
}

// ─── Championships ────────────────────────────────────────────────────────────

let _champIdCounter = 1;

function enterChampionship(definitionId, carId) {
  const champDef = getChampionshipById(definitionId);
  if (!champDef) return { ok: false, msg: 'Unknown championship.' };

  const car = G.cars.find(c => c.id === carId);
  if (!car) return { ok: false, msg: 'Car not found.' };
  if (!champDef.allowedClasses.includes(car.classId))
    return { ok: false, msg: `${car.name} cannot enter this series.` };

  if (car.championshipId !== null) return { ok: false, msg: 'Car already in a championship.' };
  if (G.money < champDef.entryFee) return { ok: false, msg: 'Not enough money for entry fee.' };

  G.money -= champDef.entryFee;

  const entry = {
    id: 'champ_entry_' + _champIdCounter++,
    definitionId,
    carId,
    currentRound: 0,
    maxRounds: champDef.rounds,
    roundStartTime: Date.now(),
    roundDurationSec: champDef.roundDurationSec,
    repEarned: 0,
    incomeEarned: 0,
    startedAt: Date.now(),
  };

  G.activeChampionships.push(entry);
  car.championshipId = entry.id;
  return { ok: true, entryId: entry.id };
}

function withdrawFromChampionship(entryId) {
  const idx = G.activeChampionships.findIndex(c => c.id === entryId);
  if (idx === -1) return { ok: false, msg: 'Entry not found.' };

  const entry = G.activeChampionships[idx];
  const car = G.cars.find(c => c.id === entry.carId);
  if (car) car.championshipId = null;

  G.activeChampionships.splice(idx, 1);
  return { ok: true };
}

// ─── Driver System ────────────────────────────────────────────────────────────

function scoutDriver(tier) {
  const tierDef = DRIVER_TIERS[tier];
  if (!tierDef) return { ok: false, msg: 'Unknown tier.' };
  if (tier === 'S' || tier === 'L') return { ok: false, msg: 'Special acquisition only.' };

  if (G.money < tierDef.scoutCost) return { ok: false, msg: 'Not enough money.' };
  G.money -= tierDef.scoutCost;

  const [min, max] = tierDef.paceRange;
  const pace = Math.floor(Math.random() * (max - min + 1)) + min;
  const name = DRIVER_NAMES[Math.floor(Math.random() * DRIVER_NAMES.length)];

  const driver = {
    id: 'driver_' + G.nextDriverId++,
    name,
    tier,
    pace,       // % income bonus
    consistency: Math.floor(Math.random() * 20) + (tier === 'C' ? 5 : tier === 'B' ? 15 : 25),
    xp: 0,
    carId: null,
  };
  G.drivers.push(driver);
  return { ok: true, driver };
}

function assignDriver(driverId, carId) {
  const driver = G.drivers.find(d => d.id === driverId);
  const car = G.cars.find(c => c.id === carId);
  if (!driver || !car) return { ok: false, msg: 'Driver or car not found.' };

  // Unassign from previous car
  if (driver.carId) {
    const prevCar = G.cars.find(c => c.id === driver.carId);
    if (prevCar) prevCar.driverId = null;
  }
  // Unassign previous driver from target car
  if (car.driverId) {
    const prevDriver = G.drivers.find(d => d.id === car.driverId);
    if (prevDriver) prevDriver.carId = null;
  }

  driver.carId = carId;
  car.driverId = driverId;
  return { ok: true };
}

function unassignDriver(driverId) {
  const driver = G.drivers.find(d => d.id === driverId);
  if (!driver) return { ok: false, msg: 'Driver not found.' };
  if (driver.carId) {
    const car = G.cars.find(c => c.id === driver.carId);
    if (car) car.driverId = null;
  }
  driver.carId = null;
  return { ok: true };
}

// ─── Season Reset (Prestige) ─────────────────────────────────────────────────

function canPrestige() {
  // Must have completed at least one championship this season
  return G.completedChampionships.some(c => c.season === G.season);
}

function calcPrestigePoints() {
  // Award PP based on reputation milestones and championships completed
  const repPP = Math.floor(G.reputation / 1000);
  const champPP = G.completedChampionships.filter(c => c.season === G.season).length * 10;
  return repPP + champPP;
}

function doPrestige() {
  if (!canPrestige()) return { ok: false, msg: 'Complete at least one championship first.' };

  const ppGain = calcPrestigePoints();
  G.prestigePoints += ppGain;
  G.season++;
  G.money = 5000;

  const headStart = G.prestige.permanentBonuses.headStartLevels;

  // Reset cars (keep 2 reliability levels, add head-start levels)
  G.cars.forEach(car => {
    const relLvl = car.upgrades.reliability;
    car.upgrades = { engine: headStart, aero: headStart, tyres: headStart, brakes: headStart, reliability: Math.min(2 + headStart, 20) };
    car.upgrades.reliability = Math.max(car.upgrades.reliability, Math.min(relLvl, 2) + headStart);
    car.championshipId = null;
  });

  // Clear championships
  G.activeChampionships = [];

  // Driver XP persists; unassign for clarity
  G.drivers.forEach(d => { d.carId = null; });
  G.cars.forEach(c => { c.driverId = null; });

  addNotification(`Season ${G.season - 1} complete! +${ppGain} Prestige Points.`, 'prestige');

  return { ok: true, ppGain };
}

// ─── Notifications ────────────────────────────────────────────────────────────

function addNotification(msg, type = 'info') {
  G.notifications.push({ msg, type, ts: Date.now() });
  if (G.notifications.length > 50) G.notifications.shift();
}

// ─── Tick Logic ──────────────────────────────────────────────────────────────

function tick(deltaMs) {
  const deltaSec = deltaMs / 1000;

  // Passive income from all cars
  const income = calcTotalIncomePerSec() * deltaSec;
  G.money += income;
  G.totalEarned += income;

  // Driver XP (passive growth)
  G.drivers.forEach(d => {
    if (d.carId) d.xp += deltaSec * 0.1;
  });

  // Championship round progression
  const now = Date.now();
  G.activeChampionships.forEach(entry => {
    const elapsed = (now - entry.roundStartTime) / 1000;
    if (elapsed >= entry.roundDurationSec) {
      const champDef = getChampionshipById(entry.definitionId);
      entry.currentRound++;
      entry.repEarned += champDef.repPerRound;
      G.reputation += champDef.repPerRound;
      entry.roundStartTime = now;

      const isFinal = entry.currentRound >= entry.maxRounds;
      if (isFinal) {
        // Final round bonus
        const car = G.cars.find(c => c.id === entry.carId);
        const champIncomePerSec = car ? calcCarIncomePerSec(car) : 0;
        const bonusCash = champIncomePerSec * entry.roundDurationSec * champDef.finalBonusMult;
        G.money += bonusCash;
        G.totalEarned += bonusCash;

        // Extra REP bonus for completion
        const completionRep = champDef.repPerRound * 2;
        G.reputation += completionRep;
        entry.repEarned += completionRep;

        G.completedChampionships.push({
          definitionId: entry.definitionId,
          carId: entry.carId,
          repEarned: entry.repEarned,
          incomeEarned: entry.incomeEarned,
          season: G.season,
          completedAt: now,
        });

        addNotification(`${champDef.name} complete! +${entry.repEarned} REP, +$${formatNumber(bonusCash)} bonus.`, 'success');

        // Unlink car
        if (car) car.championshipId = null;
        entry._completed = true;
      } else {
        addNotification(`${champDef.shortName} — Round ${entry.currentRound}/${entry.maxRounds} complete. +${champDef.repPerRound} REP`, 'info');
      }
    }
  });

  // Remove completed championship entries
  G.activeChampionships = G.activeChampionships.filter(e => !e._completed);
}

// ─── Offline Progress ────────────────────────────────────────────────────────

function applyOfflineProgress() {
  const now = Date.now();
  const elapsed = Math.min((now - G.lastSave) / 1000, MAX_OFFLINE_SEC);
  if (elapsed < 5) return;

  // Simulate offline ticks in bulk (skip championship advancement for simplicity)
  const income = calcTotalIncomePerSec() * elapsed;
  G.money += income;
  G.totalEarned += income;

  // Advance championships
  G.activeChampionships.forEach(entry => {
    const champDef = getChampionshipById(entry.definitionId);
    const totalElapsed = elapsed + (Date.now() - entry.roundStartTime) / 1000;
    const roundsCompleted = Math.floor(totalElapsed / entry.roundDurationSec);
    const actualNew = Math.min(roundsCompleted, entry.maxRounds - entry.currentRound);

    if (actualNew > 0) {
      const repGain = actualNew * champDef.repPerRound;
      entry.currentRound += actualNew;
      entry.repEarned += repGain;
      G.reputation += repGain;
      entry.roundStartTime = Date.now() - ((totalElapsed % entry.roundDurationSec) * 1000);
    }

    if (entry.currentRound >= entry.maxRounds && !entry._completed) {
      const car = G.cars.find(c => c.id === entry.carId);
      const bonusCash = (car ? calcCarIncomePerSec(car) : 0) * entry.roundDurationSec * champDef.finalBonusMult;
      G.money += bonusCash;
      G.totalEarned += bonusCash;
      G.reputation += champDef.repPerRound * 2;
      G.completedChampionships.push({
        definitionId: entry.definitionId,
        carId: entry.carId,
        repEarned: entry.repEarned,
        season: G.season,
        completedAt: Date.now(),
      });
      if (car) car.championshipId = null;
      entry._completed = true;
    }
  });
  G.activeChampionships = G.activeChampionships.filter(e => !e._completed);

  return elapsed;
}

// ─── Save / Load ─────────────────────────────────────────────────────────────

function saveGame() {
  G.lastSave = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(G));
  } catch (e) {
    console.warn('Save failed:', e);
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    // Merge with defaults to handle new keys added in updates
    G = Object.assign(createDefaultState(), saved);
    return true;
  } catch (e) {
    console.warn('Load failed:', e);
    return false;
  }
}

function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  G = createDefaultState();
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function formatNumber(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toLocaleString();
}

function formatTime(sec) {
  if (sec < 60) return Math.floor(sec) + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + Math.floor(sec % 60) + 's';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

// ─── Init & Loop ─────────────────────────────────────────────────────────────

let _lastTick = 0;
let _lastSaveTime = 0;
let _offlineEarned = 0;

function initGame() {
  const loaded = loadGame();
  if (!loaded) {
    G = createDefaultState();
  } else {
    const elapsed = applyOfflineProgress();
    if (elapsed > 5) {
      _offlineEarned = calcTotalIncomePerSec() * elapsed;
      addNotification(`Welcome back! Your cars raced for ${formatTime(elapsed)}. +$${formatNumber(_offlineEarned)} earned offline.`, 'offline');
    }
  }
  _lastTick = performance.now();
  _lastSaveTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function gameLoop(now) {
  const delta = now - _lastTick;
  _lastTick = now;

  tick(delta);

  if (now - _lastSaveTime > SAVE_INTERVAL_MS) {
    saveGame();
    _lastSaveTime = now;
  }

  requestAnimationFrame(gameLoop);
}
