/**
 * Tests: Pluralformen in t() (Audit-Befund nach #534)
 * Zweck: `{{count}}`-Strings waren hart im Plural formuliert - „1 Adressbücher
 *        aktiviert". t() wählt jetzt über Intl.PluralRules die passende Variante
 *        (`key_one`, `key_few`, …) und fällt auf den Basisschlüssel zurück,
 *        wenn eine Locale die Variante nicht kennt.
 * Ausführen: node test/test-i18n-plural.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALE_DIR = new URL('../public/locales/', import.meta.url);
const localeFile = (locale) => JSON.parse(readFileSync(new URL(`${locale}.json`, LOCALE_DIR), 'utf8'));

/** Verschachtelte Locale-Datei zu einer flachen Map `a.b.c` -> Wert. */
const flattenLocale = (obj, prefix = '', out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flattenLocale(v, key, out);
    else out.set(key, v);
  }
  return out;
};

// i18n.js ist Browser-Code: Umgebung stellen, bevor das Modul geladen wird.
const store = new Map();
global.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.document = { documentElement: { lang: '', dir: '' } };
global.window = { dispatchEvent: () => {}, matchMedia: () => ({ matches: false }) };
global.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
global.fetch = async (url) => {
  const locale = String(url).replace('/locales/', '').replace('.json', '');
  return { ok: true, json: async () => localeFile(locale) };
};
Object.defineProperty(global, 'navigator', {
  value: { languages: ['de-DE'], language: 'de-DE' },
  writable: true,
  configurable: true,
});

const { initI18n, setLocale, t } = await import('../public/i18n.js');
await initI18n();

test('Deutsch: Singular und Plural je nach count', async () => {
  await setLocale('de');
  assert.equal(t('settings.enabledReminderListCount', { count: 1 }), '1 Erinnerungsliste aktiviert');
  assert.equal(t('settings.enabledReminderListCount', { count: 2 }), '2 Erinnerungslisten aktiviert');
  assert.equal(t('settings.enabledReminderListCount', { count: 0 }), '0 Erinnerungslisten aktiviert');
});

test('Englisch: Singular und Plural je nach count', async () => {
  await setLocale('en');
  assert.equal(t('settings.enabledReminderListCount', { count: 1 }), '1 reminder list enabled');
  assert.equal(t('settings.enabledReminderListCount', { count: 3 }), '3 reminder lists enabled');
  assert.equal(t('settings.calendarImport.success', { count: 1 }), '1 event imported.');
  assert.equal(t('settings.calendarImport.success', { count: 4 }), '4 events imported.');
});

test('Sprachen ohne Zahlflexion liefern für jede Anzahl denselben Satz', async () => {
  await setLocale('ja');
  const one = t('settings.enabledReminderListCount', { count: 1 });
  const many = t('settings.enabledReminderListCount', { count: 5 });
  assert.equal(one.replace('1', 'N'), many.replace('5', 'N'));
});

test('Polnisch: fehlende few/many-Variante fällt auf den Basisschlüssel zurück', async () => {
  await setLocale('pl');
  // pl kennt one/few/many/other; hinterlegt sind Basis + _one. Kein Absturz,
  // und das zählunabhängige „Label: N"-Muster bleibt korrekt.
  for (const count of [1, 2, 5, 22]) {
    assert.match(t('settings.enabledReminderListCount', { count }), /Włączone listy przypomnień: \d+/);
  }
});

test('„N von M"-Zähler nutzt bei einem Eintrag die Singularform', async () => {
  // Die _one-Variante ging beim Umbenennen einer früheren Runde verloren:
  // „1 von 1 Adressbüchern aktiv". t() wählt über count (= Gesamtzahl).
  await setLocale('de');
  assert.equal(
    t('settings.addressbooksEnabledOfTotal', { enabled: 1, total: 1, count: 1 }),
    '1 von 1 Adressbuch aktiv',
  );
  assert.equal(
    t('settings.addressbooksEnabledOfTotal', { enabled: 1, total: 3, count: 3 }),
    '1 von 3 Adressbüchern aktiv',
  );
  await setLocale('en');
  assert.equal(
    t('settings.calendarsEnabledOfTotal', { enabled: 0, total: 1, count: 1 }),
    '0 of 1 calendar active',
  );
  assert.equal(
    t('settings.calendarsEnabledOfTotal', { enabled: 2, total: 4, count: 4 }),
    '2 of 4 calendars active',
  );
});

test('Standard-Punkte (#578): zählende Strings nutzen die Singularform', async () => {
  // Review-Fund: die vier count-Strings des Features waren hart im Plural
  // formuliert („1 Aufgaben aktualisiert").
  await setLocale('de');
  assert.equal(t('tasks.pointsSummary', { count: 1 }), '1 Punkt');
  assert.equal(t('tasks.pointsSummary', { count: 10 }), '10 Punkte');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 1 }), '1 Aufgabe aktualisiert.');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 3 }), '3 Aufgaben aktualisiert.');
  assert.match(t('settings.rewardsDefaultPointsRebaseTitle', { count: 1, from: 10, to: 15 }), /^1 Aufgabe von 10 auf 15 /);

  await setLocale('en');
  assert.equal(t('tasks.pointsSummary', { count: 1 }), '1 point');
  assert.equal(t('tasks.pointsSummary', { count: 4 }), '4 points');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 1 }), '1 task updated.');
  assert.equal(t('settings.rewardsDefaultPointsRebased', { count: 2 }), '2 tasks updated.');
});

test('Garantie-Restlaufzeit (Inventar, Stufe 4): zählender String nutzt die Singularform', async () => {
  // Review-Fund: der String wurde mit `days` interpoliert. t() wählt die
  // Pluralvariante ausschließlich über einen numerischen `count` - daher stand
  // dort "in 1 Tagen".
  await setLocale('de');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 1 }), 'Garantie läuft in 1 Tag ab');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 12 }), 'Garantie läuft in 12 Tagen ab');

  await setLocale('en');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 1 }), 'Warranty ends in 1 day');
  assert.equal(t('inventory.warrantyStatusExpiringSoon', { count: 30 }), 'Warranty ends in 30 days');
});

test('Schlüssel ohne Pluralvarianten funktionieren unverändert', async () => {
  await setLocale('de');
  assert.equal(t('common.save'), localeFile('de').common.save);
  // count-Parameter ohne passende Variante (7 → „other"): Basisschlüssel plus Interpolation.
  assert.equal(
    t('settings.enabledReminderListCount', { count: 7 }),
    '7 Erinnerungslisten aktiviert',
  );
});

test('unbekannter Schlüssel liefert den Schlüssel selbst zurück - auch mit count', async () => {
  await setLocale('de');
  assert.equal(t('gibt.es.nicht'), 'gibt.es.nicht');
  assert.equal(t('gibt.es.nicht', { count: 2 }), 'gibt.es.nicht');
});

test('jede Pluralvariante hat einen zählenden Basisschlüssel in allen Locales', () => {
  const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));
  // Pluralvariante = Suffix einer CLDR-Kategorie UND ein {{count}} im Wert.
  // Das trennt sie von echten Enum-Werten wie `budget.accountType_other`.
  for (const file of files) {
    const entries = flattenLocale(JSON.parse(readFileSync(new URL(file, LOCALE_DIR), 'utf8')));
    for (const [key, value] of entries) {
      if (!/_(zero|one|two|few|many|other)$/.test(key)) continue;
      if (typeof value !== 'string' || !value.includes('{{count}}')) continue;
      const base = key.replace(/_(zero|one|two|few|many|other)$/, '');
      assert.ok(entries.has(base), `${file}: ${key} ohne Basisschlüssel ${base}`);
      assert.match(entries.get(base), /\{\{count\}\}/, `${file}: ${base} zählt nicht`);
    }
  }
});

// ---------------------------------------------------------------------------
// Die Gegenrichtung: ein zählender Schlüssel OHNE Variante (#1010)
//
// Der Test oben geht von der Variante aus und findet deshalb nur den Fehler
// „Variante da, Basis fehlt". Der Fehler, den Menschen tatsächlich machen, ist
// der andere: `{{count}}` schreiben und die `_one`-Variante vergessen. Zwei
// unabhängige PRs lieferten am 2./3.09. je drei solcher Schlüssel bei gruener
// CI - „1 Dateien hochladen".
//
// Gemessen wird `de.json`, die Referenz-Locale: was dort eine Variante braucht,
// braucht sie ueberall. Der umgekehrte Fall (eine Sprache braucht eine Variante,
// wo Deutsch keine braucht) ist eine groessere Frage und nicht die dieses Guards.
//
// WARUM EINE AUSNAHMEKARTE UND KEIN STRIKTES ROT: der Bestand traegt 70 solcher
// Schluessel. Ein Guard, der beim ersten Lauf 70-mal scheitert, wird abgeschwaecht
// statt erfuellt - danach prueft er wieder nichts. Die Karte friert den Bestand
// ein; jeder NEUE zaehlende Schluessel ohne Variante ist ab sofort rot.
//
// BEKANNTE GRENZE: erkannt wird ein zaehlender Schluessel am `{{count}}` im WERT.
// Ein Aufrufer darf `count` aber auch nur zur Pluralwahl uebergeben, waehrend der
// Text andere Platzhalter interpoliert - `settings.addressbooksEnabledOfTotal` macht
// genau das (`{{enabled}} von {{total}}`, Aufruf mit `count: addressbooks.length`,
// sync-contacts.js:163). Solche Schluessel sieht dieser Guard nicht; sie zu finden
// hiesse, jeden `t()`-Aufruf auf ein `count:`-Argument zu lesen. Bewusst offen
// gelassen: die haeufige Luecke ist die hier gepruefte.
//
// Die Kategorie sagt, WARUM der Schluessel keine Variante braucht - und sie ist
// am AUFRUFER belegt, nicht am Wortlaut. Ein String, der klingt, als koenne er
// nicht bei 1 stehen, kann es meistens doch (#1010 nennt zwei Faelle, die genau
// so durchgefallen sind).
// ---------------------------------------------------------------------------

/**
 * Zaehlende Basisschluessel ohne `_one` - der eingefrorene Bestand.
 *
 * NO_NOUN        Auf die Zahl folgt kein Substantiv („3 ausgewaehlt", „3 aktiv").
 *                Im Deutschen numerusneutral, braucht keine Variante.
 * PARENTHETICAL  Die Zahl steht in Klammern oder hinter einem Doppelpunkt
 *                („Dateikonflikte (3)"). Ebenfalls neutral.
 * ABBREV         Die Einheit ist eine numerusneutrale Abkuerzung („3 Min.").
 * PAIR_LEGACY    Handgebautes Paar aus der Zeit vor `_one` (Suffix `Plural`,
 *                `Many`/`One`, `Singular`). Heute korrekt, nur alte Schreibweise.
 *                Ein Umbau auf `_one` waere ein eigener Vorgang: 20+ Aufrufstellen.
 * NOT_A_COUNT    `count` ist gar kein Zaehler, sondern ein Zahlenwert oder ein
 *                bereits formatierter String. Plural-Regeln greifen hier nicht.
 * GUARDED        n=1 ist AM AUFRUFER ausgeschlossen - mit Datei und Zeile belegt.
 * DEAD_KEY       Der Schluessel wird nirgends aufgerufen (in allen Locales
 *                vorhanden, im Code nicht). Aufraeumen ist eine eigene Aenderung -
 *                24 Sprachdateien, und sie duerfen nicht reserialisiert werden.
 * TODO_ONE       Echte Luecke: n=1 ist erreichbar und der Satz ist dann falsch.
 *                Steht hier, damit der Guard scharf gestellt werden kann, ohne
 *                24 Locales in derselben Aenderung anzufassen.
 */
const PLURAL_EXCEPTIONS = {
  // --- kein Substantiv nach der Zahl -------------------------------------
  'contacts.selectCount': 'NO_NOUN',
  'contacts.importSelectedStatus': 'NO_NOUN',
  'contacts.importDetailBirthday': 'NO_NOUN',
  'contacts.importDetailFailed': 'NO_NOUN',
  'documents.selectCount': 'NO_NOUN',
  'tasks.bulkSelectedCount': 'NO_NOUN',
  'dashboard.todayShoppingCount': 'NO_NOUN',
  'dashboard.rewardsPending': 'NO_NOUN',
  'dashboard.healthRefill': 'NO_NOUN',
  'health.labs.abnormalBadge': 'NO_NOUN',
  'subscriptions.activeCount': 'NO_NOUN',
  'budget.loansSummary': 'NO_NOUN',

  // --- Zahl in Klammern / hinter Doppelpunkt ------------------------------
  'category.errorInUse': 'PARENTHETICAL',
  'category.errorSubInUse': 'PARENTHETICAL',
  'documents.folderUpload.fileConflictsTitle': 'PARENTHETICAL',
  'documents.folderUpload.folderConflictsTitle': 'PARENTHETICAL',
  'documents.folderUpload.rejectedTitle': 'PARENTHETICAL',
  'shopping.clearChecked': 'PARENTHETICAL',
  'contacts.importSubmit': 'PARENTHETICAL',
  'health.cycle.settings.applyToAllDone': 'PARENTHETICAL',

  // --- numerusneutrale Abkuerzung ----------------------------------------
  'settings.calendarDurationMinutes': 'ABBREV',

  // --- handgebaute Paare, alte Schreibweise -------------------------------
  'search.resultCountOne': 'PAIR_LEGACY',
  'search.resultCountMany': 'PAIR_LEGACY',
  'contacts.countMany': 'PAIR_LEGACY',
  'contacts.importedCountToast': 'PAIR_LEGACY',
  'contacts.importedCountToastSingular': 'PAIR_LEGACY',
  'dashboard.eventsChip': 'PAIR_LEGACY',
  'dashboard.eventsChipPlural': 'PAIR_LEGACY',
  'dashboard.urgentTasksChip': 'PAIR_LEGACY',
  'dashboard.urgentTasksChipPlural': 'PAIR_LEGACY',
  'dashboard.overdueTasksChip': 'PAIR_LEGACY',
  'dashboard.overdueTasksChipPlural': 'PAIR_LEGACY',
  'reminders.pendingBadgeTitle': 'PAIR_LEGACY',
  'reminders.pendingBadgeTitlePlural': 'PAIR_LEGACY',

  // --- `count` ist kein Zaehler ------------------------------------------
  // fmtNum() (health.js:1256) liefert einen fertig formatierten String bzw. '–'.
  // Eine Dosis „1,5×" ist kein Zaehlwert, Intl.PluralRules greift hier nicht.
  'health.meds.doseQty': 'NOT_A_COUNT',

  // --- n=1 am Aufrufer ausgeschlossen ------------------------------------
  // subscriptions.js:135 - `cycle_interval === 1 ? t(key) : t('everyCycle', …)`.
  'subscriptions.everyCycle': 'GUARDED',
  // personal-calendar.js:214 - der Wert ist die Konstante MAX_DEFAULT_REMINDERS.
  'settings.calendarDefaultRemindersMax': 'GUARDED',
  // subscriptions.js:150-154 - dueLabel() faengt d<0, d===0 und d===1 vorher ab,
  // diese Zeile sieht nur noch d >= 2.
  'subscriptions.dueInDays': 'GUARDED',

  // --- echte Luecken, eingefroren statt behoben ---------------------------
  // Alle unten sind bei n=1 grammatisch falsch und n=1 ist erreichbar.
  'dashboard.housekeepingVisitsMonth': 'TODO_ONE',  // dashboard.js:2138, `visits` ungefiltert
  'dashboard.shoppingMore': 'TODO_ONE',             // dashboard.js:1485/2987/3530, Guard ist `> 0`
  'calendar.moreEvents': 'TODO_ONE',
  'calendar.searchCount': 'TODO_ONE',
  'contacts.bulkDeletedToast': 'TODO_ONE',
  'contacts.importSkippedNote': 'TODO_ONE',
  'birthdays.importSelected': 'TODO_ONE',
  'birthdays.importSubmit': 'TODO_ONE',
  'birthdays.importSuccess': 'TODO_ONE',
  'documents.bulkArchivedToast': 'TODO_ONE',
  'documents.bulkDeleteConfirm': 'TODO_ONE',
  'documents.bulkDeletedToast': 'TODO_ONE',
  'documents.bulkMovedToast': 'TODO_ONE',
  'documents.bulkRestoredToast': 'TODO_ONE',
  'documents.bulkUploadedToast': 'TODO_ONE',
  'documents.selectedFilesLabel': 'TODO_ONE',
  'budget.chartSummary': 'TODO_ONE',
  'budget.statsDonutSummary': 'TODO_ONE',
  'health.labs.analyteCount': 'TODO_ONE',
  'health.cycle.status.inDays': 'TODO_ONE',
  'health.cycle.status.overdue': 'TODO_ONE',
  'inventory.navLabelAttention': 'TODO_ONE',        // router-Badge, Guard ist `> 0`
  'tasks.navLabelOverdue': 'TODO_ONE',              // router.js:1151, Guard ist `> 0`
  'subscriptions.listCount': 'TODO_ONE',
  'subscriptions.overdueDays': 'TODO_ONE',
  'subscriptions.reminderMeta': 'TODO_ONE',
  'subscriptions.metaInUseWarning': 'TODO_ONE',     // umgeht den Plural im String: „Abonnement(s)"
  'settings.recipeProviderDeleteAccountConfirm': 'TODO_ONE',

  // --- tote Schluessel: in allen Locales, im Code nirgends ----------------
  // Gemessen am 06.09.2026: 0 Treffer ausserhalb von public/locales/, auch
  // nicht dynamisch zusammengesetzt. Aufraeumen: eigener Vorgang.
  'housekeeping.monthTotal': 'DEAD_KEY',
  'housekeeping.moreWorkers': 'DEAD_KEY',
  'tasks.overdueDay': 'DEAD_KEY',
  'tasks.bulkDeleteConfirm': 'DEAD_KEY',
};

test('ein zaehlender Schluessel ohne Variante steht in der Ausnahmekarte (#1010)', () => {
  const entries = flattenLocale(localeFile('de'));
  const ohneVariante = [];
  for (const [key, value] of entries) {
    if (/_(zero|one|two|few|many|other)$/.test(key)) continue;
    if (typeof value !== 'string' || !value.includes('{{count}}')) continue;
    // Nicht nur `has()`: ein `_one`, das null, eine Zahl oder ein leerer String ist,
    // faellt zur Laufzeit auf den Plural-Basisschluessel zurueck (oder laesst `t()`
    // `.replace()` auf einem Nicht-String rufen) - die Variante waere da und wirkungslos.
    const variante = entries.get(`${key}_one`);
    if (typeof variante === 'string' && variante.trim() !== '') continue;
    ohneVariante.push(key);
  }

  const neu = ohneVariante.filter((k) => !(k in PLURAL_EXCEPTIONS));
  assert.deepEqual(neu, [],
    'Neue zaehlende Schluessel ohne `_one`-Variante. Entweder eine Variante anlegen '
    + '(public/locales/*.json, alle Sprachen) oder mit begruendeter Kategorie in '
    + `PLURAL_EXCEPTIONS eintragen: ${neu.join(', ')}`);

  // Die Karte darf nicht verrotten: ein Eintrag, der keine Ausnahme mehr ist -
  // weil der Schluessel eine Variante bekam oder geloescht wurde -, muss raus.
  // Ohne diese Haelfte waechst die Karte und niemand raeumt sie je auf
  // (dasselbe Muster wie INTENTIONALLY_NOT_IN_INSTALLER).
  const veraltet = Object.keys(PLURAL_EXCEPTIONS).filter((k) => !ohneVariante.includes(k));
  assert.deepEqual(veraltet, [],
    `Ausnahmekarte veraltet - diese Schluessel brauchen keine Ausnahme mehr: ${veraltet.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Platzhalter-Ersetzung
//
// Die Werte kommen aus Nutzereingaben (Namen, Titel, Notizen). Sie werden
// eingesetzt, nicht interpretiert - weder als Regex-Rückverweis noch als
// weiterer Platzhalter.
// ---------------------------------------------------------------------------

test('Werte mit Ersetzungssyntax werden wörtlich eingesetzt', async () => {
  await setLocale('de');
  // `$&` steht in einem String-Ersatz für den Treffer, `` $` `` für den Text
  // davor. Vorher wurde aus "A $& B" ein "A {{name}} B" und `` $` `` zog den
  // halben Satz in den Namen.
  assert.equal(t('birthdays.calendarEventTitle', { name: 'A $& B' }), 'Geburtstag: A $& B');
  assert.equal(t('birthdays.calendarEventTitle', { name: 'X $` Y' }), 'Geburtstag: X $` Y');
  assert.equal(t('birthdays.calendarEventTitle', { name: "Z $' W" }), "Geburtstag: Z $' W");
  assert.equal(t('birthdays.calendarEventTitle', { name: 'P $$ Q' }), 'Geburtstag: P $$ Q');
});

test('ein Wert, der wie ein Platzhalter aussieht, wird nicht erneut ersetzt', async () => {
  await setLocale('de');
  // Nacheinander ersetzt, hätte der date-Durchgang den eingesetzten Namen
  // nochmals durchsucht und das Datum zweimal geschrieben.
  assert.equal(
    t('birthdays.calendarEventDescription', { name: '{{date}}', date: '01.01.2000' }),
    'Geburtstagserinnerung für {{date}} (01.01.2000).',
  );
});

test('unbekannte Platzhalter bleiben sichtbar stehen', async () => {
  await setLocale('de');
  // Ein vergessener Parameter soll auffallen, nicht still ein Loch hinterlassen.
  assert.equal(
    t('birthdays.calendarEventDescription', { name: 'Emma' }),
    'Geburtstagserinnerung für Emma ({{date}}).',
  );
});

test('Zahlen und Pluralformen ersetzen weiterhin normal', async () => {
  await setLocale('de');
  assert.equal(t('settings.enabledReminderListCount', { count: 1 }), '1 Erinnerungsliste aktiviert');
  assert.equal(t('settings.enabledReminderListCount', { count: 7 }), '7 Erinnerungslisten aktiviert');
});
