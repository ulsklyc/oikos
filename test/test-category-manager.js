/**
 * Modul: Category-Manager-Test
 * Zweck: Sichert Struktur und API-Nutzung der generischen Komponente + Budget-Verdrahtung
 * Ausführen: node --experimental-sqlite test/test-category-manager.js
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

console.log('\n[Category-Manager-Test]\n');

const comp = readFileSync(new URL('../public/components/category-manager.js', import.meta.url), 'utf8');
const compCss = readFileSync(new URL('../public/styles/category-manager.css', import.meta.url), 'utf8');
const settingsCss = readFileSync(new URL('../public/styles/settings.css', import.meta.url), 'utf8');
const notesPage = readFileSync(new URL('../public/pages/notes.js', import.meta.url), 'utf8');

test('Definiert das Custom Element yuvomi-category-manager', () => {
  assert(/customElements\.define\(\s*'yuvomi-category-manager'/.test(comp), 'Tag-Name muss yuvomi-category-manager sein');
});
test('Bietet eine configure()-Methode für Properties', () => {
  assert(/configure\s*\(/.test(comp), 'configure() muss existieren');
});
test('Lädt Kategorien relativ zu basePath via api.get', () => {
  assert(/api\.get\(\s*this\._basePath/.test(comp) || /api\.get\(`?\$\{this\._basePath\}/.test(comp), 'Muss api.get(basePath) nutzen');
});
test('Mutiert über post/put/patch/delete relativ zu basePath', () => {
  assert(/api\.post\(/.test(comp), 'POST zum Hinzufügen');
  assert(/api\.put\(/.test(comp), 'PUT zum Umbenennen');
  assert(/api\.patch\(/.test(comp), 'PATCH zum Reorder');
  assert(/api\.delete\(/.test(comp), 'DELETE zum Löschen');
});
test('Dispatcht category-manager-changed nach Mutationen', () => {
  assert(/category-manager-changed/.test(comp), 'Event muss dispatcht werden');
});
test('Notizen aktualisieren sich nach Manager-Mutationen über einen lebenszyklusfesten Callback', () => {
  assert(/this\._onChanged\?\.\(detail\)/.test(comp), 'der Manager muss den direkten Change-Callback aufrufen');
  assert(/pending\?\.catch/.test(comp), 'ein fehlgeschlagener Seiten-Refresh darf die Mutation nicht als Fehler melden');
  const managerFn = notesPage.match(/function openNoteCategoryManager\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert(/onChanged:\s*refresh/.test(managerFn), 'Notizen müssen ihren Refresh direkt konfigurieren');
  assert(!/removeEventListener\('category-manager-changed'/.test(managerFn),
    'der Notes-Refresh darf nicht mit dem vor DELETE laufenden Modal-Cleanup verschwinden');
});
test('Räumt Listener in disconnectedCallback auf', () => {
  assert(/disconnectedCallback\s*\(\)\s*\{[\s\S]*removeEventListener/.test(comp), 'Listener-Cleanup nötig');
});
test('Nutzt kein innerHTML', () => {
  assert(!/\.innerHTML/.test(comp), 'innerHTML ist verboten');
});
test('Escaped Nutzerdaten via esc()', () => {
  assert(/import \{[^}]*esc[^}]*\} from '\/utils\/html\.js'/.test(comp), 'esc muss importiert werden');
});
test('Zeigt lokalisierte Server-Guard-Fehler (reason → t()) mit Fallback', () => {
  assert(/showToast\(\s*this\._errMsg\(err\)/.test(comp), 'Fehler müssen über _errMsg (lokalisiert) statt roher err.message angezeigt werden');
  assert(/err\?\.data\?\.reason/.test(comp), '_errMsg muss den stabilen reason-Code aus err.data lesen');
  assert(/'category_in_use'/.test(comp) && /'category_last'/.test(comp) && /'category_exists'/.test(comp), 'Kategorie-reason-Codes müssen gemappt werden');
  assert(/t\('category\.errorInUse'/.test(comp), 'auf lokalisierte category.error*-Keys mappen');
  assert(/err\?\.message/.test(comp), 'Fallback auf die Server-Meldung bei unbekanntem reason');
});
test('Behält einen abgewiesenen Umbenennungswert für den nächsten Versuch', () => {
  assert(/let promptValue = current/.test(comp), 'der eingegebene Name muss nach 409 erhalten bleiben');
  assert(/err\?\.status !== 409/.test(comp), 'nur ein Namenskonflikt öffnet den Rename-Dialog erneut');
});
test('Unterstützt Subkategorien unter basePath/:key/subcategories', () => {
  assert(/subcategories/.test(comp), 'Subkategorie-Pfad muss vorkommen');
  assert(/this\._supportsSub/.test(comp), 'supportsSubcategories muss ausgewertet werden');
});

const budgetPage = readFileSync(new URL('../public/pages/budget.js', import.meta.url), 'utf8');
test('Budget importiert die generische Komponente', () => {
  assert(/components\/category-manager\.js/.test(budgetPage), 'budget.js muss die Komponente importieren');
  assert(/yuvomi-category-manager/.test(budgetPage), 'budget.js muss das Element verwenden');
});
test('Notizen importieren die generische Komponente auch beim direkten Seitenaufruf', () => {
  assert(/components\/category-manager\.js/.test(notesPage), 'notes.js muss die Komponente importieren');
  assert(/yuvomi-category-manager/.test(notesPage), 'notes.js muss das Element verwenden');
});
test('Notiz-Kategorien nutzen eine gemeinsame scope-fähige Eingabe und Scope-Icons', () => {
  assert(/unifiedAdd:\s*true/.test(notesPage), 'Notizen müssen genau eine gemeinsame Add-Eingabe konfigurieren');
  assert(/rowIconResolver/.test(notesPage), 'Notizen müssen persönliche und Haushaltskategorien per Icon unterscheiden');
  assert(/addScopeHelpKey/.test(notesPage), 'Die Scope-Wahl braucht einen erklärenden Tooltip');
  assert(/this\._unifiedAdd/.test(comp), 'Category Manager muss den gemeinsamen Add-Modus unterstützen');
  assert(/this\._rowIconResolver/.test(comp), 'Category Manager muss opt-in Scope-Icons unterstützen');
});
test('Scope-Tooltip und Berechtigungs-Einzüge funktionieren auch in RTL-Sprachen', () => {
  assert(/inset-inline-end:\s*0/.test(compCss), 'Tooltip muss logisch am Inline-Ende verankert sein');
  assert(/padding-inline-start:\s*var\(--space-8\)/.test(settingsCss), 'Widget-Einzug muss logisch sein');
  assert(/margin-inline:\s*var\(--space-8\)/.test(settingsCss), 'Capability-Einzug muss logisch sein');
});
test('Budget konfiguriert basePath /budget/categories und Gruppen', () => {
  assert(/configure\(/.test(budgetPage), 'configure() muss aufgerufen werden');
  assert(/\/budget\/categories/.test(budgetPage), 'basePath /budget/categories nötig');
  assert(/supportsSubcategories:\s*true/.test(budgetPage), 'Subkategorien müssen aktiviert sein');
});
test('Budget reagiert auf category-manager-changed', () => {
  assert(/category-manager-changed/.test(budgetPage), 'Listener auf category-manager-changed nötig');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
