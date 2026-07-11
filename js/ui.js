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
  MAP_SCALE: 1.7,                 // Cache-Schärfe: reicht bis Zoom ~2.1 ohne Matsch
  OV_SCALE: 0.55,
  OV_ZMAX: 0.92,                  // bis zu diesem Zoom: ruhige Übersichtsebene
  ZSWITCH: 2.1,                   // erst darüber: teures Live-Zeichnen pro Frame
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

/* ---------- HUD-Sichtbarkeit: alles Unwichtige ist ausblendbar ----------
   Ereignis-Log ist standardmäßig AUS — wichtige Dinge kommen als Toast. */
UI.hud = (() => {
  try { return Object.assign({ log: false, rank: true, mini: true }, JSON.parse(localStorage.getItem('finalfront_hud') || '{}')); }
  catch (e) { return { log: false, rank: true, mini: true }; }
})();

function applyHud() {
  document.getElementById('log').classList.toggle('hidden', !UI.hud.log);
  document.getElementById('ranking').classList.toggle('hidden', !UI.hud.rank);
  document.getElementById('minimap').classList.toggle('hidden', !UI.hud.mini);
  for (const [k, id] of [['log', 'hud-log'], ['rank', 'hud-rank'], ['mini', 'hud-mini']]) {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('active', !!UI.hud[k]);
  }
  try { localStorage.setItem('finalfront_hud', JSON.stringify(UI.hud)); } catch (e) { /* egal */ }
}

/* ---------- Farb-Helfer ---------- */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.min(255, Math.max(0, Math.round(r * f)));
  g = Math.min(255, Math.max(0, Math.round(g * f)));
  b = Math.min(255, Math.max(0, Math.round(b * f)));
  return `rgb(${r},${g},${b})`;
}

function colorA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* Eigenes Icon statt Emoji: verweist auf ein <symbol> im Sprite-Sheet (index.html) */
function ic(name, cls) {
  return `<svg class="ic${cls ? ' ' + cls : ''}"><use href="#i-${name}"/></svg>`;
}
/* Moral als farbiger Punkt statt Emoji-Gesicht (grün→rot) */
function moralDot(m) {
  const col = m >= 1.05 ? '#57c268' : m >= 0.85 ? '#b6c34a' : m >= 0.65 ? '#e0a34a' : '#e0574a';
  return `<span class="ic-dot" style="background:${col}"></span>`;
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
  applyHud();
}

function resizeCanvas() {
  UI.canvas.width = window.innerWidth;
  UI.canvas.height = window.innerHeight;
}

/* Nach einem Kartenwechsel: alle Render-Ebenen auf die neue Weltgröße bringen */
function rebuildLayers() {
  UI.mapLayer.width = Math.round(WORLD_W * UI.MAP_SCALE);
  UI.mapLayer.height = Math.round(WORLD_H * UI.MAP_SCALE);
  UI.ovLayer.width = Math.round(WORLD_W * UI.OV_SCALE);
  UI.ovLayer.height = Math.round(WORLD_H * UI.OV_SCALE);
  UI.minimap.height = Math.round(220 * WORLD_H / WORLD_W);
  UI.minimapBase.width = UI.minimap.width;
  UI.minimapBase.height = UI.minimap.height;
  UI.labels = null;
}

/* Breite der linken UI (Menüleiste + ggf. offenes Panel) */
function leftUIW() {
  return 52 + (UI.activeTab ? 308 : 0);
}

function fitZoom() {
  // Untergrenze schützt vor innerWidth=0 (verdeckter Tab) → nie negativer Zoom
  return Math.max(0.25,
    Math.min((window.innerWidth - leftUIW() - 20) / WORLD_W, (window.innerHeight - 60) / WORLD_H));
}

function fitView() {
  // Versteckter/eingeklappter Tab meldet 0×0 — damit nicht rechnen
  if (window.innerWidth < 100 || window.innerHeight < 100) return;
  UI.zoomAnim = null;
  UI.cam.zoom = fitZoom();
  UI.cam.x = WORLD_W / 2 - (window.innerWidth + leftUIW()) / 2 / UI.cam.zoom;
  UI.cam.y = WORLD_H / 2 - (window.innerHeight + 44) / 2 / UI.cam.zoom;
}

function centerOn(c, r, zoom) {
  UI.zoomAnim = null;
  const p = hexToPixel(c, r);
  if (zoom) UI.cam.zoom = zoom;
  UI.cam.x = p.x - (window.innerWidth + leftUIW()) / 2 / UI.cam.zoom;
  UI.cam.y = p.y - window.innerHeight / 2 / UI.cam.zoom;
}

function camClamp() {
  if (!(UI.cam.zoom > 0.05)) UI.cam.zoom = fitZoom();   // kaputte Zoom-Werte heilen
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

/* Fluss: dezente Tönung + DURCHGEHENDE Wasserlinie zu Nachbar-Flüssen
   und zum Meer — Flüsse lesen sich als Linien, nicht als Kleckse. */
function drawRiverAt(ctx, h, p, detailed) {
  ctx.lineCap = 'round';
  // Segmente zu Nachbar-Flüssen/Meer einsammeln
  const segs = [];
  let mouths = 0;
  for (const [nc, nr] of neighborsOf(h.c, h.r)) {
    const nh = game.hexAt(nc, nr);
    if (!nh || (!nh.river && nh.terrain !== 'water')) continue;
    if (nh.terrain === 'water' && !nh.river) {
      if (mouths >= 1 || segs.length >= 2) continue;   // genau EINE Mündung, kein Küsten-Stern
      mouths++;
    }
    const np = hexToPixel(nc, nr);
    const mx = (p.x + np.x) / 2, my = (p.y + np.y) / 2;
    // leichte Biegung: Kontrollpunkt seitlich versetzt fürs Mäandern
    const ox = (my - p.y) * 0.28, oy = (p.x - mx) * 0.28;
    segs.push([(p.x + mx) / 2 + ox, (p.y + my) / 2 + oy, mx, my]);
  }
  if (!segs.length) segs.push([p.x, p.y - 3, p.x + 5, p.y + 1]);
  // Zwei Durchgänge: dunkle Fassung + heller Kern — der Fluss bleibt auch
  // auf eingefärbtem (erobertem) Land klar lesbar.
  const passes = [
    [detailed ? 4.4 : 3.8, 'rgba(16, 42, 66, 0.72)'],
    [detailed ? 2.2 : 1.8, 'rgba(132, 198, 246, 0.95)'],
  ];
  for (const [w, style] of passes) {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    for (const [cx, cy, mx, my] of segs) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(cx, cy, mx, my);
      ctx.stroke();
    }
  }
}

/* Flachwasser: heller Saum entlang der Küsten gibt der Karte Tiefe */
function drawShallowAt(ctx, p, size) {
  hexPath(ctx, p.x, p.y, size);
  ctx.fillStyle = 'rgba(96, 156, 205, 0.20)';
  ctx.fill();
}

function drawBuilding(ctx, h, x, y, detailed) {
  ctx.save();
  ctx.translate(x, y);
  // Ausbau-Level VISUELL: das Gebäude selbst wird größer (kein Symbol-Kram)
  const lvl = h.level || 1;
  if (lvl > 1 && h.building) {
    const s = 1 + (lvl - 1) * 0.22;
    ctx.scale(s, s);
  }
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
    // Fels-Halde mit gezimmertem Stolleneingang + glänzendem Golderz
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(-6.2, 4.2, 12.6, 1.3);
    // Felsmound (rund, nicht spitz — sonst wirkt es wie ein Zelt)
    ctx.fillStyle = '#6b6154'; ctx.strokeStyle = '#241f1a';
    ctx.beginPath();
    ctx.moveTo(-6.4, 4.4);
    ctx.quadraticCurveTo(-5.6, -2.6, -1.6, -3.9);
    ctx.quadraticCurveTo(3.8, -4.6, 6.4, 4.4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Felskanten für Volumen
    if (detailed) {
      ctx.strokeStyle = 'rgba(28,23,18,0.45)'; ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-3.8, -1.4); ctx.lineTo(-2.2, 0.8);
      ctx.moveTo(2.8, -2.4); ctx.lineTo(4.2, 0.2);
      ctx.stroke();
    }
    // Stolleneingang: dunkles Portal mit rundem Sturz
    ctx.fillStyle = '#0f0b08';
    ctx.beginPath();
    ctx.moveTo(-2.5, 4.4);
    ctx.lineTo(-2.5, 0.6);
    ctx.quadraticCurveTo(0, -1.8, 2.5, 0.6);
    ctx.lineTo(2.5, 4.4);
    ctx.closePath(); ctx.fill();
    // Holz-Grubenzimmerung (zwei Pfosten + Sturzbalken)
    ctx.strokeStyle = '#8a5a2c'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2.9, 4.4); ctx.lineTo(-2.9, 0.7);
    ctx.quadraticCurveTo(0, -1.7, 2.9, 0.7); ctx.lineTo(2.9, 4.4);
    ctx.stroke();
    // Golderz-Ader am Eingang (glänzt)
    ctx.fillStyle = '#f5c542'; ctx.strokeStyle = '#b3861a'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.arc(-4.3, 1.4, 0.85, 0, 7); ctx.fill(); ctx.stroke();
    if (detailed) {
      ctx.beginPath(); ctx.arc(4.5, 1.9, 0.7, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath(); ctx.arc(-4.5, 1.1, 0.28, 0, 7); ctx.fill();
    }
  } else if (h.building === 'fischerei') {
    // Boot
    ctx.fillStyle = '#8a6f4a'; ctx.strokeStyle = '#3a2c18';
    ctx.beginPath();
    ctx.moveTo(-5.5, 0.5); ctx.lineTo(5.5, 0.5); ctx.lineTo(3.4, 3.2); ctx.lineTo(-3.4, 3.2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Segel
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(0, -5.4); ctx.stroke();
    ctx.fillStyle = 'rgba(246,240,224,0.96)'; ctx.strokeStyle = '#232a36';
    ctx.beginPath();
    ctx.moveTo(0.2, -5.2); ctx.lineTo(0.2, -0.4); ctx.lineTo(4.2, -1.6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (detailed) {
      // Netz mit Schwimmern
      ctx.strokeStyle = 'rgba(240,240,245,0.75)'; ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-6.5, -2.5); ctx.quadraticCurveTo(-4, -0.5, -1.6, -2.8);
      ctx.moveTo(-5.8, -3.6); ctx.lineTo(-5, -0.9);
      ctx.moveTo(-3.6, -3.4); ctx.lineTo(-3.2, -1.2);
      ctx.stroke();
      ctx.fillStyle = '#e8d67a';
      ctx.beginPath(); ctx.arc(-6.3, -2.6, 0.7, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(-1.8, -2.8, 0.7, 0, 7); ctx.fill();
    }
  } else if (h.building === 'forsterei') {
    // Holzstapel
    ctx.strokeStyle = '#3a2c18';
    const log = (lx, ly) => {
      ctx.fillStyle = '#8a6540';
      ctx.beginPath(); ctx.arc(lx, ly, 1.9, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9a36c';
      ctx.beginPath(); ctx.arc(lx, ly, 1.0, 0, 7); ctx.fill();
    };
    log(-4.6, 3); log(-0.8, 3); log(-2.7, 0.4);
    // Hütte mit Säge
    ctx.fillStyle = '#7a5c38'; ctx.strokeStyle = '#3a2c18';
    ctx.fillRect(1.6, -0.6, 5.4, 4.4); ctx.strokeRect(1.6, -0.6, 5.4, 4.4);
    ctx.fillStyle = '#4e6b38';
    ctx.beginPath();
    ctx.moveTo(0.9, -0.6); ctx.lineTo(4.3, -3.6); ctx.lineTo(7.7, -0.6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (detailed) {
      // Axt am Stapel
      ctx.strokeStyle = '#5a4630'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(-4.4, -3.6); ctx.lineTo(-2, -0.8); ctx.stroke();
      ctx.fillStyle = '#b9c2cc';
      ctx.beginPath();
      ctx.moveTo(-4.9, -4.2); ctx.lineTo(-3.4, -3.4); ctx.lineTo(-4.6, -2.6);
      ctx.closePath(); ctx.fill();
    }
  } else if (h.building === 'farm') {
    // Scheune mit Koppel
    ctx.fillStyle = '#a3502e'; ctx.strokeStyle = '#3a2118';
    ctx.fillRect(-5.6, -1.2, 6.4, 4.6); ctx.strokeRect(-5.6, -1.2, 6.4, 4.6);
    ctx.fillStyle = '#7d3c22';
    ctx.beginPath();
    ctx.moveTo(-6.3, -1.2); ctx.lineTo(-2.4, -4.4); ctx.lineTo(1.5, -1.2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (detailed) {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(-3.4, 0.2, 2, 3.2);   // Tor
      ctx.strokeStyle = '#3a2118'; ctx.lineWidth = 0.6;
      ctx.strokeRect(-3.4, 0.2, 2, 3.2);
    }
    // Koppel-Zaun
    ctx.strokeStyle = '#8a6f4a'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(2.2, 0.6); ctx.lineTo(7.6, 0.6);
    ctx.moveTo(2.2, 3.4); ctx.lineTo(7.6, 3.4);
    ctx.moveTo(2.6, 0); ctx.lineTo(2.6, 3.8);
    ctx.moveTo(4.9, 0); ctx.lineTo(4.9, 3.8);
    ctx.moveTo(7.2, 0); ctx.lineTo(7.2, 3.8);
    ctx.stroke();
    // kleines Pferd in der Koppel (Seitenansicht, gesenkter Kopf beim Grasen)
    ctx.fillStyle = '#6b4f34'; ctx.strokeStyle = '#33261a'; ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(3.3, 1.9);   // Kruppe
    ctx.lineTo(4.6, 1.6);   // Rücken
    ctx.lineTo(5.4, 1.5);   // Widerrist
    ctx.lineTo(6.4, 2.6);   // Hals nach unten
    ctx.lineTo(6.9, 3.0);   // Kopf/Maul (grasend)
    ctx.lineTo(6.4, 3.2);
    ctx.lineTo(5.7, 2.4);   // Kehle
    ctx.lineTo(5.3, 3.4);   // Vorderbein
    ctx.lineTo(4.9, 3.4);
    ctx.lineTo(4.9, 2.3);
    ctx.lineTo(3.9, 2.3);
    ctx.lineTo(3.9, 3.4);   // Hinterbein
    ctx.lineTo(3.5, 3.4);
    ctx.lineTo(3.6, 2.2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Schweif
    ctx.strokeStyle = '#33261a'; ctx.lineWidth = 0.7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(3.3, 1.9); ctx.lineTo(2.7, 3.1); ctx.stroke();
  } else if (h.building === 'turm') {
    // WEHRTURM: stämmiger Steinturm mit auskragendem Zinnenkranz + Scharten.
    // Hochkant + Zinnen = klar Festungswerk (passt zu Schwert/Kavallerie/Kanone)
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-4.4, 4.3, 9.0, 1.2);
    // Turmschaft (leicht konisch, unten breiter → standfest)
    ctx.fillStyle = '#9a938a'; ctx.strokeStyle = '#332f29';
    ctx.beginPath();
    ctx.moveTo(-3.6, 4.4); ctx.lineTo(-3.0, -2.8);
    ctx.lineTo(3.0, -2.8); ctx.lineTo(3.6, 4.4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Schattenseite rechts für Volumen
    ctx.fillStyle = 'rgba(50,46,40,0.20)';
    ctx.beginPath();
    ctx.moveTo(0.7, -2.8); ctx.lineTo(3.0, -2.8); ctx.lineTo(3.6, 4.4); ctx.lineTo(1.3, 4.4);
    ctx.closePath(); ctx.fill();
    // auskragender Zinnenkranz (Machicoulis, etwas breiter als der Schaft)
    ctx.fillStyle = '#aca69c'; ctx.strokeStyle = '#332f29';
    ctx.beginPath(); ctx.rect(-4.0, -4.2, 8.0, 1.5); ctx.fill(); ctx.stroke();
    // Zinnen (Zähne)
    for (let zx = -4.0; zx < 3.4; zx += 1.6) {
      ctx.beginPath(); ctx.rect(zx, -5.5, 0.95, 1.4); ctx.fill(); ctx.stroke();
    }
    // Schießscharten: senkrechter Schlitz in der Mitte + zwei kleine
    ctx.fillStyle = '#22262d';
    ctx.fillRect(-0.55, -1.7, 1.1, 2.6);
    ctx.fillRect(-2.5, -1.0, 0.75, 1.7);
    ctx.fillRect(1.75, -1.0, 0.75, 1.7);
    if (detailed) {
      // Steinquader-Fugen
      ctx.strokeStyle = 'rgba(50,46,40,0.4)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-3.2, 1.4); ctx.lineTo(3.2, 1.4);
      ctx.moveTo(-3.4, 3.0); ctx.lineTo(3.4, 3.0);
      ctx.moveTo(0, 1.4); ctx.lineTo(0, 4.4);
      ctx.stroke();
    }
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
  // Straßen verbinden sich NUR mit Straßen und Städten — sonst entsteht
  // ein wirres Muster aus Stichstraßen zu jedem Gebäude
  if (!h.road) return;
  const segs = [];
  for (const [nc, nr] of neighborsOf(h.c, h.r)) {
    const nh = game.hexAt(nc, nr);
    if (nh && (nh.road || nh.building === 'stadt' || nh.capital)) {
      const np = hexToPixel(nc, nr);
      segs.push([(p.x + np.x) / 2, (p.y + np.y) / 2]);
    }
  }
  if (!segs.length) segs.push([p.x + 4, p.y]);
  // Zwei Durchgänge: dunkle Fassung + sandiger Kern = lesbare Straße
  for (const [w, style] of [[3.6, 'rgba(40,30,18,0.85)'], [2.0, 'rgba(196,168,120,0.95)']]) {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    for (const [mx, my] of segs) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(mx, my);
      ctx.stroke();
    }
  }
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
  const rect = null;   // IMMER voll neu zeichnen — Teilflächen hinterlassen Näht-Rahmen
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
    if (h.terrain === 'water') {
      if (h.coastal) drawShallowAt(ctx, hexToPixel(c, r), HEX_SIZE + 0.55);
      continue;
    }
    const p = hexToPixel(c, r);
    fillHex(ctx, h, p);
    drawTerrainArt(ctx, h, p.x, p.y, false);
  }
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
  // Flüsse ÜBER den Grenzen: bleiben auch auf erobertem Land sichtbar
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const h = game.hexAt(c, r);
    if (h.river) drawRiverAt(ctx, h, hexToPixel(c, r), false);
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
    if (h.terrain === 'water') {
      if (h.coastal) drawShallowAt(ctx, hexToPixel(c, r), HEX_SIZE + 1.1);
      continue;
    }
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
    if (h.river) {
      ctx.fillStyle = 'rgba(50, 122, 194, 0.42)';
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
const TYPE_STRIPE = { inf: null, kav: '#7fa8d8', kan: '#d87f7f' };

/* =========================================================
   TRUPPEN-SPRITES — gefüllte Silhouetten statt Strichfiguren.
   Gezeichnet in Weltkoordinaten (Kamera skaliert), zentriert
   auf (cx, cy). Heller Körper + dunkle Kontur, damit sie auf
   jeder Nationsfarbe knallen.
   ========================================================= */
function beginSprite(ctx) {
  ctx.fillStyle = '#f3f7fc';
  ctx.strokeStyle = 'rgba(9,13,22,0.92)';
  ctx.lineWidth = 0.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}
function polySprite(ctx, cx, cy, pts) {
  ctx.beginPath();
  ctx.moveTo(cx + pts[0][0], cy + pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(cx + pts[i][0], cy + pts[i][1]);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

/* Krieger: rundes Schild + gekreuzte Schwerter */
function drawKriegerSprite(ctx, cx, cy) {
  // Schild-Rückgrund (leicht durchscheinend)
  ctx.beginPath();
  ctx.arc(cx, cy + 0.2, 4.7, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // zwei gekreuzte Schwerter (Griffe unten, Klingen oben)
  for (const ang of [0.6, -0.6]) {
    ctx.save();
    ctx.translate(cx, cy + 0.6);
    ctx.rotate(ang);
    beginSprite(ctx);
    // Klinge (spitz zulaufend)
    polySprite(ctx, 0, 0, [[0, -5.6], [-0.7, -4.3], [-0.62, 1.0], [0.62, 1.0], [0.7, -4.3]]);
    // Parierstange
    polySprite(ctx, 0, 0, [[-2.1, 1.1], [2.1, 1.1], [1.8, 2.0], [-1.8, 2.0]]);
    // Griff
    ctx.beginPath(); ctx.rect(-0.55, 2.0, 1.1, 2.1); ctx.fill(); ctx.stroke();
    // Knauf
    ctx.beginPath(); ctx.arc(0, 4.5, 0.95, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

/* Kavallerie: Pferdekopf im Profil (Springer-Silhouette), nach rechts —
   fließende Mähne entlang des Nackens, spitze Ohren, klares Maul */
function drawKavallerieSprite(ctx, cx, cy) {
  beginSprite(ctx);
  polySprite(ctx, cx, cy, [
    [-2.4, 4.4],   // Halsansatz hinten unten
    [-3.3, 2.3],   // Mähne-Schwung 1 (ausgestellt)
    [-2.5, 1.2],
    [-3.4, -0.2],  // Mähne-Schwung 2
    [-2.4, -1.2],
    [-3.0, -2.4],  // Mähne-Spitze am Nacken
    [-1.9, -2.6],
    [-1.4, -3.7],  // hinteres Ohr Basis
    [-1.2, -4.9],  // hinteres Ohr Spitze
    [-0.2, -3.5],  // zwischen den Ohren
    [0.6, -4.6],   // vorderes Ohr Spitze
    [1.0, -3.1],   // Stirn
    [2.8, -2.5],   // Braue
    [4.6, -1.0],   // Nüster oben
    [5.1, 0.3],    // Nase
    [4.1, 1.0],    // Maul
    [2.7, 0.6],    // Maulwinkel
    [3.1, 2.0],    // Kiefer
    [2.0, 3.2],    // Kehle
    [0.5, 4.3],    // Halsfront unten
  ]);
  // Auge
  ctx.beginPath();
  ctx.fillStyle = 'rgba(9,13,22,0.9)';
  ctx.arc(cx + 2.6, cy - 1.3, 0.55, 0, 7);
  ctx.fill();
  // Nüster
  ctx.beginPath();
  ctx.arc(cx + 4.3, cy - 0.1, 0.32, 0, 7);
  ctx.fill();
}

/* Kanonen: Feldkanone im Profil — Rad, Rohr, Mündungsblitz */
function drawKanonenSprite(ctx, cx, cy) {
  beginSprite(ctx);
  // Rohr (Lünse unten, Mündung nach oben-rechts)
  ctx.save();
  ctx.translate(cx - 1.6, cy + 0.7);
  ctx.rotate(-0.46);
  polySprite(ctx, 0, 0, [[-1.4, -1.5], [6.6, -0.8], [6.6, 0.8], [-1.4, 1.5]]);
  // Mündungsring
  ctx.beginPath(); ctx.rect(6.0, -1.0, 0.9, 2.0); ctx.fill(); ctx.stroke();
  // Bodenstück
  ctx.beginPath(); ctx.arc(-1.4, 0, 1.55, 0, 7); ctx.fill(); ctx.stroke();
  ctx.restore();
  // Rad
  ctx.beginPath();
  ctx.arc(cx - 3.1, cy + 1.9, 2.7, 0, 7);
  ctx.fillStyle = '#f3f7fc';
  ctx.fill(); ctx.stroke();
  // Nabe + Speichen (dunkel)
  ctx.strokeStyle = 'rgba(9,13,22,0.6)';
  ctx.lineWidth = 0.45;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 4 + 0.35;
    ctx.beginPath();
    ctx.moveTo(cx - 3.1, cy + 1.9);
    ctx.lineTo(cx - 3.1 + Math.cos(a) * 2.5, cy + 1.9 + Math.sin(a) * 2.5);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.fillStyle = 'rgba(9,13,22,0.9)';
  ctx.arc(cx - 3.1, cy + 1.9, 0.75, 0, 7);
  ctx.fill();
  // Mündungsblitz (warme Spitze)
  const mx = cx - 1.6 + Math.cos(-0.46) * 7.4, my = cy + 0.7 + Math.sin(-0.46) * 7.4;
  ctx.fillStyle = '#ffd15a';
  ctx.strokeStyle = 'rgba(120,70,10,0.7)';
  ctx.lineWidth = 0.4;
  polySprite(ctx, mx, my, [[0, -1.5], [0.5, -0.4], [1.6, 0], [0.5, 0.4], [0, 1.5], [-0.5, 0.4], [-1.4, 0], [-0.5, -0.4]]);
}

function drawUnitSprite(ctx, type, cx, cy) {
  ctx.save();
  if (type === 'inf') drawKriegerSprite(ctx, cx, cy);
  else if (type === 'kav') drawKavallerieSprite(ctx, cx, cy);
  else if (type === 'kan') drawKanonenSprite(ctx, cx, cy);
  ctx.restore();
}

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
    ctx.fillRect(d.x - w / 2, d.y + hh / 2 + 0.8, w * Math.max(0, d.org / t.maxOrg), 1.5);
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
  const stripeOff = TYPE_STRIPE[d.type] ? 1.1 : 0;
  drawUnitSprite(ctx, d.type, x + w / 2 + stripeOff, y + hh / 2);
  // Oberer Balken = ORGANISATION (grün), unterer = Ressourcen/Stärke (bernstein)
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.fillRect(x, y + hh + 1.1, w, 2.2);
  ctx.fillStyle = '#57c268';
  ctx.fillRect(x + 0.3, y + hh + 1.4, (w - 0.6) * Math.max(0, d.org / t.maxOrg), 1.6);
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.fillRect(x, y + hh + 3.8, w, 2.2);
  ctx.fillStyle = '#e0b34a';
  ctx.fillRect(x + 0.3, y + hh + 4.1, (w - 0.6) * Math.max(0, d.str / BAL.maxStr), 1.6);
  const vet = game.vetLevel(d);
  if (vet > 0) {
    // Veteranen: goldene Winkel überm Counter
    ctx.fillStyle = '#ffd76a';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.6;
    for (let v = 0; v < vet; v++) {
      const vx = x + 2.4 + v * 4.4, vy = y - 1.8;
      ctx.beginPath();
      ctx.moveTo(vx - 1.8, vy); ctx.lineTo(vx, vy - 2.9); ctx.lineTo(vx + 1.8, vy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
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
  const now = performance.now();
  // Framerate-unabhängiges Easing: gleiche Glätte bei 60 und 120 Hz
  const rdt = Math.min(0.1, (now - (UI._lastRenderT || now)) / 1000);
  UI._lastRenderT = now;
  const ease = 1 - Math.exp(-rdt * 12);

  // Sanfter Zoom: animiert zum Ziel, Weltpunkt unterm Anker bleibt stehen
  if (UI.zoomAnim) {
    const za = UI.zoomAnim;
    const nz = UI.cam.zoom + (za.target - UI.cam.zoom) * (1 - Math.exp(-rdt * 15));
    const w = screenToWorld(za.ax, za.ay);
    UI.cam.zoom = Math.abs(za.target - nz) < 0.002 ? za.target : nz;
    UI.cam.x = w.x - za.ax / UI.cam.zoom;
    UI.cam.y = w.y - za.ay / UI.cam.zoom;
    if (UI.cam.zoom === za.target) UI.zoomAnim = null;
  }

  // Selbstheilung: hat ein versteckter Tab die Kamera verstellt (Zoom unter
  // dem erlaubten Minimum), bei sichtbarem Viewport neu einpassen
  if (window.innerWidth > 100 && window.innerHeight > 100
    && UI.cam.zoom < Math.min(0.3, fitZoom() * 0.9) - 0.005) fitView();

  const { zoom } = UI.cam;
  camClamp();

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
      if (h.terrain === 'water') {
        if (h.coastal) drawShallowAt(ctx, hexToPixel(c, r), HEX_SIZE + 0.55);
        continue;
      }
      const p = hexToPixel(c, r);
      fillHex(ctx, h, p);
      drawTerrainArt(ctx, h, p.x, p.y, true);
    }
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
    // Flüsse ÜBER den Grenzen: bleiben auch auf erobertem Land sichtbar
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.river) drawRiverAt(ctx, h, hexToPixel(c, r), true);
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

  // Kessel: eingeschlossene Gebiete rot markieren
  if (game._pockets && game._pockets.length && zoom >= 0.4) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 400);
    for (const pk of game._pockets) {
      if (pk.cx < UI.cam.x - 200 || pk.cx > UI.cam.x + UI.canvas.width / zoom + 200
        || pk.cy < UI.cam.y - 200 || pk.cy > UI.cam.y + UI.canvas.height / zoom + 200) continue;
      ctx.fillStyle = `rgba(255, 58, 40, ${0.10 + 0.06 * pulse})`;
      for (const h of pk.hexes) {
        const p = hexToPixel(h.c, h.r);
        hexPath(ctx, p.x, p.y, HEX_SIZE + 0.4);
        ctx.fill();
      }
      if (zoom >= 0.7) {
        ctx.font = `800 ${11 / Math.min(zoom, 1.8) + 3}px 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3 / zoom + 1;
        ctx.strokeStyle = `rgba(30, 8, 6, ${0.7 + 0.2 * pulse})`;
        ctx.fillStyle = `rgba(255, 96, 80, ${0.75 + 0.25 * pulse})`;
        const label = pk.divCount > 0 ? `⚔${pk.divCount}` : '⚔';
        ctx.strokeText(label, pk.cx, pk.cy);
        ctx.fillText(label, pk.cx, pk.cy);
      }
    }
  }

  // Frontlinien des Spielers (War-of-Dots-Stil): Linie + Truppen-Badge.
  // Badge anklicken = Front wählen, dann Ziel klicken = Vormarsch.
  UI._frontBadges = [];
  for (const f of game.fronts) {
    if (f.owner !== game.player || !f.hexes.length) continue;
    const w = Math.max(2.5, 3.5 / zoom);
    const trace = () => {
      ctx.beginPath();
      let prev = null;
      for (const h of f.hexes) {
        const p = hexToPixel(h.c, h.r);
        if (!prev || hexDist(h.c, h.r, prev.c, prev.r) > 3) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        prev = h;
      }
    };
    const isBorder = f.kind === 'border';
    ctx.strokeStyle = isBorder ? 'rgba(255,70,45,0.28)' : 'rgba(255,200,60,0.26)';
    ctx.lineWidth = w * 2.6;
    ctx.lineJoin = 'round';
    trace();
    ctx.stroke();
    ctx.strokeStyle = isBorder ? 'rgba(255,86,58,0.95)' : 'rgba(255,205,70,0.92)';
    ctx.lineWidth = w * 0.9;
    ctx.setLineDash([7, 5]);
    trace();
    ctx.stroke();
    ctx.setLineDash([]);
    // Badge: Anzahl der Fronttruppen an der Linienmitte (klickbar!)
    const mid = f.hexes[Math.floor(f.hexes.length / 2)];
    const mp = hexToPixel(mid.c, mid.r);
    const n = game.frontDivisions(f).length;
    const rad = 6.5 / Math.min(zoom, 1.6) + 2;
    const armed = UI.pushMode === f.id;
    ctx.fillStyle = armed ? 'rgba(190,150,20,0.96)' : isBorder ? 'rgba(120,26,18,0.94)' : 'rgba(96,72,10,0.94)';
    ctx.strokeStyle = armed ? '#ffffff' : isBorder ? '#ff8a70' : '#ffd75e';
    ctx.lineWidth = (armed ? 2.2 : 1.4) / zoom + 0.5;
    ctx.beginPath(); ctx.arc(mp.x, mp.y - HEX_SIZE * 0.9, rad, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff2e0';
    ctx.font = `bold ${9 / Math.min(zoom, 1.6) + 3}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), mp.x, mp.y - HEX_SIZE * 0.9 + 0.5);
    ctx.textBaseline = 'alphabetic';
    UI._frontBadges.push({ id: f.id, x: mp.x, y: mp.y - HEX_SIZE * 0.9, r: rad });
    // Vormarsch: Pfeil von der Linienmitte zum Ziel
    if (f.push) {
      const tp = hexToPixel(f.push[0], f.push[1]);
      drawArrow(ctx, mp.x, mp.y, tp.x, tp.y, 'rgba(255,215,94,0.8)');
      hexPath(ctx, tp.x, tp.y, HEX_SIZE * 0.72);
      ctx.strokeStyle = 'rgba(255,215,94,0.9)';
      ctx.lineWidth = 2 / zoom + 0.8;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Vorschau der gezogenen Frontlinie (B-Modus)
  if (UI.frontDraw && UI.frontDraw.path.length) {
    ctx.strokeStyle = 'rgba(255,215,94,0.9)';
    ctx.lineWidth = 2.4 / zoom + 1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    UI.frontDraw.path.forEach(([pc, pr], i) => {
      const p = hexToPixel(pc, pr);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Spawn-Phase: Startplätze aller Spieler markieren
  if (game.spawnPhase) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    for (const [id, natSp] of Object.entries(game.nations)) {
      if (!natSp.capital) continue;
      const p = hexToPixel(...natSp.capital);
      const mine = id === game.player;
      ctx.strokeStyle = mine ? `rgba(255,215,94,${0.6 + 0.4 * pulse})` : NATION_DEFS[id].color;
      ctx.lineWidth = (mine ? 3 : 2) / zoom + 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, HEX_SIZE * (1.3 + (mine ? 0.25 * pulse : 0)), 0, 7); ctx.stroke();
      ctx.font = `800 ${11 / Math.min(zoom, 1.6) + 3}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 / zoom + 1;
      ctx.strokeStyle = 'rgba(10,14,20,0.9)';
      ctx.fillStyle = mine ? '#ffd75e' : '#f0ece0';
      const label = mine ? '★' : NATION_DEFS[id].name;
      ctx.strokeText(label, p.x, p.y - HEX_SIZE * 1.8);
      ctx.fillText(label, p.x, p.y - HEX_SIZE * 1.8);
    }
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
    } else if (e.type === 'capture') {
      hexPath(ctx, p.x, p.y, HEX_SIZE * (1 - age * 0.3));
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - age)})`;
      ctx.fill();
    } else if (e.type === 'grow') {
      // Annexions-„Wachstum": ein heller Ring platzt vom Feld nach außen,
      // dazu ein kurzer Farbfüllblitz — kräftiger als das reine Füllen.
      const col = e.by && NATION_DEFS[e.by] ? NATION_DEFS[e.by].color : '#ffffff';
      const pop = 1 - Math.pow(1 - age, 2);          // schnell raus, sanft aus
      hexPath(ctx, p.x, p.y, (HEX_SIZE + 0.55) * (0.5 + pop * 0.85));
      ctx.strokeStyle = colorA(shade(col, 1.4), 0.9 * (1 - age));
      ctx.lineWidth = 2.6 * (1 - age * 0.5);
      ctx.stroke();
      hexPath(ctx, p.x, p.y, (HEX_SIZE + 0.55) * (1 - age * 0.15));
      ctx.fillStyle = colorA(shade(col, 1.3), 0.4 * (1 - age));
      ctx.fill();
    } else if (e.type === 'death') {
      ctx.fillStyle = `rgba(25,20,20,${0.75 * (1 - age)})`;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', p.x, p.y - age * 11);
    }
  }


  // Umkämpfte Hexes: das Feld füllt sich von unten mit der Farbe des
  // Eroberers — je weniger Widerstand, desto voller (kein Balken mehr)
  if (zoom > 0.45) {
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const h = game.hexAt(c, r);
      if (h.terrain === 'water' || !h._atkT || game.dayFloat - h._atkT > 1.5 || h.resist >= h.resistMax) continue;
      const by = h._atkBy && NATION_DEFS[h._atkBy] ? NATION_DEFS[h._atkBy].color : '#ffffff';
      const prog = Math.max(0.05, 1 - h.resist / h.resistMax);
      // Anzeige-Füllstand gleitet dem Tick-Wert extra weich hinterher
      if (h._dispProg === undefined || h._dispProg - prog > 0.3) h._dispProg = prog;
      else h._dispProg += (prog - h._dispProg) * (1 - Math.exp(-rdt * 5));
      const p = hexToPixel(c, r);
      const t = Math.min(1, h._dispProg);
      // Die Farbe WÄCHST pulsierend vom Zentrum nach außen (kein „Balken")
      const grow = t * (1 + 0.05 * Math.sin(now / 150));
      hexPath(ctx, p.x, p.y, (HEX_SIZE + 0.55) * grow);
      ctx.fillStyle = colorA(by, 0.6 + 0.14 * Math.sin(now / 170));
      ctx.fill();
      ctx.strokeStyle = colorA(shade(by, 1.3), 0.95);
      ctx.lineWidth = 1.3 + 0.7 * (0.5 + 0.5 * Math.sin(now / 170));   // pulsierender Rand
      ctx.stroke();
      // heller Kern wächst mit → lebendiges „Reinwachsen" statt starr
      if (t > 0.2) {
        hexPath(ctx, p.x, p.y, (HEX_SIZE + 0.55) * t * 0.55);
        ctx.fillStyle = colorA(shade(by, 1.4), 0.28);
        ctx.fill();
      }
    }
  }

  // Divisionen — Stapel fächern leicht auf und zeigen oben rechts ihre Anzahl
  const stackN = new Map(), stackI = new Map();
  for (const d of game.divisions) {
    if (d.dead) continue;
    const k = d.c + d.r * MAP_W;
    stackN.set(k, (stackN.get(k) || 0) + 1);
  }
  for (const d of game.divisions) {
    if (d.dead) continue;
    // Zielposition: zwischen aktuellem Feld und nächstem Wegpunkt interpolieren
    // (moveProgress) — Märsche gleiten statt Hex für Hex zu springen
    const base = hexToPixel(d.c, d.r);
    let tx = base.x, ty = base.y;
    if (d.path && d.pathI < d.path.length && !d.attackTarget) {
      const nx = hexToPixel(d.path[d.pathI][0], d.path[d.pathI][1]);
      const f = Math.max(0, Math.min(1, d.moveProgress));
      tx = base.x + (nx.x - base.x) * f;
      ty = base.y + (nx.y - base.y) * f;
    }
    const ddx = tx - d.x, ddy = ty - d.y;
    // Marschierende Truppen: bewusst träges Easing — die Anzeige hinkt dem
    // Tick-Ziel leicht hinterher und gleitet dadurch OHNE Ruckeln (Fließband)
    const mEase = d.path ? (1 - Math.exp(-rdt * 4.5)) : ease;
    if (ddx * ddx + ddy * ddy > (HEX_SIZE * 5) ** 2) { d.x = tx; d.y = ty; }   // Teleport (Rückzug/Spawn): schnappen
    else { d.x += ddx * mEase; d.y += ddy * mEase; }
    if (d.x < UI.cam.x - 40 || d.x > UI.cam.x + UI.canvas.width / zoom + 40
      || d.y < UI.cam.y - 40 || d.y > UI.cam.y + UI.canvas.height / zoom + 40) continue;
    const k = d.c + d.r * MAP_W;
    const n = stackN.get(k) || 1;
    if (n > 1) {
      const idx = stackI.get(k) || 0;
      stackI.set(k, idx + 1);
      const off = idx - (n - 1) / 2;
      ctx.save();
      ctx.translate(off * 3.4, off * -2.4);
      drawDivision(ctx, d, zoom);
      ctx.restore();
      if (idx === n - 1) {
        // Stapel-Badge: Anzahl der Armeen auf dem Feld
        const bx = d.x + 12.5, by = d.y - 10.5;
        ctx.fillStyle = 'rgba(20,26,36,0.95)';
        ctx.strokeStyle = '#f2e7c8';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(bx, by, 5.6, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffe9b0';
        ctx.font = 'bold 7.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), bx, by + 0.5);
        ctx.textBaseline = 'alphabetic';
      }
    } else {
      drawDivision(ctx, d, zoom);
    }
  }

  // Ausbildungs-Standorte: Fortschrittsring + Anzahl
  if (game.training.length && zoom >= 0.8) {
    const sites = new Map();
    for (const q of game.training) {
      const k = q.c + q.r * MAP_W;
      const s = sites.get(k);
      if (!s || q.ready < s.ready) sites.set(k, { c: q.c, r: q.r, ready: q.ready, type: q.type, n: (s ? s.n : 0) + 1 });
      else s.n++;
    }
    for (const s of sites.values()) {
      const p = hexToPixel(s.c, s.r);
      const dauer = BAL.trainTime[s.type] || 8;
      const frac = Math.max(0.05, Math.min(1, 1 - (s.ready - game.dayFloat) / dauer));
      const bx = p.x + HEX_SIZE * 0.9, by = p.y - HEX_SIZE * 0.9;
      ctx.beginPath(); ctx.arc(bx, by, 4.6, 0, 7);
      ctx.fillStyle = 'rgba(18,24,34,0.92)';
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.arc(bx, by, 4.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = '#e0b34a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,230,200,0.9)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(bx, by, 4.6, 0, 7); ctx.stroke();
      if (s.n > 1) {
        ctx.fillStyle = '#ffe9b0';
        ctx.font = 'bold 6.5px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(s.n), bx + 6.8, by - 3);
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  // Laufende Gefechte: Pfeil zeigt LIVE vom Angreifer aufs Ziel —
  // die Kampfrichtung ist auf einen Blick lesbar
  // Marsch-Vorschau: gestrichelte Linie von der Auswahl zum Hover-Feld
  if (UI.selectedDivs.size && UI.hoverHex && !UI._overUI && zoom >= 0.5) {
    const lead = playerSelection()[0];
    const hh = UI.hoverHex;
    if (lead && !(lead.inCombat && !lead.attackTarget)) {
      const key = lead.id + '|' + hh.c + '|' + hh.r + '|' + lead.c + '|' + lead.r;
      if (UI._pvKey !== key) {
        UI._pvKey = key;
        UI._pvPath = game.findPath(lead.nation, lead.c, lead.r, hh.c, hh.r, false);
      }
      if (UI._pvPath && UI._pvPath.length) {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -((now / 45) % 10);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(lead.x, lead.y);
        for (const [pc, pr] of UI._pvPath) { const pp = hexToPixel(pc, pr); ctx.lineTo(pp.x, pp.y); }
        ctx.stroke();
        const end = hexToPixel(...UI._pvPath[UI._pvPath.length - 1]);
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(end.x, end.y, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }
  // Spawn-Glow: die eigene Hauptstadt pulsiert golden, solange der Startplatz
  // wählbar ist — der Flüsterer verweist darauf („dein Vorschlag glüht")
  if (game.spawnPhase && game.nations[game.player] && game.nations[game.player].capital) {
    const cap = game.nations[game.player].capital;
    const p = hexToPixel(cap[0], cap[1]);
    const pulse = 0.5 + 0.35 * Math.sin(now / 280);
    ctx.save();
    ctx.strokeStyle = `rgba(230,184,78,${pulse.toFixed(3)})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, HEX_SIZE * 1.45 + Math.sin(now / 280) * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // DER RING (Akt III): die Siegpunkt-Hauptstädte leuchten als Ziele —
  // alle müssen an denselben Tisch, die Konvergenz erzwingt die Entscheidung
  if (game.akt === 3 && game.vpHexes) {
    for (const v of game.vpHexes) {
      const p = hexToPixel(v.c, v.r);
      const pulse = 0.4 + 0.3 * Math.sin(now / 340);
      ctx.save();
      ctx.strokeStyle = `rgba(255,215,94,${pulse.toFixed(3)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, HEX_SIZE * 1.7 + Math.sin(now / 340) * 1.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = pulse * 0.55;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, HEX_SIZE * 2.5 + Math.sin(now / 340 + 1.3) * 2.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  // Schild-Schimmer: steht eine eigene Division auf gedecktem Land (Stadt-/
  // Dorf-Schutzzone), zeigt ein pulsierendes Schild: hier musst du EROBERN
  if (zoom >= 0.9 && !game.spawnPhase) {
    for (const d of game.divisionsOf(game.player)) {
      if (d.dead) continue;
      const h = game.hexAt(d.c, d.r);
      if (!h || h.owner === game.player || h.terrain === 'water') continue;
      if (!game.hexProtected(h, game.player)) continue;
      drawShieldHint(ctx, d.x, d.y - 13.5, now);
    }
  }
  if (zoom >= 0.5) {
    for (const a of game.divisions) {
      if (a.dead || !a.attackTarget) continue;
      // Vom ANGREIFER-FELD aufs Zielfeld — Hex-Mitten statt der animierten
      // Sprite-Position, damit der Pfeil immer korrekt in Angriffsrichtung zeigt.
      // Nebeneinander stehende Sprites überlappen sich → der Pfeil wird über die
      // Counter gehoben (Normale nach oben) und leicht verlängert, sonst unsichtbar.
      const ap = hexToPixel(a.c, a.r);
      const tp = hexToPixel(a.attackTarget[0], a.attackTarget[1]);
      const dx = tp.x - ap.x, dy = tp.y - ap.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      let px = -uy, py = ux;                 // Normale
      if (py > 0) { px = -px; py = -py; }    // immer nach oben heben
      const lift = HEX_SIZE * 0.9;
      drawArrow(ctx,
        ap.x + px * lift - ux * HEX_SIZE * 0.55, ap.y + py * lift - uy * HEX_SIZE * 0.55,
        tp.x + px * lift, tp.y + py * lift,
        colorA(NATION_DEFS[a.nation].color, 0.92));
    }
  }

  // Gefechtsprognose (HOI-Bubble) über laufenden Kämpfen mit Spieler-Beteiligung
  if (zoom >= 0.65) {
    // Angreifer je Verteidiger in EINEM Durchlauf sammeln (statt n²-Filter)
    const atkByDef = new Map();
    for (const a of game.divisions) {
      if (a.dead || !a.attackTarget) continue;
      const def = game.divisionAt(a.attackTarget[0], a.attackTarget[1]);
      if (!def || def.dead || def.nation === a.nation) continue;
      if (a.nation !== game.player && def.nation !== game.player) continue;
      const e = atkByDef.get(def);
      if (e) { if (e.nation === a.nation) e.list.push(a); }
      else atkByDef.set(def, { nation: a.nation, list: [a] });
    }
    UI._odds = UI._odds || new Map();
    const oddsUsed = new Set();
    for (const [def, e] of atkByDef) {
      const share = battleOdds(e.list, def);
      const myShare = e.nation === game.player ? share : 1 - share;
      const prev = UI._odds.get(def.id);
      const disp = prev === undefined ? myShare : prev + (myShare - prev) * ease;
      UI._odds.set(def.id, disp);
      oddsUsed.add(def.id);
      const a = e.list[0];
      const p2 = hexToPixel(def.c, def.r);
      // Bubble über den gehobenen Angriffspfeil stapeln, damit beide lesbar bleiben
      drawOddsBubble(ctx, (a.x + p2.x) / 2, (a.y + p2.y) / 2 - 9 - HEX_SIZE, disp, zoom, false);
    }
    for (const k of UI._odds.keys()) if (!oddsUsed.has(k)) UI._odds.delete(k);
  }
  // Hover-Prognose: gewinnt meine Auswahl gegen die Armee unterm Cursor?
  if (UI.hoverHex && UI.selectedDivs.size && !UI._overUI && !game.spawnPhase) {
    const hd = game.divisionAt(UI.hoverHex.c, UI.hoverHex.r);
    if (hd && !hd.dead && hd.nation !== game.player && game.hostile(game.player, hd.nation)) {
      const sel = playerSelection();
      if (sel.length) drawOddsBubble(ctx, hd.x, hd.y - HEX_SIZE * 1.7, battleOdds(sel, hd), zoom, true);
    }
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

/* Grobe Gefechtsprognose wie in HOI: Anteil der eigenen Schlagkraft.
   RPS-Dreieck, Gelände, Fluss, Org, Versorgung und Kessel fließen ein. */
// Kanonische Prognose lebt in der Sim (game.combatOdds) — dieselbe Zahl treibt
// die Bubble UND das ≥50 %-Tor der Kampfauflösung. Kein Auseinanderdriften.
function battleOdds(attackers, def) {
  return game.combatOdds(attackers, def);
}

/* Grün = du gewinnst, Gelb = knapp, Rot = Finger weg */
function drawOddsBubble(ctx, x, y, share, zoom, big) {
  const pct = Math.round(share * 100);
  const col = share >= 0.58 ? '#3fae53' : share >= 0.42 ? '#d7a83c' : '#cc4536';
  const r = (big ? 10.5 : 8.5) / Math.min(zoom, 1.8) + 3;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + r + 3.5);
  ctx.lineTo(x - 3, y + r - 1.5);
  ctx.lineTo(x + 3, y + r - 1.5);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = 1.4 / zoom + 0.4;
  ctx.strokeStyle = 'rgba(16,20,28,0.85)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${(big ? 8.5 : 7.5) / Math.min(zoom, 1.8) + 2.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pct + '%', x, y + 0.5);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

/* Kleines pulsierendes Schild überm Counter: „gedecktes Land — stehend erobern" */
function drawShieldHint(ctx, x, y, now) {
  const a = 0.55 + 0.3 * Math.sin(now / 260);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(16,22,34,0.9)';
  ctx.strokeStyle = '#e6b84e';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(x - 4.4, y - 4);
  ctx.lineTo(x + 4.4, y - 4);
  ctx.lineTo(x + 4.4, y + 0.6);
  ctx.quadraticCurveTo(x + 4.4, y + 4.6, x, y + 6.4);
  ctx.quadraticCurveTo(x - 4.4, y + 4.6, x - 4.4, y + 0.6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Kreuz-Kerbe im Schild
  ctx.beginPath();
  ctx.moveTo(x, y - 2.2); ctx.lineTo(x, y + 3.6);
  ctx.moveTo(x - 2.4, y + 0.4); ctx.lineTo(x + 2.4, y + 0.4);
  ctx.stroke();
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
  if (!UI.hud.mini) return;
  const m = UI.minimap;
  const mctx = m.getContext('2d');
  mctx.drawImage(UI.minimapBase, 0, 0);
  const sx = m.width / WORLD_W, sy = m.height / WORLD_H;
  // Überblick: rote Puls-Blips an laufenden Kämpfen, Gold-Punkt = eigene Hauptstadt
  const blink = 0.5 + 0.5 * Math.sin(performance.now() / 200);
  mctx.fillStyle = `rgba(255,84,60,${(0.5 + 0.5 * blink).toFixed(3)})`;
  for (const d of game.divisions) {
    if (d.dead || !d.attackTarget) continue;
    const p = hexToPixel(d.attackTarget[0], d.attackTarget[1]);
    mctx.beginPath();
    mctx.arc(p.x * sx, p.y * sy, 2 + blink * 1.3, 0, Math.PI * 2);
    mctx.fill();
  }
  const nat = game.nations[game.player];
  if (nat && nat.capital && nat.alive) {
    const p = hexToPixel(nat.capital[0], nat.capital[1]);
    mctx.fillStyle = '#ffd75e';
    mctx.strokeStyle = 'rgba(10,14,20,0.9)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.arc(p.x * sx, p.y * sy, 2.4, 0, Math.PI * 2);
    mctx.fill(); mctx.stroke();
  }
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
    if (UI.frontDraw) {
      // B-Modus: Linie aufnehmen
      const w = screenToWorld(e.clientX, e.clientY);
      const hx = pixelToHex(w.x, w.y);
      if (hx) UI.frontDraw.path = [[hx.c, hx.r]];
      UI.frontDraw.active = true;
      UI.drag = { frontDraw: true };
    } else if (UI.buildMode) {
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
    } else if (UI.drag && UI.drag.frontDraw && UI.frontDraw) {
      if (e.buttons & 1) {
        const w = screenToWorld(e.clientX, e.clientY);
        const hx = pixelToHex(w.x, w.y);
        if (hx) {
          const last = UI.frontDraw.path[UI.frontDraw.path.length - 1];
          if (!last || last[0] !== hx.c || last[1] !== hx.r) UI.frontDraw.path.push([hx.c, hx.r]);
        }
      }
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
      if (UI.drag && UI.drag.frontDraw) { UI.drag = null; finishFrontDraw(); return; }
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
    const zoomAt = factor => {
      const w = screenToWorld(e.clientX, e.clientY);
      UI.cam.zoom = Math.min(4.5, Math.max(Math.min(0.3, fitZoom() * 0.9), UI.cam.zoom * factor));
      UI.cam.x = w.x - e.clientX / UI.cam.zoom;
      UI.cam.y = w.y - e.clientY / UI.cam.zoom;
    };
    if (e.ctrlKey) {
      // Trackpad-Pinch (macOS meldet ctrlKey): direkt — die Geste ist selbst kontinuierlich
      UI.zoomAnim = null;
      zoomAt(Math.exp(-e.deltaY * 0.014));
    } else if (Math.abs(e.deltaX) > 0.01 || Math.abs(e.deltaY) < 40) {
      // Zwei-Finger-Scroll auf dem Trackpad: Karte schwenken (umsehen)
      UI.cam.x += e.deltaX / UI.cam.zoom;
      UI.cam.y += e.deltaY / UI.cam.zoom;
    } else {
      // klassisches Mausrad: animiert zoomen (fühlt sich weich an statt zu rasten)
      const zmin = Math.min(0.3, fitZoom() * 0.9);
      const base = UI.zoomAnim ? UI.zoomAnim.target : UI.cam.zoom;
      UI.zoomAnim = {
        target: Math.min(4.5, Math.max(zmin, base * (e.deltaY < 0 ? 1.16 : 1 / 1.16))),
        ax: e.clientX, ay: e.clientY,
      };
    }
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    // Enter = Chat öffnen (Multiplayer, in Lobby und Runde)
    if (e.code === 'Enter' && typeof NET !== 'undefined' && NET.ws && NET.state !== 'off') {
      if (netToggleChat()) { e.preventDefault(); return; }
    }
    // S = teilen, M = vereinen (wenn Truppen ausgewählt sind)
    if (e.code === 'KeyS' && UI.selectedDivs.size && !e.ctrlKey) { splitSelection(); return; }
    if (e.code === 'KeyM' && UI.selectedDivs.size) { mergeSelection(); return; }
    UI.keys.add(e.code);
    if (e.code === 'Space') { e.preventDefault(); if (!game._net) { game.paused = !game.paused; updateTopbar(); } }
    if (e.key >= '1' && e.key <= '4' && !game._net) { game.speed = +e.key; game.paused = false; }
    if (e.key === '+' || e.key === '=') zoomStep(1.25);
    if (e.key === '-') zoomStep(1 / 1.25);
    if (e.code === 'Home') centerOn(...game.nations[game.player].capital, Math.max(UI.cam.zoom, 1.5));
    if (e.key === 'v' || e.key === 'V') { UI.supplyOverlay = !UI.supplyOverlay; updateTopbar(); }
    if (e.code === 'KeyB' && !game.spawnPhase) {
      // B = Frontlinien-Zeichenmodus (Linie über die Karte ziehen)
      if (UI.frontDraw) {
        UI.frontDraw = null;
        UI.canvas.style.cursor = '';
      } else {
        UI.buildMode = null;
        UI.frontDraw = { path: [], active: false };
        UI.canvas.style.cursor = 'crosshair';
      }
    }
    if (e.code === 'Escape') {
      // Kaskade: erst Vormarsch-/Zeichen-/Baumodus, dann Auswahl, dann Panel
      if (UI.pushMode) {
        UI.pushMode = null;
      } else if (UI.frontDraw) {
        UI.frontDraw = null;
        UI.canvas.style.cursor = '';
      } else if (UI.buildMode) {
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
  const base = UI.zoomAnim ? UI.zoomAnim.target : UI.cam.zoom;
  UI.zoomAnim = {
    target: Math.min(4.5, Math.max(Math.min(0.3, fitZoom() * 0.9), base * f)),
    ax: cx, ay: cy,
  };
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
  if (game._replayCmds) { replayBlockedToast(); return; }
  const w = screenToWorld(sx, sy);
  const hx = pixelToHex(w.x, w.y);
  if (!hx) return;
  const h = game.hexAt(hx.c, hx.r);
  const res = game.issue('build', hx.c, hx.r, UI.buildMode);
  if (res === true) {
    updateTopbar();
  } else if (performance.now() - UI._paintToastT > 1200 && h && h.owner === game.player) {
    UI._paintToastT = performance.now();
    pushToast('⚠ ' + res);
  }
}

function replayBlockedToast() {
  if (performance.now() - (UI._replayToastT || 0) < 2500) return;
  UI._replayToastT = performance.now();
  pushToast('🎬🔒');
}

function setBuildMode(mode) {
  UI.buildMode = (UI.buildMode === mode) ? null : mode;
  refreshPanel();
}

/* S: ausgewählte Divisionen teilen */
function splitSelection() {
  if (game._replayCmds) { replayBlockedToast(); return; }
  const ids = playerSelection().map(d => d.id);
  const res = game.issue('split', ids);
  if (res === 'sent') { setTimeout(updateUnitbar, 450); return; }
  const twins = Array.isArray(res) ? res : [];
  twins.forEach(id => UI.selectedDivs.add(id));
  if (!twins.length) pushToast('⚠✂');
  updateUnitbar();
}

/* M: ausgewählte Divisionen gleichen Typs vereinen */
function mergeSelection() {
  if (game._replayCmds) { replayBlockedToast(); return; }
  const ids = playerSelection().map(d => d.id);
  const res = game.issue('merge', ids);
  if (res === 'sent') { setTimeout(updateUnitbar, 450); return; }
  const merged = res || 0;
  for (const id of [...UI.selectedDivs]) {
    const d = game.divisions.find(x => x.id === id);
    if (!d || d.dead) UI.selectedDivs.delete(id);
  }
  if (!merged) pushToast('⚠🔗');
  updateUnitbar();
}

/* Rechtsklick: Marschbefehl (Standard) / Shift = Wegpunkt / Alt = Front-Automatik / Allianz */
function onRightTap(sx, sy, alt, shift) {
  if (UI.buildMode) { setBuildMode(null); return; }
  if (game._replayCmds) { replayBlockedToast(); return; }
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
      pushToast(`🕊️ ${BAL.graceDays - game.day}📅`);
      return;
    }
    // Direkter Marsch-/Angriffsbefehl · Shift = Wegpunkt anhängen
    groupMoveOrder(hx.c, hx.r, shift);
    return;
  }
  // Ohne Auswahl: Rechtsklick auf fremdes Land = Allianz anbieten
  if (h.owner && h.owner !== game.player && game.nations[h.owner].alive) {
    if (game.allied(game.player, h.owner)) {
      pushToast(`🤝 ${game.nationName(h.owner)}`);
    } else {
      const res = game.issue('ally', h.owner);
      if (res !== true && res !== 'sent') pushToast('🤝 ' + res);
    }
  }
}

/* Strg+Klick auf die Grenze: Frontlinie gegen den Nachbarn erstellen und
   die aktuelle Auswahl darauf verteilen (War-of-Dots-Geste) */
function frontlineClick(hx) {
  const h = game.hexAt(hx.c, hx.r);
  if (!h || h.terrain === 'water') return false;
  let other = null;
  const check = hex => {
    if (hex && hex.owner && hex.owner !== game.player && game.nations[hex.owner].alive) other = hex.owner;
  };
  if (h.owner && h.owner !== game.player) check(h);
  if (!other) for (const [nc, nr] of neighborsOf(hx.c, hx.r)) check(game.hexAt(nc, nr));
  if (!other) return false;
  if (game.allied(game.player, other)) {
    pushToast(`🤝 ${game.nationName(other)}`);
    return true;
  }
  const ids = playerSelection().map(d => d.id);
  const res = game.issue('frontBorder', other, ids);
  if (res) refreshPanel();
  return true;
}

/* B-Modus: eigene Frontlinie über die Karte ziehen */
function finishFrontDraw() {
  const draw = UI.frontDraw;
  UI.frontDraw = null;
  UI.canvas.style.cursor = '';
  if (!draw || draw.path.length < 2) {
    if (draw) pushToast('⚠📏');
    refreshPanel();
    return;
  }
  const ids = playerSelection().map(d => d.id);
  const res = game.issue('frontLine', draw.path, ids);
  if (!res && res !== 'sent') pushToast('⚠📏');
  refreshPanel();
}

function handleClick(sx, sy, additive) {
  const w = screenToWorld(sx, sy);

  // Spawn-Phase: Klick = Startplatz verlegen
  if (game.spawnPhase && !game._replayCmds) {
    const hx = pixelToHex(w.x, w.y);
    if (hx) {
      const ok = game.issue('spawn', hx.c, hx.r);
      if (!ok && ok !== 'sent') pushToast('⚠📍');
    }
    return;
  }

  // Front-Badge angeklickt? → Front wählen, der nächste Klick setzt das Vormarschziel
  if (!game._replayCmds && UI._frontBadges) {
    for (const b of UI._frontBadges) {
      if ((w.x - b.x) ** 2 + (w.y - b.y) ** 2 <= (b.r * 1.35) ** 2) {
        const f = game.frontById(b.id);
        if (f) {
          UI.pushMode = f.id;
          UI.selectedDivs.clear();
          game.frontDivisions(f).forEach(d => UI.selectedDivs.add(d.id));
          updateUnitbar();
        }
        return;
      }
    }
  }
  // Vormarschziel setzen (Front wurde eben per Badge gewählt)
  if (UI.pushMode && !game._replayCmds) {
    const fid = UI.pushMode;
    UI.pushMode = null;
    const hx = pixelToHex(w.x, w.y);
    const h = hx && game.hexAt(hx.c, hx.r);
    if (h && h.terrain !== 'water' && game.frontById(fid)) {
      game.issue('frontPush', fid, hx.c, hx.r);
      refreshPanel();
    }
    return;
  }

  let clickedDiv = null, bestD = (14 / Math.max(UI.cam.zoom, 0.6)) ** 2 + 60;
  for (const d of game.divisions) {
    if (d.dead) continue;
    const dist = (d.x - w.x) ** 2 + (d.y - w.y) ** 2;
    if (dist < bestD) { bestD = dist; clickedDiv = d; }
  }

  // Strg+Klick auf die Karte (keine Truppe getroffen): Frontlinie an der Grenze
  if (!clickedDiv && additive && !game._replayCmds) {
    const hx = pixelToHex(w.x, w.y);
    if (hx && frontlineClick(hx)) return;
  }

  if (clickedDiv) {
    const now = performance.now();
    const isDouble = !additive && UI._lastClickDiv === clickedDiv.id && now - (UI._lastClickT || 0) < 350;
    UI._lastClickDiv = clickedDiv.id;
    UI._lastClickT = now;
    if (isDouble && clickedDiv.nation === game.player) {
      // Doppelklick: alle eigenen Truppen auswählen
      UI.selectedDivs.clear();
      game.divisionsOf(game.player).forEach(d => UI.selectedDivs.add(d.id));
      pushToast(`👥 ${UI.selectedDivs.size} ✔`);
    } else if (additive && clickedDiv.nation === game.player) {
      // Strg/Shift: hinzufügen bzw. wieder abwählen
      if (UI.selectedDivs.has(clickedDiv.id)) UI.selectedDivs.delete(clickedDiv.id);
      else UI.selectedDivs.add(clickedDiv.id);
    } else {
      // Klick auf ein Feld mit Stapel: ALLE Armeen dort auswählen —
      // die Leiste unten listet sie einzeln (Karte = einzeln wählen)
      UI.selectedDivs.clear();
      const stack = clickedDiv.nation === game.player
        ? game.divisionsAt(clickedDiv.c, clickedDiv.r).filter(x => x.nation === game.player)
        : [clickedDiv];
      stack.forEach(x => UI.selectedDivs.add(x.id));
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
    // Eigenes Feld (oder baubares Küstenwasser) → Bauliste fürs Feld
    if (h && (h.owner === game.player
      || (h.terrain === 'water' && game.canBuild(game.player, h, 'fischerei') === true))) UI.activeTab = 'bauen';
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
  updateUnitbar();
}

function groupMoveOrder(c, r, queue) {
  let divs = playerSelection();
  if (!divs.length) return;
  // Angegriffene Truppen sind im Gefecht gebunden — sie bleiben stehen
  const locked = divs.filter(d => d.inCombat && !d.attackTarget);
  if (locked.length) {
    pushToast('⚠⚔');
    divs = divs.filter(d => !locked.includes(d));
    if (!divs.length) return;
  }
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
  divs.forEach((d, i) => {
    const [tc, tr] = targets[Math.min(i, targets.length - 1)];
    game.issue('move', d.id, tc, tr, queue);
  });
  game.effects.push({ type: 'capture', c, r, t: performance.now() - 400 });
}

/* ---------- Tooltip ---------- */
function updateTooltip(sx, sy) {
  const tip = document.getElementById('tooltip');
  if (!UI.hoverHex || !game || UI._overUI) { tip.style.display = 'none'; return; }
  const h = game.hexAt(UI.hoverHex.c, UI.hoverHex.r);
  if (!h) { tip.style.display = 'none'; return; }
  let html = `<b>${TERRAIN_ICON[h.terrain] || ''}</b>${h.river ? ' ' + ic('water') : ''}`;
  if (h._pocket) html += ` ${ic('swords')}`;
  if (h.owner) {
    html += ` <span class="chip" style="background:${NATION_DEFS[h.owner].color}"></span>`;
    if (game.isTraitor(h.owner)) html += ic('snake');
    if (game.allied(game.player, h.owner)) html += ic('ally');
    if (h.capital || h.vp) html += ic('star');
    if (h.building) html += ` · ${buildingName(h.building)}${'▮'.repeat(h.level || 1)}`;
    if (h.road) html += ' · ' + ic('road');
    const tq = game.training.filter(q => q.c === h.c && q.r === h.r);
    if (tq.length) html += `<br>${tq.map(q => `${TYPE_ICON[q.type]}${ic('clock')}${Math.max(0, q.ready - game.dayFloat).toFixed(0)}`).join(' ')}`;
    if (h.terrain !== 'water')
      html += `<br><span class="tt-dim">${ic('supply')}${Math.round(h.supply * 100)}% · ${ic('shield')}${Math.round(h.resist)}/${Math.round(h.resistMax)}</span>`;
  } else if (h.terrain !== 'water') {
    html += ` <span class="tt-dim">${ic('shield')}${Math.round(h.resist)}/${Math.round(h.resistMax)}</span>`;
  }
  const d = game.divisionAt(UI.hoverHex.c, UI.hoverHex.r);
  if (d) {
    const dt2 = BAL.divTypes[d.type];
    const sup2 = game.supplyModOf(d);
    const broke2 = game.nations[d.nation] && game.nations[d.nation]._broke;
    // Warum diese Org? Regen = Basis × Versorgung × Moral, 0 im Gefecht
    const regen = d.inCombat ? 0 : BAL.orgRegen * sup2.mod * d.moral;
    html += `<hr><span class="chip" style="background:${NATION_DEFS[d.nation].color}"></span> ${TYPE_ICON[d.type]}
      <span class="tt-dim">${ic('soldier')}${Math.round(d.str)}</span>
      <br>${ic('bolt')} ${Math.round(d.org)}/${dt2.maxOrg} <b>${d.inCombat ? ic('swords') : '▲' + regen.toFixed(1)}</b>
      <br><span class="tt-dim">${ic('bolt')}▲${BAL.orgRegen} × ${ic('supply')}${Math.round(sup2.mod * 100)}% × ${moralDot(d.moral)}${d.moral.toFixed(2)}${d.inCombat ? ` · ${ic('swords')}0` : ''}${broke2 ? ' · ' + ic('broke') : ''}</span>`;
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = Math.min(sx + 16, window.innerWidth - 260) + 'px';
  tip.style.top = Math.min(sy + 16, window.innerHeight - 130) + 'px';
}

function buildingName(b) {
  const n = { dorf: 'house', stadt: 'city', mine: 'mine', farm: 'farm', forsterei: 'forest', fischerei: 'fish', kaserne: 'barracks', turm: 'tower', strasse: 'road' }[b];
  return n ? ic(n) : b;
}
const TERRAIN_ICON = { plains: ic('wheat'), forest: ic('forest'), hills: ic('mountain'), mountain: ic('mountain'), water: ic('water') };
const TYPE_ICON = { inf: ic('shield'), kav: ic('horse'), kan: ic('cannon') };

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
  box.innerHTML = game.allianceOffers.filter(o => (o.to || game.player) === game.player).map(o => `
    <div class="offer">
      <span class="chip" style="background:${game.nationColor(o.from)}"></span> 🤝
      <button data-accept="${o.from}">✔</button>
      <button data-decline="${o.from}" class="danger">✖</button>
    </div>`).join('');
  box.querySelectorAll('[data-accept]').forEach(b =>
    b.addEventListener('click', () => game.issue('answerOffer', b.dataset.accept, true)));
  box.querySelectorAll('[data-decline]').forEach(b =>
    b.addEventListener('click', () => game.issue('answerOffer', b.dataset.decline, false)));
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
  const mpBlocked = () => {
    if (game && game._net) { pushToast('🌐⏱'); return true; }
    return false;
  };
  document.getElementById('btn-pause').addEventListener('click', () => { if (mpBlocked()) return; game.paused = !game.paused; updateTopbar(); });
  for (const s of [1, 2, 3, 4]) {
    document.getElementById('btn-speed' + s).addEventListener('click', () => { if (mpBlocked()) return; game.speed = s; game.paused = false; updateTopbar(); });
  }
  document.getElementById('btn-supply').addEventListener('click', () => {
    UI.supplyOverlay = !UI.supplyOverlay;
    updateTopbar();
  });
  for (const [k, id] of [['log', 'hud-log'], ['rank', 'hud-rank'], ['mini', 'hud-mini']]) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => { UI.hud[k] = !UI.hud[k]; applyHud(); });
  }
  const sndBtn = document.getElementById('btn-sound');
  if (sndBtn) {
    sndBtn.classList.toggle('active', UI.sound);
    sndBtn.addEventListener('click', () => {
      UI.sound = !UI.sound;
      try { localStorage.setItem('ff_sound', UI.sound ? '1' : '0'); } catch (e) { /* egal */ }
      sndBtn.classList.toggle('active', UI.sound);
      if (UI.sound) SFX.play('durchbruch');   // hörbares Feedback beim Einschalten
    });
  }
  document.getElementById('btn-save').addEventListener('click', () => {
    if (game && game._net) { pushToast('🌐🚫💾'); return; }
    try {
      localStorage.setItem('finalfront_save', JSON.stringify({ t: Date.now(), save: game.serialize() }));
      pushToast('💾✔');
    } catch (e) { pushToast('💾⚠'); }
  });
  document.getElementById('btn-load').addEventListener('click', () => {
    if (game && game._net) { pushToast('🌐🚫📂'); return; }
    loadNewestSave();
  });
  document.getElementById('btn-restart').addEventListener('click', () => showStartScreen());
  document.getElementById('spawn-ready').addEventListener('click', finishSpawnPhase);
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
  if (!pick) { pushToast('📂⚠'); return false; }
  const g = Game.deserialize(pick.save);
  if (!g) { pushToast('📂⚠'); return false; }
  window.game = g;
  rebuildLayers();
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
    `<span class="chip" style="background:${game.nationColor(game.player)}"></span>${game.nationName(game.player)}`
    + (game.isTraitor(game.player)
      ? ' ' + ic('snake') : '');
  const inc = nat.incomePerDay * (nat.econMult || 1);
  const goldEl = document.getElementById('tb-gold');
  goldEl.textContent = `${Math.floor(nat.gold)} ${inc >= 0 ? '▲' : '▼'}${Math.abs(inc).toFixed(1)}`;
  goldEl.parentElement.classList.toggle('broke', !!nat._broke);
  document.getElementById('tb-mp').textContent =
    `${Math.floor(nat.leute)}/${Math.round(nat.popCap || 0)}`;
  document.getElementById('tb-eisen').textContent =
    `${Math.floor(nat.eisen)}/${Math.round(nat.eisenCap || 0)}`;
  document.getElementById('tb-pferde').textContent =
    `${Math.floor(nat.pferde)}/${Math.round(nat.pferdeCap || 0)}`;
  document.getElementById('tb-div').textContent = `${game.divisionsOf(game.player).length}`;
  const share = Math.round(nat.hexCount / game.totalLand * 100);
  document.getElementById('tb-prov').textContent = `${nat.hexCount} (${share} %)`;
  document.getElementById('tb-vp').textContent = `${nat.vp || 0}/${game.vpNeed || BAL.round.vpToWin}`;
  document.getElementById('tb-day').innerHTML = `${ic('calendar')} ${game.day}`;
  document.getElementById('tb-round').innerHTML = `${ic('hourglass')}${Math.max(0, BAL.round.days - game.day)}`;
  // Akt-Uhr-Chip: Ⅰ Landnahme (grün) · Ⅱ Der Krieg (bernstein) · Ⅲ Der Ring (rot)
  const aktEl = document.getElementById('tb-akt');
  if (aktEl && aktEl._akt !== game.akt) {
    aktEl._akt = game.akt;
    aktEl.textContent = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][game.akt] || 'Ⅰ';
    aktEl.className = 'a' + game.akt;
    aktEl.title = ['', 'Akt Ⅰ — Landnahme', 'Akt Ⅱ — Der Krieg', 'Akt Ⅲ — Der Ring (Endphase)'][game.akt] || '';
  }

  document.getElementById('replay-badge').classList.toggle('hidden', !game._replayCmds);

  // Sieg-Countdown-Banner
  const banner = document.getElementById('vp-banner');
  if (game.vpLeader && !game.over && game.nations[game.vpLeader]) {
    const own = game.vpLeader === game.player;
    const rest = Math.max(0, game.vpDeadline - game.day);
    banner.className = own ? 'own' : '';
    banner.innerHTML = `${ic('crown')} <span class="chip" style="background:${game.nationColor(game.vpLeader)}"></span> ${ic('capital')}${game.nations[game.vpLeader].vp} · ${ic('hourglass')}<b>${rest}</b>`;
  } else {
    banner.className = 'hidden';
  }
  document.getElementById('btn-pause').classList.toggle('active', game.paused);
  for (const s of [1, 2, 3, 4])
    document.getElementById('btn-speed' + s).classList.toggle('active', !game.paused && game.speed === s);
  document.getElementById('btn-supply').classList.toggle('active', UI.supplyOverlay);

  // Multiplayer: Server taktet — Tempo-Buttons weg, LIVE-Badge mit Ping hin
  const mp = !!game._net;
  const speedBox = document.querySelector('#tb-datebox .speed');
  if (speedBox) speedBox.style.display = mp ? 'none' : '';
  const live = document.getElementById('tb-live');
  if (live) {
    live.classList.toggle('hidden', !mp);
    if (mp) {
      const lag = (typeof NET !== 'undefined' && NET.steps.length > 16);
      live.innerHTML = lag ? `${ic('globe')} LIVE · ${ic('hourglass')}…`
        : `${ic('globe')} LIVE${(typeof NET !== 'undefined' && NET.rtt) ? ` · ${NET.rtt} ms` : ''}`;
      live.classList.toggle('lag', lag);
    }
  }
}

const PANEL_TITLES = { bauen: ic('build'), armeen: ic('soldier'), nationen: ic('globe'), info: ic('info') };

/* ---------- Live-Rangliste (Rundenmodus) ---------- */
/* Sieg-Leiste: „die Leiste entscheidet" — Rangfolge = Score (Land + Kronen +
   Kessel + Ring-Eroberungen), live als Balken. Beim Abpfiff gewinnt der längste. */
function rankedNations() {
  return Object.keys(game.nations)
    .filter(id => game.nations[id].alive)
    .sort((a, b) => (game.score(b) - game.score(a))
      || ((game.nations[b].vp || 0) - (game.nations[a].vp || 0))
      || (game.nations[b].hexCount - game.nations[a].hexCount));
}

function rankRowHtml(place, id, maxScore) {
  const n = game.nations[id];
  let who = '';
  if (game._names) {   // Multiplayer: wer ist Mensch, wer Bot?
    const nm = !n.ai && game._names[id] ? String(game._names[id]).replace(/</g, '&lt;') : null;
    who = nm ? ` <span class="rank-who">${ic('people')} ${nm}</span>` : ` <span class="rank-who">${ic('bot')}</span>`;
  }
  const sc = game.score(id);
  const w = Math.max(3, Math.round(sc / Math.max(1, maxScore) * 100));
  return `<div class="rank-row ${id === game.player ? 'me' : ''}">
    <span class="rank-pl">${place}.</span>
    <span class="chip" style="background:${game.nationColor(id)}"></span>
    <span class="rank-name">${game.nationName(id)}${game.isTraitor(id) ? ' ' + ic('snake') : ''}${who}</span>
    <span class="rank-vp">${ic('capital')} ${n.vp || 0}</span>
    <span class="rank-hex">${Math.round(sc)}</span>
    <span class="rank-bar"><i style="width:${w}%;background:${game.nationColor(id)}"></i></span>
  </div>`;
}

function renderRanking() {
  const el = document.getElementById('ranking');
  if (!game || game.over) { el.innerHTML = ''; return; }
  if (!UI.hud.rank) return;
  const ids = rankedNations();
  const maxScore = ids.length ? game.score(ids[0]) : 1;
  let html = `<div class="rank-head">${ic('trophy')} · ${ic('capital')} · ${ic('hex')}</div>`;
  ids.forEach((id, i) => {
    if (i < 5 || id === game.player) html += rankRowHtml(i + 1, id, maxScore);
  });
  if (!game.nations[game.player].alive) html += `<div class="rank-row me"><span class="rank-pl">☠</span></div>`;
  el.innerHTML = html;
}

function refreshPanel() {
  document.querySelectorAll('#sidebar button[data-tab]').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === UI.activeTab));
  const panel = document.getElementById('panel');
  if (!UI.activeTab || !game) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  document.getElementById('panel-title').innerHTML = PANEL_TITLES[UI.activeTab] || '';
  const el = document.getElementById('panel-content');
  if (UI.activeTab === 'bauen') el.innerHTML = panelBauen();
  else if (UI.activeTab === 'armeen') el.innerHTML = panelTruppen();
  else if (UI.activeTab === 'nationen') el.innerHTML = panelNationen();
  else el.innerHTML = panelInfo();
  bindPanelActions(el);
}

function panelBauen() {
  const hx = UI.selectedHex;
  const h = hx && game.hexAt(hx.c, hx.r);
  const strassenBtn = `<hr><button data-buildmode="strasse" class="${UI.buildMode === 'strasse' ? 'active-build' : ''}">${ic('road')} ${BAL.cost.strasse} ${ic('gold')}</button>`;
  const mine = h && h.owner === game.player;
  const fischbar = h && h.terrain === 'water' && game.canBuild(game.player, h, 'fischerei') === true;
  if (!h || (!mine && !fischbar)) return `<p class="hint" style="text-align:center;font-size:24px">${ic('hex')}</p>` + strassenBtn;

  let html = `<p style="font-size:16px">${TERRAIN_ICON[h.terrain] || ''}${h.river ? ' ' + ic('water') : ''}`
    + (h.building ? ` · ${buildingName(h.building)}${'▮'.repeat(h.level || 1)}` : '')
    + (h.road ? ' · ' + ic('road') : '') + '</p>';
  if (mine && h.terrain !== 'water')
    html += `<p class="small">${ic('supply')} ${Math.round(h.supply * 100)}% · ${ic('shield')} ${Math.round(h.resist)}/${Math.round(h.resistMax)}</p>`;

  const y = BAL.yields;
  const YIELD = {
    mine: `+${y.mine.eisen}${ic('iron')}`,
    farm: `+${y.farm.pferde}${ic('horse')}`,
    forsterei: `+${y.forsterei.gold}${ic('gold')} +${y.forsterei.leute}${ic('people')}`,
    fischerei: `+${y.fischerei.gold}${ic('gold')} +${y.fischerei.leute}${ic('people')}`,
    dorf: `+${y.dorf.leute}${ic('people')}`,
    stadt: `+${BAL.incomeStadt}${ic('gold')} +${BAL.leuteStadt}${ic('people')}`,
    turm: `${ic('shield')}×${BAL.bunker.def[0]}–${BAL.bunker.def[2]}`,
    kaserne: `${ic('clock')} ×2`,
  };
  html += '<div class="icon-grid">';
  let any = false;
  for (const key of ['mine', 'farm', 'forsterei', 'fischerei', 'dorf', 'stadt', 'turm', 'kaserne']) {
    const res = game.canBuild(game.player, h, key);
    // Platzierung unmöglich (Terrain/belegt) -> gar nicht zeigen;
    // nur zu teuer (⚠🪙) -> zeigen, aber AUSGEGRAUT
    const zuTeuer = typeof res === 'string' && res.startsWith('⚠🪙');
    if (res !== true && !zuTeuer) continue;
    const up = h.building === key;
    any = true;
    html += `<button class="icon-btn${zuTeuer ? ' locked' : ''}" ${zuTeuer ? 'disabled' : ''} data-buildat="${key}">
      <span class="ib-icon">${buildingName(key)}${up ? '▲' : ''}</span>
      <span class="ib-cost${zuTeuer ? ' missing' : ''}">${game.buildCost(game.player, h, key)} ${ic('gold')}</span>
      <span class="ib-yield">${YIELD[key] || ''}</span>
    </button>`;
  }
  html += '</div>';
  if (!any) html += `<p class="hint" style="text-align:center;font-size:20px">${ic('ban')}</p>`;

  if (game.isTrainSite(h, game.player)) {
    const fast = h.building === 'kaserne';
    const nat = game.nations[game.player];
    html += `<hr><div class="icon-grid">`;
    for (const ty of ['inf', 'kav', 'kan']) {
      const t = BAL.divTypes[ty];
      const tage = BAL.trainTime[ty] * (fast ? BAL.kaserneTrainFactor : 1);
      // fehlende Posten ROT hervorheben, Button ausgrauen
      const fehltLeute = nat.leute < t.mp;
      const fehltEisen = t.eisen && nat.eisen < t.eisen;
      const fehltPferde = t.pferde && nat.pferde < t.pferde;
      const locked = fehltLeute || fehltEisen || fehltPferde;
      const kosten = `<span class="${fehltLeute ? 'missing' : ''}">${t.mp}${ic('people')}</span>`
        + (t.pferde ? ` <span class="${fehltPferde ? 'missing' : ''}">${t.pferde}${ic('horse')}</span>` : '')
        + (t.eisen ? ` <span class="${fehltEisen ? 'missing' : ''}">${t.eisen}${ic('iron')}</span>` : '');
      html += `<button class="icon-btn${locked ? ' locked' : ''}" ${locked ? 'disabled' : ''} data-trainat="${ty}">
        <span class="ib-icon">${TYPE_ICON[ty]}</span>
        <span class="ib-cost">${kosten}</span>
        <span class="ib-yield">${ic('clock')}${tage} · ${t.upkeep}${ic('gold')}</span>
      </button>`;
    }
    html += '</div>';
    const queue = game.training.filter(q => q.c === h.c && q.r === h.r);
    if (queue.length) {
      html += `<p>${queue.map(q => `${TYPE_ICON[q.type]}${ic('clock')}${Math.max(0, q.ready - game.dayFloat).toFixed(0)}`).join(' · ')}</p>`;
    }
  }
  return html + strassenBtn;
}

function panelTruppen() {
  const myDivs = game.divisionsOf(game.player);
  const frei = myDivs.filter(d => d.front == null).length;
  const queued = game.training.filter(q => q.nation === game.player).length;
  let html = `<p style="font-size:15px">${ic('soldier')} ${myDivs.length} · ${frei}${queued ? ` · ${ic('clock')} ${queued}` : ''}</p><hr>`;
  const myFronts = game.fronts.filter(f => f.owner === game.player);
  for (const f of myFronts) {
    const divs = game.frontDivisions(f);
    const chip = f.kind === 'border'
      ? `<span class="chip" style="background:${game.nationColor(f.target)}"></span>`
      : ic('road');
    html += `<div class="front-row">
      <div class="diplo-info">${ic('swords')} ${chip} <b>${divs.length}</b>${f.push ? ' ' + ic('pin') : ''}</div>
      <button class="mini" data-selfront="${f.id}">${ic('people')}</button>
      ${f.push
        ? `<button class="mini" data-stoppush="${f.id}">⏹</button>`
        : `<button class="mini" data-pushfront="${f.id}">🎯</button>`}
      <button class="mini danger" data-delfront="${f.id}">✖</button>
    </div>`;
  }
  return html;
}

function panelNationen() {
  let html = '';
  const ids = Object.keys(game.nations).filter(id => id !== game.player);
  ids.sort((a, b) => game.nations[b].hexCount - game.nations[a].hexCount);
  for (const id of ids) {
    const n = game.nations[id];
    const isAlly = game.allied(game.player, id);
    html += `<div class="diplo-row ${n.alive ? '' : 'dead'}">
      <span class="chip" style="background:${game.nationColor(id)}"></span>
      <div class="diplo-info"><b>${isAlly ? ic('ally') + ' ' : ''}${game.isTraitor(id) ? ic('snake') + ' ' : ''}${n.alive ? `${ic('hex')}${n.hexCount} · ${ic('soldier')}${game.divisionsOf(id).length}` : '☠'}</b></div>
      ${n.alive ? (isAlly
        ? `<button data-unally="${id}" class="danger">${ic('close')}</button>`
        : `<button data-ally="${id}" class="peace">${ic('ally')}</button>`) : ''}
    </div>`;
  }
  return html;
}

function panelInfo() {
  if (UI.selectedHex) {
    const h = game.hexAt(UI.selectedHex.c, UI.selectedHex.r);
    if (h && h.owner) {
      const id = h.owner;
      const n = game.nations[id];
      const isAlly = id !== game.player && game.allied(game.player, id);
      let html = `<p style="font-size:16px"><span class="chip" style="background:${game.nationColor(id)}"></span>
        ${isAlly ? '🤝' : ''} ⬡${n.hexCount} · 🪖${game.divisionsOf(id).length}</p>
        <p style="font-size:16px">${TERRAIN_ICON[h.terrain] || ''}${h.building ? ' · ' + buildingName(h.building) : ''}${h.capital ? ' ★' : ''}</p>`;
      if (id !== game.player && n.alive) {
        html += isAlly
          ? `<button data-unally="${id}" class="wide danger">💔</button>`
          : `<button data-ally="${id}" class="wide peace">🤝</button>`;
      }
      return html;
    }
    return `<p class="hint" style="font-size:20px;text-align:center">${h ? (TERRAIN_ICON[h.terrain] || '') : ''}</p>`;
  }
  return `<p class="hint" style="font-size:24px;text-align:center">👆⬡</p>`;
}

function bindPanelActions(el) {
  el.querySelectorAll('[data-buildmode]').forEach(b => b.addEventListener('click', () => {
    setBuildMode(b.dataset.buildmode);
  }));
  el.querySelectorAll('[data-buildat]').forEach(b => b.addEventListener('click', () => {
    if (!UI.selectedHex) return;
    const res = game.issue('build', UI.selectedHex.c, UI.selectedHex.r, b.dataset.buildat);
    if (res !== true && res !== 'sent') pushToast(game._replayCmds ? '🎬' : String(res));
    refreshPanel(); updateTopbar();
    if (res === 'sent') setTimeout(() => { refreshPanel(); updateTopbar(); }, 450);
  }));
  el.querySelectorAll('[data-trainat]').forEach(b => b.addEventListener('click', () => {
    if (!UI.selectedHex) return;
    const ty = b.dataset.trainat;
    const res = game.issue('trainAt', UI.selectedHex.c, UI.selectedHex.r, ty);
    if (res !== true && res !== 'sent') pushToast(game._replayCmds ? '🎬' : String(res));
    refreshPanel(); updateTopbar();
    if (res === 'sent') setTimeout(() => { refreshPanel(); updateTopbar(); }, 450);
  }));
  el.querySelectorAll('[data-ally]').forEach(b => b.addEventListener('click', () => {
    const res = game.issue('ally', b.dataset.ally);
    if (res !== true && res !== 'sent') pushToast('🤝 ' + res);
    refreshPanel();
  }));
  el.querySelectorAll('[data-unally]').forEach(b => b.addEventListener('click', () => {
    game.issue('unally', b.dataset.unally);
    refreshPanel();
  }));

  el.querySelectorAll('[data-selfront]').forEach(b => b.addEventListener('click', () => {
    const f = game.frontById(+b.dataset.selfront);
    if (!f) return;
    UI.selectedDivs.clear();
    game.frontDivisions(f).forEach(d => UI.selectedDivs.add(d.id));
    if (f.hexes.length) {
      const mid = f.hexes[Math.floor(f.hexes.length / 2)];
      centerOn(mid.c, mid.r, Math.max(UI.cam.zoom, 1.6));
    }
    updateUnitbar();
    pushToast(`👥 ${UI.selectedDivs.size} ✔`);
  }));
  el.querySelectorAll('[data-delfront]').forEach(b => b.addEventListener('click', () => {
    game.issue('frontRemove', +b.dataset.delfront);
    refreshPanel();
  }));
  el.querySelectorAll('[data-pushfront]').forEach(b => b.addEventListener('click', () => {
    UI.pushMode = +b.dataset.pushfront;
  }));
  el.querySelectorAll('[data-stoppush]').forEach(b => b.addEventListener('click', () => {
    game.issue('frontPush', +b.dataset.stoppush, null, null);
    refreshPanel();
  }));
}

/* =========================================================
   EINHEITEN-LEISTE (unten, HOI4-Stil)
   ========================================================= */
const TYPE_SHORT = { inf: 'KRI', kav: 'KAV', kan: 'KAN' };

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
    const wp = d.queue && d.queue.length ? ` · ${ic('pin')}${d.queue.length}` : '';
    const supWarn = sup.level < 0.5 ? ` · <span style="color:#e0a34a">${ic('supply')}${Math.round(sup.level * 100)}%</span>` : '';
    const front = d.front != null ? game.frontById(d.front) : null;
    const stackN = game.divisionsAt(d.c, d.r).length;
    head.innerHTML = `<b style="font-size:15px">${TYPE_ICON[d.type]}</b><span class="small"> ${front ? ic('swords') : ''}${wp}</span>
      <span class="small ub-stats">${ic('soldier')}${Math.round(d.str)} · ${ic('bolt')}${Math.round(d.org)}/${t.maxOrg} · ${moralDot(d.moral)}${supWarn}${stackN > 1 ? ` · ${ic('stack')}${stackN}` : ''}</span>
      <button class="mini" id="ub-close">${ic('close')}</button>`;
  } else {
    const avgStr = sel.reduce((s, d) => s + d.str, 0) / sel.length;
    const frontN = sel.filter(d => d.front != null).length;
    const sameHex = sel.every(x => x.c === sel[0].c && x.r === sel[0].r);
    head.innerHTML = `<b>${ic('soldier')} ${sel.length}</b><span class="small ub-stats">${ic('soldier')}${Math.round(avgStr)}${frontN ? ` · ${ic('swords')}${frontN}` : ''}${sameHex ? ` · ${ic('stack')}${sel.length}` : ''}</span>
      <button class="mini" id="ub-close">${ic('close')}</button>`;
  }

  const cards = document.getElementById('unitbar-cards');
  const shown = sel.slice(0, 24);
  cards.innerHTML = shown.map(d => {
    const t = BAL.divTypes[d.type];
    const lowSup = game.supplyModOf(d).level < 0.25 ? ic('warn') : '';
    return `<div class="ucard" data-div="${d.id}">
      <div class="ucard-type" style="border-top-color:${TYPE_STRIPE[d.type] || '#8fa0b3'}">${TYPE_SHORT[d.type] || '?'}</div>
      <div class="ubar"><i style="width:${Math.max(0, Math.min(100, d.str))}%;background:#57c268"></i></div>
      <div class="ubar"><i style="width:${Math.max(0, Math.min(100, d.org / t.maxOrg * 100))}%;background:#e0b34a"></i></div>
      <div class="ucard-flags">${d.inCombat ? ic('swords') : ''}${lowSup}${d.front != null ? ic('road') : ''}</div>
    </div>`;
  }).join('') + (sel.length > 24 ? `<div class="ucard-more small">+${sel.length - 24}</div>` : '');

  const anyFront = sel.some(d => d.front != null);
  const actions = document.getElementById('unitbar-actions');
  actions.innerHTML = `
    <button id="ub-split">${ic('scissors')}</button>
    <button id="ub-merge">${ic('link')}</button>
    ${anyFront ? `<button id="ub-release">${ic('release')}</button>` : ''}
    <button id="ub-disband" class="danger">${ic('trash')}</button>`;

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
  const rel = document.getElementById('ub-release');
  if (rel) rel.onclick = () => {
    game.issue('release', playerSelection().map(d => d.id));
    updateUnitbar();
    refreshPanel();
  };
  document.getElementById('ub-disband').onclick = () => {
    const n = game.issue('disband', playerSelection().map(d => d.id)) || 0;
    UI.selectedDivs.clear();

    updateUnitbar();
    updateTopbar();
  };
}

/* =========================================================
   GEFÜHRTES ERSTES MATCH & BERATER (Easy Entry)
   ========================================================= */
const TUTORIAL_STEPS = [
  { text: 'Deine <b>Stadt übernimmt freies Umland von selbst</b> (näher = schneller). Schick deine Armee per <b>Rechtsklick</b> auf ein fremdes Feld und lass sie <b>stehen</b> — sie übernimmt genau dieses Feld!',
    done: g => g.nations[g.player].hexCount >= 9 },
  { text: 'Klicke ein <b>freies Feld in deinem Gebiet</b> an und bau eine <b>🎪 Kaserne</b> — sie bildet Truppen doppelt so schnell aus.',
    ghost: 'kaserne', done: g => g.ownedHexes(g.player).some(h => h.building === 'kaserne') },
  { text: 'Bau ein <b>🏠 Dorf</b> (oder eine 🎣 Fischerei am Ufer) — mehr 👥 Leute als Nachschub für deine Kaserne.',
    ghost: 'dorf', done: g => g.nations[g.player].leutePerDay >= 0.42 },
  { text: 'Klicke deine <b>Hauptstadt oder Kaserne</b> an und bilde <b>Krieger</b> aus — sie erscheinen dort nach der Ausbildung. Merke das Dreieck: Krieger &gt; Kavallerie &gt; Kanonen &gt; Krieger!',
    done: g => g.divisionsOf(g.player).length + g.training.filter(q => q.nation === g.player).length >= 2 },
  { text: '<b>Strg+Klick auf die Grenze</b> zu einem Nachbarn = Frontlinie — deine Truppen verteilen sich darauf (oder <b>B</b> drücken und selbst eine Linie ziehen). <b>3 🏛️ Hauptstädte gewinnen die Runde!</b>',
    done: g => g.fronts.some(f => f.owner === g.player) },
];

function tutorialDone() {
  try { return localStorage.getItem('finalfront_tutorial') === 'done'; } catch (e) { return true; }
}
function markTutorialDone() {
  try { localStorage.setItem('finalfront_tutorial', 'done'); } catch (e) { /* egal */ }
}

function updateTutorial() {
  const el = document.getElementById('tutorial');
  if (!game || game.over || game.spawnPhase || UI.tutorialStep == null || UI.tutorialStep < 0
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
      pushToast('🎓✔');
      el.classList.add('hidden');
      return;
    }
    pushToast('✅');
  }
  const s = TUTORIAL_STEPS[UI.tutorialStep];
  el.classList.remove('hidden');
  if (UI._tutRendered !== UI.tutorialStep) {
    UI._tutRendered = UI.tutorialStep;
    el.innerHTML = `<div class="tut-head"><span>🎓 AUFGABE ${UI.tutorialStep + 1}/${TUTORIAL_STEPS.length}</span>
        <button class="mini" id="tut-skip">✕</button></div>
      <div class="tut-text">${s.text}</div>`;
    el.querySelector('#tut-skip').onclick = () => {
      markTutorialDone();
      UI.tutorialStep = -1;
      UI._ghost = null;
      el.classList.add('hidden');
      pushToast('🎓✖');
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
    when: g => { const n = g.nations[g.player]; return n.leute < 5 && n.leutePerDay < 0.3; },
    msg: '⚠️ Kaum noch 👥 Leute — bau Dörfer, Fischereien oder Städte!' },
  { key: 'pleite', cd: 60000,
    when: g => !!g.nations[g.player]._broke,
    msg: '💸 PLEITE! Truppen verlieren Moral — löse Truppen auf (🗑) oder bau Gold-Gebäude (Forsterei/Stadt).' },
  { key: 'ruestung', cd: 90000,
    when: g => {
      const n = g.nations[g.player];
      return g.day > 50 && n.eisenPerDay === 0 && n.pferdePerDay === 0 && n.gold > 250;
    },
    msg: '💡 Ohne ⛏️ Minen (🔩 Kanonen) und 🚜 Farmen (🐎 Kavallerie) bleibt dir nur Infanterie!' },
  { key: 'stau', cd: 90000,
    when: g => { const n = g.nations[g.player]; return n.leute > (n.popCap || 99) * 0.9 && n.gold > 300 && g.divisionsOf(g.player).length < 6; },
    msg: '💡 Volle Kassen und volles Volk — klick eine Stadt oder Kaserne an und bilde Truppen aus!' },
  { key: 'popcap', cd: 90000,
    when: g => { const n = g.nations[g.player]; return n.popCap > 0 && n.leute >= n.popCap * 0.97 && n.leutePerDay > 0.05; },
    msg: '⚠️ Bevölkerungslimit erreicht — Dörfer, Städte und Fischereien erhöhen die Kapazität (👥 oben zeigt x/Limit)!' },
  { key: 'supply', cd: 90000,
    when: g => g.divisionsOf(g.player).some(d => g.supplyModOf(d).level < 0.2),
    msg: '⚠️ Divisionen ohne Nachschub verlieren Stärke — Straßen, Städte und Kasernen versorgen.' },
];

function advisorTick() {
  return;   // Berater deaktiviert — keine Text-Belehrungen mehr
  // eslint-disable-next-line no-unreachable
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

/* ---------- Akt-Uhr: Übergangs-Banner (rein kosmetisch, UI-seitig) ---------- */
const AKT_INFO = {
  2: { ey: 'Akt Ⅱ', title: 'Der Krieg', sub: 'Die Reiche stehen — jetzt entscheidet der Schwerpunkt' },
  3: { ey: 'Akt Ⅲ', title: 'Der Ring', sub: 'Eroberungen zählen doppelt · Angriffe schlagen härter durch · die Kronen leuchten' },
};

function aktTick() {
  if (!game) return;
  // Neues Spiel / Ladevorgang: still synchronisieren, kein Banner nachfeuern
  if (UI._aktGame !== game) { UI._aktGame = game; UI._lastAkt = game.akt; UI._gongDone = false; UI._dramaT = 0; return; }
  if (game.akt === UI._lastAkt) return;
  UI._lastAkt = game.akt;
  const info = AKT_INFO[game.akt];
  if (info && !game._replayCmds && !game.over) showAktBanner(info);
}

function showAktBanner(info, tone) {
  const el = document.getElementById('akt-banner');
  if (!el) return;
  el.querySelector('.ab-ey').textContent = info.ey;
  el.querySelector('.ab-title').textContent = info.title;
  el.querySelector('.ab-sub').textContent = info.sub;
  el.classList.remove('hidden', 'show', 'rot', 'gold');
  if (tone) el.classList.add(tone);   // 'rot' = Gefahr, 'gold' = Triumph
  void el.offsetWidth;   // Reflow: Animation zuverlässig neu starten
  el.classList.add('show');
}

/* ---------- Juice: WebAudio-Synth (keine Assets), Shake, Drama-Regie ----------
   Anti-Spam: höchstens ein Sound alle 5 s (Kronenfall darf immer), Banner im
   2,2-s-Abstand. Alles abschaltbar (Lautsprecher-Knopf, localStorage). */
UI.sound = (() => { try { return localStorage.getItem('ff_sound') !== '0'; } catch (e) { return true; } })();

const SFX = {
  ctx: null, last: 0,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* egal */ } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type, vol, delay, slideTo) {
    const ctx = this.ensure();
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime + (delay || 0);
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  },
  play(kind) {
    if (!UI.sound) return;
    const now = performance.now();
    if (kind !== 'krone' && kind !== 'gong' && now - this.last < 5000) return;
    this.last = now;
    if (kind === 'durchbruch') { this.tone(392, 0.16, 'square', 0.045); this.tone(523, 0.3, 'square', 0.045, 0.14); }
    else if (kind === 'kessel') { this.tone(85, 0.5, 'sine', 0.16, 0, 52); }
    else if (kind === 'krone') { this.tone(660, 1.1, 'triangle', 0.07); this.tone(990, 1.1, 'triangle', 0.045, 0.03); }
    else if (kind === 'verrat') { this.tone(220, 0.55, 'sawtooth', 0.035); this.tone(233, 0.55, 'sawtooth', 0.035); }
    else if (kind === 'gong') { this.tone(110, 1.7, 'sine', 0.15, 0, 62); this.tone(164, 1.4, 'sine', 0.05, 0.02); }
  },
};
// Browser-Autoplay: AudioContext braucht eine Nutzer-Geste zum Entsperren
window.addEventListener('pointerdown', () => SFX.ensure(), { once: true });

function screenShake(strong) {
  const el = document.body;
  el.classList.remove('shake', 'shake2');
  void el.offsetWidth;
  el.classList.add(strong ? 'shake2' : 'shake');
}

/* Drama-Regie: zieht Momente aus der Sim-Queue und inszeniert sie.
   Spieler-zentriert — KI-Geplänkel fern des Spielers bleibt im Log. */
function dramaTick() {
  if (!game) return;
  if (game.over && !UI._gongDone) { UI._gongDone = true; SFX.play('gong'); }
  if (!game._drama || !game._drama.length) return;
  if (game._replayCmds || game.spawnPhase) { game._drama.length = 0; return; }
  const now = performance.now();
  if (now - (UI._dramaT || 0) < 2200) return;   // Banner-Abstand
  const ev = game._drama.shift();
  if (!ev) return;
  const me = game.player;
  const N = id => game.nationName(id);
  let shown = true;
  if (ev.type === 'krone') {
    const mine = ev.by === me, lost = ev.loser === me;
    showAktBanner({
      ey: ev.name || 'Hauptstadt',
      title: mine ? 'Krone erobert!' : lost ? 'Deine Krone fällt!' : 'Krone gefallen',
      sub: `${N(ev.loser || '')} → ${N(ev.by)}`,
    }, mine ? 'gold' : 'rot');
    SFX.play('krone');
    if (mine || lost) screenShake(true);
  } else if (ev.type === 'kessel') {
    const mine = ev.owner === me;
    if (!mine && ev.count < 2) { shown = false; }
    else {
      showAktBanner({
        ey: 'Einkesselung',
        title: mine ? 'Kessel!' : 'Kessel geschlossen',
        sub: mine ? `${ev.count} deiner Divisionen eingeschlossen — raus da!`
          : `${ev.count} Divisionen von ${N(ev.owner)} sitzen fest`,
      }, mine ? 'rot' : undefined);
      SFX.play('kessel');
      if (mine) screenShake(false);
    }
  } else if (ev.type === 'durchbruch') {
    if (ev.by !== me) shown = false;
    else { showAktBanner({ ey: 'Die Front rollt', title: 'Durchbruch!', sub: '4 Felder heute — nachstoßen!' }, 'gold'); SFX.play('durchbruch'); }
  } else if (ev.type === 'einbruch') {
    if (ev.loser !== me) shown = false;
    else { showAktBanner({ ey: 'Alarm', title: 'Die Front bricht!', sub: '4 Felder heute verloren — stopf die Lücke' }, 'rot'); SFX.play('kessel'); screenShake(false); }
  } else if (ev.type === 'verrat') {
    showAktBanner({
      ey: 'Dolchstoß',
      title: 'Verrat!',
      sub: `${N(ev.traitor)} fällt ${ev.victim === me ? 'DIR' : N(ev.victim)} in den Rücken`,
    }, 'rot');
    SFX.play('verrat');
    if (ev.victim === me) screenShake(true);
  } else {
    shown = false;
  }
  if (shown) UI._dramaT = now;
}

/* ---------- Der Flüsterer: ein Satz zur richtigen Zeit, je einmal ----------
   Kein Tutorial-Modus — die Runde ist das Tutorial. Jeder Hinweis feuert
   genau einmal (localStorage), einer zur Zeit, ✕ blendet sofort aus. */
const WHISPERS = [
  { key: 'spawn', when: g => g.spawnPhase,
    text: 'Wähle deinen Startplatz — deine Hauptstadt glüht golden. Bleiben ist okay.' },
  { key: 'sperre', when: g => !g.spawnPhase
      && g.divisionsOf(g.player).some(d => d.inCombat && !d.attackTarget),
    text: 'Wer angegriffen wird, steht fest — bis der Kampf entschieden ist.' },
  { key: 'ampel', when: g => {
      if (g.spawnPhase) return false;
      const mine = g.divisionsOf(g.player);
      if (!mine.length) return false;
      return g.divisions.some(e => !e.dead && e.nation !== g.player
        && g.hostile(g.player, e.nation)
        && mine.some(d => hexDist(d.c, d.r, e.c, e.r) <= 2));
    },
    text: 'Die Bubble ist eine Ampel: Grün = greif an · Rot = sammel erst Masse.' },
  { key: 'land', when: g => !g.spawnPhase && g.day >= 1.5,
    text: 'Lauf auf freies Land — es wird deins.' },
  // Überlebens-Hinweise: wer nicht baut und ausbildet, wird in Akt II überrannt
  { key: 'ausbilden', when: g => !g.spawnPhase && g.day >= 12
      && g.divisionsOf(g.player).length < 3
      && g.nations[g.player].leute >= BAL.divTypes.inf.mp,
    text: 'Zeit für Nachschub: Klick deine Hauptstadt an und bilde Krieger aus.' },
  { key: 'wirtschaft', when: g => !g.spawnPhase && g.day >= 20
      && g.nations[g.player].gold > 180 && g.builtCount(g.player, 'dorf') < 1,
    text: 'Volle Kasse: Bau Dörfer und Forstereien — Akt Ⅱ gewinnt, wer jetzt wirtschaftet.' },
];

function whisperSeen() {
  try { return JSON.parse(localStorage.getItem('ff_whisper') || '{}'); } catch (e) { return {}; }
}

function whisperTick() {
  const el = document.getElementById('whisper');
  if (!el) return;
  if (!UI._whisperBound) {
    UI._whisperBound = true;
    document.getElementById('whisper-x').addEventListener('click', () => {
      el.classList.add('hidden'); UI._whisperUntil = 0; UI._whisperGapT = performance.now();
    });
  }
  if (!game || game.over || game._replayCmds) { el.classList.add('hidden'); UI._whisperUntil = 0; return; }
  const now = performance.now();
  if (UI._whisperUntil) {
    if (now < UI._whisperUntil) return;                       // Hinweis läuft noch
    el.classList.add('hidden'); UI._whisperUntil = 0; UI._whisperGapT = now;
  }
  if (now - (UI._whisperGapT || 0) < 3000) return;            // Luft zwischen Hinweisen
  const seen = whisperSeen();
  for (const w of WHISPERS) {
    if (seen[w.key]) continue;
    let fire = false;
    try { fire = w.when(game); } catch (e) { fire = false; }
    if (!fire) continue;
    seen[w.key] = 1;
    try { localStorage.setItem('ff_whisper', JSON.stringify(seen)); } catch (e) { /* egal */ }
    document.getElementById('whisper-text').textContent = w.text;
    el.classList.remove('hidden');
    UI._whisperUntil = now + 6500;
    break;                                                    // höchstens einer gleichzeitig
  }
}

/* ---------- Doktrin-Wahl (Akt II): vier Archetypen, ein Entscheid ----------
   Ein-Satz-Identitäten, Zahlen nur im Tooltip. Massenheer ist Default bei
   Nichtwahl. Läuft als issue('doctrine') durch den Lockstep (MP-sicher). */
const DOCTRINE_CARDS = [
  { key: 'blitz', tag: 'Rush · der Hammer', one: '„Schnell rein, schnell durch."',
    up: 'Durchbruch & Marschtempo', down: 'Zäh im Halten',
    tip: 'Durchbruch ×1,35 · Tempo ×1,25 · Verteidigung ×0,85 · Org-Regen ×0,85' },
  { key: 'festung', tag: 'Turtle · der Amboss', one: '„Komm doch."',
    up: 'Halten & Regenerieren', down: 'Langsamer Angriff',
    tip: 'Verteidigung ×1,35 · Org-Regen ×1,35 · Durchbruch ×0,85 · Tempo ×0,95' },
  { key: 'wirtschaft', tag: 'Boom · der Spätzünder', one: '„Erst reich, dann Krieg."',
    up: 'Ertrag & billige Bauten', down: 'Schwächerer Angriff',
    tip: 'Gold-Ertrag ×1,4 · Baukosten ×0,75 · Angriff ×0,9' },
  { key: 'masse', tag: 'Swarm · die Welle', one: '„Viele sind ein Argument."',
    up: 'Billige Truppen & mehr Volk', down: 'Dünn pro Division',
    tip: 'Truppenkosten ×0,7 · Bevölkerungslimit ×1,3 · Angriff ×0,92', def: true },
];

function doctrineTick() {
  const el = document.getElementById('doctrine-dialog');
  if (!el) return;
  const show = game && !game.over && !game._replayCmds && !game.spawnPhase
    && game.akt >= 2 && game.nations[game.player] && game.nations[game.player].alive
    && !game.nations[game.player].doctrine;
  if (!show) {
    if (!el.classList.contains('hidden')) {
      el.classList.add('hidden');
      // Einzelspieler: die Wahl hat pausiert — vorherigen Zustand wiederherstellen
      if (UI._ddPaused && game && !game._net) game.paused = !!UI._ddPausedPrev;
      UI._ddPaused = false;
    }
    return;
  }
  const deadline = Math.floor(BAL.round.days * BAL.round.akt2) + BAL.doctrineGraceDays;
  const rest = Math.max(0, deadline - game.day);
  const t = document.getElementById('dd-timer');
  if (t) t.textContent = game._net
    ? (rest > 0 ? `in ${rest} Tagen wählt das Massenheer für dich` : 'Massenheer übernimmt')
    : 'das Spiel wartet auf dich';
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    renderDoctrineCards();
    if (!game._net) { UI._ddPausedPrev = game.paused; game.paused = true; UI._ddPaused = true; }
  }
}

function renderDoctrineCards() {
  const box = document.getElementById('dd-cards');
  if (!box) return;
  box.innerHTML = DOCTRINE_CARDS.map(c => `
    <button class="dd-card dd-${c.key}" data-doc="${c.key}" title="${c.tip}">
      <span class="dd-name">${BAL.doctrines[c.key].name}</span>
      <span class="dd-tag">${c.tag}</span>
      <span class="dd-one">${c.one}</span>
      <span class="dd-up">▲ ${c.up}</span>
      <span class="dd-down">▼ ${c.down}</span>
      ${c.def ? '<span class="dd-def">Default bei Nichtwahl</span>' : ''}
    </button>`).join('');
  box.querySelectorAll('.dd-card').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.doc;
    const res = game.issue('doctrine', key);
    if (res === true || game._net) {
      const c = DOCTRINE_CARDS.find(x => x.key === key);
      showAktBanner({ ey: 'Doktrin gewählt', title: BAL.doctrines[key].name,
        sub: c ? c.one.replace(/[„"]/g, '') : '' });
    } else if (typeof res === 'string') {
      pushToast(res);
    }
  }));
}

/* ---------- Spawn-Phase: Startplatz wählen ---------- */
function updateSpawnPhase() {
  const el = document.getElementById('spawn-banner');
  if (!game || !game.spawnPhase || game._replayCmds) { el.classList.add('hidden'); UI._mpReadySent = false; return; }
  el.classList.remove('hidden');
  const rest = Math.max(0, Math.ceil((UI.spawnDeadline - performance.now()) / 1000));
  const cnt = el.querySelector('#spawn-count');
  if (cnt) cnt.textContent = rest;
  if (rest <= 0) finishSpawnPhase();
}

function finishSpawnPhase() {
  if (!game || !game.spawnPhase || game._replayCmds) return;
  if (game._net) {
    // Multiplayer: "Bereit"-Stimme — der Server beendet die Phase für alle
    if (!UI._mpReadySent) {
      UI._mpReadySent = true;
      game.issue('startMatch');
      pushToast('✔⏳');
    }
    return;
  }
  game.issue('startMatch');
  document.getElementById('spawn-banner').classList.add('hidden');
  updateTopbar();
  refreshPanel();
}

/* ---------- Ereignis-Log ---------- */
let lastLogLen = 0;
function updateLog() {
  if (!game || !UI.hud.log) return;
  if (game.log.length === lastLogLen) return;
  lastLogLen = game.log.length;
  const el = document.getElementById('log');
  el.innerHTML = game.log.slice(-7).map(l =>
    `<div class="${l.important ? 'imp' : ''}"><span>${dateStr(l.day)}</span> ${l.msg}</div>`).join('');
}

/* Mini-Kartenvorschau: echte Landform des Maps als Sprite ins Menü zeichnen.
   Wasser dunkelblau, Land nach Terrain, Flüsse hell, feiner Küstensaum. */
const THUMB_COLS = { p: '#9aa38f', f: '#7f9a7e', h: '#a89e86', m: '#6f6b71' };
function drawMapThumb(cv, m) {
  const maxW = 88, maxH = 60;
  const px = Math.max(1, Math.min(maxW / m.w, maxH / m.h));
  cv.width = Math.ceil(m.w * px + px * 0.5);
  cv.height = Math.ceil(m.h * px);
  const ctx = cv.getContext('2d');
  // Meerwasser-Grund mit sanftem Verlauf
  const g = ctx.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, '#1b3a52'); g.addColorStop(1, '#122a3d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  const cell = px + 0.6;   // leichte Überlappung → keine Lücken
  for (let r = 0; r < m.h; r++) {
    const row = m.rows[r] || '';
    const riv = (m.rivers && m.rivers[r]) || '';
    const off = (r & 1) ? px * 0.5 : 0;
    for (let c = 0; c < m.w; c++) {
      const ch = row[c];
      if (!ch || ch === '.') continue;
      ctx.fillStyle = riv[c] === 'r' ? '#5a9ed6' : (THUMB_COLS[ch] || '#9aa38f');
      ctx.fillRect(c * px + off, r * px, cell, cell);
    }
  }
}

/* Nations-Wappen: kleines heraldisches Schild in der Nationsfarbe.
   Verlauf für Volumen, dunkle Kontur, heller Glanzstreifen oben. */
function drawNationShield(cv, color) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, cx = W / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(cx - 18, 5);
  ctx.lineTo(cx + 18, 5);
  ctx.lineTo(cx + 18, H * 0.48);
  ctx.quadraticCurveTo(cx + 18, H - 12, cx, H - 3);
  ctx.quadraticCurveTo(cx - 18, H - 12, cx - 18, H * 0.48);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, shade(color, 1.22));
  g.addColorStop(1, shade(color, 0.78));
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  // Glanzstreifen oben
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  ctx.beginPath();
  ctx.moveTo(cx - 18, 5); ctx.lineTo(cx + 18, 5);
  ctx.lineTo(cx + 18, 14); ctx.lineTo(cx - 18, 20);
  ctx.closePath(); ctx.fill();
  // senkrechter Mittelgrat (Pfahl) — dezent
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(cx - 1.2, 5, 2.4, H);
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(10,14,20,0.9)';
  ctx.beginPath();
  ctx.moveTo(cx - 18, 5);
  ctx.lineTo(cx + 18, 5);
  ctx.lineTo(cx + 18, H * 0.48);
  ctx.quadraticCurveTo(cx + 18, H - 12, cx, H - 3);
  ctx.quadraticCurveTo(cx - 18, H - 12, cx - 18, H * 0.48);
  ctx.closePath(); ctx.stroke();
}

/* ---------- Start- und Endbildschirm ---------- */
function showStartScreen() {
  if (typeof NET !== 'undefined' && (NET.ws || NET.driver)) netLeave(true);
  const sc = document.getElementById('start');
  sc.classList.remove('hidden');
  document.getElementById('gameover').classList.add('hidden');
  if (typeof netProbeForStartScreen === 'function') netProbeForStartScreen();

  // Kartenwahl
  if (!UI.selectedMap || !GENMAPS[UI.selectedMap]) UI.selectedMap = Object.keys(GENMAPS)[0];
  const mapGrid = document.getElementById('map-grid');
  const renderMaps = () => {
    mapGrid.innerHTML = Object.entries(GENMAPS).map(([id, m]) => {
      let land = 0;
      for (const row of m.rows) for (const ch of row) if (ch !== '.') land++;
      return `<button class="nation-card map-card ${UI.selectedMap === id ? 'sel' : ''}" data-map="${id}">
        <canvas class="map-thumb"></canvas>
        <span class="map-card-txt">
          <b>${id === 'duell' ? '⚔️ ' : ''}${m.name}</b>
          <span class="small">⬡${land} · ${id === 'duell' ? '2' : '5'}👤</span>
        </span>
      </button>`;
    }).join('');
    mapGrid.querySelectorAll('.map-card').forEach(b => {
      const cv = b.querySelector('.map-thumb');
      if (cv) drawMapThumb(cv, GENMAPS[b.dataset.map]);
      b.addEventListener('click', () => { UI.selectedMap = b.dataset.map; renderMaps(); });
    });
  };
  renderMaps();

  const grid = document.getElementById('nation-grid');
  grid.innerHTML = Object.entries(NATION_DEFS).map(([id]) =>
    `<button class="nation-card" data-nation="${id}">
      <canvas class="nation-shield" width="42" height="50"></canvas>
    </button>`).join('');
  grid.querySelectorAll('.nation-card').forEach(b => {
    const cv = b.querySelector('.nation-shield');
    if (cv) drawNationShield(cv, NATION_DEFS[b.dataset.nation].color);
    b.addEventListener('click', () => startGame(b.dataset.nation));
  });
  const cont = document.getElementById('btn-continue');
  const has = readSlot('finalfront_save') || readSlot('finalfront_autosave');
  cont.classList.toggle('hidden', !has);
  cont.onclick = () => loadNewestSave();
}

function startGame(nationId) {
  const slots = UI.selectedMap === 'duell' ? 2 : 5;
  if (slots === 2 && nationId !== 'A' && nationId !== 'B') nationId = 'A';
  window.game = new Game(nationId, undefined, UI.selectedMap, undefined, slots);
  rebuildLayers();
  lastLogLen = 0;
  UI.selectedHex = null; UI.selectedDivs.clear(); UI.selectedArmy = null;
  UI.buildMode = null;
  UI.frontDraw = null;
  UI.activeTab = null;                 // Spawn-Phase: freie Sicht auf die Karte
  document.getElementById('start').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('offers').innerHTML = '';
  game._offersChanged = true;
  game.updateFronts();
  fitView();                           // kleine Karte: alles im Blick für die Spawn-Wahl
  UI.spawnDeadline = performance.now() + BAL.spawn.seconds * 1000;
  UI.tutorialStep = -1;   // Einführung deaktiviert — keine Text-Aufgaben
  UI._tutRendered = -1;
  UI._advisor = {};
  UI._ghost = null;
  refreshPanel();
  updateTopbar();
  updateUnitbar();
  updateTutorial();
  updateSpawnPhase();
}

/* ---------- Replay ---------- */
function startReplay() {
  const rep = game && game.getReplay ? game.getReplay() : null;
  if (!rep) { pushToast('🎬⚠'); return; }
  const g = Game.fromReplay(rep);
  if (!g) return;
  window.game = g;
  rebuildLayers();
  lastLogLen = 0;
  UI.selectedDivs.clear(); UI.selectedHex = null; UI.selectedArmy = null;
  UI.buildMode = null;
  UI.tutorialStep = -1; UI._ghost = null;
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('offers').innerHTML = '';
  game._offersChanged = true;
  game.speed = 3;
  game.paused = false;
  game.updateFronts();
  centerOn(...game.nations[game.player].capital, 1.0);
  refreshPanel(); updateTopbar(); updateUnitbar(); renderRanking();
}

function checkGameOver() {
  if (!game || !game.over) return;
  const el = document.getElementById('gameover');
  if (!el.classList.contains('hidden')) return;
  el.classList.remove('hidden');
  el.querySelector('h1').textContent = game.over.win ? '🏆' : '💀';
  el.querySelector('p').textContent = '';
  const rbtn = document.getElementById('gameover-replay');
  rbtn.classList.toggle('hidden', !(game._replayCapable && game.cmdLog));
  rbtn.onclick = startReplay;
  const lbtn = document.getElementById('gameover-lobby');
  if (lbtn) {
    lbtn.classList.toggle('hidden', !game._net);
    lbtn.onclick = () => netBackToLobby();
  }
  // Endstand: Top 5 + Spieler — mit finaler Sieg-Leiste
  game.vpRecount();
  const ids = rankedNations();
  const maxScore = ids.length ? game.score(ids[0]) : 1;
  let html = `<div class="rank-head">📅${game.day} · 🏛️ · ⬡</div>`;
  ids.forEach((id, i) => {
    if (i < 5 || id === game.player) html += rankRowHtml(i + 1, id, maxScore);
  });
  if (!game.nations[game.player].alive)
    html += `<div class="rank-row me"><span class="rank-pl">☠</span></div>`;
  document.getElementById('gameover-stats').innerHTML = html;
  document.getElementById('ranking').innerHTML = '';
}
