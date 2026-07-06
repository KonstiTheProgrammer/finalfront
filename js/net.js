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
  if (!info) return '🌐 Multiplayer: Server offline';
  return `🌐 Multiplayer: online — Lobby ${info.lobby.players}/${info.lobby.needed} · Karte: ${info.lobby.map}`;
}

/* Startbildschirm: Status anzeigen (wird beim Öffnen geprüft) */
async function netProbeForStartScreen() {
  const el = document.getElementById('mp-status');
  if (!el) return;
  el.textContent = '🌐 Multiplayer: suche Server …';
  const found = await netFindServer();
  NET._found = found;
  el.textContent = netStatusText(found && found.info);
  const btn = document.getElementById('btn-mp');
  if (btn) btn.disabled = !found;
}

function netJoin() {
  if (NET.ws) { try { NET.ws.close(); } catch (e) {} NET.ws = null; }
  const found = NET._found;
  if (!found) { pushToast('🌐 Kein Multiplayer-Server erreichbar — spiel solange Solo!'); return; }
  NET.state = 'connecting';
  netShowLobby('Verbinde …');
  const ws = new WebSocket(found.url);
  NET.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'hello', name: netPlayerName() }));
    ws.send(JSON.stringify({ t: 'join' }));
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
      pushToast('🌐 Verbindung fehlgeschlagen — Server nicht erreichbar.');
      netLeave();
      return;
    }
    if (NET.state === 'game' && window.game && game._net && !game.over) {
      pushToast('🔌 Verbindung zum Server verloren — die Runde läuft ohne dich weiter.');
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
  if (NET.driver) { clearInterval(NET.driver); NET.driver = null; }
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
    pushToast('🌐 ' + msg.msg);

  } else if (msg.t === 'start') {
    netStartGame(msg);

  } else if (msg.t === 'step') {
    NET.steps.push(msg);
  }
}

/* ---------- Lobby-UI ---------- */
function netShowLobby(text) {
  const ov = document.getElementById('mp-lobby');
  ov.classList.remove('hidden');
  document.getElementById('start').classList.add('hidden');
  if (text) document.getElementById('mp-lobby-list').innerHTML = `<p class="hint">${text}</p>`;
}

function netRenderLobby() {
  const l = NET.lobby;
  if (!l) return;
  netShowLobby();
  document.getElementById('mp-lobby-map').innerHTML =
    `🗺️ Karte dieser Runde: <b>${l.mapName || l.mapId}</b> · Runde startet bei <b>${l.needed} Spielern</b> oder wenn alle bereit sind`;
  const me = l.players.find(p => p.nation === NET.you);
  document.getElementById('mp-lobby-list').innerHTML = l.players.map(p => `
    <div class="mp-row ${p.nation === NET.you ? 'me' : ''}">
      <span class="chip" style="background:${NATION_DEFS[p.nation] ? NATION_DEFS[p.nation].color : '#888'}"></span>
      <b>${p.name}</b>${p.nation === NET.you ? ' (du)' : ''}
      <span class="mp-ready">${p.ready ? '✔ bereit' : '… wartet'}</span>
    </div>`).join('')
    + `<p class="small hint">${l.players.length}/${l.needed} Spieler — freie Plätze werden beim Start mit Bots gefüllt.</p>`;
  const btn = document.getElementById('mp-ready');
  btn.textContent = me && me.ready ? '✔ Bereit (warte auf andere)' : '▶ Bereit — los geht\'s!';
  btn.dataset.ready = me && me.ready ? '1' : '0';
}

/* ---------- Runde starten (alle Clients identisch) ---------- */
function netStartGame(msg) {
  NET.state = 'game';
  NET.active = true;
  NET.steps = [];
  NET.nextTick = 0;
  document.getElementById('mp-lobby').classList.add('hidden');

  window.game = new Game(msg.you, msg.seed, msg.mapId, msg.humans);
  game._net = NET;
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
  pushToast(`🌐 Runde läuft! Du bist ${game.nationName(msg.you)} — wähle deinen Startplatz.`);

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

/* ---------- Kommandos zum Server ---------- */
NET.sendCmd = function (cmd, args) {
  if (!NET.ws || NET.ws.readyState !== 1) return null;
  NET.ws.send(JSON.stringify({ t: 'cmd', cmd, args }));
  return 'sent';   // UI: Befehl ist unterwegs (Ausführung kommt im nächsten Step)
};

/* ---------- Verkabelung (Startbildschirm & Lobby-Buttons) ---------- */
window.addEventListener('DOMContentLoaded', () => {
  const btnMp = document.getElementById('btn-mp');
  if (btnMp) btnMp.addEventListener('click', () => netJoin());
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
});
