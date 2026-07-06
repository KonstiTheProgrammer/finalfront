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

## Spielprinzip (5-Spieler-Match, War-of-Dots-Stil)

- **5 Spieler, wählbare Karten:** Vor dem Match wählst du die Karte — **Europa (48×54,
  1435 Provinzen)** oder **Mitteleuropa (32×36, 891 Provinzen)**; weitere lassen sich in
  `tools/genmap.js` mit einem Fenster + Größe definieren. In der **Startphase (15 s)**
  wählst du deinen Spawn frei per Klick — alle sehen einander, Umziehen ist erlaubt,
  **kein Mindestabstand**: direkt neben dem Gegner spawnen ist eine legitime Strategie.
  Jeder beginnt mit **einer Stadt und einer Armee Krieger**.
- **Truppendreieck (EU4-Vorbild):** 🛡 Krieger halten die Linie und schlagen Kavallerie ·
  🐎 Kavallerie ist schnell/hart und schlägt Kanonen · 💥 Kanonen belagern (2,5× gegen
  Miliz) und schlagen Krieger — langsam und fragil.
- **Langsames Erobern:** Jedes Feld ist ein kleiner Kampf (Multiplayer-Pacing). Truppen
  erobern **freies Nachbarland von selbst** (zufälliges Feld, Warteschlangen-Gefühl).
- **⚔ Frontlinien statt Automatik:** **Strg+Klick auf die Grenze** zu einem Nachbarn erzeugt
  eine Front entlang des Grenzverlaufs (wächst mit) · **B** zieht eine eigene Linie über die
  Karte. Zugewiesene Truppen verteilen sich selbst und kämpfen dort; **S** teilt und
  verteilt neu, **M** vereint.
- **Sieg:** Wer **3 der 5 Hauptstädte** hält, startet den 50-Tage-Countdown. Nach 1000 Tagen
  gewinnt sonst die stärkste Macht. Eine Runde ≈ 20–30 Minuten.

### Weitere Systeme

- **Echte Europakarte:** Die Karte wird aus **realen Geodaten** erzeugt — Küstenlinien von
  Natural Earth (1:50m, Public Domain) und echten Höhendaten (Copernicus-DEM via
  open-meteo.com). Alpen, Karpaten und Kaukasus liegen dort, wo sie wirklich sind; Spawns
  sind frei wählbar. Miller-Projektion, alles startet neutral und grau.
- **🌊 Echte Flüsse** (Natural Earth): Rhein, Donau, Weichsel & Co. sind natürliche
  Verteidigungslinien — Übergänge sind langsam, Angriffe über den Fluss um bis zu 40 %
  geschwächt, Straßen wirken als Brücken. Flüsse werden von `tools/genmap.js` mitgeneriert.
- **⚔ Kessel:** Vom Nachschub abgeschnittene Gebietsteile werden rot markiert und gemeldet —
  Einkesselungen sind sichtbar, lehrbar und der Signature-Move des Spiels.
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
- **Seehandel:** Baue einen 🚢 **Hafen an einem Ufer** — er schickt automatisch Handelsschiffe
  zu Häfen anderer Nationen. Bei jeder Ankunft verdienen **beide Seiten Gold** (längere Routen
  bringen mehr). Kein Handel mit Nationen, mit denen du in den letzten Tagen gekämpft hast;
  Verbündete handeln immer. Häfen sind außerdem Versorgungs-Hubs (Küsteninvasionen!).
- Verliert eine Nation ihre Hauptstadt, verlegt sie sie — ist das Reich zu klein, geht es unter.
- **Wirtschaftskette:** 🏠 Dörfer erzeugen **Leute**, 🏙️ Städte erzeugen Leute **und** Gold
  (Ausbau eines Dorfs, Versorgungs-Hub), ⛏️ Minen bringen Gold (nur Hügel/Gebirge), 🚢 Häfen
  bringen Gold per Seehandel. 🎪 **Kasernen bilden Leute zu Soldaten aus** — neue Divisionen
  und Verstärkung kosten Gold + Soldaten. 🛣️ Straßen = Bewegung + Versorgung.
- **Direkte Kontrolle:** Deine Truppen gehorchen dir — Rechtsklick schickt sie exakt dorthin,
  auch mitten durch Feind- oder Neutralland (sie kämpfen sich durch) und über See (Invasionen!).
- **Logistik:** Versorgung fließt von Hauptstadt/Städten/Kasernen über Straßen ins Land.
  Ohne Nachschub verlieren Divisionen Stärke und Moral. Küsten erhalten Not-Seeversorgung.
- **Moral & Organisation:** Org sinkt im Kampf (bei 0: Rückzug), Moral steigt mit Siegen und
  fällt mit Niederlagen/Mangel — beides multipliziert die Kampfkraft.
- **Einkesselung** vernichtet Divisionen ohne Rückzugsweg; an der Küste werden sie über See
  evakuiert (Dünkirchen). Wer Hauptstadt **und** 40 % seines Landes verliert, kapituliert —
  alles Land geht an den Eroberer.
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
| Rechts-/Mittel-Ziehen / WASD | Karte verschieben |
| Mausrad / Minimap | Zoom / springen |
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
- `js/game.js` — Simulation: Wirtschaft, Versorgung, Kampf, Moral, Fronten, Seehandel, KI
- `js/ui.js` — Canvas-Rendering, Eingabe, Panels
- `js/main.js` — Spielschleife

Debug-API in der Konsole: `FF.game`, `FF.startGame('D')`, `FF.validate()`.
