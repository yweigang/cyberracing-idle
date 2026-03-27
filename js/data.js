'use strict';

// ─── Car Classes ─────────────────────────────────────────────────────────────

const CAR_CLASSES = [
  {
    id: 'GT4',
    name: 'GT4',
    fullName: 'GT4 — Entry Class',
    tier: 1,
    repRequired: 0,
    ppRequired: 0,
    baseCost: 10000,
    baseIncomePerLap: 500,
    lapTimeSec: 10,
    maxOwned: 5,
    color: '#4a8fff',
    description: 'Entry-level GT racing. Every champion starts here.',
    upgradeTree: 'standard',
  },
  {
    id: 'GT3',
    name: 'GT3',
    fullName: 'GT3 — Amateur',
    tier: 2,
    repRequired: 500,
    ppRequired: 0,
    baseCost: 50000,
    baseIncomePerLap: 2000,
    lapTimeSec: 8,
    maxOwned: 4,
    color: '#00aaff',
    description: 'GT World Challenge contender. Real prize money starts here.',
    upgradeTree: 'standard',
  },
  {
    id: 'LMP3',
    name: 'LMP3',
    fullName: 'LMP3 — Pro-Am',
    tier: 3,
    repRequired: 2500,
    ppRequired: 0,
    baseCost: 250000,
    baseIncomePerLap: 8000,
    lapTimeSec: 7,
    maxOwned: 3,
    color: '#00d4ff',
    description: 'Entry-level prototype racing in ELMS and Asian Le Mans. A big step up from GT.',
    upgradeTree: 'standard',
  },
  {
    id: 'LMP2',
    name: 'LMP2',
    fullName: 'LMP2 — Semi-Pro',
    tier: 4,
    repRequired: 8000,
    ppRequired: 0,
    baseCost: 1000000,
    baseIncomePerLap: 25000,
    lapTimeSec: 6,
    maxOwned: 2,
    color: '#ff8800',
    description: 'Prototype racing in WEC and ELMS. Speed in a different language.',
    upgradeTree: 'standard',
  },
  {
    id: 'HYPERCAR',
    name: 'Hypercar',
    fullName: 'LMH/Hypercar — Elite',
    tier: 5,
    repRequired: 25000,
    ppRequired: 0,
    baseCost: 5000000,
    baseIncomePerLap: 90000,
    lapTimeSec: 5,
    maxOwned: 2,
    color: '#ff4400',
    description: 'WEC Hypercar — the pinnacle of endurance racing.',
    upgradeTree: 'standard',
  },
  {
    id: 'F1',
    name: 'Formula 1',
    fullName: 'F1 — Pinnacle',
    tier: 6,
    repRequired: 100000,
    ppRequired: 500,
    baseCost: 25000000,
    baseIncomePerLap: 500000,
    lapTimeSec: 4,
    maxOwned: 2,
    color: '#ff0055',
    description: 'The ultimate motorsport challenge. Formula One.',
    upgradeTree: 'f1',
  },
];

// ─── Upgrades ─────────────────────────────────────────────────────────────────

const UPGRADES = {
  engine: {
    id: 'engine',
    name: 'Engine',
    icon: '⚙',
    maxLevel: 20,
    baseCost: 2500,
    costMult: 1.8,
    description: '+5% income/level',
    getIncomeMult: (lvl) => 1 + lvl * 0.05,
  },
  aero: {
    id: 'aero',
    name: 'Aerodynamics',
    icon: '◈',
    maxLevel: 20,
    baseCost: 2000,
    costMult: 1.7,
    description: '+3% income/level',
    getIncomeMult: (lvl) => 1 + lvl * 0.03,
  },
  tyres: {
    id: 'tyres',
    name: 'Tyres',
    icon: '◎',
    maxLevel: 20,
    baseCost: 1500,
    costMult: 1.6,
    description: '+4% income/level',
    getIncomeMult: (lvl) => 1 + lvl * 0.04,
  },
  brakes: {
    id: 'brakes',
    name: 'Brakes',
    icon: '▣',
    maxLevel: 20,
    baseCost: 1800,
    costMult: 1.65,
    description: '+2% income/level',
    getIncomeMult: (lvl) => 1 + lvl * 0.02,
  },
  reliability: {
    id: 'reliability',
    name: 'Reliability',
    icon: '◆',
    maxLevel: 20,
    baseCost: 3000,
    costMult: 1.9,
    description: 'Reduces failures; bonus income after lv10',
    // Level 0 = 80% efficiency (20% failure). Level 10 = 100%. Levels 11-20 add +1.5% income.
    getIncomeMult: (lvl) => {
      const efficiency = Math.min(1.0, 0.80 + lvl * 0.02);
      const bonus = lvl > 10 ? 1 + (lvl - 10) * 0.015 : 1;
      return efficiency * bonus;
    },
  },
};

const UPGRADE_ORDER = ['engine', 'aero', 'tyres', 'brakes', 'reliability'];

// ─── Championships ─────────────────────────────────────────────────────────────

const CHAMPIONSHIPS = [
  {
    id: 'gt4_regional',
    name: 'GT4 Regional Cup',
    shortName: 'GT4 Cup',
    allowedClasses: ['GT4'],
    rounds: 8,
    roundDurationSec: 60,
    entryFee: 5000,
    repRequired: 0,
    prerequisiteChampionship: null,
    repPerRound: 100,
    incomeBonus: 0.15,
    finalBonusMult: 2.5,
    color: '#4a8fff',
    description: '8-round regional sprint series. Perfect for a new team.',
  },
  {
    id: 'gt_world_challenge',
    name: 'GT World Challenge',
    shortName: 'GT World Chall.',
    allowedClasses: ['GT3'],
    rounds: 10,
    roundDurationSec: 90,
    entryFee: 50000,
    repRequired: 800,
    prerequisiteChampionship: 'gt4_regional',
    repPerRound: 200,
    incomeBonus: 0.20,
    finalBonusMult: 3.0,
    color: '#00aaff',
    description: '10-round series mixing sprint and endurance formats.',
  },
  {
    id: 'imsa_weathertech',
    name: 'IMSA WeatherTech',
    shortName: 'IMSA',
    allowedClasses: ['GT3', 'LMP3', 'LMP2'],
    rounds: 12,
    roundDurationSec: 120,
    entryFee: 300000,
    repRequired: 3500,
    prerequisiteChampionship: 'gt_world_challenge',
    repPerRound: 350,
    incomeBonus: 0.25,
    finalBonusMult: 3.5,
    color: '#00d4ff',
    description: 'Multi-class endurance racing across 12 rounds.',
  },
  {
    id: 'elms',
    name: 'European Le Mans Series',
    shortName: 'ELMS',
    allowedClasses: ['GT3', 'LMP3'],
    rounds: 6,
    roundDurationSec: 150,
    entryFee: 500000,
    repRequired: 5000,
    prerequisiteChampionship: 'gt_world_challenge',
    repPerRound: 400,
    incomeBonus: 0.30,
    finalBonusMult: 4.0,
    color: '#ff8800',
    description: '6-round endurance series. Includes a night race bonus.',
  },
  {
    id: 'fia_wec',
    name: 'FIA World Endurance Championship',
    shortName: 'FIA WEC',
    allowedClasses: ['LMP3', 'LMP2', 'HYPERCAR'],
    rounds: 8,
    roundDurationSec: 180,
    entryFee: 2000000,
    repRequired: 20000,
    prerequisiteChampionship: ['imsa_weathertech', 'elms'], // either one
    repPerRound: 600,
    incomeBonus: 0.35,
    finalBonusMult: 5.0,
    color: '#ff4400',
    description: 'The world\'s greatest endurance championship.',
  },
  {
    id: 'f1_world_championship',
    name: 'F1 World Championship',
    shortName: 'F1 WC',
    allowedClasses: ['F1'],
    rounds: 24,
    roundDurationSec: 120,
    entryFee: 20000000,
    repRequired: 80000,
    prerequisiteChampionship: 'fia_wec',
    repPerRound: 500,
    incomeBonus: 0.50,
    finalBonusMult: 6.0,
    color: '#ff0055',
    description: 'The pinnacle of motorsport. 24 races across the globe.',
  },
];

// ─── Drivers ──────────────────────────────────────────────────────────────────

const DRIVER_TIERS = {
  C: { name: 'Club Racer',     rarity: 'Common',    scoutCost: 0,       color: '#888',    locked: false },
  B: { name: 'Gentleman',      rarity: 'Uncommon',  scoutCost: 10000,   color: '#44aa44', locked: false },
  A: { name: 'Pro Driver',     rarity: 'Rare',      scoutCost: 75000,   color: '#4488ff', locked: false },
  S: { name: 'Factory Driver', rarity: 'Epic',      scoutCost: 500000,  color: '#aa44ff', locked: false },
  L: { name: 'Legend',         rarity: 'Legendary', scoutCost: 0,       color: '#ffaa00', locked: true  },
};

// Budget, floor, and ceiling per driver tier
const DRIVER_STAT_CONFIG = {
  C: { budgetMin: 50,  budgetMax: 70,  floor: 5,  ceiling: 25  },
  B: { budgetMin: 80,  budgetMax: 110, floor: 8,  ceiling: 38  },
  A: { budgetMin: 130, budgetMax: 160, floor: 15, ceiling: 60  },
  S: { budgetMin: 180, budgetMax: 220, floor: 25, ceiling: 80  },
  L: { budgetMin: 260, budgetMax: 300, floor: 40, ceiling: 100 },
};

const DRIVER_STAT_KEYS = ['pace', 'consistency', 'tyreManagement', 'rainSkill', 'fitness'];
const DRIVER_STAT_LABELS = {
  pace:           'Pace',
  consistency:    'Consistency',
  tyreManagement: 'Tyre Mgmt',
  rainSkill:      'Rain Skill',
  fitness:        'Fitness',
};

// Starting age range when scouting a new driver
const DRIVER_AGE_RANGES = {
  C: { min: 18, max: 35 },
  B: { min: 22, max: 40 },
  A: { min: 20, max: 32 },
  S: { min: 22, max: 30 },
  L: { min: 25, max: 35 },
};

// Career stages keyed by age bracket
const CAREER_STAGES = [
  { id: 'junior',     label: 'Junior',         color: '#4488ff', minAge: 14, maxAge: 17, trajectory: '↑' },
  { id: 'rising',     label: 'Rising Star',     color: '#00ff88', minAge: 18, maxAge: 22, trajectory: '↑' },
  { id: 'prime',      label: 'Prime',           color: '#ffd700', minAge: 23, maxAge: 28, trajectory: '↑' },
  { id: 'veteran',    label: 'Veteran',         color: '#d8d8f0', minAge: 29, maxAge: 34, trajectory: '→' },
  { id: 'late',       label: 'Late Career',     color: '#ff8800', minAge: 35, maxAge: 39, trajectory: '↓' },
  { id: 'retirement', label: 'Retirement Zone', color: '#ff3355', minAge: 40, maxAge: 999, trajectory: '↓' },
];

function getCareerStage(age) {
  return CAREER_STAGES.find(s => age >= s.minAge && age <= s.maxAge)
    || CAREER_STAGES[CAREER_STAGES.length - 1];
}

const DRIVER_NAMES = [
  'Alex Mercer', 'Jordan Kane', 'Nico Voss', 'Lena Carver', 'Riku Tanaka',
  'Sara Blaine', 'Theo Marsh', 'Dani Reyes', 'Kira Stone', 'Oscar Flynn',
  'Maya Cruz', 'Lars Brandt', 'Vance Cole', 'Iris Park', 'Eli Dorn',
];

// ─── Prestige Shop ────────────────────────────────────────────────────────────

const PRESTIGE_ITEMS = [
  {
    id: 'head_start',
    name: 'Season Head-Start',
    cost: 50,
    description: 'Start next season with 3 upgrade levels on all car parts.',
    repeatable: true,
    maxPurchases: 5,
  },
  {
    id: 'factory_backing',
    name: 'Factory Backing',
    cost: 100,
    description: 'Sponsor income +25% permanently.',
    repeatable: false,
  },
  {
    id: 'talent_academy',
    name: 'Talent Academy',
    cost: 150,
    description: 'Unlock one exclusive A/S-tier driver each season.',
    repeatable: false,
  },
  {
    id: 'dev_token',
    name: 'Development Token',
    cost: 200,
    description: 'One upgrade of your choice does not reset on Season Reset.',
    repeatable: true,
    maxPurchases: 5,
  },
  {
    id: 'legend_contract',
    name: 'Legend Contract',
    cost: 500,
    description: 'Recruit a Legendary-tier driver for 1 season.',
    repeatable: true,
  },
];

// ─── Garage Upgrades ──────────────────────────────────────────────────────────

const GARAGE_UPGRADES = [
  { level: 1, slots: 1, cost: 0,          repRequired: 0 },
  { level: 2, slots: 2, cost: 50000,      repRequired: 0 },
  { level: 3, slots: 3, cost: 200000,     repRequired: 500 },
  { level: 4, slots: 4, cost: 750000,     repRequired: 2500 },
  { level: 5, slots: 6, cost: 3000000,    repRequired: 8000 },
  { level: 6, slots: 8, cost: 15000000,   repRequired: 25000 },
];

const GARAGE_MAX_LEVEL = GARAGE_UPGRADES.length;

function getGarageSlots(level) {
  const entry = GARAGE_UPGRADES.find(g => g.level === level);
  return entry ? entry.slots : 1;
}

function getGarageNextUpgrade(currentLevel) {
  return GARAGE_UPGRADES.find(g => g.level === currentLevel + 1) || null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUpgradeCost(upgradeId, currentLevel) {
  const upg = UPGRADES[upgradeId];
  return Math.floor(upg.baseCost * Math.pow(upg.costMult, currentLevel));
}

function getCarClassById(id) {
  return CAR_CLASSES.find(c => c.id === id) || null;
}

function getChampionshipById(id) {
  return CHAMPIONSHIPS.find(c => c.id === id) || null;
}

// Returns the prerequisite championship name(s) as a human-readable string, or null.
function getPrerequisiteLabel(champDef) {
  if (!champDef.prerequisiteChampionship) return null;
  const ids = Array.isArray(champDef.prerequisiteChampionship)
    ? champDef.prerequisiteChampionship
    : [champDef.prerequisiteChampionship];
  const names = ids.map(id => {
    const c = getChampionshipById(id);
    return c ? c.shortName : id;
  });
  return names.length === 1 ? names[0] : names.join(' or ');
}

// ─── Sponsor System ───────────────────────────────────────────────────────────

const SPONSOR_TIERS = {
  starter: {
    id: 'starter',
    label: 'Family',
    color: '#ff88cc',
    incomeMin: 8, incomeMax: 8,
    contractMin: null, contractMax: null,
    target: null,
    bonusCash: 0, bonusRep: 0, bonusPP: 0,
    unlocksLivery: false,
  },
  regional: {
    id: 'regional',
    label: 'Regional',
    color: '#4a8fff',
    incomeMin: 20, incomeMax: 80,
    contractMin: 1, contractMax: 2,
    target: 'any_round_completed',
    bonusCash: 10000, bonusRep: 0, bonusPP: 0,
    unlocksLivery: false,
  },
  national: {
    id: 'national',
    label: 'National',
    color: '#00d4ff',
    incomeMin: 100, incomeMax: 300,
    contractMin: 2, contractMax: 3,
    target: 'any_champ_completed',
    bonusCash: 40000, bonusRep: 200, bonusPP: 0,
    unlocksLivery: false,
  },
  international: {
    id: 'international',
    label: 'International',
    color: '#ff8800',
    incomeMin: 400, incomeMax: 1000,
    contractMin: 3, contractMax: 3,
    target: 'major_champ_completed',
    bonusCash: 150000, bonusRep: 1000, bonusPP: 0,
    unlocksLivery: false,
  },
  factory: {
    id: 'factory',
    label: 'Factory Title',
    color: '#ff0055',
    incomeMin: 2000, incomeMax: 5000,
    contractMin: null, contractMax: null,
    target: 'top_champ_completed',
    bonusCash: 0, bonusRep: 0, bonusPP: 5,
    unlocksLivery: true,
  },
};

// Human-readable descriptions for target types
const SPONSOR_TARGET_LABELS = {
  any_round_completed: 'Top 10 in any championship round this season',
  any_champ_completed: 'Complete any championship this season',
  major_champ_completed: 'Complete a major championship (IMSA, ELMS, WEC, or F1)',
  top_champ_completed: 'Win FIA WEC or F1 World Championship',
};

// Slot unlock conditions (index = slot number - 1)
const SPONSOR_SLOT_UNLOCKS = [
  { slot: 1, condition: null,                                           label: 'Default slot' },
  { slot: 2, condition: { type: 'champ', champId: 'gt4_regional' },    label: 'Complete GT4 Regional Cup' },
  { slot: 3, condition: { type: 'rep',   amount: 3500  },              label: 'Reach 3,500 REP' },
  { slot: 4, condition: { type: 'rep',   amount: 20000 },              label: 'Reach 20,000 REP' },
  { slot: 5, condition: { type: 'rep',   amount: 80000 },              label: 'Reach 80,000 REP' },
];

const SPONSOR_CATEGORIES = [
  { id: 'tyre',    name: 'Tyres',        icon: '◎' },
  { id: 'fuel',    name: 'Fuel',         icon: '◈' },
  { id: 'apparel', name: 'Apparel',      icon: '◆' },
  { id: 'energy',  name: 'Energy Drink', icon: '⚡' },
  { id: 'tech',    name: 'Technology',   icon: '⬡' },
  { id: 'finance', name: 'Finance',      icon: '▣' },
];

const SPONSOR_BRAND_WORDS = {
  tyre:    ['Apex', 'Grip', 'Vector', 'Traction', 'Circuit', 'Velo'],
  fuel:    ['Nitro', 'Blaze', 'Surge', 'Turbo', 'Flash', 'Ignite'],
  apparel: ['Rally', 'Podium', 'Victory', 'Champion', 'Elite', 'Pace'],
  energy:  ['Volt', 'Rush', 'Pulse', 'Blast', 'Charge', 'Jolt'],
  tech:    ['Nexus', 'Vertex', 'Core', 'Synapse', 'Quantum', 'Prism'],
  finance: ['Capital', 'Premier', 'Summit', 'Sterling', 'Vault', 'Meridian'],
};

const SPONSOR_SUFFIXES = ['Racing', 'Motorsport', 'Pro', 'Sport', 'Performance', 'Systems'];

// ─── Team Staff ────────────────────────────────────────────────────────────────

const TP_TIERS = {
  amateur:      { id: 'amateur',      label: 'Amateur',       color: '#888888', hireCost: 0,       salary: 0,      locked: false },
  regional:     { id: 'regional',     label: 'Regional',      color: '#44aa44', hireCost: 50000,   salary: 10000,  locked: false },
  national:     { id: 'national',     label: 'National',      color: '#4488ff', hireCost: 200000,  salary: 50000,  locked: false },
  international:{ id: 'international',label: 'International', color: '#aa44ff', hireCost: 750000,  salary: 200000, locked: false },
  legendary:    { id: 'legendary',    label: 'Legend',        color: '#ffaa00', hireCost: 0,       salary: 500000, locked: true  },
};

const TP_STAT_CONFIG = {
  amateur:      { budgetMin: 50,  budgetMax: 70,  floor: 5,  ceiling: 25  },
  regional:     { budgetMin: 80,  budgetMax: 110, floor: 8,  ceiling: 38  },
  national:     { budgetMin: 130, budgetMax: 160, floor: 15, ceiling: 60  },
  international:{ budgetMin: 180, budgetMax: 220, floor: 25, ceiling: 80  },
  legendary:    { budgetMin: 260, budgetMax: 300, floor: 40, ceiling: 100 },
};

const TP_STAT_KEYS = ['motivation', 'strategy', 'budgetManagement', 'sponsorshipNetwork', 'talentEye'];
const TP_STAT_LABELS = {
  motivation:         'Motivation',
  strategy:           'Strategy',
  budgetManagement:   'Budget Mgmt',
  sponsorshipNetwork: 'Sponsorship',
  talentEye:          'Talent Eye',
};
const TP_STAT_DESCS = {
  motivation:         'Boosts all driver pace multipliers',
  strategy:           'Extra REP per championship round',
  budgetManagement:   'Reduces upgrade costs',
  sponsorshipNetwork: 'Increases all sponsor income',
  talentEye:          'Reduces driver scouting costs',
};

const RE_TIERS = {
  amateur:      { id: 'amateur',      label: 'Amateur',       color: '#888888', hireCost: 0,       salary: 0,      locked: false },
  regional:     { id: 'regional',     label: 'Regional',      color: '#44aa44', hireCost: 30000,   salary: 8000,   locked: false },
  national:     { id: 'national',     label: 'National',      color: '#4488ff', hireCost: 120000,  salary: 30000,  locked: false },
  international:{ id: 'international',label: 'International', color: '#aa44ff', hireCost: 450000,  salary: 100000, locked: false },
  legendary:    { id: 'legendary',    label: 'Legend',        color: '#ffaa00', hireCost: 0,       salary: 300000, locked: true  },
};

const RE_STAT_CONFIG = {
  amateur:      { budgetMin: 50,  budgetMax: 70,  floor: 5,  ceiling: 25  },
  regional:     { budgetMin: 80,  budgetMax: 110, floor: 8,  ceiling: 38  },
  national:     { budgetMin: 130, budgetMax: 160, floor: 15, ceiling: 60  },
  international:{ budgetMin: 180, budgetMax: 220, floor: 25, ceiling: 80  },
  legendary:    { budgetMin: 260, budgetMax: 300, floor: 40, ceiling: 100 },
};

const RE_STAT_KEYS = ['setupMastery', 'reliabilityEngineering', 'pitWallStrategy', 'driverCoach', 'dataAnalysis'];
const RE_STAT_LABELS = {
  setupMastery:           'Setup Mastery',
  reliabilityEngineering: 'Reliability Eng.',
  pitWallStrategy:        'Pit Strategy',
  driverCoach:            'Driver Coach',
  dataAnalysis:           'Data Analysis',
};
const RE_STAT_DESCS = {
  setupMastery:           'Boosts all upgrade multipliers on this car',
  reliabilityEngineering: 'Boosts reliability multiplier on this car',
  pitWallStrategy:        'Increases championship income bonus for this car',
  driverCoach:            'Increases assigned driver XP gain',
  dataAnalysis:           'Boosts championship final payout bonus',
};

const STAFF_NAMES = [
  'Marco Rossi', 'James Wright', 'Elena Kovač', 'Yuki Hara', 'Chris Barlow',
  'Sofia Andrade', 'Neil Hartley', 'Ana Santos', 'Raj Mehta', 'Tom Clancy',
  'Ingrid Bauer', 'Luca Ferrari', 'Mei Chen', 'Ben Archer', 'Natasha Volkov',
];
