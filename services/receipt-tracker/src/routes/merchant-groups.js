/**
 * Merchant grouping — e.g. "ShopRite of Bayonne" and "ShopRite of Metro
 * Plaza" both roll up under "ShopRite" for the Tracking page, while
 * receipts.merchant keeps the specific location. A merchant with no row
 * here is its own group (falls back to its raw name wherever this is
 * joined — see stats.js).
 */
import express from 'express';
import * as db from '../db.js';
import { requireYuvomiSession } from '../auth.js';
import { requireCsrf } from '../csrf.js';

const router = express.Router();

router.get('/', requireYuvomiSession, (_req, res) => {
  const merchants = db.get().prepare('SELECT DISTINCT merchant FROM receipts ORDER BY merchant').all().map((r) => r.merchant);
  const groups = db.get().prepare('SELECT merchant, group_name FROM merchant_groups').all();
  const groupByMerchant = Object.fromEntries(groups.map((g) => [g.merchant, g.group_name]));

  res.json({
    data: merchants.map((merchant) => ({ merchant, group_name: groupByMerchant[merchant] || merchant })),
  });
});

router.put('/:merchant', requireYuvomiSession, requireCsrf, (req, res) => {
  const merchant = req.params.merchant;
  const groupName = String(req.body?.group_name || '').trim();

  if (!groupName || groupName === merchant) {
    // Same as its own name (or cleared) — no row needed, falls back naturally.
    db.get().prepare('DELETE FROM merchant_groups WHERE merchant = ?').run(merchant);
  } else {
    db.get()
      .prepare(`
        INSERT INTO merchant_groups (merchant, group_name) VALUES (?, ?)
        ON CONFLICT(merchant) DO UPDATE SET group_name = excluded.group_name
      `)
      .run(merchant, groupName);
  }

  res.json({ data: { merchant, group_name: groupName || merchant } });
});

export default router;
