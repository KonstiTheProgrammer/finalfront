/* =========================================================
   FINAL FRONT — net.js (Multiplayer-Client)

   Lockstep: Der Server taktet die Runde in "Steps" (8/s).
   Jeder Step enthält alle Kommandos aller Spieler — jeder
   Client führt sie in identischer Reihenfolge aus und rechnet
   dann genau EINEN Simulations-Tick. Gleiche Saat + gleiche
   Kommandos = identisches Spiel auf allen Geräten.

   Server-Adresse: wird aus einem GitHub-Gist gelesen, das
   tools/mpserver/start.sh beim Hochfahren aktualisiert.
   ========================================================= */

const NET = {
  // Discovery: hier veröffentlicht der Server seine aktuelle wss-Adresse
  CONFIG_URL: 'https://gist.githubusercontent.com/KonstiTheProgrammer/41b04695913f0fbc3145fe31cebf8a3d/raw/finalfront-server.json',
  LOCAL_URL: 'ws://localhost:8571',    // Entwicklung: lokaler Server hat Vorrang

  ws: null,
  state: 'off',        // off | connecting | lobby | game
  you: null,
  lobby: null,
  steps: [],           // empfangene, noch nicht ausgeführte Steps
  nextTick: 0,
  driver: null,
  active: false,       // true, solange eine MP-Runde läuft
  names: null,         // Nation -> Spielername (vom Server)
  rtt: null,           // gemessener Ping (ms)
  _pinger: null,
};

/* ---------- Server finden & verbinden ---------- */
async function netFindServer() {
  // 1) lokaler Server (Entwicklung / eigenes Hosting)
  try {
    const base = NET.LOCAL_URL.replace('ws://', 'http://').replace('wss://', 'https://');
    const res = await fetch(base, { signal: AbortSignal.timeout(1200) });
    const info = await res.json();
    if (info && info.ok) return { url: NET.LOCAL_URL, info };
  } catch (e) { /* kein lokaler Server */ }
  // 2) veröffentlichte Adresse aus dem Gist (Cache umgehen)
  try {
    const res = await fetch(NET.CONFIG_URL + '?t=' + Date.now(), { signal: AbortSignal.timeout(5000) });
    const cfg = await res.json();
    if (cfg && cfg.url && cfg.url.startsWith('ws')) {
      const base = cfg.url.replace('wss://', 'https://').replace('ws://', 'http://');
      const res2 = await fetch(base, { signal: AbortSignal.timeout(5000) });
      const info = await res2.json();
      if (info && info.ok) return { url: cfg.url, info };
    }
  } catch (e) { /* offline */ }
  return null;
}

function netStatusText(info) {
  if (!info) return '🌐❌';
  const duel = info.duel ? ` · ⚔️${info.duel.players}/${info.duel.needed}` : '';
  return `🌐✅ 🌍${info.lobby.players}/${info.lobby.needed}${duel}`;
}

/* Startbildschirm: Status anzeigen (wird beim Öffnen geprüft) */
async function netProbeForStartScreen() {
  const el = document.getElementById('mp-status');
  if (!el) return;
  el.textContent = '🌐⏳';
  const found = await netFindServer();
  NET._found = found;
  el.textContent = netStatusText(found && found.info);
  const btn = document.getElementById('btn-mp');
  if (btn) btn.disabled = !found;
  const btn2 = document.getElementById('btn-mp-duel');
  if (btn2) btn2.disabled = !found;
}

function netJoin(mode) {
  if (mode === 'ffa' || mode === 'duel') NET.mode = mode;
  if (!NET.mode) NET.mode = 'ffa';
  if (NET.ws) { try { NET.ws.close(); } catch (e) {} NET.ws = null; }
  const found = NET._found;
  if (!found) { pushToast('🌐❌'); return; }
  NET.state = 'connecting';
  netShowLobby('⏳');
  const ws = new WebSocket(found.url);
  NET.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'hello', name: netPlayerName() }));
    ws.send(JSON.stringify({ t: 'join', mode: NET.mode }));
    clearInterval(NET._pinger);
    NET._pinger = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
    }, 4000);
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
  };
  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    netHandle(msg);
  };
  ws.onclose = () => {
    if (NET.state === 'connecting') {
      // erster Versuch gescheitert (Browser-Warmlauf o. Ä.) — einmal neu probieren
      if (!NET._retried) {
        NET._retried = true;
        setTimeout(netJoin, 700);
        return;
      }
      pushToast('🌐❌');
      netLeave();
      return;
    }
    if (NET.state === 'game' && window.game && game._net && !game.over) {
      pushToast('🔌❌');
    }
    if (NET.state !== 'off') netLeave(true);
  };
  ws.onerror = () => { /* onclose übernimmt */ };
}

function netPlayerName() {
  try {
    let n = localStorage.getItem('finalfront_name');
    if (!n) {
      n = 'Spieler' + (100 + Math.floor(Math.random() * 900));
      localStorage.setItem('finalfront_name', n);
    }
    return n;
  } catch (e) { return 'Spieler'; }
}

function netLeave(silent) {
  if (NET.ws) {
    try { NET.ws.send(JSON.stringify({ t: 'leave' })); NET.ws.close(); } catch (e) {}
  }
  NET.ws = null;
  NET.state = 'off';
  NET.active = false;
  NET.rtt = null;
  clearInterval(NET._pinger);
  NET._pinger = null;
  if (NET.driver) { clearInterval(NET.driver); NET.driver = null; }
  const cl = document.getElementById('chat-log');
  if (cl) { cl.innerHTML = ''; cl.classList.add('hidden'); }
  const ci = document.getElementById('chat-input');
  if (ci) ci.classList.remove('open');
  if (window.game && game._net) game._net = null;
  const ov = document.getElementById('mp-lobby');
  if (ov) ov.classList.add('hidden');
  if (!silent) showStartScreen();
}

/* ---------- Nachrichten vom Server ---------- */
function netHandle(msg) {
  if (msg.t === 'hi' || msg.t === 'lobby') {
    NET._retried = false;   // Verbindung steht
    NET.lobby = msg;
    if (msg.you) NET.you = msg.you;
    if (NET.state !== 'game') { NET.state = 'lobby'; netRenderLobby(); }

  } else if (msg.t === 'err') {
    pushToast('🌐⚠');

  } else if (msg.t === 'start') {
    netStartGame(msg);

  } else if (msg.t === 'step') {
    NET.steps.push(msg);

  } else if (msg.t === 'pong') {
    NET.rtt = Math.max(1, Math.round(performance.now() - msg.ts));

  } else if (msg.t === 'chat') {
    netChatShow(msg);
  }
}

/* ---------- Chat ---------- */
function netChatShow(msg) {
  const box = document.getElementById('chat-log');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'chat-line';
  const col = msg.n && NATION_DEFS[msg.n] ? NATION_DEFS[msg.n].color : '#9fb2c8';
  el.innerHTML = `<b style="color:${col}">${(msg.name || '?').replace(/</g, '&lt;')}:</b> ${String(msg.msg).replace(/</g, '&lt;')}`;
  box.appendChild(el);
  while (box.children.length > 6) box.removeChild(box.firstChild);
  box.classList.remove('hidden');
  clearTimeout(NET._chatHideT);
  NET._chatHideT = setTimeout(() => { if (!document.getElementById('chat-input').classList.contains('open')) box.classList.add('hidden'); }, 12000);
}

function netChatSend(text) {
  text = (text || '').trim();
  if (!text || !NET.ws || NET.ws.readyState !== 1) return;
  NET.ws.send(JSON.stringify({ t: 'chat', msg: text.slice(0, 160) }));
}

/* Enter = Chat öffnen/senden (nur wenn verbunden) */
function netToggleChat() {
  if (!NET.ws || NET.ws.readyState !== 1) return false;
  const wrap = document.getElementById('chat-input');
  const inp = wrap.querySelector('input');
  if (wrap.classList.contains('open')) {
    const v = inp.value;
    inp.value = '';
    wrap.classList.remove('open');
    inp.blur();
    if (v.trim()) netChatSend(v);
  } else {
    wrap.classList.add('open');
    document.getElementById('chat-log').classList.remove('hidden');
    inp.focus();
  }
  return true;
}

/* ---------- Lobby-UI ---------- */
function netShowLobby(text) {
  const ov = document.getElementById('mp-lobby');
  ov.classList.remove('hidden');
  document.getElementById('start').classList.add('hidden');
  if (text) document.getElementById('mp-lobby-list').innerHTML = `<p class="hint">${text}</p>`;
}

function netDrawMapPreview(mapId) {
  const cv = document.getElementById('mp-lobby-preview');
  if (!cv || !GENMAPS[mapId]) return;
  if (cv._drawn === mapId) return;
  cv._drawn = mapId;
  const m = GENMAPS[mapId];
  const px = Math.max(2, Math.floor(Math.min(220 / m.w, 150 / m.h)));
  cv.width = m.w * px + px;
  cv.height = m.h * px;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#16283a';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const COLS = { p: '#a8aba4', f: '#98a89a', h: '#a49e8e', m: '#7e7a80' };
  for (let r = 0; r < m.h; r++) {
    const row = m.rows[r] || '';
    const riv = (m.rivers && m.rivers[r]) || '';
    for (let c = 0; c < m.w; c++) {
      const ch = row[c];
      if (!ch || ch === '.') continue;
      ctx.fillStyle = riv[c] === 'r' ? '#5a9ed6' : (COLS[ch] || '#a8aba4');
      ctx.fillRect(c * px + ((r & 1) ? px / 2 : 0), r * px, px, px);
    }
  }
}

function netRenderLobby() {
  const l = NET.lobby;
  if (!l) return;
  netShowLobby();
  netDrawMapPreview(l.mapId);
  document.getElementById('mp-lobby-map').innerHTML =
    `<b>${l.mode === 'duel' ? '⚔️' : '🌍'} ${l.players.length}/${l.needed} 👤</b>${l.rounds ? ` · ▶${l.rounds}` : ''}`;
  const me = l.players.find(p => p.nation === NET.you);
  document.getElementById('mp-lobby-list').innerHTML = l.players.map(p => `
    <div class="mp-row ${p.nation === NET.you ? 'me' : ''}">
      <span class="chip" style="background:${NATION_DEFS[p.nation] ? NATION_DEFS[p.nation].color : '#888'}"></span>
      <b>${(p.name || '').replace(/</g, '&lt;')}</b>${p.nation === NET.you ? ' 👈' : ''}
      <span class="mp-ready">${p.ready ? '✔' : '⏳'}</span>
    </div>`).join('');
  const btn = document.getElementById('mp-ready');
  btn.textContent = me && me.ready ? '✔…' : '✔';
  btn.dataset.ready = me && me.ready ? '1' : '0';
}

/* ---------- Runde starten (alle Clients identisch) ---------- */
function netStartGame(msg) {
  NET.state = 'game';
  NET.active = true;
  NET.steps = [];
  NET.nextTick = 0;
  document.getElementById('mp-lobby').classList.add('hidden');

  window.game = new Game(msg.you, msg.seed, msg.mapId, msg.humans, msg.slots || 5);
  game._net = NET;
  NET.names = msg.names || null;
  game._names = NET.names;
  rebuildLayers();
  lastLogLen = 0;
  UI.selectedHex = null; UI.selectedDivs.clear(); UI.selectedArmy = null;
  UI.buildMode = null; UI.frontDraw = null; UI.pushMode = null;
  UI.activeTab = null;
  document.getElementById('start').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('offers').innerHTML = '';
  game._offersChanged = true;
  game.updateFronts();
  fitView();
  UI.spawnDeadline = performance.now() + (msg.spawnSeconds || 20) * 1000;
  UI.tutorialStep = -1;   // Multiplayer: keine Einführung
  UI._ghost = null;
  game.speed = 2;         // nur Anzeige — der Server taktet
  refreshPanel(); updateTopbar(); updateUnitbar(); updateTutorial(); updateSpawnPhase();
  pushToast(`🌐▶ 📍`);

  // Step-Treiber: unabhängig vom Renderer (läuft auch im Hintergrund-Tab)
  if (NET.driver) clearInterval(NET.driver);
  NET.driver = setInterval(netDrive, 20);
}

function netDrive() {
  if (!window.game || !game._net) return;
  let budget = 40;   // Aufhol-Limit pro Durchlauf (Burst nach Tab-Wechsel)
  while (NET.steps.length && budget-- > 0) {
    const step = NET.steps.shift();
    for (const c of (step.cmds || [])) game.applyNetCmd(c.n, c.cmd, c.args);
    if (step.k >= 0 && !game.over) game.runTick();
  }
  if (game.over && NET.active) {
    NET.active = false;
    if (NET.ws) { try { NET.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {} }
  }
}

/* Nach dem Rundenende: direkt zurück in die (nächste) Lobby — die Karte rotiert */
function netBackToLobby() {
  if (NET.driver) { clearInterval(NET.driver); NET.driver = null; }
  if (window.game && game._net) game._net = null;
  NET.active = false;
  document.getElementById('gameover').classList.add('hidden');
  if (NET.ws && NET.ws.readyState === 1) {
    NET.state = 'lobby';
    netShowLobby('⏳');
    NET.ws.send(JSON.stringify({ t: 'join', mode: NET.mode || 'ffa' }));
  } else {
    netProbeThenJoin();
  }
}

async function netProbeThenJoin() {
  netShowLobby('⏳');
  NET._found = await netFindServer();
  if (NET._found) netJoin();
  else { pushToast('🌐❌'); netLeave(); }
}

/* ---------- Kommandos zum Server ---------- */
NET.sendCmd = function (cmd, args) {
  if (!NET.ws || NET.ws.readyState !== 1) return null;
  NET.ws.send(JSON.stringify({ t: 'cmd', cmd, args }));
  return 'sent';   // UI: Befehl ist unterwegs (Ausführung kommt im nächsten Step)
};

/* ---------- Verkabelung (Startbildschirm & Lobby-Buttons) ---------- */
window.addEventListener('DOMContentLoaded', () => {
  const btnMp = document.getElementById('btn-mp');
  if (btnMp) btnMp.addEventListener('click', () => netJoin('ffa'));
  const btnDuel = document.getElementById('btn-mp-duel');
  if (btnDuel) btnDuel.addEventListener('click', () => netJoin('duel'));
  const btnReady = document.getElementById('mp-ready');
  if (btnReady) btnReady.addEventListener('click', () => {
    if (NET.ws && NET.state === 'lobby')
      NET.ws.send(JSON.stringify({ t: 'ready', v: btnReady.dataset.ready !== '1' }));
  });
  const btnLeave = document.getElementById('mp-leave');
  if (btnLeave) btnLeave.addEventListener('click', () => netLeave());
  const nameInput = document.getElementById('mp-name');
  if (nameInput) {
    nameInput.value = netPlayerName();
    nameInput.addEventListener('change', () => {
      try { localStorage.setItem('finalfront_name', nameInput.value.slice(0, 20) || 'Spieler'); } catch (e) {}
    });
  }
  const chatInp = document.querySelector('#chat-input input');
  if (chatInp) {
    chatInp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') netToggleChat();
      else if (e.key === 'Escape') {
        chatInp.value = '';
        document.getElementById('chat-input').classList.remove('open');
        chatInp.blur();
      }
    });
  }
});
