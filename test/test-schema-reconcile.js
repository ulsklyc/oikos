/**
 * Tests: Schema-Selbstheilung gegen Migrations-Drift (#538)
 * Modul: server/db.js → reconcileCriticalSchema()
 *
 * Szenario: Eine Migration (v54) ist in schema_migrations als angewendet vermerkt,
 * ihr additiver Effekt (reminders.pushed_at) fehlt real - etwa nach Restore aus
 * einem inkonsistenten Backup. Ohne die Spalte scheitert der Notification-/Push-
 * Scheduler bei jedem Lauf still auf `no such column: r.pushed_at`.
 *
 * Der Test läuft gegen eine eigene node:sqlite-DB (built-in) und beweist damit,
 * dass die Reparatur mit derselben API funktioniert wie in Produktion mit
 * better-sqlite3 (PRAGMA table_info + ALTER TABLE ADD COLUMN).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// db.js initialisiert beim Import die globale (better-sqlite3-)DB; wir testen
// reconcileCriticalSchema aber isoliert gegen eine eigene node:sqlite-Instanz.
const { reconcileCriticalSchema } = await import('../server/db.js');

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

test('trägt fehlende reminders.pushed_at nach und erhält Bestandsdaten', () => {
  const db = new DatabaseSync(':memory:');
  // reminders wie in einer gedrifteten DB: ohne pushed_at
  db.exec(`CREATE TABLE reminders (
    id INTEGER PRIMARY KEY, entity_type TEXT, entity_id INTEGER,
    remind_at TEXT, dismissed INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT
  )`);
  db.exec(`INSERT INTO reminders (id, entity_type, remind_at) VALUES (1, 'task', '2026-01-01T09:00:00Z')`);
  assert.equal(hasColumn(db, 'reminders', 'pushed_at'), false);

  reconcileCriticalSchema(db);

  assert.equal(hasColumn(db, 'reminders', 'pushed_at'), true);
  // Die neue Spalte ist NULL-defaultet, Bestandszeile bleibt erhalten
  const row = db.prepare('SELECT id, entity_type, pushed_at FROM reminders WHERE id = 1').get();
  assert.equal(row.entity_type, 'task');
  assert.equal(row.pushed_at, null);
  // Genau die Query des Schedulers ist danach lauffähig
  assert.doesNotThrow(() => db.prepare('SELECT id FROM reminders r WHERE r.pushed_at IS NULL').all());
});

test('ist idempotent: vorhandene Spalte samt Wert bleibt unangetastet', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE reminders (id INTEGER PRIMARY KEY, remind_at TEXT, pushed_at TEXT)`);
  db.exec(`INSERT INTO reminders (id, pushed_at) VALUES (1, '2026-05-05T10:00:00Z')`);

  reconcileCriticalSchema(db);
  reconcileCriticalSchema(db); // zweiter Lauf darf keinen Duplicate-Column-Fehler werfen

  const row = db.prepare('SELECT pushed_at FROM reminders WHERE id = 1').get();
  assert.equal(row.pushed_at, '2026-05-05T10:00:00Z');
});

test('repairs an api-token subject migration-version collision and backfills existing tokens', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE api_tokens (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      created_by INTEGER NOT NULL
    );
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL
    );
    INSERT INTO schema_migrations (version, description)
      VALUES (134, 'Routines: scheduled occurrence persistence');
    INSERT INTO users (id, username) VALUES (7, 'existing-member');
    INSERT INTO api_tokens (id, name, token_hash, token_prefix, created_by)
      VALUES (11, 'Existing integration', 'hash', 'prefix', 7);
  `);

  assert.equal(hasColumn(db, 'api_tokens', 'subject_user_id'), false);
  reconcileCriticalSchema(db);
  reconcileCriticalSchema(db);

  assert.equal(hasColumn(db, 'api_tokens', 'subject_user_id'), true);
  assert.equal(
    db.prepare('SELECT subject_user_id FROM api_tokens WHERE id = 11').get().subject_user_id,
    7,
  );
  assert.ok(db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_api_tokens_subject_user_id'
  `).get());
  db.prepare('DELETE FROM users WHERE id = 7').run();
  assert.equal(db.prepare('SELECT count(*) AS count FROM api_tokens').get().count, 0);
});

test('ist ein No-op, wenn die reminders-Tabelle ganz fehlt (kein Wurf, keine Neuanlage)', () => {
  const db = new DatabaseSync(':memory:');
  assert.doesNotThrow(() => reconcileCriticalSchema(db));
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'").get();
  assert.equal(tbl, undefined);
});

test('greift ohne database-Argument nicht auf eine nicht-initialisierte DB zu', () => {
  // Defensive: reconcileCriticalSchema(undefined) bei fehlender globaler DB darf nicht werfen.
  assert.doesNotThrow(() => reconcileCriticalSchema(null));
});
