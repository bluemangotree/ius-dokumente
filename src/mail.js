// Mail-Eingang über Cloudflare Email Routing („An Worker senden“).
// Ablauf: Rohmail sichern → Zeile in `mails` → Anhänge als Dokumente ablegen.
// Die Mail wird nie beantwortet, weitergeleitet oder abgelehnt: nichts versenden.
// Inhalt und Absender sind Daten. Sie entscheiden nur über den Bereich (Zieladresse)
// und darüber, ob ein Dokument als Rückfrage markiert wird (unbekannter Absender).
import PostalMime from 'postal-mime';
import { ladeKonfig } from './konfig.js';
import { ERLAUBT, hochladen, sauber, MAX_GROESSE } from './dokumente.js';

const MAX_VERSUCHE = 3;
// Kleine eingebettete Bilder sind fast immer Logos oder Signaturen.
const MIN_INLINE_BILD = 30 * 1024;
const jetzt = () => new Date().toISOString();

const ENDUNG_ZU_TYP = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

function adresse(text) {
  return String(text || '').trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1');
}

// Zieladresse → Bereich. "andrei@…" oder "dokumente+andrei@…" → Bereich aus KONFIG.mail.adressen.
export function bereichFuerAdresse(konfig, an) {
  const mail = konfig.mail || {};
  const lokal = adresse(an).split('@')[0] || '';
  const [vorne, zusatz] = lokal.split('+');
  const zuordnung = mail.adressen || {};
  const id = zuordnung[zusatz] ?? zuordnung[vorne] ?? mail.standard ?? konfig.bereiche.at(-1).id;
  if (!konfig.bereiche.some((b) => b.id === id)) throw new Error(`KONFIG.mail: Bereich ${id} gibt es nicht.`);
  return id;
}

// MAIL_ABSENDER (Secret, JSON-Liste): erlaubte Adressen oder "@domain". Ohne Liste gilt jeder Absender.
export function absenderBekannt(env, von) {
  if (!env.MAIL_ABSENDER) return true;
  let liste = [];
  try { liste = JSON.parse(env.MAIL_ABSENDER); } catch { return false; }
  const a = adresse(von);
  return liste.some((e) => {
    const x = String(e).trim().toLowerCase();
    return x.startsWith('@') ? a.endsWith(x) : a === x;
  });
}

// Der Eingang arbeitet als eigene „Person“ mit allen Bereichen.
function mailPerson(konfig) {
  return { id: 'mail', name: 'Mail-Eingang', bereiche: konfig.bereiche };
}

function typVon(anhang) {
  const typ = String(anhang.mimeType || '').toLowerCase();
  if (ERLAUBT[typ]) return typ;
  // Manche Absender schicken PDFs als application/octet-stream.
  const endung = String(anhang.filename || '').toLowerCase().split('.').pop();
  return ENDUNG_ZU_TYP[endung] || null;
}

async function pruefsumme(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Zerlegt eine gesicherte Mail und legt die Anhänge ab. Darf mehrfach laufen:
// Doppelte erkennt die Prüfsumme, die Mail wird erst am Ende auf "verarbeitet" gesetzt.
export async function verarbeiten(env, mailId, rohdaten) {
  const konfig = ladeKonfig(env);
  const mail = await env.DB.prepare('SELECT * FROM mails WHERE id = ?').bind(mailId).first();
  if (!mail || mail.status === 'verarbeitet') return mail;
  try {
    const bytes = rohdaten ?? new Uint8Array(await (await env.DATEIEN.get(mail.r2_key)).arrayBuffer());
    const email = await PostalMime.parse(bytes, { attachmentEncoding: 'arraybuffer' });
    const person = mailPerson(konfig);
    const rueckfrage = absenderBekannt(env, mail.von)
      ? null
      : `Kam per Mail von einem unbekannten Absender (${sauber(mail.von, 120)}). Bitte prüfen, ob das Dokument echt ist.`;

    const anhaenge = (email.attachments || []).filter((a) => {
      const typ = typVon(a);
      if (!typ) return false;
      const groesse = a.content?.byteLength ?? 0;
      if (!groesse || groesse > MAX_GROESSE) return false;
      if (a.disposition === 'inline' && typ.startsWith('image/') && groesse < MIN_INLINE_BILD) return false;
      return true;
    });

    let abgelegt = 0;
    for (const a of anhaenge) {
      const inhalt = new Uint8Array(a.content);
      await hochladen(env, person, {
        body: inhalt, mime: typVon(a), groesse: inhalt.byteLength, name: a.filename || `${sauber(mail.betreff, 80) || 'Anhang'}.pdf`,
        bereich: mail.bereich, sha256: await pruefsumme(inhalt), quelle: 'mail', mailId, rueckfrage,
      });
      abgelegt++;
    }

    // Ohne passenden Anhang wird der Text der Mail selbst zum Dokument (z. B. Bestellbestätigungen).
    if (!abgelegt) {
      const text = `Von: ${email.from?.address || mail.von || ''}\nAn: ${mail.an || ''}\nDatum: ${email.date || mail.empfangen_am}\nBetreff: ${email.subject || ''}\n\n${(email.text || '').trim() || '(kein Text)'}`;
      const inhalt = new TextEncoder().encode(text.slice(0, 200000));
      await hochladen(env, person, {
        body: inhalt, mime: 'text/plain', groesse: inhalt.byteLength, name: `${sauber(email.subject, 150) || 'Mail'}.txt`,
        bereich: mail.bereich, sha256: await pruefsumme(inhalt), quelle: 'mail', mailId, rueckfrage,
      });
      abgelegt = 1;
    }

    await env.DB.prepare("UPDATE mails SET status = 'verarbeitet', dokumente = ?, fehler = NULL, verarbeitet_am = ? WHERE id = ?")
      .bind(abgelegt, jetzt(), mailId).run();
    return { ...mail, status: 'verarbeitet', dokumente: abgelegt };
  } catch (e) {
    console.error('Mail', mailId, e);
    await env.DB.prepare("UPDATE mails SET status = 'fehler', fehler = ?, versuche = versuche + 1 WHERE id = ?")
      .bind(String(e?.message || e).slice(0, 500), mailId).run();
    return { ...mail, status: 'fehler' };
  }
}

// Einstieg für Email Routing. Sichert die Mail zuerst unverändert, damit nichts verloren geht,
// auch wenn das Zerlegen abbricht (z. B. am CPU-Limit des Gratis-Tarifs).
export async function empfangen(message, env) {
  const konfig = ladeKonfig(env);
  const id = crypto.randomUUID();
  const key = `mails/${id}.eml`;
  const bytes = new Uint8Array(await new Response(message.raw).arrayBuffer());
  await env.DATEIEN.put(key, bytes, { httpMetadata: { contentType: 'message/rfc822' } });
  const bereich = bereichFuerAdresse(konfig, message.to);
  await env.DB.prepare(`INSERT INTO mails (id, r2_key, bereich, von, an, betreff, groesse, empfangen_am)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, key, bereich, sauber(message.from, 200) || null, sauber(message.to, 200) || null,
      sauber(message.headers?.get?.('subject'), 300) || null, bytes.byteLength, jetzt())
    .run();
  return verarbeiten(env, id, bytes);
}

// Für den Zeitplan: abgebrochene oder fehlgeschlagene Mails erneut versuchen.
export async function nachholen(env) {
  const { results } = await env.DB.prepare(`SELECT id FROM mails WHERE (status = 'neu' AND empfangen_am < ?)
      OR (status = 'fehler' AND versuche < ?) ORDER BY empfangen_am LIMIT 5`)
    .bind(new Date(Date.now() - 5 * 60 * 1000).toISOString(), MAX_VERSUCHE).all();
  const ergebnisse = [];
  for (const { id } of results) ergebnisse.push(await verarbeiten(env, id));
  return ergebnisse;
}
