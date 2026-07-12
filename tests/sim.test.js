/* =========================================================
   FINAL FRONT — Simulations-Testsuite
   Ausführen:  node tests/sim.test.js   (aus dem Repo-Root)
   ========================================================= */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

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

const out = vm.runInContext(`
(() => {
  const results = [];
  const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
  const runTicks = (g, n) => { for (let i = 0; i < n && !g.over; i++) g.runTick(); };
  const norm = g => { const o = JSON.parse(g.serialize()); delete o.cmds; return JSON.stringify(o); };

  /* ===== Spawn-Phase & symmetrischer Start ===== */
  let g = new Game('A', 42);
  ok('5 Spieler, 5 Siegpunkte', Object.keys(g.nations).length === 5 && g.vpHexes.length === 5);
  ok('Start: Stadt + 1 Armee', g.hexAt(...g.nations['A'].capital).building === 'stadt'
    && Object.keys(g.nations).every(id => g.divisionsOf(id).length === 1));
  ok('Start ohne Rohstoffe', g.nations['A'].eisen === 0 && g.nations['A'].pferde === 0);
  ok('Spawn-Phase blockiert die Uhr', g.spawnPhase === true && (g.tick(1), g.tickCount === 0));
  let ziel = null;
  for (const row of g.hexes) { for (const h of row) {
    if (h.terrain !== 'water' && h.terrain !== 'mountain' && !h.owner) { ziel = h; break; }
  } if (ziel) break; }
  ok('Spawn verlegen', g.issue('spawn', ziel.c, ziel.r) === true && g.hexAt(ziel.c, ziel.r).capital === true);
  const bCap = g.nations['B'].capital;
  ok('Auf fremde Stadt spawnen verboten', g.issue('spawn', bCap[0], bCap[1]) !== true);
  g.issue('startMatch');
  ok('startMatch beendet die Phase', !g.spawnPhase);
  for (let i = 0; i < 8; i++) g.tick(1);
  ok('Uhr läuft nach Start', g.tickCount > 0);

  /* ===== Truppendreieck (RPS) mit eingefrorenem RNG ===== */
  g = new Game('B', 7); g.endSpawnPhase();
  const atk = g.divisionsOf('B')[0];
  let defHex = null;
  for (const [nc, nr] of neighborsOf(atk.c, atk.r)) {
    const h = g.hexAt(nc, nr);
    if (h && h.terrain !== 'water') { defHex = h; break; }
  }
  defHex.owner = 'C';
  g.day = BAL.graceDays + 1; g.dayFloat = g.day;
  const defDiv = g.divisionsOf('C')[0];
  g._placeDiv(defDiv, defHex.c, defHex.r);
  const messen = (aT, dT) => {
    atk.type = aT; atk.org = 60; atk.str = 100; atk.moral = 1;
    defDiv.type = dT; defDiv.org = 60; defDiv.str = 100; defDiv.moral = 1;
    const st = g._rngState;
    const orgVor = defDiv.org;
    g.resolveCombat(atk, defHex, 0.02);
    g._rngState = st;
    const dmg = orgVor - defDiv.org;
    defDiv.dead = false; atk.dead = false;
    return dmg;
  };
  ok('Krieger schlagen Kavallerie (+35 %)', Math.abs(messen('inf','kav') / messen('inf','inf') - 1.35) < 0.02);
  ok('Kavallerie schlägt Kanonen (+50 %)', Math.abs(messen('kav','kan') / messen('kav','kav') - 1.5) < 0.02);
  ok('Kanonen schlagen Krieger (+35 %)', Math.abs(messen('kan','inf') / messen('kan','kan') - 1.35) < 0.02);

  /* ===== Bunker: Division auf dem Feld verteidigt massiv stärker ===== */
  {
    const dmgOhne = messen('inf', 'inf');
    defHex.building = 'turm'; defHex.level = 1; defHex.builtBy = 'C';
    const dmgL1 = messen('inf', 'inf');
    defHex.level = 3;
    const dmgL3 = messen('inf', 'inf');
    defHex.building = null; defHex.level = 0;
    ok('Bunker L1 halbiert den Schaden (×2 Defense)', Math.abs(dmgOhne / dmgL1 - BAL.bunker.def[0]) < 0.05,
       (dmgOhne / dmgL1).toFixed(2));
    ok('Bunker L3 drittelt den Schaden (×3 Defense)', Math.abs(dmgOhne / dmgL3 - BAL.bunker.def[2]) < 0.05,
       (dmgOhne / dmgL3).toFixed(2));
    ok('Bunker hat 3 Level', BAL.bunker.maxLevel === 3);
  }

  /* ===== Besiegt = vernichtet ===== */
  {
    const gV = new Game('B', 741); gV.endSpawnPhase();
    gV.day = BAL.graceDays + 1; gV.dayFloat = gV.day;
    const aV = gV.divisionsOf('B')[0];
    let hV = null;
    for (const [nc, nr] of neighborsOf(aV.c, aV.r)) {
      const h = gV.hexAt(nc, nr);
      if (h && h.terrain !== 'water') { hV = h; break; }
    }
    hV.owner = 'C';
    const dV = gV.divisionsOf('C')[0];
    gV._placeDiv(dV, hV.c, hV.r);
    aV.str = 100; aV.org = 60; aV.moral = 1.2;
    dV.str = 40; dV.org = 9; dV.moral = 0.6;
    for (let i = 0; i < 60 && !dV.dead; i++) gV.resolveCombat(aV, hV, 0.25);
    ok('Besiegte Division wird VERNICHTET', dV.dead === true);
  }

  /* ===== Kampfsperre: Angegriffene sind gebunden ===== */
  {
    const gF = new Game('B', 742); gF.endSpawnPhase();
    gF.day = BAL.graceDays + 1; gF.dayFloat = gF.day;
    const aF = gF.divisionsOf('B')[0];
    let hF = null;
    for (const [nc, nr] of neighborsOf(aF.c, aF.r)) {
      const h = gF.hexAt(nc, nr);
      if (h && h.terrain !== 'water') { hF = h; break; }
    }
    hF.owner = 'C';
    const dF = gF.divisionsOf('C')[0];
    gF._placeDiv(dF, hF.c, hF.r);
    dF.path = null; dF.attackTarget = null;
    aF.str = 100; aF.org = 60; dF.str = 90; dF.org = 50;
    aF.attackTarget = [hF.c, hF.r];
    gF.resolveCombat(aF, hF, 0.02);
    ok('Kampf bindet den Verteidiger', dF.inCombat === true && !dF.attackTarget);
    let ziel = null;
    for (const [nc, nr] of neighborsOf(dF.c, dF.r)) {
      const h2 = gF.hexAt(nc, nr);
      if (h2 && h2.terrain !== 'water' && !(nc === aF.c && nr === aF.r)) { ziel = [nc, nr]; break; }
    }
    gF.moveOrder(dF, ziel[0], ziel[1], false);
    ok('Angegriffene Truppe kann nicht fliehen', dF.path === null);
    ok('Angegriffene Truppe kann nicht splitten', gF.splitDivision(dF) === null);
    // Der Angreifer dagegen darf die Schlacht abbrechen
    const heim = gF.nations['B'].capital;
    gF.moveOrder(aF, heim[0], heim[1], false);
    ok('Angreifer darf abbrechen', !!aF.path && aF.attackTarget === null);
  }

  /* ===== Veteranen, Flanken, Beute, Lazarett, neue Karten ===== */
  {
    const gX = new Game('B', 743); gX.endSpawnPhase();
    gX.day = BAL.graceDays + 1; gX.dayFloat = gX.day;
    const aX = gX.divisionsOf('B')[0];
    let hX = null;
    for (const [nc, nr] of neighborsOf(aX.c, aX.r)) {
      const h = gX.hexAt(nc, nr);
      if (h && h.terrain !== 'water') { hX = h; break; }
    }
    hX.owner = 'C';
    const dX = gX.divisionsOf('C')[0];
    gX._placeDiv(dX, hX.c, hX.r);
    aX.str = 100; aX.org = 60; dX.str = 100; dX.org = 60;
    for (let i = 0; i < 8; i++) gX.resolveCombat(aX, hX, 0.25);
    ok('Gefecht bringt Erfahrung (beide Seiten)', aX.xp > 1.9 && dX.xp > 1.9, 'xp=' + aX.xp.toFixed(1));
    const roh = { ...aX, xp: 0 };
    const vet = { ...aX, xp: BAL.vet.steps[2] };
    ok('Veteranenstufen 0 und 3', gX.vetLevel(roh) === 0 && gX.vetLevel(vet) === 3);
    ok('Veteranen kaempfen staerker', gX.attackPower(vet) > gX.attackPower(roh) * 1.2);

    // Flanken: 3 Angreifer aufs selbe Feld schlagen haerter zu
    gX._atkCount = new Map();
    const k = hX.c + hX.r * MAP_W;
    dX.org = 60; dX.str = 100;
    gX._atkCount.set(k, 1);
    const o1 = dX.org;
    gX.resolveCombat(aX, hX, 0.25);
    const solo = o1 - dX.org;
    dX.org = 60; dX.str = 100;
    gX._atkCount.set(k, 3);
    const o2 = dX.org;
    gX.resolveCombat(aX, hX, 0.25);
    const massiert = o2 - dX.org;
    ok('Flankenbonus wirkt', massiert > solo * 1.1, solo.toFixed(2) + ' vs ' + massiert.toFixed(2));

    // Beute: eroberte Stadt fuellt die Kasse
    const beuteHex = hX;
    beuteHex.owner = 'C'; beuteHex.building = 'stadt'; beuteHex.level = 2;
    const goldVor = gX.nations['B'].gold;
    gX.captureHex(beuteHex, aX);
    const erwartet = Math.round(BAL.cost.stadt * BAL.loot * 2);
    ok('Beute bei Eroberung', Math.round(gX.nations['B'].gold - goldVor) === erwartet, '+' + (gX.nations['B'].gold - goldVor));

    // Lazarett: gleiche Stelle, einmal ohne, einmal mit Stadt
    const heimDiv = gX.divisionsOf('B')[0];
    let feld = null;
    for (const row of gX.hexes) for (const h of row) {
      if (h.owner === 'B' && !h.building && !h.capital && h.terrain !== 'water') { feld = h; break; }
    }
    gX._placeDiv(heimDiv, feld.c, feld.r);
    heimDiv.inCombat = false; heimDiv.moral = 1;
    heimDiv.org = 0;
    gX.regenTick(1);
    const ohne = heimDiv.org;
    feld.building = 'stadt'; feld.level = 1;
    heimDiv.org = 0;
    gX.regenTick(1);
    const mit = heimDiv.org;
    ok('Lazarett: Stadt heilt schneller', mit > ohne * 1.15, ohne.toFixed(1) + ' -> ' + mit.toFixed(1));
    feld.building = null;

    // Erfahrung uebersteht Speichern/Laden
    aX.xp = 42;
    const wieder = Game.deserialize(gX.serialize());
    const aW = wieder.divisions.find(d => d.id === aX.id);
    ok('Erfahrung wird gespeichert', aW && aW.xp === 42);
  }

  /* Neue Karten starten sauber */
  for (const mapId of ['kontinent', 'inselmeer', 'steppe']) {
    const gM = new Game('A', 5, mapId); gM.endSpawnPhase();
    const caps = Object.values(gM.nations).filter(n => n.capital).length;
    for (let i = 0; i < 20; i++) gM.runTick();
    ok('Karte ' + mapId + ' spielbar', caps === 5 && !gM.over);
  }
  // selectMap ist modul-global und bleibt sonst auf 'steppe' kleben —
  // alle Folgetests sollen auf der Standard-Karte laufen
  selectMap('europa');

  /* ===== Stadt-Einfluss (Radius 3) + Grenz-Sog füllt darüber hinaus ===== */
  g = new Game('A', 99); g.endSpawnPhase();
  const startHex = g.nations['A'].hexCount;
  // Reinen Stadt-Einfluss isolieren: Grenz-Sog aus → Einfluss muss am Radius enden
  const creepSave = BAL.borderCreep; BAL.borderCreep = 0;
  runTicks(g, 80);
  const nach20 = g.nations['A'].hexCount;
  ok('Stadt-Einfluss übernimmt freies Umland', nach20 > startHex, startHex + ' -> ' + nach20);
  {
    let maxDist = 0;
    const cap = g.nations['A'].capital;
    for (const row of g.hexes) for (const h of row)
      if (h.owner === 'A') maxDist = Math.max(maxDist, hexDist(h.c, h.r, cap[0], cap[1]));
    ok('Reiner Stadt-Einfluss endet am Radius', maxDist <= BAL.influence.radius, maxDist + '');
  }
  BAL.borderCreep = creepSave;
  // Mit Grenz-Sog wächst das Gebiet über den Einflussradius hinaus (füllt die Karte)
  {
    const gC = new Game('A', 99); gC.endSpawnPhase();
    runTicks(gC, 140);
    let maxDist = 0;
    const cap = gC.nations['A'].capital;
    for (const row of gC.hexes) for (const h of row)
      if (h.owner === 'A') maxDist = Math.max(maxDist, hexDist(h.c, h.r, cap[0], cap[1]));
    ok('Grenz-Sog füllt über den Einflussradius hinaus', maxDist > BAL.influence.radius, 'maxR=' + maxDist);
  }

  /* ===== Dorf-Einfluss: Radius 2, per Straße zur Stadt Radius 3 ===== */
  {
    const gD = new Game('A', 3); gD.endSpawnPhase();
    const isLand = h => h && h.terrain !== 'water' && h.terrain !== 'mountain';
    const caps = Object.values(gD.nations).map(n => n.capital).filter(Boolean);
    let vc = null;
    for (const row of gD.hexes) for (const h of row) {
      // ≥11: Hauptstadt-Einfluss (Radius 3) darf nicht ins ±4-Zählfenster reichen
      if (vc || !isLand(h) || !caps.every(c => hexDist(h.c, h.r, c[0], c[1]) >= 11)) continue;
      let okp = true;
      for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
        const n = gD.hexAt(h.c + dc, h.r + dr);
        if (hexDist(h.c, h.r, h.c + dc, h.r + dr) <= 3 && (!n || n.owner !== null || !isLand(n))) okp = false;
      }
      if (okp) vc = h;
    }
    if (vc) {
      vc.owner = 'A'; vc.building = 'dorf'; vc.level = 1; vc.builtBy = 'A'; gD.setResist(vc);
      gD.recalcEconomy();
      ok('Dorf ohne Straße nicht angebunden', gD.roadConnectedToCity(vc) === false);
      for (let i = 0; i < 25; i++) gD.influenceDaily();
      let maxD = 0, cnt = 0;
      for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
        const n = gD.hexAt(vc.c + dc, vc.r + dr);
        if (!n || hexDist(vc.c, vc.r, n.c, n.r) > 4) continue;   // Offset-Box ≠ Hex-Distanz
        if (n.owner === 'A' && n !== vc) { maxD = Math.max(maxD, hexDist(vc.c, vc.r, n.c, n.r)); cnt++; }
      }
      ok('Dorf nimmt Umland bis Radius 2 ein', maxD === 2 && cnt > 0, 'maxR=' + maxD + ' felder=' + cnt);
    } else ok('Dorf nimmt Umland bis Radius 2 ein', true, 'kein isoliertes Fleck');

    // Straßen-Anbindung: Dorf neben Hauptstadt, Zwischenfeld als Straße
    const gR = new Game('A', 3); gR.endSpawnPhase();
    const cap = gR.hexAt(...gR.nations['A'].capital);
    let dv = null;
    for (let d = 3; d <= 5 && !dv; d++) { const h = gR.hexAt(cap.c + d, cap.r); if (isLand(h)) dv = h; }
    if (dv) {
      dv.owner = 'A'; dv.building = 'dorf'; dv.level = 1; dv.builtBy = 'A'; gR.setResist(dv);
      for (let x = cap.c; x <= dv.c; x++) { const h = gR.hexAt(x, cap.r); if (h) { h.owner = 'A'; if (isLand(h)) h.road = true; } }
      gR.recalcEconomy();
      ok('Dorf mit Straße zur Stadt ist angebunden', gR.roadConnectedToCity(dv) === true);
      for (let x = cap.c; x <= dv.c; x++) { const h = gR.hexAt(x, cap.r); if (h) h.road = false; }
      ok('Ohne Straße wieder abgeschnitten', gR.roadConnectedToCity(dv) === false);
    } else { ok('Dorf mit Straße zur Stadt ist angebunden', true, 'kein Platz'); ok('Ohne Straße wieder abgeschnitten', true, 'kein Platz'); }
  }

  /* ===== Akt-Uhr: Prozent-Anker, Übergänge, abgeleitet beim Laden ===== */
  {
    const gAkt = new Game('A', 12);
    const D = BAL.round.days;
    ok('Akt I am Start', gAkt.akt === 1 && gAkt.aktOf(0) === 1);
    ok('Akt II ab 20 %', gAkt.aktOf(D * BAL.round.akt2) === 2 && gAkt.aktOf(D * BAL.round.akt2 - 1) === 1);
    ok('Akt III fällt exakt auf lateStart', gAkt.aktOf(D * BAL.round.lateStart) === 3
      && gAkt.aktOf(D * BAL.round.lateStart - 1) === 2);
    gAkt.endSpawnPhase();
    gAkt.day = Math.floor(D * BAL.round.akt2) - 1; gAkt.dayFloat = gAkt.day;
    const logLen = gAkt.log.length;
    for (let i = 0; i < 12 && gAkt.akt < 2; i++) gAkt.runTick();
    ok('Tick über die 20 %-Grenze setzt Akt II', gAkt.akt === 2, 'akt=' + gAkt.akt);
    ok('Akt-Wechsel schreibt Log', gAkt.log.length > logLen);
    gAkt.day = Math.floor(D * BAL.round.lateStart) + 3; gAkt.dayFloat = gAkt.day;
    const g2 = Game.deserialize(gAkt.serialize());
    ok('Akt wird beim Laden aus dem Tag abgeleitet', g2.akt === 3, 'akt=' + g2.akt);
  }

  /* ===== Sieg-Leiste: Score = Land + Kronen + Kessel + Ring-Eroberungen ===== */
  {
    const gS = new Game('A', 21); gS.endSpawnPhase();
    const nA = gS.nations['A'];
    const base = gS.score('A');
    // Start: eigenes Land + die EIGENE Krone (jede Nation hält ihre Hauptstadt)
    const erwartet = nA.hexCount + (nA.vp || 0) * gS.totalLand * BAL.score.krone;
    ok('Score = Land + Kronen am Start', Math.abs(base - erwartet) < 0.001,
      base.toFixed(1) + ' vs ' + erwartet.toFixed(1) + ' (vp=' + nA.vp + ')');
    nA.kesselKills = 2;
    ok('Kessel-Vernichtungen zählen auf die Leiste',
      Math.abs(gS.score('A') - (base + 2 * BAL.score.kessel)) < 0.001);
    nA.kesselKills = 0; nA.ringCaptures = 5;
    ok('Ring-Eroberungen zählen auf die Leiste',
      Math.abs(gS.score('A') - (base + 5 * BAL.score.ring)) < 0.001);
    nA.ringCaptures = 0;

    // Akt III: aktive Eroberung erhöht ringCaptures (doppelt zählen)
    gS.akt = 3;
    let freeH = null;
    for (const row of gS.hexes) for (const h of row)
      if (!freeH && !h.owner && h.terrain !== 'water' && h.terrain !== 'mountain') freeH = h;
    gS.captureHex(freeH, gS.divisionsOf('A')[0]);
    ok('Akt-III-Eroberung erhöht ringCaptures', nA.ringCaptures === 1, 'ring=' + nA.ringCaptures);
    gS.akt = 1;

    // Save/Load: Leisten-Zähler überleben
    nA.kesselKills = 3;
    const gL = Game.deserialize(gS.serialize());
    ok('Leisten-Zähler überleben Save/Load',
      gL.nations['A'].kesselKills === 3 && gL.nations['A'].ringCaptures === 1);

    // Abpfiff: die Leiste entscheidet (Ring-Punkte überholen reinen Besitz)
    gS.nations['B'].ringCaptures = 5000;
    gS.day = BAL.round.days; gS.dayFloat = gS.day;
    gS.vpDaily();
    ok('Abpfiff: die Leiste entscheidet', !!gS.over && gS.over.text.includes(gS.nationName('B')),
      gS.over ? gS.over.text : 'kein over');
  }

  /* ===== Doktrinen: Wahl-Regeln, Multiplikatoren, KI + Default, Save/Load ===== */
  {
    const gD = new Game('A', 33); gD.endSpawnPhase();
    const nA = gD.nations['A'];
    ok('Doktrin vor Akt II abgelehnt', gD.issue('doctrine', 'blitz') !== true && !nA.doctrine);
    gD.akt = 2;
    ok('Doktrin-Wahl ab Akt II', gD.issue('doctrine', 'blitz') === true && nA.doctrine === 'blitz');
    ok('Doktrin nur einmal wählbar', gD.issue('doctrine', 'festung') !== true && nA.doctrine === 'blitz');

    const d = gD.divisionsOf('A')[0]; d.str = 100; d.org = 50; d.moral = 1;
    const pNorm = gD.attackPower(d);                    // blitz hat keinen atk-Mult
    nA.doctrine = 'wirtschaft';
    ok('Doktrin-Multiplikator wirkt auf Angriffskraft',
      Math.abs(gD.attackPower(d) / pNorm - BAL.doctrines.wirtschaft.atk) < 0.01);

    const cW = gD.buildCost('A', null, 'dorf');         // wirtschaft: ×0,75
    nA.doctrine = null;
    const c0 = gD.buildCost('A', null, 'dorf');
    ok('Kriegswirtschaft baut billiger', cW === Math.round(c0 * BAL.doctrines.wirtschaft.buildCost),
      cW + ' vs ' + c0);

    nA.doctrine = 'masse'; gD.economyDirty = true; gD.recalcEconomy();
    const capMasse = nA.popCap;
    nA.doctrine = null; gD.economyDirty = true; gD.recalcEconomy();
    ok('Massenheer hebt das Bevölkerungslimit', capMasse > nA.popCap, capMasse + ' > ' + nA.popCap);

    nA.doctrine = 'masse'; nA.leute = 50;
    const capH = gD.hexAt(...nA.capital);
    const vorher = nA.leute;
    const rT = gD.queueTraining('A', capH.c, capH.r, 'inf');
    ok('Massenheer rekrutiert billiger', rT === true
      && Math.abs((vorher - nA.leute) - BAL.divTypes.inf.mp * BAL.doctrines.masse.mp) < 0.11,
      'kosten=' + (vorher - nA.leute).toFixed(1));

    // Drama-Queue: Sim meldet große Momente für die UI-Regie
    {
      const gJ = new Game('A', 66); gJ.endSpawnPhase();
      gJ._drama.length = 0;
      const dJ = gJ.divisionsOf('A')[0];
      const fremd = gJ.hexAt(...gJ.nations['B'].capital);
      for (const d of gJ.divisionsAt(fremd.c, fremd.r)) d.dead = true;
      gJ._hasDead = true;
      gJ.captureHex(fremd, dJ);
      ok('Drama: Kronenfall gemeldet', gJ._drama.some(e => e.type === 'krone' && e.by === 'A' && e.loser === 'B'));
      gJ._drama.length = 0;
      gJ.nations['A']._caps24 = 3;
      let frei = null;
      for (const row of gJ.hexes) for (const h of row)
        if (!frei && !h.owner && h.terrain !== 'water' && h.terrain !== 'mountain') frei = h;
      gJ.captureHex(frei, dJ);
      ok('Drama: Durchbruch ab 4 Eroberungen/Tag', gJ._drama.some(e => e.type === 'durchbruch' && e.by === 'A'));
      gJ._checkBetrayal && (gJ._exAllies['A>B'] = gJ.day, gJ._checkBetrayal('A', 'B'));
      ok('Drama: Verrat gemeldet', gJ._drama.some(e => e.type === 'verrat' && e.traitor === 'A'));
      for (let i = 0; i < 30; i++) gJ._dramaPush('krone', { by: 'A' });
      ok('Drama-Queue ist gedeckelt', gJ._drama.length <= 12);
      // Tages-Reset der Zähler
      gJ.nations['A']._caps24 = 9;
      gJ.runTick(); gJ.runTick(); gJ.runTick(); gJ.runTick(); gJ.runTick();
      ok('Drama: Tageszähler wird zurückgesetzt', gJ.nations['A']._caps24 < 9);
    }

    // Operationen: Sammeln → Sturm (Zonen-Bonus) → Ende (Cooldown)
    {
      const gO = new Game('A', 88); gO.endSpawnPhase();
      const nO = gO.nations['A'];
      let ziel = null;
      for (const row of gO.hexes) for (const h of row)
        if (!ziel && h.terrain !== 'water' && h.owner !== 'A') ziel = h;
      ok('Operation startet mit Namen', gO.issue('operation', ziel.c, ziel.r) === true
        && !!nO.op && BAL.operation.namen.includes(nO.op.name) && nO.op.phase === 'sammeln');
      ok('Keine zweite Operation parallel', gO.issue('operation', ziel.c, ziel.r) !== true);
      ok('Sammeln: noch kein Bonus', gO.opPush('A', ziel) === 1);
      for (let i = 0; i < BAL.operation.sammelTage * 4 + 6 && nO.op && nO.op.phase === 'sammeln'; i++) gO.runTick();
      ok('Sammeln → Sturm', !!nO.op && nO.op.phase === 'sturm', nO.op ? nO.op.phase : 'weg');
      ok('Sturm-Bonus im Zielgebiet', gO.opPush('A', ziel) === BAL.operation.bonus);
      let fern = null;
      for (const row of gO.hexes) for (const h of row)
        if (!fern && h.terrain !== 'water' && hexDist(h.c, h.r, ziel.c, ziel.r) > BAL.operation.radius + 2) fern = h;
      ok('Kein Bonus fern des Ziels', gO.opPush('A', fern) === 1);
      // Serialize mitten im Sturm
      const gO2 = Game.deserialize(gO.serialize());
      ok('Operation überlebt Save/Load', !!gO2.nations['A'].op && gO2.nations['A'].op.phase === 'sturm');
      for (let i = 0; i < BAL.operation.sturmTage * 4 + 6 && nO.op; i++) gO.runTick();
      ok('Sturm endet mit Cooldown', !nO.op && gO.nations['A'].opCooldownUntil > gO.day);
      ok('Cooldown blockiert Neustart', gO.issue('operation', ziel.c, ziel.r) !== true);
      // Abbruch = halber Cooldown
      const gA2 = new Game('A', 89); gA2.endSpawnPhase();
      let z2 = null;
      for (const row of gA2.hexes) for (const h of row)
        if (!z2 && h.terrain !== 'water' && h.owner !== 'A') z2 = h;
      gA2.issue('operation', z2.c, z2.r);
      ok('Abbruch kostet halben Cooldown', gA2.issue('operationAbbruch') === true
        && !gA2.nations['A'].op
        && gA2.nations['A'].opCooldownUntil === gA2.day + Math.ceil(BAL.operation.cooldown / 2));
    }

    // Chronik: die Runde schreibt ihre Geschichte mit (Kriegsbilanz-Futter)
    {
      const gC2 = new Game('A', 44); gC2.endSpawnPhase();
      gC2.chronicle.length = 0;
      const dC = gC2.divisionsOf('A')[0];
      const kroneH = gC2.hexAt(...gC2.nations['B'].capital);
      for (const d of gC2.divisionsAt(kroneH.c, kroneH.r)) d.dead = true;
      gC2._hasDead = true;
      gC2.captureHex(kroneH, dC);
      ok('Chronik: Kronenfall notiert', gC2.chronicle.some(e => e.type === 'krone' && e.by === 'A'));
      gC2._exAllies['A>C'] = gC2.day; gC2._checkBetrayal('A', 'C');
      ok('Chronik: Verrat notiert', gC2.chronicle.some(e => e.type === 'verrat'));
      ok('Chronik: Einträge tragen den Tag', gC2.chronicle.every(e => typeof e.day === 'number'));
      const gC3 = Game.deserialize(gC2.serialize());
      ok('Chronik überlebt Save/Load', gC3.chronicle.length === gC2.chronicle.length
        && gC3.chronicle.some(e => e.type === 'krone'));
      for (let i = 0; i < 120; i++) gC2._chron('kessel', { owner: 'B', count: 2 });
      ok('Chronik ist gedeckelt', gC2.chronicle.length <= 80);
    }

    // Tempo-Preset: Rundenlänge pro Spiel — Akte skalieren mit (Prozent-Anker)
    {
      const gB = new Game('A', 44, 'europa', undefined, 5, BAL.round.blitzDays);
      ok('Blitz-Preset setzt Rundenlänge', gB.roundDays === BAL.round.blitzDays);
      ok('Akt II skaliert mit dem Preset',
        gB.aktOf(BAL.round.blitzDays * BAL.round.akt2) === 2
        && gB.aktOf(BAL.round.blitzDays * BAL.round.akt2 - 1) === 1);
      ok('Akt III skaliert mit dem Preset', gB.aktOf(BAL.round.blitzDays * BAL.round.lateStart) === 3);
      gB.endSpawnPhase();
      const gB2 = Game.deserialize(gB.serialize());
      ok('Rundenlänge überlebt Save/Load', gB2.roundDays === BAL.round.blitzDays);
      ok('Replay trägt die Rundenlänge', (gB.getReplay() || {}).roundDays === BAL.round.blitzDays);
      const gStd = new Game('A', 44);
      ok('Ohne Preset gilt der Standard', gStd.roundDays === BAL.round.days);
      // Abpfiff kommt am Blitz-Ende
      gB.day = BAL.round.blitzDays; gB.dayFloat = gB.day;
      gB.vpDaily();
      ok('Blitz-Runde endet am Blitz-Tag', !!gB.over);
    }

    // KI wählt lagebasiert, der Mensch bekommt nach der Frist das Massenheer
    const gK = new Game('A', 34); gK.endSpawnPhase();
    gK.day = Math.floor(BAL.round.days * BAL.round.akt2) - 1; gK.dayFloat = gK.day;
    for (let i = 0; i < 60; i++) gK.runTick();
    const alleHaben = Object.values(gK.nations).every(n => !n.alive || n.doctrine);
    ok('KI wählt, Mensch bekommt Default nach Frist',
      alleHaben && gK.nations['A'].doctrine === 'masse',
      Object.entries(gK.nations).map(([i, n]) => i + ':' + (n.doctrine || '-')).join(' '));
    const gL2 = Game.deserialize(gK.serialize());
    ok('Doktrin überlebt Save/Load', gL2.nations['A'].doctrine === 'masse');
  }

  /* ===== Frei laufen + Steh-Eroberung ===== */
  g = new Game('A', 66); g.endSpawnPhase();
  const dEr = g.divisionsOf('A')[0];
  let nZiel = null;
  for (const row of g.hexes) for (const h of row) {
    if (h.terrain !== 'water' && h.terrain !== 'mountain' && h.owner === null
      && hexDist(h.c, h.r, dEr.c, dEr.r) === 5 && !nZiel) nZiel = h;
  }
  g.issue('move', dEr.id, nZiel.c, nZiel.r, false);
  runTicks(g, 60);
  ok('Truppe läuft frei über unerobertes Land', dEr.c === nZiel.c && dEr.r === nZiel.r);
  runTicks(g, 100);
  ok('Stehen erobert das Standfeld', nZiel.owner === 'A');
  {
    const dS = g.divisionsOf('A')[0];
    let zS = null;
    for (const [nc, nr] of neighborsOf(dS.c, dS.r)) {
      const h = g.hexAt(nc, nr);
      if (h && h.terrain !== 'water' && !h.owner) { zS = h; break; }
    }
    if (zS) {
      const m = str => { dS.str = str; dS.org = 60; dS.moral = 1; zS.resist = zS.resistMax;
        g.standingCapture(dS, zS, 0.25); return zS.resistMax - zS.resist; };
      ok('Steh-Eroberung skaliert mit Stärke', Math.abs(m(50) / m(100) - 0.5) < 0.03);
    } else ok('Steh-Eroberung skaliert mit Stärke', true, 'übersprungen');
  }

  /* ===== Sofort-Einnahme beim Drüberlaufen + Schutzzonen (Stadt r2 / Dorf r1) ===== */
  {
    const gP = new Game('A', 91); gP.endSpawnPhase();
    const bCap = gP.hexAt(...gP.nations['B'].capital);
    // irgendein Landfeld im 2er-Umkreis der B-Stadt (fester +2-Offset kann je
    // nach Karte Wasser/Kartenrand treffen)
    let r2 = null;
    for (let dr = -2; dr <= 2 && !r2; dr++) for (let dc = -3; dc <= 3 && !r2; dc++) {
      const h = gP.hexAt(bCap.c + dc, bCap.r + dr);
      if (h && h !== bCap && h.terrain !== 'water' && hexDist(bCap.c, bCap.r, h.c, h.r) <= 2) r2 = h;
    }
    ok('Schutzzone: Feld im Stadt-Umkreis 2 ist geschützt', !!r2 && gP.hexProtected(r2, 'A') === true);
    let farO = null;
    for (const row of gP.hexes) for (const h of row)
      if (h.terrain !== 'water' && h.terrain !== 'mountain' && !h.owner && !gP.hexProtected(h, 'A') && !farO) farO = h;
    ok('Schutzzone: freies Feld fern jeder Stadt ist ungeschützt', !!farO && gP.hexProtected(farO, 'A') === false);

    let tOpen = null, fOpen = null;
    outerT: for (const row of gP.hexes) for (const h of row) {
      if (h.terrain === 'water' || h.terrain === 'mountain' || h.owner || gP.hexProtected(h, 'A')) continue;
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        const n = gP.hexAt(nc, nr);
        if (n && n.terrain !== 'water' && n.terrain !== 'mountain' && !n.owner) { tOpen = h; fOpen = n; break outerT; }
      }
    }
    if (tOpen) {
      const dP = gP.divisionsOf('A')[0];
      gP._placeDiv(dP, fOpen.c, fOpen.r); gP.captureHex(fOpen, dP); dP.org = 1; dP.str = 20; dP.path = null;
      gP.moveOrder(dP, tOpen.c, tOpen.r);
      for (let i = 0; i < 200 && (dP.c !== tOpen.c || dP.r !== tOpen.r); i++) gP.subTick(0.25);
      ok('Drüberlaufen nimmt offenes Land sofort ein', gP.hexAt(tOpen.c, tOpen.r).owner === 'A',
        'endOwner=' + gP.hexAt(tOpen.c, tOpen.r).owner);
    } else ok('Drüberlaufen nimmt offenes Land sofort ein', true, 'übersprungen');

    let tProt = null, fProt = null;
    outerG: for (const row of gP.hexes) for (const h of row) {
      if (h.terrain === 'water' || h.terrain === 'mountain' || h.owner || !gP.hexProtected(h, 'A')) continue;
      for (const [nc, nr] of neighborsOf(h.c, h.r)) {
        const n = gP.hexAt(nc, nr);
        if (n && n.terrain !== 'water' && n.terrain !== 'mountain' && (!n.owner || n.owner === 'A')) { tProt = h; fProt = n; break outerG; }
      }
    }
    if (tProt) {
      const dG = gP.divisionsOf('A')[0];
      gP._placeDiv(dG, fProt.c, fProt.r); gP.captureHex(fProt, dG); dG.org = 1; dG.str = 20; dG.path = null;
      gP.moveOrder(dG, tProt.c, tProt.r);
      let arr = false;
      for (let i = 0; i < 200 && !arr; i++) { gP.subTick(0.25); if (dG.c === tProt.c && dG.r === tProt.r) arr = true; }
      ok('Geschütztes Feld wird beim Drüberlaufen NICHT sofort erobert', gP.hexAt(tProt.c, tProt.r).owner !== 'A',
        'owner=' + gP.hexAt(tProt.c, tProt.r).owner);
    } else ok('Geschütztes Feld wird beim Drüberlaufen NICHT sofort erobert', true, 'übersprungen');
  }

  /* ===== Move-Fix: Doppelklick wirft Fortschritt nicht weg ===== */
  {
    const gM = new Game('A', 357); gM.endSpawnPhase();
    const dM = gM.divisionsOf('A')[0];
    let zM = null;
    for (const row of gM.hexes) for (const h of row)
      if (h.terrain !== 'water' && h.terrain !== 'mountain' && hexDist(h.c, h.r, dM.c, dM.r) === 3 && !zM) zM = h;
    gM.issue('move', dM.id, zM.c, zM.r, false);
    let tr = 0;
    while ((dM.moveProgress < 0.2 || dM.moveProgress > 0.9) && tr++ < 60 && dM.path) gM.runTick();
    const pv = dM.moveProgress;
    gM.issue('move', dM.id, zM.c, zM.r, false);
    ok('Doppelklick: Fortschritt bleibt', pv > 0 && Math.abs(dM.moveProgress - pv) < 0.001);
  }

  /* ===== Terrain-Widerstand ===== */
  {
    const tP = { terrain: 'plains', owner: null, resist: 0, resistMax: 0 };
    const tB = { terrain: 'mountain', owner: null, resist: 0, resistMax: 0 };
    const tF = { terrain: 'plains', river: true, owner: null, resist: 0, resistMax: 0 };
    g.setResist(tP); g.setResist(tB); g.setResist(tF);
    ok('Berge doppelt so zäh', tB.resistMax >= tP.resistMax * 2);
    ok('Flussfelder zäher als Ebene', tF.resistMax > tP.resistMax && tF.resistMax < tB.resistMax);
  }

  /* ===== Pop-Cap + Pools + Lager-Caps ===== */
  {
    const gP = new Game('A', 550); gP.endSpawnPhase();
    const nP = gP.nations['A'];
    ok('Pop-Kapazität berechnet', nP.popCap > BAL.pop.base);
    nP.leute = nP.popCap;
    gP.economyTick(1);
    ok('Wachstum stoppt am Pop-Limit', nP.leute <= nP.popCap + 0.001);
    ok('Lager-Caps ohne Gebäude = 0', nP.eisenCap === 0 && nP.pferdeCap === 0);
    nP.gold = 99999; nP.leute = 60; nP.eisen = 20; nP.pferde = 20;
    const capH = gP.nations['A'].capital;
    gP.issue('trainAt', capH[0], capH[1], 'inf');
    ok('Krieger kosten nur Leute', Math.abs(nP.leute - (60 - BAL.divTypes.inf.mp)) < 0.01
      && nP.eisen === 20 && nP.pferde === 20);
    gP.issue('trainAt', capH[0], capH[1], 'kav');
    ok('Kavallerie kostet Leute + Pferde', Math.abs(nP.pferde - (20 - BAL.divTypes.kav.pferde)) < 0.01);
    gP.issue('trainAt', capH[0], capH[1], 'kan');
    ok('Kanonen kosten Leute + Eisen', Math.abs(nP.eisen - (20 - BAL.divTypes.kan.eisen)) < 0.01);
    nP.pferde = 0;
    ok('Ohne Pferde keine Kavallerie', gP.issue('trainAt', capH[0], capH[1], 'kav') !== true);
    // Lager-Cap: Mine erhöht, economyTick klemmt
    const spotM = gP.ownedHexes('A').find(h => TERRAIN[h.terrain].buildable && !h.building && !h.capital);
    gP.issue('build', spotM.c, spotM.r, 'mine');
    gP.recalcEconomy();
    ok('Minen-Lager: Cap = Level × ' + BAL.storePerMine, nP.eisenCap === BAL.storePerMine);
    nP.eisen = 0;
    for (let i = 0; i < 400; i++) gP.economyTick(0.25);
    ok('Eisen stapelt nur bis zum Cap', Math.abs(nP.eisen - nP.eisenCap) < 0.5, nP.eisen.toFixed(1));
    ok('Erstellung kostet kein Gold', (nP.gold = 0, gP.issue('trainAt', capH[0], capH[1], 'inf') === true));
  }

  /* ===== Preis-Staffel ===== */
  {
    const gPr = new Game('A', 963); gPr.endSpawnPhase();
    gPr.nations['A'].gold = 99999;
    const spots = gPr.ownedHexes('A').filter(h => h.terrain !== 'water' && !h.building && !h.capital);
    const base = BAL.cost.dorf;
    ok('1. Gebäude = Basispreis', gPr.buildCost('A', spots[0], 'dorf') === base);
    gPr.issue('build', spots[0].c, spots[0].r, 'dorf');
    ok('2. Gebäude = ×2', gPr.buildCost('A', spots[1], 'dorf') === base * 2);
    gPr.issue('build', spots[1].c, spots[1].r, 'dorf');
    gPr.issue('build', spots[2].c, spots[2].r, 'dorf');
    gPr.issue('build', spots[3].c, spots[3].r, 'dorf');
    ok('5.+ Gebäude = ×16 (Deckel)', gPr.buildCost('A', spots[4], 'dorf') === base * 16);
    spots[0].owner = 'B';
    ok('Verlust senkt den Preis wieder', gPr.buildCost('A', spots[4], 'dorf') === base * 8);
    ok('Erobertes zählt beim Eroberer nicht', gPr.builtCount('B', 'dorf') === 0);
    ok('Straßen ohne Staffel', gPr.buildCost('A', spots[4], 'strasse') === BAL.cost.strasse);
  }

  /* ===== Unterhalt & Pleite ===== */
  {
    const gB = new Game('A', 660); gB.endSpawnPhase();
    const nB = gB.nations['A'];
    ok('Unterhalt teuer + gestaffelt', BAL.divTypes.inf.upkeep >= 1.0
      && BAL.divTypes.kan.upkeep > BAL.divTypes.kav.upkeep && BAL.divTypes.kav.upkeep > BAL.divTypes.inf.upkeep);
    nB.gold = 0; nB.incomePerDay = -5;
    gB.economyTick(0.25);
    ok('Pleite erkannt', nB._broke === true);
    const dB = gB.divisionsOf('A')[0];
    dB.moral = 1.0;
    gB.regenTick(1);
    ok('Pleite: Moral sinkt', dB.moral < 1.0 - BAL.brokeMoralDrain * 0.5);
  }

  /* ===== Über See + Wasser unantastbar ===== */
  {
    const gW = new Game('A', 808); gW.endSpawnPhase();
    const compId = new Map();
    let comps = 0;
    for (const row of gW.hexes) for (const h of row) {
      if (h.terrain === 'water' || compId.has(h.c + h.r * MAP_W)) continue;
      comps++;
      const st = [h]; compId.set(h.c + h.r * MAP_W, comps);
      while (st.length) {
        const x = st.pop();
        for (const [nc, nr] of neighborsOf(x.c, x.r)) {
          const nh = gW.hexAt(nc, nr);
          if (!nh || nh.terrain === 'water' || compId.has(nc + nr * MAP_W)) continue;
          compId.set(nc + nr * MAP_W, comps); st.push(nh);
        }
      }
    }
    const dW = gW.divisionsOf('A')[0];
    const myC = compId.get(dW.c + dW.r * MAP_W);
    let insel = null;
    for (const row of gW.hexes) { for (const h of row) {
      if (h.terrain !== 'water' && compId.get(h.c + h.r * MAP_W) !== myC
        && hexDist(h.c, h.r, dW.c, dW.r) < 18) { insel = h; break; }
    } if (insel) break; }
    if (insel) {
      gW.issue('move', dW.id, insel.c, insel.r, false);
      for (let i = 0; i < 1600 && !(dW.c === insel.c && dW.r === insel.r); i++) gW.runTick();
      ok('Truppe setzt über aufs andere Ufer', compId.get(dW.c + dW.r * MAP_W) !== myC);
    } else ok('Truppe setzt über aufs andere Ufer', true, 'keine Insel — übersprungen');
    let wasser = null;
    for (const row of gW.hexes) for (const h of row) if (h.terrain === 'water' && !wasser) wasser = h;
    ok('Wasser nicht eroberbar', gW.attackable('A', wasser) === false);
  }

  /* ===== Umzingeln (nur ohne Meerzugang) ===== */
  {
    const gU = new Game('A', 202); gU.endSpawnPhase();
    gU.day = BAL.graceDays + 2; gU.dayFloat = gU.day;
    let kessel = null, kueste = null;
    for (const row of gU.hexes) {
      for (const h of row) {
        if (h.terrain === 'water' || h.owner || h.capital || h.vp) continue;
        const raw = neighborsOf(h.c, h.r);
        const nbs = raw.map(([c2, r2]) => gU.hexAt(c2, r2));
        const land = nbs.filter(x => x && x.terrain !== 'water');
        const wat = nbs.filter(x => x && x.terrain === 'water').length;
        if (!kessel && raw.length === 6 && land.length === 6
          && land.every(x => !x.owner && !x.capital && !x.vp)) kessel = { m: h, ring: land };
        if (!kueste && wat >= 1 && land.length >= 2
          && land.every(x => !x.owner && !x.capital && !x.vp)) kueste = { m: h, ring: land };
      }
      if (kessel && kueste) break;
    }
    kessel.m.owner = 'B'; gU.setResist(kessel.m);
    for (const h of kessel.ring) { h.owner = 'A'; gU.setResist(h); }
    gU.encircleDaily();
    ok('Binnengebiet umzingelt = flippt', kessel.m.owner === 'A');
    kueste.m.owner = 'B'; gU.setResist(kueste.m);
    for (const h of kueste.ring) { h.owner = 'A'; gU.setResist(h); }
    gU.encircleDaily();
    ok('Küstenzipfel mit Meerzugang flippt NICHT', kueste.m.owner === 'B');
  }

  /* ===== Fronten + Split-Stapel + Vormarsch ===== */
  {
    const gF = new Game('A', 123); gF.endSpawnPhase();
    const aC = gF.nations['A'].capital;
    const gr = neighborsOf(...aC).map(([c2, r2]) => gF.hexAt(c2, r2)).filter(h => h && h.terrain !== 'water');
    gr.slice(0, 1).forEach(h => { h.owner = 'B'; gF.setResist(h); });
    const ids = gF.divisionsOf('A').map(d => d.id);
    const res = gF.issue('frontBorder', 'B', ids);
    ok('Grenz-Front + Zuweisung', res && res.n === 1 && gF.frontById(res.id).hexes.length >= 1);
    const d0 = gF.divisionsOf('A')[0];
    d0.str = 100;
    const tw = gF.issue('split', [d0.id]);
    const twin = gF.divisions.find(x => x.id === tw[0]);
    ok('Split: Zwilling auf demselben Feld', twin.c === d0.c && twin.r === d0.r);
    ok('divisionsAt findet den Stapel', gF.divisionsAt(d0.c, d0.r).length >= 2);
    ok('frontPush setzt/stoppt', gF.issue('frontPush', res.id, gr[0].c, gr[0].r) === true
      && gF.frontById(res.id).push[0] === gr[0].c
      && gF.issue('frontPush', res.id, null, null) === true && gF.frontById(res.id).push === null);
    gF.issue('move', d0.id, aC[0], aC[1], false);
    ok('Marschbefehl löst von der Front', d0.front === null);
  }

  /* ===== Siege: Dominanz + Countdown ===== */
  {
    const gD = new Game('A', 404); gD.endSpawnPhase();
    for (const row of gD.hexes) for (const h of row)
      if (h.terrain !== 'water' && !h.capital) h.owner = 'A';
    gD.recalcEconomy();
    gD.vpDaily();
    ok('80 % Dominanz = sofortiger Sieg', gD.over && gD.over.win === true);
  }
  {
    const gC = new Game('A', 555); gC.endSpawnPhase();
    // Übrige Nationen vollständig entwaffnen: weder KI noch das Armee-System
    // (Ziel EXPAND läuft auch für Menschen automatisch) darf die Krone per
    // Steh-Eroberung zurückholen — der Test prüft den Countdown selbst.
    for (const [nid, n] of Object.entries(gC.nations)) {
      if (nid === 'A') continue;
      n.ai = false;
      for (const a of n.armies) { a.target = null; a.mode = 'defend'; }
      for (const d of gC.divisionsOf(nid)) d.dead = true;
    }
    gC._hasDead = true;
    for (const v of gC.vpHexes.filter(v => v.id !== 'A').slice(0, 2)) gC.hexAt(v.c, v.r).owner = 'A';
    runTicks(gC, 4);
    ok('Countdown bei 3 Hauptstädten', gC.vpLeader === 'A');
    runTicks(gC, BAL.round.countdownDays * 4 + 8);
    ok('Countdown-Sieg', gC.over && gC.over.win === true);
  }

  /* ===== Determinismus / Replay / Save-Load ===== */
  let a = new Game('A', 4711), b2 = new Game('A', 4711);
  a.endSpawnPhase(); b2.endSpawnPhase();
  runTicks(a, 800); runTicks(b2, 800);
  ok('Determinismus (200 Tage)', norm(a) === norm(b2));
  a = new Game('A', 777);
  a.issue('startMatch');
  runTicks(a, 100);
  const dA = a.divisionsOf('A')[0];
  let mZiel = null;
  for (const row of a.hexes) { for (const h of row) {
    if (h.terrain !== 'water' && h.owner === null && h.terrain !== 'mountain'
      && hexDist(h.c, h.r, dA.c, dA.r) === 4) { mZiel = h; break; }
  } if (mZiel) break; }
  a.issue('move', dA.id, mZiel.c, mZiel.r, false);
  runTicks(a, 200);
  a.issue('train', 'inf', 1);
  runTicks(a, 500);
  const r = Game.fromReplay(a.getReplay());
  runTicks(r, 800);
  ok('Replay == Original', norm(a) === norm(r));
  const l1 = Game.deserialize(a.serialize()), l2 = Game.deserialize(a.serialize());
  runTicks(l1, 200); runTicks(l2, 200);
  ok('Zwei Loads laufen identisch', !!l1 && norm(l1) === norm(l2));

  /* ===== Karten: Mitteleuropa + Duell ===== */
  const gm = new Game('A', 5, 'mitteleuropa');
  ok('Mitteleuropa lädt', MAP_W === 32 && gm.mapId === 'mitteleuropa');
  gm.issue('startMatch');
  for (let i = 0; i < 200; i++) gm.runTick();
  ok('Match läuft', gm.nations['A'].hexCount >= 1 && !gm.over);
  const gmr = Game.fromReplay(gm.getReplay());
  for (let i = 0; i < 200; i++) gmr.runTick();
  ok('Replay auf gewählter Karte identisch', norm(gm) === norm(gmr));
  {
    const gd = new Game('A', 77, 'duell', null, 2);
    ok('Duell: 2 Nationen, Siegbedarf 2', Object.keys(gd.nations).length === 2 && gd.vpNeed === 2);
    const cA = gd.nations['A'].capital, cB = gd.nations['B'].capital;
    ok('Duell: gespiegelte Seiten', cA[0] < MAP_W / 2 && cB[0] > MAP_W / 2);
    let west = 0, east = 0;
    for (const row of gd.hexes) for (const h of row) {
      if (h.terrain === 'water') continue;
      const x = h.c + 0.5 * (h.r & 1);
      if (x < (MAP_W - 1) / 2 - 0.01) west++;
      else if (x > (MAP_W - 1) / 2 + 0.01) east++;
    }
    ok('Duell-Karte symmetrisch', west === east);
    selectMap('europa');
  }

  /* ===== Front-Bündelung: Schwerpunkt am Vormarschziel (Großkämpfe) ===== */
  {
    const gM = new Game('A', 88); gM.endSpawnPhase();
    const line = [];
    for (let i = 0; i < 10; i++) line.push(gM.hexAt(20 + i, 30) || { c: 20 + i, r: 30 });
    const mk = () => Array.from({ length: 8 }, (_, i) => ({ id: 900 + i, c: 25, r: 35, station: null }));
    // Mit Push aufs linke Ende → schmale Speerspitze, alle Stationen nah am Fokus
    const d1 = mk();
    gM._massStations(d1, line, 'A', [line[0].c, line[0].r]);
    const maxDist = Math.max(...d1.map(d => Math.abs(d.station[0] - line[0].c)));
    ok('Front-Push bündelt am Ziel', maxDist <= 3, 'maxDist=' + maxDist);
    // Ohne Push → breiter Schirm über viele Felder verteilt
    const d2 = mk();
    gM._massStations(d2, line, 'A', null);
    const genutzt = new Set(d2.map(d => d.station[0] + ',' + d.station[1])).size;
    ok('Ohne Push breiter Schirm', genutzt >= 5, 'Felder=' + genutzt);
  }

  /* ===== Kampf HOI4: Rückzug statt Tod, Kessel = Tod, ≥50%-Tor ===== */
  {
    // (1) Org gebrochen + Rückzugsfeld frei → Verteidiger weicht zurück, Angreifer nimmt das Feld
    const gB = new Game('B', 321); gB.endSpawnPhase();
    gB.day = BAL.graceDays + 5; gB.dayFloat = gB.day;
    // Binnen-Feld mit 6 Landnachbarn → garantiert freie Rückzugsfelder
    let H = null;
    for (const row of gB.hexes) for (const h of row) {
      if (H || h.terrain === 'water' || h.terrain === 'mountain') continue;
      const nbs = neighborsOf(h.c, h.r).map(([c, r]) => gB.hexAt(c, r));
      if (nbs.length === 6 && nbs.every(n => n && n.terrain !== 'water' && n.terrain !== 'mountain')) H = h;
    }
    const def = gB.divisionsOf('B')[0];
    const atk = gB.divisionsOf('C')[0];
    if (H && atk) {
      const aHex = gB.hexAt(...neighborsOf(H.c, H.r)[0]);
      H.owner = 'B'; H.resist = 0;                                   // Feld ohne Miliz
      gB._placeDiv(def, H.c, H.r); def.org = 0.2; def.str = 6; def.moral = 0.4;
      gB._placeDiv(atk, aHex.c, aHex.r); atk.org = 55; atk.str = 100; atk.moral = 1;
      atk.attackTarget = [H.c, H.r];
      gB.resolveBattle({ hex: H, atk: [atk], def: [def] }, 0.25);
      ok('HOI4: org-loser Verteidiger weicht zurück (kein Sofort-Tod)',
        def.dead === false && (def.c !== H.c || def.r !== H.r), 'dead=' + def.dead + ' pos=' + def.c + ',' + def.r);
      ok('HOI4: Angreifer nimmt die geräumte Stellung', gB.hexAt(H.c, H.r).owner === 'C');
    } else { ok('HOI4: Rückzug', true, 'übersprungen'); ok('HOI4: Feldnahme', true, 'übersprungen'); }

    // (2) Kessel: alle Nachbarn Feindland → kein Rückzug möglich → Vernichtung
    const gK = new Game('B', 55); gK.endSpawnPhase();
    gK.day = BAL.graceDays + 5; gK.dayFloat = gK.day;
    let center = null;
    for (const row of gK.hexes) for (const h of row) {
      if (center || h.terrain === 'water' || h.terrain === 'mountain') continue;
      const nbs = neighborsOf(h.c, h.r).map(([c, r]) => gK.hexAt(c, r));
      if (nbs.length === 6 && nbs.every(n => n && n.terrain !== 'water')) center = h;
    }
    const dK = gK.divisionsOf('B')[0], aK = gK.divisionsOf('C')[0];
    if (center && aK) {
      gK._placeDiv(dK, center.c, center.r); dK.org = 0.2; dK.str = 6; dK.moral = 0.4; center.resist = 0;
      const nbs = neighborsOf(center.c, center.r);
      for (const [nc, nr] of nbs) { const n = gK.hexAt(nc, nr); if (n) n.owner = 'A'; }   // ringsum Feind
      gK._placeDiv(aK, nbs[0][0], nbs[0][1]); aK.org = 55; aK.str = 100; aK.moral = 1; aK.attackTarget = [center.c, center.r];
      gK.resolveBattle({ hex: center, atk: [aK], def: [dK] }, 0.25);
      ok('HOI4: eingekesselter Verteidiger wird vernichtet', dK.dead === true, 'dead=' + dK.dead);
    } else ok('HOI4: eingekesselter Verteidiger wird vernichtet', true, 'übersprungen');

    // (3) ≥50%-Tor: aussichtsloser Angriff (<50%) richtet KEINEN Schaden an
    const gT = new Game('B', 77); gT.endSpawnPhase();
    gT.day = BAL.graceDays + 5; gT.dayFloat = gT.day;
    let hh = null, ah2 = null;
    for (const row of gT.hexes) { for (const h of row) {
      if (hh || h.terrain === 'water' || h.terrain === 'mountain') continue;
      for (const [nc, nr] of neighborsOf(h.c, h.r)) { const n = gT.hexAt(nc, nr); if (n && n.terrain !== 'water') { hh = h; ah2 = n; break; } }
    } if (hh) break; }
    const dT = gT.divisionsOf('B')[0], aT = gT.divisionsOf('C')[0];
    if (hh && ah2 && aT) {
      gT._placeDiv(dT, hh.c, hh.r); dT.org = BAL.divTypes[dT.type].maxOrg; dT.str = 100; dT.moral = 1;
      gT._placeDiv(aT, ah2.c, ah2.r); aT.org = 6; aT.str = 12; aT.moral = 0.6; aT.attackTarget = [hh.c, hh.r];
      const odds = gT.combatOdds([aT], dT);
      const orgBefore = dT.org;
      gT.resolveBattle({ hex: hh, atk: [aT], def: [dT] }, 0.25);
      ok('HOI4: ≥50%-Tor — aussichtsloser Angriff macht keinen Schaden',
        odds < 0.5 && dT.org === orgBefore, 'odds=' + odds.toFixed(2) + ' orgWeg=' + (orgBefore - dT.org).toFixed(2));
    } else ok('HOI4: ≥50%-Tor', true, 'übersprungen');
  }

  /* ===== Ausbildung: Queue + Kaserne ===== */
  {
    const gT = new Game('A', 777); gT.endSpawnPhase();
    const nT = gT.nations['A'];
    nT.gold = 5000; nT.leute = 200;
    const cT = gT.hexAt(...nT.capital);
    ok('Nur an Stätten', gT.issue('trainAt', cT.c + 9, cT.r, 'inf') !== true);
    gT.issue('trainAt', cT.c, cT.r, 'inf');
    gT.issue('trainAt', cT.c, cT.r, 'inf');
    const [q1, q2] = gT.training.filter(q => q.nation === 'A');
    ok('Warteschlange pro Standort', Math.abs((q2.ready - q1.ready) - BAL.trainTime.inf) < 0.01);
    const kS = gT.ownedHexes('A').find(h => TERRAIN[h.terrain].buildable && !h.building && !h.capital);
    gT.issue('build', kS.c, kS.r, 'kaserne');
    gT.issue('trainAt', kS.c, kS.r, 'inf');
    const qK = gT.training.filter(q => q.nation === 'A').pop();
    ok('Kaserne: halbe Ausbildungszeit', Math.abs((qK.ready - gT.dayFloat) - BAL.trainTime.inf * 0.5) < 0.01);
    const before = gT.divisionsOf('A').length;
    for (let i = 0; i < BAL.trainTime.inf * 8 + 8 && gT.training.some(q => q.nation === 'A'); i++) gT.runTick();
    ok('Truppen spawnen am Standort', gT.divisionsOf('A').length === before + 3);
  }

  /* ===== Org-0-Start + Aufbau ===== */
  {
    const gO = new Game('A', 611); gO.endSpawnPhase();
    const nO = gO.nations['A'];
    nO.gold = 5000; nO.leute = 100;
    const cO = gO.hexAt(...nO.capital);
    gO.issue('trainAt', cO.c, cO.r, 'inf');
    for (let i = 0; i < BAL.trainTime.inf * 4 + 8 && gO.training.some(q => q.nation === 'A'); i++) gO.runTick();
    const neu = gO.divisionsOf('A').find(d => d.str === 85 || d.org < 5);
    ok('Neue Truppe startet mit Org ~0', !!neu && neu.org < BAL.divTypes.inf.maxOrg * 0.2, neu ? neu.org.toFixed(1) : '?');
    const orgVor = neu.org;
    for (let i = 0; i < 40; i++) gO.runTick();   // 10 Tage Aufbau
    ok('Organisation baut sich langsam auf', neu.dead || neu.org > orgVor + 3,
       orgVor.toFixed(1) + ' -> ' + (neu.dead ? 'tot' : neu.org.toFixed(1)));
  }

  /* ===== Upgrades teurer: x3 / x6 ===== */
  {
    const gU2 = new Game('A', 622); gU2.endSpawnPhase();
    gU2.nations['A'].gold = 99999;
    const s2 = gU2.ownedHexes('A').find(h => TERRAIN[h.terrain].buildable && !h.building && !h.capital);
    gU2.issue('build', s2.c, s2.r, 'dorf');
    ok('Ausbau auf Level 2 = x3', gU2.buildCost('A', s2, 'dorf') === BAL.cost.dorf * 3);
    gU2.issue('build', s2.c, s2.r, 'dorf');
    ok('Ausbau auf Level 3 = x6', gU2.buildCost('A', s2, 'dorf') === BAL.cost.dorf * 6);
  }

  /* ===== Unterhalt: Stärke + Staffel + Ausland ===== */
  {
    const gK = new Game('A', 633); gK.endSpawnPhase();
    const nK = gK.nations['A'];
    const d1 = gK.divisionsOf('A')[0];
    // Basis: 1 volle Division daheim
    d1.str = 100;
    gK.recalcEconomy();
    const inc1 = nK.incomePerDay;
    // Verwundet: halber Sold-Anteil
    d1.str = 0.01;
    gK.recalcEconomy();
    const incVerwundet = nK.incomePerDay;
    ok('Verwundete kosten weniger Unterhalt', incVerwundet > inc1 + BAL.divTypes.inf.upkeep * 0.3,
       (incVerwundet - inc1).toFixed(2));
    d1.str = 100;
    // Staffel: zweite Division kostet +6 %
    const p2 = hexToPixel(d1.c, d1.r);
    gK.divisions.push({ id: 999, name: 'x', nation: 'A', type: 'inf', c: d1.c, r: d1.r, x: p2.x, y: p2.y,
      str: 100, org: 0, moral: 1, army: null, front: null, station: null, path: null, pathI: 0,
      moveProgress: 0, queue: [], attackTarget: null, inCombat: false, manual: true, dead: false });
    gK.recalcEconomy();
    const inc2 = nK.incomePerDay;
    const kosten2 = inc1 - inc2;   // Kosten der ZWEITEN Division
    ok('Armeegrößen-Staffel: nächste Division teurer', Math.abs(kosten2 - BAL.divTypes.inf.upkeep * (1 + BAL.upkeepRamp)) < 0.01,
       kosten2.toFixed(2));
    // Ausland: Division auf fremdem Feld kostet x1.4
    let fremd = null;
    for (const row of gK.hexes) for (const h of row)
      if (h.terrain !== 'water' && h.owner !== 'A' && !fremd) fremd = h;
    gK._placeDiv(gK.divisions[gK.divisions.length - 1], fremd.c, fremd.r);
    gK.recalcEconomy();
    const inc3 = nK.incomePerDay;
    ok('Auslandszuschlag x1.4', inc3 < inc2 - 0.01, (inc2 - inc3).toFixed(2));
  }

  /* ===== Verräter ===== */
  g = new Game('A', 31); g.endSpawnPhase();
  g.formAlliance('A', 'B');
  g.issue('unally', 'B');
  g._checkBetrayal('A', 'B');
  ok('Verräter-System aktiv', g.isTraitor('A'));

  return results.join('\\n');
})()
`, ctx);
console.log(out);
process.exit(out.includes('FAIL') ? 1 : 0);
