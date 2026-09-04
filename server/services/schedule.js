/** Resolve schedule patterns without materialising calendar events. */
import { daysBetweenDateKeys, shiftDateKey } from '../utils/timezone.js';

export function cyclePosition(anchorDate, cycleLength, dateKey) {
  const days = daysBetweenDateKeys(anchorDate, dateKey);
  const length = Number(cycleLength);
  if (days === null || !Number.isInteger(length) || length < 1) return null;
  return ((days % length) + length) % length;
}

export function dateKeysInRange(from, to) {
  const count = daysBetweenDateKeys(from, to);
  if (count === null || count < 0) return [];
  return Array.from({ length: count + 1 }, (_, index) => shiftDateKey(from, index));
}

/**
 * Resolve one user's patterns and overrides in an inclusive date window.
 * `patterns` must be ordered by descending valid_from, so the first matching
 * pattern is the documented winner when a user accidentally overlaps them.
 *
 * `patternDays` maps "patternId:position" to an ARRAY of schedule_pattern_days
 * rows, not a single row - a cycle day may carry several classes at different
 * times (a timetable), each its own shift_type_id. An empty/missing array
 * still resolves to exactly one explicit free-day entry (never zero entries),
 * matching what an unset position has always meant.
 */
export function resolveEntries({ from, to, userId, patterns, patternDays, overrides }) {
  const overrideByDate = new Map(overrides.map((row) => [row.date_key, row]));
  const entries = [];
  const warnings = [];
  for (const date_key of dateKeysInRange(from, to)) {
    const override = overrideByDate.get(date_key);
    if (override) {
      entries.push({ user_id: userId, date_key, source: 'override', override_id: override.id, pattern_day_id: null,
        shift_type_id: override.shift_type_id, note: override.note ?? null, is_free: override.shift_type_id == null });
      continue;
    }
    const matches = patterns.filter((pattern) =>
      (!pattern.valid_from || pattern.valid_from <= date_key) && (!pattern.valid_until || pattern.valid_until >= date_key));
    if (!matches.length) continue;
    if (matches.length > 1) warnings.push({ user_id: userId, date_key, pattern_ids: matches.map((p) => p.id) });
    const pattern = matches[0];
    const position = cyclePosition(pattern.anchor_date, pattern.cycle_length, date_key);
    const days = patternDays.get(`${pattern.id}:${position}`) ?? [];
    if (!days.length) {
      entries.push({ user_id: userId, date_key, source: 'pattern', pattern_id: pattern.id, position, pattern_day_id: null,
        shift_type_id: null, note: null, is_free: true });
      continue;
    }
    for (const day of days) {
      entries.push({ user_id: userId, date_key, source: 'pattern', pattern_id: pattern.id, position, pattern_day_id: day.id,
        shift_type_id: day.shift_type_id, note: null, is_free: day.shift_type_id == null });
    }
  }
  return { entries, warnings };
}
