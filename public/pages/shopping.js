/**
 * Modul: Einkaufslisten (Shopping)
 * Zweck: Multi-Listen-Tabs, Artikel mit Kategorie-Gruppierung, Quick-Add mit Autocomplete
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';
import { stagger, vibrate } from '/utils/ux.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { promptModal } from '/components/modal.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

// Swipe-Gesten Konstanten (identisch zu tasks.js)
const SWIPE_THRESHOLD = 80;   // px - Mindestweg für Aktion
const SWIPE_MAX_VERT  = 12;   // px - vertikaler Toleranzbereich
const SWIPE_LOCK_VERT = 30;   // px - ab diesem Weg gilt es als Scroll

const ITEM_CATEGORIES = [
  'Obst & Gemüse', 'Backwaren', 'Milchprodukte', 'Fleisch & Fisch',
  'Tiefkühl', 'Getränke', 'Haushalt', 'Drogerie', 'Sonstiges',
];

const CATEGORY_LABELS = () => ({
  'Obst & Gemüse':   t('shopping.catFruitVeg'),
  'Backwaren':       t('shopping.catBakery'),
  'Milchprodukte':   t('shopping.catDairy'),
  'Fleisch & Fisch': t('shopping.catMeatFish'),
  'Tiefkühl':        t('shopping.catFrozen'),
  'Getränke':        t('shopping.catDrinks'),
  'Haushalt':        t('shopping.catHousehold'),
  'Drogerie':        t('shopping.catDrugstore'),
  'Sonstiges':       t('shopping.catMisc'),
});

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
        ${esc(list.name)}
        ${list.item_total > 0 ? `<span class="list-tab__count">${unchecked > 0 ? unchecked : '✓'}</span>` : ''}
      </button>`;
  }).join('');

  bar.innerHTML = `
    ${tabsHtml}
    <button class="list-tab__new" data-action="new-list" aria-label="Neue Liste erstellen">
      <i data-lucide="plus" style="width:18px;height:18px" aria-hidden="true"></i>
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
        <i data-lucide="shopping-cart" style="width:56px;height:56px;color:var(--color-text-disabled)" aria-hidden="true"></i>
        <div style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold)">${t('shopping.noLists')}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">
          ${t('shopping.noListsDescription')}
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
            role="button" tabindex="0" aria-label="${t('shopping.renameListLabel')}">
        ${esc(state.activeList.name)}
        <i data-lucide="pencil" class="list-header__edit-icon" aria-hidden="true"></i>
      </span>
      <div class="list-header__actions">
        ${checkedCount > 0 ? `
          <button class="btn btn--ghost" data-action="clear-checked"
                  style="font-size:var(--text-sm);color:var(--color-text-secondary)">
            <i data-lucide="trash-2" style="width:15px;height:15px" aria-hidden="true"></i>
            ${t('shopping.clearChecked', { count: checkedCount })}
          </button>` : ''}
        <button class="btn btn--ghost btn--icon" data-action="delete-list"
                data-id="${state.activeList.id}" aria-label="${t('shopping.deleteListLabel')}"
                style="color:var(--color-text-secondary)">
          <i data-lucide="trash" style="width:18px;height:18px" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- Quick-Add -->
    <div class="quick-add">
      <form class="quick-add__form" id="quick-add-form" novalidate autocomplete="off">
        <div class="quick-add__input-wrap">
          <input class="quick-add__input" type="text" id="item-name-input"
                 placeholder="${t('shopping.itemNamePlaceholder')}" aria-label="${t('shopping.itemNameLabel')}" autocomplete="off">
          <input class="quick-add__qty" type="text" id="item-qty-input"
                 placeholder="${t('shopping.itemQtyPlaceholder')}" aria-label="${t('shopping.itemQtyLabel')}" autocomplete="off">
          <div class="autocomplete-dropdown" id="autocomplete-dropdown" hidden></div>
        </div>
        <select class="quick-add__cat" id="item-cat-select" aria-label="${t('shopping.categoryLabel')}">
          ${ITEM_CATEGORIES.map((c) =>
            `<option value="${c}">${c}</option>`
          ).join('')}
        </select>
        <button class="quick-add__btn" type="submit" aria-label="${t('shopping.addItemLabel')}">
          <i data-lucide="plus" style="width:20px;height:20px" aria-hidden="true"></i>
        </button>
      </form>
    </div>

    <!-- Artikel-Liste -->
    <div class="items-list" id="items-list">
      ${renderItems()}
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
  stagger(content.querySelectorAll('.shopping-item'));
  wireAutocomplete(container);
  wireQuickAdd(container);
  maybeShowSwipeHint(container);
}

function renderItems() {
  if (!state.items.length) {
    return `
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        <div class="empty-state__title">${t('shopping.emptyList')}</div>
        <div class="empty-state__description">${t('shopping.emptyListDescription')}</div>
      </div>`;
  }

  const catLabels = CATEGORY_LABELS();
  const groups = groupItemsByCategory(state.items);
  return groups.map(([cat, items]) => `
    <div class="item-category">
      <div class="item-category__header">
        <i data-lucide="${CATEGORY_ICONS[cat] ?? 'tag'}" class="item-category__icon" aria-hidden="true"></i>
        ${catLabels[cat] || cat}
      </div>
      ${items.map(renderItem).join('')}
    </div>`).join('');
}

function renderItem(item) {
  const isDone = Boolean(item.is_checked);
  return `
    <div class="swipe-row" data-swipe-id="${item.id}" data-swipe-checked="${item.is_checked}">
      <div class="swipe-reveal swipe-reveal--done" aria-hidden="true">
        <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>${isDone ? t('shopping.swipeBack') : t('shopping.swipeCheck')}</span>
      </div>
      <div class="swipe-reveal swipe-reveal--delete" aria-hidden="true">
        <i data-lucide="trash-2" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>${t('shopping.swipeDelete')}</span>
      </div>
      <div class="shopping-item ${isDone ? 'shopping-item--checked' : ''}"
           data-item-id="${item.id}">
        <button class="item-check ${isDone ? 'item-check--checked' : ''}"
                data-action="toggle-item" data-id="${item.id}" data-checked="${item.is_checked}"
                aria-label="${isDone ? t('shopping.markUndoneLabel', { name: esc(item.name) }) : t('shopping.markDoneLabel', { name: esc(item.name) })}">
          <i data-lucide="check" class="item-check__icon" aria-hidden="true"></i>
        </button>
        <div class="item-body">
          <div class="item-name">${esc(item.name)}</div>
          ${item.quantity ? `<div class="item-quantity">${esc(item.quantity)}</div>` : ''}
        </div>
        <button class="item-delete" data-action="delete-item" data-id="${item.id}"
                aria-label="${t('shopping.deleteItemLabel', { name: esc(item.name) })}">
          <i data-lucide="x" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
      </div>
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
          `<div class="autocomplete-item" data-idx="${i}" data-value="${esc(s)}">${esc(s)}</div>`
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

/**
 * Zeigt kurzes Checkmark-Feedback auf dem +-Button (700ms).
 * Verwendet DOM-API statt innerHTML um XSS-Risiken zu vermeiden.
 * @param {HTMLButtonElement|null} btn
 */
function _flashAddBtn(btn) {
  if (!btn) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('aria-hidden', 'true');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', '20 6 9 17 4 12');
  svg.appendChild(poly);

  const saved = [...btn.childNodes];
  btn.classList.add('btn--success');
  btn.replaceChildren(svg);
  setTimeout(() => {
    btn.classList.remove('btn--success');
    btn.replaceChildren(...saved);
    if (window.lucide) window.lucide.createIcons();
  }, 700);
}

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
      // Erfolgs-Feedback auf dem +-Button (DOM-API, kein innerHTML)
      _flashAddBtn(form.querySelector('.quick-add__btn'));
      nameInput.focus();
    } catch (err) {
      window.oikos.showToast(err.message, 'danger');
    }
  });
}

// --------------------------------------------------------
// Swipe-Affordance Hint (Long Loop)
// Zeigt den Nudge-Hinweis maximal 3x (gespeichert in localStorage).
// --------------------------------------------------------

const SWIPE_HINT_KEY  = 'oikos:swipeHintSeen';
const SWIPE_HINT_MAX  = 3;

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
// Swipe-Gesten
// --------------------------------------------------------

function wireSwipeGestures(container) {
  const listEl = container.querySelector('#items-list');
  if (!listEl) return;

  listEl.querySelectorAll('.swipe-row').forEach((row) => {
    let startX = 0, startY = 0;
    let dx = 0;
    let locked = false; // false | 'swipe' | 'scroll'
    let thresholdHit = false;
    const card = row.querySelector('.shopping-item');
    if (!card) return;

    function resetCard(animate = true) {
      card.style.transition = animate ? 'transform 0.25s ease' : '';
      card.style.transform  = '';
      row.classList.remove('swipe-row--swiping');
      row.querySelector('.swipe-reveal--done').style.opacity    = '0';
      row.querySelector('.swipe-reveal--delete').style.opacity  = '0';
    }

    row.addEventListener('touchstart', (e) => {
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

      if (dy < SWIPE_LOCK_VERT) e.preventDefault();

      const dampened = dx > 0
        ? Math.min(dx,  SWIPE_THRESHOLD + (dx  - SWIPE_THRESHOLD) * 0.2)
        : Math.max(dx, -(SWIPE_THRESHOLD + (-dx - SWIPE_THRESHOLD) * 0.2));

      card.style.transform = `translateX(${dampened}px)`;
      row.classList.add('swipe-row--swiping');

      const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      if (dx < 0) {
        row.querySelector('.swipe-reveal--done').style.opacity   = String(progress);
        row.querySelector('.swipe-reveal--delete').style.opacity = '0';
      } else {
        row.querySelector('.swipe-reveal--delete').style.opacity = String(progress);
        row.querySelector('.swipe-reveal--done').style.opacity   = '0';
      }

      // Haptic-Feedback beim Erreichen des Schwellwerts
      if (!thresholdHit && Math.abs(dx) >= SWIPE_THRESHOLD) {
        thresholdHit = true;
        vibrate(15);
      }
    }, { passive: false });

    row.addEventListener('touchend', async () => {
      if (locked !== 'swipe') { resetCard(false); return; }

      const itemId  = Number(row.dataset.swipeId);
      const checked = Number(row.dataset.swipeChecked);

      if (dx < -SWIPE_THRESHOLD) {
        // Swipe links → abhaken / zurück
        card.style.transition = 'transform 0.2s ease';
        card.style.transform  = 'translateX(-110%)';
        vibrate(40);
        setTimeout(async () => {
          resetCard(false);
          const newVal = checked ? 0 : 1;
          const item   = state.items.find((i) => i.id === itemId);
          if (item) {
            item.is_checked = newVal;
            updateItemsList(container);
            updateListCounter(state.activeListId, 0, newVal ? 1 : -1);
            renderTabs(container);
          }
          try {
            await api.patch(`/shopping/items/${itemId}`, { is_checked: newVal });
            vibrate(10);
          } catch (err) {
            if (item) item.is_checked = checked;
            updateItemsList(container);
            window.oikos.showToast(err.message, 'danger');
          }
        }, 200);

      } else if (dx > SWIPE_THRESHOLD) {
        // Swipe rechts → löschen
        card.style.transition = 'transform 0.2s ease';
        card.style.transform  = 'translateX(110%)';
        vibrate(40);
        setTimeout(async () => {
          const item = state.items.find((i) => i.id === itemId);
          try {
            await api.delete(`/shopping/items/${itemId}`);
            state.items = state.items.filter((i) => i.id !== itemId);
            updateItemsList(container);
            updateListCounter(state.activeListId, -1, item?.is_checked ? -1 : 0);
            renderTabs(container);
          } catch (err) {
            resetCard(true);
            window.oikos.showToast(err.message, 'danger');
          }
        }, 200);

      } else {
        resetCard(true);
      }
    });
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
    stagger(listEl.querySelectorAll('.shopping-item'));
    wireSwipeGestures(container);
    maybeShowSwipeHint(container);
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
          <i data-lucide="trash-2" style="width:15px;height:15px" aria-hidden="true"></i>
          ${t('shopping.clearChecked', { count: checkedCount })}
        </button>`);
      if (window.lucide) window.lucide.createIcons();
    } else if (clearBtn) {
      if (checkedCount === 0) {
        clearBtn.remove();
      } else {
        clearBtn.innerHTML = `
          <i data-lucide="trash-2" style="width:15px;height:15px" aria-hidden="true"></i>
          ${t('shopping.clearChecked', { count: checkedCount })}`;
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
    window.oikos?.showToast(t('shopping.listsLoadError'), 'danger');
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
    window.oikos?.showToast(t('shopping.itemsLoadError'), 'danger');
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
      const name = await promptModal(t('shopping.newListPrompt'));
      if (!name) return;
      try {
        const data = await api.post('/shopping', { name });
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
        vibrate(10);
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
        window.oikos.showToast(t('shopping.itemsRemovedToast', { count }));
      } catch (err) {
        window.oikos.showToast(err.message, 'danger');
      }
    }

    // ---- Liste umbenennen ----
    if (action === 'rename-list') {
      const newName = await promptModal(t('shopping.renameListPrompt'), state.activeList?.name ?? '');
      if (!newName || newName === state.activeList?.name) return;
      try {
        const data = await api.put(`/shopping/${state.activeListId}`, { name: newName });
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
      if (!confirm(t('shopping.deleteListConfirm', { name: state.activeList?.name }))) return;
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
        window.oikos.showToast(t('shopping.deletedListToast'));
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
    window.oikos.showToast(t('shopping.listsLoadError'), 'danger');
  }

  container.innerHTML = `
    <div class="shopping-page">
      <h1 class="sr-only">${t('shopping.title')}</h1>
      <div class="list-tabs-bar" id="list-tabs-bar"></div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden"></div>
      <button class="page-fab" id="fab-new-item" aria-label="${t('shopping.addItemLabel')}">
        <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
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

