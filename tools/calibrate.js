// Championship outcome table: final position / titles for driver tiers and upgrade levels.
// Run: node tools/calibrate.js [champId=gt4_regional] [classId=GT4]
const { createGame } = require('./harness');
const champId = process.argv[2] || 'gt4_regional';
const classId = process.argv[3] || 'GT4';
const RUNS = 40;
const g = createGame({ seed: 7 });
console.log(`${champId} with ${classId} — ${RUNS} runs each`);
for (const tier of ['C', 'B', 'A', 'S']) {
  const row = [];
  for (const lv of [0, 2, 4, 6, 8, 10, 12, 14]) {
    const r = g.run(`(() => {
      G = createDefaultState(); G.money = 1e15;
      const car = G.cars[0]; car.classId = '${classId}';
      const d = scoutDriver('${tier}').driver;
      d.licenses = LICENSE_TIERS.map(l => l.id);
      assignDriver(d.id, car.id);
      UPGRADE_ORDER.forEach(u => car.upgrades[u] = ${lv});
      let fin = 0, titles = 0, prize = 0;
      for (let k = 0; k < ${RUNS}; k++) {
        G.reputation = 1e9; G.champCompletions = { gt4_regional: 1, gt_world_challenge: 1, imsa_weathertech: 1, formula_regional: 1, formula_3_championship: 1, formula_2_championship: 1 };
        const res = enterChampionship('${champId}', car.id);
        if (!res.ok) return { err: res.msg };
        const e = G.activeChampionships[0];
        while (!e._completed) { runChampionshipRound(e); if (e.currentRound >= e.maxRounds) finishChampionship(e); }
        G.activeChampionships = [];
        const c = G.completedChampionships[G.completedChampionships.length - 1];
        fin += c.finalPosition; titles += c.finalPosition === 1; prize += c.prizeEarned;
      }
      return { rating: Math.round(calcCarRating(car)), fin: (fin / ${RUNS}).toFixed(1), titles, prize: Math.round(prize / ${RUNS}) };
    })()`);
    if (r.err) { console.log(r.err); process.exit(1); }
    row.push(`lv${String(lv).padEnd(2)} ★${String(r.rating).padStart(3)} P${r.fin.padStart(4)} ${String(Math.round(r.titles / RUNS * 100)).padStart(3)}%`);
  }
  console.log(tier, row.join(' | '));
}
