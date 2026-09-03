/**
 * Modul: Gruppenschluessel der Rechtematrix zerlegen (#1009)
 * Zweck: Aus `typ:schluessel` die beiden Teile holen, wenn der SCHLUESSEL
 *        selbst Doppelpunkte enthalten darf.
 * Abhaengigkeiten: keine
 *
 * WARUM DAS EINE EIGENE DATEI IST UND KEIN split(':'). Die Rechtematrix
 * beschriftet jedes Segment-Control mit `module:<schluessel>` bzw.
 * `widget:<id>`. Fuer Kernmodule ist das ein Paar; fuer Fremdmodule nicht:
 *
 *   module:tasks              -> Kernmodul
 *   module:ext:mein-modul     -> Fremdmodul, Schluessel ist `ext:<modulId>`
 *   widget:countdown          -> Kern-Widget
 *   widget:mein-modul:kachel  -> Fremd-Widget, Id ist `<modulId>:<widgetId>`
 *
 * `const [type, key] = String(group).split(':')` nimmt aus den letzten beiden
 * Zeilen `key = 'ext'` bzw. `key = 'mein-modul'` - der Rest faellt weg. Genau
 * das war #1009: der Entwurf trug danach `modules['ext']`, und der Server
 * antwortete voellig zu Recht `Unknown module: ext`. Der Fehler sah nach einem
 * Serverproblem aus und stand in der Oberflaeche.
 *
 * Getrennt wird deshalb am ERSTEN Doppelpunkt: der Typ ist ein einzelnes Wort,
 * alles danach gehoert dem Schluessel. Dasselbe Muster wie `${var##*:}` in der
 * Shell, nur mit umgekehrter Blickrichtung - und mit demselben Fallstrick.
 *
 * NICHT ZU VERWECHSELN mit `id.split(':')[0]` an einer Widget-Id: dort ist die
 * ERSTE Komponente gesucht (die Modul-Id), und dafuer ist split richtig.
 */

/**
 * Zerlegt einen Gruppenschluessel in Typ und Schluessel.
 *
 * @param {string} group - z.B. `module:ext:mein-modul`
 * @returns {{type: string, key: string}} - leerer `key`, wenn kein
 *   Doppelpunkt vorkommt oder nichts dahinter steht. Der Aufrufer bricht
 *   darauf ab, statt `undefined` als Schluessel weiterzureichen.
 */
export function parsePermissionGroup(group) {
  const raw = String(group ?? '');
  const sep = raw.indexOf(':');
  if (sep < 0) return { type: raw, key: '' };
  return { type: raw.slice(0, sep), key: raw.slice(sep + 1) };
}
