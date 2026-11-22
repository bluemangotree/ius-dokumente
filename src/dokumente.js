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

export async function hochladen(env, person, { body, mime, groesse, name, bereich, sha256, quelle = 'upload' }) {
  if (!bereichIds(person).includes(bereich)) throw new Fehler(400, 'Wähle einen Bereich, den du sehen darfst.');
  const typ = String(mime || '').split(';')[0].trim().toLowerCase();
  if (!ERLAUBT[typ]) throw new Fehler(415, 'Nur PDF und Bilder (JPEG, PNG, WebP, HEIC) sind möglich.');
  const laenge = Number(groesse);
  if (!Number.isInteger(laenge) || laenge <= 0) throw new Fehler(411, 'Die Datei ist leer oder ihre Größe fehlt.');
  if (laenge > MAX_GROESSE) throw new Fehler(413, 'Die Datei ist größer als 25 MB. Bitte kleiner speichern.');
  const original = sauber(name, 200) || `dokument.${ERLAUBT[typ]}`;
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
        hochgeladen_von, hochgeladen_am, geaendert_am) VALUES (?, ?, 'eingang', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, bereich, quelle, key, original, typ, laenge, hash, person.id, am, am),
    protokoll(env.DB, id, person.id, 'hochgeladen', { bereich, name: original }),
  ]);
  return { doppelt: false, dokument: ausZeile(await zeile(env, person, id)) };
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
  const suche = sauber(q, 100);
  if (suche) {
    // Einfache Suche über alle Wörter. Phase 2 ergänzt die Suche in Alltagssprache über Claude.
    for (const wort of suche.split(' ').slice(0, 8)) {
      const muster = `%${wort.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      wo.push(`(coalesce(dateiname, '') || ' ' || original_name || ' ' || coalesce(absender, '') || ' ' || coalesce(kategorie, '')
        || ' ' || tags || ' ' || coalesce(zusammenfassung, '') || ' ' || coalesce(volltext, '')) LIKE ? ESCAPE '\\'`);
      werte.push(muster);
    }
  }
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
export function pruefeFelder(person, felder) {
  const f = felder && typeof felder === 'object' ? felder : {};
  const neu = {};
  for (const [feld, max] of Object.entries(TEXTFELDER)) {
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

export async function aendern(env, person, id, felder) {
  const vorher = await zeile(env, person, id);
  const neu = pruefeFelder(person, felder);
  if (neu.status === 'eingeordnet' && vorher.status !== 'eingeordnet') neu.eingeordnet_am = jetzt();
  const spalten = Object.keys(neu);
  if (!spalten.length) return ausZeile(vorher);
  neu.geaendert_am = jetzt();
  const alle = Object.keys(neu);
  await env.DB.batch([
    env.DB.prepare(`UPDATE dokumente SET ${alle.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`).bind(...alle.map((s) => neu[s]), vorher.id),
    protokoll(env.DB, vorher.id, person.id, 'geaendert', Object.fromEntries(spalten.map((s) => [s, [vorher[s], neu[s]]]))),
  ]);
  return ausZeile(await zeile(env, person, id));
}
