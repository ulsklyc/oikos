/**
 * One-shot AI cleanup pass: re-labels every distinct item and re-groups
 * every merchant already in the database using the current (improved)
 * prompt, so historical/imported data catches up to whatever quality bar
 * new scans get. Admin-only — costs real API calls and rewrites data.
 *
 * Items are processed in batches (not one giant call — see providers/
 * schema.js for why) applied to the DB after each batch, so a failure
 * partway through still keeps whatever progress was made instead of
 * losing the whole pass.
 */
import express from 'express';
import * as db from '../db.js';
import { requireYuvomiAdmin } from '../auth.js';
import { requireCsrf } from '../csrf.js';
import { runClassifyItems, runClassifyMerchants } from '../providers/index.js';

const router = express.Router();
const ITEM_BATCH_SIZE = 60;

router.post('/', requireYuvomiAdmin, requireCsrf, async (req, res) => {
  const provider = db.getSetting('vision_provider') || 'gemini';
  const model = req.body?.model || db.getSetting('vision_model') || null;
  const apiKey = db.getSetting(`${provider}_api_key`) || process.env[`${provider.toUpperCase()}_API_KEY`] || null;
  if (!apiKey) {
    return res.status(409).json({ error: `No API key configured for ${provider}. Set one under Settings first.`, code: 409 });
  }

  const items = db
    .get()
    .prepare('SELECT raw_name, MIN(category) AS category, MIN(canonical_label) AS canonical_label FROM receipt_items GROUP BY raw_name')
    .all();
  const merchants = db.get().prepare('SELECT DISTINCT merchant FROM receipts ORDER BY merchant').all().map((r) => r.merchant);

  if (!items.length) {
    return res.status(400).json({ error: 'No items to reclassify yet.', code: 400 });
  }

  const updateItem = db.get().prepare('UPDATE receipt_items SET canonical_label = ?, category = ? WHERE raw_name = ?');
  const upsertGroup = db.get().prepare(`
    INSERT INTO merchant_groups (merchant, group_name) VALUES (?, ?)
    ON CONFLICT(merchant) DO UPDATE SET group_name = excluded.group_name
  `);
  const clearGroup = db.get().prepare('DELETE FROM merchant_groups WHERE merchant = ?');

  let merchantsGrouped = 0;
  try {
    const merchantGroups = await runClassifyMerchants({ provider, model, apiKey, merchants });
    db.get().transaction(() => {
      for (const m of merchantGroups) {
        if (m.group_name === m.merchant) clearGroup.run(m.merchant);
        else {
          upsertGroup.run(m.merchant, m.group_name);
          merchantsGrouped++;
        }
      }
    })();
  } catch (err) {
    return res.status(502).json({ error: `Merchant grouping failed: ${err.message}`, code: 502 });
  }

  const existingLabels = new Set();
  let itemsUpdated = 0;
  let batchesDone = 0;
  const totalBatches = Math.ceil(items.length / ITEM_BATCH_SIZE);

  for (let i = 0; i < items.length; i += ITEM_BATCH_SIZE) {
    const batch = items.slice(i, i + ITEM_BATCH_SIZE);
    let result;
    try {
      // Malformed/truncated JSON from the model is common enough at this
      // volume of structured-output calls to be worth one immediate retry
      // before giving up and losing the rest of the run.
      try {
        result = await runClassifyItems({ provider, model, apiKey, items: batch, existingLabels: [...existingLabels] });
      } catch {
        result = await runClassifyItems({ provider, model, apiKey, items: batch, existingLabels: [...existingLabels] });
      }
    } catch (err) {
      // Partial progress already committed to the DB from earlier batches —
      // report what happened rather than losing it.
      return res.status(502).json({
        error: `Item batch ${batchesDone + 1}/${totalBatches} failed twice: ${err.message}. ${itemsUpdated} item rows were already updated before this failure.`,
        code: 502,
      });
    }

    db.get().transaction(() => {
      for (const it of result) {
        const info = updateItem.run(it.canonical_label, it.category, it.raw_name);
        itemsUpdated += info.changes;
        if (it.canonical_label) existingLabels.add(it.canonical_label);
      }
    })();
    batchesDone++;
  }

  const distinctLabelsAfter = db
    .get()
    .prepare('SELECT COUNT(DISTINCT canonical_label) n FROM receipt_items WHERE canonical_label IS NOT NULL')
    .get().n;
  const categoriesUsed = db.get().prepare('SELECT DISTINCT category FROM receipt_items').all().map((r) => r.category);
  db.setSetting('categories', JSON.stringify([...new Set(categoriesUsed)].sort()));

  res.json({
    data: {
      distinctItemsSeen: items.length,
      batchesRun: batchesDone,
      itemRowsUpdated: itemsUpdated,
      distinctLabelsAfter,
      merchantsGrouped,
    },
  });
});

export default router;
