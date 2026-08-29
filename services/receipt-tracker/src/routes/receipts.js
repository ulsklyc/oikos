import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../db.js';
import { requireYuvomiSession } from '../auth.js';
import { requireCsrf } from '../csrf.js';

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || './data';
const STAGED_DIR = path.join(DATA_DIR, 'images', 'staged');
const RECEIPTS_DIR = path.join(DATA_DIR, 'images', 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

function withItems(receipt) {
  const items = db
    .get()
    .prepare('SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY id')
    .all(receipt.id);
  return { ...receipt, items };
}

function ensureCategory(category) {
  const categories = JSON.parse(db.getSetting('categories') || '[]');
  if (!categories.includes(category)) {
    categories.push(category);
    db.setSetting('categories', JSON.stringify(categories));
  }
}

// POST / — persist a reviewed/edited receipt + its line items.
router.post('/', requireYuvomiSession, requireCsrf, (req, res) => {
  const { merchant, date, tax, tip, total, items, stagedImageId, provider, model } = req.body || {};

  if (!merchant || !date || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'merchant, date and at least one item are required.', code: 400 });
  }

  // A single scanned photo/PDF can hold several distinct receipts (see
  // providers/schema.js) — they all carry the same stagedImageId. The
  // first save here moves the staged file into place; every later save
  // for the same scan just points at that same now-final file instead of
  // trying to move it again (which would silently drop the image).
  let imagePath = null;
  if (stagedImageId) {
    const stagedPath = path.join(STAGED_DIR, stagedImageId);
    const finalPath = path.join(RECEIPTS_DIR, stagedImageId);
    if (fs.existsSync(stagedPath)) {
      fs.renameSync(stagedPath, finalPath);
      imagePath = `receipts/${stagedImageId}`;
    } else if (fs.existsSync(finalPath)) {
      imagePath = `receipts/${stagedImageId}`;
    }
  }

  const insertReceipt = db.get().prepare(`
    INSERT INTO receipts (created_by, merchant, purchase_date, tax, tip, total, image_path, provider, model)
    VALUES (@created_by, @merchant, @purchase_date, @tax, @tip, @total, @image_path, @provider, @model)
  `);
  const insertItem = db.get().prepare(`
    INSERT INTO receipt_items (receipt_id, raw_name, canonical_label, description, quantity, unit_price, total_price, category)
    VALUES (@receipt_id, @raw_name, @canonical_label, @description, @quantity, @unit_price, @total_price, @category)
  `);

  const receiptId = db.get().transaction(() => {
    const info = insertReceipt.run({
      created_by: req.yuvomiUser.id,
      merchant: String(merchant).trim(),
      purchase_date: String(date).trim(),
      tax: Number(tax) || 0,
      tip: Number(tip) || 0,
      total: Number(total) || 0,
      image_path: imagePath,
      provider: provider || null,
      model: model || null,
    });
    for (const it of items) {
      const category = String(it.category || 'Other').trim() || 'Other';
      ensureCategory(category);
      insertItem.run({
        receipt_id: info.lastInsertRowid,
        raw_name: String(it.item || it.raw_name || '').trim(),
        canonical_label: it.canonical_label ? String(it.canonical_label).trim() : null,
        description: it.description ? String(it.description).trim() : null,
        quantity: Number(it.quantity) || 1,
        unit_price: it.unit_price != null ? Number(it.unit_price) : null,
        total_price: Number(it.total_price) || 0,
        category,
      });
    }
    return info.lastInsertRowid;
  })();

  const receipt = db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
  res.status(201).json({ data: withItems(receipt) });
});

// GET / — search + filter + paginate.
router.get('/', requireYuvomiSession, (req, res) => {
  const { q, category, merchant, from, to, page = '1', pageSize = '25' } = req.query;

  const where = [];
  const params = {};
  if (q) {
    where.push(`(
      r.merchant LIKE @q
      OR r.id IN (SELECT receipt_id FROM receipt_items WHERE raw_name LIKE @q OR canonical_label LIKE @q)
    )`);
    params.q = `%${q}%`;
  }
  if (category) {
    where.push('r.id IN (SELECT receipt_id FROM receipt_items WHERE category = @category)');
    params.category = category;
  }
  if (merchant) {
    where.push('r.merchant = @merchant');
    params.merchant = merchant;
  }
  if (from) {
    where.push('r.purchase_date >= @from');
    params.from = from;
  }
  if (to) {
    where.push('r.purchase_date <= @to');
    params.to = to;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(pageSize) || 25, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const total = db.get().prepare(`SELECT COUNT(*) AS n FROM receipts r ${whereSql}`).get(params).n;
  const rows = db
    .get()
    .prepare(`SELECT r.* FROM receipts r ${whereSql} ORDER BY r.purchase_date DESC, r.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  res.json({ data: rows.map(withItems), meta: { total, page: Number(page) || 1, pageSize: limit } });
});

router.get('/:id', requireYuvomiSession, (req, res) => {
  const receipt = db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!receipt) return res.status(404).json({ error: 'Not found.', code: 404 });
  res.json({ data: withItems(receipt) });
});

router.put('/:id', requireYuvomiSession, requireCsrf, (req, res) => {
  const existing = db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found.', code: 404 });

  const { merchant, date, tax, tip, total, items } = req.body || {};

  db.get().transaction(() => {
    db.get()
      .prepare(`
        UPDATE receipts
        SET merchant = @merchant, purchase_date = @purchase_date, tax = @tax, tip = @tip, total = @total,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = @id
      `)
      .run({
        id: existing.id,
        merchant: String(merchant ?? existing.merchant).trim(),
        purchase_date: String(date ?? existing.purchase_date).trim(),
        tax: tax != null ? Number(tax) : existing.tax,
        tip: tip != null ? Number(tip) : existing.tip,
        total: total != null ? Number(total) : existing.total,
      });

    if (Array.isArray(items)) {
      db.get().prepare('DELETE FROM receipt_items WHERE receipt_id = ?').run(existing.id);
      const insertItem = db.get().prepare(`
        INSERT INTO receipt_items (receipt_id, raw_name, canonical_label, description, quantity, unit_price, total_price, category)
        VALUES (@receipt_id, @raw_name, @canonical_label, @description, @quantity, @unit_price, @total_price, @category)
      `);
      for (const it of items) {
        const category = String(it.category || 'Other').trim() || 'Other';
        ensureCategory(category);
        insertItem.run({
          receipt_id: existing.id,
          raw_name: String(it.item || it.raw_name || '').trim(),
          canonical_label: it.canonical_label ? String(it.canonical_label).trim() : null,
          description: it.description ? String(it.description).trim() : null,
          quantity: Number(it.quantity) || 1,
          unit_price: it.unit_price != null ? Number(it.unit_price) : null,
          total_price: Number(it.total_price) || 0,
          category,
        });
      }
    }
  })();

  const updated = db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(existing.id);
  res.json({ data: withItems(updated) });
});

router.delete('/:id', requireYuvomiSession, requireCsrf, (req, res) => {
  const existing = db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found.', code: 404 });

  if (existing.image_path) {
    const full = path.join(DATA_DIR, 'images', existing.image_path);
    fs.rm(full, { force: true }, () => {});
  }
  db.get().prepare('DELETE FROM receipts WHERE id = ?').run(existing.id);
  res.status(204).end();
});

// Item-level editing, independent of the whole-receipt PUT above — lets
// History correct or drop a single line without resubmitting every other
// item on the receipt.
router.put('/:id/items/:itemId', requireYuvomiSession, requireCsrf, (req, res) => {
  const item = db
    .get()
    .prepare('SELECT * FROM receipt_items WHERE id = ? AND receipt_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

  const body = req.body || {};
  const category = body.category != null ? String(body.category).trim() || 'Other' : item.category;
  if (body.category != null) ensureCategory(category);

  db.get()
    .prepare(`
      UPDATE receipt_items
      SET raw_name = @raw_name, canonical_label = @canonical_label, description = @description,
          quantity = @quantity, unit_price = @unit_price, total_price = @total_price, category = @category
      WHERE id = @id
    `)
    .run({
      id: item.id,
      raw_name: body.item != null || body.raw_name != null ? String(body.item ?? body.raw_name).trim() : item.raw_name,
      canonical_label: body.canonical_label !== undefined ? (body.canonical_label ? String(body.canonical_label).trim() : null) : item.canonical_label,
      description: body.description !== undefined ? (body.description ? String(body.description).trim() : null) : item.description,
      quantity: body.quantity != null ? Number(body.quantity) || 1 : item.quantity,
      unit_price: body.unit_price !== undefined ? (body.unit_price != null ? Number(body.unit_price) : null) : item.unit_price,
      total_price: body.total_price != null ? Number(body.total_price) || 0 : item.total_price,
      category,
    });

  const receipt = db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  res.json({ data: withItems(receipt) });
});

router.post('/:id/items', requireYuvomiSession, requireCsrf, (req, res) => {
  const receipt = db.get().prepare('SELECT id FROM receipts WHERE id = ?').get(req.params.id);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found.', code: 404 });

  const it = req.body || {};
  const category = String(it.category || 'Other').trim() || 'Other';
  ensureCategory(category);

  db.get()
    .prepare(`
      INSERT INTO receipt_items (receipt_id, raw_name, canonical_label, description, quantity, unit_price, total_price, category)
      VALUES (@receipt_id, @raw_name, @canonical_label, @description, @quantity, @unit_price, @total_price, @category)
    `)
    .run({
      receipt_id: req.params.id,
      raw_name: String(it.item || it.raw_name || '').trim(),
      canonical_label: it.canonical_label ? String(it.canonical_label).trim() : null,
      description: it.description ? String(it.description).trim() : null,
      quantity: Number(it.quantity) || 1,
      unit_price: it.unit_price != null ? Number(it.unit_price) : null,
      total_price: Number(it.total_price) || 0,
      category,
    });

  res.status(201).json({ data: withItems(db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id)) });
});

router.delete('/:id/items/:itemId', requireYuvomiSession, requireCsrf, (req, res) => {
  const item = db
    .get()
    .prepare('SELECT id FROM receipt_items WHERE id = ? AND receipt_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.', code: 404 });

  db.get().prepare('DELETE FROM receipt_items WHERE id = ?').run(item.id);
  const receipt = db.get().prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  res.json({ data: withItems(receipt) });
});

router.get('/:id/image', requireYuvomiSession, (req, res) => {
  const receipt = db.get().prepare('SELECT image_path FROM receipts WHERE id = ?').get(req.params.id);
  if (!receipt?.image_path) return res.status(404).json({ error: 'No image.', code: 404 });
  res.sendFile(path.resolve(DATA_DIR, 'images', receipt.image_path));
});

export default router;
