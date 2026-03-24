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
  C: { name: 'Club Racer', rarity: 'Common',    scoutCost: 0,      paceRange: [5, 10],  color: '#888' },
  B: { name: 'Gentleman',  rarity: 'Uncommon',  scoutCost: 10000,  paceRange: [12, 20], color: '#44aa44' },
  A: { name: 'Pro Driver', rarity: 'Rare',      scoutCost: 75000,  paceRange: [22, 35], color: '#4488ff' },
  S: { name: 'Factory',    rarity: 'Epic',      scoutCost: 0,      paceRange: [38, 55], color: '#aa44ff' }, // PP only
  L: { name: 'Legend',     rarity: 'Legendary', scoutCost: 0,      paceRange: [60, 80], color: '#ffaa00' }, // special only
};

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
