/**
 * Modul: Pinnwand / Notizen (Notes)
 * Zweck: Masonry-Grid mit farbigen Sticky Notes, Pin-Toggle, CRUD
 * Abhängigkeiten: /api.js, /router.js (window.oikos)
 */

import { api } from '/api.js';
import { openModal as openSharedModal, closeModal } from '/components/modal.js';
import { stagger, vibrate } from '/utils/ux.js';

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
        <h1 class="notes-toolbar__title">Pinnwand</h1>
        <button class="btn btn--primary" id="notes-add-btn">
          <i data-lucide="plus" style="width:16px;height:16px;margin-right:4px;" aria-hidden="true"></i>
          Neue Notiz
        </button>
      </div>
      <div id="notes-grid" class="notes-grid"></div>
      <button class="page-fab" id="fab-new-note" aria-label="Neue Notiz">
        <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
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

  const addHandler = () => openNoteModal({ mode: 'create' });
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
      <div class="empty-state" style="column-span:all;">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <div class="empty-state__title">Noch keine Notizen</div>
        <div class="empty-state__description">Neue Notiz über den + Button erstellen.</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  grid.innerHTML = state.notes.map((n) => renderNoteCard(n)).join('');
  if (window.lucide) lucide.createIcons();
  stagger(grid.querySelectorAll('.note-card'));

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
      if (note) openNoteModal({ mode: 'edit', note });
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
              aria-label="${note.pinned ? 'Anpinnen aufheben' : 'Anpinnen'}">
        <i data-lucide="${note.pinned ? 'pin-off' : 'pin'}" style="width:12px;height:12px;" aria-hidden="true"></i>
      </button>
      ${note.title ? `<div class="note-card__title">${escHtml(note.title)}</div>` : ''}
      <div class="note-card__content">${renderMarkdownLight(note.content)}</div>
      <div class="note-card__footer">
        <div class="note-card__creator">
          <span class="note-card__avatar"
                style="background-color:${escHtml(note.creator_color || '#8E8E93')}">${initials}</span>
          <span>${escHtml(note.creator_name || '')}</span>
        </div>
        <button class="note-card__delete" data-action="delete" data-id="${note.id}" aria-label="Notiz löschen">
          <i data-lucide="trash-2" style="width:12px;height:12px;" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Formatierungs-Helfer
// --------------------------------------------------------

function applyFormat(textarea, format) {
  const start = textarea.selectionStart;
  const end   = textarea.selectionEnd;
  const text  = textarea.value;
  const sel   = text.slice(start, end);

  let before, after, insert;
  switch (format) {
    case 'bold':
      before = '**'; after = '**';
      insert = sel || 'Text';
      break;
    case 'italic':
      before = '*'; after = '*';
      insert = sel || 'Text';
      break;
    case 'underline':
      before = '<u>'; after = '</u>';
      insert = sel || 'Text';
      break;
    case 'strikethrough':
      before = '~~'; after = '~~';
      insert = sel || 'Text';
      break;
    case 'code':
      before = '`'; after = '`';
      insert = sel || 'Code';
      break;
    case 'link':
      if (sel) {
        textarea.setRangeText(`[${sel}](url)`, start, end, 'select');
        textarea.selectionStart = start + sel.length + 3;
        textarea.selectionEnd   = start + sel.length + 6;
      } else {
        textarea.setRangeText('[Linktext](url)', start, end, 'select');
        textarea.selectionStart = start + 1;
        textarea.selectionEnd   = start + 9;
      }
      return;
    case 'heading': {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const lineEnd   = text.indexOf('\n', start);
      const line      = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const match     = line.match(/^(#{1,3})\s/);
      if (match && match[1].length < 3) {
        textarea.setRangeText('#' + line, lineStart, lineEnd === -1 ? text.length : lineEnd, 'end');
      } else if (match && match[1].length >= 3) {
        textarea.setRangeText(line.replace(/^#{1,3}\s/, ''), lineStart, lineEnd === -1 ? text.length : lineEnd, 'end');
      } else {
        textarea.setRangeText('## ' + line, lineStart, lineEnd === -1 ? text.length : lineEnd, 'end');
      }
      return;
    }
    case 'list': {
      if (sel) {
        const lines = sel.split('\n').map((l) => l.startsWith('- ') ? l : `- ${l}`);
        textarea.setRangeText(lines.join('\n'), start, end, 'end');
        return;
      }
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const currentLine = text.slice(lineStart, start);
      if (currentLine.trim() === '') {
        textarea.setRangeText('- ', start, start, 'end');
      } else {
        textarea.setRangeText('\n- ', start, start, 'end');
      }
      return;
    }
    case 'ordered-list': {
      if (sel) {
        const lines = sel.split('\n').map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s/, '')}`);
        textarea.setRangeText(lines.join('\n'), start, end, 'end');
        return;
      }
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const currentLine = text.slice(lineStart, start);
      if (currentLine.trim() === '') {
        textarea.setRangeText('1. ', start, start, 'end');
      } else {
        textarea.setRangeText('\n1. ', start, start, 'end');
      }
      return;
    }
    case 'checklist': {
      if (sel) {
        const lines = sel.split('\n').map((l) => l.startsWith('- [ ] ') ? l : `- [ ] ${l}`);
        textarea.setRangeText(lines.join('\n'), start, end, 'end');
        return;
      }
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const currentLine = text.slice(lineStart, start);
      if (currentLine.trim() === '') {
        textarea.setRangeText('- [ ] ', start, start, 'end');
      } else {
        textarea.setRangeText('\n- [ ] ', start, start, 'end');
      }
      return;
    }
    case 'quote': {
      if (sel) {
        const lines = sel.split('\n').map((l) => l.startsWith('> ') ? l : `> ${l}`);
        textarea.setRangeText(lines.join('\n'), start, end, 'end');
        return;
      }
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const currentLine = text.slice(lineStart, start);
      if (currentLine.trim() === '') {
        textarea.setRangeText('> ', start, start, 'end');
      } else {
        textarea.setRangeText('\n> ', start, start, 'end');
      }
      return;
    }
    case 'divider':
      textarea.setRangeText('\n\n---\n\n', start, end, 'end');
      return;
    default: return;
  }

  const replacement = `${before}${insert}${after}`;
  textarea.setRangeText(replacement, start, end, 'select');
  // Selektion auf den eingefügten Text setzen (ohne Marker)
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd   = start + before.length + insert.length;
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------

function openNoteModal({ mode, note = null }) {
  const isEdit    = mode === 'edit';
  const selColor  = isEdit ? note.color : NOTE_COLORS[0];

  const content = `
    <div class="form-group">
      <label class="form-label" for="note-title">Titel (optional)</label>
      <input type="text" class="form-input" id="note-title"
             placeholder="Kein Titel" value="${escHtml(isEdit && note.title ? note.title : '')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="note-content">Inhalt <span style="font-weight:400;color:var(--text-tertiary);font-size:.85em;">(Markdown-Formatierung möglich)</span></label>
      <div class="note-format-toolbar">
        <button type="button" class="note-format-btn" data-format="bold" title="Fett (Strg+B)">
          <i data-lucide="bold" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="italic" title="Kursiv (Strg+I)">
          <i data-lucide="italic" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="underline" title="Unterstrichen (Strg+U)">
          <i data-lucide="underline" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="strikethrough" title="Durchgestrichen">
          <i data-lucide="strikethrough" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <span class="note-format-btn--sep"></span>
        <button type="button" class="note-format-btn" data-format="heading" title="Überschrift">
          <i data-lucide="heading" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="list" title="Aufzählung">
          <i data-lucide="list" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="ordered-list" title="Nummerierte Liste">
          <i data-lucide="list-ordered" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="checklist" title="Checkliste">
          <i data-lucide="list-checks" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <span class="note-format-btn--sep"></span>
        <button type="button" class="note-format-btn" data-format="link" title="Link">
          <i data-lucide="link" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="code" title="Code">
          <i data-lucide="code" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="quote" title="Zitat">
          <i data-lucide="quote" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
        <button type="button" class="note-format-btn" data-format="divider" title="Trennlinie">
          <i data-lucide="minus" style="width:14px;height:14px;" aria-hidden="true"></i>
        </button>
      </div>
      <textarea class="form-input" id="note-content" rows="6"
                placeholder="Notiz eingeben…"
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

    <div class="modal-panel__footer" style="border:none;padding:0;margin-top:var(--space-4)">
      <button class="btn btn--secondary" id="note-modal-cancel">Abbrechen</button>
      <button class="btn btn--primary" id="note-modal-save">${isEdit ? 'Speichern' : 'Erstellen'}</button>
    </div>`;

  openSharedModal({
    title: isEdit ? 'Notiz bearbeiten' : 'Neue Notiz',
    content,
    size: 'md',
    onSave(panel) {
      // Farb-Swatch
      panel.querySelectorAll('.note-color-swatch').forEach((sw) => {
        sw.addEventListener('click', () => {
          panel.querySelectorAll('.note-color-swatch').forEach((s) => s.classList.remove('note-color-swatch--active'));
          sw.classList.add('note-color-swatch--active');
        });
      });

      // Formatierungs-Toolbar
      const textarea = panel.querySelector('#note-content');
      panel.querySelectorAll('.note-format-btn[data-format]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyFormat(textarea, btn.dataset.format);
          textarea.focus();
        });
      });

      textarea.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
          if (e.key === 'b') { e.preventDefault(); applyFormat(textarea, 'bold'); }
          if (e.key === 'i') { e.preventDefault(); applyFormat(textarea, 'italic'); }
          if (e.key === 'u') { e.preventDefault(); applyFormat(textarea, 'underline'); }
        }
      });

      panel.querySelector('#note-modal-cancel').addEventListener('click', closeModal);

      panel.querySelector('#note-modal-save').addEventListener('click', async () => {
        const saveBtn = panel.querySelector('#note-modal-save');
        const title   = panel.querySelector('#note-title').value.trim() || null;
        const cnt     = panel.querySelector('#note-content').value.trim();
        const color   = panel.querySelector('.note-color-swatch--active')?.dataset.color || NOTE_COLORS[0];
        const pinned  = panel.querySelector('#note-pinned').checked ? 1 : 0;

        if (!cnt) { window.oikos?.showToast('Inhalt ist erforderlich', 'error'); return; }

        saveBtn.disabled    = true;
        saveBtn.textContent = '…';

        try {
          if (mode === 'create') {
            const res = await api.post('/notes', { title, content: cnt, color, pinned });
            state.notes.unshift(res.data);
          } else {
            const res = await api.put(`/notes/${note.id}`, { title, content: cnt, color, pinned });
            const idx = state.notes.findIndex((n) => n.id === note.id);
            if (idx !== -1) state.notes[idx] = res.data;
            state.notes.sort((a, b) => b.pinned - a.pinned);
          }
          closeModal();
          renderGrid();
          window.oikos?.showToast(mode === 'create' ? 'Notiz erstellt' : 'Notiz gespeichert', 'success');
        } catch (err) {
          window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
          saveBtn.disabled    = false;
          saveBtn.textContent = isEdit ? 'Speichern' : 'Erstellen';
        }
      });
    },
  });
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
    vibrate([30, 50, 30]);
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
