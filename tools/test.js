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
  for (let i = 0; i < 200 && g.run(`G.activeChampionships.some(e => e.carId === '${carId}')`); i++) g.tickFor(10, 10);
  assert(!g.run(`G.activeChampionships.some(e => e.carId === '${carId}')`), 'championship did not finish');
}

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
  g.run(`assignDriver('${a}', '${car}'); enterChampionship('gt4_regional', '${car}'); G.lastSave = Date.now();`);
  g.advance(3600e3);
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

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('PASS', t.name); }
  catch (e) { failed++; console.log('FAIL', t.name, '\n    ', e.message); }
}
console.log(failed ? `${failed}/${tests.length} FAILED` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
