# Anmeldung über Cloudflare Access

Datum: 2026-11-22
Status: gilt

## Entscheidung
Cloudflare Access (Zero Trust, Gratis-Tarif) steht vor der App und meldet per E-Mail-Code an. Der Worker prüft das Access-Token selbst und ordnet die E-Mail über das Secret `ZUGRIFF` einer Person zu.

## Warum
Kein eigenes Passwort, keine Sitzungsverwaltung im Code. Für Dokumente ist eine Anmeldung je Person nötig, weil die Sichtrechte je Person gelten (anders als das gemeinsame Passwort der HaushaltsApp).

## Folgen
Ohne Access-Variablen ist die API gesperrt. Der MCP-Zugang (Phase 2) braucht eine Ausnahme in Access und prüft die Person über OAuth.
