/* =========================================================
   FINAL FRONT — ui.js
   Rendering (Hybrid), Eingabe (RTS-Stil), Minimap, Panels,
   Allianz-Angebote, Toasts, Start-/Endbildschirm.

   Eingabe:  Links-Ziehen = Box-Auswahl · Linksklick = wählen
             Rechtsklick  = Front zuweisen / Marsch / Allianz
             Rechts-/Mittel-Ziehen, WASD = Karte bewegen
   ========================================================= */

const UI = {
  canvas: null, ctx: null,
  mapLayer: null, mapCtx: null,
  ovLayer: null, ovCtx: null,     // flache Übersichtsebene für weite Zooms
  MAP_SCALE: 1.1,
  OV_SCALE: 0.55,
  OV_ZMAX: 0.92,                  // bis zu diesem Zoom: ruhige Übersichtsebene
  ZSWITCH: 1.35,
  minimap: null, minimapBase: null,
  cam: { x: 0, y: 0, zoom: 0.6 },
  selectedHex: null,
  selectedDivs: new Set(),
  selectedArmy: null,
  hoverHex: null,
  activeTab: 'bauen',
  drag: null,
  boxSel: null,
  buildMode: null,
  supplyOverlay: false,
  keys: new Set(),
  labels: null,
  _lastMapRender: 0,
  lastPanelUpdate: 0,
  _paintToastT: 0,
};

const NEUTRAL_COLOR = '#a8aba4';

/* ---------- Farb-Helfer ---------- */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.min(255, Math.max(0, Math.round(r * f)));
  g = Math.min(255, Math.max(0, Math.round(g * f)));
  b = Math.min(255, Math.max(0, Math.round(b * f)));
  return `rgb(${r},${g},${b})`;
}

function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}

function hexPath(ctx, cx, cy, size) {
  const pts = hexCorners(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/* ---------- Setup ---------- */
function uiInit() {
  UI.canvas = document.getElementById('map');
  UI.ctx = UI.canvas.getContext('2d');
  UI.mapLayer = document.createElement('canvas');
  UI.mapLayer.width = Math.round(WORLD_W * UI.MAP_SCALE);
  UI.mapLayer.height = Math.round(WORLD_H * UI.MAP_SCALE);
  UI.mapCtx = UI.mapLayer.getContext('2d');
  UI.ovLayer = document.createElement('canvas');
  UI.ovLayer.width = Math.round(WORLD_W * UI.OV_SCALE);
  UI.ovLayer.height = Math.round(WORLD_H * UI.OV_SCALE);
  UI.ovCtx = UI.ovLayer.getContext('2d');
  UI.minimap = document.getElementById('minimap');
  UI.minimap.width = 220;
  UI.minimap.height = Math.round(220 * WORLD_H / WORLD_W);
  UI.minimapBase = document.createElement('canvas');
  UI.minimapBase.width = UI.minimap.width;
  UI.minimapBase.height = UI.minimap.height;

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  bindInput();
  bindPanels();
  bindMinimap();
}

function resizeCanvas() {
  UI.canvas.width = window.innerWidth;
  UI.canvas.height = window.innerHeight;
}

/* Breite der linken UI (Menüleiste + ggf. offenes Panel) */
function leftUIW() {
  return 52 + (UI.activeTab ? 308 : 0);
}

function fitZoom() {
  return Math.min((window.innerWidth - leftUIW() - 20) / WORLD_W, (window.innerHeight - 60) / WORLD_H);
}

function fitView() {
  UI.cam.zoom = fitZoom();
  UI.cam.x = WORLD_W / 2 - (window.innerWidth + leftUIW()) / 2 / UI.cam.zoom;
  UI.cam.y = WORLD_H / 2 - (window.innerHeight + 44) / 2 / UI.cam.zoom;
}

function centerOn(c, r, zoom) {
  const p = hexToPixel(c, r);
  if (zoom) UI.cam.zoom = zoom;
  UI.cam.x = p.x - (window.innerWidth + leftUIW()) / 2 / UI.cam.zoom;
  UI.cam.y = p.y - window.innerHeight / 2 / UI.cam.zoom;
}

function camClamp() {
  const m = 260 / UI.cam.zoom;
  const viewW = window.innerWidth / UI.cam.zoom;
  const viewH = window.innerHeight / UI.cam.zoom;
  UI.cam.x = Math.max(-m, Math.min(WORLD_W - viewW + m, UI.cam.x));
  UI.cam.y = Math.max(-m, Math.min(WORLD_H - viewH + m, UI.cam.y));
}

/* =========================================================
   SPRITES — Terrain & Gebäude
   ========================================================= */
function drawTerrainArt(ctx, h, x, y, detailed) {
  if (h.terrain === 'mountain') {
    ctx.fillStyle = 'rgba(52,50,58,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 4.5); ctx.lineTo(x - 1.2, y - 4.8); ctx.lineTo(x + 3.5, y + 4.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(84,80,90,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 1.2, y - 4.8); ctx.lineTo(x + 3.5, y + 4.5); ctx.lineTo(x + 1, y + 4.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(245,245,252,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - 2.9, y - 1.4); ctx.lineTo(x - 1.2, y - 4.8); ctx.lineTo(x + 0.6, y - 1.2);
    ctx.lineTo(x - 0.5, y - 2); ctx.lineTo(x - 1.6, y - 1);
    ctx.closePath(); ctx.fill();
    if (detailed) {
      ctx.fillStyle = 'rgba(40,38,46,0.8)';
      ctx.beginPath();
      ctx.moveTo(x + 1.8, y + 4.5); ctx.lineTo(x + 4.8, y - 0.4); ctx.lineTo(x + 7.4, y + 4.5);
      ctx.closePath(); ctx.fill();
    }
  } else if (h.terrain === 'hills') {
    ctx.fillStyle = 'rgba(96,78,50,0.4)';
    ctx.beginPath(); ctx.arc(x - 3, y + 3, 3.2, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3, y + 4, 2.5, Math.PI, 0); ctx.closePath(); ctx.fill();
    if (detailed) {
      ctx.strokeStyle = 'rgba(60,48,30,0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x - 3, y + 3, 3.2, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 3, y + 4, 2.5, Math.PI, 0); ctx.stroke();
    }
  } else if (h.terrain === 'forest') {
    const tree = (tx, ty, s) => {
      if (detailed) {
        ctx.fillStyle = 'rgba(74,52,32,0.9)';
        ctx.fillRect(tx - 0.6, ty + s * 0.4, 1.2, s * 0.55);
      }
      ctx.fillStyle = 'rgba(26,74,38,0.85)';
      ctx.beginPath();
      ctx.moveTo(tx, ty - s); ctx.lineTo(tx - s * 0.7, ty + s * 0.45); ctx.lineTo(tx + s * 0.7, ty + s * 0.45);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(40,98,52,0.9)';
      ctx.beginPath();
      ctx.moveTo(tx, ty - s * 1.15); ctx.lineTo(tx - s * 0.5, ty - s * 0.1); ctx.lineTo(tx + s * 0.5, ty - s * 0.1);
      ctx.closePath(); ctx.fill();
    };
    tree(x - 3, y + 1.7, 3.1);
    tree(x + 2.6, y + 0.4, 2.8);
    if (detailed) tree(x + 0.2, y + 3.8, 2.4);
  }
}

function drawBuilding(ctx, h, x, y, detailed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = detailed ? 0.9 : 0.8;
  if (h.building === 'dorf') {
    const house = (hx, hy, w, hh, roof) => {
      ctx.fillStyle = '#ecdcba'; ctx.strokeStyle = '#423522';
      ctx.fillRect(hx - w / 2, hy, w, hh); ctx.strokeRect(hx - w / 2, hy, w, hh);
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(hx - w / 2 - 1, hy); ctx.lineTo(hx, hy - hh * 0.9); ctx.lineTo(hx + w / 2 + 1, hy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (detailed) { ctx.fillStyle = '#5b4630'; ctx.fillRect(hx - 0.7, hy + hh - 2.3, 1.5, 2.3); }
    };
    house(-3, -0.5, 5.4, 4.2, '#b0552e');
    house(3.2, 0.7, 4.5, 3.4, '#9c4a28');
  } else if (h.building === 'stadt') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-6.2, 4.4, 13.2, 1.4);
    const tower = (tx, w, hh, col) => {
      ctx.fillStyle = col; ctx.strokeStyle = '#232a36';
      ctx.fillRect(tx, 4.4 - hh, w, hh); ctx.strokeRect(tx, 4.4 - hh, w, hh);
      if (detailed) {
        ctx.fillStyle = '#f5e9b8';
        for (let wy = 4.4 - hh + 1.4; wy < 2.5; wy += 2.4)
          for (let wx = tx + 0.9; wx < tx + w - 0.9; wx += 2)
            ctx.fillRect(wx, wy, 0.9, 1.2);
      }
    };
    tower(-6.2, 3.9, 7, '#c9d0da');
    tower(-1.8, 4.2, 10.5, '#dde3ec');
    tower(3, 3.7, 8.4, '#b8c0cc');
  } else if (h.building === 'mine') {
    ctx.fillStyle = '#60564a'; ctx.strokeStyle = '#241f1a';
    ctx.beginPath(); ctx.moveTo(-6, 4.8); ctx.lineTo(0, -4.8); ctx.lineTo(6, 4.8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#17120e';
    ctx.beginPath(); ctx.moveTo(-2.3, 4.8); ctx.lineTo(0, 0.7); ctx.lineTo(2.3, 4.8);
    ctx.closePath(); ctx.fill();
    if (detailed) {
      ctx.strokeStyle = '#8a6f4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-2.3, 4.8); ctx.lineTo(-1.2, 1.9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2.3, 4.8); ctx.lineTo(1.2, 1.9); ctx.stroke();
    }
    ctx.fillStyle = '#f5c542';
    ctx.fillRect(-1, -4, 2, 1.9);
  } else if (h.building === 'hafen') {
    // Lagerhaus
    ctx.fillStyle = '#7d8a99'; ctx.strokeStyle = '#232a36';
    ctx.fillRect(-6, -2.2, 7, 4.8); ctx.strokeRect(-6, -2.2, 7, 4.8);
    ctx.fillStyle = '#5a6675';
    ctx.beginPath();
    ctx.moveTo(-6.7, -2.2); ctx.lineTo(-2.5, -5); ctx.lineTo(1.7, -2.2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Pier
    ctx.fillStyle = '#8a6f4a'; ctx.strokeStyle = '#4a3a24';
    ctx.fillRect(1.4, 1.2, 6.6, 2);
    if (detailed) {
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(3.2, 1.2); ctx.lineTo(3.2, 3.8);
      ctx.moveTo(5.2, 1.2); ctx.lineTo(5.2, 3.8);
      ctx.moveTo(7.2, 1.2); ctx.lineTo(7.2, 3.8);
      ctx.stroke();
      ctx.fillStyle = '#c9d0da';
      ctx.fillRect(-4.9, -1.2, 2, 2);   // Tor
    }
    // Mast mit Wimpel
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(4.6, 1.2); ctx.lineTo(4.6, -4.8); ctx.stroke();
    ctx.fillStyle = '#4aa3d9';
    ctx.beginPath(); ctx.moveTo(4.6, -4.8); ctx.lineTo(7.8, -4); ctx.lineTo(4.6, -3.1);
    ctx.closePath(); ctx.fill();
  } else if (h.building === 'kaserne') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-5.7, 3.5, 12.3, 1.2);
    ctx.fillStyle = '#75824f'; ctx.strokeStyle = '#2b3320';
    ctx.fillRect(-5.7, -1.3, 11.4, 4.8); ctx.strokeRect(-5.7, -1.3, 11.4, 4.8);
    ctx.fillStyle = '#5c6a40';
    ctx.beginPath(); ctx.moveTo(-6.3, -1.3); ctx.lineTo(0, -4); ctx.lineTo(6.3, -1.3);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (detailed) {
      ctx.fillStyle = '#2f3823';
      ctx.fillRect(-1, 0.4, 2, 3.1);
      ctx.fillRect(-4.4, 0.4, 1.4, 1.6); ctx.fillRect(3, 0.4, 1.4, 1.6);
    }
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(4.7, -3.8); ctx.lineTo(4.7, -8); ctx.stroke();
    ctx.fillStyle = '#d84343';
    ctx.beginPath(); ctx.moveTo(4.7, -8); ctx.lineTo(8.4, -7.1); ctx.lineTo(4.7, -5.9);
    ctx.closePath(); ctx.fill();
  }
  if (h.capital || h.vp) {
    // Siegpunkt-Hauptstädte behalten ihren Stern dauerhaft — sie sind das Rundenziel
    if (h.vp) {
      ctx.strokeStyle = 'rgba(255,215,94,0.55)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, h.building ? -8.4 : 0, 7.2, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = '#ffd75e'; ctx.strokeStyle = '#6b5100'; ctx.lineWidth = 1;
    star(ctx, 0, h.building ? -8.4 : 0, 4.5);
  }
  ctx.restore();
}

function star(ctx, x, y, s) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 5 * i - Math.PI / 2;
    const rad = i % 2 === 0 ? s : s * 0.45;
    const px = x + rad * Math.cos(a), py = y + rad * Math.sin(a);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

/* ---------- Zeichen-Bausteine ---------- */
function fillHex(ctx, h, p) {
  const base = h.owner ? NATION_DEFS[h.owner].color : NEUTRAL_COLOR;
  hexPath(ctx, p.x, p.y, HEX_SIZE + 0.55);
  ctx.fillStyle = shade(base, h.shade);
  ctx.fill();
}

function drawRoadsAt(ctx, h, p) {
  if (!h.road) return;
  let connected = false;
  for (const [nc, nr] of neighborsOf(h.c, h.r)) {
    const nh = game.hexAt(nc, nr);
    if (nh && (nh.road || nh.building || nh.capital)) {
      const np = hexToPixel(nc, nr);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo((p.x + np.x) / 2, (p.y + np.y) / 2);
      ctx.stroke();
      connected = true;
    }
  }
  if (!connected) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.stroke(); }
}

function drawBordersAt(ctx, h, p, thick) {
  if (!h.owner) return;   // Neutralland: nur Küste unten via Wasserkontrast
  const corners = hexCorners(p.x, p.y, HEX_SIZE + 0.55);
  const inner = hexCorners(p.x, p.y, HEX_SIZE - 2);
  const deltas = (h.r & 1) ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
  for (let i = 0; i < 6; i++) {
    const [dc, dr] = deltas[i];
    const nh = game.hexAt(h.c + dc, h.r + dr);
    if (nh && nh.owner === h.owner) continue;
    const isCoastOrNeutral = !nh || nh.terrain === 'water' || !nh.owner;
    const np = nh ? hexToPixel(h.c + dc, h.r + dr) : { x: p.x + (dc || 0.1) * 20, y: p.y + dr * 20 };
    let bi = 0, bd = Infinity;
    for (let e = 0; e < 6; e++) {
      const mx = (corners[e][0] + corners[(e + 1) % 6][0]) / 2;
      const my = (corners[e][1] + corners[(e + 1) % 6][1]) / 2;
      const d = (mx - np.x) ** 2 + (my - np.y) ** 2;
      if (d < bd) { bd = d; bi = e; }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = thick * 1.7;
    ctx.beginPath();
    ctx.moveTo(inner[bi][0], inner[bi][1]);
    ctx.lineTo(inner[(bi + 1) % 6][0], inner[(bi + 1) % 6][1]);
    ctx.stroke();
    ctx.strokeStyle = isCoastOrNeutral ? 'rgba(12,18,26,0.9)' : shade(NATION_DEFS[h.owner].color, 0.38);
    ctx.lineWidth = isCoastOrNeutral ? thick * 1.05 : thick;
    ctx.beginPath();
    ctx.moveTo(corners[bi][0], corners[bi][1]);
    ctx.lineTo(corners[(bi + 1) % 6][0], corners[(bi + 1) % 6][1]);
    ctx.stroke();
  }
}

/* ---------- Statische Kartenebene ---------- */
function renderMapLayer() {
  const ctx = UI.mapCtx;
  const S = UI.MAP_SCALE;
  const rect = game._dirtyAll ? null : game.dirtyRect;
  // WICHTIG gegen Nähte: der Neuzeichnungs-Ring (±3 Hexes) muss ÜBER den
  // Clip-Rand (±2,6 Hexbreiten) hinausreichen, damit am Rand keine
  // angeschnittenen Nachbar-Hexes stehen bleiben.
  let c0 = 0, r0 = 0, c1 = MAP_W - 1, r1 = MAP_H - 1;
  let rx = 0, ry = 0, rw = WORLD_W, rh = WORLD_H;
  if (rect) {
    c0 = Math.max(0, rect.c0 - 3); r0 = Math.max(0, rect.r0 - 3);
    c1 = Math.min(MAP_W - 1, rect.c1 + 3); r1 = Math.min(MAP_H - 1, rect.r1 + 3);
    const q0 = hexToPixel(rect.c0, rect.r0), q1 = hexToPixel(rect.c1, rect.r1);
    rx = q0.x - HEX_SIZE * 2.6; ry = q0.y - HEX_SIZE * 2.4;
    rw = q1.x - q0.x + HEX_SIZE * 5.8; rh = q1.y - q0.y + HEX_SIZE * 4.8;
  }
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.save();
  ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();

  const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  grad.addColorStop(0, '#1d3247');
  grad.addColorStop(1, '#152638');
  ctx.fillStyle = grad;
  ctx.fillRect(rx, ry, rw, rh);

  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (h.terrain === 'water') continue;
    const p = hexToPixel(c, r);
    fillHex(ctx, h, p);
    drawTerrainArt(ctx, h, p.x, p.y, false);
  }
  ctx.strokeStyle = 'rgba(88,68,44,0.95)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (h.road) drawRoadsAt(ctx, h, hexToPixel(c, r));
  }
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (h.terrain === 'water') continue;
    drawBordersAt(ctx, h, hexToPixel(c, r), 2.2);
  }
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (h.building || h.capital || h.vp) {
      const p = hexToPixel(c, r);
      drawBuilding(ctx, h, p.x, p.y, false);
    }
  }
  ctx.restore();
  renderOverviewRegion(c0, r0, c1, r1, rx, ry, rw, rh);
  game.mapDirty = false;
  game.dirtyRect = null;
  game._dirtyAll = false;
  updateMinimapBase();
}

/* Flache Übersichtsebene: satte Farben, keine Icons, kein Rauschen —
   dadurch sieht die Karte weit herausgezoomt sauber aus. */
function renderOverviewRegion(c0, r0, c1, r1, rx, ry, rw, rh) {
  const ctx = UI.ovCtx;
  const S = UI.OV_SCALE;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.save();
  ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();

  const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  grad.addColorStop(0, '#1d3247');
  grad.addColorStop(1, '#152638');
  ctx.fillStyle = grad;
  ctx.fillRect(rx, ry, rw, rh);

  // Flächen: flache Farben, leicht überlappend gegen Fugen
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (h.terrain === 'water') continue;
    const p = hexToPixel(c, r);
    hexPath(ctx, p.x, p.y, HEX_SIZE + 1.1);
    ctx.fillStyle = h.owner ? NATION_DEFS[h.owner].color : NEUTRAL_COLOR;
    ctx.fill();
    // nur Gebirge dezent tönen — alles andere bleibt ruhig und flächig
    if (h.terrain === 'mountain') {
      ctx.fillStyle = 'rgba(30,28,36,0.22)';
      ctx.fill();
    } else if (h.terrain === 'hills') {
      ctx.fillStyle = 'rgba(50,42,28,0.08)';
      ctx.fill();
    }
  }
  // Grenzen: nur Küste + Nationsgrenzen, kräftig und ruhig
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (h.terrain === 'water' || !h.owner) continue;
    const pp = hexToPixel(c, r);
    const corners = hexCorners(pp.x, pp.y, HEX_SIZE + 1.1);
    const deltas = (r & 1) ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
    for (let i = 0; i < 6; i++) {
      const [dc, dr] = deltas[i];
      const nh = game.hexAt(c + dc, r + dr);
      if (nh && nh.owner === h.owner) continue;
      const p = hexToPixel(c, r);
      const np = nh ? hexToPixel(c + dc, r + dr) : { x: p.x + (dc || 0.1) * 20, y: p.y + dr * 20 };
      let bi = 0, bd = Infinity;
      for (let e = 0; e < 6; e++) {
        const mx = (corners[e][0] + corners[(e + 1) % 6][0]) / 2;
        const my = (corners[e][1] + corners[(e + 1) % 6][1]) / 2;
        const d = (mx - np.x) ** 2 + (my - np.y) ** 2;
        if (d < bd) { bd = d; bi = e; }
      }
      const isCoastOrNeutral = !nh || nh.terrain === 'water' || !nh.owner;
      ctx.strokeStyle = isCoastOrNeutral ? 'rgba(12,18,26,0.85)' : shade(NATION_DEFS[h.owner].color, 0.38);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(corners[bi][0], corners[bi][1]);
      ctx.lineTo(corners[(bi + 1) % 6][0], corners[(bi + 1) % 6][1]);
      ctx.stroke();
    }
  }
  // Hauptstädte & Städte als Punkte
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (!h.capital && !h.vp && h.building !== 'stadt') continue;
    const p = hexToPixel(c, r);
    const isVp = h.capital || h.vp;
    ctx.fillStyle = isVp ? '#ffd75e' : 'rgba(245,245,240,0.9)';
    ctx.strokeStyle = 'rgba(20,20,26,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(p.x, p.y, isVp ? 4.2 : 2.6, 0, 7);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function updateMinimapBase() {
  const mctx = UI.minimapBase.getContext('2d');
  mctx.fillStyle = '#152638';
  mctx.fillRect(0, 0, UI.minimapBase.width, UI.minimapBase.height);
  mctx.drawImage(UI.ovLayer, 0, 0, UI.ovLayer.width, UI.ovLayer.height,
    0, 0, UI.minimapBase.width, UI.minimapBase.height);
}

/* ---------- Nationen-Beschriftungen ---------- */
function computeLabels() {
  const labels = [];
  const sums = {};
  for (const row of game.hexes) for (const h of row) {
    if (!h.owner) continue;
    const s = sums[h.owner] || (sums[h.owner] = { x: 0, y: 0, n: 0 });
    const p = hexToPixel(h.c, h.r);
    s.x += p.x; s.y += p.y; s.n++;
  }
  for (const [id, s] of Object.entries(sums)) {
    if (!game.nations[id] || !game.nations[id].alive || s.n < 4) continue;
    let x = s.x / s.n, y = s.y / s.n;
    const hx = pixelToHex(x, y);
    if (!hx || !game.hexAt(hx.c, hx.r) || game.hexAt(hx.c, hx.r).owner !== id) {
      let best = null, bd = Infinity;
      for (const row of game.hexes) for (const h of row) {
        if (h.owner !== id) continue;
        const p = hexToPixel(h.c, h.r);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { x = best.x; y = best.y; }
    }
    labels.push({ id, x, y, size: Math.min(44, Math.max(13, 6 + Math.sqrt(s.n) * 1.7)) });
  }
  UI.labels = labels;
  game.labelsDirty = false;
}

/* ---------- Divisions-Sprites ---------- */
const TYPE_STRIPE = { inf: null, gar: '#ffd75e', pz: '#7fa8d8', art: '#d87f7f' };

function drawDivision(ctx, d, zoom) {
  const t = BAL.divTypes[d.type];
  const isPlayer = d.nation === game.player;
  const sel = UI.selectedDivs.has(d.id);
  if (zoom < 0.75) {
    const w = 11, hh = 7.5;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(d.x - w / 2 + 1, d.y - hh / 2 + 1, w, hh);
    ctx.fillStyle = shade(NATION_DEFS[d.nation].color, 1.05);
    ctx.fillRect(d.x - w / 2, d.y - hh / 2, w, hh);
    ctx.strokeStyle = sel ? '#fff' : 'rgba(10,14,20,0.9)';
    ctx.lineWidth = sel ? 1.6 : 0.8;
    ctx.strokeRect(d.x - w / 2, d.y - hh / 2, w, hh);
    ctx.fillStyle = '#57c268';
    ctx.fillRect(d.x - w / 2, d.y + hh / 2 + 0.8, w * Math.max(0, d.str / 100), 1.5);
    return;
  }
  const w = 18, hh = 12;
  const x = d.x - w / 2, y = d.y - hh / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x + 1.2, y + 1.5, w, hh);
  const g = ctx.createLinearGradient(0, y, 0, y + hh);
  const col = NATION_DEFS[d.nation].color;
  g.addColorStop(0, shade(col, 1.12));
  g.addColorStop(1, shade(col, 0.82));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, hh);
  if (TYPE_STRIPE[d.type]) {
    ctx.fillStyle = TYPE_STRIPE[d.type];
    ctx.fillRect(x, y, 2.2, hh);
  }
  ctx.strokeStyle = sel ? '#ffffff' : (isPlayer ? '#f2e7c8' : 'rgba(12,16,24,0.95)');
  ctx.lineWidth = sel ? 1.8 : 1;
  ctx.strokeRect(x, y, w, hh);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 1.05;
  const ix = x + (TYPE_STRIPE[d.type] ? 3.1 : 1.9), iy = y + 1.9, iw = w - (TYPE_STRIPE[d.type] ? 5 : 3.8), ih = hh - 3.8;
  if (d.type === 'inf' || d.type === 'gar') {
    ctx.beginPath();
    ctx.moveTo(ix, iy); ctx.lineTo(ix + iw, iy + ih);
    ctx.moveTo(ix + iw, iy); ctx.lineTo(ix, iy + ih);
    ctx.stroke();
    if (d.type === 'gar') {
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath(); ctx.arc(ix + iw / 2, iy + ih / 2, 1.5, 0, 7); ctx.fill();
    }
  } else if (d.type === 'pz') {
    ctx.beginPath();
    ctx.ellipse(ix + iw / 2, iy + ih / 2, iw * 0.42, ih * 0.4, 0, 0, 7);
    ctx.stroke();
  } else if (d.type === 'art') {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.arc(ix + iw / 2, iy + ih / 2 + 0.5, 1.6, 0, 7); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ix + iw / 2, iy + ih / 2); ctx.lineTo(ix + iw / 2 + 3, iy - 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.fillRect(x, y + hh + 1.1, w, 2.2);
  ctx.fillStyle = '#57c268';
  ctx.fillRect(x + 0.3, y + hh + 1.4, (w - 0.6) * Math.max(0, d.str / BAL.maxStr), 1.6);
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.fillRect(x, y + hh + 3.8, w, 2.2);
  ctx.fillStyle = '#e0b34a';
  ctx.fillRect(x + 0.3, y + hh + 4.1, (w - 0.6) * Math.max(0, d.org / t.maxOrg), 1.6);
  if (d.inCombat) {
    ctx.fillStyle = '#ff5040';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(x + w, y, 2.4, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/* =========================================================
   HAUPT-RENDER
   ========================================================= */
function render() {
  const ctx = UI.ctx;
  const { zoom } = UI.cam;
  camClamp();
  const now = performance.now();

  if (game.mapDirty && now - UI._lastMapRender > 400) {
    UI._lastMapRender = now;
    renderMapLayer();
  }
  // Labels wandern langsam — bei Eroberungen reicht ~1×/Sekunde statt jeder Frame
  if (!UI.labels || (game.labelsDirty && now - (UI._lastLabelT || 0) > 1000)) {
    UI._lastLabelT = now;
    computeLabels();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#101a26';
  ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);

  ctx.setTransform(zoom, 0, 0, zoom, -UI.cam.x * zoom, -UI.cam.y * zoom);

  const cMin = Math.max(0, Math.floor(UI.cam.x / (HEX_SIZE * SQRT3)) - 2);
  const cMax = Math.min(MAP_W - 1, Math.ceil((UI.cam.x + UI.canvas.width / zoom) / (HEX_SIZE * SQRT3)) + 2);
  const rMin = Math.max(0, Math.floor(UI.cam.y / (HEX_SIZE * 1.5)) - 2);
  const rMax = Math.min(MAP_H - 1, Math.ceil((UI.cam.y + UI.canvas.height / zoom) / (HEX_SIZE * 1.5)) + 2);

  if (zoom <= UI.OV_ZMAX) {
    // Weit draußen: flache Übersichtsebene (keine Fragmente)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(UI.ovLayer, 0, 0, UI.ovLayer.width, UI.ovLayer.height, 0, 0, WORLD_W, WORLD_H);
  } else if (zoom <= UI.ZSWITCH) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(UI.mapLayer, 0, 0, UI.mapLayer.width, UI.mapLayer.height, 0, 0, WORLD_W, WORLD_H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    grad.addColorStop(0, '#1d3247');
    grad.addColorStop(1, '#152638');
    ctx.fillStyle = grad;
    ctx.fillRect(UI.cam.x - 50, UI.cam.y - 50, UI.canvas.width / zoom + 100, UI.canvas.height / zoom + 100);
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.terrain === 'water') continue;
      const p = hexToPixel(c, r);
      fillHex(ctx, h, p);
      drawTerrainArt(ctx, h, p.x, p.y, true);
    }
    ctx.strokeStyle = 'rgba(88,68,44,0.95)';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.road) drawRoadsAt(ctx, h, hexToPixel(c, r));
    }
    const bThick = Math.max(2, 3 / zoom * 1.6);
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.terrain === 'water') continue;
      drawBordersAt(ctx, h, hexToPixel(c, r), bThick);
    }
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.building || h.capital || h.vp) {
        const p = hexToPixel(c, r);
        drawBuilding(ctx, h, p.x, p.y, true);
      }
    }
  }

  // Weltrand: sanfter dunkler Rahmen — der Kartenausschnitt endet gewollt,
  // abgeschnittenes Land wirkt nicht mehr wie ein Renderfehler
  for (const [w, a] of [[44, 0.12], [28, 0.18], [14, 0.3], [5, 0.55]]) {
    ctx.strokeStyle = `rgba(10,16,24,${a})`;
    ctx.lineWidth = w;
    ctx.strokeRect(w / 2 - 2, w / 2 - 2, WORLD_W - w + 4, WORLD_H - w + 4);
  }

  // Versorgungs-Overlay
  if (UI.supplyOverlay && zoom >= 0.5) {
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.owner !== game.player || h.terrain === 'water') continue;
      const p = hexToPixel(c, r);
      const lvl = Math.min(1, h.supply);
      hexPath(ctx, p.x, p.y, HEX_SIZE + 0.55);
      ctx.fillStyle = `hsla(${lvl * 120}, 75%, 48%, 0.4)`;
      ctx.fill();
    }
  }

  // Frontlinien der eigenen Armeen
  const nat = game.nations[game.player];
  if (nat) for (const army of nat.armies) {
    if (!army.frontHexes.length) continue;
    const isSel = UI.selectedArmy === army.id;
    const isExpand = army.target === 'EXPAND';
    const w = Math.max(2.5, 3.5 / zoom);
    // Linie bei großen Sprüngen abreißen — keine Querverbinder durchs Reich
    const traceFront = () => {
      ctx.beginPath();
      let prev = null;
      for (const h of army.frontHexes) {
        const p = hexToPixel(h.c, h.r);
        if (!prev || hexDist(h.c, h.r, prev.c, prev.r) > 3) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        prev = h;
      }
    };
    ctx.strokeStyle = isExpand ? 'rgba(110,230,140,0.28)'
      : army.mode === 'attack' ? 'rgba(255,70,45,0.28)' : 'rgba(255,200,60,0.25)';
    ctx.lineWidth = w * 2.6;
    ctx.lineJoin = 'round';
    traceFront();
    ctx.stroke();
    ctx.strokeStyle = isExpand ? 'rgba(120,240,150,0.95)'
      : army.mode === 'attack' ? 'rgba(255,86,58,0.95)' : 'rgba(255,205,70,0.9)';
    ctx.lineWidth = isSel ? w * 1.4 : w * 0.8;
    ctx.setLineDash(isSel ? [] : [7, 5]);
    traceFront();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Effekte
  for (const e of game.effects) {
    const age = (now - e.t) / 900;
    const p = hexToPixel(e.c, e.r);
    if (e.type === 'battle') {
      const pulse = 0.5 + 0.5 * Math.sin(now / 110);
      hexPath(ctx, p.x, p.y, HEX_SIZE * (0.75 + 0.18 * pulse));
      ctx.strokeStyle = `rgba(255,60,40,${0.8 * (1 - age)})`;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      const fp = hexToPixel(e.fc, e.fr);
      drawArrow(ctx, fp.x, fp.y, p.x, p.y, `rgba(255,90,60,${0.85 * (1 - age)})`);
    } else if (e.type === 'capture') {
      hexPath(ctx, p.x, p.y, HEX_SIZE * (1 - age * 0.3));
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - age)})`;
      ctx.fill();
    } else if (e.type === 'death') {
      ctx.fillStyle = `rgba(25,20,20,${0.75 * (1 - age)})`;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', p.x, p.y - age * 11);
    } else if (e.type === 'gold') {
      const ty = p.y - HEX_SIZE - 2 - age * 16;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = `rgba(50,35,0,${0.85 * (1 - age)})`;
      ctx.fillStyle = `rgba(255,216,90,${0.95 * (1 - age)})`;
      ctx.strokeText('+' + e.amount + ' G', p.x, ty);
      ctx.fillText('+' + e.amount + ' G', p.x, ty);
    }
  }

  // Handelsschiffe (weit draußen ausblenden — sonst wirken sie wie Krümel)
  if (zoom >= 0.6) {
    for (const s of game.ships) {
      if (s.x < UI.cam.x - 30 || s.x > UI.cam.x + UI.canvas.width / zoom + 30
        || s.y < UI.cam.y - 30 || s.y > UI.cam.y + UI.canvas.height / zoom + 30) continue;
      drawShip(ctx, s, now);
    }
  }

  // Umkämpfte Hexes: Widerstands-Balken
  if (zoom > 1.0) {
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.terrain === 'water' || !h._atkT || game.dayFloat - h._atkT > 1.5 || h.resist >= h.resistMax) continue;
      const p = hexToPixel(c, r);
      const bw = 15;
      ctx.fillStyle = 'rgba(10,10,14,0.8)';
      ctx.fillRect(p.x - bw / 2, p.y - HEX_SIZE - 4, bw, 2.8);
      ctx.fillStyle = '#e8e4da';
      ctx.fillRect(p.x - bw / 2 + 0.4, p.y - HEX_SIZE - 3.6, (bw - 0.8) * Math.max(0, h.resist / h.resistMax), 2);
    }
  }

  // Divisionen
  for (const d of game.divisions) {
    if (d.dead) continue;
    const target = hexToPixel(d.c, d.r);
    d.x += (target.x - d.x) * 0.18;
    d.y += (target.y - d.y) * 0.18;
    if (d.x < UI.cam.x - 40 || d.x > UI.cam.x + UI.canvas.width / zoom + 40
      || d.y < UI.cam.y - 40 || d.y > UI.cam.y + UI.canvas.height / zoom + 40) continue;
    drawDivision(ctx, d, zoom);
  }

  // Städtenamen (Hauptstädte)
  if (zoom >= 0.9) {
    const alpha = Math.min(1, (zoom - 0.9) / 0.4);
    ctx.textAlign = 'center';
    ctx.font = `600 ${10.5 / Math.min(zoom, 2.2)}px 'Segoe UI', sans-serif`;
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (!h.cityName || !h.owner) continue;
      const p = hexToPixel(c, r);
      ctx.lineWidth = 2.6 / zoom;
      ctx.strokeStyle = `rgba(10,14,20,${0.85 * alpha})`;
      ctx.fillStyle = `rgba(245,240,228,${0.95 * alpha})`;
      ctx.strokeText(h.cityName, p.x, p.y + HEX_SIZE + 8 / Math.min(zoom, 2.2));
      ctx.fillText(h.cityName, p.x, p.y + HEX_SIZE + 8 / Math.min(zoom, 2.2));
    }
  }

  // Nationen-Namen
  if (UI.labels) {
    const lblAlpha = zoom > 2.2 ? Math.max(0, 1 - (zoom - 2.2) / 0.8) : 1;
    if (lblAlpha > 0.02) {
      ctx.textAlign = 'center';
      for (const l of UI.labels) {
        ctx.font = `800 ${l.size}px 'Segoe UI', sans-serif`;
        ctx.lineWidth = l.size / 7;
        ctx.strokeStyle = `rgba(15,20,28,${0.72 * lblAlpha})`;
        ctx.fillStyle = `rgba(255,252,242,${0.88 * lblAlpha})`;
        const name = NATION_DEFS[l.id].name.toUpperCase();
        ctx.strokeText(name, l.x, l.y);
        ctx.fillText(name, l.x, l.y);
      }
    }
  }

  // Geister-Bauplatz (Tutorial): pulsierender Vorschlag
  if (UI._ghost) {
    const p = hexToPixel(UI._ghost.c, UI._ghost.r);
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    hexPath(ctx, p.x, p.y, HEX_SIZE + 0.5);
    ctx.strokeStyle = `rgba(255,215,94,${0.45 + 0.45 * pulse})`;
    ctx.lineWidth = 2.6 / zoom + 1;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${12 / Math.min(zoom, 2) + 5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.55 + 0.3 * pulse;
    ctx.fillText(UI._ghost.what === 'kaserne' ? '🎪' : '🏠', p.x, p.y + 5);
    ctx.globalAlpha = 1;
  }

  // Wegpunkt-Routen der ausgewählten Divisionen
  if (UI.selectedDivs.size) {
    for (const id of UI.selectedDivs) {
      const d = game.divisions.find(x => x.id === id && !x.dead);
      if (!d || d.nation !== game.player) continue;
      const pts = [];
      if (d.path && d.pathI < d.path.length) pts.push(d.path[d.path.length - 1]);
      if (d.queue) for (const q of d.queue) pts.push(q);
      if (!pts.length) continue;
      ctx.strokeStyle = 'rgba(120,215,255,0.7)';
      ctx.lineWidth = 1.7 / zoom + 0.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      for (const [qc, qr] of pts) { const p = hexToPixel(qc, qr); ctx.lineTo(p.x, p.y); }
      ctx.stroke();
      ctx.setLineDash([]);
      const rad = 4.5 / Math.min(zoom, 2) + 1;
      pts.forEach(([qc, qr], i) => {
        const p = hexToPixel(qc, qr);
        ctx.fillStyle = 'rgba(20,40,60,0.9)';
        ctx.strokeStyle = 'rgba(120,215,255,0.95)';
        ctx.lineWidth = 1.2 / zoom + 0.4;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#cfeaff';
        ctx.font = `bold ${8.5 / Math.min(zoom, 2) + 2}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), p.x, p.y + 0.5);
        ctx.textBaseline = 'alphabetic';
      });
    }
  }

  // Auswahl-Markierungen
  if (UI.selectedHex) {
    const p = hexToPixel(UI.selectedHex.c, UI.selectedHex.r);
    hexPath(ctx, p.x, p.y, HEX_SIZE + 0.5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4 / zoom + 1;
    ctx.stroke();
  }
  if (UI.buildMode && UI.hoverHex) {
    const p = hexToPixel(UI.hoverHex.c, UI.hoverHex.r);
    const h = game.hexAt(UI.hoverHex.c, UI.hoverHex.r);
    const ok = h && game.canBuild(game.player, h, UI.buildMode) === true;
    hexPath(ctx, p.x, p.y, HEX_SIZE + 0.5);
    ctx.strokeStyle = ok ? 'rgba(120,255,140,0.95)' : 'rgba(255,90,70,0.9)';
    ctx.lineWidth = 2.6 / zoom + 1;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (UI.hoverHex && !UI.selectedDivs.size) {
    const p = hexToPixel(UI.hoverHex.c, UI.hoverHex.r);
    hexPath(ctx, p.x, p.y, HEX_SIZE + 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.6 / zoom + 0.5;
    ctx.stroke();
  }

  // Box-Selektion (Bildschirmkoordinaten)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (UI.boxSel) {
    const b = UI.boxSel;
    ctx.strokeStyle = 'rgba(140,200,255,0.9)';
    ctx.fillStyle = 'rgba(140,200,255,0.12)';
    ctx.lineWidth = 1.4;
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0), hh = Math.abs(b.y1 - b.y0);
    ctx.fillRect(x, y, w, hh);
    ctx.strokeRect(x, y, w, hh);
  }

  drawMinimap();
}

function drawShip(ctx, s, now) {
  const bob = Math.sin(now / 320 + s.x * 0.13) * 0.7;
  const x = s.x, y = s.y + bob;
  const col = NATION_DEFS[s.from] ? NATION_DEFS[s.from].color : '#888';
  ctx.save();
  // Kielwasser
  ctx.strokeStyle = 'rgba(220,235,245,0.25)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x - 5.5, y + 1.6); ctx.lineTo(x - 9, y + 1.6); ctx.stroke();
  // Rumpf
  ctx.fillStyle = shade(col, 0.9);
  ctx.strokeStyle = 'rgba(10,14,20,0.85)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x - 4.2, y); ctx.lineTo(x + 4.2, y); ctx.lineTo(x + 2.5, y + 2.4); ctx.lineTo(x - 2.5, y + 2.4);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // Segel
  ctx.fillStyle = 'rgba(246,240,224,0.96)';
  ctx.beginPath();
  ctx.moveTo(x - 0.2, y - 0.6); ctx.lineTo(x - 0.2, y - 5.6); ctx.lineTo(x + 3.6, y - 1.2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sx = x1 + ux * 6, sy = y1 + uy * 6;
  const ex = x2 - ux * 8, ey = y2 - uy * 8;
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2 - ux * 2, y2 - uy * 2);
  ctx.lineTo(ex - uy * 3.6, ey + ux * 3.6);
  ctx.lineTo(ex + uy * 3.6, ey - ux * 3.6);
  ctx.closePath(); ctx.fill();
}

/* ---------- Minimap ---------- */
function drawMinimap() {
  const m = UI.minimap;
  const mctx = m.getContext('2d');
  mctx.drawImage(UI.minimapBase, 0, 0);
  const sx = m.width / WORLD_W, sy = m.height / WORLD_H;
  mctx.strokeStyle = 'rgba(255,255,255,0.9)';
  mctx.lineWidth = 1.4;
  mctx.strokeRect(UI.cam.x * sx, UI.cam.y * sy,
    UI.canvas.width / UI.cam.zoom * sx, UI.canvas.height / UI.cam.zoom * sy);
}

function bindMinimap() {
  const m = UI.minimap;
  let down = false;
  const jump = e => {
    const rect = m.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / m.width * WORLD_W;
    const wy = (e.clientY - rect.top) / m.height * WORLD_H;
    UI.cam.x = wx - UI.canvas.width / 2 / UI.cam.zoom;
    UI.cam.y = wy - UI.canvas.height / 2 / UI.cam.zoom;
  };
  m.addEventListener('mousedown', e => { down = true; jump(e); e.stopPropagation(); });
  window.addEventListener('mousemove', e => { if (down) jump(e); });
  window.addEventListener('mouseup', () => { down = false; });
}

/* =========================================================
   EINGABE
   ========================================================= */
function screenToWorld(sx, sy) {
  return { x: sx / UI.cam.zoom + UI.cam.x, y: sy / UI.cam.zoom + UI.cam.y };
}

function playerSelection() {
  return [...UI.selectedDivs]
    .map(id => game.divisions.find(d => d.id === id && !d.dead))
    .filter(d => d && d.nation === game.player);
}

function bindInput() {
  const cv = UI.canvas;

  cv.addEventListener('mousedown', e => {
    if (e.button === 1 || e.button === 2) {
      UI.drag = { sx: e.clientX, sy: e.clientY, cx: UI.cam.x, cy: UI.cam.y, moved: false, pan: true };
      if (e.button === 1) e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (UI.buildMode) {
      paintBuild(e.clientX, e.clientY);
      UI.drag = { paint: true };
    } else {
      // Links-Ziehen = Box-Auswahl (Klick = Auswahl); Strg/Shift = zur Auswahl hinzufügen
      UI.boxSel = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.ctrlKey || e.shiftKey };
    }
  });

  window.addEventListener('mousemove', e => {
    if (UI.boxSel) {
      UI.boxSel.x1 = e.clientX; UI.boxSel.y1 = e.clientY;
    } else if (UI.drag && UI.drag.paint) {
      if (e.buttons & 1) paintBuild(e.clientX, e.clientY);
    } else if (UI.drag && UI.drag.pan) {
      const dx = e.clientX - UI.drag.sx, dy = e.clientY - UI.drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) UI.drag.moved = true;
      if (UI.drag.moved) {
        UI.cam.x = UI.drag.cx - dx / UI.cam.zoom;
        UI.cam.y = UI.drag.cy - dy / UI.cam.zoom;
        UI.canvas.style.cursor = 'grabbing';
      }
    }
    const w = screenToWorld(e.clientX, e.clientY);
    UI.hoverHex = pixelToHex(w.x, w.y);
    UI._overUI = e.target !== UI.canvas;   // Maus über Panel/Leisten: kein Karten-Tooltip
    updateTooltip(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', e => {
    UI.canvas.style.cursor = '';
    if (e.button === 0) {
      if (UI.drag && UI.drag.paint) { UI.drag = null; return; }
      if (UI.boxSel) {
        const b = UI.boxSel;
        UI.boxSel = null;
        const additive = b.add || e.ctrlKey || e.shiftKey;
        if (Math.abs(b.x1 - b.x0) < 8 && Math.abs(b.y1 - b.y0) < 8) handleClick(e.clientX, e.clientY, additive);
        else finishBoxSelect(b, additive);
      }
      UI.drag = null;
      return;
    }
    if (e.button === 2) {
      const wasPan = UI.drag && UI.drag.pan && UI.drag.moved;
      UI.drag = null;
      if (!wasPan) onRightTap(e.clientX, e.clientY, e.altKey, e.shiftKey);
      return;
    }
    if (e.button === 1) UI.drag = null;
  });

  cv.addEventListener('contextmenu', e => e.preventDefault());

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const w = screenToWorld(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
    UI.cam.zoom = Math.min(4.5, Math.max(Math.min(0.3, fitZoom() * 0.9), UI.cam.zoom * factor));
    UI.cam.x = w.x - e.clientX / UI.cam.zoom;
    UI.cam.y = w.y - e.clientY / UI.cam.zoom;
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    // S = teilen, M = vereinen (wenn Truppen ausgewählt sind)
    if (e.code === 'KeyS' && UI.selectedDivs.size && !e.ctrlKey) { splitSelection(); return; }
    if (e.code === 'KeyM' && UI.selectedDivs.size) { mergeSelection(); return; }
    UI.keys.add(e.code);
    if (e.code === 'Space') { e.preventDefault(); game.paused = !game.paused; updateTopbar(); }
    if (e.key >= '1' && e.key <= '4') { game.speed = +e.key; game.paused = false; }
    if (e.key === '+' || e.key === '=') zoomStep(1.25);
    if (e.key === '-') zoomStep(1 / 1.25);
    if (e.code === 'Home') centerOn(...game.nations[game.player].capital, Math.max(UI.cam.zoom, 1.5));
    if (e.key === 'v' || e.key === 'V') { UI.supplyOverlay = !UI.supplyOverlay; updateTopbar(); }
    if (e.code === 'KeyB') {
      UI.activeTab = UI.activeTab === 'bauen' ? null : 'bauen';
      refreshPanel();
    }
    if (e.code === 'Escape') {
      // Kaskade wie in HOI4: erst Baumodus, dann Auswahl, dann Panel schließen
      if (UI.buildMode) {
        UI.buildMode = null;
      } else if (UI.selectedDivs.size || UI.selectedHex) {
        UI.selectedDivs.clear();
        UI.selectedHex = null;
        updateUnitbar();
      } else if (UI.activeTab) {
        UI.activeTab = null;
      }
      refreshPanel();
    }
    updateTopbar();
  });
  window.addEventListener('keyup', e => UI.keys.delete(e.code));
}

function zoomStep(f) {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const w = screenToWorld(cx, cy);
  UI.cam.zoom = Math.min(4.5, Math.max(Math.min(0.3, fitZoom() * 0.9), UI.cam.zoom * f));
  UI.cam.x = w.x - cx / UI.cam.zoom;
  UI.cam.y = w.y - cy / UI.cam.zoom;
}

function keyboardPan(dt) {
  const sp = 700 / UI.cam.zoom * dt;
  if (UI.keys.has('KeyW') || UI.keys.has('ArrowUp')) UI.cam.y -= sp;
  if (UI.keys.has('KeyS') || UI.keys.has('ArrowDown')) UI.cam.y += sp;
  if (UI.keys.has('KeyA') || UI.keys.has('ArrowLeft')) UI.cam.x -= sp;
  if (UI.keys.has('KeyD') || UI.keys.has('ArrowRight')) UI.cam.x += sp;
}

function paintBuild(sx, sy) {
  if (!UI.buildMode) return;
  const w = screenToWorld(sx, sy);
  const hx = pixelToHex(w.x, w.y);
  if (!hx) return;
  const h = game.hexAt(hx.c, hx.r);
  const res = game.build(game.player, h, UI.buildMode);
  if (res === true) {
    updateTopbar();
  } else if (performance.now() - UI._paintToastT > 1200 && h && h.owner === game.player) {
    UI._paintToastT = performance.now();
    pushToast('⚠ ' + res);
  }
}

function setBuildMode(mode) {
  UI.buildMode = (UI.buildMode === mode) ? null : mode;
  refreshPanel();
}

/* S: ausgewählte Divisionen teilen */
function splitSelection() {
  const sel = playerSelection();
  let n = 0;
  for (const d of sel) {
    const twin = game.splitDivision(d);
    if (twin) { UI.selectedDivs.add(twin.id); n++; }
  }
  pushToast(n ? `✂️ ${n} Division(en) geteilt.` : '⚠ Teilen braucht ≥ 40 Stärke und einen freien Nachbarplatz.');
  updateUnitbar();
}

/* M: ausgewählte Divisionen gleichen Typs vereinen */
function mergeSelection() {
  const sel = playerSelection();
  const merged = game.mergeDivisions(sel);
  for (const id of [...UI.selectedDivs]) {
    const d = game.divisions.find(x => x.id === id);
    if (!d || d.dead) UI.selectedDivs.delete(id);
  }
  pushToast(merged ? `🔗 ${merged}× vereint.` : '⚠ Zum Vereinen mind. 2 Divisionen gleichen Typs auswählen.');
  updateUnitbar();
}

/* Rechtsklick: Marschbefehl (Standard) / Shift = Wegpunkt / Alt = Front-Automatik / Allianz */
function onRightTap(sx, sy, alt, shift) {
  if (UI.buildMode) { setBuildMode(null); return; }
  const w = screenToWorld(sx, sy);
  const hx = pixelToHex(w.x, w.y);
  if (!hx) return;
  const h = game.hexAt(hx.c, hx.r);
  if (!h) return;
  const sel = playerSelection();

  if (sel.length) {
    const ownOrAllied = h.owner === game.player || (h.owner && game.allied(game.player, h.owner));
    const hostileOwned = h.owner && !ownOrAllied;
    if (hostileOwned && h.terrain !== 'water' && game.day < BAL.graceDays) {
      pushToast(`⏳ Schonfrist: Angriffe auf Nationen erst in ${BAL.graceDays - game.day} Tagen.`);
      return;
    }
    if (alt && !shift && h.terrain !== 'water' && !ownOrAllied) {
      // Alt+Rechtsklick = Automatik: Truppen der Front zuweisen
      assignSelectionToFront(h.owner === null ? 'EXPAND' : h.owner);
    } else {
      // Standard: direkter Marsch-/Angriffsbefehl · Shift = Wegpunkt anhängen
      groupMoveOrder(hx.c, hx.r, shift);
    }
    return;
  }
  // Ohne Auswahl: Rechtsklick auf fremdes Land = Allianz anbieten
  if (h.owner && h.owner !== game.player && game.nations[h.owner].alive) {
    if (game.allied(game.player, h.owner)) {
      pushToast(`🤝 Mit ${game.nationName(h.owner)} verbündet — lösen im Nationen-Tab.`);
    } else {
      const res = game.offerAlliance(game.player, h.owner);
      if (res !== true) pushToast('🤝 ' + res);
    }
  }
}

function assignSelectionToFront(key) {
  const nat = game.nations[game.player];
  let army = nat.armies.find(a => a.target === key);
  if (!army) {
    army = game.createArmy(game.player,
      key === 'EXPAND' ? 'Expansionsarmee' : 'Front: ' + game.nationName(key));
    army.target = key;
  }
  army.mode = 'attack';
  let n = 0;
  for (const d of playerSelection()) {
    d.army = army.id; d.manual = false; d.path = null; d.attackTarget = null; d.queue = [];
    n++;
  }
  game.updateFronts(game.player);
  pushToast(key === 'EXPAND'
    ? `🌍 ${n} Division(en) expandieren automatisch ins Neutralland!`
    : `⚔️ ${n} Division(en) automatisch an die Front gegen ${game.nationName(key)}!`);
  refreshPanel();
}

function handleClick(sx, sy, additive) {
  const w = screenToWorld(sx, sy);
  let clickedDiv = null, bestD = (14 / Math.max(UI.cam.zoom, 0.6)) ** 2 + 60;
  for (const d of game.divisions) {
    if (d.dead) continue;
    const dist = (d.x - w.x) ** 2 + (d.y - w.y) ** 2;
    if (dist < bestD) { bestD = dist; clickedDiv = d; }
  }
  if (clickedDiv) {
    const now = performance.now();
    const isDouble = !additive && UI._lastClickDiv === clickedDiv.id && now - (UI._lastClickT || 0) < 350;
    UI._lastClickDiv = clickedDiv.id;
    UI._lastClickT = now;
    if (isDouble && clickedDiv.nation === game.player && clickedDiv.army != null) {
      // Doppelklick: ganze Armee auswählen
      const a = game.armyById(game.player, clickedDiv.army);
      if (a) {
        UI.selectedDivs.clear();
        game.armyDivisions(a).forEach(d => UI.selectedDivs.add(d.id));
        pushToast(`👥 ${a.name}: ${UI.selectedDivs.size} Divisionen ausgewählt.`);
      }
    } else if (additive && clickedDiv.nation === game.player) {
      // Strg/Shift: hinzufügen bzw. wieder abwählen
      if (UI.selectedDivs.has(clickedDiv.id)) UI.selectedDivs.delete(clickedDiv.id);
      else UI.selectedDivs.add(clickedDiv.id);
    } else {
      UI.selectedDivs.clear();
      UI.selectedDivs.add(clickedDiv.id);
    }
    UI.selectedHex = null;
    updateUnitbar();
    refreshPanel();
    return;
  }
  if (!additive) UI.selectedDivs.clear();
  const hx = pixelToHex(w.x, w.y);
  if (hx) {
    UI.selectedHex = hx;
    const h = game.hexAt(hx.c, hx.r);
    if (h && h.owner === game.player && UI.activeTab === 'info') UI.activeTab = 'bauen';
    // Fremde Nation angeklickt → Info-/Diplomatie-Panel (wie HOI4)
    if (h && h.owner && h.owner !== game.player) UI.activeTab = 'info';
    updateUnitbar();
    refreshPanel();
  }
}

function finishBoxSelect(b, shift) {
  const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
  const y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
  if (!shift) UI.selectedDivs.clear();
  for (const d of game.divisions) {
    if (d.dead || d.nation !== game.player) continue;
    const sx = (d.x - UI.cam.x) * UI.cam.zoom;
    const sy = (d.y - UI.cam.y) * UI.cam.zoom;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) UI.selectedDivs.add(d.id);
  }
  if (UI.selectedDivs.size) {
    pushToast(`🪖 ${UI.selectedDivs.size} ausgewählt — Rechtsklick = Marsch · Shift = Wegpunkte · Alt = Front-Automatik`);
  }
  updateUnitbar();
}

function groupMoveOrder(c, r, queue) {
  const divs = playerSelection();
  if (!divs.length) return;
  const targets = [[c, r]];
  const seen = new Set([c + r * MAP_W]);
  let frontier = [[c, r]];
  while (targets.length < divs.length && frontier.length) {
    const next = [];
    for (const [fc, fr] of frontier) for (const [nc, nr] of neighborsOf(fc, fr)) {
      const k = nc + nr * MAP_W;
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push([nc, nr]); next.push([nc, nr]);
      if (targets.length >= divs.length) break;
    }
    frontier = next;
  }
  divs.sort((a, b) => hexDist(a.c, a.r, c, r) - hexDist(b.c, b.r, c, r));
  divs.forEach((d, i) => game.moveOrder(d, ...targets[Math.min(i, targets.length - 1)], queue));
  game.effects.push({ type: 'capture', c, r, t: performance.now() - 400 });
}

/* ---------- Tooltip ---------- */
function updateTooltip(sx, sy) {
  const tip = document.getElementById('tooltip');
  if (!UI.hoverHex || !game || UI._overUI) { tip.style.display = 'none'; return; }
  const h = game.hexAt(UI.hoverHex.c, UI.hoverHex.r);
  if (!h) { tip.style.display = 'none'; return; }
  let html = `<b>${TERRAIN[h.terrain].name}</b>`;
  if (h.owner) {
    html += ` — <span style="color:${NATION_DEFS[h.owner].color}">${game.nationName(h.owner)}</span>`;
    if (game.allied(game.player, h.owner)) html += ' 🤝';
    if (h.capital) html += ' ★';
    if (h.vp) html += ' · <b>🏛️ Siegpunkt-Hauptstadt</b>';
    if (h.cityName) html += ` · <b>${h.cityName}</b>`;
    if (h.building) {
      html += `<br>${buildingName(h.building)}`;
      const eff = h.building === 'dorf' ? `+${BAL.leuteDorf}k Leute/Tag`
        : h.building === 'stadt' ? `+${BAL.incomeStadt} Gold · +${BAL.leuteStadt}k Leute/Tag`
        : h.building === 'mine' ? `+${h.terrain === 'mountain' ? BAL.incomeMineBerg : BAL.incomeMine} Gold/Tag`
        : h.building === 'kaserne' ? `bildet ${BAL.trainPerKaserne}k Leute/Tag zu Soldaten aus`
        : '';
      if (eff) html += ` <span class="tt-dim">(${eff})</span>`;
      if (h.building === 'hafen') {
        const partners = Object.keys(game.nations).filter(x => x !== h.owner
          && game.nations[x].alive && (game.nations[x].ports || 0) > 0
          && game.tradePartners(h.owner, x)).length;
        html += `<br><span class="tt-dim">🚢 Handelspartner: ${partners} · hier verdient: ${Math.round(h._tradeEarned || 0)} G</span>`;
      }
    }
    if (h.road) html += ' · 🛣️';
    html += `<br><span class="tt-dim">Versorgung ${Math.round(h.supply * 100)} % · Miliz ${Math.round(h.resist)}/${h.resistMax}</span>`;
  } else if (h.terrain !== 'water') {
    html += ` — <span class="tt-dim">neutral (Miliz ${Math.round(h.resist)}/${h.resistMax})</span>`;
  }
  const d = game.divisionAt(UI.hoverHex.c, UI.hoverHex.r);
  if (d) {
    const army = d.army != null ? game.armyById(d.nation, d.army) : null;
    html += `<hr><b>${d.name}</b><br><span style="color:${NATION_DEFS[d.nation].color}">${game.nationName(d.nation)}</span>`;
    html += `${army ? ' · ' + army.name : ''}<br><span class="tt-dim">Stärke ${Math.round(d.str)} · Org ${Math.round(d.org)} · Moral ${Math.round(d.moral * 100)} %</span>`;
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = Math.min(sx + 16, window.innerWidth - 260) + 'px';
  tip.style.top = Math.min(sy + 16, window.innerHeight - 130) + 'px';
}

function buildingName(b) {
  return { dorf: '🏠 Dorf', stadt: '🏙️ Stadt', mine: '⛏️ Mine', kaserne: '🎪 Kaserne', hafen: '🚢 Hafen' }[b] || b;
}

/* =========================================================
   TOASTS & ANGEBOTE
   ========================================================= */
function pushToast(msg) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, 3800);
}

function drainToasts() {
  if (!game || !game.toasts) return;
  while (game.toasts.length) pushToast(game.toasts.shift());
}

function renderOffers() {
  if (!game || !game._offersChanged) return;
  game._offersChanged = false;
  const box = document.getElementById('offers');
  box.innerHTML = game.allianceOffers.map(o => `
    <div class="offer">
      <span class="chip" style="background:${game.nationColor(o.from)}"></span>
      <b>${game.nationName(o.from)}</b>&nbsp;bietet eine Allianz an
      <button data-accept="${o.from}">✔ Annehmen</button>
      <button data-decline="${o.from}" class="danger">✖ Ablehnen</button>
    </div>`).join('');
  box.querySelectorAll('[data-accept]').forEach(b =>
    b.addEventListener('click', () => game.resolveOffer(b.dataset.accept, true)));
  box.querySelectorAll('[data-decline]').forEach(b =>
    b.addEventListener('click', () => game.resolveOffer(b.dataset.decline, false)));
}

/* =========================================================
   TOPBAR & PANELS
   ========================================================= */
function bindPanels() {
  // Linke Menüleiste: Klick öffnet das Panel, nochmal klicken schließt (HOI4-Stil)
  document.querySelectorAll('#sidebar button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      UI.activeTab = UI.activeTab === btn.dataset.tab ? null : btn.dataset.tab;
      refreshPanel();
    });
  });
  document.getElementById('panel-close').addEventListener('click', () => {
    UI.activeTab = null;
    refreshPanel();
  });
  document.getElementById('btn-pause').addEventListener('click', () => { game.paused = !game.paused; updateTopbar(); });
  for (const s of [1, 2, 3, 4]) {
    document.getElementById('btn-speed' + s).addEventListener('click', () => { game.speed = s; game.paused = false; updateTopbar(); });
  }
  document.getElementById('btn-supply').addEventListener('click', () => {
    UI.supplyOverlay = !UI.supplyOverlay;
    updateTopbar();
  });
  document.getElementById('btn-save').addEventListener('click', () => {
    try {
      localStorage.setItem('finalfront_save', JSON.stringify({ t: Date.now(), save: game.serialize() }));
      pushToast('💾 Spiel gespeichert.');
    } catch (e) { pushToast('⚠ Speichern fehlgeschlagen.'); }
  });
  document.getElementById('btn-load').addEventListener('click', () => loadNewestSave());
  document.getElementById('btn-restart').addEventListener('click', () => showStartScreen());
  document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('help').classList.toggle('hidden');
  });
  document.getElementById('help').addEventListener('click', e => {
    if (e.target.id === 'help') e.target.classList.add('hidden');
  });
}

function readSlot(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const wrap = JSON.parse(raw);
    if (wrap && wrap.save) return wrap;
    return { t: 0, save: raw };
  } catch (e) { return null; }
}

function loadNewestSave() {
  const a = readSlot('finalfront_save');
  const b = readSlot('finalfront_autosave');
  const pick = (a && b) ? (a.t >= b.t ? a : b) : (a || b);
  if (!pick) { pushToast('⚠ Kein Spielstand gefunden.'); return false; }
  const g = Game.deserialize(pick.save);
  if (!g) { pushToast('⚠ Spielstand inkompatibel (alte Version).'); return false; }
  window.game = g;
  UI.selectedHex = null; UI.selectedDivs.clear(); UI.selectedArmy = null;
  document.getElementById('start').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  game.updateFronts();
  centerOn(...game.nations[game.player].capital, 1.2);
  UI.tutorialStep = -1;   // geladene Spiele: keine Einführung
  UI._ghost = null;
  refreshPanel(); updateTopbar(); updateUnitbar(); updateTutorial();
  return true;
}

function updateTopbar() {
  if (!game) return;
  const nat = game.nations[game.player];
  document.getElementById('tb-nation').innerHTML =
    `<span class="chip" style="background:${game.nationColor(game.player)}"></span>${game.nationName(game.player)}`;
  const inc = nat.incomePerDay * (nat.econMult || 1);
  document.getElementById('tb-gold').textContent =
    `${Math.floor(nat.gold)} (${inc >= 0 ? '+' : ''}${inc.toFixed(1)})`;
  document.getElementById('tb-mp').textContent =
    `${nat.leute.toFixed(1)}k (+${nat.leutePerDay.toFixed(2)})`;
  document.getElementById('tb-sold').textContent =
    `${nat.soldaten.toFixed(1)}k (+${Math.min(nat.trainCap, nat.leute > 0.1 ? nat.trainCap : 0).toFixed(2)})`;
  document.getElementById('tb-div').textContent = `${game.divisionsOf(game.player).length}`;
  const share = Math.round(nat.hexCount / game.totalLand * 100);
  document.getElementById('tb-prov').textContent = `${nat.hexCount} (${share} %)`;
  document.getElementById('tb-vp').textContent = `${nat.vp || 0}/${BAL.round.vpToWin}`;
  document.getElementById('tb-day').textContent = dateStr(game.day);
  document.getElementById('tb-round').textContent = `noch ${Math.max(0, BAL.round.days - game.day)} T.`;

  // Sieg-Countdown-Banner
  const banner = document.getElementById('vp-banner');
  if (game.vpLeader && !game.over && game.nations[game.vpLeader]) {
    const own = game.vpLeader === game.player;
    const rest = Math.max(0, game.vpDeadline - game.day);
    banner.className = own ? 'own' : '';
    banner.innerHTML = own
      ? `👑 Du hältst ${game.nations[game.vpLeader].vp} Hauptstädte — <b>Sieg in ${rest} Tagen!</b> Halte durch!`
      : `👑 <b>${game.nationName(game.vpLeader)}</b> hält ${game.nations[game.vpLeader].vp} Hauptstädte — Sieg in <b>${rest} Tagen</b>! Haltet ihn auf!`;
  } else {
    banner.className = 'hidden';
  }
  document.getElementById('btn-pause').classList.toggle('active', game.paused);
  for (const s of [1, 2, 3, 4])
    document.getElementById('btn-speed' + s).classList.toggle('active', !game.paused && game.speed === s);
  document.getElementById('btn-supply').classList.toggle('active', UI.supplyOverlay);
}

const PANEL_TITLES = {
  bauen: '🏗 Bauen',
  armeen: '🪖 Armeen',
  nationen: '🌍 Nationen & Diplomatie',
  info: 'ℹ️ Info',
};

/* ---------- Live-Rangliste (Rundenmodus) ---------- */
function rankedNations() {
  return Object.keys(game.nations)
    .filter(id => game.nations[id].alive)
    .sort((a, b) => ((game.nations[b].vp || 0) - (game.nations[a].vp || 0))
      || (game.nations[b].hexCount - game.nations[a].hexCount));
}

function rankRowHtml(place, id) {
  const n = game.nations[id];
  return `<div class="rank-row ${id === game.player ? 'me' : ''}">
    <span class="rank-pl">${place}.</span>
    <span class="chip" style="background:${game.nationColor(id)}"></span>
    <span class="rank-name">${game.nationName(id)}</span>
    <span class="rank-vp">🏛️ ${n.vp || 0}</span>
    <span class="rank-hex">${n.hexCount}</span>
  </div>`;
}

function renderRanking() {
  const el = document.getElementById('ranking');
  if (!game || game.over) { el.innerHTML = ''; return; }
  const ids = rankedNations();
  let html = `<div class="rank-head">🏆 RANGLISTE — 🏛️ Hauptstädte · Provinzen</div>`;
  ids.forEach((id, i) => {
    if (i < 5 || id === game.player) html += rankRowHtml(i + 1, id);
  });
  if (!game.nations[game.player].alive) html += `<div class="rank-row me"><span class="rank-pl">☠</span><span class="rank-name">Du bist ausgeschieden</span></div>`;
  el.innerHTML = html;
}

function refreshPanel() {
  document.querySelectorAll('#sidebar button[data-tab]').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === UI.activeTab));
  const panel = document.getElementById('panel');
  if (!UI.activeTab || !game) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  document.getElementById('panel-title').textContent = PANEL_TITLES[UI.activeTab] || '';
  const el = document.getElementById('panel-content');
  if (UI.activeTab === 'bauen') el.innerHTML = panelBauen();
  else if (UI.activeTab === 'armeen') el.innerHTML = panelArmeen();
  else if (UI.activeTab === 'nationen') el.innerHTML = panelNationen();
  else el.innerHTML = panelInfo();
  bindPanelActions(el);
}

function panelBauen() {
  let html = `<p class="hint">Bau-Modus wählen, dann auf die Karte klicken — Straßen lassen sich <b>ziehen</b>. Rechtsklick/Esc beendet.</p>`;
  const items = [
    ['dorf', '🏠 Dorf', `erzeugt Leute: +${BAL.leuteDorf}k/Tag`],
    ['stadt', '🏙️ Stadt', `Dorf-Ausbau: +${BAL.incomeStadt} Gold und +${BAL.leuteStadt}k Leute/Tag · Versorgungs-Hub`],
    ['mine', '⛏️ Mine', `erzeugt Gold: +${BAL.incomeMine}–${BAL.incomeMineBerg}/Tag (Hügel/Gebirge)`],
    ['hafen', '🚢 Hafen', `bringt Gold per Seehandel (beide Seiten verdienen) · Versorgungs-Hub · nur am Ufer`],
    ['kaserne', '🎪 Kaserne', `bildet ${BAL.trainPerKaserne}k Leute/Tag zu 🎖️ Soldaten aus — Divisionen kosten Gold + Soldaten`],
    ['strasse', '🛣️ Straße', `Bewegung + Versorgung — ziehbar!`],
  ];
  for (const [key, label, desc] of items) {
    html += `<div class="build-row">
      <button data-buildmode="${key}" class="${UI.buildMode === key ? 'active-build' : ''}">${label} — ${BAL.cost[key]} G</button>
      <div class="small">${desc}</div>
    </div>`;
  }
  if (UI.selectedHex) {
    const h = game.hexAt(UI.selectedHex.c, UI.selectedHex.r);
    if (h && h.owner === game.player) {
      html += `<hr><p><b>${TERRAIN[h.terrain].name}</b> (${h.c}|${h.r})`;
      if (h.building) html += ` · ${buildingName(h.building)}`;
      if (h.road) html += ' · 🛣️';
      html += `<br><span class="small">Versorgung ${Math.round(h.supply * 100)} %</span></p>`;
    }
  }
  return html;
}

function panelArmeen() {
  const nat = game.nations[game.player];
  const borders = game.borderNationsOf(game.player).filter(b => game.hostile(game.player, b));
  let html = `<p class="hint small">Du steuerst deine Truppen selbst: auswählen (Links-Ziehen), <b>Rechtsklick = Marschbefehl</b>. Armeen sind die optionale Automatik: <b>Alt+Rechtsklick</b> auf Feind-/Neutralland weist Truppen einer Front zu — sie verteilen sich dann selbst.</p>`;
  for (const a of nat.armies) {
    const divs = game.armyDivisions(a);
    const sel = UI.selectedArmy === a.id;
    let targetOpts = `<option value="EXPAND" ${a.target === 'EXPAND' ? 'selected' : ''}>🌍 Expansion (Neutralland)</option>
      <option value="ALL" ${a.target === 'ALL' ? 'selected' : ''}>Gesamtfront (alle Nachbarn)</option>
      <option value="RESERVE" ${a.target === 'RESERVE' ? 'selected' : ''}>Reserve (Hauptstadt)</option>`;
    const opts = new Set(['EXPAND', 'ALL', 'RESERVE', ...borders]);
    if (!opts.has(a.target)) targetOpts += `<option value="${a.target}" selected>Front: ${game.nationName(a.target)}</option>`;
    for (const e of borders)
      targetOpts += `<option value="${e}" ${a.target === e ? 'selected' : ''}>Front: ${game.nationName(e)}</option>`;
    const avgOrg = divs.length ? divs.reduce((s, d) => s + d.org / BAL.divTypes[d.type].maxOrg, 0) / divs.length : 0;
    const avgMoral = divs.length ? divs.reduce((s, d) => s + d.moral, 0) / divs.length : 0;
    const typeCount = {};
    divs.forEach(d => typeCount[d.type] = (typeCount[d.type] || 0) + 1);
    const typeStr = Object.entries(typeCount).map(([t, n]) => `${n}×${BAL.divTypes[t].name.slice(0, 4)}`).join(' ');
    html += `<div class="army ${sel ? 'sel' : ''}" data-army="${a.id}">
      <div class="army-head">
        <b class="army-name" data-rename="${a.id}" title="Klicken zum Umbenennen">${a.name} ✏</b>
        <span>${divs.length} Div. ${nat.armies.length > 1 ? `<button class="mini danger" data-delarmy="${a.id}" title="Armee auflösen">✖</button>` : ''}</span>
      </div>
      <div class="bar"><i style="width:${avgOrg * 100}%;background:#e0b34a"></i></div>
      <div class="small">${typeStr || '—'} · Ø Moral ${Math.round(avgMoral * 100)} % · Front: ${a.frontHexes.length} Felder</div>
      <div class="army-controls">
        <select data-target="${a.id}">${targetOpts}</select>
        <div class="mode-btns">
          <button data-mode="defend" data-army-id="${a.id}" class="${a.mode === 'defend' ? 'active' : ''}">🛡 Verteidigen</button>
          <button data-mode="attack" data-army-id="${a.id}" class="${a.mode === 'attack' ? 'active' : ''}">⚔ Angriff!</button>
        </div>
        <div class="row-btns">
          <button data-selarmy="${a.id}">👥 Auswählen</button>
          <button data-gotofront="${a.id}">🎯 Zur Front</button>
        </div>
        <div class="train-grid">
          ${['inf', 'gar', 'pz', 'art'].map(ty => {
            const t = BAL.divTypes[ty];
            return `<div class="train-row"><span>${t.name}<br><span class="small">${t.gold} G · ${t.mp}k 🎖️</span></span>
              <span><button data-train="${ty}" data-n="1" data-army-id="${a.id}">+1</button>
              <button data-train="${ty}" data-n="5" data-army-id="${a.id}">+5</button></span></div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }
  html += `<button id="new-army" class="wide">➕ Neue Armee aufstellen</button>`;
  return html;
}

function panelNationen() {
  let html = `<p class="hint small">Keine Kriegserklärungen — jeder Nicht-Verbündete ist angreifbar.
    Allianz: Rechtsklick auf fremdes Land oder hier anbieten (max. ${BAL.maxAllies}).</p>`;
  const ids = Object.keys(NATION_DEFS).filter(id => id !== game.player);
  ids.sort((a, b) => game.nations[b].hexCount - game.nations[a].hexCount);
  for (const id of ids) {
    const n = game.nations[id];
    const isAlly = game.allied(game.player, id);
    html += `<div class="diplo-row ${n.alive ? '' : 'dead'}">
      <span class="chip" style="background:${game.nationColor(id)}"></span>
      <div class="diplo-info"><b>${game.nationName(id)}${isAlly ? ' 🤝' : ''}</b>
        <span class="small">${n.alive ? `${n.hexCount} Provinzen · ${game.divisionsOf(id).length} Div.` : '☠ untergegangen'}</span></div>
      ${n.alive ? (isAlly
        ? `<button data-unally="${id}" class="danger">💔 Lösen</button>`
        : `<button data-ally="${id}" class="peace">🤝 Allianz</button>`) : ''}
    </div>`;
  }
  return html;
}

function panelInfo() {
  // Divisionen werden in der Einheiten-Leiste unten verwaltet —
  // hier gibt es Infos zu Feldern und Nationen.
  if (UI.selectedHex) {
    const h = game.hexAt(UI.selectedHex.c, UI.selectedHex.r);
    if (h && h.owner) {
      const id = h.owner;
      const n = game.nations[id];
      const isAlly = id !== game.player && game.allied(game.player, id);
      let html = `<h3><span class="chip" style="background:${game.nationColor(id)}"></span>${game.nationName(id)}${isAlly ? ' 🤝' : ''}</h3>
        <p class="small">${n.hexCount} Provinzen · ${game.divisionsOf(id).length} Divisionen · Einkommen ${n.incomePerDay.toFixed(1)}/Tag</p>
        <p>${TERRAIN[h.terrain].name}${h.cityName ? ' · ' + h.cityName : ''}${h.building ? ' · ' + buildingName(h.building) : ''}${h.capital ? ' ★' : ''}</p>`;
      if (id !== game.player && n.alive) {
        html += isAlly
          ? `<button data-unally="${id}" class="wide danger">💔 Allianz lösen</button>`
          : `<button data-ally="${id}" class="wide peace">🤝 Allianz anbieten</button>
             <p class="small hint">Angreifen: Truppen auswählen und per Rechtsklick hierher schicken.</p>`;
      }
      return html;
    }
    if (h && h.terrain !== 'water') {
      return `<p class="hint">${TERRAIN[h.terrain].name} — <b>neutrales Land</b>.<br><br>
        Truppen auswählen und per Rechtsklick hierher expandieren!</p>`;
    }
    return `<p class="hint">${h ? TERRAIN[h.terrain].name : ''}</p>`;
  }
  return `<p class="hint">Klicke auf ein Feld für Details.<br><br>
    Divisionen wählst du direkt auf der Karte aus (Klick oder Links-Ziehen) —
    sie erscheinen dann in der <b>Einheiten-Leiste unten</b>.</p>`;
}

function bindPanelActions(el) {
  el.querySelectorAll('[data-buildmode]').forEach(b => b.addEventListener('click', () => {
    setBuildMode(b.dataset.buildmode);
  }));
  el.querySelectorAll('[data-ally]').forEach(b => b.addEventListener('click', () => {
    const res = game.offerAlliance(game.player, b.dataset.ally);
    if (res !== true) pushToast('🤝 ' + res);
    refreshPanel();
  }));
  el.querySelectorAll('[data-unally]').forEach(b => b.addEventListener('click', () => {
    game.dissolveAlliance(game.player, b.dataset.unally);
    refreshPanel();
  }));
  el.querySelectorAll('[data-target]').forEach(s => s.addEventListener('change', () => {
    const a = game.armyById(game.player, +s.dataset.target);
    if (a) { a.target = s.value; game.updateFronts(game.player); }
  }));
  el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    const a = game.armyById(game.player, +b.dataset.armyId);
    if (a) { a.mode = b.dataset.mode; refreshPanel(); }
  }));
  el.querySelectorAll('[data-train]').forEach(b => b.addEventListener('click', () => {
    const a = game.armyById(game.player, +b.dataset.armyId);
    const n = game.trainDivisions(game.player, b.dataset.train, +b.dataset.n, a);
    if (!n) pushToast('⚠ Zu wenig Gold oder 🎖️ Soldaten — Kasernen bilden Leute zu Soldaten aus.');
    else pushToast(`🪖 ${n} ${BAL.divTypes[b.dataset.train].name}division(en) aufgestellt — warten an der Kaserne auf deine Befehle.`);
    game.updateFronts(game.player);
    refreshPanel(); updateTopbar();
  }));
  el.querySelectorAll('[data-selarmy]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const a = game.armyById(game.player, +b.dataset.selarmy);
    UI.selectedDivs.clear();
    game.armyDivisions(a).forEach(d => UI.selectedDivs.add(d.id));
    pushToast(`👥 ${UI.selectedDivs.size} Divisionen von ${a.name} ausgewählt.`);
  }));
  el.querySelectorAll('[data-gotofront]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const a = game.armyById(game.player, +b.dataset.gotofront);
    if (a && a.frontHexes.length) {
      const mid = a.frontHexes[Math.floor(a.frontHexes.length / 2)];
      centerOn(mid.c, mid.r, Math.max(UI.cam.zoom, 1.6));
    } else {
      centerOn(...game.nations[game.player].capital, Math.max(UI.cam.zoom, 1.4));
    }
  }));
  el.querySelectorAll('[data-delarmy]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    if (game.disbandArmy(game.player, +b.dataset.delarmy)) refreshPanel();
  }));
  el.querySelectorAll('[data-rename]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const a = game.armyById(game.player, +b.dataset.rename);
    if (!a) return;
    const input = document.createElement('input');
    input.value = a.name;
    input.maxLength = 24;
    b.replaceWith(input);
    input.focus(); input.select();
    const done = () => { a.name = input.value.trim() || a.name; refreshPanel(); };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
  }));
  el.querySelectorAll('.army').forEach(div => div.addEventListener('click', e => {
    if (e.target.closest('button,select,input,.army-name')) return;
    UI.selectedArmy = UI.selectedArmy === +div.dataset.army ? null : +div.dataset.army;
    refreshPanel();
  }));
  const na = el.querySelector('#new-army');
  if (na) na.addEventListener('click', () => { game.createArmy(game.player); refreshPanel(); });
}

/* =========================================================
   EINHEITEN-LEISTE (unten, HOI4-Stil)
   ========================================================= */
const TYPE_SHORT = { inf: 'INF', gar: 'GAR', pz: 'PZ', art: 'ART' };

function updateUnitbar() {
  const bar = document.getElementById('unitbar');
  if (!game) { bar.classList.add('hidden'); return; }
  if (document.querySelector('#unitbar select:focus')) return;   // Dropdown offen: nicht neu bauen
  const sel = playerSelection();
  if (!sel.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  const nat = game.nations[game.player];
  const head = document.getElementById('unitbar-head');
  if (sel.length === 1) {
    const d = sel[0];
    const t = BAL.divTypes[d.type];
    const sup = game.supplyModOf(d);
    const army = d.army != null ? game.armyById(d.nation, d.army) : null;
    const wp = d.queue && d.queue.length ? ` · 📍 ${d.queue.length} Wegpunkt(e)` : '';
    // UI-Diät: Moral als Zustand, Versorgung nur wenn sie zum Problem wird
    const moralIcon = d.moral >= 1.05 ? '😄' : d.moral >= 0.85 ? '🙂' : d.moral >= 0.65 ? '😐' : '😟';
    const supWarn = sup.level < 0.5
      ? ` · <span style="color:#e0a34a">⚠️ Nachschub ${Math.round(sup.level * 100)} %</span>` : '';
    head.innerHTML = `<b>${d.name}</b><span class="small"> ${army ? army.name : ''} · ${d.manual ? '🎮 dein Befehl' : '🤖 Automatik'}${wp}</span>
      <span class="small ub-stats">Stärke ${Math.round(d.str)} · Org ${Math.round(d.org)}/${t.maxOrg} · ${moralIcon}${supWarn}</span>
      <button class="mini" id="ub-close" title="Auswahl aufheben (Esc)">✕</button>`;
  } else {
    const avgStr = sel.reduce((s, d) => s + d.str, 0) / sel.length;
    const autoN = sel.filter(d => !d.manual).length;
    head.innerHTML = `<b>${sel.length} Divisionen</b><span class="small"> · Ø Stärke ${Math.round(avgStr)} % · ${autoN ? autoN + '× 🤖 Automatik' : 'alle 🎮 unter Befehl'}</span>
      <span class="small ub-stats">Rechtsklick = Marsch · Shift = Wegpunkt · Alt = Front</span>
      <button class="mini" id="ub-close" title="Auswahl aufheben (Esc)">✕</button>`;
  }

  const cards = document.getElementById('unitbar-cards');
  const shown = sel.slice(0, 24);
  cards.innerHTML = shown.map(d => {
    const t = BAL.divTypes[d.type];
    const lowSup = game.supplyModOf(d).level < 0.25 ? '⚠️' : '';
    return `<div class="ucard" data-div="${d.id}" title="${d.name} — Klick: einzeln wählen, Strg/Shift: abwählen">
      <div class="ucard-type" style="border-top-color:${TYPE_STRIPE[d.type] || '#8fa0b3'}">${TYPE_SHORT[d.type] || '?'}</div>
      <div class="ubar"><i style="width:${Math.max(0, Math.min(100, d.str))}%;background:#57c268"></i></div>
      <div class="ubar"><i style="width:${Math.max(0, Math.min(100, d.org / t.maxOrg * 100))}%;background:#e0b34a"></i></div>
      <div class="ucard-flags">${d.inCombat ? '⚔' : ''}${lowSup}${d.manual ? '' : '🤖'}</div>
    </div>`;
  }).join('') + (sel.length > 24 ? `<div class="ucard-more small">+${sel.length - 24}</div>` : '');

  // Häufigste Armee der Auswahl als Vorauswahl
  const armyCount = {};
  sel.forEach(d => { if (d.army != null) armyCount[d.army] = (armyCount[d.army] || 0) + 1; });
  const topArmy = Object.entries(armyCount).sort((a, b) => b[1] - a[1])[0];
  const actions = document.getElementById('unitbar-actions');
  actions.innerHTML = `
    <button id="ub-split" title="Teilen — braucht ≥ 40 Stärke (S)">✂ Teilen</button>
    <button id="ub-merge" title="Gleiche Typen vereinen (M)">🔗 Vereinen</button>
    <select id="ub-army" title="Ziel-Armee für die Automatik">${nat.armies.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select>
    <button id="ub-assign" title="Divisionen verteilen sich selbstständig an der Front dieser Armee">🤖 Automatik</button>
    <button id="ub-disband" class="danger" title="Ausgewählte Divisionen auflösen (50 % der Soldaten zurück)">🗑</button>`;
  if (topArmy) actions.querySelector('#ub-army').value = topArmy[0];

  document.getElementById('ub-close').onclick = () => { UI.selectedDivs.clear(); updateUnitbar(); };
  cards.querySelectorAll('.ucard').forEach(el => el.addEventListener('click', e => {
    const id = +el.dataset.div;
    if (e.ctrlKey || e.shiftKey) {
      if (UI.selectedDivs.has(id)) UI.selectedDivs.delete(id);
      else UI.selectedDivs.add(id);
    } else {
      UI.selectedDivs.clear();
      UI.selectedDivs.add(id);
      const d = game.divisions.find(x => x.id === id && !x.dead);
      if (d) centerOn(d.c, d.r, Math.max(UI.cam.zoom, 1.4));
    }
    updateUnitbar();
  }));
  document.getElementById('ub-split').onclick = () => splitSelection();
  document.getElementById('ub-merge').onclick = () => mergeSelection();
  document.getElementById('ub-assign').onclick = () => {
    const armyId = +document.getElementById('ub-army').value;
    let n = 0;
    for (const d of playerSelection()) {
      d.army = armyId; d.manual = false; d.path = null; d.queue = []; d.attackTarget = null;
      n++;
    }
    game.updateFronts(game.player);
    pushToast(`🤖 ${n} Division(en) der Armee-Automatik übergeben — sie verteilen sich an der Front.`);
    updateUnitbar();
  };
  document.getElementById('ub-disband').onclick = () => {
    const toDisband = playerSelection();
    for (const d of toDisband) game.disbandDivision(d);
    UI.selectedDivs.clear();
    pushToast(`🗑 ${toDisband.length} Division(en) aufgelöst.`);
    updateUnitbar();
    updateTopbar();
  };
}

/* =========================================================
   GEFÜHRTES ERSTES MATCH & BERATER (Easy Entry)
   ========================================================= */
const TUTORIAL_STEPS = [
  { text: 'Wähle deine Divisionen (Klick oder <b>Links-Ziehen</b>) und erobere per <b>Rechtsklick</b> graues Neutralland — hol dir 8 Provinzen!',
    done: g => g.nations[g.player].hexCount >= 8 },
  { text: 'Bau eine <b>🎪 Kaserne</b>: Menüleiste links → 🏗️ (Taste <b>B</b>). Sie bildet 👥 Leute zu 🎖️ Soldaten aus.',
    ghost: 'kaserne', done: g => g.nations[g.player].trainCap > 0 },
  { text: 'Bau ein <b>🏠 Dorf</b> — es erzeugt 👥 Leute, den Nachschub für deine Kaserne.',
    ghost: 'dorf', done: g => g.nations[g.player].leutePerDay >= 0.19 },
  { text: 'Öffne das <b>🪖 Armeen-Menü</b> links und stelle eine Infanterie-Division auf (<b>+1</b>) — kostet Gold + 🎖️ Soldaten.',
    done: g => g.divisionsOf(g.player).length >= 3 },
  { text: 'Bau eine <b>🏙️ Stadt</b> (im Bau-Menü auf ein Dorf klicken) — sie bringt Gold <b>und</b> Leute. Danach: erobere 🏛️ Hauptstädte — <b>4 gewinnen die Runde!</b>',
    done: g => (g.nations[g.player].staedte || 0) >= 1 },
];

function tutorialDone() {
  try { return localStorage.getItem('finalfront_tutorial') === 'done'; } catch (e) { return true; }
}
function markTutorialDone() {
  try { localStorage.setItem('finalfront_tutorial', 'done'); } catch (e) { /* egal */ }
}

function updateTutorial() {
  const el = document.getElementById('tutorial');
  if (!game || game.over || UI.tutorialStep == null || UI.tutorialStep < 0
    || UI.tutorialStep >= TUTORIAL_STEPS.length) {
    el.classList.add('hidden');
    UI._ghost = null;
    return;
  }
  if (TUTORIAL_STEPS[UI.tutorialStep].done(game)) {
    UI.tutorialStep++;
    UI._ghost = null;
    UI._tutRendered = -1;
    if (UI.tutorialStep >= TUTORIAL_STEPS.length) {
      markTutorialDone();
      pushToast('🎓 Einführung abgeschlossen — Europa wartet. Viel Erfolg!');
      el.classList.add('hidden');
      return;
    }
    pushToast('✅ Aufgabe geschafft!');
  }
  const s = TUTORIAL_STEPS[UI.tutorialStep];
  el.classList.remove('hidden');
  if (UI._tutRendered !== UI.tutorialStep) {
    UI._tutRendered = UI.tutorialStep;
    el.innerHTML = `<div class="tut-head"><span>🎓 AUFGABE ${UI.tutorialStep + 1}/${TUTORIAL_STEPS.length}</span>
        <button class="mini" id="tut-skip" title="Einführung überspringen">✕</button></div>
      <div class="tut-text">${s.text}</div>`;
    el.querySelector('#tut-skip').onclick = () => {
      markTutorialDone();
      UI.tutorialStep = -1;
      UI._ghost = null;
      el.classList.add('hidden');
      pushToast('🎓 Einführung übersprungen — ❓ oben rechts hilft jederzeit.');
    };
  }
  // Geister-Bauplatz vorschlagen (für Kasernen-/Dorf-Aufgabe)
  if (s.ghost) {
    if (!UI._ghost || UI._ghost.what !== s.ghost || performance.now() - UI._ghost.t > 5000) {
      const nat = game.nations[game.player];
      const spot = game.findBuildSpot(game.player, nat.capital[0], nat.capital[1],
        h => TERRAIN[h.terrain].buildable && !h.building, 10);
      UI._ghost = spot ? { c: spot.c, r: spot.r, what: s.ghost, t: performance.now() } : null;
    }
  } else {
    UI._ghost = null;
  }
}

/* Berater: erklärt Engpässe in dem Moment, in dem sie auftreten */
const ADVISOR_CHECKS = [
  { key: 'leute', cd: 60000,
    when: g => { const n = g.nations[g.player]; return n.trainCap > 0 && n.leute < 0.5 && n.soldaten < 15; },
    msg: '⚠️ Deine Kasernen haben keine 👥 Leute mehr — bau Dörfer oder Städte!' },
  { key: 'kaserne', cd: 90000,
    when: g => { const n = g.nations[g.player]; return n.trainCap === 0 && g.day > 40 && n.gold >= BAL.cost.kaserne; },
    msg: '💡 Ohne 🎪 Kaserne bekommst du keine Soldaten — bau eine (Menü links → 🏗️).' },
  { key: 'stau', cd: 90000,
    when: g => { const n = g.nations[g.player]; return n.soldaten > 30 && n.gold > 300; },
    msg: '💡 Viele 🎖️ Soldaten warten — stelle im Armeen-Menü Divisionen auf!' },
  { key: 'supply', cd: 90000,
    when: g => g.divisionsOf(g.player).some(d => g.supplyModOf(d).level < 0.2),
    msg: '⚠️ Divisionen ohne Nachschub verlieren Stärke — Straßen, Städte und Häfen versorgen.' },
];

function advisorTick() {
  if (!game || game.over || game.paused || game.day < 10) return;
  const now = performance.now();
  UI._advisor = UI._advisor || {};
  for (const c of ADVISOR_CHECKS) {
    const last = UI._advisor[c.key];
    if (last !== undefined && now - last < c.cd) continue;   // "nie gefeuert" ist immer fällig
    if (c.when(game)) {
      UI._advisor[c.key] = now;
      pushToast(c.msg);
      break;   // höchstens eine Warnung auf einmal
    }
  }
}

/* ---------- Ereignis-Log ---------- */
let lastLogLen = 0;
function updateLog() {
  if (!game) return;
  if (game.log.length === lastLogLen) return;
  lastLogLen = game.log.length;
  const el = document.getElementById('log');
  el.innerHTML = game.log.slice(-7).map(l =>
    `<div class="${l.important ? 'imp' : ''}"><span>${dateStr(l.day)}</span> ${l.msg}</div>`).join('');
}

/* ---------- Start- und Endbildschirm ---------- */
function showStartScreen() {
  const sc = document.getElementById('start');
  sc.classList.remove('hidden');
  document.getElementById('gameover').classList.add('hidden');
  const grid = document.getElementById('nation-grid');
  grid.innerHTML = Object.entries(NATION_DEFS).map(([id, def]) => {
    return `<button class="nation-card" data-nation="${id}">
      <span class="chip big" style="background:${def.color}"></span>
      <b>${def.name}</b>
      <span class="small">startet bei ${def.capitalName}</span>
    </button>`;
  }).join('');
  grid.querySelectorAll('.nation-card').forEach(b =>
    b.addEventListener('click', () => startGame(b.dataset.nation)));
  const cont = document.getElementById('btn-continue');
  const has = readSlot('finalfront_save') || readSlot('finalfront_autosave');
  cont.classList.toggle('hidden', !has);
  cont.onclick = () => loadNewestSave();
}

function startGame(nationId) {
  window.game = new Game(nationId);
  lastLogLen = 0;
  UI.selectedHex = null; UI.selectedDivs.clear(); UI.selectedArmy = null;
  UI.buildMode = null;
  UI.activeTab = 'bauen';
  document.getElementById('start').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('offers').innerHTML = '';
  game._offersChanged = true;
  game.updateFronts();
  centerOn(...game.nations[nationId].capital, 1.25);
  UI.tutorialStep = tutorialDone() ? -1 : 0;
  UI._tutRendered = -1;
  UI._advisor = {};
  UI._ghost = null;
  refreshPanel();
  updateTopbar();
  updateUnitbar();
  updateTutorial();
}

function checkGameOver() {
  if (!game || !game.over) return;
  const el = document.getElementById('gameover');
  if (!el.classList.contains('hidden')) return;
  el.classList.remove('hidden');
  el.querySelector('h1').textContent = game.over.win ? '🏆 SIEG!' : '💀 NIEDERLAGE';
  el.querySelector('p').textContent = game.over.text;
  // Endstand: Top 5 + Spieler
  game.vpRecount();
  const ids = rankedNations();
  let html = `<div class="rank-head">ENDSTAND (Tag ${game.day}) — 🏛️ Hauptstädte · Provinzen</div>`;
  ids.forEach((id, i) => {
    if (i < 5 || id === game.player) html += rankRowHtml(i + 1, id);
  });
  if (!game.nations[game.player].alive)
    html += `<div class="rank-row me"><span class="rank-pl">☠</span><span class="rank-name">Dein Reich ist untergegangen</span></div>`;
  document.getElementById('gameover-stats').innerHTML = html;
  document.getElementById('ranking').innerHTML = '';
}
