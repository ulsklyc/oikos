/**
 * CSV export — every item across every receipt, flattened. Opens directly
 * in Excel/Sheets; no separate .xlsx writer needed for that.
 */
import express from 'express';
import * as db from '../db.js';
import { requireYuvomiSession } from '../auth.js';

const router = express.Router();

function csvField(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/', requireYuvomiSession, (_req, res) => {
  const rows = db
    .get()
    .prepare(`
      SELECT r.purchase_date, r.merchant, r.tax AS receipt_tax, r.tip AS receipt_tip, r.total AS receipt_total,
             i.raw_name, i.canonical_label, i.category, i.quantity, i.unit_price, i.total_price
      FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
      ORDER BY r.purchase_date, r.id, i.id
    `)
    .all();

  const header = [
    'Date', 'Merchant', 'Item', 'Group As', 'Category', 'Quantity', 'Unit Price', 'Item Total',
    'Receipt Tax', 'Receipt Tip', 'Receipt Total',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.purchase_date, r.merchant, r.raw_name, r.canonical_label || '', r.category,
        r.quantity, r.unit_price ?? '', r.total_price, r.receipt_tax, r.receipt_tip, r.receipt_total,
      ].map(csvField).join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="receipts-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

export default router;
