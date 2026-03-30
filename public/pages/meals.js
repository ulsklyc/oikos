/**
 * Modul: Essensplan (Meals)
 * Zweck: Wochenansicht mit Mahlzeit-CRUD, Zutaten-Verwaltung und Einkaufslisten-Integration
 * Abhängigkeiten: /api.js, /router.js (window.oikos)
 */

import { api } from '/api.js';
import { openModal as openSharedModal, closeModal as closeSharedModal } from '/components/modal.js';
import { stagger } from '/utils/ux.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const MEAL_TYPES = [
  { key: 'breakfast', label: 'Frühstück',   icon: 'sunrise'       },
  { key: 'lunch',     label: 'Mittagessen', icon: 'sun'           },
  { key: 'dinner',    label: 'Abendessen',  icon: 'moon'          },
  { key: 'snack',     label: 'Snack',       icon: 'cookie'        },
];

const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = {
  currentWeek: null,   // YYYY-MM-DD (Montag)
  meals:       [],
  lists:       [],     // Einkaufslisten für Transfer-Dropdown
  modal:       null,
};

// Container-Referenz für Hilfsfunktionen (wird in render() gesetzt)
let _container = null;

// --------------------------------------------------------
// Datumshelfer
// --------------------------------------------------------

function getMondayOf(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(monday) {
  const sunday = addDays(monday, 6);
  const fmt    = (s) => {
    const d = new Date(s + 'T00:00:00Z');
    return `${d.getUTCDate().toString().padStart(2, '0')}.${(d.getUTCMonth() + 1).toString().padStart(2, '0')}.${d.getUTCFullYear()}`;
  };
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function isToday(dateStr) {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function formatDayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

// --------------------------------------------------------
// API-Wrapper
// --------------------------------------------------------

async function loadWeek(week) {
  try {
    const res = await api.get(`/meals?week=${week}`);
    state.meals       = res.data;
    state.currentWeek = getMondayOf(week);
  } catch (err) {
    console.error('[Meals] loadWeek Fehler:', err);
    state.meals       = [];
    state.currentWeek = getMondayOf(week);
    window.oikos?.showToast('Essensplan konnte nicht geladen werden.', 'danger');
  }
}

async function loadLists() {
  try {
    const res   = await api.get('/shopping');
    state.lists = res.data;
  } catch {
    state.lists = [];
  }
}

// --------------------------------------------------------
// Render
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  container.innerHTML = `
    <div class="meals-page">
      <h1 class="sr-only">Essensplan</h1>
      <div class="week-nav">
        <button class="btn btn--icon" id="week-prev" aria-label="Vorherige Woche">
          <i data-lucide="chevron-left" aria-hidden="true"></i>
        </button>
        <span class="week-nav__label" id="week-label"></span>
        <button class="week-nav__today" id="week-today">Heute</button>
        <button class="btn btn--icon" id="week-next" aria-label="Nächste Woche">
          <i data-lucide="chevron-right" aria-hidden="true"></i>
        </button>
      </div>
      <div class="week-grid" id="week-grid">
        <div style="margin:auto;padding:2rem;text-align:center;color:var(--color-text-disabled)">Lade…</div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  const today  = new Date().toISOString().slice(0, 10);
  const monday = getMondayOf(today);

  await Promise.all([loadWeek(monday), loadLists()]);
  renderWeekGrid();
  wireNav();
}

// --------------------------------------------------------
// Wochengitter
// --------------------------------------------------------

function renderWeekGrid() {
  const grid = _container.querySelector('#week-grid');
  if (!grid) return;

  _container.querySelector('#week-label').textContent =
    formatWeekLabel(state.currentWeek);

  const days = Array.from({ length: 7 }, (_, i) => addDays(state.currentWeek, i));

  grid.innerHTML = days.map((date, idx) => {
    const mealsForDay = state.meals.filter((m) => m.date === date);
    const todayClass  = isToday(date) ? 'day-header--today' : '';

    return `
      <div class="day-column">
        <div class="day-header ${todayClass}">
          <span class="day-header__name">${DAY_NAMES[idx]}</span>
          <span class="day-header__date">${formatDayDate(date)}</span>
        </div>
        <div class="day-slots">
          ${MEAL_TYPES.map((type) => renderSlot(date, type, mealsForDay)).join('')}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
  stagger(grid.querySelectorAll('.meal-card'));
  wireGrid(grid);
}

function renderSlot(date, type, mealsForDay) {
  const meal = mealsForDay.find((m) => m.meal_type === type.key);

  if (!meal) {
    return `
      <div class="meal-slot meal-slot--empty" data-date="${date}" data-type="${type.key}">
        <div class="meal-slot__type-label">${type.label}</div>
        <div class="empty-state empty-state--compact">
          <div class="empty-state__description">Kein Essen geplant</div>
        </div>
        <button
          class="meal-slot__add-btn"
          data-action="add-meal"
          data-date="${date}"
          data-type="${type.key}"
          aria-label="${type.label} hinzufügen"
        >
          <i data-lucide="plus" style="width:16px;height:16px;" aria-hidden="true"></i>
        </button>
      </div>
    `;
  }

  const ingCount = meal.ingredients?.length ?? 0;
  const ingDone  = meal.ingredients?.filter((i) => i.on_shopping_list).length ?? 0;
  const ingLabel = ingCount > 0 ? `${ingCount} Zutat${ingCount !== 1 ? 'en' : ''}` : '';
  const ingDoneLabel = ingCount > 0 && ingDone === ingCount ? ' ✓' : '';
  const canTransfer  = ingCount > 0 && ingDone < ingCount;

  return `
    <div class="meal-slot meal-slot--has-meal" data-meal-id="${meal.id}" data-type="${type.key}">
      <div class="meal-slot__type-label">${type.label}</div>
      <div class="meal-card"
           data-action="edit-meal"
           data-meal-id="${meal.id}"
           role="button" tabindex="0">
        <div class="meal-card__title">${escHtml(meal.title)}</div>
        ${ingLabel ? `<div class="meal-card__meta">
          <span class="meal-card__ingredients-count">${ingLabel}${escHtml(ingDoneLabel)}</span>
        </div>` : ''}
        <div class="meal-card__actions">
          ${canTransfer ? `<button class="meal-card__action-btn meal-card__action-btn--shopping"
            data-action="transfer-meal"
            data-meal-id="${meal.id}"
            aria-label="Zutaten auf Einkaufsliste"
          ><i data-lucide="shopping-cart" style="width:14px;height:14px;" aria-hidden="true"></i></button>` : ''}
          <button class="meal-card__action-btn"
            data-action="delete-meal"
            data-meal-id="${meal.id}"
            aria-label="Mahlzeit löschen"
          ><i data-lucide="trash-2" style="width:14px;height:14px;" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Event-Delegation
// --------------------------------------------------------

function wireNav() {
  _container.querySelector('#week-prev')?.addEventListener('click', async () => {
    await loadWeek(addDays(state.currentWeek, -7));
    renderWeekGrid();
  });

  _container.querySelector('#week-next')?.addEventListener('click', async () => {
    await loadWeek(addDays(state.currentWeek, 7));
    renderWeekGrid();
  });

  _container.querySelector('#week-today')?.addEventListener('click', async () => {
    const monday = getMondayOf(new Date().toISOString().slice(0, 10));
    if (monday === state.currentWeek) return;
    await loadWeek(monday);
    renderWeekGrid();
  });
}

function wireGrid(grid) {
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === 'add-meal') {
      openMealModal({ mode: 'create', date: btn.dataset.date, mealType: btn.dataset.type });
      return;
    }

    if (action === 'edit-meal') {
      const mealId = parseInt(btn.dataset.mealId, 10);
      const meal   = state.meals.find((m) => m.id === mealId);
      if (meal) openMealModal({ mode: 'edit', meal, date: meal.date, mealType: meal.meal_type });
      return;
    }

    if (action === 'delete-meal') {
      await deleteMeal(parseInt(btn.dataset.mealId, 10));
      return;
    }

    if (action === 'transfer-meal') {
      await transferMeal(parseInt(btn.dataset.mealId, 10));
    }
  });

  grid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('[data-action="edit-meal"]');
      if (card) { e.preventDefault(); card.click(); }
    }
  });
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------

function openMealModal(opts) {
  state.modal = opts;
  const { mode, date, mealType, meal } = opts;
  const isEdit = mode === 'edit';

  const content = buildModalContent(opts);

  openSharedModal({
    title: isEdit ? 'Mahlzeit bearbeiten' : 'Mahlzeit hinzufügen',
    content,
    size: 'md',
    onSave(panel) {
      // Autocomplete
      const titleInput = panel.querySelector('#modal-title');
      const acDropdown = panel.querySelector('#modal-autocomplete');
      let acIndex = -1;
      let acTimer;

      titleInput.addEventListener('input', () => {
        clearTimeout(acTimer);
        acTimer = setTimeout(async () => {
          const q = titleInput.value.trim();
          if (!q) { acDropdown.hidden = true; return; }
          try {
            const res = await api.get(`/meals/suggestions?q=${encodeURIComponent(q)}`);
            if (!res.data.length) { acDropdown.hidden = true; return; }
            acIndex = -1;
            acDropdown.innerHTML = res.data.map((s) => `
              <div class="meal-modal__autocomplete-item" data-title="${escHtml(s.title)}">${escHtml(s.title)}</div>
            `).join('');
            acDropdown.hidden = false;
          } catch { acDropdown.hidden = true; }
        }, 200);
      });

      titleInput.addEventListener('keydown', (e) => {
        const items = [...acDropdown.querySelectorAll('.meal-modal__autocomplete-item')];
        if (!items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('meal-modal__autocomplete-item--active', i === acIndex)); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); acIndex = Math.max(acIndex - 1, 0);                items.forEach((el, i) => el.classList.toggle('meal-modal__autocomplete-item--active', i === acIndex)); }
        if (e.key === 'Enter' && acIndex >= 0) { e.preventDefault(); titleInput.value = items[acIndex].dataset.title; acDropdown.hidden = true; acIndex = -1; }
        if (e.key === 'Escape') acDropdown.hidden = true;
      });

      acDropdown.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.meal-modal__autocomplete-item');
        if (item) { titleInput.value = item.dataset.title; acDropdown.hidden = true; }
      });

      // Zutaten
      const ingList   = panel.querySelector('#ingredient-list');
      const addIngBtn = panel.querySelector('#add-ingredient-btn');

      addIngBtn.addEventListener('click', () => {
        const tmp  = document.createElement('div');
        tmp.innerHTML = ingredientRowHTML('', '', null);
        const row = tmp.firstElementChild;
        ingList.appendChild(row);
        if (window.lucide) lucide.createIcons();
        row.querySelector('input').focus();
      });

      ingList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="remove-ingredient"]');
        if (btn) btn.closest('.ingredient-row').remove();
      });

      // Einkaufslisten-Transfer
      panel.querySelector('#transfer-btn')?.addEventListener('click', async () => {
        const selectEl = panel.querySelector('#transfer-list-select');
        const listId   = parseInt(selectEl?.value, 10);
        if (!listId || !state.modal?.meal) return;
        const btn = panel.querySelector('#transfer-btn');
        btn.disabled = true;
        try {
          const res = await api.post(`/meals/${state.modal.meal.id}/to-shopping-list`, { listId });
          if (res.data.transferred > 0) {
            window.oikos?.showToast(`${res.data.transferred} Zutat${res.data.transferred !== 1 ? 'en' : ''} übertragen`, 'success');
            await loadWeek(state.currentWeek);
            closeModal();
            renderWeekGrid();
          } else {
            window.oikos?.showToast('Alle Zutaten bereits übertragen', 'info');
            btn.disabled = false;
          }
        } catch (err) {
          window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
          btn.disabled = false;
        }
      });

      panel.querySelector('#modal-cancel').addEventListener('click', closeModal);
      panel.querySelector('#modal-save').addEventListener('click', () => saveModal(panel));
    },
  });
}

function buildModalContent({ mode, date, mealType, meal }) {
  const isEdit   = mode === 'edit';
  const typeOpts = MEAL_TYPES.map((t) =>
    `<option value="${t.key}" ${t.key === mealType ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  const listOpts = state.lists.length
    ? state.lists.map((l) => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('')
    : '<option value="" disabled>Keine Einkaufslisten vorhanden</option>';

  const ingRows = isEdit && meal.ingredients?.length
    ? meal.ingredients.map((ing) => ingredientRowHTML(ing.name, ing.quantity ?? '', ing.id)).join('')
    : '';

  const hasIngOpen = isEdit && meal.ingredients?.some((i) => !i.on_shopping_list);

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="modal-date">Datum</label>
        <input type="date" class="form-input" id="modal-date" value="${date}">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="modal-type">Mahlzeit</label>
        <select class="form-input" id="modal-type">${typeOpts}</select>
      </div>
    </div>

    <div class="form-group" style="position:relative;">
      <label class="form-label" for="modal-title">Titel *</label>
      <input type="text" class="form-input" id="modal-title"
             placeholder="z.B. Spaghetti Bolognese"
             value="${escHtml(isEdit ? meal.title : '')}"
             autocomplete="off">
      <div id="modal-autocomplete" class="meal-modal__autocomplete" hidden></div>
    </div>

    <div class="form-group">
      <label class="form-label" for="modal-notes">Notizen</label>
      <textarea class="form-input" id="modal-notes" rows="2"
                placeholder="Optional…">${escHtml(isEdit && meal.notes ? meal.notes : '')}</textarea>
    </div>

    <div class="form-group">
      <label class="form-label">Zutaten</label>
      <div class="ingredient-list" id="ingredient-list">${ingRows}</div>
      <button class="add-ingredient-btn" id="add-ingredient-btn" type="button">
        <i data-lucide="plus" style="width:14px;height:14px;" aria-hidden="true"></i>
        Zutat hinzufügen
      </button>
    </div>

    ${isEdit && hasIngOpen ? `
    <div class="shopping-transfer">
      <div class="shopping-transfer__label">
        <i data-lucide="shopping-cart" style="width:14px;height:14px;" aria-hidden="true"></i>
        Zutaten auf Einkaufsliste übertragen
      </div>
      <select class="shopping-transfer__select" id="transfer-list-select">${listOpts}</select>
      <button class="btn btn--secondary shopping-transfer__btn" id="transfer-btn" type="button">
        Jetzt übertragen
      </button>
    </div>` : ''}

    <div class="modal-panel__footer" style="border:none;padding:0;margin-top:var(--space-4)">
      <button class="btn btn--secondary" id="modal-cancel">Abbrechen</button>
      <button class="btn btn--primary" id="modal-save">${isEdit ? 'Speichern' : 'Hinzufügen'}</button>
    </div>`;
}

function ingredientRowHTML(name, qty, id) {
  return `
    <div class="ingredient-row" data-ing-id="${id ?? ''}">
      <input type="text" class="form-input ingredient-row__name" placeholder="Zutat" value="${escHtml(name)}">
      <input type="text" class="form-input ingredient-row__qty" placeholder="Menge" value="${escHtml(qty)}">
      <button class="ingredient-row__remove" data-action="remove-ingredient" type="button" aria-label="Zutat entfernen">
        <i data-lucide="x" style="width:14px;height:14px;" aria-hidden="true"></i>
      </button>
    </div>
  `;
}

function closeModal() {
  closeSharedModal();
  state.modal = null;
}

async function saveModal(overlay) {
  const saveBtn   = overlay.querySelector('#modal-save');
  const date      = overlay.querySelector('#modal-date').value;
  const meal_type = overlay.querySelector('#modal-type').value;
  const title     = overlay.querySelector('#modal-title').value.trim();
  const notes     = overlay.querySelector('#modal-notes').value.trim() || null;

  if (!title) {
    window.oikos?.showToast('Titel ist erforderlich', 'error');
    return;
  }

  const ingredients = [];
  overlay.querySelectorAll('.ingredient-row').forEach((row) => {
    const name = row.querySelector('.ingredient-row__name').value.trim();
    const qty  = row.querySelector('.ingredient-row__qty').value.trim() || null;
    if (name) ingredients.push({ name, quantity: qty, id: row.dataset.ingId || null });
  });

  saveBtn.disabled    = true;
  saveBtn.textContent = '…';

  try {
    const { mode, meal } = state.modal;

    if (mode === 'create') {
      const res     = await api.post('/meals', { date, meal_type, title, notes, ingredients });
      state.meals.push(res.data);
    } else {
      // Update meal meta
      await api.put(`/meals/${meal.id}`, { date, meal_type, title, notes });

      // Sync ingredients
      const existingIds = new Set((meal.ingredients ?? []).map((i) => i.id));
      const keptIds     = new Set(
        ingredients.filter((i) => i.id).map((i) => parseInt(i.id, 10))
      );

      for (const id of existingIds) {
        if (!keptIds.has(id)) await api.delete(`/meals/ingredients/${id}`);
      }
      for (const ing of ingredients) {
        if (!ing.id) await api.post(`/meals/${meal.id}/ingredients`, { name: ing.name, quantity: ing.quantity });
      }

      // Reload updated meal
      await loadWeek(state.currentWeek);
    }

    closeModal();
    renderWeekGrid();
    window.oikos?.showToast(mode === 'create' ? 'Mahlzeit hinzugefügt' : 'Mahlzeit gespeichert', 'success');
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? 'Fehler beim Speichern', 'error');
    saveBtn.disabled    = false;
    saveBtn.textContent = state.modal?.mode === 'edit' ? 'Speichern' : 'Hinzufügen';
  }
}

// --------------------------------------------------------
// Mahlzeit löschen
// --------------------------------------------------------

async function deleteMeal(mealId) {
  if (!confirm('Mahlzeit wirklich löschen?')) return;
  try {
    await api.delete(`/meals/${mealId}`);
    state.meals = state.meals.filter((m) => m.id !== mealId);
    renderWeekGrid();
    window.oikos?.showToast('Mahlzeit gelöscht', 'success');
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? 'Fehler beim Löschen', 'error');
  }
}

// --------------------------------------------------------
// Zutaten → Einkaufsliste (Quick-Transfer vom Slot aus)
// --------------------------------------------------------

async function transferMeal(mealId) {
  if (!state.lists.length) {
    window.oikos?.showToast('Keine Einkaufslisten vorhanden', 'error');
    return;
  }

  let listId = state.lists[0].id;

  if (state.lists.length > 1) {
    const names  = state.lists.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
    const choice = prompt(`Auf welche Einkaufsliste?\n${names}\nNummer eingeben:`);
    const n = parseInt(choice, 10);
    if (!n || n < 1 || n > state.lists.length) return;
    listId = state.lists[n - 1].id;
  }

  try {
    const res = await api.post(`/meals/${mealId}/to-shopping-list`, { listId });
    if (res.data.transferred > 0) {
      window.oikos?.showToast(`${res.data.transferred} Zutat${res.data.transferred !== 1 ? 'en' : ''} übertragen`, 'success');
      await loadWeek(state.currentWeek);
      renderWeekGrid();
    } else {
      window.oikos?.showToast('Alle Zutaten bereits übertragen', 'info');
    }
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? 'Fehler beim Übertragen', 'error');
  }
}

// --------------------------------------------------------
// Hilfsfunktion
// --------------------------------------------------------

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
