// Anmeldung über Cloudflare Access. Access prüft die Person vor dem Worker und gibt
// ein signiertes JWT im Header Cf-Access-Jwt-Assertion mit. Der Worker prüft Signatur,
// Aussteller, Zielgruppe (ACCESS_AUD) und Ablauf selbst, damit ein Aufruf an Access
// vorbei (z. B. über eine zweite Domain) nichts freigibt.
import { personZuEmail } from './konfig.js';

const ZERTIFIKATE_MS = 60 * 60 * 1000;
const schluessel = new Map(); // Team-Domain → { keys: Map(kid → CryptoKey), bis }

const dec = new TextDecoder();

function b64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function teamUrl(domain) {
  const d = String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return d ? `https://${d}` : '';
}

async function ladeSchluessel(team, neu = false) {
  const vorhanden = schluessel.get(team);
  if (vorhanden && !neu && vorhanden.bis > Date.now()) return vorhanden.keys;
  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access-Zertifikate nicht ladbar (${res.status})`);
  const { keys = [] } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    map.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  schluessel.set(team, { keys: map, bis: Date.now() + ZERTIFIKATE_MS });
  return map;
}

export function vergissSchluessel() { schluessel.clear(); }

// Gibt die Nutzdaten des Tokens zurück oder null, wenn es nicht gültig ist.
export async function pruefeToken(token, { team, aud, jetzt = Date.now() }) {
  const teile = String(token || '').split('.');
  if (teile.length !== 3 || !team || !aud) return null;
  let kopf, daten;
  try {
    kopf = JSON.parse(dec.decode(b64url(teile[0])));
    daten = JSON.parse(dec.decode(b64url(teile[1])));
  } catch { return null; }
  if (kopf.alg !== 'RS256' || !kopf.kid) return null;

  let keys = await ladeSchluessel(team);
  // Access wechselt seine Schlüssel regelmäßig. Unbekannte kid: einmal neu laden.
  if (!keys.has(kopf.kid)) keys = await ladeSchluessel(team, true);
  const key = keys.get(kopf.kid);
  if (!key) return null;

  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(teile[2]), new TextEncoder().encode(`${teile[0]}.${teile[1]}`));
  if (!ok) return null;

  const sek = Math.floor(jetzt / 1000);
  const auds = Array.isArray(daten.aud) ? daten.aud : [daten.aud];
  if (daten.iss !== team) return null;
  if (!auds.includes(aud)) return null;
  if (!(Number(daten.exp) > sek - 30)) return null;
  if (daten.nbf && Number(daten.nbf) > sek + 30) return null;
  return daten;
}

const LOKAL = new Set(['localhost', '127.0.0.1', '[::1]']);

// Ergebnis: { person } bei Erfolg, sonst { status, fehler }.
export async function anmeldung(request, env) {
  const url = new URL(request.url);
  let email = null;

  if (env.DEV_BENUTZER && LOKAL.has(url.hostname)) {
    // Nur für die lokale Entwicklung (.dev.vars). Auf Cloudflare ist der Hostname nie localhost.
    email = env.DEV_BENUTZER;
  } else {
    const team = teamUrl(env.ACCESS_TEAM_DOMAIN);
    if (!team || !env.ACCESS_AUD) {
      return { status: 503, fehler: 'Die Anmeldung ist noch nicht eingerichtet. ACCESS_TEAM_DOMAIN und ACCESS_AUD setzen.' };
    }
    const daten = await pruefeToken(request.headers.get('cf-access-jwt-assertion'), { team, aud: env.ACCESS_AUD });
    if (!daten) return { status: 401, fehler: 'Bitte neu anmelden. Lade die Seite neu.' };
    email = daten.email;
  }

  const person = personZuEmail(env, email);
  if (!person) return { status: 403, fehler: 'Diese Adresse hat keinen Zugang. Bitte mit einer freigegebenen Adresse anmelden.' };
  return { person };
}
