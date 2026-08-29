import {
  RECEIPT_PROMPT,
  GEMINI_RESPONSE_SCHEMA,
  normalizeExtraction,
  buildItemBatchPrompt,
  buildMerchantGroupPrompt,
  ITEM_BATCH_RESPONSE_SCHEMA,
  MERCHANT_GROUP_RESPONSE_SCHEMA,
  normalizeItemBatch,
  normalizeMerchantGroups,
} from './schema.js';

export const DEFAULT_MODEL = 'gemini-3.5-flash';

/** Live list of models this API key can actually use for image/PDF extraction. */
export async function listModels({ apiKey }) {
  if (!apiKey) throw new Error('No Gemini API key to list models with.');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini model list failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  return (body.models || [])
    // generateContent is the call we make; vision/PDF input isn't broken out
    // in this list, so a model that can't take images will surface that at
    // scan time with a clear error rather than being silently excluded here.
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      label: m.displayName || m.name.replace(/^models\//, ''),
    }));
}

export async function extract({ apiKey, model, base64, mimeType }) {
  if (!apiKey) throw new Error('No Gemini API key configured.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || DEFAULT_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: RECEIPT_PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini.');

  return normalizeExtraction(JSON.parse(text));
}

async function generateJson({ apiKey, model, prompt, responseSchema, maxOutputTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || DEFAULT_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema, maxOutputTokens },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  const candidate = body?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : '';
    throw new Error(`Empty response from Gemini${reason}.`);
  }
  return JSON.parse(text);
}

/** One batch of items — see schema.js buildItemBatchPrompt. Batched by the
 * caller (reclassify.js) rather than sent all at once: hundreds of items
 * in one response reliably overflows or times out. */
export async function classifyItems({ apiKey, model, items, existingLabels }) {
  if (!apiKey) throw new Error('No Gemini API key configured.');
  const raw = await generateJson({
    apiKey,
    model,
    prompt: buildItemBatchPrompt({ items, existingLabels }),
    responseSchema: ITEM_BATCH_RESPONSE_SCHEMA,
    maxOutputTokens: 8192,
  });
  return normalizeItemBatch(raw);
}

/** All merchants in one call — a few dozen at most, fits comfortably. */
export async function classifyMerchants({ apiKey, model, merchants }) {
  if (!apiKey) throw new Error('No Gemini API key configured.');
  const raw = await generateJson({
    apiKey,
    model,
    prompt: buildMerchantGroupPrompt({ merchants }),
    responseSchema: MERCHANT_GROUP_RESPONSE_SCHEMA,
    maxOutputTokens: 4096,
  });
  return normalizeMerchantGroups(raw);
}
