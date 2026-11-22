// Hält nur die Oberfläche offline vor. Dokumente und API-Antworten laufen nie über diesen Zwischenspeicher.
const CACHE = 'dokumente-v1';
const SHELL = ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/icons/logo.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (!SHELL.includes(url.pathname) && event.request.mode !== 'navigate') return;

  const key = event.request.mode === 'navigate' ? '/' : url.pathname;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);
      const fresh = fetch(event.request)
        .then((res) => { if (res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
