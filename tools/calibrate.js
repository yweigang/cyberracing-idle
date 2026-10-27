// Championship outcome table: average final position / title rate by driver tier and
// pit crew level, with full setup knowledge and a full lineup of same-tier drivers.
// Each cell averages several scouted lineups, so it reflects the tier, not one roll.
// Run: node tools/calibrate.js [champId=gt4_regional] [classId=GT4]
const { createGame } = require('./harness');
const champId = process.argv[2] || 'gt4_regional';
const classId = process.argv[3] || 'GT4';
const LINEUPS = 8;
const RUNS = 8;
const g = createGame({ seed: 7 });
console.log(`${champId} with ${classId}: ${LINEUPS} lineups x ${RUNS} runs, setup maxed, preparation Lv 6`);
for (const tier of ['C', 'B', 'A', 'S']) {
  const row = [];
  for (const crew of [0, 4, 8, 12, 16, 20]) {
    const r = g.run(`(() => {
      let fin = 0, titles = 0, rating = 0;
      for (let l = 0; l < ${LINEUPS}; l++) {
        G = createDefaultState(); G.money = 1e15; G.pitCrew.level = ${crew}; G.prestige.prestigeCount = 1;
        const car = G.cars[0]; car.classId = '${classId}';
        car.upgrades.reliability = 6; car.setupChamps = 99;
        const def = getChampionshipById('${champId}');
        const size = getLineupSize(def);
        for (let i = 0; i < size; i++) {
          const d = scoutDriver('${tier}').driver;
          d.licenses = LICENSE_TIERS.map(t => t.id);
          assignDriver(d.id, car.id, 'co');
        }
        rating += calcCarRating(car, def.format, false, size);
        for (let k = 0; k < ${RUNS}; k++) {
          G.reputation = 1e9; G.champCompletions = { gt4_regional: 1, gt_world_challenge: 1, imsa_weathertech: 1, formula_regional: 1, formula_3_championship: 1, formula_2_championship: 1 };
          const res = enterChampionship('${champId}', car.id);
          if (!res.ok) return { err: res.msg };
          const e = G.activeChampionships[0];
          while (!e._completed) { runChampionshipRound(e); if (e.currentRound >= e.maxRounds) finishChampionship(e); }
          G.activeChampionships = [];
          const c = G.completedChampionships[G.completedChampionships.length - 1];
          fin += c.finalPosition; titles += c.finalPosition === 1;
        }
      }
      const n = ${LINEUPS} * ${RUNS};
      return { rating: Math.round(rating / ${LINEUPS}), fin: (fin / n).toFixed(1), titles: Math.round(titles / n * 100) };
    })()`);
    if (r.err) { console.log(r.err); process.exit(1); }
    row.push(`crew${String(crew).padEnd(2)} ★${String(r.rating).padStart(3)} P${r.fin.padStart(4)} ${String(r.titles).padStart(3)}%`);
  }
  console.log(tier, row.join(' | '));
}
