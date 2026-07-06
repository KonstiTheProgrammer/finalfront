/* =========================================================
   FINAL FRONT — tools/genmap.js
   Erzeugt js/mapdata.js (MEHRERE Karten) aus ECHTEN Geodaten:
   - Landform: Natural Earth ne_50m_land + ne_50m_lakes (GeoJSON, Public Domain)
   - Höhen:    OpenTopoData/Open-Meteo (Copernicus/ETOPO)
   - Flüsse:   Natural Earth ne_50m_rivers_lake_centerlines
   Ausführen:  node tools/genmap.js
   ========================================================= */

const fs = require('fs');
const path = require('path');

const MAPS = [
  { id: 'europa', name: 'Europa', W: 48, H: 54, lonMin: -11, lonMax: 42, latMin: 34, latMax: 71.5 },
  { id: 'mitteleuropa', name: 'Mitteleuropa', W: 32, H: 36, lonMin: 0, lonMax: 24, latMin: 43, latMax: 57 },
];

const URLS = {
  land: [
    'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_land.json',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson',
  ],
  lakes: [
    'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_lakes.json',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson',
  ],
  rivers: [
    'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_rivers_lake_centerlines.json',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson',
  ],
};

const RIVER_MAX_SCALERANK = 8;
const RIVER_MIN_CHAIN = 4;

/* ---------- Miller-Projektion (pro Karte) ---------- */
const D2R = Math.PI / 180;
const millerY = lat => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * D2R));

function makeProj(cfg) {
  const yTop = millerY(cfg.latMax);
  const yBot = millerY(cfg.latMin);
  return {
    rowLat(r) {
      const fy = (r + 0.5) / cfg.H;
      const y = yTop + fy * (yBot - yTop);
      return (Math.atan(Math.exp(y / 1.25)) - Math.PI / 4) / (0.4 * D2R);
    },
    colLon(c, r) {
      const fx = (c + 0.5 * (r & 1) + 0.5) / cfg.W;
      return cfg.lonMin + fx * (cfg.lonMax - cfg.lonMin);
    },
    lonLatToHex(lon, lat) {
      const y = millerY(lat);
      const r = Math.round(((y - yTop) / (yBot - yTop)) * cfg.H - 0.5);
      const c = Math.round(((lon - cfg.lonMin) / (cfg.lonMax - cfg.lonMin)) * cfg.W - 0.5 - 0.5 * (r & 1));
      return [c, r];
    },
  };
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

function collectRings(geojson, cfg) {
  const rings = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      let inBox = false;
      for (const [lon, lat] of ring) {
        if (lon >= cfg.lonMin - 2 && lon <= cfg.lonMax + 2
          && lat >= cfg.latMin - 2 && lat <= cfg.latMax + 2) { inBox = true; break; }
      }
      if (inBox) rings.push(ring);
    }
  }
  return rings;
}

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
  let n = 0;
  for (const x of crossings) { if (x < lon) n++; else break; }
  return (n & 1) === 1;
}

/* ---------- Höhendaten ---------- */
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
    url: b => `https://api.open-meteo.com/v1/elevation?latitude=${b.map(p => p[1].toFixed(4)).join(',')}&longitude=${b.map(p => p[0].toFixed(4)).join(',')}`,
    parse: (json, n) => (json.elevation && json.elevation.length === n) ? json.elevation : null,
  },
];

async function fetchElevations(points) {
  const out = new Array(points.length).fill(null);
  const chunk = 100;
  let failed = 0;
  let prov = 0;
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
    process.stdout.write(`\r    Höhen: ${done}/${points.length} (${Math.round(done / points.length * 100)} %)   `);
  }
  console.log();
  return { out, failed };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEIGHBORS_EVEN = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const NEIGHBORS_ODD = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];

/* ---------- Eine Karte erzeugen ---------- */
async function buildOneMap(cfg, landGeo, lakesGeo, riversGeo) {
  console.log(`\nKarte "${cfg.id}" — ${cfg.W}x${cfg.H}, ${cfg.lonMin}..${cfg.lonMax}°O / ${cfg.latMin}..${cfg.latMax}°N`);
  const proj = makeProj(cfg);
  const landRings = collectRings(landGeo, cfg);
  const lakeRings = lakesGeo ? collectRings(lakesGeo, cfg) : [];

  // 1) Land/Wasser rastern
  const isLand = [];
  for (let r = 0; r < cfg.H; r++) {
    const lat = proj.rowLat(r);
    const landX = scanlineCrossings(landRings, lat);
    const lakeX = scanlineCrossings(lakeRings, lat);
    const row = [];
    for (let c = 0; c < cfg.W; c++) {
      const lon = proj.colLon(c, r);
      row.push(insideByParity(landX, lon) && !insideByParity(lakeX, lon));
    }
    isLand.push(row);
  }
  console.log(`  Land: ${isLand.flat().filter(Boolean).length}/${cfg.W * cfg.H} Hexes`);

  // 2) Höhen
  const landPoints = [];
  const landIndex = [];
  for (let r = 0; r < cfg.H; r++) for (let c = 0; c < cfg.W; c++) {
    if (isLand[r][c]) { landPoints.push([proj.colLon(c, r), proj.rowLat(r)]); landIndex.push([c, r]); }
  }
  let elev = null;
  try {
    const res = await fetchElevations(landPoints);
    const got = res.out.filter(x => x !== null).length;
    if (got > landPoints.length * 0.4) elev = res.out;
  } catch (e) { /* Fallback unten */ }

  // 3) Terrain klassifizieren
  const rng = mulberry32(1337);
  const grid = [];
  for (let r = 0; r < cfg.H; r++) grid.push(new Array(cfg.W).fill('.'));
  const elevOf = new Map();
  if (elev) landIndex.forEach(([c, r], i) => { if (elev[i] !== null) elevOf.set(c + r * 100000, elev[i]); });

  for (let r = 0; r < cfg.H; r++) {
    const lat = proj.rowLat(r);
    for (let c = 0; c < cfg.W; c++) {
      if (!isLand[r][c]) continue;
      const e = elevOf.has(c + r * 100000) ? elevOf.get(c + r * 100000) : 150;
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

  // 4) Flüsse rastern
  const marked = new Set();
  if (riversGeo) {
    for (const f of riversGeo.features) {
      const props = f.properties || {};
      if (String(props.featurecla || '').includes('Lake Centerline')) continue;
      const rank = props.scalerank !== undefined ? props.scalerank : 9;
      if (rank > RIVER_MAX_SCALERANK) continue;
      const g = f.geometry;
      if (!g) continue;
      const lines = g.type === 'LineString' ? [g.coordinates]
        : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) {
        for (let i = 0; i < line.length - 1; i++) {
          const [lon1, lat1] = line[i];
          const [lon2, lat2] = line[i + 1];
          if (Math.max(lon1, lon2) < cfg.lonMin || Math.min(lon1, lon2) > cfg.lonMax) continue;
          if (Math.max(lat1, lat2) < cfg.latMin || Math.min(lat1, lat2) > cfg.latMax) continue;
          const steps = Math.max(1, Math.ceil(Math.hypot(lon2 - lon1, lat2 - lat1) / 0.04));
          for (let s = 0; s <= steps; s++) {
            const lon = lon1 + (lon2 - lon1) * s / steps;
            const lat = lat1 + (lat2 - lat1) * s / steps;
            const [c, r] = proj.lonLatToHex(lon, lat);
            if (c < 0 || c >= cfg.W || r < 0 || r >= cfg.H) continue;
            if (grid[r][c] === '.') continue;
            marked.add(c + r * cfg.W);
          }
        }
      }
    }
    // Mini-Schnipsel entfernen
    const seen = new Set();
    const drop = [];
    for (const key of marked) {
      if (seen.has(key)) continue;
      const comp = [key];
      seen.add(key);
      for (let i = 0; i < comp.length; i++) {
        const c = comp[i] % cfg.W, r = Math.floor(comp[i] / cfg.W);
        const deltas = (r & 1) ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
        for (const [dc, dr] of deltas) {
          const k = (c + dc) + (r + dr) * cfg.W;
          if (marked.has(k) && !seen.has(k)) { seen.add(k); comp.push(k); }
        }
      }
      if (comp.length < RIVER_MIN_CHAIN) drop.push(...comp);
    }
    for (const k of drop) marked.delete(k);
  }
  console.log(`  Flüsse: ${marked.size} Hexes`);

  const rows = grid.map(r => r.join(''));
  const riverRows = [];
  for (let r = 0; r < cfg.H; r++) {
    let row = '';
    for (let c = 0; c < cfg.W; c++) row += marked.has(c + r * cfg.W) ? 'r' : '.';
    riverRows.push(row);
  }
  const stats = {};
  for (const row of rows) for (const ch of row) stats[ch] = (stats[ch] || 0) + 1;
  console.log(`  Terrain: Wasser ${stats['.'] || 0} · Ebene ${stats['p'] || 0} · Wald ${stats['f'] || 0} · Hügel ${stats['h'] || 0} · Gebirge ${stats['m'] || 0}`);
  return { name: cfg.name, w: cfg.W, h: cfg.H, rows, rivers: riverRows };
}

/* ---------- Hauptprogramm ---------- */
(async function main() {
  console.log(`FINAL FRONT Kartengenerator — ${MAPS.length} Karten`);
  const land = await fetchFirst(URLS.land, 'Natural Earth Land (50m)');
  if (!land) { console.error('FEHLER: Keine Landdaten erreichbar.'); process.exit(1); }
  const lakes = await fetchFirst(URLS.lakes, 'Natural Earth Seen (50m)');
  const rivers = await fetchFirst(URLS.rivers, 'Natural Earth Flüsse (50m)');

  const maps = {};
  for (const cfg of MAPS) {
    maps[cfg.id] = await buildOneMap(cfg, land, lakes, rivers);
  }

  const entries = Object.entries(maps).map(([id, m]) => `  ${id}: {
    name: ${JSON.stringify(m.name)},
    w: ${m.w},
    h: ${m.h},
    rows: [
${m.rows.map(r => `      '${r}',`).join('\n')}
    ],
    rivers: [
${m.rivers.map(r => `      '${r}',`).join('\n')}
    ],
  },`).join('\n');

  const out = `/* Automatisch erzeugt von tools/genmap.js — NICHT von Hand editieren.
   Quellen: Natural Earth 1:50m (Land/Seen/Flüsse, Public Domain),
   Höhen via OpenTopoData/Open-Meteo. Miller-Projektion.
   Erzeugt: ${new Date().toISOString()} */
const GENMAPS = {
${entries}
};
`;
  const outPath = path.join(__dirname, '..', 'js', 'mapdata.js');
  fs.writeFileSync(outPath, out);
  console.log(`\ngeschrieben: ${outPath}`);
  console.log('Fertig.');
})();
