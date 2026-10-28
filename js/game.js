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
    teamName: DEFAULT_TEAM_NAME,
    lastSeenVersion: null,     // newest release whose notes the player has seen
    money: 5000,
    reputation: 0,
    prestigePoints: 0,
    season: 1,
    totalEarned: 0,
    garageLevel: 1,
    nextCarId: 2,
    nextDriverId: 1,
    nextEntryId: 1,            // championship entries and registrations (saved, so ids stay unique across reloads)
    cars: [
      {
        id: 'car_1',
        classId: 'GT4',
        name: 'GT4 #1',
        upgrades: { reliability: 0 },
        setupChamps: 0,
        driverId: null,
        coDriverIds: [],
        championshipId: null,
        autoRenew: null,
      },
    ],
    drivers: [],
    activeChampionships: [],
    registrations: [],         // entries for next season: { id, definitionId, carId, fee }
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
      sponsorPP: 0,            // sponsor PP bonuses, paid out at the next reset
      permanentBonuses: {
        incomeMultiplier: 1.0,   // race rating multiplier (Performance Programme)
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
    teamPrincipals: { gt_endurance: null, single_seater: null },
    raceEngineers: {},
    spareEngineers: [],        // paid race engineers whose car was sold, waiting for a car
    licensePtMultiplier: LICENSE_CONFIG.defaultMultiplier,
    hq: { simulator: 0, composites: 0, hospitality: 0 },
    pitCrew: { level: 0, size: 1 },
    notifications: [],
  };
}

// ─── Car Performance ──────────────────────────────────────────────────────────

// Setup knowledge bonus a car has built up from completed championships
function getSetupBonus(car) {
  return Math.min(SETUP_BONUS_MAX, (car.setupChamps || 0) * SETUP_BONUS_PER_CHAMP);
}

// Balanced class rating plus the car's setup knowledge
function calcCarBaseRating(car) {
  const cls = getCarClassById(car.classId);
  return (cls ? cls.baseRating : 100) * (1 + getSetupBonus(car));
}

// ─── Pit Crew ─────────────────────────────────────────────────────────────────

// Cars the crew covers fully: highest classes first
function getCrewCoveredCarIds() {
  return [...G.cars].sort((a, b) => getCarClassById(b.classId).tier - getCarClassById(a.classId).tier)
    .slice(0, G.pitCrew.size).map(c => c.id);
}

// Rating bonus (fraction) the pit crew gives a car in a race format
function getPitCrewBonus(car, format = 'sprint') {
  const pct = format === 'endurance' ? PIT_CREW.endurancePctPerLevel : PIT_CREW.sprintPctPerLevel;
  const share = getCrewCoveredCarIds().includes(car.id) ? 1 : PIT_CREW.uncoveredShare;
  return G.pitCrew.level * pct / 100 * share;
}

// Discounts from the Team Principal and the Crew Training Centre
function _crewCostMult() {
  return getTPBonuses().upgradeCostMult * (1 - getHQLevel('composites') * 0.03);
}

function getPitCrewLevelCost() {
  return Math.floor(PIT_CREW.levelBaseCost * Math.pow(PIT_CREW.levelCostMult, G.pitCrew.level) * _crewCostMult());
}

function getPitCrewSizeCost() {
  return Math.floor(PIT_CREW.sizeBaseCost * Math.pow(PIT_CREW.sizeCostMult, G.pitCrew.size - 1) * _crewCostMult());
}

function trainPitCrew() {
  if (G.pitCrew.level >= PIT_CREW.maxLevel) return { ok: false, msg: 'Pit crew fully trained.' };
  const cost = getPitCrewLevelCost();
  if (G.money < cost) return { ok: false, msg: 'Not enough money.' };
  G.money -= cost;
  G.pitCrew.level++;
  return { ok: true, level: G.pitCrew.level };
}

function expandPitCrew() {
  if (G.pitCrew.size >= PIT_CREW.maxSize) return { ok: false, msg: 'Pit crew at full size.' };
  const cost = getPitCrewSizeCost();
  if (G.money < cost) return { ok: false, msg: 'Not enough money.' };
  G.money -= cost;
  G.pitCrew.size++;
  return { ok: true, size: G.pitCrew.size };
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

const getSpecialDef = driver => (driver && driver.special && SPECIAL_DRIVERS.find(s => s.id === driver.special)) || null;

// Skill in a particular car: special drivers can be stronger in some classes
function calcDriverSkillInCar(driver, car, format, wet) {
  const special = getSpecialDef(driver);
  const boost = special && special.classBoost && special.classBoost.classes.includes(car.classId) ? special.classBoost.mult : 1;
  return calcDriverSkill(driver, format, wet) * boost;
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

// Largest lineup any series open to this class asks for
function getMaxLineupForClass(classId) {
  return CHAMPIONSHIPS.filter(c => c.allowedClasses.includes(classId))
    .reduce((m, c) => Math.max(m, getLineupSize(c)), 1);
}

// Racing seats in a car: its current series' lineup, else the largest open to its class.
// Drivers seated beyond this are reserves.
function getCarLineupSize(car) {
  const entry = car.championshipId && G.activeChampionships.find(e => e.id === car.championshipId);
  return entry ? getLineupSize(getChampionshipById(entry.definitionId)) : getMaxLineupForClass(car.classId);
}

// Seats in a car: the most race drivers its class ever needs, plus one reserve
function getCarSeatLimit(car) {
  return Math.min(MAX_LINEUP, getMaxLineupForClass(car.classId) + 1);
}

// Whether a driver sits in a car's reserve seats
function isReserveDriver(driver) {
  const car = driver.carId && G.cars.find(c => c.id === driver.carId);
  return !!car && getCarLineup(car).findIndex(d => d.id === driver.id) >= getCarLineupSize(car);
}

// Seats a lineup of the given size is short
function getMissingDrivers(car, lineupSize = 1) {
  return Math.max(0, lineupSize - getCarLineup(car).length);
}

// Stint-averaged skill of the first `lineupSize` drivers. Stints nobody covers are
// driven by the fittest driver at reduced, fatigued skill.
function calcLineupSkill(car, format = 'sprint', wet = false, lineupSize = 1, drivers) {
  const lineup = drivers || getCarLineup(car).slice(0, lineupSize);
  if (!lineup.length) return 0;
  const stints = lineup.map(d => calcDriverSkillInCar(d, car, format, wet));
  const fittest = lineup.reduce((a, b) => ((b.fitness || 0) > (a.fitness || 0) ? b : a));
  const fatigued = calcDriverSkillInCar(fittest, car, format, wet) * (FATIGUE_SKILL_BASE + (fittest.fitness || 0) / FATIGUE_FITNESS_DIV);
  while (stints.length < lineupSize) stints.push(fatigued);
  return stints.reduce((a, b) => a + b, 0) / lineupSize;
}

// Full race rating of a car with its current lineup and staff
// drivers: who actually races (defaults to the car's first lineupSize drivers)
function calcCarRating(car, format = 'sprint', wet = false, lineupSize = 1, drivers) {
  const reB = getREBonuses(car.id);
  const driverMult = 1 + calcLineupSkill(car, format, wet, lineupSize, drivers) / 100 + getTPBonuses(car).paceMult;
  return calcCarBaseRating(car) * driverMult * (1 + reB.setupBonus) * (1 + getPitCrewBonus(car, format))
    * G.prestige.permanentBonuses.incomeMultiplier * (1 + getHQLevel('simulator') * 0.015);
}

// Chance per round that the car retires. Endurance rounds are twice as punishing,
// and every missing driver in the lineup adds fatigue mistakes.
// absent: lineup drivers who skipped the round, which leaves the lineup short too
function calcDNFChance(car, format = 'sprint', lineupSize = 1, absent = 0) {
  const reB = getREBonuses(car.id);
  const base = Math.max(0.01, 0.10 - car.upgrades.reliability * 0.01);
  const fatigue = 1 + SHORT_LINEUP_DNF_PENALTY * (getMissingDrivers(car, lineupSize) + absent);
  return base * (format === 'endurance' ? 2 : 1) * fatigue * Math.max(0, 1 - reB.reliBonus * 2);
}

// Sponsor income is now the primary passive income source.
// Car income formula is retained only for championship payout bonus calculations.
function _sponsorMult() {
  const prestigeBonus = (G.prestige && G.prestige.permanentBonuses && G.prestige.permanentBonuses.sponsorBonus) || 0;
  return 1 + prestigeBonus + getTPBonuses().sponsorMult + getHQLevel('hospitality') * 0.05 + getFameTier().sponsor;
}

// Share of a sponsor's income paid straight away (targeted sponsors hold the rest back)
function _upfrontShare(sponsor) {
  return sponsor.target ? SPONSOR_UPFRONT_SHARE : 1;
}

// A sponsor's income per second after bonuses, split into what is paid now and
// what is held back until its target is met at season end
function getSponsorPayRates(sponsor) {
  const mult = _sponsorMult();
  const now = sponsor.incomePerSec * _upfrontShare(sponsor) * mult;
  return { now, held: sponsor.incomePerSec * mult - now };
}

// Family support after bonuses
function getFamilySupportPerSec() {
  return FAMILY_SUPPORT_IPS * _sponsorMult();
}

// Sponsor income paid out right now, per second
function calcSponsorIncomePerSec() {
  const parentsIncome = FAMILY_SUPPORT_IPS; // Mum & Dad Racing Support — always active
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
    upgrades: { reliability: 0 },
    setupChamps: 0,
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

// Money needed to get racing again with no car: the cheapest car the team may buy
// plus the cheapest entry fee of a series open to it
function getRestartCost() {
  let best = Infinity;
  CAR_CLASSES.forEach(cls => {
    if (cls.pathway === 'single_seater' && !isSingleSeaterUnlocked()) return;
    if (G.reputation < cls.repRequired || (cls.ppRequired && G.prestigePoints < cls.ppRequired)) return;
    const fees = CHAMPIONSHIPS.filter(c => c.allowedClasses.includes(cls.id)
      && (!c.pathway || isSingleSeaterUnlocked())
      && G.reputation >= (c.repRequired || 0) && checkChampionshipPrerequisite(c)).map(c => getClassEntryFee(c, cls.id));
    if (fees.length) best = Math.min(best, cls.baseCost + Math.min(...fees));
  });
  return best;
}

// Whether a car may be sold. The last car only sells if the money afterwards still
// buys a new car and pays its entry fee, so the team can never get stuck.
function canSellCar(carId) {
  const car = G.cars.find(c => c.id === carId);
  if (!car) return { ok: false, msg: 'Car not found.' };
  if (G.cars.length === 1) {
    const need = getRestartCost();
    if (G.money + getCarSellValue(car) < need)
      return { ok: false, msg: `You can't sell your last car unless you'd still have $${formatNumber(need)} for a new car and an entry fee.` };
  }
  return { ok: true };
}

// Sells a car. A championship it is racing in is abandoned (no fee refund);
// a next-season registration is refunded.
function sellCar(carId) {
  const idx = G.cars.findIndex(c => c.id === carId);
  if (idx === -1) return { ok: false, msg: 'Car not found.' };
  const car = G.cars[idx];
  const check = canSellCar(carId);
  if (!check.ok) return check;

  if (car.championshipId) withdrawFromChampionship(car.championshipId);
  const value = getCarSellValue(car);
  getCarLineup(car).forEach(d => { d.carId = null; });
  _releaseCarEngineer(carId);
  if (getRegistration(carId)) cancelRegistration(carId);
  G.cars.splice(idx, 1);
  G.money += value;
  addNotification(`Sold ${car.name} for $${formatNumber(value)}.`, 'info');
  return { ok: true, value };
}

// ─── Garage Upgrade ───────────────────────────────────────────────────────────

// ─── Team ─────────────────────────────────────────────────────────────────────

// Renames the team. HTML-special characters are dropped since names are shown in markup.
function renameTeam(name) {
  const clean = String(name || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, TEAM_NAME_MAX_LENGTH);
  if (!clean) return { ok: false, msg: 'Team name cannot be empty.' };
  G.teamName = clean;
  return { ok: true, name: clean };
}

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

// Next id for a championship entry or registration. The counter lives in the save:
// a counter that restarted on every reload handed out ids already in use.
function _newEntryId(prefix) {
  return prefix + G.nextEntryId++;
}

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

// Entry fee for a car: full for a new slot, RENEWAL_FEE_SHARE once the car has raced the series
function hasSeriesSlot(car, champDef) {
  return !!(car && champDef && (car.seriesSlots || []).includes(champDef.id));
}

// First entry fee for a class in a series, rounded to two significant digits
function getClassEntryFee(champDef, classId = champDef.allowedClasses[0]) {
  const raw = getRoundPrize(champDef, classId) * champDef.rounds * (champDef.entryFeeShare || ENTRY_FEE_SHARE);
  const unit = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
  return Math.round(raw / unit) * unit;
}

function getRenewalFee(champDef, classId) {
  return Math.round(getClassEntryFee(champDef, classId) * RENEWAL_FEE_SHARE);
}

// Fee a car pays to enter; without a car, the fee for classId (default: the series' first class)
function getEntryFee(champDef, car, classId = car ? car.classId : undefined) {
  return hasSeriesSlot(car, champDef) ? getRenewalFee(champDef, classId) : getClassEntryFee(champDef, classId);
}

function fitsInSeason(champDef, at = Date.now()) {
  return getChampionshipDuration(champDef) <= getSeasonTimeLeft(at);
}

// Rule checks shared by entering now and registering for next season.
// Returns an error message, or null when the car may enter.
function _entryProblem(champDef, car) {
  if (!champDef) return 'Unknown championship.';
  if (champDef.pathway === 'single_seater' && !isSingleSeaterUnlocked())
    return 'Single-Seater Pathway not yet unlocked.';
  if (G.reputation < (champDef.repRequired || 0))
    return `Need ${formatNumber(champDef.repRequired)} REP to enter.`;
  if (!checkChampionshipPrerequisite(champDef)) return `Complete ${getPrerequisiteLabel(champDef)} first.`;
  if (!car) return 'Car not found.';
  if (!champDef.allowedClasses.includes(car.classId)) return `${car.name} cannot enter this series.`;
  if (!car.driverId) return 'Assign a driver first.';
  return null;
}

// prepaidFee: the fee already paid through a next-season registration, if any
function enterChampionship(definitionId, carId, at = Date.now(), prepaidFee = null) {
  const champDef = getChampionshipById(definitionId);
  const car = G.cars.find(c => c.id === carId);
  const problem = _entryProblem(champDef, car);
  if (problem) return { ok: false, msg: problem };
  if (car.championshipId !== null) return { ok: false, msg: 'Car already in a championship.' };
  if (!fitsInSeason(champDef, at)) return { ok: false, msg: 'Not enough time left this season.' };
  const fee = prepaidFee !== null ? prepaidFee : getEntryFee(champDef, car);
  if (prepaidFee === null && G.money < fee) return { ok: false, msg: 'Not enough money for entry fee.' };

  if (prepaidFee === null) G.money -= fee;

  const entry = {
    id: _newEntryId('champ_entry_'),
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
    feePaid: fee,
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

// ─── Next-Season Registration ─────────────────────────────────────────────────

function getRegistration(carId) {
  return (G.registrations || []).find(r => r.carId === carId) || null;
}

// Books a car into a series for next season. The entry fee is paid now and the
// championship starts when the new season begins. The car may still be racing.
function registerForNextSeason(definitionId, carId) {
  const champDef = getChampionshipById(definitionId);
  const car = G.cars.find(c => c.id === carId);
  const problem = _entryProblem(champDef, car);
  if (problem) return { ok: false, msg: problem };
  if (getRegistration(carId)) return { ok: false, msg: `${car.name} is already registered for next season.` };
  const fee = getEntryFee(champDef, car);
  if (G.money < fee) return { ok: false, msg: 'Not enough money for entry fee.' };
  G.money -= fee;
  G.registrations.push({ id: _newEntryId('reg_'), definitionId, carId, fee });
  return { ok: true };
}

function cancelRegistration(carId) {
  const reg = getRegistration(carId);
  if (!reg) return { ok: false, msg: 'Not registered.' };
  G.money += reg.fee;
  G.registrations = G.registrations.filter(r => r !== reg);
  return { ok: true };
}

// Starts registered championships at the start of a season; refunds any that can't start
function _activateRegistrations(at) {
  const regs = G.registrations || [];
  G.registrations = [];
  regs.forEach(reg => {
    const champDef = getChampionshipById(reg.definitionId);
    const car = G.cars.find(c => c.id === reg.carId);
    const res = enterChampionship(reg.definitionId, reg.carId, at, reg.fee);
    if (res.ok) {
      _notify(`${car.name} starts ${champDef.name}.`, 'info');
    } else {
      G.money += reg.fee;
      _notify(`${car ? car.name : 'A car'} could not start ${champDef ? champDef.name : 'its series'} (${res.msg}). Entry fee refunded.`, 'error');
    }
  });
}

// ─── Early Season End ─────────────────────────────────────────────────────────

// The season can end early once nothing is racing and every series some car could
// enter is too long for the time left. Money is ignored, so being short on cash
// never fast-forwards seasons.
function canEndSeasonEarly(at = Date.now()) {
  if (G.activeChampionships.length > 0) return false;
  let anyEligible = false;
  for (const car of G.cars) {
    for (const champDef of CHAMPIONSHIPS) {
      if (_entryProblem(champDef, car)) continue;
      anyEligible = true;
      if (fitsInSeason(champDef, at)) return false;
    }
  }
  return anyEligible;
}

// ─── Race Engine ──────────────────────────────────────────────────────────────

function _gauss() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Multiplier on every rival field after the given number of prestige resets
function getFieldMult(resets = G.prestige.prestigeCount || 0) {
  return Math.min(FIELD_PRESTIGE_MAX, 1 + FIELD_PRESTIGE_STEP * resets);
}

// Prizes and REP rise with the field, at PRESTIGE_REWARD_SHARE of its rate
function getPrestigeRewardMult() {
  return 1 + (getFieldMult() - 1) * PRESTIGE_REWARD_SHARE;
}

// AI field strength for one class in a series
function getFieldStrength(champDef, classId) {
  const fs = champDef.fieldStrength;
  return Math.round((fs[classId] || fs[champDef.allowedClasses[0]]) * getFieldMult());
}

// P1 round prize for a class; higher classes in a series pay proportionally more
function getRoundPrize(champDef, classId) {
  const cls = getCarClassById(classId);
  return cls ? cls.baseIncomePerLap * champDef.prizeMult * getPrestigeRewardMult() : 0;
}

// P1 round REP for a class. Faster classes face stronger fields, so they earn more:
// the square root of their field strength over the series' slowest class.
function getRoundRep(champDef, classId) {
  const slowest = Math.min(...champDef.allowedClasses.map(id => getFieldStrength(champDef, id)));
  return champDef.repPerRound * Math.sqrt(getFieldStrength(champDef, classId || champDef.allowedClasses[0]) / slowest)
    * getPrestigeRewardMult();
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
  rows.push({ name: G.teamName || DEFAULT_TEAM_NAME, points: entry.points, isPlayer: true });
  // On equal points the player ranks behind (no countback)
  return rows.sort((a, b) => b.points - a.points || (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
}

function getStandingPosition(entry) {
  return getStandings(entry).findIndex(r => r.isPlayer) + 1;
}

const _pick = list => list[Math.floor(Math.random() * list.length)];
const _lerp = ([lo, hi]) => lo + Math.random() * (hi - lo);

// Chance of a driver error, from the lineup's average consistency
function calcDriverErrorChance(base, consistency, wet) {
  return base * (1 - consistency / 100) * (wet ? WET_ERROR_MULT : 1);
}

// Why the car retires this round, or null when it finishes
function _rollRetirement(car, format, size, lineup, consistency, wet, entry, absent) {
  if (Math.random() < calcDNFChance(car, format, size, absent)) return _pick(MECHANICAL_FAILURES);
  if (Math.random() < calcDriverErrorChance(DRIVER_CRASH_CHANCE, consistency, wet))
    return `${_pick(lineup).name} ${_pick(DRIVER_CRASHES)}`;
  if (Math.random() < RIVAL_CRASH_CHANCE) return `taken out by ${_pick(entry.field).name}`;
  return null;
}

// At most one incident for a finishing car: { type, text, loss }, or null
function _rollIncident(car, format, lineup, consistency, wet, entry) {
  for (const d of lineup) {
    const quirk = getSpecialDef(d) && getSpecialDef(d).incident;
    if (quirk && Math.random() < quirk.chance)
      return { type: 'special', text: `${d.name} ${quirk.text}`, loss: _lerp(quirk.loss) };
  }
  if (Math.random() < calcDriverErrorChance(SPIN_CHANCE, consistency, wet))
    return { type: 'spin', text: `${_pick(lineup).name} ${_pick(SPINS)}`, loss: _lerp(INCIDENT_LOSS.spin) };
  if (Math.random() < CONTACT_CHANCE)
    return { type: 'contact', text: `hit by ${_pick(entry.field).name}`, loss: _lerp(INCIDENT_LOSS.contact) };
  const crew = G.pitCrew.level / PIT_CREW.maxLevel * (getCrewCoveredCarIds().includes(car.id) ? 1 : PIT_CREW.uncoveredShare);
  if (Math.random() < SLOW_STOP_CHANCE * (1 - crew) * (format === 'endurance' ? 1.5 : 1))
    return { type: 'pit', text: 'slow pit stop', loss: _lerp(INCIDENT_LOSS.pit) };
  return null;
}

// Simulate one round: positions, points, prize money and REP
function runChampionshipRound(entry) {
  const champDef = getChampionshipById(entry.definitionId);
  const car = G.cars.find(c => c.id === entry.carId);
  const wet = Math.random() < (champDef.wetChance || 0);
  const format = champDef.format || 'sprint';
  const size = getLineupSize(champDef);
  const seated = car ? getCarLineup(car).slice(0, size) : [];
  // Drivers who skip the round leave the rest of the lineup to cover their stints
  const absent = seated.filter(d => { const s = getSpecialDef(d); return s && s.noShow && Math.random() < s.noShow.chance; });
  const lineup = seated.filter(d => !absent.includes(d));
  const absentText = absent.map(d => `${d.name} did not show up: "${getSpecialDef(d).noShow.line}"`).join('; ') || null;
  if (car) lineup.forEach(d => { d.seasonClassTier = Math.max(d.seasonClassTier || 0, getCarClassById(car.classId).tier); });

  const aiScores = entry.field.map(r => r.rating * (1 + _gauss() * RACE_NOISE));
  let pos = null, dnf = false, dns = false, dnfReason = null, incident = null;
  const dnsReason = !car || lineup.length ? null : seated.length ? absentText : 'no driver';
  const consistency = lineup.length ? lineup.reduce((sum, d) => sum + (d.consistency || 0), 0) / lineup.length : 0;
  if (!car || !lineup.length) {
    dns = true;
  } else if ((dnfReason = _rollRetirement(car, format, size, lineup, consistency, wet, entry, absent.length))) {
    dnf = true;
  } else {
    const noise = RACE_NOISE * (1 - consistency / 200);
    const score = calcCarRating(car, format, wet, size, lineup) * (1 + _gauss() * noise);
    const rankOf = sc => 1 + aiScores.filter(ai => ai > sc).length;
    incident = _rollIncident(car, format, lineup, consistency, wet, entry);
    pos = rankOf(incident ? score * (1 - incident.loss) : score);
    if (incident) incident = { type: incident.type, text: incident.text, lost: pos - rankOf(score) };
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
    rep = Math.round(getRoundRep(champDef, entry.classId) * getPrizeFactor(pos)) + getTPBonuses(car).strategyRep;
  }
  entry.points += points;
  entry.prizeEarned += prize;
  entry.repEarned += rep;
  entry.results.push(dns ? 'DNS' : dnf ? 'DNF' : pos);
  entry.resultNotes = entry.resultNotes || [];
  entry.resultNotes[entry.results.length - 1] = [dnsReason || absentText, dnfReason || (incident && describeIncident(incident))]
    .filter(Boolean).join('; ') || null;
  entry.currentRound++;
  entry.lastRound = { pos, dnf, dns, dnsReason, absentText, dnfReason, incident, wet, prize, rep, points, driverId: lineup[0] ? lineup[0].id : null,
    driverIds: lineup.map(d => d.id), missing: car ? getMissingDrivers(car, size) : 0 };
  G.money += prize;
  G.totalEarned += prize;
  G.reputation += rep;
  return entry.lastRound;
}

// "Quinn spun, lost 3 places" / "hit by Kaiju Racing, no places lost"
function describeIncident(incident) {
  const lost = incident.lost === 1 ? 'lost 1 place' : incident.lost > 1 ? `lost ${incident.lost} places` : 'no places lost';
  return `${incident.text}, ${lost}`;
}

// Final standings payout and completion record
function finishChampionship(entry) {
  const champDef = getChampionshipById(entry.definitionId);
  const car = G.cars.find(c => c.id === entry.carId);
  const finalPos = getStandingPosition(entry);
  const share = STANDING_BONUS[finalPos - 1] || 0;
  const dataBonus = getREBonuses(entry.carId).dataBonus;
  const bonusCash = Math.round(getRoundPrize(champDef, entry.classId) * entry.maxRounds * share * (1 + dataBonus));
  const bonusRep  = Math.round(getRoundRep(champDef, entry.classId) * entry.maxRounds * (STANDING_REP_BONUS[finalPos - 1] || 0));
  G.money += bonusCash;
  G.totalEarned += bonusCash;
  G.reputation += bonusRep;
  entry.repEarned += bonusRep;

  // The drivers who raced earn LP; reserves beyond the series' lineup earn nothing
  const lineup = car ? getCarLineup(car).slice(0, getLineupSize(champDef)) : [];
  const classId = entry.classId || (car && car.classId);
  const lpByDriver = {};
  lineup.forEach(d => { lpByDriver[d.id] = awardChampionshipLP(d, classId, finalPos, entry.carId); });
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
  if (car) {
    car.championshipId = null;
    car.setupChamps = (car.setupChamps || 0) + 1;
    if (!hasSeriesSlot(car, champDef)) car.seriesSlots = [...(car.seriesSlots || []), champDef.id];
  }
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

  if (cfg.paceMin) stats.pace = Math.max(stats.pace, cfg.paceMin);

  return { stats, primaryStat: primaryKey };
}

// ─── Driver System ────────────────────────────────────────────────────────────

// Names of everyone on the team (drivers and staff), plus any extra people passed in
function _takenNames(extra = []) {
  const staff = [...getTeamPrincipals(), ...Object.values(G.raceEngineers || {}), ...(G.spareEngineers || [])].filter(Boolean);
  return new Set([...G.drivers, ...staff, ...extra].map(p => p.name));
}

// A random "First Last" nobody on the team has, preferring first and last names no
// one on the team uses yet. If every combination is taken, the name gets a number.
function _uniqueName(firstNames, lastNames, extraTaken = []) {
  const taken = _takenNames(extraTaken);
  const parts = [...taken].map(n => n.split(' '));
  const fresh = (list, i) => {
    const used = new Set(parts.map(p => p[i]));
    const open = list.filter(x => !used.has(x));
    return open.length ? open : list;
  };
  const pick = list => list[Math.floor(Math.random() * list.length)];
  let name = pick(fresh(firstNames, 0)) + ' ' + pick(fresh(lastNames, 1));
  for (let i = 0; i < 200 && taken.has(name); i++) name = pick(firstNames) + ' ' + pick(lastNames);
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

let _allowLockedScout = false;

// Seconds until the free Club Racer scout is available again
function getFreeScoutWait(at = Date.now()) {
  return Math.max(0, ((G.nextFreeScoutAt || 0) - at) / 1000);
}

// Highest car class tier a driver raced or sits in this season (0 for neither)
function getDriverSalaryClassTier(driver) {
  const car = driver.carId && G.cars.find(c => c.id === driver.carId);
  return Math.max(car ? getCarClassById(car.classId).tier : 0, driver.seasonClassTier || 0);
}

function getDriverSalary(driver) {
  const tierDef = DRIVER_TIERS[driver.tier];
  const base = tierDef ? tierDef.salary || 0 : 0;
  return Math.round(base * (SALARY_CLASS_MULT[getDriverSalaryClassTier(driver)] || 1) * (1 - getFameTier().salary));
}

// The team's fame tier for its current REP
function getFameTier(rep = G.reputation) {
  return FAME_TIERS.filter(t => rep >= t.rep).pop();
}

// What a scout of this tier costs after the Team Principal and Talent Academy
function getScoutCost(tier) {
  const discount = G.prestige.permanentBonuses.scoutDiscount || 0;
  return Math.floor(DRIVER_TIERS[tier].scoutCost * getTPBonuses().scoutCostMult * (1 - discount));
}

// allowSpecial: false for drivers the game hands out, like the first one of a new game
function scoutDriver(tier, allowSpecial = true) {
  const tierDef = DRIVER_TIERS[tier];
  if (!tierDef) return { ok: false, msg: 'Unknown tier.' };
  if (tierDef.locked && !_allowLockedScout) return { ok: false, msg: 'Special acquisition only.' };
  const effectiveScoutCost = getScoutCost(tier);
  if (G.money < effectiveScoutCost) return { ok: false, msg: 'Not enough money.' };
  const freeScout = tier === 'C';
  if (freeScout && getFreeScoutWait() > 0) return { ok: false, msg: `Next free scout in ${Math.ceil(getFreeScoutWait())}s.` };

  G.money -= effectiveScoutCost;
  if (freeScout) G.nextFreeScoutAt = Date.now() + FREE_SCOUT_COOLDOWN_SEC * 1000;

  const driver = _newDriver(tier, allowSpecial ? _rollSpecialDriver(tier) : null);
  const special = getSpecialDef(driver);
  if (special) addNotification(`A special driver joined: ${driver.name}! ${special.quirk}`, 'prestige');
  return { ok: true, driver };
}

// A special driver nobody on the team is yet, at the tier's chance, or null
function _rollSpecialDriver(tier) {
  if (Math.random() >= (SPECIAL_DRIVER_CHANCES[tier] || 0)) return null;
  const free = SPECIAL_DRIVERS.filter(s => !G.drivers.some(d => d.special === s.id));
  return free.length ? _pick(free) : null;
}

// Creates a driver of a tier and adds them to the roster; special: a SPECIAL_DRIVERS entry
function _newDriver(tier, special = null) {
  const { stats, primaryStat } = generateDriverStats(tier, Math.random);
  const name = special ? special.name : _uniqueName(DRIVER_FIRST_NAMES, DRIVER_LAST_NAMES);
  if (special) stats.pace = Math.min(100, stats.pace + (special.paceBonus || 0));

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
  if (special) driver.special = special.id;
  G.drivers.push(driver);
  return driver;
}

// Pace multiplier from the lead driver (1.0 if no driver), as shown on the car card
function calcDriverPaceMult(car) {
  const tpMot = getTPBonuses(car).paceMult;
  const driver = car.driverId ? G.drivers.find(d => d.id === car.driverId) : null;
  return 1 + calcDriverSkillInCar(driver, car, 'sprint', false) / 100 + tpMot;
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
  if (slot === 'co' && others >= getCarSeatLimit(car))
    return { ok: false, msg: `${car.name} already has ${getCarSeatLimit(car)} drivers.` };

  _detachDriver(driver);
  if (!car.driverId) {
    car.driverId = driverId;
  } else if (slot === 'lead') {
    const prevLead = G.drivers.find(d => d.id === car.driverId);
    car.driverId = driverId;
    if (prevLead) {
      if (getCarLineup(car).length < getCarSeatLimit(car)) car.coDriverIds.unshift(prevLead.id);
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

// Championships completed in a season of the current run. Season numbers restart
// at 1 after a prestige reset, so earlier runs are told apart by completion time.
function _seasonChampionships(season = G.season) {
  const since = (G.prestige && G.prestige.lastPrestigeAt) || 0;
  return G.completedChampionships.filter(c => c.season === season && (c.completedAt || 0) > since);
}

// Round results (positions, 'DNF', 'DNS') raced this season
function _seasonRoundResults() {
  const done = _seasonChampionships().flatMap(c => c.results || []);
  const live = G.activeChampionships.flatMap(e => e.results || []);
  return done.concat(live);
}

// { have, need } toward a sponsor target this season
function getSponsorTargetProgress(target) {
  const season = _seasonChampionships();
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
    case 'major_top': return `Top ${target.pos} in a major championship (NA Endurance, Euro Endurance, World Endurance, F2 Global, Formula World)`;
    case 'top_title': return 'Win the World Endurance Cup or the Formula World Championship this season';
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
  const thisSeasonChamps = _seasonChampionships();
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

// Ends a sponsor's contract and signs one of this season's offers into its slot
function replaceSponsor(sponsorId, offerId) {
  const idx = G.sponsors.findIndex(s => s && s.id === sponsorId);
  if (idx === -1) return { ok: false, msg: 'Sponsor not found.' };
  if (!getSponsorOffers().some(o => o.id === offerId)) return { ok: false, msg: 'Offer no longer available.' };
  terminateSponsor(sponsorId);
  return signSponsorOffer(idx, offerId);
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
        G.prestige.sponsorPP = (G.prestige.sponsorPP || 0) + s.bonusPP;
        addNotification(`${s.name}: +${s.bonusPP} PP toward your next prestige!`, 'prestige');
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

// Racing program a car belongs to
function getCarProgram(car) {
  return getCarClassById(car.classId).pathway === 'single_seater' ? 'single_seater' : 'gt_endurance';
}

function getTeamPrincipals() {
  return Object.values(G.teamPrincipals || {}).filter(Boolean);
}

// Whether a principal's tier is senior enough to run a car class
function canTPRunClass(tp, classId) {
  return getCarClassById(classId).tier <= TP_TIERS[tp.tier].maxClassTier;
}

// The principal running a car: its program's, if senior enough for the car's class
function getCarTP(car) {
  const tp = (G.teamPrincipals || {})[getCarProgram(car)];
  return tp && canTPRunClass(tp, car.classId) ? tp : null;
}

// With a car: the pace and REP bonuses of the principal running it. Without: the
// team-wide perks, each taken from whichever principal offers the most.
function getTPBonuses(car) {
  if (car) return _tpBonuses(getCarTP(car));
  const all = getTeamPrincipals().map(_tpBonuses);
  if (!all.length) return _tpBonuses(null);
  return {
    paceMult: 0,
    strategyRep: 0,
    upgradeCostMult: Math.min(...all.map(b => b.upgradeCostMult)),
    sponsorMult:     Math.max(...all.map(b => b.sponsorMult)),
    scoutCostMult:   Math.min(...all.map(b => b.scoutCostMult)),
  };
}

// Bonuses from one principal (or all zeros for none)
function _tpBonuses(tp) {
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

// Upgrade cost after the Team Principal and Crew Training Centre discounts
function getEffectiveUpgradeCost(upgradeId, currentLevel, classId) {
  const base = getUpgradeCost(upgradeId, currentLevel, classId);
  return Math.max(1, Math.floor(base * _crewCostMult()));
}

// extraTaken: candidates generated alongside this one, so a shortlist has no repeats
function _generateStaff(type, tier, extraTaken = []) {
  const statKeys   = type === 'tp' ? TP_STAT_KEYS   : RE_STAT_KEYS;
  const statConfig = type === 'tp' ? TP_STAT_CONFIG  : RE_STAT_CONFIG;
  const tierDef    = type === 'tp' ? TP_TIERS[tier]  : RE_TIERS[tier];
  const { stats, primaryStat } = generateBudgetStats(statKeys, statConfig, tier, Math.random);
  const name = _uniqueName(STAFF_FIRST_NAMES, STAFF_LAST_NAMES, extraTaken);
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
  const options = [];
  Object.keys(TP_TIERS).filter(tier => !TP_TIERS[tier].locked)
    .forEach(tier => options.push(_generateStaff('tp', tier, options)));
  return options;
}

function generateREOptions() {
  const options = [];
  Object.keys(RE_TIERS).filter(tier => !RE_TIERS[tier].locked)
    .forEach(tier => options.push(_generateStaff('re', tier, options)));
  return options;
}

function hireTP(staffData, program = 'gt_endurance') {
  const prog = TP_PROGRAMS.find(p => p.id === program);
  if (!prog) return { ok: false, msg: 'Unknown program.' };
  const current = G.teamPrincipals[program];
  const buyout = current ? Math.floor(TP_TIERS[current.tier].hireCost * 0.25) : 0;
  const tierDef = TP_TIERS[staffData.tier];
  if (G.money < buyout + tierDef.hireCost) return { ok: false, msg: 'Not enough money.' };
  if (current) {
    G.money -= buyout;
    addNotification(`Bought out ${current.name} for $${formatNumber(buyout)}.`, 'info');
  }
  G.money -= tierDef.hireCost;
  G.teamPrincipals[program] = { ...staffData };
  addNotification(`Hired ${staffData.name} as ${prog.label} Team Principal!`, 'success');
  return { ok: true };
}

function fireTP(program = 'gt_endurance') {
  const tp = G.teamPrincipals[program];
  if (!tp) return { ok: false, msg: 'No Team Principal to fire.' };
  G.teamPrincipals[program] = null;
  addNotification(`${tp.name} stepped down as Team Principal.`, 'info');
  return { ok: true };
}

function hireRE(carId, staffData) {
  if (!G.raceEngineers) G.raceEngineers = {};
  const tierDef = RE_TIERS[staffData.tier];
  if (tierDef.hireCost > 0) {
    if (G.money < tierDef.hireCost) return { ok: false, msg: 'Not enough money.' };
    G.money -= tierDef.hireCost;
  }
  // The engineer being replaced moves to the spare list
  _releaseCarEngineer(carId);
  G.raceEngineers[carId] = { ...staffData };
  const car = G.cars.find(c => c.id === carId);
  addNotification(`Hired ${staffData.name} as Race Engineer for ${car ? car.name : carId}.`, 'success');
  return { ok: true };
}

// Takes a car's engineer off it; they stay with the team as a spare
function _releaseCarEngineer(carId) {
  const re = getREForCar(carId);
  if (!re) return;
  delete G.raceEngineers[carId];
  G.spareEngineers.push(re);
  addNotification(`${re.name} stays with the team as a spare race engineer: assign them to a car in the Staff tab.`, 'info');
}

// Puts a spare engineer on a car; the engineer already on it becomes a spare
function assignSpareEngineer(index, carId) {
  const re = G.spareEngineers[index];
  if (!re) return { ok: false, msg: 'No such spare engineer.' };
  if (!G.cars.some(c => c.id === carId)) return { ok: false, msg: 'Car not found.' };
  G.spareEngineers.splice(index, 1);
  _releaseCarEngineer(carId);
  G.raceEngineers[carId] = re;
  const car = G.cars.find(c => c.id === carId);
  addNotification(`${re.name} is now Race Engineer for ${car.name}.`, 'success');
  return { ok: true };
}

function releaseSpareEngineer(index) {
  const re = G.spareEngineers[index];
  if (!re) return { ok: false, msg: 'No such spare engineer.' };
  G.spareEngineers.splice(index, 1);
  addNotification(`${re.name} left the engineering team.`, 'info');
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

// Converts banked XP into stat points, half of them into pace. Trained stats can go a
// little past the tier ceiling.
function _applyDriverTraining(driver) {
  const cfg = DRIVER_STAT_CONFIG[driver.tier];
  if (!cfg) return;
  const cap = cfg.ceiling + TRAINING_CEILING_BONUS;
  const points = Math.floor((driver.xp || 0) / XP_PER_STAT_POINT);
  driver.xp -= points * XP_PER_STAT_POINT;
  for (let i = 0; i < points; i++) {
    const open = DRIVER_STAT_KEYS.filter(k => driver[k] < cap);
    if (!open.length) break;
    const key = open.includes('pace') && Math.random() < 0.5 ? 'pace' : open[Math.floor(Math.random() * open.length)];
    driver[key]++;
  }
}

// Everyone paid at season end: the Team Principal, race engineers and drivers
function getPayroll() {
  const rows = [];
  Object.entries(G.teamPrincipals || {}).forEach(([program, tp]) => {
    if (tp) rows.push({ kind: 'tp', program, person: tp, salary: tp.salary || 0 });
  });
  Object.entries(G.raceEngineers || {}).forEach(([carId, re]) => rows.push({ kind: 're', carId, person: re, salary: re.salary || 0 }));
  (G.spareEngineers || []).forEach(re => rows.push({ kind: 're', carId: null, person: re, salary: re.salary || 0 }));
  G.drivers.forEach(d => rows.push({ kind: 'driver', person: d, salary: getDriverSalary(d) }));
  return rows.filter(r => r.salary > 0);
}

// The season right after a prestige reset is salary-free
function isSalaryFreeSeason() {
  return G.salaryFreeSeason === G.season;
}

// Salaries due at the end of this season
function getSeasonSalaryTotal() {
  return isSalaryFreeSeason() ? 0 : getPayroll().reduce((sum, r) => sum + r.salary, 0);
}

// Pays the season's salaries. When the money doesn't cover them, the best-paid people
// leave unpaid until it does, so money never goes negative.
function deductSeasonSalaries() {
  if (isSalaryFreeSeason()) {
    addNotification(`No salaries for season ${G.season}: the team was rebuilding after its reset.`, 'info');
    return;
  }
  const rows = getPayroll().sort((a, b) => b.salary - a.salary);
  let total = rows.reduce((sum, r) => sum + r.salary, 0);
  while (rows.length && total > Math.max(0, G.money)) {
    const r = rows.shift();
    total -= r.salary;
    if (r.kind === 'tp') G.teamPrincipals[r.program] = null;
    else if (r.kind === 're' && r.carId) delete G.raceEngineers[r.carId];
    else if (r.kind === 're') G.spareEngineers.splice(G.spareEngineers.indexOf(r.person), 1);
    else { _detachDriver(r.person); G.drivers.splice(G.drivers.indexOf(r.person), 1); }
    addNotification(`${r.person.name} left: the team couldn't pay their $${formatNumber(r.salary)} salary.`, 'error');
  }
  if (total > 0) {
    G.money -= total;
    addNotification(`Season ${G.season} salaries: -$${formatNumber(total)}`, 'info');
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
  if (G.prestige.sponsorPP === undefined) {
    // Sponsor PP used to be paid out at once; before a first reset it is the only PP source,
    // so unspent PP moves to the next-prestige counter
    G.prestige.sponsorPP = 0;
    if (G.prestige.prestigeCount === 0 && G.prestigePoints > 0) {
      G.prestige.sponsorPP = G.prestigePoints;
      G.prestigePoints = 0;
    }
  }
  _migrateDriverAge();
}

// Ensure all drivers have license data (for saves created before the license system)
function _migrateDriverLicenses() {
  if (G.licensePtMultiplier === undefined) G.licensePtMultiplier = LICENSE_CONFIG.defaultMultiplier;
  G.drivers.forEach(d => {
    if (!d.licenses) d.licenses = ['GT4'];
    if (!d.licensePoints) d.licensePoints = {};
    // F3 and F2 once raced on the F4 license: drivers already in those cars keep their seat,
    // and scouted drivers get the single-seater licenses their tier now starts with
    if (d.licensePoints.F3 === undefined && d.licenses.includes('F4')) {
      const car = G.cars.find(c => c.id === d.carId);
      const grant = new Set((TIER_STARTING_LICENSES[d.tier] || []).filter(id => id === 'F3' || id === 'F2'));
      if (car && (car.classId === 'F3' || car.classId === 'F2')) grant.add('F3');
      if (car && car.classId === 'F2') grant.add('F2');
      grant.forEach(id => { if (!d.licenses.includes(id)) d.licenses.push(id); });
    }
    // Legends start with every license their tier now holds (F1 was once missing)
    if (d.tier === 'L') TIER_STARTING_LICENSES.L.forEach(id => {
      if (d.licenses.includes(id)) return;
      d.licenses.push(id);
      d.licensePoints[id] = LICENSE_TIERS.find(lt => lt.id === id).pointsRequired;
    });
    // Ensure every license tier has an entry
    LICENSE_TIERS.forEach(lt => {
      if (d.licensePoints[lt.id] === undefined) {
        // If the driver already holds this license (from the licenses array), set to threshold
        d.licensePoints[lt.id] = d.licenses.includes(lt.id) ? lt.pointsRequired : 0;
      }
    });
    // Licenses were once earned out of order (F1 before F2): a held license brings every lower one
    [...LICENSE_TIERS].reverse().forEach(lt => {
      const prev = _prevLicense(lt.id);
      if (!prev || !d.licenses.includes(lt.id) || d.licenses.includes(prev.id)) return;
      d.licenses.push(prev.id);
      d.licensePoints[prev.id] = Math.max(d.licensePoints[prev.id] || 0, prev.pointsRequired);
    });
    // Retroactively grant licenses where LP already meets the threshold
    _grantEarnedLicenses(d);
  });
}

// The license below this one in its pathway, or null for the first
function _prevLicense(id) {
  const lt = LICENSE_TIERS.find(t => t.id === id);
  const ladder = LICENSE_TIERS.filter(t => t.pathway === lt.pathway);
  return ladder[ladder.indexOf(lt) - 1] || null;
}

// Grants every license whose LP is met once the one below it is held, so F2 always comes
// before F1. LP keeps banking meanwhile. Returns the licenses granted.
function _grantEarnedLicenses(driver) {
  const granted = [];
  LICENSE_TIERS.forEach(lt => { // in ladder order, so one grant can unlock the next
    if (driver.licenses.includes(lt.id) || (driver.licensePoints[lt.id] || 0) < lt.pointsRequired) return;
    const prev = _prevLicense(lt.id);
    if (prev && !driver.licenses.includes(prev.id)) return;
    driver.licenses.push(lt.id);
    granted.push(lt);
  });
  return granted;
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
  // One Team Principal became one per program: the old one runs GT & Endurance
  if (!G.teamPrincipals) G.teamPrincipals = { gt_endurance: G.teamPrincipal || null, single_seater: null };
  delete G.teamPrincipal;
  if (!G.raceEngineers || typeof G.raceEngineers !== 'object' || Array.isArray(G.raceEngineers)) {
    G.raceEngineers = {};
  }
  if (!Array.isArray(G.spareEngineers)) G.spareEngineers = [];
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
function awardChampionshipLP(driver, classId, finalPos, carId) {
  if (!driver) return {};
  const lpTable = LP_EARN_TABLE[classId] || {};
  const factor  = LICENSE_RESULT_FACTORS[Math.min(finalPos, LICENSE_RESULT_FACTORS.length) - 1];
  const mult    = (G.licensePtMultiplier || 1.0) * (1 + getREBonuses(carId).coachBonus) * factor;
  if (!driver.licensePoints) driver.licensePoints = {};
  if (!driver.licenses) driver.licenses = ['GT4'];

  const earned = {};
  Object.entries(lpTable).forEach(([licenseId, baseLP]) => {
    if (driver.licenses.includes(licenseId)) return;
    const pts = Math.round(baseLP * mult);
    if (pts <= 0) return;
    driver.licensePoints[licenseId] = (driver.licensePoints[licenseId] || 0) + pts;
    earned[licenseId] = pts;
  });
  _grantEarnedLicenses(driver).forEach(lt => _notify(`🏆 ${driver.name} has earned their ${lt.name} License!`, 'success'));
  return earned;
}

// LP earned this season per driver, summed from completed championships
function _seasonLPByDriver(season) {
  const byDriver = {};
  _seasonChampionships(season).forEach(c => {
    const perDriver = c.lpByDriver || (c.driverId && c.lpGained ? { [c.driverId]: c.lpGained } : {});
    Object.entries(perDriver).forEach(([driverId, earned]) => {
      const acc = byDriver[driverId] = byDriver[driverId] || {};
      Object.entries(earned).forEach(([id, pts]) => { acc[id] = (acc[id] || 0) + pts; });
    });
  });
  return byDriver;
}

// endedAt: when the season actually ended (earlier than scheduled for an early end)
function endSeason(endedAt = getSeasonEndTime()) {
  const endedSeason = G.season;
  const seasonResults = _seasonChampionships(endedSeason)
    .map(c => ({ definitionId: c.definitionId, classId: c.classId, finalPosition: c.finalPosition, prizeEarned: c.prizeEarned }));

  // 1. Evaluate all active sponsor contracts
  evaluateSponsorsAtSeasonEnd();

  // 2. Championships still running are abandoned below; refund their entry fees,
  // then pay salaries
  G.activeChampionships.forEach(entry => {
    const def = getChampionshipById(entry.definitionId);
    if (!def) return;
    const paid = entry.feePaid !== undefined ? entry.feePaid : getClassEntryFee(def, entry.classId);
    G.money += paid;
    addNotification(`${def.name} couldn't finish before the season ended: $${formatNumber(paid)} entry fee refunded.`, 'info');
  });
  deductSeasonSalaries();
  G.drivers.forEach(d => { d.seasonClassTier = 0; });

  // 3. LP was awarded per championship; collect it for the summary
  const lpByDriver = _seasonLPByDriver(endedSeason);

  // 4. Award XP (per championship completion; separate from LP)
  _seasonChampionships()
    .forEach(comp => {
      _champDriverAndClass(comp).driverIds.forEach(driverId => {
        const driver = G.drivers.find(d => d.id === driverId);
        if (driver) driver.xp += 100;
      });
    });

  // 5. Age all drivers, train XP into stats, apply career stat changes, handle retirements
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
    _applyDriverTraining(d);
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

  G.seasonStartTime = endedAt;

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
  return Math.floor(pp + repGained / PRESTIGE_REP_PER_PP) + getHQPrestigePoints() + (G.prestige.sponsorPP || 0);
}

// Share of REP kept through a reset
function getFanBaseShare() {
  return getPrestigeItemCount('fan_base') * FAN_BASE_REP_SHARE;
}

// Money the team restarts with after a prestige reset
function getPrestigeStartMoney() {
  return PRESTIGE_START_MONEY + getPrestigeItemCount('seed_money') * SEED_MONEY_PER_PURCHASE;
}

// Cheapest shop item still available to buy, or null
function getCheapestPrestigeItem() {
  return PRESTIGE_ITEMS.filter(i => !i.maxPurchases || getPrestigeItemCount(i.id) < i.maxPurchases)
    .sort((a, b) => a.cost - b.cost)[0] || null;
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
  // REP resets too; each Fan Base purchase keeps 1% of it
  G.reputation = Math.floor(G.reputation * getFanBaseShare());
  G.prestige.repAtLastPrestige = G.reputation;
  G.prestige.sponsorPP = 0;
  const prevPrestigeCount = G.prestige.prestigeCount || 0;
  G.prestige.prestigeCount = prevPrestigeCount + 1;
  G.prestige.totalResets++;
  const singleSeaterJustUnlocked = prevPrestigeCount === 0;

  // Reset money, end all championships and start over at season 1, salary-free.
  // The old season ends without its season-end steps (no aging, sponsor payouts or
  // salaries); legend contracts running out with it move to the new one.
  G.money = getPrestigeStartMoney();
  G.activeChampionships = [];
  G.drivers.filter(d => d.contractUntilSeason !== undefined)
    .forEach(d => { d.contractUntilSeason = 1 + Math.max(0, d.contractUntilSeason - G.season); });
  G.season = 1;
  G.seasonStartTime = Date.now();
  G.lastSeasonSummary = null;
  G.salaryFreeSeason = G.season;
  G.drivers.forEach(d => { d.seasonClassTier = 0; });

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
  G.cars.filter(c => !keptCars.includes(c)).forEach(c => _releaseCarEngineer(c.id));
  G.cars = keptCars;
  if (!G.cars.some(c => c.classId === 'GT4')) {
    G.cars.push({ id: 'car_' + G.nextCarId++, classId: 'GT4', name: 'GT4 #1', upgrades: { reliability: 0 }, driverId: null, coDriverIds: [], championshipId: null, autoRenew: null });
  }

  // Cars keep 2 preparation levels and lose their setup knowledge; the pit crew is
  // rebuilt at the head-start level
  G.cars.forEach(car => {
    car.upgrades = { reliability: Math.min(car.upgrades.reliability || 0, 2) };
    car.setupChamps = 0;
    car.seriesSlots = [];
    car.championshipId = null;
    car.autoRenew = null;
  });
  const headStart = G.prestige.permanentBonuses.headStartLevels || 0;
  G.pitCrew = { level: Math.min(PIT_CREW.maxLevel, headStart * 2), size: 1 };

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
  G.registrations = [];

  // HQ facilities are rebuilt each run (their levels were paid out as PP)
  G.hq = { simulator: 0, composites: 0, hospitality: 0 };

  addNotification(`Prestige! +${ppGain} PP. The team starts over with ${G.cars.length} car${G.cars.length > 1 ? 's' : ''} and $${formatNumber(G.money)}. Season ${G.season} begins, with no salaries due.`, 'prestige');
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

  // Driver XP (passive growth, boosted by RE driverCoach); reserves don't gain any
  G.drivers.forEach(d => {
    if (d.carId && !isReserveDriver(d)) {
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
      if (r.absentText && !r.dns) _notify(`${tag}: ${r.absentText}`, 'info');
      if (r.dns)      _notify(`${tag}: did not start — ${r.dnsReason || 'no driver'}.`, 'error');
      else if (r.dnf) _notify(`${tag}: DNF — ${r.dnfReason || 'mechanical failure'}.`, 'error');
      else _notify(`${tag}: finished P${r.pos}${r.incident ? ` (${describeIncident(r.incident)})` : ''} · +$${formatNumber(r.prize)} · +${r.rep} REP`, r.pos <= 3 ? 'success' : 'info');

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
    _startNextSeason(getSeasonEndTime());
    if (now >= getSeasonEndTime()) advanceWorld(now);   // more than one season elapsed
  } else if (canEndSeasonEarly(now)) {
    _notify(`Nothing left to race in season ${G.season}: it ends early.`, 'info');
    _startNextSeason(now);
  }
}

// Ends the season at `at` and starts the next one: registrations first, then auto-renew
function _startNextSeason(at) {
  endSeason(at);
  _activateRegistrations(G.seasonStartTime);
  G.cars.forEach(car => _tryAutoRenew(car, G.seasonStartTime));
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
    _migrateBoP();
    _migrateDuplicateNames();
    _migrateEntryIds();
    _migrateFeedbackRound();
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

// Saves from before BoP: performance upgrades are removed and their full cost refunded,
// as are preparation levels above the new cap.
function _migrateBoP() {
  if (!G.pitCrew) G.pitCrew = { level: 0, size: 1 };
  let refund = 0;
  G.cars.forEach(car => {
    const u = car.upgrades || {};
    const cls = getCarClassById(car.classId);
    const classMult = (cls && cls.upgradeCostMult) || 1;
    Object.entries(LEGACY_UPGRADES).forEach(([id, def]) => {
      for (let lvl = 0; lvl < (u[id] || 0); lvl++) refund += Math.floor(def.baseCost * Math.pow(def.costMult, lvl) * classMult);
    });
    const reli = u.reliability || 0;
    for (let lvl = UPGRADES.reliability.maxLevel; lvl < reli; lvl++) refund += getUpgradeCost('reliability', lvl, car.classId);
    car.upgrades = { reliability: Math.min(reli, UPGRADES.reliability.maxLevel) };
    if (car.setupChamps === undefined) car.setupChamps = 0;
  });
  if (refund > 0) {
    G.money += refund;
    addNotification(`Cars now run under Balance of Performance. Car upgrades were refunded: +$${formatNumber(refund)}.`, 'success');
  }
}

// Saves from before the entry counter was saved: entries made after a reload could reuse
// an id, so the UI updated the wrong card and withdraw/sell could hit the wrong entry.
// Gives duplicates new ids, relinks each car to its own entry and moves the counter
// past every id in use.
function _migrateEntryIds() {
  const num = id => +(String(id).match(/(\d+)$/) || [0, 0])[1];
  const all = [...G.activeChampionships, ...(G.registrations || [])];
  G.nextEntryId = Math.max(G.nextEntryId || 1, ...all.map(e => num(e.id) + 1));
  const seen = new Set();
  all.forEach(e => {
    if (seen.has(e.id)) e.id = _newEntryId(e.id.startsWith('reg_') ? 'reg_' : 'champ_entry_');
    seen.add(e.id);
  });
  G.cars.forEach(car => {
    const entry = G.activeChampionships.find(e => e.carId === car.id);
    car.championshipId = entry ? entry.id : null;
  });
}

// Saves from before unique names: later drivers and staff that share a name get a new one
// Saves from before series slots and the no-debt payroll: cars keep a slot in every
// series they finished since the last reset, and old debt is written off
function _migrateFeedbackRound() {
  const since = G.prestige.lastPrestigeAt || 0;
  G.completedChampionships.filter(c => (c.completedAt || 0) > since).forEach(c => {
    const car = G.cars.find(x => x.id === c.carId);
    if (car && !(car.seriesSlots || []).includes(c.definitionId)) car.seriesSlots = [...(car.seriesSlots || []), c.definitionId];
  });
  if (G.money < 0) {
    addNotification(`Your $${formatNumber(-G.money)} debt was written off: salaries can no longer push the team below zero.`, 'success');
    G.money = 0;
  }
}

function _migrateDuplicateNames() {
  const people = [...G.drivers, ...getTeamPrincipals(), ...Object.values(G.raceEngineers || {}), ...(G.spareEngineers || [])].filter(Boolean);
  const seen = new Set();
  people.forEach(p => {
    if (!seen.has(p.name)) { seen.add(p.name); return; }
    const old = p.name;
    const isDriver = G.drivers.includes(p);
    p.name = '';
    p.name = isDriver ? _uniqueName(DRIVER_FIRST_NAMES, DRIVER_LAST_NAMES) : _uniqueName(STAFF_FIRST_NAMES, STAFF_LAST_NAMES);
    seen.add(p.name);
    addNotification(`Two team members were both called ${old}; one is now ${p.name}.`, 'info');
  });
}

function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  G = createDefaultState();
  _setupNewGame();
}

function _setupNewGame() {
  const res = scoutDriver('C', false);
  if (res.ok) assignDriver(res.driver.id, G.cars[0].id);
  G.nextFreeScoutAt = 0;
  G.lastSeenVersion = GAME_VERSION;
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
