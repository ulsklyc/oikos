/**
 * Shared shape every vision provider must return. This closely follows the
 * prompt/schema in the original receipt-tracker app's server.ts, which is
 * what actually produced the household's clean historical CSV — notably:
 * `item` is a clean human-readable name (the model's job, it's good at
 * this), `description` is the raw printed line for reference, and the
 * root is an ARRAY of receipts so one photo/PDF containing more than one
 * physical receipt comes back as separate entries instead of one merged
 * mess. Discounts/coupons get their own negative-price entry rather than
 * being netted into the item above them (also matches the historical data).
 */
export const DEPARTMENT_CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Deli', 'Bakery', 'Snacks', 'Beverages',
  'Alcohol', 'Pantry', 'Prepared Foods', 'Grocery', 'Household', 'Supplies',
  'Health & Beauty', 'Baby', 'Apparel', 'Sporting Goods', 'Shopping', 'Dining',
  'Utilities', 'Other',
];

export const RECEIPT_PROMPT = `You are reading one or more retail or restaurant receipts (a photo or a scanned/exported PDF). It may contain a single receipt, or multiple separate receipts (side-by-side, stacked, or on separate pages) — recognize ALL distinct physical receipts present and extract each one separately.

For each receipt:
- merchant: the clean, recognizable store or merchant name.
- date: the purchase date in YYYY-MM-DD. Default to today (${new Date().toISOString().slice(0, 10)}) if genuinely unreadable.
- items: one entry per printed line, including discounts/coupons/instant-savings — those get their own entry with a negative total_price, immediately after the item they apply to (do not net them into that item's price). If a discount line has no product name printed (just a code/number), name it descriptively using the item it discounts, e.g. "Chicken Melt Discount".
  - item: a clean, concise, human-readable product name. Expand abbreviations using your own knowledge of how receipts print them (e.g. "B/S ATL SALM" -> "Boneless Skinless Atlantic Salmon", "HVY CREAM QT" -> "Heavy Cream, Quart"). This is the name a person would recognize, not a transcription.
  - description: the exact line text as printed on the receipt, unmodified — kept for reference against the original.
  - canonical_label: a short general product-type label for grouping this item with similar purchases over time, e.g. "Turkey Breast", "King Salmon", "Laundry Detergent", "Vegetable" for a specific onion/pepper/etc when nothing more specific fits. Leave empty only if the item name is already that generic.
  - quantity: may be fractional (e.g. weighed produce). Default to 1 if not shown.
  - unit_price / total_price: the numbers printed on the receipt (before tax).
  - category: the grocery/store department this item belongs to. Prefer one of: ${DEPARTMENT_CATEGORIES.join(', ')} — but if an item clearly belongs to a department not in this list, use the correct department name rather than forcing it into "Other".
- tax, tip, total: the receipt-level values (tip is 0 if not applicable, e.g. a grocery store).

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{
  "receipts": [
    {
      "merchant": string,
      "date": "YYYY-MM-DD",
      "tax": number,
      "tip": number,
      "total": number,
      "items": [
        { "item": string, "description": string, "canonical_label": string, "quantity": number, "unit_price": number, "total_price": number, "category": string }
      ]
    }
  ]
}
If there is only one receipt, return a "receipts" array with exactly one element.`;

// Gemini's responseSchema (a restricted JSON-Schema subset).
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    receipts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          merchant: { type: 'string' },
          date: { type: 'string' },
          tax: { type: 'number' },
          tip: { type: 'number' },
          total: { type: 'number' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string' },
                description: { type: 'string' },
                canonical_label: { type: 'string' },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
                total_price: { type: 'number' },
                category: { type: 'string' },
              },
              required: ['item', 'quantity', 'total_price', 'category'],
            },
          },
        },
        required: ['merchant', 'date', 'total', 'items'],
      },
    },
  },
  required: ['receipts'],
};

/**
 * Text-only reclassification pass over every distinct item name and
 * merchant already in the database — run after prompt changes so
 * historical/imported data (which predates the improved prompt, or came
 * from a CSV with its own inconsistent labels) gets the same quality bar
 * as a fresh scan.
 *
 * Split into two calls rather than one:
 * - Merchants (typically a few dozen) fit comfortably in one call.
 * - Items can run into the hundreds, which in practice overflows a
 *   single response (truncated JSON) on some models and is slow on
 *   others. Items are processed in batches instead — each batch is told
 *   which canonical_labels earlier batches already chose and asked to
 *   reuse one rather than invent a near-duplicate, so consistency is
 *   carried forward across batches instead of requiring one giant call.
 */
export function buildItemBatchPrompt({ items, existingLabels }) {
  // JSON.stringify (not manual "${x}" quoting) so an item name containing a
  // literal quote or backslash (e.g. `Keebler 9" Crust`) round-trips as
  // valid JSON both here and, by example, in the model's own output.
  const itemLines = items
    .map((it) => `- ${JSON.stringify(it.raw_name)} (current category: ${it.category || 'none'}, current label: ${it.canonical_label || 'none'})`)
    .join('\n');
  const existingLabelsBlock = existingLabels?.length
    ? `\nLabels already chosen for other items in this same cleanup pass — reuse one of these for the same real product instead of inventing a near-duplicate (e.g. don't add "Chicken" if "Chicken Breast" is already here and fits):\n${existingLabels.map((l) => `- ${JSON.stringify(l)}`).join('\n')}\n`
    : '';

  return `You are cleaning up a household's grocery/shopping spend-tracking database so its "most bought items" report is accurate instead of fragmented.

For every item below, assign:
- canonical_label: a short, general product-type name for grouping repeat purchases of the same real-world product over time (e.g. "Whole Milk", "Chicken Breast", "Paper Towels", "Bananas").
- category: the store department, from exactly this list: ${DEPARTMENT_CATEGORIES.join(', ')}. Fix any item that's clearly miscategorized.
${existingLabelsBlock}
Items (${items.length} in this batch):
${itemLines}

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{ "items": [ { "raw_name": string, "canonical_label": string, "category": string } ] }
Include every item listed above, exactly once each, with raw_name matching the input string exactly. Never write "none"/"n/a" as a label — if truly nothing more specific fits, repeat the item's own clean name.`;
}

export function buildMerchantGroupPrompt({ merchants }) {
  const merchantLines = merchants.map((m) => `- ${JSON.stringify(m)}`).join('\n');
  return `Group these merchants from a household's spend-tracking database by real-world business — merchants that are the same business at different physical locations should share one group_name (e.g. "ShopRite of Bayonne" and "ShopRite of Metro Plaza" both -> "ShopRite"). Leave genuinely distinct merchants as their own group (group_name equal to the merchant name). Use your judgement on borderline cases like a gas station vs. the main store of the same brand.

Merchants (${merchants.length} total):
${merchantLines}

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{ "merchantGroups": [ { "merchant": string, "group_name": string } ] }
Include every merchant listed above, exactly once each, with merchant matching the input string exactly.`;
}

export const ITEM_BATCH_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          raw_name: { type: 'string' },
          canonical_label: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['raw_name', 'canonical_label', 'category'],
      },
    },
  },
  required: ['items'],
};

export const MERCHANT_GROUP_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    merchantGroups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          merchant: { type: 'string' },
          group_name: { type: 'string' },
        },
        required: ['merchant', 'group_name'],
      },
    },
  },
  required: ['merchantGroups'],
};

// Models sometimes write the word "none"/"n/a"/etc instead of actually
// leaving a field empty, despite instructions — treat those as empty too.
const EMPTY_LABEL_RE = /^(none|n\/a|na|null|empty|unknown|-)$/i;
function cleanLabel(value) {
  const s = String(value || '').trim();
  return s && !EMPTY_LABEL_RE.test(s) ? s : null;
}

export function normalizeItemBatch(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Model did not return an object.');
  const items = Array.isArray(raw.items) ? raw.items : [];
  return items.map((it) => ({
    raw_name: String(it.raw_name || '').trim(),
    canonical_label: cleanLabel(it.canonical_label),
    category: String(it.category || 'Other').trim() || 'Other',
  })).filter((it) => it.raw_name);
}

export function normalizeMerchantGroups(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Model did not return an object.');
  const merchantGroups = Array.isArray(raw.merchantGroups) ? raw.merchantGroups : [];
  return merchantGroups.map((m) => ({
    merchant: String(m.merchant || '').trim(),
    group_name: String(m.group_name || '').trim(),
  })).filter((m) => m.merchant && m.group_name);
}

/** Loose validation + normalization of whatever a provider returned. Always
 * returns an array of receipts, even when the provider (or an older prompt
 * response) gave back a single flat receipt object. */
export function normalizeExtraction(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Model did not return an object.');
  const rawReceipts = Array.isArray(raw.receipts) ? raw.receipts : Array.isArray(raw.items) ? [raw] : [];
  if (!rawReceipts.length) throw new Error('Model did not return any receipts.');

  return rawReceipts.map((r) => {
    const items = Array.isArray(r.items) ? r.items : [];
    return {
      merchant: String(r.merchant || '').trim() || 'Unknown merchant',
      date: String(r.date || '').trim(),
      tax: Number(r.tax) || 0,
      tip: Number(r.tip) || 0,
      total: Number(r.total) || 0,
      items: items.map((it) => ({
        item: String(it.item || '').trim(),
        description: it.description ? String(it.description).trim() : null,
        canonical_label: it.canonical_label ? String(it.canonical_label).trim() : null,
        quantity: Number(it.quantity) || 1,
        unit_price: it.unit_price != null ? Number(it.unit_price) : null,
        total_price: Number(it.total_price) || 0,
        category: String(it.category || 'Other').trim() || 'Other',
      })),
    };
  });
}
