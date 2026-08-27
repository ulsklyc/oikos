/**
 * Modul: Kalender (Calendar) - Termin-CRUD (lokale Events)
 * GET /:id, POST /, PUT /:id, POST /:id/reset, POST /:id/exceptions, DELETE /:id.
 */

import { createLogger } from '../../logger.js';
import express from 'express';
import * as db from '../../db.js';
import { str, color, datetime, rrule, collectErrors, MAX_TITLE, MAX_TEXT, DATE_RE } from '../../middleware/validate.js';
import { normalizeVisibility, visibilityWhere } from '../../services/visibility.js';
import {
  StorageError,
  cleanupStagedUpload,
  stageDocumentUpload,
} from '../../services/document-storage.js';
import { queueEventDeletion, markEventOutbound, flushOutbound } from '../../services/calendar-outbound.js';
import {
  ASSIGNED_USERS_SQL,
  getUserId,
  isAdminUser,
  eventIcon,
  parseAttachment,
  caldavTarget,
  googleTarget,
  outlookTarget,
  createAttachmentDocument,
  parseAssignedTo,
  setEventAssignments,
  serializeEvent,
  sendStorageError,
} from './helpers.js';

const log = createLogger('Calendar');
const router = express.Router();

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
             u_created.display_name  AS creator_name,
             -- Dieselbe geerbte Farbe wie im Lesepfad, damit jede Antwort dieses
             -- Moduls dasselbe Event-Objekt liefert: CalDAV/Google ueber
             -- calendar_ref_id, ICS-Abos ueber subscription_id (#891).
             COALESCE(ec.color, isub.color) AS cal_color,
             bd.name       AS birthday_name,
             bd.birth_date AS birthday_date,
             ${ASSIGNED_USERS_SQL},
             (SELECT hws.id FROM housekeeping_work_sessions hws WHERE hws.calendar_event_id = e.id LIMIT 1) AS housekeeping_visit_id
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      LEFT JOIN external_calendars ec ON ec.id = e.calendar_ref_id
      LEFT JOIN ics_subscriptions isub ON isub.id = e.subscription_id
      LEFT JOIN birthdays bd ON bd.calendar_event_id = e.id
      WHERE e.id = ?
        AND ${visibilityWhere('e', 'event_assignments', 'event_id')}
    `).get(id, getUserId(req), getUserId(req));

    if (!event) return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });
    res.json({ data: serializeEvent(event) });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/calendar
// Neuen Termin anlegen.
// Body: { title, description?, start_datetime, end_datetime?,
//         all_day?, location?, color?, icon?, assigned_to?,
//         recurrence_rule?, countdown? }
// Response: { data: Event }
// --------------------------------------------------------
router.post('/', async (req, res) => {
  let stagedUpload;
  try {
    const userId = getUserId(req);
    if (!userId) {
      log.warn('Rejecting calendar create without resolved authenticated user id', {
        authMethod: req.authMethod || null,
        authUserId: req.authUserId || null,
        reqUserId: req.user?.id || null,
        sessionUserId: req.session?.userId || null,
      });
      return res.status(401).json({ error: 'Not authenticated.', code: 401 });
    }

    const vTitle = str(req.body.title, 'Titel', { max: MAX_TITLE });
    const vDesc  = str(req.body.description, 'Beschreibung', { max: MAX_TEXT, required: false });
    const vStart = datetime(req.body.start_datetime, 'Startdatum', true);
    const vEnd   = datetime(req.body.end_datetime, 'Enddatum');
    // Kein Fallback auf eine Palettenfarbe: fehlt die Angabe, bekommt der Termin
    // KEINE eigene Farbe (NULL) und leiht sich die der zugewiesenen Person
    // (#891). `color()` liefert fuer undefined/null/'' bereits value: null.
    const vColor = color(req.body.color, 'Farbe');
    const vIcon  = eventIcon(req.body.icon);
    const vLoc   = str(req.body.location, 'Ort', { max: MAX_TITLE, required: false });
    const vRrule = rrule(req.body.recurrence_rule, 'Wiederholung');
    const vCaldav = caldavTarget(req.body);
    const vGoogle = googleTarget(req.body);
    const vOutlook = outlookTarget(req.body);
    const errors = collectErrors([vTitle, vDesc, vStart, vEnd, vColor, vLoc, vRrule, vCaldav, vGoogle, vOutlook]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });
    if (!vIcon) return res.status(400).json({ error: 'icon: invalid calendar event icon.', code: 400 });

    const { all_day = 0 } = req.body;
    const userIds  = parseAssignedTo(req.body.assigned_to);
    const firstUid = userIds[0] ?? null;

    const attachment = req.body.attachment_data
      ? parseAttachment(req.body.attachment_data)
      : { mime: null, size: null, buffer: null };
    if (attachment.buffer) {
      stagedUpload = await stageDocumentUpload({
        buffer: attachment.buffer,
        mime: attachment.mime,
        category: 'other',
        originalName: req.body.attachment_name || 'Attachment',
      });
    }

    const eventId = db.get().transaction(() => {
      const documentId = createAttachmentDocument(
        db.get(),
        attachment,
        stagedUpload,
        req.body,
        userId
      );
      const result = db.get().prepare(`
        INSERT INTO calendar_events
          (title, description, start_datetime, end_datetime, all_day,
           location, color, icon, assigned_to, created_by, recurrence_rule,
           attachment_name, attachment_mime, attachment_size, attachment_data, attachment_document_id,
           target_caldav_account_id, target_caldav_calendar_url, target_google_calendar_id,
           target_outlook_account_id, target_outlook_calendar_id, visibility,
           countdown)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        vTitle.value, vDesc.value,
        vStart.value, vEnd.value,
        all_day ? 1 : 0, vLoc.value,
        vColor.value, vIcon, firstUid,
        userId, vRrule.value,
        req.body.attachment_name || null,
        attachment.mime,
        attachment.size,
        null,
        documentId,
        vCaldav.value.accountId,
        vCaldav.value.calendarUrl,
        vGoogle.value,
        vOutlook.value.accountId,
        vOutlook.value.calendarId,
        normalizeVisibility(req.body.visibility),
        req.body.countdown ? 1 : 0
      );
      setEventAssignments(db.get(), result.lastInsertRowid, userIds);
      return result.lastInsertRowid;
    })();

    const event = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name,
             -- Dieselbe geerbte Farbe wie im Lesepfad, damit jede Antwort dieses
             -- Moduls dasselbe Event-Objekt liefert: CalDAV/Google ueber
             -- calendar_ref_id, ICS-Abos ueber subscription_id (#891).
             COALESCE(ec.color, isub.color) AS cal_color,
             ${ASSIGNED_USERS_SQL}
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      LEFT JOIN external_calendars ec ON ec.id = e.calendar_ref_id
      LEFT JOIN ics_subscriptions isub ON isub.id = e.subscription_id
      WHERE e.id = ?
    `).get(eventId);

    res.status(201).json({ data: serializeEvent(event) });
  } catch (err) {
    if (err instanceof StorageError && !stagedUpload) {
      log.error('POST / storage error:', err);
      return sendStorageError(res, err, 'Calendar attachment storage upload failed.');
    }
    log.error('', err);
    if (stagedUpload) {
      try {
        await cleanupStagedUpload(stagedUpload);
      } catch (cleanupError) {
        log.error('POST / cleanup error after database failure:', cleanupError);
        return sendStorageError(
          res,
          cleanupError,
          'Calendar attachment storage cleanup failed.'
        );
      }
    }
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/calendar/:id
// Termin vollständig aktualisieren.
// Body: alle Felder optional außer title + start_datetime
// Response: { data: Event }
// --------------------------------------------------------
router.put('/:id', async (req, res) => {
  let stagedUpload;
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
    // Der unveränderte Bestandswert kommt ohne Prüfung durch: Die Regel steht
    // bereits so in der Datenbank, und der Validator kennt nur das Vokabular der
    // eigenen Oberfläche (FREQ/INTERVAL/BYDAY/UNTIL/COUNT, ohne „RRULE:"-Präfix).
    // Eine aus CalDAV eingelesene Serie trägt regelmäßig mehr als das - Präfix,
    // WKST, BYMONTHDAY. Ohne diese Ausnahme scheiterte jede Änderung an einem
    // anderen Feld (Zuweisung, Titel) an der Wiederholung, die der Nutzer gar
    // nicht angefasst hat (#756). Geändert wird weiterhin nur, was der Validator
    // zulässt.
    if (req.body.recurrence_rule !== undefined
        && req.body.recurrence_rule !== event.recurrence_rule) {
      checks.push(rrule(req.body.recurrence_rule, 'Wiederholung'));
    }
    // CalDAV-Ziel nur prüfen, wenn der Client es mitschickt; sonst bestehenden Wert behalten.
    const caldavProvided = req.body.target_caldav_account_id !== undefined
      || req.body.target_caldav_calendar_url !== undefined;
    const vCaldav = caldavProvided ? caldavTarget(req.body) : null;
    if (vCaldav) checks.push(vCaldav);
    // Google-Ziel nur prüfen, wenn der Client es mitschickt; sonst bestehenden Wert behalten.
    const googleProvided = req.body.target_google_calendar_id !== undefined;
    const vGoogle = googleProvided ? googleTarget(req.body) : null;
    if (vGoogle) checks.push(vGoogle);
    // Outlook-Ziel nur prüfen, wenn der Client es mitschickt; sonst bestehenden Wert behalten.
    const outlookProvided = req.body.target_outlook_account_id !== undefined
      || req.body.target_outlook_calendar_id !== undefined;
    const vOutlook = outlookProvided ? outlookTarget(req.body) : null;
    if (vOutlook) checks.push(vOutlook);
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });
    const vIcon = req.body.icon !== undefined ? eventIcon(req.body.icon) : event.icon;
    if (!vIcon) return res.status(400).json({ error: 'icon: invalid calendar event icon.', code: 400 });
    if (
      req.body.remove_attachment !== undefined
      && typeof req.body.remove_attachment !== 'boolean'
    ) {
      return res.status(400).json({
        error: 'remove_attachment: muss ein Boolean sein.',
        code: 400,
      });
    }
    const attachmentDataProvided = Object.hasOwn(req.body, 'attachment_data');
    const replacementRequested = typeof req.body.attachment_data === 'string'
      && req.body.attachment_data.trim() !== '';
    const removalRequested = req.body.remove_attachment === true
      || (attachmentDataProvided && req.body.attachment_data === null);
    if (replacementRequested && removalRequested) {
      return res.status(400).json({
        error: 'attachment_data und remove_attachment widersprechen sich.',
        code: 400,
      });
    }
    const attachment = replacementRequested
      ? parseAttachment(req.body.attachment_data)
      : null;
    if (attachment?.buffer) {
      stagedUpload = await stageDocumentUpload({
        buffer: attachment.buffer,
        mime: attachment.mime,
        category: 'other',
        originalName: req.body.attachment_name || 'Attachment',
      });
    }

    const {
      title, description, start_datetime, end_datetime,
      all_day, location, color: colorVal, recurrence_rule,
    } = req.body;

    // `color` ueberhaupt mitgeschickt? Nur dann wird die Spalte angefasst - der
    // Wert selbst darf dann auch null sein und heisst "keine eigene Farbe" (#891).
    const colorTouched = Object.hasOwn(req.body, 'color');

    const assignedTouched = req.body.assigned_to !== undefined;
    const userIds  = assignedTouched
      ? parseAssignedTo(req.body.assigned_to)
      : db.get().prepare('SELECT user_id FROM event_assignments WHERE event_id = ?')
          .all(id).map((r) => r.user_id);

    // `assigned_to` ist die PRIMAERE Zuweisung, nicht bloss die erste Zeile: das
    // Formular schickt seine Reihenfolge mit, und `userIds[0]` traegt sie. Beim
    // Nachladen oben gibt es diese Reihenfolge aber nicht - die Abfrage hat kein
    // `ORDER BY`, ihre Reihenfolge ist die der `event_assignments`-Zeilen. Ein
    // PUT, das `assigned_to` gar nicht mitschickt (der Serien-Split etwa sendet
    // nur `recurrence_rule`), wuerde die primaere Zuweisung sonst auf gut Glueck
    // neu bestimmen und dabei still auf ein anderes Mitglied umlegen.
    //
    // Seit #891 ist das sichtbar: `resolveEventColor()` nimmt die Farbe der in
    // `assigned_to` genannten Person, ein Termin ohne eigene Farbe wechselt also
    // die Farbe, ohne dass jemand die Zuweisung angefasst hat. Dieselbe Regel wie
    // bei `color`: nicht mitgeschickt heisst nicht angefasst.
    const firstUid = assignedTouched
      ? (userIds[0] ?? null)
      : (userIds.includes(event.assigned_to) ? event.assigned_to : (userIds[0] ?? null));

    const userModified = event.external_source !== 'local' ? 1 : event.user_modified;

    // Die Farbe führt ihren eigenen Zustand (#899). `user_modified` bedeutet
    // "an diesem Termin wurde etwas bearbeitet" und wird oben bei JEDEM Feld
    // gesetzt; der Inbound der Anbieter las es trotzdem als "die Farbe wird ab
    // jetzt lokal geführt". Eine Titeländerung fror damit die Farbspalte
    // dauerhaft ein - eine Umfärbung auf dem Server kam nie mehr an.
    //
    // Gesetzt wird deshalb nur bei einer ECHTEN Umfärbung: `color` mitgeschickt
    // UND ein anderer Wert als bisher. Ein Formular, das die unveränderte Farbe
    // brav mitschickt, ist keine. Einmal gesetzt bleibt das Flag stehen, auch
    // wenn die Farbe später wieder geleert wird - genau dieser Zustand
    // (`color IS NULL AND color_modified = 1`) ist das ausdrückliche Leeren, das
    // der Ausgang spiegeln darf.
    const colorModified = (colorTouched && (colorVal ?? null) !== (event.color ?? null))
      ? 1
      : event.color_modified;

    const caldavAccountId = vCaldav ? vCaldav.value.accountId : event.target_caldav_account_id;
    const caldavCalendarUrl = vCaldav ? vCaldav.value.calendarUrl : event.target_caldav_calendar_url;
    const googleTargetId = vGoogle ? vGoogle.value : event.target_google_calendar_id;
    const outlookAccountId = vOutlook ? vOutlook.value.accountId : event.target_outlook_account_id;
    const outlookCalendarId = vOutlook ? vOutlook.value.calendarId : event.target_outlook_calendar_id;

    db.get().transaction(() => {
      const documentId = replacementRequested
        ? createAttachmentDocument(
            db.get(),
            attachment,
            stagedUpload,
            req.body,
            event.created_by
          )
        : removalRequested
          ? null
          : event.attachment_document_id;
      const attachmentName = replacementRequested
        ? (req.body.attachment_name || 'Attachment')
        : removalRequested
          ? null
          : event.attachment_name;
      const attachmentMime = replacementRequested
        ? attachment.mime
        : removalRequested
          ? null
          : event.attachment_mime;
      const attachmentSize = replacementRequested
        ? attachment.size
        : removalRequested
          ? null
          : event.attachment_size;
      const attachmentData = replacementRequested || removalRequested
        ? null
        : event.attachment_data;
      db.get().prepare(`
        UPDATE calendar_events
        SET title           = COALESCE(?, title),
            description     = ?,
            start_datetime  = COALESCE(?, start_datetime),
            end_datetime    = ?,
            all_day         = COALESCE(?, all_day),
            location        = ?,
            -- Nicht COALESCE: der Wert NULL ist hier eine AUSSAGE ("dieser Termin
            -- hat keine eigene Farbe", #891) und kein fehlender Parameter.
            -- COALESCE kann beides nicht auseinanderhalten und wuerde die
            -- Loeschung schlucken. Der Schalter traegt die Unterscheidung, die
            -- der Body macht: color fehlt = nicht angefasst, color: null =
            -- ausdruecklich geleert. Damit bleibt die Regel der Nachbarfelder
            -- erhalten - das PUT eines Clients, der das Feld nicht kennt, darf
            -- eine gesetzte Farbe nicht stillschweigend loeschen.
            color           = CASE WHEN ? THEN ? ELSE color END,
            icon            = COALESCE(?, icon),
            assigned_to     = ?,
            recurrence_rule = ?,
            attachment_name = ?,
            attachment_mime  = ?,
            attachment_size  = ?,
            attachment_data  = ?,
            attachment_document_id = ?,
            target_caldav_account_id   = ?,
            target_caldav_calendar_url = ?,
            target_google_calendar_id  = ?,
            target_outlook_account_id  = ?,
            target_outlook_calendar_id = ?,
            visibility      = ?,
            -- Anzeigeeinstellung, kein gespiegeltes Feld (#647): sie steht nicht
            -- in MIRRORED_FIELDS und löst deshalb keinen Push aus. Wie bei den
            -- Nachbarfeldern gilt „nicht mitgeschickt" als „nicht angefasst" -
            -- das PUT eines Clients, der das Feld nicht kennt (Modul, ältere
            -- App), darf eine gesetzte Markierung nicht stillschweigend löschen.
            countdown       = ?,
            user_modified   = ?,
            color_modified  = ?
        WHERE id = ?
      `).run(
        title?.trim()  ?? null,
        description !== undefined ? (description || null) : event.description,
        start_datetime ?? null,
        end_datetime !== undefined ? (end_datetime || null) : event.end_datetime,
        all_day !== undefined ? (all_day ? 1 : 0) : null,
        location !== undefined ? (location || null) : event.location,
        colorTouched ? 1 : 0, colorVal ?? null,
        req.body.icon !== undefined ? vIcon : null,
        firstUid !== undefined ? firstUid : event.assigned_to,
        recurrence_rule !== undefined ? (recurrence_rule || null) : event.recurrence_rule,
        attachmentName,
        attachmentMime,
        attachmentSize,
        attachmentData,
        documentId,
        caldavAccountId,
        caldavCalendarUrl,
        googleTargetId,
        outlookAccountId,
        outlookCalendarId,
        req.body.visibility !== undefined
          ? normalizeVisibility(req.body.visibility, event.visibility)
          : event.visibility,
        req.body.countdown !== undefined ? (req.body.countdown ? 1 : 0) : event.countdown,
        userModified,
        colorModified,
        id
      );
      setEventAssignments(db.get(), id, userIds);
    })();

    const updated = db.get().prepare(`
      SELECT e.*,
             u_assigned.display_name AS assigned_name,
             u_assigned.avatar_color AS assigned_color,
             u_created.display_name  AS creator_name,
             -- Dieselbe geerbte Farbe wie im Lesepfad, damit jede Antwort dieses
             -- Moduls dasselbe Event-Objekt liefert: CalDAV/Google ueber
             -- calendar_ref_id, ICS-Abos ueber subscription_id (#891).
             COALESCE(ec.color, isub.color) AS cal_color,
             ${ASSIGNED_USERS_SQL}
      FROM calendar_events e
      LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = e.created_by
      LEFT JOIN external_calendars ec ON ec.id = e.calendar_ref_id
      LEFT JOIN ics_subscriptions isub ON isub.id = e.subscription_id
      WHERE e.id = ?
    `).get(id);

    // Änderung an einem synchronisierten Termin beim Provider nachziehen (#593):
    // geänderte Felder als Patch, ein gewechselter Zielkalender als Umzug.
    // Wie beim Löschen: vormerken, antworten, danach best effort ausführen.
    const pending = markEventOutbound(event, updated);

    res.json({ data: serializeEvent(updated) });

    if (pending) {
      flushOutbound()
        .catch((e) => log.warn('Änderung vorgemerkt, Sofortversuch fehlgeschlagen:', e.message));
    }
  } catch (err) {
    if (err instanceof StorageError && !stagedUpload) {
      log.error('PUT /:id storage error:', err);
      return sendStorageError(res, err, 'Calendar attachment storage upload failed.');
    }
    log.error('', err);
    if (stagedUpload) {
      try {
        await cleanupStagedUpload(stagedUpload);
      } catch (cleanupError) {
        log.error('PUT /:id cleanup error after database failure:', cleanupError);
        return sendStorageError(
          res,
          cleanupError,
          'Calendar attachment storage cleanup failed.'
        );
      }
    }
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/calendar/:id/reset
// ICS-Event auf Original zurücksetzen (user_modified = 0).
// Nur Event-Creator, Subscription-Creator oder Admin.
// Response: { data: { reset: true } }
// --------------------------------------------------------
router.post('/:id/reset', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.', code: 400 });
    const event = db.get().prepare(`
      SELECT e.*, s.created_by AS sub_created_by
      FROM calendar_events e
      LEFT JOIN ics_subscriptions s ON s.id = e.subscription_id
      WHERE e.id = ?
    `).get(id);
    if (!event) return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });
    if (event.external_source !== 'ics')
      return res.status(400).json({ error: 'Nur ICS-Events können zurückgesetzt werden.', code: 400 });

    const userId  = getUserId(req);
    const isAdmin = isAdminUser(req);
    if (!isAdmin && event.created_by !== userId && event.sub_created_by !== userId)
      return res.status(403).json({ error: 'Nicht autorisiert.', code: 403 });

    // `color_modified` geht mit: Zurücksetzen heisst "der Feed führt diesen
    // Termin wieder", und das schliesst seine Farbe ein (#899).
    db.get().prepare('UPDATE calendar_events SET user_modified = 0, color_modified = 0 WHERE id = ?').run(id);
    res.json({ data: { reset: true } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/calendar/:id/exceptions
// Nimmt ein einzelnes Vorkommen einer lokalen Serie aus (EXDATE, #489).
// Body: { date: 'YYYY-MM-DD' } — Start-Datum der auszunehmenden Instanz.
// Nur lokale (nicht extern synchronisierte) wiederkehrende Termine.
// Response: 201 { data: { event_id, exception_date } }
// --------------------------------------------------------
router.post('/:id/exceptions', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.', code: 400 });

    const date = req.body?.date;
    if (!DATE_RE.test(date || ''))
      return res.status(400).json({ error: 'date muss YYYY-MM-DD sein.', code: 400 });

    const event = db.get().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    if (!event) return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });
    if (!event.recurrence_rule)
      return res.status(400).json({ error: 'Termin ist keine Serie.', code: 400 });
    // Nur rein lokale Serien: extern synchronisierte (Google/Apple/CalDAV via
    // calendar_ref_id, ICS-Abo via subscription_id) würden beim nächsten Sync
    // wiederkehren; deren EXDATE-Propagierung ist bewusst out of scope (#489).
    if (event.external_source !== 'local' || event.calendar_ref_id || event.subscription_id)
      return res.status(400).json({ error: 'Externe Serien können nicht einzeln ausgenommen werden.', code: 400 });

    const userId  = getUserId(req);
    const isAdmin = isAdminUser(req);
    if (!isAdmin && event.created_by !== userId)
      return res.status(403).json({ error: 'Nicht autorisiert.', code: 403 });

    db.get().prepare(
      'INSERT OR IGNORE INTO calendar_event_exceptions (event_id, exception_date) VALUES (?, ?)'
    ).run(id, date);

    res.status(201).json({ data: { event_id: id, exception_date: date } });
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/calendar/:id
// Termin löschen. Ein nach Google gespiegelter Termin wird dort ebenfalls
// gelöscht (#593) - vorgemerkt vor dem lokalen DELETE (danach ist die Zeile
// mitsamt der Google-Event-ID weg), ausgeführt asynchron nach der Antwort.
// Response: 204 No Content
// --------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id, 10);
    const event = db.get().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    const queued = event ? queueEventDeletion(event) : false;

    const result = db.get().prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Termin nicht gefunden', code: 404 });

    res.status(204).end();

    // Bewusst nach der Antwort: der Provider-Aufruf darf das lokale Löschen weder
    // verzögern noch scheitern lassen. Schlägt er fehl, bleibt der Tombstone
    // liegen und der nächste Sync-Lauf holt die Löschung nach.
    if (queued) {
      flushOutbound()
        .catch((err) => log.warn('Löschung vorgemerkt, Sofortversuch fehlgeschlagen:', err.message));
    }
  } catch (err) {
    log.error('', err);
    res.status(500).json({ error: 'Interner Fehler', code: 500 });
  }
});

export default router;
