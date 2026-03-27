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
    garageLevel: 1,
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
    champCompletions: {},      // { champId: totalCount } — persists across season resets
    prestige: {
      totalResets: 0,
      permanentBonuses: {
        incomeMultiplier: 1.0,
        sponsorBonus: 0,
        headStartLevels: 0,
      },
      purchased: [],
    },
    sponsors: [null, null, null, null, null],
    hasFactoryLivery: false,
    teamPrincipal: null,
    raceEngineers: {},
    notifications: [],
  };
}

// ─── Income Calculations ──────────────────────────────────────────────────────

function calcCarIncomePerSec(car) {
  const cls = getCarClassById(car.classId);
  if (!cls) return 0;

  const upg = car.upgrades;
  const re  = getREForCar(car.id);
  const reB = re ? getREBonuses(car.id) : { setupBonus: 0, reliBonus: 0, pitBonus: 0 };

  const engMult   = UPGRADES.engine.getIncomeMult(upg.engine);
  const aeroMult  = UPGRADES.aero.getIncomeMult(upg.aero);
  const tyresMult = UPGRADES.tyres.getIncomeMult(upg.tyres);
  const brakeMult = UPGRADES.brakes.getIncomeMult(upg.brakes);
  const reliMult  = UPGRADES.reliability.getIncomeMult(upg.reliability) * (1 + reB.reliBonus);

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
      if (champDef) champBonus = 1 + champDef.incomeBonus + reB.pitBonus;
    }
  }

  const basePerSec = cls.baseIncomePerLap / cls.lapTimeSec;
  return basePerSec * engMult * aeroMult * tyresMult * brakeMult * reliMult
    * driverMult * champBonus * G.prestige.permanentBonuses.incomeMultiplier
    * (1 + reB.setupBonus);
}

// Sponsor income is now the primary passive income source.
// Car income formula is retained only for championship payout bonus calculations.
function calcSponsorIncomePerSec() {
  const prestigeBonus = (G.prestige && G.prestige.permanentBonuses && G.prestige.permanentBonuses.sponsorBonus) || 0;
  const tpBonus = getTPBonuses().sponsorMult;
  const sponsorMult = 1 + prestigeBonus + tpBonus;
  const parentsIncome = 8; // Mum & Dad Racing Support — always active
  const sponsors = Array.isArray(G.sponsors) ? G.sponsors : [];
  const earnedIncome = sponsors.reduce((sum, s) => sum + (s ? s.incomePerSec : 0), 0);
  return (parentsIncome + earnedIncome) * sponsorMult;
}

function calcTotalIncomePerSec() {
  return calcSponsorIncomePerSec();
}

// ─── Upgrade Logic ────────────────────────────────────────────────────────────

function canAffordUpgrade(car, upgradeId) {
  const cost = getEffectiveUpgradeCost(upgradeId, car.upgrades[upgradeId]);
  return G.money >= cost;
}

function isUpgradeMaxed(car, upgradeId) {
  return car.upgrades[upgradeId] >= UPGRADES[upgradeId].maxLevel;
}

function buyUpgrade(carId, upgradeId) {
  const car = G.cars.find(c => c.id === carId);
  if (!car) return { ok: false, msg: 'Car not found.' };
  if (isUpgradeMaxed(car, upgradeId)) return { ok: false, msg: 'Already maxed.' };

  const cost = getEffectiveUpgradeCost(upgradeId, car.upgrades[upgradeId]);
  if (G.money < cost) return { ok: false, msg: 'Not enough money.' };

  G.money -= cost;
  car.upgrades[upgradeId]++;
  return { ok: true };
}

// ─── Buy Car ──────────────────────────────────────────────────────────────────

function buyCar(classId) {
  const cls = getCarClassById(classId);
  if (!cls) return { ok: false, msg: 'Unknown car class.' };
  if (G.reputation < cls.repRequired) return { ok: false, msg: `Need ${formatNumber(cls.repRequired)} REP.` };
  if (cls.ppRequired && G.prestigePoints < cls.ppRequired) return { ok: false, msg: `Need ${cls.ppRequired} PP.` };

  const totalSlots = getGarageSlots(G.garageLevel);
  if (G.cars.length >= totalSlots) return { ok: false, msg: 'Expand your garage to buy more cars.' };

  const ownedOfClass = G.cars.filter(c => c.classId === classId).length;
  if (ownedOfClass >= cls.maxOwned) return { ok: false, msg: `Max ${cls.maxOwned} ${cls.name} cars owned.` };

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

// ─── Garage Upgrade ───────────────────────────────────────────────────────────

function upgradeGarage() {
  const next = getGarageNextUpgrade(G.garageLevel);
  if (!next) return { ok: false, msg: 'Garage is already at maximum capacity.' };
  if (G.reputation < next.repRequired) return { ok: false, msg: `Need ${formatNumber(next.repRequired)} REP.` };
  if (G.money < next.cost) return { ok: false, msg: 'Not enough money.' };
  G.money -= next.cost;
  G.garageLevel = next.level;
  return { ok: true, level: next.level, slots: next.slots };
}

// ─── Championships ────────────────────────────────────────────────────────────

let _champIdCounter = 1;

function hasCompletedChampionship(champId) {
  return (G.champCompletions[champId] || 0) > 0;
}

function checkChampionshipPrerequisite(champDef) {
  if (!champDef.prerequisiteChampionship) return true;
  const ids = Array.isArray(champDef.prerequisiteChampionship)
    ? champDef.prerequisiteChampionship
    : [champDef.prerequisiteChampionship];
  return ids.some(id => hasCompletedChampionship(id));
}

function enterChampionship(definitionId, carId) {
  const champDef = getChampionshipById(definitionId);
  if (!champDef) return { ok: false, msg: 'Unknown championship.' };

  if (G.reputation < (champDef.repRequired || 0))
    return { ok: false, msg: `Need ${formatNumber(champDef.repRequired)} REP to enter.` };

  if (!checkChampionshipPrerequisite(champDef)) {
    const label = getPrerequisiteLabel(champDef);
    return { ok: false, msg: `Complete ${label} first.` };
  }

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

// ─── Driver Stat Generation ───────────────────────────────────────────────────

// Park-Miller LCG — deterministic, seeded PRNG for migration
function seededRand(seed) {
  let s = (Math.abs(seed | 0) % 2147483646) || 1;
  return function() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Distribute a stat budget across the 5 driver stats.
// randFn: function returning [0,1). Works with Math.random or seededRand output.
function generateDriverStats(tier, randFn) {
  const cfg = DRIVER_STAT_CONFIG[tier];
  const budget = Math.floor(randFn() * (cfg.budgetMax - cfg.budgetMin + 1)) + cfg.budgetMin;

  // Primary stat gets 30–40% of budget
  const primaryIdx = Math.floor(randFn() * DRIVER_STAT_KEYS.length);
  const primaryKey = DRIVER_STAT_KEYS[primaryIdx];
  const primaryRaw = Math.round(budget * (0.30 + randFn() * 0.10));
  const primaryVal = Math.min(cfg.ceiling, Math.max(cfg.floor, primaryRaw));

  // Distribute remaining across the other four stats using random weights
  const remaining = budget - primaryVal;
  const otherKeys = DRIVER_STAT_KEYS.filter(k => k !== primaryKey);
  const weights   = otherKeys.map(() => randFn() + 0.2); // +0.2 avoids near-zero
  const wTotal    = weights.reduce((a, b) => a + b, 0);

  const stats = { [primaryKey]: primaryVal };
  otherKeys.forEach((key, i) => {
    const raw = Math.round(remaining * weights[i] / wTotal);
    stats[key] = Math.min(cfg.ceiling, Math.max(cfg.floor, raw));
  });

  // Rain Skill gets extra ±40% variance after distribution
  const rainMod = 1 + (randFn() * 0.8 - 0.4);
  stats.rainSkill = Math.min(cfg.ceiling, Math.max(cfg.floor, Math.round(stats.rainSkill * rainMod)));

  return { stats, primaryStat: primaryKey };
}

// ─── Driver System ────────────────────────────────────────────────────────────

function scoutDriver(tier) {
  const tierDef = DRIVER_TIERS[tier];
  if (!tierDef) return { ok: false, msg: 'Unknown tier.' };
  if (tierDef.locked) return { ok: false, msg: 'Special acquisition only.' };
  const effectiveScoutCost = Math.floor(tierDef.scoutCost * getTPBonuses().scoutCostMult);
  if (G.money < effectiveScoutCost) return { ok: false, msg: 'Not enough money.' };

  G.money -= effectiveScoutCost;

  const { stats, primaryStat } = generateDriverStats(tier, Math.random);
  const name = DRIVER_NAMES[Math.floor(Math.random() * DRIVER_NAMES.length)];

  const driver = {
    id: 'driver_' + G.nextDriverId++,
    name,
    tier,
    pace:           stats.pace,
    consistency:    stats.consistency,
    tyreManagement: stats.tyreManagement,
    rainSkill:      stats.rainSkill,
    fitness:        stats.fitness,
    primaryStat,
    xp: 0,
    carId: null,
  };
  G.drivers.push(driver);
  return { ok: true, driver };
}

// Returns the pace-based income multiplier for a car (1.0 if no driver).
function calcDriverPaceMult(car) {
  const tpMot = getTPBonuses().paceMult; // TP motivation bonus applies even without a driver
  if (!car.driverId) return 1.0 + tpMot;
  const driver = G.drivers.find(d => d.id === car.driverId);
  return driver ? 1 + driver.pace / 100 + tpMot : 1.0 + tpMot;
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

function fireDriver(driverId) {
  const idx = G.drivers.findIndex(d => d.id === driverId);
  if (idx === -1) return { ok: false, msg: 'Driver not found.' };
  const driver = G.drivers[idx];
  if (driver.carId) {
    const car = G.cars.find(c => c.id === driver.carId);
    if (car) car.driverId = null;
  }
  const name = driver.name;
  G.drivers.splice(idx, 1);
  return { ok: true, name };
}

// ─── Sponsor System ──────────────────────────────────────────────────────────

function getSponsorSlotsUnlocked() {
  let slots = 1;
  if (hasCompletedChampionship('gt4_regional')) slots = Math.max(slots, 2);
  if (G.reputation >= 3500)  slots = Math.max(slots, 3);
  if (G.reputation >= 20000) slots = Math.max(slots, 4);
  if (G.reputation >= 80000) slots = Math.max(slots, 5);
  return slots;
}

function isSponsorTargetMet(sponsor) {
  if (!sponsor.target) return true;
  const thisSeasonChamps = G.completedChampionships.filter(c => c.season === G.season);
  switch (sponsor.target) {
    case 'any_round_completed':
      return thisSeasonChamps.length > 0 ||
             G.activeChampionships.some(c => c.currentRound > 0);
    case 'any_champ_completed':
      return thisSeasonChamps.length > 0;
    case 'major_champ_completed':
      return thisSeasonChamps.some(c =>
        ['imsa_weathertech', 'elms', 'fia_wec', 'f1_world_championship'].includes(c.definitionId));
    case 'top_champ_completed':
      return thisSeasonChamps.some(c =>
        ['fia_wec', 'f1_world_championship'].includes(c.definitionId));
    default:
      return false;
  }
}

function getAvailableSponsorTiers() {
  const tiers = ['regional'];
  if ((G.champCompletions['gt4_regional'] || 0) > 0)
    tiers.push('national');
  if ((G.champCompletions['gt_world_challenge'] || 0) > 0 ||
      (G.champCompletions['imsa_weathertech'] || 0) > 0)
    tiers.push('international');
  if ((G.champCompletions['fia_wec'] || 0) > 0 ||
      (G.champCompletions['f1_world_championship'] || 0) > 0)
    tiers.push('factory');
  return tiers;
}

function generateSponsor(tier) {
  const tierDef = SPONSOR_TIERS[tier];
  const cat = SPONSOR_CATEGORIES[Math.floor(Math.random() * SPONSOR_CATEGORIES.length)];
  const brandWords = SPONSOR_BRAND_WORDS[cat.id];
  const brand  = brandWords[Math.floor(Math.random() * brandWords.length)];
  const suffix = SPONSOR_SUFFIXES[Math.floor(Math.random() * SPONSOR_SUFFIXES.length)];

  const incomePerSec = Math.floor(
    tierDef.incomeMin + Math.random() * (tierDef.incomeMax - tierDef.incomeMin + 1)
  );
  const seasonsRemaining = tierDef.contractMin !== null
    ? tierDef.contractMin + Math.floor(Math.random() * (tierDef.contractMax - tierDef.contractMin + 1))
    : null;

  return {
    id: 'sp_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
    name: brand + ' ' + suffix,
    category: cat.id,
    tier,
    incomePerSec,
    seasonsRemaining,
    bonusCash: tierDef.bonusCash,
    bonusRep: tierDef.bonusRep,
    bonusPP: tierDef.bonusPP,
    unlocksLivery: tierDef.unlocksLivery,
  };
}

function generateSponsorOptions() {
  const availTiers = getAvailableSponsorTiers();
  const options = [];
  const usedNames = new Set();
  let attempts = 0;
  while (options.length < 3 && attempts < 30) {
    const tier = availTiers[Math.floor(Math.random() * availTiers.length)];
    const s = generateSponsor(tier);
    if (!usedNames.has(s.name)) {
      usedNames.add(s.name);
      options.push(s);
    }
    attempts++;
  }
  while (options.length < 3) options.push(generateSponsor(availTiers[0]));
  return options;
}

function signSponsor(slotIndex, sponsorData) {
  if (slotIndex < 0 || slotIndex > 4)
    return { ok: false, msg: 'Invalid slot.' };
  if (slotIndex + 1 > getSponsorSlotsUnlocked())
    return { ok: false, msg: 'Slot not yet unlocked.' };
  if (G.sponsors[slotIndex] !== null)
    return { ok: false, msg: 'Slot already occupied.' };
  G.sponsors[slotIndex] = { ...sponsorData };
  addNotification(`Signed ${sponsorData.name} — $${formatNumber(sponsorData.incomePerSec)}/s!`, 'success');
  return { ok: true };
}

function terminateSponsor(sponsorId) {
  const idx = G.sponsors.findIndex(s => s && s.id === sponsorId);
  if (idx === -1) return { ok: false, msg: 'Sponsor not found.' };
  const name = G.sponsors[idx].name;
  G.sponsors[idx] = null;
  addNotification(`${name} contract terminated.`, 'info');
  return { ok: true };
}

function evaluateSponsorsAtSeasonEnd() {
  G.sponsors.forEach((s, i) => {
    if (!s) return;
    const met = isSponsorTargetMet(s);
    if (met) {
      if (s.bonusCash > 0) {
        G.money += s.bonusCash;
        G.totalEarned += s.bonusCash;
        addNotification(`${s.name} season bonus: +$${formatNumber(s.bonusCash)}!`, 'success');
      }
      if (s.bonusRep > 0) {
        G.reputation += s.bonusRep;
        addNotification(`${s.name}: +${formatNumber(s.bonusRep)} REP bonus!`, 'success');
      }
      if (s.bonusPP > 0) {
        G.prestigePoints += s.bonusPP;
        addNotification(`${s.name}: +${s.bonusPP} PP!`, 'prestige');
      }
      if (s.unlocksLivery && !G.hasFactoryLivery) {
        G.hasFactoryLivery = true;
        addNotification('Factory livery unlocked!', 'prestige');
      }
      if (s.seasonsRemaining !== null) {
        s.seasonsRemaining--;
        if (s.seasonsRemaining <= 0) {
          G.sponsors[i] = null;
          addNotification(`${s.name} contract ended — slot ${i + 1} is open.`, 'info');
        }
      }
    } else {
      addNotification(`${s.name} target not met — contract terminated.`, 'error');
      G.sponsors[i] = null;
    }
  });
}

// ─── Team Staff System ────────────────────────────────────────────────────────

// Shared stat budget generator (used by both TP and RE)
function generateBudgetStats(statKeys, statConfig, tier, randFn) {
  const cfg = statConfig[tier];
  const budget = Math.floor(randFn() * (cfg.budgetMax - cfg.budgetMin + 1)) + cfg.budgetMin;
  const primaryIdx = Math.floor(randFn() * statKeys.length);
  const primaryKey = statKeys[primaryIdx];
  const primaryRaw = Math.round(budget * (0.30 + randFn() * 0.10));
  const primaryVal = Math.min(cfg.ceiling, Math.max(cfg.floor, primaryRaw));
  const remaining  = budget - primaryVal;
  const otherKeys  = statKeys.filter(k => k !== primaryKey);
  const weights    = otherKeys.map(() => randFn() + 0.2);
  const wTotal     = weights.reduce((a, b) => a + b, 0);
  const stats = { [primaryKey]: primaryVal };
  otherKeys.forEach((key, i) => {
    const raw = Math.round(remaining * weights[i] / wTotal);
    stats[key] = Math.min(cfg.ceiling, Math.max(cfg.floor, raw));
  });
  return { stats, primaryStat: primaryKey };
}

// Returns computed bonuses from the active TP (or all zeros if none)
function getTPBonuses() {
  const tp = G.teamPrincipal;
  if (!tp) return { paceMult: 0, strategyRep: 0, upgradeCostMult: 1, sponsorMult: 0, scoutCostMult: 1 };
  return {
    paceMult:        tp.motivation         / 100 * 0.20,       // up to +20% driver pace
    strategyRep:     Math.round(tp.strategy / 100 * 2),        // up to +2 REP per round
    upgradeCostMult: 1 - tp.budgetManagement / 100 * 0.20,     // up to -20% upgrade cost
    sponsorMult:     tp.sponsorshipNetwork  / 100 * 0.30,      // up to +30% sponsor income
    scoutCostMult:   1 - tp.talentEye       / 100 * 0.30,      // up to -30% scout cost
  };
}

function getREForCar(carId) {
  return (G.raceEngineers && G.raceEngineers[carId]) || null;
}

// Returns computed bonuses from a car's RE (or all zeros if none)
function getREBonuses(carId) {
  const re = getREForCar(carId);
  if (!re) return { setupBonus: 0, reliBonus: 0, pitBonus: 0, coachBonus: 0, dataBonus: 0 };
  return {
    setupBonus: re.setupMastery           / 100 * 0.10,  // up to +10% all upgrade mults
    reliBonus:  re.reliabilityEngineering / 100 * 0.20,  // up to +20% reliability mult
    pitBonus:   re.pitWallStrategy        / 100 * 0.05,  // up to +5% champ income bonus
    coachBonus: re.driverCoach            / 100 * 0.50,  // up to +50% driver XP
    dataBonus:  re.dataAnalysis           / 100 * 0.10,  // up to +10% final payout
  };
}

// Upgrade cost after TP budget management discount
function getEffectiveUpgradeCost(upgradeId, currentLevel) {
  const base = getUpgradeCost(upgradeId, currentLevel);
  return Math.max(1, Math.floor(base * getTPBonuses().upgradeCostMult));
}

function _generateStaff(type, tier) {
  const statKeys   = type === 'tp' ? TP_STAT_KEYS   : RE_STAT_KEYS;
  const statConfig = type === 'tp' ? TP_STAT_CONFIG  : RE_STAT_CONFIG;
  const tierDef    = type === 'tp' ? TP_TIERS[tier]  : RE_TIERS[tier];
  const { stats, primaryStat } = generateBudgetStats(statKeys, statConfig, tier, Math.random);
  const name = STAFF_NAMES[Math.floor(Math.random() * STAFF_NAMES.length)];
  const obj  = {
    id: 'staff_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
    type,
    tier,
    name,
    primaryStat,
    salary: tierDef.salary,
  };
  statKeys.forEach(k => { obj[k] = stats[k]; });
  return obj;
}

function generateTPOptions() {
  return Object.keys(TP_TIERS)
    .filter(tier => !TP_TIERS[tier].locked)
    .map(tier => _generateStaff('tp', tier));
}

function generateREOptions() {
  return Object.keys(RE_TIERS)
    .filter(tier => !RE_TIERS[tier].locked)
    .map(tier => _generateStaff('re', tier));
}

function hireTP(staffData) {
  if (G.teamPrincipal) {
    const existingTierDef = TP_TIERS[G.teamPrincipal.tier];
    const buyout = Math.floor(existingTierDef.hireCost * 0.25);
    if (G.money < buyout) return { ok: false, msg: `Buying out current TP costs $${formatNumber(buyout)}.` };
    G.money -= buyout;
    addNotification(`Bought out ${G.teamPrincipal.name} for $${formatNumber(buyout)}.`, 'info');
  }
  const tierDef = TP_TIERS[staffData.tier];
  if (tierDef.hireCost > 0) {
    if (G.money < tierDef.hireCost) return { ok: false, msg: 'Not enough money.' };
    G.money -= tierDef.hireCost;
  }
  G.teamPrincipal = { ...staffData };
  addNotification(`Hired ${staffData.name} as Team Principal!`, 'success');
  return { ok: true };
}

function fireTP() {
  if (!G.teamPrincipal) return { ok: false, msg: 'No Team Principal to fire.' };
  const name = G.teamPrincipal.name;
  G.teamPrincipal = null;
  addNotification(`${name} stepped down as Team Principal.`, 'info');
  return { ok: true };
}

function hireRE(carId, staffData) {
  if (!G.raceEngineers) G.raceEngineers = {};
  if (G.raceEngineers[carId]) {
    const existingTierDef = RE_TIERS[G.raceEngineers[carId].tier];
    const buyout = Math.floor(existingTierDef.hireCost * 0.25);
    if (G.money < buyout) return { ok: false, msg: `Buying out current RE costs $${formatNumber(buyout)}.` };
    G.money -= buyout;
    addNotification(`Bought out ${G.raceEngineers[carId].name} for $${formatNumber(buyout)}.`, 'info');
  }
  const tierDef = RE_TIERS[staffData.tier];
  if (tierDef.hireCost > 0) {
    if (G.money < tierDef.hireCost) return { ok: false, msg: 'Not enough money.' };
    G.money -= tierDef.hireCost;
  }
  G.raceEngineers[carId] = { ...staffData };
  const car = G.cars.find(c => c.id === carId);
  addNotification(`Hired ${staffData.name} as Race Engineer for ${car ? car.name : carId}.`, 'success');
  return { ok: true };
}

function fireRE(carId) {
  if (!G.raceEngineers || !G.raceEngineers[carId]) return { ok: false, msg: 'No Race Engineer to fire.' };
  const name = G.raceEngineers[carId].name;
  delete G.raceEngineers[carId];
  addNotification(`${name} left the engineering team.`, 'info');
  return { ok: true };
}

function deductSeasonSalaries() {
  let total = 0;
  if (G.teamPrincipal) total += G.teamPrincipal.salary;
  if (G.raceEngineers) Object.values(G.raceEngineers).forEach(re => { total += re.salary; });
  if (total > 0) {
    G.money -= total;
    addNotification(`Season ${G.season} staff salaries: -$${formatNumber(total)}`, 'info');
  }
}

function _migrateStaff() {
  if (!G.teamPrincipal) G.teamPrincipal = null;
  if (!G.raceEngineers || typeof G.raceEngineers !== 'object' || Array.isArray(G.raceEngineers)) {
    G.raceEngineers = {};
  }
  // Remove RE entries for cars that no longer exist
  Object.keys(G.raceEngineers).forEach(carId => {
    if (!G.cars.find(c => c.id === carId)) delete G.raceEngineers[carId];
  });
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

  // Evaluate sponsor contracts before the season increments
  evaluateSponsorsAtSeasonEnd();

  const ppGain = calcPrestigePoints();
  G.prestigePoints += ppGain;
  G.season++;
  G.money = 5000;
  deductSeasonSalaries();

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

  // Driver XP (passive growth, boosted by RE driverCoach)
  G.drivers.forEach(d => {
    if (d.carId) {
      const coachBonus = getREBonuses(d.carId).coachBonus;
      d.xp += deltaSec * 0.1 * (1 + coachBonus);
    }
  });

  // Championship round progression
  const now = Date.now();
  G.activeChampionships.forEach(entry => {
    const elapsed = (now - entry.roundStartTime) / 1000;
    if (elapsed >= entry.roundDurationSec) {
      const champDef = getChampionshipById(entry.definitionId);
      const strategyRep = getTPBonuses().strategyRep;
      entry.currentRound++;
      entry.repEarned += champDef.repPerRound + strategyRep;
      G.reputation += champDef.repPerRound + strategyRep;
      entry.roundStartTime = now;

      const isFinal = entry.currentRound >= entry.maxRounds;
      if (isFinal) {
        // Final round bonus
        const car = G.cars.find(c => c.id === entry.carId);
        const champIncomePerSec = car ? calcCarIncomePerSec(car) : 0;
        const dataBonus = getREBonuses(entry.carId).dataBonus;
        const bonusCash = champIncomePerSec * entry.roundDurationSec * champDef.finalBonusMult * (1 + dataBonus);
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
        G.champCompletions[entry.definitionId] = (G.champCompletions[entry.definitionId] || 0) + 1;

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
      G.champCompletions[entry.definitionId] = (G.champCompletions[entry.definitionId] || 0) + 1;
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
    _migrateDriverStats();
    _migrateSponsors();
    _migrateStaff();
    return true;
  } catch (e) {
    console.warn('Load failed:', e);
    return false;
  }
}

// Regenerate the 5-stat block for drivers saved before the stat budget system.
// Uses the driver's ID number as a seed so results are deterministic on every load.
function _migrateDriverStats() {
  G.drivers.forEach(driver => {
    if (driver.tyreManagement === undefined) {
      const seed = parseInt(driver.id.replace('driver_', ''), 10) || 1;
      const { stats, primaryStat } = generateDriverStats(driver.tier || 'C', seededRand(seed));
      driver.pace           = stats.pace;
      driver.consistency    = stats.consistency;
      driver.tyreManagement = stats.tyreManagement;
      driver.rainSkill      = stats.rainSkill;
      driver.fitness        = stats.fitness;
      driver.primaryStat    = primaryStat;
    }
  });
}

// Ensure sponsors array is always a 5-element array (handles old saves)
function _migrateSponsors() {
  if (!Array.isArray(G.sponsors) || G.sponsors.length !== 5) {
    const existing = Array.isArray(G.sponsors) ? G.sponsors.filter(Boolean) : [];
    G.sponsors = [null, null, null, null, null];
    existing.forEach((s, i) => { if (i < 5) G.sponsors[i] = s; });
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

  try { tick(delta); } catch (e) { console.error('[gameLoop] tick error:', e); }

  if (now - _lastSaveTime > SAVE_INTERVAL_MS) {
    saveGame();
    _lastSaveTime = now;
  }

  requestAnimationFrame(gameLoop);
}
