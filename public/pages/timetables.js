import { api, auth } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { todayKey, startOfLocalWeekKey, addLocalDays } from '/utils/date.js';
import { openModal, closeModal, confirmModal } from '/components/modal.js';
import { createPageFab, setPageFabAction } from '/utils/fab.js';
import { emptyStateHTML } from '/utils/empty-state.js';
import { renderPageHeader, renderPageTitle, renderPageBody } from '/utils/page-layout.js';

let root = null;
let pageFab = null;
let currentUserId = null;
let isAdmin = false;

let state = {
  users: [],
  selectedUserId: null,
  entries: [],
  holidays: [], // Current week's holidays & school holidays
  settings: {
    active_week: 'all',
    view_mode: 'week',
    show_weekends: 0,
    show_school_holidays: 1,
  },
  selectedDay: null, // 1..7
  weekFilter: 'all', // 'all', 'A', 'B'
};

const COLOR_PRESETS = Object.freeze([
  '#0E7490', // Cyan
  '#2563EB', // Blue
  '#7C3AED', // Violet
  '#C026D3', // Fuchsia
  '#DB2777', // Pink
  '#DC2626', // Red
  '#EA580C', // Orange
  '#D97706', // Amber
  '#16A34A', // Green
  '#059669', // Emerald
  '#475569', // Slate
]);

const DAY_NAMES = [
  { day: 1, key: 'timetables.monday', shortKey: 'timetables.mon' },
  { day: 2, key: 'timetables.tuesday', shortKey: 'timetables.tue' },
  { day: 3, key: 'timetables.wednesday', shortKey: 'timetables.wed' },
  { day: 4, key: 'timetables.thursday', shortKey: 'timetables.thu' },
  { day: 5, key: 'timetables.friday', shortKey: 'timetables.fri' },
  { day: 6, key: 'timetables.saturday', shortKey: 'timetables.sat' },
  { day: 7, key: 'timetables.sunday', shortKey: 'timetables.sun' },
];

function getTodayIsoDay() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function userName(id) {
  const u = state.users.find((user) => Number(user.id) === Number(id));
  return u ? (u.display_name || u.username) : String(id);
}

function canEditUser(targetUserId) {
  return isAdmin || Number(targetUserId) === Number(currentUserId);
}

async function loadData(user) {
  if (user) {
    currentUserId = user.id;
    isAdmin = user.role === 'admin';
  } else if (!currentUserId) {
    const meRes = await auth.me().catch(() => null);
    const me = meRes?.user;
    currentUserId = me?.id ?? null;
    isAdmin = me?.role === 'admin';
  }

  const [usersRes, settingsRes] = await Promise.all([
    api.get('/auth/users'),
    api.get('/timetables/settings'),
  ]);

  state.users = usersRes.users || usersRes.data || [];
  if (!state.selectedUserId) {
    state.selectedUserId = currentUserId || state.users[0]?.id;
  }

  if (settingsRes && settingsRes.settings) {
    state.settings = { ...state.settings, ...settingsRes.settings };
    if (state.settings.active_week && state.settings.active_week !== 'all') {
      state.weekFilter = state.settings.active_week;
    }
  }

  if (!state.selectedDay) {
    state.selectedDay = getTodayIsoDay();
  }

  await loadEntries();
}

async function loadEntries() {
  const queryParams = new URLSearchParams();
  if (state.selectedUserId && state.selectedUserId !== 'all') {
    queryParams.set('user_id', String(state.selectedUserId));
  }
  if (state.weekFilter && state.weekFilter !== 'all') {
    queryParams.set('week_type', state.weekFilter);
  }

  const today = todayKey();
  const monday = startOfLocalWeekKey(today, 1);
  const sunday = addLocalDays(monday, 6);

  const [res, holRes] = await Promise.all([
    api.get(`/timetables?${queryParams.toString()}`),
    state.settings.show_school_holidays
      ? api.get(`/calendar/holidays?from=${monday}&to=${sunday}`).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ]);

  state.entries = res.data || [];
  state.holidays = holRes?.data || [];
}

function holidaysOnDay(isoDay) {
  if (!state.settings.show_school_holidays || !state.holidays?.length) return [];
  const monday = startOfLocalWeekKey(todayKey(), 1);
  const dayDate = addLocalDays(monday, isoDay - 1);
  return state.holidays.filter((h) => h.date === dayDate);
}

function renderUI() {
  if (!root) return;

  const todayIso = getTodayIsoDay();
  const daysToShow = state.settings.show_weekends ? DAY_NAMES : DAY_NAMES.slice(0, 5);

  const headerHTML = renderPageHeader({
    title: renderPageTitle(t('timetables.title')),
    actions: `
      <button type="button" class="btn btn-secondary btn-sm" id="btn-timetable-copy" title="${esc(t('timetables.copySchedule'))}">
        <i data-lucide="copy"></i> ${esc(t('timetables.copy'))}
      </button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-timetable-add">
        <i data-lucide="plus"></i> ${esc(t('timetables.addSlot'))}
      </button>
    `,
  });

  const memberOptions = `
    <option value="all" ${state.selectedUserId === 'all' ? 'selected' : ''}>
      ${esc(t('timetables.allMembers'))}
    </option>
  ` + state.users.map((u) => `
    <option value="${u.id}" ${state.selectedUserId !== 'all' && Number(u.id) === Number(state.selectedUserId) ? 'selected' : ''}>
      ${esc(u.display_name || u.username)}
    </option>
  `).join('');

  const toolbarHTML = `
    <div class="timetable-toolbar">
      <div class="timetable-controls-left">
        <label for="timetable-member" class="sr-only">${esc(t('timetables.familyMember'))}</label>
        <select id="timetable-member" class="timetable-member-select">
          ${memberOptions}
        </select>

        <label for="timetable-week-filter" class="sr-only">${esc(t('timetables.weekType'))}</label>
        <select id="timetable-week-filter" class="timetable-week-select">
          <option value="all" ${state.weekFilter === 'all' ? 'selected' : ''}>${esc(t('timetables.allWeeks'))}</option>
          <option value="A" ${state.weekFilter === 'A' ? 'selected' : ''}>${esc(t('timetables.weekA'))}</option>
          <option value="B" ${state.weekFilter === 'B' ? 'selected' : ''}>${esc(t('timetables.weekB'))}</option>
        </select>
      </div>

      <div class="timetable-controls-right">
        <div class="timetable-view-group" role="group" aria-label="${esc(t('timetables.viewMode'))}">
          <button type="button" data-view="week" class="${state.settings.view_mode === 'week' ? 'active' : ''}">
            <i data-lucide="grid"></i> ${esc(t('timetables.viewWeek'))}
          </button>
          <button type="button" data-view="day" class="${state.settings.view_mode === 'day' ? 'active' : ''}">
            <i data-lucide="calendar"></i> ${esc(t('timetables.viewDay'))}
          </button>
          <button type="button" data-view="list" class="${state.settings.view_mode === 'list' ? 'active' : ''}">
            <i data-lucide="list"></i> ${esc(t('timetables.viewList'))}
          </button>
        </div>
      </div>
    </div>
  `;

  let contentHTML = '';

  if (state.entries.length === 0) {
    contentHTML = emptyStateHTML({
      icon: 'graduation-cap',
      title: t('timetables.emptyTitle'),
      message: t('timetables.emptyMessage'),
      actionLabel: t('timetables.addFirstSlot'),
      actionId: 'btn-timetable-empty-add',
    });
  } else if (state.settings.view_mode === 'week') {
    const gridCols = daysToShow.map((d) => {
      const isToday = d.day === todayIso;
      const dayEntries = state.entries.filter((e) => e.day_of_week === d.day);
      const dayHols = holidaysOnDay(d.day);

      const holsHTML = dayHols.length > 0
        ? `<div class="timetable-holidays-list">${dayHols.map((h) => `
            <div class="timetable-holiday-chip" style="background-color: ${esc(h.color || (h.type === 'school' ? '#34C759' : '#FF3B30'))};" title="${esc(h.name)}">
              <i data-lucide="${h.type === 'school' ? 'sun' : 'flag'}" style="width:11px;height:11px;"></i>
              <span>${esc(h.name)}</span>
            </div>
          `).join('')}</div>`
        : '';

      const slotsHTML = dayEntries.length > 0
        ? dayEntries.map((e) => renderSlotCard(e)).join('')
        : `<div class="timetable-empty-day">${esc(t('timetables.noEntries'))}</div>`;

      return `
        <div class="timetable-day-col ${isToday ? 'is-today' : ''}" data-day="${d.day}">
          <div class="timetable-day-header">
            <span>${esc(t(d.key))}</span>
            ${isToday ? `<span class="today-badge">${esc(t('timetables.today'))}</span>` : ''}
          </div>
          ${holsHTML}
          <div class="timetable-slot-list">
            ${slotsHTML}
          </div>
        </div>
      `;
    }).join('');

    const gridClass = daysToShow.length === 7 ? 'days-7' : 'days-5';
    contentHTML = `<div class="timetable-grid ${gridClass}">${gridCols}</div>`;
  } else if (state.settings.view_mode === 'day') {
    const dayTabs = daysToShow.map((d) => {
      const isToday = d.day === todayIso;
      const isActive = d.day === state.selectedDay;
      const dayHols = holidaysOnDay(d.day);
      return `
        <button type="button" class="timetable-day-tab ${isActive ? 'active' : ''} ${isToday ? 'is-today' : ''}" data-day="${d.day}">
          <span>${esc(t(d.shortKey))}</span>
          ${dayHols.length > 0 ? '<span class="timetable-day-holiday-dot" title="' + esc(dayHols[0].name) + '"></span>' : ''}
        </button>
      `;
    }).join('');

    const dayEntries = state.entries.filter((e) => e.day_of_week === state.selectedDay);
    const dayName = DAY_NAMES.find((d) => d.day === state.selectedDay);
    const selectedDayHols = holidaysOnDay(state.selectedDay);

    const holsHTML = selectedDayHols.length > 0
      ? `<div class="timetable-holidays-list" style="padding: 0 var(--space-2); margin-top: var(--space-2);">${selectedDayHols.map((h) => `
          <div class="timetable-holiday-chip" style="background-color: ${esc(h.color || (h.type === 'school' ? '#34C759' : '#FF3B30'))};" title="${esc(h.name)}">
            <i data-lucide="${h.type === 'school' ? 'sun' : 'flag'}" style="width:11px;height:11px;"></i>
            <span>${esc(h.name)}</span>
          </div>
        `).join('')}</div>`
      : '';

    const slotsHTML = state.selectedUserId === 'all'
      ? renderAllMembersDayGrid(dayEntries)
      : dayEntries.length > 0
        ? dayEntries.map((e) => renderSlotCard(e, true)).join('')
        : `<div class="timetable-empty-day" style="padding: var(--space-8);">${esc(t('timetables.noEntriesForDay'))}</div>`;

    contentHTML = `
      <div class="timetable-day-view-container ${state.selectedUserId === 'all' ? 'timetable-day-view-container--all-members' : ''}">
        <div class="timetable-day-tabs">${dayTabs}</div>
        <div class="timetable-day-col is-today">
          <div class="timetable-day-header">
            <span>${esc(t(dayName?.key || 'timetables.day'))}</span>
            <span>${dayEntries.length} ${esc(t('timetables.slotsCount'))}</span>
          </div>
          ${holsHTML}
          <div class="timetable-slot-list">
            ${slotsHTML}
          </div>
        </div>
      </div>
    `;
  } else {
    // List view
    const sections = daysToShow.map((d) => {
      const dayEntries = state.entries.filter((e) => e.day_of_week === d.day);
      const dayHols = holidaysOnDay(d.day);
      if (dayEntries.length === 0 && dayHols.length === 0) return '';

      const isToday = d.day === todayIso;

      const holsHTML = dayHols.length > 0
        ? `<div class="timetable-holidays-list">${dayHols.map((h) => `
            <div class="timetable-holiday-chip" style="background-color: ${esc(h.color || (h.type === 'school' ? '#34C759' : '#FF3B30'))};" title="${esc(h.name)}">
              <i data-lucide="${h.type === 'school' ? 'sun' : 'flag'}" style="width:11px;height:11px;"></i>
              <span>${esc(h.name)}</span>
            </div>
          `).join('')}</div>`
        : '';

      return `
        <div class="timetable-list-section">
          <div class="timetable-list-section-title">
            <span>${esc(t(d.key))} ${isToday ? `(${esc(t('timetables.today'))})` : ''}</span>
            <span class="badge badge-subtle">${dayEntries.length}</span>
          </div>
          ${holsHTML}
          <div class="timetable-list-rows">
            ${dayEntries.map((e) => renderSlotCard(e, true)).join('')}
          </div>
        </div>
      `;
    }).filter(Boolean).join('');

    contentHTML = `
      <div class="timetable-list">
        ${sections || `<div class="timetable-empty-day">${esc(t('timetables.noEntries'))}</div>`}
      </div>
    `;
  }

  const bodyHTML = renderPageBody({
    content: `
      <div class="timetable-container">
        ${toolbarHTML}
        ${contentHTML}
      </div>
    `,
  });

  root.replaceChildren();
  root.insertAdjacentHTML('beforeend', headerHTML + bodyHTML);

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

  attachEvents();
}

function renderAllMembersDayGrid(dayEntries) {
  const timeSlots = [...new Set(dayEntries.map((entry) => entry.start_time))].sort();
  if (timeSlots.length === 0) {
    return `<div class="timetable-empty-day" style="padding: var(--space-8);">${esc(t('timetables.noEntriesForDay'))}</div>`;
  }

  const memberColumns = state.users.map((member) => `
    <div class="timetable-member-day-column">
      <div class="timetable-member-day-header">${esc(member.display_name || member.username)}</div>
      <div class="timetable-member-day-slots">
        ${timeSlots.map((startTime) => {
          const entries = dayEntries.filter((entry) => Number(entry.user_id) === Number(member.id) && entry.start_time === startTime);
          return `<div class="timetable-member-day-cell">
            ${entries.length > 0
              ? entries.map((entry) => renderSlotCard(entry, true)).join('')
              : `<span class="timetable-member-day-empty">&nbsp;</span>`}
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');

  return `
    <div class="timetable-member-day-grid">
      <div class="timetable-member-day-time-column">
        <div class="timetable-member-day-header">${esc(t('timetables.time'))}</div>
        <div class="timetable-member-day-times">
          ${timeSlots.map((startTime) => `<div class="timetable-member-day-time">${esc(startTime)}</div>`).join('')}
        </div>
      </div>
      ${memberColumns}
    </div>
  `;
}

function renderSlotCard(entry, detailed = false) {
  const cardColor = entry.color || 'var(--module-timetables)';
  const periodLabel = entry.period_number ? `${entry.period_number}.` : '';
  const weekBadge = entry.week_type && entry.week_type !== 'all'
    ? `<span class="timetable-slot-tag">${esc(entry.week_type === 'A' ? t('timetables.weekA') : t('timetables.weekB'))}</span>`
    : '';
  const categoryBadge = entry.category && entry.category !== 'school'
    ? `<span class="timetable-slot-tag">${esc(t(`timetables.cat_${entry.category}`))}</span>`
    : '';
  const memberBadge = state.selectedUserId === 'all'
    ? `<span class="timetable-slot-tag timetable-slot-member"><i data-lucide="user" style="width:11px;height:11px;"></i> ${esc(userName(entry.user_id))}</span>`
    : '';

  return `
    <div class="timetable-slot-card" data-id="${entry.id}" style="border-left-color: ${esc(cardColor)};">
      <div class="timetable-slot-time">
        <span>${periodLabel ? `<strong>${esc(periodLabel)}</strong> ` : ''}${esc(entry.start_time)}–${esc(entry.end_time)}</span>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          ${memberBadge}
          ${weekBadge}
          ${categoryBadge}
        </div>
      </div>
      <div class="timetable-slot-subject">${esc(entry.subject)}</div>
      ${entry.room || entry.instructor || (detailed && entry.notes) ? `
        <div class="timetable-slot-meta">
          ${entry.room ? `<span><i data-lucide="map-pin" style="width:12px;height:12px;"></i> ${esc(entry.room)}</span>` : ''}
          ${entry.instructor ? `<span><i data-lucide="user" style="width:12px;height:12px;"></i> ${esc(entry.instructor)}</span>` : ''}
        </div>
      ` : ''}
      ${detailed && entry.notes ? `
        <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px;">
          ${esc(entry.notes)}
        </div>
      ` : ''}
    </div>
  `;
}

function attachEvents() {
  if (!root) return;

  // Member select
  const memberSelect = root.querySelector('#timetable-member');
  memberSelect?.addEventListener('change', async (e) => {
    state.selectedUserId = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
    await loadEntries();
    renderUI();
  });

  // Week filter
  const weekFilter = root.querySelector('#timetable-week-filter');
  weekFilter?.addEventListener('change', async (e) => {
    state.weekFilter = e.target.value;
    await loadEntries();
    renderUI();
  });

  // View mode buttons
  root.querySelectorAll('.timetable-view-group button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const view = btn.dataset.view;
      if (view && view !== state.settings.view_mode) {
        state.settings.view_mode = view;
        renderUI();
        if (state.selectedUserId && state.selectedUserId !== 'all') {
          await api.put('/timetables/settings', {
            user_id: state.selectedUserId,
            view_mode: view,
            active_week: state.settings.active_week,
            show_weekends: state.settings.show_weekends,
            show_school_holidays: state.settings.show_school_holidays,
          });
        }
      }
    });
  });

  // Day tabs in Day View
  root.querySelectorAll('.timetable-day-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const day = parseInt(tab.dataset.day, 10);
      if (day) {
        state.selectedDay = day;
        renderUI();
      }
    });
  });

  // Add slot button
  const addBtn = root.querySelector('#btn-timetable-add');
  addBtn?.addEventListener('click', () => openSlotModal());

  const emptyAddBtn = root.querySelector('#btn-timetable-empty-add');
  emptyAddBtn?.addEventListener('click', () => openSlotModal());

  // Copy schedule button
  const copyBtn = root.querySelector('#btn-timetable-copy');
  copyBtn?.addEventListener('click', () => openCopyModal());

  // Card click to edit
  root.querySelectorAll('.timetable-slot-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.id, 10);
      const entry = state.entries.find((e) => e.id === id);
      if (entry) {
        openSlotModal(entry);
      }
    });
  });

  // FAB
  if (pageFab) {
    setPageFabAction(pageFab, {
      icon: 'plus',
      label: t('timetables.addSlot'),
      onClick: () => openSlotModal(),
    });
  }
}

function openSlotModal(entry = null) {
  const isEditing = !!entry;
  const initialDay = entry ? entry.day_of_week : (state.selectedDay || 1);
  const initialUser = entry ? entry.user_id : (state.selectedUserId !== 'all' && state.selectedUserId ? state.selectedUserId : currentUserId);
  const initialColor = entry ? entry.color : COLOR_PRESETS[0];

  const userOptions = state.users.map((u) => `
    <option value="${u.id}" ${Number(u.id) === Number(initialUser) ? 'selected' : ''}>
      ${esc(u.display_name || u.username)}
    </option>
  `).join('');

  const dayOptions = DAY_NAMES.map((d) => `
    <option value="${d.day}" ${d.day === initialDay ? 'selected' : ''}>
      ${esc(t(d.key))}
    </option>
  `).join('');

  const colorChips = COLOR_PRESETS.map((c) => `
    <div class="timetable-color-chip ${c === initialColor ? 'selected' : ''}" data-color="${c}" style="background-color: ${c};"></div>
  `).join('');

  const content = `
    <form id="form-timetable-slot" class="form-stack">
      <div class="form-field">
        <label for="slot-user" class="label">${esc(t('timetables.familyMember'))}</label>
        <select id="slot-user" name="user_id" class="input" required>
          ${userOptions}
        </select>
      </div>

      <div class="form-field">
        <label for="slot-subject" class="label">${esc(t('timetables.subjectTitle'))}</label>
        <input type="text" id="slot-subject" name="subject" class="input" value="${esc(entry?.subject || '')}" required placeholder="${esc(t('timetables.subjectPlaceholder'))}" />
      </div>

      <div class="modal-grid modal-grid--2">
        <div class="form-field">
          <label for="slot-day" class="label">${esc(t('timetables.dayOfWeek'))}</label>
          <select id="slot-day" name="day_of_week" class="input" required>
            ${dayOptions}
          </select>
        </div>
        <div class="form-field">
          <label for="slot-category" class="label">${esc(t('timetables.category'))}</label>
          <select id="slot-category" name="category" class="input">
            <option value="school" ${entry?.category === 'school' ? 'selected' : ''}>${esc(t('timetables.cat_school'))}</option>
            <option value="work" ${entry?.category === 'work' ? 'selected' : ''}>${esc(t('timetables.cat_work'))}</option>
            <option value="activity" ${entry?.category === 'activity' ? 'selected' : ''}>${esc(t('timetables.cat_activity'))}</option>
            <option value="other" ${entry?.category === 'other' ? 'selected' : ''}>${esc(t('timetables.cat_other'))}</option>
          </select>
        </div>
      </div>

      <div class="modal-grid modal-grid--2" style="grid-template-columns: 1fr 1fr 1fr;">
        <div class="form-field">
          <label for="slot-start" class="label">${esc(t('timetables.startTime'))}</label>
          <input type="time" id="slot-start" name="start_time" class="input" value="${esc(entry?.start_time || '08:00')}" required />
        </div>
        <div class="form-field">
          <label for="slot-end" class="label">${esc(t('timetables.endTime'))}</label>
          <input type="time" id="slot-end" name="end_time" class="input" value="${esc(entry?.end_time || '09:30')}" required />
        </div>
        <div class="form-field">
          <label for="slot-period" class="label">${esc(t('timetables.periodNumber'))}</label>
          <input type="number" id="slot-period" name="period_number" class="input" min="1" max="30" value="${entry?.period_number != null ? entry.period_number : ''}" placeholder="${esc(t('timetables.optional'))}" />
        </div>
      </div>

      <div class="modal-grid modal-grid--2">
        <div class="form-field">
          <label for="slot-room" class="label">${esc(t('timetables.roomLocation'))}</label>
          <input type="text" id="slot-room" name="room" class="input" value="${esc(entry?.room || '')}" placeholder="${esc(t('timetables.roomPlaceholder'))}" />
        </div>
        <div class="form-field">
          <label for="slot-instructor" class="label">${esc(t('timetables.instructor'))}</label>
          <input type="text" id="slot-instructor" name="instructor" class="input" value="${esc(entry?.instructor || '')}" placeholder="${esc(t('timetables.instructorPlaceholder'))}" />
        </div>
      </div>

      <div class="form-field">
        <label for="slot-week-type" class="label">${esc(t('timetables.weekRecurrence'))}</label>
        <select id="slot-week-type" name="week_type" class="input">
          <option value="all" ${entry?.week_type === 'all' || !entry ? 'selected' : ''}>${esc(t('timetables.allWeeks'))}</option>
          <option value="A" ${entry?.week_type === 'A' ? 'selected' : ''}>${esc(t('timetables.weekAOnly'))}</option>
          <option value="B" ${entry?.week_type === 'B' ? 'selected' : ''}>${esc(t('timetables.weekBOnly'))}</option>
        </select>
      </div>

      <div class="form-field">
        <span class="label">${esc(t('timetables.color'))}</span>
        <input type="hidden" id="slot-color" name="color" value="${esc(initialColor || COLOR_PRESETS[0])}" />
        <div class="timetable-color-presets">
          ${colorChips}
        </div>
      </div>

      <div class="form-field">
        <label for="slot-notes" class="label">${esc(t('timetables.notes'))}</label>
        <textarea id="slot-notes" name="notes" class="input" rows="2" placeholder="${esc(t('timetables.notesPlaceholder'))}">${esc(entry?.notes || '')}</textarea>
      </div>

      <div class="modal-panel__footer" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div>
          ${isEditing ? `
            <button type="button" class="btn btn-danger btn-sm" id="btn-slot-delete">
              <i data-lucide="trash-2"></i> ${esc(t('common.delete'))}
            </button>
          ` : ''}
        </div>
        <div style="display: flex; gap: var(--space-2);">
          <button type="button" class="btn btn-secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(isEditing ? t('common.save') : t('common.add'))}</button>
        </div>
      </div>
    </form>
  `;

  openModal({
    title: isEditing ? t('timetables.editSlot') : t('timetables.addSlot'),
    size: 'md',
    content,
    onSave: (panel) => {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ el: panel });
      }

      const form = panel.querySelector('#form-timetable-slot');
      const colorInput = panel.querySelector('#slot-color');
      const chips = panel.querySelectorAll('.timetable-color-chip');

      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          chips.forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
          colorInput.value = chip.dataset.color;
        });
      });

      panel.querySelector('#btn-slot-delete')?.addEventListener('click', async () => {
        const confirmed = await confirmModal({
          title: t('timetables.deleteConfirmTitle'),
          message: t('timetables.deleteConfirmMessage', { subject: entry.subject }),
          confirmLabel: t('common.delete'),
          danger: true,
        });

        if (confirmed) {
          try {
            await api.delete(`/timetables/${entry.id}`);
            await closeModal({ force: true });
            await loadEntries();
            renderUI();
            window.yuvomi?.showToast(t('common.deleted') || 'Deleted', 'success');
          } catch (err) {
            window.yuvomi?.showToast(err.message || t('common.errorGeneric'), 'danger');
          }
        }
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const payload = {
          user_id: parseInt(formData.get('user_id'), 10),
          day_of_week: parseInt(formData.get('day_of_week'), 10),
          subject: formData.get('subject')?.trim(),
          category: formData.get('category') || 'school',
          start_time: formData.get('start_time'),
          end_time: formData.get('end_time'),
          period_number: formData.get('period_number') ? parseInt(formData.get('period_number'), 10) : null,
          room: formData.get('room')?.trim() || null,
          instructor: formData.get('instructor')?.trim() || null,
          week_type: formData.get('week_type') || 'all',
          color: formData.get('color') || null,
          notes: formData.get('notes')?.trim() || null,
        };

        if (payload.start_time >= payload.end_time) {
          window.yuvomi?.showToast(t('timetables.errorTimeOrder'), 'danger');
          return;
        }

        try {
          if (isEditing) {
            await api.put(`/timetables/${entry.id}`, payload);
          } else {
            await api.post('/timetables', payload);
          }

          await closeModal({ force: true });
          await loadEntries();
          renderUI();
          window.yuvomi?.showToast(t('common.saved') || 'Saved', 'success');
        } catch (err) {
          window.yuvomi?.showToast(err.message || t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

function openCopyModal() {
  const targetUser = state.selectedUserId !== 'all' && state.selectedUserId ? state.selectedUserId : currentUserId;
  const otherUsers = state.users.filter((u) => Number(u.id) !== Number(targetUser));
  if (otherUsers.length === 0) {
    alert(t('timetables.noOtherUsers'));
    return;
  }

  const fromOptions = otherUsers.map((u) => `
    <option value="${u.id}">${esc(u.display_name || u.username)}</option>
  `).join('');

  const content = `
    <form id="form-timetable-copy" class="form-stack">
      <p style="margin-bottom: var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-sm);">
        ${esc(t('timetables.copyDescription', { target: userName(targetUser) }))}
      </p>

      <div class="form-field">
        <label for="copy-from-user" class="label">${esc(t('timetables.copyFrom'))}</label>
        <select id="copy-from-user" name="from_user_id" class="input" required>
          ${fromOptions}
        </select>
      </div>

      <div class="modal-panel__footer" style="display: flex; justify-content: flex-end; gap: var(--space-2); width: 100%;">
        <button type="button" class="btn btn-secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('timetables.copyNow'))}</button>
      </div>
    </form>
  `;

  openModal({
    title: t('timetables.copySchedule'),
    size: 'md',
    content,
    onSave: (panel) => {
      const form = panel.querySelector('#form-timetable-copy');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const fromUserId = parseInt(form.querySelector('#copy-from-user').value, 10);
          await api.post('/timetables/copy', {
            from_user_id: fromUserId,
            to_user_id: targetUser,
          });

          await closeModal({ force: true });
          await loadEntries();
          renderUI();
          window.yuvomi?.showToast(t('common.saved') || 'Saved', 'success');
        } catch (err) {
          window.yuvomi?.showToast(err.message || t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

export async function render(container, { user } = {}) {
  root = container;
  currentUserId = user?.id ?? null;
  isAdmin = user?.role === 'admin';
  pageFab = createPageFab(root);
  await loadData(user);
  renderUI();
}
