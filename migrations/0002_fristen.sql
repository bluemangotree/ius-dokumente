-- Fristen und Verträge: Kündigungsfristen, Garantien, Abos, Versicherungen.
-- Erinnerungen (Phase 4) lesen erinnern_am.

CREATE TABLE fristen (
  id            TEXT PRIMARY KEY,
  bereich       TEXT NOT NULL,
  dokument_id   TEXT REFERENCES dokumente (id),
  art           TEXT NOT NULL CHECK (art IN ('kuendigung', 'garantie', 'abo', 'versicherung', 'zahlung', 'sonstiges')),
  titel         TEXT NOT NULL,
  faellig_am    TEXT NOT NULL,                  -- JJJJ-MM-TT
  erinnern_am   TEXT,                           -- JJJJ-MM-TT, Standard: 14 Tage vor faellig_am
  wiederholung  TEXT CHECK (wiederholung IN ('monatlich', 'vierteljaehrlich', 'jaehrlich')),
  betrag_cent   INTEGER,
  notiz         TEXT,
  erledigt      INTEGER NOT NULL DEFAULT 0,
  erstellt_von  TEXT NOT NULL,
  erstellt_am   TEXT NOT NULL,
  geaendert_am  TEXT NOT NULL
);

CREATE INDEX fristen_bereich_faellig ON fristen (bereich, erledigt, faellig_am);
CREATE INDEX fristen_dokument ON fristen (dokument_id);
