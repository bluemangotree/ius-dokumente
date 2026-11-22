# Eigenes Repo, mehrere Instanzen per Konfiguration

Datum: 2026-11-22
Status: gilt

## Entscheidung
Die Dokumentenverwaltung ist ein eigenes Repo, getrennt von der HaushaltsApp. Jede Instanz (privat, später SOMA Massagen) hat eigenen Worker, eigene D1 und eigenen R2-Bucket. Bereiche und Personen stehen in `KONFIG`, nicht im Code.

## Warum
Firmenunterlagen und private Unterlagen sollen sich keine Datenbank teilen. SOMA braucht andere Bereiche und Aufbewahrungsregeln (GoBD).

## Folgen
Code darf keine Bereichs- oder Personennamen fest einbauen. Neue Instanz = neuer Abschnitt `[env.<name>]` in `wrangler.toml`.
