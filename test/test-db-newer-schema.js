/**
 * Modul: Downgrade-Schutz - aeltere App auf neuerer Datenbank
 * Zweck: Migrationen laufen nur vorwaerts. Traegt eine Datenbank Migrationsnummern,
 *        die dieser Build nicht kennt, hat eine NEUERE Yuvomi-Version sie
 *        geschrieben (Image-Rollback, fremdes Backup). Bis zum Leitlinien-Audit
 *        vom 03.09.2026 (Nebenbefund N1) startete die aeltere App darauf stumm;
 *        was sie schrieb, war nach dem naechsten Update verloren, weil die
 *        Migration als angewendet galt. Jetzt: Start verweigert mit klarer
 *        Meldung, DB_ALLOW_NEWER_SCHEMA=1 als ausdruecklicher Notfallschalter
 *        mit Warnung. Je Szenario eine frische db.js-Instanz (Cache-Busting-
 *        Query), da DB_PATH beim Modul-Load gelesen wird und init() beim Import
 *        laeuft - dasselbe Muster wie test-db-encryption.js.
 * Ausfuehren: npm run test:db-newer-schema
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

delete process.env.DB_ENCRYPTION_KEY;
delete process.env.DB_ALLOW_NEWER_SCHEMA;
const dir = mkdtempSync(join(tmpdir(), 'yuvomi-newer-schema-'));
const dbPath = join(dir, 'yuvomi.db');
let scenario = 0;

/** Frische db.js-Instanz auf dbPath; init() laeuft beim Import. */
function boot() {
  process.env.DB_PATH = dbPath;
  return import(`../server/db.js?newer=${++scenario}`);
}

test.after(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('eine Datenbank dieses Builds startet ohne Befund', async () => {
  const mod = await boot();
  assert.deepEqual(mod.unknownMigrationVersions(mod.get()), []);
  // Migration "aus der Zukunft" eintragen - so sieht die Datei nach einem
  // Rollback des Images aus.
  mod.get().prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)')
    .run(999999, 'aus einer neueren Version');
  assert.deepEqual(mod.unknownMigrationVersions(mod.get()), [999999]);
  mod.get().close();
});

test('eine aeltere App verweigert den Start auf der neueren Datenbank und sagt warum', async () => {
  await assert.rejects(boot(), (err) => {
    assert.match(err.message, /newer Yuvomi/, 'die Ursache steht in der Meldung');
    assert.match(err.message, /999999/, 'die unbekannte Nummer steht in der Meldung');
    assert.match(err.message, /DB_ALLOW_NEWER_SCHEMA/, 'der Notfallschalter steht in der Meldung');
    return true;
  });
});

test('DB_ALLOW_NEWER_SCHEMA=1 startet trotzdem, die Datenbank bleibt nutzbar', async () => {
  process.env.DB_ALLOW_NEWER_SCHEMA = '1';
  try {
    const mod = await boot();
    assert.doesNotThrow(() => mod.get().prepare('SELECT 1').get());
    assert.deepEqual(mod.unknownMigrationVersions(mod.get()), [999999],
      'der Schalter umgeht die Pruefung, er repariert nichts');
    mod.get().close();
  } finally {
    delete process.env.DB_ALLOW_NEWER_SCHEMA;
  }
});

test('ein leerer Wert des Schalters zaehlt nicht als gesetzt', async () => {
  process.env.DB_ALLOW_NEWER_SCHEMA = '';
  try {
    await assert.rejects(boot(), /newer Yuvomi/);
  } finally {
    delete process.env.DB_ALLOW_NEWER_SCHEMA;
  }
});
