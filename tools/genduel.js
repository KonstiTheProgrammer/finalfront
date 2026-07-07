/* =========================================================
   FINAL FRONT — tools/genduel.js
   Erzeugt die synthetische 1v1-Karte "Duell-Insel" (20×22):
   SPIEGELSYMMETRISCH (West ↔ Ost) und damit wirklich fair —
   in der Mitte ein Bergriegel mit zwei Durchbrüchen, dazu ein
   symmetrischer Fluss. Kein Netz nötig; schreibt den Eintrag
   direkt in js/mapdata.js (GENMAPS.duell).
   Ausführen:  node tools/genduel.js
   ========================================================= */

const fs = require('fs');
const path = require('path');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDuel() {
  const W = 20, H = 22;
  const rng = mulberry32(4242);
  // Rauschgitter fürs Küsten-Wackeln (nur linke Hälfte wird gewürfelt)
  const noise = [];
  for (let r = 0; r < H; r++) {
    noise.push([]);
    for (let c = 0; c < W; c++) noise[r].push(rng() * 2 - 1);
  }
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const xpos = (c, r) => c + 0.5 * (r & 1);
  // Spiegel-Spalte (odd-r: halbe Zelle versetzt)
  const mirrorC = (c, r) => (r & 1) ? (W - 2 - c) : (W - 1 - c);

  const terr = [];
  for (let r = 0; r < H; r++) terr.push(new Array(W).fill('.'));

  // Linke Hälfte formen, rechte spiegeln
  const gapRows = [6, 15];   // Durchbrüche im Bergriegel
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const x = xpos(c, r);
      if (x > cx + 0.26) continue;   // nur links (inkl. Mittellinie)
      const dx = (x - cx) / (W * 0.46);
      const dy = (r - cy) / (H * 0.44);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.86 + 0.13 * noise[r][c]) continue;   // Meer
      let t = 'p';
      const distMid = Math.abs(x - cx);
      if (distMid <= 0.6) {
        // Bergriegel in der Mitte — zwei Lücken als Angriffswege
        t = gapRows.some(g => Math.abs(r - g) <= 1) ? 'p' : 'm';
      } else if (distMid <= 1.7 && noise[r][c] > -0.35) {
        t = 'h';                                     // Hügelsaum am Riegel
      } else if (noise[r][c] > 0.42) {
        t = 'f';                                     // Waldflecken
      }
      terr[r][c] = t;
      const mc = mirrorC(c, r);
      if (mc >= 0 && mc < W && mc !== c) terr[r][mc] = t;
    }
  }

  // Mini-Inseln entfernen (größte Landmasse behalten) — Maske ist
  // symmetrisch, also bleibt auch die Bereinigung symmetrisch
  const NB_E = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
  const NB_O = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];
  const seen = new Set();
  const comps = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (terr[r][c] === '.' || seen.has(c + r * W)) continue;
    const comp = [[c, r]];
    seen.add(c + r * W);
    for (let i = 0; i < comp.length; i++) {
      const [cc, cr] = comp[i];
      for (const [dc, dr] of (cr & 1) ? NB_O : NB_E) {
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
        if (terr[nr][nc] === '.' || seen.has(nc + nr * W)) continue;
        seen.add(nc + nr * W);
        comp.push([nc, nr]);
      }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  for (const comp of comps.slice(1)) for (const [c, r] of comp) terr[r][c] = '.';

  // Symmetrischer Fluss: waagerecht durch die Kartenmitte (nicht durch den Riegel)
  const rivers = [];
  for (let r = 0; r < H; r++) rivers.push(new Array(W).fill(' '));
  const riverRow = Math.round(cy);
  for (let c = 0; c < W; c++) {
    if (terr[riverRow][c] !== '.' && terr[riverRow][c] !== 'm') rivers[riverRow][c] = 'r';
  }

  const rows = terr.map(a => a.join(''));
  const riv = rivers.map(a => a.join(''));
  let land = 0, west = 0, east = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (terr[r][c] === '.') continue;
    land++;
    const x = xpos(c, r);
    if (x < cx - 0.01) west++;
    else if (x > cx + 0.01) east++;
  }
  console.log(`Duell-Insel: ${W}x${H}, ${land} Land — West ${west} / Ost ${east} (Spiegel-Fairness)`);
  return { id: 'duell', map: { name: 'Duell-Insel (1v1)', w: W, h: H, rows, rivers: riv } };
}

/* mapdata.js patchen: GENMAPS.duell einsetzen/ersetzen */
function main() {
  const vm = require('vm');
  const file = path.join(__dirname, '..', 'js', 'mapdata.js');
  const src = fs.readFileSync(file, 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.__G = GENMAPS;', ctx);   // JS-Literal auswerten
  const maps = ctx.__G;
  const { id, map } = buildDuel();
  maps[id] = map;
  const header = src.slice(0, src.indexOf('const GENMAPS'));
  fs.writeFileSync(file, header + 'const GENMAPS = ' + JSON.stringify(maps) + ';\n');
  console.log('geschrieben: ' + file);
}

if (require.main === module) main();
module.exports = { buildDuel };
