// --------------------------------------------------------
// Ausgehende Änderungen für CalDAV-Server (Issue #593).
//
// Geteilt vom generischen Multi-Account-Sync (caldav-sync.js) und vom
// Apple-Legacy-Sync (apple-calendar.js): beide sprechen dasselbe Protokoll und
// hätten sonst zwei Kopien derselben Logik.
//
// CalDAV kennt keinen Aufruf "ändere Event X in Kalender Y": ein Kalenderobjekt
// wird über SEINE eigene URL angefasst. Die URL steht seit Migration v106 in
// calendar_events.external_object_url; für Termine, die davor synchronisiert
// wurden, löst der laufende Sync sie über die UID der gerade geholten Objekte auf.
// --------------------------------------------------------

import { createLogger } from '../logger.js';
import * as outbound from './calendar-outbound.js';
import { patchICSEvent } from '../utils/ics-patch.js';
import { toICSDatetime } from '../utils/ics-format.js';
import { nearestIcalColorName } from '../utils/ical-color.js';

const log = createLogger('CalDAVOutbound');

const label = (source) => (source === 'apple' ? 'Apple' : 'CalDAV');

/**
 * Kalender-Properties eines lokalen Termins für patchICSEvent.
 * Ganztägig → VALUE=DATE mit exklusivem DTEND (RFC 5545), sonst Wanduhrzeit mit
 * der Zone des Termins, damit ein importierter Termin seine TZID behält.
 */
export function icsFieldsForEvent(event) {
  const hasZoneInValue = /Z$|[+-]\d{2}:?\d{2}$/.test(event.start_datetime || '');
  const tzParam = (event.tzid && !hasZoneInValue) ? `;TZID=${event.tzid}` : '';

  let start;
  let end;
  if (event.all_day) {
    const startDate = event.start_datetime.slice(0, 10).replace(/-/g, '');
    const endSrc    = (event.end_datetime || event.start_datetime).slice(0, 10);
    const endD      = new Date(endSrc + 'T00:00:00');
    endD.setDate(endD.getDate() + 1);
    const endDate = `${endD.getFullYear()}${String(endD.getMonth() + 1).padStart(2, '0')}${String(endD.getDate()).padStart(2, '0')}`;
    start = { value: startDate, params: ';VALUE=DATE' };
    end   = { value: endDate,   params: ';VALUE=DATE' };
  } else {
    start = { value: toICSDatetime(event.start_datetime), params: tzParam };
    end   = { value: toICSDatetime(event.end_datetime || event.start_datetime), params: tzParam };
  }

  const fields = {
    SUMMARY:     event.title,
    DESCRIPTION: event.description || null,
    LOCATION:    event.location || null,
    RRULE:       event.recurrence_rule || null,
    DTSTART:     start,
    DTEND:       end,
  };

  // COLOR ist Teil von MIRRORED_FIELDS, wurde aber nie geschrieben (#897): eine
  // Umfaerbung kostete einen PUT, der beim Server nichts aenderte.
  //
  // DREI Faelle, und die letzten beiden sehen im Rueckgabewert gleich aus:
  //   - abbildbare Eigenfarbe   -> CSS3-Name, ersetzt die Property
  //   - gar keine Eigenfarbe    -> null, ENTFERNT die Property; der Termin soll
  //     beim Anbieter wieder die Kalenderfarbe erben (wie colorId null bei Google)
  //   - Farbe, aber nicht abbildbar (kein gueltiges #RRGGBB, etwa aus einem alten
  //     Bestand) -> das Feld gar nicht erst mitgeben. "Nicht anfassen" ist hier
  //     richtig: der Termin TRAEGT eine Farbe, wir koennen sie nur nicht schreiben,
  //     und eine fremde COLOR dafuer zu loeschen waere ein Datenverlust.
  const colorName = nearestIcalColorName(event.color);
  if (colorName)        fields.COLOR = colorName;
  else if (!event.color) fields.COLOR = null;

  return fields;
}

/** Dateiname eines Kalenderobjekts aus seiner URL, ersatzweise aus der UID. */
export function filenameFromUrl(url, uid) {
  const last = String(url).split('/').filter(Boolean).pop();
  return last && last.includes('.') ? last : `${uid}.ics`;
}

/**
 * Holt gezielt einzelne Kalenderobjekte statt ganzer Kalender - die Grundlage des
 * Sofortversuchs direkt nach einer Bearbeitung (#593). Ein voller Kalenderabruf
 * wäre dafür unverhältnismäßig; hier zählt nur das eine geänderte Objekt.
 *
 * @param {object} client
 * @param {Array<{uid:string,url:string,calendarUrl:string}>} wanted
 * @returns {Promise<Map>} UID → { url, etag, data, calendarUrl }
 */
export async function fetchObjectsByUrl(client, wanted) {
  const index = new Map();
  if (!wanted.length) return index;

  // Nach Kalender gruppieren: fetchCalendarObjects adressiert Objekte innerhalb
  // einer Collection.
  const byCalendar = new Map();
  for (const item of wanted) {
    if (!item.url || !item.calendarUrl) continue;
    if (!byCalendar.has(item.calendarUrl)) byCalendar.set(item.calendarUrl, []);
    byCalendar.get(item.calendarUrl).push(item);
  }

  for (const [calendarUrl, items] of byCalendar) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar:   { url: calendarUrl },
        objectUrls: items.map((i) => i.url),
      });
      // Über die URL zurück auf den Termin abbilden - verlässlicher als die UID
      // erneut aus dem Objekt zu parsen.
      for (const obj of objects || []) {
        const match = items.find((i) => i.url === obj.url) || (items.length === 1 ? items[0] : null);
        if (!match) continue;
        index.set(match.uid, {
          url: obj.url || match.url, etag: obj.etag, data: obj.data, calendarUrl,
        });
      }
    } catch (err) {
      // Kein Grund zur Sorge: der reguläre Sync-Lauf holt den Kalender ohnehin.
      log.warn(`Could not fetch calendar objects from ${calendarUrl} for the immediate attempt: ${err.message}`);
    }
  }
  return index;
}

/**
 * Sofortversuch für einen CalDAV-Account: erledigt, was ohne vollen Kalenderabruf
 * geht. Löschungen brauchen nur die gespeicherte Objekt-URL, Änderungen zusätzlich
 * das Originalobjekt; ein Umzug zusätzlich die Kalenderliste.
 *
 * Was hier nicht klappt, bleibt vorgemerkt und läuft im nächsten Sync mit.
 * @returns {Promise<{deleted:number,updated:number}>}
 */
export async function flushAccount(client, source, { deletions, updates, needsCalendars }) {
  const wanted = updates
    .filter((e) => e.external_object_url)
    .map((e) => ({
      uid: e.external_calendar_id,
      url: e.external_object_url,
      calendarUrl: e.__calendarUrl,
    }));

  const objectIndex = await fetchObjectsByUrl(client, wanted);

  let calendarsByUrl = new Map();
  if (needsCalendars) {
    try {
      const cals = await client.fetchCalendars();
      calendarsByUrl = new Map((cals || []).map((c) => [c.url, c]));
    } catch (err) {
      log.warn(`Could not list calendars for the immediate attempt: ${err.message}`);
    }
  }

  // ownCalendarUrls bewusst nicht gesetzt: ohne vollen Abruf ist "der Server
  // führt das Objekt nicht mehr" nicht belegbar, und ein Tombstone ohne bekannte
  // URL darf hier nicht als erledigt gelten. Er bleibt für den Sync liegen.
  const deleted = deletions.length ? await processPendingDeletions(client, source, objectIndex) : 0;
  const updated = objectIndex.size ? await processPendingUpdates(client, source, objectIndex, calendarsByUrl) : 0;
  return { deleted, updated };
}

/**
 * Arbeitet vorgemerkte Löschungen auf einem CalDAV-Server ab.
 * @param {object} client       tsdav-Client
 * @param {string} source       'caldav' | 'apple'
 * @param {Map}    objectIndex  UID → { url, etag, data, calendarUrl } aus dem Inbound dieses Laufs
 * @param {Set}    [ownCalendarUrls] Kalender dieses Accounts; fremde Tombstones bleiben unangetastet
 * @returns {Promise<number>} erledigte Tombstones
 */
export async function processPendingDeletions(client, source, objectIndex, ownCalendarUrls = null) {
  const rows = outbound.pendingDeletions(source);
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {
    // Mehrere Accounts teilen sich die Tombstone-Tabelle: nur anfassen, was zu den
    // gerade abgerufenen Kalendern gehört, sonst zählt ein fremder Account fremde
    // Fehlversuche hoch und verwirft am Ende eine fremde Löschung.
    if (ownCalendarUrls && row.calendar_external_id && !ownCalendarUrls.has(row.calendar_external_id)) continue;

    const known = objectIndex.get(row.event_external_id);
    const url   = row.object_url || known?.url || null;

    if (!url) {
      // Zuständig, aber der Server liefert das Objekt nicht mehr aus: dann ist es
      // dort bereits weg und der Tombstone hat sein Ziel erreicht.
      if (ownCalendarUrls) {
        log.info(`[${label(source)}] Event ${row.event_external_id} is no longer on the server, dropping the pending deletion.`);
        outbound.dropDeletion(row.id);
        done++;
      }
      continue;
    }

    try {
      await client.deleteCalendarObject({ calendarObject: { url, etag: known?.etag } });
      outbound.dropDeletion(row.id);
      done++;
    } catch (err) {
      if (outbound.handleDeletionError(err, row, label(source))
          && outbound.classifyOutboundError(err) === 'settled') {
        done++;
      }
    }
  }
  return done;
}

/**
 * Schiebt lokal bearbeitete, bereits synchronisierte Termine zum Server.
 * Ein Wechsel des Zielkalenders wird als Anlegen im Ziel + Löschen in der Quelle
 * ausgeführt: CalDAV kennt kein Verschieben.
 * @returns {Promise<number>} erfolgreich verarbeitete Termine
 */
export async function processPendingUpdates(client, source, objectIndex, calendarsByUrl = new Map()) {
  const events = outbound.pendingUpdates(source);
  if (events.length === 0) return 0;

  let done = 0;
  for (const event of events) {
    const known = objectIndex.get(event.external_calendar_id);
    const url   = event.external_object_url || known?.url || null;

    // Weder gespeichert noch im aktuellen Abruf enthalten: das Objekt gehört zu
    // einem anderen Account. Nichts tun, nichts verwerfen - dessen Lauf übernimmt.
    if (!url) continue;

    if (!known?.data) {
      // Ohne das Originalobjekt bliebe nur, es neu zu bauen - und das verlöre
      // alles, was Yuvomi nicht kennt (Teilnehmer, Alarme, Kategorien).
      log.warn(`[${label(source)}] No source object for event ${event.id} in this run, deferring its update.`);
      continue;
    }

    // Frisch nachladen: zwischen der Auswahl und hier liegt ein await, in dem eine
    // weitere Bearbeitung eingetroffen sein kann.
    const fresh = outbound.reloadEvent(event.id);
    if (!fresh) continue; // parallel gelöscht - der Tombstone-Pfad übernimmt

    const patched = patchICSEvent(known.data, event.external_calendar_id, icsFieldsForEvent(fresh));
    if (!patched) {
      log.warn(`[${label(source)}] Event ${event.external_calendar_id} has no editable VEVENT in its calendar object, dropping its update.`);
      outbound.clearOutbound(event.id);
      continue;
    }

    // ── Wechsel des Zielkalenders: anlegen im Ziel, löschen in der Quelle ──────
    const moveTo = event.outbound_move_to;
    if (moveTo && moveTo !== known.calendarUrl) {
      const destCal = calendarsByUrl.get(moveTo);
      if (!destCal) {
        log.warn(`[${label(source)}] Destination calendar ${moveTo} is not available, keeping event ${event.id} where it is.`);
        outbound.clearOutboundMove(event.id);
      } else {
        try {
          await client.createCalendarObject({
            calendar:   destCal,
            filename:   filenameFromUrl(url, event.external_calendar_id),
            iCalString: patched,
          });
          // Erst nach erfolgreichem Anlegen löschen: scheitert das Löschen, steht
          // der Termin doppelt - das ist reparabel. Umgekehrt wäre er weg.
          try {
            await client.deleteCalendarObject({ calendarObject: { url, etag: known.etag } });
          } catch (err) {
            log.error(`[${label(source)}] Event ${event.id} was copied to ${moveTo} but could not be removed from its old calendar:`, err.message);
          }
          outbound.clearOutbound(event.id);
          done++;
          continue; // der Patch ist mit dem Anlegen bereits geschrieben
        } catch (err) {
          outbound.handleUpdateError(err, event, 'move', label(source), outbound.clearOutboundMove);
          continue;
        }
      }
    } else if (moveTo) {
      outbound.clearOutboundMove(event.id);
    }

    if (!event.outbound_dirty) continue;

    try {
      await client.updateCalendarObject({
        calendarObject: { url, etag: known.etag, data: patched },
      });
      outbound.clearOutbound(event.id);
      done++;
    } catch (err) {
      outbound.handleUpdateError(err, event, 'update', label(source));
    }
  }
  return done;
}
