// Headless game-logic tests. Run: node tools/test.js
const { createGame } = require('./harness');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

// New game with money, two free drivers and the starting car
function setup(opts) {
  const g = createGame({ seed: 42, ...opts });
  g.run(`G.money = 1e9;`);
  const a = g.run(`scoutDriver('C').driver.id`);
  const b = g.run(`scoutDriver('C').driver.id`);
  const car = g.run(`G.cars[0].id`);
  return { g, a, b, car };
}

// Run a championship on a car to completion
function finishChamp(g, champId, carId) {
  const r = g.run(`enterChampionship('${champId}', '${carId}')`);
  assert(r.ok, 'enter failed: ' + r.msg);
  g.run(`setAutoRenew('${carId}', false)`);
  for (let i = 0; i < 200 && g.run(`G.activeChampionships.some(e => e.carId === '${carId}')`); i++) g.tickFor(10, 10);
  assert(!g.run(`G.activeChampionships.some(e => e.carId === '${carId}')`), 'championship did not finish');
}

const SEASON_SEC = g => g.run('SEASON_LENGTH_SEC');
const driver = (g, id) => g.run(`G.drivers.find(d => d.id === '${id}')`);

test('LP goes to the driver who completed the championship, not the current one', () => {
  const { g, a, b, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  finishChamp(g, 'gt4_regional', car);
  g.run(`assignDriver('${b}', '${car}')`);
  const res = g.run(`endSeason()`);
  assert(res.ok !== false, 'endSeason failed');
  assert(driver(g, a).licensePoints.GT3 > 0, 'A should earn GT3 LP');
  assert(driver(g, b).licensePoints.GT3 === 0, 'B should earn nothing');
});

test('Offline completion credits the driver who raced', () => {
  const { g, a, b, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}'); setAutoRenew('${car}', false); G.lastSave = Date.now();`);
  g.advance(20 * 60e3);
  g.run(`applyOfflineProgress()`);
  assert(g.run(`G.completedChampionships.length`) === 1, 'offline should complete championship');
  g.run(`assignDriver('${b}', '${car}'); endSeason();`);
  assert(driver(g, a).licensePoints.GT3 > 0 && driver(g, b).licensePoints.GT3 === 0, 'LP should go to A');
});

test('Drivers without the class license cannot be assigned', () => {
  const { g, a, car } = setup();
  g.run(`G.cars[0].classId = 'GT3'`);
  assert(g.run(`assignDriver('${a}', '${car}').ok`) === false, 'GT4-only driver must be blocked from GT3');
});

test('Save/load round-trips and migrates drivers without license data', () => {
  const { g } = setup();
  g.run(`G.drivers.forEach(d => { delete d.licenses; delete d.licensePoints; }); saveGame(); loadGame();`);
  assert(g.run(`G.drivers.every(d => d.licenses.includes('GT4') && d.licensePoints.F1 === 0)`), 'migration should add licenses');
});

test('Entering a championship requires a driver', () => {
  const { g, car } = setup();
  assert(g.run(`enterChampionship('gt4_regional', '${car}').ok`) === false, 'should need a driver');
});

test('A round produces a position, points, prize and standings', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}');`);
  const before = g.run('G.money');
  g.tickFor(61);
  const e = g.run('G.activeChampionships[0]');
  assert(e.currentRound === 1 && e.results.length === 1, 'one round should have run');
  const r = e.lastRound;
  assert(r.dnf || (r.pos >= 1 && r.pos <= 13), 'position in range');
  if (!r.dnf) assert(g.run('G.money') - before === r.prize && r.prize > 0, 'prize paid');
  const st = g.run('getStandings(G.activeChampionships[0])');
  assert(st.length === 13 && st.filter(x => x.isPlayer).length === 1, 'standings include 12 AI + player');
  assert(st.reduce((n, x) => n + x.points, 0) === 25 + 18 + 15 + 12 + 10 + 8 + 6 + 4 + 2 + 1, 'all points awarded once');
});

test('Better cars finish higher on average', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  const avg = lv => g.run(`(() => {
    UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = ${lv});
    let sum = 0;
    for (let k = 0; k < 20; k++) {
      enterChampionship('gt4_regional', G.cars[0].id);
      const e = G.activeChampionships[0];
      while (!e._completed) { runChampionshipRound(e); if (e.currentRound >= e.maxRounds) finishChampionship(e); }
      G.activeChampionships = [];
      sum += G.completedChampionships[G.completedChampionships.length - 1].finalPosition;
    }
    return sum / 20;
  })()`);
  const slow = avg(0), fast = avg(8);
  assert(fast < slow - 3, `expected lv8 (${fast}) well ahead of lv0 (${slow})`);
});

test('Completed championship records final position and pays standings bonus', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = 12);`);
  finishChamp(g, 'gt4_regional', car);
  const c = g.run('G.completedChampionships[0]');
  assert(c.finalPosition === 1, 'maxed car should win GT4 Cup, got P' + c.finalPosition);
  assert(c.prizeEarned > 2000 * 8 * 0.5, 'prize should include standings bonus');
});

test('Season ends automatically when the clock runs out', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  g.tickFor(SEASON_SEC(g) + 5, 5);
  assert(g.run('G.season') === 2, 'should be season 2, got ' + g.run('G.season'));
  assert(g.run('G.lastSeasonSummary.season') === 1, 'summary recorded');
  assert(g.run('getSeasonTimeLeft()') > SEASON_SEC(g) - 10, 'new season clock started');
});

test('Championships that would not finish before season end cannot be entered', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  g.tickFor(SEASON_SEC(g) - 5 * 60, 10);      // 5 minutes left, GT4 Cup needs 8
  const r = g.run(`enterChampionship('gt4_regional', '${car}')`);
  assert(!r.ok && /time/.test(r.msg), 'should be rejected for time');
});

test('Auto-renew keeps a car racing across championships and seasons', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}')`);
  g.tickFor(SEASON_SEC(g) + 20 * 60, 5);
  const done = g.run('G.completedChampionships.length');
  assert(done >= 8, 'expected 7 per season plus more in season 2, got ' + done);
  assert(g.run(`G.activeChampionships.some(e => e.carId === '${car}')`), 'still racing in season 2');
});

test('Offline progress replays seasons and auto-renewals', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}'); G.lastSave = Date.now();`);
  g.advance(3 * 3600e3);
  g.run('applyOfflineProgress()');
  assert(g.run('G.season') === 4, 'three seasons should pass, season=' + g.run('G.season'));
  assert(g.run('G.completedChampionships.length') >= 20, 'auto-renewed championships while offline');
});

test('Two GT4 Cup titles earn the GT3 license', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = 12);`);
  finishChamp(g, 'gt4_regional', car);
  assert(driver(g, a).licensePoints.GT3 === 25, 'title pays 25 GT3 LP, got ' + driver(g, a).licensePoints.GT3);
  assert(!driver(g, a).licenses.includes('GT3'), 'one title is not enough');
  finishChamp(g, 'gt4_regional', car);
  assert(driver(g, a).licenses.includes('GT3'), 'two titles grant GT3');
});

test('Lower finishes earn a share of the LP', () => {
  const { g } = setup();
  const pts = g.run(`(() => { const d = scoutDriver('C').driver; return awardChampionshipLP(d, 'GT4', 6, null).GT3; })()`);
  assert(pts === 5, 'P6 earns 20% of 25 GT3 LP, got ' + pts);
});

test('Higher-tier scouts arrive with licenses and earn no LP for them', () => {
  const { g } = setup();
  const lic = g.run(`scoutDriver('A').driver.licenses`);
  assert(['GT3', 'LMP3'].every(l => lic.includes(l)) && !lic.includes('LMP2'), 'A tier holds up to LMP3: ' + lic);
  const earned = g.run(`awardChampionshipLP(G.drivers[G.drivers.length - 1], 'GT4', 1, null)`);
  assert(!('GT3' in earned) && earned.LMP3 === undefined && earned.LMP2 > 0, 'no LP toward held licenses');
});

test('Sponsor offers are fixed for the season and refresh next season', () => {
  const { g } = setup();
  const first = g.run('getSponsorOffers().map(o => o.id).join()');
  assert(first === g.run('getSponsorOffers().map(o => o.id).join()'), 'same offers within a season');
  const id = g.run('getSponsorOffers()[0].id');
  assert(g.run(`signSponsorOffer(0, '${id}').ok`), 'sign works');
  assert(g.run('getSponsorOffers().length') === 3, 'signed offer is removed');
  g.run('endSeason()');
  assert(g.run('getSponsorOffers().length') === 4 && g.run('getSponsorOffers().map(o => o.id).join()') !== first, 'fresh offers next season');
});

test('Sponsor targets track this season and end the contract when missed', () => {
  const { g, a, car } = setup();
  g.run(`G.sponsors[0] = Object.assign(generateSponsor('regional'), { target: { type: 'round_podiums', count: 3 }, seasonsRemaining: 2 })`);
  assert(g.run('getSponsorTargetProgress(G.sponsors[0].target).have') === 0, 'no podiums yet');
  g.run(`assignDriver('${a}', '${car}'); UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = 12);`);
  finishChamp(g, 'gt4_regional', car);
  assert(g.run('getSponsorTargetProgress(G.sponsors[0].target).have') >= 3, 'podiums counted from results');
  const m = g.run('G.money');
  g.run('endSeason()');
  assert(g.run('G.sponsors[0] && G.sponsors[0].seasonsRemaining') === 1, 'contract continues');
  assert(g.run('G.money') - m >= 5000, 'season bonus paid');
  g.run('endSeason()');
  assert(g.run('G.sponsors[0]') === null, 'missed target ends contract');
});

test('Sponsor tiers open up with results', () => {
  const { g, a, car } = setup();
  assert(g.run('getAvailableSponsorTiers().join()') === 'regional', 'only regional at start');
  g.run(`assignDriver('${a}', '${car}'); UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = 12);`);
  finishChamp(g, 'gt4_regional', car);
  assert(g.run('getAvailableSponsorTiers().includes("national")'), 'podium finish unlocks national');
});

test('Selling a car refunds part of its value and frees the slot', () => {
  const { g, a, car } = setup();
  g.run(`G.reputation = 1000; upgradeGarage(); buyCar('GT3'); assignDriver('${a}', '${car}');`);
  g.run(`G.cars[0].upgrades.engine = 2`);
  const value = g.run(`getCarSellValue(G.cars[0])`);
  assert(value === Math.floor(10000 * 0.5 + (1000 + 1800) * 0.3), 'value = 50% price + 30% upgrades, got ' + value);
  const m = g.run('G.money');
  assert(g.run(`sellCar('${car}').ok`), 'sell works');
  assert(g.run('G.money') - m === value && g.run('G.cars.length') === 1, 'refund paid and car removed');
  assert(g.run(`G.drivers.find(d => d.id === '${a}').carId`) === null, 'driver unassigned');
  assert(g.run(`sellCar(G.cars[0].id).ok`) === false, 'cannot sell the last car');
});

test('Prestige pays PP for results and resets upgrades but keeps drivers', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = 12);`);
  assert(!g.run('canPrestige()'), 'nothing earned yet');
  for (let i = 0; i < 10; i++) {
    if (!g.run("fitsInSeason(getChampionshipById('gt4_regional'))")) g.run('endSeason()');
    finishChamp(g, 'gt4_regional', car);
  }
  const pp = g.run('calcPrestigePoints()');
  assert(pp >= 20, 'ten GT4 titles should be worth at least 20 PP, got ' + pp);
  const res = g.run('doPrestige()');
  assert(res.ok && g.run('G.prestigePoints') === pp, 'PP granted');
  assert(g.run('G.cars[0].upgrades.engine') === 0 && g.run('G.cars[0].upgrades.reliability') === 2, 'upgrades reset, 2 reliability kept');
  assert(g.run('G.cars.length') === 1 && g.run('G.cars[0].classId') === 'GT4', 'back to one GT4');
  assert(g.run('G.cars[0].driverId') === a && g.run('G.money') === 5000, 'driver back in the GT4, $5k');
  assert(g.run('G.sponsors.every(s => s === null)'), 'sponsor contracts end');
  assert(g.run('calcPrestigePoints()') === 0 && g.run('isSingleSeaterUnlocked()'), 'PP counter restarts; single-seaters unlocked');
});

test('Prestige shop items apply their effects', () => {
  const { g } = setup();
  g.run('G.prestigePoints = 10000');
  const before = g.run(`calcCarRating(G.cars[0])`);
  ['head_start', 'wind_tunnel', 'dev_token', 'talent_academy'].forEach(id => assert(g.run(`buyPrestigeItem('${id}').ok`), id));
  assert(g.run(`calcCarRating(G.cars[0])`) > before, 'wind tunnel raises rating');
  assert(g.run(`(() => { const m = G.money; scoutDriver('B'); return m - G.money; })()`) === 5000, 'scouting is half price');
  g.run(`G.reputation = 1000; G.money = 1e9; upgradeGarage(); upgradeGarage(); buyCar('GT3'); buyCar('GT4');
    G.cars[1].upgrades.engine = 9; G.prestige.lastPrestigeAt = 0; G.reputation = 50000; doPrestige();`);
  assert(g.run('G.cars.map(c => c.classId).sort().join()') === 'GT3,GT4', 'dev token keeps the GT3, plus a GT4');
  assert(g.run(`G.cars.find(c => c.classId === 'GT3').upgrades.engine`) === 1, 'kept car resets to head-start level');
  assert(g.run(`buyPrestigeItem('legend_contract').ok`) && g.run(`G.drivers.some(d => d.tier === 'L')`), 'legend signed');
  g.run('endSeason()');
  assert(!g.run(`G.drivers.some(d => d.tier === 'L')`), 'legend leaves at season end');
});

test('Team HQ is locked until 8k REP, then levels apply their effects', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  assert(!g.run(`buyHQ('simulator').ok`), 'locked at 0 REP');
  g.run('G.reputation = 8000');
  const rating = g.run('calcCarRating(G.cars[0])');
  const upg = g.run(`getEffectiveUpgradeCost('engine', 0, 'GT4')`);
  const spons = g.run('calcSponsorIncomePerSec()');
  const m = g.run('G.money');
  ['simulator', 'composites', 'hospitality'].forEach(id => assert(g.run(`buyHQ('${id}').ok`), id));
  assert(m - g.run('G.money') === 2000000 + 1500000 + 1000000, 'level 1 costs paid');
  assert(g.run(`getHQCost('simulator')`) === 3200000, 'cost grows x1.6');
  assert(Math.abs(g.run('calcCarRating(G.cars[0])') / rating - 1.015) < 1e-9, 'simulator +1.5% rating');
  assert(g.run(`getEffectiveUpgradeCost('engine', 0, 'GT4')`) === Math.floor(upg * 0.97), 'composites -3% upgrade cost');
  assert(Math.abs(g.run('calcSponsorIncomePerSec()') / spons - 1.05) < 1e-9, 'hospitality +5% sponsors');
});

test('HQ levels pay PP on prestige and reset', () => {
  const { g } = setup();
  g.run(`G.reputation = 8000; G.prestige.repAtLastPrestige = 8000; buyHQ('simulator'); buyHQ('simulator'); buyHQ('hospitality');`);
  assert(g.run('calcPrestigePoints()') === 3, '3 HQ levels = 3 PP');
  g.run('G.hq.composites = 17; doPrestige()');
  assert(g.run('G.prestigePoints') === 20 && g.run('getHQLevel("simulator")') === 0, 'PP paid and HQ reset');
});

test('Targeted sponsors hold back part of their income until the target is met', () => {
  const { g, a, car } = setup();
  g.run(`G.sponsors[0] = Object.assign(generateSponsor('regional'), { incomePerSec: 100, target: { type: 'round_podiums', count: 1 }, seasonsRemaining: 3 })`);
  const m = g.run('G.money');
  g.run('accrueSponsorIncome(100)');
  const share = g.run('SPONSOR_UPFRONT_SHARE');
  assert(Math.round(g.run('G.money') - m) === Math.round((8 + 100 * share) * 100), 'family full + upfront share paid now');
  assert(Math.round(g.run('G.sponsors[0].heldBack')) === Math.round(100 * (1 - share) * 100), 'rest held back');
  g.run(`assignDriver('${a}', '${car}'); UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = 12);`);
  finishChamp(g, 'gt4_regional', car);
  const held = g.run('G.sponsors[0].heldBack'), m2 = g.run('G.money');
  g.run('evaluateSponsorsAtSeasonEnd()');
  assert(Math.round(g.run('G.money') - m2) >= Math.round(held) + 5000, 'held income + bonus paid when target met');
  assert(g.run('G.sponsors[0].heldBack') === 0, 'held amount resets');
});

test('A missed target forfeits the held-back income', () => {
  const { g } = setup();
  g.run(`G.sponsors[0] = Object.assign(generateSponsor('regional'), { incomePerSec: 100, target: { type: 'round_wins', count: 5 } }); accrueSponsorIncome(100);`);
  const m = g.run('G.money');
  g.run('evaluateSponsorsAtSeasonEnd()');
  assert(g.run('G.money') === m && g.run('G.sponsors[0]') === null, 'nothing paid and contract ended');
});

test('Sponsor tiers start over after a prestige', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); UPGRADE_ORDER.forEach(u => G.cars[0].upgrades[u] = 12);`);
  finishChamp(g, 'gt4_regional', car);
  assert(g.run('getAvailableSponsorTiers().includes("national")'), 'national after a podium');
  g.advance(1000);
  g.run('G.reputation = 50000; doPrestige()');
  assert(g.run('getAvailableSponsorTiers().join()') === 'regional', 'back to regional after the reset');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('PASS', t.name); }
  catch (e) { failed++; console.log('FAIL', t.name, '\n    ', e.message); }
}
console.log(failed ? `${failed}/${tests.length} FAILED` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
