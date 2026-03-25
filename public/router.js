/**
 * Modul: Client-Side Router
 * Zweck: SPA-Routing über History API ohne Framework, Auth-Guard, Seiten-Übergänge
 * Abhängigkeiten: api.js
 */

import { auth } from '/api.js';

// --------------------------------------------------------
// Routen-Definitionen
// Jede Route hat: path, page (dynamisch geladen), requiresAuth
// --------------------------------------------------------
const ROUTES = [
  { path: '/login',    page: '/pages/login.js',    requiresAuth: false },
  { path: '/',         page: '/pages/dashboard.js', requiresAuth: true  },
  { path: '/tasks',    page: '/pages/tasks.js',     requiresAuth: true  },
  { path: '/shopping', page: '/pages/shopping.js',  requiresAuth: true  },
  { path: '/meals',    page: '/pages/meals.js',     requiresAuth: true  },
  { path: '/calendar', page: '/pages/calendar.js',  requiresAuth: true  },
  { path: '/notes',    page: '/pages/notes.js',     requiresAuth: true  },
  { path: '/contacts', page: '/pages/contacts.js',  requiresAuth: true  },
  { path: '/budget',   page: '/pages/budget.js',    requiresAuth: true  },
  { path: '/settings', page: '/pages/settings.js',  requiresAuth: true  },
];

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

// --------------------------------------------------------
// Router
// --------------------------------------------------------

/**
 * Navigiert zu einem Pfad und rendert die entsprechende Seite.
 * @param {string} path
 * @param {Object|boolean} userOrPushState - Direkt ein User-Objekt nach Login,
 *   oder boolean (pushState) für interne Navigation
 * @param {boolean} pushState - false beim initialen Load und popstate
 */
async function navigate(path, userOrPushState = true, pushState = true) {
  // Überlastung: navigate(path, user) nach Login vs navigate(path, false) beim Init
  if (typeof userOrPushState === 'object' && userOrPushState !== null) {
    currentUser = userOrPushState;
  } else {
    pushState = userOrPushState;
  }

  if (path === currentPath) return;
  currentPath = path;

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES.find((r) => r.path === '/');

  // Auth-Guard
  if (route.requiresAuth && !currentUser) {
    try {
      const result = await auth.me();
      currentUser = result.user;
    } catch {
      currentPath = null; // Reset damit navigate('/login') nicht geblockt wird
      navigate('/login');
      return;
    }
  }

  if (!route.requiresAuth && currentUser && path === '/login') {
    currentPath = null;
    navigate('/');
    return;
  }

  if (pushState) {
    history.pushState({ path }, '', path);
  }

  await renderPage(route);
  updateNav(path);
}

/**
 * Lädt und rendert eine Seite dynamisch.
 * @param {{ path: string, page: string }} route
 */
async function renderPage(route) {
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

    // Alte Seite kurz ausfaden, falls vorhanden
    const oldPage = content.querySelector('.page-transition');
    if (oldPage) {
      oldPage.classList.add('page-transition--out');
      await new Promise(r => setTimeout(r, 120));
    }

    // Seiten-Wrapper bereits jetzt in den DOM einfügen, damit
    // document.getElementById() in render() die richtigen Elemente findet.
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-transition';
    pageWrapper.style.animation = 'page-in 0.2s ease forwards';
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
    <nav class="nav-sidebar" aria-label="Hauptnavigation">
      <div class="nav-sidebar__logo"><span>Oikos</span></div>
      <div class="nav-sidebar__items" role="list">
        ${navItems().map(navItemHtml).join('')}
      </div>
    </nav>

    <main class="app-content" id="page-content" aria-live="polite">
    </main>

    <nav class="nav-bottom" aria-label="Navigation">
      <div class="nav-bottom__items" role="list">
        ${navItems().slice(0, 5).map(navItemHtml).join('')}
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
window.oikos = { navigate, showToast };
