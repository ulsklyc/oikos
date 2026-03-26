/**
 * Modul: Einkaufslisten (Shopping)
 * Zweck: Multi-Listen-Tabs, Artikel mit Kategorie-Gruppierung, Quick-Add mit Autocomplete
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const ITEM_CATEGORIES = [
  'Obst & Gemüse', 'Backwaren', 'Milchprodukte', 'Fleisch & Fisch',
  'Tiefkühl', 'Getränke', 'Haushalt', 'Drogerie', 'Sonstiges',
];

const CATEGORY_ICONS = {
  'Obst & Gemüse':  'apple',
  'Backwaren':      'wheat',
  'Milchprodukte':  'milk',
  'Fleisch & Fisch':'beef',
  'Tiefkühl':       'snowflake',
  'Getränke':       'cup-soda',
  'Haushalt':       'spray-can',
  'Drogerie':       'pill',
  'Sonstiges':      'shopping-basket',
};

// --------------------------------------------------------
// State
// --------------------------------------------------------

const state = {
  lists:         [],
  activeListId:  null,
  items:         [],
  activeList:    null,
};

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function groupItemsByCategory(items) {
  const grouped = {};
  for (const item of items) {
    const cat = item.category || 'Sonstiges';
    (grouped[cat] = grouped[cat] || []).push(item);
  }
  // In Supermarkt-Gang-Reihenfolge zurückgeben
  return ITEM_CATEGORIES
    .filter((c) => grouped[c])
    .map((c) => [c, grouped[c]]);
}

// --------------------------------------------------------
// Render-Bausteine
// --------------------------------------------------------

function renderTabs(container) {
  const bar = container.querySelector('#list-tabs-bar');
  if (!bar) return;

  const tabsHtml = state.lists.map((list) => {
    const unchecked = list.item_total - list.item_checked;
    return `
      <button class="list-tab ${list.id === state.activeListId ? 'list-tab--active' : ''}"
              data-action="switch-list" data-id="${list.id}">
        ${list.name}
        ${list.item_total > 0 ? `<span class="list-tab__count">${unchecked > 0 ? unchecked : '✓'}</span>` : ''}
      </button>`;
  }).join('');

  bar.innerHTML = `
    ${tabsHtml}
    <button class="list-tab__new" data-action="new-list" aria-label="Neue Liste erstellen">
      <i data-lucide="plus" style="width:18px;height:18px"></i>
    </button>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function renderListContent(container) {
  const content = container.querySelector('#list-content');
  if (!content) return;

  if (!state.activeList) {
    content.innerHTML = `
      <div class="no-lists">
        <i data-lucide="shopping-cart" style="width:56px;height:56px;color:var(--color-text-disabled)"></i>
        <div style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold)">Keine Listen</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          Erstelle eine Liste mit dem + Button.
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const checkedCount = state.items.filter((i) => i.is_checked).length;

  content.innerHTML = `
    <!-- Liste-Header -->
    <div class="list-header">
      <span class="list-header__name" data-action="rename-list" data-id="${state.activeList.id}"
            role="button" tabindex="0" aria-label="Liste umbenennen">
        ${state.activeList.name}
        <i data-lucide="pencil" class="list-header__edit-icon"></i>
      </span>
      <div class="list-header__actions">
        ${checkedCount > 0 ? `
          <button class="btn btn--ghost" data-action="clear-checked"
                  style="font-size:var(--text-sm);color:var(--color-text-secondary)">
            <i data-lucide="trash-2" style="width:15px;height:15px"></i>
            Abgehakt löschen (${checkedCount})
          </button>` : ''}
        <button class="btn btn--ghost btn--icon" data-action="delete-list"
                data-id="${state.activeList.id}" aria-label="Liste löschen"
                style="color:var(--color-text-secondary)">
          <i data-lucide="trash" style="width:18px;height:18px"></i>
        </button>
      </div>
    </div>

    <!-- Quick-Add -->
    <div class="quick-add">
      <form class="quick-add__form" id="quick-add-form" novalidate autocomplete="off">
        <div class="quick-add__input-wrap">
          <input class="quick-add__input" type="text" id="item-name-input"
                 placeholder="Artikel hinzufügen…" aria-label="Artikelname" autocomplete="off">
          <input class="quick-add__qty" type="text" id="item-qty-input"
                 placeholder="Menge" aria-label="Menge" autocomplete="off">
          <div class="autocomplete-dropdown" id="autocomplete-dropdown" hidden></div>
        </div>
        <select class="quick-add__cat" id="item-cat-select" aria-label="Kategorie">
          ${ITEM_CATEGORIES.map((c) =>
            `<option value="${c}">${c}</option>`
          ).join('')}
        </select>
        <button class="quick-add__btn" type="submit" aria-label="Artikel hinzufügen">
          <i data-lucide="plus" style="width:20px;height:20px"></i>
        </button>
      </form>
    </div>

    <!-- Artikel-Liste -->
    <div class="items-list" id="items-list">
      ${renderItems()}
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
  wireAutocomplete(container);
  wireQuickAdd(container);
}

function renderItems() {
  if (!state.items.length) {
    return `
      <div class="shopping-empty">
        <i data-lucide="check-circle" class="shopping-empty__icon"></i>
        <div class="shopping-empty__title">Liste ist leer</div>
        <div class="shopping-empty__desc">Füge Artikel mit dem Eingabefeld oben hinzu.</div>
      </div>`;
  }

  const groups = groupItemsByCategory(state.items);
  return groups.map(([cat, items]) => `
    <div class="item-category">
      <div class="item-category__header">
        <i data-lucide="${CATEGORY_ICONS[cat] ?? 'tag'}" class="item-category__icon"></i>
        ${cat}
      </div>
      ${items.map(renderItem).join('')}
    </div>`).join('');
}

function renderItem(item) {
  return `
    <div class="shopping-item ${item.is_checked ? 'shopping-item--checked' : ''}"
         data-item-id="${item.id}">
      <button class="item-check ${item.is_checked ? 'item-check--checked' : ''}"
              data-action="toggle-item" data-id="${item.id}" data-checked="${item.is_checked}"
              aria-label="${item.name} ${item.is_checked ? 'als nicht erledigt markieren' : 'abhaken'}">
        <i data-lucide="check" class="item-check__icon"></i>
      </button>
      <div class="item-body">
        <div class="item-name">${item.name}</div>
        ${item.quantity ? `<div class="item-quantity">${item.quantity}</div>` : ''}
      </div>
      <button class="item-delete" data-action="delete-item" data-id="${item.id}"
              aria-label="${item.name} löschen">
        <i data-lucide="x" style="width:16px;height:16px"></i>
      </button>
    </div>`;
}

// --------------------------------------------------------
// Autocomplete
// --------------------------------------------------------

let autocompleteTimeout = null;

function wireAutocomplete(container) {
  const input    = container.querySelector('#item-name-input');
  const dropdown = container.querySelector('#autocomplete-dropdown');
  if (!input || !dropdown) return;

  let activeIdx = -1;

  input.addEventListener('input', () => {
    clearTimeout(autocompleteTimeout);
    const q = input.value.trim();
    if (q.length < 1) { dropdown.hidden = true; return; }

    autocompleteTimeout = setTimeout(async () => {
      try {
        const data = await api.get(`/shopping/suggestions?q=${encodeURIComponent(q)}`);
        const suggestions = data.data ?? [];
        if (!suggestions.length) { dropdown.hidden = true; return; }

        dropdown.innerHTML = suggestions.map((s, i) =>
          `<div class="autocomplete-item" data-idx="${i}" data-value="${s}">${s}</div>`
        ).join('');
        dropdown.hidden = false;
        activeIdx = -1;

        dropdown.querySelectorAll('.autocomplete-item').forEach((el) => {
          el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = el.dataset.value;
            dropdown.hidden = true;
          });
        });

        if (window.lucide) window.lucide.createIcons();
      } catch { dropdown.hidden = true; }
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (dropdown.hidden) return;
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === activeIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === activeIdx));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      input.value = items[activeIdx].dataset.value;
      dropdown.hidden = true;
    } else if (e.key === 'Escape') {
      dropdown.hidden = true;
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.hidden = true; }, 150);
  });
}

// --------------------------------------------------------
// Quick-Add Form
// --------------------------------------------------------

function wireQuickAdd(container) {
  const form = container.querySelector('#quick-add-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = container.querySelector('#item-name-input');
    const qtyInput  = container.querySelector('#item-qty-input');
    const catSelect = container.querySelector('#item-cat-select');

    const name     = nameInput.value.trim();
    const quantity = qtyInput.value.trim() || null;
    const category = catSelect.value;

    if (!name) { nameInput.focus(); return; }

    try {
      const data = await api.post(`/shopping/${state.activeListId}/items`, { name, quantity, category });
      state.items.push(data.data);
      // Einfügen in DOM ohne komplettes Re-Render
      updateItemsList(container);
      updateListCounter(state.activeListId, 1, 0);
      renderTabs(container);
      nameInput.value = '';
      qtyInput.value  = '';
      nameInput.focus();
    } catch (err) {
      window.oikos.showToast(err.message, 'danger');
    }
  });
}

// --------------------------------------------------------
// DOM-Updates (ohne komplettes Re-Render)
// --------------------------------------------------------

function updateItemsList(container) {
  const listEl = container.querySelector('#items-list');
  if (listEl) {
    listEl.innerHTML = renderItems();
    if (window.lucide) window.lucide.createIcons();
  }
  // clear-checked Button aktualisieren
  const checkedCount = state.items.filter((i) => i.is_checked).length;
  const clearBtn     = container.querySelector('[data-action="clear-checked"]');
  const header       = container.querySelector('.list-header__actions');
  if (header) {
    if (checkedCount > 0 && !clearBtn) {
      header.insertAdjacentHTML('afterbegin', `
        <button class="btn btn--ghost" data-action="clear-checked"
                style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          <i data-lucide="trash-2" style="width:15px;height:15px"></i>
          Abgehakt löschen (${checkedCount})
        </button>`);
      if (window.lucide) window.lucide.createIcons();
    } else if (clearBtn) {
      if (checkedCount === 0) {
        clearBtn.remove();
      } else {
        clearBtn.innerHTML = `
          <i data-lucide="trash-2" style="width:15px;height:15px"></i>
          Abgehakt löschen (${checkedCount})`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }
}

function updateListCounter(listId, totalDelta, checkedDelta) {
  const list = state.lists.find((l) => l.id === listId);
  if (list) {
    list.item_total   = (list.item_total   || 0) + totalDelta;
    list.item_checked = (list.item_checked || 0) + checkedDelta;
  }
}

// --------------------------------------------------------
// API-Aktionen
// --------------------------------------------------------

async function loadLists() {
  try {
    const data   = await api.get('/shopping');
    state.lists  = data.data ?? [];
  } catch (err) {
    console.error('[Shopping] loadLists Fehler:', err);
    state.lists = [];
    window.oikos?.showToast('Listen konnten nicht geladen werden.', 'danger');
  }
}

async function loadItems(listId) {
  const data       = await api.get(`/shopping/${listId}/items`);
  state.items      = data.data ?? [];
  state.activeList = data.list ?? null;
}

async function switchList(listId, container) {
  state.activeListId = listId;
  renderTabs(container);
  try {
    await loadItems(listId);
  } catch (err) {
    console.error('[Shopping] loadItems Fehler:', err);
    state.items = [];
    state.activeList = state.lists.find((l) => l.id === listId) ?? null;
    window.oikos?.showToast('Artikel konnten nicht geladen werden.', 'danger');
  }
  renderListContent(container);
  wireListContentEvents(container);
}

// --------------------------------------------------------
// Event-Verdrahtung
// --------------------------------------------------------

function wireTabBar(container) {
  container.querySelector('#list-tabs-bar')?.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    if (target.dataset.action === 'switch-list') {
      await switchList(Number(target.dataset.id), container);
    }

    if (target.dataset.action === 'new-list') {
      const name = prompt('Name der neuen Liste:');
      if (!name?.trim()) return;
      try {
        const data = await api.post('/shopping', { name: name.trim() });
        state.lists.push({ ...data.data, item_total: 0, item_checked: 0 });
        await switchList(data.data.id, container);
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
      }
    }
  });
}

function wireListContentEvents(container) {
  const content = container.querySelector('#list-content');
  if (!content) return;

  content.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    // ---- Artikel abhaken ----
    if (action === 'toggle-item') {
      const id      = Number(target.dataset.id);
      const checked = Number(target.dataset.checked);
      const newVal  = checked ? 0 : 1;

      // Optimistisches Update
      const item = state.items.find((i) => i.id === id);
      if (item) {
        item.is_checked = newVal;
        updateItemsList(container);
        updateListCounter(state.activeListId, 0, newVal ? 1 : -1);
        renderTabs(container);
      }

      try {
        await api.patch(`/shopping/items/${id}`, { is_checked: newVal });
      } catch (err) {
        // Zurückrollen
        if (item) item.is_checked = checked;
        updateItemsList(container);
        window.oikos.showToast(err.message, 'danger');
      }
    }

    // ---- Artikel löschen ----
    if (action === 'delete-item') {
      const id   = Number(target.dataset.id);
      const item = state.items.find((i) => i.id === id);
      try {
        await api.delete(`/shopping/items/${id}`);
        state.items = state.items.filter((i) => i.id !== id);
        updateItemsList(container);
        updateListCounter(state.activeListId, -1, item?.is_checked ? -1 : 0);
        renderTabs(container);
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
      }
    }

    // ---- Abgehakte löschen ----
    if (action === 'clear-checked') {
      const count = state.items.filter((i) => i.is_checked).length;
      if (!count) return;
      try {
        await api.delete(`/shopping/${state.activeListId}/items/checked`);
        state.items = state.items.filter((i) => !i.is_checked);
        updateItemsList(container);
        updateListCounter(state.activeListId, -count, -count);
        renderTabs(container);
        window.oikos.showToast(`${count} Artikel entfernt.`);
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
      }
    }

    // ---- Liste umbenennen ----
    if (action === 'rename-list') {
      const newName = prompt('Neuer Listen-Name:', state.activeList?.name);
      if (!newName?.trim() || newName.trim() === state.activeList?.name) return;
      try {
        const data = await api.put(`/shopping/${state.activeListId}`, { name: newName.trim() });
        const idx  = state.lists.findIndex((l) => l.id === state.activeListId);
        if (idx >= 0) state.lists[idx].name = data.data.name;
        state.activeList = data.data;
        renderTabs(container);
        renderListContent(container);
        wireListContentEvents(container);
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
      }
    }

    // ---- Liste löschen ----
    if (action === 'delete-list') {
      if (!confirm(`Liste "${state.activeList?.name}" und alle Artikel löschen?`)) return;
      try {
        await api.delete(`/shopping/${state.activeListId}`);
        state.lists = state.lists.filter((l) => l.id !== state.activeListId);
        state.activeListId = state.lists[0]?.id ?? null;
        if (state.activeListId) {
          await switchList(state.activeListId, container);
        } else {
          state.items      = [];
          state.activeList = null;
          renderTabs(container);
          renderListContent(container);
        }
        window.oikos.showToast('Liste gelöscht.');
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
      }
    }
  });

  // Rename per Enter
  content.querySelector('[data-action="rename-list"]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.currentTarget.click();
  });
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  container.innerHTML = `
    <div class="shopping-page">
      <div class="list-tabs-bar" id="list-tabs-bar">
        <div class="skeleton skeleton-line skeleton-line--medium" style="height:36px;width:120px;border-radius:var(--radius-full)"></div>
        <div class="skeleton skeleton-line skeleton-line--short"  style="height:36px;width:80px; border-radius:var(--radius-full)"></div>
      </div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column">
        <div style="padding:var(--space-6)">
          ${[1,2,3].map(() => `
            <div class="skeleton skeleton-line skeleton-line--full" style="height:48px;margin-bottom:var(--space-2);border-radius:var(--radius-sm)"></div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  try {
    await loadLists();
    if (state.lists.length) {
      state.activeListId = state.lists[0].id;
      await loadItems(state.activeListId);
    }
  } catch (err) {
    console.error('[Shopping] Ladefehler:', err.message);
    window.oikos.showToast('Einkaufslisten konnten nicht geladen werden.', 'danger');
  }

  container.innerHTML = `
    <div class="shopping-page">
      <div class="list-tabs-bar" id="list-tabs-bar"></div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden"></div>
      <button class="page-fab" id="fab-new-item" aria-label="Artikel hinzufügen">
        <i data-lucide="plus" style="width:24px;height:24px"></i>
      </button>
    </div>
  `;

  renderTabs(container);
  wireTabBar(container);
  renderListContent(container);
  wireListContentEvents(container);

  container.querySelector('#fab-new-item')?.addEventListener('click', () => {
    const input = container.querySelector('#item-name-input');
    if (input) {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus();
    } else {
      // Keine Liste aktiv → neue Liste erstellen
      container.querySelector('[data-action="new-list"]')?.click();
    }
  });
}
