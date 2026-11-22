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

## Später (Phase 2)

Der MCP-Server für claude.ai meldet sich per OAuth an und muss an Access vorbei erreichbar sein. Dafür kommt in Phase 2 eine zweite Access-Anwendung für die Pfade `/mcp`, `/oauth/*` und `/.well-known/*` mit der Richtlinie „Bypass“. Die Sichtrechte prüft dort der Worker selbst.
