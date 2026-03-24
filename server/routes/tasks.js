/**
 * Modul: Aufgaben (Tasks)
 * Zweck: REST-API-Routen für Aufgaben und Teilaufgaben (max. 2 Ebenen)
 * Abhängigkeiten: express, server/db.js
 */

'use strict';

const express      = require('express');
const router       = express.Router();
const db           = require('../db');
const { nextOccurrence }   = require('../services/recurrence');
const v            = require('../middleware/validate');

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES   = ['open', 'in_progress', 'done'];
const VALID_CATEGORIES = ['Haushalt', 'Schule', 'Einkauf', 'Reparatur',
                          'Gesundheit', 'Finanzen', 'Freizeit', 'Sonstiges'];

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

/** Alle Subtasks einer Aufgabe laden (eine Ebene tief). */
function loadSubtasks(taskId) {
  return db.get().prepare(`
    SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.parent_task_id = ?
    ORDER BY t.created_at ASC
  `).all(taskId);
}

/** Fortschritt der Subtasks berechnen (erledigte / gesamt). */
function subtaskProgress(taskId) {
  const row = db.get().prepare(`
    SELECT
      COUNT(*)                          AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM tasks
    WHERE parent_task_id = ?
  `).get(taskId);
  return { total: row.total ?? 0, done: row.done ?? 0 };
}

/** Eingabe-Validierung für Task-Felder (zentralisiert über validate.js). */
function validateTaskInput(body, isCreate = true) {
  return v.collectErrors([
    v.str(body.title,       'title',       { required: isCreate }),
    v.str(body.description, 'description', { required: false, max: v.MAX_TEXT }),
    v.oneOf(body.priority,  VALID_PRIORITIES, 'priority'),
    v.oneOf(body.status,    VALID_STATUSES,   'status'),
    v.oneOf(body.category,  VALID_CATEGORIES, 'category'),
    v.date(body.due_date,   'due_date'),
    v.time(body.due_time,   'due_time'),
  ]);
}

// --------------------------------------------------------
// GET /api/v1/tasks
// Listet Top-Level-Aufgaben mit optionalen Filtern.
// Query-Parameter: status, priority, assigned_to, category
// Response: { data: Task[] }  (jede Task enthält subtask_progress)
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const { status, priority, assigned_to, category } = req.query;

    let sql = `
      SELECT
        t.*,
        u.display_name AS assigned_name,
        u.avatar_color AS assigned_color,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id)                           AS subtask_total,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.status = 'done')     AS subtask_done
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.parent_task_id IS NULL
    `;
    const params = [];

    if (status)      { sql += ' AND t.status = ?';      params.push(status); }
    if (priority)    { sql += ' AND t.priority = ?';    params.push(priority); }
    if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(Number(assigned_to)); }
    if (category)    { sql += ' AND t.category = ?';    params.push(category); }

    sql += `
      ORDER BY
        CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2 ELSE 3 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
    `;

    res.json({ data: db.get().prepare(sql).all(...params) });
  } catch (err) {
    console.error('[Tasks] GET / Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/:id
// Einzelne Aufgabe mit Subtasks.
// Response: { data: Task & { subtasks: Task[] } }
// --------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const task = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ? AND t.parent_task_id IS NULL
    `).get(req.params.id);

    if (!task) return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });

    task.subtasks = loadSubtasks(task.id);
    res.json({ data: task });
  } catch (err) {
    console.error('[Tasks] GET /:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/tasks
// Neue Aufgabe erstellen.
// Body: { title, description?, category?, priority?, due_date?, due_time?,
//         assigned_to?, parent_task_id? }
// Response: { data: Task }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const errors = validateTaskInput(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title,
      description   = null,
      category      = 'Sonstiges',
      priority      = 'medium',
      due_date      = null,
      due_time      = null,
      assigned_to   = null,
      parent_task_id = null,
    } = req.body;

    // Tiefe begrenzen: Subtasks dürfen keine eigenen Subtasks haben (max. 2 Ebenen)
    if (parent_task_id) {
      const parent = db.get().prepare('SELECT parent_task_id FROM tasks WHERE id = ?')
        .get(parent_task_id);
      if (!parent) return res.status(404).json({ error: 'Übergeordnete Aufgabe nicht gefunden.', code: 404 });
      if (parent.parent_task_id)
        return res.status(400).json({ error: 'Maximal 2 Verschachtelungsebenen erlaubt.', code: 400 });
    }

    const result = db.get().prepare(`
      INSERT INTO tasks
        (title, description, category, priority, due_date, due_time,
         assigned_to, created_by, parent_task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(), description, category, priority,
      due_date, due_time, assigned_to, req.session.userId, parent_task_id
    );

    const task = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: task });
  } catch (err) {
    console.error('[Tasks] POST / Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/tasks/:id
// Aufgabe vollständig aktualisieren.
// Body: { title, description?, category?, priority?, status?,
//         due_date?, due_time?, assigned_to? }
// Response: { data: Task }
// --------------------------------------------------------
router.put('/:id', (req, res) => {
  try {
    const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });

    const errors = validateTaskInput(req.body, false);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title       = task.title,
      description = task.description,
      category    = task.category,
      priority    = task.priority,
      status      = task.status,
      due_date    = task.due_date,
      due_time    = task.due_time,
      assigned_to = task.assigned_to,
    } = req.body;

    db.get().prepare(`
      UPDATE tasks SET
        title = ?, description = ?, category = ?, priority = ?,
        status = ?, due_date = ?, due_time = ?, assigned_to = ?
      WHERE id = ?
    `).run(title.trim(), description, category, priority,
           status, due_date, due_time, assigned_to, req.params.id);

    const updated = db.get().prepare(`
      SELECT t.*, u.display_name AS assigned_name, u.avatar_color AS assigned_color
      FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ?
    `).get(req.params.id);
    updated.subtasks = loadSubtasks(updated.id);

    res.json({ data: updated });
  } catch (err) {
    console.error('[Tasks] PUT /:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/tasks/:id/status
// Status einer Aufgabe schnell wechseln (z.B. Swipe-Geste / Checkbox).
// Body: { status: 'open' | 'in_progress' | 'done' }
// Response: { data: { id, status } }
// --------------------------------------------------------
router.patch('/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ error: `Ungültiger Status. Erlaubt: ${VALID_STATUSES.join(', ')}`, code: 400 });

    const result = db.get().prepare('UPDATE tasks SET status = ? WHERE id = ?')
      .run(status, req.params.id);

    if (result.changes === 0)
      return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });

    // Wiederkehrende Aufgabe: nächste Instanz erstellen wenn erledigt
    if (status === 'done') {
      const task = db.get().prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (task?.is_recurring && task.recurrence_rule && !task.parent_task_id) {
        const nextDate = nextOccurrence(task.due_date, task.recurrence_rule);
        if (nextDate) {
          db.get().prepare(`
            INSERT INTO tasks (title, description, category, priority, status,
              due_date, due_time, assigned_to, created_by, is_recurring, recurrence_rule)
            VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, 1, ?)
          `).run(
            task.title, task.description, task.category, task.priority,
            nextDate, task.due_time, task.assigned_to, task.created_by,
            task.recurrence_rule
          );
        }
      }
    }

    res.json({ data: { id: Number(req.params.id), status } });
  } catch (err) {
    console.error('[Tasks] PATCH /:id/status Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/tasks/:id
// Aufgabe löschen (Subtasks werden per CASCADE mitgelöscht).
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const result = db.get().prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Aufgabe nicht gefunden.', code: 404 });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Tasks] DELETE /:id Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/tasks/meta/options
// Liefert Filteroptionen: alle User + gültige Werte für Dropdowns.
// Response: { users, priorities, statuses, categories }
// --------------------------------------------------------
router.get('/meta/options', (req, res) => {
  try {
    const users = db.get().prepare(
      'SELECT id, display_name, avatar_color FROM users ORDER BY display_name'
    ).all();
    res.json({ users, priorities: VALID_PRIORITIES, statuses: VALID_STATUSES, categories: VALID_CATEGORIES });
  } catch (err) {
    console.error('[Tasks] GET /meta/options Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

module.exports = router;
