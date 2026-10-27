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
    baseRating: 100,
    upgradeCostMult: 1,
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
    baseRating: 135,
    upgradeCostMult: 2.5,
    maxOwned: 4,
    color: '#00aaff',
    description: 'GT World Series contender. Real prize money starts here.',
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
    baseRating: 170,
    upgradeCostMult: 6,
    maxOwned: 3,
    color: '#00d4ff',
    description: 'Entry-level prototype racing in the European Endurance Series. A big step up from GT.',
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
    baseRating: 205,
    upgradeCostMult: 15,
    maxOwned: 2,
    color: '#ff8800',
    description: 'Prototype racing across the endurance calendar. Speed in a different language.',
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
    baseRating: 245,
    upgradeCostMult: 40,
    maxOwned: 2,
    color: '#ff4400',
    description: 'Hypercar — the pinnacle of endurance racing.',
    upgradeTree: 'standard',
  },
  // ── Single-Seater Pathway (unlocks after first prestige) ─────────────────
  {
    id: 'F4',
    name: 'Formula 4',
    fullName: 'F4 — Single-Seater Entry',
    tier: 2,
    repRequired: 1000,
    ppRequired: 1,
    baseCost: 75000,
    baseIncomePerLap: 2500,
    lapTimeSec: 8,
    baseRating: 120,
    upgradeCostMult: 3,
    maxOwned: 3,
    color: '#ff6699',
    description: 'Entry-level open-wheel racing. The bottom rung of the single-seater ladder.',
    upgradeTree: 'f1',
    pathway: 'single_seater',
  },
  {
    id: 'F3',
    name: 'Formula 3',
    fullName: 'F3 — Open Wheel',
    tier: 3,
    repRequired: 5000,
    ppRequired: 1,
    baseCost: 500000,
    baseIncomePerLap: 12000,
    lapTimeSec: 7,
    baseRating: 165,
    upgradeCostMult: 10,
    maxOwned: 2,
    color: '#ff4488',
    description: 'Serious single-seater competition. Where future champions are forged.',
    upgradeTree: 'f1',
    pathway: 'single_seater',
  },
  {
    id: 'F2',
    name: 'Formula 2',
    fullName: 'F2 — One Step From The Top',
    tier: 4,
    repRequired: 20000,
    ppRequired: 1,
    baseCost: 3000000,
    baseIncomePerLap: 50000,
    lapTimeSec: 5,
    baseRating: 215,
    upgradeCostMult: 30,
    maxOwned: 2,
    color: '#ff2266',
    description: 'The final proving ground before the top tier. Elite talent required.',
    upgradeTree: 'f1',
    pathway: 'single_seater',
  },
  {
    id: 'F1',
    name: 'Formula World',
    fullName: 'F1 — Pinnacle',
    tier: 6,
    repRequired: 100000,
    ppRequired: 500,
    baseCost: 25000000,
    baseIncomePerLap: 500000,
    lapTimeSec: 4,
    baseRating: 270,
    upgradeCostMult: 100,
    maxOwned: 2,
    color: '#ff0055',
    description: 'The ultimate open-wheel challenge.',
    upgradeTree: 'f1',
    pathway: 'single_seater',
  },
];

// ─── Driver Licenses ──────────────────────────────────────────────────────────

// All license tiers in progression order (within each pathway)
const LICENSE_TIERS = [
  { id: 'GT4',      name: 'GT4',      pointsRequired: 30,  pathway: 'gt_endurance'  },
  { id: 'GT3',      name: 'GT3',      pointsRequired: 50,  pathway: 'gt_endurance'  },
  { id: 'LMP3',     name: 'LMP3',     pointsRequired: 100, pathway: 'gt_endurance'  },
  { id: 'LMP2',     name: 'LMP2',     pointsRequired: 150, pathway: 'gt_endurance'  },
  { id: 'HYPERCAR', name: 'Hypercar', pointsRequired: 200, pathway: 'gt_endurance'  },
  { id: 'F4',       name: 'F4',       pointsRequired: 30,  pathway: 'single_seater' },
  { id: 'F1',       name: 'F1',       pointsRequired: 300, pathway: 'single_seater' },
];

// Which license a driver must hold to be assigned to a given car class
const CLASS_LICENSE_REQUIREMENT = {
  GT4:     'GT4',
  GT3:     'GT3',
  LMP3:    'LMP3',
  LMP2:    'LMP2',
  HYPERCAR:'HYPERCAR',
  F4:      'F4',
  F3:      'F4',   // F3/F2 use F4 license — no separate tier defined
  F2:      'F4',
  F1:      'F1',
};

// LP earned per completed championship toward each license, keyed by the class raced in.
// The full amount is paid for a title; lower finishes earn a share (LICENSE_RESULT_FACTORS).
// "—" cells in the spec (already qualified) are simply absent from each row.
const LP_EARN_TABLE = {
  KARTING: { F4: 10, GT4: 5,  GT3: 2,  LMP3: 1,  LMP2: 1,  HYPERCAR: 1,  F1: 1  },
  F4:      {         GT4: 15, GT3: 8,  LMP3: 3,  LMP2: 2,  HYPERCAR: 1,  F1: 1  },
  // GT and prototype racing also counts toward the F4 license, so any driver can cross over
  GT4:     { F4: 10,          GT3: 25, LMP3: 10, LMP2: 6,  HYPERCAR: 4,  F1: 2  },
  GT3:     { F4: 12,                   LMP3: 25, LMP2: 14, HYPERCAR: 9,  F1: 5  },
  LMP3:    { F4: 15,                             LMP2: 30, HYPERCAR: 20, F1: 12 },
  LMP2:    { F4: 20,                                       HYPERCAR: 30, F1: 20 },
  HYPERCAR:{ F4: 30,                                                      F1: 30 },
  // F3/F2 not in original spec — values are estimates, adjust as needed
  F3:      {                           LMP3: 20, LMP2: 10, HYPERCAR: 6,  F1: 15 },
  F2:      {                                     LMP2: 25, HYPERCAR: 15, F1: 25 },
};

// Share of the LP table earned by final championship position (last value repeats)
const LICENSE_RESULT_FACTORS = [1, 0.75, 0.6, 0.4, 0.4, 0.2, 0.2, 0.2, 0.2, 0.2, 0.1];

// Licenses a freshly scouted driver already holds, by driver tier
const TIER_STARTING_LICENSES = {
  C: ['GT4'],
  B: ['GT4', 'GT3', 'F4'],
  A: ['GT4', 'GT3', 'LMP3', 'F4'],
  S: ['GT4', 'GT3', 'LMP3', 'LMP2', 'F4'],
  L: ['GT4', 'GT3', 'LMP3', 'LMP2', 'HYPERCAR', 'F4'],
};

// Global LP multiplier config — wire prestige scaling here when values are finalised
const LICENSE_CONFIG = {
  defaultMultiplier: 1.0,
  // prestigeMultipliers: { 0: 1.0, 1: 1.5, 2: 2.0, 3: 3.0 },  // TBD
};

// ─── Balance of Performance ───────────────────────────────────────────────────

// Cars in a class are balanced: performance comes from drivers, the pit crew and a
// small setup bonus. Reliability (car preparation) is the only per-car upgrade.
const UPGRADES = {
  reliability: {
    id: 'reliability',
    name: 'Car Preparation',
    icon: '◆',
    maxLevel: 9,
    baseCost: 1200,
    costMult: 1.9,
    description: '-1% DNF chance/level',
    // DNF chance per round: 10% at Lv 0, -1% per level, floor 1% (doubled in endurance)
  },
};

const UPGRADE_ORDER = ['reliability'];

// Performance upgrades from before BoP; their spend is refunded when an old save loads
const LEGACY_UPGRADES = {
  engine: { baseCost: 1000, costMult: 1.8 },
  aero:   { baseCost: 800,  costMult: 1.7 },
  tyres:  { baseCost: 600,  costMult: 1.6 },
  brakes: { baseCost: 700,  costMult: 1.65 },
};

// Setup knowledge: each completed championship in a car adds a little, up to a cap
const SETUP_BONUS_PER_CHAMP = 0.005;
const SETUP_BONUS_MAX = 0.03;

// Team-wide pit crew. Level adds rating to every car it covers (more in endurance,
// where stops matter); size is how many cars it covers fully, the rest get a share.
const PIT_CREW = {
  maxLevel: 20,
  levelBaseCost: 5000,
  levelCostMult: 1.55,
  sprintPctPerLevel: 0.4,
  endurancePctPerLevel: 1.0,
  maxSize: 8,
  sizeBaseCost: 25000,
  sizeCostMult: 3,
  uncoveredShare: 0.5,
};

// Driver development: XP turns into stat points at season end
const XP_PER_STAT_POINT = 400;
const TRAINING_CEILING_BONUS = 10;   // trained stats can exceed the tier ceiling by this much

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
    repPerRound: 20,
    format: 'sprint',
    fieldStrength: { GT4: 105 },
    prizeMult: 4,
    wetChance: 0.15,
    color: '#4a8fff',
    description: '8-round regional sprint series. Perfect for a new team.',
  },
  {
    id: 'gt_world_challenge',
    name: 'GT World Series',
    shortName: 'GT World Series',
    allowedClasses: ['GT3'],
    rounds: 10,
    roundDurationSec: 90,
    entryFee: 50000,
    repRequired: 800,
    prerequisiteChampionship: 'gt4_regional',
    repPerRound: 40,
    format: 'sprint',
    fieldStrength: { GT3: 160 },
    prizeMult: 5,
    wetChance: 0.2,
    color: '#00aaff',
    description: '10-round series mixing sprint and endurance formats.',
  },
  {
    id: 'imsa_weathertech',
    name: 'North American Endurance Championship',
    shortName: 'NA Endurance',
    allowedClasses: ['GT3', 'LMP2', 'HYPERCAR'],
    rounds: 12,
    roundDurationSec: 120,
    entryFee: 300000,
    repRequired: 3500,
    prerequisiteChampionship: 'gt_world_challenge',
    repPerRound: 70,
    format: 'endurance',
    lineupSize: 2,
    fieldStrength: { GT3: 170, LMP2: 270, HYPERCAR: 335 },
    prizeMult: 10,
    wetChance: 0.15,
    color: '#00d4ff',
    description: 'North American multi-class endurance racing for Hypercars, LMP2 and GT3.',
  },
  {
    id: 'elms',
    name: 'European Endurance Series',
    shortName: 'Euro Endurance',
    allowedClasses: ['GT3', 'LMP3', 'LMP2'],
    rounds: 6,
    roundDurationSec: 150,
    entryFee: 500000,
    repRequired: 2500,      // the LMP3's series: opens when the LMP3 can be bought
    prerequisiteChampionship: 'gt_world_challenge',
    repPerRound: 80,
    format: 'endurance',
    lineupSize: 3,
    fieldStrength: { GT3: 180, LMP3: 212, LMP2: 265 },
    prizeMult: 15,
    wetChance: 0.25,
    color: '#ff8800',
    description: '6-round European endurance series for LMP2, LMP3 and GT3.',
  },
  {
    id: 'fia_wec',
    name: 'World Endurance Cup',
    shortName: 'World Endurance',
    allowedClasses: ['GT3', 'LMP2', 'HYPERCAR'],
    rounds: 8,
    roundDurationSec: 180,
    entryFee: 2000000,
    repRequired: 20000,
    prerequisiteChampionship: ['imsa_weathertech', 'elms'], // either one
    repPerRound: 120,
    format: 'endurance',
    lineupSize: 3,
    fieldStrength: { GT3: 195, LMP2: 285, HYPERCAR: 350 },
    prizeMult: 20,
    wetChance: 0.2,
    color: '#ff4400',
    description: 'The world\'s greatest endurance championship.',
  },
  // ── Single-Seater Pathway championships (unlocks after first prestige) ────
  {
    id: 'formula_regional',
    name: 'Regional Formula Series',
    shortName: 'Regional Formula',
    allowedClasses: ['F4'],
    rounds: 8,
    roundDurationSec: 60,
    entryFee: 10000,
    repRequired: 0,
    prerequisiteChampionship: null,
    repPerRound: 20,
    format: 'sprint',
    fieldStrength: { F4: 140 },
    prizeMult: 2,
    wetChance: 0.2,
    color: '#ff6699',
    description: 'The starting point of the single-seater ladder. 8 rounds of tight F4 action.',
    pathway: 'single_seater',
  },
  {
    id: 'formula_3_championship',
    name: 'F3 International Series',
    shortName: 'F3 International',
    allowedClasses: ['F3'],
    rounds: 12,
    roundDurationSec: 90,
    entryFee: 150000,
    repRequired: 3000,
    prerequisiteChampionship: 'formula_regional',
    repPerRound: 40,
    format: 'sprint',
    fieldStrength: { F3: 195 },
    prizeMult: 4,
    wetChance: 0.2,
    color: '#ff4488',
    description: 'The proving ground for the next generation of top-flight stars. 12 rounds.',
    pathway: 'single_seater',
  },
  {
    id: 'formula_2_championship',
    name: 'F2 Global Series',
    shortName: 'F2 Global',
    allowedClasses: ['F2'],
    rounds: 16,
    roundDurationSec: 120,
    entryFee: 2000000,
    repRequired: 15000,
    prerequisiteChampionship: 'formula_3_championship',
    repPerRound: 80,
    format: 'sprint',
    fieldStrength: { F2: 265 },
    prizeMult: 5,
    wetChance: 0.2,
    color: '#ff2266',
    description: 'One step from the pinnacle. Prove yourself here to reach the top tier.',
    pathway: 'single_seater',
  },
  {
    id: 'f1_world_championship',
    name: 'Formula World Championship',
    shortName: 'Formula World',
    allowedClasses: ['F1'],
    rounds: 24,
    roundDurationSec: 120,
    entryFee: 20000000,
    repRequired: 80000,
    prerequisiteChampionship: 'formula_2_championship',
    repPerRound: 100,
    format: 'sprint',
    fieldStrength: { F1: 365 },
    prizeMult: 4,
    wetChance: 0.15,
    color: '#ff0055',
    description: 'The pinnacle of motorsport. 24 races across the globe.',
    pathway: 'single_seater',
  },
];

// ─── Race Simulation ─────────────────────────────────────────────────────────

// Championship points per finishing position (P1 first)
const POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// Share of the P1 round prize/REP paid per finishing position (last value repeats)
const PRIZE_FACTORS = [1, 0.8, 0.66, 0.55, 0.46, 0.39, 0.33, 0.28, 0.24, 0.2, 0.15, 0.1];

// Championship prize pool paid on the final standings, as a share of (P1 round prize × rounds)
const STANDING_BONUS = [0.6, 0.45, 0.35, 0.27, 0.2, 0.15, 0.11, 0.08, 0.05, 0.03];
// REP bonus on the final standings, same base (P1 round REP × rounds)
const STANDING_REP_BONUS = [0.5, 0.3, 0.2, 0.1, 0.05];

// A car that has raced a series before keeps its slot: later entries cost this share of the fee
const RENEWAL_FEE_SHARE = 0.25;

// Every season lasts this long in real time and ends automatically
const SEASON_LENGTH_SEC = 3600;

const FIELD_SIZE = 12;          // AI rivals per class in a championship
const FIELD_SPREAD = 0.36;      // AI ratings span fieldStrength × (1 ± spread/2)
const RACE_NOISE = 0.07;        // per-round performance variance (std dev, before consistency)

// Driver lineups: a car seats a lead driver plus co-drivers. Endurance series set a
// lineupSize; a short lineup makes its fittest driver double-stint while fatigued.
// Seats beyond the lineup size hold reserves: they don't race or earn anything, but
// move up when a race driver leaves.
const MAX_LINEUP = 4;             // most seats in any car: 3 race drivers + a reserve

const DEFAULT_TEAM_NAME = 'Cyberracing';
const TEAM_NAME_MAX_LENGTH = 24;
const FATIGUE_SKILL_BASE = 0.55;        // double-stint skill share, + fitness / FATIGUE_FITNESS_DIV
const FATIGUE_FITNESS_DIV = 500;        // fitness 50 → 65% of normal skill
const SHORT_LINEUP_DNF_PENALTY = 0.5;   // +50% DNF chance per missing driver

const RIVAL_TEAMS = [
  'Apex Dynamics', 'Redline Works', 'Nova Motorsport', 'Iron Falcon', 'Stratos Racing',
  'Velocity Lab', 'Kaiju Racing', 'Bluewave GP', 'Corsa Nera', 'Helix Autosport',
  'Northstar Racing', 'Vortex Engineering', 'Sakura Speed', 'Crimson Arrow', 'Atlas Racing',
  'Phantom GP', 'Zenith Motorsport', 'Neon Drift', 'Titan Racing', 'Eclipse Racing',
];

// ─── Drivers ──────────────────────────────────────────────────────────────────

// salary: paid at every season end while the driver is signed (Legends are prepaid)
const DRIVER_TIERS = {
  C: { name: 'Club Racer',     rarity: 'Common',    scoutCost: 0,       salary: 0,      color: '#888',    locked: false },
  B: { name: 'Gentleman',      rarity: 'Uncommon',  scoutCost: 10000,   salary: 2000,   color: '#44aa44', locked: false },
  A: { name: 'Pro Driver',     rarity: 'Rare',      scoutCost: 75000,   salary: 15000,  color: '#4488ff', locked: false },
  S: { name: 'Factory Driver', rarity: 'Epic',      scoutCost: 500000,  salary: 100000, color: '#aa44ff', locked: false },
  L: { name: 'Legend',         rarity: 'Legendary', scoutCost: 0,       salary: 0,      color: '#ffaa00', locked: true  },
};

// The free Club Racer scout can only be used this often, so it can't be rerolled endlessly
const FREE_SCOUT_COOLDOWN_SEC = 90;

// Budget, floor, and ceiling per driver tier. paceMin guarantees a paid driver is
// actually quick, whichever stat their budget favours.
const DRIVER_STAT_CONFIG = {
  C: { budgetMin: 50,  budgetMax: 70,  floor: 5,  ceiling: 25,  paceMin: 8  },
  B: { budgetMin: 80,  budgetMax: 110, floor: 8,  ceiling: 38,  paceMin: 18 },
  A: { budgetMin: 130, budgetMax: 160, floor: 15, ceiling: 60,  paceMin: 32 },
  S: { budgetMin: 180, budgetMax: 220, floor: 25, ceiling: 80,  paceMin: 48 },
  L: { budgetMin: 260, budgetMax: 300, floor: 40, ceiling: 100, paceMin: 65 },
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

// Driver names are a random first + last name, never one already on the team
const DRIVER_FIRST_NAMES = [
  'Alex', 'Jordan', 'Nico', 'Lena', 'Riku', 'Sara', 'Theo', 'Dani', 'Kira', 'Oscar',
  'Maya', 'Lars', 'Vance', 'Iris', 'Eli', 'Mira', 'Jonas', 'Talia', 'Ruben', 'Anya',
  'Felix', 'Noor', 'Emil', 'Sofia', 'Kai', 'Leona', 'Mateo', 'Yara', 'Hugo', 'Ines',
  'Aiden', 'Bianca', 'Caspar', 'Dalia', 'Elias', 'Freya', 'Gael', 'Hana', 'Ivo', 'Jana',
  'Kenji', 'Lucia', 'Milo', 'Nadia', 'Orin', 'Petra', 'Quentin', 'Rosa', 'Silas', 'Tamsin',
  'Ugo', 'Vera', 'Wes', 'Xenia', 'Yusuf', 'Zara', 'Arlo', 'Beatriz', 'Cyrus', 'Delphine',
  'Esme', 'Finn', 'Greta', 'Hamza', 'Isla', 'Joaquin', 'Katja', 'Leif', 'Marisol', 'Nils',
  'Odette', 'Pavel', 'Rhea', 'Soren', 'Thea', 'Umar', 'Valentina', 'Wren', 'Yannis', 'Zoe',
  'Anders', 'Celeste', 'Dario', 'Elodie', 'Florin', 'Gwen', 'Haruto', 'Ilse', 'Jasper', 'Kalani',
  'Linnea', 'Marek', 'Nell', 'Otto', 'Priya', 'Remy', 'Saskia', 'Tobias', 'Viggo', 'Wilhelmina',
];
const DRIVER_LAST_NAMES = [
  'Mercer', 'Kane', 'Voss', 'Carver', 'Tanaka', 'Blaine', 'Marsh', 'Reyes', 'Stone', 'Flynn',
  'Cruz', 'Brandt', 'Cole', 'Park', 'Dorn', 'Halden', 'Okafor', 'Lindqvist', 'Moreau', 'Sato',
  'Varga', 'Quinn', 'Ashby', 'Delacroix', 'Novak', 'Brenner', 'Castell', 'Ivers', 'Rhee', 'Thorne',
  'Albrecht', 'Barrow', 'Calloway', 'Dunmore', 'Ekström', 'Falk', 'Garrow', 'Holm', 'Ishikawa', 'Jansen',
  'Kowal', 'Lacroix', 'Mendes', 'Nakamura', 'Oduya', 'Pellegrin', 'Quist', 'Rasmussen', 'Strand', 'Tavares',
  'Ulrich', 'Vance', 'Wexler', 'Yilmaz', 'Zeller', 'Abara', 'Bexley', 'Corvin', 'Draper', 'Estrada',
  'Fenwick', 'Galloway', 'Hargrove', 'Ibarra', 'Jessop', 'Kirkland', 'Lowell', 'Marchetti', 'Northam', 'Oakes',
  'Penrose', 'Ravel', 'Selby', 'Thackeray', 'Ueda', 'Valdez', 'Whitlock', 'Yardley', 'Zamora', 'Achterberg',
  'Blackwood', 'Castellan', 'Davenport', 'Elsworth', 'Fairbanks', 'Greaves', 'Holloway', 'Ingram', 'Kessler', 'Lindahl',
  'Moretti', 'Nordberg', 'Okonkwo', 'Prescott', 'Radcliffe', 'Sinclair', 'Tremblay', 'Underwood', 'Vasquez', 'Winslow',
];

// ─── Prestige Shop ────────────────────────────────────────────────────────────

const PRESTIGE_ITEMS = [
  {
    id: 'seed_money',
    name: 'Investor Backing',
    cost: 10,
    description: '+$25,000 starting money after every reset (per purchase).',
    maxPurchases: 5,
  },
  {
    id: 'head_start',
    name: 'Season Head-Start',
    cost: 50,
    description: 'The pit crew restarts each reset with +2 levels (per purchase).',
    maxPurchases: 5,
  },
  {
    id: 'wind_tunnel',
    name: 'Performance Programme',
    cost: 75,
    description: '+3% race rating for every car, permanently.',
    maxPurchases: 10,
  },
  {
    id: 'factory_backing',
    name: 'Factory Backing',
    cost: 100,
    description: 'Sponsor income +25% permanently.',
    maxPurchases: 1,
  },
  {
    id: 'talent_academy',
    name: 'Talent Academy',
    cost: 150,
    description: 'Driver scouting costs 50% less, permanently.',
    maxPurchases: 1,
  },
  {
    id: 'dev_token',
    name: 'Development Token',
    cost: 200,
    description: 'Each token keeps one more car through resets (highest class first). Its preparation and setup still reset.',
    maxPurchases: 5,
  },
  {
    id: 'legend_contract',
    name: 'Legend Contract',
    cost: 500,
    description: 'Sign a Legendary driver for the rest of this season.',
  },
];

// PP for a title in each series; P2/P3 earn PRESTIGE_PODIUM_SHARE of it
const PRESTIGE_TITLE_PP = {
  gt4_regional: 2, gt_world_challenge: 4, imsa_weathertech: 8, elms: 8, fia_wec: 15,
  formula_regional: 3, formula_3_championship: 6, formula_2_championship: 10, f1_world_championship: 25,
};
const PRESTIGE_PODIUM_SHARE = 0.4;
const PRESTIGE_REP_PER_PP = 1000;   // REP gained since the last reset per PP
const PRESTIGE_MIN_GAIN = 20;       // smallest PP gain that allows a reset
const PRESTIGE_START_MONEY = 5000;  // money after a reset, before Investor Backing
const SEED_MONEY_PER_PURCHASE = 25000;

// ─── Team HQ (late-game money sink) ───────────────────────────────────────────

// Facilities bought with money; costs grow exponentially. Levels reset on prestige
// and each level is worth HQ_PP_PER_LEVEL prestige points at the reset.
const HQ_UNLOCK_REP = 8000;
const HQ_PP_PER_LEVEL = 1;
const HQ_FACILITIES = [
  {
    id: 'simulator',
    name: 'Simulator Centre',
    icon: '🖥',
    description: '+1.5% race rating for every car per level.',
    baseCost: 2000000,
    costMult: 1.6,
    maxLevel: null,
  },
  {
    id: 'composites',
    name: 'Crew Training Centre',
    icon: '🔧',
    description: '-3% pit crew and car preparation costs per level.',
    baseCost: 1500000,
    costMult: 1.6,
    maxLevel: 15,
  },
  {
    id: 'hospitality',
    name: 'Hospitality Suite',
    icon: '🥂',
    description: '+5% sponsor income per level.',
    baseCost: 1000000,
    costMult: 1.5,
    maxLevel: null,
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

// Share of a car's purchase price and upgrade spend refunded when it is sold
const SELL_CAR_REFUND = 0.5;
const SELL_UPGRADE_REFUND = 0.3;

function getGarageSlots(level) {
  const entry = GARAGE_UPGRADES.find(g => g.level === level);
  return entry ? entry.slots : 1;
}

function getGarageNextUpgrade(currentLevel) {
  return GARAGE_UPGRADES.find(g => g.level === currentLevel + 1) || null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUpgradeCost(upgradeId, currentLevel, classId) {
  const upg = UPGRADES[upgradeId];
  const cls = classId ? getCarClassById(classId) : null;
  const classMult = (cls && cls.upgradeCostMult) || 1;
  return Math.floor(upg.baseCost * Math.pow(upg.costMult, currentLevel) * classMult);
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
    incomeMin: 10, incomeMax: 25,
    contractMin: 1, contractMax: 2,
    targets: [
      { type: 'round_podiums', countMin: 2, countMax: 4 },
      { type: 'round_wins',    countMin: 1, countMax: 2 },
    ],
    bonusCash: 5000, bonusRep: 0, bonusPP: 0,
    unlocksLivery: false,
  },
  national: {
    id: 'national',
    label: 'National',
    color: '#00d4ff',
    incomeMin: 40, incomeMax: 100,
    contractMin: 2, contractMax: 3,
    targets: [
      { type: 'champ_top',  pos: 3, minTier: 1 },
      { type: 'round_wins', countMin: 3, countMax: 6 },
    ],
    bonusCash: 25000, bonusRep: 50, bonusPP: 0,
    unlocksLivery: false,
  },
  international: {
    id: 'international',
    label: 'International',
    color: '#ff8800',
    incomeMin: 200, incomeMax: 500,
    contractMin: 3, contractMax: 3,
    targets: [
      { type: 'major_top', pos: 3 },
      { type: 'champ_top', pos: 1, minTier: 3 },
    ],
    bonusCash: 150000, bonusRep: 250, bonusPP: 0,
    unlocksLivery: false,
  },
  factory: {
    id: 'factory',
    label: 'Factory Title',
    color: '#ff0055',
    incomeMin: 1500, incomeMax: 3000,
    contractMin: null, contractMax: null,
    targets: [
      { type: 'top_title' },
    ],
    bonusCash: 0, bonusRep: 0, bonusPP: 5,
    unlocksLivery: true,
  },
};

// Championships that count as "major" for sponsor targets
const MAJOR_CHAMPIONSHIPS = ['imsa_weathertech', 'elms', 'fia_wec', 'formula_2_championship', 'f1_world_championship'];
const TOP_CHAMPIONSHIPS   = ['fia_wec', 'f1_world_championship'];

// Share of a targeted sponsor's income paid as it accrues; the rest is held
// back and only paid at season end if the target is met
const SPONSOR_UPFRONT_SHARE = 0.75;
const FAMILY_SUPPORT_IPS = 8;     // Mum & Dad Racing Support, $/s before bonuses

// Sponsor offers available per season (fixed until the season ends)
const SPONSOR_OFFERS_PER_SEASON = 4;

// Labels for contracts signed before result targets existed
const SPONSOR_TARGET_LABELS = {
  any_round_completed: 'Top 10 in any championship round this season',
  any_champ_completed: 'Complete any championship this season',
  major_champ_completed: 'Complete a major championship (NA Endurance, Euro Endurance, World Endurance or Formula World)',
  top_champ_completed: 'Win the World Endurance Cup or the Formula World Championship',
};

// Slot unlock conditions (index = slot number - 1)
const SPONSOR_SLOT_UNLOCKS = [
  { slot: 1, condition: null,                                           label: 'Default slot' },
  { slot: 2, condition: { type: 'champ', champId: 'gt4_regional' },    label: 'Complete GT4 Regional Cup' },
  { slot: 3, condition: { type: 'rep',   amount: 3500  },              label: 'Reach 3,500 REP' },
  { slot: 4, condition: { type: 'rep',   amount: 15000 },              label: 'Reach 15,000 REP' },
  { slot: 5, condition: { type: 'rep',   amount: 40000 },              label: 'Reach 40,000 REP' },
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
  budgetManagement:   'Reduces pit crew and car preparation costs',
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
  setupMastery:           'Raises the race rating of this car',
  reliabilityEngineering: 'Boosts reliability multiplier on this car',
  pitWallStrategy:        'Smarter strategy calls: up to +5% prize money from every race',
  driverCoach:            'Increases assigned driver XP and License Point gain',
  dataAnalysis:           'Boosts championship final payout bonus',
};

const STAFF_FIRST_NAMES = [
  'Marco', 'James', 'Elena', 'Yuki', 'Chris', 'Sofia', 'Neil', 'Ana', 'Raj', 'Tom',
  'Ingrid', 'Luca', 'Mei', 'Ben', 'Natasha', 'Pieter', 'Grace', 'Omar', 'Hanna', 'Diego',
  'Adele', 'Bruno', 'Carmen', 'Dmitri', 'Eva', 'Frank', 'Gloria', 'Henrik', 'Ivana', 'Jack',
  'Karin', 'Leo', 'Monica', 'Nathan', 'Olga', 'Paul', 'Rita', 'Stefan', 'Tara', 'Victor',
  'Agnes', 'Bernard', 'Clara', 'Dennis', 'Edith', 'Gustav', 'Helena', 'Igor', 'Julia', 'Klaus',
  'Lorna', 'Martin', 'Nora', 'Oliver', 'Pia', 'Rolf', 'Simone', 'Ted', 'Ulla', 'Walter',
];
const STAFF_LAST_NAMES = [
  'Wright', 'Kovač', 'Hara', 'Barlow', 'Andrade', 'Hartley', 'Santos', 'Mehta', 'Calloway', 'Bauer',
  'Ferrante', 'Chen', 'Archer', 'Volkov', 'Lindgren', 'Okoro', 'Whitfield', 'Navarro', 'Strand', 'Keller',
  'Abbott', 'Brook', 'Carlsen', 'Duarte', 'Ellis', 'Fischer', 'Gruber', 'Hoffmann', 'Iversen', 'Jaeger',
  'Kerr', 'Lund', 'Mattsson', 'Nolan', 'Ortega', 'Pryce', 'Rinaldi', 'Schuster', 'Toft', 'Vogel',
  'Walsh', 'Aldridge', 'Bergman', 'Costa', 'Dahl', 'Engel', 'Foster', 'Galvez', 'Hale', 'Imhof',
  'Jarvis', 'Krause', 'Lambert', 'Morrow', 'Nyberg', 'Osei', 'Pike', 'Quiroga', 'Rowe', 'Sandoval',
];
