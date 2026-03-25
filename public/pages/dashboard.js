/**
 * Modul: Dashboard
 * Zweck: Startseite mit Begrüßung, Terminen, Aufgaben, Essen, Notizen und FAB
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function greeting(displayName) {
  const h = new Date().getHours();
  const tageszeit = h < 12 ? 'Morgen' : h < 18 ? 'Tag' : 'Abend';
  return `Guten ${tageszeit}, ${displayName}`;
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString('de-DE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dateStr = d.toDateString() === today.toDateString()
    ? 'Heute'
    : d.toDateString() === tomorrow.toDateString()
    ? 'Morgen'
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

  const timeStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr} Uhr`;
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const now = new Date();
  const diffMs = due - now;
  const diffH = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) return { text: 'Überfällig', overdue: true };
  if (diffH < 24) return { text: 'Heute fällig', overdue: false };
  if (diffH < 48) return { text: 'Morgen fällig', overdue: false };
  return {
    text: due.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
    overdue: false,
  };
}

const MEAL_LABELS = {
  breakfast: 'Frühstück',
  lunch:     'Mittagessen',
  dinner:    'Abendessen',
  snack:     'Snack',
};

const MEAL_ICONS = {
  breakfast: 'sunrise',
  lunch:     'sun',
  dinner:    'moon',
  snack:     'apple',
};

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function widgetHeader(icon, title, count, linkHref, linkLabel = 'Alle') {
  const badge = count != null
    ? `<span class="widget__badge">${count}</span>`
    : '';
  return `
    <div class="widget__header">
      <span class="widget__title">
        <i data-lucide="${icon}" class="widget__title-icon" aria-hidden="true"></i>
        ${title}
        ${badge}
      </span>
      <a href="${linkHref}" data-route="${linkHref}" class="widget__link">
        ${linkLabel}
      </a>
    </div>
  `;
}

// --------------------------------------------------------
// Skeleton
// --------------------------------------------------------

function skeletonWidget(lines = 3) {
  const lineHtml = Array.from({ length: lines }, (_, i) => `
    <div class="skeleton skeleton-line ${i % 2 === 0 ? 'skeleton-line--full' : 'skeleton-line--medium'}"></div>
  `).join('');
  return `
    <div class="widget-skeleton">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      ${lineHtml}
    </div>
  `;
}

// --------------------------------------------------------
// Widget-Renderer
// --------------------------------------------------------

function renderGreeting(user, stats = {}) {
  const { urgentCount = 0, todayEventCount = 0, todayMealTitle = null } = stats;

  const chipIcon = 'width:12px;height:12px;flex-shrink:0;';
  const statChips = [];
  if (urgentCount > 0)
    statChips.push(`<span class="greeting-chip greeting-chip--warn">
      <i data-lucide="alert-circle" style="${chipIcon}"></i>
      ${urgentCount} dring. Aufgabe${urgentCount > 1 ? 'n' : ''}
    </span>`);
  if (todayEventCount > 0)
    statChips.push(`<span class="greeting-chip">
      <i data-lucide="calendar" style="${chipIcon}"></i>
      ${todayEventCount} Termin${todayEventCount > 1 ? 'e' : ''} heute
    </span>`);
  if (todayMealTitle)
    statChips.push(`<span class="greeting-chip">
      <i data-lucide="utensils" style="${chipIcon}"></i>
      Heute: ${todayMealTitle}
    </span>`);

  return `
    <div class="widget-greeting">
      <div class="widget-greeting__content">
        <div class="widget-greeting__title">${greeting(user.display_name)}</div>
        <div class="widget-greeting__date">${formatDate()}</div>
        ${statChips.length ? `<div class="widget-greeting__chips">${statChips.join('')}</div>` : ''}
      </div>
    </div>
  `;
}

function renderUrgentTasks(tasks) {
  if (!tasks.length) {
    return `<div class="widget">
      ${widgetHeader('check-square', 'Aufgaben', 0, '/tasks')}
      <div class="widget__empty">
        <i data-lucide="check-circle" class="empty-state__icon" style="color:var(--color-success)"></i>
        <div>Alles erledigt</div>
      </div>
    </div>`;
  }

  const items = tasks.map((t) => {
    const due = formatDueDate(t.due_date);
    return `
      <div class="task-item" data-route="/tasks" role="button" tabindex="0">
        <div class="task-item__priority task-item__priority--${t.priority}"></div>
        <div class="task-item__content">
          <div class="task-item__title">${t.title}</div>
          ${due ? `<div class="task-item__meta ${due.overdue ? 'task-item__meta--overdue' : ''}">${due.text}</div>` : ''}
        </div>
        ${t.assigned_color ? `
          <div class="task-item__avatar" style="background-color:${t.assigned_color}"
               title="${t.assigned_name || ''}">${initials(t.assigned_name || '')}</div>` : ''}
      </div>
    `;
  }).join('');

  return `<div class="widget">
    ${widgetHeader('check-square', 'Aufgaben', tasks.length, '/tasks')}
    <div class="widget__body">${items}</div>
  </div>`;
}

function renderUpcomingEvents(events) {
  if (!events.length) {
    return `<div class="widget">
      ${widgetHeader('calendar', 'Termine', 0, '/calendar')}
      <div class="widget__empty">
        <i data-lucide="calendar-check" class="empty-state__icon"></i>
        <div>Keine Termine</div>
      </div>
    </div>`;
  }

  const today = new Date().toDateString();
  const items = events.map((e) => {
    const d = new Date(e.start_datetime);
    const isToday = d.toDateString() === today;
    const timeStr = e.all_day ? 'Ganztägig' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
    return `
      <div class="event-item" data-route="/calendar" role="button" tabindex="0">
        <div class="event-item__bar" style="background-color:${e.color || 'var(--color-accent)'}"></div>
        <div class="event-item__content">
          <div class="event-item__title">${e.title}</div>
          <div class="event-item__time">
            <span class="event-time-badge ${isToday ? 'event-time-badge--today' : ''}">${isToday ? 'Heute' : formatDateTime(e.start_datetime).split(',')[0]}</span>
            ${timeStr}
            ${e.location ? ` · ${e.location}` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `<div class="widget">
    ${widgetHeader('calendar', 'Termine', events.length, '/calendar')}
    <div class="widget__body">${items}</div>
  </div>`;
}

function renderTodayMeals(meals) {
  const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

  const slots = MEAL_ORDER.map((type) => {
    const meal = meals.find((m) => m.meal_type === type);
    return `
      <div class="meal-slot ${meal ? 'meal-slot--filled' : ''}" data-route="/meals" role="button" tabindex="0">
        <i data-lucide="${MEAL_ICONS[type]}" class="meal-slot__icon" aria-hidden="true"></i>
        <div class="meal-slot__type">${MEAL_LABELS[type]}</div>
        <div class="meal-slot__title">${meal ? meal.title : '—'}</div>
      </div>
    `;
  }).join('');

  return `<div class="widget widget--meals">
    ${widgetHeader('utensils', 'Heute essen', null, '/meals', 'Woche')}
    <div class="meal-slots">${slots}</div>
  </div>`;
}

function renderPinnedNotes(notes) {
  if (!notes.length) {
    return `<div class="widget">
      ${widgetHeader('pin', 'Pinnwand', 0, '/notes')}
      <div class="widget__empty">
        <i data-lucide="sticky-note" class="empty-state__icon"></i>
        <div>Keine angepinnten Notizen</div>
      </div>
    </div>`;
  }

  const items = notes.map((n) => `
    <div class="note-item" data-route="/notes" role="button" tabindex="0"
         style="--note-color:${n.color};">
      ${n.title ? `<div class="note-item__title">${n.title}</div>` : ''}
      <div class="note-item__content">${n.content}</div>
    </div>
  `).join('');

  return `<div class="widget widget--wide">
    ${widgetHeader('pin', 'Pinnwand', notes.length, '/notes')}
    <div class="notes-grid-widget">${items}</div>
  </div>`;
}

// --------------------------------------------------------
// Wetter-Widget
// --------------------------------------------------------

const WEATHER_ICON_BASE = 'https://openweathermap.org/img/wn/';

function renderWeatherWidget(weather) {
  if (!weather) return '';

  const { city, current, forecast } = weather;

  const forecastHtml = forecast.map((d) => {
    const date = new Date(d.date + 'T12:00:00');
    const label = date.toLocaleDateString('de-DE', { weekday: 'short' });
    return `
      <div class="weather-forecast__day">
        <div class="weather-forecast__label">${label}</div>
        <img class="weather-forecast__icon" src="${WEATHER_ICON_BASE}${d.icon}@2x.png"
             alt="${d.desc}" width="32" height="32" loading="lazy">
        <div class="weather-forecast__temps">
          <span class="weather-forecast__high">${d.temp_max}°</span>
          <span class="weather-forecast__low">${d.temp_min}°</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="widget weather-widget">
      <div class="weather-widget__main">
        <div class="weather-widget__left">
          <div class="weather-widget__temp">${current.temp}°C</div>
          <div class="weather-widget__desc">${current.desc}</div>
          <div class="weather-widget__city">${city}</div>
          <div class="weather-widget__meta">
            Gefühlt ${current.feels_like}° · ${current.humidity}% · Wind ${current.wind_speed} km/h
          </div>
        </div>
        <img class="weather-widget__icon" src="${WEATHER_ICON_BASE}${current.icon}@2x.png"
             alt="${current.desc}" width="80" height="80" loading="lazy">
      </div>
      ${forecast.length ? `<div class="weather-forecast">${forecastHtml}</div>` : ''}
    </div>`;
}

// --------------------------------------------------------
// FAB Speed-Dial
// --------------------------------------------------------

const FAB_ACTIONS = [
  { route: '/tasks',    label: 'Aufgabe',  icon: 'check-square'   },
  { route: '/calendar', label: 'Termin',   icon: 'calendar-plus'  },
  { route: '/shopping', label: 'Einkauf',  icon: 'shopping-cart'  },
  { route: '/notes',    label: 'Notiz',    icon: 'sticky-note'    },
];

function renderFab() {
  const actionsHtml = FAB_ACTIONS.map((a) => `
    <div class="fab-action" data-route="${a.route}" role="button" tabindex="-1"
         aria-label="${a.label} hinzufügen">
      <span class="fab-action__label">${a.label}</span>
      <button class="fab-action__btn" tabindex="-1" aria-hidden="true">
        <i data-lucide="${a.icon}" aria-hidden="true"></i>
      </button>
    </div>
  `).join('');

  return `
    <div class="fab-container" id="fab-container">
      <button class="fab-main" id="fab-main" aria-label="Schnellaktionen" aria-expanded="false">
        <i data-lucide="plus" aria-hidden="true"></i>
      </button>
      <div class="fab-actions" id="fab-actions" aria-hidden="true">
        ${actionsHtml}
      </div>
    </div>
  `;
}

function initFab(container) {
  const fabMain    = container.querySelector('#fab-main');
  const fabActions = container.querySelector('#fab-actions');
  if (!fabMain) return;

  let open = false;

  function toggleFab(force) {
    open = force !== undefined ? force : !open;
    fabMain.classList.toggle('fab-main--open', open);
    fabMain.setAttribute('aria-expanded', String(open));
    fabActions.classList.toggle('fab-actions--visible', open);
    fabActions.setAttribute('aria-hidden', String(!open));
    fabActions.querySelectorAll('[role="button"]').forEach((el) => {
      el.tabIndex = open ? 0 : -1;
    });
    if (window.lucide) window.lucide.createIcons();
  }

  fabMain.addEventListener('click', (e) => { e.stopPropagation(); toggleFab(); });

  fabActions.querySelectorAll('[data-route]').forEach((el) => {
    const go = () => { toggleFab(false); window.oikos.navigate(el.dataset.route); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  document.addEventListener('click', () => { if (open) toggleFab(false); });
}

// --------------------------------------------------------
// Navigations-Links verdrahten
// --------------------------------------------------------

function wireLinks(container) {
  container.querySelectorAll('[data-route]').forEach((el) => {
    if (el.id === 'fab-main' || el.closest('#fab-actions')) return;
    const go = () => window.oikos.navigate(el.dataset.route);
    if (el.tagName === 'A') {
      el.addEventListener('click', (e) => { e.preventDefault(); go(); });
    } else {
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    }
  });
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  container.innerHTML = `
    <div class="dashboard">
      <div class="dashboard__grid">
        <div class="widget-greeting" style="grid-column:1/-1">
          <div class="widget-greeting__content">
            <div class="widget-greeting__title">${greeting(user.display_name)}</div>
            <div class="widget-greeting__date">${formatDate()}</div>
          </div>
        </div>
        ${skeletonWidget(3)}
        ${skeletonWidget(3)}
        ${skeletonWidget(2)}
        ${skeletonWidget(3)}
      </div>
    </div>
    ${renderFab()}
  `;
  initFab(container);

  let data    = { upcomingEvents: [], urgentTasks: [], todayMeals: [], pinnedNotes: [] };
  let weather = null;
  try {
    const [dashRes, weatherRes] = await Promise.all([
      api.get('/dashboard'),
      api.get('/weather').catch(() => ({ data: null })),
    ]);
    data    = dashRes;
    weather = weatherRes.data ?? null;
  } catch (err) {
    console.error('[Dashboard] Ladefehler:', err.message);
    window.oikos?.showToast('Dashboard konnte nicht vollständig geladen werden.', 'warning');
  }

  const today = new Date().toDateString();
  const stats = {
    urgentCount:     data.urgentTasks?.length ?? 0,
    todayEventCount: (data.upcomingEvents ?? []).filter((e) =>
      new Date(e.start_datetime).toDateString() === today
    ).length,
    todayMealTitle: (data.todayMeals ?? []).find((m) => m.meal_type === 'lunch')?.title
      ?? (data.todayMeals ?? [])[0]?.title
      ?? null,
  };

  container.innerHTML = `
    <div class="dashboard">
      <div class="dashboard__grid">
        ${renderGreeting(user, stats)}
        ${renderWeatherWidget(weather)}
        ${renderUrgentTasks(data.urgentTasks ?? [])}
        ${renderUpcomingEvents(data.upcomingEvents ?? [])}
        ${renderTodayMeals(data.todayMeals ?? [])}
        ${renderPinnedNotes(data.pinnedNotes ?? [])}
      </div>
    </div>
    ${renderFab()}
  `;

  wireLinks(container);
  initFab(container);
  if (window.lucide) window.lucide.createIcons();
}
