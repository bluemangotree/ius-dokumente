# Architektur

## Betrieb

- Cloudflare Worker `dokumente` (Gratis-Tarif) liefert Oberfläche (`public/` als Assets) und API. `/api/*` läuft zuerst durch den Worker (`run_worker_first`).
- D1-Datenbank `dokumente` (Standort Westeuropa) für Metadaten, Schema über `migrations/`.
- R2-Bucket `dokumente` mit EU-Jurisdiktion für die Dateien. Schlüssel: `dokumente/<id>`. Der Schlüssel ändert sich nie, auch nicht beim Umbenennen oder beim Wechsel des Bereichs. Der sprechende Name steht in D1 und wird beim Herunterladen gesetzt.
- Cloudflare Access steht vor der ganzen Domain und meldet per E-Mail-Code an.

## Instanzen und Konfiguration

Eine Instanz ist ein Worker mit eigener D1, eigenem R2-Bucket und eigener Konfiguration. Privat ist der oberste Abschnitt in `wrangler.toml`, weitere Instanzen bekommen einen Abschnitt `[env.<name>]` (Vorlage für SOMA steht dort auskommentiert).

| Name | Art | Inhalt |
|---|---|---|
| `KONFIG` | Variable in `wrangler.toml` | `name`, `bereiche` (`id`, `name`), `personen` (`id`, `name`, `bereiche`). Geprüft in `src/konfig.js` |
| `ZUGRIFF` | Secret | JSON: E-Mail-Adresse → Personen-id. Steht nicht im Repo, weil es öffentlich ist |
| `ACCESS_TEAM_DOMAIN` | Variable im Dashboard | z. B. `meinteam.cloudflareaccess.com` |
| `ACCESS_AUD` | Variable im Dashboard | Application Audience (AUD) Tag der Access-Anwendung |
| `DEV_BENUTZER` | nur `.dev.vars` | Anmeldung ohne Access, wirkt nur auf `localhost` |

`keep_vars = true` sorgt dafür, dass im Dashboard gesetzte Variablen beim Veröffentlichen erhalten bleiben.

## Anmeldung und Sichtrechte

1. Access prüft die Person und gibt dem Worker das JWT im Header `Cf-Access-Jwt-Assertion` mit.
2. `src/zugriff.js` prüft Signatur (Schlüssel von `https://<team>/cdn-cgi/access/certs`, eine Stunde zwischengespeichert, bei unbekannter `kid` neu geladen), Aussteller, `aud` und Ablauf.
3. Die E-Mail aus dem Token wird über `ZUGRIFF` einer Person zugeordnet. Deren Bereiche bestimmen, was sie sieht.
4. Jede Abfrage in `src/dokumente.js` filtert auf diese Bereiche. Fremde Dokumente sehen aus wie nicht vorhandene (404).

Schreibende Aufrufe müssen den eigenen `Origin` tragen.

## API

| Aufruf | Zweck |
|---|---|
| `GET /api/ich` | Instanzname, Person, sichtbare Bereiche |
| `GET /api/dokumente?bereich=&status=&q=&vor=` | Liste, neueste zuerst, 50 je Seite, `vor` aus `weiter` der letzten Seite |
| `POST /api/dokumente` | Datei roh im Body. Header: `Content-Type`, `Content-Length`, `X-Bereich`, `X-Dateiname` (URL-kodiert), optional `X-Sha256` (im Browser berechnet, für Doppelte) |
| `GET /api/dokumente/:id` | Metadaten |
| `PATCH /api/dokumente/:id` | Metadaten ändern (Bereich, Name, Kategorie, Absender, Datum, Betrag in Cent, Tags, Status, …) |
| `GET /api/dokumente/:id/datei[?herunterladen]` | Datei anzeigen oder herunterladen |

Erlaubt sind PDF, JPEG, PNG, WebP und HEIC bis 25 MB.

## Datenmodell

- `dokumente`: eine Zeile je Datei. `status` ist `eingang` (neu, noch nicht eingeordnet), `rueckfrage` (unklar, mit Text in `rueckfrage`) oder `eingeordnet`. „Eingang“ aus der Spezifikation ist dieser Status, kein Ordner in R2.
- `protokoll`: wer wann was getan hat, nur ergänzt, nie geändert.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/index.js` | Router, Fehlerbehandlung, Dateiantwort |
| `src/zugriff.js` | Prüfung des Access-Tokens, Zuordnung zur Person |
| `src/konfig.js` | Lesen und Prüfen von `KONFIG` und `ZUGRIFF` |
| `src/dokumente.js` | Fachlogik, von Oberfläche und später MCP gemeinsam genutzt |
| `public/app.js` | Oberfläche in Vanilla JS |
| `public/sw.js` | Hält nur die Oberfläche offline vor, nie Dokumente |
| `scripts/lokal.mjs` | Lokaler Server mit node:sqlite und R2-Nachbildung, auch Grundlage der Tests |
| `scripts/icons.cjs` | Erzeugt die PNG-Icons |
| `test/app.test.mjs` | API-, Sichtrechte-, Konfigurations- und Access-Tests |
| `test/browser.cjs` | Durchlauf im Handy-Browser |
