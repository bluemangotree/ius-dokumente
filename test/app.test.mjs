import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
const worker = { fetch: app };
import { pruefeToken, vergissSchluessel } from '../src/zugriff.js';
import { pruefeKonfig, KonfigFehler } from '../src/konfig.js';
import { createDb, testEnv } from '../scripts/lokal.mjs';

const BASIS = 'http://localhost';
const PDF = new TextEncoder().encode('%PDF-1.4 Testinhalt');

function aufruf(env, pfad, { method = 'GET', als = 'andrei@test.local', headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (method !== 'GET' && !h.has('origin')) h.set('origin', BASIS);
  return worker.fetch(new Request(`${BASIS}${pfad}`, { method, headers: h, body }), { ...env, DEV_BENUTZER: als });
}

async function hoch(env, { als, bereich = 'gemeinsam', name = 'Rechnung.pdf', bytes = PDF, typ = 'application/pdf', sha } = {}) {
  const headers = { 'content-type': typ, 'content-length': String(bytes.byteLength), 'x-bereich': bereich, 'x-dateiname': encodeURIComponent(name) };
  if (sha) headers['x-sha256'] = sha;
  return aufruf(env, '/api/dokumente', { method: 'POST', als, headers, body: bytes });
}

describe('Weboberfläche und API', () => {
  let env;
  beforeEach(() => { env = testEnv(createDb()); });

  test('ich: Person mit ihren Bereichen', async () => {
    const res = await aufruf(env, '/api/ich');
    assert.equal(res.status, 200);
    const daten = await res.json();
    assert.equal(daten.person.name, 'Andrei');
    assert.deepEqual(daten.person.bereiche.map((b) => b.id), ['andrei', 'gemeinsam']);
  });

  test('unbekannte Adresse bekommt keinen Zugang', async () => {
    const res = await aufruf(env, '/api/ich', { als: 'fremd@test.local' });
    assert.equal(res.status, 403);
  });

  test('ohne Access-Einrichtung und ohne lokalen Benutzer: 503', async () => {
    const res = await worker.fetch(new Request(`${BASIS}/api/ich`), env);
    assert.equal(res.status, 503);
  });

  test('lokaler Benutzer gilt nur auf localhost', async () => {
    const res = await worker.fetch(new Request('https://dokumente.example.dev/api/ich'),
      { ...env, DEV_BENUTZER: 'andrei@test.local', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud' });
    assert.equal(res.status, 401);
  });

  test('Hochladen, Liste, Datei und Protokoll', async () => {
    const res = await hoch(env, { name: 'Scan 1.pdf' });
    assert.equal(res.status, 201);
    const { dokument } = await res.json();
    assert.equal(dokument.status, 'eingang');
    assert.equal(dokument.bereich, 'gemeinsam');
    assert.equal(dokument.original_name, 'Scan 1.pdf');
    assert.equal(dokument.hochgeladen_von, 'andrei');
    assert.equal(dokument.r2_key, undefined, 'interne Felder bleiben verborgen');

    const liste = await (await aufruf(env, '/api/dokumente')).json();
    assert.equal(liste.dokumente.length, 1);

    const datei = await aufruf(env, `/api/dokumente/${dokument.id}/datei`);
    assert.equal(datei.status, 200);
    assert.equal(datei.headers.get('content-type'), 'application/pdf');
    assert.equal(datei.headers.get('x-content-type-options'), 'nosniff');
    assert.match(datei.headers.get('content-disposition'), /^inline; filename="Scan 1.pdf"/);
    assert.deepEqual(new Uint8Array(await datei.arrayBuffer()), PDF);

    const runter = await aufruf(env, `/api/dokumente/${dokument.id}/datei?herunterladen`);
    assert.match(runter.headers.get('content-disposition'), /^attachment;/);

    const eintraege = env.DB.sqlite.prepare('SELECT wer, was FROM protokoll').all();
    assert.deepEqual(eintraege.map((e) => ({ ...e })), [{ wer: 'andrei', was: 'hochgeladen' }]);
  });

  test('Sichtrechte: Sven sieht Andreis Bereich nicht, aber Gemeinsam', async () => {
    const privat = (await (await hoch(env, { bereich: 'andrei' })).json()).dokument;
    const gemeinsam = (await (await hoch(env, { bereich: 'gemeinsam', name: 'Miete.pdf' })).json()).dokument;

    const liste = await (await aufruf(env, '/api/dokumente', { als: 'sven@test.local' })).json();
    assert.deepEqual(liste.dokumente.map((x) => x.id), [gemeinsam.id]);

    for (const pfad of [`/api/dokumente/${privat.id}`, `/api/dokumente/${privat.id}/datei`]) {
      assert.equal((await aufruf(env, pfad, { als: 'sven@test.local' })).status, 404);
    }
    const patch = await aufruf(env, `/api/dokumente/${privat.id}`, {
      method: 'PATCH', als: 'sven@test.local', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kategorie: 'x' }),
    });
    assert.equal(patch.status, 404);

    const leer = await (await aufruf(env, '/api/dokumente?bereich=andrei', { als: 'sven@test.local' })).json();
    assert.deepEqual(leer.dokumente, []);
  });

  test('Hochladen in fremden Bereich wird abgelehnt', async () => {
    const res = await hoch(env, { als: 'sven@test.local', bereich: 'andrei' });
    assert.equal(res.status, 400);
    assert.equal(env.DATEIEN.daten.size, 0);
  });

  test('Dateityp und Größe werden geprüft', async () => {
    assert.equal((await hoch(env, { typ: 'text/html', name: 'x.html' })).status, 415);
    assert.equal((await hoch(env, { bytes: new Uint8Array(0) })).status, 411);
    const zuGross = await aufruf(env, '/api/dokumente', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'content-length': String(30 * 1024 * 1024), 'x-bereich': 'gemeinsam' },
      body: PDF,
    });
    assert.equal(zuGross.status, 413);
  });

  test('Doppelte Dateien werden erkannt, aber nur in sichtbaren Bereichen', async () => {
    const sha = 'a'.repeat(64);
    const erst = await (await hoch(env, { sha, bereich: 'andrei' })).json();
    const nochmal = await hoch(env, { sha, bereich: 'gemeinsam' });
    assert.equal(nochmal.status, 200);
    const n = await nochmal.json();
    assert.equal(n.doppelt, true);
    assert.equal(n.dokument.id, erst.dokument.id);

    // Sven darf nicht erfahren, dass es die Datei in Andreis Bereich gibt.
    const sven = await hoch(env, { sha, bereich: 'sven', als: 'sven@test.local' });
    assert.equal(sven.status, 201);
  });

  test('Fremde Herkunft darf nicht schreiben', async () => {
    const res = await hoch(env, {});
    assert.equal(res.status, 201);
    const fremd = await aufruf(env, '/api/dokumente', {
      method: 'POST', headers: { origin: 'https://boese.example', 'content-type': 'application/pdf', 'content-length': '3', 'x-bereich': 'gemeinsam' }, body: 'abc',
    });
    assert.equal(fremd.status, 403);
  });

  test('Ändern prüft Felder und schreibt Protokoll', async () => {
    const { dokument } = await (await hoch(env, {})).json();
    const patch = (felder) => aufruf(env, `/api/dokumente/${dokument.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(felder),
    });
    const ok = await patch({ dateiname: '2026-11-01 Stadtwerke Abschlag', kategorie: 'Energie', datum: '2026-11-01', betrag_cent: 8900, tags: ['Strom', 'strom', ' Abschlag '], status: 'eingeordnet', bereich: 'andrei' });
    assert.equal(ok.status, 200);
    const neu = (await ok.json()).dokument;
    assert.equal(neu.kategorie, 'Energie');
    assert.equal(neu.betrag_cent, 8900);
    assert.deepEqual(neu.tags, ['strom', 'abschlag']);
    assert.equal(neu.bereich, 'andrei');
    assert.ok(neu.eingeordnet_am);

    assert.equal((await patch({ datum: '01.11.2026' })).status, 400);
    assert.equal((await patch({ betrag_cent: 12.5 })).status, 400);
    assert.equal((await patch({ bereich: 'sven' })).status, 400);
    assert.equal((await patch({ status: 'geloescht' })).status, 400);

    const p = env.DB.sqlite.prepare("SELECT details FROM protokoll WHERE was = 'geaendert'").get();
    assert.deepEqual(JSON.parse(p.details).kategorie, [null, 'Energie']);

    const datei = await aufruf(env, `/api/dokumente/${dokument.id}/datei?herunterladen`);
    assert.match(datei.headers.get('content-disposition'), /filename="2026-11-01 Stadtwerke Abschlag.pdf"/);
  });

  test('Suche, Statusfilter und Seiten', async () => {
    for (let i = 0; i < 53; i++) await hoch(env, { name: `Beleg ${i}.pdf` });
    const { dokument } = await (await hoch(env, { name: 'Kfz-Versicherung 100%.pdf' })).json();
    await aufruf(env, `/api/dokumente/${dokument.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ absender: 'HUK Coburg', status: 'rueckfrage' }),
    });

    const treffer = await (await aufruf(env, `/api/dokumente?q=${encodeURIComponent('huk versicherung')}`)).json();
    assert.deepEqual(treffer.dokumente.map((x) => x.id), [dokument.id]);
    const prozent = await (await aufruf(env, `/api/dokumente?q=${encodeURIComponent('100%')}`)).json();
    assert.equal(prozent.dokumente.length, 1);
    const rueck = await (await aufruf(env, '/api/dokumente?status=rueckfrage')).json();
    assert.equal(rueck.dokumente.length, 1);

    const s1 = await (await aufruf(env, '/api/dokumente')).json();
    assert.equal(s1.dokumente.length, 50);
    assert.ok(s1.weiter);
    const s2 = await (await aufruf(env, `/api/dokumente?vor=${encodeURIComponent(s1.weiter)}`)).json();
    assert.equal(s2.dokumente.length, 4);
    assert.equal(s2.weiter, null);
    const ids = new Set([...s1.dokumente, ...s2.dokumente].map((x) => x.id));
    assert.equal(ids.size, 54);
  });

  test('Dateinamen werden bereinigt', async () => {
    const { dokument } = await (await hoch(env, { name: '../../etc/passwd\n.pdf' })).json();
    assert.equal(dokument.original_name.includes('/'), false);
    assert.equal(dokument.original_name.includes('\n'), false);
  });

  test('Oberfläche kommt aus den Assets', async () => {
    const res = await worker.fetch(new Request(`${BASIS}/`), env);
    assert.match(await res.text(), /<title>/);
  });
});

describe('Konfiguration', () => {
  const gut = { name: 'X', bereiche: [{ id: 'a', name: 'A' }], personen: [{ id: 'p', name: 'P', bereiche: ['a'] }] };
  test('gültige Konfiguration', () => assert.equal(pruefeKonfig(gut), gut));
  test('Person mit unbekanntem Bereich', () => {
    assert.throws(() => pruefeKonfig({ ...gut, personen: [{ id: 'p', name: 'P', bereiche: ['b'] }] }), KonfigFehler);
  });
  test('doppelter Bereich', () => {
    assert.throws(() => pruefeKonfig({ ...gut, bereiche: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }), KonfigFehler);
  });
  test('ungültige id', () => {
    assert.throws(() => pruefeKonfig({ ...gut, bereiche: [{ id: 'A B', name: 'A' }] }), KonfigFehler);
  });
});

describe('Cloudflare Access', () => {
  const team = 'https://team.cloudflareaccess.com';
  const aud = 'aud-123';
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  let paar, jwk, abrufe;

  async function signiere(daten, { kid = 'k1', key = paar.privateKey } = {}) {
    const kopf = enc({ alg: 'RS256', kid, typ: 'JWT' });
    const rumpf = enc(daten);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${kopf}.${rumpf}`));
    return `${kopf}.${rumpf}.${Buffer.from(sig).toString('base64url')}`;
  }
  const jetzt = () => Math.floor(Date.now() / 1000);
  const daten = (x = {}) => ({ iss: team, aud: [aud], email: 'Andrei@Test.local', exp: jetzt() + 600, iat: jetzt(), ...x });

  beforeEach(async () => {
    vergissSchluessel();
    paar = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwk = { ...(await crypto.subtle.exportKey('jwk', paar.publicKey)), kid: 'k1' };
    abrufe = 0;
    globalThis.fetch = async (url) => {
      abrufe++;
      assert.equal(String(url), `${team}/cdn-cgi/access/certs`);
      return Response.json({ keys: [jwk] });
    };
  });

  test('gültiges Token', async () => {
    const d = await pruefeToken(await signiere(daten()), { team, aud });
    assert.equal(d.email, 'Andrei@Test.local');
  });

  test('falsche Zielgruppe, falscher Aussteller, abgelaufen', async () => {
    assert.equal(await pruefeToken(await signiere(daten({ aud: ['andere'] })), { team, aud }), null);
    assert.equal(await pruefeToken(await signiere(daten({ iss: 'https://boese.cloudflareaccess.com' })), { team, aud }), null);
    assert.equal(await pruefeToken(await signiere(daten({ exp: jetzt() - 120 })), { team, aud }), null);
  });

  test('fremder Schlüssel', async () => {
    const anderes = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
    assert.equal(await pruefeToken(await signiere(daten(), { key: anderes.privateKey }), { team, aud }), null);
  });

  test('manipulierte Nutzdaten', async () => {
    const [k, , s] = (await signiere(daten())).split('.');
    assert.equal(await pruefeToken(`${k}.${enc(daten({ email: 'sven@test.local' }))}.${s}`, { team, aud }), null);
  });

  test('alg none wird abgelehnt', async () => {
    const t = `${enc({ alg: 'none', kid: 'k1' })}.${enc(daten())}.`;
    assert.equal(await pruefeToken(t, { team, aud }), null);
  });

  test('Schlüssel werden zwischengespeichert und bei neuer kid nachgeladen', async () => {
    await pruefeToken(await signiere(daten()), { team, aud });
    await pruefeToken(await signiere(daten()), { team, aud });
    assert.equal(abrufe, 1);
    jwk = { ...jwk, kid: 'k2' };
    assert.ok(await pruefeToken(await signiere(daten(), { kid: 'k2' }), { team, aud }));
    assert.equal(abrufe, 2);
  });

  test('Ende zu Ende über den Worker', async () => {
    const env = testEnv(createDb(), { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: aud });
    const token = await signiere(daten());
    const ok = await worker.fetch(new Request('https://dokumente.example.dev/api/ich', { headers: { 'cf-access-jwt-assertion': token } }), env);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).person.id, 'andrei');
    const ohne = await worker.fetch(new Request('https://dokumente.example.dev/api/ich'), env);
    assert.equal(ohne.status, 401);
  });
});
