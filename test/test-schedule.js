process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import express from 'express';
import { get } from '../server/db.js';
import scheduleRouter, { isStillReferenced } from '../server/routes/schedule.js';
import { cyclePosition, resolveEntries } from '../server/services/schedule.js';

// Fuer die Verhaltenstests von overrideGroups()/rangeDifference() unten - laedt
// public/pages/schedule.js als echtes Modul statt nur seinen Quelltext zu lesen.
register('./test-browser-loader.mjs', import.meta.url);

const database = get();
database.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES ('schedule-alice', 'Alice', 'x', 'member')").run();
database.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES ('schedule-bob', 'Bob', 'x', 'member')").run();
database.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES ('schedule-admin', 'Admin', 'x', 'admin')").run();

const ALICE = { id: 1, role: 'member' };
const BOB = { id: 2, role: 'member' };
const ADMIN = { id: 3, role: 'admin' };
const typeId = database.prepare("INSERT INTO schedule_shift_types (name, start_time, end_time, color) VALUES ('Early', '06:00', '14:00', '#6C3AED')").run().lastInsertRowid;
const patternId = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length) VALUES (1, 'Eight day', '2026-09-01', 8)").run().lastInsertRowid;
database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, ?, ?)').run(patternId, 7, typeId);

const patterns = () => database.prepare('SELECT * FROM schedule_patterns WHERE user_id = 1').all();
// Ein Array je Schluessel, nicht eine einzelne Zeile - ein Zyklustag kann
// mehrere Klassen tragen (Stundenplan), resolveEntries() erwartet das jetzt so.
function days() {
  const map = new Map();
  for (const row of database.prepare('SELECT * FROM schedule_pattern_days').all()) {
    const key = `${row.pattern_id}:${row.position}`;
    if (map.has(key)) map.get(key).push(row);
    else map.set(key, [row]);
  }
  return map;
}
function resolve(from, to, overrides = database.prepare('SELECT * FROM schedule_overrides WHERE user_id = 1').all()) {
  return resolveEntries({ from, to, userId: 1, patterns: patterns(), patternDays: days(), overrides });
}

test('cycle position handles dates before the anchor', () => {
  assert.equal(cyclePosition('2026-09-01', 8, '2026-08-31'), 7);
  assert.equal(resolve('2026-08-31', '2026-08-31').entries[0].shift_type_id, typeId);
});

test('a NULL override explicitly makes a scheduled day free and deleting it restores the pattern', () => {
  database.prepare('INSERT INTO schedule_overrides (user_id, date_key, shift_type_id) VALUES (1, ?, NULL)').run('2026-09-01');
  assert.equal(resolve('2026-09-01', '2026-09-01').entries[0].is_free, true);
  database.prepare('DELETE FROM schedule_overrides WHERE user_id = 1 AND date_key = ?').run('2026-09-01');
  assert.equal(resolve('2026-09-01', '2026-09-01').entries[0].source, 'pattern');
});

test('override beats pattern, and a pattern beats nothing', () => {
  const result = resolveEntries({
    from: '2026-10-01', to: '2026-10-01', userId: 1,
    patterns: [{ id: 44, anchor_date: '2026-10-01', cycle_length: 1, valid_from: null, valid_until: null }],
    patternDays: new Map([['44:0', [{ id: 999, shift_type_id: typeId }]]]),
    overrides: [{ id: 55, date_key: '2026-10-01', shift_type_id: null, note: 'Vacation' }],
  });
  assert.equal(result.entries[0].source, 'override');
  assert.equal(result.entries[0].is_free, true);
  const noPattern = resolveEntries({ from: '2026-10-01', to: '2026-10-01', userId: 1, patterns: [], patternDays: new Map(), overrides: [] });
  assert.deepEqual(noPattern.entries, []);
});

// A timetable's whole point: one cycle position, several classes at
// different times. Each row keeps its own stable pattern_day_id (the
// disambiguator reminders/ICS rely on to give each class its own anchor/UID),
// and an empty position still resolves to exactly one free-day entry, never
// zero - the same placeholder a single-class pattern has always produced.
test('a pattern day can carry several classes, each its own entry with its own pattern_day_id', () => {
  const bioType = database.prepare("INSERT INTO schedule_shift_types (name, start_time, end_time, color) VALUES ('Bio', '09:00', '10:00', '#123456')").run().lastInsertRowid;
  const result = resolveEntries({
    from: '2026-11-02', to: '2026-11-02', userId: 1,
    patterns: [{ id: 77, anchor_date: '2026-11-02', cycle_length: 7, valid_from: null, valid_until: null }],
    patternDays: new Map([['77:0', [{ id: 501, shift_type_id: typeId }, { id: 502, shift_type_id: bioType }]]]),
    overrides: [],
  });
  assert.equal(result.entries.length, 2, 'both classes on the day must resolve, not just the last one');
  assert.deepEqual(result.entries.map((e) => e.shift_type_id).sort(), [bioType, typeId].sort());
  assert.deepEqual(result.entries.map((e) => e.pattern_day_id).sort(), [501, 502]);
  assert.ok(result.entries.every((e) => e.source === 'pattern' && e.position === 0));

  const empty = resolveEntries({
    from: '2026-11-02', to: '2026-11-02', userId: 1,
    patterns: [{ id: 77, anchor_date: '2026-11-02', cycle_length: 7, valid_from: null, valid_until: null }],
    patternDays: new Map(),
    overrides: [],
  });
  assert.equal(empty.entries.length, 1, 'zero classes must still resolve to one explicit free day, not zero entries');
  assert.equal(empty.entries[0].is_free, true);
  assert.equal(empty.entries[0].pattern_day_id, null);
});

test('a referenced shift type cannot be deleted', () => {
  assert.throws(() => database.prepare('DELETE FROM schedule_shift_types WHERE id = ?').run(typeId));
});

test('calendar day arithmetic remains stable across DST', () => {
  assert.equal(cyclePosition('2026-03-27', 8, '2026-03-30'), 3);
});

let actor = ALICE;
const app = express();
app.use((req, _res, next) => {
  req.authUserId = actor.id;
  req.authRole = actor.role;
  req.session = { userId: actor.id, role: actor.role };
  next();
});
app.use(express.json());
app.use('/', scheduleRouter);
const server = app.listen(0);
const baseUrl = await new Promise((resolveServer) => server.on('listening', () => resolveServer(`http://127.0.0.1:${server.address().port}`)));
test.after(() => server.close());

async function call(method, path, { as = ALICE, body } = {}) {
  actor = as;
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const contentType = response.headers.get('content-type') || '';
  return { status: response.status, body: contentType.includes('application/json') ? await response.json() : null };
}

test('GET /household-members lists real members only, never staff or split-expense guests', async () => {
  const workerUserId = database.prepare(
    "INSERT INTO users (username, display_name, password_hash, role) VALUES ('schedule-worker', 'Worker', 'x', 'member')"
  ).run().lastInsertRowid;
  database.prepare('INSERT INTO housekeeping_workers (user_id) VALUES (?)').run(workerUserId);

  const guestUserId = database.prepare(
    "INSERT INTO users (username, display_name, password_hash, role) VALUES ('schedule-guest', 'Guest', 'x', 'member')"
  ).run().lastInsertRowid;
  const groupId = database.prepare(
    "INSERT INTO expense_groups (name, default_currency, created_by) VALUES ('Overview test group', 'EUR', ?)"
  ).run(ADMIN.id).lastInsertRowid;
  database.prepare('INSERT INTO split_expense_guest_users (user_id, group_id, created_by) VALUES (?, ?, ?)').run(guestUserId, groupId, ADMIN.id);

  const response = await call('GET', '/household-members', { as: ALICE });
  assert.equal(response.status, 200);
  const ids = response.body.data.map((row) => row.id);
  assert.ok(ids.includes(ALICE.id), 'an ordinary member is offered');
  assert.ok(!ids.includes(workerUserId), 'a housekeeping worker is never offered');
  assert.ok(!ids.includes(guestUserId), 'a split-expense guest is never offered');
});

test('entries are household-readable, include type data, and never materialize calendar events', async () => {
  const nightType = database.prepare("INSERT INTO schedule_shift_types (name, short_code, start_time, end_time, color) VALUES ('Night', 'N', '22:00', '06:00', '#123456')").run().lastInsertRowid;
  const bobPattern = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length) VALUES (2, 'Nights', '2026-10-01', 1)").run().lastInsertRowid;
  database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(bobPattern, nightType);
  const before = database.prepare('SELECT count(*) AS count FROM calendar_events').get().count;
  const response = await call('GET', '/entries?from=2026-10-01&to=2026-10-01', { as: ALICE });
  assert.equal(response.status, 200);
  const entry = response.body.data.entries.find((item) => item.user_id === BOB.id);
  assert.equal(entry.date_key, '2026-10-01', 'overnight shift remains on its start day');
  assert.equal(entry.shift_type.short_code, 'N');
  assert.equal(entry.crosses_midnight, true);
  const fullDayType = database.prepare("INSERT INTO schedule_shift_types (name, short_code, start_time, end_time, color) VALUES ('Full day', '24', '10:00', '10:00', '#654321')").run().lastInsertRowid;
  const fullDayPattern = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length) VALUES (2, 'Full day', '2026-10-02', 1)").run().lastInsertRowid;
  database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(fullDayPattern, fullDayType);
  const fullDay = await call('GET', '/entries?from=2026-10-02&to=2026-10-02&user_id=2', { as: ALICE });
  assert.equal(fullDay.body.data.entries[0].crosses_midnight, true, 'equal start/end is a 24-hour shift');
  assert.equal(database.prepare('SELECT count(*) AS count FROM calendar_events').get().count, before);
});

// Migration 183: GET /entries embeds each resolved entry's field_values (keyed
// by the RIGHT id column for its source - pattern_day_id/override_id/extra_id
// are three different lookups, see scheduleData()) and each shift_type's own
// attached-field list, so the frontend never needs a second round trip to
// know what to show or how to label it.
test('GET /entries embeds field_values (keyed correctly per source) and each shift type\'s attached fields', async () => {
  const type = database.prepare("INSERT INTO schedule_shift_types (name, start_time, end_time, color) VALUES ('Period 3', '09:55', '10:40', '#111111')").run().lastInsertRowid;
  const room = database.prepare("INSERT INTO schedule_custom_fields (name) VALUES ('Room')").run().lastInsertRowid;
  database.prepare('INSERT INTO schedule_shift_type_fields (shift_type_id, custom_field_id, position, show_in_overlay) VALUES (?, ?, 0, 1)').run(type, room);

  const pattern = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length) VALUES (1, 'Fields entries', '2026-11-01', 1)").run().lastInsertRowid;
  const dayId = database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(pattern, type).lastInsertRowid;
  database.prepare("INSERT INTO schedule_custom_field_values (entry_type, entry_id, custom_field_id, value) VALUES ('pattern_day', ?, ?, 'Room 1')").run(dayId, room);

  database.prepare('INSERT INTO schedule_overrides (user_id, date_key, shift_type_id) VALUES (1, ?, ?)').run('2026-11-02', type);
  const overrideId = database.prepare('SELECT id FROM schedule_overrides WHERE user_id = 1 AND date_key = ?').get('2026-11-02').id;
  database.prepare("INSERT INTO schedule_custom_field_values (entry_type, entry_id, custom_field_id, value) VALUES ('override', ?, ?, 'Room 2')").run(overrideId, room);

  database.prepare('INSERT INTO schedule_extra_shifts (user_id, date_key, shift_type_id) VALUES (1, ?, ?)').run('2026-11-01', type);
  const extraId = database.prepare('SELECT id FROM schedule_extra_shifts WHERE user_id = 1 AND date_key = ?').get('2026-11-01').id;
  database.prepare("INSERT INTO schedule_custom_field_values (entry_type, entry_id, custom_field_id, value) VALUES ('extra_shift', ?, ?, 'Room 3')").run(extraId, room);

  const response = await call('GET', '/entries?from=2026-11-01&to=2026-11-02&user_id=1', { as: ALICE });
  assert.equal(response.status, 200);
  const byDate = Object.fromEntries(response.body.data.entries.map((e) => [`${e.date_key}:${e.source}`, e]));

  assert.deepEqual(byDate['2026-11-01:pattern'].field_values, { [room]: 'Room 1' });
  assert.deepEqual(byDate['2026-11-02:override'].field_values, { [room]: 'Room 2' });
  assert.deepEqual(byDate['2026-11-01:extra'].field_values, { [room]: 'Room 3' }, 'the extra keys off extra_id, not pattern_day_id, even on the same date as the pattern entry');
  assert.deepEqual(byDate['2026-11-01:pattern'].shift_type.fields, [{ id: room, name: 'Room', position: 0, show_in_overlay: true }]);
});

test('members may write only themselves while admins may write any household schedule', async () => {
  const body = { user_id: BOB.id, name: 'Blocked', anchor_date: '2026-11-01', cycle_length: 7, is_active: true };
  const denied = await call('POST', '/patterns', { as: ALICE, body });
  assert.equal(denied.status, 403);
  const allowed = await call('POST', '/patterns', { as: ADMIN, body: { ...body, name: 'Admin pattern', is_active: false } });
  assert.equal(allowed.status, 201);
  assert.equal(allowed.body.data.is_active, 0);
  const self = await call('PUT', '/overrides/2026-11-03', { as: ALICE, body: { user_id: ALICE.id, shift_type_id: null, note: 'Vacation' } });
  assert.equal(self.status, 200);
  const foreign = await call('PUT', '/overrides/2026-11-03', { as: ALICE, body: { user_id: BOB.id, shift_type_id: null } });
  assert.equal(foreign.status, 403);
});

// A shift type belongs to the household, not to a person: it shows up in every
// member's pattern. Anyone may add one - that takes nothing away from anybody -
// but renaming or deleting one is the owner's call, or an admin's. Without this
// any member could rename the family's early shift, and the delete went through
// on nothing but a valid id.
// `dateKeysInRange()` builds one string per day and `resolveEntries()` walks it
// once per household member, synchronously. `from=1000-01-01&to=9999-12-31` is
// roughly 3.3 million days - any signed-in member, or a token scoped to
// schedule:read, could have stalled the server with a single GET.
test('the entries range is capped, and the cap names itself', async () => {
  const huge = await call('GET', '/entries?from=1000-01-01&to=9999-12-31', { as: ALICE });
  assert.equal(huge.status, 400);
  assert.match(huge.body.error, /731 days/);

  // The boundary itself is inclusive on both ends: 731 keys, not 732.
  const atCap = await call('GET', '/entries?from=2026-01-01&to=2028-01-01', { as: ALICE });
  assert.equal(atCap.status, 200, '731 days must still be allowed');

  const overCap = await call('GET', '/entries?from=2026-01-01&to=2028-01-02', { as: ALICE });
  assert.equal(overCap.status, 400, '732 days must not');
});

// `fill` writes real rows, unlike every other range-taking route in this file
// which only reads - its cap (MAX_FILL_DAYS) is therefore its own constant,
// not a reuse of MAX_RANGE_DAYS, and deliberately much smaller (schedule.js
// justifies both numbers separately).
test('overrides can be filled across a date range, self or admin-on-behalf, capped and validated', async () => {
  const denied = await call('POST', '/overrides/fill', { as: ALICE, body: { user_id: BOB.id, from: '2027-03-01', to: '2027-03-05', shift_type_id: null } });
  assert.equal(denied.status, 403, 'a member cannot fill someone else\'s schedule');

  const inverted = await call('POST', '/overrides/fill', { as: ALICE, body: { user_id: ALICE.id, from: '2027-03-10', to: '2027-03-01', shift_type_id: null } });
  assert.equal(inverted.status, 400);
  assert.match(inverted.body.error, /from must be before to/);

  const overCap = await call('POST', '/overrides/fill', { as: ALICE, body: { user_id: ALICE.id, from: '2027-01-01', to: '2027-05-01', shift_type_id: null } });
  assert.equal(overCap.status, 400);
  assert.match(overCap.body.error, /100 days/);

  const badType = await call('POST', '/overrides/fill', { as: ALICE, body: { user_id: ALICE.id, from: '2027-03-01', to: '2027-03-02', shift_type_id: 999999 } });
  assert.equal(badType.status, 400);
  assert.match(badType.body.error, /shift_type_id does not exist/);

  // A pre-existing override in-range must be overwritten, not duplicated -
  // fill uses the same ON CONFLICT upsert as the single-date PUT.
  await call('PUT', '/overrides/2027-03-02', { as: ALICE, body: { user_id: ALICE.id, shift_type_id: typeId, note: 'stale' } });

  const filled = await call('POST', '/overrides/fill', { as: ALICE, body: { user_id: ALICE.id, from: '2027-03-01', to: '2027-03-05', shift_type_id: null, note: 'Vacation' } });
  assert.equal(filled.status, 200);
  assert.equal(filled.body.data.updated, 5, 'five inclusive days, from and to both count');

  const rows = database.prepare('SELECT date_key, shift_type_id, note FROM schedule_overrides WHERE user_id = ? AND date_key BETWEEN ? AND ? ORDER BY date_key').all(ALICE.id, '2027-03-01', '2027-03-05');
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.shift_type_id === null && row.note === 'Vacation'), 'every day in range is free, including the one that was previously "stale"');

  const asAdmin = await call('POST', '/overrides/fill', { as: ADMIN, body: { user_id: BOB.id, from: '2027-03-01', to: '2027-03-02', shift_type_id: typeId } });
  assert.equal(asAdmin.status, 200, 'an admin may fill on behalf of another member');
});

// `DELETE /overrides` (collection) is `/overrides/fill`'s counterpart, for a
// grouped range (client: overrideGroups()) that shrinks or disappears. Unlike
// fill it is a single indexed DELETE, not a per-day write loop, so it carries
// MAX_RANGE_DAYS (the read-side cap) rather than the smaller MAX_FILL_DAYS.
test('a date range of overrides can be deleted in one call, self or admin-on-behalf', async () => {
  const denied = await call('DELETE', '/overrides?user_id=' + BOB.id + '&from=2027-04-01&to=2027-04-05', { as: ALICE });
  assert.equal(denied.status, 403, 'a member cannot clear someone else\'s schedule');

  const inverted = await call('DELETE', '/overrides?user_id=' + ALICE.id + '&from=2027-04-10&to=2027-04-01', { as: ALICE });
  assert.equal(inverted.status, 400);
  assert.match(inverted.body.error, /from must be before to/);

  await call('POST', '/overrides/fill', { as: ALICE, body: { user_id: ALICE.id, from: '2027-04-01', to: '2027-04-10', shift_type_id: null, note: 'Vacation' } });

  // Deleting the middle of a ten-day range must leave exactly the two edges -
  // this is what lets an edit shrink a grouped range from either end without
  // touching the days it kept.
  const deleted = await call('DELETE', '/overrides?user_id=' + ALICE.id + '&from=2027-04-04&to=2027-04-07', { as: ALICE });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.deleted, 4);

  const remaining = database.prepare('SELECT date_key FROM schedule_overrides WHERE user_id = ? AND date_key BETWEEN ? AND ? ORDER BY date_key').all(ALICE.id, '2027-04-01', '2027-04-10').map((r) => r.date_key);
  assert.deepEqual(remaining, ['2027-04-01', '2027-04-02', '2027-04-03', '2027-04-08', '2027-04-09', '2027-04-10']);

  const asAdmin = await call('DELETE', '/overrides?user_id=' + ALICE.id + '&from=2027-04-01&to=2027-04-03', { as: ADMIN });
  assert.equal(asAdmin.status, 200, 'an admin may clear on behalf of another member');
  assert.equal(asAdmin.body.data.deleted, 3);
});

// Migration 183: an override's field_values round-trip through the single-day
// PUT, /overrides/fill applies the same values to every day in the range
// (matching the existing note/reminder_offset_minutes sharing semantics), and
// deleting a value's owning row (single or range) cleans up its values too -
// entry_id is polymorphic (no real FK, see schema comment), so nothing does
// that automatically.
test('an override\'s field_values round-trip, fill shares one set across the range, and deleting an override cleans up its values', async () => {
  const type = (await call('POST', '/shift-types', { as: ALICE, body: { name: 'On call (fields)' } })).body.data.id;
  const client = (await call('POST', '/custom-fields', { as: ALICE, body: { name: 'Client' } })).body.data.id;
  await call('PUT', `/shift-types/${type}/fields`, { as: ALICE, body: { fields: [{ custom_field_id: client, position: 0 }] } });

  const set = await call('PUT', '/overrides/2027-05-01', { as: ALICE, body: { user_id: ALICE.id, shift_type_id: type, field_values: { [client]: 'Acme Corp' } } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.data.field_values, { [client]: 'Acme Corp' });
  const overrideId = set.body.data.id;
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM schedule_custom_field_values WHERE entry_type='override' AND entry_id=?").get(overrideId).c, 1);

  const listed = await call('GET', '/overrides?user_id=' + ALICE.id + '&from=2027-05-01&to=2027-05-01', { as: ALICE });
  assert.deepEqual(listed.body.data[0].field_values, { [client]: 'Acme Corp' });

  const deleted = await call('DELETE', '/overrides/2027-05-01?user_id=' + ALICE.id, { as: ALICE });
  assert.equal(deleted.status, 204);
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM schedule_custom_field_values WHERE entry_type='override' AND entry_id=?").get(overrideId).c, 0, 'deleting the override cleans up its values');

  const filled = await call('POST', '/overrides/fill', { as: ALICE, body: { user_id: ALICE.id, from: '2027-05-10', to: '2027-05-12', shift_type_id: type, field_values: { [client]: 'Beta LLC' } } });
  assert.equal(filled.status, 200);
  const filledRows = database.prepare("SELECT id FROM schedule_overrides WHERE user_id=? AND date_key BETWEEN ? AND ?").all(ALICE.id, '2027-05-10', '2027-05-12');
  assert.equal(filledRows.length, 3);
  for (const row of filledRows) {
    assert.equal(database.prepare("SELECT value FROM schedule_custom_field_values WHERE entry_type='override' AND entry_id=? AND custom_field_id=?").get(row.id, client)?.value, 'Beta LLC');
  }

  const rangeDeleted = await call('DELETE', '/overrides?user_id=' + ALICE.id + '&from=2027-05-10&to=2027-05-12', { as: ALICE });
  assert.equal(rangeDeleted.status, 200);
  assert.equal(rangeDeleted.body.data.deleted, 3);
  for (const row of filledRows) {
    assert.equal(database.prepare("SELECT COUNT(*) AS c FROM schedule_custom_field_values WHERE entry_type='override' AND entry_id=?").get(row.id).c, 0, 'a range delete cleans up every affected row\'s values');
  }
});

test('a shift type may be added by anyone but only changed by its creator or an admin', async () => {
  const created = await call('POST', '/shift-types', { as: ALICE, body: { name: 'Standby', start_time: '18:00', end_time: '20:00' } });
  assert.equal(created.status, 201, 'every member may add a shift type');
  const shiftId = created.body.data.id;
  assert.equal(created.body.data.created_by, ALICE.id, 'the creator is recorded');

  const foreignRename = await call('PUT', `/shift-types/${shiftId}`, { as: BOB, body: { name: 'Renamed by Bob' } });
  assert.equal(foreignRename.status, 403, 'a member does not rename the household shift type');

  const foreignDelete = await call('DELETE', `/shift-types/${shiftId}`, { as: BOB });
  assert.equal(foreignDelete.status, 403, 'nor delete it');

  const ownRename = await call('PUT', `/shift-types/${shiftId}`, { as: ALICE, body: { name: 'Standby late' } });
  assert.equal(ownRename.status, 200);
  assert.equal(ownRename.body.data.name, 'Standby late');

  const adminDelete = await call('DELETE', `/shift-types/${shiftId}`, { as: ADMIN });
  assert.equal(adminDelete.status, 204, 'an admin may clean up any shift type');
});

// A type still referenced by a pattern day is held by the foreign key. The 409
// has to come from THAT and not from any error at all - the branch used to
// catch everything and blame the same cause, so a broken statement would have
// told the caller the type was still in use.
// `color()` in validate.js answers a falsy input with {value: null, error: null},
// so an empty string passes validation and reaches the UPDATE - where the column
// is NOT NULL. The default does not apply to an explicitly bound NULL, so this
// used to surface as an unhandled constraint error and a bare 500. The POST
// handler sidesteps it with a default; PUT had no equivalent.
test('an empty color on PUT keeps the stored one instead of writing NULL', async () => {
  const created = await call('POST', '/shift-types', { as: ALICE, body: { name: 'Late', color: '#123456' } });
  const shiftId = created.body.data.id;

  for (const value of ['', null]) {
    const res = await call('PUT', `/shift-types/${shiftId}`, { as: ALICE, body: { color: value } });
    assert.equal(res.status, 200, `color: ${JSON.stringify(value)} must not blow up`);
    assert.equal(res.body.data.color, '#123456', 'the stored colour survives');
  }

  const bad = await call('PUT', `/shift-types/${shiftId}`, { as: ALICE, body: { color: 'rebeccapurple' } });
  assert.equal(bad.status, 400, 'a malformed colour is still rejected');

  await call('DELETE', `/shift-types/${shiftId}`, { as: ADMIN });
});

test('deleting a shift type that is still in use answers 409, and 404 stays 404', async () => {
  const inUse = await call('DELETE', `/shift-types/${typeId}`, { as: ADMIN });
  assert.equal(inUse.status, 409);
  assert.match(inUse.body.error, /in use/);
  assert.equal(database.prepare('SELECT count(*) AS count FROM schedule_pattern_days WHERE shift_type_id = ?').get(typeId).count, 1,
    'the refusal left the pattern day alone');

  const missing = await call('DELETE', '/shift-types/999999', { as: ADMIN });
  assert.equal(missing.status, 404, 'an unknown id is not "in use"');
});

// Migration 183 (custom fields): a shift type's attached-field set is replaced
// wholesale on every save, same shape as PUT /patterns/:id/days - no natural
// way to tell "unchanged" from "removed" apart in the submitted list either.
test('a shift type\'s attached custom fields can be replaced, reordered, and are ownership-guarded', async () => {
  const type = await call('POST', '/shift-types', { as: ALICE, body: { name: 'Fields host' } });
  const shiftId = type.body.data.id;
  assert.deepEqual(type.body.data.fields, [], 'a freshly created type starts with no fields');

  const room = await call('POST', '/custom-fields', { as: ALICE, body: { name: 'Room' } });
  const instructor = await call('POST', '/custom-fields', { as: ALICE, body: { name: 'Instructor' } });
  const roomId = room.body.data.id;
  const instructorId = instructor.body.data.id;

  const foreign = await call('PUT', `/shift-types/${shiftId}/fields`, { as: BOB, body: { fields: [{ custom_field_id: roomId, position: 0 }] } });
  assert.equal(foreign.status, 403, 'attaching fields is the same ownership rule as editing the shift type itself');

  const attached = await call('PUT', `/shift-types/${shiftId}/fields`, {
    as: ALICE,
    body: { fields: [
      { custom_field_id: roomId, position: 0, show_in_overlay: true },
      { custom_field_id: instructorId, position: 1 },
    ] },
  });
  assert.equal(attached.status, 200);
  assert.equal(attached.body.data.fields.length, 2);
  assert.deepEqual(attached.body.data.fields.map((f) => f.name), ['Room', 'Instructor'], 'order follows position');
  assert.equal(attached.body.data.fields[0].show_in_overlay, true);
  assert.equal(attached.body.data.fields[1].show_in_overlay, false, 'omitted show_in_overlay defaults to false');

  const listed = await call('GET', '/shift-types', { as: ALICE });
  const listedType = listed.body.data.find((t) => t.id === shiftId);
  assert.equal(listedType.fields.length, 2, 'GET /shift-types embeds the same attachment');

  // Re-ordering is the same wholesale replace, not a partial patch - only one
  // field survives here, which is itself the proof that it truly replaces.
  const reordered = await call('PUT', `/shift-types/${shiftId}/fields`, { as: ALICE, body: { fields: [{ custom_field_id: instructorId, position: 0 }] } });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.data.fields.map((f) => f.name), ['Instructor']);

  const duplicate = await call('PUT', `/shift-types/${shiftId}/fields`, { as: ALICE, body: { fields: [{ custom_field_id: roomId, position: 0 }, { custom_field_id: roomId, position: 1 }] } });
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.error, /not repeat/);

  const unknownField = await call('PUT', `/shift-types/${shiftId}/fields`, { as: ALICE, body: { fields: [{ custom_field_id: 999999, position: 0 }] } });
  assert.equal(unknownField.status, 400);
  assert.match(unknownField.body.error, /does not exist/);

  const notArray = await call('PUT', `/shift-types/${shiftId}/fields`, { as: ALICE, body: { fields: 'nope' } });
  assert.equal(notArray.status, 400);

  await call('DELETE', `/shift-types/${shiftId}`, { as: ALICE });
  await call('DELETE', `/custom-fields/${roomId}`, { as: ALICE });
  await call('DELETE', `/custom-fields/${instructorId}`, { as: ALICE });
});

// The status-code test above stays green either way - it measures the outcome,
// not the reason. This one asks the rule directly, so a catch-all can't pass
// itself off as a foreign-key check.
test('only a foreign-key refusal counts as "still in use"', () => {
  // Measured, not guessed: a refused ON DELETE RESTRICT arrives as
  // SQLITE_CONSTRAINT_TRIGGER even though its message says "FOREIGN KEY
  // constraint failed". A check for _FOREIGNKEY alone would miss every one.
  assert.equal(isStillReferenced({ code: 'SQLITE_CONSTRAINT_TRIGGER' }), true);
  assert.equal(isStillReferenced({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }), true);
  assert.equal(isStillReferenced({ code: 'SQLITE_CONSTRAINT' }), true);
  assert.equal(isStillReferenced({ code: 'SQLITE_ERROR' }), false, 'a broken statement is not a reference');
  assert.equal(isStillReferenced(new TypeError('undefined is not a function')), false);
  assert.equal(isStillReferenced(undefined), false);
});

test('schedule routes reject invalid shift times and return data envelopes', async () => {
  const invalid = await call('POST', '/shift-types', { as: ALICE, body: { name: 'Invalid', color: '#abcdef', start_time: '25:61', end_time: '26:00' } });
  assert.equal(invalid.status, 400);
  const listed = await call('GET', '/shift-types', { as: ALICE });
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body.data));
});

// The icon vocabulary itself (Lucide's ~1700 names) lives client-side on
// `window.lucide` - unreachable from the server, same reason quick-links'
// icon field only checks the FORM (lowercase/digits/hyphens, a length cap),
// not the name against a real list. Mirrors quick-links.js's own guard.
test('a shift type may carry an optional icon, validated for form only', async () => {
  const created = await call('POST', '/shift-types', { as: ALICE, body: { name: 'Iconic', color: '#123456', icon: 'sunrise' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.icon, 'sunrise');
  const shiftId = created.body.data.id;

  const malformed = await call('POST', '/shift-types', { as: ALICE, body: { name: 'Bad icon', color: '#123456', icon: 'Sun Rise!' } });
  assert.equal(malformed.status, 400);
  assert.match(malformed.body.error, /icon must contain only lowercase letters, digits, and hyphens/);

  const noIcon = await call('POST', '/shift-types', { as: ALICE, body: { name: 'No icon', color: '#123456' } });
  assert.equal(noIcon.status, 201, 'icon stays optional');
  assert.equal(noIcon.body.data.icon, null);

  const updated = await call('PUT', `/shift-types/${shiftId}`, { as: ALICE, body: { icon: 'moon' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.icon, 'moon');

  const untouched = await call('PUT', `/shift-types/${shiftId}`, { as: ALICE, body: { name: 'Iconic v2' } });
  assert.equal(untouched.status, 200);
  assert.equal(untouched.body.data.icon, 'moon', 'omitting icon on update must not clear it');

  await call('DELETE', `/shift-types/${shiftId}`, { as: ALICE });
});


test('overlapping patterns return a warning and the newer valid_from pattern wins', async () => {
  const carol = database.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES ('schedule-carol', 'Carol', 'x', 'member')").run().lastInsertRowid;
  const newerType = database.prepare("INSERT INTO schedule_shift_types (name, short_code, start_time, end_time, color) VALUES ('Late audit', 'L', '14:00', '22:00', '#123abc')").run().lastInsertRowid;
  const oldPattern = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length, valid_from) VALUES (?, 'Old audit', '2027-01-01', 1, '2027-01-01')").run(carol).lastInsertRowid;
  const newPattern = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length, valid_from) VALUES (?, 'New audit', '2027-01-15', 1, '2027-01-15')").run(carol).lastInsertRowid;
  database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(oldPattern, typeId);
  database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(newPattern, newerType);

  const response = await call('GET', '/entries?from=2027-01-20&to=2027-01-20&user_id=' + carol, { as: ALICE });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.entries[0].shift_type_id, Number(newerType));
  assert.deepEqual(response.body.data.warnings, [{ user_id: Number(carol), date_key: '2027-01-20', pattern_ids: [Number(newPattern), Number(oldPattern)] }]);
});

// Multi-class positions (a timetable) live entirely WITHIN one pattern's one
// day - they must not change what happens BETWEEN two different overlapping
// patterns. The newer pattern still wins outright and the older one's
// classes must not leak into the result just because the winner has several.
test('a multi-class winning pattern still fully replaces an older overlapping one, not merges with it', async () => {
  const dana = database.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES ('schedule-dana', 'Dana', 'x', 'member')").run().lastInsertRowid;
  const mathType = database.prepare("INSERT INTO schedule_shift_types (name, start_time, end_time, color) VALUES ('Math', '08:00', '09:00', '#111111')").run().lastInsertRowid;
  const bioType = database.prepare("INSERT INTO schedule_shift_types (name, start_time, end_time, color) VALUES ('Bio', '09:00', '10:00', '#222222')").run().lastInsertRowid;
  const oldJob = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length, valid_from) VALUES (?, 'Old job', '2027-02-01', 1, '2027-02-01')").run(dana).lastInsertRowid;
  const timetable = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length, valid_from) VALUES (?, 'Timetable', '2027-02-15', 7, '2027-02-15')").run(dana).lastInsertRowid;
  database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(oldJob, typeId);
  database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(timetable, mathType);
  database.prepare('INSERT INTO schedule_pattern_days (pattern_id, position, shift_type_id) VALUES (?, 0, ?)').run(timetable, bioType);

  const response = await call('GET', '/entries?from=2027-02-22&to=2027-02-22&user_id=' + dana, { as: ALICE });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.entries.length, 2, 'both of the winning pattern\'s classes appear, and nothing from the older pattern');
  assert.deepEqual(response.body.data.entries.map((e) => e.shift_type_id).sort(), [bioType, mathType].sort());
  assert.deepEqual(response.body.data.warnings, [{ user_id: Number(dana), date_key: '2027-02-22', pattern_ids: [Number(timetable), Number(oldJob)] }]);
});

// First HTTP-level coverage for the bulk days route accepting the SAME
// position more than once - the whole point of this feature. It used to
// reject that with 400 (a `seen` Set guarded against it); replacing every
// day on every save (not diffing) means a second save with fewer rows for a
// position must also correctly shrink it back down, not leave orphans.
test('PUT /patterns/:id/days accepts several classes at the same position, and a later save can shrink it back down', async () => {
  const mathType = database.prepare("INSERT INTO schedule_shift_types (name, start_time, end_time, color) VALUES ('Math class', '08:00', '09:00', '#333333')").run().lastInsertRowid;
  const bioType = database.prepare("INSERT INTO schedule_shift_types (name, start_time, end_time, color) VALUES ('Bio class', '09:00', '10:00', '#444444')").run().lastInsertRowid;
  const timetableId = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length) VALUES (1, 'Monday timetable', '2027-03-01', 7)").run().lastInsertRowid;

  const filled = await call('PUT', `/patterns/${timetableId}/days`, {
    as: ALICE,
    body: { days: [{ position: 0, shift_type_id: mathType }, { position: 0, shift_type_id: bioType }] },
  });
  assert.equal(filled.status, 200);
  assert.equal(filled.body.data.length, 2);
  assert.deepEqual(filled.body.data.map((d) => d.shift_type_id).sort(), [bioType, mathType].sort());

  const shrunk = await call('PUT', `/patterns/${timetableId}/days`, { as: ALICE, body: { days: [{ position: 0, shift_type_id: mathType }] } });
  assert.equal(shrunk.status, 200);
  assert.equal(shrunk.body.data.length, 1, 'a save with fewer rows for the position must remove what is no longer sent, not add to it');
  assert.equal(shrunk.body.data[0].shift_type_id, Number(mathType));
});

// Migration 183 (custom fields): a pattern day's field_values ride inside the
// SAME wholesale-replace request as its position/shift_type_id, and every
// save assigns the day rows fresh ids (see the comment above PUT
// /patterns/:id/days) - the atomicity claim this design rests on is that the
// FIRST save's values are truly gone after the SECOND, not orphaned under the
// old (now-reused-elsewhere) id space.
test('a pattern day carries field_values, validated against its shift type\'s attached fields, and a resave leaves no orphaned values behind', async () => {
  const mathType = (await call('POST', '/shift-types', { as: ALICE, body: { name: 'Math (fields)' } })).body.data.id;
  const room = (await call('POST', '/custom-fields', { as: ALICE, body: { name: 'Room' } })).body.data.id;
  const instructor = (await call('POST', '/custom-fields', { as: ALICE, body: { name: 'Instructor' } })).body.data.id;
  await call('PUT', `/shift-types/${mathType}/fields`, { as: ALICE, body: { fields: [{ custom_field_id: room, position: 0 }, { custom_field_id: instructor, position: 1 }] } });
  const patternId = database.prepare("INSERT INTO schedule_patterns (user_id, name, anchor_date, cycle_length) VALUES (1, 'Fields pattern', '2027-04-01', 7)").run().lastInsertRowid;

  // A field not attached to the day's shift type is rejected.
  const rejected = await call('PUT', `/patterns/${patternId}/days`, { as: ALICE, body: { days: [{ position: 0, shift_type_id: mathType, field_values: { 999999: 'nope' } }] } });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /not attached/);

  const saved = await call('PUT', `/patterns/${patternId}/days`, {
    as: ALICE,
    body: { days: [{ position: 0, shift_type_id: mathType, field_values: { [room]: 'Room 204', [instructor]: '  Ms. Rivera  ' } } ] },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data[0].field_values, { [room]: 'Room 204', [instructor]: 'Ms. Rivera' }, 'values are trimmed');
  const firstDayId = saved.body.data[0].id;
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM schedule_custom_field_values WHERE entry_type='pattern_day' AND entry_id=?").get(firstDayId).c, 2);

  const listed = await call('GET', `/patterns/${patternId}/days`, { as: ALICE });
  assert.deepEqual(listed.body.data[0].field_values, { [room]: 'Room 204', [instructor]: 'Ms. Rivera' });

  // Re-save with different values - every row gets a fresh id (documented
  // behaviour), so the OLD id's values must be gone, not merely superseded.
  const resaved = await call('PUT', `/patterns/${patternId}/days`, {
    as: ALICE,
    body: { days: [{ position: 0, shift_type_id: mathType, field_values: { [room]: 'Room 105' } } ] },
  });
  assert.equal(resaved.status, 200);
  const secondDayId = resaved.body.data[0].id;
  assert.notEqual(secondDayId, firstDayId, 'the wholesale replace assigns a fresh id');
  assert.deepEqual(resaved.body.data[0].field_values, { [room]: 'Room 105' }, 'instructor was dropped by omitting it');
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM schedule_custom_field_values WHERE entry_type='pattern_day' AND entry_id=?").get(firstDayId).c, 0, 'no orphaned values under the old id');
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM schedule_custom_field_values WHERE entry_type='pattern_day' AND entry_id=?").get(secondDayId).c, 1);
});

// The date arithmetic itself (rangeDifference) is exercised end-to-end by the
// server test above - deleting the middle of a filled range and asserting the
// exact remaining days IS the same computation the client runs locally before
// calling DELETE. This test only pins the wiring: the client groups before
// rendering, an edit reopens with editable bounds instead of a fixed date, and
// a range delete asks first (a single day did not, until it became a group of
// its own - one confirm dialog now covers both, so there is exactly one place
// that can forget to ask before deleting many days at once).
test('the Overrides section groups consecutive same-type days and edits/deletes them as a range', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /function overrideGroups\(overrides = state\.overrides\)/);
  assert.match(schedulePage, /function rangeDifference\(oldFrom, oldTo, newFrom, newTo\)/);
  assert.match(schedulePage, /data-form="override-edit"/);
  assert.match(schedulePage, /data-action="delete-override-range"/);
  assert.match(schedulePage, /overrideGroups\(\)\.find\(/);
  const editBranch = schedulePage.slice(schedulePage.indexOf("form.dataset.form === 'override-edit'"), schedulePage.indexOf("await load();\n    renderPage();"));
  assert.match(editBranch, /confirmModal\(/, 'saving an edited range confirms before writing and deleting');
  assert.match(editBranch, /rangeDifference\(/, 'shrinking a range removes what fell outside it, not just fills the new span');
  const deleteBranch = schedulePage.slice(schedulePage.indexOf("'delete-override-range'"), schedulePage.indexOf("'save-days'"));
  assert.match(deleteBranch, /confirmModal\(/, 'deleting a range confirms first, unlike the old single-day delete');
});

// Real behaviour instead of a name-in-source check (PR #930 review): a text
// guard stays green if overrideGroups() is renamed or gutted to return [].
// Both functions now take their input as a parameter (overrideGroups(overrides),
// already pure for rangeDifference), so a test can hand them real days and
// check the actual grouping/diff instead of asserting on the identifier.
test('overrideGroups() merges consecutive same-series days and splits on a gap or a change', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const row = (id, date_key, overrides = {}) => ({ id, user_id: 1, date_key, shift_type_id: typeId, note: null, ...overrides });

  // Drei aufeinanderfolgende Tage derselben Person/Schicht -> eine Gruppe.
  const consecutive = __test.overrideGroups([row(1, '2027-03-01'), row(2, '2027-03-02'), row(3, '2027-03-03')]);
  assert.equal(consecutive.length, 1, 'three consecutive days of the same type must merge into one group');
  assert.deepEqual([consecutive[0].from, consecutive[0].to], ['2027-03-01', '2027-03-03']);
  assert.deepEqual(consecutive[0].ids, [1, 2, 3]);

  // Eine Luecke (04. fehlt) -> zwei Gruppen, nicht eine ueberspannende.
  const withGap = __test.overrideGroups([row(1, '2027-03-01'), row(2, '2027-03-02'), row(3, '2027-03-05')]);
  assert.equal(withGap.length, 2, 'a gap in the dates must split into two groups');
  assert.deepEqual([withGap[0].from, withGap[0].to], ['2027-03-01', '2027-03-02']);
  assert.deepEqual([withGap[1].from, withGap[1].to], ['2027-03-05', '2027-03-05']);

  // Ein Wechsel der Schichtart mitten in der Reihe splittet ebenso, obwohl die
  // Tage selbst luckenlos sind.
  const otherTypeId = typeId + 1;
  const typeChange = __test.overrideGroups([row(1, '2027-03-01'), row(2, '2027-03-02', { shift_type_id: otherTypeId })]);
  assert.equal(typeChange.length, 2, 'a different shift_type_id must not merge with its neighbour');

  // Migration 183: field_values carry the same "must match to merge" rule as
  // note already did - two consecutive days with different values are not
  // one range, even though shift type and note happen to be identical.
  const differentFieldValues = __test.overrideGroups([
    row(1, '2027-03-01', { field_values: { 7: 'Room 204' } }),
    row(2, '2027-03-02', { field_values: { 7: 'Room 99' } }),
  ]);
  assert.equal(differentFieldValues.length, 2, 'different field_values must not merge with its neighbour');

  const sameFieldValues = __test.overrideGroups([
    row(1, '2027-03-01', { field_values: { 7: 'Room 204' } }),
    row(2, '2027-03-02', { field_values: { 7: 'Room 204' } }),
  ]);
  assert.equal(sameFieldValues.length, 1, 'identical field_values must still merge');
  assert.deepEqual(sameFieldValues[0].field_values, { 7: 'Room 204' });
});

test('sameFieldValues() compares by key and value, not by object identity or key order', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  assert.equal(__test.sameFieldValues(undefined, undefined), true, 'two absent field_values are equal');
  assert.equal(__test.sameFieldValues({}, {}), true);
  assert.equal(__test.sameFieldValues({ 1: 'a', 2: 'b' }, { 2: 'b', 1: 'a' }), true, 'key order does not matter');
  assert.equal(__test.sameFieldValues({ 1: 'a' }, { 1: 'b' }), false, 'same key, different value');
  assert.equal(__test.sameFieldValues({ 1: 'a' }, { 1: 'a', 2: 'b' }), false, 'a superset is not equal');
  assert.equal(__test.sameFieldValues({}, undefined), true, 'an empty object and an absent value are both "nothing set"');
});

// Migration 183: overlayMeta() feeds the Today card's meta line - note plus
// every show_in_overlay field that actually has a value, a field attached but
// not flagged stays out even with a value, and a flagged field with no value
// stays out too (nothing to show).
test('overlayMeta() joins the note with show_in_overlay fields that have a value, and only those', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const shift_type = { fields: [
    { id: 1, name: 'Room', show_in_overlay: true },
    { id: 2, name: 'Instructor', show_in_overlay: false },
    { id: 3, name: 'Notes', show_in_overlay: true },
  ] };
  assert.equal(__test.overlayMeta({ note: null, shift_type, field_values: { 1: 'Room 204', 2: 'Ms. Rivera' } }), 'Room: Room 204', 'the non-overlay field is excluded even with a value');
  assert.equal(__test.overlayMeta({ note: 'Bring textbook', shift_type, field_values: { 1: 'Room 204' } }), 'Bring textbook · Room: Room 204', 'note comes first');
  assert.equal(__test.overlayMeta({ note: null, shift_type, field_values: { 3: '' } }), '', 'an overlay field with no value contributes nothing');
  assert.equal(__test.overlayMeta({ note: null, shift_type: null, field_values: {} }), '', 'a free day (no shift type) has no fields to show');
});

// Overview tab: lane order tracks SELECTION order, never activity - the whole
// point of the side-by-side view is that "person 2's column" stays put day
// to day, so a person with more entries must not be promoted ahead of one
// selected before them.
test('buildOverviewLanes() keeps lane order fixed by selection, and always renders an empty lane', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const entries = [
    { user_id: 2, date_key: '2026-09-07', shift_type_id: 10 },
    { user_id: 2, date_key: '2026-09-07', shift_type_id: 11 },
    { user_id: 2, date_key: '2026-09-07', shift_type_id: 12 },
  ];
  const result = __test.buildOverviewLanes(['2026-09-07'], [1, 2], entries);
  assert.equal(result.length, 1);
  assert.equal(result[0].lanes.length, 2, 'a lane exists for every selected person, even one with nothing');
  assert.equal(result[0].lanes[0].userId, 1, 'the first-selected person stays in lane 0');
  assert.deepEqual(result[0].lanes[0].entries, [], 'lane 0 is empty, not skipped');
  assert.equal(result[0].lanes[1].userId, 2);
  assert.equal(result[0].lanes[1].entries.length, 3, 'lane 1 carries all three of person 2\'s entries');
});

test('buildOverviewLanes() only matches entries on the same day and person', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const entries = [
    { user_id: 1, date_key: '2026-09-07', shift_type_id: 10 },
    { user_id: 1, date_key: '2026-09-08', shift_type_id: 11 },
    { user_id: 2, date_key: '2026-09-07', shift_type_id: 12 },
  ];
  const result = __test.buildOverviewLanes(['2026-09-07', '2026-09-08'], [1], entries);
  assert.equal(result[0].lanes[0].entries.length, 1);
  assert.equal(result[0].lanes[0].entries[0].shift_type_id, 10);
  assert.equal(result[1].lanes[0].entries.length, 1);
  assert.equal(result[1].lanes[0].entries[0].shift_type_id, 11);
});

// Fix 2026-09-04: a night shift (22:00-06:00) only ever showed its
// before-midnight half - the after-midnight half vanished entirely once the
// start day was over. buildOverviewLanes() now injects a continuation entry
// onto the following day so the whole shift stays visible.
test('buildOverviewLanes() carries an overnight shift onto the next day as a continuation entry', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const night = { user_id: 3, date_key: '2026-09-11', shift_type_id: 9, shift_type: { start_time: '22:00', end_time: '06:00' } };
  const result = __test.buildOverviewLanes(['2026-09-11', '2026-09-12'], [3], [night]);
  assert.equal(result[0].lanes[0].entries.length, 1, 'the real entry stays on its own start day');
  assert.equal(result[0].lanes[0].entries[0].__continuation, undefined);
  assert.equal(result[1].lanes[0].entries.length, 1, 'a continuation entry appears on the following day');
  assert.equal(result[1].lanes[0].entries[0].__continuation, true);
  assert.equal(result[1].lanes[0].entries[0].shift_type_id, 9, 'the continuation carries the same shift data');
});

test('buildOverviewLanes() does not carry a continuation past the visible days, and does not double it for a same-day-ending shift', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const night = { user_id: 3, date_key: '2026-09-11', shift_type_id: 9, shift_type: { start_time: '22:00', end_time: '06:00' } };
  const dayShift = { user_id: 1, date_key: '2026-09-11', shift_type_id: 7, shift_type: { start_time: '06:00', end_time: '14:00' } };
  const result = __test.buildOverviewLanes(['2026-09-11'], [1, 3], [night, dayShift]);
  assert.equal(result[0].lanes[0].entries.length, 1, 'a plain day shift never gets a continuation');
  assert.equal(result[0].lanes[1].entries.length, 1, 'the overnight shift itself is unaffected when its next day is not even shown');
});

test('a continuation entry sorts to the very top of its lane, ahead of the day\'s own early entries', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const night = { user_id: 3, date_key: '2026-09-11', shift_type_id: 9, shift_type: { start_time: '22:00', end_time: '06:00' }, label: 'night' };
  const earlyNextDay = { user_id: 3, date_key: '2026-09-12', shift_type_id: 1, shift_type: { start_time: '01:00', end_time: '02:00' }, label: 'oddly-early' };
  const result = __test.buildOverviewLanes(['2026-09-11', '2026-09-12'], [3], [night, earlyNextDay]);
  const labels = result[1].lanes[0].entries.map((e) => e.label);
  assert.deepEqual(labels, ['night', 'oddly-early'], 'the continuation (00:00) sorts before a 01:00 entry on the same day');
});

test('a "free day" marker on the day a continuation lands is dropped, not shown alongside it', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const night = { user_id: 3, date_key: '2026-09-12', shift_type_id: 9, shift_type: { start_time: '22:00', end_time: '06:00' } };
  const freeMarker = { user_id: 3, date_key: '2026-09-13', shift_type: null, is_free: true };
  const result = __test.buildOverviewLanes(['2026-09-12', '2026-09-13'], [3], [night, freeMarker]);
  const sundayEntries = result[1].lanes[0].entries;
  assert.equal(sundayEntries.length, 1, 'only the continuation remains - the misleading "free" marker is dropped');
  assert.equal(sundayEntries[0].__continuation, true);
});

// Jede Spur wird chronologisch nach Beginn sortiert, unabhaengig von der
// Reihenfolge, in der GET /entries die Bloecke eines Tages liefert - sonst
// koennte "5. Stunde" vor "1. Stunde" in der Liste stehen.
test('buildOverviewLanes() sorts each lane chronologically by start time, regardless of input order', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const entries = [
    { user_id: 1, date_key: '2026-09-07', shift_type: { start_time: '11:40', end_time: '12:25' }, label: 'late' },
    { user_id: 1, date_key: '2026-09-07', shift_type: { start_time: '08:00', end_time: '08:45' }, label: 'early' },
    { user_id: 1, date_key: '2026-09-07', shift_type: null, label: 'free-marker' },
  ];
  const result = __test.buildOverviewLanes(['2026-09-07'], [1], entries);
  const labels = result[0].lanes[0].entries.map((entry) => entry.label);
  assert.deepEqual(labels, ['free-marker', 'early', 'late'], 'untimed first, then ascending by start time');
});

// Kurskorrektur nach Live-Test (2026-09-04): eine gemeinsame, durchgehende
// 24h-Skala zwang eine 45-Minuten-Schulstunde und eine 8-Stunden-Schicht auf
// denselben Massstab. computeActiveHours() traegt nur noch Stunden, die
// irgendjemand aus der Auswahl tatsaechlich belegt.
test('computeActiveHours() drops hours nobody selected occupies, and falls back with no timed entries at all', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  assert.deepEqual(__test.computeActiveHours([]), Array.from({ length: 14 }, (_, i) => i + 6), 'fallback band with nothing timed');
  const school = [{ shift_type: { start_time: '08:00', end_time: '08:45' } }, { shift_type: { start_time: '12:30', end_time: '13:15' } }];
  assert.deepEqual(__test.computeActiveHours(school), [8, 12, 13], '09-11 has nothing in it and is dropped entirely');
  // Beide Haelften einer Nachtschicht zaehlen (Fix 2026-09-04) - sonst haette
  // eine Fortsetzungszeile auf dem Folgetag keine aktive Stunde zum Andocken.
  const overnight = [{ shift_type: { start_time: '22:00', end_time: '06:00' } }];
  assert.deepEqual(__test.computeActiveHours(overnight), [0, 1, 2, 3, 4, 5, 22, 23], 'both the before- and after-midnight hours count as active');
});

// Review-Fund 2026-09-05 (#1022): activeHours filterte strikt nach
// visibleDateKeys, ohne eine Nachtschicht des Vortags zu beruecksichtigen,
// deren Fortsetzung auf einen sichtbaren Tag faellt. In der Tagesansicht
// direkt nach einer Nachtschicht war visibleDateKeys dann genau EIN Tag, der
// Originaleintrag (datiert auf den Vortag) fiel durchs Sieb, und
// computeActiveHours() sah gar keinen bezeiteten Eintrag - obwohl
// buildOverviewLanes() die Fortsetzung selbst unabhaengig davon zeigt.
test('touchesVisibleDay() counts a previous day\'s overnight shift when its continuation lands on a visible day', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const night = { date_key: '2026-09-11', shift_type: { start_time: '22:00', end_time: '06:00' } };
  const dayShift = { date_key: '2026-09-11', shift_type: { start_time: '08:00', end_time: '16:00' } };

  assert.equal(__test.touchesVisibleDay(night, new Set(['2026-09-11'])), true, 'an entry on a visible day always counts');
  assert.equal(
    __test.touchesVisibleDay(night, new Set(['2026-09-12'])), true,
    'day view of 12 Sept alone must still see the night shift that started on the 11th',
  );
  assert.equal(
    __test.touchesVisibleDay(dayShift, new Set(['2026-09-12'])), false,
    'a plain (non-overnight) shift on a day that is not visible must not count',
  );
  assert.equal(
    __test.touchesVisibleDay(night, new Set(['2026-09-13'])), false,
    'the continuation only lands on the immediate next day - it does not reach two days out',
  );
});

test('computeActiveHours() sees a full-height continuation in a single-day view right after a night shift, not the default fallback', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const night = { date_key: '2026-09-11', shift_type: { start_time: '22:00', end_time: '06:00' } };
  const visibleDateKeys = new Set(['2026-09-12']); // day view showing only the day AFTER the shift started
  const selected = [night].filter((entry) => __test.touchesVisibleDay(entry, visibleDateKeys));
  assert.deepEqual(
    __test.computeActiveHours(selected), [0, 1, 2, 3, 4, 5, 22, 23],
    'the night shift counts even though its own date_key (11th) is not the visible day (12th) - ' +
    'without this the axis fell back to the default 06-19 band and the continuation collapsed to 18px',
  );
});

test('collapsedMinutes() maps clock time onto the collapsed scale, and puts an exact-hour end at the end of the PRECEDING hour', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const activeHours = [8, 12, 13]; // 09-11 dropped, matching the fixture above
  assert.equal(__test.collapsedMinutes(8 * 60, activeHours), 0, 'start of the first active hour is the very top');
  assert.equal(__test.collapsedMinutes(8 * 60 + 45, activeHours), 45, 'still inside hour 8, no jump yet');
  assert.equal(__test.collapsedMinutes(12 * 60, activeHours), 60, 'hour 12 starts right after hour 8 ends - 09-11 contribute nothing');
  assert.equal(__test.collapsedMinutes(9 * 60, activeHours), 60, 'an entry ending exactly at 09:00 (a dropped hour) belongs to the end of hour 8s row, not a hour that contributes nothing');
  assert.equal(__test.collapsedMinutes(13 * 60 + 15, activeHours), 135, '13 is itself active, so 13:15 is a plain lookup - no boundary special-case needed');
});

test('normalizeOverviewSelection() drops ids no longer eligible, without throwing', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  assert.deepEqual(__test.normalizeOverviewSelection([1, 2, 3], [1, 3]), [1, 3], 'a since-demoted/removed id is silently dropped');
  assert.deepEqual(__test.normalizeOverviewSelection([], [1, 2]), []);
  assert.deepEqual(__test.normalizeOverviewSelection(null, [1, 2]), [], 'a non-array input is treated as no selection, not an error');
  assert.deepEqual(__test.normalizeOverviewSelection(undefined, [1, 2]), []);
});

test('rangeDifference() finds exactly what fell outside a shrunk range, and nothing when it only grew', async () => {
  const { __test } = await import('../public/pages/schedule.js');

  // Verkuerzt an BEIDEN Enden: zwei Reststuecke.
  assert.deepEqual(
    __test.rangeDifference('2027-04-01', '2027-04-10', '2027-04-03', '2027-04-07'),
    [{ from: '2027-04-01', to: '2027-04-02' }, { from: '2027-04-08', to: '2027-04-10' }],
  );

  // Verkuerzt nur am Ende: ein Reststueck.
  assert.deepEqual(
    __test.rangeDifference('2027-04-01', '2027-04-10', '2027-04-01', '2027-04-07'),
    [{ from: '2027-04-08', to: '2027-04-10' }],
  );

  // Nur erweitert, nicht verkuerzt: keine Reststuecke - eine Erweiterung darf
  // nichts loeschen, das ist der Unterschied zwischen "editieren" und "fuellen".
  assert.deepEqual(__test.rangeDifference('2027-04-03', '2027-04-07', '2027-04-01', '2027-04-10'), []);
});

// Extras used to render one row per day even for a range created via
// /extras/fill - the same "nice summary" overrides already had was missing
// here (user feedback). Extras have no ON CONFLICT like overrides though (no
// unique (user_id, date_key) to upsert against), so editing a group can't
// reuse rangeDifference()/fill-in-place - it creates fresh rows for the new
// range first and only deletes the old ids afterwards, so a failed second
// step leaves a duplicate rather than losing data.
test('the Extra shifts section groups consecutive same-type days and edits/deletes them as a range', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /function extraGroups\(\)/);
  assert.match(schedulePage, /data-form="extra-edit-range"/);
  assert.match(schedulePage, /data-action="edit-extra-range"/);
  assert.match(schedulePage, /data-action="delete-extra-range"/);
  assert.match(schedulePage, /extraGroups\(\)\.find\(/);
  assert.doesNotMatch(schedulePage, /function openExtraEditModal\(/, 'the single-row edit modal is fully replaced by the group modal');
  assert.doesNotMatch(schedulePage, /data-action="edit-extra"/, 'no single-row edit action should remain');

  const groupsFn = schedulePage.slice(schedulePage.indexOf('function extraGroups()'), schedulePage.indexOf('function extraRows()'));
  assert.match(groupsFn, /reminder_offset_minutes/, 'grouping must not merge extras with different reminder offsets into one row');

  const editBranch = schedulePage.slice(schedulePage.indexOf("form.dataset.form === 'extra-edit-range'"), schedulePage.indexOf('await load();'));
  assert.match(editBranch, /api\.post\('\/schedule\/extras'/, 'a single-day edit still uses the plain create endpoint');
  assert.match(editBranch, /api\.post\('\/schedule\/extras\/fill'/, 'a multi-day edit still uses the fill endpoint');
  assert.match(editBranch, /data\.ids\.split\(','\)/, 'the old ids are deleted individually, extras have no range-delete endpoint');
  const postIndex = editBranch.indexOf("api.post('/schedule/extras");
  const deleteIndex = editBranch.indexOf('api.delete');
  assert.ok(postIndex < deleteIndex, 'the new rows must be created before the old ones are deleted, so a failed create never loses data');

  const deleteBranch = schedulePage.slice(schedulePage.indexOf("'delete-extra-range'"), schedulePage.indexOf("'save-days'"));
  assert.match(deleteBranch, /confirmModal\(/, 'deleting a range confirms first, matching the override range delete');
});

// The three library tabs (shift types, patterns, overrides) are one module,
// not three, and their empty states used to say otherwise: overrides fell back
// to a bare paragraph while its siblings already used the shared
// emptyStateHTML grammar (icon, title, description, CTA). Caught after a user
// noticed the mismatch directly - the same regression an add-only PR review
// would not catch, since a bare `<p>` still renders "something."
test('all three Schedule library tabs share the same empty-state grammar', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /function emptyOverrideState\(\)/);
  const emptyOverrideBody = schedulePage.slice(schedulePage.indexOf('function emptyOverrideState'), schedulePage.indexOf('function overrideRows'));
  assert.match(emptyOverrideBody, /emptyStateHTML\(/, 'overrides must use the shared empty-state component, like patterns and shift types');
  assert.doesNotMatch(schedulePage, /if \(!groups\.length\) return '<p>'/, 'the old bare-paragraph empty state must not come back');
});

// Vacation/Sick are shift types without a start/end time - the schema already
// allows this (start_time and end_time are nullable as a pair, and a type
// without them renders as "all day"), so an absence reason needed no new
// column or endpoint, only two more preset entries. Verified server-side too,
// by the existing 'schedule routes reject invalid shift times' test elsewhere
// in this file exercising the same POST /shift-types with null times.
// Shared across every quickstart template (work/school/university), not
// duplicated per template - absence-marking is the same need everywhere.
test('quick-start includes Vacation and Sick as timeless presets, not just work shifts', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  const presetsBlock = schedulePage.slice(schedulePage.indexOf('const SHARED_PRESETS'), schedulePage.indexOf(']);') + 3);
  assert.match(presetsBlock, /key: 'vacation'.*startTime: null.*endTime: null/, 'vacation must carry no times, like a real absence rather than a shift');
  assert.match(presetsBlock, /key: 'sick'.*startTime: null.*endTime: null/, 'sick must carry no times, like a real absence rather than a shift');
});

// Quickstart used to be a single fixed 7-preset button, gated by "does the
// household have any shift type yet" - fine for one template, wrong once a
// second one might reasonably run later (Work for a parent, then School for
// a kid). It must offer all three, key its guard on the shift-type's own
// short_code (skip what's already there) rather than blocking outright, and
// stay reachable after the first type exists, not just from the empty state.
test('quickstart offers three templates and only skips presets already present, not the whole run', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /const PRESET_TEMPLATES = Object\.freeze\(\{/);
  assert.match(schedulePage, /work: Object\.freeze\(\[/);
  assert.match(schedulePage, /school: Object\.freeze\(\[/);
  assert.match(schedulePage, /university: Object\.freeze\(\[/);
  assert.match(schedulePage, /const QUICKSTART_TEMPLATES = \[\['work', 'schedule\.templateWork'\], \['school', 'schedule\.templateSchool'\], \['university', 'schedule\.templateUniversity'\]\];/);
  assert.match(schedulePage, /'data-action': 'quick-start-shifts', 'data-template': key/, 'the empty state builds one quickstart action per still-visible template');
  assert.match(schedulePage, /data-action="quick-start-shifts" data-template="' \+ template \+ '"/, 'the persistent header picker offers the same still-visible templates, not just the empty state');

  const handler = schedulePage.slice(schedulePage.indexOf("button.dataset.action === 'quick-start-shifts'"), schedulePage.indexOf("if (button.dataset.action === 'pick-shift-icon'"));
  assert.doesNotMatch(handler, /if \(state\.types\.length\) return;/, 'a second template must not be blocked just because a first one already ran');
  assert.match(handler, /existingCodes\.has\(preset\.shortCode\)/, 're-running (or a second) template must skip what already exists by short_code, not error or duplicate');
});

// Which templates are even offered is itself a household-wide preference
// (server/routes/preferences.js#schedule_hidden_templates) - a household that
// only needs Work shouldn't see School/University buttons forever. Both
// entry points (empty state and the persistent header) must respect it, and
// hiding every template must not leave a broken empty wrapper behind.
test('the quickstart template list is filtered by the household schedule_hidden_templates preference', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /function visibleQuickstartTemplates\(\)/);
  assert.match(schedulePage, /const hidden = new Set\(state\.hiddenTemplates \?\? \[\]\);/);
  assert.match(schedulePage, /QUICKSTART_TEMPLATES\.filter\(\(\[key\]\) => !hidden\.has\(key\)\)/);
  assert.match(schedulePage, /visibleQuickstartTemplates\(\)\.map/, 'the empty state must consume the filtered list, not the raw one');
  assert.match(schedulePage, /state\.types\.length && visibleQuickstartTemplates\(\)\.length \? '<div class="segmented"/, 'the header picker must not render an empty wrapper once every template is hidden');
  assert.match(schedulePage, /hiddenTemplates: Array\.isArray\(householdPrefs\.data\?\.schedule_hidden_templates\)/, 'load() must read the household preference, not just default to showing everything');
});

// The icon-picker button is wired twice, on purpose: the create modal hangs
// off document.body (openScheduleCreateModal's onSave attaches directly,
// root's click delegate never reaches it), the inline shift-type edit form
// lives inside `root` and goes through action()'s delegate instead. Missing
// either wiring leaves that form's icon button doing nothing on click.
test('the shift-type icon picker is wired for both the create modal and inline edit', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /async function pickShiftIcon\(button\)/);
  assert.match(schedulePage, /data-action="pick-shift-icon"/);
  assert.match(schedulePage, /querySelector\('\[data-action="pick-shift-icon"\]'\)\?\.addEventListener\('click'/, 'the create modal must attach its own listener - root\'s delegate cannot reach it');
  assert.match(schedulePage, /button\.dataset\.action === 'pick-shift-icon'/, 'the inline edit form relies on the action() delegate');
  assert.match(schedulePage, /import\('\/components\/icon-picker\.js'\)/, 'reuses the shared icon picker rather than a new dialog');
});

// Overrides (replaces what a pattern says for a day) and extras (adds
// alongside it) are NOT folded into the same tab because they're the same
// thing - a separate Overrides tab was removed in favor of one Patterns tab
// showing all three lists (patterns, overrides, extras) and one create modal
// with a single upfront 3-way mode picker (pattern / replace / add) instead
// of two nested toggles - each mode lives in its own <fieldset> that's
// `disabled` whenever it isn't the active mode, so FormData and native
// validation both skip the inactive fields automatically (a hidden-but-still-
// required field previously blocked Save silently - see the git history for
// the repro).
test('the Patterns tab folds patterns, overrides, and extras into one tab and one 3-way create modal', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  const tabsBlock = schedulePage.slice(schedulePage.indexOf('const tabs = ['), schedulePage.indexOf('];', schedulePage.indexOf('const tabs = [')));
  assert.doesNotMatch(tabsBlock, /'overrides'/, 'overrides must not be its own tab anymore');
  assert.match(tabsBlock, /'shifts'/);
  assert.match(tabsBlock, /'patterns'/);
  assert.match(tabsBlock, /'statistics'/);

  const patternsBranch = schedulePage.slice(schedulePage.indexOf("activeView === 'patterns'"), schedulePage.indexOf(': renderStatistics()'));
  assert.match(patternsBranch, /schedule-library--patterns/);
  assert.match(patternsBranch, /schedule-library--overrides/, 'the overrides list must render inside the patterns branch, not a separate view');
  assert.match(patternsBranch, /schedule-library--extras/, 'the extras list must render inside the patterns branch, not a separate view');
  assert.match(patternsBranch, /data-action="open-create-override"/);
  assert.match(patternsBranch, /data-action="open-create-extra"/);

  const modalFn = schedulePage.slice(schedulePage.indexOf("function openScheduleCreateModal"), schedulePage.indexOf('async function saveCreatedSchedule'));
  assert.match(modalFn, /name="mode"/, 'a hidden field must carry the active mode');
  assert.match(modalFn, /\[\['pattern', 'schedule\.pattern'\], \['replace', 'schedule\.override'\], \['add', 'schedule\.extraBadgeLabel'\]\]/, 'the 3-way mode picker must offer pattern/replace/add');
  assert.match(modalFn, /data-mode="'\s*\+\s*value\s*\+\s*'"/, 'each segmented button must carry its own mode via data-mode');
  assert.match(modalFn, /data-field="mode-pattern"/);
  assert.match(modalFn, /data-field="one-time-shared"/);
  assert.match(modalFn, /data-field="mode-replace"/);
  assert.match(modalFn, /data-field="mode-add"/);
  // Every non-active fieldset must ship `disabled` in its initial markup too,
  // not just `hidden` - `hidden` alone is exactly the bug that shipped.
  assert.match(modalFn, /data-field="mode-pattern"'\s*\+\s*\(mode === 'pattern' \? '' : ' hidden disabled'\)/);
  assert.match(modalFn, /setGroup\('mode-pattern', mode === 'pattern'\)/, 'the mode-switch handler must toggle disabled, not just hidden');
  assert.match(modalFn, /typeOptions\(null\)/, 'the replace-mode type select must include the free-day option (default includeFree=true)');
  assert.match(modalFn, /typeOptions\(null, false\)/, 'the add-mode type select must exclude the free-day option - an extra always names a real shift');

  const saveFn = schedulePage.slice(schedulePage.indexOf('async function saveCreatedSchedule'), schedulePage.indexOf('function formData'));
  assert.match(saveFn, /data\.mode === 'pattern'/, 'must branch on the pattern mode');
  assert.match(saveFn, /data\.mode === 'replace'/, 'must branch on the replace mode');
  assert.match(saveFn, /api\.post\('\/schedule\/patterns', data\)/, 'pattern branch still posts a pattern');
  assert.match(saveFn, /api\.put\('\/schedule\/overrides\/'/, 'replace branch still posts an override');
  assert.match(saveFn, /api\.post\('\/schedule\/extras', /, 'add branch still posts an extra');
  assert.doesNotMatch(schedulePage, /function openExtraCreateModal/, 'the standalone extras-only create modal must be fully replaced by the unified one');
});

// Lucide's createIcons() replaces an <i data-lucide> element with an <svg
// class="lucide ..."> IN PLACE, it does not just decorate the existing <i>.
// A cleanup that only ever looks for an <i> therefore finds nothing to
// remove after the first pick, and every subsequent pick just stacks
// another icon into the button instead of replacing the old one.
function makeFakeIconButton() {
  const button = {
    children: [],
    querySelectorAll(selector) {
      const wantsI = selector.includes('i[data-lucide]');
      const wantsSvg = selector.includes('svg.lucide');
      return button.children.filter((node) => (wantsI && node.tag === 'i' && 'data-lucide' in node.attrs)
        || (wantsSvg && node.tag === 'svg' && (node.attrs.class || '').split(' ').includes('lucide')))
        .map((node) => ({ remove: () => { button.children = button.children.filter((other) => other !== node); } }));
    },
    insertAdjacentHTML(position, html) {
      const match = html.match(/data-lucide="([^"]+)"/);
      const node = { tag: 'i', attrs: { 'data-lucide': match ? match[1] : '' } };
      if (position === 'afterbegin') button.children.unshift(node);
      else button.children.push(node);
    },
  };
  return button;
}

test('setShiftIconButtonIcon replaces the previous icon even after lucide has converted it to an <svg>, so repeated picks never stack icons', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    lucide: {
      createIcons({ el }) {
        el.children = el.children.map((node) => ((node.tag === 'i' && 'data-lucide' in node.attrs)
          ? { tag: 'svg', attrs: { class: `lucide lucide-${node.attrs['data-lucide']}` } }
          : node));
      },
    },
  };
  try {
    const { __test } = await import('../public/pages/schedule.js');
    const button = makeFakeIconButton();
    __test.setShiftIconButtonIcon(button, 'shield');
    __test.setShiftIconButtonIcon(button, 'key');
    __test.setShiftIconButtonIcon(button, 'mail');
    __test.setShiftIconButtonIcon(button, 'clock');
    assert.equal(button.children.length, 1, 'only the most recently picked icon should remain, not one per pick');
    assert.equal(button.children[0].attrs.class, 'lucide lucide-clock');
  } finally {
    globalThis.window = originalWindow;
  }
});

// Rebuilding .schedule-body on every renderPage() call can destroy whatever
// currently holds focus (e.g. the Statistics tab's own persistent form
// controls, which trigger a render on every change) - losing focus resets it
// to <body>, and the browser scrolls #main-content (the app's real
// scrollport, see router.js) back to the top. renderPage() must snapshot and
// restore that scrollTop around its own DOM mutation, or every click/change
// on the Statistics tab visibly jumps the page to the top.
test('renderPage() preserves the #main-content scroll position across its own DOM rebuild', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  const body = schedulePage.slice(schedulePage.indexOf('function renderPage()'), schedulePage.indexOf('function updateScheduleFab()'));
  assert.match(body, /const scrollPort = document\.getElementById\('main-content'\);/);
  assert.match(body, /const scrollTop = scrollPort\?\.scrollTop \?\? 0;/, 'must capture the scroll position before body.replaceChildren() runs');
  assert.match(body, /if \(scrollPort\) scrollPort\.scrollTop = scrollTop;/, 'must restore the scroll position after the DOM rebuild completes');
  const saveIndex = body.indexOf('const scrollTop = scrollPort');
  const rebuildIndex = body.indexOf('body.replaceChildren()');
  const restoreIndex = body.indexOf('scrollPort.scrollTop = scrollTop;');
  assert.ok(saveIndex < rebuildIndex && rebuildIndex < restoreIndex, 'save must happen before the rebuild and restore must happen after it, not interleaved');
});

// Overtime must be caught over ANY rolling 7-day stretch, not fixed calendar
// weeks (Mon-Sun) and not averaged across the whole selected range. Fixed
// weeks would cut a contiguous work stretch that straddles a week boundary
// into two halves, neither of which alone crosses the threshold - a single
// genuinely-over 30-day range's total (3000 min) is also nowhere near a
// whole-range average threshold (~10286 min at 40h/week over 30 days), which
// was the original, wrong design (most people don't work all 7 days of a
// week, so spreading the weekly target evenly across every calendar day set
// a target a real week's hours could rarely cross).
test('overtimeInfo() catches a work stretch that straddles a calendar-week boundary, which fixed Mon-Sun weeks would have missed', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const longShift = { start_time: '08:00', end_time: '18:00' }; // 10h
  // Thu Sep 10 through Mon Sep 14 2026: five consecutive 10h days that split
  // 4/1 across the Sun 13 / Mon 14 calendar-week boundary - fixed weeks would
  // see 40h in one half and 10h in the other, neither over a 40h target.
  const entries = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']
    .map((date_key) => ({ date_key, shift_type: longShift }));
  const result = __test.overtimeInfo(entries, 40);
  assert.equal(result.over, true, 'five consecutive 10h days is 50h in any 7-day window that contains them all, regardless of which calendar week they land in');
  assert.equal(result.excessMinutes, 600, 'only the 10h (600 min) over the 40h/week target counts, not the stretch\'s full 50h');
});

test('overtimeInfo() flags a single real overtime week even when the rest of a 30-day range is quiet, and reports only the worst window\'s excess', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const longShift = { start_time: '08:00', end_time: '18:00' }; // 10h
  const entries = [
    { date_key: '2026-09-07', shift_type: longShift },
    { date_key: '2026-09-08', shift_type: longShift },
    { date_key: '2026-09-09', shift_type: longShift },
    { date_key: '2026-09-10', shift_type: longShift },
    { date_key: '2026-09-11', shift_type: longShift }, // Mon-Fri, 50h total
    { date_key: '2026-09-20', shift_type: null }, // a free day elsewhere in the range
  ];
  const result = __test.overtimeInfo(entries, 40);
  assert.equal(result.over, true, 'one 50h week must flag, regardless of how quiet the rest of the range was');
  assert.equal(result.excessMinutes, 600, 'only the 10h (600 min) that crossed the 40h/week target counts, not the week\'s full total');
});

test('overtimeInfo() never flags when no 7-day window crossed the target', async () => {
  const { __test } = await import('../public/pages/schedule.js');
  const normalShift = { start_time: '09:00', end_time: '17:00' }; // 8h
  const entries = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']
    .map((date_key) => ({ date_key, shift_type: normalShift })); // Mon-Fri, 40h exactly
  const result = __test.overtimeInfo(entries, 40);
  assert.equal(result.over, false);
  assert.equal(result.excessMinutes, 0);
});

test('the weekly-hours target is a per-user preference, fetched and saved through /schedule/preferences', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /api\.get\('\/schedule\/preferences'\)/);
  assert.match(schedulePage, /savePreference\(\{ weeklyHours: hours \}\)/);
  assert.match(schedulePage, /id="schedule-weekly-hours"/);
});

test('the Statistics tab offers a print action that leaves nav/tabs/filters off the page', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /data-action="print-statistics"/);
  assert.match(schedulePage, /window\.print\(\)/);
  const scheduleCss = readFileSync(new URL('../public/styles/schedule.css', import.meta.url), 'utf8');
  const printBlock = scheduleCss.slice(scheduleCss.indexOf('@media print'));
  assert.match(printBlock, /\.schedule-tabs/, 'the tab bar has no purpose on a single printed view');
  assert.match(printBlock, /\.schedule-stat-filter-actions/, 'Save/Print buttons must not print themselves');
});

test('calendar defaults to compact Schedule strips, includes their start time, and keeps 24-hour shifts in their start-day strip', () => {
  const calendarPage = readFileSync(new URL('../public/pages/calendar.js', import.meta.url), 'utf8');
  assert.match(calendarPage, /scheduleDisplay: 'compact'/);
  assert.match(calendarPage, /schedule-entry__start/);
  assert.match(calendarPage, /function scheduleIsFullDayShift\(entry\)/);
  assert.match(calendarPage, /scheduleHasTimes\(entry\) && !scheduleIsFullDayShift\(entry\)/);
  assert.match(calendarPage, /!scheduleHasTimes\(entry\) \|\| scheduleIsFullDayShift\(entry\)/);
});


test('schedule statistics tab uses the computed entries API and includes overnight and 24-hour durations', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  assert.match(schedulePage, /\['statistics', t\('schedule\.statistics'\)\]/);
  assert.match(schedulePage, /\/schedule\/entries\?from=/);
  assert.match(schedulePage, /if \(end <= start\) end \+= 24 \* 60/);
  assert.match(schedulePage, /monthBounds\(statistics\.monthFrom\)/);
  assert.match(schedulePage, /yuvomi-datepicker required name="from" type="date"/);
  const submitHandler = schedulePage.slice(schedulePage.indexOf('async function submitForm'), schedulePage.indexOf('async function action'));
  assert.match(submitHandler, /form\.dataset\.form === 'statistics'/);
  assert.match(submitHandler, /formValue\(form, 'from'/);
  assert.match(submitHandler, /await refreshStatistics\(\)/);
  assert.match(schedulePage, /schedule-stat-loading/);
  assert.match(schedulePage, /class="segmented schedule-stat-range__choices"/);
});


test('Schedule uses the full desktop module shell and responsive library/statistics grids', () => {
  const schedulePage = readFileSync(new URL('../public/pages/schedule.js', import.meta.url), 'utf8');
  const scheduleCss = readFileSync(new URL('../public/styles/schedule.css', import.meta.url), 'utf8');
  assert.doesNotMatch(schedulePage, /page-measure--narrow schedule-page/);
  // Die Wurzel traegt die Modulklasse; seit dem Kompositionssystem stehen die
  // Layout-Primitives daneben (app-page app-page--full). Geprueft wird die Sache -
  // die Seite ist als schedule-page ausgezeichnet -, nicht die Schreibweise, sonst
  // wird dieser Guard bei jeder korrekten Erweiterung des Wurzelmarkups rot.
  assert.match(schedulePage, /<div class=\"schedule-page(?:\s[^\"]*)?\"/);
  assert.match(schedulePage, /schedule-library--shifts/);
  assert.match(scheduleCss, /container: schedule-page \/ inline-size/);
  assert.match(scheduleCss, /@container schedule-page \(min-width: 720px\)/);
  assert.match(scheduleCss, /@container schedule-page \(min-width: 900px\)/);
  assert.match(scheduleCss, /schedule-stat-dates/);
});
