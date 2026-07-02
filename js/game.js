/* =========================================================
   FINAL FRONT — game.js
   Free-for-All-Simulation: leere Karte, Expansion in
   neutrales Land, Allianzen statt Diplomatie, Fronten,
   Kampf, Moral, Versorgung, KI.
   ========================================================= */

/* ---------- Balance-Konstanten ---------- */
const BAL = {
  // Spielgeschwindigkeit: deutlich entschleunigt, damit man reagieren kann
  daysPerSec: [0, 0.5, 1, 2.5, 6],
  // Wirtschaftskette (pro Tag):
  //   Dorf → Leute · Stadt → Leute + Gold · Mine/Hafen → Gold
  //   Kaserne bildet Leute zu Soldaten aus · Divisionen kosten Gold + Soldaten
  baseIncome: 2.5,                    // Staatskasse (Grundeinkommen)
  incomeStadt: 4.0,
  incomeMine: 6.0,
  incomeMineBerg: 8.0,
  landIncomePerHex: 0.008,            // Territorium zahlt Steuern
  leuteDorf: 0.10,                    // Dorf: nur Leute
  leuteStadt: 0.20,                   // Stadt: Leute UND Gold
  trainPerKaserne: 0.25,              // Ausbildung: Leute → Soldaten pro Kaserne
  // Baukosten
  cost: { strasse: 25, dorf: 60, mine: 120, kaserne: 150, hafen: 180, stadt: 250 },
  // Seehandel
  trade: {
    shipEveryDays: 4,        // jeder Hafen schickt alle N Tage ein Schiff
    baseGold: 10,
    goldPerDist: 0.7,        // längere Routen = mehr Gewinn
    shipSpeed: 7,            // Hexes/Tag
    warCooldown: 25,         // Tage ohne Kampf, bis Handel wieder möglich
  },
  // Divisionstypen
  divTypes: {
    inf: { name: 'Infanterie', gold: 80,  mp: 10, upkeep: 0.5, atk: 1.0, defF: 1.2, maxOrg: 55, speed: 1.0, militia: 1.0 },
    gar: { name: 'Garde',      gold: 170, mp: 12, upkeep: 0.9, atk: 1.5, defF: 1.5, maxOrg: 70, speed: 1.0, militia: 1.0 },
    pz:  { name: 'Panzer',     gold: 240, mp: 6,  upkeep: 1.6, atk: 2.0, defF: 0.9, maxOrg: 45, speed: 1.8, militia: 1.3 },
    art: { name: 'Artillerie', gold: 150, mp: 5,  upkeep: 1.0, atk: 1.7, defF: 0.6, maxOrg: 40, speed: 0.8, militia: 2.0 },
  },
  maxStr: 100,
  reinforceRate: 3.0,
  reinforceMpCost: 0.1,
  orgRegen: 7.0,
  retreatOrg: 8,
  // Kampf (pro Tag)
  atkBase: 8.0,
  orgDmg: 0.9,
  strDmg: 0.22,
  militiaResist: 15,
  militiaResistStadt: 30,
  militiaResistHauptstadt: 45,
  militiaResistNeutral: 7,            // Neutralland fällt zügig, aber nicht sofort
  neutralDmgBonus: 1.6,
  neutralCounter: 0.5,
  militiaRegen: 2.0,
  militiaCounter: 0.25,
  seaAssaultMalus: 0.5,
  // Versorgung (3x-Karte: Distanzen sind größer)
  supplyHub: { capital: 1.0, stadt: 0.85, hafen: 0.7, kaserne: 0.6 },
  supplyDecay: 0.023,
  roadCostFactor: 0.5,
  seaMinSupply: 0.25,
  lowSupply: 0.2,
  attritionStr: 1.2,
  attritionMoral: 0.03,
  // Moral
  moralMin: 0.5, moralMax: 1.3,
  moralWin: 0.04, moralLoss: 0.06, moralRetreat: 0.05,
  moralBaselinePull: 0.03,
  // Bewegung (Hexes/Tag)
  moveSpeed: 4.0,
  // Flüsse: Übergänge sind langsam und gefährlich — Straßen überbrücken sie
  river: { moveFactor: 1.6, attackFrom: 0.6, attackInto: 0.85 },
  // Verrat: Ex-Verbündeten schnell angreifen macht dich öffentlich zum Verräter
  traitor: { window: 25, duration: 60 },
  // Politik
  maxAllies: 2,
  offerLifetime: 40,
  // Balance / Fairness (Multiplayer-tauglich)
  graceDays: 30,              // Schonfrist: so lange keine Angriffe auf Nationen
  catchupMax: 0.35,           // Einkommensbonus kleiner Nationen (bis +35 %)
  leaderMalus: 0.25,          // Einkommensmalus des Spitzenreiters (bis -25 %)
  smallNationDefense: 1.5,    // Miliz-Bonus für Nationen unter 30 Provinzen
  // Rundenmodus & Sieg über Hauptstädte
  round: {
    days: 1000,               // Rundenlänge in Spieltagen (≈ 17–33 min je nach Tempo)
    vpToWin: 4,               // gehaltene Hauptstädte starten den Sieg-Countdown
    countdownDays: 50,        // Länge des Countdowns — Zeit für die Gegenkoalition
    lateStart: 0.7,           // ab 70 % der Runde: Endphase (Miliz ermüdet, Aufholbonus schwindet)
  },
};

/* Fester Simulationstakt: alle Maschinen rechnen identische Schritte —
   Grundlage für Determinismus, Replays und späteres Lockstep-Multiplayer. */
const TICK_DAYS = 0.25;   // Spieltage pro Tick (0.25 ist binär exakt — kein Drift)

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function dateStr(day) {
  const d = new Date(1936, 0, 1 + day);
  return `${d.getDate()}. ${MONTHS_DE[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------- Spielzustand ---------- */
class Game {
  constructor(playerNationId, seed) {
    // Geseedeter Zufall (mulberry32) mit serialisierbarem Zustand:
    // gleiche Saat + gleiche Kommandos = identischer Spielverlauf.
    this.seed = (seed === undefined ? (Date.now() & 0x7fffffff) : seed) >>> 0;
    this._rngState = this.seed;
    this.tickCount = 0;
    this._acc = 0;
    this.cmdLog = [];              // alle Spieler-Kommandos {t, cmd, args}
    this._replayCmds = null;       // im Replay: abzuspielende Kommandos
    this._replayIdx = 0;
    this._replayCapable = true;

    this.hexes = buildMap();
    this.day = 0;
    this.dayFloat = 0;
    this.speed = 1;
    this.paused = false;
    this.player = playerNationId;
    this.divisions = [];
    this.nations = {};
    this.log = [];
    this.toasts = [];
    this.effects = [];
    this.ships = [];                // Handelsschiffe unterwegs
    this.warHeat = {};              // 'A|B' -> Tag des letzten Kampfs
    this._seaRoutes = new Map();    // Cache für Seewege
    this.allianceOffers = [];       // {from, day} — Angebote an den Spieler
    this._offersChanged = false;
    this.over = null;
    this._divSeq = 1;
    this._armySeq = 1;
    this._lastAutosave = performance.now();
    this._supplyDirtyIds = new Set();
    this._frontsDirtyIds = new Set();
    this._damagedHexes = new Set();    // Hexes mit angeschlagener Miliz (für militiaDaily)
    this._ports = [];                  // Cache: alle Hafen-Hexes (recalcEconomy)
    this._kasernen = [];               // Cache: alle Kasernen-Hexes (recalcEconomy)
    this._borderCache = null;          // Cache: borderNationsOf pro Tag
    this._hasDead = false;
    this._pockets = [];                // erkannte Kessel (für Anzeige & Meldungen)
    this._pocketKeys = new Set();
    this._exAllies = {};               // 'Initiator>Opfer' -> Tag der Bündnisauflösung
    this.mapDirty = true;
    this.dirtyRect = null;
    this.labelsDirty = true;
    this.totalLand = 0;
    for (const row of this.hexes) for (const h of row) {
      if (h.terrain !== 'water') {
        this.totalLand++;
        this.setResist(h);          // Neutral-Miliz überall
      }
    }

    for (const [id, def] of Object.entries(NATION_DEFS)) this.initNation(id, def);

    // Siegpunkt-Hauptstädte: die 15 Original-Hauptstädte bleiben dauerhaft
    // markiert — wer BAL.round.vpToWin davon hält, startet den Sieg-Countdown.
    this.vpHexes = [];
    this.vpLeader = null;
    this.vpDeadline = 0;
    for (const [id, nat] of Object.entries(this.nations)) {
      if (!nat.capital) continue;
      const h = this.hexAt(...nat.capital);
      h.vp = true;
      this.vpHexes.push({ id, c: h.c, r: h.r, name: h.cityName });
    }
    this.vpRecount();

    this.recalcEconomy();
    this.recalcAllSupply();
    this.updateFronts();
    this.addLog(`🌍 Europa liegt brach, ${dateStr(0)}. Du führst ${this.nationName(playerNationId)} — breite dich aus!`, true);
    if (BAL.graceDays > 0)
      this.addLog(`⏳ Schonfrist: ${BAL.graceDays} Tage lang nur Expansion ins Neutralland — danach ist jeder angreifbar!`, true);
  }

  /* ---------- Hilfen ---------- */
  hexAt(c, r) { return (this.hexes[r] && this.hexes[r][c]) || null; }
  nationName(id) { return NATION_DEFS[id] ? NATION_DEFS[id].name : '???'; }
  nationColor(id) { return NATION_DEFS[id] ? NATION_DEFS[id].color : '#999'; }

  /* Geseedeter Zufall (mulberry32) mit explizitem Zustand — serialisierbar,
     damit Save/Load und Replays den identischen Zufallsstrom fortsetzen. */
  rand() {
    let a = this._rngState = (this._rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  addLog(msg, important) {
    this.log.push({ day: this.day, msg, important: !!important, t: performance.now() });
    if (this.log.length > 250) this.log.shift();
    if (important) this.toasts.push(msg);
  }

  ownedHexes(id) {
    const out = [];
    for (const row of this.hexes) for (const h of row) if (h.owner === id) out.push(h);
    return out;
  }

  divisionsOf(id) { return this.divisions.filter(d => d.nation === id && !d.dead); }

  divisionAt(c, r) {
    if (this._divIndex) {
      const arr = this._divIndex.get(c + r * MAP_W);
      if (arr) for (const d of arr) if (!d.dead) return d;
      return null;
    }
    return this.divisions.find(d => !d.dead && d.c === c && d.r === r) || null;
  }

  _rebuildDivIndex() {
    this._divIndex = new Map();
    for (const d of this.divisions) {
      if (d.dead) continue;
      const k = d.c + d.r * MAP_W;
      const arr = this._divIndex.get(k);
      if (arr) arr.push(d); else this._divIndex.set(k, [d]);
    }
  }

  _placeDiv(div, c, r) {
    if (this._divIndex) {
      const oldK = div.c + div.r * MAP_W;
      const arr = this._divIndex.get(oldK);
      if (arr) {
        const i = arr.indexOf(div);
        if (i >= 0) arr.splice(i, 1);
      }
      const newK = c + r * MAP_W;
      const na = this._divIndex.get(newK);
      if (na) na.push(div); else this._divIndex.set(newK, [div]);
    }
    div.c = c; div.r = r;
  }

  /* ---------- Politik: Allianzen statt Kriegserklärungen ---------- */
  allied(a, b) { return this.nations[a] && this.nations[a].allies.has(b); }

  hostile(a, b) {
    if (a === b || !a || !b) return false;
    if (!this.nations[a].alive || !this.nations[b].alive) return false;
    return !this.allied(a, b);
  }

  isCoastal(h) {
    for (const [nc, nr] of neighborsOf(h.c, h.r)) {
      const nh = this.hexAt(nc, nr);
      if (nh && nh.terrain === 'water') return true;
    }
    return false;
  }

  /* Handel möglich? Verbündete immer, sonst nur ohne frische Kämpfe */
  tradePartners(a, b) {
    if (a === b || !this.nations[a] || !this.nations[b]) return false;
    if (!this.nations[a].alive || !this.nations[b].alive) return false;
    if (this.isTraitor(a) || this.isTraitor(b)) return false;   // Verräter sind vom Handel ausgeschlossen
    if (this.allied(a, b)) return true;
    const heat = this.warHeat[[a, b].sort().join('|')];
    return heat === undefined || this.day - heat > BAL.trade.warCooldown;
  }

  /* Darf 'nation' das Hex angreifen? (Neutral: immer; Nationen erst nach der Schonfrist) */
  attackable(nation, h) {
    if (!h || h.terrain === 'water') return false;
    if (h.owner === null) return true;
    if (this.day < BAL.graceDays) return false;   // Schonfrist: nur Expansion
    return this.hostile(nation, h.owner);
  }

  offerAlliance(a, b) {
    if (a === b || !this.nations[a].alive || !this.nations[b].alive) return 'ungültig';
    if (this.allied(a, b)) return 'Bereits verbündet';
    if (this.nations[a].allies.size >= BAL.maxAllies) return `Max. ${BAL.maxAllies} Allianzen`;
    if (this.nations[b].allies.size >= BAL.maxAllies) return `${this.nationName(b)} hat keine freien Bündnisplätze`;
    if (b === this.player) {
      if (!this.allianceOffers.find(o => o.from === a)) {
        this.allianceOffers.push({ from: a, day: this.day });
        this._offersChanged = true;
        this.addLog(`🤝 ${this.nationName(a)} bietet dir eine Allianz an!`, true);
      }
      return true;
    }
    // KI entscheidet sofort
    if (this.allianceDecide(a, b)) {
      this.formAlliance(a, b);
      return true;
    }
    return `${this.nationName(b)} lehnt ab`;
  }

  allianceDecide(from, to) {
    const nTo = this.nations[to];
    if (this.isTraitor(from)) return false;   // mit Verrätern verbündet sich niemand
    if (nTo.allies.size >= BAL.maxAllies) return false;
    if (this.nationPower(from) < this.nationPower(to) * 0.35) return false;
    // Nicht mit dem eigenen Angriffsziel verbünden
    for (const army of nTo.armies) if (army.target === from && army.mode === 'attack') return false;
    return this.rand() < 0.7;
  }

  formAlliance(a, b) {
    this.nations[a].allies.add(b);
    this.nations[b].allies.add(a);
    this.addLog(`🤝 Allianz geschlossen: ${this.nationName(a)} & ${this.nationName(b)}!`, a === this.player || b === this.player);
    this.frontsDirty = true;
  }

  dissolveAlliance(a, b, initiator) {
    if (!this.allied(a, b)) return;
    this.nations[a].allies.delete(b);
    this.nations[b].allies.delete(a);
    // Wer aktiv auflöst und den Ex-Verbündeten bald angreift, wird Verräter
    if (initiator) this._exAllies[initiator + '>' + (initiator === a ? b : a)] = this.day;
    this.addLog(`💔 Die Allianz zwischen ${this.nationName(a)} und ${this.nationName(b)} ist zerbrochen.`, a === this.player || b === this.player);
    this.frontsDirty = true;
  }

  isTraitor(id) {
    return !!this.nations[id] && this.nations[id].traitorUntil > this.day;
  }

  _checkBetrayal(attacker, victim) {
    if (!victim || attacker === victim || !this.nations[attacker]) return;
    const rec = this._exAllies[attacker + '>' + victim];
    if (rec === undefined || this.day - rec > BAL.traitor.window) return;
    if (this.isTraitor(attacker)) return;
    this.nations[attacker].traitorUntil = this.day + BAL.traitor.duration;
    delete this._exAllies[attacker + '>' + victim];
    this.addLog(`🐍 ${this.nationName(attacker)} bricht den Bund und fällt ${this.nationName(victim)} in den Rücken — VERRÄTER! ${BAL.traitor.duration} Tage geächtet: kein Handel, keine Bündnisse, Freiwild für alle.`, true);
  }

  resolveOffer(from, accept) {
    this.allianceOffers = this.allianceOffers.filter(o => o.from !== from);
    this._offersChanged = true;
    if (accept && this.nations[from].alive && !this.allied(this.player, from)
      && this.nations[this.player].allies.size < BAL.maxAllies) {
      this.formAlliance(from, this.player);
    } else if (!accept) {
      this.addLog(`Du hast das Bündnisangebot von ${this.nationName(from)} abgelehnt.`);
    }
  }

  nationPower(id) {
    let p = 0;
    for (const d of this.divisionsOf(id)) p += (d.str / 100) * d.moral * BAL.divTypes[d.type].atk;
    return p + this.nations[id].incomePerDay * 0.15;
  }

  /* Angrenzende feindliche Nationen (für UI & KI) — pro Tag gecacht,
     das Panel fragt sonst alle 400 ms die ganze Karte ab */
  borderNationsOf(id) {
    if (this._borderCache && this._borderCache.day === this.day) {
      const hit = this._borderCache.map.get(id);
      if (hit) return hit;
    } else {
      this._borderCache = { day: this.day, map: new Map() };
    }
    const out = new Set();
    for (const row of this.hexes) for (const h of row) {
      if (h.owner !== id) continue;
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        const nh = this.hexAt(nc, nr);
        if (nh && nh.owner && nh.owner !== id && this.nations[nh.owner].alive) out.add(nh.owner);
      }
    }
    const arr = [...out];
    this._borderCache.map.set(id, arr);
    return arr;
  }

  /* ---------- Nation initialisieren (FFA: 1 Dorf, 2 Truppen) ---------- */
  nearestFreeLand(c, r) {
    let best = null, bd = Infinity;
    for (const row of this.hexes) for (const h of row) {
      if (h.terrain === 'water' || h.owner !== null) continue;
      if (h.terrain === 'mountain') continue;
      const d = hexDist(h.c, h.r, c, r);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  initNation(id, def) {
    const nat = {
      id,
      alive: true,
      gold: 200,
      leute: 20,        // Bevölkerungs-Pool (aus Dörfern/Städten)
      soldaten: 12,     // ausgebildete Soldaten (aus Kasernen) — Divisionen kosten Soldaten
      allies: new Set(),
      armies: [],
      ai: id !== this.player,
      aiTick: Math.floor(this.rand() * 6),
      capital: null,
      divNameSeq: 1,
      hexCount: 1,
      traitorUntil: -999,
      incomePerDay: 0, leutePerDay: 0, trainCap: 0,
      _lastAttacker: null, _lastAttackedDay: -99, _atkToastDay: -99,
    };
    this.nations[id] = nat;

    const spawn = this.nearestFreeLand(...def.spawnHex);
    if (!spawn) { nat.alive = false; return; }
    spawn.owner = id;
    spawn.capital = true;
    spawn.building = 'dorf';
    spawn.cityName = def.capitalName;
    this.setResist(spawn);
    nat.capital = [spawn.c, spawn.r];

    const army = this.createArmy(id, '1. Armee');
    army.target = 'EXPAND';
    army.mode = 'attack';
    this.spawnDivision(id, 'inf', army, true);
    this.spawnDivision(id, 'inf', army, true);
  }

  setResist(h) {
    let base;
    if (!h.owner) base = BAL.militiaResistNeutral;
    else {
      if (h.capital) base = BAL.militiaResistHauptstadt;
      else if (h.building === 'stadt') base = BAL.militiaResistStadt;
      else base = BAL.militiaResist;
      // Heimatverteidigung: kleine Nationen sind zäher — schützt vor frühem Aus
      const nat = this.nations[h.owner];
      if (nat && nat.alive && nat.hexCount < 30) base *= BAL.smallNationDefense;
    }
    h.resistMax = base;
    if (h.resist <= 0 || h.resist > base) h.resist = base;
  }

  findBuildSpot(nation, cc, cr, pred, maxDist = 24, own = null) {
    let best = null, bestD = Infinity;
    for (const h of (own || this.ownedHexes(nation))) {
      if (h.owner !== nation || h.capital) continue;
      if (!pred(h)) continue;
      const d = hexDist(h.c, h.r, cc, cr) + this.rand() * 0.7;
      if (d < bestD && d <= maxDist) { bestD = d; best = h; }
    }
    return best;
  }

  markDirty(c, r) {
    this.mapDirty = true;
    if (this._dirtyAll) return;   // Voll-Neuzeichnung steht schon an
    if (!this.dirtyRect) this.dirtyRect = { c0: c, r0: r, c1: c, r1: r };
    else {
      const d = this.dirtyRect;
      d.c0 = Math.min(d.c0, c); d.r0 = Math.min(d.r0, r);
      d.c1 = Math.max(d.c1, c); d.r1 = Math.max(d.r1, r);
    }
  }
  markDirtyAll() { this.mapDirty = true; this._dirtyAll = true; this.dirtyRect = null; }

  /* ---------- Armeen & Divisionen ---------- */
  createArmy(nation, name) {
    const a = {
      id: this._armySeq++,
      nation,
      name: name || `${this.nations[nation].armies.length + 1}. Armee`,
      target: 'EXPAND',      // 'EXPAND' | 'ALL' | Nation-ID | 'RESERVE'
      mode: 'defend',
      frontHexes: [],
    };
    this.nations[nation].armies.push(a);
    return a;
  }

  spawnDivision(nation, type, army, free) {
    const nat = this.nations[nation];
    const t = BAL.divTypes[type];
    if (!t) return null;
    if (!free) {
      if (nat.gold < t.gold || nat.soldaten < t.mp) return null;
      nat.gold -= t.gold; nat.soldaten -= t.mp;
    }
    let spawn = null;
    const [cc, cr] = nat.capital || [0, 0];
    for (const h of this._kasernen) {
      if (h.owner !== nation || h.building !== 'kaserne') continue;
      if (!spawn || hexDist(h.c, h.r, cc, cr) < hexDist(spawn.c, spawn.r, cc, cr)) spawn = h;
    }
    if (!spawn) spawn = this.hexAt(cc, cr);
    if (!spawn || spawn.owner !== nation) {
      const own = this.ownedHexes(nation);
      if (!own.length) return null;
      spawn = own[0];
    }
    if (this.divisionAt(spawn.c, spawn.r)) {
      for (const [nc, nr] of neighborsOf(spawn.c, spawn.r)) {
        const h = this.hexAt(nc, nr);
        if (h && h.owner === nation && h.terrain !== 'water' && !this.divisionAt(nc, nr)) { spawn = h; break; }
      }
    }
    const div = {
      id: this._divSeq++,
      name: `${nat.divNameSeq++}. ${t.name}division`,
      nation, type,
      c: spawn.c, r: spawn.r,
      x: 0, y: 0,
      str: free ? 100 : 60,
      org: free ? t.maxOrg : t.maxOrg * 0.5,
      moral: 1.0,
      army: army ? army.id : null,
      station: null,
      path: null, pathI: 0, moveProgress: 0,
      queue: [],
      attackTarget: null,
      inCombat: false,
      // Spieler-Divisionen starten MANUELL: sie warten auf Befehle statt
      // automatisch zur Front zu laufen. Automatik nur auf Wunsch (Alt+Rechtsklick).
      manual: nation === this.player,
      dead: false,
    };
    const p = hexToPixel(spawn.c, spawn.r);
    div.x = p.x; div.y = p.y;
    this.divisions.push(div);
    if (this._divIndex) {
      const k = div.c + div.r * MAP_W;
      const arr = this._divIndex.get(k);
      if (arr) arr.push(div); else this._divIndex.set(k, [div]);
    }
    return div;
  }

  trainDivisions(nation, type, count, army) {
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (!this.spawnDivision(nation, type, army, false)) break;
      n++;
    }
    if (n > 0) { this._frontsDirtyIds.add(nation); this.economyDirty = true; }
    return n;
  }

  armyById(nation, id) { return this.nations[nation].armies.find(a => a.id === id) || null; }
  armyDivisions(army) { return this.divisions.filter(d => !d.dead && d.nation === army.nation && d.army === army.id); }

  disbandArmy(nation, armyId) {
    const nat = this.nations[nation];
    if (nat.armies.length <= 1) return false;
    const army = this.armyById(nation, armyId);
    if (!army) return false;
    const target = nat.armies.find(a => a.id !== armyId);
    for (const d of this.armyDivisions(army)) d.army = target.id;
    nat.armies = nat.armies.filter(a => a.id !== armyId);
    this._frontsDirtyIds.add(nation);
    return true;
  }

  disbandDivision(div) {
    div.dead = true;
    this._hasDead = true;
    this.nations[div.nation].soldaten += (div.str / 100) * BAL.divTypes[div.type].mp * 0.5;
    this.economyDirty = true;
  }

  /* Division teilen: zwei halbe Divisionen (S-Taste) */
  splitDivision(div) {
    if (div.dead || div.str < 40) return null;
    // freien Nachbarplatz suchen
    let spot = null;
    for (const [nc, nr] of neighborsOf(div.c, div.r)) {
      const h = this.hexAt(nc, nr);
      if (h && h.owner === div.nation && h.terrain !== 'water' && !this.divisionAt(nc, nr)) { spot = h; break; }
    }
    if (!spot) return null;
    const nat = this.nations[div.nation];
    const t = BAL.divTypes[div.type];
    const half = div.str / 2;
    div.str = half;
    const p = hexToPixel(spot.c, spot.r);
    const twin = {
      id: this._divSeq++,
      name: `${nat.divNameSeq++}. ${t.name}division`,
      nation: div.nation, type: div.type,
      c: spot.c, r: spot.r, x: p.x, y: p.y,
      str: half, org: div.org, moral: div.moral,
      army: div.army, station: null,
      path: null, pathI: 0, moveProgress: 0,
      queue: [],
      attackTarget: null, inCombat: false,
      manual: div.manual, dead: false,
    };
    this.divisions.push(twin);
    if (this._divIndex) {
      const k = twin.c + twin.r * MAP_W;
      const arr = this._divIndex.get(k);
      if (arr) arr.push(twin); else this._divIndex.set(k, [twin]);
    }
    this._frontsDirtyIds.add(div.nation);
    this.economyDirty = true;
    return twin;
  }

  /* Divisionen gleichen Typs vereinen (M-Taste) */
  mergeDivisions(divs) {
    const nat = divs.length ? this.nations[divs[0].nation] : null;
    let merged = 0;
    const byType = {};
    for (const d of divs) {
      if (d.dead) continue;
      (byType[d.type] = byType[d.type] || []).push(d);
    }
    for (const group of Object.values(byType)) {
      group.sort((a, b) => b.str - a.str);
      while (group.length >= 2) {
        const a = group[0];
        const b = group.pop();
        if (a === b) break;
        const sum = a.str + b.str;
        const overflow = Math.max(0, sum - BAL.maxStr);
        a.str = Math.min(BAL.maxStr, sum);
        a.org = Math.min(BAL.divTypes[a.type].maxOrg, (a.org * a.str + b.org * b.str) / Math.max(1, a.str + b.str) + 4);
        a.moral = Math.max(a.moral, b.moral);
        if (overflow > 0 && nat) nat.soldaten += overflow * BAL.reinforceMpCost;
        b.dead = true;
        merged++;
      }
    }
    if (merged) {
      this._hasDead = true;
      if (nat) this._frontsDirtyIds.add(nat.id);
      this.economyDirty = true;
    }
    return merged;
  }

  /* ---------- Bauen ---------- */
  canBuild(nation, h, what) {
    if (!h || h.owner !== nation) return 'Nicht dein Gebiet';
    const nat = this.nations[nation];
    const cost = BAL.cost[what];
    if (what === 'strasse') {
      if (h.terrain === 'water') return 'Nicht im Meer';
      if (h.road) return 'Bereits Straße';
    } else if (what === 'stadt') {
      if (h.building !== 'dorf') return 'Braucht ein Dorf (Ausbau)';
    } else if (what === 'mine') {
      if (h.terrain !== 'hills' && h.terrain !== 'mountain') return 'Nur auf Hügeln/Gebirge';
      if (h.building) return 'Feld belegt';
    } else if (what === 'hafen') {
      if (!TERRAIN[h.terrain].buildable) return TERRAIN[h.terrain].name + ' — nicht bebaubar';
      if (h.building) return 'Feld belegt';
      if (!this.isCoastal(h)) return 'Nur am Ufer (Küstenfeld)';
    } else {
      if (!TERRAIN[h.terrain].buildable) return TERRAIN[h.terrain].name + ' — nicht bebaubar';
      if (h.building) return 'Feld belegt';
    }
    if (nat.gold < cost) return `Zu wenig Gold (${cost})`;
    return true;
  }

  build(nation, h, what) {
    const ok = this.canBuild(nation, h, what);
    if (ok !== true) return ok;
    this.nations[nation].gold -= BAL.cost[what];
    if (what === 'strasse') h.road = true;
    else if (what === 'stadt') { h.building = 'stadt'; this.setResist(h); }
    else { h.building = what; this.setResist(h); }
    if (what === 'hafen') this._ports.push(h);
    else if (what === 'kaserne') this._kasernen.push(h);
    this._supplyDirtyIds.add(nation);
    this.economyDirty = true;
    this.markDirty(h.c, h.r);
    return true;
  }

  /* ---------- Wirtschaft (1 Kartenscan, gecacht) ---------- */
  recalcEconomy() {
    for (const nat of Object.values(this.nations)) {
      nat.incomePerDay = BAL.baseIncome;
      nat.leutePerDay = 0;
      nat.trainCap = 0;      // Ausbildungskapazität der Kasernen (Leute → Soldaten)
      nat.hexCount = 0;
      nat.ports = 0;
      nat.staedte = 0;
    }
    this._ports = [];
    this._kasernen = [];
    for (const row of this.hexes) for (const h of row) {
      if (!h.owner) continue;
      const nat = this.nations[h.owner];
      if (!nat) continue;
      nat.hexCount++;
      nat.incomePerDay += BAL.landIncomePerHex;
      if (h.building === 'dorf') nat.leutePerDay += BAL.leuteDorf;
      else if (h.building === 'stadt') { nat.incomePerDay += BAL.incomeStadt; nat.leutePerDay += BAL.leuteStadt; nat.staedte++; }
      else if (h.building === 'mine') nat.incomePerDay += h.terrain === 'mountain' ? BAL.incomeMineBerg : BAL.incomeMine;
      else if (h.building === 'hafen') { nat.ports++; this._ports.push(h); }
      else if (h.building === 'kaserne') { this._kasernen.push(h); nat.trainCap += BAL.trainPerKaserne; }
    }
    for (const d of this.divisions) {
      if (!d.dead) this.nations[d.nation].incomePerDay -= BAL.divTypes[d.type].upkeep;
    }
    this.economyDirty = false;
  }

  economyTick(dt) {
    // Aufholmechanik: kleine Nationen verdienen mehr, der Spitzenreiter weniger —
    // hält das Feld zusammen (Multiplayer-Fairness, bremst Snowballing)
    let sum = 0, cnt = 0;
    for (const nat of Object.values(this.nations)) if (nat.alive) { sum += nat.hexCount; cnt++; }
    const avg = Math.max(1, sum / Math.max(1, cnt));
    const lf = this.lateFactor();   // Endphase: Aufholbonus/Malus schwinden
    for (const nat of Object.values(this.nations)) {
      if (!nat.alive) continue;
      const rel = nat.hexCount / avg;
      let mult = 1;
      if (rel < 1) mult = 1 + Math.min(BAL.catchupMax, (1 - rel) * 0.5);
      else mult = 1 - Math.min(BAL.leaderMalus, (rel - 1) * 0.1);
      mult = 1 + (mult - 1) * (1 - lf);
      nat.econMult = nat.incomePerDay > 0 ? mult : 1;
      nat.gold = Math.max(0, nat.gold + nat.incomePerDay * nat.econMult * dt);
      nat.leute += nat.leutePerDay * dt;
      // Kasernen bilden aus: Leute → Soldaten (begrenzt durch Kapazität & Bevölkerung)
      const conv = Math.min(nat.trainCap * dt, nat.leute);
      if (conv > 0) { nat.leute -= conv; nat.soldaten += conv; }
    }
  }

  /* ---------- Versorgung ---------- */
  recalcSupply(id) {
    // Dijkstra ab den Versorgungs-Hubs (Max-Heap) statt bis zu 90 Sweeps
    // über alle eigenen Hexes — gleiches Ergebnis, Bruchteil der Arbeit.
    const own = this.ownedHexes(id);
    const heap = [];
    const hpush = (s, h) => {
      heap.push([s, h]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] >= heap[i][0]) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    };
    const hpop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, rr = l + 1; let m = i;
          if (l < heap.length && heap[l][0] > heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] > heap[m][0]) m = rr;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    };
    for (const h of own) {
      let hub = 0;
      if (h.capital) hub = BAL.supplyHub.capital;
      else if (h.building === 'stadt') hub = BAL.supplyHub.stadt;
      else if (h.building === 'hafen') hub = BAL.supplyHub.hafen;
      else if (h.building === 'kaserne') hub = BAL.supplyHub.kaserne;
      h.supply = hub;
      if (hub > 0) hpush(hub, h);
    }
    while (heap.length) {
      const [s, h] = hpop();
      if (s < h.supply - 1e-9) continue;   // veralteter Heap-Eintrag
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        const nh = this.hexAt(nc, nr);
        if (!nh || nh.owner !== id || nh.terrain === 'water') continue;
        const stepCost = TERRAIN[nh.terrain].move
          * (nh.road ? BAL.roadCostFactor : (nh.river ? BAL.river.moveFactor : 1)) * BAL.supplyDecay;
        const v = s - stepCost;
        if (v > nh.supply + 1e-4) { nh.supply = v; hpush(v, nh); }
      }
    }
    for (const h of own) {
      if (h.supply >= BAL.seaMinSupply || h.terrain === 'water') continue;
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        const nh = this.hexAt(nc, nr);
        if (nh && nh.terrain === 'water') { h.supply = BAL.seaMinSupply; break; }
      }
    }
  }

  recalcAllSupply() {
    for (const id of Object.keys(this.nations)) if (this.nations[id].alive) this.recalcSupply(id);
    this._supplyDirtyIds.clear();
  }

  supplyDaily() {
    // Gestaffelt: jede Nation alle 3 Tage + alle „dreckigen" sofort
    const ids = Object.keys(this.nations).filter(id => this.nations[id].alive);
    ids.forEach((id, i) => {
      if (this._supplyDirtyIds.has(id) || (this.day + i) % 3 === 0) this.recalcSupply(id);
    });
    this._supplyDirtyIds.clear();
  }

  supplyModOf(div) {
    const h = this.hexAt(div.c, div.r);
    let s;
    if (!h) s = 0;
    else if (h.terrain === 'water') s = 0.3;
    else s = h.owner === div.nation ? h.supply : h.supply * 0.5;
    return { mod: 0.35 + 0.65 * Math.min(1, s), level: s };
  }

  /* ---------- Wegfindung (A* mit Binär-Heap) ----------
     Wiederverwendbare Puffer mit Generationszähler statt Maps —
     spart pro Aufruf zwei Map-Allokationen über die ganze Karte. */
  findPath(nation, c1, r1, c2, r2, ownOnly) {
    if (!this._pfGen) {
      this._pfGen = new Int32Array(MAP_W * MAP_H);
      this._pfG = new Float64Array(MAP_W * MAP_H);
      this._pfCame = new Int32Array(MAP_W * MAP_H);
      this._pfGenId = 0;
    }
    const gen = ++this._pfGenId;
    const seen = this._pfGen, gScore = this._pfG, came = this._pfCame;
    const heap = [[0, 0, c1, r1]];
    const hpush = it => {
      heap.push(it);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    };
    const hpop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, rr = l + 1; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    };
    const startKey = c1 + r1 * MAP_W;
    seen[startKey] = gen; gScore[startKey] = 0; came[startKey] = -1;
    const targetKey = c2 + r2 * MAP_W;
    let found = null;
    let iter = 0;
    while (heap.length && iter++ < 14000) {
      const [f, g, c, r] = hpop();
      const key = c + r * MAP_W;
      if (key === targetKey) { found = key; break; }
      for (const [nc, nr] of neighborsOf(c, r)) {
        const nh = this.hexAt(nc, nr);
        if (!nh) continue;
        const isTarget = nc === c2 && nr === r2;
        let step;
        if (nh.terrain === 'water') {
          if (ownOnly) continue;
          step = TERRAIN.water.move;
        } else if (nh.owner === nation) {
          // Straße überbrückt den Fluss (Brücke), sonst bremst er
          step = TERRAIN[nh.terrain].move * (nh.road ? BAL.roadCostFactor : (nh.river ? BAL.river.moveFactor : 1));
        } else if (!ownOnly && nh.owner && this.allied(nation, nh.owner)) {
          step = TERRAIN[nh.terrain].move * (nh.river ? BAL.river.moveFactor : 1);   // Durchmarsch bei Verbündeten
        } else if (!ownOnly && (isTarget || this.attackable(nation, nh))) {
          step = TERRAIN[nh.terrain].move * (isTarget ? 1 : 1.6)
            * (nh.river ? BAL.river.moveFactor : 1);               // Feind-/Neutralland: kämpfend passierbar
        } else continue;
        const ng = g + step;
        const nKey = nc + nr * MAP_W;
        if (seen[nKey] !== gen || gScore[nKey] > ng) {
          seen[nKey] = gen;
          gScore[nKey] = ng;
          came[nKey] = key;
          hpush([ng + hexDist(nc, nr, c2, r2), ng, nc, nr]);
        }
      }
    }
    if (found === null) return null;
    const path = [];
    let cur = found;
    while (cur >= 0 && cur !== startKey) {
      path.unshift([cur % MAP_W, Math.floor(cur / MAP_W)]);
      cur = came[cur];
    }
    return path;
  }

  /* ---------- Fronten ---------- */
  frontMatches(army, nh) {
    if (!nh || nh.terrain === 'water') return false;
    if (army.target === 'EXPAND') return nh.owner === null;
    if (army.target === 'ALL') return nh.owner !== null && this.hostile(army.nation, nh.owner);
    return nh.owner === army.target && this.hostile(army.nation, army.target);
  }

  computeFront(army, ownList) {
    if (army.target === 'RESERVE') { army.frontHexes = []; return; }
    const own = ownList || this.ownedHexes(army.nation);
    const border = [];
    for (const h of own) {
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        if (this.frontMatches(army, this.hexAt(nc, nr))) { border.push(h); break; }
      }
    }
    if (border.length > 2) {
      const remain = new Map(border.map(h => [h.c + h.r * MAP_W, h]));
      let start = border[0], minN = Infinity;
      for (const h of border) {
        let n = 0;
        for (const [nc, nr] of neighborsOf(h.c, h.r)) if (remain.has(nc + nr * MAP_W)) n++;
        if (n < minN) { minN = n; start = h; }
      }
      const ordered = [start];
      remain.delete(start.c + start.r * MAP_W);
      while (remain.size) {
        const cur = ordered[ordered.length - 1];
        // Zusammenhängende Front: direkter Nachbar reicht (O(1) statt O(n))
        let best = null;
        for (const [nc, nr] of neighborsOf(cur.c, cur.r)) {
          const cand = remain.get(nc + nr * MAP_W);
          if (cand) { best = cand; break; }
        }
        if (!best) {   // Lücke in der Front: nächstgelegenes Resthex suchen
          let bestD = Infinity;
          for (const h of remain.values()) {
            const d = hexDist(cur.c, cur.r, h.c, h.r);
            if (d < bestD) { bestD = d; best = h; }
          }
        }
        ordered.push(best);
        remain.delete(best.c + best.r * MAP_W);
      }
      army.frontHexes = ordered;
    } else {
      army.frontHexes = border;
    }
  }

  distributeArmy(army) {
    const divs = this.armyDivisions(army).filter(d => !d.manual);
    const line = army.frontHexes;
    if (!divs.length) return;
    if (!line.length) {
      const [cc, cr] = this.nations[army.nation].capital || [0, 0];
      const spots = [[cc, cr]];
      const seen = new Set([cc + cr * MAP_W]);
      let frontier = [[cc, cr]];
      while (spots.length < divs.length + 2 && frontier.length) {
        const next = [];
        for (const [c, r] of frontier) for (const [nc, nr] of neighborsOf(c, r)) {
          const k = nc + nr * MAP_W;
          if (seen.has(k)) continue;
          seen.add(k);
          const h = this.hexAt(nc, nr);
          if (h && h.owner === army.nation && h.terrain !== 'water') {
            spots.push([nc, nr]); next.push([nc, nr]);
          }
        }
        frontier = next;
      }
      divs.forEach((d, i) => { d.station = spots[i % spots.length]; });
      return;
    }
    const idxOf = d => {
      let bi = 0, bd = Infinity;
      line.forEach((h, i) => {
        const dd = hexDist(d.c, d.r, h.c, h.r);
        if (dd < bd) { bd = dd; bi = i; }
      });
      return bi;
    };
    const sorted = divs.map(d => [idxOf(d), d]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const used = new Set();
    sorted.forEach((d, i) => {
      const idx = sorted.length === 1 ? Math.floor(line.length / 2)
        : Math.round(i * (line.length - 1) / (sorted.length - 1));
      let h = line[Math.min(idx, line.length - 1)];
      if (used.has(h.c + h.r * MAP_W)) {
        const free = this.findFreeStation(army.nation, h, used);
        if (free) h = free;
      }
      used.add(h.c + h.r * MAP_W);
      d.station = [h.c, h.r];
    });
  }

  findFreeStation(nation, start, used) {
    const seen = new Set([start.c + start.r * MAP_W]);
    let frontier = [start];
    for (let ring = 0; ring < 3; ring++) {
      const next = [];
      for (const f of frontier) for (const [nc, nr] of neighborsOf(f.c, f.r)) {
        const k = nc + nr * MAP_W;
        if (seen.has(k)) continue;
        seen.add(k);
        const h = this.hexAt(nc, nr);
        if (!h || h.owner !== nation || h.terrain === 'water') continue;
        if (!used.has(k)) return h;
        next.push(h);
      }
      frontier = next;
    }
    return null;
  }

  updateFrontsFor(id) {
    const nat = this.nations[id];
    if (!nat || !nat.alive) return;
    const own = this.ownedHexes(id);   // 1 Kartenscan für ALLE Armeen der Nation
    for (const a of nat.armies) {
      // Front nur für Armeen mit automatisch geführten Divisionen — sonst
      // erscheint eine sinnlose Linie, obwohl niemand ihr folgt
      const hasAuto = this.divisions.some(d => !d.dead && d.nation === id && d.army === a.id && !d.manual);
      if (!hasAuto) { a.frontHexes = []; continue; }
      this.computeFront(a, own);
      this.distributeArmy(a);
    }
  }

  updateFronts(onlyId) {
    if (onlyId) return this.updateFrontsFor(onlyId);
    for (const id of Object.keys(this.nations)) this.updateFrontsFor(id);
    this.frontsDirty = false;
    this._frontsDirtyIds.clear();
  }

  /* Täglich: Nationen gestaffelt aktualisieren statt alle auf einmal */
  frontsTick() {
    const ids = Object.keys(this.nations).filter(id => this.nations[id].alive);
    ids.forEach((id, i) => {
      if (this.frontsDirty || this._frontsDirtyIds.has(id) || (this.day + i) % 2 === 0)
        this.updateFrontsFor(id);
    });
    this.frontsDirty = false;
    this._frontsDirtyIds.clear();
  }

  /* ---------- Divisionen: Bewegung & Kampf ---------- */
  moveOrder(div, c, r, queue) {
    const h = this.hexAt(c, r);
    if (!h) return;
    div.manual = true;
    if (queue) {
      // Shift: Wegpunkt anhängen — wird abgearbeitet, sobald die Division frei ist
      if (div.path || div.attackTarget || (div.queue && div.queue.length)) {
        (div.queue = div.queue || []).push([c, r]);
        return;
      }
    } else {
      div.queue = [];              // neuer Befehl ersetzt die Warteschlange
      div.attackTarget = null;
    }
    const path = this.findPath(div.nation, div.c, div.r, c, r, false);
    if (path) { div.path = path; div.pathI = 0; div.moveProgress = 0; }
    else if (div.nation === this.player) {
      this.addLog(`⚠ ${div.name}: kein Weg dorthin (Invasionen brauchen ein Küstenfeld als Ziel).`);
    }
  }

  releaseToArmy(div) {
    div.manual = false;
    div.path = null;
    div.queue = [];
    this._frontsDirtyIds.add(div.nation);
  }

  divisionsTick(dt) {
    this._rebuildDivIndex();
    this._atkCount = new Map();
    for (const d of this.divisions) {
      if (d.dead || !d.attackTarget) continue;
      const k = d.attackTarget[0] + d.attackTarget[1] * MAP_W;
      this._atkCount.set(k, (this._atkCount.get(k) || 0) + 1);
    }

    for (const div of this.divisions) {
      if (div.dead) continue;
      div.inCombat = false;

      if (div.attackTarget) {
        const [tc, tr] = div.attackTarget;
        const th = this.hexAt(tc, tr);
        if (!th || th.owner === div.nation || !this.attackable(div.nation, th)
          || hexDist(div.c, div.r, tc, tr) > 1) {
          div.attackTarget = null;
        } else {
          this.resolveCombat(div, th, dt);
          continue;
        }
      }

      // Wegpunkt-Warteschlange: nächstes Ziel anpacken, sobald die Division frei ist
      if (!div.path && !div.attackTarget && div.queue && div.queue.length) {
        const [qc, qr] = div.queue.shift();
        if (qc !== div.c || qr !== div.r) {
          const p = this.findPath(div.nation, div.c, div.r, qc, qr, false);
          if (p && p.length) { div.path = p; div.pathI = 0; div.moveProgress = 0; }
          else if (div.nation === this.player) this.addLog(`⚠ ${div.name}: Wegpunkt nicht erreichbar — übersprungen.`);
        }
      }

      if (!div.path && div.station && !div.attackTarget) {
        if ((div.c !== div.station[0] || div.r !== div.station[1])
          && (!div._pathRetryAt || this.dayFloat >= div._pathRetryAt)) {
          const p = this.findPath(div.nation, div.c, div.r, div.station[0], div.station[1], false);
          if (p && p.length) { div.path = p; div.pathI = 0; div.moveProgress = 0; }
          else div._pathRetryAt = this.dayFloat + 2.5;   // unerreichbar: A*-Fehlversuche drosseln
        }
      }
      if (div.path && div.pathI < div.path.length) {
        const [nc, nr] = div.path[div.pathI];
        const nh = this.hexAt(nc, nr);
        if (!nh) { div.path = null; continue; }
        if (nh.owner !== div.nation && nh.terrain !== 'water' && !this.allied(div.nation, nh.owner)) {
          if (this.attackable(div.nation, nh)) div.attackTarget = [nc, nr];
          else div.path = null;
          continue;
        }
        const step = nh.terrain === 'water' ? TERRAIN.water.move
          : TERRAIN[nh.terrain].move * (nh.road && nh.owner === div.nation
            ? BAL.roadCostFactor : (nh.river ? BAL.river.moveFactor : 1));
        const t = BAL.divTypes[div.type];
        div.moveProgress += (BAL.moveSpeed * t.speed / step) * dt;
        if (div.moveProgress >= 1) {
          div.moveProgress = 0;
          const isFinal = div.pathI >= div.path.length - 1;
          const occupied = this.divisionAt(nc, nr);
          if (isFinal && occupied && occupied.id !== div.id) {
            div.path = null;
            if (div.manual) div.station = [div.c, div.r];
            else div._pathRetryAt = this.dayFloat + 1;   // Ziel besetzt: nicht jeden Tick neu pfaden
            continue;
          }
          this._placeDiv(div, nc, nr);
          div.pathI++;
          if (div.pathI >= div.path.length) { div.path = null; if (div.manual) div.station = [div.c, div.r]; }
        }
      }

      if (!div.path && !div.attackTarget) {
        const army = div.army != null ? this.armyById(div.nation, div.army) : null;
        const aggressive = army && army.mode === 'attack' && !div.manual;
        if (aggressive && div.org > BAL.divTypes[div.type].maxOrg * 0.45) {
          const sup = this.supplyModOf(div);
          if (sup.level > 0.15) {
            const target = this.pickAttackTarget(div, army);
            if (target) div.attackTarget = [target.c, target.r];
          }
        }
      }
    }
  }

  pickAttackTarget(div, army) {
    const myPow = this.attackPower(div);
    let best = null, bestScore = -Infinity;
    for (const [nc, nr] of neighborsOf(div.c, div.r)) {
      const nh = this.hexAt(nc, nr);
      if (!this.frontMatches(army, nh)) continue;
      const defDiv = this.divisionAt(nc, nr);
      let defense = nh.resist * 0.4;
      if (defDiv) {
        const t = BAL.divTypes[defDiv.type];
        const defPow = this.attackPower(defDiv) * t.defF
          * (0.25 + 0.75 * defDiv.org / t.maxOrg) * TERRAIN[nh.terrain].def;
        if (myPow < defPow * 0.6) continue;
        defense += (defDiv.str / 100) * defDiv.org;
      }
      defense *= TERRAIN[nh.terrain].def;
      let score = -defense;
      if (nh.building) score += 4;
      if (nh.capital) score += 10;
      if (nh.vp) score += 12;   // Siegpunkt-Hauptstädte sind das Rundenziel
      if (nh.river) score -= 3; // Flussübergänge meiden, wenn es Alternativen gibt
      if (this._atkCount && this._atkCount.get(nc + nr * MAP_W)) score += 6;
      if (score > bestScore) { bestScore = score; best = nh; }
    }
    return best;
  }

  attackPower(div) {
    const t = BAL.divTypes[div.type];
    const sup = this.supplyModOf(div);
    return (div.str / 100) * div.moral * sup.mod * t.atk;
  }

  resolveCombat(atk, targetHex, dt) {
    atk.inCombat = true;
    const terr = TERRAIN[targetHex.terrain];
    const fromHex = this.hexAt(atk.c, atk.r);
    const seaAssault = fromHex && fromHex.terrain === 'water';
    const rand = 0.85 + this.rand() * 0.3;
    let power = this.attackPower(atk) * rand / terr.def;
    if (seaAssault) power *= BAL.seaAssaultMalus;
    // Flussübergang: Angriff aus dem Fluss heraus oder in ihn hinein ist geschwächt
    if (fromHex && fromHex.river) power *= BAL.river.attackFrom;
    else if (targetHex.river) power *= BAL.river.attackInto;
    const neutral = targetHex.owner === null;

    const def = this.divisionAt(targetHex.c, targetHex.r);
    targetHex._atkT = this.dayFloat;
    const now = performance.now();
    if (!atk._fxT || now - atk._fxT > 300) {
      atk._fxT = now;
      this.effects.push({ type: 'battle', c: targetHex.c, r: targetHex.r, fc: atk.c, fr: atk.r, t: now });
      if (this.effects.length > 300) this.effects.splice(0, this.effects.length - 300);
    }

    if (def && !def.dead) {
      def.inCombat = true;
      if (def.nation !== atk.nation) {
        this.warHeat[[atk.nation, def.nation].sort().join('|')] = this.day;
        this._checkBetrayal(atk.nation, def.nation);
      }
      const dRand = 0.85 + this.rand() * 0.3;
      const defT = BAL.divTypes[def.type];
      const defPower = this.attackPower(def) * defT.defF * dRand;
      // Endphase: Angreifer schlagen härter durch — Stellungskriege lösen sich,
      // Hauptstädte fallen, die Runde findet ihren Sieger
      const lateAtk = 1 + 0.5 * this.lateFactor();
      def.org -= power * BAL.atkBase * BAL.orgDmg * lateAtk * dt;
      def.str -= power * BAL.atkBase * BAL.strDmg * lateAtk * dt;
      atk.org -= defPower * BAL.atkBase * BAL.orgDmg * 0.75 * dt;
      atk.str -= defPower * BAL.atkBase * BAL.strDmg * 0.6 * dt;
      if (def.str <= 5) this.destroyDivision(def, atk.nation);
      else if (def.org <= BAL.retreatOrg) this.retreatDivision(def, atk);
    } else {
      const t = BAL.divTypes[atk.type];
      // Endphase: Milizen ermüden — die Karte konsolidiert sich, Runden enden
      const bonus = (neutral ? BAL.neutralDmgBonus : 1) * (1 + this.lateFactor());
      targetHex.resist -= power * BAL.atkBase * 0.55 * t.militia * bonus * dt;
      this._damagedHexes.add(targetHex);
      const counter = neutral ? BAL.neutralCounter : 1;
      atk.org -= BAL.atkBase * BAL.militiaCounter * terr.def * 0.35 * counter * dt;
      atk.str -= BAL.atkBase * BAL.militiaCounter * 0.06 * counter * dt;
      if (targetHex.resist <= 0) this.captureHex(targetHex, atk);
    }

    if (atk.org <= BAL.retreatOrg) {
      atk.attackTarget = null;
      atk.moral = Math.max(BAL.moralMin, atk.moral - BAL.moralRetreat);
      if (seaAssault) this.retreatDivision(atk, null);
    }
    if (atk.str <= 5) this.destroyDivision(atk, targetHex.owner);
  }

  retreatDivision(div, attacker) {
    let best = null, bestScore = -Infinity;
    for (const [nc, nr] of neighborsOf(div.c, div.r)) {
      const nh = this.hexAt(nc, nr);
      if (!nh || nh.owner !== div.nation || nh.terrain === 'water') continue;
      if (this.divisionAt(nc, nr)) continue;
      let score = nh.supply * 2;
      for (const [ec, er] of neighborsOf(nc, nr)) {
        const eh = this.hexAt(ec, er);
        if (eh && eh.owner && this.hostile(div.nation, eh.owner)) score -= 1;
      }
      if (score > bestScore) { bestScore = score; best = nh; }
    }
    if (best) {
      this._placeDiv(div, best.c, best.r);
      div.org = Math.max(2, div.org);
      div.attackTarget = null; div.path = null;
      div.moral = Math.max(BAL.moralMin, div.moral - BAL.moralLoss);
      return;
    }
    for (const [nc, nr] of neighborsOf(div.c, div.r)) {
      const nh = this.hexAt(nc, nr);
      if (nh && nh.terrain === 'water' && !this.divisionAt(nc, nr)) {
        this._placeDiv(div, nc, nr);
        div.org = Math.max(2, div.org);
        div.attackTarget = null; div.path = null;
        div.manual = false;
        div.moral = Math.max(BAL.moralMin, div.moral - BAL.moralLoss * 1.5);
        this.addLog(`⛵ ${div.name} (${this.nationName(div.nation)}) wurde über See evakuiert!`, div.nation === this.player);
        return;
      }
    }
    this.addLog(`💀 ${div.name} (${this.nationName(div.nation)}) wurde eingekesselt und vernichtet!`, div.nation === this.player);
    this.destroyDivision(div, attacker ? attacker.nation : null);
  }

  destroyDivision(div, byNation) {
    if (div.dead) return;
    div.dead = true;
    this._hasDead = true;
    this.economyDirty = true;
    if (byNation && this.nations[byNation]) {
      for (const d of this.divisionsOf(byNation)) {
        if (hexDist(d.c, d.r, div.c, div.r) <= 3) d.moral = Math.min(BAL.moralMax, d.moral + 0.02);
      }
    }
    this.effects.push({ type: 'death', c: div.c, r: div.r, t: performance.now() });
  }

  captureHex(h, div) {
    const loser = h.owner;
    h.owner = div.nation;
    this.setResist(h);
    h.resist = h.resistMax * 0.35;
    this._damagedHexes.add(h);
    if (!this.divisionAt(h.c, h.r)) {
      this._placeDiv(div, h.c, h.r);
      // Marschbefehl fortsetzen: das eroberte Hex war der nächste Wegpunkt
      if (div.path && div.pathI < div.path.length
        && div.path[div.pathI][0] === h.c && div.path[div.pathI][1] === h.r) {
        div.pathI++;
        div.moveProgress = 0;
        if (div.pathI >= div.path.length) { div.path = null; if (div.manual) div.station = [div.c, div.r]; }
      }
    }
    div.attackTarget = null;
    div.moral = Math.min(BAL.moralMax, div.moral + (loser ? BAL.moralWin : BAL.moralWin * 0.3));
    div.org = Math.max(2, div.org - (loser ? 4 : 1.5));
    this.effects.push({ type: 'capture', c: h.c, r: h.r, t: performance.now() });
    this._supplyDirtyIds.add(div.nation);
    this._frontsDirtyIds.add(div.nation);
    if (loser) this._frontsDirtyIds.add(loser);
    this._borderCache = null;
    this.economyDirty = true;
    this.labelsDirty = true;
    this.markDirty(h.c, h.r);

    if (loser) {
      this._supplyDirtyIds.add(loser);
      this.warHeat[[div.nation, loser].sort().join('|')] = this.day;
      this._checkBetrayal(div.nation, loser);
      const ln = this.nations[loser];
      ln._lastAttacker = div.nation;
      ln._lastAttackedDay = this.day;
      // Spieler benachrichtigen, wenn er angegriffen wird
      if (loser === this.player && this.day - ln._atkToastDay > 12) {
        ln._atkToastDay = this.day;
        this.addLog(`⚔️ ${this.nationName(div.nation)} greift dein Reich an!`, true);
      }
      const enemyDiv = this.divisions.find(d => !d.dead && d.c === h.c && d.r === h.r && d.nation === loser);
      if (enemyDiv) this.retreatDivision(enemyDiv, div);
      if (h.capital) { h.capital = false; this.onCapitalFall(loser, div.nation); }
      this.checkElimination(loser, div.nation);
    }
  }

  onCapitalFall(loser, winner) {
    this.addLog(`🏰 Die Hauptstadt von ${this.nationName(loser)} ist an ${this.nationName(winner)} gefallen!`, true);
    for (const d of this.divisionsOf(loser)) d.moral = Math.max(BAL.moralMin, d.moral - 0.25);
    const nat = this.nations[loser];
    const own = this.ownedHexes(loser);
    if (own.length < 25) { this.surrender(loser, winner); return; }
    // Hauptstadt verlegen: beste Stadt/Kaserne, sonst bestversorgtes Feld
    let best = null, bestScore = -Infinity;
    for (const h of own) {
      let s = h.supply;
      if (h.building === 'stadt') s += 3;
      else if (h.building === 'kaserne') s += 2;
      else if (h.building) s += 1;
      if (s > bestScore) { bestScore = s; best = h; }
    }
    if (best) {
      best.capital = true;
      this.setResist(best);
      nat.capital = [best.c, best.r];
      this._supplyDirtyIds.add(loser);
      this.markDirty(best.c, best.r);
      this.addLog(`${this.nationName(loser)} verlegt die Hauptstadt und kämpft weiter!`);
    }
  }

  surrender(loser, winner) {
    const nat = this.nations[loser];
    if (!nat.alive) return;
    nat.alive = false;
    for (const a of [...nat.allies]) this.dissolveAlliance(loser, a);
    this.allianceOffers = this.allianceOffers.filter(o => o.from !== loser);
    this._offersChanged = true;
    let n = 0;
    for (const row of this.hexes) for (const hh of row) {
      if (hh.owner === loser) {
        hh.owner = winner; hh.capital = false;
        this.setResist(hh);
        hh.resist = hh.resistMax * 0.5;
        this._damagedHexes.add(hh);
        n++;
      }
    }
    for (const d of this.divisionsOf(loser)) d.dead = true;
    this._hasDead = true;
    this._borderCache = null;
    this.addLog(`🏳️ ${this.nationName(loser)} ist untergegangen${n > 0 && winner ? ` — ${this.nationName(winner)} übernimmt ${n} Provinzen` : ''}.`, true);
    this._supplyDirtyIds.add(winner);
    this.frontsDirty = true;
    this.economyDirty = true;
    this.labelsDirty = true;
    this.markDirtyAll();
    if (loser === this.player) this.over = { win: false, text: 'Dein Reich ist untergegangen.' };
  }

  checkElimination(loser, winner) {
    if (!loser || !this.nations[loser] || !this.nations[loser].alive) return;
    if (this.ownedHexes(loser).length === 0) this.surrender(loser, winner);
  }

  /* ---------- Kessel: eingeschlossene Gebietsteile sichtbar machen ---------- */
  pocketsDaily() {
    for (const p of this._pockets) for (const h of p.hexes) h._pocket = false;
    const pockets = [];
    const byOwner = new Map();
    for (const row of this.hexes) for (const h of row) {
      if (!h.owner || h.terrain === 'water') continue;
      let arr = byOwner.get(h.owner);
      if (!arr) byOwner.set(h.owner, arr = []);
      arr.push(h);
    }
    for (const [id, own] of byOwner) {
      if (!this.nations[id] || !this.nations[id].alive || own.length < 2) continue;
      const seen = new Set();
      for (const start of own) {
        const sk = start.c + start.r * MAP_W;
        if (seen.has(sk)) continue;
        seen.add(sk);
        const comp = [start];
        let hasHub = false, minKey = sk;
        for (let i = 0; i < comp.length; i++) {
          const h = comp[i];
          if (h.capital || h.building === 'stadt' || h.building === 'hafen' || h.building === 'kaserne') hasHub = true;
          for (const [nc, nr] of neighborsOf(h.c, h.r)) {
            const nh = this.hexAt(nc, nr);
            if (!nh || nh.owner !== id || nh.terrain === 'water') continue;
            const k = nc + nr * MAP_W;
            if (!seen.has(k)) { seen.add(k); comp.push(nh); if (k < minKey) minKey = k; }
          }
        }
        if (hasHub) continue;   // Hauptgebiet bzw. versorgter Landesteil — kein Kessel
        let divCount = 0, sx = 0, sy = 0;
        const compSet = new Set(comp.map(h => h.c + h.r * MAP_W));
        for (const d of this.divisions) {
          if (!d.dead && d.nation === id && compSet.has(d.c + d.r * MAP_W)) divCount++;
        }
        for (const h of comp) {
          const p = hexToPixel(h.c, h.r);
          sx += p.x; sy += p.y;
          h._pocket = true;
        }
        pockets.push({ owner: id, hexes: comp, cx: sx / comp.length, cy: sy / comp.length, divCount, key: id + ':' + minKey });
      }
    }
    // Neu entstandene Kessel melden
    for (const p of pockets) {
      if (this._pocketKeys.has(p.key)) continue;
      if (p.owner === this.player && p.divCount > 0)
        this.addLog(`⚠️ KESSEL! ${p.divCount} deiner Divisionen sind eingeschlossen — ausbrechen oder Verbindung freikämpfen!`, true);
      else if (p.divCount >= 2)
        this.addLog(`⚔️ Kessel! ${p.divCount} Divisionen von ${this.nationName(p.owner)} sind eingeschlossen.`);
    }
    this._pocketKeys = new Set(pockets.map(p => p.key));
    this._pockets = pockets;
  }

  /* ---------- Rundenmodus: Sieg über Hauptstädte ---------- */
  /* 0 vor der Endphase, steigt bis 1 am Rundenende — steuert Endspiel-Druck */
  lateFactor() {
    const start = BAL.round.days * BAL.round.lateStart;
    return Math.max(0, Math.min(1, (this.day - start) / (BAL.round.days - start)));
  }

  vpRecount() {
    for (const nat of Object.values(this.nations)) nat.vp = 0;
    for (const v of this.vpHexes) {
      const o = this.hexAt(v.c, v.r).owner;
      if (o && this.nations[o] && this.nations[o].alive) this.nations[o].vp++;
    }
  }

  vpDaily() {
    if (this.over) return;
    this.vpRecount();
    const need = BAL.round.vpToWin;
    const alive = Object.keys(this.nations).filter(id => this.nations[id].alive);

    // Letzter Überlebender gewinnt sofort
    if (alive.length === 1) {
      const w = alive[0];
      this.over = {
        win: w === this.player,
        text: w === this.player
          ? 'Alle Rivalen sind gefallen — ganz Europa gehört dir!'
          : `${this.nationName(w)} steht allein — Europa ist verloren.`,
      };
      return;
    }

    // Laufenden Countdown verwalten
    if (this.vpLeader) {
      const ln = this.nations[this.vpLeader];
      if (!ln.alive || ln.vp < need) {
        this.addLog(`🕊 ${this.nationName(this.vpLeader)} hält keine ${need} Hauptstädte mehr — der Sieg-Countdown ist gestoppt!`, true);
        this.vpLeader = null;
        this.vpDeadline = 0;
      } else if (this.day >= this.vpDeadline) {
        this.over = {
          win: this.vpLeader === this.player,
          text: this.vpLeader === this.player
            ? `Du hältst ${ln.vp} Hauptstädte — Europa liegt dir zu Füßen!`
            : `${this.nationName(this.vpLeader)} beherrscht Europa mit ${ln.vp} Hauptstädten.`,
        };
        return;
      }
    }
    // Neuen Countdown starten?
    if (!this.vpLeader) {
      let cand = null;
      for (const id of alive) {
        if (this.nations[id].vp >= need && (!cand || this.nations[id].vp > this.nations[cand].vp)) cand = id;
      }
      if (cand) {
        this.vpLeader = cand;
        this.vpDeadline = this.day + BAL.round.countdownDays;
        this.addLog(`👑 ${this.nationName(cand)} hält ${this.nations[cand].vp} Hauptstädte — Sieg in ${BAL.round.countdownDays} Tagen! ${cand === this.player ? 'Halte durch!' : 'Haltet ihn auf!'}`, true);
      }
    }

    // Rundenende per Timer: stärkste Macht gewinnt
    if (this.day >= BAL.round.days) {
      const ranked = [...alive].sort((a, b) =>
        (this.nations[b].vp - this.nations[a].vp) || (this.nations[b].hexCount - this.nations[a].hexCount));
      const winner = ranked[0];
      const place = ranked.indexOf(this.player) + 1;
      this.over = {
        win: winner === this.player,
        text: winner === this.player
          ? `Zeit abgelaufen — du bist die stärkste Macht Europas (${this.nations[winner].vp} Hauptstädte, ${this.nations[winner].hexCount} Provinzen)!`
          : `Zeit abgelaufen — ${this.nationName(winner)} gewinnt mit ${this.nations[winner].vp} Hauptstädten.${place > 0 ? ` Du wirst ${place}.` : ''}`,
      };
    }
  }

  /* ---------- Seehandel ---------- */
  findWaterPath(ph, qh) {
    let start = null, goal = null;
    for (const [nc, nr] of neighborsOf(ph.c, ph.r)) {
      const nh = this.hexAt(nc, nr);
      if (nh && nh.terrain === 'water') { start = nh; break; }
    }
    for (const [nc, nr] of neighborsOf(qh.c, qh.r)) {
      const nh = this.hexAt(nc, nr);
      if (nh && nh.terrain === 'water') { goal = nh; break; }
    }
    if (!start || !goal) return null;
    const sKey = start.c + start.r * MAP_W, gKey = goal.c + goal.r * MAP_W;
    const cacheKey = sKey + '|' + gKey;
    if (this._seaRoutes.has(cacheKey)) return this._seaRoutes.get(cacheKey);

    // A* nur über Wasser
    const heap = [[0, 0, start.c, start.r]];
    const hpush = it => {
      heap.push(it);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    };
    const hpop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, rr = l + 1; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    };
    const came = new Map();
    const gScore = new Map([[sKey, 0]]);
    let found = false, iter = 0;
    while (heap.length && iter++ < 16000) {
      const [f, g, c, r] = hpop();
      if (c + r * MAP_W === gKey) { found = true; break; }
      for (const [nc, nr] of neighborsOf(c, r)) {
        const nh = this.hexAt(nc, nr);
        if (!nh || nh.terrain !== 'water') continue;
        const ng = g + 1;
        const nKey = nc + nr * MAP_W;
        if (!gScore.has(nKey) || gScore.get(nKey) > ng) {
          gScore.set(nKey, ng);
          came.set(nKey, c + r * MAP_W);
          hpush([ng + hexDist(nc, nr, goal.c, goal.r), ng, nc, nr]);
        }
      }
    }
    let path = null;
    if (found) {
      path = [];
      let cur = gKey;
      while (cur !== undefined) {
        path.unshift([cur % MAP_W, Math.floor(cur / MAP_W)]);
        if (cur === sKey) break;
        cur = came.get(cur);
      }
    }
    if (this._seaRoutes.size > 500) this._seaRoutes.clear();
    this._seaRoutes.set(cacheKey, path);
    this._seaRoutes.set(gKey + '|' + sKey, path ? [...path].reverse() : null);
    return path;
  }

  tradeDaily() {
    const ports = this._ports.filter(h =>
      h.building === 'hafen' && h.owner && this.nations[h.owner].alive);
    for (const p of ports) {
      if (p._nextShipDay === undefined)
        p._nextShipDay = this.day + 1 + Math.floor(this.rand() * BAL.trade.shipEveryDays);
      if (this.day < p._nextShipDay) continue;
      const cands = ports.filter(q => q.owner !== p.owner && this.tradePartners(p.owner, q.owner));
      if (!cands.length) { p._nextShipDay = this.day + 2; continue; }
      const q = cands[Math.floor(this.rand() * cands.length)];
      const path = this.findWaterPath(p, q);
      if (!path || path.length < 2) { p._nextShipDay = this.day + 3; continue; }
      p._nextShipDay = this.day + BAL.trade.shipEveryDays;
      const sp = hexToPixel(path[0][0], path[0][1]);
      this.ships.push({
        path, i: 0, prog: 0, x: sp.x, y: sp.y,
        from: p.owner, origin: [p.c, p.r], target: [q.c, q.r],
        gold: Math.round(BAL.trade.baseGold + path.length * BAL.trade.goldPerDist),
      });
    }
  }

  shipsTick(dt) {
    if (!this.ships.length) return;
    const speed = BAL.trade.shipSpeed * dt;
    const arrived = [];
    for (const s of this.ships) {
      s.prog += speed;
      while (s.prog >= 1 && s.i < s.path.length - 1) { s.prog -= 1; s.i++; }
      const [c1, r1] = s.path[s.i];
      const [c2, r2] = s.path[Math.min(s.i + 1, s.path.length - 1)];
      const p1 = hexToPixel(c1, r1), p2 = hexToPixel(c2, r2);
      const f = Math.min(1, s.prog);
      s.x = p1.x + (p2.x - p1.x) * f;
      s.y = p1.y + (p2.y - p1.y) * f;
      if (s.i >= s.path.length - 1) arrived.push(s);
    }
    for (const s of arrived) {
      this.ships.splice(this.ships.indexOf(s), 1);
      const th = this.hexAt(...s.target);
      // Zielhafen muss noch existieren
      if (!th || th.building !== 'hafen' || !th.owner || !this.nations[th.owner].alive) continue;
      const seller = this.nations[s.from];
      const buyer = this.nations[th.owner];
      if (seller && seller.alive) {
        seller.gold += s.gold;
        seller.tradeEarned = (seller.tradeEarned || 0) + s.gold;
        const oh = this.hexAt(...s.origin);
        if (oh) {
          oh._tradeEarned = (oh._tradeEarned || 0) + s.gold;
          this.effects.push({ type: 'gold', c: s.origin[0], r: s.origin[1], amount: s.gold, t: performance.now() });
        }
      }
      buyer.gold += s.gold;
      buyer.tradeEarned = (buyer.tradeEarned || 0) + s.gold;
      th._tradeEarned = (th._tradeEarned || 0) + s.gold;
      this.effects.push({ type: 'gold', c: th.c, r: th.r, amount: s.gold, t: performance.now() });
      if (!this._firstTradeToast && (th.owner === this.player || s.from === this.player)) {
        this._firstTradeToast = true;
        this.addLog(`🚢 Seehandel läuft! Jede Schiffsankunft bringt beiden Häfen Gold.`, true);
      }
    }
  }

  /* ---------- Regeneration / Verschleiß ---------- */
  regenTick(dt) {
    for (const div of this.divisions) {
      if (div.dead) continue;
      const t = BAL.divTypes[div.type];
      const nat = this.nations[div.nation];
      const sup = this.supplyModOf(div);

      if (!div.inCombat) {
        div.org = Math.min(t.maxOrg, div.org + BAL.orgRegen * sup.mod * div.moral * dt);
        if (div.str < BAL.maxStr && sup.level > 0.4 && nat.soldaten > 0.5) {
          const pts = Math.min(BAL.reinforceRate * dt, BAL.maxStr - div.str, nat.soldaten / BAL.reinforceMpCost);
          div.str += pts;
          nat.soldaten -= pts * BAL.reinforceMpCost;
        }
      }
      div.moral += (1.0 - div.moral) * BAL.moralBaselinePull * dt;
      if (sup.level < BAL.lowSupply) {
        div.str -= BAL.attritionStr * dt;
        div.moral = Math.max(BAL.moralMin, div.moral - BAL.attritionMoral * dt);
        if (div.str <= 3) {
          this.addLog(`💀 ${div.name} (${this.nationName(div.nation)}) ist ohne Nachschub zerfallen.`, div.nation === this.player);
          this.destroyDivision(div, null);
        }
      }
      div.moral = Math.max(BAL.moralMin, Math.min(BAL.moralMax, div.moral));
    }
  }

  militiaDaily() {
    // Nur angeschlagene Hexes regenerieren — statt die ganze Karte zu scannen.
    // In der Endphase regeneriert die Miliz kaum noch.
    const regen = BAL.militiaRegen * (1 - 0.85 * this.lateFactor());
    for (const h of this._damagedHexes) {
      if (h.terrain === 'water' || h.resist >= h.resistMax) { this._damagedHexes.delete(h); continue; }
      if (this.dayFloat - (h._atkT || -99) > 2) {
        h.resist = Math.min(h.resistMax, h.resist + regen);
        if (h.resist >= h.resistMax) this._damagedHexes.delete(h);
      }
    }
  }

  /* ---------- KI ---------- */
  aiDaily() {
    for (const [id, nat] of Object.entries(this.nations)) {
      if (!nat.alive || !nat.ai) continue;
      if ((this.day + nat.aiTick) % 5 === 0) this.aiBuild(id);
      this.aiTrain(id);
      if ((this.day + nat.aiTick) % 3 === 0) this.aiMilitary(id);
      if ((this.day + nat.aiTick) % 50 === 0) this.aiPolitics(id);
    }
  }

  aiBuild(id) {
    const nat = this.nations[id];
    const [cc, cr] = nat.capital;
    const own = this.ownedHexes(id);
    const count = w => own.filter(h => h.building === w).length;
    const buildable = x => TERRAIN[x.terrain].buildable && !x.building;

    // Neue Wirtschaftskette: Dörfer geben KEIN Gold mehr. Die KI verfolgt
    // EIN Sparziel nach dem anderen — sonst verzettelt sie sich in billigen
    // Bauten und erreicht Stadt (270 G) oder Kaserne nie (Oszillation).
    const doerfer = count('dorf'), staedte = count('stadt');
    const kasernen = count('kaserne');
    const wantKas = 1 + (staedte >= 1 ? Math.floor(own.length / 100) : 0);
    const wantStadt = 1 + Math.floor(own.length / 120);
    const wantHafen = 1 + Math.floor(own.length / 220);
    // Genug Dörfer, um die Kasernen zu füttern (1 Kaserne frisst 0.25k/Tag)
    const wantDorf = Math.max(2, Math.floor(own.length * 0.025), kasernen * 3 - staedte * 2);
    const mineSpots = own.filter(h => (h.terrain === 'hills' || h.terrain === 'mountain') && !h.building);
    const spotNear = maxDist => () => this.findBuildSpot(id, cc, cr, buildable, maxDist, own);

    const plan = [];
    if (doerfer + staedte < 2) plan.push(['dorf', spotNear(30)]);
    if (kasernen < wantKas) plan.push(['kaserne', spotNear(30)]);
    if (staedte < wantStadt)
      plan.push(['stadt', () => own.find(h => h.building === 'dorf') || null]);
    // Leute-Mangel (< 20 Tage Ausbildungs-Reserve): Dörfer VOR Minen ziehen,
    // sonst verhungern die Kasernen reicher Minen-Nationen
    if (nat.leute < nat.trainCap * 20 && doerfer + staedte < wantDorf)
      plan.push(['dorf', spotNear(34)]);
    if (mineSpots.length)
      plan.push(['mine', () => mineSpots[0]]);
    if ((nat.ports || 0) < wantHafen)
      plan.push(['hafen', () => this.findBuildSpot(id, cc, cr, x => buildable(x) && this.isCoastal(x), 55, own)]);
    if (doerfer + staedte < wantDorf) plan.push(['dorf', spotNear(34)]);

    for (const [what, findSpot] of plan) {
      const spot = findSpot();
      if (!spot) continue;                    // unbaubar (z. B. Binnenland ohne Küste) → nächstes Ziel
      if (nat.gold < BAL.cost[what]) return;  // sparen aufs wichtigste erreichbare Ziel
      return this.build(id, spot, what);
    }
    // 8) Straße Richtung Front — nur vom Überschuss, Divisionen gehen vor
    const army = nat.armies[0];
    if (army && army.frontHexes.length && nat.gold >= BAL.cost.strasse + 350) {
      const f = army.frontHexes[Math.floor(army.frontHexes.length / 2)];
      const path = this.findPath(id, cc, cr, f.c, f.r, true);
      if (path) for (const [pc, pr] of path) {
        const ph = this.hexAt(pc, pr);
        if (ph && ph.owner === id && !ph.road && ph.terrain !== 'water') return this.build(id, ph, 'strasse');
      }
    }
  }

  aiTrain(id) {
    const nat = this.nations[id];
    // Flacherer Verlauf: Riesenreiche stellen nicht mehr endlos Divisionen auf
    // (Einkommens-Term gedeckelt — sonst fluten Minen-Nationen die Karte)
    const cap = Math.floor(4 + Math.min(10, Math.max(0, nat.incomePerDay) / 5) + nat.hexCount / 90);
    const divs = this.divisionsOf(id);
    if (divs.length >= cap) return;
    let type = 'inf';
    const roll = this.rand();
    if (nat.gold > 600 && roll < 0.2) type = 'pz';
    else if (nat.gold > 400 && roll < 0.4) type = 'art';
    else if (nat.gold > 500 && roll < 0.5) type = 'gar';
    const tt = BAL.divTypes[type];
    const underAttack = this.day - nat._lastAttackedDay < 12;
    // In Friedenszeiten Wirtschaft vor Masse: erst bauen (Stadt = 270 G),
    // Divisionen nur vom Überschuss. Ausnahme: Armee stark dezimiert
    // (Nachkriegs-Wiederaufbau) — dann zügig nachrüsten.
    const buffer = underAttack ? 10 : (divs.length < cap * 0.5 ? 60 : 220);
    if (nat.gold >= tt.gold + buffer && nat.soldaten >= tt.mp) {
      this.spawnDivision(id, type, nat.armies[0], false);
      this.economyDirty = true;
    }
  }

  aiMilitary(id) {
    const nat = this.nations[id];
    const army = nat.armies[0];
    if (!army) return;
    const myPow = this.nationPower(id);

    // 0) Schonfrist: nur expandieren
    if (this.day < BAL.graceDays) {
      army.target = 'EXPAND';
      army.mode = 'attack';
      return;
    }
    // 1) Unter Beschuss? Verteidigen/zurückschlagen
    if (this.day - nat._lastAttackedDay < 10 && nat._lastAttacker
      && this.nations[nat._lastAttacker].alive && this.hostile(id, nat._lastAttacker)) {
      const ratio = myPow / Math.max(0.1, this.nationPower(nat._lastAttacker));
      army.target = ratio > 0.85 ? nat._lastAttacker : 'ALL';
      army.mode = ratio > 0.85 ? 'attack' : 'defend';
      return;
    }
    // 2) Lohnendes Opfer in Reichweite? Große Ziele bevorzugen —
    //    das bremst Spitzenreiter und verhindert Dogpiling auf Sterbende.
    //    Hauptstadt-Sammler sind besonders attraktive Ziele (Countdown stoppen!).
    const borders = this.borderNationsOf(id).filter(b => this.hostile(id, b));
    let victim = null, vRatio = 0, vScore = -Infinity;
    for (const b of borders) {
      const r = myPow / Math.max(0.1, this.nationPower(b));
      const size = Math.sqrt(this.nations[b].hexCount / Math.max(1, nat.hexCount));
      let score = r * Math.min(2, Math.max(0.5, size));
      score *= 1 + (this.nations[b].vp || 0) * 0.1;
      if (this.isTraitor(b)) score *= 1.35;                           // Verräter sind Freiwild
      if (this.vpLeader === b) score *= 1.6;                          // Countdown stoppen!
      else if ((this.nations[b].vp || 0) >= BAL.round.vpToWin - 1) score *= 1.8;  // Beinahe-Sieger bremsen
      if (score > vScore) { vScore = score; vRatio = r; victim = b; }
    }
    const aggression = NATION_DEFS[id].aggression;
    const lf = this.lateFactor();   // Endphase: mutiger angreifen, die Runde entscheidet sich
    // Wer selbst Hauptstädte sammelt, greift nach der Krone
    if (victim && vRatio > 1.4 - 0.2 * lf && this.divisionsOf(id).length >= 5
      && this.rand() < aggression + 0.25 + 0.2 * lf + 0.08 * ((nat.vp || 1) - 1)) {
      army.target = victim;
      army.mode = 'attack';
      return;
    }
    // 3) Sonst: expandieren, solange es neutrales Land gibt
    army.target = 'EXPAND';
    army.mode = 'attack';
    this.computeFront(army);
    if (!army.frontHexes.length) {
      // nichts Neutrales mehr erreichbar
      if (victim && vRatio > 1.1) { army.target = victim; army.mode = 'attack'; }
      else { army.target = 'ALL'; army.mode = 'defend'; }
    }
  }

  aiPolitics(id) {
    const nat = this.nations[id];
    if (nat.allies.size >= BAL.maxAllies) return;
    const myPow = this.nationPower(id);
    // Bedrohung suchen
    const borders = this.borderNationsOf(id).filter(b => this.hostile(id, b));
    let threat = null, tRatio = 0;
    for (const b of borders) {
      const r = this.nationPower(b) / Math.max(0.1, myPow);
      if (r > tRatio) { tRatio = r; threat = b; }
    }
    if (tRatio < 1.5) return;
    // Verbünde dich mit jemand Starkem, der nicht die Bedrohung ist
    const cands = Object.keys(this.nations)
      .filter(x => x !== id && x !== threat && this.nations[x].alive && !this.allied(id, x)
        && this.nations[x].allies.size < BAL.maxAllies && !this.isTraitor(x))
      .sort((a, b) => this.nationPower(b) - this.nationPower(a));
    if (cands.length) this.offerAlliance(id, cands[0]);
  }

  /* ---------- Haupt-Tick: fester Takt ----------
     Echtzeit wird angesammelt und in identische TICK_DAYS-Schritte übersetzt.
     Jeder Tick ist auf jeder Maschine gleich groß — deterministisch. */
  tick(realDt) {
    if (this.paused || this.over) return;
    this._acc += Math.min(realDt, 0.25) * BAL.daysPerSec[this.speed];
    let guard = 0;
    while (this._acc >= TICK_DAYS && !this.over && guard++ < 60) {
      this._acc -= TICK_DAYS;
      this.runTick();
    }
    if (this._acc > TICK_DAYS * 4) this._acc = 0;   // Rückstand kappen (Tab war im Hintergrund)
  }

  runTick() {
    // Replay: aufgezeichnete Kommandos exakt vor ihrem Tick abspielen
    if (this._replayCmds) {
      while (this._replayIdx < this._replayCmds.length
        && this._replayCmds[this._replayIdx].t === this.tickCount) {
        const c = this._replayCmds[this._replayIdx++];
        this._exec(c.cmd, c.args);
      }
    }
    this.tickCount++;
    this.subTick(TICK_DAYS);
  }

  subTick(dt) {
    if (dt <= 0) return;
    const prevDay = Math.floor(this.dayFloat);
    this.dayFloat += dt;
    this.day = Math.floor(this.dayFloat);

    this.economyTick(dt);
    this.divisionsTick(dt);
    this.regenTick(dt);
    this.shipsTick(dt);

    if (this.day !== prevDay) {
      if (this._hasDead) {   // tote Divisionen aus dem Array räumen (sonst wachsen alle Schleifen ewig)
        this.divisions = this.divisions.filter(d => !d.dead);
        this._hasDead = false;
      }
      if (prevDay < BAL.graceDays && this.day >= BAL.graceDays)
        this.addLog('⚔️ Die Schonfrist ist vorbei — ganz Europa ist jetzt angreifbar!', true);
      const lateDay = Math.floor(BAL.round.days * BAL.round.lateStart);
      if (prevDay < lateDay && this.day >= lateDay)
        this.addLog('🔥 Endphase! Die Milizen ermüden, der Aufholbonus schwindet — jetzt entscheidet Eroberung.', true);
      if (this.economyDirty) this.recalcEconomy();
      this.frontsTick();
      this.supplyDaily();
      this.militiaDaily();
      this.tradeDaily();
      this.aiDaily();
      this.vpDaily();
      this.pocketsDaily();
      // Abgelaufene Bündnisangebote entfernen
      const before = this.allianceOffers.length;
      this.allianceOffers = this.allianceOffers.filter(o => this.day - o.day < BAL.offerLifetime);
      if (this.allianceOffers.length !== before) this._offersChanged = true;
      if (performance.now() - this._lastAutosave > 60000 && !this.over && !this._replayCmds) {
        this._lastAutosave = performance.now();
        try {
          localStorage.setItem('finalfront_autosave', JSON.stringify({ t: Date.now(), save: this.serialize() }));
        } catch (e) { /* ignorieren */ }
      }
    }
    const now = performance.now();
    if (this.effects.length && now - this.effects[0].t > 900) {
      this.effects = this.effects.filter(e => now - e.t < 900);
    }
  }

  /* ---------- Speichern / Laden ---------- */
  serialize() {
    return JSON.stringify({
      v: 4, day: this.day, dayFloat: this.dayFloat, player: this.player,
      divSeq: this._divSeq, armySeq: this._armySeq,
      vpLeader: this.vpLeader, vpDeadline: this.vpDeadline,
      seed: this.seed, rngState: this._rngState, tickCount: this.tickCount,
      cmds: this._replayCapable ? this.cmdLog : undefined,
      warHeat: this.warHeat,
      exAllies: this._exAllies,
      hexes: this.hexes.flat().map(h => [h.owner, h.building, h.road ? 1 : 0, h.capital ? 1 : 0, Math.round(h.resist)]),
      nations: Object.fromEntries(Object.entries(this.nations).map(([id, n]) => [id, {
        alive: n.alive, gold: Math.round(n.gold), leute: +n.leute.toFixed(2), soldaten: +n.soldaten.toFixed(2),
        traitorUntil: n.traitorUntil,
        allies: [...n.allies], capital: n.capital, divNameSeq: n.divNameSeq,
        armies: n.armies.map(a => ({ id: a.id, name: a.name, target: a.target, mode: a.mode })),
      }])),
      divisions: this.divisions.filter(d => !d.dead).map(d => ({
        id: d.id, name: d.name, nation: d.nation, type: d.type, c: d.c, r: d.r,
        str: Math.round(d.str), org: Math.round(d.org), moral: +d.moral.toFixed(2), army: d.army, manual: d.manual,
      })),
    });
  }

  static deserialize(json) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return null; }
    if (!s || (s.v !== 3 && s.v !== 4) || !Array.isArray(s.hexes) || s.hexes.length !== MAP_W * MAP_H) return null;
    if (!NATION_DEFS[s.player]) return null;
    const g = new Game(s.player, s.seed !== undefined ? s.seed : 1);
    g.divisions = [];
    g.day = s.day; g.dayFloat = s.dayFloat;
    g._divSeq = s.divSeq; g._armySeq = s.armySeq;
    // Zufallsstrom & Kommando-Log exakt fortsetzen (Determinismus über Save/Load)
    if (s.rngState !== undefined) g._rngState = s.rngState;
    g.tickCount = s.tickCount !== undefined ? s.tickCount : Math.round(s.dayFloat / TICK_DAYS);
    g.cmdLog = Array.isArray(s.cmds) ? s.cmds : [];
    g._replayCapable = s.seed !== undefined && Array.isArray(s.cmds);
    const flat = g.hexes.flat();
    // Erst alles zurück auf neutral
    for (const h of flat) {
      if (h.terrain === 'water') continue;
      h.owner = null; h.building = null; h.road = false; h.capital = false;
    }
    s.hexes.forEach((hs, i) => {
      const h = flat[i];
      h.owner = hs[0]; h.building = hs[1]; h.road = !!hs[2]; h.capital = !!hs[3];
      g.setResist(h); h.resist = hs[4];
    });
    for (const [id, ns] of Object.entries(s.nations)) {
      const n = g.nations[id];
      if (!n) continue;
      n.alive = ns.alive; n.gold = ns.gold;
      // v3-Spielstände: alter Rekruten-Pool wird auf Leute/Soldaten aufgeteilt
      n.leute = ns.leute !== undefined ? ns.leute : (ns.manpower !== undefined ? ns.manpower * 0.6 : 20);
      n.soldaten = ns.soldaten !== undefined ? ns.soldaten : (ns.manpower !== undefined ? ns.manpower * 0.4 : 10);
      n.traitorUntil = ns.traitorUntil !== undefined ? ns.traitorUntil : -999;
      n.allies = new Set(ns.allies); n.capital = ns.capital; n.divNameSeq = ns.divNameSeq;
      n.armies = ns.armies.map(a => ({ ...a, nation: id, frontHexes: [] }));
    }
    for (const ds of s.divisions) {
      if (!BAL.divTypes[ds.type]) continue;
      const p = hexToPixel(ds.c, ds.r);
      g.divisions.push({
        ...ds, x: p.x, y: p.y, station: null, path: null, pathI: 0,
        moveProgress: 0, queue: [], attackTarget: null, inCombat: false, dead: false,
      });
    }
    g.log = [];
    g.toasts = [];
    g.allianceOffers = [];
    g.ships = [];
    g.warHeat = s.warHeat || {};
    g._exAllies = s.exAllies || {};
    g.vpLeader = s.vpLeader || null;
    g.vpDeadline = s.vpDeadline || 0;
    g.vpRecount();
    g.addLog('💾 Spielstand geladen.');
    g.economyDirty = true; g.labelsDirty = true; g.frontsDirty = true;
    g.markDirtyAll();
    g.recalcEconomy();
    // Miliz-Obergrenzen mit korrekten Nationsgrößen neu setzen (Heimatverteidigung)
    g._damagedHexes.clear();
    for (const h of flat) {
      if (h.terrain === 'water') continue;
      g.setResist(h);
      if (h.resist < h.resistMax) g._damagedHexes.add(h);
    }
    g.recalcAllSupply(); g.updateFronts();
    return g;
  }

  /* ---------- Replay ---------- */
  getReplay() {
    if (!this._replayCapable) return null;
    return { v: 1, seed: this.seed, player: this.player, cmds: this.cmdLog };
  }

  static fromReplay(rep) {
    if (!rep || rep.seed === undefined || !NATION_DEFS[rep.player]) return null;
    const g = new Game(rep.player, rep.seed);
    g._replayCmds = (rep.cmds || []).slice();
    g._replayIdx = 0;
    g.cmdLog = g._replayCmds;
    g._replayCapable = false;
    g.addLog('🎬 Replay — Eingaben sind gesperrt, Geschwindigkeit frei wählbar.', true);
    return g;
  }
}

/* =========================================================
   KOMMANDO-SCHLEUSE
   Alle Spieler-Eingriffe laufen als aufgezeichnete Kommandos
   durch issue() — die Basis für Replays und Multiplayer.
   ========================================================= */
Game.prototype._divById = function (id) {
  return this.divisions.find(d => d.id === id && !d.dead) || null;
};

Game.prototype.issue = function (cmd, ...args) {
  if (this._replayCmds) return null;   // Replay: Eingaben gesperrt
  const fn = this._commands[cmd];
  if (!fn) return null;
  this.cmdLog.push({ t: this.tickCount, cmd, args });
  return fn.apply(this, args);
};

Game.prototype._exec = function (cmd, args) {
  const fn = this._commands[cmd];
  if (fn) fn.apply(this, args);
};

Game.prototype._commands = {
  move(divId, c, r, queue) {
    const d = this._divById(divId);
    if (d && d.nation === this.player) this.moveOrder(d, c, r, queue);
  },
  build(c, r, what) {
    return this.build(this.player, this.hexAt(c, r), what);
  },
  train(type, n, armyId) {
    const a = this.armyById(this.player, armyId);
    const made = this.trainDivisions(this.player, type, n, a);
    if (made) this.updateFronts(this.player);
    return made;
  },
  split(divIds) {
    const twins = [];
    for (const id of divIds) {
      const d = this._divById(id);
      if (d && d.nation === this.player) {
        const t = this.splitDivision(d);
        if (t) twins.push(t.id);
      }
    }
    return twins;
  },
  merge(divIds) {
    const divs = divIds.map(id => this._divById(id)).filter(d => d && d.nation === this.player);
    return this.mergeDivisions(divs);
  },
  disband(divIds) {
    let n = 0;
    for (const id of divIds) {
      const d = this._divById(id);
      if (d && d.nation === this.player) { this.disbandDivision(d); n++; }
    }
    return n;
  },
  disbandArmy(armyId) {
    return this.disbandArmy(this.player, armyId);
  },
  createArmy() {
    this.createArmy(this.player);
  },
  renameArmy(armyId, name) {
    const a = this.armyById(this.player, armyId);
    if (a && name) a.name = String(name).slice(0, 24);
  },
  armyTarget(armyId, target) {
    const a = this.armyById(this.player, armyId);
    if (a) { a.target = target; this.updateFronts(this.player); }
  },
  armyMode(armyId, mode) {
    const a = this.armyById(this.player, armyId);
    if (a && (mode === 'attack' || mode === 'defend')) a.mode = mode;
  },
  assignFront(divIds, key) {
    const nat = this.nations[this.player];
    let army = nat.armies.find(a => a.target === key);
    if (!army) {
      army = this.createArmy(this.player,
        key === 'EXPAND' ? 'Expansionsarmee' : 'Front: ' + this.nationName(key));
      army.target = key;
    }
    army.mode = 'attack';
    let n = 0;
    for (const id of divIds) {
      const d = this._divById(id);
      if (!d || d.nation !== this.player) continue;
      d.army = army.id; d.manual = false; d.path = null; d.attackTarget = null; d.queue = [];
      n++;
    }
    this.updateFronts(this.player);
    return n;
  },
  assign(divIds, armyId) {
    let n = 0;
    for (const id of divIds) {
      const d = this._divById(id);
      if (!d || d.nation !== this.player) continue;
      d.army = armyId; d.manual = false; d.path = null; d.queue = []; d.attackTarget = null;
      n++;
    }
    this.updateFronts(this.player);
    return n;
  },
  release(divIds) {
    for (const id of divIds) {
      const d = this._divById(id);
      if (d && d.nation === this.player) this.releaseToArmy(d);
    }
    this.updateFronts(this.player);
  },
  ally(to) {
    return this.offerAlliance(this.player, to);
  },
  unally(other) {
    this.dissolveAlliance(this.player, other, this.player);
  },
  answerOffer(from, accept) {
    this.resolveOffer(from, accept);
  },
};
