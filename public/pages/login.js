/**
 * Modul: Login-Seite
 * Zweck: Anmeldeformular mit Username/Passwort, Fehlerbehandlung, Session-Start
 * Abhängigkeiten: /api.js
 */

import { auth } from '/api.js';

/**
 * Rendert die Login-Seite in den gegebenen Container.
 * @param {HTMLElement} container
 */
export async function render(container) {
  container.innerHTML = `
    <main class="login-page" id="main-content">
      <div class="login-card card card--padded">
        <h1 class="login-card__title">Oikos</h1>
        <p class="login-card__subtitle">Familienplaner</p>

        <form class="login-form" id="login-form" novalidate>
          <div class="form-group">
            <label class="label" for="username">Benutzername</label>
            <input
              class="input"
              type="text"
              id="username"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              autocorrect="off"
              placeholder="benutzername"
              required
            />
          </div>

          <div class="form-group">
            <label class="label" for="password">Passwort</label>
            <input
              class="input"
              type="password"
              id="password"
              name="password"
              autocomplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>

          <div class="login-error" id="login-error" role="alert" aria-live="polite" hidden></div>

          <button type="submit" class="btn btn--primary login-form__submit" id="login-btn">
            Anmelden
          </button>
        </form>
      </div>
    </main>
  `;

  const form = container.querySelector('#login-form');
  const errorEl = container.querySelector('#login-error');
  const submitBtn = container.querySelector('#login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const username = form.username.value.trim();
    const password = form.password.value;

    if (!username || !password) {
      showError(errorEl, 'Bitte alle Felder ausfüllen.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird angemeldet …';

    try {
      await auth.login(username, password);
      window.oikos.navigate('/');
    } catch (err) {
      showError(errorEl, err.status === 429
        ? 'Zu viele Versuche. Bitte warte kurz.'
        : 'Ungültige Anmeldedaten.'
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Anmelden';
    }
  });
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}
