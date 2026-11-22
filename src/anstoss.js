// Stößt die geplante Claude-Aufgabe über ihren API-Trigger an, wenn neue Dokumente im Eingang
// liegen. Läuft im Zeitplan alle 15 Minuten und feuert höchstens einmal je 15 Minuten,
// so werden mehrere Uploads gebündelt. Den nächtlichen Lauf plant die Aufgabe selbst in claude.ai.
//
// CLAUDE_FIRE_URL:   https://api.anthropic.com/v1/claude_code/routines/<id>/fire (Secret)
// CLAUDE_FIRE_TOKEN: Token aus „Generate token“ (Secret)

const ABSTAND_MS = 15 * 60 * 1000;
const BETA = 'experimental-cc-routine-2026-04-01';

async function meta(env, schluessel) {
  const z = await env.DB.prepare('SELECT wert FROM meta WHERE schluessel = ?').bind(schluessel).first();
  return z?.wert ?? null;
}
function setzeMeta(env, schluessel, wert) {
  return env.DB.prepare('INSERT INTO meta (schluessel, wert) VALUES (?, ?) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert')
    .bind(schluessel, wert);
}

export async function anstossen(env, { jetzt = Date.now() } = {}) {
  if (!env.CLAUDE_FIRE_URL || !env.CLAUDE_FIRE_TOKEN) return { ergebnis: 'nicht eingerichtet' };
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/[\w-]+\/fire$/.test(env.CLAUDE_FIRE_URL)) {
    return { ergebnis: 'CLAUDE_FIRE_URL hat nicht die erwartete Form' };
  }
  const offen = await env.DB.prepare("SELECT count(*) AS anzahl, max(hochgeladen_am) AS neuestes FROM dokumente WHERE status = 'eingang'").first();
  if (!offen?.anzahl) return { ergebnis: 'nichts offen' };

  const zuletzt = await meta(env, 'anstoss_zuletzt');
  if (zuletzt && jetzt - Date.parse(zuletzt) < ABSTAND_MS) return { ergebnis: 'zu früh' };
  // Nur wenn seit dem letzten Anstoß etwas Neues kam. Liegengebliebenes holt der nächtliche Lauf.
  if (zuletzt && offen.neuestes <= zuletzt) return { ergebnis: 'nichts Neues' };

  const res = await fetch(env.CLAUDE_FIRE_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.CLAUDE_FIRE_TOKEN}`,
      'anthropic-beta': env.CLAUDE_FIRE_BETA || BETA,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    // Bewusst nur eine Zahl, kein Inhalt aus Dokumenten oder Mails.
    body: JSON.stringify({ text: `${offen.anzahl} Dokument(e) im Eingang.` }),
  });
  const am = new Date(jetzt).toISOString();
  const ergebnis = res.ok ? 'angestoßen' : `Fehler ${res.status}`;
  await env.DB.batch([
    // Auch bei Fehlern merken, damit ein falscher Token nicht alle 15 Minuten wiederholt wird, ohne dass sich etwas ändert.
    setzeMeta(env, 'anstoss_zuletzt', am),
    setzeMeta(env, 'anstoss_ergebnis', `${am} ${ergebnis}`),
  ]);
  if (!res.ok) console.error('Anstoß fehlgeschlagen', res.status, (await res.text()).slice(0, 300));
  return { ergebnis, anzahl: offen.anzahl };
}
