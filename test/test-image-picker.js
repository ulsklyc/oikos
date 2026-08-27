/**
 * Modul: Bildaufnahme für zugeschnittene Bilder (#901)
 * Zweck: Der Zuschnitt-Dialog war exportiert, der Weg dorthin nicht - also
 *        baute sich jeder Aufrufer seinen eigenen. Fünf Fassungen von
 *        „Datei lesen, prüfen, zuschneiden, Ergebnis prüfen" liefen
 *        auseinander: eine schnitt gar nicht zu (die Meldung), eine prüfte
 *        keine Größe, eine schluckte jeden Fehler stumm. Diese Suite hält
 *        den einen Weg offen und die vier Umgehungen zu.
 * Ausführen: node --test test/test-image-picker.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CROP_MODULE = path.join(PUBLIC_DIR, 'utils/avatar-crop.js');

const cropSource = readFileSync(CROP_MODULE, 'utf8');

/** Alle .js unter public/, ohne vendor (Fremdcode wird von Hand kopiert). */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'vendor' || entry === 'locales') continue;
      out.push(...jsFiles(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = jsFiles(PUBLIC_DIR);
const rel = (f) => path.relative(ROOT, f);

// ---------------------------------------------------------------------------
// 1. Der Dialog bleibt privat
// ---------------------------------------------------------------------------

test('openCropDialog wird nicht exportiert', () => {
  assert.ok(
    /^function openCropDialog\(/m.test(cropSource),
    'openCropDialog muss modul-privat deklariert sein'
  );
  assert.ok(
    !/export\s+(async\s+)?function openCropDialog/.test(cropSource),
    'openCropDialog darf nicht exportiert werden - sonst baut sich der nächste '
    + 'Aufrufer wieder seinen eigenen Weg dorthin'
  );
});

test('kein Modul greift am Zuschnitt vorbei auf den Dialog zu', () => {
  for (const file of FILES) {
    if (file === CROP_MODULE) continue;
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !source.includes('openCropDialog'),
      `${rel(file)} nennt openCropDialog - der einzige Weg hinein ist pickCroppedImage()`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Der Dateidialog filtert, was die Aufnahme danach prüft
// ---------------------------------------------------------------------------

function acceptedTypes() {
  const match = cropSource.match(/const ACCEPTED_TYPES = \[([^\]]+)\]/);
  assert.ok(match, 'ACCEPTED_TYPES nicht in avatar-crop.js gefunden');
  return match[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
}

test('jedes reine Bildfeld neben einem Zuschnitt filtert dieselben Typen', () => {
  const expected = acceptedTypes().join(',');
  let checked = 0;

  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('pickCroppedImage')) continue;

    // BEIDE Schreibweisen, und keine stillschweigend uebergangene: ein
    // `accept='image/gif'` ist gueltiges HTML und fiel durch ein Muster, das
    // nur doppelte Anfuehrungszeichen kannte - der Zaehler unten blieb dabei
    // ueber der Schwelle, weil die anderen Felder ihn allein tragen. Ein
    // `accept=`, das zu keiner der beiden Formen passt, wirft deshalb.
    for (const m of source.matchAll(/accept=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
      assert.ok(
        m[3] === undefined,
        `${rel(file)}: unverstandene Schreibweise des accept-Attributs: ${m[0]}`
      );
      const list = m[1] ?? m[2];
      // Felder, die auch Nicht-Bilder annehmen (Belege, Anhaenge), gehören
      // nicht zum Zuschnitt und werden hier nicht gemessen.
      if (!list.split(',').every((type) => type.startsWith('image/'))) continue;
      checked += 1;
      assert.strictEqual(
        list,
        expected,
        `${rel(file)}: accept="${list}" weicht von ACCEPTED_TYPES ab - der Dateidialog `
        + 'bietet dann etwas an, das pickCroppedImage() danach ablehnt'
      );
    }
  }

  assert.ok(checked >= 5, `nur ${checked} Bildfelder geprüft - erwartet mindestens 5`);
});

// ---------------------------------------------------------------------------
// 3. Die Meldungsschlüssel sind für keinen t()-Scanner mehr sichtbar
// ---------------------------------------------------------------------------

test('alle Meldungsschlüssel der Aufnahme existieren in der Referenz-Locale', () => {
  const de = JSON.parse(readFileSync(path.join(PUBLIC_DIR, 'locales/de.json'), 'utf8'));
  const lookup = (key) => key.split('.').reduce((acc, part) => acc?.[part], de);

  // Die Schlüssel stehen seit #901 als Werte in Objekten, nicht mehr als
  // t('...')-Aufruf. Wer nach t( sucht, findet sie nicht - ein Tippfehler
  // fällt deshalb erst dem Nutzer auf, und ein Aufräumer hält sie für tot.
  const keys = new Set();
  const collect = (source) => {
    const block = source.match(/(DEFAULT_MESSAGE_KEYS|messageKeys)\s*[:=]\s*\{([^}]*)\}/gs) || [];
    for (const b of block) {
      for (const m of b.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)) keys.add(m[1]);
    }
  };
  collect(cropSource);
  for (const file of FILES) collect(readFileSync(file, 'utf8'));

  assert.ok(keys.size >= 7, `nur ${keys.size} Schlüssel gefunden - erwartet mindestens 7`);
  for (const key of keys) {
    assert.strictEqual(typeof lookup(key), 'string', `de.json kennt "${key}" nicht`);
  }
});
