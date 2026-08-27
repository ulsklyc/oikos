/**
 * Test: Wiederholungsfelder der Oberfläche (public/rrule-ui.js, #756)
 *
 * Der Anlassfall: Ein per CalDAV eingelesener Serientermin verlor seine
 * Wiederholung, sobald man in Yuvomi irgendein anderes Feld änderte - und der
 * Verlust wanderte über den Sync zurück in den Fremdkalender. Zwei Ursachen,
 * beide hier abgedeckt:
 *
 *  1. Eingelesene Regeln stehen mit „RRULE:"-Präfix in der Datenbank
 *     (ics-parser.js). parseRRule kannte das Präfix nicht, las FREQ nicht und
 *     lieferte „keine Wiederholung" - das Formular zeigte ein leeres Feld und
 *     schrieb diese Leere beim Speichern fest.
 *  2. Dieses Formular kennt nur einen Ausschnitt von RFC 5545. Alles darüber
 *     hinaus (WKST, BYMONTHDAY, BYSETPOS) ginge beim Neubau aus den Feldern
 *     verloren, obwohl der Nutzer die Wiederholung gar nicht angefasst hat.
 *
 * Die Prüfungen laufen gegen den echten Regelaufbau, nicht gegen Schreibweisen:
 * gerendertes Formular -> DOM-Stub -> getRRuleValues, also derselbe Weg, den
 * ein Klick auf „Speichern" nimmt.
 *
 * Ausführen: node --loader ./test/test-browser-loader.mjs test/test-rrule-ui.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseRRule, buildRRule, describeRRule, renderRRuleFields, getRRuleValues, bindRRuleEvents } =
  await import('../public/rrule-ui.js');

// --------------------------------------------------------
// Ein DOM-Ersatz, klein genug zum Lesen: getRRuleValues fragt ausschließlich per
// querySelector nach `#id` und `#id .klasse` und liest `value` bzw. `checked`.
// Die Werte kommen aus dem gerenderten Formular-HTML, damit Render- und
// Lesepfad zusammen geprüft werden und nicht zwei getrennte Annahmen.
// --------------------------------------------------------
function formRoot(html) {
  const attr = (tag, name) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
    return m ? m[1] : null;
  };
  const decode = (s) => String(s).replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  // Feldwerte einmal aus dem Markup ziehen: id -> value.
  const values = new Map();
  for (const tag of html.match(/<(input|select|yuvomi-datepicker)\b[^>]*>/g) ?? []) {
    const id = attr(tag, 'id');
    if (id) values.set(`#${id}`, decode(attr(tag, 'value') ?? ''));
  }
  // <select> trägt seinen Wert an der markierten <option>, nicht am Element.
  for (const [, id, body] of html.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const selected = /<option value="([^"]*)"[^>]*\bselected\b/.exec(body);
    values.set(`#${id}`, selected ? selected[1] : (/<option value="([^"]*)"/.exec(body)?.[1] ?? ''));
  }

  // Aktive Wochentagsknöpfe, die einzige Sammelabfrage.
  const activeDays = [...html.matchAll(/<button[^>]*class="rrule-day rrule-day--active"[^>]*data-day="([A-Z]{2})"/g)]
    .map((m) => ({ dataset: { day: m[1] } }));

  return {
    querySelector(selector) {
      if (!values.has(selector)) return null;
      return { value: values.get(selector), checked: false };
    },
    querySelectorAll(selector) {
      return selector.includes('rrule-day--active') ? activeDays : [];
    },
    _set(selector, value) { values.set(selector, value); },
  };
}

/** Das Formular so lesen, wie „Speichern" es liest. */
function roundTrip(rule, mutate) {
  const root = formRoot(renderRRuleFields('event', rule, { allowCount: true }));
  mutate?.(root);
  return getRRuleValues(root, 'event');
}

// --------------------------------------------------------
// 1. Das Präfix
// --------------------------------------------------------

test('parseRRule liest eine Regel mit RRULE:-Präfix (#756)', () => {
  const parsed = parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE');
  assert.equal(parsed.freq, 'WEEKLY', 'ohne FREQ hält das Formular die Serie für keine Serie');
  assert.deepEqual(parsed.byday, ['WE']);
  assert.equal(parsed.interval, 1);
});

test('parseRRule bleibt bei der präfixlosen Schreibweise gleich', () => {
  assert.deepEqual(
    parseRRule('RRULE:FREQ=WEEKLY;BYDAY=WE'),
    parseRRule('FREQ=WEEKLY;BYDAY=WE'),
    'beide Schreibweisen stehen nebeneinander in der Datenbank'
  );
});

test('describeRRule beschreibt auch die eingelesene Schreibweise', () => {
  // Die Detailansicht zeigte hier eine leere Zeile - das erste sichtbare
  // Symptom, noch vor dem Datenverlust.
  assert.notEqual(describeRRule('RRULE:FREQ=WEEKLY;BYDAY=WE'), '');
});

test('das Formular zeigt eine eingelesene Serie als Wiederholung an', () => {
  const html = renderRRuleFields('event', 'RRULE:FREQ=WEEKLY;BYDAY=WE', { allowCount: true });
  assert.match(html, /<option value="WEEKLY" selected>/, 'die Frequenz muss vorausgewählt sein');
  assert.doesNotMatch(html, /id="event-rrule-details"[^>]*hidden/, 'die Detailfelder dürfen nicht verborgen sein');
});

// --------------------------------------------------------
// 1b. Der Takt ist einstellbar, und das Formular sagt es (#862)
//
// Die vier Frequenzen lasen sich wie feste Werte: das Intervallfeld liegt im
// Detailbereich, und der traegt "hidden", solange nichts gewaehlt ist. Ein
// Melder hat deshalb einen Thread fuer eine Funktion aufgemacht, die es gibt -
// gefunden hat er sie erst, nachdem er auf gut Glueck "woechentlich" waehlte.
// --------------------------------------------------------

/** Mini-DOM fuer bindRRuleEvents: nur hidden, value und addEventListener. */
function eventRoot(html) {
  const nodes = new Map();
  for (const [, tag, id] of html.matchAll(/<(\w[\w-]*)[^>]*\bid="([^"]+)"/g)) {
    const chunk = new RegExp(`<${tag}[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';
    nodes.set(`#${id}`, {
      tagName: tag, hidden: /\shidden(?=[\s>])/.test(chunk), value: '',
      listeners: {},
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      fire(type) { for (const fn of this.listeners[type] ?? []) fn(); },
    });
  }
  return {
    querySelector: (sel) => nodes.get(sel) ?? null,
    querySelectorAll: () => [],
    get: (sel) => nodes.get(sel),
  };
}

test('ohne gewaehlte Wiederholung sagt das Formular, dass der Takt einstellbar ist', () => {
  const html = renderRRuleFields('event', null, { allowCount: true });
  assert.match(html, /id="event-rrule-hint"/, 'der Hinweis fehlt ganz');
  assert.doesNotMatch(html, /id="event-rrule-hint"[^>]*hidden/,
    'genau hier ist der Irrtum moeglich - der Hinweis muss sichtbar sein');
  assert.match(html, /rrule\.intervalHint/, 'der Text kommt aus der Uebersetzung, nicht aus dem Markup');
});

test('Hinweis und Detailbereich sind komplementaer, nie beide da und nie beide weg', () => {
  // Das ist die Regel, nicht die Beobachtung: der Hinweis beantwortet die Frage
  // "sind das die einzigen vier Takte?", und sobald der Takt sichtbar
  // danebensteht, hat sie sich erledigt. Zwei Zustaende, nie ein dritter.
  for (const [label, rule] of [['ohne Regel', null], ['mit Regel', 'RRULE:FREQ=WEEKLY;INTERVAL=2']]) {
    const html = renderRRuleFields('event', rule, { allowCount: true });
    const hintHidden    = /id="event-rrule-hint"[^>]*hidden/.test(html);
    const detailsHidden = /id="event-rrule-details"[^>]*hidden/.test(html);
    assert.notEqual(hintHidden, detailsHidden, `${label}: beide ${hintHidden ? 'verborgen' : 'sichtbar'}`);
  }
});

test('der Hinweis ist dem Auswahlfeld zugeordnet, nicht nur danebengesetzt', () => {
  const html = renderRRuleFields('task', null, {});
  assert.match(html, /aria-describedby="task-rrule-hint"/,
    'ohne die Zuordnung liest ein Screenreader die Auswahl ohne ihre Erklaerung vor');
});

test('die Auswahl einer Frequenz nimmt den Hinweis weg und holt den Takt hervor', () => {
  const html = renderRRuleFields('event', null, { allowCount: true });
  const root = eventRoot(html);
  const freq = root.get('#event-rrule-freq');
  const hint = root.get('#event-rrule-hint');
  const details = root.get('#event-rrule-details');

  assert.equal(hint.hidden, false, 'Ausgangslage');
  assert.equal(details.hidden, true, 'Ausgangslage');

  bindRRuleEvents(root, 'event');
  freq.value = 'MONTHLY';
  freq.fire('change');

  assert.equal(hint.hidden, true, 'beantwortet, also weg');
  assert.equal(details.hidden, false, 'und der Takt steht jetzt da');

  // Und zurueck: wer die Wiederholung wieder abwaehlt, bekommt den Hinweis wieder.
  freq.value = '';
  freq.fire('change');
  assert.equal(hint.hidden, false);
  assert.equal(details.hidden, true);
});

// --------------------------------------------------------
// 2. Wer nichts ändert, ändert nichts
// --------------------------------------------------------

test('eine unangetastete Serie geht im Wortlaut zurück (#756)', () => {
  const rule = 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE';
  const values = roundTrip(rule);
  assert.equal(values.recurrence_rule, rule, 'sonst schreibt jedes Speichern eine andere Regel als die gelesene');
  assert.equal(values.is_recurring, true);
});

test('Regelteile außerhalb des Formular-Vokabulars überleben eine Änderung am Termin', () => {
  // BYSETPOS/BYMONTHDAY kennt dieses Formular nicht. Aus den Feldern neu gebaut
  // würde aus „jeder dritte Donnerstag" ein schlichtes „jeden Monat" - eine
  // stille Verschiebung der ganzen Serie.
  const rule = 'RRULE:FREQ=MONTHLY;BYSETPOS=3;BYDAY=TH';
  assert.equal(roundTrip(rule).recurrence_rule, rule);
});

test('eine echte Änderung an der Wiederholung schlägt durch', () => {
  const values = roundTrip('RRULE:FREQ=WEEKLY;BYDAY=WE', (root) => {
    root._set('#event-rrule-freq', 'DAILY');
  });
  assert.equal(values.recurrence_rule, 'FREQ=DAILY', 'die Ausgangsregel darf die Eingabe nicht überstimmen');
});

test('eine bewusst entfernte Wiederholung bleibt entfernt', () => {
  // Die Gegenrichtung: Der Unverändert-Rückgriff darf das Leeren nicht
  // rückgängig machen, sonst ließe sich keine Serie mehr auflösen.
  const values = roundTrip('RRULE:FREQ=WEEKLY;BYDAY=WE', (root) => {
    root._set('#event-rrule-freq', '');
  });
  assert.equal(values.recurrence_rule, null);
  assert.equal(values.is_recurring, false);
});

test('ohne Ausgangsregel entsteht die Regel wie bisher aus den Feldern', () => {
  const values = roundTrip(null, (root) => {
    root._set('#event-rrule-freq', 'WEEKLY');
  });
  assert.equal(values.recurrence_rule, 'FREQ=WEEKLY');
});

// --------------------------------------------------------
// 3. Was der Server annehmen muss
// --------------------------------------------------------

test('eine neu gebaute Regel besteht weiterhin den Server-Validator', () => {
  // Derselbe Ausdruck wie in server/middleware/validate.js: Er kennt kein
  // Präfix. Deshalb darf der Unverändert-Rückgriff nur greifen, wenn die Regel
  // wirklich unverändert ist - alles andere muss durch diese Prüfung passen.
  const RRULE_RE = /^(FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=\d{1,2})?(;BYDAY=[A-Z,]{2,}(,[A-Z]{2})*)?(;(UNTIL=\d{8}(T\d{6}Z)?|COUNT=\d{1,4}))?)?$/;
  const built = buildRRule({ freq: 'WEEKLY', interval: 2, byday: ['MO', 'TH'], until: '', count: 5 });
  assert.match(built, RRULE_RE);
});
