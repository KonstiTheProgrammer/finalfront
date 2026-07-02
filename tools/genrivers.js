/* =========================================================
   FINAL FRONT — tools/genrivers.js
   Fügt js/mapdata.js eine Fluss-Ebene aus ECHTEN Geodaten hinzu:
   Natural Earth ne_50m_rivers_lake_centerlines (Public Domain).
   Die Landform/Höhen bleiben unangetastet — nur `rivers` wird
   erzeugt/ersetzt. Projektion identisch zu genmap.js.
   Ausführen:  node tools/genrivers.js
   ========================================================= */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  lonMin: -11, lonMax: 42,
  latMin: 34, latMax: 71.5,
  riverUrls: [
    'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_rivers_lake_centerlines.json',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson',
  ],
  maxScalerank: 8,     // kleinere Zahl = bedeutenderer Fluss
  minChainLen: 5,      // Mini-Schnipsel verwerfen (in Hexes)
  stepDeg: 0.04,       // Abtastschritt entlang der Flusslinien
};

/* ---------- Miller-Projektion (identisch zu genmap.js) ---------- */
const D2R = Math.PI / 180;
const millerY = lat => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * D2R));
const Y_TOP = millerY(CONFIG.latMax);
const Y_BOT = millerY(CONFIG.latMin);

function lonLatToHex(lon, lat, W, H) {
  const y = millerY(lat);
  const r = Math.round(((y - Y_TOP) / (Y_BOT - Y_TOP)) * H - 0.5);
  const c = Math.round(((lon - CONFIG.lonMin) / (CONFIG.lonMax - CONFIG.lonMin)) * W - 0.5 - 0.5 * (r & 1));
  return [c, r];
}

const NEIGHBORS_EVEN = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const NEIGHBORS_ODD = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];

async function fetchFirst(urls, label) {
  for (const url of urls) {
    try {
      process.stdout.write(`  lade ${label}: ${url.slice(0, 80)}… `);
      const res = await fetch(url);
      if (!res.ok) { console.log(`HTTP ${res.status}`); continue; }
      const json = await res.json();
      console.log('ok');
      return json;
    } catch (e) {
      console.log('Fehler: ' + e.message);
    }
  }
  return null;
}

(async function main() {
  // 1) Bestehende Karte laden (GENMAP aus js/mapdata.js auswerten)
  const mapPath = path.join(__dirname, '..', 'js', 'mapdata.js');
  const src = fs.readFileSync(mapPath, 'utf8');
  const GENMAP = new Function(src + '; return GENMAP;')();
  const { w: W, h: H, rows } = GENMAP;
  console.log(`FINAL FRONT Fluss-Generator — Karte ${W}x${H}`);

  // 2) Flüsse laden
  const geo = await fetchFirst(CONFIG.riverUrls, 'Natural Earth Flüsse (50m)');
  if (!geo) { console.error('FEHLER: Keine Flussdaten erreichbar.'); process.exit(1); }

  // 3) Linien im Kartenfenster abtasten und Hexes markieren
  const marked = new Set();
  let features = 0;
  for (const f of geo.features) {
    const props = f.properties || {};
    const cla = String(props.featurecla || '');
    if (cla.includes('Lake Centerline')) continue;          // Seen-Mittellinien nicht als Fluss
    const rank = props.scalerank !== undefined ? props.scalerank : 9;
    if (rank > CONFIG.maxScalerank) continue;
    const g = f.geometry;
    if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates : [];
    let used = false;
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [lon1, lat1] = line[i];
        const [lon2, lat2] = line[i + 1];
        if (Math.max(lon1, lon2) < CONFIG.lonMin || Math.min(lon1, lon2) > CONFIG.lonMax) continue;
        if (Math.max(lat1, lat2) < CONFIG.latMin || Math.min(lat1, lat2) > CONFIG.latMax) continue;
        const steps = Math.max(1, Math.ceil(Math.hypot(lon2 - lon1, lat2 - lat1) / CONFIG.stepDeg));
        for (let s = 0; s <= steps; s++) {
          const lon = lon1 + (lon2 - lon1) * s / steps;
          const lat = lat1 + (lat2 - lat1) * s / steps;
          const [c, r] = lonLatToHex(lon, lat, W, H);
          if (c < 0 || c >= W || r < 0 || r >= H) continue;
          if (rows[r][c] === '.') continue;                 // Meer/See: kein Fluss-Hex
          marked.add(c + r * W);
          used = true;
        }
      }
    }
    if (used) features++;
  }
  console.log(`  ${features} Flussläufe im Fenster, ${marked.size} Hexes markiert (roh)`);

  // 4) Mini-Schnipsel entfernen (zusammenhängende Ketten < minChainLen)
  const seen = new Set();
  const drop = [];
  for (const key of marked) {
    if (seen.has(key)) continue;
    const comp = [key];
    seen.add(key);
    for (let i = 0; i < comp.length; i++) {
      const c = comp[i] % W, r = Math.floor(comp[i] / W);
      const deltas = (r & 1) ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
      for (const [dc, dr] of deltas) {
        const k = (c + dc) + (r + dr) * W;
        if (marked.has(k) && !seen.has(k)) { seen.add(k); comp.push(k); }
      }
    }
    if (comp.length < CONFIG.minChainLen) drop.push(...comp);
  }
  for (const k of drop) marked.delete(k);
  console.log(`  nach Bereinigung: ${marked.size} Fluss-Hexes`);

  // 5) rivers-Zeilen bauen und mapdata.js neu schreiben
  const riverRows = [];
  for (let r = 0; r < H; r++) {
    let row = '';
    for (let c = 0; c < W; c++) row += marked.has(c + r * W) ? 'r' : '.';
    riverRows.push(row);
  }

  const header = src.match(/^\/\*[\s\S]*?\*\//);
  const out = `${header ? header[0] : '/* mapdata */'}
const GENMAP = {
  w: ${W},
  h: ${H},
  realElevation: ${GENMAP.realElevation},
  spawns: ${JSON.stringify(GENMAP.spawns)},
  rows: [
${rows.map(r => `    '${r}',`).join('\n')}
  ],
  /* Flüsse: Natural Earth ne_50m_rivers_lake_centerlines (scalerank ≤ ${CONFIG.maxScalerank}) */
  rivers: [
${riverRows.map(r => `    '${r}',`).join('\n')}
  ],
};
`;
  fs.writeFileSync(mapPath, out);
  console.log(`  geschrieben: ${mapPath}`);
  console.log('Fertig.');
})();
