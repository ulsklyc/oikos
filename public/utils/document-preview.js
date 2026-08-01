/**
 * Geteiltes Vokabular für die Dokument-Vorschau (Client-Seite).
 *
 * Die sechs Typen spiegeln `PREVIEWABLE_MIME` in server/routes/documents.js — nur
 * diese liefert der Server mit `Content-Disposition: inline` aus, alles andere
 * beantwortet /preview mit 415. Die Server-Liste bleibt bewusst eine eigene,
 * unabhängige Allowlist (Defense-in-Depth): sie darf nicht aus dem Client
 * abgeleitet werden, sonst entschiede eine Frontend-Änderung mit, was inline
 * ausgeliefert wird.
 *
 * `previewKind()` ist die eine Stelle, die MIME auf einen Renderer abbildet.
 * Der Viewer in pages/documents.js und die Preview-vs-Download-Entscheidung in
 * pages/tasks.js lesen beide hier, statt die Typen erneut auszuschreiben.
 */

/** MIME ohne Parameter, klein: `text/plain; charset=utf-8` -> `text/plain`. */
function baseMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

// Renderer-Familien. Ein Typ gehört zu genau einer Familie.
const PREVIEW_KINDS = Object.freeze({
  pdf:   Object.freeze(['application/pdf']),
  image: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
  text:  Object.freeze(['text/plain', 'text/csv']),
});

/**
 * Renderer-Familie eines MIME-Typs: `'pdf'`, `'image'`, `'text'` oder `null`
 * für nicht darstellbare Typen (Download-only).
 */
export function previewKind(mime) {
  const m = baseMime(mime);
  for (const [kind, types] of Object.entries(PREVIEW_KINDS)) {
    if (types.includes(m)) return kind;
  }
  return null;
}

/** True, wenn der Typ inline vorschaubar ist; sonst nur als Download verlinkbar. */
export function isPreviewable(mime) {
  return previewKind(mime) !== null;
}
