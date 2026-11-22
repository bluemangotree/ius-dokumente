# Suche ohne FTS5

Datum: 2026-11-22
Status: gilt

## Entscheidung
Die Suche nutzt `LIKE` über Name, Absender, Kategorie, Tags, Zusammenfassung und Volltext. Kein Volltextindex (FTS5).

## Warum
D1 kann Datenbanken mit virtuellen Tabellen nicht exportieren, und der Export ist die Grundlage für das monatliche Backup. Für einige tausend Dokumente zweier Personen reicht `LIKE`. Die Suche in Alltagssprache leistet Claude, indem es die Frage in Filter übersetzt.

## Folgen
Wird die Suche zu langsam, zuerst die Ergebnismenge über Filter (Bereich, Datum) verkleinern. Ein Index müsste in eine zweite Datenbank, damit das Backup der Hauptdatenbank möglich bleibt.
