/**
 * Spend analysis for the Tracking view: by category, by item (grouped by
 * canonical_label when set, falling back to the raw OCR text otherwise —
 * see receipt-tracker/index.js review screen for how canonical labels get
 * assigned), by merchant, and a time series bucketed by week or month.
 */
import express from 'express';
import * as db from '../db.js';
import { requireYuvomiSession } from '../auth.js';

const router = express.Router();

function dateFilter(from, to) {
  const where = [];
  const params = {};
  if (from) {
    where.push('r.purchase_date >= @from');
    params.from = from;
  }
  if (to) {
    where.push('r.purchase_date <= @to');
    params.to = to;
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/', requireYuvomiSession, (req, res) => {
  const { from, to, bucket = 'month' } = req.query;
  const { sql: whereSql, params } = dateFilter(from, to);
  const dateBucket = bucket === 'week' ? "strftime('%Y-W%W', r.purchase_date)" : "strftime('%Y-%m', r.purchase_date)";

  const byCategory = db
    .get()
    .prepare(`
      SELECT i.category AS category, SUM(i.total_price) AS total, COUNT(*) AS count
      FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
      ${whereSql}
      GROUP BY i.category ORDER BY total DESC
    `)
    .all(params);

  const byItem = db
    .get()
    .prepare(`
      SELECT COALESCE(NULLIF(i.canonical_label, ''), i.raw_name) AS label,
             SUM(i.total_price) AS total, SUM(i.quantity) AS quantity, COUNT(*) AS count
      FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
      ${whereSql}
      GROUP BY label ORDER BY total DESC
    `)
    .all(params);

  // Rolls receipts.merchant up through merchant_groups (e.g. "ShopRite of
  // Bayonne" + "ShopRite of Metro Plaza" -> "ShopRite") — a merchant with
  // no group row is its own group.
  const byMerchant = db
    .get()
    .prepare(`
      SELECT COALESCE(mg.group_name, r.merchant) AS merchant, SUM(r.total) AS total, COUNT(*) AS count
      FROM receipts r LEFT JOIN merchant_groups mg ON mg.merchant = r.merchant
      ${whereSql}
      GROUP BY COALESCE(mg.group_name, r.merchant) ORDER BY total DESC
    `)
    .all(params);

  const overTime = db
    .get()
    .prepare(`
      SELECT ${dateBucket} AS bucket, SUM(r.total) AS total, COUNT(*) AS count
      FROM receipts r
      ${whereSql}
      GROUP BY bucket ORDER BY bucket
    `)
    .all(params);

  res.json({ data: { byCategory, byItem, byMerchant, overTime } });
});

// Item-level breakdown within one department, for the "Spend by department"
// drill-down popup — same date range, grouped the same way as byItem above.
router.get('/category/:category', requireYuvomiSession, (req, res) => {
  const { from, to } = req.query;
  const { sql: dateSql, params } = dateFilter(from, to);
  const where = dateSql ? `${dateSql} AND i.category = @category` : 'WHERE i.category = @category';

  const items = db
    .get()
    .prepare(`
      SELECT COALESCE(NULLIF(i.canonical_label, ''), i.raw_name) AS label,
             SUM(i.total_price) AS total, SUM(i.quantity) AS quantity, COUNT(*) AS count
      FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
      ${where}
      GROUP BY label ORDER BY total DESC
    `)
    .all({ ...params, category: req.params.category });

  res.json({ data: { category: req.params.category, items } });
});

export default router;
