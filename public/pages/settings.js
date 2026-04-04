/**
 * Modul: Einstellungen (Settings)
 * Zweck: Benutzerkonto, Passwort, Kalender-Sync, Familienmitglieder
 * Abhängigkeiten: /api.js
 */

import { api, auth } from '/api.js';
import { t, formatDate, formatTime } from '/i18n.js';
import { esc } from '/utils/html.js';
import '/components/oikos-locale-picker.js';

/**
 * @param {HTMLElement} container
 * @param {{ user: object }} context
 */
export async function render(container, { user }) {
  // URL-Parameter auswerten (z.B. nach OAuth-Callback)
  const params   = new URLSearchParams(location.search);
  const syncOk   = params.get('sync_ok');
  const syncErr  = params.get('sync_error');

  // State für Familienmitglieder + Sync-Status
  let users        = [];
  let googleStatus = { configured: false, connected: false, lastSync: null };
  let appleStatus  = { configured: false, lastSync: null };
  let prefs        = { visible_meal_types: ['breakfast', 'lunch', 'dinner', 'snack'] };

  try {
    const [usersRes, gStatus, aStatus, prefsRes] = await Promise.allSettled([
      user.role === 'admin' ? auth.getUsers() : Promise.resolve({ data: [] }),
      api.get('/calendar/google/status'),
      api.get('/calendar/apple/status'),
      api.get('/preferences'),
    ]);
    if (usersRes.status === 'fulfilled')  users        = usersRes.value.data  ?? [];
    if (gStatus.status  === 'fulfilled')  googleStatus = gStatus.value;
    if (aStatus.status  === 'fulfilled')  appleStatus  = aStatus.value;
    if (prefsRes.status === 'fulfilled')  prefs        = prefsRes.value.data  ?? prefs;
  } catch (_) { /* non-critical */ }

  const googleStatusText = googleStatus.connected
    ? (googleStatus.lastSync ? t('settings.connectedLastSync', { date: formatDateTime(googleStatus.lastSync) }) : t('settings.connected'))
    : googleStatus.configured ? t('settings.notConnected') : t('settings.notConfigured');

  const appleStatusText = appleStatus.connected
    ? (appleStatus.lastSync ? t('settings.connectedLastSync', { date: formatDateTime(appleStatus.lastSync) }) : t('settings.connected'))
    : appleStatus.configured
      ? (appleStatus.lastSync ? t('settings.configuredLastSync', { date: formatDateTime(appleStatus.lastSync) }) : t('settings.configured'))
      : t('settings.notConnected');

  container.innerHTML = `
    <div class="page settings-page">
      <div class="page__header">
        <h1 class="page__title">${t('settings.title')}</h1>
      </div>

      ${syncOk  ? `<div class="settings-banner settings-banner--success">${syncOk === 'google' ? t('settings.syncSuccessGoogle') : t('settings.syncSuccessApple')}</div>` : ''}
      ${syncErr ? `<div class="settings-banner settings-banner--error">${syncErr === 'google' ? t('settings.syncErrorGoogle') : t('settings.syncErrorApple')}</div>` : ''}

      <!-- Design -->
      <section class="settings-section">
        <h2 class="settings-section__title">${t('settings.sectionDesign')}</h2>
        <div class="settings-card">
          <h3 class="settings-card__title">${t('settings.cardAppearance')}</h3>
          <div class="theme-toggle" id="theme-toggle">
            <button class="theme-toggle__btn ${currentTheme() === 'system' ? 'theme-toggle__btn--active' : ''}" data-theme-value="system" aria-label="${t('settings.themeSysLabel')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              ${t('settings.themeSystem')}
            </button>
            <button class="theme-toggle__btn ${currentTheme() === 'light' ? 'theme-toggle__btn--active' : ''}" data-theme-value="light" aria-label="${t('settings.themeLightLabel')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ${t('settings.themeLight')}
            </button>
            <button class="theme-toggle__btn ${currentTheme() === 'dark' ? 'theme-toggle__btn--active' : ''}" data-theme-value="dark" aria-label="${t('settings.themeDarkLabel')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              ${t('settings.themeDark')}
            </button>
          </div>
        </div>
      </section>

      <!-- Sprache -->
      <section class="settings-section">
        <h2 class="settings-section__title">${t('settings.languageTitle')}</h2>
        <div class="settings-card">
          <oikos-locale-picker></oikos-locale-picker>
        </div>
      </section>

      <!-- Essensplan -->
      <section class="settings-section">
        <h2 class="settings-section__title">${t('settings.sectionMeals')}</h2>
        <div class="settings-card">
          <h3 class="settings-card__title">${t('settings.mealTypesLabel')}</h3>
          <p class="form-hint" style="margin-bottom:var(--space-3)">${t('settings.mealTypesHint')}</p>
          <div class="meal-type-toggles" id="meal-type-toggles">
            <label class="toggle-row">
              <input type="checkbox" value="breakfast" checked>
              <span>${t('meals.typeBreakfast')}</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" value="lunch" checked>
              <span>${t('meals.typeLunch')}</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" value="dinner" checked>
              <span>${t('meals.typeDinner')}</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" value="snack" checked>
              <span>${t('meals.typeSnack')}</span>
            </label>
          </div>
        </div>
      </section>

      <!-- Mein Konto -->
      <section class="settings-section">
        <h2 class="settings-section__title">${t('settings.sectionAccount')}</h2>

        <div class="settings-card">
          <div class="settings-user-info">
            <div class="settings-avatar" style="background:${esc(user?.avatar_color) || '#007AFF'}">
              ${esc(initials(user?.display_name))}
            </div>
            <div>
              <div class="settings-user-info__name">${esc(user?.display_name)}</div>
              <div class="settings-user-info__username">@${esc(user?.username)}</div>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <h3 class="settings-card__title">${t('settings.changePassword')}</h3>
          <form id="password-form" class="settings-form">
            <div class="form-group">
              <label class="form-label" for="current-password">${t('settings.currentPasswordLabel')}</label>
              <input class="form-input" type="password" id="current-password" autocomplete="current-password" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-password">${t('settings.newPasswordLabel')}</label>
              <input class="form-input" type="password" id="new-password" autocomplete="new-password" minlength="8" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="confirm-password">${t('settings.confirmPasswordLabel')}</label>
              <input class="form-input" type="password" id="confirm-password" autocomplete="new-password" minlength="8" required />
            </div>
            <div id="password-error" class="form-error" hidden></div>
            <button type="submit" class="btn btn--primary">${t('settings.savePassword')}</button>
          </form>
        </div>
      </section>

      <!-- Kalender-Synchronisation -->
      <section class="settings-section">
        <h2 class="settings-section__title">${t('settings.sectionCalendarSync')}</h2>

        <!-- Google Calendar -->
        <div class="settings-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--google">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">${t('settings.googleCalendar')}</div>
              <div class="settings-sync-info__status ${googleStatus.connected ? 'settings-sync-info__status--connected' : ''}">
                ${googleStatusText}
              </div>
            </div>
          </div>
          ${googleStatus.configured ? `
            <div class="settings-sync-actions">
              ${googleStatus.connected ? `
                <button class="btn btn--secondary" id="google-sync-btn">${t('settings.syncNow')}</button>
                ${user?.role === 'admin' ? `<button class="btn btn--danger-outline" id="google-disconnect-btn">${t('settings.disconnect')}</button>` : ''}
              ` : `
                ${user?.role === 'admin' ? `<a href="/api/v1/calendar/google/auth" class="btn btn--primary">${t('settings.connectGoogle')}</a>` : `<span class="form-hint">${t('settings.googleOnlyAdmin')}</span>`}
              `}
            </div>
          ` : ''}
        </div>

        <!-- Apple Calendar -->
        <div class="settings-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--apple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">${t('settings.appleCalendar')}</div>
              <div class="settings-sync-info__status ${appleStatus.configured ? 'settings-sync-info__status--connected' : ''}">
                ${appleStatusText}
              </div>
            </div>
          </div>
          ${appleStatus.configured ? `
            <div class="settings-sync-actions">
              <button class="btn btn--secondary" id="apple-sync-btn">${t('settings.syncNow')}</button>
              ${appleStatus.connected && user?.role === 'admin' ? `<button class="btn btn--danger-outline" id="apple-disconnect-btn">${t('settings.disconnect')}</button>` : ''}
            </div>
          ` : user?.role === 'admin' ? `
            <form id="apple-connect-form" class="settings-form settings-form--compact">
              <div class="form-group">
                <label class="form-label" for="apple-caldav-url">${t('settings.caldavUrlLabel')}</label>
                <input class="form-input" type="url" id="apple-caldav-url" placeholder="${t('settings.caldavUrlPlaceholder')}" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="apple-username">${t('settings.appleIdLabel')}</label>
                <input class="form-input" type="email" id="apple-username" autocomplete="username" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="apple-password">${t('settings.applePasswordLabel')}</label>
                <input class="form-input" type="password" id="apple-password" autocomplete="current-password" required />
                <span class="form-hint">${t('settings.applePasswordHint')}</span>
              </div>
              <div id="apple-connect-error" class="form-error" hidden></div>
              <button type="submit" class="btn btn--primary" id="apple-connect-btn">${t('settings.appleConnectBtn')}</button>
            </form>
          ` : `<span class="form-hint">${t('settings.appleOnlyAdmin')}</span>`}
        </div>
      </section>

      <!-- Familienmitglieder (nur Admin) -->
      ${user?.role === 'admin' ? `
      <section class="settings-section">
        <h2 class="settings-section__title">${t('settings.sectionFamily')}</h2>
        <div class="settings-card" id="members-card">
          <ul class="settings-members" id="members-list">
            ${users.map(memberHtml).join('')}
          </ul>
          <button class="btn btn--primary settings-add-btn" id="add-member-btn">${t('settings.addMember')}</button>
        </div>

        <div class="settings-card settings-card--hidden" id="add-member-form-card">
          <h3 class="settings-card__title">${t('settings.newMemberTitle')}</h3>
          <form id="add-member-form" class="settings-form">
            <div class="form-group">
              <label class="form-label" for="new-username">${t('settings.usernameLabel')}</label>
              <input class="form-input" type="text" id="new-username" required autocomplete="off" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-display-name">${t('settings.displayNameLabel')}</label>
              <input class="form-input" type="text" id="new-display-name" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-member-password">${t('settings.memberPasswordLabel')}</label>
              <input class="form-input" type="password" id="new-member-password" minlength="8" required autocomplete="new-password" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-avatar-color">${t('settings.colorLabel')}</label>
              <input class="form-input form-input--color" type="color" id="new-avatar-color" value="#007AFF" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-role">${t('settings.roleLabel')}</label>
              <select class="form-input" id="new-role">
                <option value="member">${t('settings.roleMember')}</option>
                <option value="admin">${t('settings.roleAdmin')}</option>
              </select>
            </div>
            <div id="member-error" class="form-error" hidden></div>
            <div class="settings-form-actions">
              <button type="submit" class="btn btn--primary">${t('settings.createMember')}</button>
              <button type="button" class="btn btn--secondary" id="cancel-add-member">${t('settings.cancelAddMember')}</button>
            </div>
          </form>
        </div>
      </section>
      ` : ''}

      <!-- Abmelden -->
      <section class="settings-section">
        <button class="btn btn--danger-outline settings-logout-btn" id="logout-btn">${t('settings.logout')}</button>
      </section>
    </div>
  `;

  // Meal-Type-Checkboxen initialisieren
  const toggles = container.querySelector('#meal-type-toggles');
  if (toggles) {
    toggles.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = prefs.visible_meal_types.includes(cb.value);
    });
  }

  bindEvents(container, user);
}

// --------------------------------------------------------
// Event-Binding
// --------------------------------------------------------

function bindEvents(container, user) {
  // Theme-Toggle
  const themeToggle = container.querySelector('#theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-value]');
      if (!btn) return;
      const value = btn.dataset.themeValue;
      applyTheme(value);
      themeToggle.querySelectorAll('.theme-toggle__btn').forEach(b => b.classList.remove('theme-toggle__btn--active'));
      btn.classList.add('theme-toggle__btn--active');
    });
  }

  // Meal-Type-Toggles
  const mealToggles = container.querySelector('#meal-type-toggles');
  if (mealToggles) {
    mealToggles.addEventListener('change', async () => {
      const checked = [...mealToggles.querySelectorAll('input:checked')].map((cb) => cb.value);
      if (checked.length === 0) {
        window.oikos?.showToast(t('settings.mealTypesMinOne'), 'error');
        // Revert: re-check all
        mealToggles.querySelectorAll('input').forEach((cb) => { cb.checked = true; });
        return;
      }
      try {
        await api.put('/preferences', { visible_meal_types: checked });
        window.oikos?.showToast(t('settings.mealTypesSaved'), 'success');
      } catch (err) {
        window.oikos?.showToast(err.message ?? t('common.errorGeneric'), 'danger');
      }
    });
  }

  // Passwort ändern
  const passwordForm = container.querySelector('#password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPw  = container.querySelector('#current-password').value;
      const newPw      = container.querySelector('#new-password').value;
      const confirmPw  = container.querySelector('#confirm-password').value;
      const errorEl    = container.querySelector('#password-error');

      errorEl.hidden = true;

      if (newPw !== confirmPw) {
        showError(errorEl, t('settings.passwordMismatch'));
        return;
      }

      const btn = passwordForm.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await api.patch('/auth/me/password', { current_password: currentPw, new_password: newPw });
        passwordForm.reset();
        window.oikos?.showToast(t('settings.passwordSavedToast'), 'success');
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Google Sync
  const googleSyncBtn = container.querySelector('#google-sync-btn');
  if (googleSyncBtn) {
    googleSyncBtn.addEventListener('click', async () => {
      googleSyncBtn.disabled = true;
      googleSyncBtn.textContent = t('settings.synchronizing');
      try {
        await api.post('/calendar/google/sync', {});
        window.oikos?.showToast(t('settings.syncSuccess', { provider: 'Google Calendar' }), 'success');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      } finally {
        googleSyncBtn.disabled = false;
        googleSyncBtn.textContent = t('settings.syncNow');
      }
    });
  }

  // Google Disconnect (Admin)
  const googleDisconnectBtn = container.querySelector('#google-disconnect-btn');
  if (googleDisconnectBtn) {
    googleDisconnectBtn.addEventListener('click', async () => {
      if (!confirm(t('settings.googleDisconnectConfirm'))) return;
      try {
        await api.delete('/calendar/google/disconnect');
        window.oikos?.showToast(t('settings.disconnectedToast', { provider: 'Google Calendar' }), 'default');
        window.oikos?.navigate('/settings');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      }
    });
  }

  // Apple Sync
  const appleSyncBtn = container.querySelector('#apple-sync-btn');
  if (appleSyncBtn) {
    appleSyncBtn.addEventListener('click', async () => {
      appleSyncBtn.disabled = true;
      appleSyncBtn.textContent = t('settings.synchronizing');
      try {
        await api.post('/calendar/apple/sync', {});
        window.oikos?.showToast(t('settings.syncSuccess', { provider: 'Apple Calendar' }), 'success');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      } finally {
        appleSyncBtn.disabled = false;
        appleSyncBtn.textContent = t('settings.syncNow');
      }
    });
  }

  // Apple Disconnect (Admin)
  const appleDisconnectBtn = container.querySelector('#apple-disconnect-btn');
  if (appleDisconnectBtn) {
    appleDisconnectBtn.addEventListener('click', async () => {
      if (!confirm(t('settings.appleDisconnectConfirm'))) return;
      try {
        await api.delete('/calendar/apple/disconnect');
        window.oikos?.showToast(t('settings.disconnectedToast', { provider: 'Apple Calendar' }), 'default');
        window.oikos?.navigate('/settings');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      }
    });
  }

  // Apple Connect-Formular (Admin)
  const appleConnectForm = container.querySelector('#apple-connect-form');
  if (appleConnectForm) {
    appleConnectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = container.querySelector('#apple-connect-error');
      errorEl.hidden = true;

      const url      = container.querySelector('#apple-caldav-url').value.trim();
      const username = container.querySelector('#apple-username').value.trim();
      const password = container.querySelector('#apple-password').value;
      const btn      = container.querySelector('#apple-connect-btn');

      btn.disabled = true;
      btn.textContent = t('settings.appleConnecting');
      try {
        await api.post('/calendar/apple/connect', { url, username, password });
        window.oikos?.showToast(t('settings.appleConnectedToast'), 'success');
        window.oikos?.navigate('/settings');
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = t('settings.appleConnectBtn');
      }
    });
  }

  // Mitglied hinzufügen (Admin)
  const addMemberBtn = container.querySelector('#add-member-btn');
  if (addMemberBtn) {
    addMemberBtn.addEventListener('click', () => {
      container.querySelector('#add-member-form-card').classList.remove('settings-card--hidden');
      addMemberBtn.hidden = true;
    });
  }

  const cancelAddMember = container.querySelector('#cancel-add-member');
  if (cancelAddMember) {
    cancelAddMember.addEventListener('click', () => {
      container.querySelector('#add-member-form-card').classList.add('settings-card--hidden');
      container.querySelector('#add-member-btn').hidden = false;
      container.querySelector('#add-member-form').reset();
      container.querySelector('#member-error').hidden = true;
    });
  }

  const addMemberForm = container.querySelector('#add-member-form');
  if (addMemberForm) {
    addMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = container.querySelector('#member-error');
      errorEl.hidden = true;

      const data = {
        username:     container.querySelector('#new-username').value.trim(),
        display_name: container.querySelector('#new-display-name').value.trim(),
        password:     container.querySelector('#new-member-password').value,
        avatar_color: container.querySelector('#new-avatar-color').value,
        role:         container.querySelector('#new-role').value,
      };

      const btn = addMemberForm.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const res  = await auth.createUser(data);
        const list = container.querySelector('#members-list');
        list.insertAdjacentHTML('beforeend', memberHtml(res.user));
        addMemberForm.reset();
        container.querySelector('#add-member-form-card').classList.add('settings-card--hidden');
        container.querySelector('#add-member-btn').hidden = false;
        window.oikos?.showToast(t('settings.memberAddedToast', { name: res.user.display_name }), 'success');
        bindDeleteButtons(container, user);
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  bindDeleteButtons(container, user);

  // Abmelden
  const logoutBtn = container.querySelector('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await auth.logout();
      } finally {
        window.location.href = '/login';
      }
    });
  }
}

function bindDeleteButtons(container, user) {
  container.querySelectorAll('[data-delete-user]').forEach((btn) => {
    btn.replaceWith(btn.cloneNode(true)); // Doppelte Listener vermeiden
  });
  container.querySelectorAll('[data-delete-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id   = parseInt(btn.dataset.deleteUser, 10);
      const name = btn.dataset.name;
      if (!confirm(t('settings.deleteMemberConfirm', { name }))) return;
      try {
        await auth.deleteUser(id);
        btn.closest('.settings-member').remove();
        window.oikos?.showToast(t('settings.memberDeletedToast', { name }), 'default');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      }
    });
  });
}


function memberHtml(u) {
  return `
    <li class="settings-member" data-id="${u.id}">
      <div class="settings-avatar settings-avatar--sm" style="background:${esc(u.avatar_color)}">${initials(u.display_name)}</div>
      <div class="settings-member__info">
        <span class="settings-member__name">${esc(u.display_name)}</span>
        <span class="settings-member__meta">@${esc(u.username)} · ${u.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleMember')}</span>
      </div>
      <button class="btn btn--icon btn--danger-outline" data-delete-user="${u.id}" data-name="${esc(u.display_name)}" aria-label="${esc(u.display_name)} ${t('settings.deleteMemberLabel')}" title="${t('settings.deleteMemberLabel')}">
        <i data-lucide="trash-2" aria-hidden="true"></i>
      </button>
    </li>
  `;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDate(d)} ${formatTime(d)}`.trim();
}

function currentTheme() {
  return localStorage.getItem('oikos-theme') || 'system';
}

function applyTheme(value) {
  localStorage.setItem('oikos-theme', value);
  if (value === 'light' || value === 'dark') {
    document.documentElement.setAttribute('data-theme', value);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}
