/**
 * Tests: UX Utilities (stagger, vibrate)
 * Läuft im Node-Kontext — kein DOM verfügbar, daher nur Pure-Logic-Tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimales Window/Navigator-Mock für Node
const { stagger, vibrate } = await (async () => {
  // stagger braucht window.matchMedia — wir mocken es
  global.window = {
    matchMedia: () => ({ matches: false }),
  };
  // navigator ist in Node ein getter-only property — über defineProperty überschreiben
  Object.defineProperty(global, 'navigator', {
    value: { vibrate: null },
    writable: true,
    configurable: true,
  });
  return import('./public/utils/ux.js');
})();

test('stagger: setzt opacity:0 auf alle Elemente', () => {
  const els = [{ style: {} }, { style: {} }, { style: {} }];
  stagger(els, { delay: 0, duration: 0 });
  assert.equal(els[0].style.opacity, '0');
  assert.equal(els[1].style.opacity, '0');
  assert.equal(els[2].style.opacity, '0');
});

test('stagger: tut nichts bei prefers-reduced-motion', () => {
  global.window.matchMedia = () => ({ matches: true });
  const els = [{ style: {} }];
  stagger(els);
  assert.equal(els[0].style.opacity, undefined); // unverändert
  global.window.matchMedia = () => ({ matches: false }); // reset
});

test('vibrate: tut nichts wenn API nicht vorhanden', () => {
  Object.defineProperty(global, 'navigator', { value: { vibrate: null }, writable: true, configurable: true });
  assert.doesNotThrow(() => vibrate(10));
});

test('vibrate: ruft navigator.vibrate auf wenn vorhanden', () => {
  let called = null;
  Object.defineProperty(global, 'navigator', { value: { vibrate: (p) => { called = p; } }, writable: true, configurable: true });
  vibrate(15);
  assert.equal(called, 15);
});
