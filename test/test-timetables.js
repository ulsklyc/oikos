/**
 * Test: Timetables / Stundenplan & Arbeitszeiten
 * Zweck: Validierung der REST-Routen, DB-Schema, Validierung, Berechtigungen und Einstellungen
 * Ausführen: node --experimental-sqlite --test test/test-timetables.js
 */

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as dbmod from '../server/db.js';
import timetablesRouter from '../server/routes/timetables.js';
import { SCOPE_MODULES } from '../server/scopes.js';
import { PERMISSION_MODULES } from '../server/permissions.js';

const db = dbmod.get();

const USER_ALICE = db.prepare(`
  INSERT INTO users (username, display_name, password_hash, role)
  VALUES ('alice', 'Alice', 'x', 'member')
`).run().lastInsertRowid;

const USER_BOB = db.prepare(`
  INSERT INTO users (username, display_name, password_hash, role)
  VALUES ('bob', 'Bob', 'x', 'member')
`).run().lastInsertRowid;

let actorId = USER_ALICE;
let actorRole = 'member';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.authUserId = actorId;
  req.authRole = actorRole;
  req.session = { userId: actorId, role: actorRole };
  next();
});
app.use('/timetables', timetablesRouter);

const server = app.listen(0);
const baseUrl = await new Promise((r) => server.on('listening', () => r(`http://127.0.0.1:${server.address().port}`)));
test.after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204/empty */ }
  return { status: res.status, body: json };
}

// --------------------------------------------------------------------------
// Scopes & Module Registration
// --------------------------------------------------------------------------
test('timetables module is registered in SCOPE_MODULES and PERMISSION_MODULES', () => {
  const scopeMod = SCOPE_MODULES.find((m) => m.key === 'timetables');
  assert.ok(scopeMod, 'timetables in SCOPE_MODULES');
  assert.deepEqual(scopeMod.prefixes, ['timetables']);

  const permMod = PERMISSION_MODULES.find((m) => m.key === 'timetables');
  assert.ok(permMod, 'timetables in PERMISSION_MODULES');
  assert.deepEqual(permMod.navIds, ['timetables']);
});

// --------------------------------------------------------------------------
// CRUD Operations & Validation
// --------------------------------------------------------------------------
test('POST /timetables: validation errors on invalid input', async () => {
  // Missing subject
  let r = await call('POST', '/timetables', {
    user_id: USER_ALICE,
    day_of_week: 1,
    start_time: '08:00',
    end_time: '09:30',
  });
  assert.equal(r.status, 400);

  // End time before start time
  r = await call('POST', '/timetables', {
    user_id: USER_ALICE,
    subject: 'Maths',
    day_of_week: 1,
    start_time: '10:00',
    end_time: '08:00',
  });
  assert.equal(r.status, 400);

  // Invalid day of week (must be 1..7)
  r = await call('POST', '/timetables', {
    user_id: USER_ALICE,
    subject: 'Maths',
    day_of_week: 8,
    start_time: '08:00',
    end_time: '09:30',
  });
  assert.equal(r.status, 400);

  // Invalid user_id
  r = await call('POST', '/timetables', {
    user_id: 99999,
    subject: 'Maths',
    day_of_week: 1,
    start_time: '08:00',
    end_time: '09:30',
  });
  assert.equal(r.status, 400);
});

let createdEntryId = null;

test('POST /timetables: creates timetable slot successfully', async () => {
  const r = await call('POST', '/timetables', {
    user_id: USER_ALICE,
    day_of_week: 1,
    start_time: '08:00',
    end_time: '09:30',
    subject: 'Mathematics',
    room: 'Room 101',
    instructor: 'Mr. Gauss',
    color: '#0E7490',
    category: 'school',
    week_type: 'all',
    period_number: 1,
    notes: 'Bring calculator',
  });

  assert.equal(r.status, 201);
  assert.equal(r.body.data.subject, 'Mathematics');
  assert.equal(r.body.data.room, 'Room 101');
  assert.equal(r.body.data.instructor, 'Mr. Gauss');
  assert.equal(r.body.data.period_number, 1);
  assert.equal(r.body.data.day_of_week, 1);
  assert.equal(r.body.data.week_type, 'all');

  createdEntryId = r.body.data.id;
});

test('GET /timetables/:id: retrieves created entry', async () => {
  const r = await call('GET', `/timetables/${createdEntryId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.id, createdEntryId);
  assert.equal(r.body.data.subject, 'Mathematics');
});

test('PUT /timetables/:id: updates timetable slot', async () => {
  const r = await call('PUT', `/timetables/${createdEntryId}`, {
    subject: 'Advanced Mathematics',
    room: 'Room 202',
    start_time: '08:15',
    end_time: '09:45',
    day_of_week: 1,
    category: 'school',
    week_type: 'A',
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.data.subject, 'Advanced Mathematics');
  assert.equal(r.body.data.room, 'Room 202');
  assert.equal(r.body.data.start_time, '08:15');
  assert.equal(r.body.data.week_type, 'A');
});

test('GET /timetables: lists entries and respects filters', async () => {
  // Add a second slot for Tuesday, week B
  await call('POST', '/timetables', {
    user_id: USER_ALICE,
    day_of_week: 2,
    start_time: '10:00',
    end_time: '12:00',
    subject: 'Physics Lab',
    category: 'school',
    week_type: 'B',
  });

  // Filter by user_id
  let r = await call('GET', `/timetables?user_id=${USER_ALICE}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 2);

  // Filter by day_of_week
  r = await call('GET', `/timetables?user_id=${USER_ALICE}&day_of_week=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].subject, 'Advanced Mathematics');

  // Filter by week_type=A (returns all + A)
  r = await call('GET', `/timetables?user_id=${USER_ALICE}&week_type=A`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].subject, 'Advanced Mathematics');
});

test('GET /timetables/today: returns slots for current weekday', async () => {
  const r = await call('GET', `/timetables/today?user_id=${USER_ALICE}`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data));
  assert.ok(r.body.day_of_week >= 1 && r.body.day_of_week <= 7);
});

// --------------------------------------------------------------------------
// Settings API
// --------------------------------------------------------------------------
test('GET & PUT /timetables/settings: manages user timetable preferences', async () => {
  let r = await call('GET', `/timetables/settings?user_id=${USER_ALICE}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.view_mode, 'week');
  assert.equal(r.body.settings.show_weekends, 0);
  assert.equal(r.body.settings.show_school_holidays, 1);

  r = await call('PUT', '/timetables/settings', {
    user_id: USER_ALICE,
    view_mode: 'grid',
    active_week: 'A',
    show_weekends: 1,
    show_school_holidays: 0,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.view_mode, 'grid');
  assert.equal(r.body.settings.active_week, 'A');
  assert.equal(r.body.settings.show_weekends, 1);
  assert.equal(r.body.settings.show_school_holidays, 0);
});

// --------------------------------------------------------------------------
// Copy timetable between members
// --------------------------------------------------------------------------
test('POST /timetables/copy: copies all entries to another user', async () => {
  const r = await call('POST', '/timetables/copy', {
    from_user_id: USER_ALICE,
    to_user_id: USER_BOB,
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.count, 2);

  const bobEntries = await call('GET', `/timetables?user_id=${USER_BOB}`);
  assert.equal(bobEntries.status, 200);
  assert.equal(bobEntries.body.data.length, 2);
});

// --------------------------------------------------------------------------
// Delete slot
// --------------------------------------------------------------------------
test('DELETE /timetables/:id: deletes slot', async () => {
  const r = await call('DELETE', `/timetables/${createdEntryId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const check = await call('GET', `/timetables/${createdEntryId}`);
  assert.equal(check.status, 404);
});
