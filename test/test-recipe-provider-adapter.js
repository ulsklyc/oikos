/**
 * Modul: Recipe-Provider-Adapter-Test (Mealie)
 * Zweck: Validiert MealieAdapter (testConnection/listRecipeSummaries/getRecipe/
 *        recipeUrl) gegen ein gemocktes fetch - keine echte Netzwerkverbindung.
 *        getRecipe() liefert die normalisierte { id, updatedAt, slug, title,
 *        notes, hasImage, ingredients } Form; flattenIngredient ist nicht mehr
 *        exportiert und wird deshalb nur noch indirekt über getRecipe() geprüft.
 *        Deckt außerdem die Wortgrenzen-Regression in categorizeIngredient ab
 *        (#'ei' in 'Fleisch').
 * Ausführen: node --test test/test-recipe-provider-adapter.js
 */
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { MealieAdapter } from '../server/services/recipe-providers/mealie.js';
import { categorizeIngredient } from '../server/services/recipe-providers/categorize.js';

const account = { base_url: 'https://mealie.example.com/', api_token: 'tok123' };

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

test('Konstruktor entfernt trailing slash von base_url', () => {
  const adapter = new MealieAdapter(account);
  assert.equal(adapter.base, 'https://mealie.example.com');
});

test('testConnection: setzt Bearer-Header, liefert linkContext.groupSlug aus UserOut', async () => {
  mockFetch(() => jsonResponse({ groupSlug: 'home' }));
  const adapter = new MealieAdapter(account);
  const out = await adapter.testConnection();
  assert.equal(calls[0].url, 'https://mealie.example.com/api/users/self');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok123');
  assert.equal(out.ok, true);
  assert.equal(out.linkContext.groupSlug, 'home');
});

test('testConnection: ok=false bei 401, kein Wurf', async () => {
  mockFetch(() => jsonResponse({}, 401));
  const adapter = new MealieAdapter(account);
  const out = await adapter.testConnection();
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
});

test('testConnection: Netzwerkfehler → ok=false, status=0, error gesetzt', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const adapter = new MealieAdapter(account);
  const out = await adapter.testConnection();
  assert.equal(out.ok, false);
  assert.equal(out.status, 0);
  assert.match(out.error, /ECONNREFUSED/);
});

test('listRecipeSummaries: paginiert bis total_pages erreicht ist', async () => {
  mockFetch((url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    if (page === 1) return jsonResponse({ items: [{ id: 'id-a', slug: 'a' }, { id: 'id-b', slug: 'b' }], total_pages: 2 });
    return jsonResponse({ items: [{ id: 'id-c', slug: 'c' }], total_pages: 2 });
  });
  const adapter = new MealieAdapter(account);
  const summaries = await adapter.listRecipeSummaries();
  assert.equal(calls.length, 2);
  assert.deepEqual(summaries.map((s) => s.ref), ['a', 'b', 'c']);
  assert.deepEqual(summaries.map((s) => s.id), ['id-a', 'id-b', 'id-c']);
});

test('listRecipeSummaries: einzelne Seite (total_pages fehlt) → genau ein Request', async () => {
  mockFetch(() => jsonResponse({ items: [{ id: 'id-solo', slug: 'solo' }] }));
  const adapter = new MealieAdapter(account);
  const summaries = await adapter.listRecipeSummaries();
  assert.equal(calls.length, 1);
  assert.equal(summaries.length, 1);
});

test('getRecipe: fragt /api/recipes/{slug} ab, url-kodiert den Slug, liefert normalisierte Form', async () => {
  mockFetch(() => jsonResponse({ id: 'id-1', name: 'Süßspeise', slug: 'süßspeise', updatedAt: 't1', description: 'Lecker', image: 'x.jpg', recipeIngredient: [] }));
  const adapter = new MealieAdapter(account);
  const recipe = await adapter.getRecipe('süßspeise');
  assert.equal(calls[0].url, 'https://mealie.example.com/api/recipes/s%C3%BC%C3%9Fspeise');
  assert.equal(recipe.id, 'id-1');
  assert.equal(recipe.title, 'Süßspeise');
  assert.equal(recipe.slug, 'süßspeise');
  assert.equal(recipe.updatedAt, 't1');
  assert.equal(recipe.notes, 'Lecker');
  assert.equal(recipe.hasImage, true);
  assert.deepEqual(recipe.ingredients, []);
});

test('getRecipe: kein Bild → hasImage=false, keine Notes → notes=null', async () => {
  mockFetch(() => jsonResponse({ id: 'id-2', name: 'Ohne Bild', slug: 'ohne-bild', updatedAt: 't1', description: null, image: null, recipeIngredient: [] }));
  const adapter = new MealieAdapter(account);
  const recipe = await adapter.getRecipe('ohne-bild');
  assert.equal(recipe.hasImage, false);
  assert.equal(recipe.notes, null);
});

test('getRecipe: HTTP-Fehler wirft mit Statuscode', async () => {
  mockFetch(() => jsonResponse({}, 404));
  const adapter = new MealieAdapter(account);
  await assert.rejects(() => adapter.getRecipe('missing'), /Mealie request failed \(404\)/);
});

test('recipeUrl: baut /g/{groupSlug}/r/{slug}, null ohne groupSlug', () => {
  const adapter = new MealieAdapter(account);
  assert.equal(adapter.recipeUrl({ groupSlug: 'home' }, { slug: 'pancakes' }), 'https://mealie.example.com/g/home/r/pancakes');
  assert.equal(adapter.recipeUrl(null, { slug: 'pancakes' }), null);
  assert.equal(adapter.recipeUrl({ groupSlug: null }, { slug: 'pancakes' }), null);
});

test('recipeUrl: nutzt external_url statt base_url, wenn gesetzt (Docker-interne base_url ist fuer den Browser sonst blackholed)', () => {
  const adapter = new MealieAdapter({ ...account, external_url: 'https://recipes.example.com/' });
  assert.equal(adapter.recipeUrl({ groupSlug: 'home' }, { slug: 'pancakes' }), 'https://recipes.example.com/g/home/r/pancakes');
  // base_url selbst bleibt fuer Requests unveraendert - nur der Link-Aufbau weicht ab.
  assert.equal(adapter.base, 'https://mealie.example.com');
});

test('recipeUrl: leere external_url faellt auf base_url zurueck', () => {
  const adapter = new MealieAdapter({ ...account, external_url: '' });
  assert.equal(adapter.recipeUrl({ groupSlug: 'home' }, { slug: 'pancakes' }), 'https://mealie.example.com/g/home/r/pancakes');
});

// --------------------------------------------------------------------------
// flattenIngredient (intern, nur über getRecipe() prüfbar): Mealies
// quantity/unit/food → flaches name/quantity/category
// --------------------------------------------------------------------------

test('getRecipe: verknüpftes food → name=food.name, quantity aus quantity+unit', async () => {
  mockFetch(() => jsonResponse({
    id: 'id-3', name: 'Pfannkuchen', slug: 'pfannkuchen', updatedAt: 't1', description: null, image: null,
    recipeIngredient: [{ quantity: 2, unit: { name: 'cups', useAbbreviation: false, abbreviation: '' }, food: { name: 'flour' } }],
  }));
  const adapter = new MealieAdapter(account);
  const recipe = await adapter.getRecipe('pfannkuchen');
  assert.equal(recipe.ingredients.length, 1);
  assert.deepEqual(recipe.ingredients[0], { name: 'flour', quantity: '2 cups', category: 'Backwaren' });
});

test('getRecipe: Abkürzung bevorzugt, wenn useAbbreviation gesetzt ist', async () => {
  mockFetch(() => jsonResponse({
    id: 'id-4', name: 'Latte', slug: 'latte', updatedAt: 't1', description: null, image: null,
    recipeIngredient: [{ quantity: 1, unit: { name: 'liter', useAbbreviation: true, abbreviation: 'l' }, food: { name: 'Milch' } }],
  }));
  const adapter = new MealieAdapter(account);
  const recipe = await adapter.getRecipe('latte');
  assert.equal(recipe.ingredients[0].quantity, '1 l');
});

test('getRecipe: ohne food (Freitext) → display/originalText wird zum Namen, quantity bleibt leer', async () => {
  mockFetch(() => jsonResponse({
    id: 'id-5', name: 'Salz', slug: 'salz', updatedAt: 't1', description: null, image: null,
    recipeIngredient: [{ quantity: 0, unit: null, food: null, display: 'a pinch of salt', originalText: 'a pinch of salt' }],
  }));
  const adapter = new MealieAdapter(account);
  const recipe = await adapter.getRecipe('salz');
  assert.equal(recipe.ingredients[0].name, 'a pinch of salt');
  assert.equal(recipe.ingredients[0].quantity, null);
});

test('getRecipe: Mealie-Food-Label geht der Namens-Keyword-Suche vor', async () => {
  // 'chicken broth' triggert für sich allein kein Fleisch-Keyword; das Label schon.
  mockFetch(() => jsonResponse({
    id: 'id-6', name: 'Brühe', slug: 'bruehe', updatedAt: 't1', description: null, image: null,
    recipeIngredient: [{ quantity: 1, unit: { name: 'liter' }, food: { name: 'chicken broth', label: { name: 'Fleisch' } } }],
  }));
  const adapter = new MealieAdapter(account);
  const recipe = await adapter.getRecipe('bruehe');
  assert.equal(recipe.ingredients[0].category, 'Fleisch & Fisch');
});

// --------------------------------------------------------------------------
// categorizeIngredient: Wortgrenzen-Regression
// --------------------------------------------------------------------------

test('categorizeIngredient: "ei" (Ei) matcht nicht als Teilstring in "Fleisch"', () => {
  assert.equal(categorizeIngredient({ labelName: 'Fleisch' }), 'Fleisch & Fisch');
});

test('categorizeIngredient: "ei" (Ei) matcht nicht als Teilstring in "Reis"', () => {
  assert.equal(categorizeIngredient({ foodName: 'Reis' }), 'Sonstiges');
});

test('categorizeIngredient: eigenständiges "Eier" matcht weiterhin', () => {
  assert.equal(categorizeIngredient({ foodName: 'Eier' }), 'Milchprodukte');
});

test('categorizeIngredient: mehrwortiges Stichwort ("baking powder") matcht als Phrase', () => {
  assert.equal(categorizeIngredient({ foodName: 'baking powder' }), 'Backwaren');
});

test('categorizeIngredient: kein Treffer → Fallback Sonstiges', () => {
  assert.equal(categorizeIngredient({ foodName: 'Xyzzy' }), 'Sonstiges');
});
