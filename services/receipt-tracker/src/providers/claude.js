import {
  RECEIPT_PROMPT,
  normalizeExtraction,
  buildItemBatchPrompt,
  buildMerchantGroupPrompt,
  normalizeItemBatch,
  normalizeMerchantGroups,
} from './schema.js';

export const DEFAULT_MODEL = 'claude-sonnet-5';

/** Live list of models this API key can actually use. */
export async function listModels({ apiKey }) {
  if (!apiKey) throw new Error('No Anthropic API key to list models with.');

  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Claude model list failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  return (body.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not find JSON in Claude response.');
    return JSON.parse(match[0]);
  }
}

export async function extract({ apiKey, model, base64, mimeType }) {
  if (!apiKey) throw new Error('No Anthropic API key configured.');

  // Claude's Messages API takes PDFs as a "document" content block, distinct
  // from the "image" block used for photos — same request shape otherwise.
  const isPdf = mimeType === 'application/pdf';
  const fileBlock = {
    type: isPdf ? 'document' : 'image',
    source: { type: 'base64', media_type: mimeType, data: base64 },
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: RECEIPT_PROMPT }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Claude request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  const text = body?.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Empty response from Claude.');

  return normalizeExtraction(extractJson(text));
}

async function generateJson({ apiKey, model, prompt, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Claude request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  if (body?.stop_reason === 'max_tokens') {
    throw new Error('Response was cut off (hit max_tokens).');
  }
  const text = body?.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Empty response from Claude.');
  return extractJson(text);
}

/** One batch of items — see schema.js buildItemBatchPrompt. Batched by the
 * caller (reclassify.js) rather than sent all at once: hundreds of items
 * in one response reliably overflows or times out. */
export async function classifyItems({ apiKey, model, items, existingLabels }) {
  if (!apiKey) throw new Error('No Anthropic API key configured.');
  const raw = await generateJson({ apiKey, model, prompt: buildItemBatchPrompt({ items, existingLabels }), maxTokens: 4096 });
  return normalizeItemBatch(raw);
}

/** All merchants in one call — a few dozen at most, fits comfortably. */
export async function classifyMerchants({ apiKey, model, merchants }) {
  if (!apiKey) throw new Error('No Anthropic API key configured.');
  const raw = await generateJson({ apiKey, model, prompt: buildMerchantGroupPrompt({ merchants }), maxTokens: 4096 });
  return normalizeMerchantGroups(raw);
}
