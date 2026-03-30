/**
 * Modul: Aufgaben (Tasks)
 * Zweck: Listenansicht mit Filtern, Gruppierung, CRUD-Modal, Subtask-Verwaltung
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';
import { renderRRuleFields, bindRRuleEvents, getRRuleValues } from '/rrule-ui.js';
import { openModal as openSharedModal, closeModal, wireBlurValidation, btnSuccess, btnError } from '/components/modal.js';
import { stagger, vibrate } from '/utils/ux.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const PRIORITIES = [
  { value: 'urgent', label: 'Dringend',  color: 'var(--color-priority-urgent)' },
  { value: 'high',   label: 'Hoch',      color: 'var(--color-priority-high)'   },
  { value: 'medium', label: 'Mittel',    color: 'var(--color-priority-medium)' },
  { value: 'low',    label: 'Niedrig',   color: 'var(--color-priority-low)'    },
];

const STATUSES = [
  { value: 'open',        label: 'Offen'        },
  { value: 'in_progress', label: 'In Bearbeitung'},
  { value: 'done',        label: 'Erledigt'      },
];

const CATEGORIES = [
  'Haushalt','Schule','Einkauf','Reparatur',
  'Gesundheit','Finanzen','Freizeit','Sonstiges',
];

const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]));
const STATUS_LABELS   = Object.fromEntries(STATUSES.map((s)  => [s.value, s.label]));

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const due  = new Date(dateStr);
  const now  = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - now) / 86400000);

  if (diffDays < 0)  return { label: `${Math.abs(diffDays)}d überfällig`, cls: 'due-date--overdue' };
  if (diffDays === 0) return { label: 'Heute fällig',                      cls: 'due-date--today'   };
  if (diffDays === 1) return { label: 'Morgen fällig',                     cls: ''                  };
  return { label: due.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), cls: '' };
}

function groupBy(tasks, mode) {
  const groups = {};

  if (mode === 'category') {
    for (const t of tasks) {
      const key = t.category || 'Sonstiges';
      (groups[key] = groups[key] || []).push(t);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'de'));
  }

  // mode === 'due'
  for (const t of tasks) {
    let key;
    if (!t.due_date)                  key = 'Kein Datum';
    else {
      const diff = Math.round((new Date(t.due_date) - new Date().setHours(0,0,0,0)) / 86400000);
      if (diff < 0)       key = 'Überfällig';
      else if (diff === 0) key = 'Heute';
      else if (diff <= 3)  key = 'Diese Woche';
      else if (diff <= 7)  key = 'Nächste Woche';
      else                 key = 'Später';
    }
    (groups[key] = groups[key] || []).push(t);
  }

  const order = ['Überfällig', 'Heute', 'Diese Woche', 'Nächste Woche', 'Später', 'Kein Datum'];
  return order.filter((k) => groups[k]).map((k) => [k, groups[k]]);
}

// --------------------------------------------------------
// Render-Bausteine
// --------------------------------------------------------

function renderPriorityBadge(priority) {
  return `<span class="priority-badge priority-badge--${priority}">
    <span class="priority-dot priority-dot--${priority}"></span>
    ${PRIORITY_LABELS[priority] ?? priority}
  </span>`;
}

function renderDueDate(dateStr) {
  const d = formatDueDate(dateStr);
  if (!d) return '';
  return `<span class="due-date ${d.cls}">
    <i data-lucide="clock" style="width:11px;height:11px" aria-hidden="true"></i> ${d.label}
  </span>`;
}

function renderSwipeRow(task, innerHtml) {
  const isDone = task.status === 'done';
  return `
    <div class="swipe-row" data-swipe-id="${task.id}" data-swipe-status="${task.status}">
      <div class="swipe-reveal swipe-reveal--done" aria-hidden="true">
        <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>${isDone ? 'Öffnen' : 'Erledigt'}</span>
      </div>
      <div class="swipe-reveal swipe-reveal--edit" aria-hidden="true">
        <i data-lucide="pencil" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>Bearbeiten</span>
      </div>
      ${innerHtml}
    </div>`;
}

function renderTaskCard(task, opts = {}) {
  const { expandedSubtasks = false } = opts;
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
                  data-status="${s.status}" aria-label="${s.title} als erledigt markieren">
            ${s.status === 'done' ? '<i data-lucide="check" style="width:10px;height:10px;color:#fff" aria-hidden="true"></i>' : ''}
          </button>
          <span class="subtask-item__title">${s.title}</span>
        </div>`).join('')
    : '';

  return `
    <div class="task-card ${isDone ? 'task-card--done' : ''}" data-task-id="${task.id}">
      <div class="task-card__main">
        <button class="task-status-btn task-status-btn--${task.status}"
                data-action="toggle-status" data-id="${task.id}" data-status="${task.status}"
                aria-label="${task.title} als erledigt markieren">
          <i data-lucide="check" class="task-status-btn__check" aria-hidden="true"></i>
        </button>

        <div class="task-card__body">
          <div class="task-card__title" data-action="open-task" data-id="${task.id}">
            ${task.title}
          </div>
          <div class="task-card__meta">
            ${renderPriorityBadge(task.priority)}
            ${renderDueDate(task.due_date)}
            ${task.is_recurring ? '<span class="due-date" aria-label="Wiederkehrend"><i data-lucide="repeat" style="width:12px;height:12px" aria-hidden="true"></i></span>' : ''}
            ${task.category !== 'Sonstiges' ? `<span class="due-date">${task.category}</span>` : ''}
          </div>
        </div>

        ${task.assigned_color ? `
          <div class="task-avatar" style="background-color:${task.assigned_color}"
               title="${task.assigned_name ?? ''}">
            ${initials(task.assigned_name ?? '')}
          </div>` : ''}

        <button class="btn btn--ghost btn--icon" data-action="edit-task" data-id="${task.id}"
                aria-label="Aufgabe bearbeiten" style="min-height:unset;width:36px;height:36px">
          <i data-lucide="pencil" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
      </div>

      ${progress !== null ? `
        <div class="subtask-progress" data-action="toggle-subtasks" data-id="${task.id}"
             aria-label="Teilaufgaben anzeigen">
          <div class="subtask-progress__bar-wrap">
            <div class="subtask-progress__bar-fill" style="width:${progress}%"></div>
          </div>
          <span class="subtask-progress__text">${task.subtask_done}/${task.subtask_total}</span>
        </div>` : ''}

      ${task.subtasks !== undefined ? `
        <div class="subtask-list ${expandedSubtasks ? 'subtask-list--visible' : ''}"
             id="subtasks-${task.id}">
          ${subtasksHtml}
          <button class="subtask-item__add" data-action="add-subtask" data-parent="${task.id}">
            + Teilaufgabe hinzufügen
          </button>
        </div>` : ''}
    </div>`;
}

function renderTaskGroups(tasks, groupMode) {
  if (!tasks.length) {
    return `<div class="empty-state">
      <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <div class="empty-state__title">Keine Aufgaben — alles erledigt?</div>
      <div class="empty-state__description">Neue Aufgaben über den + Button erstellen.</div>
    </div>`;
  }

  const groups = groupBy(tasks, groupMode);
  return groups.map(([name, groupTasks]) => `
    <div class="task-group">
      <div class="task-group__header">
        <span class="task-group__title">${name}</span>
        <span class="task-group__count">${groupTasks.length}</span>
      </div>
      ${groupTasks.map((t) => renderSwipeRow(t, renderTaskCard(t))).join('')}
    </div>`).join('');
}

// --------------------------------------------------------
// Task-Modal (Erstellen / Bearbeiten)
// --------------------------------------------------------

function renderModalContent({ task = null, users = [] } = {}) {
  const isEdit = !!task;

  const userOptions = users.map((u) =>
    `<option value="${u.id}" ${task?.assigned_to === u.id ? 'selected' : ''}>${u.display_name}</option>`
  ).join('');

  const categoryOptions = CATEGORIES.map((c) =>
    `<option value="${c}" ${(task?.category ?? 'Sonstiges') === c ? 'selected' : ''}>${c}</option>`
  ).join('');

  const priorityOptions = PRIORITIES.map((p) =>
    `<option value="${p.value}" ${(task?.priority ?? 'medium') === p.value ? 'selected' : ''}>${p.label}</option>`
  ).join('');

  return `
    <form id="task-form" novalidate>
      <input type="hidden" id="task-id" value="${task?.id ?? ''}">

      <div class="form-group">
        <div class="form-field">
          <label class="label" for="task-title">Titel *</label>
          <input class="input" type="text" id="task-title" name="title"
                 value="${task?.title ?? ''}" placeholder="Was muss erledigt werden?"
                 required autocomplete="off">
          <div class="form-field__error">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/>
                 <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/>
            </svg>
            Dieses Feld ist erforderlich.
          </div>
        </div>
      </div>

      <div class="form-group">
        <label class="label" for="task-description">Notiz</label>
        <textarea class="input" id="task-description" name="description"
                  rows="2" placeholder="Optionale Details…"
                  style="resize:vertical">${task?.description ?? ''}</textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="task-priority">Priorität</label>
          <select class="input" id="task-priority" name="priority" style="min-height:44px">
            ${priorityOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="task-category">Kategorie</label>
          <select class="input" id="task-category" name="category" style="min-height:44px">
            ${categoryOptions}
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-top:var(--space-4)">
        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="task-due-date">Fälligkeit</label>
          <input class="input" type="date" id="task-due-date" name="due_date"
                 value="${task?.due_date ?? ''}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="label" for="task-due-time">Uhrzeit</label>
          <input class="input" type="time" id="task-due-time" name="due_time"
                 value="${task?.due_time ?? ''}">
        </div>
      </div>

      <div class="form-group" style="margin-top:var(--space-4)">
        <label class="label" for="task-assigned">Zugewiesen an</label>
        <select class="input" id="task-assigned" name="assigned_to" style="min-height:44px">
          <option value="">— Niemand —</option>
          ${userOptions}
        </select>
      </div>

      ${isEdit ? `
        <div class="form-group">
          <label class="label" for="task-status">Status</label>
          <select class="input" id="task-status" name="status" style="min-height:44px">
            ${STATUSES.map((s) =>
              `<option value="${s.value}" ${task.status === s.value ? 'selected' : ''}>${s.label}</option>`
            ).join('')}
          </select>
        </div>` : ''}

      ${renderRRuleFields('task', task?.recurrence_rule)}

      <div id="task-form-error" class="login-error" hidden></div>

      <div class="modal-panel__footer" style="padding:0;border:none;margin-top:var(--space-6)">
        ${isEdit ? `
          <button type="button" class="btn btn--danger" data-action="delete-task"
                  data-id="${task.id}">Löschen</button>` : ''}
        <button type="submit" class="btn btn--primary" id="task-submit-btn">
          ${isEdit ? 'Speichern' : 'Erstellen'}
        </button>
      </div>
    </form>`;
}

// --------------------------------------------------------
// Seiten-State
// --------------------------------------------------------

let state = {
  tasks:         [],
  users:         [],
  filters:       { status: '', priority: '', assigned_to: '' },
  groupMode:     'category',   // 'category' | 'due'
  viewMode:      'list',       // 'list' | 'kanban'
  expandedTasks: new Set(),
  dragTaskId:    null,
};

// --------------------------------------------------------
// API-Aktionen
// --------------------------------------------------------

async function loadTasks(container) {
  const params = new URLSearchParams();
  if (state.filters.status)      params.set('status',      state.filters.status);
  if (state.filters.priority)    params.set('priority',    state.filters.priority);
  if (state.filters.assigned_to) params.set('assigned_to', state.filters.assigned_to);

  const query = params.toString() ? `?${params}` : '';
  const data  = await api.get(`/tasks${query}`);
  state.tasks = data.data ?? [];
  renderTaskList(container);
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

// --------------------------------------------------------
// Modal-Verwaltung (delegiert an Shared Modal-System)
// --------------------------------------------------------

function openTaskModal({ task = null, users = [] } = {}, container) {
  const isEdit = !!task;
  openSharedModal({
    title: isEdit ? 'Aufgabe bearbeiten' : 'Neue Aufgabe',
    content: renderModalContent({ task, users }),
    size: 'lg',
    onSave(panel) {
      // RRULE-Events binden
      bindRRuleEvents(document, 'task');

      // Blur-Validierung für required-Felder aktivieren
      wireBlurValidation(panel);

      // Form-Events
      panel.querySelector('#task-form')
        ?.addEventListener('submit', (e) => handleFormSubmit(e, container));

      panel.querySelector('[data-action="delete-task"]')
        ?.addEventListener('click', (e) => handleDeleteTask(e.currentTarget.dataset.id, container));
    },
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

  errorEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Wird gespeichert…';

  const originalLabel = taskId ? 'Speichern' : 'Erstellen';

  const rrule = getRRuleValues(document, 'task');
  const body = {
    title:           form.title.value.trim(),
    description:     form.description.value.trim() || null,
    priority:        form.priority.value,
    category:        form.category.value,
    due_date:        form.due_date?.value || null,
    due_time:        form.due_time?.value || null,
    assigned_to:     form.assigned_to.value ? Number(form.assigned_to.value) : null,
    is_recurring:    rrule.is_recurring ? 1 : 0,
    recurrence_rule: rrule.recurrence_rule,
  };
  if (form.status) body.status = form.status.value;

  try {
    if (taskId) {
      await api.put(`/tasks/${taskId}`, body);
      window.oikos.showToast('Aufgabe gespeichert.', 'success');
    } else {
      await api.post('/tasks', body);
      window.oikos.showToast('Aufgabe erstellt.', 'success');
    }
    btnSuccess(submitBtn, originalLabel);
    setTimeout(() => closeModal(), 700);
    await loadTasks(container);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    btnError(submitBtn);
  }
}

async function handleDeleteTask(id, container) {
  if (!confirm('Aufgabe und alle Teilaufgaben löschen?')) return;
  try {
    await api.delete(`/tasks/${id}`);
    closeModal();
    window.oikos.showToast('Aufgabe gelöscht.', 'default');
    await loadTasks(container);
  } catch (err) {
    window.oikos.showToast(err.message, 'danger');
  }
}

async function handleAddSubtask(parentId, container) {
  const title = prompt('Teilaufgabe:');
  if (!title?.trim()) return;
  try {
    await api.post('/tasks', { title: title.trim(), parent_task_id: parentId });
    await loadTasks(container);
  } catch (err) {
    window.oikos.showToast(err.message, 'danger');
  }
}

// --------------------------------------------------------
// Kanban-Ansicht
// --------------------------------------------------------

const KANBAN_COLS = [
  { status: 'open',        label: 'Offen',         colorVar: '--color-text-secondary' },
  { status: 'in_progress', label: 'In Bearbeitung', colorVar: '--color-warning'        },
  { status: 'done',        label: 'Erledigt',       colorVar: '--color-success'        },
];

function renderKanbanCard(task) {
  const due = formatDueDate(task.due_date);
  return `
    <div class="kanban-card ${task.status === 'done' ? 'kanban-card--done' : ''}"
         data-task-id="${task.id}" draggable="true">
      <div class="kanban-card__title">${task.title}</div>
      <div class="kanban-card__meta">
        ${renderPriorityBadge(task.priority)}
        ${due ? `<span class="due-date ${due.cls}"><i data-lucide="clock" style="width:10px;height:10px" aria-hidden="true"></i> ${due.label}</span>` : ''}
      </div>
      ${task.assigned_color ? `
        <div class="kanban-card__footer">
          <div class="task-avatar" style="background-color:${task.assigned_color};width:22px;height:22px;font-size:9px"
               title="${task.assigned_name ?? ''}">
            ${initials(task.assigned_name ?? '')}
          </div>
        </div>` : ''}
    </div>`;
}

function renderKanban(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  const grouped = {};
  for (const col of KANBAN_COLS) grouped[col.status] = [];
  for (const t of state.tasks) {
    if (grouped[t.status]) grouped[t.status].push(t);
    else grouped['open'].push(t);
  }

  listEl.innerHTML = `
    <div class="kanban-board">
      ${KANBAN_COLS.map((col) => `
        <div class="kanban-col" data-status="${col.status}">
          <div class="kanban-col__header">
            <span class="kanban-col__title" style="color:${col.colorVar.startsWith('--') ? `var(${col.colorVar})` : col.colorVar}">
              ${col.label}
            </span>
            <span class="kanban-col__count">${grouped[col.status].length}</span>
          </div>
          <div class="kanban-col__body" data-drop-zone="${col.status}">
            ${grouped[col.status].map((t) => renderKanbanCard(t)).join('')}
            <div class="kanban-drop-placeholder" hidden></div>
          </div>
        </div>
      `).join('')}
    </div>`;

  if (window.lucide) window.lucide.createIcons();
  wireKanbanDrag(container);
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
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card[data-task-id]');
    if (card) card.classList.remove('kanban-card--dragging');
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
      window.oikos.showToast(err.message, 'danger');
      await loadTasks(container);
    }
  });

  // Klick auf Kanban-Card öffnet Edit-Modal
  board.addEventListener('click', async (e) => {
    if (e.target.closest('[draggable]')) {
      const card = e.target.closest('.kanban-card[data-task-id]');
      if (!card) return;
      try {
        const task = await loadTaskForEdit(card.dataset.taskId);
        openTaskModal({ task, users: state.users }, container);
      } catch (err) {
        window.oikos.showToast('Aufgabe konnte nicht geladen werden.', 'danger');
      }
    }
  });
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
  listEl.innerHTML = renderTaskGroups(state.tasks, state.groupMode);
  if (window.lucide) window.lucide.createIcons();
  stagger(listEl.querySelectorAll('.swipe-row, .kanban-card'));
  updateOverdueBadge();
  wireSwipeGestures(container);
}

function renderFilters(container) {
  const bar = container.querySelector('#filter-bar');
  if (!bar) return;

  const chips = [];
  if (state.filters.status) {
    chips.push(`<span class="filter-chip filter-chip--active" data-filter="status">
      ${STATUS_LABELS[state.filters.status]}
      <span class="filter-chip__remove" aria-hidden="true">×</span>
    </span>`);
  }
  if (state.filters.priority) {
    chips.push(`<span class="filter-chip filter-chip--active" data-filter="priority">
      ${PRIORITY_LABELS[state.filters.priority]}
      <span class="filter-chip__remove" aria-hidden="true">×</span>
    </span>`);
  }
  if (state.filters.assigned_to) {
    const u = state.users.find((u) => u.id === Number(state.filters.assigned_to));
    chips.push(`<span class="filter-chip filter-chip--active" data-filter="assigned_to">
      ${u?.display_name ?? 'Person'}
      <span class="filter-chip__remove" aria-hidden="true">×</span>
    </span>`);
  }

  // Inaktive Filter-Chips (zum Aktivieren)
  if (!state.filters.status) {
    STATUSES.forEach((s) => {
      chips.push(`<span class="filter-chip" data-filter="status" data-value="${s.value}">${s.label}</span>`);
    });
  }
  if (!state.filters.priority) {
    PRIORITIES.forEach((p) => {
      chips.push(`<span class="filter-chip" data-filter="priority" data-value="${p.value}">${p.label}</span>`);
    });
  }
  if (!state.filters.assigned_to && state.users.length > 1) {
    state.users.forEach((u) => {
      chips.push(`<span class="filter-chip" data-filter="assigned_to" data-value="${u.id}">${u.display_name}</span>`);
    });
  }

  bar.innerHTML = chips.join('');
  wireFilterChips(container);
}

function updateOverdueBadge() {
  const overdue = state.tasks.filter((t) => {
    if (!t.due_date || t.status === 'done') return false;
    return new Date(t.due_date) < new Date().setHours(0, 0, 0, 0);
  }).length;

  document.querySelectorAll('[data-route="/tasks"] .nav-badge').forEach((el) => el.remove());
  if (overdue > 0) {
    document.querySelectorAll('[data-route="/tasks"]').forEach((el) => {
      el.insertAdjacentHTML('beforeend', `<span class="nav-badge">${overdue}</span>`);
    });
  }
}

// --------------------------------------------------------
// Swipe-Gesten (Mobil: links = erledigt, rechts = bearbeiten)
// --------------------------------------------------------

const SWIPE_THRESHOLD    = 80;   // px — Mindestweg für Aktion
const SWIPE_MAX_VERT     = 12;   // px — vertikaler Bewegungs-Toleranzbereich (darunter: kein Scroll-Abbruch)
const SWIPE_LOCK_VERT    = 30;   // px — ab diesem Weg gilt es als Scroll (Swipe abgebrochen)

function wireSwipeGestures(container) {
  const listEl = container.querySelector('#task-list');
  if (!listEl) return;

  listEl.querySelectorAll('.swipe-row').forEach((row) => {
    let startX = 0, startY = 0;
    let dx = 0;
    let locked = false;    // false = unentschieden, 'swipe' | 'scroll'
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
        setTimeout(async () => {
          resetCard(false);
          try {
            await toggleTaskStatus(taskId, status);
            await loadTasks(container);
          } catch (err) {
            window.oikos.showToast(err.message, 'danger');
            await loadTasks(container);
          }
        }, 200);

      } else if (dx > SWIPE_THRESHOLD) {
        // Swipe rechts → Bearbeiten-Modal
        resetCard(true);
        vibrate(20);
        try {
          const task = await loadTaskForEdit(taskId);
          openTaskModal({ task, users: state.users }, container);
        } catch (err) {
          window.oikos.showToast('Aufgabe konnte nicht geladen werden.', 'danger');
        }

      } else {
        resetCard(true);
      }
    }, { passive: true });
  });
}

// --------------------------------------------------------
// Event-Verdrahtung
// --------------------------------------------------------

function wireFilterChips(container) {
  container.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const filter = chip.dataset.filter;
      if (chip.classList.contains('filter-chip--active')) {
        state.filters[filter] = '';
      } else {
        state.filters[filter] = chip.dataset.value;
      }
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
      toggle.querySelectorAll('[data-view]').forEach((b) =>
        b.classList.toggle('group-toggle__btn--active', b.dataset.view === state.viewMode)
      );
      // Gruppierungs-Toggle nur in Listenansicht sinnvoll
      const groupToggle = container.querySelector('#group-mode-toggle');
      if (groupToggle) groupToggle.style.display = state.viewMode === 'list' ? '' : 'none';
      renderTaskList(container);
    });
  });
}

function wireGroupToggle(container) {
  const toggle = container.querySelector('#group-mode-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.group-toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.groupMode = btn.dataset.mode;
      toggle.querySelectorAll('.group-toggle__btn').forEach((b) =>
        b.classList.toggle('group-toggle__btn--active', b.dataset.mode === state.groupMode)
      );
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
      target.classList.toggle('task-status-btn--done', status !== 'done');
      target.closest('.task-card')?.classList.toggle('task-card--done', status !== 'done');
      try {
        await toggleTaskStatus(id, status);
        await loadTasks(container);
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
        await loadTasks(container);
      }
    }

    if (action === 'toggle-subtasks') {
      const subtaskList = document.getElementById(`subtasks-${id}`);
      if (subtaskList) subtaskList.classList.toggle('subtask-list--visible');
    }

    if (action === 'toggle-subtask') {
      try {
        await toggleSubtaskStatus(id, target.dataset.status);
        await loadTasks(container);
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
      }
    }

    if (action === 'edit-task' || action === 'open-task') {
      try {
        const task = await loadTaskForEdit(id);
        openTaskModal({ task, users: state.users }, container);
      } catch (err) {
        window.oikos.showToast('Aufgabe konnte nicht geladen werden.', 'danger');
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
  // Initiales Skeleton
  container.innerHTML = `
    <div class="tasks-page">
      <div class="tasks-toolbar">
        <h1 class="tasks-toolbar__title">Aufgaben</h1>
        <div class="tasks-toolbar__actions">
          <div class="group-toggle" id="view-toggle">
            <button class="group-toggle__btn group-toggle__btn--active" data-view="list"
                    title="Listenansicht" aria-label="Listenansicht">
              <i data-lucide="list" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
            </button>
            <button class="group-toggle__btn" data-view="kanban"
                    title="Kanban-Ansicht" aria-label="Kanban-Ansicht">
              <i data-lucide="columns" style="width:14px;height:14px;pointer-events:none" aria-hidden="true"></i>
            </button>
          </div>
          <div class="group-toggle" id="group-mode-toggle">
            <button class="group-toggle__btn group-toggle__btn--active" data-mode="category">Kategorie</button>
            <button class="group-toggle__btn" data-mode="due">Fälligkeit</button>
          </div>
          <button class="btn btn--primary" id="btn-new-task" style="gap:var(--space-1)">
            <i data-lucide="plus" style="width:18px;height:18px" aria-hidden="true"></i> Neu
          </button>
        </div>
      </div>

      <div class="tasks-filters" id="filter-bar"></div>

      <div id="task-list">
        ${[1,2,3].map(() => `
          <div class="widget-skeleton" style="margin-bottom:var(--space-2)">
            <div class="skeleton skeleton-line skeleton-line--medium" style="height:18px;margin-bottom:var(--space-3)"></div>
            <div class="skeleton skeleton-line skeleton-line--full" style="height:14px;margin-bottom:var(--space-2)"></div>
            <div class="skeleton skeleton-line skeleton-line--short" style="height:12px"></div>
          </div>`).join('')}
      </div>
      <button class="page-fab" id="fab-new-task" aria-label="Neue Aufgabe">
        <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
      </button>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();

  // Daten laden
  try {
    const [tasksData, metaData] = await Promise.all([
      api.get('/tasks'),
      api.get('/tasks/meta/options'),
    ]);
    state.tasks = tasksData.data ?? [];
    state.users = metaData.users ?? [];
  } catch (err) {
    console.error('[Tasks] Ladefehler:', err.message);
    window.oikos.showToast('Aufgaben konnten nicht geladen werden.', 'danger');
    state.tasks = [];
    state.users = [];
  }

  // UI verdrahten
  wireViewToggle(container);
  wireGroupToggle(container);
  wireNewTaskBtn(container);
  wireTaskList(container);
  renderFilters(container);
  renderTaskList(container);
}
