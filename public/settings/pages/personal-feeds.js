/**
 * Modul: Feed-Abos (persoenlich)
 * Zweck: Die schreibgeschuetzten ICS-Feeds, mit denen eine Person
 *        Yuvomi-Daten in ihrem eigenen Kalenderprogramm abonniert - der
 *        Haushaltskalender, die Inventar-Fristen und der eigene Schichtplan.
 *
 * Warum ein eigenes Blatt und warum unter `personal`: alle Tokens haengen an
 * der eigenen users-Zeile (calendar_feed_token, Migration 61;
 * inventory_deadlines_feed_token, Migration 144; schedule_feed_token,
 * Migration 177), und alle Routen tragen serverseitig bewusst keinen
 * Admin-Check. Der Kalender-Feed lag trotzdem auf `sync-calendar`, das
 * adminOnly ist - in einem Haushalt mit fuenf Mitgliedern konnte also genau
 * eine Person ihr eigenes Abo einrichten oder zurueckziehen.
 * Was in den Feed HINEIN kommt (CalDAV-Konten, ICS-Abos, Kalenderimport),
 * bleibt eine Haushaltsfrage und damit auf dem gegateten Blatt; was aus ihm
 * HERAUS geht, ist persoenlich. Vierter Fall desselben Musters, siehe die
 * Kommentare an `personal-calendar`, `personal-tasks` und `modules-navigation`
 * in ../registry.js.
 */

import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { confirmModal } from '/components/modal.js';
import { createInlineError, toggleRowHtml } from '/settings/components.js';

function showToast(message, tone = 'default') {
  window.yuvomi?.showToast(message, tone);
}

function renderPage(container) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.feedExportTitle')}</h2>
      <div class="settings-card">
        <p class="settings-card-description">${t('settings.feedExportDescription')}</p>
        <div id="feed-export-body"></div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.inventoryFeedTitle')}</h2>
      <div class="settings-card">
        <p class="settings-card-description">${t('settings.inventoryFeedDescription')}</p>
        <div id="inventory-feed-body"></div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.scheduleFeedTitle')}</h2>
      <div class="settings-card">
        <p class="settings-card-description">${t('settings.scheduleFeedDescription')}</p>
        <div id="schedule-feed-body"></div>
      </div>
    </section>
  `);
}

// --------------------------------------------------------------------------
// Read-only ICS export feed
// --------------------------------------------------------------------------

function renderFeedExportInactive(body) {
  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <p class="settings-card-description">${t('settings.feedExportInactive')}</p>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--primary" id="feed-activate">${t('settings.feedExportActivate')}</button>
    </div>
  `);
}

function renderFeedExportActive(body, data) {
  const webcal = data.url.replace(/^https?:\/\//i, 'webcal://');
  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <div class="form-group">
      <label class="form-label" for="feed-url">${t('settings.feedExportUrlLabel')}</label>
      <input id="feed-url" class="form-input" type="text" readonly value="${esc(data.url)}">
      <p class="form-hint">${t('settings.feedExportHint')}</p>
    </div>
    <div class="form-group">
      ${toggleRowHtml({
        label: t('settings.feedExportShowAssignees'),
        checked: !!data.showAssignees,
        attrs: { id: 'feed-show-assignees', 'aria-describedby': 'feed-show-assignees-hint' },
      })}
      <p class="form-hint" id="feed-show-assignees-hint">${t('settings.feedExportShowAssigneesHint')}</p>
    </div>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--secondary" id="feed-copy">${t('settings.feedExportCopy')}</button>
      <a class="btn btn--secondary" href="${esc(webcal)}">${t('settings.feedExportSubscribe')}</a>
      <button type="button" class="btn btn--secondary" id="feed-regen">${t('settings.feedExportRegenerate')}</button>
      <button type="button" class="btn btn--danger-outline" id="feed-disable">${t('settings.feedExportDisable')}</button>
    </div>
  `);
}

async function loadFeedExport(container) {
  const body = container.querySelector('#feed-export-body');
  if (!body) return;

  const reload = () => loadFeedExport(container);

  let res;
  try {
    res = await api.get('/calendar/feed');
  } catch (err) {
    body.replaceChildren();
    body.appendChild(createInlineError(err.message || t('common.errorGeneric')));
    return;
  }

  const data = res?.data;
  if (!data) {
    renderFeedExportInactive(body);
    body.querySelector('#feed-activate')?.addEventListener('click', async () => {
      try {
        await api.post('/calendar/feed/regenerate');
        showToast(t('settings.feedExportTitle'), 'success');
        await reload();
      } catch (err) {
        showToast(err.message || t('common.errorGeneric'), 'danger');
      }
    });
    return;
  }

  renderFeedExportActive(body, data);

  body.querySelector('#feed-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard?.writeText(data.url);
      showToast(t('settings.feedExportCopied'), 'success');
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  body.querySelector('#feed-regen')?.addEventListener('click', async () => {
    if (!await confirmModal(t('settings.feedExportRegenerateConfirm'),
      { danger: true, detail: t('settings.feedExportRegenerateConfirmDetail') })) return;
    try {
      await api.post('/calendar/feed/regenerate');
      await reload();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  body.querySelector('#feed-disable')?.addEventListener('click', async () => {
    if (!await confirmModal(t('settings.feedExportDisableConfirm'),
      { danger: true, detail: t('settings.feedExportDisableConfirmDetail') })) return;
    try {
      await api.delete('/calendar/feed');
      await reload();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  body.querySelector('#feed-show-assignees')?.addEventListener('change', async (e) => {
    const input = e.currentTarget;
    const next = input.checked;
    input.disabled = true;
    try {
      await api.put('/calendar/feed', { showAssignees: next });
      showToast(t('settings.feedExportSaved'), 'success');
    } catch (err) {
      input.checked = !next; // Fehlschlag → visuellen Zustand zurücksetzen
      showToast(err.message || t('common.errorGeneric'), 'danger');
    } finally {
      input.disabled = false;
    }
  });
}

// --------------------------------------------------------------------------
// Read-only ICS export feed - inventory warranty deadlines
// --------------------------------------------------------------------------

function renderInventoryFeedInactive(body) {
  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <p class="settings-card-description">${t('settings.inventoryFeedInactive')}</p>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--primary" id="inventory-feed-activate">${t('settings.inventoryFeedActivate')}</button>
    </div>
  `);
}

function renderInventoryFeedActive(body, data) {
  const webcal = data.url.replace(/^https?:\/\//i, 'webcal://');
  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <div class="form-group">
      <label class="form-label" for="inventory-feed-url">${t('settings.inventoryFeedUrlLabel')}</label>
      <input id="inventory-feed-url" class="form-input" type="text" readonly value="${esc(data.url)}">
      <p class="form-hint">${t('settings.inventoryFeedHint')}</p>
    </div>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--secondary" id="inventory-feed-copy">${t('settings.inventoryFeedCopy')}</button>
      <a class="btn btn--secondary" href="${esc(webcal)}">${t('settings.inventoryFeedSubscribe')}</a>
      <button type="button" class="btn btn--secondary" id="inventory-feed-regen">${t('settings.inventoryFeedRegenerate')}</button>
      <button type="button" class="btn btn--danger-outline" id="inventory-feed-disable">${t('settings.inventoryFeedDisable')}</button>
    </div>
  `);
}

async function loadInventoryFeed(container) {
  const body = container.querySelector('#inventory-feed-body');
  if (!body) return;

  const reload = () => loadInventoryFeed(container);

  let res;
  try {
    res = await api.get('/inventory/deadlines-feed');
  } catch (err) {
    body.replaceChildren();
    body.appendChild(createInlineError(err.message || t('common.errorGeneric')));
    return;
  }

  const data = res?.data;
  if (!data) {
    renderInventoryFeedInactive(body);
    body.querySelector('#inventory-feed-activate')?.addEventListener('click', async () => {
      try {
        await api.post('/inventory/deadlines-feed/regenerate');
        showToast(t('settings.inventoryFeedTitle'), 'success');
        await reload();
      } catch (err) {
        showToast(err.message || t('common.errorGeneric'), 'danger');
      }
    });
    return;
  }

  renderInventoryFeedActive(body, data);

  body.querySelector('#inventory-feed-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard?.writeText(data.url);
      showToast(t('settings.inventoryFeedCopied'), 'success');
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  body.querySelector('#inventory-feed-regen')?.addEventListener('click', async () => {
    if (!await confirmModal(t('settings.inventoryFeedRegenerateConfirm'),
      { danger: true, detail: t('settings.inventoryFeedRegenerateConfirmDetail') })) return;
    try {
      await api.post('/inventory/deadlines-feed/regenerate');
      await reload();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  body.querySelector('#inventory-feed-disable')?.addEventListener('click', async () => {
    if (!await confirmModal(t('settings.inventoryFeedDisableConfirm'),
      { danger: true, detail: t('settings.inventoryFeedDisableConfirmDetail') })) return;
    try {
      await api.delete('/inventory/deadlines-feed');
      await reload();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
}

// --------------------------------------------------------------------------
// Read-only ICS export feed - own schedule
// --------------------------------------------------------------------------

function renderScheduleFeedInactive(body) {
  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <p class="settings-card-description">${t('settings.scheduleFeedInactive')}</p>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--primary" id="schedule-feed-activate">${t('settings.scheduleFeedActivate')}</button>
    </div>
  `);
}

function renderScheduleFeedActive(body, data) {
  const webcal = data.url.replace(/^https?:\/\//i, 'webcal://');
  body.replaceChildren();
  body.insertAdjacentHTML('beforeend', `
    <div class="form-group">
      <label class="form-label" for="schedule-feed-url">${t('settings.scheduleFeedUrlLabel')}</label>
      <input id="schedule-feed-url" class="form-input" type="text" readonly value="${esc(data.url)}">
      <p class="form-hint">${t('settings.scheduleFeedHint')}</p>
    </div>
    <div class="settings-form-actions">
      <button type="button" class="btn btn--secondary" id="schedule-feed-copy">${t('settings.scheduleFeedCopy')}</button>
      <a class="btn btn--secondary" href="${esc(webcal)}">${t('settings.scheduleFeedSubscribe')}</a>
      <button type="button" class="btn btn--secondary" id="schedule-feed-regen">${t('settings.scheduleFeedRegenerate')}</button>
      <button type="button" class="btn btn--danger-outline" id="schedule-feed-disable">${t('settings.scheduleFeedDisable')}</button>
    </div>
  `);
}

async function loadScheduleFeed(container) {
  const body = container.querySelector('#schedule-feed-body');
  if (!body) return;

  const reload = () => loadScheduleFeed(container);

  let res;
  try {
    res = await api.get('/schedule/feed');
  } catch (err) {
    body.replaceChildren();
    body.appendChild(createInlineError(err.message || t('common.errorGeneric')));
    return;
  }

  const data = res?.data;
  if (!data) {
    renderScheduleFeedInactive(body);
    body.querySelector('#schedule-feed-activate')?.addEventListener('click', async () => {
      try {
        await api.post('/schedule/feed/regenerate');
        showToast(t('settings.scheduleFeedTitle'), 'success');
        await reload();
      } catch (err) {
        showToast(err.message || t('common.errorGeneric'), 'danger');
      }
    });
    return;
  }

  renderScheduleFeedActive(body, data);

  body.querySelector('#schedule-feed-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard?.writeText(data.url);
      showToast(t('settings.scheduleFeedCopied'), 'success');
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  body.querySelector('#schedule-feed-regen')?.addEventListener('click', async () => {
    if (!await confirmModal(t('settings.scheduleFeedRegenerateConfirm'),
      { danger: true, detail: t('settings.scheduleFeedRegenerateConfirmDetail') })) return;
    try {
      await api.post('/schedule/feed/regenerate');
      await reload();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  body.querySelector('#schedule-feed-disable')?.addEventListener('click', async () => {
    if (!await confirmModal(t('settings.scheduleFeedDisableConfirm'),
      { danger: true, detail: t('settings.scheduleFeedDisableConfirmDetail') })) return;
    try {
      await api.delete('/schedule/feed');
      await reload();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

export async function render(container) {
  renderPage(container);
  await loadFeedExport(container);
  await loadInventoryFeed(container);
  await loadScheduleFeed(container);
  window.lucide?.createIcons({ el: container });
}
