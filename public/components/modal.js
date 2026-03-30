/**
 * Modul: Shared Modal-System
 * Zweck: Einheitliches Modal mit Focus-Trap, Escape-Handler, Overlay-Click,
 *        Focus-Restore, Scroll-Lock und aria-modal.
 *        Auf Mobile: Bottom Sheet mit Swipe-to-Close und Slide-out-Animation.
 * Abhängigkeiten: CSS-Klassen aus layout.css (.modal-overlay, .modal-panel, etc.)
 *
 * API:
 *   openModal({ title, content, onSave, onDelete, size }) → void
 *   closeModal() → void
 */

let activeOverlay = null;
let previouslyFocused = null;
let focusTrapHandler = null;

// Overlay-Dimming: theme-color abdunkeln im Standalone-Modus
const OVERLAY_THEME_COLOR = '#1A1A1A';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// --------------------------------------------------------
// Focus-Trap (Spec §5.2)
// --------------------------------------------------------

function trapFocus(container) {
  focusTrapHandler = (e) => {
    // Tab-Trap: Fokus innerhalb des Modals halten
    if (e.key === 'Tab') {
      const focusable = container.querySelectorAll(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    // Enter in einzeiligen Inputs/Selects → zum nächsten Feld springen
    if (e.key === 'Enter') {
      const active = document.activeElement;
      const isInput = active.tagName === 'INPUT' && active.type !== 'submit' && active.type !== 'button';
      const isSelect = active.tagName === 'SELECT';

      if (isInput || isSelect) {
        const focusable = Array.from(container.querySelectorAll(FOCUSABLE));
        const idx = focusable.indexOf(active);
        const next = focusable[idx + 1];

        if (next && next.tagName !== 'BUTTON') {
          e.preventDefault();
          next.focus();
        }
        // Beim letzten Feld oder wenn Next ein Button ist: Submit auslösen
        if (!next || next.tagName === 'BUTTON') {
          const submitBtn = container.querySelector('button[type="submit"], .btn--primary');
          if (submitBtn && !submitBtn.disabled) {
            e.preventDefault();
            submitBtn.click();
          }
        }
      }
    }
  };
  container.addEventListener('keydown', focusTrapHandler);

  // Virtual Keyboard: Focused Input in sichtbaren Bereich scrollen
  function onInputFocus(e) {
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
  container.addEventListener('focusin', onInputFocus);
  container._onInputFocus = onInputFocus;

  // Focus first focusable element
  const first = container.querySelector(FOCUSABLE);
  if (first) {
    setTimeout(() => first.focus(), 50);
  }
}

// --------------------------------------------------------
// Escape-Handler
// --------------------------------------------------------

function onEscape(e) {
  if (e.key === 'Escape') closeModal();
}

// --------------------------------------------------------
// Swipe-to-Close (Mobile)
// --------------------------------------------------------

function _wireSheetSwipe(panel) {
  let startY = 0;
  let dragging = false;

  panel.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) return; // Kein Swipe nach oben
    panel.style.transform = `translateY(${dy * 0.6}px)`;
  }, { passive: true });

  panel.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    panel.style.transform = '';
    if (dy > 80) {
      closeModal();
    }
  });
}

// --------------------------------------------------------
// _doClose — gemeinsame Cleanup-Logik
// --------------------------------------------------------

function _doClose() {
  if (!activeOverlay) return;
  activeOverlay.remove();
  activeOverlay = null;

  // Scroll-Lock aufheben
  document.body.style.overflow = '';

  // Focus-Restore
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus();
    previouslyFocused = null;
  }

  // Standalone: Statusbar-Farbe zur aktuellen Route wiederherstellen
  if (window.oikos?.restoreThemeColor) {
    window.oikos.restoreThemeColor();
  }
}

// --------------------------------------------------------
// openModal
// --------------------------------------------------------

/**
 * Öffnet ein Modal mit dem Shared-System.
 *
 * @param {Object}   opts
 * @param {string}   opts.title    — Titel im Modal-Header
 * @param {string}   opts.content  — HTML-String für den Modal-Body
 * @param {Function} [opts.onSave]   — Callback, wird nach Einfügen in DOM aufgerufen
 *                                      (zum Binden von Form-Events)
 * @param {Function} [opts.onDelete] — Falls vorhanden, wird ein Löschen-Button eingebaut
 * @param {string}   [opts.size='md'] — 'sm' | 'md' | 'lg'
 */
export function openModal({ title, content, onSave, onDelete, size = 'md' } = {}) {
  // Vorheriges Modal schließen (kein Stacking)
  if (activeOverlay) closeModal();

  // Focus-Restore vorbereiten
  previouslyFocused = document.activeElement;

  // Scroll-Lock
  document.body.style.overflow = 'hidden';

  const sizeClass = size !== 'md' ? ` modal-panel--${size}` : '';

  const html = `
    <div class="modal-overlay" id="shared-modal-overlay">
      <div class="modal-panel${sizeClass}" role="dialog" aria-modal="true"
           aria-labelledby="shared-modal-title">
        <div class="modal-panel__header">
          <h2 class="modal-panel__title" id="shared-modal-title">${title}</h2>
          <button class="modal-panel__close" data-action="close-modal" aria-label="Schließen">
            <i data-lucide="x" style="width:18px;height:18px" aria-hidden="true"></i>
          </button>
        </div>
        <div class="modal-panel__body">
          ${content}
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  activeOverlay = document.getElementById('shared-modal-overlay');

  // Lucide-Icons rendern
  if (window.lucide) window.lucide.createIcons();

  // Focus-Trap
  const panel = activeOverlay.querySelector('.modal-panel');
  trapFocus(panel);

  // Swipe-to-Close auf Mobile
  if (window.innerWidth < 768) {
    _wireSheetSwipe(panel);
  }

  // Overlay-Click schließt Modal
  activeOverlay.addEventListener('click', (e) => {
    if (e.target === activeOverlay) closeModal();
  });

  // Close-Button
  activeOverlay.querySelector('[data-action="close-modal"]')
    ?.addEventListener('click', closeModal);

  // Escape
  document.addEventListener('keydown', onEscape);

  // Callback für Aufrufer (Form-Events binden etc.)
  if (typeof onSave === 'function') onSave(panel);

  // Standalone: Statusbar abdunkeln (Overlay-Effekt)
  if (window.oikos?.setThemeColor) {
    window.oikos.setThemeColor(OVERLAY_THEME_COLOR, OVERLAY_THEME_COLOR);
  }
}

// --------------------------------------------------------
// closeModal
// --------------------------------------------------------

export function closeModal() {
  if (!activeOverlay) return;

  document.removeEventListener('keydown', onEscape);

  const panel = activeOverlay.querySelector('.modal-panel');

  // Focus-Trap-Handler und Virtual-Keyboard-Listener entfernen
  if (focusTrapHandler) {
    if (panel) panel.removeEventListener('keydown', focusTrapHandler);
    focusTrapHandler = null;
  }
  if (panel?._onInputFocus) {
    panel.removeEventListener('focusin', panel._onInputFocus);
  }

  // Sheet-Out-Animation auf Mobile, danach _doClose
  const isMobile = window.innerWidth < 768;
  if (isMobile && panel) {
    panel.classList.add('modal-panel--closing');
    panel.addEventListener('animationend', () => {
      _doClose();
    }, { once: true });
    return;
  }

  _doClose();
}

// --------------------------------------------------------
// Inline Blur-Validierung
// --------------------------------------------------------

/**
 * Aktiviert Blur-Validierung für alle required-Inputs in einem Container.
 * @param {HTMLElement} formContainer
 */
export function wireBlurValidation(formContainer) {
  formContainer.querySelectorAll('input[required], select[required], textarea[required]').forEach((input) => {
    input.addEventListener('blur', () => {
      const group = input.closest('.form-field') ?? input.parentElement;
      const hasValue = input.value.trim().length > 0;
      group?.classList.toggle('form-field--error', !hasValue);
      group?.classList.toggle('form-field--valid', hasValue);
    });
  });
}

// --------------------------------------------------------
// Submit-Feedback (Checkmark + Shake)
// --------------------------------------------------------

/**
 * Zeigt Erfolgs-Feedback auf einem Button (Checkmark für 700ms).
 * @param {HTMLButtonElement} btn
 * @param {string} [originalLabel]
 */
export function btnSuccess(btn, originalLabel) {
  const label = originalLabel ?? btn.textContent;
  btn.classList.add('btn--success');
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;
  setTimeout(() => {
    btn.classList.remove('btn--success');
    btn.textContent = label;
  }, 700);
}

/**
 * Zeigt Fehler-Feedback auf einem Button (Shake-Animation).
 * @param {HTMLButtonElement} btn
 */
export function btnError(btn) {
  btn.classList.remove('btn--shaking');
  void btn.offsetWidth; // Reflow für Animation-Restart
  btn.classList.add('btn--shaking');
  btn.addEventListener('animationend', () => btn.classList.remove('btn--shaking'), { once: true });
}
