# Plan: Dokumentenverwaltung

Stand: 2026-11-22. Je Phase ein Pull Request. Ist das Vorhaben fertig, Ergebnisse nach `architektur.md` und in Entscheidungen übernehmen und diesen Plan löschen.

## Phase 1: Schema, Upload, Login (dieser Stand)

Erledigt: Schema `dokumente` und `protokoll`, Upload vom Handy direkt nach R2, Liste mit Filtern und einfacher Suche, Detailansicht mit Bearbeiten, Anmeldung über Access, Sichtrechte je Bereich, Konfiguration je Instanz, PWA.

## Phase 2: MCP-Server für claude.ai

- OAuth für den claude.ai-Connector, z. B. mit `@cloudflare/workers-oauth-provider` (braucht einen KV-Namespace). Die Anmeldung im OAuth-Ablauf läuft über Access, damit dieselbe E-Mail und damit dieselben Sichtrechte gelten.
- Werkzeuge: `dokumente_eingang`, `dokument_lesen` (liefert die Datei als Bild oder PDF an Claude), `dokument_einordnen` (nutzt `pruefeFelder`), `dokumente_suchen`, `frist_setzen`, `fristen_anzeigen`, `export_erstellen`.
- Suche in Alltagssprache: Claude übersetzt die Frage in Filter und Stichwörter. Dazu Volltextindex (FTS5) über Name, Absender, Tags, Zusammenfassung und `volltext`.
- Werkzeuge können nichts löschen und nichts versenden.

## Phase 3: Mail-Eingang und Anstoß für Claude

- Email Routing auf eine eigene Adresse, Email Worker legt Anhänge mit `quelle = 'mail'` und `status = 'eingang'` ab. Absender nur aus einer Erlaubnisliste. Bereich der Mail aus der Zieladresse (z. B. `andrei@`, `gemeinsam@`).
- Der Worker stößt gebündelt (höchstens alle 15 Minuten) die geplante Claude-Aufgabe über deren API-Trigger an, dazu ein nächtlicher Lauf als Absicherung. Braucht Fire-URL und Token aus claude.ai (Secret).
- Unklare Dokumente bekommen `status = 'rueckfrage'`, die Morgen-Zusammenfassung listet sie.

## Phase 4: Fristen, Export, Backup

- Tabelle `fristen` (Kündigung, Garantie, Abo, Versicherung) mit Erinnerung.
- Steuer-Export je Person und Quartal oder Jahr: ZIP mit Dateien und CSV.
- Monatlicher Backup-Export, z. B. nach Google Drive.
- Für SOMA: Aufbewahrungsfristen nach GoBD je Bereich in `KONFIG` (Buchungsbelege derzeit 8 Jahre, Bücher und Abschlüsse 10 Jahre, Handelsbriefe 6 Jahre; vor dem Einrichten prüfen lassen).
