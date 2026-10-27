// Balance simulation: a bot plays the game headlessly on a fake clock and prints
// when it hits progression milestones.
// Run: node tools/sim.js [hours=12] [seed=1] [--prestige]
const { createGame } = require('./harness');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const HOURS = +(args[0] || 12);
const SEED = +(args[1] || 1);
const PRESTIGE = process.argv.includes('--prestige');
const g = createGame({ seed: SEED });
g.run('_setupNewGame()');
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
  MARGIN: 1.2,   // aim for this much rating over the field average
  tierOf(car) { return getCarClassById(car.classId).tier; },
  champsFor(car) {
    return CHAMPIONSHIPS.filter(c => c.allowedClasses.includes(car.classId)
      && (!c.pathway || isSingleSeaterUnlocked())
      && G.reputation >= c.repRequired && checkChampionshipPrerequisite(c));
  },
  // Hardest series the car can be competitive in, else the easiest one
  pickSeries(car) {
    const cs = BOT.champsFor(car).sort((a, b) => getFieldStrength(a, car.classId) - getFieldStrength(b, car.classId));
    if (!cs.length) return null;
    const ok = cs.filter(c => calcCarRating(car, c.format) >= getFieldStrength(c, car.classId) * 1.05);
    return ok.length ? ok[ok.length - 1] : cs[0];
  },
  // Rating the car should reach for the hardest series open to it
  targetRating(car) {
    const cs = BOT.champsFor(car);
    if (!cs.length) return 0;
    return cs.reduce((m, c) => Math.max(m, getFieldStrength(c, car.classId)), 0) * BOT.MARGIN;
  },
  nextClass() {
    const best = Math.max(...G.cars.map(c => BOT.tierOf(c)));
    return CAR_CLASSES.filter(c => !c.pathway && c.tier === best + 1 && G.reputation >= c.repRequired)[0] || null;
  },
  licensedDriverFor(classId) {
    const need = CLASS_LICENSE_REQUIREMENT[classId];
    return G.drivers.find(d => d.licenses.includes(need));
  },
  step() {
    // Next class: buy once affordable, scouting a licensed driver if needed and making room
    const next = BOT.nextClass();
    if (next) {
      const scoutTier = { GT3: 'B', LMP3: 'A', LMP2: 'S' }[next.id];
      const haveDriver = BOT.licensedDriverFor(next.id);
      const scoutCost = haveDriver ? 0 : (scoutTier ? DRIVER_TIERS[scoutTier].scoutCost : Infinity);
      if (G.money >= next.baseCost * 1.3 + scoutCost) {
        if (G.cars.length >= getGarageSlots(G.garageLevel) && !upgradeGarage().ok) {
          const weakest = G.cars.filter(c => !c.championshipId).sort((a, b) => BOT.tierOf(a) - BOT.tierOf(b))[0];
          if (weakest && BOT.tierOf(weakest) < next.tier) sellCar(weakest.id);
        }
        if (!haveDriver && scoutTier) scoutDriver(scoutTier);
        buyCar(next.id);
      }
    }
    // Drivers: best licensed driver goes to the highest-tier cars
    [...G.cars].sort((a, b) => BOT.tierOf(b) - BOT.tierOf(a)).forEach(car => {
      const cur = car.driverId && G.drivers.find(d => d.id === car.driverId);
      const pool = G.drivers.filter(d => d !== cur
        && (!d.carId || BOT.tierOf(G.cars.find(c => c.id === d.carId)) < BOT.tierOf(car))
        && d.licenses.includes(CLASS_LICENSE_REQUIREMENT[car.classId]))
        .sort((a, b) => calcDriverSkill(b, 'sprint') - calcDriverSkill(a, 'sprint'));
      if (pool[0] && (!cur || calcDriverSkill(pool[0], 'sprint') > calcDriverSkill(cur, 'sprint') + 5)) {
        assignDriver(pool[0].id, car.id);   // the lower car gets a fill-in driver below
      }
    });
    // Empty GT4s get a free club driver
    G.cars.forEach(car => {
      if (car.driverId) return;
      const free = G.drivers.find(d => !d.carId && d.licenses.includes(CLASS_LICENSE_REQUIREMENT[car.classId]));
      if (free) assignDriver(free.id, car.id);
      else {
        const tier = { GT4: 'C', GT3: 'B', LMP3: 'A', LMP2: 'S', HYPERCAR: 'S' }[car.classId];
        if (tier && G.money >= DRIVER_TIERS[tier].scoutCost * 2) { const r = scoutDriver(tier); if (r.ok) assignDriver(r.driver.id, car.id); }
      }
    });
    // A second GT4 early on for more prize money and LP
    if (G.cars.length < getGarageSlots(G.garageLevel) && G.cars.filter(c => c.classId === 'GT4').length < 2 && G.money > 30000) buyCar('GT4');
    if (G.cars.length >= getGarageSlots(G.garageLevel) && G.cars.length < 2) upgradeGarage();
    // Sponsors: highest income among this season's offers
    for (let i = 0; i < getSponsorSlotsUnlocked(); i++) {
      if (G.sponsors[i]) continue;
      const best = [...getSponsorOffers()].sort((a, b) => b.incomePerSec - a.incomePerSec)[0];
      if (best) signSponsorOffer(i, best.id);
    }
    // Upgrades: most rating per dollar, weighted by how far the car is below its target
    const reserve = (next ? next.baseCost * 0.5 : 0)
      + Math.max(0, ...G.cars.map(c => { const s = BOT.pickSeries(c); return s ? s.entryFee : 0; }));
    for (let k = 0; k < 100; k++) {
      let best = null;
      G.cars.forEach(car => {
        const deficit = BOT.targetRating(car) - calcCarRating(car);
        if (deficit <= 0) return;
        UPGRADE_ORDER.forEach(u => {
          if (isUpgradeMaxed(car, u)) return;
          const cost = getEffectiveUpgradeCost(u, car.upgrades[u], car.classId);
          const base = getCarClassById(car.classId).baseRating / 100;
          const gain = u === 'reliability' ? (car.upgrades.reliability < 6 ? 3 * base : 0.5 * base) : UPGRADES[u].ratingPctPerLevel * base;
          const score = gain / cost * deficit;
          if (!best || score > best.score) best = { car, u, cost, score };
        });
      });
      if (!best || G.money - best.cost < reserve) break;
      buyUpgrade(best.car.id, best.u);
    }
    // Surplus beyond the reserve goes into the cheapest HQ facility
    if (isHQUnlocked()) {
      for (let k = 0; k < 20; k++) {
        const f = HQ_FACILITIES.filter(f => f.maxLevel === null || getHQLevel(f.id) < f.maxLevel)
          .sort((a, b) => getHQCost(a.id) - getHQCost(b.id))[0];
        if (!f || G.money - getHQCost(f.id) < reserve * 2) break;
        buyHQ(f.id);
      }
    }
    // Idle cars enter their best series; auto-renew switches to it once the car outgrows the old one
    G.cars.forEach(car => {
      const c = BOT.pickSeries(car);
      if (!c) return;
      if (!car.championshipId && car.driverId && G.money >= c.entryFee) enterChampionship(c.id, car.id);
      if (car.autoRenew && car.autoRenew !== c.id) car.autoRenew = c.id;
    });
  },
};
`);

let lastSeason = 1;
let lastEarned = 0;
for (let s = 1; s <= HOURS * 3600; s++) {
  g.tickFor(1);
  if (s % 10 === 0) g.run('BOT.step()');

  const season = g.run('G.season');
  if (season !== lastSeason) {
    lastSeason = season;
    const sum = g.run(`({ m: Math.round(G.money), rep: G.reputation, sp: Math.round(calcTotalIncomePerSec()),
      res: (G.lastSeasonSummary.results || []).map(r => r.classId + ' P' + r.finalPosition).join(' '),
      cars: G.cars.map(c => c.classId + '★' + Math.round(calcCarRating(c))).join(' '),
      hq: HQ_FACILITIES.map(f => getHQLevel(f.id)).join('/') })`);
    const earned = g.run('G.totalEarned');
    console.log(`${fmtTime()}  -- S${season - 1}: earned $${Math.round(earned - lastEarned).toLocaleString('en')} | bank $${sum.m.toLocaleString('en')} | REP ${sum.rep} | sponsors $${sum.sp}/s | HQ ${sum.hq} | ${sum.cars}`);
    console.log(`          results: ${sum.res}`);
    lastEarned = earned;
    if (PRESTIGE && g.run('calcPrestigePoints()') >= 150) {
      const r = g.run('doPrestige()');
      console.log(`${fmtTime()}  PRESTIGE +${r.ppGain} PP`);
      g.run(`['wind_tunnel', 'head_start', 'dev_token'].forEach(id => { while (buyPrestigeItem(id).ok); })`);
    }
  }

  if (s % 60 === 0) {
    const st = g.run(`({ cars: G.cars.map(c => c.classId),
      titles: G.completedChampionships.filter(c => c.finalPosition === 1).map(c => c.classId + ' ' + c.definitionId),
      lic: [...new Set(G.drivers.flatMap(d => d.licenses))], idle: G.cars.filter(c => !c.driverId).map(c => c.classId) })`);
    st.cars.forEach(c => milestone('car:' + c, `bought first ${c}`));
    st.titles.forEach(t => milestone('title:' + t, `first title: ${t}`));
    st.lic.forEach(l => milestone('lic:' + l, `license held: ${l}`));
    st.idle.forEach(c => milestone(`idle:${c}:${Math.floor(s / 1800)}`, `  ${c} car idle (no licensed driver)`));
  }
}
console.log('FINAL', JSON.stringify(g.run(`({ money: Math.round(G.money), rep: G.reputation, season: G.season, pp: G.prestigePoints,
  cars: G.cars.map(c => c.classId + ' ' + Object.values(c.upgrades).join('/')),
  sponsors: G.sponsors.filter(Boolean).map(s => s.tier + ':' + s.incomePerSec) })`)));
