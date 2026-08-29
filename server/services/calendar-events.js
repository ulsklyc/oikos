/**
 * Modul: Kalender-Events (geteilte Abfrage-Logik)
 * Zweck: Wiederholungs-Expansion und "anstehende Termine" zentral bereitstellen,
 *        damit Kalender-Route und Dashboard exakt dieselbe Logik nutzen.
 * Abhängigkeiten: server/services/recurrence.js
 */

import { nextOccurrence, parseRRule, matchesRRuleByday } from './recurrence.js';
import { visibilityWhere } from './visibility.js';
import {
  householdTimeZone, localToUTC, shiftDateKey, storedToInstantMs, todayKey, utcToWall,
} from '../utils/timezone.js';

// Zugewiesene Personen eines Events als JSON-Array (Multi-Assignment).
const ASSIGNED_USERS_SQL = `(
  SELECT json_group_array(json_object(
    'id', u.id, 'display_name', u.display_name, 'color', u.avatar_color,
    'avatar_data', u.avatar_data
  ))
  FROM event_assignments ea JOIN users u ON u.id = ea.user_id
  WHERE ea.event_id = e.id
) AS assigned_users_json`;

/**
 * Lädt die Instanz-Ausnahmen (EXDATE, #489) für die gegebenen Event-IDs als Map.
 * @param {import('node:sqlite').DatabaseSync} d  Geöffnete DB-Verbindung
 * @param {Array<number>} eventIds  IDs wiederkehrender Events
 * @returns {Map<number, Set<string>>}  event.id → Set ausgenommener Daten (YYYY-MM-DD)
 */
export function loadEventExceptions(d, eventIds) {
  const map = new Map();
  if (!eventIds || eventIds.length === 0) return map;
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = d.prepare(
    `SELECT event_id, exception_date FROM calendar_event_exceptions WHERE event_id IN (${placeholders})`
  ).all(...eventIds);
  for (const row of rows) {
    if (!map.has(row.event_id)) map.set(row.event_id, new Set());
    map.get(row.event_id).add(row.exception_date);
  }
  return map;
}

// --------------------------------------------------------
// RRULE-Expansion: alle Vorkommen eines wiederkehrenden Events
// innerhalb [from, to] generieren (inklusive beider Grenzen).
// --------------------------------------------------------

/**
 * @param {object[]} events  Rohe DB-Events (können recurrence_rule haben)
 * @param {string}   from    YYYY-MM-DD
 * @param {string}   to      YYYY-MM-DD
 * @param {Map<number, Set<string>>?} exceptionsByEvent  event.id → Set ausgenommener
 *        Instanz-Daten (YYYY-MM-DD); diese Vorkommen werden übersprungen (EXDATE, #489)
 * @returns {object[]}  Expandiertes, sortiertes Array
 */
export function expandRecurringEvents(events, from, to, exceptionsByEvent = null) {
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

    // DST-korrekte Expansion: bei bekannter TZID (CalDAV/Apple-Serie) pro Vorkommen
    // die lokale Wanduhrzeit des Masters neu nach UTC rechnen, statt den festen
    // UTC-Suffix zu wiederholen (sonst driftet die Uhrzeit über die Sommer-/
    // Winterzeit-Grenze, #549). Nur für Tagtermine, deren lokales Datum == UTC-Datum
    // ist (kein Mitternachts-Überlauf) - sonst alte Fixe-Suffix-Logik.
    const wall = (event.tzid && !isAllDay) ? utcToWall(event.start_datetime, event.tzid) : null;
    const tzAware = wall && wall.date === event.start_datetime.slice(0, 10);

    let currentDate = event.start_datetime.slice(0, 10); // YYYY-MM-DD
    let iterations  = 0;
    const MAX_ITER  = 1000; // Sicherheitsgrenze
    const exceptions = exceptionsByEvent?.get(event.id) ?? null; // ausgenommene Instanz-Daten (#489)
    // COUNT=N begrenzt die Serie auf N Vorkommen ab DTSTART. Gezählt wird über
    // die Instanzen der Serie (nicht das Anzeigefenster) und VOR EXDATE-Entfernung
    // (RFC 5545): ausgenommene Vorkommen zählen mit, erzeugen aber keine Instanz (#513).
    const maxCount   = parseRRule(event.recurrence_rule)?.count ?? null;
    let   occurrence = 0;

    while (currentDate <= to && iterations < MAX_ITER) {
      iterations++;
      if (maxCount !== null && occurrence >= maxCount) break;
      occurrence++;

      // Ausgenommenes Vorkommen (EXDATE, #489) oder Tag außerhalb des BYDAY-Musters
      // (#549: DTSTART am Wochenende bei BYDAY=MO..FR): überspringen, Serie weiterlaufen lassen.
      if (exceptions?.has(currentDate) || !matchesRRuleByday(currentDate, event.recurrence_rule)) {
        const next = nextOccurrence(currentDate, event.recurrence_rule);
        if (!next || next <= currentDate) break;
        currentDate = next;
        continue;
      }

      // For multi-day events, check if the instance end reaches into [from, to]
      let instanceEnd = currentDate;
      if (isAllDay && durationDays > 0) {
        const d = new Date(currentDate + 'T00:00:00');
        d.setDate(d.getDate() + durationDays);
        instanceEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      if (currentDate >= from || instanceEnd >= from) {
        const newStart = tzAware ? localToUTC(`${currentDate}T${wall.time}`, event.tzid) : currentDate + timeSuffix;
        let newEnd = event.end_datetime;
        if (durationMs !== null) {
          if (isAllDay) {
            // Keep date-only format for all-day events
            const d = new Date(currentDate + 'T00:00:00');
            d.setDate(d.getDate() + durationDays);
            newEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } else {
            const endDate = new Date(new Date(newStart).getTime() + durationMs);
            if (timeSuffix.includes('Z')) {
              newEnd = endDate.toISOString().replace('.000Z', 'Z');
            } else {
              const p = n => String(n).padStart(2, '0');
              newEnd = `${endDate.getFullYear()}-${p(endDate.getMonth() + 1)}-${p(endDate.getDate())}T${p(endDate.getHours())}:${p(endDate.getMinutes())}`;
            }
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
// Anstehende Termine ab jetzt (für Dashboard-Widget & Kalender-Upcoming).
// Berücksichtigt Wiederholungen, indem das Master-Event innerhalb eines
// Fensters [heute, heute+windowDays] expandiert wird. Dadurch erscheinen
// auch wiederkehrende Serien, deren Master-Start in der Vergangenheit liegt.
// --------------------------------------------------------

/**
 * @param {import('node:sqlite').DatabaseSync} d  Geöffnete DB-Verbindung
 * @param {object}  opts
 * @param {number?} opts.userId      Aktueller User (für ICS-Sichtbarkeit)
 * @param {number}  opts.limit       Maximale Anzahl Termine (default 5)
 * @param {number}  opts.windowDays  Vorausschau-Fenster in Tagen (default 90)
 * @param {boolean} opts.fromToday   true = ab Tagesbeginn (Dashboard); false = ab jetzt (default)
 * @param {number?} opts.assignedTo  Nur Termine, die dieser Person zugewiesen sind (#814)
 * @param {boolean} opts.includeBirthdays  false = Geburtstagstermine aussortieren (#927)
 * @param {Date}    [opts.now]        Ersetzbar für Tests - die Tagesgrenze ist genau
 *        das, was hier schiefgehen kann, und ohne festen Zeitpunkt liesse sie sich
 *        nur an dem einen Abend im Jahr pruefen, an dem die Suite zufaellig laeuft.
 * @returns {object[]}  Rohe, expandierte Event-Zeilen (inkl. assigned_users_json)
 */
export function getUpcomingEvents(d, {
  userId = null, limit = 5, windowDays = 90, fromToday = false, assignedTo = null,
  includeBirthdays = true, now = new Date(),
} = {}) {
  const tz      = householdTimeZone(d);
  const nowDate = todayKey(d, now);
  // fromToday: ganztägige Sichtbarkeit heutiger Termine (Dashboard-Widget) -
  // gerechnet wird ab Mitternacht der Haushaltszone, nicht ab Mitternacht UTC.
  const filterFromMs = fromToday
    ? new Date(localToUTC(`${nowDate}T00:00:00`, tz)).getTime()
    : now.getTime();
  // Fenster: heute bis +windowDays voraus (für Wiederholungs-Expansion)
  const future  = shiftDateKey(nowDate, windowDays);
  // Untere SQL-Grenze einen Tag früher als das Ergebnisfenster (#824): `DATE()`
  // liest einen Instant als UTC-Kalendertag, und westlich von UTC liegt ein
  // Abendtermin von heute dort schon auf morgen - er fiele aus einer Grenze
  // heraus, die exakt auf `nowDate` sitzt. Geklammert wird danach exakt, über
  // den Instant-Vergleich unten, deshalb blendet der Rand nichts Zusätzliches ein.
  const sqlFrom = shiftDateKey(nowDate, -1);

  const rawEvents = d.prepare(`
    SELECT e.*,
           u_assigned.display_name AS assigned_name,
           u_assigned.avatar_color AS assigned_color,
           ec.name  AS cal_name,
           -- Zwei Toepfe fuer dieselbe geerbte Farbe: CalDAV/Google ueber
           -- calendar_ref_id, ICS-Abos ueber subscription_id (#891).
           COALESCE(ec.color, isub.color) AS cal_color,
           bd.name       AS birthday_name,
           bd.birth_date AS birthday_date,
           ${ASSIGNED_USERS_SQL}
    FROM calendar_events e
    LEFT JOIN users u_assigned ON u_assigned.id = e.assigned_to
    LEFT JOIN external_calendars ec ON ec.id = e.calendar_ref_id
    LEFT JOIN ics_subscriptions isub ON isub.id = e.subscription_id
    LEFT JOIN birthdays bd ON bd.calendar_event_id = e.id
    WHERE (
      (e.recurrence_rule IS NULL AND DATE(e.start_datetime) BETWEEN ? AND ?)
      OR
      (e.recurrence_rule IS NOT NULL AND DATE(e.start_datetime) <= ?)
    )
    AND (
      e.external_source <> 'ics'
      OR e.subscription_id IN (
        SELECT id FROM ics_subscriptions WHERE shared = 1 OR created_by = ?
      )
    )
    AND ${visibilityWhere('e', 'event_assignments', 'event_id')}
    ORDER BY e.start_datetime ASC
  `).all(sqlFrom, future, future, userId, userId, userId);

  const recurringIds = rawEvents.filter((e) => e.recurrence_rule).map((e) => e.id);
  const exceptions   = loadEventExceptions(d, recurringIds);

  return expandRecurringEvents(rawEvents, sqlFrom, future, exceptions)
    .filter((e) => {
      // Verglichen werden ZEITPUNKTE, nicht Strings. In start_datetime liegen
      // zwei Formen nebeneinander - zonenlose Wanduhrzeit (lokal angelegt) und
      // Instants mit Offset oder 'Z' (synchronisiert) -, und lexikografisch ist
      // '2026-08-21T21:00' kleiner als '2026-08-22T00:00:00.000Z', obwohl der
      // Termin noch eine Stunde vor uns liegt. Genau so verschwanden westlich
      // von UTC die Abendtermine aus dem Übersichts-Widget (#829).
      // Ganztägige Termine beginnen um Mitternacht der Haushaltszone.
      const startMs = storedToInstantMs(
        e.all_day ? e.start_datetime.slice(0, 10) : e.start_datetime, tz
      );
      return startMs !== null && startMs >= filterFromMs;
    })
    // „NUR MEINE" HEISST HIER DASSELBE WIE IM KALENDERMODUL (#814): zugewiesen,
    // nicht etwa „unzugewiesen zählt auch mit". Das Modul filtert clientseitig
    // über `assigned_users.some(u => u.id === me)` (public/pages/calendar.js,
    // `belongsToMe`), und zwei Auslegungen desselben Satzes an zwei Orten wären
    // schlimmer als der eine Fall, über den man streiten kann.
    //
    // VOR der Deckelung, nicht danach: gefiltert würde sonst innerhalb der
    // fünf, die ohnehin schon feststehen, und ein Widget mit „nur meine" zeigte
    // je nach Fremdterminen mal fünf und mal keinen (dieselbe Lehre wie #647).
    .filter((e) => {
      if (!assignedTo) return true;
      const assigned = e.assigned_users_json ? JSON.parse(e.assigned_users_json) : [];
      return assigned.some((u) => Number(u.id) === Number(assignedTo));
    })
    /* GEBURTSTAGE ABWAEHLEN (#927) - und zwar hier, VOR der Deckelung, aus
     * demselben Grund wie „nur meine" eine Zeile darueber: gefiltert wuerde
     * sonst innerhalb der fuenf, die ohnehin schon feststehen, und wer die
     * Geburtstage abwaehlt, saehe im August drei Termine statt fuenf.
     *
     * ERKANNT WIRD DER GEBURTSTAG AM JOIN, NICHT AM TITEL: `birthday_name`
     * kommt aus dem LEFT JOIN auf `birthdays` und ist genau dann gesetzt, wenn
     * der Termin aus dem Geburtstagsmodul stammt. Der Titel ist in der
     * Datensprache des Haushalts gespeichert (#524) - ein Vergleich auf
     * „Geburtstag: " haette in jedem anderssprachigen Haushalt nichts
     * gefunden. Dieselbe Bedingung wie `isVisibleLayer` im Kalendermodul. */
    .filter((e) => includeBirthdays || !e.birthday_name)
    .slice(0, limit);
}
