/* =========================================================
   FINAL FRONT — tools/genmap.js
   Erzeugt js/mapdata.js aus ECHTEN Geodaten:
   - Landform: Natural Earth ne_50m_land + ne_50m_lakes (GeoJSON, Public Domain)
   - Höhen:    Open-Meteo Elevation API (Copernicus DEM GLO-90)
   Ausführen:  node tools/genmap.js
   ========================================================= */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  W: 180, H: 205,                       // Hexgitter (odd-r, pointy-top)
  lonMin: -11, lonMax: 42,              // Europa: Irland bis Moskau
  latMin: 34, latMax: 71.5,             // Nordafrika-Küste bis Nordkap
  landUrls: [
    'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_land.json',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson',
  ],
  lakesUrls: [
    'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_lakes.json',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson',
  ],
  elevationApi: 'https://api.open-meteo.com/v1/elevation',
  // Echte Hauptstadt-Koordinaten [lon, lat]
  capitals: {
    G: [-0.13, 51.51],   // London
    J: [-6.26, 53.35],   // Dublin
    F: [2.35, 48.86],    // Paris
    L: [4.35, 50.85],    // Brüssel
    D: [13.40, 52.52],   // Berlin
    W: [7.45, 46.95],    // Bern
    I: [12.50, 41.90],   // Rom
    S: [-3.70, 40.42],   // Madrid
    O: [-9.14, 38.72],   // Lissabon
    N: [18.07, 59.33],   // Stockholm
    P: [21.01, 52.23],   // Warschau
    H: [16.37, 48.21],   // Wien
    B: [20.46, 44.82],   // Belgrad
    R: [37.62, 55.75],   // Moskau
    T: [32.85, 39.93],   // Ankara
  },
  // Fallback-Gebirge [lon, lat, RadiusGrad], falls die Höhen-API nicht erreichbar ist
  fallbackMountains: [
    [8.5, 46.4, 2.6], [13, 47, 2.2],          // Alpen
    [0.8, 42.7, 1.6],                          // Pyrenäen
    [24.5, 47.3, 2.4], [21, 49.3, 1.4],        // Karpaten
    [8.5, 61.5, 2.6], [14, 65, 2.6],           // Skanden
    [18, 43.7, 1.8], [21.5, 41.8, 1.6],        // Dinariden/Balkan
    [13.5, 42.5, 1.4], [16, 40.5, 1.2],        // Apennin
    [-4.5, 57.2, 1.2],                         // Schottland
    [43, 43, 2.2],                             // Kaukasus
    [35, 38.5, 2.2], [39, 39.5, 2.4],          // Anatolien
    [-5.5, 37, 1.0], [-3, 40.5, 0.8],          // Iberische Ketten
  ],
};

/* ---------- Miller-Projektion ---------- */
const D2R = Math.PI / 180;
const millerY = lat => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * D2R));
const Y_TOP = millerY(CONFIG.latMax);
const Y_BOT = millerY(CONFIG.latMin);

function rowLat(r) {
  const fy = (r + 0.5) / CONFIG.H;
  const y = Y_TOP + fy * (Y_BOT - Y_TOP);
  return (Math.atan(Math.exp(y / 1.25)) - Math.PI / 4) / (0.4 * D2R);
}
function colLon(c, r) {
  const fx = (c + 0.5 * (r & 1) + 0.5) / CONFIG.W;
  return CONFIG.lonMin + fx * (CONFIG.lonMax - CONFIG.lonMin);
}
function lonLatToHex(lon, lat) {
  const y = millerY(lat);
  const r = Math.round(((y - Y_TOP) / (Y_BOT - Y_TOP)) * CONFIG.H - 0.5);
  const c = Math.round(((lon - CONFIG.lonMin) / (CONFIG.lonMax - CONFIG.lonMin)) * CONFIG.W - 0.5 - 0.5 * (r & 1));
  return [Math.max(0, Math.min(CONFIG.W - 1, c)), Math.max(0, Math.min(CONFIG.H - 1, r))];
}

/* ---------- Downloads ---------- */
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

/* Alle Ringe (Außen + Löcher) aus einer GeoJSON-Feature-Collection */
function collectRings(geojson) {
  const rings = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      // Bounding-Box-Vorfilter aufs Kartenfenster
      let inBox = false;
      for (const [lon, lat] of ring) {
        if (lon >= CONFIG.lonMin - 2 && lon <= CONFIG.lonMax + 2
          && lat >= CONFIG.latMin - 2 && lat <= CONFIG.latMax + 2) { inBox = true; break; }
      }
      if (inBox) rings.push(ring);
    }
  }
  return rings;
}

/* Scanline: für eine Breitengrad-Linie alle Kanten-Schnittpunkte (Längengrade) */
function scanlineCrossings(rings, lat) {
  const xs = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      if ((lat1 > lat) !== (lat2 > lat)) {
        xs.push(lon1 + (lat - lat1) / (lat2 - lat1) * (lon2 - lon1));
      }
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

function insideByParity(crossings, lon) {
  // Anzahl Schnittpunkte links vom Punkt — ungerade = innen
  let n = 0;
  for (const x of crossings) { if (x < lon) n++; else break; }
  return (n & 1) === 1;
}

/* ---------- Höhendaten ---------- */
/* Zwei Anbieter: OpenTopoData (ETOPO1, 1 Call/s, 1000/Tag) primär,
   open-meteo als Fallback. Pro Batch wird notfalls gewechselt. */
const ELEV_PROVIDERS = [
  {
    name: 'opentopodata/etopo1',
    delay: 1100,
    url: b => 'https://api.opentopodata.org/v1/etopo1?locations='
      + b.map(p => p[1].toFixed(4) + ',' + p[0].toFixed(4)).join('|'),
    parse: (json, n) => (json.results && json.results.length === n)
      ? json.results.map(r => r.elevation) : null,
  },
  {
    name: 'open-meteo',
    delay: 600,
    url: b => `${CONFIG.elevationApi}?latitude=${b.map(p => p[1].toFixed(4)).join(',')}&longitude=${b.map(p => p[0].toFixed(4)).join(',')}`,
    parse: (json, n) => (json.elevation && json.elevation.length === n) ? json.elevation : null,
  },
];

async function fetchElevations(points) {
  const out = new Array(points.length).fill(null);
  const chunk = 100;
  let failed = 0;
  let prov = 0;    // aktueller Anbieter (bleibt bei dem, der funktioniert)
  for (let i = 0; i < points.length; i += chunk) {
    const batch = points.slice(i, i + chunk);
    let ok = false;
    for (let p = 0; p < ELEV_PROVIDERS.length && !ok; p++) {
      const provider = ELEV_PROVIDERS[(prov + p) % ELEV_PROVIDERS.length];
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const res = await fetch(provider.url(batch));
          if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const vals = provider.parse(await res.json(), batch.length);
          if (!vals) throw new Error('Antwortformat');
          for (let k = 0; k < batch.length; k++) out[i + k] = vals[k];
          ok = true;
          prov = (prov + p) % ELEV_PROVIDERS.length;
          await sleep(provider.delay);
        } catch (e) {
          await sleep(1200 * (attempt + 1));
        }
      }
    }
    if (!ok) failed += batch.length;
    const done = Math.min(points.length, i + chunk);
    process.stdout.write(`\r  Höhen: ${done}/${points.length} (${Math.round(done / points.length * 100)} %) via ${ELEV_PROVIDERS[prov].name}${failed ? ` — ${failed} fehlgeschlagen` : ''}   `);
  }
  console.log();
  return { out, failed };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Deterministischer Zufall für Wald */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Hauptprogramm ---------- */
(async function main() {
  console.log(`FINAL FRONT Kartengenerator — ${CONFIG.W}x${CONFIG.H} Hexes, Europa ${CONFIG.lonMin}..${CONFIG.lonMax}°O / ${CONFIG.latMin}..${CONFIG.latMax}°N`);

  const land = await fetchFirst(CONFIG.landUrls, 'Natural Earth Land (50m)');
  if (!land) { console.error('FEHLER: Keine Landdaten erreichbar.'); process.exit(1); }
  const lakes = await fetchFirst(CONFIG.lakesUrls, 'Natural Earth Seen (50m)');

  const landRings = collectRings(land);
  const lakeRings = lakes ? collectRings(lakes) : [];
  console.log(`  ${landRings.length} Land-Ringe, ${lakeRings.length} See-Ringe im Fenster`);

  // 1) Land/Wasser per Scanline rastern
  const isLand = [];
  for (let r = 0; r < CONFIG.H; r++) {
    const lat = rowLat(r);
    const landX = scanlineCrossings(landRings, lat);
    const lakeX = scanlineCrossings(lakeRings, lat);
    const row = [];
    for (let c = 0; c < CONFIG.W; c++) {
      const lon = colLon(c, r);
      row.push(insideByParity(landX, lon) && !insideByParity(lakeX, lon));
    }
    isLand.push(row);
  }
  let landCount = isLand.flat().filter(Boolean).length;
  console.log(`  Landform gerastert: ${landCount} Land-Hexes von ${CONFIG.W * CONFIG.H}`);

  // 2) Echte Höhen für alle Land-Hexes
  const landPoints = [];
  const landIndex = [];
  for (let r = 0; r < CONFIG.H; r++) for (let c = 0; c < CONFIG.W; c++) {
    if (isLand[r][c]) { landPoints.push([colLon(c, r), rowLat(r)]); landIndex.push([c, r]); }
  }
  console.log(`  hole echte Höhendaten (Copernicus DEM via open-meteo.com)…`);
  let elev = null;
  try {
    const res = await fetchElevations(landPoints);
    // Teilergebnisse zählen: echte Höhe wo vorhanden, Fallback nur für Lücken
    const got = res.out.filter(x => x !== null).length;
    console.log(`  echte Höhenwerte: ${got}/${landPoints.length}`);
    if (got > landPoints.length * 0.4) elev = res.out;
    else console.log('  zu wenige echte Werte — nutze komplett Fallback-Gebirge.');
  } catch (e) {
    console.log('  Höhen-API nicht erreichbar — nutze Fallback-Gebirge: ' + e.message);
  }

  // 3) Terrain klassifizieren
  const rng = mulberry32(1337);
  const grid = [];
  for (let r = 0; r < CONFIG.H; r++) grid.push(new Array(CONFIG.W).fill('.'));

  const elevOf = new Map();
  if (elev) {
    landIndex.forEach(([c, r], i) => { if (elev[i] !== null) elevOf.set(c + r * 100000, elev[i]); });
  }
  const fallbackElev = (lon, lat) => {
    let e = 150;
    for (const [mlon, mlat, rad] of CONFIG.fallbackMountains) {
      const d = Math.hypot((lon - mlon) * Math.cos(lat * D2R), lat - mlat) / rad;
      if (d < 1) e = Math.max(e, 2200 * (1 - d));
    }
    return e;
  };

  for (let r = 0; r < CONFIG.H; r++) {
    const lat = rowLat(r);
    for (let c = 0; c < CONFIG.W; c++) {
      if (!isLand[r][c]) continue;
      const e = elevOf.has(c + r * 100000) ? elevOf.get(c + r * 100000) : fallbackElev(colLon(c, r), lat);
      const roll = rng();
      let t;
      if (e >= 1600 || (e >= 1250 && roll < 0.5)) t = 'm';
      else if (e >= 800 || (e >= 550 && roll < 0.35)) t = 'h';
      else {
        const forestChance = lat > 56 ? 0.45 : lat > 46 ? 0.2 : 0.07;
        t = roll < forestChance ? 'f' : 'p';
      }
      grid[r][c] = t;
    }
  }

  // 4) Spawns: echte Hauptstadt-Koordinaten aufs Gitter projizieren
  const spawns = {};
  for (const [id, [lon, lat]] of Object.entries(CONFIG.capitals)) {
    spawns[id] = lonLatToHex(lon, lat);
  }

  // 5) js/mapdata.js schreiben
  const rows = grid.map(r => r.join(''));
  const out = `/* Automatisch erzeugt von tools/genmap.js — NICHT von Hand editieren.
   Quelle Landform: Natural Earth 1:50m (Public Domain)
   Quelle Höhen:    ${elev ? 'Copernicus DEM GLO-90 via open-meteo.com' : 'prozeduraler Fallback'}
   Fenster: ${CONFIG.lonMin}..${CONFIG.lonMax}°O, ${CONFIG.latMin}..${CONFIG.latMax}°N (Miller-Projektion)
   Erzeugt: ${new Date().toISOString()} */
const GENMAP = {
  w: ${CONFIG.W},
  h: ${CONFIG.H},
  realElevation: ${!!elev},
  spawns: ${JSON.stringify(spawns)},
  rows: [
${rows.map(r => `    '${r}',`).join('\n')}
  ],
};
`;
  const outPath = path.join(__dirname, '..', 'js', 'mapdata.js');
  fs.writeFileSync(outPath, out);
  const terrainStats = {};
  for (const row of rows) for (const ch of row) terrainStats[ch] = (terrainStats[ch] || 0) + 1;
  console.log(`  geschrieben: ${outPath}`);
  console.log(`  Terrain: Wasser ${terrainStats['.'] || 0} · Ebene ${terrainStats['p'] || 0} · Wald ${terrainStats['f'] || 0} · Hügel ${terrainStats['h'] || 0} · Gebirge ${terrainStats['m'] || 0}`);
  console.log('Fertig.');
})();
