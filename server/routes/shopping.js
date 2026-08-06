/**
 * Modul: Einkaufslisten (Shopping)
 * Zweck: REST-API-Routen für Einkaufslisten, Artikel, Kategorien, Autocomplete
 * Abhängigkeiten: express, server/db.js
 *
 * Routen-Reihenfolge: Statische Pfade (/suggestions, /categories, /items/:id) müssen
 * vor dynamischen (/:listId) registriert sein, damit Express korrekt matcht.
 */

import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, oneOf, url, date, collectErrors, MAX_TITLE, MAX_SHORT, MAX_TEXT } from '../middleware/validate.js';
import { aggregateMealIngredients } from '../services/shopping-import.js';
import { loadItemTagsFor } from '../utils/task-tags.js';
import {
  flushOutbound, markTodoOutbound, queueTodoDeletions,
} from '../services/caldav-todo-outbound.js';

const log = createLogger('Shopping');

const router  = express.Router();

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------

/**
 * Aus einer CalDAV-Liste gespiegelte Artikel einer Auswahl - vor dem Löschen zu
 * ermitteln, danach sind UID und Objekt-URL weg (#617).
 */
function mirroredItems(where, ...params) {
  return db.get().prepare(
    `SELECT * FROM shopping_items WHERE ${where} AND external_source = 'caldav'`
  ).all(...params);
}

/**
 * Ausgehende Arbeit an einem CalDAV-Spiegel anstoßen (#617). Bewusst nach der
 * Antwort und ohne await: der Server-Aufruf darf die Antwort weder verzögern
 * noch scheitern lassen. Schlägt er fehl, bleibt die Vormerkung liegen und der
 * nächste Sync-Lauf holt sie nach.
 */
function pushToCalDAV(what) {
  flushOutbound().catch((err) => log.warn(`${what} vorgemerkt, Sofortversuch fehlgeschlagen:`, err.message));
}

/** Alle Kategorien aus DB laden (nach sort_order sortiert). */
function loadCategories() {
  return db.get().prepare('SELECT * FROM shopping_categories ORDER BY sort_order ASC').all();
}

/** Kategorie-Namen-Array für Validierung. */
function validCategoryNames() {
  return loadCategories().map((c) => c.name);
}

/**
 * Artikel einer Liste in Anzeigereihenfolge: Kategorie in Gang-Reihenfolge,
 * abgehaktes ans Ende, davor die Handsortierung (#678), zuletzt die
 * Eingabereihenfolge als Gleichstand-Entscheider.
 *
 * Eine Funktion für Lesen UND Umsortieren: die Sortierung ist die Aussage
 * dieses Moduls über "Reihenfolge" und darf nicht in zwei Schreibweisen
 * auseinanderlaufen - die Antwort auf ein Umsortieren muss genau das zeigen,
 * was das nächste Laden liefert.
 */
function loadListItems(listId, categories) {
  const categoryOrder = categories.map((c, i) => `WHEN '${c.name.replace(/'/g, "''")}' THEN ${i}`).join(' ');
  const items = db.get().prepare(`
    SELECT * FROM shopping_items
    WHERE list_id = ?
    ORDER BY
      CASE category ${categoryOrder} ELSE ${categories.length} END,
      is_checked ASC,
      sort_order ASC,
      created_at ASC
  `).all(listId);

  // Gespiegelte CATEGORIES der Quellliste (#586). Eine Abfrage für die ganze
  // Liste, nicht eine pro Zeile.
  const tagMap = loadItemTagsFor(db.get(), items.map((i) => i.id));
  for (const item of items) item.tags = tagMap.get(item.id) ?? [];
  return items;
}

// --------------------------------------------------------
// GET /api/v1/shopping/categories
// Alle Kategorien zurückgeben.
// Response: { data: ShoppingCategory[] }
// --------------------------------------------------------
router.get('/categories', (_req, res) => {
  try {
    res.json({ data: loadCategories() });
  } catch (err) {
    log.error('GET /categories error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/categories
// Neue Kategorie erstellen.
// Body: { name }
// Response: { data: ShoppingCategory }
// --------------------------------------------------------
router.post('/categories', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const existing = db.get()
      .prepare('SELECT id FROM shopping_categories WHERE name = ? COLLATE NOCASE')
      .get(vName.value);
    if (existing) return res.status(409).json({ error: 'Category already exists.', code: 409 });

    const maxOrder = db.get()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM shopping_categories')
      .get().m;

    const result = db.get()
      .prepare('INSERT INTO shopping_categories (name, icon, sort_order) VALUES (?, ?, ?)')
      .run(vName.value, 'tag', maxOrder + 1);

    const cat = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: cat });
  } catch (err) {
    log.error('POST /categories error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/shopping/categories/:catId
// Kategorie umbenennen.
// Body: { name }
// Response: { data: ShoppingCategory }
// --------------------------------------------------------
router.put('/categories/:catId', (req, res) => {
  try {
    const cat = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Category not found.', code: 404 });

    const vName = str(req.body.name, 'Name', { max: MAX_SHORT });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const conflict = db.get()
      .prepare('SELECT id FROM shopping_categories WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(vName.value, cat.id);
    if (conflict) return res.status(409).json({ error: 'Category already exists.', code: 409 });

    // Artikel, die die alte Kategorie nutzen, mitumbenennen
    db.get().transaction(() => {
      db.get()
        .prepare('UPDATE shopping_items SET category = ? WHERE category = ?')
        .run(vName.value, cat.name);
      db.get()
        .prepare('UPDATE shopping_categories SET name = ? WHERE id = ?')
        .run(vName.value, cat.id);
    })();

    const updated = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(cat.id);
    res.json({ data: updated });
  } catch (err) {
    log.error('PUT /categories/:catId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/categories/:catId
// Kategorie löschen (Artikel werden zu "Sonstiges" verschoben).
// Die letzte verbleibende Kategorie kann nicht gelöscht werden.
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/categories/:catId', (req, res) => {
  try {
    const cat = db.get()
      .prepare('SELECT * FROM shopping_categories WHERE id = ?')
      .get(req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Category not found.', code: 404 });

    const total = db.get()
      .prepare('SELECT COUNT(*) AS c FROM shopping_categories')
      .get().c;
    if (total <= 1) return res.status(400).json({ error: 'The last category cannot be deleted.', code: 400 });

    // Fallback-Kategorie: erste andere Kategorie nach sort_order
    const fallback = db.get()
      .prepare('SELECT name FROM shopping_categories WHERE id != ? ORDER BY sort_order ASC LIMIT 1')
      .get(cat.id);

    db.get().transaction(() => {
      // Umziehende Artikel hinten anstellen, je Liste (#678). Ohne den Versatz
      // behielten sie ihre Ränge aus der gelöschten Kategorie und mischten sich
      // zwischen die handsortierten der Zielkategorie - eine Reihenfolge, die
      // niemand hergestellt hat.
      //
      // Der Versatz wird je Liste VOR dem Umzug bestimmt und nicht als Subquery
      // im UPDATE gelesen: dort zählte die gerade umgezogene Zeile schon zum
      // Maximum der Zielkategorie, und jede weitere sprang um ihren eigenen Rang
      // höher - die Umzügler kamen in der Reihenfolge ihrer id an statt in ihrer
      // eigenen (Test „Umzügler landen hinter der Handsortierung des Ziels").
      const listen = db.get()
        .prepare('SELECT DISTINCT list_id FROM shopping_items WHERE category = ?')
        .all(cat.name);
      const maxIn = db.get().prepare(
        'SELECT COALESCE(MAX(sort_order), 0) AS m FROM shopping_items WHERE list_id = ? AND category = ?'
      );
      const move = db.get().prepare(
        'UPDATE shopping_items SET category = ?, sort_order = sort_order + ? WHERE category = ? AND list_id = ?'
      );
      for (const { list_id: listId } of listen) {
        move.run(fallback.name, maxIn.get(listId, fallback.name).m, cat.name, listId);
      }
      db.get()
        .prepare('DELETE FROM shopping_categories WHERE id = ?')
        .run(cat.id);
    })();

    res.json({ ok: true });
  } catch (err) {
    log.error('DELETE /categories/:catId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/shopping/categories/reorder
// Reihenfolge der Kategorien ändern.
// Body: { order: number[] }  (Array von IDs in gewünschter Reihenfolge)
// Response: { data: ShoppingCategory[] }
// --------------------------------------------------------
router.patch('/categories/reorder', (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0)
      return res.status(400).json({ error: 'order muss ein nicht-leeres Array von IDs sein.', code: 400 });

    const update = db.get().prepare('UPDATE shopping_categories SET sort_order = ? WHERE id = ?');
    db.get().transaction(() => {
      order.forEach((id, idx) => update.run(idx, id));
    })();

    res.json({ data: loadCategories() });
  } catch (err) {
    log.error('PATCH /categories/reorder error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping/suggestions?q=…
// Autocomplete-Vorschläge aus bisherigen Artikelnamen.
// Response: { data: string[] }
// --------------------------------------------------------
router.get('/suggestions', (req, res) => {
  try {
    const q = (req.query.q ?? '').trim();
    if (q.length < 1) return res.json({ data: [] });

    const rows = db.get().prepare(`
      SELECT DISTINCT name FROM shopping_items
      WHERE name LIKE ? COLLATE NOCASE
      ORDER BY name ASC
      LIMIT 8
    `).all(`${q}%`);

    res.json({ data: rows.map((r) => r.name) });
  } catch (err) {
    log.error('suggestions error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/shopping/items/:itemId
// Artikel aktualisieren (is_checked, name, quantity, category, notes, url).
// Body: { is_checked?, name?, quantity?, category?, notes?, url? }
// Response: { data: ShoppingItem }
// --------------------------------------------------------
router.patch('/items/:itemId', (req, res) => {
  try {
    const item = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

    const {
      is_checked = item.is_checked,
      name       = item.name,
      quantity   = item.quantity,
      category   = item.category,
      notes      = item.notes,
      url: urlVal = item.url,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name darf nicht leer sein.', code: 400 });

    const validNames = validCategoryNames();
    if (category && !validNames.includes(category))
      return res.status(400).json({ error: 'Invalid category.', code: 400 });

    // notes/url gleich validieren wie beim Anlegen (URL nur http/https → XSS-sicher).
    const vNotes = str(notes, 'Notiz', { max: MAX_TEXT, required: false });
    const vUrl   = url(urlVal, 'URL');
    const fieldErrors = collectErrors([vNotes, vUrl]);
    if (fieldErrors.length) return res.status(400).json({ error: fieldErrors.join(' '), code: 400 });

    db.get().prepare(`
      UPDATE shopping_items
      SET is_checked = ?, name = ?, quantity = ?, category = ?, notes = ?, url = ?
      WHERE id = ?
    `).run(is_checked ? 1 : 0, name.trim(), quantity ?? null, category, vNotes.value, vUrl.value, req.params.itemId);

    // Kategoriewechsel heißt Positionswechsel: die Handsortierung zählt je
    // Kategorie (#678), der alte Rang gilt in der neuen Nachbarschaft nicht.
    // Ans Ende - dort landet in dieser Liste auch alles neu Hinzugefügte.
    if (category !== item.category) {
      db.get().prepare(`
        UPDATE shopping_items SET sort_order = COALESCE((
          SELECT MAX(sort_order) FROM shopping_items
           WHERE list_id = ? AND category = ? AND id != ?
        ), 0) + 1 WHERE id = ?
      `).run(item.list_id, category, item.id, item.id);
    }

    const updated = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(req.params.itemId);

    // Abhaken oder Umbenennen eines gespiegelten Artikels zieht auf dem
    // CalDAV-Server nach (#617).
    const pending = markTodoOutbound('shopping', item, updated);

    res.json({ data: updated });

    if (pending) pushToCalDAV('Änderung');
  } catch (err) {
    log.error('PATCH items/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/items/undo-transfer
// Nimmt einen Übertrag aus einem Nachbar-Tab der Küche zurück.
// Body: { ids: number[] } - die `added_ids` aus der Transfer-Antwort.
// Response: { data: { removed: number } }
//
// Die drei erzeugenden Pfade der Küche (Vorrat, Rezept, Mahlzeit → Einkauf)
// nehmen über DIESE Route zurück, nicht über N einzelne DELETEs. Zwei Gründe:
//
//   1. Ein Übertrag ist eine Handlung, also ist auch seine Rücknahme eine.
//      Einzel-DELETEs können zur Hälfte scheitern und lassen dann einen Zustand
//      zurück, den der Nutzer nie hergestellt hat. Hier ist es eine Transaktion.
//   2. Der Mahlzeit-Pfad setzt beim Übertragen `meal_ingredients.on_shopping_list`.
//      Wer nur die Einkaufsartikel löscht, lässt die Zutaten für immer als „schon
//      übertragen" zurück - weder auf der Liste noch erneut übertragbar. Das Flag
//      gehört zum Übertrag und muss mit ihm zurück (Audit 2026-07-30, P1-B).
//
// Zugeordnet wird über `added_from_meal` + Name: der Übertrag hat genau die
// offenen Zutaten dieser Mahlzeit eingefügt, der Name ist innerhalb einer
// Mahlzeit ihre Identität. Ein Doppelname wäre gemeinsam übertragen worden und
// geht damit auch gemeinsam zurück.
//
// Fremde IDs werden still übergangen statt mit 404 quittiert: `removed` sagt,
// was tatsächlich zurückging, und ein Undo, das mit einem Fehler endet, weil ein
// Artikel inzwischen von Hand gelöscht wurde, wäre die schlechtere Antwort.
// --------------------------------------------------------
router.post('/items/undo-transfer', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter(Number.isInteger)
      : [];
    if (!ids.length) return res.json({ data: { removed: 0 } });

    const removed = db.get().transaction(() => {
      const findItem = db.get()
        .prepare('SELECT id, name, added_from_meal FROM shopping_items WHERE id = ?');
      const deleteItem = db.get().prepare('DELETE FROM shopping_items WHERE id = ?');
      const unmarkIngredient = db.get().prepare(`
        UPDATE meal_ingredients SET on_shopping_list = 0
        WHERE meal_id = ? AND name = ? AND on_shopping_list = 1
      `);

      let count = 0;
      for (const id of ids) {
        const item = findItem.get(id);
        if (!item) continue;
        deleteItem.run(id);
        if (item.added_from_meal) unmarkIngredient.run(item.added_from_meal, item.name);
        count += 1;
      }
      return count;
    })();

    res.json({ data: { removed } });
  } catch (err) {
    log.error('POST /items/undo-transfer error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/items/:itemId
// Einzelnen Artikel löschen.
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/items/:itemId', (req, res) => {
  try {
    const queued = queueTodoDeletions('shopping', mirroredItems('id = ?', req.params.itemId));

    const result = db.get()
      .prepare('DELETE FROM shopping_items WHERE id = ?')
      .run(req.params.itemId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Item not found.', code: 404 });
    res.json({ ok: true });

    if (queued) pushToCalDAV('Löschung');
  } catch (err) {
    log.error('DELETE items/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping
// Alle Einkaufslisten mit Artikel-Zähler.
// Response: { data: ShoppingList[] }
// --------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const lists = db.get().prepare(`
      SELECT
        sl.*,
        COUNT(si.id)                                          AS item_total,
        SUM(CASE WHEN si.is_checked = 1 THEN 1 ELSE 0 END)   AS item_checked
      FROM shopping_lists sl
      LEFT JOIN shopping_items si ON si.list_id = sl.id
      GROUP BY sl.id
      ORDER BY sl.created_at ASC
    `).all();
    res.json({ data: lists });
  } catch (err) {
    log.error('GET / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping
// Neue Einkaufsliste erstellen.
// Body: { name }
// Response: { data: ShoppingList }
// --------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const result = db.get()
      .prepare('INSERT INTO shopping_lists (name, created_by) VALUES (?, ?)')
      .run(vName.value, req.authUserId || req.session.userId);

    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: list });
  } catch (err) {
    log.error('POST / error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/shopping/:listId
// Einkaufsliste umbenennen.
// Body: { name }
// Response: { data: ShoppingList }
// --------------------------------------------------------
router.put('/:listId', (req, res) => {
  try {
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });

    const result = db.get()
      .prepare('UPDATE shopping_lists SET name = ? WHERE id = ?')
      .run(vName.value, req.params.listId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'List not found.', code: 404 });

    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    res.json({ data: list });
  } catch (err) {
    log.error('PUT /:listId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/:listId
// Liste und alle Artikel löschen (CASCADE).
// Response: { ok: true }
// --------------------------------------------------------
router.delete('/:listId', (req, res) => {
  try {
    // Die Artikel gehen per CASCADE mit, also müssen ihre Löschungen vorher
    // vorgemerkt sein (#617).
    const queued = queueTodoDeletions('shopping', mirroredItems('list_id = ?', req.params.listId));

    const result = db.get()
      .prepare('DELETE FROM shopping_lists WHERE id = ?')
      .run(req.params.listId);
    if (result.changes === 0)
      return res.status(404).json({ error: 'List not found.', code: 404 });
    res.json({ ok: true });

    if (queued) pushToCalDAV('Löschung');
  } catch (err) {
    log.error('DELETE /:listId error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/shopping/:listId/items
// Alle Artikel einer Liste, sortiert nach Supermarkt-Gang-Logik.
// Abgehakte Artikel ans Ende innerhalb ihrer Kategorie, davor die von Hand
// gesetzte Reihenfolge (#678).
// Response: { data: ShoppingItem[], list: ShoppingList, categories: ShoppingCategory[] }
// --------------------------------------------------------
router.get('/:listId/items', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const categories = loadCategories();
    res.json({ data: loadListItems(req.params.listId, categories), list, categories });
  } catch (err) {
    log.error('GET /:listId/items error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// PATCH /api/v1/shopping/:listId/items/reorder
// Reihenfolge der Artikel INNERHALB einer Kategorie ändern (#678).
// Body: { category: string, order: number[] }  (Artikel-IDs in gewünschter Reihenfolge)
// Response: { data: ShoppingItem[], categories: ShoppingCategory[] }
//
// Je Kategorie und nicht über die ganze Liste: die Kategorie-Reihenfolge ist
// bereits ein eigener Griff (shopping_categories.sort_order, umsortierbar im
// Kategorie-Manager) und bildet den Ladenweg ab. Ein zweiter, listenweiter Rang
// daneben hätte zwei Aussagen über dieselbe Reihenfolge gemacht.
//
// Die Anfrage muss ALLE Artikel der Kategorie nennen. Eine Teilmenge würde die
// Ränge der Ausgelassenen mit den neu vergebenen kollidieren lassen - danach
// entschiede wieder created_at, und der Zug wäre teilweise verpufft.
// --------------------------------------------------------
router.patch('/:listId/items/reorder', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const { category, order } = req.body;
    if (!Array.isArray(order) || order.length === 0)
      return res.status(400).json({ error: 'order muss ein nicht-leeres Array von IDs sein.', code: 400 });

    const ids = order.map(Number);
    if (ids.some((id) => !Number.isInteger(id)))
      return res.status(400).json({ error: 'order darf nur Artikel-IDs enthalten.', code: 400 });
    if (new Set(ids).size !== ids.length)
      return res.status(400).json({ error: 'order darf keine ID doppelt enthalten.', code: 400 });

    // oneOf lässt Leerwerte durch (es validiert optionale Felder); hier ist die
    // Kategorie der Geltungsbereich der Ränge und damit Pflicht.
    if (!category) return res.status(400).json({ error: 'category ist erforderlich.', code: 400 });
    const vCat = oneOf(category, validCategoryNames(), 'Kategorie');
    if (vCat.error) return res.status(400).json({ error: vCat.error, code: 400 });

    // Die Kategorie ist der Geltungsbereich der Ränge - eine fremde ID darin
    // würde einen Artikel einer anderen Liste oder Kategorie umnummerieren.
    const own = db.get()
      .prepare('SELECT id FROM shopping_items WHERE list_id = ? AND category = ?')
      .all(req.params.listId, vCat.value)
      .map((r) => r.id);
    const ownSet = new Set(own);
    if (ids.some((id) => !ownSet.has(id)))
      return res.status(400).json({ error: 'order enthält Artikel außerhalb dieser Liste oder Kategorie.', code: 400 });
    if (ids.length !== own.length)
      return res.status(400).json({ error: 'order muss alle Artikel der Kategorie enthalten.', code: 400 });

    const update = db.get().prepare('UPDATE shopping_items SET sort_order = ? WHERE id = ?');
    db.get().transaction(() => {
      // Ab 1: die 0 bleibt dem Trigger als Marke "noch nicht eingeordnet".
      ids.forEach((id, idx) => update.run(idx + 1, id));
    })();

    const categories = loadCategories();
    res.json({ data: loadListItems(req.params.listId, categories), categories });
  } catch (err) {
    log.error('PATCH /:listId/items/reorder error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/items
// Artikel zur Liste hinzufügen.
// Body: { name, quantity?, category?, notes?, url? }
// Response: { data: ShoppingItem }
// --------------------------------------------------------
router.post('/:listId/items', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const validNames = validCategoryNames();
    const defaultCat = validNames[0] ?? 'Sonstiges';
    const requestedCat = req.body.category || defaultCat;

    const vName  = str(req.body.name, 'Name', { max: MAX_TITLE });
    const vQty   = str(req.body.quantity, 'Menge', { max: MAX_SHORT, required: false });
    const vCat   = oneOf(requestedCat, validNames, 'Kategorie');
    const vNotes = str(req.body.notes, 'Notiz', { max: MAX_TEXT, required: false });
    const vUrl   = url(req.body.url, 'URL');
    const errors = collectErrors([vName, vQty, vCat, vNotes, vUrl]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const result = db.get().prepare(`
      INSERT INTO shopping_items (list_id, name, quantity, category, notes, url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.listId, vName.value, vQty.value, vCat.value || defaultCat, vNotes.value, vUrl.value);

    const item = db.get()
      .prepare('SELECT * FROM shopping_items WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ data: item });
  } catch (err) {
    log.error('POST /:listId/items error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/import-meal-plan
// Importiert Zutaten aus dem Essensplan eines Datumsbereichs in eine Liste.
// Body: { from: YYYY-MM-DD, to: YYYY-MM-DD, preview?: boolean }
// preview:true rechnet nur (keine Schreib-Transaktion) - für die Vorschau
// "X Zutaten aus Y Mahlzeiten" im Import-Dialog (Audit A1-22).
// Response: { data: { transferred: number, added: number, meals: number, preview?: true } }
// --------------------------------------------------------
router.post('/:listId/import-meal-plan', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const vFrom = date(req.body.from, 'From date', true);
    const vTo = date(req.body.to, 'To date', true);
    const errors = collectErrors([vFrom, vTo]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });
    if (vFrom.value > vTo.value) {
      return res.status(400).json({ error: 'From date must be before or equal to end date.', code: 400 });
    }

    const ingredients = db.get().prepare(`
      SELECT mi.id, mi.meal_id, mi.name, mi.quantity, mi.category
      FROM meal_ingredients mi
      JOIN meals m ON m.id = mi.meal_id
      WHERE m.date BETWEEN ? AND ?
        AND mi.on_shopping_list = 0
      ORDER BY m.date ASC, mi.id ASC
    `).all(vFrom.value, vTo.value);

    if (!ingredients.length) {
      return res.json({ data: { transferred: 0, added: 0, meals: 0 } });
    }

    const mealCount = new Set(ingredients.map((i) => i.meal_id)).size;
    const aggregated = aggregateMealIngredients(ingredients);

    // Vorschau (Audit A1-22): identische Auswahl und Aggregation, aber ohne
    // Schreib-Transaktion. Der Client zeigt "X Zutaten aus Y Mahlzeiten",
    // bevor der Nutzer den Import bestätigt.
    if (req.body.preview === true) {
      return res.json({ data: { transferred: ingredients.length, added: aggregated.length, meals: mealCount, preview: true } });
    }

    const added = db.get().transaction(() => {
      const insertItem = db.get().prepare(`
        INSERT INTO shopping_items (list_id, name, quantity, category, added_from_meal)
        VALUES (?, ?, ?, ?, ?)
      `);
      const markDone = db.get().prepare('UPDATE meal_ingredients SET on_shopping_list = 1 WHERE id = ?');

      for (const item of aggregated) {
        insertItem.run(req.params.listId, item.name, item.quantity, item.category, item.added_from_meal);
      }
      for (const ingredient of ingredients) {
        markDone.run(ingredient.id);
      }
      return aggregated.length;
    })();

    res.json({ data: { transferred: ingredients.length, added, meals: mealCount } });
  } catch (err) {
    log.error('POST /:listId/import-meal-plan error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// POST /api/v1/shopping/:listId/import-pantry
// Setzt Vorratsartikel auf die Einkaufsliste (leer oder unter Mindestbestand).
// Body: { items: [{ pantry_item_id, quantity? }] }
//
// Die Mengen-Angabe kommt als fertiger Anzeigetext vom Client: shopping_items.quantity
// ist Freitext, und die Einheiten des Vorrats ('pcs', 'can', …) sind erst über t()
// lesbar. Die Übersetzung bleibt damit im Frontend, wo sie hingehört.
//
// Liegt derselbe Name bereits unabgehakt auf der Liste, wird übersprungen statt
// dupliziert - zweimal "Milch" hilft im Supermarkt niemandem.
// Response: { data: { added: number, skipped: number, added_ids: number[] } }
//
// `added_ids` traegt das Undo im Client: der Warenkorb in einer Vorratszeile war
// die einzige Aktion des Kuechenmoduls, die etwas erzeugt und dafuer kein
// Zuruecknehmen anbot - und sie sitzt 4px neben "Menge erhoehen", das das
// Gegenteil bedeutet (Critique 2026-07-30). Ein verzoegerter Commit waere die
// Alternative gewesen; dann muesste der Toast eine Anzahl versprechen, die erst
// der Server kennt (Duplikate werden hier uebersprungen). Deshalb echtes Undo:
// sofort einfuegen, IDs zurueckgeben, auf Wunsch genau diese wieder loeschen.
// --------------------------------------------------------
router.post('/:listId/import-pantry', (req, res) => {
  try {
    const list = db.get()
      .prepare('SELECT id FROM shopping_lists WHERE id = ?')
      .get(req.params.listId);
    if (!list) return res.status(404).json({ error: 'List not found.', code: 404 });

    const entries = Array.isArray(req.body.items) ? req.body.items : [];
    if (!entries.length) return res.json({ data: { added: 0, skipped: 0, added_ids: [] } });

    const validNames = validCategoryNames();
    const defaultCat = validNames[validNames.length - 1] ?? 'Sonstiges';

    const result = db.get().transaction(() => {
      const findPantryItem = db.get().prepare('SELECT name, category FROM pantry_items WHERE id = ?');
      const findDuplicate = db.get().prepare(`
        SELECT id FROM shopping_items
        WHERE list_id = ? AND is_checked = 0 AND name = ? COLLATE NOCASE
        LIMIT 1
      `);
      const insertItem = db.get().prepare(`
        INSERT INTO shopping_items (list_id, name, quantity, category) VALUES (?, ?, ?, ?)
      `);

      let skipped = 0;
      const addedIds = [];

      for (const entry of entries) {
        const pantryItem = findPantryItem.get(Number(entry?.pantry_item_id));
        if (!pantryItem) { skipped += 1; continue; }
        if (findDuplicate.get(req.params.listId, pantryItem.name)) { skipped += 1; continue; }

        const vQty = str(entry.quantity, 'Menge', { max: MAX_SHORT, required: false });
        const category = validNames.includes(pantryItem.category) ? pantryItem.category : defaultCat;
        const info = insertItem.run(req.params.listId, pantryItem.name, vQty.value, category);
        addedIds.push(Number(info.lastInsertRowid));
      }

      return { added: addedIds.length, skipped, added_ids: addedIds };
    })();

    res.json({ data: result });
  } catch (err) {
    log.error('POST /:listId/import-pantry error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/shopping/:listId/items/checked
// Alle abgehakten Artikel aus einer Liste löschen.
// Response: { deleted: number }
// --------------------------------------------------------
router.delete('/:listId/items/checked', (req, res) => {
  try {
    const queued = queueTodoDeletions(
      'shopping', mirroredItems('list_id = ? AND is_checked = 1', req.params.listId)
    );

    const result = db.get().prepare(`
      DELETE FROM shopping_items WHERE list_id = ? AND is_checked = 1
    `).run(req.params.listId);
    res.json({ deleted: result.changes });

    if (queued) pushToCalDAV('Löschung');
  } catch (err) {
    log.error('DELETE /:listId/items/checked error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
