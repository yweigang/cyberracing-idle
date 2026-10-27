// Balance simulation: a greedy bot plays the game headlessly on a fake clock and
// prints when it hits progression milestones.
// Run: node tools/sim.js [hours=12] [seed=1]
const { createGame } = require('./harness');

const HOURS = +(process.argv[2] || 12);
const SEED = +(process.argv[3] || 1);
const g = createGame({ seed: SEED });
const t0 = g.now();

const fmtTime = () => {
  const s = (g.now() - t0) / 1000;
  return `${String(Math.floor(s / 3600)).padStart(2)}h${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m`;
};
const seen = new Set();
const milestone = (key, msg) => { if (!seen.has(key)) { seen.add(key); console.log(`${fmtTime()}  ${msg}`); } };

// Bot policy runs inside the game sandbox so it can call game functions directly
g.run(`
var BOT = {
  tierOf(car) { return getCarClassById(car.classId).tier; },
  bestTier() { return Math.max(...G.cars.map(c => BOT.tierOf(c))); },
  champsFor(car) {
    return CHAMPIONSHIPS.filter(c => !c.pathway && c.allowedClasses.includes(car.classId)
      && G.reputation >= c.repRequired && checkChampionshipPrerequisite(c));
  },
  nextFee(car) { const cs = BOT.champsFor(car); return cs.length ? Math.max(...cs.map(c => c.entryFee)) : 0; },
  // Money to keep in reserve for the next progression purchase
  savingsGoal() {
    const next = CAR_CLASSES.filter(c => !c.pathway && G.reputation >= c.repRequired && c.tier > BOT.bestTier())
      .sort((a, b) => a.tier - b.tier)[0];
    let goal = next ? next.baseCost : 0;
    const ng = getGarageNextUpgrade(G.garageLevel);
    if (G.cars.length >= getGarageSlots(G.garageLevel) && ng && G.reputation >= ng.repRequired) goal += ng.cost;
    return goal;
  },
  canMajor() {
    return CHAMPIONSHIPS.some(c => ['imsa_weathertech', 'elms', 'fia_wec'].includes(c.id)
      && G.reputation >= c.repRequired && checkChampionshipPrerequisite(c)
      && G.cars.some(car => c.allowedClasses.includes(car.classId)));
  },
  step() {
    while (G.drivers.length < G.cars.length) scoutDriver('C');
    // Highest-tier cars get licensed drivers first, taking them from lower-tier cars
    [...G.cars].sort((a, b) => BOT.tierOf(b) - BOT.tierOf(a)).forEach(car => {
      if (car.driverId) return;
      const pool = G.drivers
        .filter(d => !d.carId || BOT.tierOf(G.cars.find(c => c.id === d.carId)) < BOT.tierOf(car))
        .sort((a, b) => (a.carId ? 1 : 0) - (b.carId ? 1 : 0) || b.pace - a.pace);
      for (const d of pool) if (assignDriver(d.id, car.id).ok) break;
    });
    // Sponsors: best of a single roll whose target is reachable
    for (let i = 0; i < getSponsorSlotsUnlocked(); i++) {
      if (G.sponsors[i]) continue;
      const opts = generateSponsorOptions().filter(o => o.tier !== 'international' || BOT.canMajor())
        .sort((a, b) => b.incomePerSec - a.incomePerSec);
      if (opts[0]) signSponsor(i, opts[0]);
    }
    // Garage expansion when full
    const ng = getGarageNextUpgrade(G.garageLevel);
    if (ng && G.cars.length >= getGarageSlots(G.garageLevel)) upgradeGarage();
    // Buy the highest affordable class, max 2 per class
    if (G.cars.length < getGarageSlots(G.garageLevel)) {
      const cls = CAR_CLASSES.filter(c => !c.pathway && G.reputation >= c.repRequired && G.money >= c.baseCost
        && G.cars.filter(x => x.classId === c.id).length < Math.min(c.maxOwned, 2))
        .sort((a, b) => b.tier - a.tier)[0];
      if (cls && cls.tier >= BOT.bestTier() - 1) buyCar(cls.id);
    }
    // Enter the most expensive available series
    G.cars.forEach(car => {
      if (car.championshipId || !car.driverId) return;
      const c = BOT.champsFor(car).filter(c => G.money >= c.entryFee).sort((a, b) => b.entryFee - a.entryFee)[0];
      if (c) enterChampionship(c.id, car.id);
    });
    // Spend surplus on the cheapest upgrade
    for (let k = 0; k < 50; k++) {
      let best = null;
      G.cars.forEach(car => UPGRADE_ORDER.forEach(u => {
        if (isUpgradeMaxed(car, u)) return;
        const cost = getEffectiveUpgradeCost(u, car.upgrades[u]);
        if (!best || cost < best.cost) best = { car, u, cost };
      }));
      const reserve = Math.max(0, ...G.cars.map(c => BOT.nextFee(c))) + BOT.savingsGoal();
      if (!best || G.money - best.cost < reserve) break;
      buyUpgrade(best.car.id, best.u);
    }
  },
};
`);

let lastSeason = 1;
let lastEarned = 0;
for (let s = 1; s <= HOURS * 3600; s++) {
  g.tickFor(1);
  if (s % 5 === 0) g.run('BOT.step()');

  // Seasons end on their own; log each one
  const season = g.run('G.season');
  if (season !== lastSeason) {
    lastSeason = season;
    const sum = g.run(`({ m: Math.round(G.money), rep: G.reputation, res: (G.lastSeasonSummary.results || []).map(r => r.classId + ' P' + r.finalPosition).join(' '),
      lic: G.drivers.map(d => d.licenses.join('/')).join(' | ') })`);
    console.log(`${fmtTime()}  -- season ${season - 1} ended: $${sum.m.toLocaleString('en')} REP ${sum.rep} | ${sum.res} | licenses ${sum.lic}`);
  }
  if (s % 3600 === 0) {
    const e = g.run('G.totalEarned'), sp = g.run('Math.round(calcTotalIncomePerSec())');
    console.log(`${fmtTime()}  earned this hour $${Math.round(e - lastEarned).toLocaleString('en')} (sponsors $${sp}/s)`);
    lastEarned = e;
  }

  const st2 = g.run(`({ cars: G.cars.map(c => c.classId), comp: Object.keys(G.champCompletions), garage: G.garageLevel,
    idle: G.cars.filter(c => !c.driverId).map(c => c.classId) })`);
  st2.cars.forEach(c => milestone('car:' + c, `bought first ${c}`));
  st2.comp.forEach(c => milestone('champ:' + c, `completed ${c}`));
  milestone('garage:' + st2.garage, `garage level ${st2.garage}`);
  st2.idle.forEach(c => milestone(`idle:${c}:${Math.floor(s / 3600)}`, `  ${c} car idle: no licensed driver`));
}
console.log('FINAL', JSON.stringify(g.run(`({ money: Math.round(G.money), rep: G.reputation, season: G.season,
  sponsors: G.sponsors.filter(Boolean).map(s => s.tier + ':' + s.incomePerSec) })`)));
