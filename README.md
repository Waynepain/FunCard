# FunCard

Selbst gehostetes Karteikartenprogramm zum Lernen für Klausuren – mobil optimiert, als PWA installierbar, offline nutzbar.

> **Status:** v0.1.0 – lauffähige erste Version mit 240 Karten für die sechs Module im WS 2026/27.

## Was drin ist

**Fächer (Decks in `decks/`)**

| Kürzel | Modul | Karten |
|---|---|---|
| WK | Werkstoffkunde | 98 |
| TM1 | Technische Mechanik 1 | 20 |
| QUM | Prozessorientiertes Qualitäts- und Umweltmanagement | 26 |
| TLP | Technik logistischer Prozesse | 44 |
| ROB | Robotik | 36 |
| AISE | AI Systems Engineering | 16 |

Die Karten stammen aus den Mitschriften und Folien im Obsidian Second Brain (`studium/`). Jede Karte hat eine Quellenangabe. Karten mit dem Thema `ungeprüft` beruhen auf ergänzten Lösungen (nicht auf Folie oder Mitschrift) und sollten gegen die Unterlagen geprüft werden – die App kennzeichnet sie auf der Rückseite.

**Lernmodi**

- **Karteikarten** – Spaced Repetition nach dem Anki-Prinzip (SM-2 mit Lernstufen): Nochmal / Schwer / Gut / Einfach, Intervallvorschau auf den Knöpfen, Tageslimit für neue Karten je Fach, Wischgesten (links = Nochmal, rechts = Gut), Tastatur (Leertaste, 1–4)
- **Quiz** – Multiple Choice; Ablenker kommen aus anderen Karten desselben Fachs, bevorzugt zum gleichen Thema
- **Eintippen** – kurze Antworten (Zahlenwerte, Begriffe) mit toleranter Prüfung (Tippfehler, Komma/Punkt)
- **Lückentext** – Lücken in Definitionen und Formeln ausfüllen
- **Durchblättern** – alle Karten ohne Plan, z. B. kurz vor der Klausur

**Außerdem:** Filter nach Thema, Suche über alle Karten, eigene Karten anlegen/bearbeiten, Karten aussetzen, Statistik (14-Tage-Verlauf, Prognose, Stand je Fach, Behaltensquote), Prüfungstermine mit Countdown, Hell/Dunkel, Sicherung als JSON, Import von CSV/TSV (`Frage;Antwort;Themen`) und Decks.

## Kartenformat

```json
{"id":"wk-005","type":"cloze","text":"Spannung σ = Kraft {{F in N}} durch {{Fläche in mm²}}.","tags":["Festigkeit"],"src":"WK - Mitschrift 2026-10-07"}
```

| `type` | Felder | Verhalten |
|---|---|---|
| `basic` | `front`, `back` | Vorder-/Rückseite; kurze Antworten auch im Eintipp-Modus |
| `type` | `front`, `back` | für Eintippen gedacht (Zahl, Begriff) |
| `mc` | `front`, `back`, `choices` | feste Antwortmöglichkeiten im Quiz |
| `cloze` | `text` mit `{{Lücke}}` | Lückentext |

Neue Fächer: Datei in `decks/` anlegen und in `decks/index.json` eintragen. IDs nie ändern – an ihnen hängt der Lernstand.

## Technik

- Reine Web-App ohne Build-Schritt: HTML, CSS, JavaScript-Module
- Lernstand in IndexedDB im Browser (pro Gerät), Service Worker für Offline-Betrieb
- Auslieferung über nginx im Docker-Container

```
index.html, manifest.webmanifest, sw.js
css/app.css
js/app.js    Oberfläche, Lernmodi, Statistik, Einstellungen
js/srs.js    Wiederholungsplan (SM-2 mit Lernstufen)
js/db.js     IndexedDB
js/util.js   Lückentext, Antwortvergleich, CSV
decks/       Kartendecks je Fach
```

## Betrieb

Lokal testen:

```bash
cd FunCard
python3 -m http.server 8080
# Browser: http://localhost:8080  (PNG-Icons entstehen erst im Docker-Build)
```

Als Container (z. B. Unraid):

```bash
git clone https://github.com/Waynepain/FunCard.git
cd FunCard
docker compose up -d --build
# erreichbar auf Port 8095
```

Aktualisieren:

```bash
cd FunCard
git pull
docker compose up -d --build
```

### Hinter Reverse Proxy und Authelia

Die App selbst hat keine Anmeldung; geschützt wird sie per **Forward-Auth** am Reverse Proxy (SWAG/nginx + Authelia). Für die PWA wichtig:

- Das Manifest wird mit `crossorigin="use-credentials"` geladen, damit das Authelia-Cookie mitgeht.
- Der Service Worker cached keine Umleitungen zur Anmeldeseite.
- Die Sitzungsdauer in Authelia großzügig setzen (z. B. `remember_me`), sonst fragt die installierte App häufig nach der Anmeldung. Offline funktioniert das Lernen trotzdem.

## Roadmap

1. ~~Grundgerüst als PWA, Decks, Spaced Repetition, Lernmodi~~ (v0.1)
2. Server-Sync des Lernstands pro Benutzer (Benutzer aus den Authelia-Headern `Remote-User`), damit Handy und Laptop denselben Stand haben
3. Formeln mit KaTeX, Bilder auf Karten (Folienausschnitte, Freikörperbilder)
4. Karten direkt aus Obsidian-Notizen erzeugen und abgleichen
5. Prüfungsmodus: Lernplan rückwärts vom Klausurtermin
6. FSRS als Alternative zu SM-2

## Lizenz

[MIT](LICENSE)
