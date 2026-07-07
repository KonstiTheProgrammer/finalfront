/* =========================================================
   FINAL FRONT — game.js
   Free-for-All-Simulation: leere Karte, Expansion in
   neutrales Land, Allianzen statt Diplomatie, Fronten,
   Kampf, Moral, Versorgung, KI.
   ========================================================= */

/* ---------- Balance-Konstanten ---------- */
const BAL = {
  // Spielgeschwindigkeit: deutlich entschleunigt, damit man reagieren kann
  // (die Anzeige bleibt durch Interpolation trotzdem flüssig)
  daysPerSec: [0, 0.3, 0.6, 1.5, 3.5],
  // Wirtschaftskette (pro Tag):
  //   Alle Truppen rekrutieren 👥 LEUTE. Dazu Rohstoffe:
  //   ⛏️ Mine → 🔩 Eisen (für Kanonen) · 🚜 Farm → 🐎 Pferde (für Kavallerie)
  baseIncome: 2.5,                    // Staatskasse (Grundeinkommen)
  incomeStadt: 4.0,                   // Start-Stadt (Hauptstadt): Gold + Leute
  leuteStadt: 0.20,
  // Truppen werden AUSGEBILDET (Warteschlange pro Standort) und spawnen dort:
  // Städte/Hauptstadt bilden aus, Kasernen doppelt so schnell.
  trainTime: { inf: 6, kav: 8, kan: 10 },   // Tage an einer Stadt
  kaserneTrainFactor: 0.5,                  // Kaserne: halbe Zeit
  // Bevölkerungs-Kapazität: das Reich versorgt nur begrenzt viele Leute.
  // Gebäude (× Level) und Landfläche erhöhen das Limit.
  pop: {
    base: 20,
    perHex: 0.2,
    stadt: 25, dorf: 10, fischerei: 8, farm: 6, forsterei: 4, kaserne: 5,
  },
  // Vier Wirtschaftsgebäude — jedes hat eine klare Rolle, Level 1–3
  // (gleiches Gebäude nochmal bauen = Ausbau, Ertrag skaliert mit dem Level):
  //   Mine (überall):        Gold             · Hügel-Bonus
  //   Forsterei (nur Wald):  viel Gold + etwas Leute
  //   Fischerei (Küstenmeer): etwas Gold + viele Leute
  //   Dorf (überall):        nur Leute
  //   Mine (überall):        🔩 Eisen  · Hügel-Bonus (für Kanonen)
  //   Farm (nur Ebene):      🐎 Pferde (für Kavallerie)
  yields: {
    mine:      { gold: 0,   leute: 0,    eisen: 0.6, hillsEisen: 0.85 },
    farm:      { gold: 0,   leute: 0,    pferde: 0.5 },
    forsterei: { gold: 6.0, leute: 0.06 },
    fischerei: { gold: 2.5, leute: 0.16 },
    dorf:      { gold: 0,   leute: 0.22 },
  },
  maxLevel: 3,
  // Unbebautes eigenes Land arbeitet auch — nur viel schwächer als ein Gebäude
  passive: {
    plains:   { gold: 0.05, leute: 0.010 },
    forest:   { gold: 0.30, leute: 0.004 },
    hills:    { gold: 0.35, leute: 0.002 },
    mountain: { gold: 0.45, leute: 0 },
  },
  // Baukosten (Ausbau auf Level N kostet das N-fache)
  cost: { strasse: 25, dorf: 60, fischerei: 90, farm: 100, mine: 110, forsterei: 130, turm: 140, kaserne: 150, stadt: 250 },
  // Wehrturm: verstärkt die Miliz umliegender eigener Felder.
  // Level 2 verdoppelt die Reichweite (1 → 2 Felder).
  turm: { boost: 1.5, range: 1, range2: 2, maxLevel: 2 },
  // Truppendreieck nach EU4-Vorbild:
  //   Krieger schlagen Kavallerie · Kavallerie schlägt Kanonen · Kanonen schlagen Krieger
  // Erober-Profil (militia = Tempo gegen Miliz, skaliert zusätzlich linear
  // mit der Stärke der Armee):
  //   Krieger normal schnell unterwegs, aber SCHWACH im Erobern
  //   Kavallerie flott unterwegs, mittelmäßig im Erobern
  //   Kanonen STARK im Erobern, aber langsam unterwegs
  // ALLE Truppen rekrutieren 👥 Leute (mp). Dazu Rohstoff-Kosten:
  //   Kavallerie braucht 🐎 Pferde (Farmen) · Kanonen brauchen 🔩 Eisen (Minen)
  divTypes: {
    inf: { name: 'Krieger',    gold: 60,  mp: 10,                upkeep: 0.4, atk: 1.0, defF: 1.4, maxOrg: 60, speed: 1.0, militia: 0.8 },
    kav: { name: 'Kavallerie', gold: 100, mp: 8,  pferde: 8,     upkeep: 1.0, atk: 1.6, defF: 0.7, maxOrg: 45, speed: 1.9, militia: 1.2 },
    kan: { name: 'Kanonen',    gold: 130, mp: 6,  eisen: 10,     upkeep: 1.5, atk: 2.1, defF: 0.5, maxOrg: 40, speed: 0.6, militia: 2.5 },
  },
  rps: { inf: { kav: 1.35 }, kav: { kan: 1.5 }, kan: { inf: 1.35 } },
  maxStr: 100,
  brokeMoralDrain: 0.08,   // Staatskasse leer + Minus: Moralverlust/Tag
  reinforceRate: 3.0,
  reinforceMpCost: 0.1,
  orgRegen: 7.0,
  retreatOrg: 8,
  // Kampf (pro Tag) — Erobern dauert bewusst LANGE (Multiplayer-Pacing):
  // jedes Feld ist ein kleiner Kampf, keine Blitz-Expansion
  atkBase: 8.0,
  orgDmg: 0.9,
  strDmg: 0.22,
  militiaResist: 35,
  militiaResistStadt: 60,
  militiaResistHauptstadt: 78,
  militiaResistNeutral: 20,
  neutralDmgBonus: 1.35,
  neutralCounter: 0.5,
  militiaRegen: 1.1,
  // Gelände wehrt sich: Berge sind Festungen, Flussfelder zäh (aber machbar)
  terrainResist: { plains: 1.0, forest: 1.15, hills: 1.35, mountain: 2.2 },
  riverResist: 1.35,
  militiaCounter: 0.25,
  seaAssaultMalus: 0.5,
  // Versorgung (kompakte Karte)
  supplyHub: { capital: 1.0, stadt: 0.85, kaserne: 0.6 },
  supplyDecay: 0.05,
  roadCostFactor: 0.5,
  seaMinSupply: 0.25,
  lowSupply: 0.2,
  attritionStr: 1.2,
  attritionMoral: 0.03,
  // Moral
  moralMin: 0.5, moralMax: 1.3,
  moralWin: 0.04, moralLoss: 0.06, moralRetreat: 0.05,
  moralBaselinePull: 0.03,
  // Bewegung (Hexes/Tag) — kompakte Karte, gemächliches Tempo
  moveSpeed: 2.6,
  // Flüsse: Übergänge sind langsam und gefährlich — Straßen überbrücken sie.
  // Wer AM Fluss verteidigt, hat einen echten Vorteil (attackInto).
  river: { moveFactor: 1.6, attackFrom: 0.6, attackInto: 0.72 },
  // Verrat: Ex-Verbündeten schnell angreifen macht dich öffentlich zum Verräter
  traitor: { window: 25, duration: 60 },
  // Politik
  maxAllies: 2,
  offerLifetime: 40,
  // Balance / Fairness (Multiplayer-tauglich)
  graceDays: 40,              // Schonfrist: so lange keine Angriffe auf Spieler
  catchupMax: 0.30,           // Einkommensbonus kleiner Spieler (bis +30 %)
  leaderMalus: 0.25,          // Einkommensmalus des Spitzenreiters (bis -25 %)
  smallNationDefense: 1.5,    // Miliz-Bonus für Spieler unter 12 Provinzen
  smallNationHexes: 12,
  // Spawn-Phase: Startplatz frei wählen, alle sehen einander
  spawn: { seconds: 15, minDist: 12 },
  // Rundenmodus & Sieg über Hauptstädte (5 Spieler).
  // 600 Tage passen zum echten Pacing der kleinen Karten — so greift die
  // Endphase wirklich, statt hinter dem Rundenende zu liegen.
  round: {
    days: 600,                // Rundenlänge in Spieltagen (≈ 10–20 min je nach Tempo)
    vpToWin: 3,               // gehaltene Hauptstädte starten den Sieg-Countdown
    countdownDays: 50,        // Länge des Countdowns — Zeit für die Gegenkoalition
    lateStart: 0.6,           // ab 60 % der Runde: Endphase (Miliz ermüdet, Aufholbonus schwindet)
    domination: 0.8,          // 80 % der Landfläche = sofortiger Sieg
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
  constructor(playerNationId, seed, mapId, humans, slots) {
    // Karte festlegen (setzt MAP_W/H & Weltgröße), dann bauen
    this.mapId = selectMap(mapId !== undefined ? mapId : CURRENT_MAP_ID);
    // Multiplayer: Liste der menschlichen Nationen (alle Clients identisch!)
    this._humans = Array.isArray(humans) && humans.length ? humans : null;
    this._net = null;                  // gesetzt von der Netz-Schicht (js/net.js)
    this._slots = Math.max(2, Math.min(5, slots || 5));   // 1v1-Duell: 2
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
    this.warHeat = {};              // 'A|B' -> Tag des letzten Kampfs
    this.allianceOffers = [];       // {from, day} — Angebote an den Spieler
    this._offersChanged = false;
    this.over = null;
    this._divSeq = 1;
    this._armySeq = 1;
    this._lastAutosave = performance.now();
    this._supplyDirtyIds = new Set();
    this._frontsDirtyIds = new Set();
    this._damagedHexes = new Set();    // Hexes mit angeschlagener Miliz (für militiaDaily)
    this._kasernen = [];               // Cache: alle Kasernen-Hexes (recalcEconomy)
    this._tuerme = [];                 // Cache: alle Wehrturm-Hexes (recalcEconomy)
    this.training = [];                // Ausbildungs-Warteschlange {c, r, nation, type, ready}
    this._borderCache = null;          // Cache: borderNationsOf pro Tag
    this._hasDead = false;
    this._pockets = [];                // erkannte Kessel (für Anzeige & Meldungen)
    this._pocketKeys = new Set();
    this._exAllies = {};               // 'Initiator>Opfer' -> Tag der Bündnisauflösung
    this.spawnPhase = true;            // Startplatz-Wahl: Spiel tickt noch nicht
    this.fronts = [];                  // Frontlinien {id, owner, kind, target, path, hexes}
    this._frontSeq = 1;
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

    for (const [id, def] of Object.entries(NATION_DEFS).slice(0, this._slots)) this.initNation(id, def);

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
    // Sieg-Bedarf skaliert mit der Spielerzahl (1v1: beide Hauptstädte)
    this.vpNeed = Math.min(BAL.round.vpToWin, Math.max(2, this.vpHexes.length));

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

  divisionsAt(c, r) {
    if (this._divIndex) {
      const arr = this._divIndex.get(c + r * MAP_W);
      return arr ? arr.filter(d => !d.dead) : [];
    }
    return this.divisions.filter(d => !d.dead && d.c === c && d.r === r);
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
    if (this.nations[b] && !this.nations[b].ai) {
      // Angebot an einen Menschen: landet in dessen Banner (to-Feld)
      if (!this.allianceOffers.find(o => o.from === a && o.to === b)) {
        this.allianceOffers.push({ from: a, to: b, day: this.day });
        this._offersChanged = true;
        if (b === this.player) this.addLog(`🤝 ${this.nationName(a)} bietet dir eine Allianz an!`, true);
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

  resolveOffer(actor, from, accept) {
    this.allianceOffers = this.allianceOffers.filter(o => !(o.from === from && (o.to || this.player) === actor));
    this._offersChanged = true;
    if (accept && this.nations[from].alive && !this.allied(actor, from)
      && this.nations[actor].allies.size < BAL.maxAllies) {
      this.formAlliance(from, actor);
    } else if (!accept && actor === this.player) {
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
      leute: 20,        // Bevölkerungs-Pool — ALLE Truppen rekrutieren hieraus
      eisen: 10,        // 🔩 aus Minen — Kanonen
      pferde: 8,        // 🐎 aus Farmen — Kavallerie
      allies: new Set(),
      armies: [],
      ai: this._humans ? !this._humans.includes(id) : id !== this.player,
      aiTick: Math.floor(this.rand() * 6),
      capital: null,
      divNameSeq: 1,
      hexCount: 1,
      traitorUntil: -999,
      incomePerDay: 0, leutePerDay: 0, eisenPerDay: 0, pferdePerDay: 0,
      _lastAttacker: null, _lastAttackedDay: -99, _atkToastDay: -99,
    };
    this.nations[id] = nat;

    const spawn = this.pickSpawnSpot();
    if (!spawn) { nat.alive = false; return; }
    this.claimSpawnArea(id, spawn, def.capitalName);
    nat.capital = [spawn.c, spawn.r];

    const army = this.createArmy(id, '1. Armee');
    army.target = 'EXPAND';
    army.mode = 'attack';
    this.spawnDivision(id, 'inf', army, true);   // … und eine Armee Krieger
  }

  /* Symmetrischer Start: Hauptstadt + Ring aus freiem Nachbarland —
     jeder Spieler beginnt mit demselben Fußabdruck (Multiplayer-Fairness) */
  claimSpawnArea(id, spawn, cityName) {
    spawn.owner = id;
    spawn.capital = true;
    spawn.building = 'stadt';          // Start: eine Stadt …
    spawn.cityName = cityName;
    this.setResist(spawn);
    spawn.resist = spawn.resistMax;    // volle Garnison ab Tag 1
    for (const [nc, nr] of neighborsOf(spawn.c, spawn.r)) {
      const h = this.hexAt(nc, nr);
      if (h && h.terrain !== 'water' && !h.owner) {
        h.owner = id;
        this.setResist(h);
        h.resist = h.resistMax;
      }
    }
  }

  /* Wie viel Land liegt im Umkreis? (Bots meiden Mini-Inseln) */
  landNearby(c, r, radius) {
    let n = 0;
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      const h = this.hexAt(c + dc, r + dr);
      if (h && h.terrain !== 'water' && hexDist(c, r, c + dc, r + dr) <= radius) n++;
    }
    return n;
  }

  /* Zufälliger Startplatz — Bots streuen sich, hart ist der Abstand aber nicht */
  pickSpawnSpot() {
    const taken = Object.values(this.nations).map(n => n.capital).filter(Boolean);
    // 1v1: gespiegelte Startseiten — Spieler 1 West, Spieler 2 Ost (fair)
    const duelSide = this._slots === 2 ? taken.length : -1;
    const base = Math.max(6, Math.floor(Math.min(MAP_W, MAP_H) / 5));
    for (let minDist = base; minDist >= 3; minDist -= 3) {
      for (let tries = 0; tries < 300; tries++) {
        const c = Math.floor(this.rand() * MAP_W), r = Math.floor(this.rand() * MAP_H);
        const h = this.hexAt(c, r);
        if (!h || h.terrain === 'water' || h.terrain === 'mountain' || h.owner) continue;
        if (duelSide === 0 && c > MAP_W * 0.38) continue;
        if (duelSide === 1 && c < MAP_W * 0.62) continue;
        if (taken.some(([tc, tr]) => hexDist(c, r, tc, tr) < minDist)) continue;
        if (this.landNearby(c, r, 3) < Math.min(14, Math.floor(MAP_W * MAP_H * 0.012))) continue;
        return h;
      }
    }
    return this.nearestFreeLand(Math.floor(MAP_W / 2), Math.floor(MAP_H / 2));
  }

  /* Spawn-Phase: eigenen Startplatz verlegen (Stadt + Truppen ziehen mit).
     KEIN Mindestabstand — direkt neben dem Gegner spawnen ist erlaubt. */
  relocateSpawn(id, c, r) {
    if (!this.spawnPhase) return false;
    const h = this.hexAt(c, r);
    if (!h || h.terrain === 'water' || h.terrain === 'mountain') return false;
    if (h.owner && h.owner !== id) return false;   // nur nicht AUF eine fremde Stadt
    const nat = this.nations[id];
    // Altes Startgebiet (Stadt + Ring) komplett räumen
    for (const row of this.hexes) for (const hh of row) {
      if (hh.owner !== id) continue;
      hh.owner = null; hh.capital = false; hh.building = null;
      hh.cityName = null; hh.vp = false;
      this.setResist(hh);
      this.markDirty(hh.c, hh.r);
    }
    this.claimSpawnArea(id, h, NATION_DEFS[id].capitalName);
    h.vp = true;
    nat.capital = [c, r];
    const vpe = this.vpHexes.find(v => v.id === id);
    if (vpe) { vpe.c = c; vpe.r = r; }
    for (const d of this.divisionsOf(id)) {
      this._placeDiv(d, c, r);
      const p = hexToPixel(c, r);
      d.x = p.x; d.y = p.y;
      d.path = null; d.station = null; d.queue = [];
    }
    this.economyDirty = true;
    this._supplyDirtyIds.add(id);
    this.labelsDirty = true;
    this.markDirty(c, r);
    return true;
  }

  endSpawnPhase() {
    if (!this.spawnPhase) return;
    this.spawnPhase = false;
    // Truppen an den Rand des Startgebiets stellen — sie nibbeln sofort los
    for (const [id, nat] of Object.entries(this.nations)) {
      if (!nat.alive) continue;
      let edge = null;
      for (const row of this.hexes) {
        for (const h of row) {
          if (h.owner !== id) continue;
          for (const [nc, nr] of neighborsOf(h.c, h.r)) {
            const nh = this.hexAt(nc, nr);
            if (nh && nh.terrain !== 'water' && nh.owner === null) { edge = h; break; }
          }
          if (edge) break;
        }
        if (edge) break;
      }
      if (edge) {
        for (const d of this.divisionsOf(id)) {
          this._placeDiv(d, edge.c, edge.r);
          const p = hexToPixel(edge.c, edge.r);
          d.x = p.x; d.y = p.y;
        }
      }
    }
    this.recalcEconomy();
    this.recalcAllSupply();
    this.vpRecount();
    this.addLog('🏁 Alle Startplätze stehen — das Match beginnt!', true);
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
      if (nat && nat.alive && nat.hexCount < BAL.smallNationHexes) base *= BAL.smallNationDefense;
    }
    // Gelände verteidigt mit: Berge sind Festungen, Flussfelder zäh
    base *= BAL.terrainResist[h.terrain] || 1;
    if (h.river) base *= BAL.riverResist;
    // Wehrturm in Reichweite: Miliz der umliegenden Felder verstärkt
    if (h.owner && this._towerNear(h)) base *= BAL.turm.boost;
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
      if (nat.gold < t.gold || nat.leute < t.mp) return null;
      nat.gold -= t.gold; nat.leute -= t.mp;
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
      front: null,
      station: null,
      path: null, pathI: 0, moveProgress: 0,
      queue: [],
      attackTarget: null,
      inCombat: false,
      // Menschliche Divisionen sind MANUELL: sie warten auf Befehle statt
      // automatisch zur Front zu laufen — auf allen Clients identisch.
      manual: !nat.ai,
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

  /* Ausbildungsstätte? Städte, Hauptstadt und Kasernen bilden Truppen aus */
  isTrainSite(h, nation) {
    return !!h && h.owner === nation
      && (h.capital || h.building === 'stadt' || h.building === 'kaserne');
  }

  /* Truppe am Standort in die Ausbildung geben (Warteschlange, Kosten sofort).
     Kasernen bilden doppelt so schnell aus; die Division spawnt am Standort. */
  queueTraining(nation, c, r, type) {
    const h = this.hexAt(c, r);
    if (!this.isTrainSite(h, nation)) return 'Nur in Städten, der Hauptstadt oder Kasernen';
    const t = BAL.divTypes[type];
    if (!t) return 'Unbekannter Typ';
    const nat = this.nations[nation];
    if (nat.gold < t.gold) return `Zu wenig Gold (${t.gold})`;
    if (nat.leute < t.mp) return `Zu wenig 👥 Leute (${t.mp}k) — Dörfer/Städte/Fischereien!`;
    if (t.eisen && nat.eisen < t.eisen) return `Zu wenig 🔩 Eisen (${t.eisen}) — Minen fördern es`;
    if (t.pferde && nat.pferde < t.pferde) return `Zu wenig 🐎 Pferde (${t.pferde}) — Farmen züchten sie`;
    nat.gold -= t.gold;
    nat.leute -= t.mp;
    if (t.eisen) nat.eisen -= t.eisen;
    if (t.pferde) nat.pferde -= t.pferde;
    const dauer = BAL.trainTime[type] * (h.building === 'kaserne' ? BAL.kaserneTrainFactor : 1);
    // hinter dem letzten Auftrag DIESES Standorts anstellen
    let start = this.dayFloat;
    for (const q of this.training) if (q.c === c && q.r === r) start = Math.max(start, q.ready);
    this.training.push({ c, r, nation, type, ready: start + dauer });
    return true;
  }

  /* Fertige Ausbildungen ausrücken lassen (läuft im festen Takt) */
  trainingTick() {
    if (!this.training.length) return;
    for (let i = this.training.length - 1; i >= 0; i--) {
      const q = this.training[i];
      if (this.dayFloat < q.ready) continue;
      this.training.splice(i, 1);
      if (this.nations[q.nation] && this.nations[q.nation].alive)
        this.spawnDivisionAt(q.nation, q.type, q.c, q.r);
    }
  }

  /* Fertig ausgebildete Division: spawnt am Ausbildungsort (Kosten schon bezahlt) */
  spawnDivisionAt(nation, type, c, r) {
    const nat = this.nations[nation];
    const t = BAL.divTypes[type];
    if (!nat || !t) return null;
    let h = this.hexAt(c, r);
    if (!h || h.owner !== nation || h.terrain === 'water') {
      // Standort verloren: an der Hauptstadt ausrücken
      h = nat.capital ? this.hexAt(...nat.capital) : null;
      if (!h || h.owner !== nation) {
        const own = this.ownedHexes(nation).filter(x => x.terrain !== 'water');
        if (!own.length) return null;
        h = own[0];
      }
    }
    const p = hexToPixel(h.c, h.r);
    const div = {
      id: this._divSeq++,
      name: `${nat.divNameSeq++}. ${t.name}division`,
      nation, type,
      c: h.c, r: h.r, x: p.x, y: p.y,
      str: 85, org: t.maxOrg * 0.6, moral: 1.0,
      army: nat.armies[0] ? nat.armies[0].id : null,
      front: null, station: null,
      path: null, pathI: 0, moveProgress: 0,
      queue: [],
      attackTarget: null, inCombat: false,
      manual: !nat.ai,
      dead: false,
    };
    this.divisions.push(div);
    if (this._divIndex) {
      const k = div.c + div.r * MAP_W;
      const arr = this._divIndex.get(k);
      if (arr) arr.push(div); else this._divIndex.set(k, [div]);
    }
    this._frontsDirtyIds.add(nation);
    this.economyDirty = true;
    if (nation === this.player)
      this.addLog(`🎖️ ${div.name} einsatzbereit${h.cityName ? ' — ' + h.cityName : ''}!`);
    return div;
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
    const t = BAL.divTypes[div.type];
    this.nations[div.nation].leute += (div.str / 100) * t.mp * 0.5;
    this.economyDirty = true;
  }

  /* Division teilen: zwei halbe Divisionen auf DEMSELBEN Feld (S-Taste) —
     Stapel zeigen ihre Anzahl, Klick aufs Feld listet die Armeen. */
  splitDivision(div) {
    if (div.dead || div.str < 40) return null;
    const nat = this.nations[div.nation];
    const t = BAL.divTypes[div.type];
    const half = div.str / 2;
    div.str = half;
    const p = hexToPixel(div.c, div.r);
    const twin = {
      id: this._divSeq++,
      name: `${nat.divNameSeq++}. ${t.name}division`,
      nation: div.nation, type: div.type,
      c: div.c, r: div.r, x: p.x, y: p.y,
      str: half, org: div.org, moral: div.moral,
      army: div.army, front: div.front, station: null,
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
        if (overflow > 0 && nat) nat.leute += overflow * BAL.reinforceMpCost;
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

  /* Steht ein eigener Wehrturm in Reichweite? (Level 2 = doppelte Reichweite) */
  _towerNear(h) {
    for (const t of this._tuerme) {
      if (t.building !== 'turm' || t.owner !== h.owner) continue;
      const range = (t.level || 1) >= 2 ? BAL.turm.range2 : BAL.turm.range;
      if (hexDist(t.c, t.r, h.c, h.r) <= range) return true;
    }
    return false;
  }

  /* Miliz-Obergrenzen rund um einen (neuen/verlorenen) Turm neu setzen */
  refreshTowerRing(h) {
    for (let dr = -BAL.turm.range2; dr <= BAL.turm.range2; dr++) {
      for (let dc = -BAL.turm.range2 - 1; dc <= BAL.turm.range2 + 1; dc++) {
        const x = this.hexAt(h.c + dc, h.r + dr);
        if (!x || x.terrain === 'water' || hexDist(h.c, h.r, x.c, x.r) > BAL.turm.range2) continue;
        this.setResist(x);
        if (x.resist < x.resistMax) this._damagedHexes.add(x);
      }
    }
  }

  /* Stadt-Ausbau: Straßen wachsen automatisch zu nahen eigenen Städten —
     schnellere Truppen, bessere Versorgung, Brücken über Flüsse */
  connectCities(h) {
    const cities = [];
    for (const row of this.hexes) for (const x of row) {
      if (x !== h && x.owner === h.owner && (x.capital || x.building === 'stadt')) cities.push(x);
    }
    cities.sort((a, b) => hexDist(h.c, h.r, a.c, a.r) - hexDist(h.c, h.r, b.c, b.r));
    let built = 0;
    for (const city of cities) {
      if (built >= 2 || hexDist(h.c, h.r, city.c, city.r) > 14) break;
      const path = this.findPath(h.owner, h.c, h.r, city.c, city.r, true);
      if (!path) continue;
      for (const [pc, pr] of path) {
        const ph = this.hexAt(pc, pr);
        if (ph && ph.owner === h.owner && ph.terrain !== 'water' && !ph.road) {
          ph.road = true;
          this.markDirty(pc, pr);
        }
      }
      built++;
    }
    if (built) this._supplyDirtyIds.add(h.owner);
    return built;
  }

  /* ---------- Bauen ----------
     Vier Wirtschaftsgebäude + Kaserne + Straße. Gleiches Gebäude nochmal
     bauen = Ausbau auf Level 2/3 (Kosten & Ertrag skalieren mit dem Level). */
  buildCost(h, what) {
    const up = h && h.building === what && what !== 'strasse';
    return BAL.cost[what] * (up ? (h.level || 1) + 1 : 1);
  }

  canBuild(nation, h, what) {
    if (!h) return 'Kein Feld';
    if (!BAL.cost[what]) return 'Gibt es nicht mehr';
    // Fischerei ist das einzige Gebäude im Meer — auf Küstenwasser neben eigenem Land
    if (what === 'fischerei') {
      if (h.terrain !== 'water') return 'Nur auf Küstenwasser';
      if (h.owner && h.owner !== nation) return 'Fremdes Gewässer';
      if (h.building === 'fischerei') {
        if ((h.level || 1) >= BAL.maxLevel) return `Schon Level ${BAL.maxLevel} (max.)`;
      } else if (h.building) return 'Feld belegt';
      if (!neighborsOf(h.c, h.r).some(([nc, nr]) => {
        const nh = this.hexAt(nc, nr);
        return nh && nh.owner === nation && nh.terrain !== 'water';
      })) return 'Braucht eigenes Land am Ufer';
    } else if (h.owner !== nation) {
      return 'Nicht dein Gebiet';
    } else if (what === 'strasse') {
      if (h.terrain === 'water') return 'Nicht im Meer';
      if (h.road) return 'Bereits Straße';
    } else if (what === 'stadt') {
      if (h.building === 'stadt') return 'Schon eine Stadt';
      if (h.building !== 'dorf') return 'Braucht ein Dorf (Ausbau)';
    } else {
      if (!TERRAIN[h.terrain].buildable) return TERRAIN[h.terrain].name + ' — nicht bebaubar';
      if (what === 'forsterei' && h.terrain !== 'forest') return 'Nur im Wald';
      if (what === 'farm' && h.terrain !== 'plains') return 'Nur auf Ebenen';
      if (h.building === what) {
        const cap = what === 'turm' ? BAL.turm.maxLevel : BAL.maxLevel;
        if ((h.level || 1) >= cap) return `Schon Level ${cap} (max.)`;
      } else if (h.building) return 'Feld belegt';
    }
    const cost = this.buildCost(h, what);
    if (this.nations[nation].gold < cost) return `Zu wenig Gold (${cost})`;
    return true;
  }

  build(nation, h, what) {
    const ok = this.canBuild(nation, h, what);
    if (ok !== true) return ok;
    this.nations[nation].gold -= this.buildCost(h, what);
    if (what === 'strasse') h.road = true;
    else if (what === 'stadt') {
      h.building = 'stadt';
      h.level = 1;
      this.setResist(h);
      const roads = this.connectCities(h);
      if (nation === this.player && roads)
        this.addLog(`🏙️ Neue Stadt — Straßen zu ${roads} Nachbarstadt/-städten wachsen von selbst!`);
    } else if (h.building === what) {
      h.level = (h.level || 1) + 1;   // Ausbau
      if (what === 'turm') this.refreshTowerRing(h);   // Level 2: doppelte Reichweite
    } else {
      h.building = what;
      h.level = 1;
      if (what === 'fischerei') h.owner = nation;   // Küstenwasser gehört jetzt dir
      this.setResist(h);
      if (what === 'kaserne') this._kasernen.push(h);
      else if (what === 'turm') { this._tuerme.push(h); this.refreshTowerRing(h); }
    }
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
      nat.eisenPerDay = 0;
      nat.pferdePerDay = 0;
      nat.hexCount = 0;
      nat.staedte = 0;
      nat.popCap = BAL.pop.base;   // Bevölkerungslimit: Basis + Gebäude + Land
    }
    this._kasernen = [];
    this._tuerme = [];
    for (const row of this.hexes) for (const h of row) {
      if (!h.owner) continue;
      const nat = this.nations[h.owner];
      if (!nat) continue;
      if (h.terrain !== 'water') { nat.hexCount++; nat.popCap += BAL.pop.perHex; }
      const lvl = h.level || 1;
      if (BAL.pop[h.building]) nat.popCap += BAL.pop[h.building] * (h.building === 'stadt' ? 1 : lvl);
      const y = BAL.yields[h.building];
      if (y) {
        // Gebäude-Ertrag × Level (Mine: Hügel-Bonus aufs Eisen)
        nat.incomePerDay += y.gold * lvl;
        nat.leutePerDay += y.leute * lvl;
        if (y.eisen) nat.eisenPerDay += ((h.terrain === 'hills' && y.hillsEisen) ? y.hillsEisen : y.eisen) * lvl;
        if (y.pferde) nat.pferdePerDay += y.pferde * lvl;
      } else if (h.building === 'stadt') {
        nat.incomePerDay += BAL.incomeStadt; nat.leutePerDay += BAL.leuteStadt; nat.staedte++;
      } else if (h.building === 'kaserne') {
        this._kasernen.push(h);
      } else if (h.building === 'turm') {
        this._tuerme.push(h);
      } else {
        // Unbebautes Land arbeitet passiv — viel schwächer als jedes Gebäude
        const p = BAL.passive[h.terrain];
        if (p) { nat.incomePerDay += p.gold; nat.leutePerDay += p.leute; }
      }
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
      // Pleite: Kasse leer UND laufendes Minus — der Sold bleibt aus
      const brokeNow = nat.gold <= 0.01 && nat.incomePerDay < 0;
      if (brokeNow && !nat._broke && nat.id === this.player)
        this.addLog('💸 Staatskasse leer — der Sold bleibt aus, deine Truppen verlieren Moral! (Truppen auflösen oder Wirtschaft bauen)', true);
      nat._broke = brokeNow;
      // Bevölkerungslimit: Wachstum stoppt am Cap, Überschuss baut sich ab
      const cap = nat.popCap || 999;
      if (nat.leute < cap) nat.leute = Math.min(cap, nat.leute + nat.leutePerDay * dt);
      else nat.leute = Math.max(cap, nat.leute - 0.4 * dt);
      // Rohstoffe: Minen fördern Eisen, Farmen züchten Pferde (Lager 999)
      nat.eisen = Math.min(999, nat.eisen + nat.eisenPerDay * dt);
      nat.pferde = Math.min(999, nat.pferde + nat.pferdePerDay * dt);
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
    div.front = null;              // Marschbefehl löst von der Frontlinie
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
    // Aus der Frontlinie lösen — Truppe wird frei und wartet auf Befehle
    div.front = null;
    div.station = null;
    div.path = null;
    div.queue = [];
  }

  /* =========================================================
     FRONTLINIEN (War-of-Dots-Stil)
     Grenz-Front: Strg+Klick auf die Grenze zu einem Spieler —
     folgt dem Grenzverlauf automatisch. Gezogene Linie (B):
     hält eine feste Stellung. Zugewiesene Truppen verteilen
     sich selbst auf der Linie und kämpfen dort.
     ========================================================= */
  frontById(id) { return this.fronts.find(f => f.id === id) || null; }
  frontDivisions(f) { return this.divisions.filter(d => !d.dead && d.front === f.id); }

  createBorderFront(owner, target) {
    let f = this.fronts.find(x => x.owner === owner && x.kind === 'border' && x.target === target);
    if (!f) {
      f = { id: this._frontSeq++, owner, kind: 'border', target, path: null, hexes: [], push: null };
      this.fronts.push(f);
      this.refreshFront(f);
    }
    return f;
  }

  createLineFront(owner, path) {
    const clean = [];
    const seen = new Set();
    for (const p of path || []) {
      const h = this.hexAt(p[0], p[1]);
      if (!h || h.terrain === 'water') continue;
      const k = p[0] + p[1] * MAP_W;
      if (seen.has(k)) continue;
      seen.add(k);
      clean.push([p[0], p[1]]);
    }
    if (clean.length < 2) return null;
    const f = { id: this._frontSeq++, owner, kind: 'line', target: null, path: clean, hexes: [], push: null };
    this.fronts.push(f);
    this.refreshFront(f);
    return f;
  }

  refreshFront(f) {
    if (f.kind === 'border') {
      const pseudo = { nation: f.owner, target: f.target, frontHexes: [] };
      this.computeFront(pseudo);
      f.hexes = pseudo.frontHexes;
    } else {
      f.hexes = f.path.map(p => this.hexAt(p[0], p[1])).filter(h => h && h.owner === f.owner);
    }
  }

  assignToFrontline(divIds, frontId) {
    const f = this.frontById(frontId);
    if (!f) return 0;
    let n = 0;
    for (const id of divIds) {
      const d = this._divById(id);
      if (!d || d.nation !== f.owner) continue;
      d.front = f.id;
      d.path = null; d.queue = []; d.attackTarget = null; d.station = null;
      n++;
    }
    this.distributeFrontline(f);
    return n;
  }

  distributeFrontline(f) {
    const divs = this.frontDivisions(f);
    const line = f.hexes;
    if (!divs.length || !line.length) return;
    const sorted = divs.map(d => {
      let bi = 0, bd = Infinity;
      line.forEach((h, i) => {
        const dd = hexDist(d.c, d.r, h.c, h.r);
        if (dd < bd) { bd = dd; bi = i; }
      });
      return [bi, d];
    }).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const used = new Set();
    sorted.forEach((d, i) => {
      const idx = sorted.length === 1 ? Math.floor(line.length / 2)
        : Math.round(i * (line.length - 1) / (sorted.length - 1));
      let h = line[Math.min(idx, line.length - 1)];
      if (used.has(h.c + h.r * MAP_W)) {
        const free = this.findFreeStation(f.owner, h, used);
        if (free) h = free;
      }
      used.add(h.c + h.r * MAP_W);
      d.station = [h.c, h.r];
    });
  }

  frontsDaily() {
    for (let i = this.fronts.length - 1; i >= 0; i--) {
      const f = this.fronts[i];
      const divs = this.frontDivisions(f);
      const ownerDead = !this.nations[f.owner] || !this.nations[f.owner].alive;
      const targetDead = f.kind === 'border' && (!this.nations[f.target] || !this.nations[f.target].alive);
      if (ownerDead || targetDead) {
        for (const d of divs) d.front = null;
        this.fronts.splice(i, 1);
        continue;
      }
      this.refreshFront(f);
      if (f.push) {
        const ph = this.hexAt(f.push[0], f.push[1]);
        if (!ph || ph.terrain === 'water' || ph.owner === f.owner) {
          f.push = null;
          if (f.owner === this.player) this.addLog('🎯 Vormarschziel erreicht — die Front hält die neue Linie.', true);
        }
      }
      if (divs.length) f._empty = undefined;
      else if (f._empty === undefined) f._empty = this.day;
      if ((f._empty !== undefined && this.day - f._empty > 20)
        || (f.kind === 'line' && !f.hexes.length)) {
        for (const d of divs) d.front = null;
        this.fronts.splice(i, 1);
        continue;
      }
      this.distributeFrontline(f);
    }
  }

  /* Ziel für eine Front-Truppe: Nachbarfelder gemäß Auftrag der Linie */
  pickFrontTarget(div) {
    const f = this.frontById(div.front);
    if (!f) { div.front = null; return null; }
    // Vormarsch: Ziel gesetzt → alles Angreifbare Richtung Ziel nehmen
    if (f.push) {
      const [pc, pr] = f.push;
      const cur = hexDist(div.c, div.r, pc, pr);
      const t = this.scoreTargets(div,
        nh => this.attackable(div.nation, nh) && hexDist(nh.c, nh.r, pc, pr) <= cur,
        nh => (cur - hexDist(nh.c, nh.r, pc, pr)) * 5);
      if (t) return t;
    }
    return this.scoreTargets(div, nh => {
      if (f.kind === 'border') return nh.owner === f.target && this.hostile(div.nation, f.target);
      return this.attackable(div.nation, nh) && nh.owner !== null;   // gezogene Linie: Feinde abwehren
    });
  }

  /* Passives Nibbeln: freies Nachbarfeld zufällig erobern (Warteschlangen-Gefühl) */
  pickNeutralNibble(div) {
    if (this.day < 1) return null;
    const cands = [];
    for (const [nc, nr] of neighborsOf(div.c, div.r)) {
      const nh = this.hexAt(nc, nr);
      if (nh && nh.terrain !== 'water' && nh.owner === null) cands.push(nh);
    }
    if (!cands.length) return null;
    return cands[Math.floor(this.rand() * cands.length)];
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
        const t = BAL.divTypes[div.type];
        if (div.org > t.maxOrg * 0.35) {
          const sup = this.supplyModOf(div);
          if (sup.level > 0.12) {
            let target = null;
            // 1) Frontlinien-Dienst: dort kämpfen, wo die Linie es verlangt
            if (div.front != null) {
              target = this.pickFrontTarget(div);
            } else if (div.army != null && !div.manual) {
              // Bots: klassische Armee-Logik
              const army = this.armyById(div.nation, div.army);
              if (army && army.mode === 'attack' && div.org > t.maxOrg * 0.45)
                target = this.pickAttackTarget(div, army);
            }
            // 2) Passives Nibbeln: jede Truppe erobert freies Nachbarland von selbst
            if (!target) target = this.pickNeutralNibble(div);
            if (target) div.attackTarget = [target.c, target.r];
          }
        }
      }
    }
  }

  pickAttackTarget(div, army) {
    return this.scoreTargets(div, nh => this.frontMatches(army, nh));
  }

  scoreTargets(div, matchFn, biasFn) {
    const myPow = this.attackPower(div);
    let best = null, bestScore = -Infinity;
    for (const [nc, nr] of neighborsOf(div.c, div.r)) {
      const nh = this.hexAt(nc, nr);
      if (!nh || nh.terrain === 'water' || !matchFn(nh)) continue;
      if (!this.attackable(div.nation, nh)) continue;
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
      if (biasFn) score += biasFn(nh);
      if (score > bestScore) { bestScore = score; best = nh; }
    }
    return best;
  }

  attackPower(div) {
    const t = BAL.divTypes[div.type];
    const sup = this.supplyModOf(div);
    const h = this.hexAt(div.c, div.r);
    const pocket = h && h._pocket ? 0.55 : 1;   // eingekesselt: kaum Kampfkraft (HOI)
    return (div.str / 100) * div.moral * sup.mod * t.atk * pocket;
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
    targetHex._atkBy = atk.nation;   // fürs Einfärben der Eroberungs-Animation
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
      // Truppendreieck: Krieger > Kavallerie > Kanonen > Krieger
      power *= (BAL.rps[atk.type] && BAL.rps[atk.type][def.type]) || 1;
      const defPower = this.attackPower(def) * defT.defF * dRand
        * ((BAL.rps[def.type] && BAL.rps[def.type][atk.type]) || 1);
      // Endphase: Angreifer schlagen härter durch — Stellungskriege lösen sich,
      // Hauptstädte fallen, die Runde findet ihren Sieger
      const lateAtk = 1 + 0.8 * this.lateFactor();
      const dh = this.hexAt(def.c, def.r);
      const pocketDmg = dh && dh._pocket ? 1.45 : 1;   // im Kessel: leicht zu vernichten
      def.org -= power * BAL.atkBase * BAL.orgDmg * lateAtk * pocketDmg * dt;
      def.str -= power * BAL.atkBase * BAL.strDmg * lateAtk * pocketDmg * dt;
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
    if (h.building === 'turm') this.refreshTowerRing(h);   // Turm wirkt jetzt für den Eroberer
    this._damagedHexes.add(h);
    // Die Truppe bleibt STEHEN — das Land wird von der Position aus übernommen
    // (War-of-Dots). War das Feld das Marschziel, ist der Befehl erledigt;
    // führt der Pfad weiter, marschiert sie im nächsten Schritt normal durch.
    if (div.path && div.pathI >= div.path.length - 1
      && div.path[div.path.length - 1][0] === h.c && div.path[div.path.length - 1][1] === h.r) {
      div.path = null;
      if (div.manual) div.station = [div.c, div.r];
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
    if (own.length < 10) { this.surrender(loser, winner); return; }
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
    // Nur Landbesitz zählt — eine einsame Fischerei hält kein Reich am Leben
    if (!this.ownedHexes(loser).some(h => h.terrain !== 'water')) this.surrender(loser, winner);
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
          if (h.capital || h.building === 'stadt' || h.building === 'kaserne') hasHub = true;
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

  /* ---------- Umzingelt = verloren ----------
     Kleine Gebiete (neutral ODER feindlich), die vollständig von EINER
     Nation umschlossen sind, fallen kampflos an den Umzingler — wie in
     Hearts of Iron. Hauptstädte, Siegpunkte und verteidigende Divisionen
     verhindern den Fall. */
  encircleDaily() {
    if (this.day < 2) return;
    const divAt = new Map();   // Feld -> Nationen der dort stehenden Divisionen
    for (const d of this.divisions) {
      if (d.dead) continue;
      const k = d.c + d.r * MAP_W;
      const arr = divAt.get(k);
      if (arr) arr.push(d.nation); else divAt.set(k, [d.nation]);
    }
    const seen = new Set();
    for (const row of this.hexes) for (const start of row) {
      if (start.terrain === 'water') continue;
      const sk = start.c + start.r * MAP_W;
      if (seen.has(sk)) continue;
      seen.add(sk);
      const owner = start.owner;
      const comp = [start];
      const bound = new Set();      // Land-Besitzer rund um das Gebiet
      const inside = new Set();     // Nationen mit Divisionen im Gebiet
      let blocked = false;
      let seaAccess = false;        // Meerzugang = NICHT eingezäunt (nur echte Farb-Zäune zählen)
      for (let i = 0; i < comp.length; i++) {
        const h = comp[i];
        if (h.capital || h.vp) blocked = true;
        const dn = divAt.get(h.c + h.r * MAP_W);
        if (dn) for (const n of dn) inside.add(n);
        for (const [nc, nr] of neighborsOf(h.c, h.r)) {
          const nh = this.hexAt(nc, nr);
          if (!nh) continue;
          if (nh.terrain === 'water') { seaAccess = true; continue; }
          if (nh.owner === owner) {
            const nk = nc + nr * MAP_W;
            if (!seen.has(nk)) { seen.add(nk); comp.push(nh); }
          } else {
            bound.add(nh.owner || '~');
          }
        }
      }
      if (blocked || seaAccess || comp.length > 12 || bound.size !== 1) continue;
      const N = [...bound][0];
      if (N === '~' || !this.nations[N] || !this.nations[N].alive) continue;
      if (owner && (this.day < BAL.graceDays || !this.hostile(N, owner))) continue;
      if ([...inside].some(n => n !== N)) continue;   // Verteidiger drin: kein Autofall
      for (const h of comp) {
        h.owner = N;
        this.setResist(h);
        h.resist = h.resistMax * 0.5;
        this._damagedHexes.add(h);
        this.markDirty(h.c, h.r);
      }
      this._supplyDirtyIds.add(N);
      this._frontsDirtyIds.add(N);
      this._borderCache = null;
      this.economyDirty = true;
      this.labelsDirty = true;
      if (owner) {
        this._supplyDirtyIds.add(owner);
        this._frontsDirtyIds.add(owner);
        this.warHeat[[N, owner].sort().join('|')] = this.day;
        this.addLog(`🔒 Umzingelt! ${comp.length} Provinz(en) von ${this.nationName(owner)} fallen kampflos an ${this.nationName(N)}.`, owner === this.player || N === this.player);
        this.checkElimination(owner, N);
      } else if (N === this.player) {
        this.addLog(`🔒 Eingekreist — ${comp.length} neutrale Provinz(en) schließen sich dir an!`);
      }
    }
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
    const need = this.vpNeed || BAL.round.vpToWin;
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

    // Dominanz-Sieg: wer 80 % der Landfläche hält, gewinnt sofort
    for (const id of alive) {
      if (this.nations[id].hexCount >= this.totalLand * BAL.round.domination) {
        const pct = Math.round(this.nations[id].hexCount / this.totalLand * 100);
        this.over = {
          win: id === this.player,
          text: id === this.player
            ? `Du kontrollierst ${pct} % Europas — totaler Sieg!`
            : `${this.nationName(id)} kontrolliert ${pct} % Europas — die Runde ist entschieden.`,
        };
        return;
      }
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

  /* ---------- Regeneration / Verschleiß ---------- */
  regenTick(dt) {
    for (const div of this.divisions) {
      if (div.dead) continue;
      const t = BAL.divTypes[div.type];
      const nat = this.nations[div.nation];
      const sup = this.supplyModOf(div);

      if (!div.inCombat) {
        div.org = Math.min(t.maxOrg, div.org + BAL.orgRegen * sup.mod * div.moral * dt);
        // Verstärkung rekrutiert immer normale Leute
        if (div.str < BAL.maxStr && sup.level > 0.4 && nat.leute > 0.5) {
          const pts = Math.min(BAL.reinforceRate * dt, BAL.maxStr - div.str, nat.leute / BAL.reinforceMpCost);
          div.str += pts;
          nat.leute -= pts * BAL.reinforceMpCost;
        }
      }
      div.moral += (1.0 - div.moral) * BAL.moralBaselinePull * dt;
      if (nat._broke) div.moral -= BAL.brokeMoralDrain * dt;   // kein Sold = sinkende Moral
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

    // Vier Gebäude, klare Rollen: die KI verfolgt EIN Sparziel nach dem
    // anderen — sonst verzettelt sie sich in billigen Bauten (Oszillation).
    const doerfer = count('dorf'), fischereien = count('fischerei');
    const minen = count('mine'), forstereien = count('forsterei');
    const farmen = count('farm');
    const kasernen = count('kaserne');
    const leuteGeb = doerfer + fischereien;
    const goldGeb = forstereien;
    const landN = nat.hexCount || own.length;
    const wantKas = 1 + Math.floor(landN / 45);
    const wantLeute = Math.max(2, kasernen * 2, Math.floor(landN * 0.08));
    const wantGold = Math.max(1, Math.floor(landN * 0.10));
    const spotNear = maxDist => () => this.findBuildSpot(id, cc, cr, buildable, maxDist, own);
    const forestSpot = () => this.findBuildSpot(id, cc, cr, x => x.terrain === 'forest' && !x.building, 24, own);
    // Fischerei: freies Küstenwasser neben eigenem Land
    const fischSpot = () => {
      for (const h of own) {
        if (h.terrain === 'water') continue;
        for (const [nc, nr] of neighborsOf(h.c, h.r)) {
          const nh = this.hexAt(nc, nr);
          if (nh && nh.terrain === 'water' && !nh.building && !nh.owner) return nh;
        }
      }
      return null;
    };

    const plan = [];
    if (leuteGeb < 1) plan.push(['dorf', spotNear(14)]);
    if (kasernen < wantKas) plan.push(['kaserne', spotNear(14)]);
    // Leute-Mangel (< 20 Tage Ausbildungs-Reserve): Leute-Gebäude zuerst —
    // Fischerei bevorzugt (mehr Leute), sonst Dorf
    if ((nat.leute < 15 || nat.leute > (nat.popCap || 99) * 0.85) && leuteGeb < wantLeute) {
      plan.push(['fischerei', fischSpot]);
      plan.push(['dorf', spotNear(16)]);
    }
    if (goldGeb < wantGold) {
      plan.push(['forsterei', forestSpot]);   // Gold kommt aus dem Wald
      plan.push(['dorf', spotNear(16)]);
    }
    // Rüstungsgüter: Minen (🔩 Kanonen) und Farmen (🐎 Kavallerie)
    if (minen < 1 + Math.floor(landN / 45)) plan.push(['mine', spotNear(18)]);
    if (farmen < 1 + Math.floor(landN / 55))
      plan.push(['farm', () => this.findBuildSpot(id, cc, cr, x => x.terrain === 'plains' && !x.building, 20, own)]);
    // Stadt-Ausbau: ab ~40 Provinzen ein Dorf zur Stadt machen (Hub + Auto-Straßen)
    const staedte = count('stadt');
    if (staedte < 1 + Math.floor(landN / 40) && nat.leute > 5)
      plan.push(['stadt', () => own.find(x => x.building === 'dorf') || null]);
    // Wehrturm: wer angegriffen wird, befestigt das Hinterland
    if (this.day - nat._lastAttackedDay < 30 && count('turm') < 1 + Math.floor(landN / 70))
      plan.push(['turm', spotNear(10)]);
    if (leuteGeb < wantLeute) plan.push(['dorf', spotNear(16)]);
    // Reiche Nationen bauen aus: bestehende Gold-Gebäude auf Level 2/3
    if (nat.gold > 420) {
      const up = own.find(h => (h.building === 'mine' || h.building === 'forsterei') && (h.level || 1) < BAL.maxLevel);
      if (up) plan.push([up.building, () => up]);
    }

    for (const [what, findSpot] of plan) {
      const spot = findSpot();
      if (!spot) continue;                             // kein Platz → nächstes Ziel
      if (nat.gold < this.buildCost(spot, what)) return;  // sparen aufs wichtigste erreichbare Ziel
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
    const cap = Math.floor(4 + Math.min(10, Math.max(0, nat.incomePerDay) / 5) + nat.hexCount / 35);
    const divs = this.divisionsOf(id);
    if (divs.length >= cap) return;
    let type = 'inf';
    const roll = this.rand();
    // Elite-Einheiten nur, wenn die Rohstoffe im Lager liegen
    if (nat.eisen >= BAL.divTypes.kan.eisen && nat.gold > 350 && roll < 0.3) type = 'kan';
    else if (nat.pferde >= BAL.divTypes.kav.pferde && nat.gold > 250 && roll < 0.6) type = 'kav';
    const tt = BAL.divTypes[type];
    const underAttack = this.day - nat._lastAttackedDay < 12;
    // In Friedenszeiten Wirtschaft vor Masse: erst bauen (Stadt = 270 G),
    // Divisionen nur vom Überschuss. Ausnahme: Armee stark dezimiert
    // (Nachkriegs-Wiederaufbau) — dann zügig nachrüsten.
    const buffer = underAttack ? 10 : (divs.length < cap * 0.5 ? 60 : 220);
    const pending = this.training.reduce((n, q) => n + (q.nation === id ? 1 : 0), 0);
    if (pending >= 2) return;   // nicht überbuchen — Nachschub kommt schon
    if (nat.gold >= tt.gold + buffer && nat.leute >= tt.mp
      && (!tt.eisen || nat.eisen >= tt.eisen) && (!tt.pferde || nat.pferde >= tt.pferde)) {
      // Kaserne bevorzugt (doppelt so schnell), sonst Hauptstadt
      const site = this._kasernen.find(k => k.owner === id && k.building === 'kaserne')
        || (nat.capital ? this.hexAt(...nat.capital) : null);
      if (site && this.isTrainSite(site, id)) this.queueTraining(id, site.c, site.r, type);
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
    if (this._net) return;   // Multiplayer: der Server taktet (net.js ruft runTick)
    // Spawn-Phase blockiert die Uhr — außer im Replay (dort steuern die Kommandos)
    if (this.paused || this.over || (this.spawnPhase && !this._replayCmds)) return;
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
        this._execAs(c.n !== undefined && c.n !== null ? c.n : this.player, c.cmd, c.args);
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
    this.trainingTick();
    this.divisionsTick(dt);
    this.regenTick(dt);

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
      this.frontsDaily();
      this.supplyDaily();
      this.militiaDaily();
      this.aiDaily();
      this.vpDaily();
      this.pocketsDaily();
      this.encircleDaily();
      // Abgelaufene Bündnisangebote entfernen
      const before = this.allianceOffers.length;
      this.allianceOffers = this.allianceOffers.filter(o => this.day - o.day < BAL.offerLifetime);
      if (this.allianceOffers.length !== before) this._offersChanged = true;
      if (performance.now() - this._lastAutosave > 60000 && !this.over && !this._replayCmds && !this._net) {
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
      v: 5, mapId: this.mapId, slots: this._slots, day: this.day, dayFloat: this.dayFloat, player: this.player,
      divSeq: this._divSeq, armySeq: this._armySeq,
      vpLeader: this.vpLeader, vpDeadline: this.vpDeadline,
      seed: this.seed, rngState: this._rngState, tickCount: this.tickCount,
      cmds: this._replayCapable ? this.cmdLog : undefined,
      warHeat: this.warHeat,
      training: this.training,
      exAllies: this._exAllies,
      frontSeq: this._frontSeq,
      fronts: this.fronts.map(f => ({ id: f.id, owner: f.owner, kind: f.kind, target: f.target, path: f.path, push: f.push || null })),
      hexes: this.hexes.flat().map(h => [h.owner, h.building, h.road ? 1 : 0, h.capital ? 1 : 0, Math.round(h.resist), h.building ? (h.level || 1) : 0]),
      nations: Object.fromEntries(Object.entries(this.nations).map(([id, n]) => [id, {
        alive: n.alive, gold: Math.round(n.gold), leute: +n.leute.toFixed(2), eisen: +n.eisen.toFixed(1), pferde: +n.pferde.toFixed(1),
        traitorUntil: n.traitorUntil,
        allies: [...n.allies], capital: n.capital, divNameSeq: n.divNameSeq,
        armies: n.armies.map(a => ({ id: a.id, name: a.name, target: a.target, mode: a.mode })),
      }])),
      divisions: this.divisions.filter(d => !d.dead).map(d => ({
        id: d.id, name: d.name, nation: d.nation, type: d.type, c: d.c, r: d.r,
        str: Math.round(d.str), org: Math.round(d.org), moral: +d.moral.toFixed(2),
        army: d.army, manual: d.manual, front: d.front,
      })),
    });
  }

  static deserialize(json) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return null; }
    if (!s || (s.v !== 3 && s.v !== 4 && s.v !== 5) || !Array.isArray(s.hexes)) return null;
    const mapDef = GENMAPS[s.mapId || 'europa'];
    if (!mapDef || s.hexes.length !== mapDef.w * mapDef.h) return null;
    if (!NATION_DEFS[s.player]) return null;
    const g = new Game(s.player, s.seed !== undefined ? s.seed : 1, s.mapId || 'europa', undefined, s.slots || 5);
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
      h.owner = null; h.building = null; h.level = 0; h.road = false; h.capital = false;
    }
    s.hexes.forEach((hs, i) => {
      const h = flat[i];
      h.owner = hs[0];
      h.building = hs[1] === 'hafen' ? null : hs[1];   // Häfen gibt es nicht mehr
      h.level = h.building ? (hs[5] || 1) : 0;
      h.road = !!hs[2]; h.capital = !!hs[3];
      g.setResist(h); h.resist = hs[4];
    });
    for (const [id, ns] of Object.entries(s.nations)) {
      const n = g.nations[id];
      if (!n) continue;
      n.alive = ns.alive; n.gold = ns.gold;
      // Alt-Spielstände: Soldaten-Pool wird zu Leuten, Rohstoffe starten mit Grundstock
      n.leute = ns.leute !== undefined ? ns.leute : 20;
      if (ns.soldaten) n.leute += ns.soldaten * 0.5;
      n.eisen = ns.eisen !== undefined ? ns.eisen : 10;
      n.pferde = ns.pferde !== undefined ? ns.pferde : 8;
      n.traitorUntil = ns.traitorUntil !== undefined ? ns.traitorUntil : -999;
      n.allies = new Set(ns.allies); n.capital = ns.capital; n.divNameSeq = ns.divNameSeq;
      n.armies = ns.armies.map(a => ({ ...a, nation: id, frontHexes: [] }));
    }
    for (const ds of s.divisions) {
      if (!BAL.divTypes[ds.type]) continue;
      const p = hexToPixel(ds.c, ds.r);
      g.divisions.push({
        front: null,
        ...ds, x: p.x, y: p.y, station: null, path: null, pathI: 0,
        moveProgress: 0, queue: [], attackTarget: null, inCombat: false, dead: false,
      });
    }
    g.spawnPhase = false;
    g._frontSeq = s.frontSeq || 1;
    g.fronts = (s.fronts || []).map(f => ({ ...f, hexes: [] }));
    for (const f of g.fronts) g.refreshFront(f);
    for (const f of g.fronts) g.distributeFrontline(f);
    g.log = [];
    g.toasts = [];
    g.allianceOffers = [];
    g.warHeat = s.warHeat || {};
    g.training = Array.isArray(s.training) ? s.training : [];
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
    return { v: 1, seed: this.seed, player: this.player, mapId: this.mapId, humans: this._humans || undefined, slots: this._slots, cmds: this.cmdLog };
  }

  static fromReplay(rep) {
    if (!rep || rep.seed === undefined || !NATION_DEFS[rep.player]) return null;
    const g = new Game(rep.player, rep.seed, rep.mapId || 'europa', rep.humans, rep.slots || 5);
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
  // Multiplayer: Kommandos gehen zum Server und kommen als Step zurück
  if (this._net) return this._net.sendCmd(cmd, args);
  const fn = this._commands[cmd];
  if (!fn) return null;
  this.cmdLog.push({ t: this.tickCount, cmd, args });
  this._actor = this.player;
  const r = fn.apply(this, args);
  this._actor = null;
  return r;
};

/* Kommando im Namen einer bestimmten Nation ausführen (Multiplayer/Replay) */
Game.prototype._execAs = function (nation, cmd, args) {
  const fn = this._commands[cmd];
  if (!fn) return;
  this._actor = nation || this.player;
  fn.apply(this, args);
  this._actor = null;
};

/* Multiplayer: vom Server verteiltes Kommando anwenden (inkl. Replay-Log) */
Game.prototype.applyNetCmd = function (nation, cmd, args) {
  this.cmdLog.push({ t: this.tickCount, cmd, args, n: nation || undefined });
  this._execAs(nation, cmd, args || []);
};

Game.prototype._exec = function (cmd, args) {
  this._execAs(this.player, cmd, args);
};

Game.prototype._commands = {
  spawn(c, r) {
    const me = this._actor || this.player;
    return this.relocateSpawn(me, c, r);
  },
  startMatch() {
    this.endSpawnPhase();
  },
  /* Multiplayer: Verbindungsabbruch — die KI übernimmt die Nation */
  aiTakeover(id) {
    const nat = this.nations[id];
    if (!nat || nat.ai) return;
    nat.ai = true;
    for (const d of this.divisionsOf(id)) d.manual = false;
    this.addLog(`🔌 ${this.nationName(id)} hat die Verbindung verloren — die KI übernimmt.`, true);
  },
  move(divId, c, r, queue) {
    const me = this._actor || this.player;
    const d = this._divById(divId);
    if (d && d.nation === me) this.moveOrder(d, c, r, queue);
  },
  build(c, r, what) {
    const me = this._actor || this.player;
    return this.build(me, this.hexAt(c, r), what);
  },
  train(type, n) {
    // Kompatibilität (alte Replays): an der besten Stätte einreihen
    const me = this._actor || this.player;
    let done = 0;
    for (let i = 0; i < (n || 1); i++) {
      const site = this._kasernen.find(k => k.owner === me && k.building === 'kaserne')
        || (this.nations[me].capital ? this.hexAt(...this.nations[me].capital) : null);
      if (!site || this.queueTraining(me, site.c, site.r, type) !== true) break;
      done++;
    }
    return done;
  },
  trainAt(c, r, type) {
    const me = this._actor || this.player;
    return this.queueTraining(me, c, r, type);
  },
  split(divIds) {
    const me = this._actor || this.player;
    const twins = [];
    const fronts = new Set();
    for (const id of divIds) {
      const d = this._divById(id);
      if (d && d.nation === me) {
        const t = this.splitDivision(d);
        if (t) {
          twins.push(t.id);
          if (t.front != null) fronts.add(t.front);
        }
      }
    }
    // Geteilte Front-Truppen sofort neu auf der Linie verteilen
    for (const fid of fronts) {
      const f = this.frontById(fid);
      if (f) this.distributeFrontline(f);
    }
    return twins;
  },
  merge(divIds) {
    const me = this._actor || this.player;
    const divs = divIds.map(id => this._divById(id)).filter(d => d && d.nation === me);
    return this.mergeDivisions(divs);
  },
  disband(divIds) {
    const me = this._actor || this.player;
    let n = 0;
    for (const id of divIds) {
      const d = this._divById(id);
      if (d && d.nation === me) { this.disbandDivision(d); n++; }
    }
    return n;
  },
  frontBorder(targetId, divIds) {
    const me = this._actor || this.player;
    if (!this.nations[targetId] || targetId === me) return null;
    const f = this.createBorderFront(me, targetId);
    const n = this.assignToFrontline(divIds || [], f.id);
    return { id: f.id, n };
  },
  frontLine(path, divIds) {
    const me = this._actor || this.player;
    const f = this.createLineFront(me, path);
    if (!f) return null;
    const n = this.assignToFrontline(divIds || [], f.id);
    return { id: f.id, n };
  },
  frontAssign(frontId, divIds) {
    return this.assignToFrontline(divIds || [], frontId);
  },
  frontPush(frontId, c, r) {
    const me = this._actor || this.player;
    const f = this.frontById(frontId);
    if (!f || f.owner !== me) return false;
    f.push = (c === null || c === undefined) ? null : [c, r];
    return true;
  },
  frontRemove(frontId) {
    const me = this._actor || this.player;
    const i = this.fronts.findIndex(f => f.id === frontId && f.owner === me);
    if (i < 0) return false;
    for (const d of this.frontDivisions(this.fronts[i])) this.releaseToArmy(d);
    this.fronts.splice(i, 1);
    return true;
  },
  release(divIds) {
    const me = this._actor || this.player;
    for (const id of divIds) {
      const d = this._divById(id);
      if (d && d.nation === me) this.releaseToArmy(d);
    }
  },
  ally(to) {
    const me = this._actor || this.player;
    return this.offerAlliance(me, to);
  },
  unally(other) {
    const me = this._actor || this.player;
    this.dissolveAlliance(me, other, me);
  },
  answerOffer(from, accept) {
    const me = this._actor || this.player;
    this.resolveOffer(me, from, accept);
  },
};
