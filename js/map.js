/* =========================================================
   FINAL FRONT — map.js
   Die Karte kommt aus js/mapdata.js (GENMAP), erzeugt von
   tools/genmap.js aus ECHTEN Geodaten:
   Natural-Earth-Küstenlinien + Copernicus-Höhenmodell.
   Hexgitter: odd-r offset, pointy-top.
   ========================================================= */

const MAP_W = GENMAP.w;
const MAP_H = GENMAP.h;

/* Nationen-Definitionen. Spawn-Hexes kommen aus den echten
   Hauptstadt-Koordinaten (via Projektion in mapdata.js). */
const NATION_DEFS = {
  G: { name: 'Großbritannien', color: '#c0504e', capitalName: 'London',    aggression: 0.35 },
  J: { name: 'Irland',         color: '#79ad58', capitalName: 'Dublin',    aggression: 0.15 },
  F: { name: 'Frankreich',     color: '#4a72c4', capitalName: 'Paris',     aggression: 0.40 },
  L: { name: 'Benelux',        color: '#d98e32', capitalName: 'Brüssel',   aggression: 0.15 },
  D: { name: 'Deutschland',    color: '#6e7480', capitalName: 'Berlin',    aggression: 0.55 },
  W: { name: 'Schweiz',        color: '#dedede', capitalName: 'Bern',      aggression: 0.10 },
  I: { name: 'Italien',        color: '#42a55c', capitalName: 'Rom',       aggression: 0.45 },
  S: { name: 'Spanien',        color: '#d4b13f', capitalName: 'Madrid',    aggression: 0.30 },
  O: { name: 'Portugal',       color: '#3e8f7a', capitalName: 'Lissabon',  aggression: 0.18 },
  N: { name: 'Skandinavien',   color: '#5f9ec9', capitalName: 'Stockholm', aggression: 0.25 },
  P: { name: 'Polen',          color: '#c268a8', capitalName: 'Warschau',  aggression: 0.30 },
  H: { name: 'Österreich-Ungarn', color: '#b07a45', capitalName: 'Wien',   aggression: 0.40 },
  B: { name: 'Balkanbund',     color: '#8a63b8', capitalName: 'Belgrad',   aggression: 0.35 },
  R: { name: 'Russland',       color: '#a03028', capitalName: 'Moskau',    aggression: 0.50 },
  T: { name: 'Türkei',         color: '#3fb0a5', capitalName: 'Ankara',    aggression: 0.40 },
};
for (const [id, def] of Object.entries(NATION_DEFS)) {
  def.spawnHex = GENMAP.spawns[id] || [Math.floor(MAP_W / 2), Math.floor(MAP_H / 2)];
}

/* Terrain-Eigenschaften */
const TERRAIN = {
  water:    { name: 'Meer',    move: 2.6, def: 1.0,  buildable: false },
  plains:   { name: 'Ebene',   move: 1.0, def: 1.0,  buildable: true },
  forest:   { name: 'Wald',    move: 1.35, def: 1.25, buildable: true },
  hills:    { name: 'Hügel',   move: 1.6, def: 1.45, buildable: true },
  mountain: { name: 'Gebirge', move: 2.2, def: 1.8,  buildable: false },
};
const TERRAIN_CODE = { '.': 'water', p: 'plains', f: 'forest', h: 'hills', m: 'mountain' };

/* ---------- Hex-Mathematik (odd-r offset, pointy-top) ---------- */
const HEX_SIZE = 12;
const SQRT3 = Math.sqrt(3);

function hexToPixel(c, r) {
  return {
    x: HEX_SIZE * SQRT3 * (c + 0.5 * (r & 1)) + HEX_SIZE,
    y: HEX_SIZE * 1.5 * r + HEX_SIZE,
  };
}
const WORLD_W = HEX_SIZE * SQRT3 * (MAP_W + 0.5) + HEX_SIZE * 2;
const WORLD_H = HEX_SIZE * 1.5 * MAP_H + HEX_SIZE * 2;

function pixelToHex(x, y) {
  const rApprox = Math.round((y - HEX_SIZE) / (HEX_SIZE * 1.5));
  let best = null, bestD = Infinity;
  for (let r = rApprox - 1; r <= rApprox + 1; r++) {
    if (r < 0 || r >= MAP_H) continue;
    const cApprox = Math.round((x - HEX_SIZE) / (HEX_SIZE * SQRT3) - 0.5 * (r & 1));
    for (let c = cApprox - 1; c <= cApprox + 1; c++) {
      if (c < 0 || c >= MAP_W) continue;
      const p = hexToPixel(c, r);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; best = { c, r }; }
    }
  }
  return best;
}

const NEIGHBORS_EVEN = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
const NEIGHBORS_ODD  = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]];

function neighborsOf(c, r) {
  const deltas = (r & 1) ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
  const out = [];
  for (const [dc, dr] of deltas) {
    const nc = c + dc, nr = r + dr;
    if (nc >= 0 && nc < MAP_W && nr >= 0 && nr < MAP_H) out.push([nc, nr]);
  }
  return out;
}

function hexDist(c1, r1, c2, r2) {
  const q1 = c1 - ((r1 - (r1 & 1)) >> 1), q2 = c2 - ((r2 - (r2 & 1)) >> 1);
  const dq = q1 - q2, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Karte aus den echten Daten aufbauen ---------- */
function buildMap() {
  const rng = mulberry32(1337);
  const hexes = [];
  for (let r = 0; r < MAP_H; r++) {
    const rowStr = GENMAP.rows[r] || '';
    const arr = [];
    const riverStr = (GENMAP.rivers && GENMAP.rivers[r]) || '';
    for (let c = 0; c < MAP_W; c++) {
      const terrain = TERRAIN_CODE[rowStr[c]] || 'water';
      arr.push({
        c, r,
        terrain,
        river: terrain !== 'water' && riverStr[c] === 'r',   // echte Flüsse (Natural Earth)
        owner: null,           // FFA: alles Land startet neutral
        building: null,
        road: false,
        capital: false,
        cityName: null,
        resist: 0, resistMax: 0,
        supply: 0,
        shade: 0.955 + rng() * 0.09,   // dezente Textur, kein Flickenteppich
      });
    }
    hexes.push(arr);
  }
  // Einzelne Wasser-Sprenkel (Mini-Seen aus den Rohdaten) zu Land füllen —
  // echte Seen wie Ladoga bleiben, weil sie mehrere Hexes groß sind.
  for (let r = 0; r < MAP_H; r++) for (let c = 0; c < MAP_W; c++) {
    const h = hexes[r][c];
    if (h.terrain !== 'water') continue;
    let landN = 0, total = 0;
    for (const [nc, nr] of neighborsOf(c, r)) {
      total++;
      if (hexes[nr][nc].terrain !== 'water') landN++;
    }
    if (total === 6 && landN >= 5) h.terrain = 'plains';
  }
  return hexes;
}

/* Validierung (Debug) */
function validateMap(hexes) {
  const issues = [];
  let land = 0;
  for (const row of hexes) for (const h of row) if (h.terrain !== 'water') land++;
  if (land < MAP_W * MAP_H * 0.25) issues.push(`Nur ${land} Land-Hexes?`);
  for (const [id, def] of Object.entries(NATION_DEFS)) {
    const [sc, sr] = def.spawnHex;
    let ok = false;
    for (let r = Math.max(0, sr - 6); r <= Math.min(MAP_H - 1, sr + 6) && !ok; r++)
      for (let c = Math.max(0, sc - 6); c <= Math.min(MAP_W - 1, sc + 6) && !ok; c++)
        if (hexes[r][c].terrain !== 'water') ok = true;
    if (!ok) issues.push(`Spawn von ${def.name} (${sc},${sr}) liegt mitten im Meer`);
  }
  return { issues, land };
}
