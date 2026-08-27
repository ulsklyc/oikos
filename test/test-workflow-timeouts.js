/**
 * Modul: Test-Infrastruktur - Workflow-Laufzeitdeckel
 * Zweck: Ein Job ohne `timeout-minutes` erbt den GitHub-Default von SECHS
 *        STUNDEN. Hängt ein Prozess - etwa eine Suite, deren Test-Helfer den
 *        Event-Loop offenhält (#903) -, verbrennt der Lauf einen halben
 *        Arbeitstag Runner-Zeit und liest sich die ganze Zeit als „in
 *        progress" statt als rotes X. Der Deckel macht aus „hängt" wieder
 *        „fällt durch".
 * Regel statt Allowlist: geprüft wird JEDER Job in JEDEM Workflow, damit ein
 *        neu angelegter Workflow nicht stillschweigend am Guard vorbeiläuft.
 * Ausführen: node --test test/test-workflow-timeouts.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../.github/workflows/', import.meta.url);

// Ein Deckel am 6-Stunden-Default wäre keiner. Die Obergrenze hält den Guard
// davon ab, eine wirkungslose Zahl durchzuwinken.
const MAX_MINUTES = 120;

/**
 * Liest die Job-Ebene eines Workflows ohne YAML-Parser: Job-Keys stehen auf
 * Indent 2 unterhalb von `jobs:`, ihre Eigenschaften auf Indent 4. Ein
 * `timeout-minutes` tiefer drin gehört einem STEP und deckelt den Job nicht -
 * deshalb zählt hier ausschliesslich Indent 4.
 */
function jobsOf(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l === 'jobs:');
  if (start === -1) return [];

  const jobs = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) break; // zurück auf Top-Level: jobs-Sektion vorbei

    const jobKey = line.match(/^ {2}([\w-]+):\s*$/);
    if (jobKey) {
      current = { name: jobKey[1], timeout: null };
      jobs.push(current);
      continue;
    }
    if (!current) continue;

    const timeout = line.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/);
    if (timeout) current.timeout = Number(timeout[1]);
  }
  return jobs;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

test('es gibt überhaupt Workflows zu prüfen', () => {
  assert.ok(files.length > 0, 'keine Workflow-Datei gefunden - der Guard läuft ins Leere');
});

for (const file of files) {
  const source = readFileSync(new URL(file, DIR), 'utf8');
  const jobs = jobsOf(source);

  test(`${file}: jeder Job hat einen Laufzeitdeckel`, () => {
    assert.ok(jobs.length > 0, `${file}: kein Job erkannt - der Guard misst hier nichts`);

    for (const job of jobs) {
      assert.notStrictEqual(
        job.timeout,
        null,
        `${file}, Job "${job.name}": timeout-minutes fehlt - der Job erbt 6 Stunden`
      );
      assert.ok(
        job.timeout > 0 && job.timeout <= MAX_MINUTES,
        `${file}, Job "${job.name}": timeout-minutes ${job.timeout} liegt ausserhalb 1..${MAX_MINUTES}`
      );
    }
  });
}
