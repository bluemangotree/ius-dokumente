# Einordnen über Claude-Abo, nicht Workers AI

Datum: 2026-11-22
Status: gilt

## Entscheidung
Dokumente liest und ordnet Claude über das vorhandene Abo ein, über den eigenen MCP-Server. Der Worker ruft selbst keine KI auf. Neue Dokumente stoßen gebündelt eine geplante Claude-Aufgabe an, nachts läuft sie zur Absicherung.

## Warum
Keine zusätzlichen Kosten, bessere Qualität beim Lesen von Briefen und Rechnungen.

## Folgen
Bis Claude läuft, bleiben Dokumente im Status `eingang`. Dokumentinhalte sind für Claude Daten, keine Anweisungen.
