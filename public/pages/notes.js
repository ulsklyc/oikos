/**
 * Modul: Pinnwand / Notizen (Notes)
 * Zweck: Masonry-Grid mit farbigen Sticky Notes, Pin-Toggle, CRUD
 * Abhängigkeiten: /api.js, /router.js (window.oikos)
 */

import { api } from '/api.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const NOTE_COLORS = [
  '#FFEB3B', '#FFD54F', '#A5D6A7', '#80DEEA',
  '#90CAF9', '#CE93D8', '#FFAB91', '#FFFFFF',
];

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = { notes: [], user: null };
let _container = null;

// --------------------------------------------------------
// Markdown-Light Renderer
// --------------------------------------------------------

function renderMarkdownLight(text) {
  if (!text) return '';
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^- (.+)$/gm,     '• $1')
    .replace(/\n/g,            '<br>');
}

// --------------------------------------------------------
// Entry Point
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  state.user = user;

  container.innerHTML = `
    <div class="notes-page">
      <div class="notes-toolbar">
        <span class="notes-toolbar__title">Pinnwand</span>
        <button class="btn btn--primary" id="notes-add-btn">
          <i data-lucide="plus" style="width:16px;height:16px;margin-right:4px;"></i>
          Neue Notiz
        </button>
      </div>
      <div id="notes-grid" class="notes-grid"></div>
      <button class="page-fab" id="fab-new-note" aria-label="Neue Notiz">
        <i data-lucide="plus" style="width:24px;height:24px"></i>
      </button>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  try {
    const res  = await api.get('/notes');
    state.notes = res.data;
  } catch (err) {
    console.error('[Notes] Laden fehlgeschlagen:', err);
    state.notes = [];
    window.oikos?.showToast('Notizen konnten nicht geladen werden.', 'danger');
  }
  renderGrid();

  const addHandler = () => openModal({ mode: 'create' });
  _container.querySelector('#notes-add-btn').addEventListener('click', addHandler);
  _container.querySelector('#fab-new-note').addEventListener('click', addHandler);
}

// --------------------------------------------------------
// Grid
// --------------------------------------------------------

function renderGrid() {
  const grid = _container.querySelector('#notes-grid');
  if (!grid) return;

  if (!state.notes.length) {
    grid.innerHTML = `
      <div class="notes-empty">
        <i data-lucide="sticky-note" class="notes-empty__icon"></i>
        <div style="font-size:var(--text-lg);font-weight:600;margin-bottom:var(--space-2);">Noch keine Notizen</div>
        <div style="font-size:var(--text-sm);">Klicke auf „Neue Notiz" um loszulegen.</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  grid.innerHTML = state.notes.map((n) => renderNoteCard(n)).join('');
  if (window.lucide) lucide.createIcons();

  grid.addEventListener('click', async (e) => {
    // Pin
    const pinBtn = e.target.closest('[data-action="pin"]');
    if (pinBtn) { e.stopPropagation(); await togglePin(parseInt(pinBtn.dataset.id, 10)); return; }

    // Delete
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) { e.stopPropagation(); await deleteNote(parseInt(delBtn.dataset.id, 10)); return; }

    // Edit
    const card = e.target.closest('.note-card[data-id]');
    if (card) {
      const note = state.notes.find((n) => n.id === parseInt(card.dataset.id, 10));
      if (note) openModal({ mode: 'edit', note });
    }
  });
}

function renderNoteCard(note) {
  const initials = note.creator_name
    ? note.creator_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const textColor = isLightColor(note.color) ? 'rgba(0,0,0,0.8)' : '#ffffff';

  return `
    <div class="note-card ${note.pinned ? 'note-card--pinned' : ''}"
         data-id="${note.id}"
         style="background-color:${escHtml(note.color)};color:${textColor};">
      <button class="note-card__pin" data-action="pin" data-id="${note.id}"
              title="${note.pinned ? 'Anpinnen aufheben' : 'Anpinnen'}">
        <i data-lucide="${note.pinned ? 'pin-off' : 'pin'}" style="width:12px;height:12px;"></i>
      </button>
      ${note.title ? `<div class="note-card__title">${escHtml(note.title)}</div>` : ''}
      <div class="note-card__content">${renderMarkdownLight(note.content)}</div>
      <div class="note-card__footer">
        <div class="note-card__creator">
          <span class="note-card__avatar"
                style="background-color:${escHtml(note.creator_color || '#8E8E93')}">${initials}</span>
          <span>${escHtml(note.creator_name || '')}</span>
        </div>
        <button class="note-card__delete" data-action="delete" data-id="${note.id}" title="Löschen">
          <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
        </button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------

function openModal({ mode, note = null }) {
  document.querySelector('#note-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id        = 'note-modal-overlay';
  overlay.className = 'note-modal-overlay';

  const isEdit    = mode === 'edit';
  const selColor  = isEdit ? note.color : NOTE_COLORS[0];

  overlay.innerHTML = `
    <div class="note-modal" role="dialog" aria-modal="true">
      <div class="note-modal__header">
        <h2 class="note-modal__title">${isEdit ? 'Notiz bearbeiten' : 'Neue Notiz'}</h2>
        <button class="note-modal__close" id="note-modal-close" aria-label="Schließen">
          <i data-lucide="x" style="width:16px;height:16px;"></i>
        </button>
      </div>
      <div class="note-modal__body">
        <div class="form-group">
          <label class="form-label" for="note-title">Titel (optional)</label>
          <input type="text" class="form-input" id="note-title"
                 placeholder="Kein Titel" value="${escHtml(isEdit && note.title ? note.title : '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="note-content">Inhalt *</label>
          <textarea class="form-input" id="note-content" rows="6"
                    placeholder="Notiz eingeben… (** fett **, * kursiv *, - Liste)"
                    style="resize:vertical;">${escHtml(isEdit ? note.content : '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Farbe</label>
          <div class="note-color-picker">
            ${NOTE_COLORS.map((c) => `
              <div class="note-color-swatch ${c === selColor ? 'note-color-swatch--active' : ''}"
                   data-color="${c}"
                   style="background-color:${c};border:2px solid ${c === '#FFFFFF' ? '#E5E5EA' : c};"
                   role="radio" tabindex="0" aria-label="Farbe ${c}"></div>
            `).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="allday-toggle">
            <input type="checkbox" id="note-pinned" ${isEdit && note.pinned ? 'checked' : ''}>
            <span class="allday-toggle__label">Anpinnen (erscheint auf Dashboard)</span>
          </label>
        </div>
      </div>
      <div class="note-modal__footer">
        <button class="btn btn--secondary" id="note-modal-cancel">Abbrechen</button>
        <button class="btn btn--primary" id="note-modal-save">${isEdit ? 'Speichern' : 'Erstellen'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();

  // Farb-Swatch
  overlay.querySelectorAll('.note-color-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      overlay.querySelectorAll('.note-color-swatch').forEach((s) => s.classList.remove('note-color-swatch--active'));
      sw.classList.add('note-color-swatch--active');
    });
  });

  overlay.querySelector('#note-modal-close').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('#note-modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#note-modal-save').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#note-modal-save');
    const title   = overlay.querySelector('#note-title').value.trim() || null;
    const content = overlay.querySelector('#note-content').value.trim();
    const color   = overlay.querySelector('.note-color-swatch--active')?.dataset.color || NOTE_COLORS[0];
    const pinned  = overlay.querySelector('#note-pinned').checked ? 1 : 0;

    if (!content) { window.oikos?.showToast('Inhalt ist erforderlich', 'error'); return; }

    saveBtn.disabled    = true;
    saveBtn.textContent = '…';

    try {
      if (mode === 'create') {
        const res = await api.post('/notes', { title, content, color, pinned });
        state.notes.unshift(res.data);
      } else {
        const res = await api.put(`/notes/${note.id}`, { title, content, color, pinned });
        const idx = state.notes.findIndex((n) => n.id === note.id);
        if (idx !== -1) state.notes[idx] = res.data;
        // Angepinnte nach oben sortieren
        state.notes.sort((a, b) => b.pinned - a.pinned);
      }
      overlay.remove();
      renderGrid();
      window.oikos?.showToast(mode === 'create' ? 'Notiz erstellt' : 'Notiz gespeichert', 'success');
    } catch (err) {
      window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
      saveBtn.disabled    = false;
      saveBtn.textContent = isEdit ? 'Speichern' : 'Erstellen';
    }
  });

  overlay.querySelector('#note-content').focus();
}

// --------------------------------------------------------
// Aktionen
// --------------------------------------------------------

async function togglePin(id) {
  try {
    const res  = await api.patch(`/notes/${id}/pin`, {});
    const note = state.notes.find((n) => n.id === id);
    if (note) note.pinned = res.data.pinned;
    state.notes.sort((a, b) => b.pinned - a.pinned);
    renderGrid();
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
  }
}

async function deleteNote(id) {
  if (!confirm('Notiz wirklich löschen?')) return;
  try {
    await api.delete(`/notes/${id}`);
    state.notes = state.notes.filter((n) => n.id !== id);
    renderGrid();
    window.oikos?.showToast('Notiz gelöscht', 'success');
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
  }
}

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

function isLightColor(hex) {
  if (!hex) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
