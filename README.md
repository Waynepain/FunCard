# FunCard

Selbst gehostetes Karteikartenprogramm zum Lernen für Klausuren – mobil optimiert, als PWA installierbar und per SSO abgesichert.

> **Status:** Projektstart / Planung. Noch kein lauffähiger Code.

## Ziel

FunCard soll den Funktionsumfang professioneller Lernkarten-Apps (z. B. Anki) bieten, aber:

- **lokal / self-hosted** auf dem eigenen Server laufen,
- **auf dem Smartphone** als installierbare PWA angenehm nutzbar sein (auch offline),
- sich in die bestehende Infrastruktur einfügen (Reverse Proxy, Subdomain, **Authelia-SSO**),
- inhaltlich an den Studienfächern ausgerichtet sein, die im Obsidian-Second-Brain gepflegt werden.

## Geplanter Funktionsumfang

### Lernen
- Spaced Repetition mit modernem Algorithmus (z. B. FSRS, Fallback SM-2)
- Bewertung pro Karte (Nochmal / Schwer / Gut / Einfach)
- Tägliche Lernsitzung mit Limits für neue Karten und Wiederholungen
- Prüfungsmodus: gezieltes Lernen auf einen Klausurtermin hin
- Statistiken: Lernverlauf, Fälligkeitsprognose, Trefferquote je Fach/Deck

### Karten & Inhalte
- Struktur: Fach → Deck → Karte, zusätzlich Tags
- Kartentypen: Basis (Vorder-/Rückseite), umgekehrt, Lückentext (Cloze), Bild-Verdeckung (Image Occlusion, später)
- Markdown, LaTeX-Formeln, Bilder und Code-Blöcke
- Suche und Filter über alle Karten
- Import/Export (CSV, Markdown; Anki-Import optional)
- Optional: Karten aus Obsidian-Notizen erzeugen bzw. synchronisieren

### Plattform
- Progressive Web App: installierbar, Offline-Lernen, Synchronisation bei Verbindung
- Mobile-first-Bedienung (Wischgesten, große Touch-Flächen, Dark Mode)
- Mehrbenutzerfähig über SSO

## Betrieb & Sicherheit

- Auslieferung als Docker-Container (Ziel: Unraid-Homelab)
- Erreichbar über eine eigene Subdomain hinter dem Reverse Proxy
- Authentifizierung über **Authelia**:
  - bevorzugt OpenID Connect (OIDC) direkt in der App
  - alternativ Forward-Auth mit Übernahme der Benutzer-Header
- Keine eigene Passwortverwaltung in der App

## Tech-Stack

Noch offen – wird im nächsten Schritt festgelegt (Frontend-Framework, Backend, Datenbank, Offline-Sync-Strategie).

## Roadmap

1. Tech-Stack und Datenmodell festlegen
2. Grundgerüst: Backend, Datenbank, Frontend als PWA
3. Decks und Karten anlegen/bearbeiten
4. Lernsitzung mit Spaced-Repetition-Algorithmus
5. SSO-Anbindung an Authelia (OIDC)
6. Offline-Modus und Synchronisation
7. Statistiken, Import/Export, Prüfungsmodus
8. Obsidian-Integration

## Lizenz

[MIT](LICENSE)
