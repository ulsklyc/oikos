/**
 * Test: Mealie-Sync-Service (Upsert, Änderungserkennung, Leer-Guard-Löschung)
 * Zweck: sync() gegen einen injizierten Fake-Adapter (kein echtes Netzwerk).
 *        Deckt den sicherheitskritischen Fall ab: ein fehlgeschlagener oder
 *        leerer Abruf darf den lokalen Mirror nie leeren (vgl. calendar-prune.js).
 *        Deckt außerdem ab, dass der Upsert-Schlüssel Mealies stabile UUID ist,
 *        nicht der (bei Umbenennung wechselnde) Slug.
 * Ausführen: node --experimental-sqlite --test test/test-mealie-sync.js
 */

process.env.DB_PATH = ':memory:';

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const db = await import('../server/db.js');
const sync = await import('../server/services/mealie-sync.js');
const conn = db.get();

const OWNER = conn.prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES ('owner','Owner','x','member')`).run().lastInsertRowid;

function newAccount(name = 'Zuhause') {
  return conn.prepare(`
    INSERT INTO mealie_accounts (name, base_url, api_token, created_by) VALUES (?, ?, 'tok', ?)
  `).run(name, `https://${name.toLowerCase()}.example.com`, OWNER).lastInsertRowid;
}

function mirroredRecipes(accountId) {
  return conn.prepare('SELECT title, mealie_recipe_id FROM recipes WHERE mealie_account_id = ? ORDER BY id ASC').all(accountId);
}

function ingredientsFor(accountId, mealieRecipeId) {
  const recipe = conn.prepare('SELECT id FROM recipes WHERE mealie_account_id = ? AND mealie_recipe_id = ?').get(accountId, mealieRecipeId);
  return conn.prepare('SELECT name, quantity, category FROM recipe_ingredients WHERE recipe_id = ? ORDER BY id ASC').all(recipe.id);
}

// sync() iteriert über ALLE aktivierten Accounts, nicht nur den des aktuellen
// Tests - ohne diesen Reset würden spätere Tests die Mirror-Rezepte früherer
// Tests mitsynchronisieren (falsche imported/deleted-Zählungen).
beforeEach(() => { conn.prepare('UPDATE mealie_accounts SET enabled = 0').run(); });
afterEach(() => sync._setAdapterFactory(null));

// summaries: [{ id, slug, updatedAt }]; details: { [slug]: { id, name, slug, updatedAt, recipeIngredient } }
// id ist Mealies stabile UUID (Upsert-Schlüssel), slug wird für getRecipe()/recipeUrl() gebraucht.
function fakeAdapter(summaries, details, { groupSlug = 'home', fail = false } = {}) {
  return () => ({
    testConnection: async () => {
      if (fail) throw new Error('network down');
      return { ok: true, status: 200, groupSlug };
    },
    listRecipeSummaries: async () => {
      if (fail) throw new Error('network down');
      return summaries;
    },
    getRecipe: async (slug) => details[slug],
    recipeUrl: (g, s) => `https://mealie.example.com/g/${g}/r/${s}`,
  });
}

test('sync(): keine aktivierten Accounts → No-Op', async () => {
  const result = await sync.sync();
  assert.deepEqual(result, { success: true, syncedAccounts: 0, imported: 0, updated: 0, deleted: 0 });
});

test('sync(): importiert neue Rezepte inkl. Zutaten, setzt recipe_url, last_sync', async () => {
  const accountId = newAccount('Import');
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-pancakes', slug: 'pancakes', updatedAt: '2026-01-01T00:00:00Z' }],
    { pancakes: {
      id: 'uuid-pancakes', name: 'Pancakes', slug: 'pancakes', description: 'Fluffy', updatedAt: '2026-01-01T00:00:00Z',
      recipeIngredient: [{ quantity: 2, unit: { name: 'cups' }, food: { name: 'flour' } }],
    } },
  ));

  const result = await sync.sync();
  assert.equal(result.imported, 1);

  const [recipe] = mirroredRecipes(accountId);
  assert.equal(recipe.title, 'Pancakes');
  assert.equal(recipe.mealie_recipe_id, 'uuid-pancakes');
  const row = conn.prepare('SELECT recipe_url, notes FROM recipes WHERE mealie_account_id = ?').get(accountId);
  assert.equal(row.recipe_url, 'https://mealie.example.com/g/home/r/pancakes');
  assert.equal(row.notes, 'Fluffy');
  assert.deepEqual(ingredientsFor(accountId, 'uuid-pancakes'), [{ name: 'flour', quantity: '2 cups', category: 'Backwaren' }]);

  const account = conn.prepare('SELECT last_sync, last_error FROM mealie_accounts WHERE id = ?').get(accountId);
  assert.ok(account.last_sync);
  assert.equal(account.last_error, null);
});

test('sync(): unveränderte updatedAt → überspringt Neuimport der Zutaten', async () => {
  newAccount('Unverändert');
  const summaries = [{ id: 'uuid-soup', slug: 'soup', updatedAt: '2026-01-01T00:00:00Z' }];
  const details = { soup: {
    id: 'uuid-soup', name: 'Soup', slug: 'soup', description: null, updatedAt: '2026-01-01T00:00:00Z',
    recipeIngredient: [{ quantity: 1, unit: { name: 'liter' }, food: { name: 'broth' } }],
  } };
  sync._setAdapterFactory(fakeAdapter(summaries, details));
  await sync.sync();

  // Zweiter Lauf: gleiche updatedAt, getRecipe würde bei Aufruf einen Fehler
  // werfen - wird er trotzdem aufgerufen, schlägt der Test fehl.
  sync._setAdapterFactory(() => ({
    testConnection: async () => ({ ok: true, status: 200, groupSlug: 'home' }),
    listRecipeSummaries: async () => summaries,
    getRecipe: async () => { throw new Error('sollte nicht aufgerufen werden'); },
    recipeUrl: (g, s) => `https://mealie.example.com/g/${g}/r/${s}`,
  }));
  const result = await sync.sync();
  assert.equal(result.imported, 0);
  assert.equal(result.updated, 0);
});

test('sync(): unveränderte updatedAt, aber geänderte external_url → recipe_url wird trotzdem neu gebaut, ohne getRecipe erneut aufzurufen', async () => {
  const accountId = newAccount('LinkWechsel');
  const summaries = [{ id: 'uuid-tarte', slug: 'tarte', updatedAt: '2026-01-01T00:00:00Z' }];
  const details = { tarte: {
    id: 'uuid-tarte', name: 'Tarte', slug: 'tarte', description: null, updatedAt: '2026-01-01T00:00:00Z',
    recipeIngredient: [],
  } };
  sync._setAdapterFactory(fakeAdapter(summaries, details));
  await sync.sync();
  const before = conn.prepare('SELECT recipe_url FROM recipes WHERE mealie_account_id = ?').get(accountId);
  assert.equal(before.recipe_url, 'https://mealie.example.com/g/home/r/tarte');

  // Zweiter Lauf simuliert eine nachträglich gesetzte external_url: derselbe
  // Slug, aber ein anderer linkBase. getRecipe darf trotzdem nicht erneut
  // aufgerufen werden - die URL wird nur aus dem gespeicherten Slug neu gebaut.
  sync._setAdapterFactory(() => ({
    testConnection: async () => ({ ok: true, status: 200, groupSlug: 'home' }),
    listRecipeSummaries: async () => summaries,
    getRecipe: async () => { throw new Error('sollte nicht aufgerufen werden'); },
    recipeUrl: (g, s) => `https://cook.example.com/g/${g}/r/${s}`,
  }));
  await sync.sync();
  const after = conn.prepare('SELECT recipe_url FROM recipes WHERE mealie_account_id = ?').get(accountId);
  assert.equal(after.recipe_url, 'https://cook.example.com/g/home/r/tarte');
});

test('sync(): unveränderte updatedAt, aber kein groupSlug diesmal → alter recipe_url bleibt unangetastet statt auf null zu fallen', async () => {
  const accountId = newAccount('KeinGroupSlug');
  const summaries = [{ id: 'uuid-brot', slug: 'brot', updatedAt: '2026-01-01T00:00:00Z' }];
  const details = { brot: {
    id: 'uuid-brot', name: 'Brot', slug: 'brot', description: null, updatedAt: '2026-01-01T00:00:00Z',
    recipeIngredient: [],
  } };
  sync._setAdapterFactory(fakeAdapter(summaries, details));
  await sync.sync();
  const before = conn.prepare('SELECT recipe_url FROM recipes WHERE mealie_account_id = ?').get(accountId);
  assert.equal(before.recipe_url, 'https://mealie.example.com/g/home/r/brot');

  // testConnection() liefert diesmal ok, aber ohne groupSlug (z. B. Mealie-
  // Versionsunterschied) - recipeUrl(null, slug) würde null bauen.
  sync._setAdapterFactory(() => ({
    testConnection: async () => ({ ok: true, status: 200, groupSlug: null }),
    listRecipeSummaries: async () => summaries,
    getRecipe: async () => { throw new Error('sollte nicht aufgerufen werden'); },
    recipeUrl: (g, s) => (g ? `https://mealie.example.com/g/${g}/r/${s}` : null),
  }));
  await sync.sync();
  const after = conn.prepare('SELECT recipe_url FROM recipes WHERE mealie_account_id = ?').get(accountId);
  assert.equal(after.recipe_url, 'https://mealie.example.com/g/home/r/brot');
});

test('sync(): geänderte updatedAt → aktualisiert Titel und ersetzt Zutaten', async () => {
  const accountId = newAccount('Ändert');
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-stew', slug: 'stew', updatedAt: '2026-01-01T00:00:00Z' }],
    { stew: { id: 'uuid-stew', name: 'Stew v1', slug: 'stew', updatedAt: '2026-01-01T00:00:00Z', recipeIngredient: [{ quantity: 1, food: { name: 'carrot' } }] } },
  ));
  await sync.sync();

  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-stew', slug: 'stew', updatedAt: '2026-02-01T00:00:00Z' }],
    { stew: { id: 'uuid-stew', name: 'Stew v2', slug: 'stew', updatedAt: '2026-02-01T00:00:00Z', recipeIngredient: [{ quantity: 1, food: { name: 'potato' } }] } },
  ));
  const result = await sync.sync();
  assert.equal(result.updated, 1);

  const row = conn.prepare('SELECT title FROM recipes WHERE mealie_account_id = ?').get(accountId);
  assert.equal(row.title, 'Stew v2');
  assert.deepEqual(ingredientsFor(accountId, 'uuid-stew').map((i) => i.name), ['potato']);
});

test('sync(): Rezept-Umbenennung in Mealie (Slug ändert sich, UUID bleibt) → Update, kein Löschen+Neuanlegen', async () => {
  // Regression: der Upsert-Schlüssel muss Mealies stabile UUID sein. Würde
  // stattdessen der Slug verwendet, sähe eine Umbenennung wie "altes Rezept
  // gelöscht, neues angelegt" aus und jede Essensplan-Verknüpfung ginge verloren
  // (meals.recipe_id ON DELETE SET NULL).
  const accountId = newAccount('Umbenennung');
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-stable', slug: 'alter-name', updatedAt: '2026-01-01T00:00:00Z' }],
    { 'alter-name': { id: 'uuid-stable', name: 'Alter Name', slug: 'alter-name', updatedAt: '2026-01-01T00:00:00Z', recipeIngredient: [] } },
  ));
  await sync.sync();
  const [before] = mirroredRecipes(accountId);
  const recipeId = conn.prepare('SELECT id FROM recipes WHERE mealie_account_id = ?').get(accountId).id;

  // Mealie liefert jetzt einen neuen Slug für dieselbe UUID (Umbenennung).
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-stable', slug: 'neuer-name', updatedAt: '2026-02-01T00:00:00Z' }],
    { 'neuer-name': { id: 'uuid-stable', name: 'Neuer Name', slug: 'neuer-name', updatedAt: '2026-02-01T00:00:00Z', recipeIngredient: [] } },
  ));
  const result = await sync.sync();

  assert.equal(result.updated, 1);
  assert.equal(result.imported, 0);
  assert.equal(result.deleted, 0);
  const [after] = mirroredRecipes(accountId);
  assert.equal(after.title, 'Neuer Name');
  assert.equal(before.mealie_recipe_id, after.mealie_recipe_id); // gleiche UUID
  // Dieselbe recipes.id - keine Neuanlage, also bleibt jede meals.recipe_id-Referenz intakt.
  assert.equal(conn.prepare('SELECT id FROM recipes WHERE mealie_account_id = ?').get(accountId).id, recipeId);
});

test('sync(): Rezept verschwindet bei Mealie → wird lokal gelöscht (Leer-Guard greift NICHT, da andere Summaries geliefert werden)', async () => {
  const accountId = newAccount('Prune');
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-a', slug: 'a', updatedAt: 't1' }, { id: 'uuid-b', slug: 'b', updatedAt: 't1' }],
    {
      a: { id: 'uuid-a', name: 'A', slug: 'a', updatedAt: 't1', recipeIngredient: [] },
      b: { id: 'uuid-b', name: 'B', slug: 'b', updatedAt: 't1', recipeIngredient: [] },
    },
  ));
  await sync.sync();
  assert.equal(mirroredRecipes(accountId).length, 2);

  // Nur noch 'b' wird geliefert - 'a' muss verschwinden.
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-b', slug: 'b', updatedAt: 't1' }],
    { b: { id: 'uuid-b', name: 'B', slug: 'b', updatedAt: 't1', recipeIngredient: [] } },
  ));
  const result = await sync.sync();
  assert.equal(result.deleted, 1);
  assert.deepEqual(mirroredRecipes(accountId).map((r) => r.mealie_recipe_id), ['uuid-b']);
});

test('sync(): SICHERHEIT - fehlgeschlagener Abruf löscht den lokalen Mirror nicht und setzt last_error', async () => {
  const accountId = newAccount('Ausfallsicher');
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-x', slug: 'x', updatedAt: 't1' }],
    { x: { id: 'uuid-x', name: 'X', slug: 'x', updatedAt: 't1', recipeIngredient: [] } },
  ));
  await sync.sync();
  assert.equal(mirroredRecipes(accountId).length, 1);

  sync._setAdapterFactory(fakeAdapter([], {}, { fail: true }));
  const result = await sync.sync();
  assert.equal(result.syncedAccounts, 0);
  assert.equal(result.deleted, 0);
  assert.equal(mirroredRecipes(accountId).length, 1); // unverändert, NICHT geleert

  const account = conn.prepare('SELECT last_error FROM mealie_accounts WHERE id = ?').get(accountId);
  assert.match(account.last_error, /network down/);
});

test('sync(): SICHERHEIT - leere Rezeptliste bei bestehendem Mirror wird als Fehler behandelt, nicht als Leerung', async () => {
  const accountId = newAccount('LeerGuard');
  sync._setAdapterFactory(fakeAdapter(
    [{ id: 'uuid-y', slug: 'y', updatedAt: 't1' }],
    { y: { id: 'uuid-y', name: 'Y', slug: 'y', updatedAt: 't1', recipeIngredient: [] } },
  ));
  await sync.sync();
  assert.equal(mirroredRecipes(accountId).length, 1);

  // Verbindung klappt (testConnection ok), aber die Liste kommt leer zurück -
  // eher ein stiller Server-/Auth-Fehler als eine tatsächlich geleerte Sammlung.
  sync._setAdapterFactory(fakeAdapter([], {}));
  const result = await sync.sync();
  assert.equal(result.deleted, 0);
  assert.equal(mirroredRecipes(accountId).length, 1);
});

test('sync(): deaktivierter Account wird übersprungen', async () => {
  const accountId = newAccount('Deaktiviert');
  conn.prepare('UPDATE mealie_accounts SET enabled = 0 WHERE id = ?').run(accountId);
  sync._setAdapterFactory(() => ({
    testConnection: async () => { throw new Error('sollte nicht aufgerufen werden'); },
    listRecipeSummaries: async () => { throw new Error('sollte nicht aufgerufen werden'); },
    getRecipe: async () => { throw new Error('sollte nicht aufgerufen werden'); },
    recipeUrl: () => null,
  }));
  const result = await sync.sync();
  assert.equal(result.syncedAccounts, 0);
});

test('sync(): ein fehlschlagender Account blockiert einen zweiten, gesunden Account nicht', async () => {
  const brokenId = newAccount('Kaputt');
  const healthyId = newAccount('Gesund');

  let callCount = 0;
  sync._setAdapterFactory((account) => {
    callCount += 1;
    if (account.id === brokenId) {
      return {
        testConnection: async () => { throw new Error('kaputt'); },
        listRecipeSummaries: async () => { throw new Error('kaputt'); },
        getRecipe: async () => { throw new Error('unused'); },
        recipeUrl: () => null,
      };
    }
    return {
      testConnection: async () => ({ ok: true, status: 200, groupSlug: 'home' }),
      listRecipeSummaries: async () => [{ id: 'uuid-z', slug: 'z', updatedAt: 't1' }],
      getRecipe: async () => ({ id: 'uuid-z', name: 'Z', slug: 'z', updatedAt: 't1', recipeIngredient: [] }),
      recipeUrl: (g, s) => `https://mealie.example.com/g/${g}/r/${s}`,
    };
  });

  const result = await sync.sync();
  assert.equal(callCount, 2);
  assert.equal(result.syncedAccounts, 1);
  assert.equal(mirroredRecipes(healthyId).length, 1);
  assert.equal(mirroredRecipes(brokenId).length, 0);

  const broken = conn.prepare('SELECT last_error FROM mealie_accounts WHERE id = ?').get(brokenId);
  assert.match(broken.last_error, /kaputt/);
});

test('syncOne(): synchronisiert nur den angegebenen Account', async () => {
  const idA = newAccount('Einzeln A');
  const idB = newAccount('Einzeln B');
  sync._setAdapterFactory((account) => ({
    testConnection: async () => ({ ok: true, status: 200, groupSlug: 'home' }),
    listRecipeSummaries: async () => [{ id: `uuid-${account.id}`, slug: `r-${account.id}`, updatedAt: 't1' }],
    getRecipe: async (slug) => ({ id: `uuid-${account.id}`, name: slug, slug, updatedAt: 't1', recipeIngredient: [] }),
    recipeUrl: (g, s) => `https://mealie.example.com/g/${g}/r/${s}`,
  }));

  await sync.syncOne(idA);
  assert.equal(mirroredRecipes(idA).length, 1);
  assert.equal(mirroredRecipes(idB).length, 0);
});

test('syncOne(): unbekannter Account wirft', async () => {
  await assert.rejects(() => sync.syncOne(999999), /not found/i);
});
