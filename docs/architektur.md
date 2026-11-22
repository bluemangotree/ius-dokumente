# Architektur

## Betrieb

- Cloudflare Worker `dokumente` (Gratis-Tarif) liefert Oberfläche (`public/` als Assets) und API. `/api/*` läuft zuerst durch den Worker (`run_worker_first`).
- D1-Datenbank `dokumente` (Standort Westeuropa) für Metadaten, Schema über `migrations/`.
- R2-Bucket `dokumente` mit EU-Jurisdiktion für die Dateien. Schlüssel: `dokumente/<id>`. Der Schlüssel ändert sich nie, auch nicht beim Umbenennen oder beim Wechsel des Bereichs. Der sprechende Name steht in D1 und wird beim Herunterladen gesetzt.
- KV-Namespace `dokumente-oauth` (Binding `OAUTH_KV`) für die OAuth-Bibliothek: Clients, Freigaben, Token (nur als Hash).
- Email Routing leitet Mails an den Worker (`email`), ein Zeitplan alle 15 Minuten ruft `scheduled` auf.
- Cloudflare Access steht vor der ganzen Domain und meldet per E-Mail-Code an. Ausnahme (Bypass): `/mcp`, `/oauth/*` und `/.well-known/*`, dort prüft der Worker selbst per OAuth.

## Instanzen und Konfiguration

Eine Instanz ist ein Worker mit eigener D1, eigenem R2-Bucket und eigener Konfiguration. Privat ist der oberste Abschnitt in `wrangler.toml`, weitere Instanzen bekommen einen Abschnitt `[env.<name>]` (Vorlage für SOMA steht dort auskommentiert).

| Name | Art | Inhalt |
|---|---|---|
| `KONFIG` | Variable in `wrangler.toml` | `name`, `bereiche` (`id`, `name`), `personen` (`id`, `name`, `bereiche`), optional `claude` (`name`, `bereiche`, `freigeben`). Geprüft in `src/konfig.js` |
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

## Claude (MCP und OAuth)

- `src/index.js` übergibt alles an `OAuthProvider` aus `@cloudflare/workers-oauth-provider`. Die Bibliothek beantwortet `/.well-known/oauth-*`, `/oauth/register` (dynamische Registrierung, wie claude.ai sie nutzt) und `/oauth/token`, und lässt `/mcp` nur mit gültigem Token durch.
- `/authorize` (`src/oauth.js`) liegt hinter Access. Die Person ist also schon angemeldet und bestätigt auf der Freigabeseite die Verbindung. Im Token steht nur ihre E-Mail.
- Wen Claude darstellt, bestimmt `claudeZugang()` in `src/konfig.js`: Ohne `KONFIG.claude` die Person selbst. Mit `KONFIG.claude` einen eigenen Zugang `claude` mit den dort genannten Bereichen, den nur Personen aus `freigeben` verbinden dürfen. Die private Instanz nutzt das, weil Andrei und Sven ein Claude-Konto teilen (siehe `entscheidungen/2026-11-22-gemeinsamer-claude-zugang.md`). Im Protokoll steht dann `claude`.
- `src/mcp.js` bestimmt den Zugang bei jedem Aufruf neu aus `ZUGRIFF` und `KONFIG`. Wer dort entfernt wird, sperrt auch Claude sofort. Alle Werkzeuge laufen über `src/dokumente.js` und damit über dieselbe Prüfung der Bereiche wie die Oberfläche.
- Die Ressource-URL ist `<Adresse der Instanz>/mcp`, je Origin entsteht ein eigener Anbieter. So braucht keine Instanz ihre Adresse in der Konfiguration.
- Access-Token gelten eine Stunde, Refresh-Token 90 Tage.

| Werkzeug | Zweck |
|---|---|
| `dokumente_eingang` | Offene Dokumente (älteste zuerst), Anzahl je Status, bisher benutzte Kategorien und Tags |
| `dokument_lesen` | Angaben und Datei. Bilder als `image` (bis 5 MB), PDF als eingebettete Ressource (bis 10 MB). HEIC kann Claude nicht lesen, dafür kommt ein Hinweis |
| `dokument_einordnen` | Felder setzen, Status `eingeordnet` oder `rueckfrage` (dann mit Frage). Protokoll: `geaendert (Claude)` |
| `dokumente_suchen` | Filter: Stichwörter, Bereich, Kategorie, Absender, Tag, Status, Datum von/bis, Betrag min/max. Liefert Anzahl und Summe |
| `frist_setzen` | Frist anlegen oder ändern, Erinnerung standardmäßig 14 Tage vorher |
| `fristen_anzeigen` | Offene Fristen nach Fälligkeit |

`export_erstellen` kommt mit dem Export in Phase 4.

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

## Mail-Eingang und Anstoß (`src/mail.js`, `src/anstoss.js`)

1. `empfangen()` sichert die Mail unverändert in R2 (`mails/<id>.eml`) und legt eine Zeile in `mails` an. So geht nichts verloren, auch wenn das Zerlegen am CPU-Limit abbricht.
2. `verarbeiten()` zerlegt die Mail mit `postal-mime`. Jeder Anhang vom Typ PDF oder Bild (auch PDFs als `application/octet-stream` mit Endung `.pdf`) wird ein Dokument mit `quelle = 'mail'`, `hochgeladen_von = 'mail'` und `mail_id`. Kleine eingebettete Bilder (unter 30 KB, Logos) fallen weg. Ohne passenden Anhang wird der Mailtext ein Dokument vom Typ `text/plain`. Doppelte erkennt die Prüfsumme.
3. Bereich aus der Zieladresse (`KONFIG.mail`), Absender außerhalb von `MAIL_ABSENDER` → Status `rueckfrage`.
4. `scheduled` (alle 15 Minuten): `nachholen()` versucht abgebrochene und fehlgeschlagene Mails erneut (höchstens drei Versuche, danach erscheinen sie in `dokumente_eingang` unter `mails_mit_fehler`). Dann `anstossen()`: Liegen Dokumente im Status `eingang`, ist seit dem letzten Anstoß etwas Neues dazugekommen und sind 15 Minuten vergangen, ruft der Worker den API-Trigger der geplanten Claude-Aufgabe auf. Der Text enthält nur die Anzahl, nie Inhalte.
5. Der Worker antwortet nie auf Mails, leitet nicht weiter und lehnt nicht ab.

| Secret | Inhalt |
|---|---|
| `MAIL_ABSENDER` | Optional, JSON-Liste erlaubter Absender (`"name@domain"` oder `"@domain"`) |
| `CLAUDE_FIRE_URL` | Fire URL der geplanten Aufgabe, muss mit `https://api.anthropic.com/v1/claude_code/routines/` beginnen |
| `CLAUDE_FIRE_TOKEN` | Token des API-Triggers |

## Datenmodell

- `dokumente`: eine Zeile je Datei. `status` ist `eingang` (neu, noch nicht eingeordnet), `rueckfrage` (unklar, mit Text in `rueckfrage`) oder `eingeordnet`. „Eingang“ aus der Spezifikation ist dieser Status, kein Ordner in R2.
- `mails` (`0003`): eine Zeile je empfangener Mail mit Status `neu`, `verarbeitet` oder `fehler`, Anzahl Versuche. `meta`: Zustandswerte wie `anstoss_zuletzt`.
- `protokoll`: wer wann was getan hat, nur ergänzt, nie geändert. Den Volltext protokolliert es nicht, nur dass er sich geändert hat.
- `fristen` (`0002`): Art (kuendigung, garantie, abo, versicherung, zahlung, sonstiges), Titel, `faellig_am`, `erinnern_am`, Wiederholung, Betrag, Bezug zu einem Dokument, erledigt. Sichtbar nach Bereich wie Dokumente.
- Suche über `LIKE` statt FTS5, weil D1 Datenbanken mit virtuellen Tabellen nicht exportieren kann (siehe `entscheidungen/2026-11-22-suche-ohne-fts.md`).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/index.js` | Einstieg, OAuth-Anbieter |
| `src/app.js` | Router der Oberfläche und API, Fehlerbehandlung, Dateiantwort |
| `src/oauth.js` | Freigabeseite für den claude.ai-Connector |
| `src/mcp.js` | MCP-Server mit den Werkzeugen für Claude |
| `src/mail.js` | Mail-Eingang |
| `src/anstoss.js` | Anstoß der geplanten Claude-Aufgabe |
| `src/zugriff.js` | Prüfung des Access-Tokens, Zuordnung zur Person |
| `src/konfig.js` | Lesen und Prüfen von `KONFIG` und `ZUGRIFF` |
| `src/dokumente.js` | Fachlogik für Dokumente und Fristen, von Oberfläche und MCP gemeinsam genutzt |
| `public/app.js` | Oberfläche in Vanilla JS |
| `public/sw.js` | Hält nur die Oberfläche offline vor, nie Dokumente |
| `scripts/lokal.mjs` | Lokaler Server mit node:sqlite und R2-Nachbildung, auch Grundlage der Tests |
| `scripts/icons.cjs` | Erzeugt die PNG-Icons |
| `test/app.test.mjs` | API-, Sichtrechte-, Konfigurations- und Access-Tests |
| `test/mcp.test.mjs` | Werkzeuge, Sichtrechte über MCP, Suche, Fristen |
| `test/mail.test.mjs` | Mail-Eingang, Wiederholung, Anstoß |
| `test/browser.cjs` | Durchlauf im Handy-Browser |
