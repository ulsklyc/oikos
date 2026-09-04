/**
 * Modul: Service-Worker-Build-Revision
 * Zweck: Gleichversionige Images dürfen keine ältere PWA-Shell wiederverwenden.
 * Run: node --test test/test-service-worker-build-revision.js
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const serviceWorkerModule = await import('../server/utils/service-worker.js');

test('renders a distinct service worker response for each same-version build revision', () => {
  assert.equal(typeof serviceWorkerModule.renderServiceWorkerSource, 'function');

  const template = "globalThis.cacheRevision = '__YUVOMI_BUILD_REVISION__';";
  const first = serviceWorkerModule.renderServiceWorkerSource(template, 'acceptance-a');
  const second = serviceWorkerModule.renderServiceWorkerSource(template, 'acceptance-b');

  assert.equal(first, "globalThis.cacheRevision = 'acceptance-a';");
  assert.equal(second, "globalThis.cacheRevision = 'acceptance-b';");
  assert.notEqual(first, second);
});

test('the shipped service worker gives same-version builds different cache namespaces', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const first = serviceWorkerModule.renderServiceWorkerSource(source, 'acceptance-a');
  const second = serviceWorkerModule.renderServiceWorkerSource(source, 'acceptance-b');

  assert.notEqual(first, second);
  assert.match(first, /const APP_BUILD_REVISION\s*=\s*'acceptance-a'/);
  assert.match(first, /yuvomi-shell-\$\{CACHE_RELEASE\}/);
  assert.doesNotMatch(first, /__YUVOMI_BUILD_REVISION__/);
});

test('builds a non-cacheable service worker response and falls back to the app version', () => {
  assert.equal(typeof serviceWorkerModule.buildServiceWorkerResponse, 'function');

  const response = serviceWorkerModule.buildServiceWorkerResponse(
    "globalThis.cacheRevision = '__YUVOMI_BUILD_REVISION__';",
    { appVersion: '2.59.0', buildRevision: '' },
  );

  assert.deepEqual(response, {
    body: "globalThis.cacheRevision = '2.59.0';",
    contentType: 'text/javascript; charset=utf-8',
    cacheControl: 'no-store, max-age=0',
    cdnCacheControl: 'no-store',
    cloudflareCdnCacheControl: 'no-store',
  });
});

test('rejects unsafe APP_BUILD_REVISION values with the variable name and allowed format', () => {
  for (const value of [
    "a'; fetch('//evil')//",
    'a\\',
    'a\nb',
    '</script>',
    'a'.repeat(81),
    '',
  ]) {
    assert.throws(
      () => serviceWorkerModule.renderServiceWorkerSource('revision: __YUVOMI_BUILD_REVISION__', value),
      /\[SW\] APP_BUILD_REVISION must match \/\^\[A-Za-z0-9\._-\]\{1,80\}\$\//,
    );
  }
});

test('falls back to the app version when APP_BUILD_REVISION is blank after trimming', () => {
  const response = serviceWorkerModule.buildServiceWorkerResponse(
    "globalThis.cacheRevision = '__YUVOMI_BUILD_REVISION__';",
    { appVersion: '2.59.0', buildRevision: '   ' },
  );

  assert.equal(response.body, "globalThis.cacheRevision = '2.59.0';");
});

test('reloads an edited service worker source from an isolated file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yuvomi-service-worker-'));
  const sourcePath = join(directory, 'sw.js');

  try {
    writeFileSync(sourcePath, "globalThis.cacheRevision = '__YUVOMI_BUILD_REVISION__';\n");
    const load = serviceWorkerModule.createServiceWorkerResponseLoader(sourcePath, {
      appVersion: '2.59.0',
      buildRevision: 'acceptance-route-test',
    });

    assert.equal(
      load().body,
      "globalThis.cacheRevision = 'acceptance-route-test';\n",
    );

    writeFileSync(
      sourcePath,
      "globalThis.cacheRevision = '__YUVOMI_BUILD_REVISION__';\n// edited\n",
    );

    assert.match(load().body, /\/\/ edited/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
