# FINAL FRONT — Europa in Flammen

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

## Spielprinzip (Free-for-All wie OpenFront)

- **Echte Europakarte:** Die Karte wird aus **realen Geodaten** erzeugt — Küstenlinien von
  Natural Earth (1:50m, Public Domain) und echten Höhendaten (Copernicus-DEM via
  open-meteo.com). Alpen, Karpaten und Kaukasus liegen dort, wo sie wirklich sind; die
  Nationen spawnen an den echten Koordinaten ihrer Hauptstädte. Über **20.000 Landprovinzen**
  (180×205 Hexes, Miller-Projektion), alles startet neutral und grau.
- Jede der 15 Nationen beginnt mit **einem Dorf und zwei Divisionen** und breitet sich in
  neutrales Land aus.
- **Keine Kriegserklärungen:** Jeder Nicht-Verbündete ist jederzeit angreifbar — du auch.
- **Allianzen:** Rechtsklick (ohne Truppenauswahl) auf fremdes Land = Angebot; die Gegenseite
  muss annehmen. Angebote an dich erscheinen als Banner. Max. 2 Allianzen.
- **4 Truppentypen:** Infanterie (billig, hält die Linie), Garde (Elite), Panzer (schnell,
  Durchbruch), Artillerie (knackt Verteidigung und Miliz).
- **Seehandel:** Baue einen 🚢 **Hafen an einem Ufer** — er schickt automatisch Handelsschiffe
  zu Häfen anderer Nationen. Bei jeder Ankunft verdienen **beide Seiten Gold** (längere Routen
  bringen mehr). Kein Handel mit Nationen, mit denen du in den letzten Tagen gekämpft hast;
  Verbündete handeln immer. Häfen sind außerdem Versorgungs-Hubs (Küsteninvasionen!).
- Verliert eine Nation ihre Hauptstadt, verlegt sie sie — ist das Reich zu klein, geht es unter.
- **Wirtschaft:** Dörfer (Gold + Rekruten), Städte (viel Gold + Rekruten, Versorgungs-Hub,
  Ausbau eines Dorfs), Minen (viel Gold, nur auf Hügeln/Gebirge), Straßen (Bewegung +
  Versorgung), Kasernen (Ausbildung + kleiner Hub).
- **Fronten wie in HOI4:** Armeen bekommen ein Ziel (Gesamtfront oder eine bestimmte Nation)
  und einen Modus (Verteidigen/Angriff). Divisionen verteilen sich selbstständig entlang der
  Front, greifen an, weichen zurück, regenerieren. Armee umziehen = Truppen verlegen sich
  von Front zu Front. Einzelne Divisionen lassen sich per Rechtsklick manuell führen
  (auch über See — Invasionen!).
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
| Doppelklick auf Division | ganze Armee auswählen |
| **S** / **M** | ausgewählte Divisionen **teilen** / gleichen Typs **vereinen** |
| **Rechtsklick auf Neutral-/Feindland** | ausgewählte Truppen der Front zuweisen — sie verteilen sich selbst |
| Rechtsklick auf eigenes Land | Truppen dorthin verlegen |
| Alt+Rechtsklick | exakter Marschbefehl (Küste = Invasion per Schiff) |
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
