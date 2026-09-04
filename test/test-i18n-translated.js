/**
 * Modul: Uebersetzt, nicht nur schluesselvollstaendig
 * Zweck: test:i18n prueft Keyset, Platzhalter-Paritaet und Dateiformat - nie, ob
 *        ein Wert je uebersetzt wurde. So kamen Vorrat (15.08.2026) und Dienstplan
 *        (27.08.2026) in 22 Sprachen auf Englisch an, bei gruener CI. Dieser Guard
 *        zaehlt je Locale die Werte ueber 12 Zeichen, die WOERTLICH dem englischen
 *        Wert gleichen, obwohl de != en - die Signatur eines kopierten statt
 *        uebersetzten Werts - und haelt die Zahl gegen eine Baseline, die nur
 *        FALLEN darf. Die Baseline ist eine Messung, keine Obergrenze: faellt die
 *        Zahl, muss sie mit (sonst deckte sie beim naechsten Modul eine stille
 *        Regression bis zur alten Hoehe).
 *
 *        Bewusst NICHT gezaehlt: Werte, die dem DEUTSCHEN gleichen - die Stichprobe
 *        vom 03.09.2026 traf dort URLs, Platzhalter-Ketten, "Snacks / Fast Food",
 *        "CalDAV & CardDAV": legitim gleich. Ebenso Werte bis 12 Zeichen ("OK",
 *        "PDF", "E-Mail") und Werte, die nur aus Platzhaltern und Zeichen bestehen.
 *        Ein Wort wie "Budget", das in vielen Sprachen gleich lautet, faellt unter
 *        die 12 Zeichen; ein ganzer englischer Satz nicht.
 * Ausfuehren: npm run test:i18n-translated
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIN_LENGTH = 13; // Werte ab 13 Zeichen zaehlen
const BASELINE_URL = new URL('./i18n-translated-baseline.json', import.meta.url);
const SETS = {
  app: new URL('../public/locales/', import.meta.url),
  installer: new URL('../tools/installer/locales/', import.meta.url),
};

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function loadSet(dir) {
  const locales = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    locales.set(f.replace(/\.json$/, ''), flatten(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
  }
  return locales;
}

/** Nur Platzhalter, Zahlen und Zeichen - "{{from}} - {{to}}" ist in jeder Sprache gleich. */
function onlySymbols(value) {
  return /^(\{\{[^}]+\}\}|[\s\d\W])*$/.test(value);
}

/** Schluessel, deren Wert in `locale` woertlich der englische ist, obwohl de einen anderen hat. */
export function copiedFromEnglish(de, en, locale) {
  const hits = [];
  for (const [key, enValue] of en) {
    if (typeof enValue !== 'string' || enValue.length < MIN_LENGTH || onlySymbols(enValue)) continue;
    if (de.get(key) === enValue) continue;
    if (locale.get(key) === enValue) hits.push(key);
  }
  return hits;
}

const baseline = JSON.parse(readFileSync(BASELINE_URL, 'utf8'));

for (const [setName, dir] of Object.entries(SETS)) {
  const locales = loadSet(dir);
  const de = locales.get('de');
  const en = locales.get('en');
  assert.ok(de && en, `${setName}: de.json und en.json muessen existieren`);

  test(`${setName}: der Zaehler ist nicht blind`, () => {
    // Eine Locale, die en woertlich kopiert, muss JEDEN zaehlbaren Schluessel treffen.
    const eligible = [...en].filter(([k, v]) => typeof v === 'string' && v.length >= MIN_LENGTH && !onlySymbols(v) && de.get(k) !== v).length;
    assert.ok(eligible > 50, `${setName}: nur ${eligible} zaehlbare Schluessel - Schwelle oder Scan stimmen nicht`);
    assert.equal(copiedFromEnglish(de, en, en).length, eligible);
    assert.equal(copiedFromEnglish(de, en, de).length, 0, 'de kopiert nichts aus en');
  });

  for (const [code, values] of locales) {
    if (code === 'de' || code === 'en') continue;
    const expected = baseline[setName]?.[code];
    const hits = copiedFromEnglish(de, en, values);

    test(`${setName}/${code}: keine neuen englischen Werte gegenueber der Baseline`, () => {
      assert.ok(Number.isInteger(expected), `${setName}/${code} fehlt in der Baseline - Eintrag mit ${hits.length} anlegen`);
      assert.ok(hits.length <= expected,
        `${setName}/${code}: ${hits.length} Werte woertlich englisch, Baseline ${expected}. Neu dazugekommen, `
        + `z. B.: ${hits.slice(-5).join(', ')} - uebersetzen, nicht die Baseline heben`);
    });

    test(`${setName}/${code}: die Baseline ist eine Messung und faellt mit`, () => {
      assert.equal(hits.length, expected,
        `${setName}/${code}: gemessen ${hits.length}, Baseline ${expected} - Baseline in `
        + 'test/i18n-translated-baseline.json auf den gemessenen Wert senken');
    });
  }

  test(`${setName}: die Baseline traegt keine Karteileichen`, () => {
    const stale = Object.keys(baseline[setName] ?? {}).filter((code) => !locales.has(code));
    assert.deepEqual(stale, [], `${setName}: Baseline-Eintraege ohne Locale-Datei`);
  });
}
