/**
 * Modul: Tages-Beschriftung
 * Zweck: Einen Kalendertag so benennen, wie ein Mensch ihn nennt - „Heute",
 *        „Gestern", sonst der Wochentag mit Datum.
 * Abhaengigkeiten: i18n.js, utils/date.js, utils/timezone.js
 *
 * Steht hier und nicht in der Aufgabenseite, weil zwei Verlaeufe dieselbe Frage
 * stellen: die Verlaufsansicht des Moduls und der Serienverlauf in der
 * Leseansicht einer Aufgabe - und die Leseansicht wird inzwischen auch von der
 * Uebersicht und vom Kalender geoeffnet.
 */

import { t, getLocale, formatDate } from '/i18n.js';
import { todayKey, addLocalDays } from '/utils/date.js';
import { zonedUTCProxy } from '/utils/timezone.js';

/**
 * Die Tages-Überschrift zu einem Datums-Key der Anzeigezone.
 *
 * DREI FALLEN AUF ENGEM RAUM, jede davon hier einmal eingebaut gewesen:
 *
 * 1. „Gestern" kommt aus `addLocalDays(today, -1)`, also aus Arithmetik auf dem
 *    KEY. Ein `Date` minus 86400000 ms trifft an der Sommerzeitgrenze den
 *    vorletzten Tag - und sobald die Anzeigezone von der des Browsers abweicht,
 *    liegt es ohnehin daneben, weil `parseLocalDateKey` seine Mitternacht in
 *    der Browserzone baut.
 * 2. Der Key geht ROH an `formatDate`. Ein Umweg über ein `Date` macht aus dem
 *    zonenlosen Kalendertag einen Zeitpunkt, den die Anzeigezone anschließend
 *    wieder umrechnet - und die Überschrift kann auf dem Nachbartag landen,
 *    während die Zeilen darunter alle vom richtigen stammen.
 * 3. `formatDate` nimmt genau EIN Argument (public/i18n.js). Ein
 *    Optionsobjekt daneben wird stillschweigend verworfen, und die als
 *    „Montag, 24. August" gedachte Zeile stand als „24.08.2026" da. Der
 *    Wochentag kommt deshalb über den `zonedUTCProxy`-Weg, wie im Dashboard.
 */
export function historyDayLabel(dayKey) {
  const today = todayKey();
  if (dayKey === today) return t('common.today');
  if (dayKey === addLocalDays(today, -1)) return t('common.yesterday');
  const proxy = zonedUTCProxy(`${dayKey}T12:00:00`);
  if (!proxy) return formatDate(dayKey);
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(proxy);
}
