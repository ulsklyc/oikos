// --------------------------------------------------------
// Ausgehende Änderungen für CalDAV-VTODO (Issue #617).
//
// Der VTODO-Spiegel (caldav-reminders-sync.js) war einseitig: eine hier
// abgehakte, umbenannte oder gelöschte Aufgabe blieb auf dem Server stehen, und
// der nächste Inbound-Lauf machte die lokale Änderung wieder rückgängig. Diese
// Datei ist die Rückrichtung, nach demselben Muster wie die Termine (#593):
//
//   Löschen → Zeile in caldav_todo_pending_deletions (überlebt den Eintrag)
//   Ändern  → outbound_dirty auf der Zeile selbst
//
// Vorgemerkt wird synchron im Route-Handler, ausgeführt wird danach: der
// Server-Aufruf darf die HTTP-Antwort weder verzögern noch scheitern lassen. Was
// nicht durchgeht, bleibt vorgemerkt und läuft im nächsten Sync mit
// (at-least-once).
//
// Ein Umzug zwischen Listen fehlt bewusst - anders als ein Termin trägt eine
// Aufgabe kein wählbares Ziel, sie gehört zu der Liste, aus der sie kam. Aus
// demselben Grund geht auch nichts hinaus, was hier neu entstanden ist: ohne
// Zielwahl gäbe es keine Liste, in die es gehörte.
// --------------------------------------------------------

import { createLogger } from '../logger.js';
import * as db from '../db.js';
import { outboundFailureAction } from './calendar-outbound.js';
import { patchICSTodo } from '../utils/ics-patch.js';
import { createCalDAVClient, collectionUrlOf } from '../utils/caldav-client.js';
import { localToUTC, serverTimeZone } from '../utils/timezone.js';
import { loadTags } from '../utils/task-tags.js';

const log = createLogger('CalDAV-Todo-Outbound');

// --------------------------------------------------------
// Module
//
// Der Inbound spiegelt VTODO in zwei Ziele, also muss die Rückrichtung beide
// kennen. `table` wird in SQL interpoliert (SQLite erlaubt keine Bind-Parameter
// für Bezeichner) - die Modulnamen hier sind zugleich die Whitelist, ein
// unbekannter Name kommt nie bis zum Statement.
// --------------------------------------------------------

export const MODULES = {
  tasks: {
    table: 'tasks',
    // Felder, die zum Server gespiegelt werden. Alles andere (Kategorie,
    // Zuweisung, Punkte, Sichtbarkeit, Unteraufgaben) ist Yuvomi-intern und
    // kennt in VTODO keine Entsprechung, löst also keinen Push aus.
    //
    // `tags_key` ist kein Spaltenname: Tags liegen in task_tags, der
    // Feldvergleich sieht aber nur die Zeile. Der Aufrufer hängt den
    // kanonischen Schlüssel (utils/task-tags.js: tagsKey) an beide Seiten,
    // sonst bliebe eine reine Tag-Änderung unbemerkt (#586).
    mirrored: ['title', 'description', 'priority', 'status', 'due_date', 'due_time', 'tags_key'],
    icsFields: icsFieldsForTask,
    labelOf: (row) => row.title,
  },
  shopping: {
    table: 'shopping_items',
    mirrored: ['name', 'is_checked'],
    icsFields: icsFieldsForShoppingItem,
    labelOf: (row) => row.name,
  },
};

function moduleDef(module) {
  const def = MODULES[module];
  if (!def) throw new Error(`Unknown VTODO module "${module}".`);
  return def;
}

// --------------------------------------------------------
// Feld-Abbildung Yuvomi → VTODO
// --------------------------------------------------------

/** RFC-5545-Zeitstempel in UTC, wie ihn COMPLETED und DTSTAMP verlangen. */
function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Yuvomi-Priorität → RFC-5545-PRIORITY. Gegenstück zu mapVtodoPriority.
 *
 * Vier lokale Stufen treffen auf drei Bänder (1-4 hoch, 5 mittel, 6-9 niedrig),
 * deshalb teilen sich `urgent` und `high` das obere Band. Damit `urgent` den
 * Rückweg trotzdem übersteht, respektiert der Inbound eine lokale Verfeinerung
 * innerhalb desselben Bandes, statt sie zu überschreiben.
 */
export function priorityToVtodo(priority) {
  switch (priority) {
    case 'urgent': return '1';
    case 'high':   return '2';
    case 'medium': return '5';
    case 'low':    return '9';
    default:       return null; // 'none' → Property entfernen
  }
}

/**
 * DUE-Property aus Datum und Uhrzeit.
 *
 * Ohne Uhrzeit ein reines Datum (VALUE=DATE), sonst ein UTC-Zeitstempel. Eine
 * Aufgabe trägt keine TZID: `due_date`/`due_time` sind Wanduhr-Werte in der Zone
 * des Haushalts, also muss die Uhrzeit von dort nach UTC (Gegenstück zu
 * splitDue). Ein ungeprüft als UTC verschicktes „14:30" verschöbe die Aufgabe auf
 * dem Server um den Zonenoffset.
 */
export function dueField(date, time, tz = serverTimeZone()) {
  if (!date) return null; // Property entfernen
  const day = String(date).slice(0, 10);
  if (!time) return { value: day.replace(/-/g, ''), params: ';VALUE=DATE' };

  const utc = localToUTC(`${day}T${String(time).slice(0, 5)}:00`, tz);
  return { value: utc.replace(/[-:]/g, '').replace(/\.\d{3}/, ''), params: '' };
}

/**
 * Erledigt-Zustand als die drei Properties, an denen Clients ihn ablesen.
 * `hadCompleted` verhindert, dass eine Bearbeitung an einer längst erledigten
 * Aufgabe deren Erledigt-Zeitpunkt auf jetzt zurücksetzt.
 */
function completionFields(done, inProgress, hadCompleted) {
  if (!done) {
    return {
      STATUS:              inProgress ? 'IN-PROCESS' : 'NEEDS-ACTION',
      COMPLETED:           null,
      'PERCENT-COMPLETE':  null,
    };
  }
  const fields = { STATUS: 'COMPLETED', 'PERCENT-COMPLETE': '100' };
  if (!hadCompleted) fields.COMPLETED = utcStamp();
  return fields;
}

/**
 * VTODO-Properties einer lokalen Aufgabe.
 *
 * CATEGORIES wird nur aufgenommen, wenn die Tags wirklich geladen sind (#586).
 * Der Unterschied ist folgenreich: ein leeres Array heißt „keine Tags mehr" und
 * entfernt die Property auf dem Server, ein fehlendes Feld heißt „unbekannt"
 * und muss sie unberührt lassen. Wäre beides dasselbe, würde jeder Aufrufer,
 * der eine rohe Zeile aus `SELECT *` durchreicht, die Tags des Servers
 * stillschweigend löschen - `reloadRow` hängt sie deshalb an.
 */
export function icsFieldsForTask(task, hadCompleted = false) {
  const fields = {
    SUMMARY:     task.title,
    DESCRIPTION: task.description || null,
    DUE:         dueField(task.due_date, task.due_time),
    PRIORITY:    priorityToVtodo(task.priority),
    ...completionFields(task.status === 'done', task.status === 'in_progress', hadCompleted),
  };
  if (Array.isArray(task.tags)) fields.CATEGORIES = task.tags;
  return fields;
}

/** VTODO-Properties eines lokalen Einkaufspostens. */
export function icsFieldsForShoppingItem(item, hadCompleted = false) {
  return {
    SUMMARY: item.name,
    ...completionFields(!!item.is_checked, false, hadCompleted),
  };
}

/** Trägt das Objekt bereits einen Erledigt-Zeitpunkt? */
function hasCompleted(icsText) {
  return /^COMPLETED[;:]/im.test(String(icsText || ''));
}

// --------------------------------------------------------
// Vormerkung: Löschung
// --------------------------------------------------------

/** Gibt es das Konto noch? */
function accountExists(accountId) {
  return !!db.get().prepare('SELECT 1 FROM caldav_accounts WHERE id = ?').get(accountId);
}

/**
 * Ist dieser Eintrag ein CalDAV-Spiegel, für den die Rückrichtung überhaupt gilt?
 * Lokale Aufgaben haben external_source = 'local' und gehen nirgendwohin.
 *
 * Das Konto muss es noch geben. `external_account_id` trägt keinen
 * Fremdschlüssel (v45), eine gedriftete Datenbank kann also auf ein längst
 * gelöschtes Konto zeigen - und der Tombstone darauf scheiterte am
 * Fremdschlüssel von caldav_todo_pending_deletions, womit sich die Aufgabe
 * lokal nicht mehr löschen ließe. Ohne Konto gibt es keinen Rückweg, also ist
 * hier nichts vorzumerken: dieselbe Vorprüfung wie acceptsOutbound() bei den
 * Terminen. Der Regelfall ist ohnehin abgedeckt - caldavSync.deleteAccount
 * entkoppelt seine Zeilen (detachAccountRows), Migration v123 den Bestand.
 */
function isMirrored(row) {
  if (!row || row.external_source !== 'caldav') return false;
  if (!row.external_uid || !row.external_account_id) return false;
  return accountExists(row.external_account_id);
}

/**
 * Löst die gespiegelten Zeilen eines Kontos von ihm ab - zu rufen, bevor das
 * Konto verschwindet. Was hier steht, sind Nutzerdaten und bleibt; nur die
 * Verbindung zum Server geht. Danach ist es eine gewöhnliche Aufgabe bzw. ein
 * gewöhnlicher Einkaufsposten: kein Tombstone, kein Push, und der Prune-Lauf
 * eines anderen Kontos fasst sie nicht an.
 *
 * @returns {number} Anzahl entkoppelter Zeilen
 */
export function detachAccountRows(accountId) {
  let detached = 0;
  for (const def of Object.values(MODULES)) {
    detached += db.get().prepare(`
      UPDATE ${def.table}
         SET external_source     = 'local',
             external_uid        = NULL,
             external_account_id = NULL,
             external_object_url = NULL,
             outbound_dirty      = 0,
             outbound_attempts   = 0
       WHERE external_source = 'caldav' AND external_account_id = ?
    `).run(accountId).changes;
  }
  return detached;
}

/**
 * Merkt einen gerade lokal gelöschten Spiegel-Eintrag für die Löschung auf dem
 * Server vor. Muss VOR dem lokalen DELETE mit der noch vorhandenen Zeile
 * aufgerufen werden - danach sind UID und Objekt-URL weg.
 *
 * @returns {boolean} true, wenn ein Tombstone entstanden ist
 */
export function queueTodoDeletion(module, row) {
  moduleDef(module);
  if (!isMirrored(row)) return false;

  db.get().prepare(`
    INSERT INTO caldav_todo_pending_deletions (account_id, module, uid, object_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, module, uid)
      DO UPDATE SET object_url = COALESCE(excluded.object_url, object_url)
  `).run(row.external_account_id, module, row.external_uid, row.external_object_url || null);
  return true;
}

/** Merkt alle gespiegelten Einträge einer Auswahl vor (Mehrfachlöschungen). */
export function queueTodoDeletions(module, rows) {
  let queued = 0;
  for (const row of rows || []) {
    if (queueTodoDeletion(module, row)) queued++;
  }
  return queued;
}

export function pendingDeletions(accountId, module) {
  return db.get().prepare(`
    SELECT id, uid, object_url, attempts
    FROM caldav_todo_pending_deletions
    WHERE account_id = ? AND module = ?
    ORDER BY id
  `).all(accountId, module);
}

/**
 * Offene Lösch-UIDs eines Moduls als Set - der Inbound darf einen lokal
 * gelöschten Eintrag nicht wieder anlegen, solange der Server ihn noch führt.
 * Fehlt die Tabelle (gedriftete Datenbank), gilt "keine offenen Löschungen":
 * daran darf ein Inbound-Lauf nicht scheitern.
 */
export function pendingDeletionUids(accountId, module) {
  try {
    return new Set(
      db.get().prepare(
        'SELECT uid FROM caldav_todo_pending_deletions WHERE account_id = ? AND module = ?'
      ).all(accountId, module).map((r) => r.uid)
    );
  } catch (err) {
    log.warn(`Pending deletions are not readable (${err.message}); treating them as none.`);
    return new Set();
  }
}

function dropDeletion(id) {
  db.get().prepare('DELETE FROM caldav_todo_pending_deletions WHERE id = ?').run(id);
}

function failDeletion(id, err) {
  db.get().prepare(
    'UPDATE caldav_todo_pending_deletions SET attempts = attempts + 1, last_error = ? WHERE id = ?'
  ).run(String(err?.message || err).slice(0, 500), id);
}

// --------------------------------------------------------
// Vormerkung: Änderung
// --------------------------------------------------------

export function mirroredFieldsChanged(module, before, after) {
  return moduleDef(module).mirrored.some((f) => before?.[f] !== after?.[f]);
}

/**
 * Merkt eine lokale Bearbeitung für den Push vor.
 * @param {'tasks'|'shopping'} module
 * @param {object} before  Zeile vor der Änderung
 * @param {object} after   Zeile danach
 * @returns {boolean} true, wenn etwas aussteht
 */
export function markTodoOutbound(module, before, after) {
  const def = moduleDef(module);
  if (!isMirrored(after)) return false;
  if (!mirroredFieldsChanged(module, before, after)) return false;

  db.get().prepare(
    `UPDATE ${def.table} SET outbound_dirty = 1, outbound_attempts = 0 WHERE id = ?`
  ).run(after.id);
  return true;
}

export function pendingUpdates(accountId, module) {
  const def = moduleDef(module);
  return db.get().prepare(`
    SELECT * FROM ${def.table}
    WHERE outbound_dirty = 1 AND external_source = 'caldav' AND external_account_id = ?
    ORDER BY id
  `).all(accountId);
}

/** UIDs mit ausstehendem Push - der Inbound überschreibt sie nicht. */
export function pendingUpdateUids(accountId, module) {
  const def = moduleDef(module);
  try {
    return new Set(
      db.get().prepare(`
        SELECT external_uid FROM ${def.table}
        WHERE outbound_dirty = 1 AND external_source = 'caldav' AND external_account_id = ?
      `).all(accountId).map((r) => r.external_uid)
    );
  } catch (err) {
    log.warn(`Pending updates are not readable (${err.message}); treating them as none.`);
    return new Set();
  }
}

function clearOutbound(module, id) {
  const def = moduleDef(module);
  db.get().prepare(
    `UPDATE ${def.table} SET outbound_dirty = 0, outbound_attempts = 0 WHERE id = ?`
  ).run(id);
}

function failOutbound(module, id) {
  const def = moduleDef(module);
  db.get().prepare(
    `UPDATE ${def.table} SET outbound_attempts = outbound_attempts + 1 WHERE id = ?`
  ).run(id);
}

/**
 * Der Stand unmittelbar vor dem Server-Aufruf; null, wenn parallel gelöscht.
 * Aufgaben bekommen ihre Tags angehängt - sie liegen in task_tags, `SELECT *`
 * allein liefert sie also nicht, und icsFieldsForTask baut CATEGORIES daraus (#586).
 */
function reloadRow(module, id) {
  const def = moduleDef(module);
  const row = db.get().prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(id) ?? null;
  if (row && module === 'tasks') row.tags = loadTags(db.get(), row.id);
  return row;
}

// --------------------------------------------------------
// Ausführung
// --------------------------------------------------------

/**
 * Arbeitet vorgemerkte Löschungen ab.
 *
 * @param {object}  client       tsdav-Client
 * @param {number}  accountId
 * @param {string}  module
 * @param {Map}     objectIndex  UID → { url, etag, data }
 * @param {boolean} complete     true, wenn alle Listen dieses Kontos abgerufen
 *                               wurden. Nur dann ist "der Server führt das Objekt
 *                               nicht mehr" belegt und der Tombstone erledigt;
 *                               im Sofortversuch (nur einzelne Objekte geholt)
 *                               bleibt er sonst liegen.
 * @returns {Promise<number>} erledigte Tombstones
 */
export async function processPendingDeletions(client, accountId, module, objectIndex, complete = false) {
  const rows = pendingDeletions(accountId, module);
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {
    const known = objectIndex.get(row.uid);
    const url   = row.object_url || known?.url || null;

    if (!url) {
      if (complete) {
        log.info(`VTODO ${row.uid} is no longer on the server, dropping the pending deletion.`);
        dropDeletion(row.id);
        done++;
      }
      continue;
    }

    try {
      await client.deleteCalendarObject({ calendarObject: { url, etag: known?.etag } });
      dropDeletion(row.id);
      done++;
    } catch (err) {
      const action = outboundFailureAction(err, row.attempts);
      if (action === 'settled') {
        dropDeletion(row.id);
        done++;
        continue;
      }
      failDeletion(row.id, err);
      if (action === 'give-up') {
        log.error(`Giving up on remote deletion of VTODO ${row.uid} after ${row.attempts + 1} attempt(s):`, err.message);
        dropDeletion(row.id);
        done++;
        continue;
      }
      log.warn(`Remote deletion failed for VTODO ${row.uid} (attempt ${row.attempts + 1}):`, err.message);
    }
  }
  return done;
}

/**
 * Schiebt lokal bearbeitete Spiegel-Einträge zum Server. Geändert wird das
 * Originalobjekt, nicht ein neu gebautes: sonst verlöre die Aufgabe auf dem
 * Server alles, was Yuvomi nicht kennt (Alarme, Unterlisten, Beziehungen).
 * CATEGORIES gehört seit #586 nicht mehr dazu - die Tag-Liste ist vollständig
 * gespiegelt und wird deshalb bewusst verwaltet.
 *
 * @returns {Promise<number>} erfolgreich verarbeitete Einträge
 */
export async function processPendingUpdates(client, accountId, module, objectIndex) {
  const def  = moduleDef(module);
  const rows = pendingUpdates(accountId, module);
  if (rows.length === 0) return 0;

  let done = 0;
  for (const row of rows) {
    const known = objectIndex.get(row.external_uid);
    const url   = row.external_object_url || known?.url || null;

    // Weder gespeichert noch im aktuellen Abruf: gehört zu einer Liste, die
    // dieser Lauf nicht angefasst hat. Nichts tun, nichts verwerfen.
    if (!url) continue;

    if (!known?.data) {
      log.warn(`No source object for ${def.table} row ${row.id} in this run, deferring its update.`);
      continue;
    }

    // Frisch nachladen: zwischen der Auswahl und hier liegt ein await, in dem
    // eine weitere Bearbeitung eingetroffen sein kann.
    const fresh = reloadRow(module, row.id);
    if (!fresh) continue; // parallel gelöscht - der Tombstone-Pfad übernimmt

    const patched = patchICSTodo(
      known.data, row.external_uid, def.icsFields(fresh, hasCompleted(known.data))
    );
    if (!patched) {
      log.warn(`VTODO ${row.external_uid} has no editable component in its calendar object, dropping its update.`);
      clearOutbound(module, row.id);
      continue;
    }

    try {
      await client.updateCalendarObject({ calendarObject: { url, etag: known.etag, data: patched } });
      clearOutbound(module, row.id);
      done++;
    } catch (err) {
      const action = outboundFailureAction(err, row.outbound_attempts);
      if (action === 'settled') {
        log.warn(`VTODO ${row.external_uid} no longer exists on the server, dropping its update.`);
        clearOutbound(module, row.id);
        continue;
      }
      if (action === 'give-up') {
        log.error(`Giving up on the outbound update of "${def.labelOf(row)}" after ${row.outbound_attempts + 1} attempt(s):`, err.message);
        clearOutbound(module, row.id);
        continue;
      }
      failOutbound(module, row.id);
      log.warn(`Outbound update failed for "${def.labelOf(row)}" (attempt ${row.outbound_attempts + 1}):`, err.message);
    }
  }
  return done;
}

// --------------------------------------------------------
// Sofortversuch (Fassade für die Route)
// --------------------------------------------------------

/** Konten mit offener ausgehender Arbeit, samt Modul. */
function accountsWithPendingWork() {
  const buckets = new Map();
  const add = (accountId, module) => {
    if (!accountId) return;
    if (!buckets.has(accountId)) buckets.set(accountId, new Set());
    buckets.get(accountId).add(module);
  };

  for (const row of db.get().prepare(
    'SELECT DISTINCT account_id, module FROM caldav_todo_pending_deletions'
  ).all()) {
    add(row.account_id, row.module);
  }
  for (const [module, def] of Object.entries(MODULES)) {
    for (const row of db.get().prepare(`
      SELECT DISTINCT external_account_id AS account_id FROM ${def.table}
      WHERE outbound_dirty = 1 AND external_source = 'caldav'
    `).all()) {
      add(row.account_id, module);
    }
  }
  return buckets;
}

/**
 * Holt gezielt die betroffenen Kalenderobjekte statt ganzer Listen - die
 * Grundlage des Sofortversuchs direkt nach einer Bearbeitung. Die Collection
 * wird aus der Objekt-URL abgeleitet, weil ein Eintrag nur diese trägt.
 *
 * @returns {Promise<Map>} UID → { url, etag, data }
 */
async function fetchObjectsByUrl(client, wanted) {
  const index = new Map();
  if (!wanted.length) return index;

  const byCollection = new Map();
  for (const item of wanted) {
    const collection = collectionUrlOf(item.url);
    if (!collection) continue;
    if (!byCollection.has(collection)) byCollection.set(collection, []);
    byCollection.get(collection).push(item);
  }

  for (const [collection, items] of byCollection) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar:   { url: collection },
        objectUrls: items.map((i) => i.url),
      });
      for (const obj of objects || []) {
        const match = items.find((i) => i.url === obj.url) || (items.length === 1 ? items[0] : null);
        if (!match) continue;
        index.set(match.uid, { url: obj.url || match.url, etag: obj.etag, data: obj.data });
      }
    } catch (err) {
      // Kein Grund zur Sorge: der reguläre Sync-Lauf holt die Liste ohnehin.
      log.warn(`Could not fetch VTODO objects from ${collection} for the immediate attempt: ${err.message}`);
    }
  }
  return index;
}

/**
 * Sofortiger Best-Effort-Durchlauf direkt nach einer lokalen Änderung oder
 * Löschung, damit der Server nicht erst beim nächsten Sync-Intervall nachzieht.
 * Fehler sind unkritisch - die Vormerkung bleibt stehen und der Sync holt nach.
 *
 * @param {{createClient?: Function}} [opts] Client-Factory (Tests)
 * @returns {Promise<{deleted:number,updated:number}>}
 */
export async function flushOutbound({ createClient } = {}) {
  const total  = { deleted: 0, updated: 0 };
  const work   = accountsWithPendingWork();
  if (work.size === 0) return total;

  const makeClient = createClient || createCalDAVClient;

  for (const [accountId, modules] of work) {
    const account = db.get().prepare('SELECT * FROM caldav_accounts WHERE id = ?').get(accountId);
    if (!account) continue;

    try {
      const client = await makeClient(account);

      for (const module of modules) {
        const wanted = [
          ...pendingDeletions(accountId, module)
            .filter((r) => r.object_url)
            .map((r) => ({ uid: r.uid, url: r.object_url })),
          ...pendingUpdates(accountId, module)
            .filter((r) => r.external_object_url)
            .map((r) => ({ uid: r.external_uid, url: r.external_object_url })),
        ];

        const objectIndex = await fetchObjectsByUrl(client, wanted);

        // complete = false: ohne vollen Listenabruf ist "der Server führt das
        // Objekt nicht mehr" nicht belegbar; ein Tombstone ohne bekannte URL
        // bleibt für den Sync liegen.
        total.deleted += await processPendingDeletions(client, accountId, module, objectIndex, false);
        total.updated += await processPendingUpdates(client, accountId, module, objectIndex);
      }
    } catch (err) {
      log.warn(`[Account ${accountId}] Immediate outbound attempt failed: ${err.message}`);
    }
  }
  return total;
}
