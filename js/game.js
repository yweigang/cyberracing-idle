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
        coDriverIds: [],
        championshipId: null,
        autoRenew: null,
      },
    ],
    drivers: [],
    activeChampionships: [],
    completedChampionships: [],
    champCompletions: {},      // { champId: totalCount } — persists across season resets
    seasonEndCount: 0,         // increments each time endSeason() is called
    seasonStartTime: Date.now(),
    lastSeasonSummary: null,   // result of the most recent endSeason(), for the Season panel
    prestige: {
      totalResets: 0,
      prestigeCount: 0,        // increments each time doPrestige() is called
      lastPrestigeSeason: 0,   // G.season value at last prestige (for PP calculation)
      lastPrestigeAt: 0,       // timestamp of the last reset (results after it earn PP)
      repAtLastPrestige: 0,
      permanentBonuses: {
        incomeMultiplier: 1.0,   // race rating multiplier (Wind Tunnel Program)
        scoutDiscount: 0,
        devTokens: 0,
        sponsorBonus: 0,
        headStartLevels: 0,
      },
      purchased: [],
    },
    sponsors: [null, null, null, null, null],
    sponsorOffers: null,       // { season, offers } — fixed sponsor offers for the current season
    hasFactoryLivery: false,
    teamPrincipal: null,
    raceEngineers: {},
    licensePtMultiplier: LICENSE_CONFIG.defaultMultiplier,
    hq: { simulator: 0, composites: 0, hospitality: 0 },
    notifications: [],
  };
}

// ─── Car Performance ──────────────────────────────────────────────────────────

// Class base rating raised by upgrades (each level adds a % of the base).
// Reliability above Lv 10 adds 1% per level.
function calcCarBaseRating(car) {
  const cls = getCarClassById(car.classId);
  const u = car.upgrades;
  const pct = UPGRADE_ORDER.reduce((sum, id) => sum + u[id] * UPGRADES[id].ratingPctPerLevel, 0)
    + Math.max(0, u.reliability - 10);
  return (cls ? cls.baseRating : 100) * (1 + pct / 100);
}

// Weighted driver skill (0–100) for a race format and conditions
function calcDriverSkill(driver, format, wet) {
  if (!driver) return 0;
  let pace = driver.pace;
  if (wet) pace = (driver.pace + driver.rainSkill) / 2;
  if (format === 'endurance') {
    return pace * 0.5 + driver.tyreManagement * 0.25 + driver.fitness * 0.25;
  }
  return pace * 0.7 + driver.tyreManagement * 0.3;
}

// Drivers seated in a car: the lead driver first, then co-drivers
function getCarLineup(car) {
  return [car.driverId, ...(car.coDriverIds || [])]
    .map(id => id && G.drivers.find(d => d.id === id)).filter(Boolean);
}

// Drivers a series expects per car (sprint series race with the lead driver only)
function getLineupSize(champDef) {
  return (champDef && champDef.lineupSize) || 1;
}

// Seats a lineup of the given size is short
function getMissingDrivers(car, lineupSize = 1) {
  return Math.max(0, lineupSize - getCarLineup(car).length);
}

// Stint-averaged skill of the first `lineupSize` drivers. Stints nobody covers are
// driven by the fittest driver at reduced, fatigued skill.
function calcLineupSkill(car, format = 'sprint', wet = false, lineupSize = 1) {
  const lineup = getCarLineup(car).slice(0, lineupSize);
  if (!lineup.length) return 0;
  const stints = lineup.map(d => calcDriverSkill(d, format, wet));
  const fittest = lineup.reduce((a, b) => ((b.fitness || 0) > (a.fitness || 0) ? b : a));
  const fatigued = calcDriverSkill(fittest, format, wet) * (FATIGUE_SKILL_BASE + (fittest.fitness || 0) / FATIGUE_FITNESS_DIV);
  while (stints.length < lineupSize) stints.push(fatigued);
  return stints.reduce((a, b) => a + b, 0) / lineupSize;
}

// Full race rating of a car with its current lineup and staff
function calcCarRating(car, format = 'sprint', wet = false, lineupSize = 1) {
  const reB = getREBonuses(car.id);
  const driverMult = 1 + calcLineupSkill(car, format, wet, lineupSize) / 100 + getTPBonuses().paceMult;
  return calcCarBaseRating(car) * driverMult * (1 + reB.setupBonus)
    * G.prestige.permanentBonuses.incomeMultiplier * (1 + getHQLevel('simulator') * 0.015);
}

// Chance per round that the car retires. Endurance rounds are twice as punishing,
// and every missing driver in the lineup adds fatigue mistakes.
function calcDNFChance(car, format = 'sprint', lineupSize = 1) {
  const reB = getREBonuses(car.id);
  const base = Math.max(0.01, 0.10 - car.upgrades.reliability * 0.01);
  const fatigue = 1 + SHORT_LINEUP_DNF_PENALTY * getMissingDrivers(car, lineupSize);
  return base * (format === 'endurance' ? 2 : 1) * fatigue * Math.max(0, 1 - reB.reliBonus * 2);
}

// Sponsor income is now the primary passive income source.
// Car income formula is retained only for championship payout bonus calculations.
function _sponsorMult() {
  const prestigeBonus = (G.prestige && G.prestige.permanentBonuses && G.prestige.permanentBonuses.sponsorBonus) || 0;
  return 1 + prestigeBonus + getTPBonuses().sponsorMult + getHQLevel('hospitality') * 0.05;
}

// Share of a sponsor's income paid straight away (targeted sponsors hold the rest back)
function _upfrontShare(sponsor) {
  return sponsor.target ? SPONSOR_UPFRONT_SHARE : 1;
}

// Sponsor income paid out right now, per second
function calcSponsorIncomePerSec() {
  const parentsIncome = 8; // Mum & Dad Racing Support — always active
  const sponsors = Array.isArray(G.sponsors) ? G.sponsors : [];
  const paid = sponsors.reduce((sum, s) => sum + (s ? s.incomePerSec * _upfrontShare(s) : 0), 0);
  return (parentsIncome + paid) * _sponsorMult();
}

// Sponsor income held back until season end, per second
function calcSponsorHeldPerSec() {
  const sponsors = Array.isArray(G.sponsors) ? G.sponsors : [];
  return sponsors.reduce((sum, s) => sum + (s ? s.incomePerSec * (1 - _upfrontShare(s)) : 0), 0) * _sponsorMult();
}

// Pay `sec` seconds of sponsor income and accrue each sponsor's held-back share
function accrueSponsorIncome(sec) {
  const income = calcSponsorIncomePerSec() * sec;
  G.money += income;
  G.totalEarned += income;
  const mult = _sponsorMult();
  G.sponsors.forEach(s => {
    if (s && s.target) s.heldBack = (s.heldBack || 0) + s.incomePerSec * (1 - SPONSOR_UPFRONT_SHARE) * mult * sec;
  });
}

function calcTotalIncomePerSec() {
  return calcSponsorIncomePerSec();
}

// ─── Upgrade Logic ────────────────────────────────────────────────────────────

function canAffordUpgrade(car, upgradeId) {
  const cost = getEffectiveUpgradeCost(upgradeId, car.upgrades[upgradeId], car.classId);
  return G.money >= cost;
}

function isUpgradeMaxed(car, upgradeId) {
  return car.upgrades[upgradeId] >= UPGRADES[upgradeId].maxLevel;
}

function buyUpgrade(carId, upgradeId) {
  const car = G.cars.find(c => c.id === carId);
  if (!car) return { ok: false, msg: 'Car not found.' };
  if (isUpgradeMaxed(car, upgradeId)) return { ok: false, msg: 'Already maxed.' };

  const cost = getEffectiveUpgradeCost(upgradeId, car.upgrades[upgradeId], car.classId);
  if (G.money < cost) return { ok: false, msg: 'Not enough money.' };

  G.money -= cost;
  car.upgrades[upgradeId]++;
  return { ok: true };
}

function isSingleSeaterUnlocked() {
  return (G.prestige.prestigeCount || 0) >= 1;
}

// ─── Buy Car ──────────────────────────────────────────────────────────────────

function buyCar(classId) {
  const cls = getCarClassById(classId);
  if (!cls) return { ok: false, msg: 'Unknown car class.' };
  if (cls.pathway === 'single_seater' && !isSingleSeaterUnlocked()) {
    return { ok: false, msg: 'Single-Seater Pathway not yet unlocked.' };
  }
  if (G.reputation < cls.repRequired) return { ok: false, msg: `Need ${formatNumber(cls.repRequired)} REP.` };
  if (cls.ppRequired && G.prestigePoints < cls.ppRequired) return { ok: false, msg: `Need ${cls.ppRequired} PP.` };

  const totalSlots = getGarageSlots(G.garageLevel);
  if (G.cars.length >= totalSlots) return { ok: false, msg: 'Expand your garage to buy more cars.' };

  const ownedOfClass = G.cars.filter(c => c.classId === classId).length;
  if (ownedOfClass >= cls.maxOwned) return { ok: false, msg: `Max ${cls.maxOwned} ${cls.name} cars owned.` };

  if (G.money < cls.baseCost) return { ok: false, msg: 'Not enough money.' };

  G.money -= cls.baseCost;
  const id = 'car_' + G.nextCarId++;
  // First free number, so names stay unique after selling
  let count = 1;
  while (G.cars.some(c => c.name === `${cls.name} #${count}`)) count++;
  G.cars.push({
    id,
    classId,
    name: `${cls.name} #${count}`,
    upgrades: { engine: 0, aero: 0, tyres: 0, brakes: 0, reliability: 0 },
    driverId: null,
    coDriverIds: [],
    championshipId: null,
    autoRenew: null,
  });
  return { ok: true, carId: id };
}

// ─── Team HQ ──────────────────────────────────────────────────────────────────

function isHQUnlocked() {
  return G.reputation >= HQ_UNLOCK_REP;
}

function getHQLevel(id) {
  return (G.hq && G.hq[id]) || 0;
}

function getHQCost(id) {
  const f = HQ_FACILITIES.find(x => x.id === id);
  return f ? Math.floor(f.baseCost * Math.pow(f.costMult, getHQLevel(id))) : Infinity;
}

function getHQPrestigePoints() {
  return HQ_FACILITIES.reduce((sum, f) => sum + getHQLevel(f.id), 0) * HQ_PP_PER_LEVEL;
}

function buyHQ(id) {
  const f = HQ_FACILITIES.find(x => x.id === id);
  if (!f) return { ok: false, msg: 'Unknown facility.' };
  if (!isHQUnlocked()) return { ok: false, msg: `Team HQ unlocks at ${formatNumber(HQ_UNLOCK_REP)} REP.` };
  if (f.maxLevel !== null && getHQLevel(id) >= f.maxLevel) return { ok: false, msg: 'Already maxed.' };
  const cost = getHQCost(id);
  if (G.money < cost) return { ok: false, msg: 'Not enough money.' };
  G.money -= cost;
  if (!G.hq) G.hq = {};
  G.hq[id] = getHQLevel(id) + 1;
  return { ok: true, level: G.hq[id] };
}

// ─── Sell Car ─────────────────────────────────────────────────────────────────

function getCarSellValue(car) {
  const cls = getCarClassById(car.classId);
  let upgradeSpend = 0;
  UPGRADE_ORDER.forEach(id => {
    for (let lvl = 0; lvl < car.upgrades[id]; lvl++) upgradeSpend += getUpgradeCost(id, lvl, car.classId);
  });
  return Math.floor((cls ? cls.baseCost : 0) * SELL_CAR_REFUND + upgradeSpend * SELL_UPGRADE_REFUND);
}

function sellCar(carId) {
  const idx = G.cars.findIndex(c => c.id === carId);
  if (idx === -1) return { ok: false, msg: 'Car not found.' };
  const car = G.cars[idx];
  if (car.championshipId) return { ok: false, msg: 'Withdraw from the championship first.' };
  if (G.cars.length <= 1) return { ok: false, msg: 'You cannot sell your last car.' };

  const value = getCarSellValue(car);
  getCarLineup(car).forEach(d => { d.carId = null; });
  if (G.raceEngineers && G.raceEngineers[carId]) delete G.raceEngineers[carId];
  G.cars.splice(idx, 1);
  G.money += value;
  addNotification(`Sold ${car.name} for $${formatNumber(value)}.`, 'info');
  return { ok: true, value };
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

// ─── Season Clock ─────────────────────────────────────────────────────────────

function getSeasonEndTime() {
  return G.seasonStartTime + SEASON_LENGTH_SEC * 1000;
}

function getSeasonTimeLeft(at = Date.now()) {
  return Math.max(0, (getSeasonEndTime() - at) / 1000);
}

function getChampionshipDuration(champDef) {
  return champDef.rounds * champDef.roundDurationSec;
}

function fitsInSeason(champDef, at = Date.now()) {
  return getChampionshipDuration(champDef) <= getSeasonTimeLeft(at);
}

function enterChampionship(definitionId, carId, at = Date.now()) {
  const champDef = getChampionshipById(definitionId);
  if (!champDef) return { ok: false, msg: 'Unknown championship.' };

  if (champDef.pathway === 'single_seater' && !isSingleSeaterUnlocked())
    return { ok: false, msg: 'Single-Seater Pathway not yet unlocked.' };

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
  if (!car.driverId) return { ok: false, msg: 'Assign a driver first.' };
  if (!fitsInSeason(champDef, at)) return { ok: false, msg: 'Not enough time left this season.' };
  if (G.money < champDef.entryFee) return { ok: false, msg: 'Not enough money for entry fee.' };

  G.money -= champDef.entryFee;

  const entry = {
    id: 'champ_entry_' + _champIdCounter++,
    definitionId,
    carId,
    currentRound: 0,
    maxRounds: champDef.rounds,
    roundStartTime: at,
    roundDurationSec: champDef.roundDurationSec,
    repEarned: 0,
    prizeEarned: 0,
    classId: car.classId,
    points: 0,
    results: [],
    lastRound: null,
    field: generateField(champDef, car.classId),
    startedAt: at,
  };

  G.activeChampionships.push(entry);
  car.championshipId = entry.id;
  car.autoRenew = definitionId;
  return { ok: true, entryId: entry.id };
}

function withdrawFromChampionship(entryId) {
  const idx = G.activeChampionships.findIndex(c => c.id === entryId);
  if (idx === -1) return { ok: false, msg: 'Entry not found.' };

  const entry = G.activeChampionships[idx];
  const car = G.cars.find(c => c.id === entry.carId);
  if (car) { car.championshipId = null; car.autoRenew = null; }

  G.activeChampionships.splice(idx, 1);
  return { ok: true };
}

function setAutoRenew(carId, on) {
  const car = G.cars.find(c => c.id === carId);
  if (!car) return { ok: false, msg: 'Car not found.' };
  const entry = G.activeChampionships.find(e => e.id === car.championshipId);
  car.autoRenew = on ? (entry ? entry.definitionId : car.autoRenew) : null;
  return { ok: true };
}

// ─── Race Engine ──────────────────────────────────────────────────────────────

function _gauss() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// AI field strength for one class in a series
function getFieldStrength(champDef, classId) {
  const fs = champDef.fieldStrength;
  return fs[classId] || fs[champDef.allowedClasses[0]];
}

// P1 round prize for a class; higher classes in a series pay proportionally more
function getRoundPrize(champDef, classId) {
  const cls = getCarClassById(classId);
  return cls ? cls.baseIncomePerLap * champDef.prizeMult : 0;
}

function generateField(champDef, classId) {
  const strength = getFieldStrength(champDef, classId);
  const names = [...RIVAL_TEAMS].sort(() => Math.random() - 0.5).slice(0, FIELD_SIZE);
  return names.map((name, i) => ({
    name,
    rating: Math.round(strength * (1 - FIELD_SPREAD / 2 + FIELD_SPREAD * i / (FIELD_SIZE - 1)) * (0.97 + Math.random() * 0.06)),
    points: 0,
  }));
}

const getPrizeFactor = pos => PRIZE_FACTORS[Math.min(pos - 1, PRIZE_FACTORS.length - 1)];
const getRoundPoints = pos => POINTS_TABLE[pos - 1] || 0;

// Current standings, best first. The player's row has isPlayer: true.
function getStandings(entry) {
  const rows = entry.field.map(r => ({ name: r.name, points: r.points, rating: r.rating, isPlayer: false }));
  rows.push({ name: 'Your Team', points: entry.points, isPlayer: true });
  // On equal points the player ranks behind (no countback)
  return rows.sort((a, b) => b.points - a.points || (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
}

function getStandingPosition(entry) {
  return getStandings(entry).findIndex(r => r.isPlayer) + 1;
}

// Simulate one round: positions, points, prize money and REP
function runChampionshipRound(entry) {
  const champDef = getChampionshipById(entry.definitionId);
  const car = G.cars.find(c => c.id === entry.carId);
  const wet = Math.random() < (champDef.wetChance || 0);
  const format = champDef.format || 'sprint';
  const size = getLineupSize(champDef);
  const lineup = car ? getCarLineup(car).slice(0, size) : [];

  const aiScores = entry.field.map(r => r.rating * (1 + _gauss() * RACE_NOISE));
  let pos = null, dnf = false, dns = false;
  if (!car || !lineup.length) {
    dns = true;
  } else if (Math.random() < calcDNFChance(car, format, size)) {
    dnf = true;
  } else {
    const consistency = lineup.reduce((sum, d) => sum + (d.consistency || 0), 0) / lineup.length;
    const noise = RACE_NOISE * (1 - consistency / 200);
    const score = calcCarRating(car, format, wet, size) * (1 + _gauss() * noise);
    pos = 1 + aiScores.filter(sc => sc > score).length;
  }

  // AI points: rank AI by score, shifted one place down behind the player
  aiScores.map((sc, i) => ({ sc, i })).sort((a, b) => b.sc - a.sc).forEach((o, rank) => {
    const aiPos = rank + 1 + (pos !== null && rank + 1 >= pos ? 1 : 0);
    entry.field[o.i].points += getRoundPoints(aiPos);
  });

  let prize = 0, rep = 0, points = 0;
  if (pos !== null) {
    points = getRoundPoints(pos);
    prize = Math.round(getRoundPrize(champDef, entry.classId) * getPrizeFactor(pos) * (1 + getREBonuses(car.id).pitBonus));
    rep = Math.round(champDef.repPerRound * getPrizeFactor(pos)) + getTPBonuses().strategyRep;
  }
  entry.points += points;
  entry.prizeEarned += prize;
  entry.repEarned += rep;
  entry.results.push(dns ? 'DNS' : dnf ? 'DNF' : pos);
  entry.currentRound++;
  entry.lastRound = { pos, dnf, dns, wet, prize, rep, points, driverId: lineup[0] ? lineup[0].id : null,
    driverIds: lineup.map(d => d.id), missing: car ? getMissingDrivers(car, size) : 0 };
  G.money += prize;
  G.totalEarned += prize;
  G.reputation += rep;
  return entry.lastRound;
}

// Final standings payout and completion record
function finishChampionship(entry) {
  const champDef = getChampionshipById(entry.definitionId);
  const car = G.cars.find(c => c.id === entry.carId);
  const finalPos = getStandingPosition(entry);
  const share = STANDING_BONUS[finalPos - 1] || 0;
  const dataBonus = getREBonuses(entry.carId).dataBonus;
  const bonusCash = Math.round(getRoundPrize(champDef, entry.classId) * entry.maxRounds * share * (1 + dataBonus));
  const bonusRep  = Math.round(champDef.repPerRound * entry.maxRounds * share);
  G.money += bonusCash;
  G.totalEarned += bonusCash;
  G.reputation += bonusRep;
  entry.repEarned += bonusRep;

  // Every driver seated in the car earns LP; those beyond the series' lineup were reserves
  const lineup = car ? getCarLineup(car) : [];
  const classId = entry.classId || (car && car.classId);
  const lpByDriver = {};
  lineup.forEach((d, i) => {
    lpByDriver[d.id] = awardChampionshipLP(d, classId, finalPos, entry.carId, i < getLineupSize(champDef) ? 1 : RESERVE_LP_SHARE);
  });
  const lpGained = lineup[0] ? lpByDriver[lineup[0].id] : {};

  G.completedChampionships.push({
    definitionId: entry.definitionId,
    carId: entry.carId,
    driverId: car ? car.driverId : null,
    driverIds: lineup.map(d => d.id),
    lpByDriver,
    classId,
    finalPosition: finalPos,
    points: entry.points,
    results: entry.results.slice(),
    lpGained,
    repEarned: entry.repEarned,
    prizeEarned: entry.prizeEarned + bonusCash,
    season: G.season,
    completedAt: Date.now(),
  });
  G.champCompletions[entry.definitionId] = (G.champCompletions[entry.definitionId] || 0) + 1;
  if (car) car.championshipId = null;
  entry._completed = true;
  return { finalPos, bonusCash, bonusRep, lpGained, lineupCount: lineup.length };
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

let _allowLockedScout = false;

function scoutDriver(tier) {
  const tierDef = DRIVER_TIERS[tier];
  if (!tierDef) return { ok: false, msg: 'Unknown tier.' };
  if (tierDef.locked && !_allowLockedScout) return { ok: false, msg: 'Special acquisition only.' };
  const discount = G.prestige.permanentBonuses.scoutDiscount || 0;
  const effectiveScoutCost = Math.floor(tierDef.scoutCost * getTPBonuses().scoutCostMult * (1 - discount));
  if (G.money < effectiveScoutCost) return { ok: false, msg: 'Not enough money.' };

  G.money -= effectiveScoutCost;

  const { stats, primaryStat } = generateDriverStats(tier, Math.random);
  const name = DRIVER_NAMES[Math.floor(Math.random() * DRIVER_NAMES.length)];

  const ageRange = DRIVER_AGE_RANGES[tier] || { min: 18, max: 35 };
  const age = ageRange.min + Math.floor(Math.random() * (ageRange.max - ageRange.min + 1));
  const retirementAge = 41 + Math.floor(Math.random() * 5); // 41–45

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
    age,
    retirementAge,
    carId: null,
    licenses: [...(TIER_STARTING_LICENSES[tier] || ['GT4'])],
    licensePoints: Object.fromEntries(LICENSE_TIERS.map(lt => [lt.id,
      (TIER_STARTING_LICENSES[tier] || ['GT4']).includes(lt.id) ? lt.pointsRequired : 0])),
  };
  G.drivers.push(driver);
  return { ok: true, driver };
}

// Pace multiplier from the lead driver (1.0 if no driver), as shown on the car card
function calcDriverPaceMult(car) {
  const tpMot = getTPBonuses().paceMult;
  const driver = car.driverId ? G.drivers.find(d => d.id === car.driverId) : null;
  return 1 + calcDriverSkill(driver, 'sprint', false) / 100 + tpMot;
}

// Takes a driver out of their car. If the lead leaves, the first co-driver takes over.
function _detachDriver(driver) {
  const car = driver.carId && G.cars.find(c => c.id === driver.carId);
  if (car) {
    car.coDriverIds = (car.coDriverIds || []).filter(id => id !== driver.id);
    if (car.driverId === driver.id) car.driverId = car.coDriverIds.shift() || null;
  }
  driver.carId = null;
}

// Seats a driver in a car. slot 'lead' takes the lead seat (the previous lead becomes
// a co-driver if a seat is free); slot 'co' joins as a co-driver, or as lead if the car is empty.
function assignDriver(driverId, carId, slot = 'lead') {
  const driver = G.drivers.find(d => d.id === driverId);
  const car = G.cars.find(c => c.id === carId);
  if (!driver || !car) return { ok: false, msg: 'Driver or car not found.' };

  const requiredLicenseId = CLASS_LICENSE_REQUIREMENT[car.classId];
  if (requiredLicenseId && !(driver.licenses || []).includes(requiredLicenseId)) {
    const licenseDef = LICENSE_TIERS.find(lt => lt.id === requiredLicenseId);
    const currentLP  = (driver.licensePoints || {})[requiredLicenseId] || 0;
    const needed     = licenseDef ? licenseDef.pointsRequired - currentLP : '?';
    return { ok: false, msg: `${driver.name} doesn't hold a ${requiredLicenseId} license yet — ${needed} more LP needed.` };
  }
  if (!car.coDriverIds) car.coDriverIds = [];
  const others = getCarLineup(car).filter(d => d.id !== driverId).length;
  if (slot === 'co' && others >= MAX_LINEUP)
    return { ok: false, msg: `${car.name} already has ${MAX_LINEUP} drivers.` };

  _detachDriver(driver);
  if (!car.driverId) {
    car.driverId = driverId;
  } else if (slot === 'lead') {
    const prevLead = G.drivers.find(d => d.id === car.driverId);
    car.driverId = driverId;
    if (prevLead) {
      if (getCarLineup(car).length < MAX_LINEUP) car.coDriverIds.unshift(prevLead.id);
      else prevLead.carId = null;
    }
  } else {
    car.coDriverIds.push(driverId);
  }
  driver.carId = carId;
  return { ok: true };
}

function unassignDriver(driverId) {
  const driver = G.drivers.find(d => d.id === driverId);
  if (!driver) return { ok: false, msg: 'Driver not found.' };
  _detachDriver(driver);
  return { ok: true };
}

function fireDriver(driverId) {
  const idx = G.drivers.findIndex(d => d.id === driverId);
  if (idx === -1) return { ok: false, msg: 'Driver not found.' };
  const driver = G.drivers[idx];
  _detachDriver(driver);
  const name = driver.name;
  G.drivers.splice(idx, 1);
  return { ok: true, name };
}

// ─── Sponsor System ──────────────────────────────────────────────────────────

function getSponsorSlotsUnlocked() {
  let slots = 1;
  if (hasCompletedChampionship('gt4_regional')) slots = Math.max(slots, 2);
  if (G.reputation >= 3500)  slots = Math.max(slots, 3);
  if (G.reputation >= 15000) slots = Math.max(slots, 4);
  if (G.reputation >= 40000) slots = Math.max(slots, 5);
  return slots;
}

// Round results (positions, 'DNF', 'DNS') raced this season
function _seasonRoundResults() {
  const done = G.completedChampionships.filter(c => c.season === G.season).flatMap(c => c.results || []);
  const live = G.activeChampionships.flatMap(e => e.results || []);
  return done.concat(live);
}

// { have, need } toward a sponsor target this season
function getSponsorTargetProgress(target) {
  const season = G.completedChampionships.filter(c => c.season === G.season);
  const tierOf = c => { const cls = getCarClassById(c.classId); return cls ? cls.tier : 0; };
  switch (target.type) {
    case 'round_podiums':
      return { have: _seasonRoundResults().filter(r => typeof r === 'number' && r <= 3).length, need: target.count };
    case 'round_wins':
      return { have: _seasonRoundResults().filter(r => r === 1).length, need: target.count };
    case 'champ_top':
      return { have: season.some(c => c.finalPosition <= target.pos && tierOf(c) >= (target.minTier || 1)) ? 1 : 0, need: 1 };
    case 'major_top':
      return { have: season.some(c => c.finalPosition <= target.pos && MAJOR_CHAMPIONSHIPS.includes(c.definitionId)) ? 1 : 0, need: 1 };
    case 'top_title':
      return { have: season.some(c => c.finalPosition === 1 && TOP_CHAMPIONSHIPS.includes(c.definitionId)) ? 1 : 0, need: 1 };
    default:
      return { have: 0, need: 1 };
  }
}

function describeSponsorTarget(target) {
  if (typeof target === 'string') return SPONSOR_TARGET_LABELS[target] || target;
  switch (target.type) {
    case 'round_podiums': return `${target.count} round podium${target.count > 1 ? 's' : ''} this season`;
    case 'round_wins':    return `${target.count} round win${target.count > 1 ? 's' : ''} this season`;
    case 'champ_top': {
      const where = target.minTier > 1 ? ` (${CAR_CLASSES.filter(c => c.tier === target.minTier && !c.pathway).map(c => c.name).join('/')} or higher)` : '';
      return target.pos === 1 ? `Win a championship${where} this season` : `Top ${target.pos} in a championship${where} this season`;
    }
    case 'major_top': return `Top ${target.pos} in a major championship (IMSA, ELMS, WEC, F2, F1)`;
    case 'top_title': return 'Win FIA WEC or the F1 World Championship this season';
    default: return '';
  }
}

function isSponsorTargetMet(sponsor) {
  const target = sponsor.target;
  if (!target) return true;
  if (typeof target === 'object') {
    const p = getSponsorTargetProgress(target);
    return p.have >= p.need;
  }
  // Contracts signed before result targets
  const thisSeasonChamps = G.completedChampionships.filter(c => c.season === G.season);
  switch (target) {
    case 'any_round_completed':
      return thisSeasonChamps.length > 0 || G.activeChampionships.some(c => c.currentRound > 0);
    case 'any_champ_completed':
      return thisSeasonChamps.length > 0;
    case 'major_champ_completed':
      return thisSeasonChamps.some(c => MAJOR_CHAMPIONSHIPS.includes(c.definitionId));
    case 'top_champ_completed':
      return thisSeasonChamps.some(c => TOP_CHAMPIONSHIPS.includes(c.definitionId));
    default:
      return false;
  }
}

// Championships completed since the last prestige (sponsor interest follows the current run)
function _runChampionships() {
  const since = (G.prestige && G.prestige.lastPrestigeAt) || 0;
  return G.completedChampionships.filter(c => (c.completedAt || 0) > since && c.finalPosition);
}

function _bestFinish(champIds) {
  return _runChampionships().filter(c => champIds.includes(c.definitionId))
    .reduce((m, c) => Math.min(m, c.finalPosition), Infinity);
}

// Sponsor tiers interested in the team, based on results in the current run
function getAvailableSponsorTiers() {
  const tiers = ['regional'];
  const anyTop3 = _runChampionships().some(c => c.finalPosition <= 3);
  if (anyTop3) tiers.push('national');
  if (_bestFinish(MAJOR_CHAMPIONSHIPS) <= 5) tiers.push('international');
  if (_bestFinish(TOP_CHAMPIONSHIPS) <= 3) tiers.push('factory');
  return tiers;
}

function _rollTarget(tierDef) {
  const t = tierDef.targets[Math.floor(Math.random() * tierDef.targets.length)];
  const target = { type: t.type };
  if (t.countMin !== undefined) target.count = t.countMin + Math.floor(Math.random() * (t.countMax - t.countMin + 1));
  if (t.pos !== undefined) target.pos = t.pos;
  if (t.minTier !== undefined) target.minTier = t.minTier;
  return target;
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
    id: 'sp_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
    name: brand + ' ' + suffix,
    category: cat.id,
    tier,
    incomePerSec,
    seasonsRemaining,
    target: _rollTarget(tierDef),
    bonusCash: tierDef.bonusCash,
    bonusRep: tierDef.bonusRep,
    bonusPP: tierDef.bonusPP,
    unlocksLivery: tierDef.unlocksLivery,
  };
}

// Offers are generated once per season; the best available tier is always offered
function getSponsorOffers() {
  if (!G.sponsorOffers || G.sponsorOffers.season !== G.season) {
    const tiers = getAvailableSponsorTiers();
    const offers = [generateSponsor(tiers[tiers.length - 1])];
    while (offers.length < SPONSOR_OFFERS_PER_SEASON) {
      offers.push(generateSponsor(tiers[Math.floor(Math.random() * tiers.length)]));
    }
    G.sponsorOffers = { season: G.season, offers };
  }
  return G.sponsorOffers.offers;
}

function signSponsorOffer(slotIndex, offerId) {
  const offers = getSponsorOffers();
  const idx = offers.findIndex(o => o.id === offerId);
  if (idx === -1) return { ok: false, msg: 'Offer no longer available.' };
  const res = signSponsor(slotIndex, offers[idx]);
  if (res.ok) offers.splice(idx, 1);
  return res;
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
    const held = Math.round(s.heldBack || 0);
    s.heldBack = 0;
    if (met) {
      if (held > 0) {
        G.money += held;
        G.totalEarned += held;
        addNotification(`${s.name} target met — held-back income paid: +$${formatNumber(held)}`, 'success');
      }
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
      addNotification(`${s.name} target not met — contract terminated${held > 0 ? `, $${formatNumber(held)} held-back income forfeited` : ''}.`, 'error');
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
function getEffectiveUpgradeCost(upgradeId, currentLevel, classId) {
  const base = getUpgradeCost(upgradeId, currentLevel, classId);
  return Math.max(1, Math.floor(base * getTPBonuses().upgradeCostMult * (1 - getHQLevel('composites') * 0.03)));
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

// Apply stat growth/decline based on driver's career stage after aging
function _applyDriverSeasonAging(driver) {
  const stage = getCareerStage(driver.age);
  const cfg   = DRIVER_STAT_CONFIG[driver.tier];
  if (!cfg) return;

  if (stage.id === 'rising') {
    DRIVER_STAT_KEYS.forEach(k => {
      driver[k] = Math.min(cfg.ceiling, Math.ceil(driver[k] * 1.08));
    });
  } else if (stage.id === 'prime') {
    DRIVER_STAT_KEYS.forEach(k => {
      driver[k] = Math.min(cfg.ceiling, Math.ceil(driver[k] * 1.02));
    });
  } else if (stage.id === 'late') {
    driver.pace    = Math.max(1, driver.pace    - 1);
    driver.fitness = Math.max(1, driver.fitness - 1);
  } else if (stage.id === 'retirement') {
    driver.pace        = Math.max(1, driver.pace        - 2);
    driver.fitness     = Math.max(1, driver.fitness     - 1);
    driver.consistency = Math.max(1, driver.consistency - 1);
  }
  // junior / veteran: no stat change
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

// Backfill driver age and retirementAge for saves predating these fields
function _migrateDriverAge() {
  G.drivers.forEach(d => {
    if (d.age === undefined) {
      const seed = parseInt(d.id.replace('driver_', ''), 10) || 1;
      const rand = seededRand(seed);
      const range = DRIVER_AGE_RANGES[d.tier] || { min: 18, max: 35 };
      d.age = range.min + Math.floor(rand() * (range.max - range.min + 1));
    }
    if (d.retirementAge === undefined) {
      const seed = parseInt(d.id.replace('driver_', ''), 10) || 1;
      const rand = seededRand(seed + 5000);
      d.retirementAge = 41 + Math.floor(rand() * 5);
    }
  });
}

// Ensure season/prestige tracking fields exist on old saves
function _migratePrestige() {
  if (G.seasonEndCount === undefined) G.seasonEndCount = 0;
  const pb = G.prestige.permanentBonuses;
  if (pb.scoutDiscount === undefined) pb.scoutDiscount = 0;
  if (pb.devTokens === undefined) pb.devTokens = 0;
  if (G.prestige.lastPrestigeAt === undefined) G.prestige.lastPrestigeAt = 0;
  if (G.prestige.repAtLastPrestige === undefined) G.prestige.repAtLastPrestige = 0;
  if (!G.prestige) G.prestige = createDefaultState().prestige;
  if (G.prestige.prestigeCount   === undefined) G.prestige.prestigeCount   = 0;
  if (G.prestige.lastPrestigeSeason === undefined) G.prestige.lastPrestigeSeason = 0;
  _migrateDriverAge();
}

// Ensure all drivers have license data (for saves created before the license system)
function _migrateDriverLicenses() {
  if (G.licensePtMultiplier === undefined) G.licensePtMultiplier = LICENSE_CONFIG.defaultMultiplier;
  G.drivers.forEach(d => {
    if (!d.licenses) d.licenses = ['GT4'];
    if (!d.licensePoints) d.licensePoints = {};
    // Ensure every license tier has an entry
    LICENSE_TIERS.forEach(lt => {
      if (d.licensePoints[lt.id] === undefined) {
        // If the driver already holds this license (from the licenses array), set to threshold
        d.licensePoints[lt.id] = d.licenses.includes(lt.id) ? lt.pointsRequired : 0;
      }
    });
    // Retroactively grant licenses where LP already meets the threshold
    LICENSE_TIERS.forEach(lt => {
      if ((d.licensePoints[lt.id] || 0) >= lt.pointsRequired && !d.licenses.includes(lt.id)) {
        d.licenses.push(lt.id);
      }
    });
  });
}

// Saves from before the season clock start a fresh season timer
function _migrateSeasonClock() {
  if (!G.seasonStartTime) G.seasonStartTime = G.lastSave || Date.now();
  if (G.lastSeasonSummary === undefined) G.lastSeasonSummary = null;
  G.cars.forEach(c => {
    if (c.autoRenew === undefined) {
      const entry = G.activeChampionships.find(e => e.id === c.championshipId);
      c.autoRenew = entry ? entry.definitionId : null;
    }
  });
}

// Championships entered before the race engine get a rival field and standings
function _migrateRaceEntries() {
  G.activeChampionships.forEach(entry => {
    const champDef = getChampionshipById(entry.definitionId);
    const car = G.cars.find(c => c.id === entry.carId);
    if (!entry.classId) entry.classId = car ? car.classId : champDef.allowedClasses[0];
    if (!entry.field) entry.field = generateField(champDef, entry.classId);
    if (entry.points === undefined) entry.points = 0;
    if (!entry.results) entry.results = [];
    if (entry.prizeEarned === undefined) entry.prizeEarned = entry.incomeEarned || 0;
    if (entry.lastRound === undefined) entry.lastRound = null;
  });
}

// If a save has single-seater cars already (from before pathway gating), treat as unlocked
function _migrateSingleSeater() {
  const SINGLE_SEATER_IDS = ['F4', 'F3', 'F2', 'F1'];
  const hasSingleSeaterCar = G.cars.some(c => SINGLE_SEATER_IDS.includes(c.classId));
  if (hasSingleSeaterCar && (G.prestige.prestigeCount || 0) === 0) {
    G.prestige.prestigeCount = 1;
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

// ─── End Season ───────────────────────────────────────────────────────────────

// Drivers and class for a completed championship. Records from before lineups list
// only the lead driver; older ones fall back to the car's current driver.
function _champDriverAndClass(comp) {
  const car = G.cars.find(c => c.id === comp.carId);
  if (comp.driverIds) return { driverIds: comp.driverIds, classId: comp.classId };
  if (comp.driverId !== undefined) {
    return { driverIds: comp.driverId ? [comp.driverId] : [], classId: comp.classId || (car && car.classId) };
  }
  return { driverIds: car && car.driverId ? [car.driverId] : [], classId: car ? car.classId : null };
}

// Award License Points to a driver for one completed championship.
// Returns { licenseId: pointsEarned } for licenses not yet held.
function awardChampionshipLP(driver, classId, finalPos, carId, share = 1) {
  if (!driver) return {};
  const lpTable = LP_EARN_TABLE[classId] || {};
  const factor  = LICENSE_RESULT_FACTORS[Math.min(finalPos, LICENSE_RESULT_FACTORS.length) - 1];
  const mult    = (G.licensePtMultiplier || 1.0) * (1 + getREBonuses(carId).coachBonus) * factor * share;
  if (!driver.licensePoints) driver.licensePoints = {};
  if (!driver.licenses) driver.licenses = ['GT4'];

  const earned = {};
  Object.entries(lpTable).forEach(([licenseId, baseLP]) => {
    if (driver.licenses.includes(licenseId)) return;
    const pts = Math.round(baseLP * mult);
    if (pts <= 0) return;
    driver.licensePoints[licenseId] = (driver.licensePoints[licenseId] || 0) + pts;
    earned[licenseId] = pts;

    const licenseDef = LICENSE_TIERS.find(lt => lt.id === licenseId);
    if (licenseDef && driver.licensePoints[licenseId] >= licenseDef.pointsRequired) {
      driver.licenses.push(licenseId);
      _notify(`🏆 ${driver.name} has earned their ${licenseDef.name} License!`, 'success');
    }
  });
  return earned;
}

// LP earned this season per driver, summed from completed championships
function _seasonLPByDriver(season) {
  const byDriver = {};
  G.completedChampionships.filter(c => c.season === season).forEach(c => {
    const perDriver = c.lpByDriver || (c.driverId && c.lpGained ? { [c.driverId]: c.lpGained } : {});
    Object.entries(perDriver).forEach(([driverId, earned]) => {
      const acc = byDriver[driverId] = byDriver[driverId] || {};
      Object.entries(earned).forEach(([id, pts]) => { acc[id] = (acc[id] || 0) + pts; });
    });
  });
  return byDriver;
}

function endSeason() {
  const endedSeason = G.season;
  const seasonResults = G.completedChampionships
    .filter(c => c.season === endedSeason)
    .map(c => ({ definitionId: c.definitionId, classId: c.classId, finalPosition: c.finalPosition, prizeEarned: c.prizeEarned }));

  // 1. Evaluate all active sponsor contracts
  evaluateSponsorsAtSeasonEnd();

  // 2. Deduct staff salaries
  deductSeasonSalaries();

  // 3. LP was awarded per championship; collect it for the summary
  const lpByDriver = _seasonLPByDriver(endedSeason);

  // 4. Age all drivers, apply career stat changes, handle retirements
  // Snapshot stats before changes so we can return a diff for the UI
  const snapshots = G.drivers.map(d => ({
    id: d.id, name: d.name,
    ageBefore: d.age || 20,
    statsBefore: DRIVER_STAT_KEYS.reduce((o, k) => { o[k] = d[k]; return o; }, {}),
  }));

  const retirees = [];
  G.drivers.forEach(d => {
    d.age = (d.age || 20) + 1;
    if (d.age === 40) addNotification(`${d.name} is in their final seasons.`, 'warning');
    _applyDriverSeasonAging(d);
    if (d.age >= (d.retirementAge || 43)) retirees.push(d.id);
  });

  // Build driver change records before retirements remove drivers
  const driverChanges = snapshots.map(snap => {
    const d = G.drivers.find(x => x.id === snap.id);
    const ageAfter  = snap.ageBefore + 1;
    const lpGained  = lpByDriver[snap.id] || {};
    if (!d || retirees.includes(snap.id)) {
      return { name: snap.name, ageBefore: snap.ageBefore, ageAfter, retired: true, changes: {}, lpGained };
    }
    const changes = {};
    DRIVER_STAT_KEYS.forEach(k => {
      const diff = d[k] - snap.statsBefore[k];
      if (diff !== 0) changes[k] = diff;
    });
    return { name: snap.name, ageBefore: snap.ageBefore, ageAfter, stage: getCareerStage(ageAfter), retired: false, changes, lpGained };
  });

  // Auto-retire queued drivers
  retirees.forEach(driverId => {
    const d = G.drivers.find(x => x.id === driverId);
    if (!d) return;
    addNotification(`${d.name} has retired aged ${d.age}.`, 'info');
    _detachDriver(d);
    G.drivers.splice(G.drivers.findIndex(x => x.id === driverId), 1);
  });

  // 5. Award XP (per championship completion; separate from LP)
  G.completedChampionships
    .filter(c => c.season === G.season)
    .forEach(comp => {
      _champDriverAndClass(comp).driverIds.forEach(driverId => {
        const driver = G.drivers.find(d => d.id === driverId);
        if (driver) driver.xp += 100;
      });
    });

  // 6. Abandon all in-progress championships
  G.activeChampionships.forEach(entry => {
    const car = G.cars.find(c => c.id === entry.carId);
    if (car) car.championshipId = null;
  });
  G.activeChampionships = [];

  // 7. Legend contracts end with the season
  G.drivers.filter(d => d.contractUntilSeason !== undefined && d.contractUntilSeason <= endedSeason).forEach(d => {
    _detachDriver(d);
    G.drivers.splice(G.drivers.indexOf(d), 1);
    addNotification(`${d.name}'s legend contract has ended.`, 'info');
  });

  // 8. Increment season
  G.season++;
  G.seasonEndCount = (G.seasonEndCount || 0) + 1;

  G.seasonStartTime = getSeasonEndTime();

  G.lastSeasonSummary = { season: endedSeason, driverChanges, results: seasonResults };
  addNotification(`Season ${endedSeason} ended. Season ${G.season} begins!`, 'success');
  return { ok: true, driverChanges };
}

// ─── Prestige ─────────────────────────────────────────────────────────────────

// Results since the last reset, each worth PP by series and finishing position
function calcPrestigePoints() {
  const since = G.prestige.lastPrestigeAt || 0;
  let pp = 0;
  G.completedChampionships.filter(c => (c.completedAt || 0) > since && c.finalPosition).forEach(c => {
    const titlePP = PRESTIGE_TITLE_PP[c.definitionId] || 0;
    if (c.finalPosition === 1) pp += titlePP;
    else if (c.finalPosition <= 3) pp += titlePP * PRESTIGE_PODIUM_SHARE;
  });
  const repGained = Math.max(0, G.reputation - (G.prestige.repAtLastPrestige || 0));
  return Math.floor(pp + repGained / PRESTIGE_REP_PER_PP) + getHQPrestigePoints();
}

function canPrestige() {
  return calcPrestigePoints() >= PRESTIGE_MIN_GAIN;
}

function getPrestigeItemCount(itemId) {
  return G.prestige.purchased.filter(p => p === itemId).length;
}

function buyPrestigeItem(itemId) {
  const item = PRESTIGE_ITEMS.find(i => i.id === itemId);
  if (!item) return { ok: false, msg: 'Unknown item.' };
  if (item.maxPurchases && getPrestigeItemCount(itemId) >= item.maxPurchases) return { ok: false, msg: 'Already maxed.' };
  if (G.prestigePoints < item.cost) return { ok: false, msg: 'Not enough PP.' };

  const bonuses = G.prestige.permanentBonuses;
  if (itemId === 'legend_contract') {
    _allowLockedScout = true;
    let res;
    try { res = scoutDriver('L'); } finally { _allowLockedScout = false; }
    if (!res.ok) return res;
    res.driver.contractUntilSeason = G.season;
    addNotification(`Legend ${res.driver.name} signed until the end of season ${G.season}.`, 'prestige');
  }
  G.prestigePoints -= item.cost;
  G.prestige.purchased.push(itemId);
  if (itemId === 'head_start')      bonuses.headStartLevels = (bonuses.headStartLevels || 0) + 1;
  if (itemId === 'wind_tunnel')     bonuses.incomeMultiplier = (bonuses.incomeMultiplier || 1) + 0.03;
  if (itemId === 'factory_backing') bonuses.sponsorBonus = (bonuses.sponsorBonus || 0) + 0.25;
  if (itemId === 'talent_academy')  bonuses.scoutDiscount = 0.5;
  if (itemId === 'dev_token')       bonuses.devTokens = (bonuses.devTokens || 0) + 1;
  addNotification(`Purchased: ${item.name}`, 'prestige');
  return { ok: true };
}

function doPrestige() {
  if (!canPrestige()) return { ok: false, msg: `Earn at least ${PRESTIGE_MIN_GAIN} PP first.` };

  const ppGain = calcPrestigePoints();
  G.prestigePoints += ppGain;
  G.prestige.lastPrestigeSeason = G.season;
  G.prestige.lastPrestigeAt = Date.now();
  G.prestige.repAtLastPrestige = G.reputation;
  const prevPrestigeCount = G.prestige.prestigeCount || 0;
  G.prestige.prestigeCount = prevPrestigeCount + 1;
  G.prestige.totalResets++;
  const singleSeaterJustUnlocked = prevPrestigeCount === 0;

  // Reset money and end all championships
  G.money = 5000;
  G.activeChampionships = [];

  // Cars: development tokens keep the highest-class cars, the rest are scrapped.
  // There is always at least one GT4 to restart with.
  const tokens = G.prestige.permanentBonuses.devTokens || 0;
  const keptCars = [...G.cars]
    .sort((a, b) => getCarClassById(b.classId).tier - getCarClassById(a.classId).tier)
    .slice(0, tokens);
  if (!keptCars.some(c => c.classId === 'GT4')) {
    const ownGT4 = G.cars.find(c => c.classId === 'GT4');
    if (ownGT4) keptCars.push(ownGT4);
  }
  G.cars.filter(c => !keptCars.includes(c)).forEach(c => {
    if (G.raceEngineers && G.raceEngineers[c.id]) delete G.raceEngineers[c.id];
  });
  G.cars = keptCars;
  if (!G.cars.some(c => c.classId === 'GT4')) {
    G.cars.push({ id: 'car_' + G.nextCarId++, classId: 'GT4', name: 'GT4 #1', upgrades: {}, driverId: null, coDriverIds: [], championshipId: null, autoRenew: null });
  }

  // Upgrades reset to the head-start level (2 reliability levels are kept)
  const headStart = G.prestige.permanentBonuses.headStartLevels || 0;
  G.cars.forEach(car => {
    const oldReli = car.upgrades.reliability || 0;
    const fresh = {};
    UPGRADE_ORDER.forEach(id => { fresh[id] = Math.min(UPGRADES[id].maxLevel, headStart); });
    fresh.reliability = Math.min(20, Math.min(oldReli, 2) + headStart);
    car.upgrades = fresh;
    car.championshipId = null;
    car.autoRenew = null;
  });

  // Drivers keep their seats only in surviving cars
  G.drivers.forEach(d => { if (d.carId && !G.cars.some(c => c.id === d.carId)) d.carId = null; });
  G.cars.forEach(c => {
    if (c.driverId && !G.drivers.some(d => d.id === c.driverId)) c.driverId = null;
    c.coDriverIds = (c.coDriverIds || []).filter(id => G.drivers.some(d => d.id === id));
    if (!c.driverId) c.driverId = c.coDriverIds.shift() || null;
  });
  const gt4 = G.cars.find(c => c.classId === 'GT4' && !c.driverId);
  if (gt4) {
    const free = G.drivers.filter(d => !d.carId).sort((a, b) => calcDriverSkill(b, 'sprint') - calcDriverSkill(a, 'sprint'))[0];
    if (free) assignDriver(free.id, gt4.id);
  }

  // Sponsor contracts end; a fresh set of offers is waiting
  G.sponsors = [null, null, null, null, null];
  G.sponsorOffers = null;

  // HQ facilities are rebuilt each run (their levels were paid out as PP)
  G.hq = { simulator: 0, composites: 0, hospitality: 0 };

  addNotification(`Prestige! +${ppGain} PP. The team starts over with ${G.cars.length} car${G.cars.length > 1 ? 's' : ''} and $5,000.`, 'prestige');
  if (singleSeaterJustUnlocked) {
    addNotification('🏎️ Single-Seater Pathway Unlocked! F4 is now available.', 'prestige');
  }
  return { ok: true, ppGain, singleSeaterJustUnlocked };
}

// ─── Notifications ────────────────────────────────────────────────────────────

function addNotification(msg, type = 'info') {
  G.notifications.push({ msg, type, ts: Date.now() });
  if (G.notifications.length > 50) G.notifications.shift();
}

// ─── Tick Logic ──────────────────────────────────────────────────────────────

function tick(deltaMs) {
  const deltaSec = deltaMs / 1000;

  // Passive sponsor income
  accrueSponsorIncome(deltaSec);

  // Driver XP (passive growth, boosted by RE driverCoach)
  G.drivers.forEach(d => {
    if (d.carId) {
      const coachBonus = getREBonuses(d.carId).coachBonus;
      d.xp += deltaSec * 0.1 * (1 + coachBonus);
    }
  });

  advanceWorld(Date.now());
}

let _quietNotifications = false;
function _notify(msg, type) { if (!_quietNotifications) addNotification(msg, type); }

// Advance championships, auto-renewals and the season clock up to time `now`
function advanceWorld(now) {
  // Rounds due before the season ends are raced first
  const roundCutoff = Math.min(now, getSeasonEndTime());
  G.activeChampionships.forEach(entry => {
    const champDef = getChampionshipById(entry.definitionId);
    while (!entry._completed && entry.roundStartTime + entry.roundDurationSec * 1000 <= roundCutoff) {
      entry.roundStartTime += entry.roundDurationSec * 1000;
      const r = runChampionshipRound(entry);
      const tag = `${champDef.shortName} R${entry.currentRound}/${entry.maxRounds}${r.wet ? ' (wet)' : ''}`;
      if (r.dns)      _notify(`${tag}: did not start — no driver.`, 'error');
      else if (r.dnf) _notify(`${tag}: DNF — mechanical failure.`, 'error');
      else _notify(`${tag}: finished P${r.pos} · +$${formatNumber(r.prize)} · +${r.rep} REP`, r.pos <= 3 ? 'success' : 'info');

      if (entry.currentRound >= entry.maxRounds) {
        const fin = finishChampionship(entry);
        entry._finishedAt = entry.roundStartTime;
        const title = fin.finalPos === 1 ? '🏆 CHAMPIONS!' : `finished P${fin.finalPos} overall`;
        const lpText = Object.entries(fin.lpGained || {}).map(([id, p]) => `+${p} ${id} LP`).join(', ')
          + (fin.lineupCount > 1 ? ' (lead driver)' : '');
        _notify(`${champDef.name}: ${title}${fin.bonusCash ? ` +$${formatNumber(fin.bonusCash)} standings bonus` : ''}${lpText ? ' · ' + lpText : ''}`, fin.finalPos <= 3 ? 'success' : 'info');
      }
    }
  });
  const finished = G.activeChampionships.filter(e => e._completed);
  G.activeChampionships = G.activeChampionships.filter(e => !e._completed);

  // Auto-renew: re-enter the same series right after finishing, if it still fits
  finished.forEach(entry => _tryAutoRenew(G.cars.find(c => c.id === entry.carId), entry._finishedAt));
  // Cars still waiting (e.g. short on the entry fee) retry quietly
  G.cars.forEach(car => _tryAutoRenew(car, now, true));

  if (now >= getSeasonEndTime()) {
    endSeason();
    G.cars.forEach(car => _tryAutoRenew(car, G.seasonStartTime));
    if (now >= getSeasonEndTime()) advanceWorld(now);   // more than one season elapsed
  }
}

function _tryAutoRenew(car, at, quiet = false) {
  if (!car || !car.autoRenew || car.championshipId) return;
  const res = enterChampionship(car.autoRenew, car.id, at);
  if (!res.ok && !quiet && res.msg !== 'Not enough time left this season.') {
    _notify(`${car.name}: auto-renew paused — ${res.msg}`, 'error');
  }
}

// ─── Offline Progress ────────────────────────────────────────────────────────

function applyOfflineProgress() {
  const now = Date.now();
  const elapsed = Math.min((now - G.lastSave) / 1000, MAX_OFFLINE_SEC);
  if (elapsed < 5) return;

  const earnedBefore = G.totalEarned;

  // Time beyond the offline cap is frozen: shift all clocks forward by it
  const frozenMs = Math.max(0, now - G.lastSave - elapsed * 1000);
  if (frozenMs > 0) {
    G.seasonStartTime += frozenMs;
    G.activeChampionships.forEach(e => { e.roundStartTime += frozenMs; });
  }

  // Replay rounds, auto-renewals and season ends in order
  const titlesBefore = G.completedChampionships.filter(c => c.finalPosition === 1).length;
  const seasonBefore = G.season;
  _quietNotifications = true;
  try {
    for (let t = G.lastSave + frozenMs; t < now; ) {
      const next = Math.min(now, t + 5000);
      accrueSponsorIncome((next - t) / 1000);
      advanceWorld(next);
      t = next;
    }
  } finally {
    _quietNotifications = false;
  }
  const titles = G.completedChampionships.filter(c => c.finalPosition === 1).length - titlesBefore;
  const seasons = G.season - seasonBefore;
  const parts = [];
  if (titles > 0) parts.push(`${titles} title${titles > 1 ? 's' : ''} won`);
  if (seasons > 0) parts.push(`${seasons} season${seasons > 1 ? 's' : ''} completed`);
  if (parts.length) addNotification(`While you were away: ${parts.join(', ')}.`, 'info');
  _offlineEarned = G.totalEarned - earnedBefore;

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
    _migratePrestige();
    _migrateSingleSeater();
    _migrateDriverLicenses();
    _migrateRaceEntries();
    _migrateSeasonClock();
    if (!G.hq) G.hq = { simulator: 0, composites: 0, hospitality: 0 };
    G.cars.forEach(c => { if (!c.coDriverIds) c.coDriverIds = []; }); // saves before driver lineups
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
  _setupNewGame();
}

function _setupNewGame() {
  const res = scoutDriver('C');
  if (res.ok) assignDriver(res.driver.id, G.cars[0].id);
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
    _setupNewGame();
  } else {
    const elapsed = applyOfflineProgress();
    if (elapsed > 5) {
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
