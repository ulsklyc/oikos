/**
 * Modul: Budget-Tracker (Budget)
 * Zweck: Monatsübersicht, Kategorie-Balkendiagramm (Canvas), Transaktionsliste,
 *        CRUD, CSV-Export
 * Abhängigkeiten: /api.js, /router.js (window.oikos)
 */

import { api } from '/api.js';
import { openModal as openSharedModal, closeModal } from '/components/modal.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const CATEGORIES = [
  'Lebensmittel', 'Miete', 'Versicherung', 'Mobilität',
  'Freizeit', 'Kleidung', 'Gesundheit', 'Bildung', 'Sonstiges',
];

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                     'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = {
  month:    '',   // YYYY-MM
  entries:  [],
  summary:  null,
};
let _container = null;

// --------------------------------------------------------
// Formatierung
// --------------------------------------------------------

function formatAmount(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// --------------------------------------------------------
// API
// --------------------------------------------------------

async function loadMonth(month) {
  try {
    const [entriesRes, summaryRes] = await Promise.all([
      api.get(`/budget?month=${month}`),
      api.get(`/budget/summary?month=${month}`),
    ]);
    state.month   = month;
    state.entries = entriesRes.data;
    state.summary = summaryRes.data;
  } catch (err) {
    console.error('[Budget] loadMonth Fehler:', err);
    state.month   = month;
    state.entries = [];
    state.summary = { income: 0, expenses: 0, balance: 0, by_category: [] };
    window.oikos?.showToast('Budget konnte nicht geladen werden.', 'danger');
  }
}

// --------------------------------------------------------
// Entry Point
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  const today = new Date();
  state.month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  container.innerHTML = `
    <div class="budget-page">
      <div class="budget-nav">
        <button class="btn btn--icon" id="budget-prev" aria-label="Vorheriger Monat">
          <i data-lucide="chevron-left"></i>
        </button>
        <button class="budget-nav__today" id="budget-today">Aktuell</button>
        <span class="budget-nav__label" id="budget-label"></span>
        <button class="btn btn--primary btn--icon" id="budget-add" aria-label="Eintrag hinzufügen">
          <i data-lucide="plus"></i>
        </button>
        <button class="btn btn--icon" id="budget-next" aria-label="Nächster Monat">
          <i data-lucide="chevron-right"></i>
        </button>
      </div>
      <div id="budget-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:2rem;text-align:center;color:var(--color-text-disabled);">Lade…</div>
      </div>
      <button class="page-fab" id="fab-new-budget" aria-label="Neuer Eintrag">
        <i data-lucide="plus" style="width:24px;height:24px"></i>
      </button>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  await loadMonth(state.month);
  renderBody();
  wireNav();
}

// --------------------------------------------------------
// Navigation
// --------------------------------------------------------

function wireNav() {
  _container.querySelector('#budget-prev').addEventListener('click', async () => {
    await loadMonth(addMonths(state.month, -1));
    renderBody();
    updateLabel();
  });
  _container.querySelector('#budget-next').addEventListener('click', async () => {
    await loadMonth(addMonths(state.month, 1));
    renderBody();
    updateLabel();
  });
  _container.querySelector('#budget-today').addEventListener('click', async () => {
    const today = new Date();
    const m = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (m === state.month) return;
    await loadMonth(m);
    renderBody();
    updateLabel();
  });
  const addHandler = () => openBudgetModal({ mode: 'create' });
  _container.querySelector('#budget-add').addEventListener('click', addHandler);
  _container.querySelector('#fab-new-budget').addEventListener('click', addHandler);
  updateLabel();
}

function updateLabel() {
  const lbl = _container.querySelector('#budget-label');
  if (lbl) lbl.textContent = formatMonthLabel(state.month);
}

// --------------------------------------------------------
// Body
// --------------------------------------------------------

function renderBody() {
  const body = _container.querySelector('#budget-body');
  if (!body) return;
  updateLabel();

  const s = state.summary;
  const balanceClass = s.balance >= 0 ? 'budget-summary-card--balance-positive' : 'budget-summary-card--balance-negative';

  body.innerHTML = `
    <!-- Zusammenfassung -->
    <div class="budget-summary">
      <div class="budget-summary-card budget-summary-card--income">
        <div class="budget-summary-card__label">Einnahmen</div>
        <div class="budget-summary-card__amount">${formatAmount(s.income)}</div>
      </div>
      <div class="budget-summary-card budget-summary-card--expenses">
        <div class="budget-summary-card__label">Ausgaben</div>
        <div class="budget-summary-card__amount">${formatAmount(Math.abs(s.expenses))}</div>
      </div>
      <div class="budget-summary-card ${balanceClass}">
        <div class="budget-summary-card__label">Saldo</div>
        <div class="budget-summary-card__amount">${formatAmount(s.balance)}</div>
      </div>
    </div>

    <!-- Kategorie-Balken -->
    ${s.byCategory.length ? `
    <div class="budget-chart-section">
      <div class="budget-chart-section__title">Nach Kategorie</div>
      <div class="budget-chart">
        ${renderCategoryBars(s.byCategory)}
      </div>
    </div>` : ''}

    <!-- Transaktionsliste -->
    <div class="budget-list-section">
      <div class="budget-list-header">
        <span class="budget-list-header__title">Transaktionen</span>
        ${state.entries.length ? `
        <a href="/api/v1/budget/export?month=${state.month}" class="btn btn--secondary"
           style="font-size:var(--text-sm);padding:var(--space-1) var(--space-3);">
          <i data-lucide="download" style="width:14px;height:14px;margin-right:4px;"></i>CSV
        </a>` : ''}
      </div>
      <div class="budget-list" id="budget-list">
        ${renderEntries()}
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  _container.querySelector('#budget-list')?.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) { await deleteEntry(parseInt(delBtn.dataset.id, 10)); return; }

    const item = e.target.closest('.budget-entry[data-id]');
    if (item && !e.target.closest('[data-action]')) {
      const entry = state.entries.find((e) => e.id === parseInt(item.dataset.id, 10));
      if (entry) openBudgetModal({ mode: 'edit', entry });
    }
  });
}

function renderCategoryBars(byCategory) {
  const maxAbs = Math.max(...byCategory.map((c) => Math.abs(c.total)), 1);

  return byCategory.map((c) => {
    const isExpense = c.total < 0;
    const pct       = Math.round((Math.abs(c.total) / maxAbs) * 100);
    const cls       = isExpense ? 'budget-bar-row__fill--expenses' : 'budget-bar-row__fill--income';

    return `
      <div class="budget-bar-row">
        <div class="budget-bar-row__label" title="${escHtml(c.category)}">${escHtml(c.category)}</div>
        <div class="budget-bar-row__track">
          <div class="budget-bar-row__fill ${cls}" style="width:${pct}%;"></div>
        </div>
        <div class="budget-bar-row__amount" style="color:${isExpense ? 'var(--color-danger)' : 'var(--color-success)'};">
          ${formatAmount(c.total)}
        </div>
      </div>
    `;
  }).join('');
}

function renderEntries() {
  if (!state.entries.length) {
    return `<div class="budget-empty">
      <i data-lucide="receipt" style="width:48px;height:48px;color:var(--color-text-disabled);margin-bottom:var(--space-3);"></i>
      <div style="font-size:var(--text-base);font-weight:600;">Keine Einträge</div>
      <div style="font-size:var(--text-sm);margin-top:var(--space-1);">Noch keine Transaktionen für diesen Monat.</div>
    </div>`;
  }

  return state.entries.map((e) => {
    const isIncome  = e.amount > 0;
    const amtClass  = isIncome ? 'budget-entry__amount--income' : 'budget-entry__amount--expenses';
    const indClass  = isIncome ? 'budget-entry__indicator--income' : 'budget-entry__indicator--expenses';
    const sign      = isIncome ? '+' : '';
    const date      = formatEntryDate(e.date);

    return `
      <div class="budget-entry" data-id="${e.id}">
        <div class="budget-entry__indicator ${indClass}"></div>
        <div class="budget-entry__body">
          <div class="budget-entry__title">${escHtml(e.title)}</div>
          <div class="budget-entry__meta">${date} · ${escHtml(e.category)}${e.is_recurring ? ' 🔁' : ''}</div>
        </div>
        <div class="budget-entry__amount ${amtClass}">${sign}${formatAmount(e.amount)}</div>
        <button class="budget-entry__delete" data-action="delete" data-id="${e.id}" title="Löschen">
          <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
        </button>
      </div>
    `;
  }).join('');
}

function formatEntryDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.`;
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------

function openBudgetModal({ mode, entry = null }) {
  const isEdit = mode === 'edit';
  const today  = new Date().toISOString().slice(0, 10);

  const isExpense  = isEdit ? entry.amount < 0 : true;
  const absAmount  = isEdit ? Math.abs(entry.amount).toFixed(2) : '';

  const catOpts = CATEGORIES.map((c) =>
    `<option value="${c}" ${isEdit && entry.category === c ? 'selected' : ''}>${c}</option>`
  ).join('');

  const content = `
    <div class="amount-type-toggle">
      <button class="amount-type-btn amount-type-btn--expenses ${isExpense ? 'amount-type-btn--active' : ''}"
              id="type-expense" type="button">Ausgabe</button>
      <button class="amount-type-btn amount-type-btn--income ${!isExpense ? 'amount-type-btn--active' : ''}"
              id="type-income" type="button">Einnahme</button>
    </div>

    <div class="form-group">
      <label class="form-label" for="bm-title">Titel *</label>
      <input type="text" class="form-input" id="bm-title"
             placeholder="z.B. REWE Einkauf" value="${escHtml(isEdit ? entry.title : '')}">
    </div>

    <div class="form-group">
      <label class="form-label" for="bm-amount">Betrag (€) *</label>
      <input type="number" class="form-input" id="bm-amount"
             placeholder="0,00" step="0.01" min="0"
             value="${absAmount}">
    </div>

    <div class="form-group">
      <label class="form-label" for="bm-category">Kategorie</label>
      <select class="form-input" id="bm-category">${catOpts}</select>
    </div>

    <div class="form-group">
      <label class="form-label" for="bm-date">Datum *</label>
      <input type="date" class="form-input" id="bm-date"
             value="${isEdit ? entry.date : today}">
    </div>

    <div class="form-group">
      <label class="allday-toggle">
        <input type="checkbox" id="bm-recurring" ${isEdit && entry.is_recurring ? 'checked' : ''}>
        <span class="allday-toggle__label">Wiederkehrend</span>
      </label>
    </div>

    <div class="modal-panel__footer" style="border:none;padding:0;margin-top:var(--space-4)">
      ${isEdit ? `<button class="btn btn--danger btn--icon" id="bm-delete" title="Löschen">
        <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
      </button>` : '<div></div>'}
      <div style="display:flex;gap:var(--space-3)">
        <button class="btn btn--secondary" id="bm-cancel">Abbrechen</button>
        <button class="btn btn--primary" id="bm-save">${isEdit ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </div>`;

  openSharedModal({
    title: isEdit ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
    content,
    size: 'sm',
    onSave(panel) {
      let currentType = isExpense ? 'expense' : 'income';

      panel.querySelector('#type-expense').addEventListener('click', () => {
        currentType = 'expense';
        panel.querySelector('#type-expense').classList.add('amount-type-btn--active');
        panel.querySelector('#type-income').classList.remove('amount-type-btn--active');
      });
      panel.querySelector('#type-income').addEventListener('click', () => {
        currentType = 'income';
        panel.querySelector('#type-income').classList.add('amount-type-btn--active');
        panel.querySelector('#type-expense').classList.remove('amount-type-btn--active');
      });

      panel.querySelector('#bm-cancel').addEventListener('click', closeModal);

      panel.querySelector('#bm-delete')?.addEventListener('click', async () => {
        if (!confirm(`"${entry.title}" wirklich löschen?`)) return;
        closeModal();
        await deleteEntry(entry.id);
      });

      panel.querySelector('#bm-save').addEventListener('click', async () => {
        const saveBtn    = panel.querySelector('#bm-save');
        const title      = panel.querySelector('#bm-title').value.trim();
        const absVal     = parseFloat(panel.querySelector('#bm-amount').value);
        const category   = panel.querySelector('#bm-category').value;
        const date       = panel.querySelector('#bm-date').value;
        const recurring  = panel.querySelector('#bm-recurring').checked ? 1 : 0;

        if (!title)           { window.oikos?.showToast('Titel ist erforderlich', 'error'); return; }
        if (isNaN(absVal) || absVal <= 0) { window.oikos?.showToast('Gültigen Betrag eingeben', 'error'); return; }
        if (!date)            { window.oikos?.showToast('Datum ist erforderlich', 'error'); return; }

        const amount = currentType === 'expense' ? -absVal : absVal;

        saveBtn.disabled    = true;
        saveBtn.textContent = '…';

        try {
          const body = { title, amount, category, date, is_recurring: recurring };
          if (mode === 'create') {
            const res = await api.post('/budget', body);
            state.entries.unshift(res.data);
          } else {
            const res = await api.put(`/budget/${entry.id}`, body);
            const idx = state.entries.findIndex((e) => e.id === entry.id);
            if (idx !== -1) state.entries[idx] = res.data;
          }
          const sumRes  = await api.get(`/budget/summary?month=${state.month}`);
          state.summary = sumRes.data;

          closeModal();
          renderBody();
          window.oikos?.showToast(mode === 'create' ? 'Eintrag hinzugefügt' : 'Eintrag gespeichert', 'success');
        } catch (err) {
          window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
          saveBtn.disabled    = false;
          saveBtn.textContent = isEdit ? 'Speichern' : 'Hinzufügen';
        }
      });
    },
  });
}

// --------------------------------------------------------
// Eintrag löschen
// --------------------------------------------------------

async function deleteEntry(id) {
  if (!confirm('Eintrag wirklich löschen?')) return;
  try {
    await api.delete(`/budget/${id}`);
    state.entries = state.entries.filter((e) => e.id !== id);
    const sumRes  = await api.get(`/budget/summary?month=${state.month}`);
    state.summary = sumRes.data;
    renderBody();
    window.oikos?.showToast('Eintrag gelöscht', 'success');
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
  }
}

// --------------------------------------------------------
// Hilfsfunktion
// --------------------------------------------------------

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
