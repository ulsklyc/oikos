import { t } from '/i18n.js';
import { getPreferences, savePreferences } from '/settings/preferences-cache.js';

// Spiegelt MAX_COUNTDOWN_GRACE_DAYS in server/routes/preferences (#969).
const MAX_COUNTDOWN_GRACE_DAYS = 90;
const DEFAULT_GRACE_DAYS = 7;

function renderPage(container, preferences) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <div class="settings-card">
        <h2 class="settings-card__title">${t('settings.countdownGraceDaysTitle')}</h2>
        <p class="form-hint">${t('settings.countdownGraceDaysHint')}</p>
        <form class="settings-form settings-form--compact" id="countdown-grace-days-form" novalidate autocomplete="off">
          <div class="form-group">
            <label class="form-label" for="countdown-grace-days">${t('settings.countdownGraceDaysLabel')}</label>
            <input class="form-input" type="number" id="countdown-grace-days" inputmode="numeric"
                   min="0" max="${MAX_COUNTDOWN_GRACE_DAYS}" step="1"
                   aria-describedby="countdown-grace-days-error"
                   value="${Number.isFinite(preferences.countdown_grace_days) ? preferences.countdown_grace_days : DEFAULT_GRACE_DAYS}">
          </div>
          <div id="countdown-grace-days-error" class="form-error" role="alert" hidden></div>
          <div class="settings-form-actions">
            <button type="submit" class="btn btn--primary">${t('common.save')}</button>
          </div>
        </form>
      </div>
    </section>
  `);
}

/**
 * Nachfrist für abgelaufene Countdowns (#969) - kein Instant-Save, dieselbe
 * Form wie rewards-default-points (modules-rewards.js): eine Eingabe, die erst
 * mit einem bewussten Abschluss zaehlt, statt bei jedem Tastendruck zu senden.
 */
function bindEvents(container, preferences) {
  const form = container.querySelector('#countdown-grace-days-form');
  const input = container.querySelector('#countdown-grace-days');
  const errorEl = container.querySelector('#countdown-grace-days-error');
  if (!form || !input) return;

  let persisted = Number.isFinite(preferences.countdown_grace_days) ? preferences.countdown_grace_days : DEFAULT_GRACE_DAYS;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    const next = Math.trunc(Number(input.value));
    if (!Number.isFinite(next) || next < 0 || next > MAX_COUNTDOWN_GRACE_DAYS) {
      errorEl.textContent = t('settings.countdownGraceDaysInvalid', { max: MAX_COUNTDOWN_GRACE_DAYS });
      errorEl.hidden = false;
      return;
    }
    if (next === persisted) return;

    // Feld mitsperren, nicht nur den Button: sonst überschreibt der Erfolgspfad
    // eine Eingabe, die während des laufenden Requests getippt wurde.
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    input.disabled = true;
    const previous = persisted;
    try {
      await savePreferences({ countdown_grace_days: next });
      persisted = next;
      input.value = String(next);
      preferences.countdown_grace_days = next;
      window.yuvomi?.showToast(t('settings.countdownGraceDaysSaved'), 'success');
    } catch (error) {
      input.value = String(previous); // Rollback
      errorEl.textContent = error.message || t('common.errorGeneric');
      errorEl.hidden = false;
    } finally {
      if (submitBtn.isConnected) submitBtn.disabled = false;
      if (input.isConnected) input.disabled = false;
    }
  });
}

export async function render(container, { user }) {
  void user;
  const preferences = await getPreferences();
  renderPage(container, preferences);
  bindEvents(container, preferences);
}
