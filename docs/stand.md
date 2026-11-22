# Stand

Zuletzt aktualisiert: 2026-11-22. Am Ende jeder Session aktualisieren.

## Gebaut

- Phase 3: Mail-Eingang (`0003`), Anstoß der geplanten Claude-Aufgabe alle 15 Minuten, Aufgabentext in `claude-aufgabe.md`.
- Phase 2: MCP-Server für Claude mit OAuth, als gemeinsamer Zugang mit allen Bereichen (`KONFIG.claude`), weil Andrei und Sven ein Claude-Konto teilen, (Freigabe hinter Access), Werkzeuge für Eingang, Lesen, Einordnen, Suchen und Fristen, Tabelle `fristen` (`0002`).
- Phase 1: Schema (`0001`), Upload vom Handy nach R2, Liste mit Filtern und Suche, Detailansicht mit Bearbeiten, Anmeldung über Cloudflare Access, Sichtrechte je Bereich, Konfiguration je Instanz, PWA.

## Angelegt in Cloudflare

- D1-Datenbank `dokumente` (Westeuropa), id in `wrangler.toml`, noch ohne Tabellen.
- KV-Namespace `dokumente-oauth` für OAuth, id in `wrangler.toml`.

## Noch nicht veröffentlicht

Es fehlen (siehe `einrichtung.md`): R2 aktivieren, Bucket anlegen, Veröffentlichen, Secret `ZUGRIFF`, Access aktivieren, `ACCESS_TEAM_DOMAIN` und `ACCESS_AUD`, Access-Ausnahme für `/mcp`, Connector in claude.ai, Email Routing (Schritt 6), geplante Aufgabe mit API-Trigger und Secrets (Schritt 7).

## Geprüft

- `npm test`: 49 Tests, davon 11 für Mail-Eingang und Anstoß.
- `wrangler dev`: Mail über `/cdn-cgi/handler/email` an `dokumente+sven@…` → Anhang als Dokument im Bereich Sven; Zeitplan über `/cdn-cgi/handler/scheduled`.
- Phase 2, `npm test`: 38 Tests, davon 13 für MCP (mit gemeinsamem Claude-Zugang) (Werkzeuge, Sichtrechte über MCP, Suche mit Summe, Fristen).
- OAuth-Ablauf in `wrangler dev` von Anfang bis Ende: Metadaten, 401 mit Hinweis auf die Metadaten, Registrierung, Freigabeseite, Code gegen Token mit PKCE, MCP-Aufrufe mit Token, falsches Token abgelehnt.
- Phase 1, `npm test`: 25 Tests (API, Sichtrechte, Doppelte, Dateitypen, Konfiguration, Prüfung des Access-Tokens mit echten RSA-Schlüsseln).
- `wrangler dev` mit lokaler D1 und R2 (echte Worker-Laufzeit): Upload wird nach R2 gestreamt, Datei kommt unverändert zurück, Umlaute im Dateinamen.
- Browsertest im iPhone-Format gegen `wrangler dev`: Hochladen, Doppelte, Bearbeiten, Suche, 320 px ohne Querscrollen.
- `wrangler deploy --dry-run`: Konfiguration gültig.

## Noch nie real geprüft

- Access-Anmeldung mit echtem Token
- Echte Handys, Installation als PWA, Kamera-Upload, HEIC vom iPhone
- PDF öffnen aus der installierten PWA auf dem iPhone
- Verbindung mit claude.ai, vor allem ob PDFs über `dokument_lesen` beim Modell ankommen
- Echte Mails (Weiterleitungen aus Mail-Programmen, große Anhänge, CPU-Limit) und echter Anstoß der geplanten Aufgabe

## Nächste Schritte

1. Einrichtung nach `einrichtung.md`, dann die ungeprüften Punkte.
2. Claude verbinden und Eingang einmal von Hand einordnen lassen.
3. Mail-Eingang und geplante Aufgabe einrichten (Schritte 6 und 7).
4. Phase 4 (Fristen-Erinnerung, Export, Backup), siehe `plaene/dokumentenverwaltung.md`.
