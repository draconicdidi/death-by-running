/* Death By Running — service worker
   Strategy:
   - App shell (three pages + images + icons) is precached on install.
   - Navigations: network first, fall back to the cached page, then to ledger.html.
   - Same-origin assets: stale-while-revalidate.
   - Google Fonts: cache-first (opportunistic).
   - Supabase (the ledger's live data): never touched — always straight to the network,
     so doubloon counts are never served stale.
   Bump VERSION whenever a shell file changes so old caches are swept. */
const VERSION = 'dbr-v3';
const SHELL = [
  '/', '/index.html', '/ledger.html', '/merch.html',
  '/manifest.webmanifest',
  '/mark.webp', '/ferryman.webp', '/doubloons.webp',
  '/coin-front.webp', '/coin-back.webp',
  '/hoodie-front.webp', '/hoodie-back.webp', '/hoodie-chest.webp', '/hoodie-detail.webp',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

function isSupabase(url) { return url.hostname.endsWith('.supabase.co'); }
function isFonts(url) { return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'; }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Live ledger data: always network, never cached.
  if (isSupabase(url)) return;

  // Page navigations: network first, cached shell as the fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(stripQuery(req), copy));
          return res;
        })
        .catch(async () => {
          const c = await caches.open(VERSION);
          return (await c.match(stripQuery(req))) || (await c.match('/ledger.html')) || Response.error();
        })
    );
    return;
  }

  // Fonts: cache first.
  if (isFonts(url)) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
        catch { return Response.error(); }
      })
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req);
        const refresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
        return hit || (await refresh) || Response.error();
      })
    );
  }
});

function stripQuery(req) {
  const u = new URL(req.url); u.search = ''; u.hash = '';
  return new Request(u.toString(), { headers: req.headers, mode: 'same-origin', credentials: req.credentials });
}
