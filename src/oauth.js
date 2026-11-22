// Freigabeseite für den claude.ai-Connector (OAuth). Die Seite liegt hinter Cloudflare Access,
// die Person ist also schon angemeldet. Sie bestätigt hier, dass Claude in ihrem Namen
// mit ihren Sichtrechten arbeiten darf. Die Token-Endpunkte stellt die OAuth-Bibliothek.
import { anmeldung } from './zugriff.js';
import { ladeKonfig } from './konfig.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function seite(titel, inhalt, status = 200, headers = new Headers()) {
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'");
  headers.set('x-frame-options', 'DENY');
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titel)}</title>
<style>
  :root { color-scheme: light dark; --plum:#2A1A45; --coral:#FF6B57; --page:#FFFAF5; --ink:#2A1A45; --soft:#6B5D82; --tint:#F7EDE4; }
  @media (prefers-color-scheme: dark) { :root { --page:#170E28; --ink:#F6EFF8; --soft:#B9ABCB; --tint:#261A3D; } }
  body { margin:0; background:var(--page); color:var(--ink); font:17px/1.45 ui-rounded, system-ui, -apple-system, sans-serif; }
  main { max-width:480px; margin:0 auto; padding:32px 16px; }
  h1 { font-size:24px; line-height:1.2; }
  .box { background:var(--tint); border-radius:14px; padding:12px 14px; margin:16px 0; }
  .warn { background:#FFC247; color:#2A1A45; }
  ul { padding-left:20px; } small { color:var(--soft); }
  .knoepfe { display:grid; gap:8px; margin-top:24px; }
  button { font:inherit; font-weight:700; border:0; border-radius:12px; padding:14px; cursor:pointer; }
  .ja { background:var(--coral); color:#fff; } .nein { background:var(--tint); color:var(--ink); }
</style></head><body><main>${inhalt}</main></body></html>`, { status, headers });
}

const fehlerSeite = (text, status = 400) => seite('Verbindung nicht möglich', `<h1>Verbindung nicht möglich</h1><p>${esc(text)}</p>`, status);

export async function freigabe(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return fehlerSeite('Die Verbindung zu Claude ist auf diesem Server nicht eingerichtet.', 503);
  const { person, fehler, status } = await anmeldung(request, env);
  if (!person) return fehlerSeite(fehler, status);

  try {
    if (request.method === 'GET') {
      const auftrag = await oauth.parseAuthRequest(request);
      const info = await oauth.describeConsent(auftrag);
      const consent = await oauth.beginConsent(auftrag);
      const herkunft = info.clientDomain
        ? `Herausgeber: <strong>${esc(info.clientDomain)}</strong>.`
        : 'Die Anwendung hat sich selbst angemeldet, ihr Name ist nicht geprüft.';
      const name = ladeKonfig(env).name;
      return seite(`${info.clientName} verbinden`, `
        <h1>${esc(info.clientName)} mit „${esc(name)}“ verbinden?</h1>
        <p>${herkunft} Der Zugang geht an <strong>${esc(info.redirectHost)}</strong>.</p>
        ${info.redirectIsLoopback ? '<p class="box warn">Der Zugang geht an ein Programm auf diesem Computer. Nur fortfahren, wenn du die Verbindung gerade selbst gestartet hast.</p>' : ''}
        <div class="box">
          <p>Angemeldet als <strong>${esc(person.name)}</strong> <small>(${esc(person.email)})</small>. Die Anwendung darf:</p>
          <ul>
            <li>Dokumente in ${person.bereiche.map((b) => `„${esc(b.name)}“`).join(' und ')} sehen, lesen und suchen</li>
            <li>Dokumente einordnen (Name, Kategorie, Bereich, Tags …) und Fristen setzen</li>
          </ul>
          <p><small>Löschen und Versenden ist nicht möglich. Die Verbindung lässt sich in Claude jederzeit trennen.</small></p>
        </div>
        <form method="post" action="/authorize">
          <input type="hidden" name="handle" value="${esc(consent.handle)}">
          <div class="knoepfe">
            <button class="ja" name="entscheidung" value="ja">Verbinden</button>
            <button class="nein" name="entscheidung" value="nein">Abbrechen</button>
          </div>
        </form>`, 200, consent.headers);
    }

    if (request.method === 'POST') {
      const form = await request.formData();
      const handle = String(form.get('handle') || '');
      if (form.get('entscheidung') !== 'ja') {
        const abgelehnt = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: abgelehnt.headers });
      }
      const ok = await oauth.approveConsent(request, handle);
      const { redirectTo } = await oauth.completeAuthorization({
        request: ok.request,
        userId: person.id,
        metadata: { person: person.id },
        scope: ok.request.scope,
        props: { email: person.email },
      });
      ok.headers.set('location', redirectTo);
      return new Response(null, { status: 302, headers: ok.headers });
    }
    return new Response('Methode nicht erlaubt', { status: 405, headers: { allow: 'GET, POST' } });
  } catch (e) {
    // Fehler mit geprüfter Rücksprungadresse gehen an die Anwendung zurück, alle anderen werden hier angezeigt.
    if (e?.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e?.name === 'AuthorizationError' || e?.name === 'CimdFetchError' || e?.description) {
      return fehlerSeite(e.description || 'Die Anfrage ist ungültig oder abgelaufen. Bitte die Verbindung in Claude neu starten.');
    }
    throw e;
  }
}
