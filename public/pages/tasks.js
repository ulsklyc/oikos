/**
 * Modul: Aufgaben (Tasks)
 * Zweck: Listenansicht mit Filtern, Gruppierung, CRUD-Modal, Subtask-Verwaltung
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';
import { renderRRuleFields, bindRRuleEvents, getRRuleValues, recurrenceRow } from '/rrule-ui.js';
import { openModal as openSharedModal, closeModal, wireBlurValidation, validateAll, btnSuccess, btnError, btnLoading, promptModal, advancedSection } from '/components/modal.js';
import { openDetailView, closeDetailView, visibilityRow, assignedRow } from '/components/detail-view.js';
import { stagger, vibrate, scheduleUndoableDelete } from '/utils/ux.js';
import { t, getLocale, formatDate, formatTime, formatDateInput, parseDateInput, isDateInputValid, formatTimeInput, parseTimeInput } from '/i18n.js';
import { esc } from '/utils/html.js';
import { refresh as refreshReminders } from '/reminders.js';
import { renderUserMultiSelect, getSelectedUserIds, bindUserMultiSelect, renderAvatarStack } from '/components/user-multi-select.js';
import { resolveReminderPreset, parseRemindAtAsUtc } from '/utils/reminder-offset.js';
import { renderPageSearch, wirePageSearch } from '/utils/page-search.js';
import { isPreviewable } from '/utils/document-preview.js';
import '/components/category-manager.js';
import '/components/tag-manager.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const PRIORITIES = () => [
  { value: 'urgent', label: t('tasks.priorityUrgent'), color: 'var(--color-priority-urgent)' },
  { value: 'high',   label: t('tasks.priorityHigh'),   color: 'var(--color-priority-high)'   },
  { value: 'medium', label: t('tasks.priorityMedium'), color: 'var(--color-priority-medium)' },
  { value: 'low',    label: t('tasks.priorityLow'),    color: 'var(--color-priority-low)'    },
  { value: 'none',   label: t('tasks.priorityNone'),   color: 'var(--color-priority-none)'   },
];

const PRIO_ORDER = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

const STATUSES = () => [
  { value: 'open',        label: t('tasks.statusOpen')       },
  { value: 'in_progress', label: t('tasks.statusInProgress') },
  { value: 'done',        label: t('tasks.statusDone')       },
  { value: 'archived',    label: t('tasks.statusArchived')   },
];

// Fallback-Kategorie (kanonischer Key). Kategorien sind seit #494 benutzer-
// verwaltbar und werden aus /tasks/meta/options in state.categories geladen.
const FALLBACK_CATEGORY = 'misc';

// Label einer Kategorie auflösen: Seed-Kategorien tragen label_key (i18n),
// benutzerdefinierte tragen name. Unbekannte Keys (z. B. Due-Gruppen-Strings)
// werden unverändert zurückgegeben.
function catLabel(key) {
  const c = state.categories.find((x) => x.key === key);
  if (!c) return key;
  return c.label_key ? t(c.label_key) : (c.name || c.key);
}

const PRIORITY_LABELS = () => Object.fromEntries(PRIORITIES().map((p) => [p.value, p.label]));
const STATUS_LABELS   = () => Object.fromEntries(STATUSES().map((s)  => [s.value, s.label]));

// --------------------------------------------------------
// Verknüpfte Dokumente (#503)
// Working-Set des aktuell offenen Modals: index = id → Dokument-Metadaten,
// selected = geordnete Liste der verknüpften Dokument-IDs. Wird beim Öffnen
// des Modals in wireDocumentSection() neu aufgebaut und beim Speichern
// (handleFormSubmit) per PUT /tasks/:id/documents als Replace-Set übernommen.
let modalDocuments = { index: new Map(), selected: [] };

function docMime(doc) {
  return String(doc.mime_type || '').split(';')[0].trim().toLowerCase();
}

// Vorschaubar -> /preview (inline), sonst /download. Welche Typen das sind, steht
// einmal in utils/document-preview.js, nicht hier.
function docHref(doc) {
  return isPreviewable(doc.mime_type)
    ? `/api/v1/documents/${doc.id}/preview`
    : `/api/v1/documents/${doc.id}/download`;
}

function docIcon(doc) {
  const mime = docMime(doc);
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'file-text';
  return 'file';
}

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// Sichtbarkeits-Indikator (#474): nur für eingeschränkte Elemente ein dezentes
// Icon — „Alle" bleibt icon-los (keine visuelle Flut, „Kraft ohne Lärm").
function renderVisibilityBadge(visibility) {
  if (!visibility || visibility === 'all') return '';
  const icon  = visibility === 'private' ? 'lock' : 'users';
  const label = visibility === 'private'
    ? t('common.visibility.private')
    : t('common.visibility.assignees');
  return `<span class="due-date task-card__visibility" title="${esc(label)}" aria-label="${esc(label)}">
            <i data-lucide="${icon}" class="icon-sm" aria-hidden="true"></i>
          </span>`;
}

function formatDueDate(dateStr, timeStr, isDone = false) {
  if (!dateStr) return null;
  const dueDate = timeStr ? new Date(`${dateStr}T${timeStr}`) : new Date(`${dateStr}T23:59:59`);
  if (isNaN(dueDate)) return null;

  const now    = new Date();
  const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const calDayDiff = Math.round((dueDay - today) / (1000 * 60 * 60 * 24));

  const timeLabel = timeStr ? ` – ${formatTime(dueDate)}` : '';
  const fullLabel = timeStr ? `${formatDate(dueDate)}, ${formatTime(dueDate)}` : formatDate(dueDate);

  // Erledigte/archivierte Aufgaben können nicht überfällig sein - neutrales Datum.
  if (isDone) {
    return { label: fullLabel, cls: '' };
  }

  if (dueDate < now) {
    return { label: `${t('tasks.overdue')} – ${fullLabel}`, cls: 'due-date--overdue' };
  }
  if (calDayDiff === 0) {
    return { label: `${t('tasks.dueToday')}${timeLabel}`, cls: 'due-date--today' };
  }
  if (calDayDiff === 1) {
    return { label: `${t('tasks.dueTomorrow')}${timeLabel}`, cls: '' };
  }
  return { label: fullLabel, cls: '' };
}

function groupBy(tasks, mode) {
  const groups = {};

  if (mode === 'category') {
    for (const t of tasks) {
      const key = t.category || FALLBACK_CATEGORY;
      (groups[key] = groups[key] || []).push(t);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'de'));
  }

  // mode === 'due'
  const groupOverdue  = t('tasks.groupOverdue');
  const groupToday    = t('tasks.groupToday');
  const groupThisWeek = t('tasks.groupThisWeek');
  const groupNextWeek = t('tasks.groupNextWeek');
  const groupLater    = t('tasks.groupLater');
  const groupNoDate   = t('tasks.groupNoDate');

  for (const task of tasks) {
    let key;
    if (!task.due_date)                  key = groupNoDate;
    else {
      const diff = Math.round((new Date(task.due_date) - new Date().setHours(0,0,0,0)) / 86400000);
      if (diff < 0)       key = groupOverdue;
      else if (diff === 0) key = groupToday;
      else if (diff <= 3)  key = groupThisWeek;
      else if (diff <= 7)  key = groupNextWeek;
      else                 key = groupLater;
    }
    (groups[key] = groups[key] || []).push(task);
  }

  const order = [groupOverdue, groupToday, groupThisWeek, groupNextWeek, groupLater, groupNoDate];
  return order.filter((k) => groups[k]).map((k) => [k, groups[k]]);
}

// --------------------------------------------------------
// Render-Bausteine
// --------------------------------------------------------

function renderPriorityBadge(priority) {
  if (priority === 'none') return '';
  return `<span class="priority-badge priority-badge--${priority}">
    <span class="priority-dot priority-dot--${priority}"></span>
    ${PRIORITY_LABELS()[priority] ?? priority}
  </span>`;
}

function renderDueDate(dateStr, timeStr, isDone = false) {
  const d = formatDueDate(dateStr, timeStr, isDone);
  if (!d) return '';
  return `<span class="due-date ${d.cls}">
    <i data-lucide="clock" class="icon-sm" aria-hidden="true"></i> ${d.label}
  </span>`;
}

function renderStartDateBadge(startDateStr) {
  if (!startDateStr) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(`${startDateStr}T00:00:00`);
  if (startDay <= today) return '';
  return `<span class="due-date">
    <i data-lucide="calendar-clock" class="icon-sm" aria-hidden="true"></i> ${t('tasks.startsOn', { date: formatDate(startDay) })}
  </span>`;
}

function renderSwipeRow(task, innerHtml) {
  const isDone = task.status === 'done';
  return `
    <div class="swipe-row" data-swipe-id="${task.id}" data-swipe-status="${task.status}">
      <div class="swipe-reveal swipe-reveal--done" aria-hidden="true">
        <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" class="icon-xl" aria-hidden="true"></i>
        <span>${isDone ? t('tasks.swipeOpen') : t('tasks.swipeDone')}</span>
      </div>
      <div class="swipe-reveal swipe-reveal--edit" aria-hidden="true">
        <i data-lucide="eye" class="icon-xl" aria-hidden="true"></i>
        <span>${t('tasks.swipeView')}</span>
      </div>
      ${innerHtml}
    </div>`;
}

function renderTaskCard(task, opts = {}) {
  const { expandedSubtasks = false, showCheckbox = false, isChecked = false } = opts;
  const isDone = task.status === 'done';
  const progress = task.subtask_total > 0
    ? Math.round((task.subtask_done / task.subtask_total) * 100)
    : null;

  const subtasksHtml = task.subtasks?.length
    ? task.subtasks.map((s) => `
        <div class="subtask-item ${s.status === 'done' ? 'subtask-item--done' : ''}"
             data-subtask-id="${s.id}">
          <button class="subtask-item__checkbox ${s.status === 'done' ? 'subtask-item__checkbox--done' : ''}"
                  data-action="toggle-subtask" data-id="${s.id}"
                  data-status="${s.status}" aria-label="${t('tasks.subtaskMarkDone', { title: esc(s.title) })}">
            ${s.status === 'done' ? '<i data-lucide="check" class="subtask-item__checkbox-icon" aria-hidden="true"></i>' : ''}
          </button>
          <span class="subtask-item__title">${esc(s.title)}</span>
        </div>`).join('')
    : '';

  return `
    <div class="task-card ${isDone ? 'task-card--done' : ''}" data-task-id="${task.id}">
      <div class="task-card__main">
        ${showCheckbox ? `
        <input type="checkbox" class="task-bulk-checkbox" data-task-id="${task.id}"
               ${isChecked ? 'checked' : ''} aria-label="${t('tasks.selectTask')}">
        ` : ''}
        <button class="task-status-btn task-status-btn--${task.status}"
                data-action="toggle-status" data-id="${task.id}" data-status="${task.status}"
                aria-label="${isDone ? t('tasks.markOpen', { title: esc(task.title) }) : t('tasks.markDone', { title: esc(task.title) })}">
          <i data-lucide="check" class="task-status-btn__check" aria-hidden="true"></i>
        </button>

        <div class="task-card__body">
          <button type="button" class="task-card__title u-card-title" data-action="open-task" data-id="${task.id}">
            ${esc(task.title)}
          </button>
          <div class="task-card__meta">
            ${renderPriorityBadge(task.priority)}
            ${renderStartDateBadge(task.start_date)}
            ${renderDueDate(task.due_date, task.due_time, task.status === 'done' || task.status === 'archived')}
            ${task.is_recurring ? `<span class="due-date" aria-label="${t('tasks.recurring')}"><i data-lucide="repeat" class="icon-sm" aria-hidden="true"></i></span>` : ''}
            ${task.document_count > 0 ? `<span class="due-date task-card__docs" aria-label="${t('tasks.documentsCount', { count: task.document_count })}"><i data-lucide="paperclip" class="icon-sm" aria-hidden="true"></i>${task.document_count}</span>` : ''}
            ${renderVisibilityBadge(task.visibility)}
            ${task.category !== FALLBACK_CATEGORY ? `<span class="due-date task-card__category">${esc(catLabel(task.category))}</span>` : ''}
            ${renderTagBadges(task.tags)}
          </div>
        </div>

        ${renderAvatarStack(task.assigned_users ?? [], { size: 28 })}

        ${!(task.subtask_total > 0) && task.status !== 'archived' && !task.parent_task_id ? `
        <button class="btn btn--ghost btn--icon btn--icon-sm task-card__inline-action" data-action="add-subtask" data-parent="${task.id}"
                aria-label="${t('tasks.subtaskAdd')}" title="${t('tasks.subtaskAdd')}">
          <i data-lucide="list-plus" class="icon-md" aria-hidden="true"></i>
        </button>` : ''}
        <button class="btn btn--ghost btn--icon btn--icon-sm task-card__inline-action" data-action="edit-task" data-id="${task.id}"
                aria-label="${t('tasks.editButton')}">
          <i data-lucide="pencil" class="icon-md" aria-hidden="true"></i>
        </button>
        ${task.status !== 'archived' ? `
        <button class="btn btn--ghost btn--icon btn--icon-sm task-card__inline-action" data-action="archive-task" data-id="${task.id}"
                aria-label="${t('tasks.archiveButton')}">
          <i data-lucide="archive" class="icon-md" aria-hidden="true"></i>
        </button>` : ''}
      </div>

      ${progress !== null ? `
        <button type="button" class="subtask-progress" data-action="toggle-subtasks" data-id="${task.id}"
                aria-expanded="${expandedSubtasks ? 'true' : 'false'}" aria-controls="subtasks-${task.id}"
                aria-label="${t('tasks.subtaskToggle')}">
          <div class="subtask-progress__bar-wrap">
            <div class="subtask-progress__bar-fill" style="--progress-scale:${progress / 100}"></div>
          </div>
          <span class="subtask-progress__text">${task.subtask_done}/${task.subtask_total}</span>
        </button>` : ''}

      ${task.subtasks?.length ? `
        <div class="subtask-list ${expandedSubtasks ? 'subtask-list--visible' : ''}"
             id="subtasks-${task.id}">
          ${subtasksHtml}
          <button class="subtask-item__add" data-action="add-subtask" data-parent="${task.id}">
            ${t('tasks.subtaskAdd')}
          </button>
        </div>` : ''}
    </div>`;
}

// Effektive Fälligkeit: mit due_time wenn vorhanden, sonst 23:59:59 des Tages
function effectiveDue(task) {
  if (!task.due_date) return null;
  return task.due_time
    ? new Date(`${task.due_date}T${task.due_time}`)
    : new Date(`${task.due_date}T23:59:59`);
}

// Einheitliche Sortierung: überfällig zuerst → Datum/Zeit ASC → Prio als Tiebreaker
function sortTasks(a, b, now) {
  const aDate = effectiveDue(a);
  const bDate = effectiveDue(b);
  const aOver = aDate && aDate < now ? 1 : 0;
  const bOver = bDate && bDate < now ? 1 : 0;
  if (bOver !== aOver) return bOver - aOver;
  if (!aDate && !bDate) return (PRIO_ORDER[a.priority] ?? 4) - (PRIO_ORDER[b.priority] ?? 4);
  if (!aDate) return 1;
  if (!bDate) return -1;
  if (aDate.getTime() !== bDate.getTime()) return aDate < bDate ? -1 : 1;
  return (PRIO_ORDER[a.priority] ?? 4) - (PRIO_ORDER[b.priority] ?? 4);
}

function renderTaskGroups(tasks, groupMode) {
  if (!tasks.length) {
    // Leere Suche ≠ leeres Modul: bei aktiver Suche wäre „Noch keine Aufgaben"
    // schlicht falsch und der Anlegen-CTA die falsche Antwort (Notizen-Muster).
    const isFiltered = state.searchQuery.trim().length > 0;
    return `<div class="empty-state">
      <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <div class="empty-state__title">${isFiltered ? t('tasks.noResultsTitle') : t('tasks.emptyTitle')}</div>
      <div class="empty-state__description">${isFiltered
        ? t('tasks.noResultsDescription', { query: esc(state.searchQuery) })
        : t('tasks.emptyDescription')}</div>
      ${isFiltered ? '' : `<p class="empty-state__hint">${t('emptyHint.tasks')}</p>
      <button class="btn btn--primary empty-state__cta" id="empty-cta-tasks">
        <i data-lucide="plus" aria-hidden="true" class="icon-md"></i>
        ${t('tasks.emptyAction')}
      </button>`}
    </div>`;
  }

  const now = new Date();
  const groups = groupBy(tasks, groupMode);
  return groups.map(([name, groupTasks]) => {
    const sorted = [...groupTasks].sort((a, b) => sortTasks(a, b, now));
    return `
    <div class="task-group">
      <div class="task-group__header">
        <span class="task-group__title">${esc(groupMode === 'category' ? catLabel(name) : name)}</span>
        <span class="task-group__count">${groupTasks.length}</span>
      </div>
      ${sorted.map((t) => renderSwipeRow(t, renderTaskCard(t, {
        showCheckbox: state.bulkSelectMode,
        isChecked: state.selectedTaskIds.has(t.id),
        expandedSubtasks: state.subtasksExpandedByDefault,
      }))).join('')}
    </div>`;
  }).join('');
}

// --------------------------------------------------------
// Task-Modal (Erstellen / Bearbeiten)
// --------------------------------------------------------

// --------------------------------------------------------
// Tags (#586)
// Freie Etiketten, gespiegelt aus VTODO CATEGORIES. Bewusst getrennt von der
// Kategorie: eine Aufgabe liegt in einer Schublade, trägt aber beliebig viele
// Etiketten.
// --------------------------------------------------------

// Grenzen identisch zu server/utils/task-tags.js — die Oberfläche soll gar nicht
// erst anbieten, was der Server anschließend kürzt.
const MAX_TAGS = 32;
const MAX_TAG_LEN = 64;

// Working-Set des offenen Bearbeiten-Dialogs, analog zu den verknüpften
// Dokumenten. Wird beim Öffnen aus der Aufgabe gefüllt und beim Speichern gelesen.
let modalTags = [];

/** Tag-Liste säubern; Groß-/Kleinschreibung eint (erste Schreibweise gewinnt). */
function normalizeTagList(list) {
  const out = [];
  const seen = new Set();
  for (const item of list ?? []) {
    const tag = String(item ?? '').trim().slice(0, MAX_TAG_LEN).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Zeichnet die Chips des Tag-Editors neu. */
function renderTagChips(container) {
  const wrap = container.querySelector('#task-tags-chips');
  if (!wrap) return;
  wrap.replaceChildren();

  modalTags.forEach((tag, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'task-tag task-tag--editable';
    chip.dataset.tagIndex = String(index);
    chip.setAttribute('aria-label', t('tasks.tagRemove', { tag }));
    chip.appendChild(document.createTextNode(tag));

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'x');
    icon.className = 'icon-sm';
    icon.setAttribute('aria-hidden', 'true');
    chip.appendChild(icon);

    wrap.appendChild(chip);
  });

  if (window.lucide) window.lucide.createIcons({ el: wrap });
}

/**
 * Verdrahtet den Tag-Editor: Enter oder Komma übernimmt, Klick auf ein Chip
 * entfernt, Backspace im leeren Feld nimmt das letzte zurück.
 */
function wireTagEditor(panel) {
  const input = panel.querySelector('#task-tag-input');
  const chips = panel.querySelector('#task-tags-chips');
  if (!input || !chips) return;

  const commit = () => {
    // Eine eingefügte Liste („Garten, Haus") in einem Rutsch übernehmen.
    const added = input.value.split(',');
    if (!added.some((v) => v.trim())) return;
    modalTags = normalizeTagList([...modalTags, ...added]);
    input.value = '';
    renderTagChips(panel);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter darf im Tag-Feld nicht das Formular abschicken.
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === 'Backspace' && !input.value && modalTags.length) {
      modalTags = modalTags.slice(0, -1);
      renderTagChips(panel);
    }
  });

  // Verlassen des Feldes übernimmt ebenfalls: sonst geht ein getippter Tag beim
  // Speichern still verloren.
  input.addEventListener('blur', commit);
  // Auswahl aus der Vorschlagsliste löst kein keydown aus.
  input.addEventListener('change', commit);

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag-index]');
    if (!chip) return;
    modalTags.splice(Number(chip.dataset.tagIndex), 1);
    renderTagChips(panel);
  });
}

// Wie viele Tags eine Karte zeigt, bevor sie zusammenfasst. Analog zum
// Avatar-Stack: eine Karte, die 32 Etiketten ausrollt, ist keine Karte mehr.
const TAG_BADGES_VISIBLE = 3;

/**
 * Tag-Chips einer Aufgabe für Karten und Kanban.
 *
 * Die Chips sind Buttons, keine Beschriftungen: ein Tag anzuklicken und die
 * Liste darauf zu filtern ist die Geste, die man von einem Etikett erwartet.
 * Den Klick fängt die Delegation in wireTagBadgeFilter ab, die ihn auch vom
 * Karten-Klick (Aufgabe öffnen) trennt.
 */
function renderTagBadges(tags) {
  if (!tags?.length) return '';
  const shown = tags.slice(0, TAG_BADGES_VISIBLE);
  const rest  = tags.length - shown.length;
  const chips = shown.map((tag) => `
    <button type="button" class="task-tag task-tag--filter" data-tag-filter="${esc(tag)}"
            aria-label="${esc(t('tasks.tagFilterBy', { tag }))}">${esc(tag)}</button>`);
  // Der Rest bleibt lesbar statt anklickbar: er benennt keinen einzelnen Tag,
  // also gäbe es auch nichts, worauf ein Klick filtern könnte.
  if (rest > 0) {
    chips.push(`<span class="task-tag task-tag--more"
                      title="${esc(tags.slice(TAG_BADGES_VISIBLE).join(', '))}">+${rest}</span>`);
  }
  return chips.join('');
}

/**
 * Klick auf ein Tag-Chip filtert die Liste danach (#586).
 *
 * Delegiert, weil Karten laufend neu gezeichnet werden - und in der
 * Capture-Phase, nicht beim Bubbling. Im Kanban öffnet ein Klick irgendwo auf
 * der Karte den Bearbeiten-Dialog, und dieser Handler sitzt am Board, also
 * unterhalb des Containers: beim Bubbling käme er zuerst dran und hätte den
 * Dialog längst geöffnet, bevor ein stopPropagation hier noch etwas ausrichtet.
 */
function wireTagBadgeFilter(container) {
  container.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-tag-filter]');
    if (!chip || !container.contains(chip)) return;
    e.preventDefault();
    e.stopPropagation();
    await toggleTagFilter(chip.dataset.tagFilter, container);
  }, true);
}

function renderModalContent({ task = null, users = [], reminder = null } = {}) {
  const isEdit = !!task;

  const selectedIds = task?.assigned_users?.map((u) => u.id) ?? (task?.assigned_to ? [task.assigned_to] : []);
  const visibility  = task?.visibility || 'all';

  const selectedCat = task?.category ?? FALLBACK_CATEGORY;
  const categoryOptions = state.categories.map((c) =>
    `<option value="${esc(c.key)}" ${selectedCat === c.key ? 'selected' : ''}>${esc(catLabel(c.key))}</option>`
  ).join('');

  const priorityOptions = PRIORITIES().map((p) =>
    `<option value="${p.value}" ${(task?.priority ?? 'none') === p.value ? 'selected' : ''}>${p.label}</option>`
  ).join('');

  // Sekundärfelder: hinter „Weitere Einstellungen". Beim Bearbeiten automatisch
  // geöffnet, falls bereits Werte abseits der Defaults gesetzt sind.
  const advancedFieldsOpen = isEdit && (
    !!task.description
    || (!!task.priority && task.priority !== 'none')
    || (!!task.category && task.category !== FALLBACK_CATEGORY)
    || !!task.start_date
    || (Number(task.points) > 0)
    || !!task.tags?.length
  );

  // Punkte neuer Aufgaben mit dem Haushalt-Standard vorbelegen (#578). Der Wert
  // ist per Definition KEIN Abweichler, der Aufklapper bleibt deshalb zu — damit
  // er trotzdem auffindbar bleibt, nennt die Zusammenfassung den Punktwert.
  const prefillPoints = !isEdit && state.defaultPoints > 0 ? state.defaultPoints : 0;
  const pointsValue = isEdit
    ? (Number(task?.points) > 0 ? Number(task.points) : '')
    : (prefillPoints || '');
  const advancedLabel = prefillPoints
    ? `${t('modal.moreSettings')} · ${t('tasks.pointsSummary', { count: prefillPoints })}`
    : undefined;

  const advancedFieldsHtml = `
      <div class="form-group">
        <label class="label" for="task-description">${t('tasks.descriptionLabel')}</label>
        <textarea class="input" id="task-description" name="description"
                  rows="2" placeholder="${t('tasks.descriptionPlaceholder')}"
                 >${esc(task?.description)}</textarea>
      </div>

      <div class="modal-grid modal-grid--2">
        <div class="form-group">
          <label class="label" for="task-priority">${t('tasks.priorityLabel')}</label>
          <select class="input" id="task-priority" name="priority">
            ${priorityOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="label" for="task-category">${t('tasks.categoryLabel')}</label>
          <select class="input" id="task-category" name="category">
            ${categoryOptions}
          </select>
        </div>
      </div>

      <div class="modal-grid modal-grid--2" style="margin-top:var(--space-4)">
        <div class="form-group">
          <label class="label" for="task-start-date">${t('tasks.startDateLabel')}</label>
          <yuvomi-datepicker type="date" id="task-start-date" name="start_date"
                 value="${esc(formatDateInput(task?.start_date))}"></yuvomi-datepicker>
        </div>
        <div class="form-group">
          <label class="label" for="task-points">${t('tasks.pointsLabel')}</label>
          <input class="input" type="number" id="task-points" name="points" inputmode="numeric"
                 min="0" step="1" value="${pointsValue}"
                 placeholder="0">
          <p class="task-field-hint">${prefillPoints
            ? t('tasks.pointsDefaultHint', { count: prefillPoints })
            : t('tasks.pointsHint')}</p>
        </div>
      </div>

      <div class="form-group task-tags-field" style="margin-top:var(--space-4)">
        <label class="label" for="task-tag-input">${t('tasks.tagsLabel')}</label>
        <div class="task-tags-editor" id="task-tags-editor">
          <div class="task-tags-editor__chips" id="task-tags-chips"></div>
          <input class="input task-tags-editor__input" type="text" id="task-tag-input"
                 list="task-tag-suggestions" autocomplete="off"
                 placeholder="${t('tasks.tagsPlaceholder')}">
          <datalist id="task-tag-suggestions">
            ${state.allTags.map((entry) => `<option value="${esc(entry.tag)}"></option>`).join('')}
          </datalist>
        </div>
        <p class="task-field-hint">${t('tasks.tagsHint')}</p>
      </div>`;

  return `
    <form id="task-form" novalidate>
      <input type="hidden" id="task-id" value="${task?.id ?? ''}">

      <div class="form-group">
        <div class="form-field">
          <label class="label" for="task-title">${t('tasks.titleLabel')}<span class="required-marker" aria-hidden="true"> *</span></label>
          <input class="input" type="text" id="task-title" name="title"
                 value="${esc(task?.title)}" placeholder="${t('tasks.titlePlaceholder')}"
                 required autocomplete="off">
          <div class="form-field__error">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/>
                 <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/>
            </svg>
            ${t('common.required')}
          </div>
        </div>
      </div>

      <div class="modal-grid modal-grid--2">
        <div class="form-group">
          <label class="label" for="task-due-date">${t('tasks.dueDateLabel')}</label>
          <yuvomi-datepicker type="date" id="task-due-date" name="due_date"
                 value="${esc(formatDateInput(task?.due_date))}"></yuvomi-datepicker>
        </div>
        <div class="form-group">
          <label class="label" for="task-due-time">${t('tasks.dueTimeLabel')}</label>
          <yuvomi-datepicker type="time" id="task-due-time" name="due_time"
                 value="${esc(formatTimeInput(task?.due_time ?? ''))}"></yuvomi-datepicker>
        </div>
      </div>

      <div class="form-group" style="margin-top:var(--space-4)">
        ${renderUserMultiSelect(users, selectedIds, 'task_assigned', 'tasks.assignedLabel')}
      </div>

      ${users.length > 1 ? `
      <div class="form-group" style="margin-top:var(--space-4)">
        <label class="label" for="task-visibility">${t('common.visibility.label')}</label>
        <select class="input" id="task-visibility" name="visibility">
          <option value="all"       ${visibility === 'all'       ? 'selected' : ''}>${t('common.visibility.all')}</option>
          <option value="assignees" ${visibility === 'assignees' ? 'selected' : ''}>${t('common.visibility.assignees')}</option>
          <option value="private"   ${visibility === 'private'   ? 'selected' : ''}>${t('common.visibility.private')}</option>
        </select>
        <p class="task-field-hint">${t('common.visibility.hint')}</p>
        <p class="task-field-hint field-hint--warn" id="task-visibility-warning" role="status" hidden><i data-lucide="alert-triangle" aria-hidden="true"></i><span>${t('common.visibility.assigneesNobodyHint')}</span></p>
      </div>` : ''}

      ${advancedSection(advancedFieldsHtml, { open: advancedFieldsOpen, label: advancedLabel })}

      ${isEdit ? `
        <div class="form-group">
          <label class="label" for="task-status">${t('tasks.statusLabel')}</label>
          <select class="input" id="task-status" name="status">
            ${STATUSES().map((s) =>
              `<option value="${s.value}" ${task.status === s.value ? 'selected' : ''}>${s.label}</option>`
            ).join('')}
          </select>
        </div>` : ''}

      ${renderRRuleFields('task', task?.recurrence_rule)}

      ${renderReminderSection(task, reminder)}

      <div class="form-group task-documents" id="task-documents-section" style="margin-top:var(--space-4)">
        <label class="label">${t('tasks.documentsLabel')}</label>
        <p class="task-field-hint">${t('tasks.documentsHint')}</p>
        <div class="task-documents__list" id="task-documents-list" role="list"></div>
        <div class="task-documents__add">
          <label class="sr-only" for="task-document-add">${t('tasks.documentAdd')}</label>
          <select class="input" id="task-document-add">
            <option value="">${t('tasks.documentAddPlaceholder')}</option>
          </select>
        </div>
      </div>

      <div id="task-form-error" class="login-error" hidden></div>

      <div class="modal-panel__footer modal-panel__footer--plain">
        ${isEdit ? `
          <button type="button" class="btn btn--danger-outline" data-action="delete-task"
                  data-id="${task.id}" style="margin-right:auto">${t('common.delete')}</button>` : ''}
        <button type="button" class="btn btn--ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn--primary" id="task-submit-btn">
          ${isEdit ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>`;
}

// --------------------------------------------------------
// Seiten-State
// --------------------------------------------------------

let state = {
  tasks:           [],
  users:           [],
  categories:      [],
  allTags:         [],       // [{ tag, count }] für Filterleiste und Vorschläge (#586)
  defaultPoints:   0,        // Haushalt-Standard für neue Aufgaben (#578), 0 = aus
  currentUserId:   null,
  // `tags` ist eine Liste, keine Auswahl: mehrere Tags engen UND-verknüpft ein,
  // wie jeder andere Filter in dieser Leiste auch (#586).
  filters:         { status: 'open', priority: '', assigned_to: '', tags: [] },
  groupMode:       'category',   // 'category' | 'due'
  viewMode:        'list',       // 'list' | 'kanban' (resolved at render time)
  showFuture:      false,
  subtasksExpandedByDefault: false,
  expandedTasks:   new Set(),
  dragTaskId:      null,
  filterPanelOpen: false,
  bulkSelectMode:  false,
  selectedTaskIds: new Set(),
  searchQuery:     '',
};

/**
 * Aufgaben nach der Toolbar-Suche gefiltert. Rein clientseitig über Titel und
 * Beschreibung — die Serverfilter (Status/Priorität/Person) laufen weiter über
 * loadTasks(). state.tasks bleibt ungefiltert, damit Zähler wie das
 * Überfällig-Badge die Gesamtlage melden und nicht die Suchtreffer.
 */
function filteredTasks() {
  const q = state.searchQuery.trim().toLowerCase();
  if (!q) return state.tasks;
  return state.tasks.filter((task) =>
    (task.title       || '').toLowerCase().includes(q) ||
    (task.description || '').toLowerCase().includes(q) ||
    (task.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
  );
}

// --------------------------------------------------------
// API-Aktionen
// --------------------------------------------------------

/**
 * Query-String für /tasks aus dem aktuellen Filterzustand.
 *
 * Geteilt zwischen dem ersten Aufbau der Seite und jedem Nachladen: die Liste
 * stand zweimal da und ist beim Hinzukommen des Tag-Filters prompt
 * auseinandergelaufen.
 */
function taskQuery() {
  const params = new URLSearchParams();
  // Kanban-Spalten SIND der Status: den Statusfilter dort nicht an den Server
  // senden, sonst blieben "In Bearbeitung"/"Erledigt" trotz vorhandener Aufgaben
  // leer (Audit A1-07/P3). In der Liste wirkt er normal; state bleibt erhalten,
  // sodass der Filter beim Zurückwechseln wieder greift.
  if (state.filters.status && state.viewMode !== 'kanban') params.set('status', state.filters.status);
  if (state.filters.priority)    params.set('priority',    state.filters.priority);
  if (state.filters.assigned_to) params.set('assigned_to', state.filters.assigned_to);
  // append statt set: jeder Tag ist ein eigener Parameter, damit ein Tag mit
  // Komma im Namen nicht am Server in zwei zerfällt.
  state.filters.tags.forEach((tag) => params.append('tag', tag));
  if (state.showFuture)          params.set('include_future', '1');
  return params.toString() ? `?${params}` : '';
}

async function loadTasks(container) {
  persistAssignedToMe();
  const data  = await api.get(`/tasks${taskQuery()}`);
  state.tasks = data.data ?? [];
  renderTaskList(container);
}

/**
 * Vergebene Tags nachladen (#586). Nur nach dem Speichern nötig, nicht bei jedem
 * Filterwechsel - die Liste ändert sich ausschließlich durch Bearbeiten.
 * Scheitert der Aufruf, bleibt die alte Liste stehen: veraltete Vorschläge sind
 * harmloser als eine plötzlich verschwundene Filtergruppe.
 */
async function refreshTags() {
  try {
    const res = await api.get('/tasks/tags');
    state.allTags = res.data ?? [];
  } catch { /* alte Liste behalten */ }
}

async function toggleTaskStatus(id, currentStatus) {
  const next = currentStatus === 'done' ? 'open' : 'done';
  await api.patch(`/tasks/${id}/status`, { status: next });
}

async function toggleSubtaskStatus(id, currentStatus) {
  const next = currentStatus === 'done' ? 'open' : 'done';
  await api.patch(`/tasks/${id}/status`, { status: next });
}

async function loadTaskForEdit(id) {
  const data = await api.get(`/tasks/${id}`);
  return data.data;
}

async function loadReminderForTask(taskId) {
  try {
    const data = await api.get(`/reminders?entity_type=task&entity_id=${taskId}`);
    return data.data;
  } catch {
    return null;
  }
}

function renderReminderSection(task = null, reminder = null) {
  const hasReminder = !!reminder;
  const resolved = resolveReminderPreset(task, reminder);
  const showCustom = hasReminder && resolved.preset === 'offset_custom';

  return `
    <div class="reminder-section">
      <div class="reminder-section__header">
        <label class="toggle" style="margin:0">
          <input type="checkbox" id="reminder-toggle" ${hasReminder ? 'checked' : ''}>
          <span class="toggle__track"></span>
          <span class="reminder-section__title">${t('reminders.enableLabel')}</span>
        </label>
      </div>
      <div id="reminder-fields" class="reminder-fields" ${hasReminder ? '' : 'style="display:none"'}>
        <div class="form-group" style="margin:0">
          <label class="label" for="reminder-offset">${t('reminders.offsetLabel')}</label>
          <select class="input" id="reminder-offset">
            <option value="offset_none">${t('reminders.offsetNone')}</option>
            <option value="offset_at_time" ${resolved.preset === 'offset_at_time' ? 'selected' : ''}>${t('reminders.offsetAtTime')}</option>
            <option value="offset_15m" ${resolved.preset === 'offset_15m' ? 'selected' : ''}>${t('reminders.offset15min')}</option>
            <option value="offset_1h" ${resolved.preset === 'offset_1h' ? 'selected' : ''}>${t('reminders.offset1hour')}</option>
            <option value="offset_1d" ${resolved.preset === 'offset_1d' ? 'selected' : ''}>${t('reminders.offset1day')}</option>
            <option value="offset_2d" ${resolved.preset === 'offset_2d' ? 'selected' : ''}>${t('reminders.offset2days')}</option>
            <option value="offset_1w" ${resolved.preset === 'offset_1w' ? 'selected' : ''}>${t('reminders.offset1week')}</option>
            <option value="offset_2w" ${resolved.preset === 'offset_2w' ? 'selected' : ''}>${t('reminders.offset2weeks')}</option>
            <option value="offset_custom" ${resolved.preset === 'offset_custom' ? 'selected' : ''}>${t('reminders.offsetCustom')}</option>
          </select>
        </div>
        <div class="modal-grid modal-grid--2" id="reminder-custom-fields" style="${showCustom ? '' : 'display:none'};margin-top:var(--space-3)">
          <div class="form-group" style="margin:0">
            <label class="label" for="reminder-custom-amount">${t('reminders.customAmountLabel')}</label>
            <input class="input" type="number" min="1" step="1" id="reminder-custom-amount" value="${resolved.amount}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="label" for="reminder-custom-unit">${t('reminders.customUnitLabel')}</label>
            <select class="input" id="reminder-custom-unit">
              <option value="minutes" ${resolved.unit === 'minutes' ? 'selected' : ''}>${t('reminders.customMinutes')}</option>
              <option value="hours" ${resolved.unit === 'hours' ? 'selected' : ''}>${t('reminders.customHours')}</option>
              <option value="days" ${resolved.unit === 'days' ? 'selected' : ''}>${t('reminders.customDays')}</option>
              <option value="weeks" ${resolved.unit === 'weeks' ? 'selected' : ''}>${t('reminders.customWeeks')}</option>
            </select>
          </div>
        </div>
      </div>
    </div>`;
}

// --------------------------------------------------------
// Modal-Verwaltung (delegiert an Shared Modal-System)
// --------------------------------------------------------

// Blendet einen Hinweis ein, wenn „Nur Zugewiesene" gewählt ist, aber niemand
// zugewiesen wurde — dann sieht faktisch nur der Ersteller den Eintrag (#474 Guard).
function wireVisibilityWarning(panel, selectSel, msName, warnSel) {
  const select = panel.querySelector(selectSel);
  const warn   = panel.querySelector(warnSel);
  if (!select || !warn) return;
  const ms = panel.querySelector(`.user-ms[data-ms-name="${msName}"]`);
  const update = () => {
    const count = getSelectedUserIds(panel, msName).length;
    warn.hidden = !(select.value === 'assignees' && count === 0);
  };
  select.addEventListener('change', update);
  ms?.addEventListener('click', () => setTimeout(update, 0));
  update();
}

// Chip für ein verknüpftes Dokument: Name öffnet Vorschau/Download, X entfernt.
function renderTaskDocChip(doc) {
  return `
    <span class="task-doc-chip" role="listitem" data-doc-id="${doc.id}">
      <i data-lucide="${docIcon(doc)}" class="task-doc-chip__icon icon-sm" aria-hidden="true"></i>
      <a class="task-doc-chip__name" href="${docHref(doc)}" target="_blank" rel="noopener"
         title="${esc(doc.name)}">${esc(doc.name)}</a>
      <button type="button" class="task-doc-chip__remove" data-action="unlink-doc"
              data-doc-id="${doc.id}" aria-label="${t('tasks.documentRemove')}">
        <i data-lucide="x" class="icon-sm" aria-hidden="true"></i>
      </button>
    </span>`;
}

// Dokument-Sektion befüllen: verfügbare + bereits verknüpfte Dokumente laden,
// das Working-Set (modalDocuments) aufbauen und Add/Remove-Interaktion binden.
async function wireDocumentSection(panel, task) {
  const section = panel.querySelector('#task-documents-section');
  if (!section) return;
  const listEl = panel.querySelector('#task-documents-list');
  const addSel = panel.querySelector('#task-document-add');
  modalDocuments = { index: new Map(), selected: [] };

  const render = () => {
    const chips = modalDocuments.selected
      .map((id) => modalDocuments.index.get(id))
      .filter(Boolean)
      .map(renderTaskDocChip)
      .join('');
    listEl.replaceChildren();
    listEl.insertAdjacentHTML('beforeend',
      chips || `<p class="task-documents__empty">${t('tasks.documentsEmpty')}</p>`);

    const available = [...modalDocuments.index.values()]
      .filter((d) => d.selectable && !modalDocuments.selected.includes(d.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    addSel.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('tasks.documentAddPlaceholder');
    addSel.appendChild(placeholder);
    for (const d of available) {
      const opt = document.createElement('option');
      opt.value = String(d.id);
      opt.textContent = d.name;
      addSel.appendChild(opt);
    }
    addSel.disabled = available.length === 0;
    window.lucide?.createIcons({ el: listEl });
  };

  try {
    const [availRes, linkedRes] = await Promise.all([
      api.get('/documents'),
      task?.id ? api.get(`/tasks/${task.id}/documents`) : Promise.resolve({ data: [] }),
    ]);
    for (const d of (availRes.data ?? [])) {
      modalDocuments.index.set(d.id, { id: d.id, name: d.name, mime_type: d.mime_type, selectable: true });
    }
    for (const d of (linkedRes.data ?? [])) {
      const existing = modalDocuments.index.get(d.id);
      if (existing) { existing.name = d.name; existing.mime_type = d.mime_type; }
      else modalDocuments.index.set(d.id, { id: d.id, name: d.name, mime_type: d.mime_type, selectable: false });
      if (!modalDocuments.selected.includes(d.id)) modalDocuments.selected.push(d.id);
    }
  } catch { /* Dokumente-Modul nicht erreichbar - Sektion bleibt leer/inaktiv */ }

  render();

  addSel.addEventListener('change', () => {
    const id = Number(addSel.value);
    if (id && !modalDocuments.selected.includes(id)) modalDocuments.selected.push(id);
    addSel.value = '';
    render();
  });
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="unlink-doc"]');
    if (!btn) return;
    const id = Number(btn.dataset.docId);
    modalDocuments.selected = modalDocuments.selected.filter((x) => x !== id);
    render();
  });
}

function openTaskModal({ task = null, users = [], reminder = null } = {}, container) {
  const isEdit = !!task;
  // Working-Set VOR dem Rendern setzen: renderTagChips liest ihn direkt danach.
  modalTags = normalizeTagList(task?.tags);
  openSharedModal({
    title: isEdit ? t('tasks.editTask') : t('tasks.newTask'),
    content: renderModalContent({ task, users, reminder }),
    size: 'lg',
    // Eine neue Aufgabe startet weiterhin mit dem Fokus im Titelfeld - hier ist
    // Tippen die Absicht.
    onSave(panel) { wireTaskForm(panel, { task, container }); },
  });
}

/**
 * Verdrahtet das Aufgaben-Formular. Eigene Funktion, weil das Formular an zwei
 * Orten entsteht: als eigenes Modal (neue Aufgabe) und als zweites Pane der
 * Detailansicht, das erst beim Wechsel gemountet wird.
 */
function wireTaskForm(panel, { task = null, container }) {
  panel.querySelector('.modal-panel__body')?.classList.add('modal-panel__body--tasks-fit');
  // RRULE-Events binden
  bindRRuleEvents(document, 'task');
  bindUserMultiSelect(panel, 'task_assigned');
  wireVisibilityWarning(panel, '#task-visibility', 'task_assigned', '#task-visibility-warning');

  // Tag-Editor (#586)
  renderTagChips(panel);
  wireTagEditor(panel);

  // Verknüpfte Dokumente laden + Add/Remove binden (#503)
  wireDocumentSection(panel, task);

  // Blur-Validierung für required-Felder aktivieren
  wireBlurValidation(panel);

  // Reminder-Toggle: Felder ein-/ausblenden
  const toggle = panel.querySelector('#reminder-toggle');
  const fields = panel.querySelector('#reminder-fields');
  const offset = panel.querySelector('#reminder-offset');
  const customFields = panel.querySelector('#reminder-custom-fields');
  toggle?.addEventListener('change', () => {
    fields.style.display = toggle.checked ? '' : 'none';
  });
  offset?.addEventListener('change', () => {
    if (!customFields) return;
    customFields.style.display = offset.value === 'offset_custom' ? '' : 'none';
  });
  // Form-Events
  panel.querySelector('#task-form')
    ?.addEventListener('submit', (e) => handleFormSubmit(e, container));

  panel.querySelector('[data-action="delete-task"]')
    ?.addEventListener('click', (e) => handleDeleteTask(e.currentTarget.dataset.id, container));
}

// --------------------------------------------------------
// Aufgaben-Detailansicht
// --------------------------------------------------------

// Was aus dem aktuellen Status als Nächstes kommt. Archivierte Aufgaben führen
// keine Weiterschaltung: sie sind aus dem Lauf genommen, nicht angehalten.
const NEXT_STATUS = {
  open:        { status: 'in_progress', labelKey: 'tasks.detailStart',  icon: 'circle-dot' },
  in_progress: { status: 'done',        labelKey: 'tasks.detailFinish', icon: 'check' },
  done:        { status: 'open',        labelKey: 'tasks.detailReopen', icon: 'rotate-ccw' },
};

/** Prioritätsbadge als DOM - dieselbe Optik wie auf der Karte. */
function priorityNode(priority) {
  if (!priority || priority === 'none') return null;
  const badge = document.createElement('span');
  badge.className = `priority-badge priority-badge--${priority}`;
  const dot = document.createElement('span');
  dot.className = `priority-dot priority-dot--${priority}`;
  badge.append(dot, document.createTextNode(PRIORITY_LABELS()[priority] ?? priority));
  return badge;
}

/** Eine Chip-Reihe aus einer Liste. Beschriftung liefert der Aufrufer. */
function chipListNode(items, toLabel) {
  if (!items.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'detail-chips';
  items.forEach((item) => {
    const chip = document.createElement('span');
    chip.className = 'task-tag';
    chip.textContent = toLabel(item);
    wrap.appendChild(chip);
  });
  return wrap;
}

/** Tags als Chips. In der Leseansicht benennen sie, sie filtern nicht. */
function tagChipsNode(tags) {
  return chipListNode(normalizeTagList(tags), (tag) => tag);
}

/** Teilaufgaben mit ihrem Stand - die Liste führt sie, also führt die Ansicht sie auch. */
function subtaskListNode(task) {
  if (!task.subtasks?.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'detail-subtasks';
  task.subtasks.forEach((s) => {
    const row = document.createElement('div');
    row.className = s.status === 'done' ? 'detail-subtask detail-subtask--done' : 'detail-subtask';
    const icon = document.createElement('i');
    icon.dataset.lucide = s.status === 'done' ? 'check-circle-2' : 'circle';
    icon.className = 'icon-sm';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = s.title;
    row.append(icon, label);
    wrap.appendChild(row);
  });
  return wrap;
}

/** Verknüpfte Dokumente beim Namen nennen, nicht nur zählen. */
function documentListNode(docs) {
  return chipListNode(
    Array.isArray(docs) ? docs : [],
    (doc) => doc.title || doc.filename || String(doc.id),
  );
}

/** Erinnerung im Klartext, aus dem gespeicherten Zeitpunkt. */
function taskReminderSummary(reminders) {
  const list = Array.isArray(reminders) ? reminders : (reminders ? [reminders] : []);
  return list
    .map((r) => {
      if (!r?.remind_at) return '';
      const at = parseRemindAtAsUtc(r.remind_at);
      return `${formatDate(at)} ${formatTime(at)}`.trim();
    })
    .filter(Boolean)
    .join(', ');
}

function renderTaskDetail(task, reminders = []) {
  const due = formatDueDate(task.due_date, task.due_time, task.status === 'done' || task.status === 'archived');

  return [
    { icon: 'circle-dot', label: t('tasks.statusLabel'), value: STATUS_LABELS()[task.status] ?? task.status },
    { icon: 'flag', label: t('tasks.priorityLabel'), node: priorityNode(task.priority) },
    { icon: 'clock', label: t('tasks.dueDateLabel'), value: due?.label ?? '' },
    { icon: 'calendar-clock', label: t('tasks.startDateLabel'), value: task.start_date ? formatDate(task.start_date) : '' },
    recurrenceRow(task.recurrence_rule),
    { icon: 'folder', label: t('tasks.categoryLabel'), value: task.category && task.category !== FALLBACK_CATEGORY ? catLabel(task.category) : '' },
    assignedRow(task.assigned_users, t('tasks.assignedLabel')),
    { icon: 'award', label: t('tasks.pointsLabel'), value: task.points ? String(task.points) : '' },
    { icon: 'tag', label: t('tasks.tagsLabel'), node: tagChipsNode(task.tags) },
    { icon: 'list-checks', label: t('tasks.subtasksLabel'), node: subtaskListNode(task) },
    { icon: 'paperclip', label: t('tasks.documentsLabel'), node: documentListNode(task.documents) },
    { icon: 'bell', label: t('reminders.sectionTitle'), value: taskReminderSummary(reminders) },
    visibilityRow(task.visibility),
    { icon: 'align-left', label: t('tasks.descriptionLabel'), value: task.description ?? '', multiline: true },
  ];
}

/**
 * Der einzige Einstieg in eine bestehende Aufgabe.
 *
 * Anders als beim Kalender wird hier bewusst kein Anker übergeben: Eine Aufgabe
 * trägt deutlich mehr Inhalt als ein Termin, und ein 320px-Popover neben der
 * Zeile wäre für Teilaufgaben, Tags und Dokumente zu eng.
 */
function openTaskDetail({ task, users = [], reminder = null }, container) {
  const next = NEXT_STATUS[task.status];

  const actions = [{
    id: 'task-detail-delete',
    label: t('common.delete'),
    variant: 'danger-ghost',
    icon: 'trash-2',
    align: 'start',
    // Siehe closeDetailView: nach dem Löschen gibt es nichts mehr zu verwerfen,
    // und der await hält die optimistische Löschung zurück, bis der
    // Overlay-Slot frei ist.
    onClick: async ({ close }) => {
      await close({ force: true });
      handleDeleteTask(String(task.id), container);
    },
  }];

  // Der häufigste Grund, eine Aufgabe zu öffnen, ist sie abzuhaken. Bisher
  // führte dieser Weg durch ein Formular mit sieben Auswahlfeldern.
  if (next) {
    actions.push({
      id: 'task-detail-advance',
      label: t(next.labelKey),
      variant: 'secondary',
      icon: next.icon,
      onClick: ({ button }) => advanceTaskStatus(task, next.status, button, container),
    });
  }

  openDetailView({
    title: task.title,
    size: 'lg',
    sections: renderTaskDetail(task, reminder),
    actions,
    edit: {
      label: t('common.edit'),
      title: t('tasks.editTask'),
      mount: (panel, pane) => {
        // Working-Set VOR dem Rendern setzen: renderTagChips in wireTaskForm
        // liest ihn direkt danach.
        modalTags = normalizeTagList(task.tags);
        pane.insertAdjacentHTML('beforeend', renderModalContent({ task, users, reminder }));
        wireTaskForm(panel, { task, container });
      },
    },
  });
}

/**
 * Status aus der Detailansicht weiterschalten. Optimistisch: Der Knopf zeigt
 * den neuen Stand sofort, weil das Abhaken sonst wie ein verschluckter Klick
 * wirkt. Scheitert der Aufruf, kommt die alte Beschriftung zurück.
 */
async function advanceTaskStatus(task, status, button, container) {
  const previous = task.status;
  const stop = btnLoading(button);
  try {
    await api.patch(`/tasks/${task.id}/status`, { status });
    task.status = status;
    // Der Status steht bereits beim Server - eine Verwerfen-Frage danach böte
    // an, etwas rückgängig zu machen, was gar nicht mehr aussteht (#625).
    await closeDetailView({ force: true });
    await loadTasks(container);
  } catch (err) {
    task.status = previous;
    stop();
    // Gescheitert ist ein Schreibvorgang, kein Laden - tasks.loadError („Aufgabe
    // konnte nicht geladen werden") beschriebe den falschen Vorgang.
    window.yuvomi.showToast(err.message ?? t('common.errorGeneric'), 'danger');
  }
}

// --------------------------------------------------------
// Tag-Verwaltung und Bulk-Vergabe (#586)
// --------------------------------------------------------

/**
 * Tags haushaltsweit umbenennen, zusammenführen und entfernen.
 * Nach jeder Änderung wandert die frische Liste direkt in den State - der
 * Server liefert sie in derselben Antwort mit, ein Nachladen entfällt.
 */
function openTagManager(container) {
  let manager = null;
  const onChanged = async (e) => {
    state.allTags = e.detail?.tags ?? state.allTags;
    // Ein Tag, der gerade umbenannt oder gelöscht wurde, kann noch im Filter
    // stehen. Bliebe er dort, filterte die Liste auf einen Namen, den es nicht
    // mehr gibt, und zeigte dauerhaft nichts an.
    const known = new Set(state.allTags.map((entry) => entry.tag.toLowerCase()));
    state.filters.tags = state.filters.tags.filter((tag) => known.has(tag.toLowerCase()));
    renderFilters(container);
    await loadTasks(container);
  };
  openSharedModal({
    title: t('tasks.manageTags'),
    content: '<yuvomi-tag-manager></yuvomi-tag-manager>',
    size: 'lg',
    onSave: (panel) => {
      manager = panel.querySelector('yuvomi-tag-manager');
      manager.addEventListener('tag-manager-changed', onChanged);
    },
    onClose: () => manager?.removeEventListener('tag-manager-changed', onChanged),
  });
}

/**
 * Tag an die ausgewählten Aufgaben hängen oder von ihnen nehmen.
 *
 * Beim Entfernen kommen die Vorschläge aus den ausgewählten Aufgaben selbst,
 * nicht aus dem Gesamtbestand: einen Tag anzubieten, den keine der markierten
 * Aufgaben trägt, wäre eine Aktion, die garantiert nichts tut.
 */
function openBulkTagDialog(taskIds, mode, container) {
  const selected = state.tasks.filter((task) => taskIds.includes(task.id));
  const pool = mode === 'remove'
    ? [...new Map(selected.flatMap((task) => task.tags ?? [])
        .map((tag) => [tag.toLowerCase(), tag])).values()].sort((a, b) =>
          a.localeCompare(b, getLocale(), { sensitivity: 'base' }))
    : state.allTags.map((entry) => entry.tag);

  openSharedModal({
    title: mode === 'add' ? t('tasks.bulkTagAdd') : t('tasks.bulkTagRemove'),
    size: 'sm',
    content: `
      <form id="bulk-tag-form">
        <div class="form-group">
          <label class="label" for="bulk-tag-input">${t('tasks.tagsLabel')}</label>
          <input class="input" type="text" id="bulk-tag-input" name="tag" autocomplete="off"
                 list="bulk-tag-suggestions" maxlength="64"
                 placeholder="${t('tasks.tagsPlaceholder')}">
          <datalist id="bulk-tag-suggestions">
            ${pool.map((tag) => `<option value="${esc(tag)}"></option>`).join('')}
          </datalist>
          <p class="task-field-hint">${t('tasks.bulkTagHint', { count: taskIds.length })}</p>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn--primary">${t('common.apply')}</button>
        </div>
      </form>`,
    onSave: (panel) => {
      const form = panel.querySelector('#bulk-tag-form');
      panel.querySelector('#bulk-tag-input')?.focus();
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tag = form.elements.tag.value.trim();
        if (!tag) return;
        try {
          const body = mode === 'add' ? { ids: taskIds, add: [tag] } : { ids: taskIds, remove: [tag] };
          const res = await api.post('/tasks/tags/apply', body);
          state.allTags = res.data?.tags ?? state.allTags;
          window.yuvomi.showToast(t('tasks.tagsUpdated', { count: res.data?.updated ?? 0 }), 'success');
          closeModal({ force: true });
          state.selectedTaskIds.clear();
          updateBulkActionsBar(container);
          renderFilters(container);
          await loadTasks(container);
        } catch (err) {
          window.yuvomi.showToast(err.message ?? t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

// --------------------------------------------------------
// Kategorie-Verwaltung (#494)
// --------------------------------------------------------

function openTaskCategoryManager(container) {
  let manager = null;
  const onChanged = async () => {
    try {
      const res = await api.get('/tasks/categories');
      state.categories = res.data ?? [];
      renderTaskList(container);
    } catch { /* Fehler wurde bereits vom Manager als Toast angezeigt */ }
  };
  openSharedModal({
    title: t('tasks.manageCategories'),
    content: '<yuvomi-category-manager></yuvomi-category-manager>',
    size: 'lg',
    onSave: (panel) => {
      manager = panel.querySelector('yuvomi-category-manager');
      manager.addEventListener('category-manager-changed', onChanged);
      manager.configure({
        basePath: '/tasks/categories',
        groups: [{ key: '', addLabelKey: 'tasks.addCategory' }],
        labelResolver: (item) => (item.label_key ? t(item.label_key) : (item.name || item.key)),
        titleKey: 'tasks.manageCategories',
        hintKey: 'category.manageHint',
        deleteDetailKey: 'category.deleteConfirmDetail',
      });
    },
    onClose: () => manager?.removeEventListener('category-manager-changed', onChanged),
  });
}

// --------------------------------------------------------
// Formular-Handler
// --------------------------------------------------------

async function handleFormSubmit(e, container) {
  e.preventDefault();
  const form      = e.target;
  const errorEl   = document.getElementById('task-form-error');
  const submitBtn = document.getElementById('task-submit-btn');
  const taskId    = document.getElementById('task-id').value;

  // Alle required-Felder sofort validieren (auch unberührte)
  if (!validateAll(form)) return;

  errorEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = t('common.saving');

  const originalLabel = taskId ? t('common.save') : t('common.create');

  const startDateRaw = form.start_date?.value || '';
  const startDate = parseDateInput(startDateRaw);
  const dueDateRaw = form.due_date?.value || '';
  const dueDate = parseDateInput(dueDateRaw);
  const rrule = getRRuleValues(document, 'task');
  const reminderToggle = form.querySelector('#reminder-toggle');
  if ((startDateRaw && !isDateInputValid(startDateRaw)) || !isDateInputValid(dueDateRaw) || !rrule.valid_until) {
    errorEl.textContent = t('calendar.invalidDate');
    errorEl.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    return;
  }
  // Ein noch nicht übernommener Tag im Eingabefeld zählt mit — wer tippt und
  // direkt speichert, hat ihn gemeint.
  const pendingTag = form.querySelector('#task-tag-input')?.value ?? '';
  const tags = normalizeTagList([...modalTags, ...pendingTag.split(',')]);

  const body = {
    title:           form.title.value.trim(),
    description:     form.description.value.trim() || null,
    priority:        form.priority.value,
    category:        form.category.value,
    tags,
    start_date:      startDate || null,
    due_date:        dueDate || null,
    assigned_to:     getSelectedUserIds(form, 'task_assigned'),
    visibility:      form.querySelector('#task-visibility')?.value || 'all',
    is_recurring:    rrule.is_recurring ? 1 : 0,
    recurrence_rule: rrule.recurrence_rule,
    points:          Math.max(0, Math.trunc(Number(form.points?.value)) || 0),
  };
  const dueTimeRaw = form.due_time?.value || '';
  const dueTime = parseTimeInput(dueTimeRaw);
  const resetSubmit = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  };
  if (dueTimeRaw && !dueTime) { resetSubmit(t('calendar.invalidDate')); return; }
  body.due_time = dueTime || null;
  if (form.status) body.status = form.status.value;

  // Erinnerungs-Vorbedingungen VOR dem Speichern prüfen — verhindert den
  // widersprüchlichen Zustand "Aufgabe gespeichert (Erfolgs-Toast) + roter
  // Fehler", wenn Reminder ohne Fälligkeit/Offset gesetzt wird (Critique P2).
  const wantsReminder = !!reminderToggle?.checked;
  let remindAt = null;
  if (wantsReminder) {
    if (!dueDate) { resetSubmit(t('tasks.reminderNeedsDueDate')); return; }
    const offsetPreset = form.querySelector('#reminder-offset')?.value || 'offset_none';
    if (offsetPreset === 'offset_none') { resetSubmit(t('tasks.reminderNeedsDueDate')); return; }
    let offsetMs = 0;
    if (offsetPreset === 'offset_15m') offsetMs = 15 * 60 * 1000;
    else if (offsetPreset === 'offset_1h') offsetMs = 60 * 60 * 1000;
    else if (offsetPreset === 'offset_1d') offsetMs = 24 * 60 * 60 * 1000;
    else if (offsetPreset === 'offset_2d') offsetMs = 2 * 24 * 60 * 60 * 1000;
    else if (offsetPreset === 'offset_1w') offsetMs = 7 * 24 * 60 * 60 * 1000;
    else if (offsetPreset === 'offset_2w') offsetMs = 14 * 24 * 60 * 60 * 1000;
    else if (offsetPreset === 'offset_custom') {
      const customAmount = Number(form.querySelector('#reminder-custom-amount')?.value || 0);
      const customUnit = form.querySelector('#reminder-custom-unit')?.value || 'days';
      if (!Number.isFinite(customAmount) || customAmount <= 0) { resetSubmit(t('common.invalidInput')); return; }
      const unitFactor = customUnit === 'minutes' ? 60000 : customUnit === 'hours' ? 3600000 : customUnit === 'days' ? 86400000 : 604800000;
      offsetMs = customAmount * unitFactor;
    }
    const dueDateTime = body.due_time ? new Date(`${dueDate}T${body.due_time}`) : new Date(`${dueDate}T23:59:59`);
    remindAt = new Date(dueDateTime.getTime() - offsetMs).toISOString().slice(0, 19);
  }

  try {
    let savedTaskId = taskId;
    if (taskId) {
      await api.put(`/tasks/${taskId}`, body);
      window.yuvomi.showToast(t('tasks.savedToast'), 'success');
    } else {
      const res = await api.post('/tasks', body);
      savedTaskId = res.data?.id;
      window.yuvomi.showToast(t('tasks.createdToast'), 'success');
    }

    // Erinnerung speichern oder löschen (Vorbedingungen bereits oben geprüft)
    if (savedTaskId) {
      if (wantsReminder) {
        await api.post('/reminders', { entity_type: 'task', entity_id: savedTaskId, remind_at: remindAt });
        refreshReminders();
      } else {
        try {
          await api.delete(`/reminders?entity_type=task&entity_id=${savedTaskId}`);
          refreshReminders();
        } catch { /* kein Reminder vorhanden - ignorieren */ }
      }

      // Dokument-Verknüpfungen als Replace-Set übernehmen (#503).
      try {
        await api.put(`/tasks/${savedTaskId}/documents`, { document_ids: modalDocuments.selected });
      } catch { /* Verknüpfen fehlgeschlagen - nicht blockierend für den Task-Save */ }
    }

    btnSuccess(submitBtn, originalLabel);
    setTimeout(() => closeModal({ force: true }), 700);
    // Erst die Tag-Liste, dann neu zeichnen: ein gerade vergebener Tag soll
    // sofort in Filterleiste und Vorschlägen stehen (#586).
    await refreshTags();
    await loadTasks(container);
  } catch (err) {
    resetSubmit(err.message);
    btnError(submitBtn);
  }
}

async function handleDeleteTask(id, container) {
  closeModal({ force: true });
  const itemEl = container.querySelector(`[data-task-id="${id}"]`);
  if (itemEl) itemEl.style.display = 'none';

  scheduleUndoableDelete({
    message: t('tasks.deletedToast'),
    commit: async ({ keepalive }) => {
      await api.delete(`/tasks/${id}`, { keepalive });
      // Erinnerungen für diese Aufgabe ebenfalls entfernen
      api.delete(`/reminders?entity_type=task&entity_id=${id}`, { keepalive }).catch(() => {});
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      refreshReminders();
      await loadTasks(container);
    },
    restore: (err) => {
      if (itemEl) itemEl.style.display = '';
      if (err) window.yuvomi.showToast(err.message ?? t('common.unknownError'), 'danger');
    },
  });
}

async function handleAddSubtask(parentId, container) {
  const title = await promptModal(t('tasks.subtaskPrompt'));
  if (!title) return;
  try {
    await api.post('/tasks', { title, parent_task_id: parentId });
    await loadTasks(container);
  } catch (err) {
    window.yuvomi.showToast(err.message, 'danger');
  }
}

// --------------------------------------------------------
// Kanban-Ansicht
// --------------------------------------------------------

const KANBAN_COLS = () => [
  { status: 'open',        label: t('tasks.kanbanOpen'),       colorVar: '--color-text-secondary' },
  { status: 'in_progress', label: t('tasks.kanbanInProgress'), colorVar: '--color-warning'        },
  { status: 'done',        label: t('tasks.kanbanDone'),       colorVar: '--color-success'        },
  { status: 'archived',    label: t('tasks.kanbanArchived'),   colorVar: '--color-text-tertiary'  },
];

function kanbanNextStatus(status) {
  if (status === 'open')        return 'in_progress';
  if (status === 'in_progress') return 'done';
  return 'open';
}

function renderKanbanCard(task) {
  const due  = formatDueDate(task.due_date, task.due_time, task.status === 'done' || task.status === 'archived');
  const next = kanbanNextStatus(task.status);
  const icon = next === 'done' ? 'check' : next === 'in_progress' ? 'circle-play' : 'rotate-ccw';
  const nextLabel = next === 'done'
    ? t('tasks.kanbanMoveToDone')
    : next === 'in_progress'
      ? t('tasks.kanbanMoveToInProgress')
      : t('tasks.kanbanMoveToOpen');
  return `
    <div class="kanban-card ${task.status === 'done' ? 'kanban-card--done' : ''}"
         data-task-id="${task.id}" draggable="true">
      <!-- Button statt div: einziger Tastaturweg in die Kartendetails; der
           Board-Klick-Handler fängt ihn über den umschließenden [draggable]. -->
      <button type="button" class="kanban-card__title u-card-title u-compact">${esc(task.title)}</button>
      <div class="kanban-card__meta">
        ${renderPriorityBadge(task.priority)}
        ${due ? `<span class="due-date ${due.cls}"><i data-lucide="clock" class="icon-sm" aria-hidden="true"></i> ${due.label}</span>` : ''}
        ${renderTagBadges(task.tags)}
      </div>
      <div class="kanban-card__footer">
        ${renderAvatarStack(task.assigned_users ?? [], { size: 22 }) || '<span></span>'}
        <button class="kanban-card__status-btn" type="button"
                data-next-status="${next}" title="${nextLabel}" aria-label="${nextLabel}">
          <i data-lucide="${icon}" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
}

function renderKanban(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  const cols = KANBAN_COLS();
  const grouped = {};
  for (const col of cols) grouped[col.status] = [];
  for (const t of filteredTasks()) {
    if (grouped[t.status]) grouped[t.status].push(t);
    else grouped['open'].push(t);
  }

  const now = new Date();
  for (const col of cols) {
    grouped[col.status].sort((a, b) => sortTasks(a, b, now));
  }

  // Bei aktiver Suche ohne Treffer wäre ein Board aus lauter „Keine Aufgaben"-
  // Spalten irreführend (wirkt wie ein leeres Modul statt wie ein leeres Such-
  // ergebnis). Stattdessen ein board-weiter Treffer-Empty analog zur Liste,
  // inkl. expliziter Zurücksetzen-Affordanz (Critique P3).
  const isFiltered   = state.searchQuery.trim().length > 0;
  const totalVisible = cols.reduce((n, c) => n + grouped[c.status].length, 0);
  if (isFiltered && totalVisible === 0) {
    listEl.replaceChildren();
    listEl.insertAdjacentHTML('beforeend', `
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div class="empty-state__title">${t('tasks.noResultsTitle')}</div>
        <div class="empty-state__description">${t('tasks.noResultsDescription', { query: esc(state.searchQuery) })}</div>
        <button class="btn btn--secondary empty-state__cta" id="kanban-reset-search">
          <i data-lucide="x" aria-hidden="true" class="icon-md"></i>
          ${t('common.searchClear')}
        </button>
      </div>`);
    if (window.lucide) window.lucide.createIcons({ el: listEl });
    listEl.querySelector('#kanban-reset-search')?.addEventListener('click', () => {
      state.searchQuery = '';
      const input = container.querySelector('#tasks-search');
      if (input) input.value = '';
      container.querySelector('[data-page-search-clear]')?.setAttribute('hidden', '');
      renderTaskList(container);
    });
    updateOverdueBadge();
    return;
  }

  const kanbanHtml = `
    <div class="kanban-board">
      ${cols.map((col) => `
        <div class="kanban-col" data-status="${col.status}">
          <div class="kanban-col__header">
            <span class="kanban-col__title" style="color:${col.colorVar.startsWith('--') ? `var(${col.colorVar})` : col.colorVar}">
              ${col.label}
            </span>
            <span class="kanban-col__count">${grouped[col.status].length}</span>
          </div>
          <div class="kanban-col__body" data-drop-zone="${col.status}">
            ${grouped[col.status].length
              ? grouped[col.status].map((task) => renderKanbanCard(task)).join('')
              : `<div class="kanban-col__empty">
                   <span class="kanban-col__empty-idle">${t('tasks.kanbanColEmpty')}</span>
                   <span class="kanban-col__empty-drop">${t('tasks.kanbanDropHint')}</span>
                 </div>`}
            <div class="kanban-drop-placeholder" hidden></div>
          </div>
        </div>
      `).join('')}
    </div>`;
  listEl.replaceChildren();
  listEl.insertAdjacentHTML('beforeend', kanbanHtml);

  if (window.lucide) window.lucide.createIcons({ el: listEl });
  wireKanbanDrag(container);
  wireKanbanTouch(container);
  updateOverdueBadge();
}

function wireKanbanDrag(container) {
  const board = container.querySelector('.kanban-board');
  if (!board) return;

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card[data-task-id]');
    if (!card) return;
    state.dragTaskId = card.dataset.taskId;
    card.classList.add('kanban-card--dragging');
    board.classList.add('kanban-board--dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card[data-task-id]');
    if (card) card.classList.remove('kanban-card--dragging');
    board.classList.remove('kanban-board--dragging');
    board.querySelectorAll('.kanban-drop-placeholder').forEach((el) => el.hidden = true);
    board.querySelectorAll('.kanban-col__body--over').forEach((el) =>
      el.classList.remove('kanban-col__body--over')
    );
    state.dragTaskId = null;
  });

  board.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = e.target.closest('[data-drop-zone]');
    if (!zone) return;
    board.querySelectorAll('.kanban-col__body--over').forEach((el) =>
      el.classList.remove('kanban-col__body--over')
    );
    zone.classList.add('kanban-col__body--over');
  });

  board.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('[data-drop-zone]');
    if (zone && !zone.contains(e.relatedTarget)) {
      zone.classList.remove('kanban-col__body--over');
    }
  });

  board.addEventListener('drop', async (e) => {
    e.preventDefault();
    const zone = e.target.closest('[data-drop-zone]');
    if (!zone || !state.dragTaskId) return;
    zone.classList.remove('kanban-col__body--over');

    const newStatus = zone.dataset.dropZone;
    const taskId    = state.dragTaskId;
    const task      = state.tasks.find((t) => String(t.id) === String(taskId));
    if (!task || task.status === newStatus) return;

    // Optimistisches Update
    task.status = newStatus;
    renderKanban(container);

    try {
      await api.patch(`/tasks/${taskId}/status`, { status: newStatus });
      await loadTasks(container); // sync
    } catch (err) {
      window.yuvomi.showToast(err.message, 'danger');
      await loadTasks(container);
    }
  });

  // Klick auf Status-Button: Status ohne Modal wechseln
  board.addEventListener('click', async (e) => {
    const statusBtn = e.target.closest('[data-next-status]');
    if (statusBtn) {
      e.stopPropagation();
      const card      = statusBtn.closest('.kanban-card[data-task-id]');
      if (!card) return;
      const taskId    = card.dataset.taskId;
      const newStatus = statusBtn.dataset.nextStatus;
      const task      = state.tasks.find((t) => String(t.id) === String(taskId));
      if (!task) return;
      task.status = newStatus;
      renderKanban(container);
      try {
        await api.patch(`/tasks/${taskId}/status`, { status: newStatus });
        await loadTasks(container);
      } catch (err) {
        window.yuvomi.showToast(err.message, 'danger');
        await loadTasks(container);
      }
      return;
    }

    // Klick auf Kanban-Card öffnet Edit-Modal
    if (e.target.closest('[draggable]')) {
      const card = e.target.closest('.kanban-card[data-task-id]');
      if (!card) return;
      try {
        const [task, reminder] = await Promise.all([
          loadTaskForEdit(card.dataset.taskId),
          loadReminderForTask(card.dataset.taskId),
        ]);
        openTaskDetail({ task, users: state.users, reminder }, container);
      } catch (err) {
        window.yuvomi.showToast(t('tasks.loadError'), 'danger');
      }
    }
  });
}

// --------------------------------------------------------
// Kanban-Touch-Drag (Mobile)
// --------------------------------------------------------

function wireKanbanTouch(container) {
  const board = container.querySelector('.kanban-board');
  if (!board) return;

  let dragging = null;
  let ghost = null;
  let taskId = null;
  let originX = 0, originY = 0;
  let originLeft = 0, originTop = 0;
  let activeZone = null;
  let started = false;

  function cleanup() {
    ghost?.remove();
    ghost = null;
    board.classList.remove('kanban-board--dragging');
    if (dragging) {
      dragging.classList.remove('kanban-card--dragging');
      dragging = null;
    }
    board.querySelectorAll('.kanban-col__body--over').forEach((el) =>
      el.classList.remove('kanban-col__body--over')
    );
    activeZone = null;
    started = false;
    taskId = null;
  }

  board.addEventListener('touchstart', (e) => {
    const card = e.target.closest('.kanban-card[data-task-id]');
    if (!card || e.target.closest('[data-next-status]')) return;
    dragging = card;
    taskId = card.dataset.taskId;
    const touch = e.touches[0];
    originX = touch.clientX;
    originY = touch.clientY;
    const rect = card.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    started = false;
  }, { passive: true });

  board.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - originX;
    const dy = touch.clientY - originY;

    if (!started && Math.sqrt(dx * dx + dy * dy) < 8) return;

    if (!started) {
      started = true;
      ghost = dragging.cloneNode(true);
      ghost.className = 'kanban-card kanban-card--ghost';
      ghost.style.width = dragging.getBoundingClientRect().width + 'px';
      ghost.style.left = originLeft + 'px';
      ghost.style.top = originTop + 'px';
      document.body.appendChild(ghost);
      dragging.classList.add('kanban-card--dragging');
      board.classList.add('kanban-board--dragging');
    }

    e.preventDefault();
    ghost.style.left = (originLeft + dx) + 'px';
    ghost.style.top = (originTop + dy) + 'px';

    ghost.style.visibility = 'hidden';
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    ghost.style.visibility = '';

    const zone = el?.closest('[data-drop-zone]');
    board.querySelectorAll('.kanban-col__body--over').forEach((z) =>
      z.classList.remove('kanban-col__body--over')
    );
    if (zone) {
      zone.classList.add('kanban-col__body--over');
      activeZone = zone;
    } else {
      activeZone = null;
    }
  }, { passive: false });

  board.addEventListener('touchend', async () => {
    if (!dragging) return;
    const zone = activeZone;
    const tid = taskId;
    const task = state.tasks.find((tk) => String(tk.id) === String(tid));
    cleanup();

    if (!zone || !task) return;
    const newStatus = zone.dataset.dropZone;
    if (task.status === newStatus) return;

    task.status = newStatus;
    renderKanban(container);
    try {
      await api.patch(`/tasks/${tid}/status`, { status: newStatus });
      await loadTasks(container);
    } catch (err) {
      window.yuvomi.showToast(err.message, 'danger');
      await loadTasks(container);
    }
  }, { passive: true });

  board.addEventListener('touchcancel', cleanup, { passive: true });
}

// --------------------------------------------------------
// Partielle DOM-Updates
// --------------------------------------------------------

function renderTaskList(container) {
  if (state.viewMode === 'kanban') {
    renderKanban(container);
    return;
  }
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;
  listEl.replaceChildren();
  listEl.insertAdjacentHTML('beforeend', renderTaskGroups(filteredTasks(), state.groupMode));
  if (window.lucide) window.lucide.createIcons({ el: listEl });
  stagger(listEl.querySelectorAll('.swipe-row, .kanban-card'));
  updateOverdueBadge();
  updateBulkActionsBar(container);
  wireSwipeGestures(container);
  maybeShowSwipeHint(container);
  listEl.querySelector('#empty-cta-tasks')?.addEventListener('click', () => {
    document.querySelector('.page-fab')?.click();
  });
}

function makeRemoveSpan() {
  const rm = document.createElement('span');
  rm.className = 'filter-chip__remove';
  rm.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', 'x');
  icon.className = 'icon-sm';
  rm.appendChild(icon);
  return rm;
}

/**
 * Ein Filter-Chip. Immer ein <button> — die Chips schalten Filter, sind also
 * Bedienelemente und müssen fokussierbar sein und ihren Zustand melden.
 * Dokumente und Kontakte rendern dieselbe .filter-chip-Klasse ebenfalls als
 * Button mit aria-pressed; hier lag zuvor ein <span> ohne Tastaturzugang.
 *
 * pressed === null markiert Aktions-Chips (zuletzt verwendete Filter), die
 * keinen Ein/Aus-Zustand haben und daher kein aria-pressed tragen dürfen.
 */
function makeChip({ label, active = false, extraClass = '', pressed = undefined, withRemove = false }) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `filter-chip${active ? ' filter-chip--active' : ''}${extraClass ? ` ${extraClass}` : ''}`;
  if (pressed !== null) chip.setAttribute('aria-pressed', String(pressed ?? active));
  // Das Entfernen-X ist aria-hidden (Dekor im selben Button); die Entfernen-
  // Aktion muss deshalb in den Accessible Name des Chips selbst.
  if (withRemove && label != null) {
    chip.setAttribute('aria-label', t('tasks.removeFilter', { label }));
  }
  if (label != null) chip.appendChild(document.createTextNode(label));
  if (withRemove) chip.appendChild(makeRemoveSpan());
  return chip;
}

function renderFilters(container) {
  const bar   = container.querySelector('#filter-bar');
  const panel = container.querySelector('#filter-panel');
  if (!bar || !panel) return;

  const statusLabels   = STATUS_LABELS();
  const priorityLabels = PRIORITY_LABELS();
  // Im Kanban ist der Statusfilter unwirksam (die Spalten SIND der Status) und
  // wird nicht als Chip gezeigt - daher auch nicht mitzählen, sonst behauptet
  // "Filter N" einen unsichtbaren Filter (Audit P3).
  const activeCount    = [
    state.viewMode === 'kanban' ? '' : state.filters.status,
    state.filters.priority,
    state.filters.assigned_to,
  ].filter(Boolean).length + state.filters.tags.length;

  // ---- Chip-Leiste: nur aktive Filter + Toggle-Button ----
  bar.replaceChildren();

  if (state.filters.status && state.viewMode !== 'kanban') {
    const chip = makeChip({ label: statusLabels[state.filters.status], active: true, withRemove: true });
    chip.dataset.filter = 'status';
    bar.appendChild(chip);
  }
  if (state.filters.priority) {
    const chip = makeChip({ label: priorityLabels[state.filters.priority], active: true, withRemove: true });
    chip.dataset.filter = 'priority';
    bar.appendChild(chip);
  }
  // Aktiver Personen-Filter — außer es ist die eigene ID, die deckt der
  // dedizierte „Mir zugewiesen"-Chip ab (keine Doppel-Anzeige).
  if (state.filters.assigned_to && !isAssignedToMe()) {
    const u = state.users.find((u) => u.id === Number(state.filters.assigned_to));
    const chip = makeChip({
      label: u?.display_name ?? t('tasks.filterGroupPerson'),
      active: true,
      withRemove: true,
    });
    chip.dataset.filter = 'assigned_to';
    bar.appendChild(chip);
  }
  // Ein Chip je gewähltem Tag. Jeder trägt seinen eigenen Wert, damit das
  // Entfernen genau diesen einen löst und nicht die ganze Auswahl.
  state.filters.tags.forEach((tag) => {
    const chip = makeChip({ label: tag, active: true, withRemove: true });
    chip.dataset.filter = 'tag';
    chip.dataset.value = tag;
    bar.appendChild(chip);
  });

  // "Mir zugewiesen" Schnellzugriff — nur sinnvoll bei mehreren Familienmitgliedern.
  // Icon+Label bewusst identisch zum Kalender-Toggle (gleiche Fähigkeit, eine Gestalt).
  if (state.users.length > 1 && state.currentUserId != null) {
    const meActive = isAssignedToMe();
    const meChip = makeChip({ label: null, active: meActive, extraClass: 'filter-chip--toggle' });
    meChip.id = 'filter-assigned-me';
    const meIcon = document.createElement('i');
    meIcon.setAttribute('data-lucide', 'user');
    meIcon.className = 'icon-sm';
    meIcon.setAttribute('aria-hidden', 'true');
    const meLabel = document.createElement('span');
    meLabel.textContent = t('tasks.assignedToMe');
    meChip.append(meIcon, meLabel);
    if (meActive) meChip.appendChild(makeRemoveSpan());
    bar.appendChild(meChip);
  }

  // "Geplante anzeigen" Toggle-Chip — Icon+Label wie „Mir zugewiesen" (beide Toggles).
  const futureChip = makeChip({ label: null, active: state.showFuture, extraClass: 'filter-chip--toggle' });
  futureChip.id = 'filter-show-future';
  const futureIcon = document.createElement('i');
  futureIcon.setAttribute('data-lucide', 'calendar-clock');
  futureIcon.className = 'icon-sm';
  futureIcon.setAttribute('aria-hidden', 'true');
  const futureLabel = document.createElement('span');
  futureLabel.textContent = t('tasks.showFuture');
  futureChip.append(futureIcon, futureLabel);
  if (state.showFuture) {
    futureChip.appendChild(makeRemoveSpan());
  }
  bar.appendChild(futureChip);

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'filter-toggle-btn';
  toggleBtn.className = `filter-toggle-btn${state.filterPanelOpen ? ' filter-toggle-btn--open' : ''}${activeCount > 0 ? ' filter-toggle-btn--active' : ''}`;
  toggleBtn.setAttribute('aria-expanded', String(state.filterPanelOpen));
  toggleBtn.setAttribute('aria-controls', 'filter-panel');

  const iconWrap = document.createElement('i');
  iconWrap.setAttribute('data-lucide', 'sliders-horizontal');
  iconWrap.className = 'icon-sm';
  iconWrap.setAttribute('aria-hidden', 'true');
  toggleBtn.appendChild(iconWrap);

  const label = document.createElement('span');
  label.textContent = t('tasks.filterBtn');
  toggleBtn.appendChild(label);

  if (activeCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'filter-toggle-btn__count';
    badge.textContent = String(activeCount);
    toggleBtn.appendChild(badge);
  }

  bar.appendChild(toggleBtn);

  // ---- Zuletzt verwendete Filter als Quick-Chips ----
  const statusLabelsMap   = STATUS_LABELS();
  const priorityLabelsMap = PRIORITY_LABELS();
  const recent = getRecentFilters();
  recent.forEach((f) => {
    const parts = [];
    if (f.status)      parts.push(statusLabelsMap[f.status]   ?? f.status);
    if (f.priority)    parts.push(priorityLabelsMap[f.priority] ?? f.priority);
    if (f.assigned_to) {
      const u = state.users.find((u) => u.id === Number(f.assigned_to));
      if (u) parts.push(u.display_name);
    }
    // Die Tags gehören in die Beschriftung, weil der Chip sie beim Klick
    // mitsetzt: ohne sie hieße ein Chip „Offen" und schaltete zusätzlich
    // Tag-Filter, die niemand am Chip ablesen kann (#586).
    parts.push(...f.tags);
    if (!parts.length) return;
    // Aktions-Chip (wendet ein Filter-Set an), kein Ein/Aus-Zustand → pressed:null.
    const chip = makeChip({ label: parts.join(' · '), extraClass: 'filter-chip--recent', pressed: null });
    chip.dataset.recentFilter = JSON.stringify(f);
    bar.appendChild(chip);
  });

  if (window.lucide) window.lucide.createIcons({ el: bar });

  // ---- Filter-Panel: Gruppen mit allen Optionen ----
  panel.hidden = !state.filterPanelOpen;
  panel.replaceChildren();

  if (state.filterPanelOpen) {
    // Im Kanban entfällt die Status-Gruppe: die Spalten übernehmen diese
    // Achse bereits (Audit A1-07).
    const groups = [
      ...(state.viewMode !== 'kanban' ? [{
        key: 'status',
        label: t('tasks.filterGroupStatus'),
        items: STATUSES().map((s) => ({ value: s.value, label: s.label })),
      }] : []),
      {
        key: 'priority',
        label: t('tasks.filterGroupPriority'),
        items: PRIORITIES().map((p) => ({ value: p.value, label: p.label })),
      },
    ];
    if (state.users.length > 1) {
      groups.push({
        key: 'assigned_to',
        label: t('tasks.filterGroupPerson'),
        items: state.users.map((u) => ({ value: String(u.id), label: u.display_name })),
      });
    }
    // Tags nur anbieten, wenn welche vergeben sind — ohne CalDAV-Spiegel und ohne
    // eigene Vergabe bleibt die Gruppe sonst als leere Zeile stehen (#586).
    if (state.allTags.length) {
      groups.push({
        key: 'tag',
        label: t('tasks.filterGroupTag'),
        items: state.allTags.map((entry) => ({ value: entry.tag, label: entry.tag })),
      });
    }

    groups.forEach((group) => {
      const section = document.createElement('div');
      section.className = 'filter-panel__group';
      section.setAttribute('role', 'group');
      section.setAttribute('aria-label', group.label);

      const heading = document.createElement('div');
      heading.className = 'filter-panel__label';
      heading.textContent = group.label;
      section.appendChild(heading);

      const row = document.createElement('div');
      row.className = 'filter-panel__chips';

      group.items.forEach((item) => {
        // Tags sind die einzige Gruppe mit Mehrfachauswahl - dort entscheidet
        // die Zugehörigkeit zur Liste, sonst die Gleichheit mit dem einen Wert.
        const isActive = group.key === 'tag'
          ? hasTagFilter(item.value)
          : state.filters[group.key] === item.value;
        const chip = makeChip({ label: item.label, active: isActive, withRemove: isActive });
        chip.dataset.filter = group.key;
        chip.dataset.value = item.value;
        row.appendChild(chip);
      });

      section.appendChild(row);
      panel.appendChild(section);
    });

    if (activeCount > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'filter-panel__clear';
      clearBtn.id = 'filter-clear-all';
      clearBtn.textContent = t('tasks.filterClearAll');
      panel.appendChild(clearBtn);
    }
    if (window.lucide) window.lucide.createIcons({ el: panel });
  }

  wireFilterChips(container);
}

function updateOverdueBadge() {
  const overdue = state.tasks.filter((t) => {
    if (!t.due_date || t.status === 'done') return false;
    return new Date(t.due_date) < new Date().setHours(0, 0, 0, 0);
  }).length;

  document.querySelectorAll('[data-route="/tasks"] .nav-badge').forEach((el) => el.remove());
  document.querySelectorAll('[data-route="/tasks"]').forEach((navItem) => {
    const baseLabel = t('tasks.title');
    navItem.setAttribute('aria-label', overdue > 0
      ? t('tasks.navLabelOverdue', { count: overdue })
      : baseLabel
    );
  });
  if (overdue > 0) {
    document.querySelectorAll('[data-route="/tasks"]').forEach((navItem) => {
      let anchor = navItem.querySelector('.nav-item__icon-wrap');
      if (!anchor) {
        const icon = navItem.querySelector('.nav-item__icon');
        anchor = document.createElement('span');
        anchor.className = 'nav-item__icon-wrap';
        if (icon) {
          icon.replaceWith(anchor);
          anchor.appendChild(icon);
        } else {
          navItem.prepend(anchor);
        }
      }
      const badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = String(overdue);
      anchor.appendChild(badge);
    });
  }
}

// --------------------------------------------------------
// Swipe-Gesten (Mobil: links = erledigt, rechts = bearbeiten)
// --------------------------------------------------------

const SWIPE_THRESHOLD    = 80;   // px - Mindestweg für Aktion
const SWIPE_MAX_VERT     = 12;   // px - vertikaler Bewegungs-Toleranzbereich (darunter: kein Scroll-Abbruch)
const SWIPE_LOCK_VERT    = 30;   // px - ab diesem Weg gilt es als Scroll (Swipe abgebrochen)

const SWIPE_HINT_KEY  = 'yuvomi:swipeHintSeen';
const SWIPE_HINT_MAX  = 3;
const RECENT_FILTERS_KEY = 'yuvomi:recentTaskFilters';
const RECENT_FILTERS_MAX = 3;
const SHOW_FUTURE_KEY = 'yuvomi:taskShowFuture';
const ASSIGNED_TO_ME_KEY = 'yuvomi:taskAssignedToMe';

// „Mir zugewiesen" ist ein Schnellzugriff auf den assigned_to-Filter mit der
// eigenen User-ID. Wird pro Gerät gemerkt und beim Laden aus dem gespeicherten
// assigned_to-Wert (== eigene ID) abgeleitet, damit Panel-Auswahl und Chip synchron bleiben.
function isAssignedToMe() {
  return state.currentUserId != null
    && String(state.filters.assigned_to) === String(state.currentUserId);
}

function persistAssignedToMe() {
  try { localStorage.setItem(ASSIGNED_TO_ME_KEY, isAssignedToMe() ? '1' : '0'); } catch {}
}

/** Ist dieser Tag gerade gefiltert? Schreibweise zählt dabei nicht. */
function hasTagFilter(tag) {
  const key = String(tag).toLowerCase();
  return state.filters.tags.some((active) => active.toLowerCase() === key);
}

/**
 * Tag im Filter an- oder abwählen. Mehrere Tags engen UND-verknüpft ein, also
 * fügt ein Klick hinzu statt zu ersetzen.
 */
async function toggleTagFilter(tag, container) {
  const key = String(tag).toLowerCase();
  state.filters.tags = hasTagFilter(tag)
    ? state.filters.tags.filter((active) => active.toLowerCase() !== key)
    : [...state.filters.tags, tag];
  if (state.filters.tags.length) saveRecentFilter(state.filters);
  renderFilters(container);
  await loadTasks(container);
}

/**
 * Ein gespeichertes Filter-Set auf die aktuelle Form bringen.
 *
 * `tag` als einzelner String stammt aus den Einträgen, die vor der
 * Mehrfachauswahl im localStorage gelandet sind. Ohne die Umschreibung wäre
 * `state.filters.tags` dort kein Array, und der erste `.forEach` darauf risse
 * die Seite auf - für einen Wert, den niemand mehr absichtlich gesetzt hat.
 */
function normalizeFilterSet(f = {}) {
  const tags = Array.isArray(f.tags) ? f.tags : (f.tag ? [f.tag] : []);
  return {
    status:      f.status || '',
    priority:    f.priority || '',
    assigned_to: f.assigned_to || '',
    tags:        tags.filter(Boolean),
  };
}

function getRecentFilters() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILTERS_KEY) ?? '[]').map(normalizeFilterSet);
  } catch { return []; }
}

function saveRecentFilter(filters) {
  const set = normalizeFilterSet(filters);
  if (!set.status && !set.priority && !set.assigned_to && !set.tags.length) return;
  // Der Tag-Teil gehört in den Schlüssel: sonst verdrängte „Offen + Garten"
  // den Eintrag „Offen + Haus", weil beide auf dieselbe Kennung fielen.
  const keyOf = (f) => [f.status, f.priority, f.assigned_to,
    f.tags.map((t) => t.toLowerCase()).sort().join(',')].join('|');
  const key = keyOf(set);
  const recent = getRecentFilters().filter((f) => keyOf(f) !== key);
  recent.unshift(set);
  try { localStorage.setItem(RECENT_FILTERS_KEY, JSON.stringify(recent.slice(0, RECENT_FILTERS_MAX))); } catch {}
}

function wireSwipeGestures(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  listEl.querySelectorAll('.swipe-row').forEach((row) => {
    let startX = 0, startY = 0;
    let dx = 0;
    let locked = false;    // false = unentschieden, 'swipe' | 'scroll'
    let thresholdHit = false; // Haptic-Feedback am Threshold nur einmal
    const card = row.querySelector('.task-card');
    if (!card) return;

    function resetCard(animate = true) {
      card.style.transition = animate ? 'transform 0.25s ease' : '';
      card.style.transform  = '';
      row.classList.remove('swipe-row--swiping');
      // Reveal-Panels zurücksetzen
      row.querySelector('.swipe-reveal--done').style.opacity = '0';
      row.querySelector('.swipe-reveal--edit').style.opacity = '0';
    }

    row.addEventListener('touchstart', (e) => {
      // Geste ignorieren wenn Modal offen
      if (document.getElementById('shared-modal-overlay')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx     = 0;
      locked = false;
      thresholdHit = false;
      card.style.transition = '';
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (locked === 'scroll') return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      dx = currentX - startX;
      const dy = Math.abs(currentY - startY);

      // Scroll-Richtung früh erkennen
      if (locked === false) {
        if (dy > SWIPE_MAX_VERT && Math.abs(dx) < dy) {
          locked = 'scroll';
          resetCard(false);
          return;
        }
        if (Math.abs(dx) > SWIPE_MAX_VERT) {
          locked = 'swipe';
        }
      }

      if (locked !== 'swipe') return;

      // Vertikalen Scroll verhindern sobald Swipe erkannt
      if (dy < SWIPE_LOCK_VERT) e.preventDefault();

      // Karte verschieben (gedämpft nach THRESHOLD)
      const dampened = dx > 0
        ? Math.min(dx, SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * 0.2)
        : Math.max(dx, -(SWIPE_THRESHOLD + (-dx - SWIPE_THRESHOLD) * 0.2));

      card.style.transform = `translateX(${dampened}px)`;
      row.classList.add('swipe-row--swiping');

      // Reveal-Panels einblenden (0 → 1 über Threshold)
      const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      if (dx < 0) {
        row.querySelector('.swipe-reveal--done').style.opacity = String(progress);
        row.querySelector('.swipe-reveal--edit').style.opacity = '0';
      } else {
        row.querySelector('.swipe-reveal--edit').style.opacity = String(progress);
        row.querySelector('.swipe-reveal--done').style.opacity = '0';
      }

      // Haptic-Feedback beim Erreichen des Schwellwerts
      if (!thresholdHit && Math.abs(dx) >= SWIPE_THRESHOLD) {
        thresholdHit = true;
        vibrate(15);
      }
    }, { passive: false });

    row.addEventListener('touchend', async () => {
      if (locked !== 'swipe') { resetCard(false); return; }

      const taskId = row.dataset.swipeId;
      const status = row.dataset.swipeStatus;

      if (dx < -SWIPE_THRESHOLD) {
        // Swipe links → Status-Toggle (offen ↔ erledigt)
        card.style.transition = 'transform 0.2s ease';
        card.style.transform  = 'translateX(-110%)';
        vibrate(40);
        const capturedStatus = status;
        const nextStatus = capturedStatus === 'done' ? 'open' : 'done';
        setTimeout(async () => {
          resetCard(false);
          try {
            await toggleTaskStatus(taskId, capturedStatus);
            await loadTasks(container);
            window.yuvomi.showToast(
              t(nextStatus === 'done' ? 'tasks.swipedDoneToast' : 'tasks.swipedOpenToast'),
              'default',
              5000,
              async () => {
                try {
                  await toggleTaskStatus(taskId, nextStatus);
                  await loadTasks(container);
                } catch (err) {
                  window.yuvomi.showToast(err.message, 'danger');
                }
              },
            );
          } catch (err) {
            window.yuvomi.showToast(err.message, 'danger');
            await loadTasks(container);
          }
        }, 200);

      } else if (dx > SWIPE_THRESHOLD) {
        // Swipe rechts → Detailansicht
        resetCard(true);
        vibrate(20);
        try {
          const [task, reminder] = await Promise.all([
            loadTaskForEdit(taskId),
            loadReminderForTask(taskId),
          ]);
          openTaskDetail({ task, users: state.users, reminder }, container);
        } catch (err) {
          window.yuvomi.showToast(t('tasks.loadError'), 'danger');
        }

      } else {
        resetCard(true);
      }
    }, { passive: true });
  });
}

// --------------------------------------------------------
// Swipe-Affordance Hint (Long Loop)
// Zeigt den Nudge-Hinweis maximal 3x (gespeichert in localStorage).
// --------------------------------------------------------

function maybeShowSwipeHint(container) {
  if (window.innerWidth >= 1024) return; // Desktop: Swipe nicht relevant
  const count = parseInt(localStorage.getItem(SWIPE_HINT_KEY) ?? '0', 10);
  if (count >= SWIPE_HINT_MAX) return;

  const firstRow = container.querySelector('.swipe-row');
  if (!firstRow) return;

  firstRow.classList.add('swipe-row--hint');
  firstRow.addEventListener('animationend', () => {
    firstRow.classList.remove('swipe-row--hint');
  }, { once: true });

  localStorage.setItem(SWIPE_HINT_KEY, String(count + 1));
}

// --------------------------------------------------------
// Event-Verdrahtung
// --------------------------------------------------------

function wireFilterChips(container) {
  // Toggle-Button öffnet/schließt das Panel
  container.querySelector('#filter-toggle-btn')?.addEventListener('click', () => {
    state.filterPanelOpen = !state.filterPanelOpen;
    renderFilters(container);
  });

  // Alle Filter zurücksetzen
  container.querySelector('#filter-clear-all')?.addEventListener('click', async () => {
    state.filters = { status: '', priority: '', assigned_to: '', tags: [] };
    renderFilters(container);
    await loadTasks(container);
  });

  // "Geplante anzeigen" Toggle
  container.querySelector('#filter-show-future')?.addEventListener('click', async () => {
    state.showFuture = !state.showFuture;
    try { localStorage.setItem(SHOW_FUTURE_KEY, state.showFuture ? '1' : '0'); } catch {}
    renderFilters(container);
    await loadTasks(container);
  });

  // "Mir zugewiesen" Toggle — schaltet assigned_to auf die eigene ID
  container.querySelector('#filter-assigned-me')?.addEventListener('click', async () => {
    state.filters.assigned_to = isAssignedToMe() ? '' : String(state.currentUserId);
    renderFilters(container);
    await loadTasks(container);
  });

  // Chip-Klicks (in Bar + Panel)
  container.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const filter = chip.dataset.filter;
      if (filter === 'tag') {
        await toggleTagFilter(chip.dataset.value, container);
        return;
      }
      if (chip.classList.contains('filter-chip--active')) {
        state.filters[filter] = '';
      } else {
        state.filters[filter] = chip.dataset.value;
        saveRecentFilter(state.filters);
      }
      renderFilters(container);
      await loadTasks(container);
    });
  });

  // Recent-Filter-Chips anwenden
  container.querySelectorAll('[data-recent-filter]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      try {
        state.filters = normalizeFilterSet(JSON.parse(chip.dataset.recentFilter));
      } catch { return; }
      renderFilters(container);
      await loadTasks(container);
    });
  });
}

function wireViewToggle(container) {
  const toggle = container.querySelector('#view-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.view;
      localStorage.setItem('yuvomi-tasks-view', state.viewMode);
      renderFilters(container);
      toggle.querySelectorAll('[data-view]').forEach((b) => {
        const on = b.dataset.view === state.viewMode;
        b.classList.toggle('group-toggle__btn--active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      // Sichtbarkeit über [hidden] statt style.display: ein Zustand, den auch
      // assistive Technik als „nicht vorhanden" liest.
      const groupToggle = container.querySelector('#group-mode-toggle');
      if (groupToggle) groupToggle.hidden = state.viewMode !== 'list';
      const bulkSelectBtn = container.querySelector('#btn-bulk-select');
      if (bulkSelectBtn) {
        bulkSelectBtn.hidden = state.viewMode !== 'list';
        if (state.viewMode === 'kanban') {
          state.bulkSelectMode = false;
          state.selectedTaskIds.clear();
          bulkSelectBtn.classList.remove('btn--active');
          bulkSelectBtn.setAttribute('aria-pressed', 'false');
        }
      }
      // Skeleton-Flash: einen Frame Render-Feedback geben, dann Ansicht aufbauen
      const listEl = container.querySelector('#task-list');
      if (listEl) listEl.style.opacity = '0.4';
      requestAnimationFrame(() => {
        // Task-Menge neu laden: der Kanban lädt alle Stati (kein status-Param),
        // die Liste wendet den Statusfilter wieder an (Audit A1-07/P3). Fällt bei
        // Netzfehler auf ein reines Re-Render der vorhandenen Aufgaben zurück.
        loadTasks(container).catch(() => renderTaskList(container)).finally(() => {
          updateBulkActionsBar(container);
          const el = container.querySelector('#task-list');
          if (el) { el.style.transition = 'opacity 0.15s'; el.style.opacity = ''; }
        });
      });
    });
  });
}

function wireGroupToggle(container) {
  const toggle = container.querySelector('#group-mode-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.group-toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.groupMode = btn.dataset.mode;
      toggle.querySelectorAll('.group-toggle__btn').forEach((b) => {
        const on = b.dataset.mode === state.groupMode;
        b.classList.toggle('group-toggle__btn--active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      renderTaskList(container);
    });
  });
}

function wireNewTaskBtn(container) {
  const handler = () => {
    openTaskModal({ users: state.users }, container);
  };
  container.querySelector('#btn-new-task')?.addEventListener('click', handler);
  container.querySelector('#fab-new-task')?.addEventListener('click', handler);
}

function updateBulkActionsBar(container) {
  const bar = container.querySelector('#bulk-actions-bar');
  const count = container.querySelector('#bulk-count');
  if (!bar) return;

  const selected = state.selectedTaskIds.size;
  const buttons = bar.querySelectorAll('button[id^="bulk-"]');

  bar.hidden = !(state.bulkSelectMode && selected > 0);
  bar.classList.toggle('bulk-actions-bar--active', selected > 0);
  buttons.forEach((button) => {
    button.disabled = selected === 0;
  });

  if (count) {
    count.textContent = t('tasks.bulkSelectedCount', { count: selected });
  }
}

function wireBulkSelect(container) {
  const toggleBtn = container.querySelector('#btn-bulk-select');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    state.bulkSelectMode = !state.bulkSelectMode;
    if (!state.bulkSelectMode) {
      state.selectedTaskIds.clear();
    }
    toggleBtn.classList.toggle('btn--active', state.bulkSelectMode);
    toggleBtn.setAttribute('aria-pressed', String(state.bulkSelectMode));
    loadTasks(container);
  });
}

function wireBulkCheckboxes(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  listEl.addEventListener('change', (e) => {
    const checkbox = e.target.closest('.task-bulk-checkbox');
    if (!checkbox) return;

    const taskId = Number(checkbox.dataset.taskId);
    if (checkbox.checked) {
      state.selectedTaskIds.add(taskId);
    } else {
      state.selectedTaskIds.delete(taskId);
    }
    updateBulkActionsBar(container);
  });
}

function wireBulkActions(container) {
  const bar = container.querySelector('#bulk-actions-bar');
  if (!bar) return;

  bar.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[id^="bulk-"]');
    if (!btn) return;

    const taskIds = [...state.selectedTaskIds];
    if (taskIds.length === 0) return;

    const action = btn.id;

    // Löschen läuft über dasselbe Optimistic-Undo-Muster wie der Einzel-Delete
    // (kein ungestylter window.confirm, immer rückgängig machbar — Critique P1).
    if (action === 'bulk-delete') {
      handleBulkDelete(taskIds, container);
      return;
    }

    if (action === 'bulk-tag-add' || action === 'bulk-tag-remove') {
      openBulkTagDialog(taskIds, action === 'bulk-tag-add' ? 'add' : 'remove', container);
      return;
    }

    try {
      if (action === 'bulk-mark-done' || action === 'bulk-mark-open') {
        const status = btn.dataset.status;
        await Promise.all(taskIds.map(id => api.patch(`/tasks/${id}/status`, { status })));
        window.yuvomi.showToast(t('tasks.bulkStatusChanged'), 'success');
      } else if (action === 'bulk-archive') {
        await Promise.all(taskIds.map(id => api.patch(`/tasks/${id}/status`, { status: 'archived' })));
        window.yuvomi.showToast(t('tasks.bulkArchived'), 'success');
      }

      state.selectedTaskIds.clear();
      updateBulkActionsBar(container);
      await loadTasks(container);
    } catch (err) {
      window.yuvomi.showToast(err.message ?? t('common.errorGeneric'), 'danger');
    }
  });
}

// Bulk-Delete mit Optimistic-Update + Undo-Toast — spiegelt handleDeleteTask
// für mehrere Aufgaben: Karten sofort ausblenden, 5s Undo-Fenster, dann erst
// die API-Aufrufe. Ersetzt den nativen window.confirm-Dialog (Critique P1).
function handleBulkDelete(taskIds, container) {
  const els = taskIds
    .map(id => container.querySelector(`[data-task-id="${id}"]`))
    .filter(Boolean);
  const prevDisplay = new Map();
  els.forEach(el => { prevDisplay.set(el, el.style.display); el.style.display = 'none'; });

  state.selectedTaskIds.clear();
  updateBulkActionsBar(container);

  const restore = () => els.forEach(el => { el.style.display = prevDisplay.get(el) ?? ''; });

  scheduleUndoableDelete({
    message: t('tasks.bulkDeleted'),
    commit: async ({ keepalive }) => {
      await Promise.all(taskIds.map(id => api.delete(`/tasks/${id}`, { keepalive })));
      taskIds.forEach(id => api.delete(`/reminders?entity_type=task&entity_id=${id}`, { keepalive }).catch(() => {}));
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      refreshReminders();
      await loadTasks(container);
    },
    restore: (err) => {
      restore();
      if (err) window.yuvomi.showToast(err.message ?? t('common.unknownError'), 'danger');
    },
  });
}

function wireTaskList(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  listEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id     = target.dataset.id;

    if (action === 'toggle-status') {
      const status = target.dataset.status;
      vibrate(15);
      target.classList.toggle('task-status-btn--done', status !== 'done');
      target.closest('.task-card')?.classList.toggle('task-card--done', status !== 'done');
      try {
        await toggleTaskStatus(id, status);
        await loadTasks(container);
      } catch (err) {
        window.yuvomi.showToast(err.message, 'danger');
        await loadTasks(container);
      }
    }

    if (action === 'toggle-subtasks') {
      const subtaskList = document.getElementById(`subtasks-${id}`);
      if (subtaskList) {
        const open = subtaskList.classList.toggle('subtask-list--visible');
        target.setAttribute('aria-expanded', String(open));
      }
    }

    if (action === 'toggle-subtask') {
      try {
        await toggleSubtaskStatus(id, target.dataset.status);
        await loadTasks(container);
      } catch (err) {
        window.yuvomi.showToast(err.message, 'danger');
      }
    }

    if (action === 'edit-task' || action === 'open-task') {
      try {
        const [task, reminder] = await Promise.all([
          loadTaskForEdit(id),
          loadReminderForTask(id),
        ]);
        openTaskDetail({ task, users: state.users, reminder }, container);
      } catch (err) {
        window.yuvomi.showToast(t('tasks.loadError'), 'danger');
      }
    }

    if (action === 'archive-task') {
      try {
        await api.patch(`/tasks/${id}/status`, { status: 'archived' });
        window.yuvomi.showToast(t('tasks.archivedToast'), 'success');
        await loadTasks(container);
      } catch (err) {
        window.yuvomi.showToast(err.message, 'danger');
      }
    }

    if (action === 'add-subtask') {
      await handleAddSubtask(target.dataset.parent, container);
    }
  });
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  state.currentUserId = user?.id ?? null;

  // „Mir zugewiesen" pro Gerät wiederherstellen (setzt assigned_to auf die eigene ID)
  try {
    if (state.currentUserId != null && localStorage.getItem(ASSIGNED_TO_ME_KEY) === '1') {
      state.filters.assigned_to = String(state.currentUserId);
    }
  } catch {}

  // View-Mode: URL-Parameter > localStorage > Default 'list'
  const urlView = new URLSearchParams(window.location.search).get('view');
  const savedView = localStorage.getItem('yuvomi-tasks-view');
  state.viewMode = (urlView === 'kanban' || urlView === 'list') ? urlView
    : (savedView === 'kanban' || savedView === 'list') ? savedView
    : 'list';

  // showFuture aus localStorage wiederherstellen
  try { state.showFuture = localStorage.getItem(SHOW_FUTURE_KEY) === '1'; } catch {}

  const isKanban = state.viewMode === 'kanban';

  // Initiales Skeleton (all values are from i18n keys or hardcoded constants, no user data)
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="tasks-page">
      <div class="page-toolbar page-toolbar--wrap tasks-toolbar">
        <h1 class="page-toolbar__title">${t('tasks.title')}</h1>
        ${renderPageSearch({
          id: 'tasks-search',
          label: t('tasks.searchPlaceholder'),
          placeholder: t('tasks.searchPlaceholder'),
          value: state.searchQuery,
          clearLabel: t('common.searchClear'),
          className: 'tasks-toolbar__search page-toolbar__center',
        })}
        <div class="page-toolbar__actions">
          <div class="group-toggle" id="view-toggle" role="group" aria-label="${t('tasks.viewToggleLabel')}">
            <button type="button" class="group-toggle__btn ${isKanban ? '' : 'group-toggle__btn--active'}" data-view="list"
                    title="${t('tasks.listView')}" aria-label="${t('tasks.listView')}" aria-pressed="${!isKanban}">
              <i data-lucide="list" class="icon-md" aria-hidden="true"></i>
            </button>
            <button type="button" class="group-toggle__btn ${isKanban ? 'group-toggle__btn--active' : ''}" data-view="kanban"
                    title="${t('tasks.kanbanView')}" aria-label="${t('tasks.kanbanView')}" aria-pressed="${isKanban}">
              <i data-lucide="columns" class="icon-md" aria-hidden="true"></i>
            </button>
          </div>
          <button class="btn btn--ghost btn--icon" id="btn-bulk-select" ${isKanban ? 'hidden' : ''}
                  title="${t('tasks.bulkSelect')}" aria-label="${t('tasks.bulkSelect')}" aria-pressed="false">
            <i data-lucide="list-checks" class="icon-lg" aria-hidden="true"></i>
          </button>
          <button class="btn btn--icon btn--ghost" id="btn-manage-categories"
                  aria-label="${t('tasks.manageCategories')}" title="${t('tasks.manageCategories')}">
            <i data-lucide="folder-tree" class="icon-lg" aria-hidden="true"></i>
          </button>
          <!-- Der Tag-Verwalter bekommt das Etiketten-Icon, die Kategorien den
               Ordnerbaum: die beiden Achsen sind bewusst getrennt, und dieselbe
               Bildsprache für beide hätte genau das wieder eingeebnet. -->
          <button class="btn btn--icon btn--ghost" id="btn-manage-tags"
                  aria-label="${t('tasks.manageTags')}" title="${t('tasks.manageTags')}">
            <i data-lucide="tags" class="icon-lg" aria-hidden="true"></i>
          </button>
          <button class="btn btn--primary toolbar-new-btn" id="btn-new-task" style="gap:var(--space-1)">
            <i data-lucide="plus" class="icon-lg" aria-hidden="true"></i> ${t('tasks.newTask')}
          </button>
        </div>
      </div>

      <div class="tasks-body">
        <div class="tasks-filters-row">
          <div class="tasks-filters" id="filter-bar" role="group" aria-label="${t('tasks.filterBtn')}"></div>
          <div class="tasks-filters__end">
            <div class="group-toggle" id="group-mode-toggle" role="group"
                 aria-label="${t('tasks.groupToggleLabel')}" ${isKanban ? 'hidden' : ''}>
              <button type="button" class="group-toggle__btn group-toggle__btn--active"
                      data-mode="category" aria-pressed="true">${t('tasks.categoryLabel')}</button>
              <button type="button" class="group-toggle__btn"
                      data-mode="due" aria-pressed="false">${t('tasks.dueDateLabel')}</button>
            </div>
          </div>
        </div>
        <div class="filter-panel" id="filter-panel" hidden></div>
        <div class="bulk-actions-bar" id="bulk-actions-bar" hidden>
          <span class="bulk-actions-bar__count" id="bulk-count"></span>
          <div class="bulk-actions-bar__actions">
            <button class="btn btn--secondary btn--sm" id="bulk-mark-done" data-status="done">
              <i data-lucide="check" class="icon-md" aria-hidden="true"></i>
              ${t('tasks.bulkMarkDone')}
            </button>
            <button class="btn btn--secondary btn--sm" id="bulk-mark-open" data-status="open">
              <i data-lucide="rotate-ccw" class="icon-md" aria-hidden="true"></i>
              ${t('tasks.bulkMarkOpen')}
            </button>
            <button class="btn btn--secondary btn--sm" id="bulk-archive">
              <i data-lucide="archive" class="icon-md" aria-hidden="true"></i>
              ${t('tasks.bulkArchive')}
            </button>
            <button class="btn btn--secondary btn--sm" id="bulk-tag-add">
              <i data-lucide="tag" class="icon-md" aria-hidden="true"></i>
              ${t('tasks.bulkTagAdd')}
            </button>
            <button class="btn btn--secondary btn--sm" id="bulk-tag-remove">
              <i data-lucide="tag-off" class="icon-md" aria-hidden="true"></i>
              ${t('tasks.bulkTagRemove')}
            </button>
            <button class="btn btn--danger btn--sm" id="bulk-delete">
              <i data-lucide="trash-2" class="icon-md" aria-hidden="true"></i>
              ${t('tasks.bulkDelete')}
            </button>
          </div>
        </div>

        <div id="task-list">
          ${[1,2,3].map(() => `
            <div class="widget-skeleton" style="margin-bottom:var(--space-2)">
              <div class="skeleton skeleton-line skeleton-line--medium" style="height:18px;margin-bottom:var(--space-3)"></div>
              <div class="skeleton skeleton-line skeleton-line--full" style="height:14px;margin-bottom:var(--space-2)"></div>
              <div class="skeleton skeleton-line skeleton-line--short" style="height:12px"></div>
            </div>`).join('')}
        </div>
        <button class="page-fab" id="fab-new-task" aria-label="${t('tasks.newTask')}">
          <i data-lucide="plus" class="icon-xl" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `);

  if (window.lucide) window.lucide.createIcons({ el: container });

  // Daten laden (Filter-State aus vorheriger Session berücksichtigen)
  try {
    const [tasksData, metaData, preferencesData] = await Promise.all([
      api.get(`/tasks${taskQuery()}`),
      api.get('/tasks/meta/options'),
      // Reine Anzeigepräferenz: ein Fehler hier darf die Aufgabenliste nicht
      // mit in den Ladefehler ziehen, deshalb eigener Fallback.
      api.get('/preferences').catch(() => ({ data: {} })),
    ]);
    state.tasks = tasksData.data ?? [];
    state.users = metaData.users ?? [];
    state.categories = metaData.categories ?? [];
    state.allTags = metaData.tags ?? [];
    state.defaultPoints = Number(metaData.default_points) || 0;
    state.subtasksExpandedByDefault = preferencesData.data?.tasks_subtasks_expanded === true;
  } catch (err) {
    console.error('[Tasks] Ladefehler:', err.message);
    window.yuvomi.showToast(t('tasks.loadError'), 'danger');
    state.tasks = [];
    state.users = [];
    state.categories = [];
    state.allTags = [];
    state.defaultPoints = 0;
    state.subtasksExpandedByDefault = false;
  }

  // UI verdrahten
  wireViewToggle(container);
  wireGroupToggle(container);
  wireNewTaskBtn(container);
  wireTaskList(container);
  wireBulkSelect(container);
  wireBulkCheckboxes(container);
  wireBulkActions(container);
  wireTagBadgeFilter(container);
  container.querySelector('#btn-manage-categories')
    ?.addEventListener('click', () => openTaskCategoryManager(container));
  container.querySelector('#btn-manage-tags')
    ?.addEventListener('click', () => openTagManager(container));
  renderFilters(container);
  renderTaskList(container);

  wirePageSearch(container, {
    id: 'tasks-search',
    onQuery: (value) => {
      state.searchQuery = value;
      renderTaskList(container);
    },
  });

  // Deep-Link: ?open=<id> öffnet die Detailansicht
  const openId = new URLSearchParams(window.location.search).get('open');
  if (openId) {
    try {
      const [task, reminder] = await Promise.all([
        loadTaskForEdit(openId),
        loadReminderForTask(openId),
      ]);
      openTaskDetail({ task, users: state.users, reminder }, container);
    } catch { /* Task existiert nicht oder kein Zugriff */ }
  }
}
