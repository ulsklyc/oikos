/**
 * Modul: RRULE UI-Helfer
 * Zweck: Wiederholungs-Formular (HTML + Logik) für Aufgaben- und Kalender-Modals
 * Abhängigkeiten: /i18n.js
 */

import { t, formatDate, formatDateInput, parseDateInput, isDateInputValid } from '/i18n.js';

const FREQ_OPTIONS = () => [
  { value: '',        label: t('rrule.freqNone') },
  { value: 'DAILY',   label: t('rrule.freqDaily') },
  { value: 'WEEKLY',  label: t('rrule.freqWeekly') },
  { value: 'MONTHLY', label: t('rrule.freqMonthly') },
  { value: 'YEARLY',  label: t('rrule.freqYearly') },
];

const WEEKDAYS = () => [
  { value: 'MO', label: t('rrule.dayMo') },
  { value: 'TU', label: t('rrule.dayTu') },
  { value: 'WE', label: t('rrule.dayWe') },
  { value: 'TH', label: t('rrule.dayTh') },
  { value: 'FR', label: t('rrule.dayFr') },
  { value: 'SA', label: t('rrule.daySa') },
  { value: 'SU', label: t('rrule.daySu') },
];

/**
 * Parsed einen RRULE-String in ein Objekt für die UI.
 *
 * Nimmt die Regel mit und ohne „RRULE:"-Präfix. Beide Schreibweisen stehen
 * nebeneinander in der Datenbank: lokal angelegte Serien speichern den nackten
 * Regelkörper, aus CalDAV/ICS eingelesene die vollständige ICS-Zeile
 * (`ics-parser.js`). Ohne das Abstreifen hieß das erste Segment `RRULE:FREQ`,
 * kein einziger Schlüssel traf, und eine synchronisierte Serie kam als
 * „keine Wiederholung" ins Formular - Speichern schrieb diese Leere fest und
 * der Sync trug den Verlust zurück in den Fremdkalender (#756). Der Server
 * macht dasselbe seit jeher (`server/services/recurrence.js`).
 *
 * @param {string|null} rule - z.B. "FREQ=WEEKLY;BYDAY=MO,TH;INTERVAL=2;COUNT=10"
 * @returns {{ freq: string, interval: number, byday: string[], until: string, count: number|null }}
 */
export function parseRRule(rule) {
  const result = { freq: '', interval: 1, byday: [], until: '', count: null };
  if (!rule) return result;

  for (const segment of String(rule).replace(/^RRULE:/i, '').split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).toUpperCase();
    const val = segment.slice(eq + 1);

    if (key === 'FREQ')     result.freq     = val;
    if (key === 'INTERVAL') result.interval  = parseInt(val, 10) || 1;
    if (key === 'BYDAY')    result.byday     = val.split(',').map(d => d.trim());
    if (key === 'UNTIL') {
      // YYYYMMDD → YYYY-MM-DD
      const c = val.replace(/[TZ]/g, '');
      result.until = `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
    }
    if (key === 'COUNT') {
      const n = parseInt(val, 10);
      if (Number.isInteger(n) && n > 0) result.count = n;
    }
  }
  return result;
}

/**
 * Baut einen RRULE-String aus den UI-Werten. UNTIL und COUNT schließen sich
 * gegenseitig aus (RFC 5545); COUNT hat Vorrang, falls beide gesetzt sind (#513).
 * @param {{ freq: string, interval: number, byday: string[], until: string, count?: number|null }} opts
 * @returns {string|null} - RRULE-String oder null (keine Wiederholung)
 */
export function buildRRule({ freq, interval, byday, until, count = null }) {
  if (!freq) return null;

  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (freq === 'WEEKLY' && byday.length > 0) {
    parts.push(`BYDAY=${byday.join(',')}`);
  }
  if (count && count > 0) {
    parts.push(`COUNT=${count}`);
  } else if (until) {
    parts.push(`UNTIL=${until.replace(/-/g, '')}T235959Z`);
  }
  return parts.join(';');
}

/**
 * Rendert das HTML für die Wiederholungs-Felder.
 * @param {string} prefix - ID-Prefix (z.B. "task" oder "event")
 * @param {string|null} existingRule - bestehende RRULE oder null
 * @param {{ allowCount?: boolean, allowFromCompletion?: boolean, fromCompletion?: boolean }} [opts]
 *        allowCount aktiviert die "Nach N Terminen"-Endebedingung (COUNT). Nur
 *        für Kontexte mit startverankerter Expansion (Kalender). Aufgaben sind
 *        abschluss-getrieben und kennen keine COUNT-Semantik (#513).
 *        allowFromCompletion aktiviert den Ankerschalter "ab Erledigung" (#658) -
 *        umgekehrt nur dort, wo es ein Erledigen gibt: ein Termin wird nicht
 *        abgehakt, für ihn gäbe es keinen zweiten Anker.
 * @returns {string} HTML-String
 */
export function renderRRuleFields(prefix, existingRule, opts = {}) {
  const allowCount = !!opts.allowCount;
  const allowFromCompletion = !!opts.allowFromCompletion;
  const fromCompletion = !!opts.fromCompletion;
  const parsed = parseRRule(existingRule);

  const freqOpts = FREQ_OPTIONS().map(o =>
    `<option value="${o.value}" ${parsed.freq === o.value ? 'selected' : ''}>${o.label}</option>`
  ).join('');

  const dayBtns = WEEKDAYS().map(d =>
    `<button type="button" class="rrule-day ${parsed.byday.includes(d.value) ? 'rrule-day--active' : ''}"
             data-day="${d.value}" aria-label="${d.label}" aria-pressed="${parsed.byday.includes(d.value)}">${d.label}</button>`
  ).join('');

  // Endebedingung: Nie / Am Datum (UNTIL) / Nach N Terminen (COUNT). COUNT und
  // UNTIL schließen sich aus (RFC 5545) – der Selektor blendet je Wahl ein Feld ein.
  // COUNT nur wenn allowCount (Kalender); sonst wird ein bestehendes COUNT wie
  // "kein Ende" behandelt (Aufgaben-Engine kennt COUNT ohnehin nicht).
  const endType = (allowCount && parsed.count) ? 'count' : (parsed.until ? 'until' : 'never');
  const endOpts = [
    { value: 'never', label: t('rrule.endNever') },
    { value: 'until', label: t('rrule.endOnDate') },
    ...(allowCount ? [{ value: 'count', label: t('rrule.endAfter') }] : []),
  ].map(o => `<option value="${o.value}" ${endType === o.value ? 'selected' : ''}>${o.label}</option>`).join('');

  // Die Ausgangsregel im Wortlaut, für den Unverändert-Fall in getRRuleValues.
  // `esc` ist hier nicht nötig und wäre falsch: der Wert durchläuft den
  // Validator des Servers, und ein RRULE-Zeichenvorrat kennt keine Anführungs-
  // zeichen. Trotzdem attributsicher quoten - der Wert kommt aus einem
  // Fremdkalender, nicht aus dieser Oberfläche.
  const sourceRule = existingRule
    ? `<input type="hidden" id="${prefix}-rrule-source" value="${String(existingRule).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}">`
    : '';

  return `
    <div class="rrule-fields" id="${prefix}-rrule-fields">
      ${sourceRule}
      <div class="form-group">
        <label class="label form-label" for="${prefix}-rrule-freq">${t('rrule.labelRepeat')}</label>
        <select class="input form-input" id="${prefix}-rrule-freq"
                aria-describedby="${prefix}-rrule-hint">
          ${freqOpts}
        </select>
        <p class="rrule-hint" id="${prefix}-rrule-hint" ${parsed.freq ? 'hidden' : ''}>${t('rrule.intervalHint')}</p>
      </div>

      <div class="rrule-details" id="${prefix}-rrule-details" ${parsed.freq ? '' : 'hidden'}>
        <div class="rrule-row">
          <div class="form-group" style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-interval">${t('rrule.labelEvery')}</label>
            <div class="rrule-interval-wrap">
              <input class="input form-input" type="number" id="${prefix}-rrule-interval"
                     min="1" max="99" value="${parsed.interval}" inputmode="numeric" style="width:64px;text-align:center">
              <span class="rrule-interval-unit" id="${prefix}-rrule-unit">${intervalUnitLabel(parsed.freq, parsed.interval)}</span>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-end">${t('rrule.labelEnds')}</label>
            <select class="input form-input" id="${prefix}-rrule-end">
              ${endOpts}
            </select>
          </div>
        </div>

        <div class="rrule-row rrule-end-inputs">
          <div class="form-group rrule-until-field" id="${prefix}-rrule-until-wrap" ${endType === 'until' ? '' : 'hidden'} style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-until">${t('rrule.labelUntil')}</label>
            <yuvomi-datepicker type="date" id="${prefix}-rrule-until"
                   value="${formatDateInput(parsed.until)}"></yuvomi-datepicker>
          </div>
          ${allowCount ? `<div class="form-group rrule-count-field" id="${prefix}-rrule-count-wrap" ${endType === 'count' ? '' : 'hidden'} style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-count">${t('rrule.labelCount')}</label>
            <div class="rrule-interval-wrap">
              <input class="input form-input" type="number" id="${prefix}-rrule-count"
                     min="1" max="999" value="${parsed.count || 10}" inputmode="numeric" style="width:64px;text-align:center">
              <span class="rrule-interval-unit">${t('rrule.unitOccurrences')}</span>
            </div>
          </div>` : ''}
        </div>

        <div class="rrule-weekdays" id="${prefix}-rrule-weekdays" ${parsed.freq === 'WEEKLY' ? '' : 'hidden'}>
          <label class="label form-label">${t('rrule.labelOnDays')}</label>
          <div class="rrule-day-grid">${dayBtns}</div>
        </div>

        ${allowFromCompletion ? `
        <div class="rrule-anchor">
          <label class="toggle" style="margin:0">
            <input type="checkbox" id="${prefix}-rrule-from-completion" ${fromCompletion ? 'checked' : ''}>
            <span class="toggle__track"></span>
            <span>${t('rrule.fromCompletionLabel')}</span>
          </label>
          <p class="rrule-anchor__hint">${t('rrule.fromCompletionHint')}</p>
        </div>` : ''}

      </div>
    </div>
  `;
}

/**
 * Das Wort hinter „Alle N": Einheit in Ein- oder Mehrzahl.
 *
 * Versteht beide Schreibweisen - die RRULE-Frequenz (`WEEKLY`) und die
 * Budget-Einheit (`weekly`, #636). Die Zuordnung Einheit → Wort lag sonst ein
 * zweites Mal im Budget-Modal, sobald auch dort „alle N Monate" wählbar wurde.
 *
 * @param {string} unit   DAILY|WEEKLY|MONTHLY|YEARLY oder weekly|monthly|yearly
 * @param {number} count  Anzahl, entscheidet über Ein-/Mehrzahl
 */
export function intervalUnitLabel(unit, count = 1) {
  const n = count > 1;
  switch (String(unit || '').toUpperCase()) {
    case 'DAILY':   return n ? t('rrule.unitDays')   : t('rrule.unitDay');
    case 'WEEKLY':  return n ? t('rrule.unitWeeks')  : t('rrule.unitWeek');
    case 'MONTHLY': return n ? t('rrule.unitMonths') : t('rrule.unitMonth');
    case 'YEARLY':  return n ? t('rrule.unitYears')  : t('rrule.unitYear');
    default:        return '';
  }
}


/**
 * Beschreibt eine RRULE in einem Satz: „Alle 2 Wochen (Mo, Do) bis 31.12.2026".
 *
 * Für die Detailansicht: Ob ein Termin wöchentlich wiederkehrt, war bisher nur
 * im Bearbeitungsformular zu sehen - man musste den Termin öffnen, um eine
 * Leseinformation zu bekommen.
 *
 * @param {string|null} rule
 * @param {{ fromCompletion?: boolean }} [opts] Der Anker steht nicht in der
 *        RRULE (RFC 5545 kennt ihn nicht) und muss deshalb hier hereingereicht
 *        werden. Ohne ihn läse sich „Jede Woche" für zwei verschiedene Serien
 *        gleich, obwohl sie an verschiedenen Tagen wiederkommen (#658).
 * @returns {string} leerer String, wenn keine Wiederholung
 */
export function describeRRule(rule, opts = {}) {
  const p = parseRRule(rule);
  if (!p.freq) return '';

  // Die Beschriftungen kommen aus denselben Listen, die auch das Formular füllt.
  // Eine zweite Wert-zu-Label-Zuordnung daneben hiesse, jede künftige Frequenz
  // an zwei Stellen zu pflegen.
  const parts = [
    p.interval > 1
      ? `${t('rrule.labelEvery')} ${p.interval} ${intervalUnitLabel(p.freq, p.interval)}`
      : (FREQ_OPTIONS().find((o) => o.value === p.freq)?.label ?? t('rrule.freqDaily')),
  ];

  // Wochentage nur bei WEEKLY: bei jeder anderen Frequenz trägt BYDAY in dieser
  // Oberfläche keine Bedeutung (buildRRule schreibt es dort auch nicht).
  if (p.freq === 'WEEKLY' && p.byday.length) {
    const weekdays = WEEKDAYS();
    const days = p.byday.map((d) => weekdays.find((w) => w.value === d)?.label).filter(Boolean);
    if (days.length) parts.push(`(${days.join(', ')})`);
  }

  // Die Endebedingung ist eine eigene Aussage und bekommt einen Trenner:
  // „Alle 2 Monate 5 Termine" las sich wie ein verunglückter Satz.
  let rhythm = parts.join(' ');
  if (opts.fromCompletion) rhythm += ` · ${t('rrule.summaryFromCompletion')}`;
  if (p.count) return `${rhythm} · ${t('rrule.summaryCount', { count: p.count })}`;
  if (p.until) return `${rhythm} · ${t('rrule.summaryUntil', { date: formatDate(p.until) })}`;
  return rhythm;
}

/**
 * Die Wiederholung als fertige Zeile für die Detailansicht.
 *
 * Wohnt hier statt in detail-view.js, weil dieses Modul das Konzept
 * „Wiederholungsregel" besitzt - Kalender und Aufgaben bauten die Zeile sonst
 * beide selbst, wortgleich bis auf die Entität.
 *
 * @param {string|null} rule
 * @param {{ fromCompletion?: boolean }} [opts] siehe describeRRule
 * @returns {{icon: string, label: string, value: string}}
 */
export function recurrenceRow(rule, opts = {}) {
  return { icon: 'repeat', label: t('rrule.labelRepeat'), value: describeRRule(rule, opts) };
}

/**
 * Bindet Events an die RRULE-Felder (Freq-Change, Day-Toggle, etc.)
 * @param {HTMLElement} root - Container-Element
 * @param {string} prefix - ID-Prefix
 */
export function bindRRuleEvents(root, prefix) {
  const freqSelect  = root.querySelector(`#${prefix}-rrule-freq`);
  const details     = root.querySelector(`#${prefix}-rrule-details`);
  const weekdays    = root.querySelector(`#${prefix}-rrule-weekdays`);
  const unitEl      = root.querySelector(`#${prefix}-rrule-unit`);
  const intervalEl  = root.querySelector(`#${prefix}-rrule-interval`);
  const endSelect   = root.querySelector(`#${prefix}-rrule-end`);
  const untilWrap   = root.querySelector(`#${prefix}-rrule-until-wrap`);
  const countWrap   = root.querySelector(`#${prefix}-rrule-count-wrap`);
  const hint        = root.querySelector(`#${prefix}-rrule-hint`);

  if (!freqSelect) return;

  freqSelect.addEventListener('change', () => {
    const freq = freqSelect.value;
    if (details)  details.hidden  = !freq;
    if (weekdays) weekdays.hidden = freq !== 'WEEKLY';
    // Der Hinweis ist die Umkehrung des Detailbereichs: er beantwortet die Frage
    // "sind das die einzigen vier Takte?", und sobald der Takt sichtbar danebensteht,
    // hat sie sich erledigt (#862).
    if (hint)     hint.hidden     = !!freq;
    updateUnit();
  });

  endSelect?.addEventListener('change', () => {
    const mode = endSelect.value;
    if (untilWrap) untilWrap.hidden = mode !== 'until';
    if (countWrap) countWrap.hidden = mode !== 'count';
  });

  intervalEl?.addEventListener('input', updateUnit);

  // Day-Toggle
  root.querySelectorAll(`#${prefix}-rrule-weekdays .rrule-day`).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('rrule-day--active');
      btn.setAttribute('aria-pressed', btn.classList.contains('rrule-day--active'));
    });
  });

  function updateUnit() {
    if (!unitEl) return;
    const interval = parseInt(intervalEl?.value, 10) || 1;
    unitEl.textContent = intervalUnitLabel(freqSelect.value, interval);
  }
}

/**
 * Liest die aktuellen RRULE-Werte aus dem Formular.
 * @param {HTMLElement} root - Container-Element
 * @param {string} prefix - ID-Prefix
 * @returns {{ is_recurring: boolean, recurrence_rule: string|null,
 *            recurrence_from_completion: boolean, valid_until: boolean }}
 */
export function getRRuleValues(root, prefix) {
  const freq     = root.querySelector(`#${prefix}-rrule-freq`)?.value || '';
  const interval = parseInt(root.querySelector(`#${prefix}-rrule-interval`)?.value, 10) || 1;
  const endMode  = root.querySelector(`#${prefix}-rrule-end`)?.value || 'never';
  const untilInput = root.querySelector(`#${prefix}-rrule-until`);
  const untilRaw = endMode === 'until' ? (untilInput?.value || '') : '';
  const until = parseDateInput(untilRaw);
  const count = endMode === 'count'
    ? (parseInt(root.querySelector(`#${prefix}-rrule-count`)?.value, 10) || null)
    : null;

  const byday = [];
  root.querySelectorAll(`#${prefix}-rrule-weekdays .rrule-day--active`).forEach(btn => {
    byday.push(btn.dataset.day);
  });

  const built = buildRRule({ freq, interval, byday, until, count });

  // WER NICHTS ÄNDERT, ÄNDERT NICHTS: Dieses Formular kennt nur einen Ausschnitt
  // von RFC 5545 (FREQ, INTERVAL, BYDAY, UNTIL, COUNT). Eine aus einem
  // Fremdkalender eingelesene Serie trägt oft mehr - WKST, BYMONTHDAY, BYSETPOS.
  // Aus den Feldern neu gebaut ginge dieser Rest beim Speichern verloren, obwohl
  // der Nutzer nur die Zuweisung geändert hat: aus „jeder dritte Donnerstag"
  // würde stillschweigend „jeden Monat" (#756). Deshalb der Vergleich gegen die
  // Ausgangsregel durch dieselbe Übersetzung: Stimmt der Formularstand mit dem
  // überein, was das Original in diese Oberfläche übersetzt, hat niemand an der
  // Wiederholung gedreht - dann geht die Regel im Wortlaut zurück.
  // Eine bewusst geleerte Wiederholung (built === null) fällt nicht darunter.
  const source = root.querySelector(`#${prefix}-rrule-source`)?.value || '';
  const rule = (built && source && buildRRule(parseRRule(source)) === built) ? source : built;

  // Ohne Regel ist der Anker bedeutungslos: sonst bliebe der Schalter an einer
  // Aufgabe hängen, die gar nicht mehr wiederkehrt, und käme beim nächsten
  // Einschalten der Wiederholung ungefragt zurück.
  const fromCompletion = !!rule
    && !!root.querySelector(`#${prefix}-rrule-from-completion`)?.checked;
  return {
    is_recurring:    !!rule,
    recurrence_rule: rule,
    recurrence_from_completion: fromCompletion,
    // UNTIL nur validieren, wenn "Am Datum" gewählt ist (sonst irrelevant).
    valid_until:     endMode !== 'until' || isDateInputValid(untilRaw),
  };
}
