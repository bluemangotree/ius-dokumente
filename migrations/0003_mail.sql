-- Mail-Eingang: Jede Mail wird zuerst roh in R2 gesichert (mails/<id>.eml), dann zerlegt.
-- Anhänge werden Dokumente mit quelle = 'mail'. Schlägt das Zerlegen fehl, versucht es der
-- Zeitplan (alle 15 Minuten) bis zu dreimal erneut.

CREATE TABLE mails (
  id             TEXT PRIMARY KEY,
  r2_key         TEXT NOT NULL UNIQUE,
  bereich        TEXT NOT NULL,
  von            TEXT,
  an             TEXT,
  betreff        TEXT,
  groesse        INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu', 'verarbeitet', 'fehler')),
  dokumente      INTEGER NOT NULL DEFAULT 0,
  fehler         TEXT,
  versuche       INTEGER NOT NULL DEFAULT 0,
  empfangen_am   TEXT NOT NULL,
  verarbeitet_am TEXT
);

CREATE INDEX mails_status ON mails (status, empfangen_am);

ALTER TABLE dokumente ADD COLUMN mail_id TEXT REFERENCES mails (id);

-- Kleine Zustandswerte, z. B. wann Claude zuletzt angestoßen wurde.
CREATE TABLE meta (
  schluessel TEXT PRIMARY KEY,
  wert       TEXT NOT NULL
);
