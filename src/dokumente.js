// Fachlogik für Dokumente. Wird von der Weboberfläche genutzt und später von MCP und Mail-Eingang.
// Jede Funktion bekommt die angemeldete Person und sieht nur deren Bereiche.

export const ERLAUBT = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
// Text kommt nur aus dem Mail-Eingang (Mails ohne Anhang), nie über den Upload.
export const ENDUNG = { ...ERLAUBT, 'text/plain': 'txt' };
export const MAX_GROESSE = 25 * 1024 * 1024;
export const STATUS = ['eingang', 'eingeordnet', 'rueckfrage'];
const SEITE = 50;

export class Fehler extends Error {
  constructor(status, text) { super(text); this.status = status; }
}

const jetzt = () => new Date().toISOString();
const bereichIds = (person) => person.bereiche.map((b) => b.id);
const platzhalter = (n) => Array(n).fill('?').join(', ');

export function sauber(text, max) {
  // Steuerzeichen und Pfadtrenner raus, Länge begrenzen.
  return String(text ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function ausZeile(z) {
  if (!z) return null;
  const { r2_key, sha256, volltext, ...rest } = z;
  let tags = [];
  try { tags = JSON.parse(z.tags || '[]'); } catch { /* bleibt leer */ }
  return { ...rest, tags };
}

function protokoll(db, dokumentId, wer, was, details) {
  return db.prepare('INSERT INTO protokoll (dokument_id, wer, was, details, am) VALUES (?, ?, ?, ?, ?)')
    .bind(dokumentId ?? null, wer, was, details ? JSON.stringify(details) : null, jetzt());
}

async function zeile(env, person, id) {
  const ids = bereichIds(person);
  const z = await env.DB.prepare(`SELECT * FROM dokumente WHERE id = ? AND bereich IN (${platzhalter(ids.length)})`)
    .bind(String(id), ...ids).first();
  // Fremde Dokumente sehen genauso aus wie nicht vorhandene.
  if (!z) throw new Fehler(404, 'Dieses Dokument gibt es nicht.');
  return z;
}

export async function hochladen(env, person, { body, mime, groesse, name, bereich, sha256, quelle = 'upload', mailId = null, rueckfrage = null }) {
  if (!bereichIds(person).includes(bereich)) throw new Fehler(400, 'Wähle einen Bereich, den du sehen darfst.');
  const typ = String(mime || '').split(';')[0].trim().toLowerCase();
  const erlaubt = quelle === 'mail' ? ENDUNG : ERLAUBT;
  if (!erlaubt[typ]) throw new Fehler(415, 'Nur PDF und Bilder (JPEG, PNG, WebP, HEIC) sind möglich.');
  const laenge = Number(groesse);
  if (!Number.isInteger(laenge) || laenge <= 0) throw new Fehler(411, 'Die Datei ist leer oder ihre Größe fehlt.');
  if (laenge > MAX_GROESSE) throw new Fehler(413, 'Die Datei ist größer als 25 MB. Bitte kleiner speichern.');
  const original = sauber(name, 200) || `dokument.${erlaubt[typ]}`;
  const hash = /^[0-9a-f]{64}$/.test(sha256 || '') ? sha256 : null;

  if (hash) {
    const ids = bereichIds(person);
    const doppelt = await env.DB.prepare(`SELECT * FROM dokumente WHERE sha256 = ? AND bereich IN (${platzhalter(ids.length)}) LIMIT 1`)
      .bind(hash, ...ids).first();
    if (doppelt) return { doppelt: true, dokument: ausZeile(doppelt) };
  }

  const id = crypto.randomUUID();
  const key = `dokumente/${id}`;
  const obj = await env.DATEIEN.put(key, body, { httpMetadata: { contentType: typ } });
  if (!obj || obj.size !== laenge) {
    await env.DATEIEN.delete(key);
    throw new Fehler(400, 'Die Datei kam nicht vollständig an. Bitte noch einmal hochladen.');
  }

  const am = jetzt();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO dokumente (id, bereich, status, quelle, r2_key, original_name, mime, groesse, sha256,
        hochgeladen_von, hochgeladen_am, geaendert_am, mail_id, rueckfrage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, bereich, rueckfrage ? 'rueckfrage' : 'eingang', quelle, key, original, typ, laenge, hash, person.id, am, am, mailId, rueckfrage),
    protokoll(env.DB, id, person.id, 'hochgeladen', { bereich, name: original, quelle, ...(mailId ? { mail: mailId } : {}) }),
  ]);
  return { doppelt: false, dokument: ausZeile(await zeile(env, person, id)) };
}

const SUCHTEXT = `(coalesce(dateiname, '') || ' ' || original_name || ' ' || coalesce(absender, '') || ' ' || coalesce(kategorie, '')
  || ' ' || tags || ' ' || coalesce(zusammenfassung, '') || ' ' || coalesce(volltext, ''))`;

// Jedes Wort muss irgendwo vorkommen (Name, Absender, Kategorie, Tags, Zusammenfassung, Volltext).
// Bewusst LIKE statt FTS5: D1 kann Datenbanken mit virtuellen Tabellen nicht exportieren (Backup).
function stichworte(q, wo, werte) {
  const suche = sauber(q, 200);
  if (!suche) return;
  for (const wort of suche.split(' ').slice(0, 8)) {
    wo.push(`${SUCHTEXT} LIKE ? ESCAPE '\\'`);
    werte.push(`%${wort.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
}

export async function liste(env, person, { bereich, status, q, vor } = {}) {
  const ids = bereichIds(person);
  const wo = [`bereich IN (${platzhalter(ids.length)})`];
  const werte = [...ids];
  if (bereich) {
    if (!ids.includes(bereich)) return { dokumente: [], weiter: null };
    wo.push('bereich = ?'); werte.push(bereich);
  }
  if (status) {
    if (!STATUS.includes(status)) throw new Fehler(400, 'Unbekannter Status.');
    wo.push('status = ?'); werte.push(status);
  }
  stichworte(q, wo, werte);
  if (vor) {
    const [zeit, id] = String(vor).split('|');
    wo.push('(hochgeladen_am < ? OR (hochgeladen_am = ? AND id < ?))');
    werte.push(zeit, zeit, id ?? '');
  }
  const { results } = await env.DB.prepare(`SELECT * FROM dokumente WHERE ${wo.join(' AND ')}
      ORDER BY hochgeladen_am DESC, id DESC LIMIT ${SEITE + 1}`).bind(...werte).all();
  const seite = results.slice(0, SEITE);
  const letzte = seite.at(-1);
  return {
    dokumente: seite.map(ausZeile),
    weiter: results.length > SEITE ? `${letzte.hochgeladen_am}|${letzte.id}` : null,
  };
}

export async function holen(env, person, id) {
  return ausZeile(await zeile(env, person, id));
}

export async function datei(env, person, id) {
  const z = await zeile(env, person, id);
  const obj = await env.DATEIEN.get(z.r2_key);
  if (!obj) throw new Fehler(404, 'Die Datei fehlt im Speicher.');
  return { obj, dokument: ausZeile(z) };
}

const TEXTFELDER = { dateiname: 200, kategorie: 80, absender: 160, zusammenfassung: 2000, rueckfrage: 500 };

// Prüft Änderungen an den Metadaten. Liefert nur die gesetzten Felder.
export function pruefeFelder(person, felder, { volltext = false } = {}) {
  const f = felder && typeof felder === 'object' ? felder : {};
  const neu = {};
  const textfelder = volltext ? { ...TEXTFELDER, volltext: 50000 } : TEXTFELDER;
  for (const [feld, max] of Object.entries(textfelder)) {
    if (f[feld] !== undefined) neu[feld] = f[feld] === null ? null : (sauber(f[feld], max) || null);
  }
  if (f.bereich !== undefined) {
    if (!bereichIds(person).includes(f.bereich)) throw new Fehler(400, 'Wähle einen Bereich, den du sehen darfst.');
    neu.bereich = f.bereich;
  }
  if (f.status !== undefined) {
    if (!STATUS.includes(f.status)) throw new Fehler(400, 'Unbekannter Status.');
    neu.status = f.status;
  }
  if (f.datum !== undefined) {
    if (f.datum === null || f.datum === '') neu.datum = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(f.datum) && !Number.isNaN(Date.parse(`${f.datum}T00:00:00Z`))) neu.datum = f.datum;
    else throw new Fehler(400, 'Das Datum braucht die Form JJJJ-MM-TT.');
  }
  if (f.betrag_cent !== undefined) {
    if (f.betrag_cent === null || f.betrag_cent === '') neu.betrag_cent = null;
    else if (Number.isSafeInteger(Number(f.betrag_cent))) neu.betrag_cent = Number(f.betrag_cent);
    else throw new Fehler(400, 'Der Betrag muss in ganzen Cent angegeben sein.');
  }
  if (f.waehrung !== undefined) {
    if (!/^[A-Z]{3}$/.test(f.waehrung || '')) throw new Fehler(400, 'Die Währung braucht drei Großbuchstaben, z. B. EUR.');
    neu.waehrung = f.waehrung;
  }
  if (f.tags !== undefined) {
    if (!Array.isArray(f.tags)) throw new Fehler(400, 'Tags müssen eine Liste sein.');
    neu.tags = JSON.stringify([...new Set(f.tags.map((t) => sauber(t, 40).toLowerCase()).filter(Boolean))].slice(0, 20));
  }
  return neu;
}

export async function aendern(env, person, id, felder, { via = null, volltext = false } = {}) {
  const vorher = await zeile(env, person, id);
  const neu = pruefeFelder(person, felder, { volltext });
  if (neu.status === 'eingeordnet' && vorher.status !== 'eingeordnet') neu.eingeordnet_am = jetzt();
  const spalten = Object.keys(neu);
  if (!spalten.length) return ausZeile(vorher);
  neu.geaendert_am = jetzt();
  const alle = Object.keys(neu);
  await env.DB.batch([
    env.DB.prepare(`UPDATE dokumente SET ${alle.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`).bind(...alle.map((s) => neu[s]), vorher.id),
    protokoll(env.DB, vorher.id, person.id, via ? `geaendert (${via})` : 'geaendert',
      Object.fromEntries(spalten.map((s) => [s, s === 'volltext' ? '(Text aktualisiert)' : [vorher[s], neu[s]]]))),
  ]);
  return ausZeile(await zeile(env, person, id));
}

// ---------- Für Claude (MCP) ----------

const kurz = (d) => ({
  id: d.id, bereich: d.bereich, status: d.status, name: d.dateiname || d.original_name, original_name: d.original_name,
  mime: d.mime, groesse: d.groesse, quelle: d.quelle, kategorie: d.kategorie, absender: d.absender, datum: d.datum,
  betrag_cent: d.betrag_cent, tags: d.tags, zusammenfassung: d.zusammenfassung, rueckfrage: d.rueckfrage,
  hochgeladen_am: d.hochgeladen_am,
});

// Was noch einzuordnen ist, älteste zuerst, dazu die bisher benutzten Kategorien und Tags,
// damit Claude einheitlich benennt.
export async function eingang(env, person, { bereich, mit_rueckfragen = true, anzahl = 20 } = {}) {
  const ids = bereichIds(person);
  const sicht = bereich ? ids.filter((b) => b === bereich) : ids;
  if (!sicht.length) throw new Fehler(400, 'Diesen Bereich darfst du nicht sehen.');
  const status = mit_rueckfragen ? ['eingang', 'rueckfrage'] : ['eingang'];
  const n = Math.min(Math.max(Number(anzahl) || 20, 1), 50);
  const p = platzhalter(sicht.length);
  const [offen, zahlen, kat, tagZeilen, mailFehler] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM dokumente WHERE bereich IN (${p}) AND status IN (${platzhalter(status.length)})
      ORDER BY hochgeladen_am ASC, id ASC LIMIT ${n}`).bind(...sicht, ...status),
    env.DB.prepare(`SELECT status, count(*) AS anzahl FROM dokumente WHERE bereich IN (${p}) GROUP BY status`).bind(...sicht),
    env.DB.prepare(`SELECT kategorie, count(*) AS anzahl FROM dokumente WHERE bereich IN (${p}) AND kategorie IS NOT NULL
      GROUP BY kategorie ORDER BY anzahl DESC LIMIT 60`).bind(...sicht),
    env.DB.prepare(`SELECT tags FROM dokumente WHERE bereich IN (${p}) AND tags != '[]' ORDER BY geaendert_am DESC LIMIT 300`).bind(...sicht),
    env.DB.prepare(`SELECT id, von, betreff, fehler, empfangen_am FROM mails WHERE bereich IN (${p}) AND status = 'fehler' AND versuche >= 3
      ORDER BY empfangen_am DESC LIMIT 20`).bind(...sicht),
  ]);
  const tagZahl = new Map();
  for (const z of tagZeilen.results) {
    try { for (const t of JSON.parse(z.tags)) tagZahl.set(t, (tagZahl.get(t) || 0) + 1); } catch { /* übergehen */ }
  }
  return {
    bereiche: person.bereiche.filter((b) => sicht.includes(b.id)),
    anzahl: Object.fromEntries(zahlen.results.map((z) => [z.status, z.anzahl])),
    dokumente: offen.results.map((z) => kurz(ausZeile(z))),
    bekannte_kategorien: kat.results.map((z) => z.kategorie),
    bekannte_tags: [...tagZahl].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([t]) => t),
    mails_mit_fehler: mailFehler.results,
  };
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
function datumOderNull(wert, feld) {
  if (wert === undefined || wert === null || wert === '') return null;
  if (!DATUM.test(wert) || Number.isNaN(Date.parse(`${wert}T00:00:00Z`))) throw new Fehler(400, `${feld} braucht die Form JJJJ-MM-TT.`);
  return wert;
}

// Suche mit Filtern. Claude übersetzt die Frage in Alltagssprache in diese Filter.
export async function suchen(env, person, f = {}) {
  const ids = bereichIds(person);
  const wo = [`bereich IN (${platzhalter(ids.length)})`];
  const werte = [...ids];
  if (f.bereich) {
    if (!ids.includes(f.bereich)) return { treffer: [], anzahl: 0 };
    wo.push('bereich = ?'); werte.push(f.bereich);
  }
  if (f.status) {
    if (!STATUS.includes(f.status)) throw new Fehler(400, 'Unbekannter Status.');
    wo.push('status = ?'); werte.push(f.status);
  }
  for (const feld of ['kategorie', 'absender']) {
    const v = sauber(f[feld], 160);
    if (v) { wo.push(`${feld} LIKE ? ESCAPE '\\'`); werte.push(`%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
  }
  const tag = sauber(f.tag, 40).toLowerCase();
  if (tag) { wo.push('EXISTS (SELECT 1 FROM json_each(dokumente.tags) WHERE value = ?)'); werte.push(tag); }
  const von = datumOderNull(f.datum_von, 'datum_von');
  const bis = datumOderNull(f.datum_bis, 'datum_bis');
  // Ohne Dokumentdatum zählt der Tag des Hochladens.
  if (von) { wo.push('coalesce(datum, substr(hochgeladen_am, 1, 10)) >= ?'); werte.push(von); }
  if (bis) { wo.push('coalesce(datum, substr(hochgeladen_am, 1, 10)) <= ?'); werte.push(bis); }
  for (const [feld, op] of [['betrag_min', '>='], ['betrag_max', '<=']]) {
    if (f[feld] === undefined || f[feld] === null || f[feld] === '') continue;
    const euro = Number(f[feld]);
    if (!Number.isFinite(euro)) throw new Fehler(400, `${feld} muss eine Zahl in Euro sein.`);
    wo.push(`betrag_cent ${op} ?`); werte.push(Math.round(euro * 100));
  }
  stichworte(f.text, wo, werte);
  const n = Math.min(Math.max(Number(f.anzahl) || 20, 1), 50);
  const bedingung = wo.join(' AND ');
  const [treffer, zahl] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM dokumente WHERE ${bedingung}
      ORDER BY coalesce(datum, substr(hochgeladen_am, 1, 10)) DESC, hochgeladen_am DESC LIMIT ${n}`).bind(...werte),
    env.DB.prepare(`SELECT count(*) AS anzahl, sum(betrag_cent) AS summe_cent FROM dokumente WHERE ${bedingung}`).bind(...werte),
  ]);
  const z = zahl.results[0] || {};
  return { anzahl: z.anzahl ?? 0, summe_cent: z.summe_cent ?? null, treffer: treffer.results.map((x) => kurz(ausZeile(x))) };
}

export async function einordnen(env, person, id, felder, via = 'Claude') {
  const f = { ...felder };
  if (f.betrag !== undefined) {
    if (f.betrag === null || f.betrag === '') f.betrag_cent = null;
    else if (Number.isFinite(Number(f.betrag))) f.betrag_cent = Math.round(Number(f.betrag) * 100);
    else throw new Fehler(400, 'betrag muss eine Zahl in Euro sein, z. B. 12.5.');
    delete f.betrag;
  }
  if (!f.status) f.status = 'eingeordnet';
  if (!['eingeordnet', 'rueckfrage'].includes(f.status)) throw new Fehler(400, 'status ist eingeordnet oder rueckfrage.');
  if (f.status === 'rueckfrage' && !sauber(f.rueckfrage, 500)) throw new Fehler(400, 'Bei einer Rückfrage bitte in rueckfrage beschreiben, was unklar ist.');
  if (f.status === 'eingeordnet' && f.rueckfrage === undefined) f.rueckfrage = null;
  return kurz(await aendern(env, person, id, f, { via, volltext: true }));
}

// ---------- Fristen ----------

const ARTEN = ['kuendigung', 'garantie', 'abo', 'versicherung', 'zahlung', 'sonstiges'];
const WIEDERHOLUNG = ['monatlich', 'vierteljaehrlich', 'jaehrlich'];

function tageVorher(datum, tage) {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - tage);
  return d.toISOString().slice(0, 10);
}

export async function fristSetzen(env, person, a = {}) {
  const ids = bereichIds(person);
  const vorher = a.id
    ? await env.DB.prepare(`SELECT * FROM fristen WHERE id = ? AND bereich IN (${platzhalter(ids.length)})`).bind(String(a.id), ...ids).first()
    : null;
  if (a.id && !vorher) throw new Fehler(404, 'Diese Frist gibt es nicht.');

  let dokument = null;
  const dokumentId = a.dokument_id !== undefined ? a.dokument_id : vorher?.dokument_id;
  if (dokumentId) dokument = await zeile(env, person, dokumentId);
  const bereich = a.bereich ?? vorher?.bereich ?? dokument?.bereich;
  if (!ids.includes(bereich)) throw new Fehler(400, 'Gib einen Bereich an, den du sehen darfst, oder eine dokument_id.');

  const art = a.art ?? vorher?.art;
  if (!ARTEN.includes(art)) throw new Fehler(400, `art ist eines von: ${ARTEN.join(', ')}.`);
  const titel = sauber(a.titel ?? vorher?.titel, 200);
  if (!titel) throw new Fehler(400, 'Die Frist braucht einen titel.');
  const faellig = datumOderNull(a.faellig_am ?? vorher?.faellig_am, 'faellig_am');
  if (!faellig) throw new Fehler(400, 'faellig_am fehlt.');
  let erinnern = a.erinnern_am !== undefined ? datumOderNull(a.erinnern_am, 'erinnern_am') : vorher?.erinnern_am;
  if (a.erinnern_tage_vorher !== undefined) {
    const t = Number(a.erinnern_tage_vorher);
    if (!Number.isInteger(t) || t < 0 || t > 365) throw new Fehler(400, 'erinnern_tage_vorher ist eine ganze Zahl von 0 bis 365.');
    erinnern = tageVorher(faellig, t);
  }
  if (!erinnern || (a.faellig_am && a.erinnern_am === undefined && a.erinnern_tage_vorher === undefined)) erinnern = tageVorher(faellig, 14);
  const wiederholung = a.wiederholung !== undefined ? (a.wiederholung || null) : (vorher?.wiederholung ?? null);
  if (wiederholung && !WIEDERHOLUNG.includes(wiederholung)) throw new Fehler(400, `wiederholung ist eines von: ${WIEDERHOLUNG.join(', ')}.`);
  let betrag = vorher?.betrag_cent ?? null;
  if (a.betrag !== undefined) {
    if (a.betrag === null || a.betrag === '') betrag = null;
    else if (Number.isFinite(Number(a.betrag))) betrag = Math.round(Number(a.betrag) * 100);
    else throw new Fehler(400, 'betrag muss eine Zahl in Euro sein.');
  }
  const notiz = a.notiz !== undefined ? (sauber(a.notiz, 1000) || null) : (vorher?.notiz ?? null);
  const erledigt = a.erledigt !== undefined ? (a.erledigt ? 1 : 0) : (vorher?.erledigt ?? 0);

  const am = jetzt();
  const id = vorher?.id ?? crypto.randomUUID();
  const werte = [bereich, dokumentId ?? null, art, titel, faellig, erinnern, wiederholung, betrag, notiz, erledigt, am];
  await env.DB.batch([
    vorher
      ? env.DB.prepare(`UPDATE fristen SET bereich = ?, dokument_id = ?, art = ?, titel = ?, faellig_am = ?, erinnern_am = ?,
          wiederholung = ?, betrag_cent = ?, notiz = ?, erledigt = ?, geaendert_am = ? WHERE id = ?`).bind(...werte, id)
      : env.DB.prepare(`INSERT INTO fristen (bereich, dokument_id, art, titel, faellig_am, erinnern_am, wiederholung, betrag_cent,
          notiz, erledigt, geaendert_am, id, erstellt_von, erstellt_am) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...werte, id, person.id, am),
    protokoll(env.DB, dokumentId ?? null, person.id, vorher ? 'frist geaendert' : 'frist gesetzt', { frist: id, titel, faellig_am: faellig }),
  ]);
  return env.DB.prepare('SELECT * FROM fristen WHERE id = ?').bind(id).first();
}

export async function fristenAnzeigen(env, person, { bis, bereich, erledigte = false } = {}) {
  const ids = bereichIds(person);
  const wo = [`bereich IN (${platzhalter(ids.length)})`];
  const werte = [...ids];
  if (bereich) {
    if (!ids.includes(bereich)) return { fristen: [] };
    wo.push('bereich = ?'); werte.push(bereich);
  }
  if (!erledigte) wo.push('erledigt = 0');
  const grenze = datumOderNull(bis, 'bis');
  if (grenze) { wo.push('faellig_am <= ?'); werte.push(grenze); }
  const { results } = await env.DB.prepare(`SELECT * FROM fristen WHERE ${wo.join(' AND ')} ORDER BY faellig_am ASC LIMIT 200`)
    .bind(...werte).all();
  return { fristen: results.map((f) => ({ ...f, erledigt: !!f.erledigt })) };
}
