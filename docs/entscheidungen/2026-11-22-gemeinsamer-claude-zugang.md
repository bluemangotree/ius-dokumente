# Gemeinsamer Claude-Zugang

Datum: 2026-11-22
Status: gilt

## Entscheidung
Andrei und Sven nutzen ein gemeinsames Claude-Konto. Der claude.ai-Connector verbindet sich deshalb nicht als eine der beiden Personen, sondern als eigener Zugang „Claude (gemeinsam)“ mit allen Bereichen. Freigeben darf ihn jeder der beiden. In der App gelten weiter die getrennten Sichtrechte.

## Warum
Mit einem geteilten Konto sieht jeder alle Chats, also auch alles, was Claude aus den Dokumenten liest. Eine Trennung im Connector würde nur vortäuschen, dass es eine gibt. Die geplante Aufgabe soll außerdem alle neuen Dokumente einordnen, nicht nur die einer Person. Verworfen: zwei Connectors je Person (geht mit einem Konto nur umständlich, schützt nichts) und je eine geplante Aufgabe pro Person.

## Folgen
`KONFIG.claude` in `wrangler.toml`. Wer private Dokumente auch vor dem anderen in Claude verbergen will, braucht ein eigenes Claude-Konto, und `KONFIG.claude` entfällt. Für SOMA ist je nach Konto neu zu entscheiden.
