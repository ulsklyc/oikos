/**
 * Modul: Install-Prompt Web Component
 * Zweck: Dezentes Banner für PWA-Installation (Chrome/Android) und iOS-Anleitung
 * Abhängigkeiten: Design Tokens aus tokens.css (via CSS custom properties)
 *
 * Verhalten:
 *   - Chrome/Android: Fängt beforeinstallprompt ab, zeigt Install-Banner
 *   - iOS (Safari): Zeigt Anleitung "Zum Home-Bildschirm"
 *   - Standalone-Modus: Zeigt nichts an
 *   - Dismiss: 7 Tage via localStorage gespeichert
 *   - Timing: Banner erst nach 2 Nutzer-Interaktionen anzeigen
 */

const DISMISS_KEY = 'oikos-install-dismissed';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

const INTERACTION_KEY = 'oikos-install-interactions';
const INTERACTION_THRESHOLD = 2;

class OikosInstallPrompt extends HTMLElement {
  constructor() {
    super();
    this._deferredPrompt = null;
    this._shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    // Bereits im Standalone-Modus — nichts anzeigen
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true
    ) {
      return;
    }

    // Dismiss noch aktiv?
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < DISMISS_DURATION_MS) {
      return;
    }

    // Noch nicht genug Interaktionen
    const interactions = Number(localStorage.getItem(INTERACTION_KEY) || '0');
    if (interactions < INTERACTION_THRESHOLD) {
      this._waitForInteractions();
      return;
    }

    if (this._isIOS()) {
      this._showIOSPrompt();
    } else {
      this._listenForInstallPrompt();
    }
  }

  disconnectedCallback() {
    window.removeEventListener('beforeinstallprompt', this._onBeforeInstall);
    if (this._offInteraction) this._offInteraction();
  }

  _waitForInteractions() {
    const onInteraction = () => {
      const count = Number(localStorage.getItem(INTERACTION_KEY) || '0') + 1;
      localStorage.setItem(INTERACTION_KEY, String(count));

      if (count >= INTERACTION_THRESHOLD) {
        document.removeEventListener('click', onInteraction);
        if (this._isIOS()) {
          this._showIOSPrompt();
        } else {
          this._listenForInstallPrompt();
        }
      }
    };
    document.addEventListener('click', onInteraction);
    this._offInteraction = () => document.removeEventListener('click', onInteraction);
  }

  /** iOS Safari erkennen (kein beforeinstallprompt-Support) */
  _isIOS() {
    return (
      navigator.standalone === undefined &&
      /iPhone|iPad/.test(navigator.userAgent) &&
      !window.MSStream
    );
  }

  /** Chrome/Android: beforeinstallprompt abfangen */
  _listenForInstallPrompt() {
    this._onBeforeInstall = (e) => {
      e.preventDefault();
      this._deferredPrompt = e;
      this._showBanner(false);
    };
    window.addEventListener('beforeinstallprompt', this._onBeforeInstall);
  }

  /** Banner rendern */
  _showBanner(isIOS) {
    this._shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        position: fixed;
        bottom: calc(var(--nav-height-mobile, 56px) + env(safe-area-inset-bottom, 0px) + 8px);
        left: var(--space-3, 12px);
        right: var(--space-3, 12px);
        z-index: var(--z-toast, 300);
        pointer-events: none;
      }

      .banner {
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
        padding: var(--space-3, 12px) var(--space-4, 16px);
        background: var(--color-surface, #fff);
        border: 1px solid var(--color-border, #e8e7e2);
        border-radius: var(--radius-md, 12px);
        box-shadow: var(--shadow-md, 0 2px 8px rgba(0,0,0,0.08));
        pointer-events: auto;
        transform: translateY(calc(100% + 20px));
        transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .banner--visible {
        transform: translateY(0);
      }

      .icon {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm, 8px);
        flex-shrink: 0;
      }

      .text {
        flex: 1;
        min-width: 0;
      }

      .title {
        font-family: var(--font-sans, system-ui);
        font-size: var(--text-base, 0.875rem);
        font-weight: var(--font-weight-semibold, 600);
        color: var(--color-text-primary, #1c1c1a);
        line-height: var(--line-height-tight, 1.25);
      }

      .subtitle {
        font-family: var(--font-sans, system-ui);
        font-size: var(--text-sm, 0.8125rem);
        color: var(--color-text-secondary, #6c6b67);
        line-height: var(--line-height-base, 1.5);
        margin-top: 2px;
      }

      .btn-install {
        flex-shrink: 0;
        padding: var(--space-2, 8px) var(--space-4, 16px);
        background: var(--color-btn-primary, #2554C7);
        color: #fff;
        border: none;
        border-radius: var(--radius-sm, 8px);
        font-family: var(--font-sans, system-ui);
        font-size: var(--text-sm, 0.8125rem);
        font-weight: var(--font-weight-semibold, 600);
        cursor: pointer;
        min-height: 36px;
        min-width: 36px;
        transition: background 0.15s ease;
      }

      .btn-install:hover {
        background: var(--color-btn-primary-hover, #1E429A);
      }

      .btn-dismiss {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: var(--radius-xs, 4px);
        cursor: pointer;
        color: var(--color-text-tertiary, #737370);
        padding: 0;
        min-height: 32px;
        min-width: 32px;
        transition: background 0.15s ease;
      }

      .btn-dismiss:hover {
        background: var(--color-surface-3, #efeee9);
      }

      .btn-dismiss svg {
        width: 18px;
        height: 18px;
      }

      /* iOS share icon inline */
      .share-icon {
        display: inline-block;
        width: 1em;
        height: 1em;
        vertical-align: -0.1em;
      }

      @media (min-width: 1024px) {
        :host {
          /* Desktop: Sidebar statt Bottom-Nav, Banner unten rechts */
          bottom: calc(var(--space-4, 16px) + env(safe-area-inset-bottom, 0px));
          left: auto;
          right: var(--space-4, 16px);
          max-width: 380px;
        }
      }
    `;

    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.setAttribute('role', 'alert');

    // App-Icon
    const icon = document.createElement('img');
    icon.className = 'icon';
    icon.src = '/icons/icon-192.png';
    icon.alt = 'Oikos';
    icon.width = 40;
    icon.height = 40;
    banner.appendChild(icon);

    // Text
    const text = document.createElement('div');
    text.className = 'text';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Oikos installieren';

    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';

    if (isIOS) {
      // iOS: Teilen-Icon als SVG inline
      subtitle.innerHTML = '';
      subtitle.append(
        document.createTextNode('Tippe auf '),
        this._createShareIcon(),
        document.createTextNode(' → „Zum Home-Bildschirm"')
      );
    } else {
      subtitle.textContent = 'Zur App hinzufügen';
    }

    text.appendChild(title);
    text.appendChild(subtitle);
    banner.appendChild(text);

    // Install-Button (nur Chrome/Android)
    if (!isIOS) {
      const btn = document.createElement('button');
      btn.className = 'btn-install';
      btn.textContent = 'Installieren';
      btn.addEventListener('click', () => this._onInstallClick());
      banner.appendChild(btn);
    }

    // Dismiss-Button
    const dismiss = document.createElement('button');
    dismiss.className = 'btn-dismiss';
    dismiss.setAttribute('aria-label', 'Schließen');
    dismiss.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    dismiss.addEventListener('click', () => this._dismiss());
    banner.appendChild(dismiss);

    this._shadow.appendChild(style);
    this._shadow.appendChild(banner);

    // Slide-in Animation nach nächstem Frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.classList.add('banner--visible');
      });
    });
  }

  /** iOS Teilen-Icon (Box mit Pfeil nach oben) */
  _createShareIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('share-icon');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '16 6 12 2 8 6');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '2');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '15');

    svg.appendChild(path);
    svg.appendChild(polyline);
    svg.appendChild(line);
    return svg;
  }

  /** Install-Button geklickt */
  async _onInstallClick() {
    if (!this._deferredPrompt) return;

    try {
      this._deferredPrompt.prompt();
      const result = await this._deferredPrompt.userChoice;
      console.log('[oikos-install-prompt] Ergebnis:', result.outcome);

      if (result.outcome === 'accepted') {
        this._remove();
      }
    } catch (err) {
      console.error('[oikos-install-prompt] Fehler:', err);
    }

    this._deferredPrompt = null;
  }

  /** Dismiss: 7 Tage merken, Interaction-Counter zurücksetzen, Banner entfernen */
  _dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    localStorage.removeItem(INTERACTION_KEY);
    this._remove();
  }

  /** Banner mit Slide-out entfernen */
  _remove() {
    const banner = this._shadow.querySelector('.banner');
    if (!banner) return;

    banner.classList.remove('banner--visible');
    banner.addEventListener('transitionend', () => this.remove(), { once: true });
  }

  /** iOS: Banner direkt anzeigen */
  _showIOSPrompt() {
    this._showBanner(true);
  }
}

customElements.define('oikos-install-prompt', OikosInstallPrompt);
