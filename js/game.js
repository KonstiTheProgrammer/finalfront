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
  // Wirtschaft (pro Tag)
  baseIncome: 2.0,
  incomeDorf: 1.0,
  incomeStadt: 4.0,
  incomeMine: 6.0,
  incomeMineBerg: 8.0,
  landIncomePerHex: 0.006,            // Territorium zahlt Steuern
  mpDorf: 0.06,
  mpStadt: 0.16,
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
  // Politik
  maxAllies: 2,
  offerLifetime: 40,
  // Sieg
  winLandShare: 0.55,
};

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function dateStr(day) {
  const d = new Date(1936, 0, 1 + day);
  return `${d.getDate()}. ${MONTHS_DE[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------- Spielzustand ---------- */
class Game {
  constructor(playerNationId) {
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
    this.recalcEconomy();
    this.recalcAllSupply();
    this.updateFronts();
    this.addLog(`🌍 Europa liegt brach, ${dateStr(0)}. Du führst ${this.nationName(playerNationId)} — breite dich aus!`, true);
  }

  /* ---------- Hilfen ---------- */
  hexAt(c, r) { return (this.hexes[r] && this.hexes[r][c]) || null; }
  nationName(id) { return NATION_DEFS[id] ? NATION_DEFS[id].name : '???'; }
  nationColor(id) { return NATION_DEFS[id] ? NATION_DEFS[id].color : '#999'; }

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
    if (this.allied(a, b)) return true;
    const heat = this.warHeat[[a, b].sort().join('|')];
    return heat === undefined || this.day - heat > BAL.trade.warCooldown;
  }

  /* Darf 'nation' das Hex angreifen? (Neutral: immer) */
  attackable(nation, h) {
    if (!h || h.terrain === 'water') return false;
    if (h.owner === null) return true;
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
    if (nTo.allies.size >= BAL.maxAllies) return false;
    if (this.nationPower(from) < this.nationPower(to) * 0.35) return false;
    // Nicht mit dem eigenen Angriffsziel verbünden
    for (const army of nTo.armies) if (army.target === from && army.mode === 'attack') return false;
    return Math.random() < 0.7;
  }

  formAlliance(a, b) {
    this.nations[a].allies.add(b);
    this.nations[b].allies.add(a);
    this.addLog(`🤝 Allianz geschlossen: ${this.nationName(a)} & ${this.nationName(b)}!`, a === this.player || b === this.player);
    this.frontsDirty = true;
  }

  dissolveAlliance(a, b) {
    if (!this.allied(a, b)) return;
    this.nations[a].allies.delete(b);
    this.nations[b].allies.delete(a);
    this.addLog(`💔 Die Allianz zwischen ${this.nationName(a)} und ${this.nationName(b)} ist zerbrochen.`, a === this.player || b === this.player);
    this.frontsDirty = true;
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

  /* Angrenzende feindliche Nationen (für UI & KI) */
  borderNationsOf(id) {
    const out = new Set();
    for (const row of this.hexes) for (const h of row) {
      if (h.owner !== id) continue;
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        const nh = this.hexAt(nc, nr);
        if (nh && nh.owner && nh.owner !== id && this.nations[nh.owner].alive) out.add(nh.owner);
      }
    }
    return [...out];
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
      manpower: 25,
      allies: new Set(),
      armies: [],
      ai: id !== this.player,
      aiTick: Math.floor(Math.random() * 6),
      capital: null,
      divNameSeq: 1,
      hexCount: 1,
      incomePerDay: 0, mpPerDay: 0,
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
    else if (h.capital) base = BAL.militiaResistHauptstadt;
    else if (h.building === 'stadt') base = BAL.militiaResistStadt;
    else base = BAL.militiaResist;
    h.resistMax = base;
    if (h.resist <= 0 || h.resist > base) h.resist = base;
  }

  findBuildSpot(nation, cc, cr, pred, maxDist = 24) {
    let best = null, bestD = Infinity;
    for (const row of this.hexes) for (const h of row) {
      if (h.owner !== nation || h.capital) continue;
      if (!pred(h)) continue;
      const d = hexDist(h.c, h.r, cc, cr) + Math.random() * 0.7;
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
      if (nat.gold < t.gold || nat.manpower < t.mp) return null;
      nat.gold -= t.gold; nat.manpower -= t.mp;
    }
    let spawn = null;
    const [cc, cr] = nat.capital || [0, 0];
    for (const row of this.hexes) for (const h of row) {
      if (h.owner === nation && h.building === 'kaserne') {
        if (!spawn || hexDist(h.c, h.r, cc, cr) < hexDist(spawn.c, spawn.r, cc, cr)) spawn = h;
      }
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
      attackTarget: null,
      inCombat: false,
      manual: false,
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
    if (n > 0) { this.frontsDirty = true; this.economyDirty = true; }
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
    this.frontsDirty = true;
    return true;
  }

  disbandDivision(div) {
    div.dead = true;
    this.nations[div.nation].manpower += (div.str / 100) * BAL.divTypes[div.type].mp * 0.5;
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
      attackTarget: null, inCombat: false,
      manual: div.manual, dead: false,
    };
    this.divisions.push(twin);
    if (this._divIndex) {
      const k = twin.c + twin.r * MAP_W;
      const arr = this._divIndex.get(k);
      if (arr) arr.push(twin); else this._divIndex.set(k, [twin]);
    }
    this.frontsDirty = true;
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
        if (overflow > 0 && nat) nat.manpower += overflow * BAL.reinforceMpCost;
        b.dead = true;
        merged++;
      }
    }
    if (merged) { this.frontsDirty = true; this.economyDirty = true; }
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
    this._supplyDirtyIds.add(nation);
    this.economyDirty = true;
    this.markDirty(h.c, h.r);
    return true;
  }

  /* ---------- Wirtschaft (1 Kartenscan, gecacht) ---------- */
  recalcEconomy() {
    for (const nat of Object.values(this.nations)) {
      nat.incomePerDay = BAL.baseIncome;
      nat.mpPerDay = 0;
      nat.hexCount = 0;
      nat.ports = 0;
    }
    for (const row of this.hexes) for (const h of row) {
      if (!h.owner) continue;
      const nat = this.nations[h.owner];
      if (!nat) continue;
      nat.hexCount++;
      nat.incomePerDay += BAL.landIncomePerHex;
      if (h.building === 'dorf') { nat.incomePerDay += BAL.incomeDorf; nat.mpPerDay += BAL.mpDorf; }
      else if (h.building === 'stadt') { nat.incomePerDay += BAL.incomeStadt; nat.mpPerDay += BAL.mpStadt; }
      else if (h.building === 'mine') nat.incomePerDay += h.terrain === 'mountain' ? BAL.incomeMineBerg : BAL.incomeMine;
      else if (h.building === 'hafen') nat.ports++;
    }
    for (const d of this.divisions) {
      if (!d.dead) this.nations[d.nation].incomePerDay -= BAL.divTypes[d.type].upkeep;
    }
    this.economyDirty = false;
  }

  economyTick(dt) {
    for (const nat of Object.values(this.nations)) {
      if (!nat.alive) continue;
      nat.gold = Math.max(0, nat.gold + nat.incomePerDay * dt);
      nat.manpower += nat.mpPerDay * dt;
    }
  }

  /* ---------- Versorgung ---------- */
  recalcSupply(id) {
    const own = this.ownedHexes(id);
    for (const h of own) {
      let hub = 0;
      if (h.capital) hub = BAL.supplyHub.capital;
      else if (h.building === 'stadt') hub = BAL.supplyHub.stadt;
      else if (h.building === 'hafen') hub = BAL.supplyHub.hafen;
      else if (h.building === 'kaserne') hub = BAL.supplyHub.kaserne;
      h.supply = hub;
    }
    let changed = true, guard = 0;
    while (changed && guard++ < 90) {
      changed = false;
      for (const h of own) {
        const stepCost = TERRAIN[h.terrain].move * (h.road ? BAL.roadCostFactor : 1) * BAL.supplyDecay;
        for (const [nc, nr] of neighborsOf(h.c, h.r)) {
          const nh = this.hexAt(nc, nr);
          if (!nh || nh.owner !== id || nh.terrain === 'water') continue;
          const v = nh.supply - stepCost;
          if (v > h.supply + 1e-4) { h.supply = v; changed = true; }
        }
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

  /* ---------- Wegfindung (A* mit Binär-Heap) ---------- */
  findPath(nation, c1, r1, c2, r2, ownOnly) {
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
    const came = new Map();
    const gScore = new Map();
    gScore.set(c1 + r1 * MAP_W, 0);
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
          step = TERRAIN[nh.terrain].move * (nh.road ? BAL.roadCostFactor : 1);
        } else if (isTarget && !ownOnly) {
          step = TERRAIN[nh.terrain].move;
        } else continue;
        const ng = g + step;
        const nKey = nc + nr * MAP_W;
        if (!gScore.has(nKey) || gScore.get(nKey) > ng) {
          gScore.set(nKey, ng);
          came.set(nKey, key);
          hpush([ng + hexDist(nc, nr, c2, r2), ng, nc, nr]);
        }
      }
    }
    if (found === null) return null;
    const path = [];
    let cur = found;
    while (cur !== undefined && cur !== c1 + r1 * MAP_W) {
      path.unshift([cur % MAP_W, Math.floor(cur / MAP_W)]);
      cur = came.get(cur);
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

  computeFront(army) {
    if (army.target === 'RESERVE') { army.frontHexes = []; return; }
    const border = [];
    for (const row of this.hexes) for (const h of row) {
      if (h.owner !== army.nation) continue;
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        if (this.frontMatches(army, this.hexAt(nc, nr))) { border.push(h); break; }
      }
    }
    if (border.length > 2) {
      const set = new Set(border.map(h => h.c + h.r * MAP_W));
      let start = border[0], minN = Infinity;
      for (const h of border) {
        let n = 0;
        for (const [nc, nr] of neighborsOf(h.c, h.r)) if (set.has(nc + nr * MAP_W)) n++;
        if (n < minN) { minN = n; start = h; }
      }
      const ordered = [start];
      const used = new Set([start.c + start.r * MAP_W]);
      while (ordered.length < border.length) {
        const cur = ordered[ordered.length - 1];
        let best = null, bestD = Infinity;
        for (const h of border) {
          const k = h.c + h.r * MAP_W;
          if (used.has(k)) continue;
          const d = hexDist(cur.c, cur.r, h.c, h.r);
          if (d < bestD) { bestD = d; best = h; }
        }
        if (!best) break;
        ordered.push(best);
        used.add(best.c + best.r * MAP_W);
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

  updateFronts() {
    for (const nat of Object.values(this.nations)) {
      if (!nat.alive) continue;
      for (const a of nat.armies) { this.computeFront(a); this.distributeArmy(a); }
    }
    this.frontsDirty = false;
  }

  /* ---------- Divisionen: Bewegung & Kampf ---------- */
  moveOrder(div, c, r) {
    const h = this.hexAt(c, r);
    if (!h) return;
    div.manual = true;
    div.attackTarget = null;
    const path = this.findPath(div.nation, div.c, div.r, c, r, false);
    if (path) { div.path = path; div.pathI = 0; div.moveProgress = 0; }
    else if (div.nation === this.player) {
      this.addLog(`⚠ ${div.name}: kein Weg dorthin (Invasionen brauchen ein Küstenfeld als Ziel).`);
    }
  }

  releaseToArmy(div) {
    div.manual = false;
    div.path = null;
    this.frontsDirty = true;
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

      if (!div.path && div.station && !div.attackTarget) {
        if ((div.c !== div.station[0] || div.r !== div.station[1])
          && (!div._pathRetryAt || this.dayFloat >= div._pathRetryAt)) {
          const p = this.findPath(div.nation, div.c, div.r, div.station[0], div.station[1], false);
          if (p && p.length) { div.path = p; div.pathI = 0; div.moveProgress = 0; }
          else div._pathRetryAt = this.dayFloat + 1;
        }
      }
      if (div.path && div.pathI < div.path.length) {
        const [nc, nr] = div.path[div.pathI];
        const nh = this.hexAt(nc, nr);
        if (!nh) { div.path = null; continue; }
        if (nh.owner !== div.nation && nh.terrain !== 'water') {
          if (this.attackable(div.nation, nh)) div.attackTarget = [nc, nr];
          else div.path = null;
          continue;
        }
        const step = nh.terrain === 'water' ? TERRAIN.water.move
          : TERRAIN[nh.terrain].move * (nh.road && nh.owner === div.nation ? BAL.roadCostFactor : 1);
        const t = BAL.divTypes[div.type];
        div.moveProgress += (BAL.moveSpeed * t.speed / step) * dt;
        if (div.moveProgress >= 1) {
          div.moveProgress = 0;
          const isFinal = div.pathI >= div.path.length - 1;
          const occupied = this.divisionAt(nc, nr);
          if (isFinal && occupied && occupied.id !== div.id) {
            div.path = null;
            if (div.manual) div.station = [div.c, div.r];
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
    const rand = 0.85 + Math.random() * 0.3;
    let power = this.attackPower(atk) * rand / terr.def;
    if (seaAssault) power *= BAL.seaAssaultMalus;
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
      if (def.nation !== atk.nation) this.warHeat[[atk.nation, def.nation].sort().join('|')] = this.day;
      const dRand = 0.85 + Math.random() * 0.3;
      const defT = BAL.divTypes[def.type];
      const defPower = this.attackPower(def) * defT.defF * dRand;
      def.org -= power * BAL.atkBase * BAL.orgDmg * dt;
      def.str -= power * BAL.atkBase * BAL.strDmg * dt;
      atk.org -= defPower * BAL.atkBase * BAL.orgDmg * 0.75 * dt;
      atk.str -= defPower * BAL.atkBase * BAL.strDmg * 0.6 * dt;
      if (def.str <= 5) this.destroyDivision(def, atk.nation);
      else if (def.org <= BAL.retreatOrg) this.retreatDivision(def, atk);
    } else {
      const t = BAL.divTypes[atk.type];
      const bonus = neutral ? BAL.neutralDmgBonus : 1;
      targetHex.resist -= power * BAL.atkBase * 0.55 * t.militia * bonus * dt;
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
    if (!this.divisionAt(h.c, h.r)) this._placeDiv(div, h.c, h.r);
    div.attackTarget = null;
    div.moral = Math.min(BAL.moralMax, div.moral + (loser ? BAL.moralWin : BAL.moralWin * 0.3));
    div.org = Math.max(2, div.org - (loser ? 4 : 1.5));
    this.effects.push({ type: 'capture', c: h.c, r: h.r, t: performance.now() });
    this._supplyDirtyIds.add(div.nation);
    this.frontsDirty = true;
    this.economyDirty = true;
    this.labelsDirty = true;
    this.markDirty(h.c, h.r);

    if (loser) {
      this._supplyDirtyIds.add(loser);
      this.warHeat[[div.nation, loser].sort().join('|')] = this.day;
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
    this.checkVictory();
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
        n++;
      }
    }
    for (const d of this.divisionsOf(loser)) d.dead = true;
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

  checkVictory() {
    if (this.over) return;
    const own = this.nations[this.player].hexCount;
    if (own / this.totalLand >= BAL.winLandShare) {
      this.over = { win: true, text: `Du kontrollierst ${Math.round(own / this.totalLand * 100)} % Europas!` };
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
    const ports = [];
    for (const row of this.hexes) for (const h of row) {
      if (h.building === 'hafen' && h.owner && this.nations[h.owner].alive) ports.push(h);
    }
    for (const p of ports) {
      if (p._nextShipDay === undefined)
        p._nextShipDay = this.day + 1 + Math.floor(Math.random() * BAL.trade.shipEveryDays);
      if (this.day < p._nextShipDay) continue;
      const cands = ports.filter(q => q.owner !== p.owner && this.tradePartners(p.owner, q.owner));
      if (!cands.length) { p._nextShipDay = this.day + 2; continue; }
      const q = cands[Math.floor(Math.random() * cands.length)];
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
        if (div.str < BAL.maxStr && sup.level > 0.4 && nat.manpower > 0.5) {
          const pts = Math.min(BAL.reinforceRate * dt, BAL.maxStr - div.str, nat.manpower / BAL.reinforceMpCost);
          div.str += pts;
          nat.manpower -= pts * BAL.reinforceMpCost;
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
    for (const row of this.hexes) for (const h of row) {
      if (h.terrain === 'water') continue;
      if (h.resist < h.resistMax && this.dayFloat - (h._atkT || -99) > 2)
        h.resist = Math.min(h.resistMax, h.resist + BAL.militiaRegen);
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

    // 1) Grundwirtschaft: die ersten Dörfer
    if (count('dorf') + count('stadt') < 3 && nat.gold >= BAL.cost.dorf) {
      const h = this.findBuildSpot(id, cc, cr, buildable, 30);
      if (h) return this.build(id, h, 'dorf');
    }
    // 2) Früher Hafen — Seehandel ist starkes Einkommen
    if ((nat.ports || 0) < 1 && nat.gold >= BAL.cost.hafen) {
      const h = this.findBuildSpot(id, cc, cr, x => buildable(x) && this.isCoastal(x), 45);
      if (h) return this.build(id, h, 'hafen');
    }
    // 3) Kaserne(n)
    const wantKas = 1 + Math.floor(own.length / 150);
    if (count('kaserne') < wantKas && nat.gold >= BAL.cost.kaserne + 30) {
      const h = this.findBuildSpot(id, cc, cr, buildable, 30);
      if (h) return this.build(id, h, 'kaserne');
    }
    // 4) Dörfer nachziehen
    if (count('dorf') + count('stadt') < Math.max(3, own.length * 0.06) && nat.gold >= BAL.cost.dorf + 30) {
      const h = this.findBuildSpot(id, cc, cr, buildable, 34);
      if (h) return this.build(id, h, 'dorf');
    }
    // 5) Minen
    const mineSpots = own.filter(h => (h.terrain === 'hills' || h.terrain === 'mountain') && !h.building);
    if (mineSpots.length && nat.gold >= BAL.cost.mine + 60) {
      return this.build(id, mineSpots[0], 'mine');
    }
    // 6) Weitere Häfen
    const wantHafen = 1 + Math.floor(own.length / 220);
    if ((nat.ports || 0) < wantHafen && nat.gold >= BAL.cost.hafen + 40) {
      const h = this.findBuildSpot(id, cc, cr, x => buildable(x) && this.isCoastal(x), 55);
      if (h) return this.build(id, h, 'hafen');
    }
    // 7) Stadt-Ausbau
    if (nat.gold >= BAL.cost.stadt + 150) {
      const dorf = own.find(h => h.building === 'dorf');
      if (dorf) return this.build(id, dorf, 'stadt');
    }
    // 8) Straße Richtung Front
    const army = nat.armies[0];
    if (army && army.frontHexes.length && nat.gold >= BAL.cost.strasse + 40) {
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
    const cap = Math.floor(3 + Math.max(0, nat.incomePerDay) / 4 + nat.hexCount / 60);
    const divs = this.divisionsOf(id);
    if (divs.length >= cap) return;
    let type = 'inf';
    const roll = Math.random();
    if (nat.gold > 600 && roll < 0.2) type = 'pz';
    else if (nat.gold > 400 && roll < 0.4) type = 'art';
    else if (nat.gold > 500 && roll < 0.5) type = 'gar';
    const tt = BAL.divTypes[type];
    const underAttack = this.day - nat._lastAttackedDay < 12;
    // In Friedenszeiten Wirtschaft vor Masse: Gold für Gebäude übrig lassen
    const buffer = underAttack ? 10 : 140;
    if (nat.gold >= tt.gold + buffer && nat.manpower >= tt.mp) {
      this.spawnDivision(id, type, nat.armies[0], false);
      this.economyDirty = true;
    }
  }

  aiMilitary(id) {
    const nat = this.nations[id];
    const army = nat.armies[0];
    if (!army) return;
    const myPow = this.nationPower(id);

    // 1) Unter Beschuss? Verteidigen/zurückschlagen
    if (this.day - nat._lastAttackedDay < 10 && nat._lastAttacker
      && this.nations[nat._lastAttacker].alive && this.hostile(id, nat._lastAttacker)) {
      const ratio = myPow / Math.max(0.1, this.nationPower(nat._lastAttacker));
      army.target = ratio > 0.85 ? nat._lastAttacker : 'ALL';
      army.mode = ratio > 0.85 ? 'attack' : 'defend';
      return;
    }
    // 2) Lohnendes Opfer in Reichweite?
    const borders = this.borderNationsOf(id).filter(b => this.hostile(id, b));
    let victim = null, vRatio = 0;
    for (const b of borders) {
      const r = myPow / Math.max(0.1, this.nationPower(b));
      if (r > vRatio) { vRatio = r; victim = b; }
    }
    const aggression = NATION_DEFS[id].aggression;
    if (victim && vRatio > 1.4 && this.divisionsOf(id).length >= 5 && Math.random() < aggression + 0.25) {
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
        && this.nations[x].allies.size < BAL.maxAllies)
      .sort((a, b) => this.nationPower(b) - this.nationPower(a));
    if (cands.length) this.offerAlliance(id, cands[0]);
  }

  /* ---------- Haupt-Tick ---------- */
  tick(realDt) {
    if (this.paused || this.over) return;
    let dt = Math.min(realDt, 0.25) * BAL.daysPerSec[this.speed];
    while (dt > 0 && !this.over) {
      const step = Math.min(dt, 0.34);
      this.subTick(step);
      dt -= step;
    }
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
      if (this.economyDirty) this.recalcEconomy();
      if (this.frontsDirty || this.day % 2 === 0) this.updateFronts();
      this.supplyDaily();
      this.militiaDaily();
      this.tradeDaily();
      this.aiDaily();
      // Abgelaufene Bündnisangebote entfernen
      const before = this.allianceOffers.length;
      this.allianceOffers = this.allianceOffers.filter(o => this.day - o.day < BAL.offerLifetime);
      if (this.allianceOffers.length !== before) this._offersChanged = true;
      if (performance.now() - this._lastAutosave > 60000 && !this.over) {
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
      v: 3, day: this.day, dayFloat: this.dayFloat, player: this.player,
      divSeq: this._divSeq, armySeq: this._armySeq,
      warHeat: this.warHeat,
      hexes: this.hexes.flat().map(h => [h.owner, h.building, h.road ? 1 : 0, h.capital ? 1 : 0, Math.round(h.resist)]),
      nations: Object.fromEntries(Object.entries(this.nations).map(([id, n]) => [id, {
        alive: n.alive, gold: Math.round(n.gold), manpower: +n.manpower.toFixed(2),
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
    if (!s || s.v !== 3 || !Array.isArray(s.hexes) || s.hexes.length !== MAP_W * MAP_H) return null;
    if (!NATION_DEFS[s.player]) return null;
    const g = new Game(s.player);
    g.divisions = [];
    g.day = s.day; g.dayFloat = s.dayFloat;
    g._divSeq = s.divSeq; g._armySeq = s.armySeq;
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
      n.alive = ns.alive; n.gold = ns.gold; n.manpower = ns.manpower;
      n.allies = new Set(ns.allies); n.capital = ns.capital; n.divNameSeq = ns.divNameSeq;
      n.armies = ns.armies.map(a => ({ ...a, nation: id, frontHexes: [] }));
    }
    for (const ds of s.divisions) {
      if (!BAL.divTypes[ds.type]) continue;
      const p = hexToPixel(ds.c, ds.r);
      g.divisions.push({
        ...ds, x: p.x, y: p.y, station: null, path: null, pathI: 0,
        moveProgress: 0, attackTarget: null, inCombat: false, dead: false,
      });
    }
    g.log = [];
    g.toasts = [];
    g.allianceOffers = [];
    g.ships = [];
    g.warHeat = s.warHeat || {};
    g.addLog('💾 Spielstand geladen.');
    g.economyDirty = true; g.labelsDirty = true; g.frontsDirty = true;
    g.markDirtyAll();
    g.recalcEconomy(); g.recalcAllSupply(); g.updateFronts();
    return g;
  }
}
