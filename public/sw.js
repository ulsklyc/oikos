/**
 * Modul: Service Worker
 * Zweck: Offline-Fähigkeit, differenzierte Caching-Strategien, Update-Notification
 * Abhängigkeiten: keine
 *
 * Caching-Strategien:
 *   APP_SHELL (HTML + kritische JS/CSS): Stale-While-Revalidate
 *     → Sofortiger Render aus Cache, Update im Hintergrund
 *   PAGE_MODULES (Seiten-JS): Stale-While-Revalidate
 *     → Navigation bleibt schnell, neue Module werden im Hintergrund geladen
 *   ASSETS (Bilder, Icons): Cache-First, 30-Tage-TTL
 *   API: Immer Netzwerk (kein Caching von Nutzerdaten)
 */

const SHELL_CACHE   = 'oikos-shell-v15';
const PAGES_CACHE   = 'oikos-pages-v15';
const ASSETS_CACHE  = 'oikos-assets-v15';
const ALL_CACHES    = [SHELL_CACHE, PAGES_CACHE, ASSETS_CACHE];

// App-Shell: sofort benötigt für ersten Render
const APP_SHELL = [
  '/',
  '/index.html',
  '/api.js',
  '/router.js',
  '/rrule-ui.js',
  '/sw-register.js',
  '/lucide.min.js',
  '/styles/tokens.css',
  '/styles/reset.css',
  '/styles/layout.css',
  '/styles/login.css',
  '/styles/dashboard.css',
  '/styles/tasks.css',
  '/styles/shopping.css',
  '/styles/meals.css',
  '/styles/calendar.css',
  '/styles/notes.css',
  '/styles/contacts.css',
  '/styles/budget.css',
  '/styles/settings.css',
  '/manifest.json',
  '/favicon.ico',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
];

// Seiten-Module: lazy geladen, aber vorab gecacht für Offline
const PAGE_MODULES = [
  '/pages/dashboard.js',
  '/pages/tasks.js',
  '/pages/shopping.js',
  '/pages/meals.js',
  '/pages/calendar.js',
  '/pages/notes.js',
  '/pages/contacts.js',
  '/pages/budget.js',
  '/pages/settings.js',
  '/pages/login.js',
];

// --------------------------------------------------------
// Install: App-Shell + Seiten-Module vorab cachen
// --------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c)  => c.addAll(APP_SHELL)),
      caches.open(PAGES_CACHE).then((c)  => c.addAll(PAGE_MODULES)),
    ])
  );
  // Sofort aktivieren ohne auf bestehende Clients zu warten
  self.skipWaiting();
});

// --------------------------------------------------------
// Activate: Alte Cache-Versionen löschen + Clients informieren
// --------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => {
      self.clients.claim();
      // Alle offenen Tabs über das Update informieren
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
      });
    })
  );
});

// --------------------------------------------------------
// Fetch: Strategie je nach Request-Typ
// --------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API: immer Netzwerk — niemals Nutzerdaten cachen
  if (url.pathname.startsWith('/api/')) return;

  // Nur GET cachen
  if (request.method !== 'GET') return;

  // Bilder + Fonts: Cache-First, langer TTL
  if (isAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE));
    return;
  }

  // Seiten-Module (/pages/*.js): Stale-While-Revalidate
  if (url.pathname.startsWith('/pages/')) {
    event.respondWith(staleWhileRevalidate(request, PAGES_CACHE));
    return;
  }

  // App-Shell (HTML, JS, CSS): Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

// --------------------------------------------------------
// Strategie: Stale-While-Revalidate
// Liefert sofort aus Cache, aktualisiert im Hintergrund.
// Fallback auf Netzwerk wenn nicht gecacht; Fallback auf
// index.html für Navigations-Requests (Offline-SPA).
// --------------------------------------------------------
async function staleWhileRevalidate(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);

  // Netzwerk-Request im Hintergrund starten
  const networkPromise = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) {
    // Hintergrund-Update läuft, Cache-Version sofort zurückgeben
    networkPromise; // fire-and-forget
    return cached;
  }

  // Nicht im Cache → auf Netzwerk warten
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  // Offline-Fallback: SPA-Shell für Navigation
  if (request.mode === 'navigate') {
    const shell = await caches.match('/index.html');
    if (shell) return shell;
  }

  // Letzter Ausweg: leere 503-Antwort statt Promise-Rejection
  return new Response('Service unavailable', { status: 503 });
}

// --------------------------------------------------------
// Strategie: Cache-First mit TTL (für Bilder/Fonts)
// --------------------------------------------------------
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------
function isAsset(pathname) {
  return /\.(png|jpg|jpeg|ico|svg|webp|woff2?|gif)$/i.test(pathname);
}
