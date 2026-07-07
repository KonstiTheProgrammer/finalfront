/* =========================================================
   FINAL FRONT — Vollrunden-Benchmark (alle Nationen als KI)
   Ausführen:  node tests/bench.js
   ========================================================= */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

for (const seed of [7, 42]) {
  for (const mapId of ['europa', 'mitteleuropa']) {
    const FixedDate = new Proxy(Date, { get: (t, k) => (k === 'now' ? () => 987654321 : t[k]) });
    const ctx = {
      performance: { now: () => 987654 },
      console, Math, Date: FixedDate, JSON,
      localStorage: { setItem() {}, getItem() { return null; } },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const f of ['mapdata.js', 'map.js', 'game.js']) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
    }
    ctx.__seed = seed;
    ctx.__map = mapId;
    const res = vm.runInContext(`
(() => {
  const g = new Game('A', __seed, __map);
  // Voll-KI-Runde: auch "Spieler" A spielt automatisch
  g.nations['A'].ai = true;
  for (const d of g.divisions) d.manual = false;
  g.endSpawnPhase();
  const maxTicks = BAL.round.days * 4 + 40;
  for (let i = 0; i < maxTicks && !g.over; i++) g.runTick();
  g.vpRecount();
  const alive = Object.keys(g.nations).filter(id => g.nations[id].alive);
  const top = alive.sort((x, y) => ((g.nations[y].vp || 0) - (g.nations[x].vp || 0))
    || (g.nations[y].hexCount - g.nations[x].hexCount)).slice(0, 3)
    .map(id => id + ':' + (g.nations[id].vp || 0) + 'vp/' + g.nations[id].hexCount);
  return JSON.stringify({
    seed: __seed, map: __map, endTag: g.day,
    grund: g.day >= BAL.round.days ? 'TIMER' : 'COUNTDOWN/SONST',
    text: g.over ? g.over.text.slice(0, 55) : '(läuft noch)',
    top, alive: alive.length, divs: g.divisions.filter(d => !d.dead).length,
  });
})()
`, ctx);
    console.log(res);
  }
}
