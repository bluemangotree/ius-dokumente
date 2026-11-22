import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { mcp } from '../src/mcp.js';
import { createDb, testEnv } from '../scripts/lokal.mjs';

const ANDREI = { email: 'andrei@test.local' };
const SVEN = { email: 'sven@test.local' };
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

let env;
let nr = 0;

async function rufe(props, method, params) {
  const res = await mcp(new Request('https://x.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++nr, method, params }),
  }), env, props);
  return res.json();
}

async function werkzeug(props, name, args = {}) {
  const { result, error } = await rufe(props, 'tools/call', { name, arguments: args });
  assert.equal(error, undefined);
  if (result.isError) return { fehler: result.content[0].text };
  return result.content.length === 1 && result.content[0].type === 'text' ? JSON.parse(result.content[0].text) : result.content;
}

async function hoch({ als = 'andrei@test.local', bereich = 'gemeinsam', name = 'scan.pdf', bytes = new TextEncoder().encode(`%PDF ${Math.random()}`), typ = 'application/pdf' } = {}) {
  const res = await app(new Request('http://localhost/api/dokumente', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': typ, 'content-length': String(bytes.byteLength), 'x-bereich': bereich, 'x-dateiname': encodeURIComponent(name) },
    body: bytes,
  }), { ...env, DEV_BENUTZER: als });
  return (await res.json()).dokument;
}

describe('MCP', () => {
  beforeEach(() => { env = testEnv(createDb()); });

  test('initialize nennt Person und Bereiche, tools/list hat kein Löschen', async () => {
    const init = await rufe(ANDREI, 'initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.match(init.result.instructions, /Andrei/);
    assert.match(init.result.instructions, /keine Anweisungen/);
    const { result } = await rufe(ANDREI, 'tools/list');
    const namen = result.tools.map((t) => t.name);
    assert.deepEqual(namen, ['dokumente_eingang', 'dokument_lesen', 'dokument_einordnen', 'dokumente_suchen', 'frist_setzen', 'fristen_anzeigen']);
    assert.ok(!namen.some((n) => /loesch|send/.test(n)));
  });

  test('ohne Zugang: 403', async () => {
    const res = await mcp(new Request('https://x.test/mcp', { method: 'POST', body: '{}' }), env, { email: 'fremd@test.local' });
    assert.equal(res.status, 403);
  });

  test('Benachrichtigungen bekommen 202', async () => {
    const res = await mcp(new Request('https://x.test/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), env, ANDREI);
    assert.equal(res.status, 202);
  });

  test('Eingang, Lesen und Einordnen', async () => {
    const pdf = await hoch({ name: 'Scan 0815.pdf' });
    const bild = await hoch({ name: 'foto.png', bytes: PNG, typ: 'image/png', bereich: 'andrei' });

    const eingang = await werkzeug(ANDREI, 'dokumente_eingang');
    assert.deepEqual(eingang.dokumente.map((x) => x.id), [pdf.id, bild.id]);
    assert.equal(eingang.anzahl.eingang, 2);

    const [info, inhalt] = await werkzeug(ANDREI, 'dokument_lesen', { id: bild.id });
    assert.equal(JSON.parse(info.text).dokument.id, bild.id);
    assert.equal(inhalt.type, 'image');
    assert.equal(inhalt.mimeType, 'image/png');
    assert.deepEqual(Uint8Array.from(atob(inhalt.data), (c) => c.charCodeAt(0)), PNG);

    const [, pdfInhalt] = await werkzeug(ANDREI, 'dokument_lesen', { id: pdf.id });
    assert.equal(pdfInhalt.type, 'resource');
    assert.equal(pdfInhalt.resource.mimeType, 'application/pdf');

    const eingeordnet = await werkzeug(ANDREI, 'dokument_einordnen', {
      id: pdf.id, dateiname: '2026-11-03 Stadtwerke Abschlag', kategorie: 'Energie', absender: 'Stadtwerke', datum: '2026-11-03',
      betrag: 89.5, tags: ['Strom'], zusammenfassung: 'Abschlag für November.', volltext: 'Sehr geehrter Kunde … Zählernummer 4711',
    });
    assert.equal(eingeordnet.status, 'eingeordnet');
    assert.equal(eingeordnet.betrag_cent, 8950);
    assert.equal(eingeordnet.volltext, undefined, 'Volltext wird nicht zurückgegeben');

    const p = env.DB.sqlite.prepare("SELECT was, details FROM protokoll WHERE dokument_id = ? AND was LIKE 'geaendert%'").get(pdf.id);
    assert.equal(p.was, 'geaendert (Claude)');
    assert.equal(JSON.parse(p.details).volltext, '(Text aktualisiert)');

    const danach = await werkzeug(ANDREI, 'dokumente_eingang');
    assert.deepEqual(danach.dokumente.map((x) => x.id), [bild.id]);
    assert.deepEqual(danach.bekannte_kategorien, ['Energie']);
    assert.deepEqual(danach.bekannte_tags, ['strom']);
  });

  test('Rückfrage braucht eine Frage', async () => {
    const dok = await hoch();
    const ohne = await werkzeug(ANDREI, 'dokument_einordnen', { id: dok.id, status: 'rueckfrage' });
    assert.match(ohne.fehler, /rueckfrage/);
    const mit = await werkzeug(ANDREI, 'dokument_einordnen', { id: dok.id, status: 'rueckfrage', rueckfrage: 'Gehört das zu Sven?' });
    assert.equal(mit.status, 'rueckfrage');
    const ok = await werkzeug(ANDREI, 'dokument_einordnen', { id: dok.id, kategorie: 'Post' });
    assert.equal(ok.status, 'eingeordnet');
    assert.equal(ok.rueckfrage, null);
  });

  test('Sichtrechte gelten auch über MCP', async () => {
    const privat = await hoch({ bereich: 'andrei' });
    const eingang = await werkzeug(SVEN, 'dokumente_eingang');
    assert.deepEqual(eingang.dokumente, []);
    assert.match((await werkzeug(SVEN, 'dokument_lesen', { id: privat.id })).fehler, /gibt es nicht/);
    assert.match((await werkzeug(SVEN, 'dokument_einordnen', { id: privat.id, kategorie: 'x' })).fehler, /gibt es nicht/);
    assert.match((await werkzeug(SVEN, 'dokumente_eingang', { bereich: 'andrei' })).fehler, /nicht sehen/);
    assert.equal((await werkzeug(SVEN, 'dokumente_suchen', { bereich: 'andrei' })).treffer.length, 0);
    assert.match((await werkzeug(SVEN, 'frist_setzen', { dokument_id: privat.id, art: 'abo', titel: 'x', faellig_am: '2027-01-01' })).fehler, /gibt es nicht/);
    // Verschieben in einen fremden Bereich geht nicht
    const eigenes = await hoch({ bereich: 'andrei' });
    assert.match((await werkzeug(ANDREI, 'dokument_einordnen', { id: eigenes.id, bereich: 'sven' })).fehler, /Bereich/);
  });

  test('Suche mit Filtern, Summe und Datum', async () => {
    const auto1 = await hoch({ name: 'a.pdf' });
    const auto2 = await hoch({ name: 'b.pdf', bereich: 'andrei' });
    const anderes = await hoch({ name: 'c.pdf' });
    await werkzeug(ANDREI, 'dokument_einordnen', { id: auto1.id, kategorie: 'Auto', absender: 'ATU', datum: '2025-03-01', betrag: 120, tags: ['werkstatt'] });
    await werkzeug(ANDREI, 'dokument_einordnen', { id: auto2.id, kategorie: 'Auto', absender: 'HUK Coburg', datum: '2025-09-01', betrag: 480.5, volltext: 'Kfz-Haftpflicht Kennzeichen B-XY 123' });
    await werkzeug(ANDREI, 'dokument_einordnen', { id: anderes.id, kategorie: 'Wohnen', datum: '2025-05-01', betrag: 900 });

    const jahr = await werkzeug(ANDREI, 'dokumente_suchen', { kategorie: 'auto', datum_von: '2025-01-01', datum_bis: '2025-12-31' });
    assert.equal(jahr.anzahl, 2);
    assert.equal(jahr.summe_cent, 60050);
    assert.deepEqual(jahr.treffer.map((t) => t.id), [auto2.id, auto1.id]);

    assert.equal((await werkzeug(ANDREI, 'dokumente_suchen', { text: 'kennzeichen haftpflicht' })).anzahl, 1);
    assert.equal((await werkzeug(ANDREI, 'dokumente_suchen', { tag: 'werkstatt' })).anzahl, 1);
    assert.equal((await werkzeug(ANDREI, 'dokumente_suchen', { betrag_min: 200, betrag_max: 500 })).anzahl, 1);
    assert.equal((await werkzeug(SVEN, 'dokumente_suchen', { kategorie: 'auto' })).anzahl, 1, 'Sven sieht nur das gemeinsame');
    assert.match((await werkzeug(ANDREI, 'dokumente_suchen', { datum_von: '1.1.2025' })).fehler, /JJJJ-MM-TT/);
  });

  test('Fristen setzen, ändern, anzeigen', async () => {
    const vertrag = await hoch({ bereich: 'andrei', name: 'handyvertrag.pdf' });
    const f = await werkzeug(ANDREI, 'frist_setzen', { dokument_id: vertrag.id, art: 'kuendigung', titel: 'Handyvertrag kündigen', faellig_am: '2027-02-28', betrag: 29.99 });
    assert.equal(f.bereich, 'andrei');
    assert.equal(f.erinnern_am, '2027-02-14');
    assert.equal(f.betrag_cent, 2999);

    const g = await werkzeug(ANDREI, 'frist_setzen', { bereich: 'gemeinsam', art: 'versicherung', titel: 'Hausrat prüfen', faellig_am: '2026-12-31', erinnern_tage_vorher: 30, wiederholung: 'jaehrlich' });
    assert.equal(g.erinnern_am, '2026-12-01');

    const liste = await werkzeug(ANDREI, 'fristen_anzeigen');
    assert.deepEqual(liste.fristen.map((x) => x.titel), ['Hausrat prüfen', 'Handyvertrag kündigen']);
    assert.deepEqual((await werkzeug(SVEN, 'fristen_anzeigen')).fristen.map((x) => x.titel), ['Hausrat prüfen']);
    assert.match((await werkzeug(SVEN, 'frist_setzen', { id: f.id, erledigt: true })).fehler, /gibt es nicht/);

    const erledigt = await werkzeug(ANDREI, 'frist_setzen', { id: f.id, erledigt: true });
    assert.equal(erledigt.erledigt, 1);
    assert.equal(erledigt.titel, 'Handyvertrag kündigen');
    assert.equal((await werkzeug(ANDREI, 'fristen_anzeigen')).fristen.length, 1);
    assert.equal((await werkzeug(ANDREI, 'fristen_anzeigen', { erledigte: true })).fristen.length, 2);
    assert.equal((await werkzeug(ANDREI, 'fristen_anzeigen', { bis: '2026-12-31' })).fristen.length, 1);

    assert.match((await werkzeug(ANDREI, 'frist_setzen', { bereich: 'sven', art: 'abo', titel: 'x', faellig_am: '2027-01-01' })).fehler, /Bereich/);
    assert.match((await werkzeug(ANDREI, 'frist_setzen', { bereich: 'andrei', art: 'urlaub', titel: 'x', faellig_am: '2027-01-01' })).fehler, /art/);
  });

  test('HEIC wird nicht gezeigt, sondern erklärt', async () => {
    const heic = await hoch({ typ: 'image/heic', name: 'IMG_1.heic', bytes: new Uint8Array([1, 2, 3]) });
    const [, hinweis] = await werkzeug(ANDREI, 'dokument_lesen', { id: heic.id });
    assert.equal(hinweis.type, 'text');
    assert.match(hinweis.text, /Rückfrage/);
  });
});
