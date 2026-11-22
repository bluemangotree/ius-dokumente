# Einrichtung einer Instanz

Am Beispiel der privaten Instanz. Für SOMA dieselben Schritte mit `--env soma` und den Namen aus `[env.soma]`.

## 1. Im Cloudflare-Dashboard

1. **R2 aktivieren:** Dashboard → R2 Object Storage → aktivieren. Cloudflare verlangt dafür eine Zahlungsmethode, der Gratis-Umfang (10 GB, 1 Mio. Schreib- und 10 Mio. Lesezugriffe im Monat) kostet nichts.
2. **Zero Trust einrichten**, falls noch nicht geschehen: Dashboard → Zero Trust, Teamname wählen, Tarif „Free“ (bis 50 Personen). Der Teamname ergibt die Team-Domain `<team>.cloudflareaccess.com`.

## 2. Mit Wrangler auf dem eigenen Rechner

```
npm install
npx wrangler login
npx wrangler r2 bucket create dokumente --jurisdiction eu
```

Die D1-Datenbank `dokumente` ist bereits angelegt, ihre id steht in `wrangler.toml`.

```
npm run veroeffentlichen
```

Danach den Zugriff setzen (E-Mail-Adressen anpassen, sie landen nur in Cloudflare, nicht im Repo):

```
echo '{"andrei@…":"andrei","sven@…":"sven"}' | npx wrangler secret put ZUGRIFF
```

## 3. Access vor den Worker stellen

1. Dashboard → Workers & Pages → `dokumente` → Einstellungen → Domains & Routes → bei `workers.dev` „Cloudflare Access“ aktivieren.
2. Cloudflare legt dabei eine Access-Anwendung an und zeigt den **AUD-Tag**. In Zero Trust → Access → Applications die Richtlinie so einstellen, dass nur die beiden E-Mail-Adressen erlaubt sind (Include → Emails).
3. Beim Worker unter Einstellungen → Variablen zwei Klartext-Variablen anlegen:
   - `ACCESS_TEAM_DOMAIN` = `<team>.cloudflareaccess.com`
   - `ACCESS_AUD` = der AUD-Tag

Ohne diese beiden Variablen antwortet die API mit „Die Anmeldung ist noch nicht eingerichtet“.

## 4. Prüfen

- Adresse im privaten Fenster öffnen: Es muss die Access-Anmeldung kommen, nicht die App.
- Als Andrei anmelden, ein PDF in „Andrei“ hochladen. Als Sven anmelden: Das Dokument darf nicht erscheinen.
- Auf dem Handy über „Zum Home-Bildschirm“ als App ablegen.

## 5. Claude verbinden

1. Damit claude.ai den MCP-Server erreicht, braucht Access eine Ausnahme. Zero Trust → Access → Applications → Add an application → Self-hosted:
   - Name „Dokumente für Claude“, Domain: die workers.dev-Adresse des Workers, drei Pfade: `mcp`, `oauth/*`, `.well-known/*`
   - Richtlinie: Aktion **Bypass**, Include → Everyone
   Diese Pfade schützt der Worker selbst per OAuth. `/authorize` bleibt hinter Access, dort meldet ihr euch an.
2. In claude.ai → Einstellungen → Connectors → Benutzerdefinierten Connector hinzufügen, URL `https://<adresse>/mcp`. Beim Verbinden öffnet sich die Access-Anmeldung, danach die Freigabeseite „Claude mit Dokumente verbinden?“.
3. Andrei und Sven teilen sich ein Claude-Konto. Einer von beiden verbindet einmal, Claude bekommt dann den gemeinsamen Zugang „Claude (gemeinsam)“ mit allen drei Bereichen (`KONFIG.claude`). In der App sieht weiterhin jeder nur seine Bereiche.

Zum Prüfen in Claude: „Was liegt im Dokumenten-Eingang?“

## 6. Mail-Eingang

Email Routing braucht eine eigene Domain bei Cloudflare, mit der workers.dev-Adresse geht es nicht. **Ein bestehendes Postfach darf dabei nicht kaputtgehen.** Deshalb zuerst nachsehen: Domain → DNS → Einträge vom Typ MX.

- **Die MX-Einträge zeigen auf Cloudflare** (`route1.mx.cloudflare.net` usw., Email Routing ist schon aktiv): Unter Email → Email Routing → Routing rules → Create address eine neue Adresse anlegen, z. B. `dokumente@<domain>`, Aktion **Send to a Worker**, Worker `dokumente`. Bestehende Regeln und Weiterleitungen bleiben unverändert. Für eigene Adressen je Bereich zusätzlich `andrei@…`, `sven@…` nur dann, wenn diese Adressen nicht schon für etwas anderes benutzt werden. Sonst einfach `dokumente+andrei@<domain>` verwenden: Der Teil nach `+` wählt den Bereich, dafür braucht es keine weitere Regel (Email Routing → Settings → Subaddressing einschalten).
- **Die MX-Einträge zeigen woanders hin** (z. B. Google, IONOS, Strato): Email Routing **nicht** auf der Domain selbst aktivieren, das würde die MX-Einträge ersetzen. Stattdessen eine Subdomain nutzen, z. B. `eingang.<domain>`: Email Routing → Settings → Subdomains → hinzufügen. Cloudflare legt dann nur für die Subdomain eigene MX-Einträge an. Adresse z. B. `dokumente@eingang.<domain>`.

Welche Zieladresse in welchen Bereich führt, steht in `KONFIG.mail` (`wrangler.toml`): `andrei`, `sven`, `gemeinsam` (als Adresse oder als `+Zusatz`), alles andere landet in „Gemeinsam“.

Optional, aber empfohlen: erlaubte Absender festlegen. Mails von anderen Absendern werden trotzdem abgelegt, aber als Rückfrage markiert.

```
echo '["andrei@…","sven@…","@stadtwerke-beispiel.de"]' | npx wrangler secret put MAIL_ABSENDER
```

Prüfen: eine Mail mit PDF-Anhang an die neue Adresse schicken. Nach wenigen Sekunden steht das Dokument in der App, mit „per Mail“.

## 7. Claude automatisch einordnen lassen

1. In claude.ai unter Code → Geplante Aufgaben (claude.ai/code/routines) eine neue Aufgabe anlegen. Den Aufgabentext aus [`claude-aufgabe.md`](claude-aufgabe.md) einfügen, Connector „Dokumente“ auswählen, Zeitplan täglich früh morgens (das ist der nächtliche Lauf mit Morgen-Zusammenfassung).
2. Im Bearbeiten-Dialog der Aufgabe unter Trigger mit **+** einen API-Trigger hinzufügen, die **Fire URL** kopieren und **Generate token** klicken. Der Token wird nur einmal angezeigt.
3. Beides als Secrets setzen:

```
echo '<Fire URL>' | npx wrangler secret put CLAUDE_FIRE_URL
echo '<Token>' | npx wrangler secret put CLAUDE_FIRE_TOKEN
```

Danach prüft der Worker alle 15 Minuten, ob neue Dokumente im Eingang liegen, und stößt die Aufgabe dann an (höchstens einmal je 15 Minuten). Der letzte Anstoß steht in der Tabelle `meta` (`anstoss_ergebnis`).
