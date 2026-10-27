// Loads data.js + game.js into a sandbox with a controllable clock and in-memory
// localStorage, so game logic can be tested and simulated headlessly in Node.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function createGame({ startTime = 1_700_000_000_000, seed = null } = {}) {
  let now = startTime;
  class FakeDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(now); }
    static now() { return now; }
  }
  const store = {};
  // Optional deterministic Math.random (mulberry32)
  const math = Object.create(Math);
  if (seed !== null) {
    let s = seed >>> 0;
    math.random = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ctx = {
    console, JSON, Object, Array, Number, String, Set, Map,
    Math: math, Date: FakeDate,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  };
  vm.createContext(ctx);
  const root = path.join(__dirname, '..');
  const src = ['data', 'game']
    .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
    .join('\n');
  vm.runInContext(src, ctx, { filename: 'game-bundle.js' });

  const run = code => vm.runInContext(code, ctx);
  run('G = createDefaultState();');
  return {
    ctx,
    run,
    get G() { return run('G'); },
    now: () => now,
    advance(ms) { now += ms; },
    // Advance the clock in ticks, calling tick() like the real game loop
    tickFor(sec, stepSec = 1) {
      for (let t = 0; t < sec; t += stepSec) { now += stepSec * 1000; run(`tick(${stepSec * 1000})`); }
    },
  };
}

module.exports = { createGame };
