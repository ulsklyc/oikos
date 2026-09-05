/**
 * Modul: Schichtplan — persönliche Einstellungen
 * Zweck: Zwei Werte je Nutzer, die beide "wie rechnet die Statistik ueber
 *        MICH" beantworten: der Schicht-Erinnerungs-Vorlauf (Minuten vor
 *        Schichtbeginn) und die Wochenstunden, gegen die die
 *        Ueberstundenkarte misst. Eigene Datei statt in routes/schedule.js:
 *        server/services/schedule-reminders.js importiert scheduleData aus
 *        routes/schedule.js für den Sync - ein Rückimport hier hätte einen
 *        Zyklus ergeben (gleicher Grund wie routes/schedule-feed.js).
 *
 * PERSONENBEZOGEN, NICHT HAUSHALTWEIT: ein Teilzeit- und ein
 * Vollzeit-Mitglied im selben Haushalt haben unterschiedliche Sollstunden,
 * und wessen Schicht wann anfaengt, betrifft auch nur die eine Person.
 *
 * Keine Admin-Gate: beide Werte haengen an der eigenen users-Zeile, jeder
 * angemeldete Nutzer stellt nur seine eigenen ein.
 */

import express from 'express';
import * as db from '../db.js';
import { createLogger } from '../logger.js';
import { syncScheduleRemindersForUser } from '../services/schedule-reminders.js';

const log = createLogger('Schedule');
const router = express.Router();

const MAX_OFFSET_MINUTES = 24 * 60;
// 168 = Stunden einer Woche - alles darueber ist kein Sollwert mehr, sondern
// eine Falscheingabe.
const MAX_WEEKLY_HOURS = 168;

function getUserId(req) {
  const candidates = [req.authUserId, req.user?.id, req.session?.userId];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

// GET /api/v1/schedule/preferences → eigener Vorlauf + eigene Wochenstunden
// (beide null = Voreinstellung: Erinnerung aus, 40 Stunden)
router.get('/', (req, res) => {
  try {
    const row = db.get().prepare(
      'SELECT schedule_reminder_offset_minutes AS m, schedule_weekly_hours AS h FROM users WHERE id = ?'
    ).get(getUserId(req));
    res.json({ data: { reminderOffsetMinutes: row?.m ?? null, weeklyHours: row?.h ?? null } });
  } catch (err) {
    log.error('GET /schedule/preferences error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// PUT /api/v1/schedule/preferences { reminderOffsetMinutes?, weeklyHours? }
// Nur mitgeschickte Felder aendern sich - ein Aufrufer, der nur die
// Wochenstunden speichert, darf den Erinnerungs-Vorlauf nicht anfassen.
router.put('/', (req, res) => {
  try {
    const userId = getUserId(req);
    const current = db.get().prepare(
      'SELECT schedule_reminder_offset_minutes AS m, schedule_weekly_hours AS h FROM users WHERE id = ?'
    ).get(userId);

    let offsetMinutes = current?.m ?? null;
    if ('reminderOffsetMinutes' in (req.body ?? {})) {
      const raw = req.body.reminderOffsetMinutes;
      if (raw === null || raw === undefined) {
        offsetMinutes = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > MAX_OFFSET_MINUTES) {
          return res.status(400).json({ error: `reminderOffsetMinutes must be an integer between 0 and ${MAX_OFFSET_MINUTES}, or null.`, code: 400 });
        }
        offsetMinutes = n;
      }
    }

    let weeklyHours = current?.h ?? null;
    if ('weeklyHours' in (req.body ?? {})) {
      const raw = req.body.weeklyHours;
      if (raw === null || raw === undefined) {
        weeklyHours = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > MAX_WEEKLY_HOURS) {
          return res.status(400).json({ error: `weeklyHours must be an integer between 1 and ${MAX_WEEKLY_HOURS}, or null.`, code: 400 });
        }
        weeklyHours = n;
      }
    }

    db.get().prepare('UPDATE users SET schedule_reminder_offset_minutes = ?, schedule_weekly_hours = ? WHERE id = ?')
      .run(offsetMinutes, weeklyHours, userId);
    // Sofort wirksam statt erst beim naechsten periodischen Lauf - gleiche
    // Erwartung wie beim Vorrat (server/routes/pantry.js ruft die Ein-
    // Artikel-Fassung direkt nach dem Speichern).
    syncScheduleRemindersForUser(db.get(), userId);
    res.json({ data: { reminderOffsetMinutes: offsetMinutes, weeklyHours } });
  } catch (err) {
    log.error('PUT /schedule/preferences error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
