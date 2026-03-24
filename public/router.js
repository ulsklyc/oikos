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
 * @param {boolean} pushState - false beim initialen Load und popstate
 */
async function navigate(path, pushState = true) {
  if (path === currentPath) return;
  currentPath = path;

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES.find((r) => r.path === '/');

  // Auth-Guard
  if (route.requiresAuth && !currentUser) {
    try {
      const result = await auth.me();
      currentUser = result.user;
    } catch {
      navigateTo('/login', true);
      return;
    }
  }

  if (!route.requiresAuth && currentUser && path === '/login') {
    navigateTo('/', true);
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
    const module = await import(route.page + '?v=1');

    if (typeof module.render !== 'function') {
      throw new Error(`Seite ${route.page} exportiert keine render()-Funktion.`);
    }

    // Seiten-Wrapper erstellen
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-transition';
    pageWrapper.style.animation = 'page-in 0.2s ease forwards';

    await module.render(pageWrapper, { user: currentUser });

    // Nav + Content einmalig aufbauen (beim ersten Render)
    if (!document.querySelector('.nav-bottom') && currentUser) {
      renderAppShell(app);
    }

    const content = document.getElementById('page-content') || app;
    content.replaceChildren(pageWrapper);

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
      <div class="nav-sidebar__logo">Oikos</div>
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
      <button class="btn btn--primary" onclick="location.reload()">Neu laden</button>
    </div>
  `;
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
  setTimeout(() => toast.remove(), duration);
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
