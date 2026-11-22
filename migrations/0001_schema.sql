-- Grundschema der Dokumentenverwaltung.
-- Die Datei selbst liegt in R2 unter r2_key, hier stehen nur Metadaten.

CREATE TABLE dokumente (
  id               TEXT PRIMARY KEY,
  bereich          TEXT NOT NULL,                 -- id aus KONFIG.bereiche, entscheidet über die Sichtbarkeit
  status           TEXT NOT NULL DEFAULT 'eingang'
                   CHECK (status IN ('eingang', 'eingeordnet', 'rueckfrage')),
  quelle           TEXT NOT NULL DEFAULT 'upload'
                   CHECK (quelle IN ('upload', 'mail')),
  r2_key           TEXT NOT NULL UNIQUE,
  original_name    TEXT NOT NULL,                 -- Name beim Hochladen, bleibt unverändert
  dateiname        TEXT,                          -- sprechender Name, vorgeschlagen von Claude oder von Hand
  mime             TEXT NOT NULL,
  groesse          INTEGER NOT NULL,
  sha256           TEXT,                          -- im Browser berechnet, nur zum Erkennen von Doppelten
  kategorie        TEXT,
  absender         TEXT,
  datum            TEXT,                          -- Datum des Dokuments, JJJJ-MM-TT
  betrag_cent      INTEGER,
  waehrung         TEXT NOT NULL DEFAULT 'EUR',
  tags             TEXT NOT NULL DEFAULT '[]',    -- JSON-Liste
  zusammenfassung  TEXT,
  volltext         TEXT,                          -- von Claude gelesener Text, für die Suche
  rueckfrage       TEXT,                          -- was unklar ist, wenn status = 'rueckfrage'
  hochgeladen_von  TEXT NOT NULL,                 -- Personen-id aus KONFIG.personen oder 'mail'
  hochgeladen_am   TEXT NOT NULL,                 -- ISO-Zeitstempel (UTC)
  eingeordnet_am   TEXT,
  geaendert_am     TEXT NOT NULL
);

CREATE INDEX dokumente_bereich_zeit ON dokumente (bereich, hochgeladen_am DESC);
CREATE INDEX dokumente_status ON dokumente (status);
CREATE INDEX dokumente_sha256 ON dokumente (sha256);
CREATE INDEX dokumente_datum ON dokumente (datum);

-- Wer hat wann was getan. Wird nie geändert, nur ergänzt.
CREATE TABLE protokoll (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dokument_id  TEXT,
  wer          TEXT NOT NULL,
  was          TEXT NOT NULL,
  details      TEXT,                              -- JSON
  am           TEXT NOT NULL
);

CREATE INDEX protokoll_dokument ON protokoll (dokument_id, am);
