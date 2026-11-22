import { anmeldung } from './zugriff.js';
import { ladeKonfig, KonfigFehler } from './konfig.js';
import * as d from './dokumente.js';
import { freigabe } from './oauth.js';

const json = (daten, status = 200) => Response.json(daten, { status, headers: { 'cache-control': 'no-store' } });

function dateiAntwort({ obj, dokument }, herunterladen) {
  const name = dokument.dateiname || dokument.original_name;
  const endung = d.ENDUNG[dokument.mime];
  const voll = name.toLowerCase().endsWith(`.${endung}`) ? name : `${name}.${endung}`;
  const ascii = voll.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(obj.body, {
    headers: {
      'content-type': dokument.mime === 'text/plain' ? 'text/plain; charset=utf-8' : dokument.mime,
      'content-length': String(obj.size),
      'content-disposition': `${herunterladen ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(voll)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    },
  });
}

async function api(request, env, url, person) {
  const [, , teil, id, aktion] = url.pathname.split('/');
  const m = request.method;

  // Schreibende Aufrufe nur von der eigenen Seite (Schutz gegen fremde Formulare).
  if (m !== 'GET' && m !== 'HEAD' && request.headers.get('origin') !== url.origin) {
    return json({ fehler: 'Aufruf von einer fremden Seite abgelehnt.' }, 403);
  }

  if (m === 'GET' && teil === 'ich' && !id) {
    const konfig = ladeKonfig(env);
    return json({ instanz: konfig.name, person: { id: person.id, name: person.name, bereiche: person.bereiche } });
  }

  if (teil === 'dokumente') {
    if (!id && m === 'GET') {
      const p = url.searchParams;
      return json(await d.liste(env, person, { bereich: p.get('bereich'), status: p.get('status'), q: p.get('q'), vor: p.get('vor') }));
    }
    if (!id && m === 'POST') {
      // Die Datei kommt roh im Body und wird ohne Zwischenspeicher nach R2 gestreamt.
      const name = (() => { try { return decodeURIComponent(request.headers.get('x-dateiname') || ''); } catch { return ''; } })();
      const ergebnis = await d.hochladen(env, person, {
        body: request.body,
        mime: request.headers.get('content-type'),
        groesse: request.headers.get('content-length'),
        name,
        bereich: request.headers.get('x-bereich'),
        sha256: request.headers.get('x-sha256'),
      });
      return json(ergebnis, ergebnis.doppelt ? 200 : 201);
    }
    if (id && !aktion && m === 'GET') return json({ dokument: await d.holen(env, person, id) });
    if (id && !aktion && m === 'PATCH') {
      const felder = await request.json().catch(() => null);
      if (!felder) return json({ fehler: 'Erwartet JSON.' }, 400);
      return json({ dokument: await d.aendern(env, person, id, felder) });
    }
    if (id && aktion === 'datei' && m === 'GET') {
      return dateiAntwort(await d.datei(env, person, id), url.searchParams.has('herunterladen'));
    }
  }
  return json({ fehler: 'Diese Adresse gibt es nicht.' }, 404);
}

// Alles außer /mcp und den OAuth-Endpunkten: Oberfläche, API und die Freigabeseite für Claude.
export async function app(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/authorize') return freigabe(request, env);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  try {
    const { person, status, fehler } = await anmeldung(request, env);
    if (!person) return json({ fehler }, status);
    return await api(request, env, url, person);
  } catch (e) {
    if (e instanceof d.Fehler) return json({ fehler: e.message }, e.status);
    if (e instanceof KonfigFehler) {
      console.error('Konfiguration:', e.message);
      return json({ fehler: `Die Instanz ist falsch eingerichtet: ${e.message}` }, 500);
    }
    console.error(e);
    return json({ fehler: 'Unerwarteter Fehler. Bitte noch einmal versuchen.' }, 500);
  }
}
