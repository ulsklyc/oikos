import { mealie } from '/api.js';
import { formatDate, formatTime, t } from '/i18n.js';
import { closeModal, confirmModal, openModal } from '/components/modal.js';
import {
  createInlineError,
  createRetryState,
  createStatusSummary,
  toggleRowHtml,
} from '/settings/components.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

function showToast(message, tone = 'default') {
  window.yuvomi?.showToast(message, tone);
}

function formatSyncTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${formatDate(date)} ${formatTime(date)}`.trim();
}

function lastSyncDetail(value) {
  const formatted = formatSyncTime(value);
  return formatted ? t('settings.lastSyncValue', { value: formatted }) : t('settings.neverSynced');
}

export async function persistMealTypeSelection(
  inputs,
  checkedMealTypes,
  persistedMealTypes,
  save,
) {
  inputs.forEach((input) => {
    input.disabled = true;
  });

  try {
    await save();
  } catch (error) {
    inputs.forEach((input) => {
      input.checked = persistedMealTypes.includes(input.value);
    });
    throw error;
  } finally {
    inputs.forEach((input) => {
      input.disabled = false;
    });
  }

  return checkedMealTypes;
}

function renderPage(container, preferences) {
  const visibleMealTypes = Array.isArray(preferences.visible_meal_types)
    ? preferences.visible_meal_types
    : MEAL_TYPES;

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.sectionMeals')}</h2>
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.mealTypesLabel')}</h3>
        <p class="form-hint">${t('settings.mealTypesHint')}</p>
        <div class="meal-type-toggles" id="meal-type-toggles">
          ${MEAL_TYPES.map((mealType) => toggleRowHtml({
            label: t(`meals.type${mealType[0].toUpperCase()}${mealType.slice(1)}`),
            checked: visibleMealTypes.includes(mealType),
            attrs: { value: mealType },
          })).join('')}
        </div>
        <p class="form-hint">${t('settings.kitchenExternalHint')}</p>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-section__title">${t('settings.mealieTitle')}</h2>
      <div class="settings-card">
        <p class="settings-card-description">${t('settings.mealieDescription')}</p>
        <div id="mealie-accounts" class="settings-sync-accounts"></div>
        <div class="settings-form-actions">
          <button type="button" class="btn btn--primary" id="mealie-add-account-btn">
            ${t('settings.mealieAddAccount')}
          </button>
        </div>
      </div>
    </section>
  `);
}

function renderMealieAccount(container, account, refresh) {
  const card = document.createElement('article');
  card.className = 'caldav-account-item';

  const details = [lastSyncDetail(account.lastSync), account.baseUrl];
  if (account.lastError) details.push(t('settings.mealieLastError', { message: account.lastError }));

  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'btn btn--secondary btn--sm';
  syncBtn.textContent = t('settings.syncNow');
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    try {
      // syncAccount() wirft nie bei einem fehlgeschlagenen Mealie-Abruf (Netzwerk/
      // Auth) - der Fehler steckt dann in result.data.failed/error, HTTP bleibt 200.
      // Nur ein echter Request-Fehler (Server down, 500) landet im catch.
      const res = await mealie.syncAccount(account.id);
      if (res.data?.failed) {
        showToast(res.data.error || t('settings.mealieSyncFailed'), 'danger');
      } else {
        showToast(t('settings.mealieSyncSuccess'), 'success');
      }
      await refresh();
    } catch (err) {
      showToast(err.message || t('settings.mealieSyncFailed'), 'danger');
      syncBtn.disabled = false;
    }
  });

  card.appendChild(createStatusSummary({
    title: account.name,
    status: account.lastError
      ? t('settings.notConnected')
      : (account.lastSync ? t('settings.connected') : t('settings.notConnected')),
    details,
    action: syncBtn,
    tone: account.lastError ? 'danger' : (account.lastSync ? 'success' : 'neutral'),
  }));

  const actions = document.createElement('div');
  actions.className = 'caldav-account-actions';

  const editLinkBtn = document.createElement('button');
  editLinkBtn.type = 'button';
  editLinkBtn.className = 'btn btn--ghost btn--sm';
  editLinkBtn.textContent = t('settings.mealieEditLink');
  editLinkBtn.addEventListener('click', () => openMealieLinkModal(account, refresh));
  actions.appendChild(editLinkBtn);

  const enableBtn = document.createElement('button');
  enableBtn.type = 'button';
  enableBtn.className = 'btn btn--ghost btn--sm';
  enableBtn.textContent = account.enabled ? t('settings.mealieDisable') : t('settings.mealieEnable');
  enableBtn.addEventListener('click', async () => {
    enableBtn.disabled = true;
    try {
      await mealie.updateAccount(account.id, { enabled: !account.enabled });
      await refresh();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
      enableBtn.disabled = false;
    }
  });
  actions.appendChild(enableBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn--danger-outline btn--sm';
  deleteBtn.textContent = t('common.delete');
  deleteBtn.addEventListener('click', async () => {
    // Löschen des Accounts löscht per FK-Kaskade auch alle von ihm gespiegelten
    // Rezepte (server/db.js Migration v111) - der Hinweis nennt das explizit,
    // sonst verschwinden Rezepte scheinbar grundlos aus dem Essensplan.
    const confirmed = await confirmModal(
      t('settings.disconnectAccountConfirmTitle', { name: account.name }),
      {
        detail: t('settings.mealieDeleteAccountConfirm', { count: account.recipeCount ?? 0 }),
        confirmLabel: t('common.delete'),
        danger: true,
      },
    );
    if (!confirmed) return;
    try {
      await mealie.deleteAccount(account.id);
      showToast(t('settings.mealieAccountDeleted'), 'success');
      await refresh();
    } catch (err) {
      showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  });
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  container.appendChild(card);
}

function openMealieLinkModal(account, refresh) {
  openModal({
    title: t('settings.mealieEditLink'),
    size: 'sm',
    content: `
      <form id="mealie-link-form" novalidate autocomplete="off">
        <p class="form-hint">${t('settings.mealieExternalUrlHint')}</p>
        <div class="form-group">
          <label class="form-label" for="mealie-link-external-url">${t('settings.mealieExternalUrlLabel')}</label>
          <input class="form-input" type="url" id="mealie-link-external-url" placeholder="https://cook.example.com" value="${account.externalUrl ? String(account.externalUrl).replace(/"/g, '&quot;') : ''}" />
        </div>
        <div id="mealie-link-error" class="form-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" id="mealie-link-cancel">${t('common.cancel')}</button>
          <button type="submit" class="btn btn--primary">${t('common.save')}</button>
        </div>
      </form>
    `,
    onSave: (panel) => {
      const form = panel.querySelector('#mealie-link-form');
      const errorEl = panel.querySelector('#mealie-link-error');
      panel.querySelector('#mealie-link-cancel')?.addEventListener('click', () => closeModal({ force: true }));

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const external_url = panel.querySelector('#mealie-link-external-url').value.trim();
        try {
          await mealie.updateAccount(account.id, { external_url });
          closeModal({ force: true });
          showToast(t('settings.mealieAccountUpdated'), 'success');
          await refresh();
        } catch (err) {
          errorEl.textContent = err.message || t('common.errorGeneric');
          errorEl.hidden = false;
        }
      });
    },
  });
}

async function loadMealieAccounts(container) {
  const listEl = container.querySelector('#mealie-accounts');
  if (!listEl) return;
  listEl.replaceChildren();

  const reload = () => loadMealieAccounts(container);

  let accounts;
  try {
    // getStatus() statt listAccounts(): liefert dieselben Felder bereits im
    // camelCase-Format, das renderMealieAccount() erwartet, plus recipeCount -
    // listAccounts() (GET /accounts) gibt dagegen die rohen snake_case-DB-Spalten
    // zurück (base_url/last_sync/last_error) und kennt recipeCount gar nicht.
    const res = await mealie.getStatus();
    accounts = res.data || [];
  } catch (err) {
    listEl.appendChild(createRetryState({
      message: err.message || t('common.errorGeneric'),
      onRetry: reload,
    }));
    return;
  }

  if (accounts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'form-hint';
    empty.textContent = t('settings.mealieEmptyState');
    listEl.appendChild(empty);
    return;
  }

  for (const account of accounts) renderMealieAccount(listEl, account, reload);
}

function bindMealieAddButton(container) {
  const addBtn = container.querySelector('#mealie-add-account-btn');
  if (!addBtn) return;
  addBtn.addEventListener('click', () => {
    openModal({
      title: t('settings.mealieAddAccount'),
      size: 'sm',
      content: `
        <form id="mealie-add-form" novalidate autocomplete="off">
          <div class="form-group">
            <label class="form-label" for="mealie-name">${t('settings.mealieNameLabel')}<span class="required-marker" aria-hidden="true"> *</span></label>
            <input class="form-input" type="text" id="mealie-name" required maxlength="100" />
          </div>
          <div class="form-group">
            <label class="form-label" for="mealie-url">${t('settings.mealieUrlLabel')}<span class="required-marker" aria-hidden="true"> *</span></label>
            <input class="form-input" type="url" id="mealie-url" required placeholder="https://mealie.example.com" />
            <small class="form-hint">${t('settings.mealieUrlHint')}</small>
          </div>
          <div class="form-group">
            <label class="form-label" for="mealie-external-url">${t('settings.mealieExternalUrlLabel')}</label>
            <input class="form-input" type="url" id="mealie-external-url" placeholder="https://cook.example.com" />
            <small class="form-hint">${t('settings.mealieExternalUrlHint')}</small>
          </div>
          <div class="form-group">
            <label class="form-label" for="mealie-token">${t('settings.mealieTokenLabel')}<span class="required-marker" aria-hidden="true"> *</span></label>
            <input class="form-input" type="password" id="mealie-token" required autocomplete="off" />
            <small class="form-hint">${t('settings.mealieTokenHint')}</small>
          </div>
          <div id="mealie-add-error" class="form-error" role="alert" hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" id="mealie-add-cancel">${t('common.cancel')}</button>
            <button type="submit" class="btn btn--primary">${t('common.save')}</button>
          </div>
        </form>
      `,
      onSave: (panel) => {
        const form = panel.querySelector('#mealie-add-form');
        const errorEl = panel.querySelector('#mealie-add-error');
        panel.querySelector('#mealie-add-cancel')?.addEventListener('click', () => closeModal({ force: true }));

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEl.hidden = true;

          const name = panel.querySelector('#mealie-name').value.trim();
          const base_url = panel.querySelector('#mealie-url').value.trim();
          const external_url = panel.querySelector('#mealie-external-url').value.trim();
          const api_token = panel.querySelector('#mealie-token').value;

          if (!name || !base_url || !api_token) {
            errorEl.textContent = t('common.requiredFields');
            errorEl.hidden = false;
            return;
          }

          try {
            await mealie.createAccount({ name, base_url, external_url, api_token });
            closeModal({ force: true });
            showToast(t('settings.mealieAccountAdded'), 'success');
            await loadMealieAccounts(container);
          } catch (err) {
            errorEl.textContent = err.message || t('common.errorGeneric');
            errorEl.hidden = false;
          }
        });
      },
    });
  });
}

function bindEvents(container) {
  const mealToggles = container.querySelector('#meal-type-toggles');
  const inputs = [...(mealToggles?.querySelectorAll('input') ?? [])];
  let persistedMealTypes = inputs
    .filter((input) => input.checked)
    .map((input) => input.value);

  mealToggles?.addEventListener('change', async () => {
    if (inputs.some((input) => input.disabled)) return;

    const checkedMealTypes = inputs
      .filter((input) => input.checked)
      .map((checkbox) => checkbox.value);

    if (checkedMealTypes.length === 0) {
      inputs.forEach((input) => {
        input.checked = persistedMealTypes.includes(input.value);
      });
      window.yuvomi?.showToast(t('settings.mealTypesMinOne'), 'danger');
      return;
    }

    try {
      persistedMealTypes = await persistMealTypeSelection(
        inputs,
        checkedMealTypes,
        persistedMealTypes,
        () => savePreferences({ visible_meal_types: checkedMealTypes }),
      );
      window.yuvomi?.showToast(t('settings.mealTypesSaved'), 'success');
    } catch (error) {
      window.yuvomi?.showToast(error.message || t('common.errorGeneric'), 'danger');
    }
  });
}

export async function render(container, { user }) {
  void user;
  const preferences = await getPreferences();
  renderPage(container, preferences);
  bindEvents(container);
  bindMealieAddButton(container);
  await loadMealieAccounts(container);
}
