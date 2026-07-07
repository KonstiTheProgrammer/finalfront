# FINAL FRONT — Europa in Flammen

**▶ Direkt im Browser spielen:** https://konstitheprogrammer.github.io/finalfront/

Echtzeit-Strategiespiel im Browser: eine Hexfeld-Karte Europas, Wirtschaftsaufbau,
HOI4-artiges Frontlinien-System mit Logistik und Moral. Kein Build-Step, kein Framework —
reines HTML/CSS/JavaScript.

## Starten

**Am einfachsten:** `index.html` doppelklicken (läuft direkt im Browser).

Oder mit lokalem Server:

```
python -m http.server 4173
# dann http://localhost:4173 öffnen
```

## 🌐 Multiplayer (echte Spieler)

Zwei Warteschlangen auf dem Startbildschirm: die **5-Spieler-Runde** (Karte rotiert:
Europa → Mitteleuropa → Westeuropa) und das **⚔️ 1v1-Duell** auf der spiegelsymmetrisch
fairen **Duell-Insel** (startet bei 2 Spielern, gespiegelte Startseiten, Sieg mit 2
Hauptstädten oder 80 %). Runden starten bei voller Lobby oder sobald **alle Anwesenden
bereit** sind (freie Plätze übernehmen Bots). Feste Geschwindigkeit (1 Tag/s), kein
Pausieren/Speichern. Bei Verbindungsabbruch übernimmt die KI die Nation. **Enter = Chat.**

**Technik (100 % gratis):** deterministischer **Lockstep** — der Server
(`server/mpserver.js`, Node + ws) simuliert nichts, er stempelt Kommandos mit der Nation des
Absenders und taktet alle Clients mit 8 Steps/s; jeder Client rechnet dieselbe Simulation.
Server-Discovery über ein GitHub-Gist, öffentlich per Cloudflare-Quick-Tunnel (kostenlos,
ohne Account).

**Selbst hosten:**
```bash
tools/mpserver/start.sh     # startet Server + Tunnel und trägt die Adresse im Gist ein
```
Fenster offen lassen; Ctrl+C meldet den Server sauber ab. Die Webseite findet den Server
automatisch (lokal hat `ws://localhost:8571` Vorrang — praktisch zum Entwickeln).

## Spielprinzip (5-Spieler-Match, War-of-Dots-Stil)

- **5 Spieler, wählbare Karten:** Vor dem Match wählst du die Karte — **Europa (48×54)**,
  **Mitteleuropa (32×36)**, **Westeuropa (34×40)** oder die **⚔️ Duell-Insel (20×22, nur
  2 Spieler, spiegelsymmetrisch — `tools/genduel.js`)**; weitere lassen sich in
  `tools/genmap.js` mit einem Fenster + Größe definieren. In der **Startphase (15 s)**
  wählst du deinen Spawn frei per Klick — alle sehen einander, Umziehen ist erlaubt,
  **kein Mindestabstand**: direkt neben dem Gegner spawnen ist eine legitime Strategie.
  Jeder beginnt mit **einer Stadt und einer Armee Krieger**.
- **Truppendreieck (EU4-Vorbild):** 🛡 Krieger halten die Linie und schlagen Kavallerie ·
  🐎 Kavallerie ist schnell/hart und schlägt Kanonen · 💥 Kanonen belagern (2,5× gegen
  Miliz) und schlagen Krieger — langsam und fragil.
- **Eroberung durch Städte:** Städte und Hauptstädte **strahlen aus** — freies Umland im
  kleinen Radius (2 Felder) schließt sich langsam von selbst an (näher = schneller); Feindland bleibt
  unberührt. **Truppen laufen überall hin** (auch durch fremdes Land — ohne Verbindung
  aber ohne Nachschub) und übernehmen im **Stehen genau ihr Standfeld**: langsam,
  stärkeabhängig, 💥 Kanonen stark · 🐎 Kavallerie mittel · 🛡 Krieger schwach; ⛰️ Berge
  und 🌊 Flussfelder sind zäher. Kämpfe gibt es nur gegen feindliche Truppen.
- **⚔ Frontlinien statt Automatik:** **Strg+Klick auf die Grenze** zu einem Nachbarn erzeugt
  eine Front entlang des Grenzverlaufs (wächst mit) · **B** zieht eine eigene Linie über die
  Karte. Zugewiesene Truppen verteilen sich selbst und kämpfen dort; **S** teilt und
  verteilt neu, **M** vereint. **🎯 Vormarsch:** Front-Badge anklicken, dann ein Ziel auf
  der Karte — die Front kämpft sich dorthin vor und meldet, wenn das Ziel erreicht ist.
- **Sieg:** Wer **3 der 5 Hauptstädte** hält, startet den 50-Tage-Countdown — und wer
  **80 % der Karte** kontrolliert, gewinnt sofort (Dominanz). Nach 600 Tagen gewinnt sonst
  die stärkste Macht. Eine Runde ≈ 10–20 Minuten.

### Weitere Systeme

- **Echte Europakarte:** Die Karte wird aus **realen Geodaten** erzeugt — Küstenlinien von
  Natural Earth (1:50m, Public Domain) und echten Höhendaten (Copernicus-DEM via
  open-meteo.com). Alpen, Karpaten und Kaukasus liegen dort, wo sie wirklich sind; Spawns
  sind frei wählbar. Miller-Projektion, alles startet neutral und grau.
- **🌊 Echte Flüsse** (Natural Earth): Rhein, Donau, Weichsel & Co. sind natürliche
  Verteidigungslinien — Übergänge sind langsam, Angriffe über den Fluss um bis zu 40 %
  geschwächt, Straßen wirken als Brücken. Flüsse werden von `tools/genmap.js` mitgeneriert.
- **⚔ Kessel (HOI-Stil):** Vom Nachschub abgeschnittene Gebietsteile werden rot markiert;
  eingeschlossene Divisionen kämpfen mit halber Kraft und nehmen +45 % Schaden. **🔒 Umzingelt
  = verloren:** kleine Gebiete (≤ 12 Felder, ohne Hauptstadt/Verteidiger), die komplett von
  EINER Nation **eingezäunt** sind, fallen ihr kampflos zu — nur ohne Meerzugang: ein
  abgeschnittener Küstenzipfel zählt nicht als umzingelt.
- **🐍 Verräter-System:** Wer ein Bündnis löst und den Ex-Verbündeten binnen 25 Tagen
  angreift, ist 60 Tage öffentlich geächtet — kein Handel, keine Bündnisse, Freiwild.
- **Easy Entry:** Das erste Match führt mit 5 kontextuellen Aufgaben durch Eroberung und
  Wirtschaftskette (inkl. vorgeschlagener Bauplätze auf der Karte); ein Berater warnt bei
  Engpässen genau dann, wenn sie auftreten — überspringbar, erscheint nur einmal.
- **Deterministische Simulation + Replays:** Fester Simulationstakt, geseedeter Zufall und
  ein Kommando-Log für alle Spieler-Eingriffe — gleiche Saat + gleiche Befehle ergeben
  bit-identische Verläufe. Nach jeder Runde: **🎬 Replay ansehen** auf dem Endbildschirm.
  Das ist zugleich das technische Fundament für späteres Lockstep-Multiplayer.
- **Endphase & Rangliste:** Live-Rangliste rechts; ab Tag 700 ermüden Milizen und der
  Aufholbonus schwindet — die Karte konsolidiert sich, jede Runde endet mit einem Sieger.
- **Keine Kriegserklärungen:** Jeder Nicht-Verbündete ist angreifbar — du auch. In den ersten
  **40 Tagen gilt eine Schonfrist** (nur Expansion ins Neutralland), damit alle fair starten.
- **Fair & Multiplayer-tauglich balanciert:** Aufholmechanik (kleine Nationen bis +35 %
  Einkommen, Spitzenreiter bis −25 %), Heimatverteidigungs-Bonus für Spieler unter
  12 Provinzen, und die KI bevorzugt große Gegner statt Sterbende zu überrennen —
  Snowballing wird gebremst, Aufholen bleibt möglich.
- **Allianzen:** Rechtsklick (ohne Truppenauswahl) auf fremdes Land = Angebot; die Gegenseite
  muss annehmen. Angebote an dich erscheinen als Banner. Max. 2 Allianzen.
- Verliert eine Nation ihre Hauptstadt, verlegt sie sie — ist das Reich zu klein, geht es unter.
- **Wirtschaft — Gebäude mit klaren Rollen und Ausbau-Leveln:** ⛏️ **Mine** = 🔩 Eisen für
  Kanonen (überall, Hügel-Bonus) · 🚜 **Farm** = 🐎 Pferde für Kavallerie (nur Ebene) ·
  🪓 **Forsterei** = Gold + etwas Leute (nur Wald) · 🎣 **Fischerei** = Gold + viele Leute
  (Küstenwasser neben eigenem Land) · 🏠 **Dorf** = nur Leute.
  Gleiches Gebäude nochmal bauen = **Level 2/3** (Kosten & Ertrag skalieren). Unbebautes Land
  arbeitet passiv mit (viel schwächer). **👥 Bevölkerungslimit:** das Reich versorgt nur
  begrenzt viele Leute (Basis 20 · +0,2 je Landfeld · Stadt +25 · Dorf +10, Fischerei +8,
  Farm +6, Forsterei +4, Kaserne +5, je × Level) — am Limit stoppt das Wachstum. **ALLE
  Truppen rekrutieren 👥 Leute** — Kavallerie kostet zusätzlich 🐎 Pferde (Farmen),
  Kanonen 🔩 Eisen (Minen). Kasernen bilden doppelt so schnell aus. **💰 Unterhalt:**
  jede Division kostet Gold/Tag (Krieger 0,4 · Kavallerie 1,0 · Kanonen 1,5) — ist die
  Kasse leer bei negativem Einkommen, verlieren alle Truppen Moral (Pleite!).
- **Weniger HUD:** 📜 Ereignis-Log (standardmäßig aus), 🏆 Rangliste und 🗺️ Minimap sind
  über die Topbar einzeln ausblendbar (gemerkt im Browser). Truppen können **über See**
  ziehen (langsamer, Angriff von See geschwächt); Wasser ist nicht eroberbar. 🏙️ **Stadt** = Dorf-Ausbau: Gold + Leute +
  Versorgungs-Hub, und **Straßen zu nahen Städten wachsen automatisch** (schnellere Truppen).
  🗼 **Wehrturm**: Miliz umliegender Felder ×1,5, Ausbau = doppelte Reichweite — fällt er,
  wirkt er für den Eroberer. 🎪 **Kasernen bilden Leute zu Soldaten aus** — neue
  Divisionen und Verstärkung kosten Gold + Soldaten. 🛣️ Straßen = Bewegung + Versorgung.
- **Bauen per Feld-Klick:** Eigenes Feld anklicken → Liste, was genau dort gebaut werden
  kann (inkl. Ausbau). **🎖️ Ausbildung:** Städte, Hauptstadt und Kasernen bilden Truppen
  aus (Warteschlange, goldener Fortschrittsring) — **Kasernen doppelt so schnell**, die
  fertige Division erscheint am Ausbildungsort.
- **Direkte Kontrolle:** Deine Truppen gehorchen dir — Rechtsklick schickt sie exakt dorthin,
  auch mitten durch Feind- oder Neutralland (sie kämpfen sich durch) und über See (Invasionen!).
- **Logistik:** Versorgung fließt von Hauptstadt/Städten/Kasernen über Straßen ins Land.
  Ohne Nachschub verlieren Divisionen Stärke und Moral. Küsten erhalten Not-Seeversorgung.
- **Moral & Organisation:** Org sinkt im Kampf (bei 0: Rückzug), Moral steigt mit Siegen und
  fällt mit Niederlagen/Mangel — beides multipliziert die Kampfkraft.
- **Einkesselung** vernichtet Divisionen ohne Rückzugsweg; an der Küste werden sie über See
  evakuiert (Dünkirchen). Wer Hauptstadt **und** 40 % seines Landes verliert, kapituliert —
  alles Land geht an den Eroberer.
- **Gefechtsprognose (HOI-Bubble):** Über laufenden Kämpfen und beim Zeigen auf feindliche
  Armeen (mit eigener Auswahl) zeigt eine grün/gelb/rote Bubble die Gewinnchance —
  RPS-Dreieck, Gelände, Fluss, Organisation und Kessel eingerechnet.
- **📚 Armee-Stapel:** Mehrere Armeen können auf einem Feld stehen (Split teilt an Ort und
  Stelle); der Stapel zeigt seine Anzahl, Klick listet die Armeen in der Einheiten-Leiste.
- Die KI baut, rüstet, erklärt Kriege und schließt Frieden — die Welt wartet nicht.

## Steuerung

| Eingabe | Wirkung |
|---|---|
| **Links-Ziehen** | Box-Auswahl mehrerer Divisionen |
| Linksklick | Feld/Division auswählen · **Strg/Shift** = zur Auswahl hinzufügen/abwählen |
| Doppelklick auf Truppe | alle eigenen Truppen auswählen |
| **S** / **M** | ausgewählte Divisionen **teilen** / gleichen Typs **vereinen** |
| **Rechtsklick** | Marschbefehl: Truppen ziehen exakt dorthin, kämpfen sich durch Feind-/Neutralland (Küste = Invasion per Schiff) |
| **Shift+Rechtsklick** | Wegpunkt anhängen — Truppen laufen die Punkte der Reihe nach ab |
| **Strg+Klick auf eine Grenze** | Frontlinie gegen den Nachbarn — Auswahl verteilt sich darauf |
| **B** + Linie ziehen | eigene Frontlinie über die Karte zeichnen |
| Rechtsklick ohne Auswahl auf fremde Nation | Allianz anbieten |
| Zwei-Finger-Scroll (Trackpad) / Rechts-/Mittel-Ziehen / WASD | Karte verschieben (umsehen) |
| Pinch / Mausrad / Minimap | Zoom / springen |
| Klick auf Front-Badge → Klick aufs Ziel | 🎯 Front-Vormarsch |
| Bauen-Tab → Karte klicken | Bau-Modus; Straßen lassen sich ziehen |
| V | Versorgungs-Overlay |
| Pos1 | zur Hauptstadt |
| Leertaste · 1–4 | Pause · Geschwindigkeit |
| Esc | Auswahl / Bau-Modus aufheben |

Autosave läuft automatisch (~1×/Minute); „Weiterspielen" auf dem Startbildschirm lädt den letzten Stand.

## Dateien

- `tools/genmap.js` — **Kartengenerator**: lädt Natural-Earth-Küsten + echte Höhendaten und
  rastert sie aufs Hexgitter. Neu erzeugen: `node tools/genmap.js` (braucht Internet).
  Region/Auflösung oben in `CONFIG` einstellbar (Bounding-Box, Gittergröße).
- `js/mapdata.js` — die generierte Karte (nicht von Hand editieren)
- `js/map.js` — Nationen, Terrain-Tabellen, Hex-Mathematik
- `js/game.js` — Simulation: Wirtschaft, Versorgung, Kampf, Moral, Fronten, Kessel, KI
- `js/ui.js` — Canvas-Rendering, Eingabe, Panels
- `js/net.js` — Multiplayer-Client (Lobby, Lockstep-Steps, Server-Discovery)
- `js/main.js` — Spielschleife
- `server/mpserver.js` — Multiplayer-Relay (Lobby, Map-Rotation, Step-Taktung)
- `tools/mpserver/start.sh` — Server + Cloudflare-Tunnel + Gist-Update (alles gratis)

Debug-API in der Konsole: `FF.game`, `FF.startGame('D')`, `FF.validate()`.
