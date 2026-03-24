/**
 * Modul: Eingabe-Validierung (Validate)
 * Zweck: Wiederverwendbare Validierungs-Helfer für alle API-Routen
 * Abhängigkeiten: keine
 */

'use strict';

// Globale Längengrenzen
const MAX_TITLE    = 200;
const MAX_TEXT     = 5000;
const MAX_SHORT    = 100;

/**
 * Bereinigt und validiert einen Pflicht-String.
 * @param {any}    val      - Eingabewert
 * @param {string} field    - Feldname (für Fehlermeldung)
 * @param {object} opts
 * @param {number} [opts.max=200]      - Maximale Länge
 * @param {boolean}[opts.required=true]- Ob das Feld Pflicht ist
 * @returns {{ value: string|null, error: string|null }}
 */
function str(val, field, { max = MAX_TITLE, required = true } = {}) {
  if (val === undefined || val === null || val === '') {
    if (required) return { value: null, error: `${field} ist erforderlich.` };
    return { value: null, error: null };
  }
  const s = String(val).trim();
  if (required && !s) return { value: null, error: `${field} darf nicht leer sein.` };
  if (s.length > max)  return { value: null, error: `${field} darf maximal ${max} Zeichen haben.` };
  return { value: s || null, error: null };
}

/**
 * Validiert einen Enum-Wert.
 * @param {any}      val
 * @param {string[]} allowed
 * @param {string}   field
 * @returns {{ value: string|null, error: string|null }}
 */
function oneOf(val, allowed, field) {
  if (val === undefined || val === null || val === '') return { value: null, error: null };
  if (!allowed.includes(val))
    return { value: null, error: `${field} muss eines von: ${allowed.join(', ')} sein.` };
  return { value: val, error: null };
}

/**
 * Validiert ein Datumsformat YYYY-MM-DD.
 * @param {any}    val
 * @param {string} field
 * @param {boolean} required
 */
function date(val, field, required = false) {
  if (!val) {
    if (required) return { value: null, error: `${field} ist erforderlich.` };
    return { value: null, error: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(val)))
    return { value: null, error: `${field} muss im Format YYYY-MM-DD sein.` };
  return { value: String(val), error: null };
}

/**
 * Validiert ein Zeit-Format HH:MM.
 */
function time(val, field) {
  if (!val) return { value: null, error: null };
  if (!/^\d{2}:\d{2}$/.test(String(val)))
    return { value: null, error: `${field} muss im Format HH:MM sein.` };
  return { value: String(val), error: null };
}

/**
 * Validiert eine Zahl (positiv oder negativ).
 */
function num(val, field, { required = false } = {}) {
  if (val === undefined || val === null || val === '') {
    if (required) return { value: null, error: `${field} ist erforderlich.` };
    return { value: null, error: null };
  }
  const n = Number(val);
  if (!isFinite(n)) return { value: null, error: `${field} muss eine gültige Zahl sein.` };
  return { value: n, error: null };
}

/**
 * Validiert eine Hex-Farbe (#RRGGBB).
 */
function color(val, field) {
  if (!val) return { value: null, error: null };
  if (!/^#[0-9A-Fa-f]{6}$/.test(String(val)))
    return { value: null, error: `${field} muss ein gültiger HEX-Farbwert sein (#RRGGBB).` };
  return { value: String(val), error: null };
}

/**
 * Sammelt alle Fehler aus einem Array von Validierungsergebnissen.
 * @param {Array<{ error: string|null }>} results
 * @returns {string[]} Fehlerliste
 */
function collectErrors(results) {
  return results.map((r) => r.error).filter(Boolean);
}

module.exports = { str, oneOf, date, time, num, color, collectErrors, MAX_TITLE, MAX_TEXT, MAX_SHORT };
