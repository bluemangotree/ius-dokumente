// Konfiguration einer Instanz. Derselbe Code läuft privat (Andrei, Sven, Gemeinsam)
// und später für SOMA Massagen, nur KONFIG und ZUGRIFF unterscheiden sich.
//
// KONFIG (öffentlich, in wrangler.toml unter [vars]):
//   { name, bereiche: [{ id, name }], personen: [{ id, name, bereiche: [bereich-id, …] }] }
// ZUGRIFF (Secret, weil E-Mail-Adressen privat sind):
//   { "andrei@example.de": "andrei", … }  E-Mail aus Cloudflare Access → Personen-id

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const cache = new WeakMap();

export class KonfigFehler extends Error {}

function lese(wert, name) {
  if (wert && typeof wert === 'object') return wert;
  if (typeof wert !== 'string' || !wert.trim()) throw new KonfigFehler(`${name} fehlt.`);
  try { return JSON.parse(wert); } catch { throw new KonfigFehler(`${name} ist kein gültiges JSON.`); }
}

export function pruefeKonfig(k) {
  if (!k || typeof k.name !== 'string' || !k.name.trim()) throw new KonfigFehler('KONFIG.name fehlt.');
  if (!Array.isArray(k.bereiche) || !k.bereiche.length) throw new KonfigFehler('KONFIG.bereiche ist leer.');
  if (!Array.isArray(k.personen) || !k.personen.length) throw new KonfigFehler('KONFIG.personen ist leer.');
  const bereiche = new Set();
  for (const b of k.bereiche) {
    if (!ID.test(b?.id ?? '') || typeof b.name !== 'string') throw new KonfigFehler(`Bereich ${JSON.stringify(b)} ist ungültig.`);
    if (bereiche.has(b.id)) throw new KonfigFehler(`Bereich ${b.id} ist doppelt.`);
    bereiche.add(b.id);
  }
  const personen = new Set();
  for (const p of k.personen) {
    if (!ID.test(p?.id ?? '') || typeof p.name !== 'string' || !Array.isArray(p.bereiche) || !p.bereiche.length) {
      throw new KonfigFehler(`Person ${JSON.stringify(p)} ist ungültig.`);
    }
    if (personen.has(p.id)) throw new KonfigFehler(`Person ${p.id} ist doppelt.`);
    personen.add(p.id);
    for (const b of p.bereiche) if (!bereiche.has(b)) throw new KonfigFehler(`Person ${p.id}: Bereich ${b} gibt es nicht.`);
  }
  return k;
}

export function ladeKonfig(env) {
  const roh = env.KONFIG;
  if (roh && typeof roh === 'object' && cache.has(roh)) return cache.get(roh);
  const k = pruefeKonfig(lese(roh, 'KONFIG'));
  if (roh && typeof roh === 'object') cache.set(roh, k);
  return k;
}

// E-Mail → Person, oder null, wenn die Adresse keiner Person zugeordnet ist.
export function personZuEmail(env, email) {
  if (!email) return null;
  const konfig = ladeKonfig(env);
  const zugriff = lese(env.ZUGRIFF, 'ZUGRIFF');
  const eintraege = Object.fromEntries(Object.entries(zugriff).map(([m, id]) => [m.trim().toLowerCase(), id]));
  const id = eintraege[String(email).trim().toLowerCase()];
  const person = konfig.personen.find((p) => p.id === id);
  if (!person) return null;
  return {
    id: person.id,
    name: person.name,
    email: String(email).toLowerCase(),
    bereiche: konfig.bereiche.filter((b) => person.bereiche.includes(b.id)),
  };
}
