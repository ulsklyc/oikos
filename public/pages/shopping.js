/**
 * Modul: Einkaufslisten (Shopping)
 * Zweck: Multi-Listen-Tabs, Artikel mit Kategorie-Gruppierung, Quick-Add mit Autocomplete
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';
import { stagger, vibrate, scheduleUndoableDelete } from '/utils/ux.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { promptModal, openModal, closeModal, confirmModal, reportFieldError } from '/components/modal.js';
import { DEFAULT_CATEGORY_NAME, categoryLabel } from '/utils/shopping-categories.js';
import { addLocalDays, toLocalDateKey } from '/utils/date.js';
import { renderKitchenTabsBar, refreshKitchenBadges } from '/utils/kitchen-tabs.js';
import { mountEmptyState, mountLoadError } from '/utils/empty-state.js';
import { popoverMenuHtml, installPopoverMenus } from '/utils/popover-menu.js';
import '/components/category-manager.js';
import { findPageFab } from '/utils/fab.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

// Swipe-Gesten Konstanten (identisch zu tasks.js)
const SWIPE_THRESHOLD = 80;   // px - Mindestweg für Aktion
const SWIPE_MAX_VERT  = 12;   // px - vertikaler Toleranzbereich
const SWIPE_LOCK_VERT = 30;   // px - ab diesem Weg gilt es als Scroll

/** Icon für eine Kategorie (aus state.categories, Fallback 'tag'). */
function catIcon(name) {
  return state.categories.find((c) => c.name === name)?.icon ?? 'tag';
}

/** Kategorienamen in DB-Reihenfolge. */
function categoryNames() {
  return state.categories.map((c) => c.name);
}

// --------------------------------------------------------
// State
// --------------------------------------------------------

const state = {
  lists:         [],
  activeListId:  null,
  items:         [],
  activeList:    null,
  categories:    [],   // { id, name, icon, sort_order }[]
  /** Zwei getrennte Ladewege, zwei getrennte Fehler - sie haben verschiedene
   *  Wiederholungen: die Listen holt die ganze Seite neu, die Artikel nur die
   *  aktive Liste. Ein gemeinsames Feld hätte den einen Fehler mit der
   *  Wiederholung des anderen bedient. */
  listsError:    null,
  itemsError:    null,
};

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function groupItemsByCategory(items) {
  const grouped = {};
  for (const item of items) {
    const cat = item.category || (state.categories[0]?.name ?? DEFAULT_CATEGORY_NAME);
    (grouped[cat] = grouped[cat] || []).push(item);
  }
  // In DB-Reihenfolge zurückgeben; unbekannte Kategorien ans Ende
  const names   = categoryNames();
  const known   = names.filter((c) => grouped[c]).map((c) => [c, grouped[c]]);
  const unknown = Object.keys(grouped).filter((c) => !names.includes(c)).map((c) => [c, grouped[c]]);
  return [...known, ...unknown];
}

function shouldIgnoreShoppingRowToggle(target) {
  return Boolean(target?.closest?.('button, a, input, select, textarea, [data-no-row-toggle]'));
}

async function toggleShoppingItem(id, checked, container) {
  const newVal = checked ? 0 : 1;

  const item = state.items.find((i) => i.id === id);
  if (item) {
    item.is_checked = newVal;
    // Nur die betroffene Zeile aktualisieren — kein Komplett-Re-Render,
    // damit die Scroll-Position der Liste erhalten bleibt (Issue #276).
    updateItemRow(container, item);
    updateCheckedActions(container);
    updateListCounter(state.activeListId, 0, newVal ? 1 : -1);
    renderTabs(container);
  }

  try {
    await api.patch(`/shopping/items/${id}`, { is_checked: newVal });
    vibrate(10);
  } catch (err) {
    if (item) {
      item.is_checked = checked;
      updateItemRow(container, item);
      updateCheckedActions(container);
      updateListCounter(state.activeListId, 0, newVal ? -1 : 1);
      renderTabs(container);
    }
    window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
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

  bar.replaceChildren();
  // Führender Listen-Marker: signalisiert „das hier sind Listen" und grenzt die
  // Leiste sichtbar von den Küchen-Modul-Tabs darüber ab (dekorativ, aria-hidden).
  bar.insertAdjacentHTML('beforeend', `
    <i data-lucide="list" class="list-tabs-bar__marker" aria-hidden="true"></i>
    ${tabsHtml}
    <button class="list-tab__new" data-action="new-list" aria-label="${t('shopping.newListButton')}">
      <i data-lucide="plus" class="icon-md" aria-hidden="true"></i>
    </button>
  `);
  if (window.lucide) window.lucide.createIcons({ el: bar });
}

function renderListContent(container) {
  const content = container.querySelector('#list-content');
  const head = container.querySelector('#list-head');
  if (!content) return;
  content.removeAttribute('aria-busy');

  // Listen nicht ladbar: Fehlerzustand statt Leerzustand. Muss VOR der
  // `!state.activeList`-Prüfung stehen - ohne geladene Listen ist auch keine
  // aktiv, und der Leerzustand darunter hätte „Keine Listen" behauptet und mit
  // „Neue Liste erstellen" ausgerechnet eine schreibende Handlung als einzigen
  // Ausweg angeboten (Critique P0, 2026-07-30).
  if (state.listsError) {
    if (head) {
      head.replaceChildren();
      head.hidden = true;
    }
    mountLoadError(content, {
      title: t('shopping.listsLoadError'),
      description: t('common.loadErrorDescription'),
      error: state.listsError,
      retryLabel: t('common.retry'),
      onRetry: () => render(container, {}),
    });
    return;
  }

  if (!state.activeList) {
    // Ohne aktive Liste gibt es nichts zu benennen: der Kopf entfällt ganz,
    // statt einen leeren Titel-Slot und drei toten Aktionen zu zeigen.
    if (head) {
      head.replaceChildren();
      head.hidden = true;
    }
    // Geteilter Renderer (utils/empty-state.js), damit dieser Zustand dieselbe
    // Reihenfolge und Rolle trägt wie die drei Geschwister-Tabs.
    mountEmptyState(content, {
      icon: 'shopping-cart',
      title: t('shopping.noLists'),
      description: t('shopping.noListsDescription'),
      // Nennt die EINGEHENDE Station des Kreislaufs (der Essensplan füllt die
      // Liste) - wie der Vorrat, dessen Hinweis auf den Einkauf zeigt. Dieser
      // Zustand war der einzige der vier ohne Hinweis (Critique 2026-07-29).
      hint: t('shopping.noListsHint'),
      action: {
        label: t('shopping.newListButton'),
        icon: 'plus',
        onClick: () => container.querySelector('[data-action="new-list"]')?.click(),
      },
    });
    return;
  }

  if (head) {
    head.hidden = false;
    head.replaceChildren();
    // Slot-Ordnung wie in den drei Geschwister-Tabs: Titel links, Aktionen
    // rechts. Der Titel trägt .page-toolbar__title und damit dessen
    // nowrap + ellipsis - vorher hatte .list-header__name `overflow: hidden`
    // ohne `white-space`, wodurch „Weekly Shop" schon bei 1440px zweizeilig
    // brach (Critique 2026-07-29).
    head.insertAdjacentHTML('beforeend', `
      <span class="page-toolbar__title list-header__name" data-action="rename-list"
            data-id="${state.activeList.id}"
            role="button" tabindex="0" aria-label="${t('shopping.renameListLabel')}">
        ${esc(state.activeList.name)}
        <i data-lucide="pencil" class="list-header__edit-icon" aria-hidden="true"></i>
      </span>
      <div class="page-toolbar__actions">
        <!-- Der Kopf trägt NUR NOCH die drei dauerhaften Aktionen.
             „In den Vorrat" und „Abgehakt löschen" standen hier und kosteten mobil
             zwei zusätzliche Kopfzeilen: der Titel füllte die erste Zeile allein
             (er wächst, und die Aktionsgruppe brach wegen ihrer
             max-content-Breite um), darunter brachen die beiden Labels
             (140px + 197px gegen 361px) noch einmal. Kopfhöhe 173px bei 393px,
             229px bei 320px. Sie sitzen jetzt in der geteilten
             .kitchen-bulkbar über der Liste - derselben Leiste, in der der Vorrat
             seine Sammelaktion trägt (Critique 2026-07-30, P1). -->
        <!-- Die drei dauerhaften Aktionen zweimal im DOM: einmal als Leiste (ab
             768px), einmal als Menü-Einträge (darunter). CSS entscheidet, welche
             Fassung Platz hat; display:none nimmt die andere auch aus der
             Tabfolge. Das ist im Repo das etablierte Muster für responsives
             Chrome, und beide Fassungen tragen dieselben data-action-Werte -
             der delegierte Handler unterscheidet sie gar nicht. -->
        <div class="list-header__inline-actions">
          <button class="btn btn--ghost list-header__import-btn" data-action="import-meals"
                  aria-label="${t('shopping.importMeals')}" title="${t('shopping.importMeals')}">
            <i data-lucide="utensils" class="icon-md" aria-hidden="true"></i>
            <span>${t('shopping.importMeals')}</span>
          </button>
          <button class="btn btn--ghost btn--icon" data-action="manage-categories"
                  aria-label="${t('shopping.manageCategories')}" title="${t('shopping.manageCategories')}">
            <i data-lucide="tags" class="icon-md" aria-hidden="true"></i>
          </button>
          <button class="btn btn--ghost btn--icon" data-action="delete-list"
                  data-id="${state.activeList.id}" aria-label="${t('shopping.deleteListLabel')}"
                  title="${t('shopping.deleteListLabel')}">
            <i data-lucide="trash" class="icon-md" aria-hidden="true"></i>
          </button>
        </div>
        <div class="list-header__more">
          ${popoverMenuHtml({
            id: 'list-head-menu',
            label: t('common.moreActions'),
            items: [
              { action: 'import-meals', label: t('shopping.importMeals'), icon: 'utensils' },
              { action: 'manage-categories', label: t('shopping.manageCategories'), icon: 'tags' },
              { action: 'delete-list', label: t('shopping.deleteListLabel'), icon: 'trash', id: state.activeList.id, danger: true },
            ],
          })}
        </div>
      </div>`);
    if (window.lucide) window.lucide.createIcons({ el: head });
  }

  content.replaceChildren();
  content.insertAdjacentHTML('beforeend', `
    <!-- Quick-Add -->
    <div class="quick-add">
      <form class="quick-add__form" id="quick-add-form" novalidate autocomplete="off">
        <div class="quick-add__input-wrap">
          <input class="quick-add__input" type="text" id="item-name-input"
                 placeholder="${t('shopping.itemNamePlaceholder')}" aria-label="${t('shopping.itemNameLabel')}" autocomplete="off">
          <div class="autocomplete-dropdown" id="autocomplete-dropdown" hidden></div>
        </div>
        <input class="quick-add__qty" type="text" id="item-qty-input"
               placeholder="${t('shopping.itemQtyPlaceholder')}" aria-label="${t('shopping.itemQtyLabel')}" autocomplete="off">
        <select class="quick-add__cat" id="item-cat-select" aria-label="${t('shopping.categoryLabel')}">
          ${state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === DEFAULT_CATEGORY_NAME ? 'selected' : ''}>${esc(categoryLabel(c.name))}</option>`).join('')}
        </select>
        <button class="quick-add__btn" type="submit" aria-label="${t('shopping.addItemLabel')}">
          <i data-lucide="plus" class="icon-lg" aria-hidden="true"></i>
        </button>
      </form>
    </div>

    <!-- Sammelaktions-Leiste, ÜBER dem Scroller und als GESCHWISTER der Liste.
         Nicht darin: updateCheckedActions() läuft beim Abhaken einzelner Artikel,
         ohne die Liste neu zu bauen (Issue #276, Scroll-Position), und mountItems()
         leert #items-list komplett. Als Kind der Liste würde eines das andere
         überschreiben. -->
    <div class="kitchen-bulkbar" id="list-header-checked" hidden></div>

    <!-- Artikel-Liste; Inhalt via mountItems(), damit der Leerzustand über den
         geteilten Renderer läuft statt als HTML-String hier drin. -->
    <div class="kitchen-list items-list" id="items-list"></div>
  `);

  mountItems(content.querySelector('#items-list'), container);

  if (window.lucide) window.lucide.createIcons({ el: content });
  stagger(content.querySelectorAll('.shopping-item'));
  wireAutocomplete(container);
  wireQuickAdd(container);
  syncQuickAddDisclosure(container, false);
  maybeShowSwipeHint(container);
  // Der Kopf rendert den Container leer; erst hier stehen die abgehakten
  // Artikel fest, aus denen die Aktionen entstehen.
  updateCheckedActions(container);
}

/**
 * Füllt den Artikel-Container: entweder Kategorie-Gruppen oder den
 * Leerzustand über den geteilten Renderer.
 *
 * Der Leerzustand lag vorher als HTML-String in `renderItems()` und trug als
 * einziger im Modul ein handgezeichnetes Inline-SVG statt eines Lucide-Icons -
 * dieselbe Warenkorb-Form, nur mit eigener Strichstärke (Critique 2026-07-29).
 */
function mountItems(listEl, container) {
  if (!listEl) return;

  // Artikel nicht ladbar: eigener Fehler mit eigener Wiederholung. Die Liste
  // existiert und ist im Kopf benannt - nur ihr Inhalt fehlt, also lädt der
  // Retry auch nur diese eine Liste nach.
  if (state.itemsError) {
    mountLoadError(listEl, {
      title: t('shopping.itemsLoadError'),
      description: t('common.loadErrorDescription'),
      error: state.itemsError,
      retryLabel: t('common.retry'),
      onRetry: container
        ? () => switchList(state.activeListId, container)
        : undefined,
    });
    return;
  }

  if (!state.items.length) {
    mountEmptyState(listEl, {
      icon: 'shopping-cart',
      title: t('shopping.emptyList'),
      description: t('shopping.emptyListDescription'),
      hint: t('emptyHint.shopping'),
      action: {
        label: t('shopping.emptyAction'),
        icon: 'plus',
        onClick: () => document.querySelector('.page-fab')?.click(),
      },
    });
    return;
  }

  listEl.replaceChildren();
  listEl.insertAdjacentHTML('beforeend', renderItems());
}

function renderItems() {
  const groups = groupItemsByCategory(state.items);
  // Geteilte Gruppen-Grammatik (styles/kitchen-row.css): .kitchen-group ordnet,
  // .kitchen-rows trägt die weiße Fläche und die Trennlinien. Die Zeilen selbst
  // sind flächenlos - vorher war Einkaufen eine Trennlinien-Liste und der Vorrat
  // eine Kartenliste, dieselbe Sache in zwei Paradigmen (Critique 2026-07-30).
  return groups.map(([cat, items]) => `
    <div class="kitchen-group item-category">
      <div class="kitchen-group__title">
        <i data-lucide="${catIcon(cat)}" class="icon-sm" aria-hidden="true"></i>
        ${esc(categoryLabel(cat))}
        <span class="kitchen-group__count">${items.length}</span>
      </div>
      <div class="kitchen-rows">
        ${items.map(renderItem).join('')}
      </div>
    </div>`).join('');
}

/**
 * Dezente Inline-Indikatoren (Progressive Disclosure): zeigen an, dass ein
 * Artikel zusätzliche Details (Link/Notiz) trägt, ohne die Zeile zu überladen.
 * Rein visuell (aria-hidden) — der Zugang läuft über den beschrifteten Details-Button.
 */
function renderItemMeta(item) {
  const bits = [];
  if (item.url)   bits.push('<i data-lucide="link" class="item-meta__icon" aria-hidden="true"></i>');
  if (item.notes) bits.push('<i data-lucide="sticky-note" class="item-meta__icon" aria-hidden="true"></i>');
  return bits.length ? `<span class="item-meta">${bits.join('')}</span>` : '';
}

// Wie viele Tags eine Zeile zeigt, bevor sie zusammenfasst - wie auf den
// Aufgabenkarten.
const ITEM_TAGS_VISIBLE = 3;

/**
 * Gespiegelte VTODO-CATEGORIES eines Einkaufspostens (#586).
 *
 * Anzeige, keine Bedienung: die Etiketten gehören der CalDAV-Quellliste, Yuvomi
 * verwaltet sie hier nicht und schreibt sie auch nicht zurück. Deshalb <span>
 * statt Button - anders als in den Aufgaben, wo ein Klick danach filtert.
 */
function renderItemTags(tags) {
  if (!tags?.length) return '';
  const shown = tags.slice(0, ITEM_TAGS_VISIBLE);
  const rest  = tags.length - shown.length;
  const chips = shown.map((tag) => `<span class="item-tag">${esc(tag)}</span>`);
  if (rest > 0) {
    chips.push(`<span class="item-tag item-tag--more"
                      title="${esc(tags.slice(ITEM_TAGS_VISIBLE).join(', '))}">+${rest}</span>`);
  }
  return `<div class="kitchen-row__tags">${chips.join('')}</div>`;
}

function renderItem(item) {
  const isDone = Boolean(item.is_checked);
  return `
    <div class="swipe-row" data-swipe-id="${item.id}" data-swipe-checked="${item.is_checked}">
      <div class="swipe-reveal swipe-reveal--done" aria-hidden="true">
        <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" class="icon-xl" aria-hidden="true"></i>
        <span>${isDone ? t('shopping.swipeBack') : t('shopping.swipeCheck')}</span>
      </div>
      <div class="swipe-reveal swipe-reveal--delete" aria-hidden="true">
        <i data-lucide="trash-2" class="icon-xl" aria-hidden="true"></i>
        <span>${t('shopping.swipeDelete')}</span>
      </div>
      <div class="kitchen-row shopping-item ${isDone ? 'shopping-item--checked' : ''}"
           data-item-id="${item.id}">
        <button class="item-check ${isDone ? 'item-check--checked' : ''}"
                data-action="toggle-item" data-id="${item.id}" data-checked="${item.is_checked}"
                aria-label="${isDone ? t('shopping.markUndoneLabel', { name: esc(item.name) }) : t('shopping.markDoneLabel', { name: esc(item.name) })}">
          <i data-lucide="check" class="item-check__icon" aria-hidden="true"></i>
        </button>
        <div class="kitchen-row__main">
          <div class="kitchen-row__name">${esc(item.name)}${renderItemMeta(item)}</div>
          ${item.quantity ? `<div class="kitchen-row__meta">${esc(item.quantity)}</div>` : ''}
          ${renderItemTags(item.tags)}
        </div>
        <!-- Geteilte .row-action-Grammatik aus layout.css (app-weit von sieben
             Modulen genutzt), gruppiert in der geteilten .kitchen-row__actions -
             vorher hingen die zwei Buttons als direkte Flex-Kinder in der Zeile,
             wodurch die Bedienzone in jedem Tab anders zusammengesetzt war. -->
        <div class="kitchen-row__actions">
          <button class="row-action" data-action="item-details" data-id="${item.id}"
                  aria-label="${t('shopping.detailsLabel', { name: esc(item.name) })}">
            <i data-lucide="pencil" class="icon-md" aria-hidden="true"></i>
          </button>
          <button class="row-action row-action--danger" data-action="delete-item" data-id="${item.id}"
                  aria-label="${t('shopping.deleteItemLabel', { name: esc(item.name) })}">
            <i data-lucide="x" class="icon-md" aria-hidden="true"></i>
          </button>
        </div>
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

        dropdown.replaceChildren();
        dropdown.insertAdjacentHTML('beforeend', suggestions.map((s, i) =>
          `<div class="autocomplete-item" data-idx="${i}" data-value="${esc(s)}">${esc(s)}</div>`
        ).join(''));
        dropdown.hidden = false;
        activeIdx = -1;

        dropdown.querySelectorAll('.autocomplete-item').forEach((el) => {
          el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = el.dataset.value;
            dropdown.hidden = true;
          });
        });

        if (window.lucide) window.lucide.createIcons({ el: dropdown });
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
    if (window.lucide) window.lucide.createIcons({ el: btn });
  }, 700);
}

// --------------------------------------------------------
// Quick-Add als Disclosure (nur Touch)
// --------------------------------------------------------

/**
 * Auf Touch ist das Quick-Add eingeklappt und der FAB öffnet es.
 *
 * WARUM: Der Einkauf trug mobil 439 von 852px Chrome, bevor ein Artikel sichtbar
 * war (52%; bei 320px 495 von 720 = 69%). Das zweizeilige Quick-Add ist davon
 * 126px - und es ist der einzige Tab, dessen FAB kein Formular öffnet, sondern
 * nur ein bereits sichtbares Feld fokussiert. Ein Griff löst beides: der FAB tut
 * dasselbe wie in Mahlzeiten, Rezepten und Vorrat, und die Liste beginnt weiter
 * oben (Critique 2026-07-30, P1).
 *
 * KEIN BOTTOM-SHEET, obwohl der FAB unten sitzt und die Tastatur unten aufgeht:
 * das Feld bleibt an seinem Platz über der Liste, wird nur enthüllt und
 * eingescrollt. Ein Sheet wäre die schönere Geste und ein zweiter Overlay-Typ mit
 * eigenem Focus-Trap - „Modal als erster Gedanke" ist in diesem Projekt ein
 * ausdrücklich verbotenes Muster, und die Eingabe gehört sichtbar zur Liste, in
 * die sie schreibt.
 *
 * Der Zustand hängt an `.shopping-page--adding` (siehe shopping.css) statt an
 * einem `hidden` am Formular: das Kriterium ist die Zeigerfähigkeit, und die
 * kennt nur CSS. JS setzt die Absicht, CSS entscheidet, ob sie überhaupt eine
 * Wirkung hat - auf Desktop ist die Klasse ein No-op.
 *
 * @param {Element} container
 * @param {boolean} open
 */
function syncQuickAddDisclosure(container, open) {
  const page = container.querySelector('.shopping-page');
  const fab = findPageFab('fab-new-item');
  if (!page || !fab) return;

  const collapsible = window.matchMedia('(hover: none)').matches && Boolean(state.activeList);
  page.classList.toggle('shopping-page--adding', collapsible && open);

  // `aria-expanded` NUR wo der Knopf tatsächlich etwas aufklappt. Auf Desktop
  // fokussiert er ein sichtbares Feld; ein „eingeklappt" zu melden, was gar nicht
  // eingeklappt ist, wäre eine Falschaussage an den Screenreader.
  if (collapsible) {
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-controls', 'quick-add-form');
  } else {
    fab.removeAttribute('aria-expanded');
    fab.removeAttribute('aria-controls');
  }
}

function wireQuickAdd(container) {
  const form = container.querySelector('#quick-add-form');
  if (!form) return;

  // Esc klappt zu und gibt den Fokus an den FAB zurück - dieselbe Zusage wie im
  // Modal, wo Esc schließt und den Auslöser wieder fokussiert.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const page = container.querySelector('.shopping-page');
    if (!page?.classList.contains('shopping-page--adding')) return;
    e.stopPropagation();
    syncQuickAddDisclosure(container, false);
    findPageFab('fab-new-item')?.focus();
  });

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
      nameInput.classList.add('quick-add__input--flash');
      nameInput.addEventListener('animationend', () => nameInput.classList.remove('quick-add__input--flash'), { once: true });
    } catch (err) {
      window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    }
  });
}

// --------------------------------------------------------
// Swipe-Affordance Hint (Long Loop)
// Zeigt den Nudge-Hinweis maximal 3x (gespeichert in localStorage).
// --------------------------------------------------------

const SWIPE_HINT_KEY  = 'yuvomi:swipeHintSeen';
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
            // Nur die Zeile aktualisieren — Scroll-Position bewahren (Issue #276).
            updateItemRow(container, item);
            updateCheckedActions(container);
            updateListCounter(state.activeListId, 0, newVal ? 1 : -1);
            renderTabs(container);
          }
          try {
            await api.patch(`/shopping/items/${itemId}`, { is_checked: newVal });
            vibrate(10);
          } catch (err) {
            if (item) {
              item.is_checked = checked;
              updateItemRow(container, item);
              updateCheckedActions(container);
              updateListCounter(state.activeListId, 0, newVal ? -1 : 1);
              renderTabs(container);
            }
            window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
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
            window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
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

/**
 * Aktualisiert nur die DOM-Zeile eines einzelnen Artikels (Checked-Status),
 * ohne die gesamte Liste neu aufzubauen. Da das Abhaken die Gruppierung nicht
 * ändert, bleibt so die Scroll-Position des Listen-Containers erhalten (Issue #276).
 */
function updateItemRow(container, item) {
  const row = container.querySelector(`.swipe-row[data-swipe-id="${item.id}"]`);
  if (!row) return;
  const isDone = Boolean(item.is_checked);

  row.dataset.swipeChecked = String(item.is_checked);

  row.querySelector('.shopping-item')?.classList.toggle('shopping-item--checked', isDone);

  const checkBtn = row.querySelector('.item-check');
  if (checkBtn) {
    checkBtn.classList.toggle('item-check--checked', isDone);
    checkBtn.dataset.checked = String(item.is_checked);
    checkBtn.setAttribute('aria-label', isDone
      ? t('shopping.markUndoneLabel', { name: item.name })
      : t('shopping.markDoneLabel', { name: item.name }));
  }

  // Swipe-Affordance (links) spiegelt den neuen Status
  const reveal = row.querySelector('.swipe-reveal--done');
  if (reveal) {
    reveal.replaceChildren();
    reveal.insertAdjacentHTML('beforeend', `
      <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" class="icon-xl" aria-hidden="true"></i>
      <span>${isDone ? t('shopping.swipeBack') : t('shopping.swipeCheck')}</span>`);
    if (window.lucide) window.lucide.createIcons({ el: reveal });
  }
}

/**
 * Aktualisiert Name, Menge und die Detail-Indikatoren (Link/Notiz) einer Zeile,
 * ohne das .shopping-item-Element zu ersetzen — so bleiben die
 * Swipe-Gesten-Closures (die die Karte einmalig referenzieren) intakt.
 *
 * Deckte vorher nur die Indikatoren ab: Name und Menge waren im Dialog gar nicht
 * änderbar (Critique 2026-07-30, P2). Seit sie es sind, muss die Zeile beide
 * mitziehen - und die Menge kann von „vorhanden" auf „leer" wechseln, also muss
 * das Meta-Element auch verschwinden können.
 */
function refreshItemName(container, item) {
  const card = container.querySelector(`.shopping-item[data-item-id="${item.id}"]`);
  const nameEl = card?.querySelector('.kitchen-row__name');
  if (!nameEl) return;

  nameEl.replaceChildren(document.createTextNode(item.name));
  const metaHtml = renderItemMeta(item);
  if (metaHtml) {
    nameEl.insertAdjacentHTML('beforeend', metaHtml);
    if (window.lucide) window.lucide.createIcons({ el: nameEl });
  }

  const main = card.querySelector('.kitchen-row__main');
  const qtyEl = main?.querySelector('.kitchen-row__meta');
  if (item.quantity) {
    if (qtyEl) {
      qtyEl.textContent = item.quantity;
    } else {
      main?.insertAdjacentHTML('beforeend', `<div class="kitchen-row__meta">${esc(item.quantity)}</div>`);
    }
  } else {
    qtyEl?.remove();
  }
}

/**
 * Artikel bearbeiten.
 *
 * WAS HIER FALSCH WAR (Critique 2026-07-30, P2): dieser Dialog und das
 * strukturgleiche Vorrats-Modal sind dieselbe Handlung - „diesen Eintrag ändern" -
 * und waren zwei verschiedene Dinge. Der Vorrat: Titel „Artikel bearbeiten", acht
 * Felder, Löschen / Abbrechen / Speichern. Der Einkauf: der DATENWERT als Titel
 * („Cherry tomatoes"), zwei Felder (Link, Notiz), Schließen und Speichern - KEIN
 * Abbrechen, und Name und Menge waren gar nicht änderbar. Wer einen Tippfehler im
 * Artikelnamen hatte, musste die Zeile löschen und neu anlegen.
 *
 * Jetzt: derselbe Titel aus demselben Key, Name / Menge / Kategorie editierbar,
 * Abbrechen neben Speichern. Die Rich-Felder (Link, Notiz) bleiben, wo sie waren -
 * sie sind der Grund, aus dem der Dialog existiert, und der Quick-Add bleibt
 * bewusst schlank.
 *
 * KEIN LÖSCHEN im Dialog, anders als im Vorrat: die Einkaufszeile trägt es selbst
 * (× auf Zeigergeräten, Wischen auf Touch), und beide Wege haben Undo. Ein dritter
 * Weg an einer Stelle, an der man gerade einen Namen tippt, wäre eine
 * Fehlerquelle, kein Gewinn.
 */
function openItemDetails(itemId, container) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const linkPreview = (value) => {
    const v = String(value ?? '').trim();
    if (!/^https?:\/\//i.test(v)) return '';
    return `
      <a class="item-details__link" href="${esc(v)}" target="_blank" rel="noopener noreferrer">
        <i data-lucide="external-link" class="icon-sm" aria-hidden="true"></i>${t('shopping.openLink')}
      </a>`;
  };

  openModal({
    title: t('common.editItem'),
    size: 'md',
    content: `
      <form id="item-details-form" class="item-details-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="item-details-name">${t('common.nameLabel')}</label>
          <input class="form-input" type="text" id="item-details-name" required
                 value="${esc(item.name)}">
        </div>
        <div class="pantry-form-row">
          <div class="form-group">
            <label class="form-label" for="item-details-qty">${t('shopping.itemQtyLabel')}</label>
            <input class="form-input" type="text" id="item-details-qty"
                   placeholder="${t('shopping.itemQtyPlaceholder')}" value="${esc(item.quantity || '')}">
          </div>
          <div class="form-group">
            <label class="form-label" for="item-details-cat">${t('shopping.categoryLabel')}</label>
            <select class="form-input" id="item-details-cat">
              ${state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === item.category ? 'selected' : ''}>${esc(categoryLabel(c.name))}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="item-details-url">${t('shopping.urlLabel')}</label>
          <input class="form-input" type="url" id="item-details-url" inputmode="url"
                 placeholder="${t('shopping.urlPlaceholder')}" value="${esc(item.url || '')}">
          <div class="item-details__link-wrap" id="item-details-link">${linkPreview(item.url)}</div>
        </div>
        <div class="form-group">
          <label class="form-label" for="item-details-notes">${t('shopping.notesLabel')}</label>
          <textarea class="form-input" id="item-details-notes" rows="4"
                    placeholder="${t('shopping.notesPlaceholder')}">${esc(item.notes || '')}</textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" id="item-details-cancel">${t('common.cancel')}</button>
          <button type="submit" class="btn btn--primary">${t('common.save')}</button>
        </div>
      </form>`,
    onSave: (panel) => {
      const form    = panel.querySelector('#item-details-form');
      const nameEl  = panel.querySelector('#item-details-name');
      const qtyEl   = panel.querySelector('#item-details-qty');
      const catEl   = panel.querySelector('#item-details-cat');
      const urlEl   = panel.querySelector('#item-details-url');
      const notesEl = panel.querySelector('#item-details-notes');
      const preview = panel.querySelector('#item-details-link');

      panel.querySelector('#item-details-cancel')?.addEventListener('click', () => closeModal());

      urlEl?.addEventListener('input', () => {
        preview.replaceChildren();
        const html = linkPreview(urlEl.value);
        if (html) {
          preview.insertAdjacentHTML('beforeend', html);
          if (window.lucide) window.lucide.createIcons({ el: preview });
        }
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameEl.value.trim();
        if (!name) {
          reportFieldError(nameEl, t('common.nameRequired'));
          return;
        }
        const payload = {
          name,
          quantity: qtyEl.value.trim() || null,
          category: catEl.value,
          notes: notesEl.value.trim() || null,
          url: urlEl.value.trim() || null,
        };
        try {
          const data = await api.patch(`/shopping/items/${item.id}`, payload);
          const categoryChanged = data.data.category !== item.category;
          Object.assign(item, data.data);
          // force: der Dirty-Guard vergleicht gegen den Snapshot vom Öffnen und
          // sähe die gerade gespeicherten Felder als ungespeicherte Änderungen.
          // Ohne das fragte Speichern „Änderungen verwerfen?" (Issue #625).
          closeModal({ force: true });
          // Ein Kategoriewechsel verschiebt die Zeile in eine andere Gruppe - das
          // kann keine Zeilen-Auffrischung leisten, dafür muss die Liste neu
          // gruppiert werden. Sonst genügt der schonende Weg, der die
          // Swipe-Closures und die Scroll-Position erhält (Issue #276).
          if (categoryChanged) {
            updateItemsList(container);
          } else {
            updateItemRow(container, item);
            refreshItemName(container, item);
          }
        } catch (err) {
          window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

function updateItemsList(container) {
  const listEl = container.querySelector('#items-list');
  if (listEl) {
    // mountItems() verdrahtet den CTA des Leerzustands selbst; der frühere
    // nachgelagerte #empty-cta-shopping-Listener entfällt damit.
    mountItems(listEl, container);
    if (window.lucide) window.lucide.createIcons({ el: listEl });
    stagger(listEl.querySelectorAll('.shopping-item'));
    wireSwipeGestures(container);
    maybeShowSwipeHint(container);
  }
  updateCheckedActions(container);
}

/**
 * Zerlegt den Freitext einer Einkaufsmenge in Zahl + Vorrats-Einheit.
 *
 * Bewusst nur die international geschriebenen metrischen Symbole: das Feld ist
 * Freitext in der Sprache des Haushalts, und ein deutschsprachiger Wortschatz
 * („Packung", „Dose") würde in 22 der 23 Sprachen ins Leere greifen. Zahl und
 * g/kg/ml/l sind sprachunabhängig und tragen den Großteil des Nutzens; alles
 * andere landet bei „Stück" und lässt sich im Dialog in einem Griff ändern.
 */
function parseShoppingQuantity(raw) {
  const fallback = { quantity: 1, unit: 'pcs' };
  const text = String(raw ?? '').trim();
  if (!text) return fallback;

  // Die Einheit braucht eine Wortgrenze davor, sonst schluckt `\b` sie bei
  // Schreibweisen wie „3x" nicht und die Menge fiele auf 1 zurück.
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:(kg|g|ml|l)\b)?/i);
  if (!match) return fallback;

  const quantity = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) return fallback;

  return { quantity, unit: match[2] ? match[2].toLowerCase() : 'pcs' };
}

/**
 * Übernahme-Dialog „Einkauf → Vorrat". Ein gemeinsamer Lagerort für alle
 * Artikel plus Menge/Einheit je Zeile: nach dem Einkauf räumt man einen Beutel
 * an einen Ort ein, nicht zwölf Artikel an zwölf Orte. Haltbarkeitsdaten bleiben
 * hier bewusst außen vor - sie sind die Ausnahme, nicht die Regel, und im
 * Vorrat einen Tap entfernt.
 */
async function openPantryTransfer(container) {
  const checked = state.items.filter((i) => i.is_checked);
  if (!checked.length) return;

  let locations = [];
  try {
    const res = await api.get('/pantry/locations');
    locations = res.data ?? [];
  } catch (err) {
    window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
    return;
  }

  const { PANTRY_UNITS } = await import('/utils/pantry-units.js');
  const { locationLabel } = await import('/utils/pantry-locations.js');

  const unitOptions = (selected) => PANTRY_UNITS
    .map((u) => `<option value="${esc(u)}" ${u === selected ? 'selected' : ''}>${esc(t(`pantry.units.${u}`))}</option>`)
    .join('');

  const rows = checked.map((item) => {
    const parsed = parseShoppingQuantity(item.quantity);
    return `
      <li class="pantry-transfer__row" data-id="${item.id}">
        <span class="pantry-transfer__name">${esc(item.name)}</span>
        <input class="form-input pantry-transfer__qty" type="number" min="0" step="any" inputmode="decimal"
               value="${parsed.quantity}" aria-label="${esc(`${t('pantry.quantityLabel')}: ${item.name}`)}">
        <select class="form-input pantry-transfer__unit" aria-label="${esc(`${t('pantry.unitLabel')}: ${item.name}`)}">
          ${unitOptions(parsed.unit)}
        </select>
      </li>`;
  }).join('');

  openModal({
    title: t('shopping.toPantryTitle'),
    size: 'lg',
    content: `
      <p class="pantry-transfer__intro">${esc(t('shopping.toPantryDescription', { count: checked.length }))}</p>
      <div class="form-group">
        <label class="form-label" for="pantry-transfer-location">${esc(t('pantry.locationLabel'))}</label>
        <select id="pantry-transfer-location" class="form-input">
          <option value="">${esc(t('pantry.unlocated'))}</option>
          ${locations.map((loc) => `<option value="${loc.id}">${esc(locationLabel(loc.name))}</option>`).join('')}
        </select>
      </div>
      <ul class="pantry-transfer__list">${rows}</ul>
      <!-- Geteiltes .form-check (layout.css): 20px-Box in Modul-Akzent, Label mit
           eigener Trefferflaeche. Das war die folgenreichste Checkbox des Moduls -
           sie loescht die eingekauften Artikel von der Liste, ist standardmaessig
           aktiv, und war als nackte System-Checkbox in System-Groesse die
           unauffaelligste (Critique 2026-07-30, P2). Der Default bleibt aktiv: wer
           eingekauft und eingeraeumt hat, will nicht doppelt kaufen. -->
      <label class="form-check pantry-transfer__clear">
        <input type="checkbox" id="pantry-transfer-clear" checked>
        <span>${esc(t('shopping.toPantryClearList'))}</span>
      </label>
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn--primary" id="pantry-transfer-confirm">${esc(t('common.apply'))}</button>
      </div>`,
    onSave(panel) {
      // Der erste Ort ist der wahrscheinlichste Standardwert; er ist zugleich
      // der, den der Haushalt in der Lagerort-Verwaltung nach oben sortiert hat.
      if (locations.length) panel.querySelector('#pantry-transfer-location').value = String(locations[0].id);

      panel.querySelector('#pantry-transfer-confirm').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const locationId = panel.querySelector('#pantry-transfer-location').value || null;
        const clearList = panel.querySelector('#pantry-transfer-clear').checked;
        const listId = state.activeListId;

        const items = [...panel.querySelectorAll('.pantry-transfer__row')].map((row) => ({
          shopping_item_id: Number(row.dataset.id),
          quantity: Number(row.querySelector('.pantry-transfer__qty').value) || 1,
          unit: row.querySelector('.pantry-transfer__unit').value,
          location_id: locationId,
        }));

        btn.disabled = true;
        try {
          const res = await api.post('/pantry/import-shopping', { list_id: listId, items });
          const stored = (res.data?.added ?? 0) + (res.data?.merged ?? 0);

          if (clearList && stored) {
            // Zweiter, getrennter Aufruf: der Vorrats-Router räumt bewusst
            // nichts im Einkauf ab, damit ein `pantry:write`-Token dort keine
            // Daten löschen kann (siehe routes/pantry.js).
            await api.delete(`/shopping/${listId}/items/checked`);
            const removed = checked.length;
            state.items = state.items.filter((i) => !i.is_checked);
            updateItemsList(container);
            updateListCounter(listId, -removed, -removed);
            renderTabs(container);
          }

          closeModal({ force: true });
          // Der Vorrat ist ein einziges Ziel, der Toast nennt ihn also schon. Was er
          // NICHT nennt, ist der Lagerort - und der ist die Wahl, die der Nutzer im
          // Dialog gerade getroffen hat.
          const locationName = locationId
            ? (locations.find((l) => String(l.id) === String(locationId))?.name ?? '')
            : '';
          window.yuvomi.showToast(
            stored
              ? (locationName
                ? t('shopping.toPantryDoneAt', { count: stored, location: locationLabel(locationName) })
                : t('shopping.toPantryDone', { count: stored }))
              : t('shopping.toPantryNothing'),
            stored ? 'success' : 'info'
          );
          // Der Vorrats-Tab zeigt jetzt eine andere Zahl.
          refreshKitchenBadges();
        } catch (err) {
          btn.disabled = false;
          window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

/**
 * Baut die Sammelaktions-Leiste neu auf, die an abgehakten Artikeln hängt.
 * Reihenfolge: erst „In den Vorrat", dann „Erledigte löschen" — ein erledigter
 * Einkauf endet im Regal, nicht im Papierkorb, und die Übernahme räumt die Liste
 * auf Wunsch gleich mit ab.
 *
 * Die Leiste trägt eine erklärende Zeile („3 Artikel abgehakt.") - genau der Teil,
 * der im Kopf fehlte: dort standen zwei Buttons, ohne dass irgendwo stand, auf
 * welche Teilmenge sie wirken. Der Vorrat hatte diese Zeile schon, und der
 * Critique nannte sie als das, was funktioniert.
 *
 * `hidden` statt eines leeren Containers: die Leiste hat eine Fläche, einen Rahmen
 * und Polsterung - leer wäre sie ein sichtbarer 42px-Streifen über der Liste. Die
 * [hidden]-Durchsetzung für `.kitchen-bulkbar` steht in layout.css, weil
 * `display: flex` das UA-`[hidden]` sonst schlägt.
 */
function updateCheckedActions(container) {
  const wrap = container.querySelector('#list-header-checked');
  if (!wrap) return;

  const checkedCount = state.items.filter((i) => i.is_checked).length;
  wrap.replaceChildren();
  wrap.hidden = !checkedCount;
  if (!checkedCount) return;

  const pantryEnabled = !window.yuvomi?.isModuleDisabled?.('pantry');
  wrap.insertAdjacentHTML('beforeend', `
    <span class="kitchen-bulkbar__label">${esc(t('shopping.checkedHint', { count: checkedCount }))}</span>
    ${pantryEnabled ? `
      <button class="btn btn--secondary kitchen-bulkbar__action" data-action="to-pantry">
        <i data-lucide="archive" class="icon-sm" aria-hidden="true"></i>
        <span>${esc(t('shopping.toPantry'))}</span>
      </button>` : ''}
    <!-- Nur das Verb, nicht „Abgehakt löschen": die Zeile darüber nennt den Bezug
         („3 Artikel abgehakt."), und bei 320px sind 262px Innenbreite gemessen -
         mit 134px für „In den Vorrat" und 169px für das lange Label brach die
         Leiste in eine dritte Zeile (159px hoch). Mit dem Verb allein sind es
         253px und die Leiste bleibt auf allen Breiten zweizeilig. Die Aktion ist
         zudem rückholbar (scheduleUndoableDelete), das Löschen der ganzen Liste
         sitzt woanders (Überlaufmenü) und hat einen Bestätigungsdialog. -->
    <button class="btn btn--ghost kitchen-bulkbar__action" data-action="clear-checked"
            aria-label="${esc(t('shopping.clearChecked', { count: checkedCount }))}">
      <i data-lucide="trash-2" class="icon-sm" aria-hidden="true"></i>
      <span>${esc(t('common.delete'))}</span>
    </button>`);
  if (window.lucide) window.lucide.createIcons({ el: wrap });
}

function updateListCounter(listId, totalDelta, checkedDelta) {
  const list = state.lists.find((l) => l.id === listId);
  if (list) {
    list.item_total   = (list.item_total   || 0) + totalDelta;
    list.item_checked = (list.item_checked || 0) + checkedDelta;
  }
}

function openMealPlanImport(container) {
  if (!state.activeListId) return;
  const today = toLocalDateKey(new Date());
  const defaultTo = addLocalDays(today, 6);

  openModal({
    title: t('shopping.importMealsTitle'),
    size: 'sm',
    content: `
      <form id="shopping-import-meals-form" class="shopping-import-meals-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="shopping-import-from">${t('calendar.fromLabel')}</label>
          <yuvomi-datepicker type="date" id="shopping-import-from" value="${esc(today)}"></yuvomi-datepicker>
        </div>
        <div class="form-group">
          <label class="form-label" for="shopping-import-to">${t('calendar.toLabel')}</label>
          <yuvomi-datepicker type="date" id="shopping-import-to" value="${esc(defaultTo)}"></yuvomi-datepicker>
        </div>
        <p class="form-hint" id="shopping-import-preview" role="status" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" id="shopping-import-cancel">${t('common.cancel')}</button>
          <!-- Startet deaktiviert und wird von updatePreview() freigeschaltet, sobald
               der Zeitraum Zutaten enthaelt. Die Schwesteraktion „Plan zufaellig
               fuellen" macht das seit dem Audit korrekt; hier blieb „Uebernehmen"
               bei 0 Treffern klickbar und quittierte mit einem Info-Toast, dass
               nichts passiert ist (Critique 2026-07-30, P2). -->
          <button type="submit" class="btn btn--primary" id="shopping-import-submit" disabled>${t('common.apply')}</button>
        </div>
      </form>`,
    onSave: (panel) => {
      const form = panel.querySelector('#shopping-import-meals-form');
      const cancelBtn = panel.querySelector('#shopping-import-cancel');
      cancelBtn?.addEventListener('click', () => closeModal());

      // Vorschau vor dem Import (Audit A1-22): dieselbe Route rechnet mit
      // preview:true nur, statt zu schreiben - der Dialog sagt, was passiert.
      const previewEl = panel.querySelector('#shopping-import-preview');
      const submitBtn = panel.querySelector('#shopping-import-submit');
      async function updatePreview() {
        const from = panel.querySelector('#shopping-import-from')?.value || '';
        const to = panel.querySelector('#shopping-import-to')?.value || '';
        if (!from || !to || !previewEl) return;
        try {
          const data = await api.post(`/shopping/${state.activeListId}/import-meal-plan`, { from, to, preview: true });
          const transferred = Number(data.data?.transferred) || 0;
          const meals = Number(data.data?.meals) || 0;
          // Zwei Zahlachsen, eine Pluralmechanik: t() dekliniert nur über
          // `count`. Die Mahlzeiten-Angabe kommt deshalb als eigener, selbst
          // pluralisierter Teilstring herein (Audit A2-21: "aus 1 Mahlzeiten").
          previewEl.textContent = transferred
            ? t('shopping.importMealsPreview', {
              count: transferred,
              mealsText: t('shopping.importMealsPreviewMeals', { count: meals }),
            })
            : t('shopping.importMealsEmpty');
          submitBtn.disabled = !transferred;
        } catch {
          previewEl.textContent = '';
          // Vorschau fehlgeschlagen: nicht sperren. Der Nutzer soll es versuchen
          // duerfen, statt an einem toten Knopf zu haengen, weil eine
          // Nebenanfrage scheiterte.
          submitBtn.disabled = false;
        }
      }
      updatePreview();
      panel.querySelector('#shopping-import-from')?.addEventListener('change', updatePreview);
      panel.querySelector('#shopping-import-to')?.addEventListener('change', updatePreview);
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const from = panel.querySelector('#shopping-import-from')?.value || '';
        const to = panel.querySelector('#shopping-import-to')?.value || '';
        if (!from || !to) return;
        try {
          const data = await api.post(`/shopping/${state.activeListId}/import-meal-plan`, { from, to });
          if (!data.data?.transferred) {
            window.yuvomi.showToast(t('shopping.importMealsEmpty'), 'default');
            return;
          }
          await Promise.all([loadLists(), loadItems(state.activeListId)]);
          renderTabs(container);
          renderListContent(container);
          wireListContentEvents(container);
          // force: siehe openItemDetails - ein geänderter Zeitraum ist nach dem
          // Import nichts, was noch zu verwerfen wäre.
          closeModal({ force: true });
          const count = Number(data.data.transferred) || 0;
          window.yuvomi.showToast(t('meals.transferSuccess', { count }), 'success');
        } catch (err) {
          window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        }
      });
    },
  });
}

// --------------------------------------------------------
// API-Aktionen
// --------------------------------------------------------

async function loadLists() {
  try {
    const data   = await api.get('/shopping');
    state.lists  = data.data ?? [];
    state.listsError = null;
  } catch (err) {
    console.error('[Shopping] loadLists Fehler:', err);
    state.lists = [];
    // Fehler statt Toast: der Toast verging, während darunter „Keine Listen ·
    // [Neue Liste erstellen]" stehen blieb - bei 31 vorhandenen Artikeln
    // (Critique P0, 2026-07-30).
    state.listsError = err;
  }
}

async function loadCategories() {
  try {
    const data       = await api.get('/shopping/categories');
    state.categories = data.data ?? [];
  } catch {
    state.categories = [];
  }
}

async function loadItems(listId) {
  const data       = await api.get(`/shopping/${listId}/items`);
  state.items      = data.data ?? [];
  state.activeList = data.list ?? null;
  // Kategorien aus API-Antwort übernehmen wenn vorhanden (immer aktuell)
  if (data.categories?.length) state.categories = data.categories;
}

async function switchList(listId, container) {
  state.activeListId = listId;
  renderTabs(container);
  // Lade-Feedback beim Listenwechsel: dimmt den alten Inhalt (CSS), meldet
  // Screenreadern „busy" — bis renderListContent den neuen Inhalt setzt.
  container.querySelector('#list-content')?.setAttribute('aria-busy', 'true');
  try {
    await loadItems(listId);
    state.itemsError = null;
  } catch (err) {
    console.error('[Shopping] loadItems Fehler:', err);
    state.items = [];
    state.activeList = state.lists.find((l) => l.id === listId) ?? null;
    state.itemsError = err;
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
        window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
      }
    }
  });
}

function wireListContentEvents(container) {
  // Delegations-Wurzel ist der Modul-Root, nicht mehr #list-content: der Kopf
  // (#list-head) ist seit dem Umstieg auf .page-toolbar ein Geschwister von
  // #list-content, seine Aktionen (rename-list, import-meals,
  // manage-categories, delete-list) liegen also außerhalb. .shopping-page ist
  // der nächste gemeinsame Vorfahre und wird - genau wie #list-content vorher -
  // pro render() genau einmal erzeugt, womit die Einmal-Bindung unten weiter gilt.
  const root = container.querySelector('.shopping-page');
  if (!root) return;

  // Die Klick-Delegation nur EINMAL anhängen. renderListContent ersetzt lediglich
  // die Kinder (replaceChildren), nicht das Element selbst - würde der Listener
  // bei jedem switchList/rename erneut gebunden, feuerte ein Toggle-Klick
  // mehrfach und höbe sich auf (Issue #398).
  // Positionierung und Schließen des Kopf-Überlaufmenüs. Idempotent, hängt an
  // derselben stabilen Wurzel wie die Klick-Delegation.
  installPopoverMenus(root);

  if (root.dataset.eventsWired) {
    wireRenameKeydown(root);
    return;
  }
  root.dataset.eventsWired = 'true';

  root.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) {
      if (shouldIgnoreShoppingRowToggle(e.target)) return;
      const row = e.target.closest('.shopping-item');
      if (!row) return;
      const toggle = row.querySelector('[data-action="toggle-item"]');
      if (!toggle) return;
      await toggleShoppingItem(Number(row.dataset.itemId), Number(toggle.dataset.checked), container);
      return;
    }
    const action = target.dataset.action;

    // ---- Artikel abhaken ----
    if (action === 'toggle-item') {
      const id      = Number(target.dataset.id);
      const checked = Number(target.dataset.checked);
      await toggleShoppingItem(id, checked, container);
    }

    // ---- Artikel-Details (URL/Notiz) bearbeiten ----
    if (action === 'item-details') {
      openItemDetails(Number(target.dataset.id), container);
    }

    // ---- Artikel löschen (mit Undo, 5s Fenster) ----
    if (action === 'delete-item') {
      const id        = Number(target.dataset.id);
      const item      = state.items.find((i) => i.id === id);
      const snapshot  = item ? { ...item } : null;

      // Optimistisch entfernen
      state.items = state.items.filter((i) => i.id !== id);
      updateItemsList(container);
      updateListCounter(state.activeListId, -1, snapshot?.is_checked ? -1 : 0);
      renderTabs(container);

      scheduleUndoableDelete({
        message: t('shopping.itemDeletedToast', { name: snapshot?.name ?? '' }),
        commit: ({ keepalive }) => api.delete(`/shopping/items/${id}`, { keepalive }),
        restore: (err) => {
          if (snapshot) {
            state.items.push(snapshot);
            state.items.sort((a, b) => a.id - b.id);
            updateItemsList(container);
            updateListCounter(state.activeListId, 1, snapshot.is_checked ? 1 : 0);
            renderTabs(container);
          }
          if (err) window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        },
      });
    }

    // ---- Abgehakte löschen (mit Undo, 5s Fenster) ----
    if (action === 'clear-checked') {
      const checked = state.items.filter((i) => i.is_checked);
      const count   = checked.length;
      if (!count) return;

      const snapshot = checked.map((i) => ({ ...i }));

      // Optimistisch entfernen
      state.items = state.items.filter((i) => !i.is_checked);
      updateItemsList(container);
      updateListCounter(state.activeListId, -count, -count);
      renderTabs(container);

      scheduleUndoableDelete({
        message: t('shopping.itemsRemovedToast', { count }),
        commit: ({ keepalive }) => api.delete(`/shopping/${state.activeListId}/items/checked`, { keepalive }),
        restore: (err) => {
          snapshot.forEach((item) => state.items.push(item));
          state.items.sort((a, b) => a.id - b.id);
          updateItemsList(container);
          updateListCounter(state.activeListId, count, count);
          renderTabs(container);
          if (err) window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
        },
      });
    }

    // ---- Kategorien verwalten ----
    if (action === 'manage-categories') {
      openCategoryManager(container);
    }

    if (action === 'import-meals') {
      openMealPlanImport(container);
    }

    if (action === 'to-pantry') {
      await openPantryTransfer(container);
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
        window.yuvomi.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
      }
    }

    // ---- Liste löschen ----
    //
    // Der Sicherheitsgradient war invertiert (Critique 2026-07-30, P2): ein
    // einzelner Artikel hatte Undo und keine Rückfrage, die ganze Liste des
    // Haushalts hatte eine Rückfrage und kein Undo - und die Rückfrage nannte nicht
    // einmal, wie viel sie vernichtet („Liste \"Weekly Shop\" und alle Artikel
    // löschen?" - wie viele?).
    //
    // Jetzt BEIDES, und in dieser Reihenfolge: die Rückfrage nennt die Artikelzahl,
    // danach läuft der Commit über dieselbe 5s-Rücknahme wie jede andere Löschung im
    // Modul. Redundant ist das nicht - eine Rückfrage schützt vor dem Fehlgriff, ein
    // Undo vor dem falschen Entschluss, und hier hängen die Artikel eines ganzen
    // Haushalts dran.
    if (action === 'delete-list') {
      const deletedListId = state.activeListId;
      const snapshot = {
        list: state.activeList ? { ...state.activeList } : null,
        listEntry: state.lists.find((l) => l.id === deletedListId),
        items: state.items.map((i) => ({ ...i })),
        index: state.lists.findIndex((l) => l.id === deletedListId),
      };
      // Bei 0 Artikeln eine eigene Fassung: „und 0 Artikel löschen?" ist zwar
      // richtig, liest sich aber wie ein Fehler.
      const confirmed = await confirmModal(
        state.items.length
          ? t('shopping.deleteListConfirm', { name: state.activeList?.name ?? '', count: state.items.length })
          : t('shopping.deleteListConfirmEmpty', { name: state.activeList?.name ?? '' }),
        { danger: true, confirmLabel: t('common.delete'), detail: t('shopping.deleteListConfirmDetail') },
      );
      if (!confirmed) return;

      // Optimistisch aus der Leiste nehmen und auf die Nachbarliste wechseln.
      state.lists = state.lists.filter((l) => l.id !== deletedListId);
      state.activeListId = state.lists[0]?.id ?? null;
      if (state.activeListId) {
        await switchList(state.activeListId, container);
      } else {
        state.items = [];
        state.activeList = null;
        renderTabs(container);
        renderListContent(container);
        wireListContentEvents(container);
      }

      scheduleUndoableDelete({
        message: t('shopping.deletedListToast'),
        commit: ({ keepalive }) => api.delete(`/shopping/${deletedListId}`, { keepalive }),
        restore: async (err) => {
          // Der Server hat nichts gelöscht (der Commit war aufgeschoben) - die Liste
          // muss also nur zurück in den State und an ihren alten Platz in der Leiste.
          if (snapshot.listEntry) {
            state.lists.splice(Math.max(0, snapshot.index), 0, snapshot.listEntry);
          }
          state.activeListId = deletedListId;
          state.activeList = snapshot.list;
          state.items = snapshot.items;
          renderTabs(container);
          renderListContent(container);
          wireListContentEvents(container);
          if (err) window.yuvomi.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
        },
      });
    }
  });

  wireRenameKeydown(root);
}

/**
 * Verdrahtet „Rename per Enter" auf dem Listen-Titel. Das Element wird bei jedem
 * renderListContent neu erzeugt, daher muss diese Bindung pro Render erfolgen —
 * im Gegensatz zur delegierten Klick-Bindung an der stabilen Wurzel (Issue #398).
 */
function wireRenameKeydown(root) {
  root.querySelector('[data-action="rename-list"]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.currentTarget.click();
  });
}

// --------------------------------------------------------
// Kategorie-Verwaltung (kanonischer Ort, früher in Settings)
// --------------------------------------------------------

/**
 * Öffnet den Kategorie-Manager in einem Modal. Reagiert auf
 * `category-manager-changed`, um den lokalen State und die aktive Liste
 * zu aktualisieren. Schließen navigiert zurück nach /shopping (Query entfernen).
 * @param {Element} container Seiten-Container
 * @param {object}  [opts]
 * @param {boolean} [opts.fromDeepLink] true, wenn via ?manage=categories geöffnet
 */
async function openCategoryManager(container, { fromDeepLink = false } = {}) {
  const { openModal } = await import('/components/modal.js');

  let changed = false;
  // Die geteilte Komponente (Audit F-15) dispatcht ohne Detail — der lokale
  // State wird nach jeder Mutation frisch vom Server geladen.
  const onCategoriesChanged = async () => {
    changed = true;
    await loadCategories();
  };

  let manager = null;
  openModal({
    title: t('shopping.manageCategories'),
    content: '<yuvomi-category-manager></yuvomi-category-manager>',
    onSave: (panel) => {
      manager = panel.querySelector('yuvomi-category-manager');
      if (!manager) return;
      manager.addEventListener('category-manager-changed', onCategoriesChanged);
      manager.configure({
        basePath: '/shopping/categories',
        labelResolver: (item) => categoryLabel(item.name),
        titleKey: 'shopping.manageCategories',
        hintKey: 'settings.shoppingCategoriesHint',
        // Anders als Budget/Tasks/Kontakte loescht der Einkauf auch belegte
        // Kategorien und schiebt die Artikel auf die naechste Kategorie.
        deleteDetailKey: 'shopping.categoryDeleteConfirmDetail',
      });
    },
    onClose: () => {
      // Listener-Cleanup, damit beim Modal-Reuse kein Leak entsteht.
      manager?.removeEventListener('category-manager-changed', onCategoriesChanged);
      manager = null;
      // Bei Mutationen die sichtbare Liste neu aufbauen (Gruppierung/Quick-Add-Select).
      if (changed && state.activeList) {
        renderListContent(container);
        wireListContentEvents(container);
      }
      // Deep-Link-Query entfernen, wenn der Manager über die URL geöffnet wurde.
      if (fromDeepLink && new URLSearchParams(window.location.search).has('manage')) {
        window.yuvomi?.navigate?.('/shopping');
      }
    },
  });
}

// --------------------------------------------------------
// Haupt-Render
// --------------------------------------------------------

export async function render(container, { user }) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
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
  `);
  state.itemsError = null;
  try {
    // loadCategories() und loadLists() fangen selbst; der äußere catch ist das
    // Netz für alles Unerwartete und bildet es auf denselben Fehlerzustand ab,
    // statt die Ausnahme in den globalen Fehlerbildschirm laufen zu lassen.
    await Promise.all([loadCategories(), loadLists()]);
    if (!state.listsError && state.lists.length) {
      const listParam = parseInt(new URLSearchParams(window.location.search).get('list'), 10) || null;
      const target = listParam && state.lists.find((l) => l.id === listParam);
      state.activeListId = target ? target.id : state.lists[0].id;
      try {
        await loadItems(state.activeListId);
      } catch (err) {
        console.error('[Shopping] loadItems Fehler:', err);
        state.items = [];
        state.activeList = state.lists.find((l) => l.id === state.activeListId) ?? null;
        state.itemsError = err;
      }
    }
  } catch (err) {
    console.error('[Shopping] Ladefehler:', err);
    state.listsError = err;
  }

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="shopping-page">
      <h1 class="sr-only">${t('nav.shopping')}</h1>
      <div class="list-tabs-bar" id="list-tabs-bar"></div>
      <!-- Kanonischer Kopf als DIREKTES Kind des Modul-Roots. Er lag früher in
           #list-content, das selbst --page-inline-pad trägt: als .page-toolbar
           hätte er dessen Padding ein zweites Mal addiert - genau die
           „genau einmal pro Ahnenkette"-Bedingung aus tokens.css, an der auch
           der 16px-Versatz im Budget-Modul hing. Draußen fluchtet er mit der
           Listen-Chip-Leiste darüber und trägt sein Chrome full-bleed. -->
      <!-- --narrow: der Kopf endet beim Lesemaß des Körpers (.kitchen-list),
           nicht an der Content-Spalte. Siehe layout.css. -->
      <div class="page-toolbar page-toolbar--in-group page-toolbar--narrow" id="list-head" hidden></div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden"></div>
      <button class="page-fab" id="fab-new-item" aria-label="${t('shopping.addItemLabel')}">
        <i data-lucide="plus" class="icon-xl" aria-hidden="true"></i>
      </button>
    </div>
  `);

  renderKitchenTabsBar(container, '/shopping');
  renderTabs(container);
  wireTabBar(container);
  renderListContent(container);
  wireListContentEvents(container);

  findPageFab('fab-new-item')?.addEventListener('click', (e) => {
    const input = container.querySelector('#item-name-input');
    if (!input) {
      // Keine Liste aktiv → neue Liste erstellen
      container.querySelector('[data-action="new-list"]')?.click();
      return;
    }

    // Auf Touch ist das Quick-Add eingeklappt: der FAB schaltet es um, statt nur
    // ein sichtbares Feld zu fokussieren (siehe syncQuickAddDisclosure).
    if (e.currentTarget.getAttribute('aria-expanded') === 'true') {
      syncQuickAddDisclosure(container, false);
      return;
    }
    syncQuickAddDisclosure(container, true);

    // FAB = Erstell-Flow (wie Meals/Recipes): die Quick-Add-Fläche sichtbar
    // aktivieren — Scroll + Fokus + kurzer Puls als „hier entsteht das Neue".
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
    input.classList.add('quick-add__input--flash');
    input.addEventListener('animationend', () => input.classList.remove('quick-add__input--flash'), { once: true });
  });

  // Deep-Link: ?highlight=<id> scrollt zum Artikel
  const highlightId = parseInt(new URLSearchParams(window.location.search).get('highlight'), 10) || null;
  if (highlightId) {
    const el = container.querySelector(`[data-action="toggle-item"][data-id="${highlightId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Deep-Link: ?manage=categories öffnet den Kategorie-Manager sofort.
  if (new URLSearchParams(window.location.search).get('manage') === 'categories') {
    openCategoryManager(container, { fromDeepLink: true });
  }
}

export const __test = { shouldIgnoreShoppingRowToggle };
