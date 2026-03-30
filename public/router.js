/**
 * Modul: Client-Side Router
 * Zweck: SPA-Routing über History API ohne Framework, Auth-Guard, Seiten-Übergänge
 * Abhängigkeiten: api.js
 */

import { auth } from '/api.js';

// --------------------------------------------------------
// Routen-Definitionen
// Jede Route hat: path, page (dynamisch geladen), requiresAuth, module (für theme-color)
// --------------------------------------------------------
const ROUTES = [
  { path: '/login',    page: '/pages/login.js',    requiresAuth: false, module: null        },
  { path: '/',         page: '/pages/dashboard.js', requiresAuth: true, module: 'dashboard' },
  { path: '/tasks',    page: '/pages/tasks.js',     requiresAuth: true, module: 'tasks'     },
  { path: '/shopping', page: '/pages/shopping.js',  requiresAuth: true, module: 'shopping'  },
  { path: '/meals',    page: '/pages/meals.js',     requiresAuth: true, module: 'meals'     },
  { path: '/calendar', page: '/pages/calendar.js',  requiresAuth: true, module: 'calendar'  },
  { path: '/notes',    page: '/pages/notes.js',     requiresAuth: true, module: 'notes'     },
  { path: '/contacts', page: '/pages/contacts.js',  requiresAuth: true, module: 'contacts'  },
  { path: '/budget',   page: '/pages/budget.js',    requiresAuth: true, module: 'budget'    },
  { path: '/settings', page: '/pages/settings.js',  requiresAuth: true, module: 'settings'  },
];

// --------------------------------------------------------
// Standalone-Modus: Dynamische theme-color Anpassung
// Statusbar-Farbe spiegelt aktuelle Seite / Modal-State wider
// --------------------------------------------------------
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true;

/**
 * Setzt die theme-color Meta-Tags (Light + Dark Variante).
 * @param {string} lightColor
 * @param {string} [darkColor] — Falls nicht angegeben, wird lightColor für beide gesetzt
 */
function setThemeColor(lightColor, darkColor) {
  if (!isStandalone) return;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (metas.length >= 2) {
    metas[0].setAttribute('content', lightColor);
    metas[1].setAttribute('content', darkColor || lightColor);
  } else if (metas.length === 1) {
    metas[0].setAttribute('content', lightColor);
  }
}

/** Liest eine CSS Custom Property vom :root */
function getCSSToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Setzt theme-color passend zum aktuellen Modul */
function updateThemeColorForRoute(route) {
  if (!route?.module) {
    setThemeColor('#007AFF', '#1C1C1E');
    return;
  }
  const color = getCSSToken(`--module-${route.module}`);
  if (color) {
    setThemeColor(color, color);
  }
}

// --------------------------------------------------------
// Modul-Cache: verhindert redundante dynamic imports bei Navigation
// --------------------------------------------------------
const moduleCache = new Map();

async function importPage(pagePath) {
  if (!moduleCache.has(pagePath)) {
    moduleCache.set(pagePath, await import(pagePath));
  }
  return moduleCache.get(pagePath);
}

// --------------------------------------------------------
// Globaler App-State
// --------------------------------------------------------
let currentUser = null;
let currentPath = null;
let isNavigating = false;

// --------------------------------------------------------
// Router
// --------------------------------------------------------

const ROUTE_ORDER = ['/', '/tasks', '/calendar', '/meals', '/shopping',
                     '/notes', '/contacts', '/budget', '/settings'];

function getDirection(fromPath, toPath) {
  const fromIdx = ROUTE_ORDER.indexOf(fromPath ?? '/');
  const toIdx   = ROUTE_ORDER.indexOf(toPath);
  if (fromIdx === -1 || toIdx === -1 || fromPath === toPath) return 'right';
  return toIdx > fromIdx ? 'right' : 'left';
}

/**
 * Navigiert zu einem Pfad und rendert die entsprechende Seite.
 * @param {string} path
 * @param {Object|boolean} userOrPushState - Direkt ein User-Objekt nach Login,
 *   oder boolean (pushState) für interne Navigation
 * @param {boolean} pushState - false beim initialen Load und popstate
 */
async function navigate(path, userOrPushState = true, pushState = true) {
  if (isNavigating) return;
  isNavigating = true;

  try {
    // Überlastung: navigate(path, user) nach Login vs navigate(path, false) beim Init
    if (typeof userOrPushState === 'object' && userOrPushState !== null) {
      currentUser = userOrPushState;
    } else {
      pushState = userOrPushState;
    }

    // Alten Pfad merken, bevor currentPath aktualisiert wird — für Richtungsberechnung
    const previousPath = currentPath;
    currentPath = path;

    const route = ROUTES.find((r) => r.path === path) ?? ROUTES.find((r) => r.path === '/');

    // Auth-Guard
    if (route.requiresAuth && !currentUser) {
      try {
        const result = await auth.me();
        currentUser = result.user;
      } catch {
        currentPath = null; // Reset damit navigate('/login') nicht geblockt wird
        isNavigating = false;
        navigate('/login');
        return;
      }
    }

    if (!route.requiresAuth && currentUser && path === '/login') {
      currentPath = null;
      isNavigating = false;
      navigate('/');
      return;
    }

    if (pushState) {
      history.pushState({ path }, '', path);
    }

    await renderPage(route, previousPath);
    updateNav(path);
    updateThemeColorForRoute(route);
  } finally {
    isNavigating = false;
  }
}

/**
 * Lädt und rendert eine Seite dynamisch.
 * @param {{ path: string, page: string }} route
 * @param {string|null} previousPath - Pfad vor der Navigation (für Richtungsberechnung)
 */
async function renderPage(route, previousPath = null) {
  const app = document.getElementById('app');
  const loading = document.getElementById('app-loading');

  // Loading verstecken
  if (loading) loading.hidden = true;

  try {
    const module = await importPage(route.page);

    if (typeof module.render !== 'function') {
      throw new Error(`Seite ${route.page} exportiert keine render()-Funktion.`);
    }

    // App-Shell einmalig aufbauen BEVOR render() aufgerufen wird —
    // page-content muss im DOM existieren damit document.getElementById()
    // in Seiten-Modulen funktioniert.
    if (!document.querySelector('.nav-bottom') && currentUser) {
      renderAppShell(app);
    }

    const content = document.getElementById('page-content') || app;

    // Richtung bestimmen (previousPath ist der alte Pfad vor der Navigation)
    const direction = getDirection(previousPath, route.path);
    const outClass  = direction === 'right' ? 'page-transition--out-left' : 'page-transition--out-right';
    const inClass   = direction === 'right' ? 'page-transition--in-right' : 'page-transition--in-left';

    // Alte Seite kurz ausfaden, falls vorhanden
    const oldPage = content.querySelector('.page-transition');
    if (oldPage) {
      oldPage.classList.add(outClass);
      await new Promise(r => setTimeout(r, 120));
    }

    // Seiten-Wrapper bereits jetzt in den DOM einfügen, damit
    // document.getElementById() in render() die richtigen Elemente findet.
    const pageWrapper = document.createElement('div');
    pageWrapper.className = `page-transition ${inClass}`;
    content.replaceChildren(pageWrapper);

    await module.render(pageWrapper, { user: currentUser });

  } catch (err) {
    console.error('[Router] Seiten-Render-Fehler:', err);
    renderError(app, err);
  }
}

/**
 * App-Shell mit Navigation einmalig aufbauen (nach erstem Login).
 */
function renderAppShell(container) {
  container.innerHTML = `
    <a href="#page-content" class="sr-only">Zum Inhalt springen</a>
    <nav class="nav-sidebar" aria-label="Hauptnavigation">
      <div class="nav-sidebar__logo"><span>Oikos</span></div>
      <div class="nav-sidebar__items" role="list">
        ${navItems().map(navItemHtml).join('')}
      </div>
    </nav>

    <main class="app-content" id="page-content" aria-live="polite">
    </main>

    <nav class="nav-bottom" aria-label="Navigation">
      <div class="nav-bottom__dots" aria-hidden="true">
        <span class="nav-bottom__dot nav-bottom__dot--active"></span>
        <span class="nav-bottom__dot"></span>
      </div>
      <div class="nav-bottom__scroll">
        <div class="nav-bottom__page" role="list">
          ${navItems().slice(0, 5).map(navItemHtml).join('')}
        </div>
        <div class="nav-bottom__page" role="list">
          ${navItems().slice(5).map(navItemHtml).join('')}
        </div>
      </div>
    </nav>

    <div class="toast-container" id="toast-container" aria-live="assertive"></div>
  `;

  // Klick-Handler für alle Nav-Links
  container.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.route);
    });
  });

  // Bottom-Nav: Scroll-Snap + Dot-Indikator
  initBottomNavSwipe(container);
}

/**
 * Initialisiert Swipe-Gesten und Dot-Indikator für die mobile Bottom-Navigation.
 */
function initBottomNavSwipe(container) {
  const scroll = container.querySelector('.nav-bottom__scroll');
  const dots   = container.querySelectorAll('.nav-bottom__dot');
  if (!scroll || !dots.length) return;

  // Scroll-Event: Dot-Indikator aktualisieren
  scroll.addEventListener('scroll', () => {
    const page = Math.round(scroll.scrollLeft / scroll.offsetWidth);
    dots.forEach((d, i) => d.classList.toggle('nav-bottom__dot--active', i === page));
  }, { passive: true });
}

/**
 * Scrollt die Bottom-Nav zur richtigen Seite, wenn ein Item auf Seite 2 aktiv ist.
 */
function scrollNavToActive() {
  const scroll = document.querySelector('.nav-bottom__scroll');
  if (!scroll) return;
  const secondPage = navItems().slice(5).map(n => n.path);
  if (secondPage.includes(currentPath)) {
    scroll.scrollTo({ left: scroll.offsetWidth, behavior: 'smooth' });
  }
}

function navItems() {
  return [
    { path: '/',         label: 'Übersicht',   icon: 'layout-dashboard' },
    { path: '/tasks',    label: 'Aufgaben',    icon: 'check-square'     },
    { path: '/calendar', label: 'Kalender',    icon: 'calendar'         },
    { path: '/meals',    label: 'Essen',        icon: 'utensils'         },
    { path: '/shopping', label: 'Einkauf',     icon: 'shopping-cart'    },
    { path: '/notes',    label: 'Pinnwand',    icon: 'sticky-note'      },
    { path: '/contacts', label: 'Kontakte',    icon: 'book-user'        },
    { path: '/budget',   label: 'Budget',      icon: 'wallet'           },
    { path: '/settings', label: 'Einstellungen', icon: 'settings'       },
  ];
}

function navItemHtml({ path, label, icon }) {
  return `
    <a href="${path}" data-route="${path}" class="nav-item" role="listitem" aria-label="${label}">
      <i data-lucide="${icon}" class="nav-item__icon" aria-hidden="true"></i>
      <span class="nav-item__label">${label}</span>
    </a>
  `;
}

/**
 * Aktiven Nav-Link hervorheben.
 */
function updateNav(path) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.removeAttribute('aria-current');
    if (el.dataset.route === path) {
      el.setAttribute('aria-current', 'page');
    }
  });

  // Lucide Icons neu rendern (nach DOM-Update)
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Bottom-Nav zur aktiven Seite scrollen
  scrollNavToActive();
}

function renderError(container, err) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__title">Etwas ist schiefgelaufen.</div>
      <div class="empty-state__description">${err.message}</div>
      <button class="btn btn--primary" id="error-reload-btn">Neu laden</button>
    </div>
  `;
  container.querySelector('#error-reload-btn')?.addEventListener('click', () => location.reload());
}

// --------------------------------------------------------
// Toast-Benachrichtigungen (global)
// --------------------------------------------------------

/**
 * Zeigt eine Toast-Benachrichtigung an.
 * @param {string} message
 * @param {'default'|'success'|'danger'|'warning'} type
 * @param {number} duration - ms
 */
function showToast(message, type = 'default', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'default' ? `toast--${type}` : ''}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// --------------------------------------------------------
// Event-Listener
// --------------------------------------------------------

// --------------------------------------------------------
// Globale Fehler-Handler (Error Boundary)
// --------------------------------------------------------

window.addEventListener('error', (e) => {
  // Ressource-Ladefehler (z.B. fehlgeschlagenes Bild): ignorieren
  if (e.target && e.target !== window) return;
  console.error('[Oikos] Unbehandelter Fehler:', e.error ?? e.message);
  showToast('Ein unerwarteter Fehler ist aufgetreten.', 'danger');
});

window.addEventListener('unhandledrejection', (e) => {
  // Auth-Fehler werden bereits von auth:expired behandelt
  if (e.reason?.status === 401) return;
  console.error('[Oikos] Unbehandeltes Promise-Rejection:', e.reason);
  const msg = e.reason?.message || 'Ein Fehler ist aufgetreten.';
  showToast(msg, 'danger');
  e.preventDefault(); // Konsolenfehler unterdrücken (bereits geloggt)
});

// SW-Update: neue Version im Hintergrund installiert → Toast anzeigen
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') {
      // Modul-Cache leeren damit nächste Navigation frische Module lädt
      moduleCache.clear();
      showToast(
        'Update verfügbar — Seite neu laden für die neueste Version.',
        'default',
        8000
      );
    }
  });
}

// Browser zurück/vor
window.addEventListener('popstate', (e) => {
  navigate(e.state?.path || location.pathname, false);
});

// Session abgelaufen
window.addEventListener('auth:expired', () => {
  currentUser = null;
  navigate('/login');
});

// --------------------------------------------------------
// Initialisierung
// --------------------------------------------------------
navigate(location.pathname, false);

// Globale Exporte
window.oikos = {
  navigate,
  showToast,
  setThemeColor,
  restoreThemeColor: () => {
    const route = ROUTES.find((r) => r.path === currentPath);
    updateThemeColorForRoute(route);
  },
};
