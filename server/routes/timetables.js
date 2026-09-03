import express from 'express';
import * as db from '../db.js';
import { color, collectErrors, id, num, oneOf, str, time } from '../middleware/validate.js';
import { createLogger } from '../logger.js';

const router = express.Router();
const log = createLogger('Timetables');

const actorId = (req) => req.authUserId || req.session?.userId;
const isAdmin = (req) => req.authRole === 'admin' || req.session?.role === 'admin';
const fail = (res, code, error) => res.status(code).json({ error, code });
const userExists = (value) => !!db.get().prepare('SELECT 1 FROM users WHERE id = ?').get(value);

const VALID_CATEGORIES = ['school', 'work', 'activity', 'other'];
const VALID_WEEK_TYPES = ['all', 'A', 'B'];
const VALID_VIEW_MODES = ['day', 'week', 'grid'];

/**
 * GET /api/v1/timetables
 * Query parameters:
 *  - user_id: filter by user ID (defaults to all or specific member)
 *  - day_of_week: 1..7 (Monday=1 .. Sunday=7)
 *  - week_type: 'all' | 'A' | 'B'
 */
router.get('/', (req, res) => {
  try {
    const database = db.get();
    let query = `
      SELECT t.*, u.display_name, u.username
      FROM timetable_entries t
      JOIN users u ON u.id = t.user_id
      WHERE 1=1
    `;
    const params = [];

    if (req.query.user_id) {
      const parsedUserId = parseInt(req.query.user_id, 10);
      if (Number.isInteger(parsedUserId) && parsedUserId > 0) {
        query += ' AND t.user_id = ?';
        params.push(parsedUserId);
      }
    }

    if (req.query.day_of_week) {
      const day = parseInt(req.query.day_of_week, 10);
      if (Number.isInteger(day) && day >= 1 && day <= 7) {
        query += ' AND t.day_of_week = ?';
        params.push(day);
      }
    }

    if (req.query.week_type && VALID_WEEK_TYPES.includes(req.query.week_type)) {
      if (req.query.week_type === 'A' || req.query.week_type === 'B') {
        query += " AND t.week_type IN ('all', ?)";
        params.push(req.query.week_type);
      } else {
        query += ' AND t.week_type = ?';
        params.push(req.query.week_type);
      }
    }

    query += ' ORDER BY t.day_of_week ASC, t.start_time ASC, t.period_number ASC';

    const rows = database.prepare(query).all(...params);
    res.json({ data: rows });
  } catch (err) {
    log.error('Failed to list timetable entries:', err);
    fail(res, 500, 'Failed to list timetable entries');
  }
});

/**
 * GET /api/v1/timetables/today
 * Returns timetable entries for today for all or selected user.
 */
router.get('/today', (req, res) => {
  try {
    const database = db.get();
    // In JavaScript Date: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    // Convert to ISO weekday (1=Monday ... 7=Sunday)
    const now = new Date();
    const jsDay = now.getDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;

    let query = `
      SELECT t.*, u.display_name, u.username
      FROM timetable_entries t
      JOIN users u ON u.id = t.user_id
      WHERE t.day_of_week = ?
    `;
    const params = [isoDay];

    if (req.query.user_id) {
      const parsedUserId = parseInt(req.query.user_id, 10);
      if (Number.isInteger(parsedUserId) && parsedUserId > 0) {
        query += ' AND t.user_id = ?';
        params.push(parsedUserId);
      }
    }

    if (req.query.week_type && (req.query.week_type === 'A' || req.query.week_type === 'B')) {
      query += " AND t.week_type IN ('all', ?)";
      params.push(req.query.week_type);
    }

    query += ' ORDER BY t.start_time ASC, t.period_number ASC';

    const rows = database.prepare(query).all(...params);
    res.json({ data: rows, day_of_week: isoDay });
  } catch (err) {
    log.error('Failed to get today timetable:', err);
    fail(res, 500, 'Failed to get today timetable');
  }
});

/**
 * GET /api/v1/timetables/settings
 */
router.get('/settings', (req, res) => {
  try {
    const database = db.get();
    const targetUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : actorId(req);
    if (!targetUserId || !Number.isInteger(targetUserId)) {
      return fail(res, 400, 'Invalid user_id');
    }

    const row = database.prepare('SELECT * FROM timetable_settings WHERE user_id = ?').get(targetUserId);
    const settings = row || {
      user_id: targetUserId,
      active_week: 'all',
      view_mode: 'week',
      show_weekends: 0,
      show_school_holidays: 1,
    };

    res.json({ settings });
  } catch (err) {
    log.error('Failed to get timetable settings:', err);
    fail(res, 500, 'Failed to get timetable settings');
  }
});

/**
 * PUT /api/v1/timetables/settings
 */
router.put('/settings', (req, res) => {
  try {
    const database = db.get();
    const targetUserId = req.body.user_id ? parseInt(req.body.user_id, 10) : actorId(req);
    if (!targetUserId || !Number.isInteger(targetUserId) || !userExists(targetUserId)) {
      return fail(res, 400, 'User not found');
    }

    const activeWeek = req.body.active_week && VALID_WEEK_TYPES.includes(req.body.active_week)
      ? req.body.active_week
      : 'all';
    const viewMode = req.body.view_mode && VALID_VIEW_MODES.includes(req.body.view_mode)
      ? req.body.view_mode
      : 'week';
    const showWeekends = req.body.show_weekends ? 1 : 0;
    const showSchoolHolidays = req.body.show_school_holidays !== undefined
      ? (req.body.show_school_holidays ? 1 : 0)
      : 1;

    database.prepare(`
      INSERT INTO timetable_settings (user_id, active_week, view_mode, show_weekends, show_school_holidays, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ON CONFLICT(user_id) DO UPDATE SET
        active_week = excluded.active_week,
        view_mode = excluded.view_mode,
        show_weekends = excluded.show_weekends,
        show_school_holidays = excluded.show_school_holidays,
        updated_at = excluded.updated_at
    `).run(targetUserId, activeWeek, viewMode, showWeekends, showSchoolHolidays);

    const saved = database.prepare('SELECT * FROM timetable_settings WHERE user_id = ?').get(targetUserId);
    res.json({ settings: saved });
  } catch (err) {
    log.error('Failed to update timetable settings:', err);
    fail(res, 500, 'Failed to update timetable settings');
  }
});

/**
 * POST /api/v1/timetables
 */
router.post('/', (req, res) => {
  try {
    const database = db.get();
    const currentActor = actorId(req);
    const targetUserId = req.body.user_id ? parseInt(req.body.user_id, 10) : currentActor;

    if (!targetUserId || !Number.isInteger(targetUserId) || !userExists(targetUserId)) {
      return fail(res, 400, 'Valid user_id is required');
    }

    const vSubject = str(req.body.subject, 'subject', { required: true, max: 200 });
    const vRoom = str(req.body.room, 'room', { required: false, max: 100 });
    const vInstructor = str(req.body.instructor, 'instructor', { required: false, max: 100 });
    const vColor = color(req.body.color, 'color', false);
    const vNotes = str(req.body.notes, 'notes', { required: false, max: 1000 });
    const vStart = time(req.body.start_time, 'start_time', true);
    const vEnd = time(req.body.end_time, 'end_time', true);
    const vCategory = oneOf(req.body.category || 'school', VALID_CATEGORIES, 'category');
    const vWeekType = oneOf(req.body.week_type || 'all', VALID_WEEK_TYPES, 'week_type');

    const errors = collectErrors([vSubject, vRoom, vInstructor, vColor, vNotes, vStart, vEnd, vCategory, vWeekType]);

    const dayOfWeek = parseInt(req.body.day_of_week, 10);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      errors.push('day_of_week must be an integer between 1 and 7 (1=Monday, 7=Sunday)');
    }

    const periodNumber = req.body.period_number !== undefined && req.body.period_number !== null && req.body.period_number !== ''
      ? parseInt(req.body.period_number, 10)
      : null;
    if (periodNumber !== null && (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 30)) {
      errors.push('period_number must be an integer between 1 and 30');
    }

    if (vStart.value && vEnd.value && vStart.value >= vEnd.value) {
      errors.push('end_time must be after start_time');
    }

    if (errors.length > 0) {
      return fail(res, 400, errors.join(' '));
    }

    const stmt = database.prepare(`
      INSERT INTO timetable_entries (
        user_id, day_of_week, start_time, end_time, subject,
        room, instructor, color, category, week_type,
        period_number, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      targetUserId,
      dayOfWeek,
      vStart.value,
      vEnd.value,
      vSubject.value,
      vRoom.value || null,
      vInstructor.value || null,
      vColor.value || null,
      vCategory.value || 'school',
      vWeekType.value || 'all',
      periodNumber,
      vNotes.value || null,
    );

    const created = database.prepare(`
      SELECT t.*, u.display_name, u.username
      FROM timetable_entries t
      JOIN users u ON u.id = t.user_id
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: created });
  } catch (err) {
    log.error('Failed to create timetable entry:', err);
    fail(res, 500, 'Failed to create timetable entry');
  }
});

/**
 * GET /api/v1/timetables/:id
 */
router.get('/:id', (req, res) => {
  try {
    const entryId = parseInt(req.params.id, 10);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return fail(res, 400, 'Invalid id');
    }

    const entry = db.get().prepare(`
      SELECT t.*, u.display_name, u.username
      FROM timetable_entries t
      JOIN users u ON u.id = t.user_id
      WHERE t.id = ?
    `).get(entryId);

    if (!entry) {
      return fail(res, 404, 'Timetable entry not found');
    }

    res.json({ data: entry });
  } catch (err) {
    log.error('Failed to get timetable entry:', err);
    fail(res, 500, 'Failed to get timetable entry');
  }
});

/**
 * PUT /api/v1/timetables/:id
 */
router.put('/:id', (req, res) => {
  try {
    const database = db.get();
    const entryId = parseInt(req.params.id, 10);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return fail(res, 400, 'Invalid id');
    }

    const existing = database.prepare('SELECT * FROM timetable_entries WHERE id = ?').get(entryId);
    if (!existing) {
      return fail(res, 404, 'Timetable entry not found');
    }

    const targetUserId = req.body.user_id ? parseInt(req.body.user_id, 10) : existing.user_id;
    if (!userExists(targetUserId)) {
      return fail(res, 400, 'User not found');
    }

    const vSubject = str(req.body.subject, 'subject', { required: true, max: 200 });
    const vRoom = str(req.body.room, 'room', { required: false, max: 100 });
    const vInstructor = str(req.body.instructor, 'instructor', { required: false, max: 100 });
    const vColor = color(req.body.color, 'color', false);
    const vNotes = str(req.body.notes, 'notes', { required: false, max: 1000 });
    const vStart = time(req.body.start_time, 'start_time', true);
    const vEnd = time(req.body.end_time, 'end_time', true);
    const vCategory = oneOf(req.body.category || existing.category, VALID_CATEGORIES, 'category');
    const vWeekType = oneOf(req.body.week_type || existing.week_type, VALID_WEEK_TYPES, 'week_type');

    const errors = collectErrors([vSubject, vRoom, vInstructor, vColor, vNotes, vStart, vEnd, vCategory, vWeekType]);

    const dayOfWeek = req.body.day_of_week !== undefined
      ? parseInt(req.body.day_of_week, 10)
      : existing.day_of_week;

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      errors.push('day_of_week must be an integer between 1 and 7');
    }

    const periodNumber = req.body.period_number !== undefined
      ? (req.body.period_number === null || req.body.period_number === '' ? null : parseInt(req.body.period_number, 10))
      : existing.period_number;

    if (periodNumber !== null && (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 30)) {
      errors.push('period_number must be an integer between 1 and 30');
    }

    if (vStart.value && vEnd.value && vStart.value >= vEnd.value) {
      errors.push('end_time must be after start_time');
    }

    if (errors.length > 0) {
      return fail(res, 400, errors.join(' '));
    }

    database.prepare(`
      UPDATE timetable_entries SET
        user_id = ?,
        day_of_week = ?,
        start_time = ?,
        end_time = ?,
        subject = ?,
        room = ?,
        instructor = ?,
        color = ?,
        category = ?,
        week_type = ?,
        period_number = ?,
        notes = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(
      targetUserId,
      dayOfWeek,
      vStart.value,
      vEnd.value,
      vSubject.value,
      vRoom.value || null,
      vInstructor.value || null,
      vColor.value || null,
      vCategory.value || 'school',
      vWeekType.value || 'all',
      periodNumber,
      vNotes.value || null,
      entryId,
    );

    const updated = database.prepare(`
      SELECT t.*, u.display_name, u.username
      FROM timetable_entries t
      JOIN users u ON u.id = t.user_id
      WHERE t.id = ?
    `).get(entryId);

    res.json({ data: updated });
  } catch (err) {
    log.error('Failed to update timetable entry:', err);
    fail(res, 500, 'Failed to update timetable entry');
  }
});

/**
 * DELETE /api/v1/timetables/:id
 */
router.delete('/:id', (req, res) => {
  try {
    const entryId = parseInt(req.params.id, 10);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return fail(res, 400, 'Invalid id');
    }

    const result = db.get().prepare('DELETE FROM timetable_entries WHERE id = ?').run(entryId);
    if (result.changes === 0) {
      return fail(res, 404, 'Timetable entry not found');
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('Failed to delete timetable entry:', err);
    fail(res, 500, 'Failed to delete timetable entry');
  }
});

/**
 * POST /api/v1/timetables/copy
 * Copy all timetable entries from one user to another.
 */
router.post('/copy', (req, res) => {
  try {
    const database = db.get();
    const fromUserId = parseInt(req.body.from_user_id, 10);
    const toUserId = parseInt(req.body.to_user_id, 10);

    if (!fromUserId || !userExists(fromUserId)) {
      return fail(res, 400, 'Source user not found');
    }
    if (!toUserId || !userExists(toUserId)) {
      return fail(res, 400, 'Target user not found');
    }
    if (fromUserId === toUserId) {
      return fail(res, 400, 'Cannot copy to the same user');
    }

    const sourceEntries = database.prepare('SELECT * FROM timetable_entries WHERE user_id = ?').all(fromUserId);
    if (sourceEntries.length === 0) {
      return res.json({ count: 0 });
    }

    const insertStmt = database.prepare(`
      INSERT INTO timetable_entries (
        user_id, day_of_week, start_time, end_time, subject,
        room, instructor, color, category, week_type,
        period_number, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    const runTransaction = database.transaction(() => {
      for (const entry of sourceEntries) {
        insertStmt.run(
          toUserId,
          entry.day_of_week,
          entry.start_time,
          entry.end_time,
          entry.subject,
          entry.room,
          entry.instructor,
          entry.color,
          entry.category,
          entry.week_type,
          entry.period_number,
          entry.notes,
        );
        count++;
      }
    });

    runTransaction();
    res.json({ count });
  } catch (err) {
    log.error('Failed to copy timetable entries:', err);
    fail(res, 500, 'Failed to copy timetable entries');
  }
});

export default router;
