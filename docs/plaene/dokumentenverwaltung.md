# Plan: Dokumentenverwaltung

Stand: 2026-11-22. Je Phase ein Pull Request. Ist das Vorhaben fertig, Ergebnisse nach `architektur.md` und in Entscheidungen übernehmen und diesen Plan löschen.

## Phase 1: Schema, Upload, Login (erledigt)

Erledigt: Schema `dokumente` und `protokoll`, Upload vom Handy direkt nach R2, Liste mit Filtern und einfacher Suche, Detailansicht mit Bearbeiten, Anmeldung über Access, Sichtrechte je Bereich, Konfiguration je Instanz, PWA.

## Phase 2: MCP-Server für claude.ai (dieser Stand)

Erledigt: OAuth mit `@cloudflare/workers-oauth-provider`, Freigabe hinter Access, Werkzeuge `dokumente_eingang`, `dokument_lesen`, `dokument_einordnen`, `dokumente_suchen`, `frist_setzen`, `fristen_anzeigen`, Tabelle `fristen`. Suche in Alltagssprache: Claude übersetzt die Frage in Filter. `export_erstellen` folgt in Phase 4.

Offen und erst mit echtem claude.ai prüfbar: ob claude.ai PDFs als eingebettete Ressource an das Modell gibt. Falls nicht, liefert `dokument_lesen` PDFs künftig Seite für Seite als Bild oder Claude liest nur den Text.

## Phase 3: Mail-Eingang und Anstoß für Claude

- Email Routing auf eine eigene Adresse, Email Worker legt Anhänge mit `quelle = 'mail'` und `status = 'eingang'` ab. Absender nur aus einer Erlaubnisliste. Bereich der Mail aus der Zieladresse (z. B. `andrei@`, `gemeinsam@`).
- Der Worker stößt gebündelt (höchstens alle 15 Minuten) die geplante Claude-Aufgabe über deren API-Trigger an, dazu ein nächtlicher Lauf als Absicherung. Braucht Fire-URL und Token aus claude.ai (Secret).
- Unklare Dokumente bekommen `status = 'rueckfrage'`, die Morgen-Zusammenfassung listet sie.
- **Vorher klären:** Die geplante Aufgabe nutzt den Connector mit dem Konto, das sie angelegt hat, und sieht damit nur dessen Bereiche. Entweder legen Andrei und Sven je eine Aufgabe an, oder es gibt in `KONFIG` eine eigene Person „Assistent“ mit allen Bereichen und eigener E-Mail in `ZUGRIFF`.

## Phase 4: Fristen, Export, Backup

- Tabelle `fristen` (Kündigung, Garantie, Abo, Versicherung) mit Erinnerung.
- Steuer-Export je Person und Quartal oder Jahr: ZIP mit Dateien und CSV.
- Monatlicher Backup-Export, z. B. nach Google Drive.
- Für SOMA: Aufbewahrungsfristen nach GoBD je Bereich in `KONFIG` (Buchungsbelege derzeit 8 Jahre, Bücher und Abschlüsse 10 Jahre, Handelsbriefe 6 Jahre; vor dem Einrichten prüfen lassen).
