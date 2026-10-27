// Headless game-logic tests. Run: node tools/test.js
const { createGame } = require('./harness');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

// New game with money, two free drivers and the starting car
function setup(opts) {
  const g = createGame({ seed: 42, ...opts });
  g.run(`G.money = 1e9;`);
  const a = g.run(`(G.nextFreeScoutAt = 0, scoutDriver('C')).driver.id`);
  const b = g.run(`(G.nextFreeScoutAt = 0, scoutDriver('C')).driver.id`);
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

test('Better drivers finish higher on average', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  const avg = skill => g.run(`(() => {
    G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = ${skill}));
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
  const slow = avg(10), fast = avg(40);
  assert(fast < slow - 3, `expected skill 40 (${fast}) well ahead of skill 10 (${slow})`);
});

test('Completed championship records final position and pays standings bonus', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
  finishChamp(g, 'gt4_regional', car);
  const c = g.run('G.completedChampionships[0]');
  assert(c.finalPosition === 1, 'maxed car should win GT4 Cup, got P' + c.finalPosition);
  assert(c.prizeEarned > 2000 * 8 * 0.5, 'prize should include standings bonus');
});

test('Season ends automatically when the clock runs out', () => {
  const { g } = setup();   // no driver seated, so nothing could race and the season runs its full length
  g.tickFor(SEASON_SEC(g) + 5, 5);
  assert(g.run('G.season') === 2, 'should be season 2, got ' + g.run('G.season'));
  assert(g.run('G.lastSeasonSummary.season') === 1, 'summary recorded');
  assert(g.run('getSeasonTimeLeft()') > SEASON_SEC(g) - 10, 'new season clock started');
});

test('Championships that would not finish before season end cannot be entered', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  // 5 minutes left, GT4 Cup needs 8
  const r = g.run(`enterChampionship('gt4_regional', '${car}', getSeasonEndTime() - 5 * 60 * 1000)`);
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
  g.run(`assignDriver('${a}', '${car}'); G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
  finishChamp(g, 'gt4_regional', car);
  assert(driver(g, a).licensePoints.GT3 === 25, 'title pays 25 GT3 LP, got ' + driver(g, a).licensePoints.GT3);
  assert(!driver(g, a).licenses.includes('GT3'), 'one title is not enough');
  finishChamp(g, 'gt4_regional', car);
  assert(driver(g, a).licenses.includes('GT3'), 'two titles grant GT3');
});

test('Lower finishes earn a share of the LP', () => {
  const { g } = setup();
  const pts = g.run(`(() => { const d = (G.nextFreeScoutAt = 0, scoutDriver('C')).driver; return awardChampionshipLP(d, 'GT4', 6, null).GT3; })()`);
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
  g.run(`assignDriver('${a}', '${car}'); G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
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
  g.run(`assignDriver('${a}', '${car}'); G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
  finishChamp(g, 'gt4_regional', car);
  assert(g.run('getAvailableSponsorTiers().includes("national")'), 'podium finish unlocks national');
});

test('Selling a car refunds part of its value and frees the slot', () => {
  const { g, a, car } = setup();
  g.run(`G.reputation = 1000; upgradeGarage(); buyCar('GT3'); assignDriver('${a}', '${car}');`);
  g.run(`G.cars[0].upgrades.reliability = 2`);
  const value = g.run(`getCarSellValue(G.cars[0])`);
  assert(value === Math.floor(10000 * 0.5 + (1200 + 2280) * 0.3), 'value = 50% price + 30% preparation, got ' + value);
  const m = g.run('G.money');
  assert(g.run(`sellCar('${car}').ok`), 'sell works');
  assert(g.run('G.money') - m === value && g.run('G.cars.length') === 1, 'refund paid and car removed');
  assert(g.run(`G.drivers.find(d => d.id === '${a}').carId`) === null, 'driver unassigned');
  g.run('G.money = 0');
  assert(g.run(`sellCar(G.cars[0].id).ok`) && g.run('G.cars.length') === 0, 'last GT3 sells: its $25k covers a restart');
  assert(g.run('G.money') === 25000, 'sale value received');
});

test('The last car cannot be sold if the team could not restart', () => {
  const { g } = setup();
  assert(g.run(`getRestartCost()`) === 15000, 'cheapest restart: GT4 $10k + GT4 Cup $5k');
  g.run('G.money = 9999');
  assert(!g.run(`sellCar(G.cars[0].id).ok`) && g.run('G.cars.length') === 1, '$5k sale + $9,999 is not enough');
  g.run('G.money = 10000');
  assert(g.run(`sellCar(G.cars[0].id).ok`) && g.run('G.cars.length') === 0, 'exactly enough is allowed');
  assert(g.run(`buyCar('GT4').ok`) && g.run('G.money') === 5000, 'a new GT4 can be bought, with the entry fee left');
});

test('Prestige pays PP for results and resets upgrades but keeps drivers', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
  g.run('G.cars[0].upgrades.reliability = 5');
  assert(!g.run('canPrestige()'), 'nothing earned yet');
  for (let i = 0; i < 10; i++) {
    if (!g.run("fitsInSeason(getChampionshipById('gt4_regional'))")) g.run('endSeason()');
    finishChamp(g, 'gt4_regional', car);
  }
  const pp = g.run('calcPrestigePoints()');
  assert(pp >= 20, 'ten GT4 titles should be worth at least 20 PP, got ' + pp);
  const res = g.run('doPrestige()');
  assert(res.ok && g.run('G.prestigePoints') === pp, 'PP granted');
  assert(g.run('G.cars[0].upgrades.reliability') === 2 && g.run('G.cars[0].setupChamps') === 0, '2 preparation levels kept, setup reset');
  assert(g.run('G.pitCrew.level') === 0 && g.run('G.pitCrew.size') === 1, 'pit crew rebuilt');
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
    G.cars[1].upgrades.reliability = 9; G.pitCrew.level = 15; G.prestige.lastPrestigeAt = 0; G.reputation = 50000; doPrestige();`);
  assert(g.run('G.cars.map(c => c.classId).sort().join()') === 'GT3,GT4', 'dev token keeps the GT3, plus a GT4');
  assert(g.run(`G.cars.find(c => c.classId === 'GT3').upgrades.reliability`) === 2, 'kept car keeps 2 preparation levels');
  assert(g.run('G.pitCrew.level') === 2, 'head start rebuilds the crew at level 2');
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
  const upg = g.run(`getEffectiveUpgradeCost('reliability', 0, 'GT4')`);
  const crew = g.run('getPitCrewLevelCost()');
  const spons = g.run('calcSponsorIncomePerSec()');
  const m = g.run('G.money');
  ['simulator', 'composites', 'hospitality'].forEach(id => assert(g.run(`buyHQ('${id}').ok`), id));
  assert(m - g.run('G.money') === 2000000 + 1500000 + 1000000, 'level 1 costs paid');
  assert(g.run(`getHQCost('simulator')`) === 3200000, 'cost grows x1.6');
  assert(Math.abs(g.run('calcCarRating(G.cars[0])') / rating - 1.015) < 1e-9, 'simulator +1.5% rating');
  assert(g.run(`getEffectiveUpgradeCost('reliability', 0, 'GT4')`) === Math.floor(upg * 0.97), 'training centre -3% preparation cost');
  assert(g.run('getPitCrewLevelCost()') === Math.floor(crew * 0.97), 'training centre -3% crew cost');
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
  g.run(`assignDriver('${a}', '${car}'); G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
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
  g.run(`assignDriver('${a}', '${car}'); G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
  finishChamp(g, 'gt4_regional', car);
  assert(g.run('getAvailableSponsorTiers().includes("national")'), 'national after a podium');
  g.advance(1000);
  g.run('G.reputation = 50000; doPrestige()');
  assert(g.run('getAvailableSponsorTiers().join()') === 'regional', 'back to regional after the reset');
});

// GT3 car with three identical GT3-licensed drivers, ready for IMSA/ELMS
function lineupSetup() {
  const g = createGame({ seed: 42 });
  g.run(`G.money = 1e9; G.reputation = 1e6; G.champCompletions = { gt4_regional: 1, gt_world_challenge: 1 };
    G.cars[0].classId = 'GT3';
    for (let i = 0; i < 4; i++) {
      const d = scoutDriver('B').driver;
      Object.assign(d, { pace: 30, consistency: 30, tyreManagement: 30, rainSkill: 30, fitness: 50 });
    }`);
  const ids = g.run('G.drivers.map(d => d.id)');
  return { g, ids, car: g.run('G.cars[0].id') };
}

test('Drivers fill lead, co-driver and reserve seats, up to four per car', () => {
  const { g, ids, car } = lineupSetup();
  assert(g.run(`assignDriver('${ids[0]}', '${car}', 'co').ok`), 'first driver takes the empty lead seat');
  g.run(`assignDriver('${ids[1]}', '${car}', 'co'); assignDriver('${ids[2]}', '${car}', 'co');`);
  assert(g.run('G.cars[0].driverId') === ids[0] && g.run('G.cars[0].coDriverIds.join()') === ids[1] + ',' + ids[2], 'lead + 2 co-drivers');
  assert(g.run(`assignDriver('${ids[3]}', '${car}', 'co').ok`), 'a fourth driver joins as reserve');
  assert(g.run(`(() => { const c = G.cars[0]; c.classId = 'GT4'; const n = getCarSeatLimit(c); c.classId = 'GT3'; return n; })()`) === 2, 'sprint-only GT4 seats lead + one reserve');
  assert(g.run(`isReserveDriver(G.drivers.find(d => d.id === '${ids[3]}'))`), 'fourth seat is a reserve');
  g.run(`G.drivers.push(Object.assign({}, G.drivers[0], { id: 'driver_x', carId: null }))`);
  assert(!g.run(`assignDriver('driver_x', '${car}', 'co').ok`), 'a fifth driver does not fit');
  g.run(`unassignDriver('${ids[3]}')`);
  g.run(`assignDriver('${ids[2]}', '${car}', 'lead')`);
  assert(g.run('G.cars[0].driverId') === ids[2] && g.run('getCarLineup(G.cars[0]).length') === 3, 'co-driver promoted, old lead stays');
  g.run(`unassignDriver('${ids[2]}')`);
  assert(g.run('G.cars[0].driverId') === ids[0] && g.run(`G.drivers.find(d => d.id === '${ids[2]}').carId`) === null, 'next driver takes the lead when the lead leaves');
});

test('A short endurance lineup races slower and retires more often', () => {
  const { g, ids, car } = lineupSetup();
  g.run(`assignDriver('${ids[0]}', '${car}')`);
  const solo = g.run(`[calcCarRating(G.cars[0], 'endurance', false, 3), calcDNFChance(G.cars[0], 'endurance', 3)]`);
  assert(Math.abs(g.run(`calcCarRating(G.cars[0], 'sprint')`) - g.run(`calcCarRating(G.cars[0], 'sprint', false, 1)`)) < 1e-9, 'sprint uses the lead only');
  g.run(`assignDriver('${ids[1]}', '${car}', 'co'); assignDriver('${ids[2]}', '${car}', 'co');`);
  const full = g.run(`[calcCarRating(G.cars[0], 'endurance', false, 3), calcDNFChance(G.cars[0], 'endurance', 3)]`);
  assert(full[0] > solo[0], `full lineup is faster (${full[0]} vs ${solo[0]})`);
  assert(Math.abs(solo[1] / full[1] - 2) < 1e-9, 'two missing drivers double the DNF chance');
  const equalSolo = g.run(`calcCarRating(G.cars[0], 'endurance', false, 1)`);
  assert(Math.abs(full[0] - equalSolo) < 1e-9, 'three equal drivers rate like one rested driver');
});

test('Race drivers earn LP and XP; reserves earn nothing', () => {
  const { g, ids, car } = lineupSetup();
  g.run(`G.cars[0].classId = 'GT4'; G.drivers.forEach(d => { d.licenses = ['GT4']; d.licensePoints = {}; });
    G.pitCrew.level = 20; G.drivers.forEach(d => DRIVER_STAT_KEYS.forEach(k => d[k] = 90));`);
  g.run(`assignDriver('${ids[0]}', '${car}'); assignDriver('${ids[1]}', '${car}', 'co');`);
  finishChamp(g, 'gt4_regional', car);
  assert(driver(g, ids[0]).licensePoints.GT3 > 0, 'lead earns LP');
  assert(!driver(g, ids[1]).licensePoints.GT3, 'sprint reserve earns no LP');
  assert(driver(g, ids[1]).xp === 0 && g.run(`isReserveDriver(G.drivers.find(d => d.id === '${ids[1]}'))`), 'reserve gains no XP');
  const leadXp = driver(g, ids[0]).xp;
  g.run('endSeason()');
  assert(driver(g, ids[0]).xp >= leadXp + 100 && driver(g, ids[1]).xp === 0, 'only the race driver gets championship XP');
  g.run(`unassignDriver('${ids[0]}')`);
  assert(g.run('G.cars[0].driverId') === ids[1], 'reserve steps in when the lead leaves');
});

test('Saves from before lineups load with empty co-driver seats', () => {
  const { g } = setup();
  g.run(`delete G.cars[0].coDriverIds; saveGame(); loadGame();`);
  assert(Array.isArray(g.run('G.cars[0].coDriverIds')), 'coDriverIds added on load');
});

test('The team is called Cyberracing by default and can be renamed', () => {
  const { g } = setup();
  assert(g.run('G.teamName') === 'Cyberracing', 'default name');
  assert(g.run(`renameTeam('  Neon   <b>Apex</b> Racing ').name`) === 'Neon bApex/b Racing', 'trimmed, markup characters dropped');
  assert(!g.run(`renameTeam('   ').ok`) && g.run('G.teamName') === 'Neon bApex/b Racing', 'empty name rejected');
  assert(g.run(`renameTeam('x'.repeat(40)).name.length`) === g.run('TEAM_NAME_MAX_LENGTH'), 'length capped');
  g.run(`delete G.teamName; saveGame(); loadGame();`);
  assert(g.run('G.teamName') === 'Cyberracing', 'old saves get the default name');
});

test('Cars are balanced: only setup knowledge and the pit crew change the car side', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  const base = g.run('calcCarBaseRating(G.cars[0])');
  assert(base === 100, 'GT4 runs at its class rating, got ' + base);
  g.run('G.cars[0].setupChamps = 10');
  assert(Math.abs(g.run('calcCarBaseRating(G.cars[0])') - 103) < 1e-9, 'setup bonus capped at +3%');
  const r0 = g.run(`calcCarRating(G.cars[0], 'endurance')`);
  assert(g.run('trainPitCrew().ok') && g.run('G.pitCrew.level') === 1, 'crew trains');
  assert(Math.abs(g.run(`calcCarRating(G.cars[0], 'endurance')`) / r0 - 1.01) < 1e-9, 'crew level adds 1% in endurance');
  assert(Math.abs(g.run('getPitCrewBonus(G.cars[0], "sprint")') - 0.004) < 1e-9, 'and 0.4% in sprint');
});

test('The pit crew covers its size in cars, highest class first; others get half', () => {
  const { g } = setup();
  g.run(`G.reputation = 1000; upgradeGarage(); buyCar('GT3'); G.pitCrew.level = 10;`);
  const gt3 = g.run(`G.cars.find(c => c.classId === 'GT3').id`);
  assert(g.run('getCrewCoveredCarIds().join()') === gt3, 'GT3 covered first');
  assert(Math.abs(g.run('getPitCrewBonus(G.cars[0], "endurance")') - 0.05) < 1e-9, 'uncovered GT4 gets half');
  assert(g.run('expandPitCrew().ok') && Math.abs(g.run('getPitCrewBonus(G.cars[0], "endurance")') - 0.1) < 1e-9, 'bigger crew covers both');
});

test('Old saves get their performance upgrades refunded in full', () => {
  const { g } = setup();
  g.run(`G.money = 0; delete G.pitCrew; G.cars[0].upgrades = { engine: 2, aero: 1, tyres: 0, brakes: 0, reliability: 11 }; saveGame(); loadGame();`);
  const expected = 1000 + 1800 + 800 + g.run(`getUpgradeCost('reliability', 9, 'GT4') + getUpgradeCost('reliability', 10, 'GT4')`);
  assert(g.run('G.money') === expected, `refund ${g.run('G.money')} vs ${expected}`);
  assert(g.run('JSON.stringify(G.cars[0].upgrades)') === '{"reliability":9}', 'only preparation left, capped at 9');
  assert(g.run('G.pitCrew.level') === 0, 'pit crew added');
  g.run('saveGame(); loadGame();');
  assert(g.run('G.money') === expected, 'refund paid once');
});

test('Banked XP trains drivers at season end', () => {
  const { g, a } = setup();
  const before = g.run(`DRIVER_STAT_KEYS.reduce((s, k) => s + G.drivers.find(d => d.id === '${a}')[k], 0)`);
  g.run(`G.drivers.find(d => d.id === '${a}').xp = XP_PER_STAT_POINT * 3 + 50; G.drivers.find(d => d.id === '${a}').age = 30; endSeason();`);
  const d = driver(g, a);
  const after = g.run(`DRIVER_STAT_KEYS.reduce((s, k) => s + G.drivers.find(d => d.id === '${a}')[k], 0)`);
  assert(after - before >= 3, `3 stat points trained (${before} -> ${after})`);
  assert(d.xp === 50, 'leftover XP kept, got ' + d.xp);
});

test('The season ends early once nothing races and nothing fits', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  const start = g.run('G.seasonStartTime');
  const cup = g.run("getChampionshipDuration(getChampionshipById('gt4_regional'))");
  g.tickFor(SEASON_SEC(g) - cup - 30, 10);
  assert(g.run('G.season') === 1, 'GT4 Cup still fits: season goes on');
  g.tickFor(60, 5);
  assert(g.run('G.season') === 2, 'ended early once the GT4 Cup no longer fits');
  const ended = (g.run('G.seasonStartTime') - start) / 1000;
  assert(ended < SEASON_SEC(g) - cup + 10, 'new season started right away, not at the scheduled end');
});

test('The season does not end early while a car is racing', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}'); setAutoRenew('${car}', false)`);
  g.tickFor(60, 5);
  assert(g.run('G.season') === 1 && g.run('G.activeChampionships.length') === 1, 'still racing in season 1');
});

test('Registering for next season pays now and starts at the season change', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}'); setAutoRenew('${car}', false)`);
  const m = g.run('G.money');
  assert(g.run(`registerForNextSeason('gt4_regional', '${car}').ok`), 'register while racing');
  assert(m - g.run('G.money') === 5000, 'fee paid now');
  assert(!g.run(`registerForNextSeason('gt4_regional', '${car}').ok`), 'one registration per car');
  assert(g.run('cancelRegistration(G.cars[0].id).ok') && g.run('G.money') === m, 'cancel refunds');
  g.run(`registerForNextSeason('gt4_regional', '${car}')`);
  g.run('endSeason(); _activateRegistrations(G.seasonStartTime);');
  assert(g.run(`G.activeChampionships.some(e => e.carId === '${car}' && e.definitionId === 'gt4_regional')`), 'started in the new season');
  assert(g.run('G.registrations.length') === 0, 'registration used up');
});

test('A registration that cannot start is refunded', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); registerForNextSeason('gt4_regional', '${car}'); unassignDriver('${a}');`);
  const m = g.run('G.money');
  g.run('endSeason(); _activateRegistrations(G.seasonStartTime);');
  assert(g.run('G.money') - m === 5000 && g.run('G.activeChampionships.length') === 0, 'fee refunded, nothing started');
});

test('Drivers and staff never share a name', () => {
  const { g } = setup();
  g.run('for (let i = 0; i < 300; i++) scoutDriver("C");');
  const names = g.run('G.drivers.map(d => d.name)');
  assert(new Set(names).size === names.length, 'all driver names unique');
  const staff = g.run('generateREOptions().concat(generateTPOptions()).map(s => s.name)');
  assert(staff.every(n => !names.includes(n)), 'staff candidates avoid driver names');
  assert(new Set(g.run('generateREOptions().map(s => s.name)')).size === g.run('generateREOptions().length'), 'no repeats in a shortlist');
  g.run('for (let i = 0; i < 700; i++) scoutDriver("C");');
  const all = g.run('G.drivers.map(d => d.name)');
  assert(new Set(all).size === all.length, 'still unique once every combination is used: ' + all.length);
});

test('Saves with duplicate names get one of them renamed', () => {
  const { g, a, b } = setup();
  g.run(`G.drivers.find(d => d.id === '${b}').name = G.drivers.find(d => d.id === '${a}').name; saveGame(); loadGame();`);
  assert(driver(g, a).name !== driver(g, b).name, 'duplicate renamed');
});

test('Selling a racing car abandons its championship and refunds its registration', () => {
  const { g, a, car } = setup();
  g.run(`G.reputation = 1000; upgradeGarage(); buyCar('GT3'); assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}'); registerForNextSeason('gt4_regional', '${car}');`);
  const m = g.run('G.money');
  const value = g.run(`getCarSellValue(G.cars.find(c => c.id === '${car}'))`);
  assert(g.run(`sellCar('${car}').ok`), 'racing car can be sold');
  assert(g.run('G.activeChampionships.length') === 0 && g.run('G.registrations.length') === 0, 'championship and registration gone');
  assert(g.run('G.money') - m === value + 5000, 'sale value plus the registration refund');
});

test('Championship entries keep unique ids across reloads', () => {
  const { g, a, b, car } = setup();
  g.run(`G.reputation = 1000; upgradeGarage(); buyCar('GT4'); assignDriver('${a}', '${car}'); assignDriver('${b}', G.cars[1].id);`);
  g.run(`enterChampionship('gt4_regional', '${car}'); saveGame(); loadGame(); enterChampionship('gt4_regional', G.cars[1].id);`);
  const ids = g.run('G.activeChampionships.map(e => e.id)');
  assert(ids.length === 2 && ids[0] !== ids[1], 'ids differ after a reload: ' + ids);
});

test('Saves with duplicate entry ids are repaired', () => {
  const { g, a, b, car } = setup();
  g.run(`G.reputation = 1000; upgradeGarage(); buyCar('GT4'); assignDriver('${a}', '${car}'); assignDriver('${b}', G.cars[1].id);
    enterChampionship('gt4_regional', '${car}'); enterChampionship('gt4_regional', G.cars[1].id);
    G.activeChampionships[1].id = G.activeChampionships[0].id; G.cars[1].championshipId = G.activeChampionships[0].id;
    G.nextEntryId = 1; saveGame(); loadGame();`);
  const ids = g.run('G.activeChampionships.map(e => e.id)');
  assert(ids[0] !== ids[1], 'duplicate id replaced');
  assert(g.run('G.cars.every(c => G.activeChampionships.find(e => e.id === c.championshipId).carId === c.id)'), 'each car points at its own entry');
  assert(g.run('G.nextEntryId') > Math.max(...ids.map(i => +i.match(/\d+$/)[0])), 'counter moved past ids in use');
});

test('Unpaid salaries make the best-paid people leave instead of going into debt', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); G.money = 30000; const s = scoutDriver('A'); G.money = 3000; G.teamPrincipal = { name: 'TP Test', salary: 10000 };`);
  g.run(`G.money = 3000; endSeason()`);
  assert(g.run('G.money') >= 0, 'money never negative');
  assert(g.run('G.teamPrincipal') === null, 'TP left');
  assert(!g.run(`G.drivers.some(d => d.tier === 'A')`), 'the A driver left');
});

test('Drivers are paid every season by tier', () => {
  const { g } = setup();
  g.run(`scoutDriver('A'); scoutDriver('B');`);
  const m = g.run('G.money');
  g.run('endSeason()');
  assert(m - g.run('G.money') === 17000, 'A 15k + B 2k, got ' + (m - g.run('G.money')));
});

test('No salaries are due in the season of a prestige reset, and Investor Backing adds money', () => {
  const { g } = setup();
  g.run(`scoutDriver('A'); G.prestigePoints = 10; buyPrestigeItem('seed_money'); G.reputation = 40000;`);
  assert(g.run('doPrestige().ok'), 'prestige');
  assert(g.run('G.money') === 30000, 'start money 5k + 25k');
  g.run('endSeason()');
  assert(g.run('G.money') >= 30000, 'no salaries paid');
});

test('A car that raced a series renews at a quarter of the fee', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}')`);
  finishChamp(g, 'gt4_regional', car);
  const m = g.run('G.money');
  assert(g.run(`enterChampionship('gt4_regional', '${car}').ok`), 'renew');
  assert(m - g.run('G.money') === 1250, 'renewal fee 25% of 5000');
});

test('Faster classes earn more REP in the same series', () => {
  const { g } = setup();
  assert(g.run(`getRoundRep(getChampionshipById('fia_wec'), 'HYPERCAR') > getRoundRep(getChampionshipById('fia_wec'), 'GT3')`), 'hypercar earns more');
  assert(g.run(`getRoundRep(getChampionshipById('fia_wec'), 'GT3') === getChampionshipById('fia_wec').repPerRound`), 'slowest class earns the base');
});

test('The free scout has a cooldown and paid drivers meet the pace floor', () => {
  const { g } = setup();
  assert(!g.run(`scoutDriver('C').ok`), 'second free scout blocked');
  g.advance(91e3);
  assert(g.run(`scoutDriver('C').ok`), 'available again after the cooldown');
  for (let i = 0; i < 20; i++) assert(g.run(`scoutDriver('A').driver.pace`) >= 32, 'A pace floor');
});

test('A championship cut short by the season end refunds its fee', () => {
  const { g, a, car } = setup();
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}');`);
  const m = g.run('G.money');
  g.run('endSeason()');
  assert(g.run('G.money') === m + 5000, 'fee refunded');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('PASS', t.name); }
  catch (e) { failed++; console.log('FAIL', t.name, '\n    ', e.message); }
}
console.log(failed ? `${failed}/${tests.length} FAILED` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
