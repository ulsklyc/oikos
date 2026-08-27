/**
 * Modul: Bildaufnahme für zugeschnittene Bilder (#901)
 * Zweck: Der Zuschnitt-Dialog war exportiert, der Weg dorthin nicht - also
 *        baute sich jeder Aufrufer seinen eigenen. Fünf Fassungen von
 *        „Datei lesen, prüfen, zuschneiden, Ergebnis prüfen" liefen
 *        auseinander: eine schnitt gar nicht zu (die Meldung), eine prüfte
 *        keine Größe, eine schluckte jeden Fehler stumm. Diese Suite hält
 *        den einen Weg offen und die vier Umgehungen zu. Seit dem Nachzügler
 *        (Inventarfoto zugeschnitten, Abo-Logo bewusst roh) misst sie auch
 *        rohe Bildfelder: wer nicht zuschneidet, prüft selbst.
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
  // JEDE Export-Form des Moduls, vom Schlüsselwort bis zum Statement-Kopf -
  // keine Liste bekannter Schreibweisen. Die erste Fassung verbot nur
  // `export function openCropDialog` und blieb grün, als testweise ein
  // nachgestelltes `export { openCropDialog };` dazukam: Test 2 überspringt
  // CROP_MODULE, die Re-Export-Zeile sah also niemand. Erfasst sind jetzt
  // auch `export default`, Export-Listen (mehrzeilig, mit `as`-Alias) und
  // ein Alias wie `export const x = openCropDialog`.
  const exportStatements = cropSource.match(
    /^[ \t]*export\s+(?:\{[^}]*\}|default[^\n]*|(?:async\s+)?function\s+\w+|class\s+\w+|(?:const|let|var)[^\n]*)/gm
  ) || [];
  assert.ok(
    exportStatements.length >= 1,
    'kein export-Statement erkannt - pickCroppedImage muss exportiert sein, das Muster greift nicht mehr'
  );
  for (const statement of exportStatements) {
    assert.ok(
      !statement.includes('openCropDialog'),
      'openCropDialog darf nicht exportiert werden - sonst baut sich der nächste '
      + `Aufrufer wieder seinen eigenen Weg dorthin: ${statement.trim()}`
    );
  }
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

/** Ob eine Datei den Zuschnitt VERWENDET (Import), nicht nur erwähnt: ein
 *  `includes('pickCroppedImage')` machte den Guard schon scharf, wenn ein
 *  Kommentar den Namen nannte - und ein Modul ohne Zuschnitt
 *  (subscriptions.js) fiele dann fälschlich unter die accept-Regel.
 *  Beide Bezugsformen: statisches `import { … } from` und das in den
 *  Handlern übliche `const { … } = await import(…)`. */
function usesPicker(source) {
  return /import\s*\{[^}]*\bpickCroppedImage\b[^}]*\}\s*from/.test(source)
    || /\{[^}]*\bpickCroppedImage\b[^}]*\}\s*=\s*await\s+import\(/.test(source);
}

/** Alle accept-Listen einer Datei, die ausschließlich Bildtypen anbieten.
 *  BEIDE Anführungsarten, und keine stillschweigend übergangene: ein
 *  `accept='image/gif'` ist gültiges HTML und fiel durch ein Muster, das
 *  nur doppelte Anführungszeichen kannte - die Zähler der Tests blieben
 *  dabei über der Schwelle, weil die anderen Felder sie allein tragen. Ein
 *  `accept=`, das zu keiner der beiden Formen passt, wirft deshalb. */
function imageOnlyAcceptLists(source, file) {
  const lists = [];
  for (const m of source.matchAll(/accept=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
    assert.ok(
      m[3] === undefined,
      `${rel(file)}: unverstandene Schreibweise des accept-Attributs: ${m[0]}`
    );
    const list = m[1] ?? m[2];
    // Felder, die auch Nicht-Bilder annehmen (Belege, Anhaenge), gehören
    // nicht zu den Bildaufnahmen und werden hier nicht gemessen.
    if (!list.split(',').every((type) => type.startsWith('image/'))) continue;
    lists.push(list);
  }
  return lists;
}

test('jedes reine Bildfeld neben einem Zuschnitt filtert dieselben Typen', () => {
  const expected = acceptedTypes().join(',');
  let checked = 0;

  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    if (!usesPicker(source)) continue;

    for (const list of imageOnlyAcceptLists(source, file)) {
      checked += 1;
      assert.strictEqual(
        list,
        expected,
        `${rel(file)}: accept="${list}" weicht von ACCEPTED_TYPES ab - der Dateidialog `
        + 'bietet dann etwas an, das pickCroppedImage() danach ablehnt'
      );
    }
  }

  assert.ok(checked >= 6, `nur ${checked} Bildfelder geprüft - erwartet mindestens 6`);
});

test('ein reines Bildfeld ohne Zuschnitt prüft Typ und Größe selbst', () => {
  let checked = 0;

  for (const file of FILES) {
    if (file === CROP_MODULE) continue;
    const source = readFileSync(file, 'utf8');
    if (usesPicker(source)) continue;
    const lists = imageOnlyAcceptLists(source, file);
    if (!lists.length) continue;
    checked += 1;

    // Wer nicht durch pickCroppedImage() geht, übernimmt dessen Pflichten
    // selbst: eine Typprüfung, deren Liste EXAKT dem Dateidialog entspricht
    // (sonst bietet der Dialog an, was der Code danach ablehnt - oder die
    // Prüfung ist lascher als das Angebot), und eine Größenprüfung. Genau
    // diese Lücke hatten inventory.js (gar keine Prüfung, englische
    // Meldung) und subscriptions.js (keine Typprüfung) vor #901.
    for (const list of lists) {
      const literal = `['` + list.split(',').join(`', '`) + `']`;
      assert.ok(
        source.includes(literal),
        `${rel(file)}: kein Array-Literal ${literal} gefunden - die Typprüfung `
        + `muss dieselben Typen tragen wie accept="${list}"`
      );
    }
    assert.ok(
      /\.includes\(file\.type\)/.test(source),
      `${rel(file)}: prüft file.type nicht gegen die eigene Typliste`
    );
    assert.ok(
      /file\.size\s*>/.test(source),
      `${rel(file)}: prüft file.size nicht`
    );
  }

  // Heute genau das Abo-Logo: SVG und Transparenz vertragen keinen
  // 256-px-JPEG-Zuschnitt, also bleibt der Weg roh - mit eigenen Prüfungen.
  // Fällt die Erkennung auf 0, misst dieser Test nichts mehr.
  assert.ok(checked >= 1, 'kein rohes Bildfeld gefunden - erwartet mindestens 1 (subscriptions.js)');
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
      // Punktschlüssel JEDER Tiefe: die erste Fassung kannte genau zwei
      // Segmente ([a-zA-Z]+\.[a-zA-Z]+). de.json hat aber auch drei- und
      // viersegmentige Schlüssel - ein Tippfehler in einem davon wurde nie
      // eingesammelt, also nie gegen de.json gehalten, und die Mindestzahl
      // unten fing das nicht auf, weil ein nicht gezählter Schlüssel ihr
      // nicht fehlt. Genau der Blindflug, gegen den es diese Suite gibt.
      for (const m of b.matchAll(/'([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)'/g)) keys.add(m[1]);
    }
  };
  collect(cropSource);
  for (const file of FILES) collect(readFileSync(file, 'utf8'));

  assert.ok(keys.size >= 7, `nur ${keys.size} Schlüssel gefunden - erwartet mindestens 7`);
  for (const key of keys) {
    assert.strictEqual(typeof lookup(key), 'string', `de.json kennt "${key}" nicht`);
  }
});
