/* =========================================================
   FINAL FRONT — tools/genmore.js
   Erzeugt drei PROZEDURALE Karten (offline, seeded, deterministisch)
   und mischt sie in js/mapdata.js (GENMAPS) — bestehende Karten
   bleiben unangetastet:
   - kontinent  „Kontinent"  44×48 — ein Erdteil, Gebirgszüge, Ströme
   - inselmeer  „Inselmeer"  36×36 — Archipel, Seewege entscheiden
   - steppe     „Steppe"     38×30 — offenes Land, Flüsse als einzige Linien
   Kompakt ausgelegt: 5 Reiche füllen die Karte in Akt I — Fronten statt
   Niemandsland, der Überblick bleibt (≤30-min-Runden).
   Ausführen:  node tools/genmore.js
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- Seeded RNG (mulberry32, wie im Spiel) ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Value-Noise auf Hex-Pixelkoordinaten ---------- */
function makeNoise(rand) {
  const grid = new Map();
  const at = (x, y) => {
    const k = x + '|' + y;
    if (!grid.has(k)) grid.set(k, rand());
    return grid.get(k);
  };
  const smooth = t => t * t * (3 - 2 * t);
  function sample(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  return (x, y, oct, freq) => {
    let v = 0, amp = 1, sum = 0;
    for (let o = 0; o < oct; o++) {
      v += sample(x * freq, y * freq) * amp;
      sum += amp; amp *= 0.5; freq *= 2;
    }
    return v / sum;
  };
}

/* Hex-Mittelpunkte (odd-r wie im Spiel: Versatz auf ungeraden Reihen) */
const hx = (c, r) => c + 0.5 * (r & 1);
const hy = r => r * 0.866;

function neighborsOf(c, r) {
  const even = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
  const odd = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];
  return ((r & 1) ? odd : even).map(([dc, dr]) => [c + dc, r + dr]);
}

/* ---------- Gemeinsame Werkzeuge ---------- */
function blankGrid(W, H, fill) {
  return Array.from({ length: H }, () => Array(W).fill(fill));
}

/* Mehrheitsfilter: Terrain glätten, Einzel-Pixel verschwinden */
function majority(t, W, H, passes) {
  for (let p = 0; p < passes; p++) {
    const out = t.map(row => row.slice());
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const cnt = {};
      cnt[t[r][c]] = 1.5;   // leichter Eigen-Bonus: Strukturen bleiben erhalten
      for (const [nc, nr] of neighborsOf(c, r)) {
        if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
        const v = t[nr][nc];
        cnt[v] = (cnt[v] || 0) + 1;
      }
      let best = t[r][c], bn = -1;
      for (const k of Object.keys(cnt)) if (cnt[k] > bn) { bn = cnt[k]; best = k; }
      out[r][c] = best;
    }
    for (let r = 0; r < H; r++) t[r] = out[r];
  }
}

/* Zusammenhangskomponenten des Landes */
function components(t, W, H) {
  const seen = blankGrid(W, H, false);
  const comps = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (t[r][c] === '.' || seen[r][c]) continue;
    const q = [[c, r]]; seen[r][c] = true;
    const comp = [];
    while (q.length) {
      const [qc, qr] = q.pop();
      comp.push([qc, qr]);
      for (const [nc, nr] of neighborsOf(qc, qr)) {
        if (nc < 0 || nr < 0 || nc >= W || nr >= H || seen[nr][nc] || t[nr][nc] === '.') continue;
        seen[nr][nc] = true; q.push([nc, nr]);
      }
    }
    comps.push(comp);
  }
  return comps;
}

/* Binnen-„Pfützen" (1–2 Hex Wasser mitten im Land) zuschütten */
function fillPuddles(t, W, H) {
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    if (t[r][c] !== '.') continue;
    let land = 0, all = 0;
    for (const [nc, nr] of neighborsOf(c, r)) {
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      all++;
      if (t[nr][nc] !== '.') land++;
    }
    if (all > 0 && land === all) t[r][c] = 'p';
  }
}

/* Flüsse: an hohen Quellen starten, bergab zum Meer mäandern */
function carveRivers(t, elev, W, H, rand, count) {
  const riv = blankGrid(W, H, '.');
  const springs = [];
  for (let r = 2; r < H - 2; r++) for (let c = 2; c < W - 2; c++) {
    if (t[r][c] === 'h' || t[r][c] === 'm') springs.push([c, r, elev[r][c]]);
  }
  springs.sort((a, b) => b[2] - a[2]);
  let made = 0;
  for (let s = 0; s < springs.length && made < count; s += Math.max(1, Math.floor(springs.length / (count * 3)))) {
    let [c, r] = springs[s];
    const chain = [];
    const visited = new Set();
    for (let step = 0; step < W + H; step++) {
      chain.push([c, r]);
      visited.add(c + '|' + r);
      let best = null, be = Infinity;
      for (const [nc, nr] of neighborsOf(c, r)) {
        if (nc < 1 || nr < 1 || nc >= W - 1 || nr >= H - 1) continue;
        if (visited.has(nc + '|' + nr)) continue;
        const e = elev[nr][nc] + rand() * 0.012;   // leichtes Mäandern
        if (e < be) { be = e; best = [nc, nr]; }
      }
      if (!best) break;
      [c, r] = best;
      if (t[r][c] === '.' || riv[r][c] === 'r') break;   // Meer/Fluss erreicht
    }
    if (chain.length >= 5) {
      for (const [rc, rr] of chain) if (t[rr][rc] !== '.') riv[rr][rc] = 'r';
      made++;
    }
  }
  return riv;
}

/* Fluss-Geflechte ausdünnen: Hexe mit 3+ Fluss-Nachbarn verlieren den Fluss */
function thinRivers(riv, W, H) {
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (riv[r][c] !== 'r') continue;
      let n = 0;
      for (const [nc, nr] of neighborsOf(c, r)) {
        if (nc >= 0 && nr >= 0 && nc < W && nr < H && riv[nr][nc] === 'r') n++;
      }
      if (n >= 4) { riv[r][c] = '.'; changed = true; }
    }
    if (!changed) break;
  }
}

/* Einzelgipfel ohne Berg-/Hügel-Nachbarn werden Hügel — Ketten bleiben */
function chainMountains(t, W, H) {
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (t[r][c] !== 'm') continue;
    let rough = 0;
    for (const [nc, nr] of neighborsOf(c, r)) {
      if (nc >= 0 && nr >= 0 && nc < W && nr < H && (t[nr][nc] === 'm' || t[nr][nc] === 'h')) rough++;
    }
    if (rough === 0) t[r][c] = 'h';
  }
}

/* Elevation + Feuchtigkeit → Terrainklassen */
function classify(landmask, elev, moist, W, H, opts) {
  const t = blankGrid(W, H, '.');
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!landmask[r][c]) continue;
    const e = elev[r][c];
    if (e > opts.mountain) t[r][c] = 'm';
    else if (e > opts.hills) t[r][c] = 'h';
    else t[r][c] = moist[r][c] > opts.forest ? 'f' : 'p';
  }
  return t;
}

function toMap(id, name, t, riv, W, H) {
  return {
    id, name,
    def: {
      name, w: W, h: H,
      rows: t.map(row => row.join('')),
      rivers: riv.map(row => row.join('')),
    },
  };
}

/* ========== Karte 1: Kontinent (44×48) — ein Erdteil, kompakt ========== */
function genKontinent() {
  const W = 44, H = 48;
  const rand = mulberry32(44048);
  const noise = makeNoise(rand);
  const landmask = blankGrid(W, H, false);
  const elev = blankGrid(W, H, 0);
  const moist = blankGrid(W, H, 0);
  const cx = W / 2, cy = H * 0.866 / 2;
  const maxD = Math.hypot(cx, cy);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const x = hx(c, r), y = hy(r);
    const d = Math.hypot(x - cx, y - cy) / maxD;              // 0 Mitte … 1 Ecke
    const base = noise(x, y, 4, 0.055);
    const land = base - d * d * 0.85 + 0.18;                  // radialer Abfall = Küstenform
    landmask[r][c] = land > 0.33;
    // Gebirge: zwei geschwungene Rücken (Ridge-Noise), Rest sanft
    const ridge = 1 - Math.abs(noise(x + 300, y - 140, 3, 0.045) - 0.5) * 2;
    elev[r][c] = base * 0.55 + Math.pow(ridge, 4) * 0.62 - d * 0.15;
    moist[r][c] = noise(x - 500, y + 260, 3, 0.07);
  }
  const t = classify(landmask, elev, moist, W, H, { mountain: 0.78, hills: 0.63, forest: 0.55 });
  majority(t, W, H, 2);
  fillPuddles(t, W, H);
  // Mini-Inseln versenken (unter 10 Hexe)
  for (const comp of components(t, W, H)) if (comp.length < 10) for (const [c, r] of comp) t[r][c] = '.';
  chainMountains(t, W, H);
  const riv = carveRivers(t, elev, W, H, rand, 6);
  thinRivers(riv, W, H);
  return toMap('kontinent', 'Kontinent', t, riv, W, H);
}

/* ========== Karte 2: Inselmeer (36×36) — Archipel ========== */
function genInselmeer() {
  const W = 36, H = 36;
  const rand = mulberry32(36036);
  const noise = makeNoise(rand);
  const t = blankGrid(W, H, '.');
  const owner = blankGrid(W, H, 0);
  // Insel-Saatpunkte mit Mindestabstand streuen
  const seeds = [];
  for (let tries = 0; tries < 6000 && seeds.length < 9; tries++) {
    const c = 3 + Math.floor(rand() * (W - 6));
    const r = 3 + Math.floor(rand() * (H - 6));
    if (seeds.some(([sc, sr]) => Math.hypot(hx(c, r) - hx(sc, sr), hy(r) - hy(sr)) < 8.2)) continue;
    seeds.push([c, r]);
  }
  // Jede Insel wächst per Zufalls-Flutung — fremde Inseln dürfen sich NIE berühren
  seeds.forEach(([sc, sr], idx) => {
    const id = idx + 1;
    const size = 14 + Math.floor(rand() * 23);
    const frontier = [[sc, sr]];
    t[sr][sc] = 'p'; owner[sr][sc] = id;
    let grown = 1;
    while (grown < size && frontier.length) {
      const i = Math.floor(rand() * frontier.length);
      const [c, r] = frontier[i];
      const nbs = neighborsOf(c, r).filter(([nc, nr]) => {
        if (nc < 2 || nr < 2 || nc >= W - 2 || nr >= H - 2 || t[nr][nc] !== '.') return false;
        // Nachbarn des Kandidaten: nur eigenes oder niemandes Land
        return neighborsOf(nc, nr).every(([mc, mr]) =>
          mc < 0 || mr < 0 || mc >= W || mr >= H || owner[mr][mc] === 0 || owner[mr][mc] === id);
      });
      if (!nbs.length) { frontier.splice(i, 1); continue; }
      const [nc, nr] = nbs[Math.floor(rand() * nbs.length)];
      t[nr][nc] = 'p'; owner[nr][nc] = id;
      frontier.push([nc, nr]); grown++;
    }
  });
  // Terrain auf den Inseln: Hügelkuppen + Wald, kaum Gebirge
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (t[r][c] === '.') continue;
    const e = noise(hx(c, r), hy(r), 3, 0.12);
    const m = noise(hx(c, r) + 400, hy(r) + 90, 3, 0.08);
    if (e > 0.74) t[r][c] = 'h';
    else if (m > 0.56) t[r][c] = 'f';
  }
  fillPuddles(t, W, H);
  // Verhungerte Mini-Inseln versenken (Spawn braucht Platz)
  for (const comp of components(t, W, H)) if (comp.length < 14) for (const [c, r] of comp) t[r][c] = '.';
  const riv = blankGrid(W, H, '.');   // Archipel: Flüsse spielen hier keine Rolle
  return toMap('inselmeer', 'Inselmeer', t, riv, W, H);
}

/* ========== Karte 3: Steppe (38×30) — offenes Land ========== */
function genSteppe() {
  const W = 38, H = 30;
  const rand = mulberry32(38030);
  const noise = makeNoise(rand);
  const landmask = blankGrid(W, H, false);
  const elev = blankGrid(W, H, 0);
  const moist = blankGrid(W, H, 0);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const x = hx(c, r), y = hy(r);
    // Fast alles Land — nur die Nordwest-Ecke ist Meer, plus 2 Steppenseen
    const seaNW = Math.hypot(x - 0, y - 0) / 14;
    landmask[r][c] = seaNW > 1
      && c > 0 && r > 0 && c < W - 1 && r < H - 1;
    // Ein Diagonal-Rücken von SW nach NO — die einzige Bergkette
    const diag = Math.abs((y - x * 0.62) - H * 0.866 * 0.34) / 3.2;
    const ridge = Math.max(0, 1 - diag) * (0.7 + noise(x, y, 2, 0.1) * 0.5);
    elev[r][c] = ridge + noise(x + 70, y - 60, 3, 0.05) * 0.22;
    moist[r][c] = noise(x - 300, y + 500, 3, 0.06);
  }
  const t = classify(landmask, elev, moist, W, H, { mountain: 0.82, hills: 0.6, forest: 0.74 });
  // Zwei Steppenseen als Fixpunkte im offenen Land
  for (const [lc, lr] of [[Math.floor(W * 0.64), Math.floor(H * 0.3)], [Math.floor(W * 0.3), Math.floor(H * 0.58)]]) {
    t[lr][lc] = '.';
    for (const [nc, nr] of neighborsOf(lc, lr)) if (nr > 0 && nc > 0 && nr < H - 1 && nc < W - 1) t[nr][nc] = '.';
  }
  majority(t, W, H, 1);
  fillPuddles(t, W, H);
  for (const comp of components(t, W, H)) if (comp.length < 10) for (const [c, r] of comp) t[r][c] = '.';
  chainMountains(t, W, H);
  const riv = carveRivers(t, elev, W, H, rand, 3);
  thinRivers(riv, W, H);
  return toMap('steppe', 'Steppe', t, riv, W, H);
}

/* ---------- mapdata.js patchen (Muster wie tools/genduel.js) ---------- */
function main() {
  const maps = [genKontinent(), genInselmeer(), genSteppe()];
  for (const m of maps) {
    const flat = m.def.rows.join('');
    const land = flat.replace(/\./g, '').length;
    console.log(`${m.id}: ${m.def.w}×${m.def.h}, Land ${(land / flat.length * 100).toFixed(0)} %`);
  }
  const file = path.join(__dirname, '..', 'js', 'mapdata.js');
  const src = fs.readFileSync(file, 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.__G = GENMAPS;', ctx);
  const all = ctx.__G;
  for (const m of maps) all[m.id] = m.def;
  const header = src.slice(0, src.indexOf('const GENMAPS'));
  fs.writeFileSync(file, header + 'const GENMAPS = ' + JSON.stringify(all) + ';\n');
  console.log('js/mapdata.js aktualisiert:', Object.keys(all).join(', '));
}

main();
