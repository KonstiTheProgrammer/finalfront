/* =========================================================
   FINAL FRONT — Multiplayer-Integrationstest
   Server + headless Lockstep-Clients: Lobby → Start, identische
   Simulation, Chat, Map-Rotation, Duell-Queue, KI-Übernahme.
   Ausführen:  node tests/mp.test.js
   ========================================================= */
const { spawn } = require('child_process');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', 'ws'));

const PORT = 8599;
const results = [];
const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

function makeSimContext() {
  const FixedDate = new Proxy(Date, { get: (t, k) => (k === 'now' ? () => 987654321 : t[k]) });
  const ctx = {
    performance: { now: () => 987654 },
    console, Math, Date: FixedDate, JSON,
    localStorage: { setItem() {}, getItem() { return null; } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['mapdata.js', 'map.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('window.__api = { mkGame: (p, s, m, h, sl) => new Game(p, s, m, h, sl), neighborsOf };', ctx);
  return ctx;
}

function makeClient(name, mode) {
  const ctx = makeSimContext();
  const c = {
    name, ctx, game: null, you: null,
    ticks: 0, snapshots: {}, chats: [],
    ws: new WebSocket(`ws://localhost:${PORT}`),
  };
  c.send = m => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
  c.ws.on('open', () => {
    c.send({ t: 'hello', name });
    c.send({ t: 'join', mode: mode || 'ffa' });
  });
  c.ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.t === 'chat') c.chats.push(msg);
    if (msg.t === 'lobby' || msg.t === 'hi') {
      if (msg.you) c.you = msg.you;
    } else if (msg.t === 'start') {
      c.you = msg.you;
      c.startMsg = msg;
      c.game = ctx.__api.mkGame(msg.you, msg.seed, msg.mapId, msg.humans, msg.slots || 5);
    } else if (msg.t === 'step') {
      const g = c.game;
      if (!g) return;
      for (const cmd of (msg.cmds || [])) g.applyNetCmd(cmd.n, cmd.cmd, cmd.args);
      if (msg.k >= 0 && !g.over) {
        g.runTick();
        c.ticks++;
        if (c.ticks === 200 || c.ticks === 500) {
          const o = JSON.parse(g.serialize());
          delete o.player;   // einziges legitim client-eigenes Feld
          c.snapshots[c.ticks] = JSON.stringify(o);
        }
        c.onTick && c.onTick(c.ticks);
      }
    }
  });
  return c;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fn()) return true;
    await sleep(30);
  }
  throw new Error('Timeout: ' + what);
}

(async () => {
  const srv = spawn('node', [path.join(ROOT, 'server', 'mpserver.js')], {
    env: { ...process.env, PORT: String(PORT), STEP_MS: '4', SPAWN_SECONDS: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; });
  srv.stderr.on('data', d => { srvLog += d; });
  try {
    await waitFor(() => srvLog.includes('läuft auf Port'), 5000, 'Serverstart');

    const health = await (await fetch(`http://localhost:${PORT}`)).json();
    ok('Health-Endpoint (beide Queues)', health.ok === true && !!health.duel);
    const firstMap = health.lobby.map;

    const c1 = makeClient('Tick');
    const c2 = makeClient('Trick');
    await waitFor(() => c1.you && c2.you, 5000, 'Lobby-Join');
    ok('Lobby: zwei Spieler, zwei Slots', c1.you !== c2.you);

    c1.send({ t: 'ready', v: true });
    c2.send({ t: 'ready', v: true });
    await waitFor(() => c1.game && c2.game, 5000, 'Rundenstart');
    ok('Runde startet per Ready-Vote', c1.startMsg.seed === c2.startMsg.seed);
    ok('Namen im Start-Paket', c1.startMsg.names && c1.startMsg.names[c2.you] === 'Trick');
    ok('Menschen menschlich, Rest KI', !c1.game.nations[c2.you].ai
      && c1.game.nations[['A', 'B', 'C', 'D', 'E'].find(x => !c1.startMsg.humans.includes(x))].ai === true);

    await sleep(100);
    let ziel = null;
    for (const row of c1.game.hexes) { for (const h of row) {
      if (h.terrain !== 'water' && h.terrain !== 'mountain' && !h.owner) { ziel = h; break; }
    } if (ziel) break; }
    c1.send({ t: 'cmd', cmd: 'spawn', args: [ziel.c, ziel.r] });
    await waitFor(() => !c1.game.spawnPhase && !c2.game.spawnPhase, 6000, 'Spawn-Ende');
    ok('Spawn-Verlegung bei BEIDEN', c1.game.hexAt(ziel.c, ziel.r).owner === c1.you
      && c2.game.hexAt(ziel.c, ziel.r).owner === c1.you);

    c1.onTick = t => {
      if (t === 40) {
        const cap = c1.game.nations[c1.you].capital;
        c1.send({ t: 'cmd', cmd: 'trainAt', args: [cap[0], cap[1], 'inf'] });
      }
    };
    c2.onTick = t => {
      if (t === 60) {
        const d = c2.game.divisionsOf(c2.you)[0];
        if (d) {
          for (const [nc, nr] of c2.ctx.__api.neighborsOf(d.c, d.r)) {
            const h = c2.game.hexAt(nc, nr);
            if (h && h.terrain !== 'water' && !h.owner) {
              c2.send({ t: 'cmd', cmd: 'move', args: [d.id, nc, nr, false] });
              break;
            }
          }
        }
      }
    };

    await waitFor(() => c1.ticks >= 510 && c2.ticks >= 510, 40000, '500 Ticks');
    ok('Lockstep identisch (Tick 200)', !!c1.snapshots[200] && c1.snapshots[200] === c2.snapshots[200]);
    ok('Lockstep identisch (Tick 500)', !!c1.snapshots[500] && c1.snapshots[500] === c2.snapshots[500]);
    ok('Kommandos wirken', c1.game.divisionsOf(c1.you).length >= 2
      || c1.game.training.some(q => q.nation === c1.you));

    c1.send({ t: 'chat', msg: 'gl hf!' });
    await waitFor(() => c2.chats.length >= 1, 4000, 'Chat');
    ok('Chat erreicht beide (gestempelt)', c2.chats[0].msg === 'gl hf!' && c2.chats[0].n === c1.you);

    const health2 = await (await fetch(`http://localhost:${PORT}`)).json();
    ok('Map-Rotation der Folge-Lobby', health2.lobby.map !== firstMap, firstMap + ' -> ' + health2.lobby.map);

    // 1v1-Duell-Queue
    const d1 = makeClient('Dora', 'duel');
    const d2 = makeClient('Duke', 'duel');
    await waitFor(() => d1.game && d2.game, 8000, 'Duell-Start');
    ok('Duell startet bei 2 Spielern', d1.startMsg.mapId === 'duell' && d1.startMsg.slots === 2);
    ok('Duell: 2 Nationen, Siegbedarf 2', Object.keys(d1.game.nations).length === 2 && d1.game.vpNeed === 2);
    await waitFor(() => d1.ticks >= 210 && d2.ticks >= 210, 20000, 'Duell 200 Ticks');
    ok('Duell-Lockstep identisch', !!d1.snapshots[200] && d1.snapshots[200] === d2.snapshots[200]);
    d1.ws.close(); d2.ws.close();

    // Disconnect → KI übernimmt
    const c2N = c2.you;
    c2.ws.close();
    await waitFor(() => c1.game.nations[c2N].ai === true, 5000, 'KI-Übernahme');
    ok('Disconnect → KI übernimmt', c1.game.nations[c2N].ai === true);

    c1.ws.close();
  } catch (e) {
    results.push('FAIL Ablauf — ' + e.message);
  } finally {
    srv.kill();
  }
  console.log(results.join('\n'));
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
