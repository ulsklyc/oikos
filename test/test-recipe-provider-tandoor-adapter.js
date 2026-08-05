/**
 * Modul: Recipe-Provider-Adapter-Test (Tandoor)
 * Zweck: Validiert TandoorAdapter (testConnection/listRecipeSummaries/getRecipe/
 *        recipeUrl/fetchThumbnail) gegen ein gemocktes fetch - keine echte
 *        Netzwerkverbindung. Analog zu test-recipe-provider-adapter.js (Mealie)
 *        und test-dms-papra-adapter.js (zweiter Provider desselben DMS-Musters).
 * Ausführen: node --test test/test-recipe-provider-tandoor-adapter.js
 */
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { TandoorAdapter } from '../server/services/recipe-providers/tandoor.js';

const account = { base_url: 'https://tandoor.example.com/', api_token: 'tok123' };

let calls;
const realFetch = globalThis.fetch;
beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(handler) {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function binaryResponse(buffer, mime, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? mime : null) },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

test('Konstruktor entfernt trailing slash von base_url', () => {
  const adapter = new TandoorAdapter(account);
  assert.equal(adapter.base, 'https://tandoor.example.com');
});

// --------------------------------------------------------------------------
// Bearer-Auth: jeder Request trägt denselben Header
// --------------------------------------------------------------------------

test('Bearer-Authorization-Header wird bei jedem Request gesetzt', async () => {
  mockFetch(() => jsonResponse({ results: [], next: null }));
  const adapter = new TandoorAdapter(account);
  await adapter.listRecipeSummaries();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok123');
});

// --------------------------------------------------------------------------
// testConnection: /api/recipe/?page_size=1
// --------------------------------------------------------------------------

test('testConnection: ok=true bei 200 auf /api/recipe/?page_size=1', async () => {
  mockFetch(() => jsonResponse({ count: 0, results: [] }));
  const adapter = new TandoorAdapter(account);
  const out = await adapter.testConnection();
  assert.equal(calls[0].url, 'https://tandoor.example.com/api/recipe/?page_size=1');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok123');
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
});

test('testConnection: ok=false bei 401, kein Wurf', async () => {
  mockFetch(() => jsonResponse({}, 401));
  const adapter = new TandoorAdapter(account);
  const out = await adapter.testConnection();
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
});

test('testConnection: Netzwerkfehler → ok=false, status=0, error gesetzt', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const adapter = new TandoorAdapter(account);
  const out = await adapter.testConnection();
  assert.equal(out.ok, false);
  assert.equal(out.status, 0);
  assert.match(out.error, /ECONNREFUSED/);
});

// --------------------------------------------------------------------------
// listRecipeSummaries: DRF-Pagination über den `next`-Link
// --------------------------------------------------------------------------

test('listRecipeSummaries: folgt dem next-Link über mehrere Seiten', async () => {
  mockFetch((url) => {
    if (url === 'https://tandoor.example.com/api/recipe/?page=1&page_size=50') {
      return jsonResponse({
        results: [{ id: 1, updated_at: 't1' }, { id: 2, updated_at: 't2' }],
        next: 'https://tandoor.example.com/api/recipe/?page=2&page_size=50',
      });
    }
    if (url === 'https://tandoor.example.com/api/recipe/?page=2&page_size=50') {
      return jsonResponse({ results: [{ id: 3, updated_at: 't3' }], next: null });
    }
    throw new Error(`unerwartete URL: ${url}`);
  });
  const adapter = new TandoorAdapter(account);
  const summaries = await adapter.listRecipeSummaries();
  assert.equal(calls.length, 2);
  assert.deepEqual(summaries.map((s) => s.id), ['1', '2', '3']);
  assert.deepEqual(summaries.map((s) => s.ref), ['1', '2', '3']);
  assert.deepEqual(summaries.map((s) => s.updatedAt), ['t1', 't2', 't3']);
});

test('listRecipeSummaries: next=null → genau ein Request', async () => {
  mockFetch(() => jsonResponse({ results: [{ id: 9, updated_at: 't9' }], next: null }));
  const adapter = new TandoorAdapter(account);
  const summaries = await adapter.listRecipeSummaries();
  assert.equal(calls.length, 1);
  assert.equal(summaries.length, 1);
});

// --------------------------------------------------------------------------
// getRecipe: flacht steps[].ingredients, überspringt is_header-Zeilen
// --------------------------------------------------------------------------

test('getRecipe: flacht Zutaten über alle steps hinweg, überspringt is_header-Zeilen', async () => {
  mockFetch(() => jsonResponse({
    id: 5, updated_at: 't5', name: 'Soup', description: 'Tasty', image: '/media/recipe_images/soup.jpg',
    steps: [
      {
        ingredients: [
          { is_header: true, food: null },
          { food: { name: 'Carrot' }, amount: 2, unit: { name: 'pieces' }, no_amount: false },
        ],
      },
      {
        ingredients: [
          { food: { name: 'Water' }, amount: 1, unit: { name: 'liter' }, no_amount: false },
        ],
      },
    ],
  }));
  const adapter = new TandoorAdapter(account);
  const recipe = await adapter.getRecipe('5');
  assert.equal(calls[0].url, 'https://tandoor.example.com/api/recipe/5/');
  assert.equal(recipe.id, '5');
  assert.equal(recipe.title, 'Soup');
  assert.equal(recipe.notes, 'Tasty');
  assert.equal(recipe.hasImage, true);
  assert.equal(recipe.slug, '/media/recipe_images/soup.jpg');
  assert.deepEqual(recipe.ingredients.map((i) => i.name), ['Carrot', 'Water']);
});

test('getRecipe: null-Menge bei no_amount=true oder falsy amount', async () => {
  mockFetch(() => jsonResponse({
    id: 6, updated_at: 't6', name: 'Salad', description: null, image: null,
    steps: [
      {
        ingredients: [
          { food: { name: 'Salt' }, amount: 1, unit: null, no_amount: true },
          { food: { name: 'Pepper' }, amount: 0, unit: null, no_amount: false },
          { food: { name: 'Oil' }, amount: 2, unit: { name: 'tbsp' }, no_amount: false },
        ],
      },
    ],
  }));
  const adapter = new TandoorAdapter(account);
  const recipe = await adapter.getRecipe('6');
  assert.equal(recipe.hasImage, false);
  assert.equal(recipe.slug, null);
  const byName = Object.fromEntries(recipe.ingredients.map((i) => [i.name, i.quantity]));
  assert.equal(byName.Salt, null); // no_amount=true
  assert.equal(byName.Pepper, null); // amount=0 ist falsy
  assert.equal(byName.Oil, '2 tbsp');
});

test('getRecipe: HTTP-Fehler wirft mit Statuscode', async () => {
  mockFetch(() => jsonResponse({}, 404));
  const adapter = new TandoorAdapter(account);
  await assert.rejects(() => adapter.getRecipe('missing'), /Tandoor request failed \(404\)/);
});

// --------------------------------------------------------------------------
// recipeUrl: /view/recipe/{id}, linkContext wird komplett ignoriert
// --------------------------------------------------------------------------

test('recipeUrl: baut /view/recipe/{id}, ignoriert linkContext (auch null/undefined)', () => {
  const adapter = new TandoorAdapter(account);
  assert.equal(adapter.recipeUrl(null, { id: 42 }), 'https://tandoor.example.com/view/recipe/42');
  assert.equal(adapter.recipeUrl(undefined, { id: 42 }), 'https://tandoor.example.com/view/recipe/42');
  assert.equal(adapter.recipeUrl({ groupSlug: 'irrelevant' }, { id: 42 }), 'https://tandoor.example.com/view/recipe/42');
});

test('recipeUrl: nutzt external_url statt base_url, wenn gesetzt', () => {
  const adapter = new TandoorAdapter({ ...account, external_url: 'https://recipes.example.com/' });
  assert.equal(adapter.recipeUrl(null, { id: 7 }), 'https://recipes.example.com/view/recipe/7');
  assert.equal(adapter.base, 'https://tandoor.example.com');
});

// --------------------------------------------------------------------------
// fetchThumbnail: {slug} ist der gespeicherte Bildpfad, kein separater Fetch bei fehlendem slug
// --------------------------------------------------------------------------

test('fetchThumbnail: fehlender slug → wirft 404 ohne Request', async () => {
  mockFetch(() => { throw new Error('sollte nicht aufgerufen werden'); });
  const adapter = new TandoorAdapter(account);
  await assert.rejects(() => adapter.fetchThumbnail({ slug: null }), (err) => {
    assert.equal(err.status, 404);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('fetchThumbnail: lädt Binärdaten vom gespeicherten Bildpfad, gibt buffer + mime zurück', async () => {
  const buf = Buffer.from('\x89PNG fake');
  mockFetch(() => binaryResponse(buf, 'image/png'));
  const adapter = new TandoorAdapter(account);
  const out = await adapter.fetchThumbnail({ slug: '/media/recipe_images/soup.jpg' });
  assert.equal(calls[0].url, 'https://tandoor.example.com/media/recipe_images/soup.jpg');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok123');
  assert.equal(out.mime, 'image/png');
  assert.ok(Buffer.isBuffer(out.buffer));
  assert.equal(out.buffer.toString(), '\x89PNG fake');
});

test('fetchThumbnail: gespeicherter Bildpfad ist eine absolute URL (Tandoors serializer baut sie via build_absolute_uri) - kein Doppel-Host', async () => {
  const buf = Buffer.from('\x89PNG fake');
  mockFetch(() => binaryResponse(buf, 'image/png'));
  const adapter = new TandoorAdapter(account);
  const out = await adapter.fetchThumbnail({ slug: 'https://tandoor.example.com/media/recipes/abc123_5.webp' });
  assert.equal(calls[0].url, 'https://tandoor.example.com/media/recipes/abc123_5.webp');
  assert.equal(out.mime, 'image/png');
});

test('fetchThumbnail: HTTP-Fehler wirft mit Statuscode', async () => {
  mockFetch(() => jsonResponse({}, 500));
  const adapter = new TandoorAdapter(account);
  await assert.rejects(() => adapter.fetchThumbnail({ slug: '/media/x.jpg' }), /Tandoor thumbnail request failed \(500\)/);
});
