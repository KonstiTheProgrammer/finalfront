/* =========================================================
   FINAL FRONT — Multiplayer-Relay (Lockstep-Metronom)

   Der Server simuliert NICHTS: Er verwaltet die Lobby, stempelt
   Spieler-Kommandos mit der Nation des Absenders und sendet im
   festen Takt "Steps" an alle Clients. Jeder Client führt die
   identische deterministische Simulation aus — gleiche Saat +
   gleiche Kommandos = identischer Spielverlauf auf allen Geräten.

   Start:  node server/mpserver.js        (Port 8571)
   Öffentlich machen: tools/mpserver/start.sh (Cloudflare-Tunnel, gratis)
   ========================================================= */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8571;
const STEP_MS = +process.env.STEP_MS || 125;   // 8 Ticks/s = 2 Spieltage/s — feste MP-Geschwindigkeit
const SLOTS = ['A', 'B', 'C', 'D', 'E'];
const PLAYERS_TO_START = 5;          // volle Lobby startet sofort …
const MAPS = ['europa', 'mitteleuropa', 'westeuropa'];   // Map-Rotation
const MAP_NAMES = { europa: 'Europa', mitteleuropa: 'Mitteleuropa', westeuropa: 'Westeuropa' };
const SPAWN_SECONDS = +process.env.SPAWN_SECONDS || 20;   // Startplatz-Wahl
const MAX_TICKS = 4000;              // Sicherheitsnetz: ~16 min, Runde ist längst vorbei

let mapIdx = 0;
let roundSeq = 1;

/* ---------- Lobby ---------- */
let lobby = null;
function newLobby() {
  lobby = {
    mapId: MAPS[mapIdx % MAPS.length],
    players: new Map(),   // ws -> {nation, name, ready}
  };
}
newLobby();

const rounds = new Set();   // laufende Runden

function lobbyState() {
  return {
    t: 'lobby',
    mapId: lobby.mapId,
    mapName: MAP_NAMES[lobby.mapId] || lobby.mapId,
    needed: PLAYERS_TO_START,
    players: [...lobby.players.values()].map(p => ({ nation: p.nation, name: p.name, ready: p.ready })),
    rounds: rounds.size,
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastLobby() {
  for (const [ws, p] of lobby.players) send(ws, { ...lobbyState(), you: p.nation });
}

function freeSlot() {
  const taken = new Set([...lobby.players.values()].map(p => p.nation));
  return SLOTS.find(s => !taken.has(s)) || null;
}

/* ---------- Runde ---------- */
function startRound() {
  const round = {
    id: roundSeq++,
    mapId: lobby.mapId,
    seed: (Math.random() * 0x7fffffff) | 0,
    players: new Map(lobby.players),   // ws -> {nation, name}
    queue: [],                         // gestempelte Kommandos fürs nächste Step
    tick: 0,
    spawnEndsAt: Date.now() + SPAWN_SECONDS * 1000,
    readyVotes: new Set(),
    interval: null,
  };
  rounds.add(round);
  const humans = [...round.players.values()].map(p => p.nation);
  const names = {};
  for (const p of round.players.values()) names[p.nation] = p.name;
  console.log(`[Runde ${round.id}] Start: ${round.mapId}, Seed ${round.seed}, Spieler: ${humans.join(',')}`);

  for (const [ws, p] of round.players) {
    ws._round = round;
    ws._lobby = false;
    send(ws, {
      t: 'start',
      seed: round.seed,
      mapId: round.mapId,
      humans,
      names,
      you: p.nation,
      spawnSeconds: SPAWN_SECONDS,
      stepMs: STEP_MS,
    });
  }

  // Map-Rotation: die NÄCHSTE Lobby bekommt die nächste Karte
  mapIdx++;
  newLobby();

  round.interval = setInterval(() => stepRound(round), STEP_MS);
}

function stepRound(round) {
  const cmds = round.queue;
  round.queue = [];
  const spawnPhase = round.spawnEndsAt !== null;

  if (spawnPhase) {
    const allReady = round.players.size > 0
      && [...round.players.values()].every(p => round.readyVotes.has(p.nation));
    if (Date.now() >= round.spawnEndsAt || allReady) {
      round.spawnEndsAt = null;
      cmds.push({ n: null, cmd: 'startMatch', args: [] });   // für ALLE im selben Step
      broadcast(round, { t: 'step', k: -1, cmds });
      return;
    }
    broadcast(round, { t: 'step', k: -1, cmds });
    return;
  }

  broadcast(round, { t: 'step', k: round.tick++, cmds });

  if (round.tick >= MAX_TICKS || round.players.size === 0) endRound(round);
}

function broadcast(round, msg) {
  const s = JSON.stringify(msg);
  for (const ws of round.players.keys()) if (ws.readyState === 1) ws.send(s);
}

function endRound(round) {
  clearInterval(round.interval);
  rounds.delete(round);
  for (const ws of round.players.keys()) ws._round = null;
  round.players.clear();
  console.log(`[Runde ${round.id}] beendet (Tick ${round.tick})`);
}

function leaveRound(ws) {
  const round = ws._round;
  if (!round) return;
  const p = round.players.get(ws);
  round.players.delete(ws);
  ws._round = null;
  if (p) {
    // Die KI übernimmt — deterministisch bei allen verbleibenden Clients
    round.queue.push({ n: null, cmd: 'aiTakeover', args: [p.nation] });
    console.log(`[Runde ${round.id}] ${p.nation} (${p.name}) raus — KI übernimmt`);
  }
  if (round.players.size === 0) endRound(round);
}

/* ---------- HTTP (Health) + WebSocket ---------- */
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({
    ok: true, game: 'finalfront',
    lobby: { map: lobby.mapId, players: lobby.players.size, needed: PLAYERS_TO_START },
    rounds: rounds.size,
  }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws._name = 'Spieler';
  ws._round = null;
  ws._lobby = false;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      ws._name = String(msg.name || 'Spieler').slice(0, 20) || 'Spieler';
      send(ws, { t: 'hi', ...lobbyState() });

    } else if (msg.t === 'join') {
      if (ws._round || ws._lobby) return;
      const slot = freeSlot();
      if (!slot) { send(ws, { t: 'err', msg: 'Lobby voll — gleich startet die Runde, versuch es danach.' }); return; }
      ws._lobby = true;
      lobby.players.set(ws, { nation: slot, name: ws._name, ready: false });
      broadcastLobby();
      if (lobby.players.size >= PLAYERS_TO_START) startRound();

    } else if (msg.t === 'ready') {
      if (ws._lobby && lobby.players.has(ws)) {
        lobby.players.get(ws).ready = !!msg.v;
        const all = lobby.players.size >= 1 && [...lobby.players.values()].every(p => p.ready);
        if (all) startRound();
        else broadcastLobby();
      }

    } else if (msg.t === 'leave') {
      if (ws._lobby) { lobby.players.delete(ws); ws._lobby = false; broadcastLobby(); }
      leaveRound(ws);

    } else if (msg.t === 'ping') {
      send(ws, { t: 'pong', ts: msg.ts });

    } else if (msg.t === 'chat') {
      // Chat ist reine Anzeige (kein Sim-Kommando) — leichtes Rate-Limit
      const now = Date.now();
      if (now - (ws._lastChat || 0) < 400) return;
      ws._lastChat = now;
      const text = String(msg.msg || '').slice(0, 160).trim();
      if (!text) return;
      const sender = ws._round ? ws._round.players.get(ws) : lobby.players.get(ws);
      const out = { t: 'chat', name: ws._name, n: sender ? sender.nation : null, msg: text };
      if (ws._round) broadcast(ws._round, out);
      else if (ws._lobby) for (const w2 of lobby.players.keys()) send(w2, out);

    } else if (msg.t === 'cmd') {
      const round = ws._round;
      if (!round || typeof msg.cmd !== 'string') return;
      const p = round.players.get(ws);
      if (!p) return;
      if (msg.cmd === 'startMatch') {
        // "Bereit"-Stimme in der Startphase — das echte startMatch sendet der Server
        round.readyVotes.add(p.nation);
        return;
      }
      if (msg.cmd === 'aiTakeover') return;   // nur der Server darf das
      // Anti-Spoofing: der Server stempelt die Nation des Absenders
      round.queue.push({ n: p.nation, cmd: msg.cmd, args: Array.isArray(msg.args) ? msg.args : [] });
    }
  });

  ws.on('close', () => {
    if (ws._lobby) { lobby.players.delete(ws); ws._lobby = false; broadcastLobby(); }
    leaveRound(ws);
  });
});

// tote Verbindungen aufräumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Final Front MP-Server läuft auf Port ${PORT} — Rotation: ${MAPS.join(' → ')}`);
});
