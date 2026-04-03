/**
 * Modul: Kalender (Calendar)
 * Zweck: REST-API-Routen für Kalendereinträge (lokale Termine)
 *        Externe Sync (Google/Apple) folgt in Phase 3, Schritte 14–15.
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

'use strict';

const express        = require('express');
const router         = express.Router();
const db             = require('../db');
const googleCalendar = require('../services/google-calendar');
const appleCalendar  = require('../services/apple-calendar');
const { requireAdmin } = require('../auth');
const { str, color, datetime, rrule, collectErrors, MAX_TITLE, MAX_TEXT, DATE_RE, DATETIME_RE } = require('../middleware/validate');

const { nextOccurrence } = require('../services/recurrence');

const VALID_SOURCES = ['local', 'google', 'apple'];

// --------------------------------------------------------
// RRULE-Expansion: alle Vorkommen eines wiederkehrenden Events
// innerhalb [from, to] generieren (inklusive beider Grenzen).
// --------------------------------------------------------

/**
 * @param {object[]} events  Rohe DB-Events (können recurrence_rule haben)
 * @param {string}   from    YYYY-MM-DD
 * @param {string}   to      YYYY-MM-DD
 * @returns {object[]}  Expandiertes, sortiertes Array
 */
function expandRecurringEvents(events, from, to) {
  const result = [];

  for (const event of events) {
    if (!event.recurrence_rule) {
      result.push(event);
      continue;
    }

    // Dauer des Events in ms (für End-Zeit-Berechnung der Instanzen)
    const startMs    = new Date(event.start_datetime).getTime();
    const endMs      = event.end_datetime ? new Date(event.end_datetime).getTime() : null;
    const durationMs = endMs !== null ? endMs - startMs : null;
    // Duration in days for all-day events (for date-only end calculation)
    const isAllDay     = !!event.all_day;
    const durationDays = isAllDay && durationMs !== null ? Math.round(durationMs / 86400000) : 0;

    // Original-Zeit-Teil erhalten (z.B. 'T14:30:00' oder '' bei All-Day)
    const timeSuffix = event.start_datetime.slice(10);

    let currentDate = event.start_datetime.slice(0, 10); // YYYY-MM-DD
    let iterations  = 0;
    const MAX_ITER  = 1000; // Sicherheitsgrenze

    while (currentDate <= to && iterations < MAX_ITER) {
      iterations++;

      // For multi-day events, check if the instance end reaches into [from, to]
      let instanceEnd = currentDate;
      if (isAllDay && durationDays > 0) {
        const d = new Date(currentDate + 'T00:00:00');
        d.setDate(d.getDate() + durationDays);
        instanceEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      if (currentDate >= from || instanceEnd >= from) {
        const newStart = currentDate + timeSuffix;
        let newEnd = event.end_datetime;
        if (durationMs !== null) {
          if (isAllDay) {
            // Keep date-only format for all-day events
            const d = new Date(currentDate + 'T00:00:00');
            d.setDate(d.getDate() + durationDays);
            newEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } else {
            newEnd = new Date(new Date(newStart).getTime() + durationMs)
              .toISOString()
              .replace('.000Z', 'Z');
          }
        }

        result.push({
          ...event,
          start_datetime:       newStart,
          end_datetime:         newEnd,
          is_recurring_instance: currentDate !== event.start_datetime.slice(0, 10) ? 1 : 0,
        });
      }

      const next = nextOccurrence(currentDate, event.recurrence_rule);
      if (!next || next <= currentDate) break;
      currentDate = next;
    }
  }

  return result.sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}

// --------------------------------------------------------
// GET /api/v1/calendar
// Termine in einem Datumsbereich abrufen.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD  (default: aktueller Monat)
//        &assigned_to=<userId>  (optional Filter)
//        &source=local|google|apple  (optional Filter)
// Response: { data: Event[], from, to }
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const year  = today.slice(0, 4);
    const month = today.slice(5, 7);

    const from = req.query.from || `${year}-${month}-01`;
    const to   = req.query.to   || `${year}-${month}-31`;

    if (!DATE_RE.test(from) || !DATE_RE.test(to))
      return res.status(400).json({ error: 'from/to müssen YYYY-MM-DD sein', code: 400 });

    let sql = `
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE (
        (e.recurrence_rule IS NULL AND
          DATE(e.start_datetime) <= ? AND
          (e.end_datetime IS NULL OR DATE(e.end_datetime) >= ?))
        OR
        (e.recurrence_rule IS NOT NULL AND DATE(e.start_datetime) <= ?)
      )
    `;
    const params = [to, from, to];

    if (req.query.assigned_to) {
      sql += ' AND e.assigned_to = ?';
      params.push(parseInt(req.query.assigned_to, 10));
    }

    if (req.query.source && VALID_SOURCES.includes(req.query.source)) {
      sql += ' AND e.external_source = ?';
      params.push(req.query.source);
    }

    sql += ' ORDER BY e.start_datetime ASC, e.all_day DESC';

    const rawEvents = db.get().prepare(sql).all(...params);
    const events    = expandRecurringEvents(rawEvents, from, to);
    res.json({ data: events, from, to });
  } catch (err) {
    console.error('[calendar/GET /]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/calendar/upcoming
// Nächste N Termine ab jetzt (für Dashboard-Widget).
// Query: ?limit=5
// Response: { data: Event[] }
// --------------------------------------------------------
router.get('/upcoming', (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const nowDate = new Date().toISOString().slice(0, 10);
    // Fenster: heute bis 90 Tage voraus (für Wiederholungs-Expansion)
    const future  = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rawEvents = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      WHERE (
        (e.recurrence_rule IS NULL AND DATE(e.start_datetime) BETWEEN ? AND ?)
        OR
        (e.recurrence_rule IS NOT NULL AND DATE(e.start_datetime) <= ?)
      )
      ORDER BY e.start_datetime ASC
    `).all(nowDate, future, future);

    const expanded = expandRecurringEvents(rawEvents, nowDate, future)
      .filter((e) => e.start_datetime >= new Date().toISOString())
      .slice(0, limit);

    res.json({ data: expanded });
  } catch (err) {
    console.error('[calendar/GET /upcoming]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// Google Calendar Sync-Routen
// Alle vor /:id registriert, um Konflikte zu vermeiden.
// --------------------------------------------------------

/**
 * GET /api/v1/calendar/google/auth
 * Admin only. Leitet zum Google OAuth-Consent-Screen weiter.
 */
router.get('/google/auth', requireAdmin, (req, res) => {
  try {
    const url = googleCalendar.getAuthUrl();
    if (!url) return res.status(503).json({ error: 'Google nicht konfiguriert.', code: 503 });
    res.redirect(url);
  } catch (err) {
    console.error('[calendar/google/auth]', err);
    res.status(503).json({ error: err.message, code: 503 });
  }
});

/**
 * GET /api/v1/calendar/google/callback
 * OAuth-Callback von Google. Tauscht Code gegen Tokens und startet initialen Sync.
 * Query: ?code=...
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) return res.redirect('/settings?sync_error=google');
    if (!code)  return res.status(400).json({ error: 'Kein Code erhalten.', code: 400 });

    await googleCalendar.handleCallback(code);

    // Initialen Sync im Hintergrund starten (kein await — Redirect soll sofort erfolgen)
    googleCalendar.sync().catch((e) => console.error('[Google] Initialer Sync fehlgeschlagen:', e.message));

    res.redirect('/settings?sync_ok=google');
  } catch (err) {
    console.error('[calendar/google/callback]', err);
    res.redirect('/settings?sync_error=google');
  }
});

/**
 * POST /api/v1/calendar/google/sync
 * Manueller Sync-Trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/google/sync', async (req, res) => {
  try {
    await googleCalendar.sync();
    const { lastSync } = googleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    console.error('[calendar/google/sync]', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

/**
 * GET /api/v1/calendar/google/status
 * Response: { configured, connected, lastSync }
 */
router.get('/google/status', (req, res) => {
  try {
    res.json(googleCalendar.getStatus());
  } catch (err) {
    console.error('[calendar/google/status]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * DELETE /api/v1/calendar/google/disconnect
 * Admin only. Tokens löschen und Verbindung trennen.
 * Response: { ok: true }
 */
router.delete('/google/disconnect', requireAdmin, (req, res) => {
  try {
    googleCalendar.disconnect();
    res.json({ ok: true });
  } catch (err) {
    console.error('[calendar/google/disconnect]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// Apple Calendar Sync-Routen
// --------------------------------------------------------

/**
 * GET /api/v1/calendar/apple/status
 * Response: { configured, lastSync }
 */
router.get('/apple/status', (req, res) => {
  try {
    res.json(appleCalendar.getStatus());
  } catch (err) {
    console.error('[calendar/apple/status]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

/**
 * POST /api/v1/calendar/apple/sync
 * Manueller Sync-Trigger.
 * Response: { ok: true, lastSync: string }
 */
router.post('/apple/sync', async (req, res) => {
  try {
    await appleCalendar.sync();
    const { lastSync } = appleCalendar.getStatus();
    res.json({ ok: true, lastSync });
  } catch (err) {
    console.error('[calendar/apple/sync]', err);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

/**
 * POST /api/v1/calendar/apple/connect
 * Apple-CalDAV-Credentials speichern und Verbindung testen.
 * Body: { url, username, password }
 * Response: { ok: true, calendarCount: number }
 */
router.post('/apple/connect', requireAdmin, async (req, res) => {
  const { url, username, password } = req.body;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'url muss eine gültige HTTP(S)-URL sein.', code: 400 });
  }
  if (!username || typeof username !== 'string' || username.length > 254) {
    return res.status(400).json({ error: 'username fehlt oder ungültig.', code: 400 });
  }
  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ error: 'password fehlt.', code: 400 });
  }

  try {
    // Zuerst temporär setzen, damit testConnection() sie findet
    appleCalendar.saveCredentials(url.trim(), username.trim(), password);
    const result = await appleCalendar.testConnection();
    res.json({ ok: true, calendarCount: result.calendarCount });
  } catch (err) {
    // Bei Fehler: gespeicherte Credentials wieder löschen
    appleCalendar.clearCredentials();
    console.error('[calendar/apple/connect]', err);
    res.status(400).json({ error: err.message.replace('[Apple] ', ''), code: 400 });
  }
});

/**
 * DELETE /api/v1/calendar/apple/disconnect
 * Apple-CalDAV-Credentials löschen.
 * Response: 204
 */
router.delete('/apple/disconnect', requireAdmin, (req, res) => {
  try {
    appleCalendar.clearCredentials();
    res.status(204).end();
  } catch (err) {
    console.error('[calendar/apple/disconnect]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/calendar/:id
// Einzelnen Termin abrufen.
// Response: { data: Event }
// --------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const event = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE e.id = ?
    `).get(id);

    if (!event) return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });
    res.json({ data: event });
  } catch (err) {
    console.error('[calendar/GET /:id]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/calendar
// Neuen Termin anlegen.
// Body: { title, description?, start_datetime, end_datetime?,
//         all_day?, location?, color?, assigned_to?,
//         recurrence_rule? }
// Response: { data: Event }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const vTitle = str(req.body.title, 'Titel', { max: MAX_TITLE });
    const vDesc  = str(req.body.description, 'Beschreibung', { max: MAX_TEXT, required: false });
    const vStart = datetime(req.body.start_datetime, 'Startdatum', true);
    const vEnd   = datetime(req.body.end_datetime, 'Enddatum');
    const vColor = color(req.body.color || '#007AFF', 'Farbe');
    const vLoc   = str(req.body.location, 'Ort', { max: MAX_TITLE, required: false });
    const vRrule = rrule(req.body.recurrence_rule, 'Wiederholung');
    const errors = collectErrors([vTitle, vDesc, vStart, vEnd, vColor, vLoc, vRrule]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const { all_day = 0, assigned_to = null } = req.body;

    if (assigned_to) {
      const user = db.get().prepare('SELECT id FROM users WHERE id = ?').get(assigned_to);
      if (!user) return res.status(400).json({ error: 'assigned_to: Benutzer nicht gefunden', code: 400 });
    }

    const result = db.get().prepare(`
      INSERT INTO calendar_events
        (title, description, start_datetime, end_datetime, all_day,
         location, color, assigned_to, created_by, recurrence_rule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vTitle.value, vDesc.value,
      vStart.value, vEnd.value,
      all_day ? 1 : 0, vLoc.value,
      vColor.value, assigned_to || null,
      req.session.userId, vRrule.value
    );

    const event = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ data: event });
  } catch (err) {
    console.error('[calendar/POST /]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/calendar/:id
// Termin vollständig aktualisieren.
// Body: alle Felder optional außer title + start_datetime
// Response: { data: Event }
// --------------------------------------------------------
router.put('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const event = db.get().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    if (!event) return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });

    const checks = [];
    if (req.body.title          !== undefined) checks.push(str(req.body.title, 'Titel', { max: MAX_TITLE, required: false }));
    if (req.body.description    !== undefined) checks.push(str(req.body.description, 'Beschreibung', { max: MAX_TEXT, required: false }));
    if (req.body.start_datetime !== undefined) checks.push(datetime(req.body.start_datetime, 'Startdatum'));
    if (req.body.end_datetime   !== undefined) checks.push(datetime(req.body.end_datetime, 'Enddatum'));
    if (req.body.color          !== undefined) checks.push(color(req.body.color, 'Farbe'));
    if (req.body.location       !== undefined) checks.push(str(req.body.location, 'Ort', { max: MAX_TITLE, required: false }));
    if (req.body.recurrence_rule !== undefined) checks.push(rrule(req.body.recurrence_rule, 'Wiederholung'));
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const {
      title, description, start_datetime, end_datetime,
      all_day, location, color: colorVal, assigned_to, recurrence_rule,
    } = req.body;

    db.get().prepare(`
      UPDATE calendar_events
      SET title           = COALESCE(?, title),
          description     = ?,
          start_datetime  = COALESCE(?, start_datetime),
          end_datetime    = ?,
          all_day         = COALESCE(?, all_day),
          location        = ?,
          color           = COALESCE(?, color),
          assigned_to     = ?,
          recurrence_rule = ?
      WHERE id = ?
    `).run(
      title?.trim()  ?? null,
      description !== undefined ? (description || null) : event.description,
      start_datetime ?? null,
      end_datetime !== undefined ? (end_datetime || null) : event.end_datetime,
      all_day !== undefined ? (all_day ? 1 : 0) : null,
      location !== undefined ? (location || null) : event.location,
      colorVal ?? null,
      assigned_to !== undefined ? (assigned_to || null) : event.assigned_to,
      recurrence_rule !== undefined ? (recurrence_rule || null) : event.recurrence_rule,
      id
    );

    const updated = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      WHERE e.id = ?
    `).get(id);

    res.json({ data: updated });
  } catch (err) {
    console.error('[calendar/PUT /:id]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/calendar/:id
// Termin löschen.
// Response: 204 No Content
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const result = db.get().prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });
    res.status(204).end();
  } catch (err) {
    console.error('[calendar/DELETE /:id]', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

module.exports = router;
