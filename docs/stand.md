# Stand

Zuletzt aktualisiert: 2026-11-22. Am Ende jeder Session aktualisieren.

## Gebaut

- Phase 1: Schema (`0001`), Upload vom Handy nach R2, Liste mit Filtern und Suche, Detailansicht mit Bearbeiten, Anmeldung über Cloudflare Access, Sichtrechte je Bereich, Konfiguration je Instanz, PWA.

## Angelegt in Cloudflare

- D1-Datenbank `dokumente` (Westeuropa), id in `wrangler.toml`, noch ohne Tabellen.

## Noch nicht veröffentlicht

Es fehlen (siehe `einrichtung.md`): R2 aktivieren, Bucket anlegen, Veröffentlichen, Secret `ZUGRIFF`, Access aktivieren, `ACCESS_TEAM_DOMAIN` und `ACCESS_AUD`.

## Geprüft

- `npm test`: 25 Tests (API, Sichtrechte, Doppelte, Dateitypen, Konfiguration, Prüfung des Access-Tokens mit echten RSA-Schlüsseln).
- `wrangler dev` mit lokaler D1 und R2 (echte Worker-Laufzeit): Upload wird nach R2 gestreamt, Datei kommt unverändert zurück, Umlaute im Dateinamen.
- Browsertest im iPhone-Format gegen `wrangler dev`: Hochladen, Doppelte, Bearbeiten, Suche, 320 px ohne Querscrollen.
- `wrangler deploy --dry-run`: Konfiguration gültig.

## Noch nie real geprüft

- Access-Anmeldung mit echtem Token
- Echte Handys, Installation als PWA, Kamera-Upload, HEIC vom iPhone
- PDF öffnen aus der installierten PWA auf dem iPhone

## Nächste Schritte

1. Einrichtung nach `einrichtung.md`, dann die ungeprüften Punkte.
2. Phase 2 (MCP-Server), siehe `plaene/dokumentenverwaltung.md`.
