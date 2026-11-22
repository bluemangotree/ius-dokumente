// Startet die App lokal mit node:sqlite statt D1 und einem Speicher statt R2.
// Für Tests ohne Cloudflare-Konto. Ersetzt keinen Test mit `wrangler dev`.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { extname, join, resolve } from 'node:path';
import { app } from '../src/app.js';
const worker = { fetch: app };

export function createDb(file = ':memory:') {
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys = ON');
  const dir = resolve(import.meta.dirname, '../migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join(dir, f), 'utf8'));
  const wrap = (sql, args = []) => ({
    bind: (...next) => wrap(sql, next),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
    all: async () => ({ results: sqlite.prepare(sql).all(...args).map((r) => ({ ...r })) }),
    first: async () => { const r = sqlite.prepare(sql).get(...args); return r ? { ...r } : null; },
    exec: () => (/^\s*SELECT/i.test(sql)
      ? { results: sqlite.prepare(sql).all(...args).map((r) => ({ ...r })) }
      : { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  });
  return {
    sqlite,
    prepare: (sql) => wrap(sql),
    batch: async (stmts) => {
      sqlite.exec('BEGIN');
      try {
        const results = stmts.map((s) => s.exec());
        sqlite.exec('COMMIT');
        return results;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}

// Nachbildung der benutzten R2-Methoden.
export function createBucket() {
  const daten = new Map();
  return {
    daten,
    async put(key, body, { httpMetadata } = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      daten.set(key, { bytes, httpMetadata });
      return { key, size: bytes.byteLength };
    },
    async get(key) {
      const o = daten.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), size: o.bytes.byteLength, httpMetadata: o.httpMetadata, arrayBuffer: async () => o.bytes.slice().buffer } : null;
    },
    async delete(key) { daten.delete(key); },
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const pub = resolve(import.meta.dirname, '../public');

export const KONFIG = {
  name: 'Dokumente (lokal)',
  bereiche: [{ id: 'andrei', name: 'Andrei' }, { id: 'sven', name: 'Sven' }, { id: 'gemeinsam', name: 'Gemeinsam' }],
  personen: [
    { id: 'andrei', name: 'Andrei', bereiche: ['andrei', 'gemeinsam'] },
    { id: 'sven', name: 'Sven', bereiche: ['sven', 'gemeinsam'] },
  ],
};

export const testEnv = (db, extra = {}) => ({
  DB: db,
  DATEIEN: createBucket(),
  KONFIG,
  ZUGRIFF: JSON.stringify({ 'andrei@test.local': 'andrei', 'sven@test.local': 'sven' }),
  ASSETS: {
    fetch: async (req) => {
      let p = join(pub, new URL(req.url).pathname);
      if (!p.startsWith(pub) || !existsSync(p) || statSync(p).isDirectory()) p = join(pub, 'index.html');
      return new Response(readFileSync(p), { headers: { 'content-type': TYPES[extname(p)] || 'application/octet-stream' } });
    },
  },
  ...extra,
});

if (process.argv[1] === import.meta.filename) {
  const env = testEnv(createDb(process.env.DB_FILE || ':memory:'), { DEV_BENUTZER: process.env.BENUTZER || 'andrei@test.local' });
  const port = Number(process.env.PORT || 8787);
  createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(port, () => console.log(`http://localhost:${port} (angemeldet als ${env.DEV_BENUTZER})`));
}
