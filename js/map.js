/* =========================================================
   FINAL FRONT — map.js
   Die Karte kommt aus js/mapdata.js (GENMAP), erzeugt von
   tools/genmap.js aus ECHTEN Geodaten:
   Natural-Earth-Küstenlinien + Copernicus-Höhenmodell.
   Hexgitter: odd-r offset, pointy-top.
   ========================================================= */

/* ---------- Kartenwahl: mehrere Karten in GENMAPS ---------- */
let CURRENT_MAP_ID = 'europa';
let MAP_W = 1, MAP_H = 1, WORLD_W = 1, WORLD_H = 1;

function selectMap(id) {
  CURRENT_MAP_ID = GENMAPS[id] ? id : Object.keys(GENMAPS)[0];
  const m = GENMAPS[CURRENT_MAP_ID];
  MAP_W = m.w;
  MAP_H = m.h;
  WORLD_W = HEX_SIZE * SQRT3 * (MAP_W + 0.5) + HEX_SIZE * 2;
  WORLD_H = HEX_SIZE * 1.5 * MAP_H + HEX_SIZE * 2;
  return CURRENT_MAP_ID;
}

/* Spieler-Definitionen: 5 Farben, ein Match = 5 Spieler (Mensch + Bots).
   Startplätze werden in der Spawn-Phase frei gewählt — keine festen Spawns. */
const NATION_DEFS = {
  A: { name: 'Azur',    color: '#4a72c4', capitalName: 'Feste Azur',    aggression: 0.40 },
  B: { name: 'Karmin',  color: '#c0504e', capitalName: 'Feste Karmin',  aggression: 0.50 },
  C: { name: 'Jade',    color: '#42a55c', capitalName: 'Feste Jade',    aggression: 0.35 },
  D: { name: 'Gold',    color: '#d4b13f', capitalName: 'Feste Gold',    aggression: 0.30 },
  E: { name: 'Violett', color: '#8a63b8', capitalName: 'Feste Violett', aggression: 0.45 },
};

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
selectMap(CURRENT_MAP_ID);   // Standardkarte laden (setzt MAP_W/H, WORLD_W/H)

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
    const rowStr = GENMAPS[CURRENT_MAP_ID].rows[r] || '';
    const arr = [];
    const riverStr = (GENMAPS[CURRENT_MAP_ID].rivers && GENMAPS[CURRENT_MAP_ID].rivers[r]) || '';
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
  // Flachwasser markieren (Wasser mit Landkontakt) — für den Küstensaum im Renderer
  for (let r = 0; r < MAP_H; r++) for (let c = 0; c < MAP_W; c++) {
    const h = hexes[r][c];
    if (h.terrain !== 'water') continue;
    for (const [nc, nr] of neighborsOf(c, r)) {
      if (hexes[nr][nc].terrain !== 'water') { h.coastal = true; break; }
    }
  }
  return hexes;
}

/* Validierung (Debug) */
function validateMap(hexes) {
  const issues = [];
  let land = 0;
  for (const row of hexes) for (const h of row) if (h.terrain !== 'water') land++;
  if (land < MAP_W * MAP_H * 0.2) issues.push(`Nur ${land} Land-Hexes?`);
  return { issues, land, map: CURRENT_MAP_ID };
}
