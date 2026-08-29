import * as gemini from './gemini.js';
import * as claude from './claude.js';

/**
 * Registry of selectable vision providers for receipt extraction. Adding a
 * new provider is: implement extract({apiKey, model, base64, mimeType}) ->
 * normalized ReceiptData and listModels({apiKey}) -> [{id, label}], then
 * list it here. `models` is only a fallback shown before the live list has
 * loaded (or if listing fails) — Settings fetches the real list per key.
 */
export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: gemini.DEFAULT_MODEL,
    models: ['gemini-3.5-flash', 'gemini-pro-latest', 'gemini-3.5-flash-lite'],
    extract: gemini.extract,
    listModels: gemini.listModels,
    classifyItems: gemini.classifyItems,
    classifyMerchants: gemini.classifyMerchants,
  },
  claude: {
    label: 'Anthropic Claude',
    defaultModel: claude.DEFAULT_MODEL,
    models: ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5'],
    extract: claude.extract,
    listModels: claude.listModels,
    classifyItems: claude.classifyItems,
    classifyMerchants: claude.classifyMerchants,
  },
};

export function providerCatalog() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([key, p]) => [
      key,
      { label: p.label, defaultModel: p.defaultModel, models: p.models },
    ])
  );
}

export async function runExtraction({ provider, model, apiKey, base64, mimeType }) {
  const entry = PROVIDERS[provider];
  if (!entry) throw new Error(`Unknown provider "${provider}".`);
  return entry.extract({ apiKey, model, base64, mimeType });
}

export async function runListModels({ provider, apiKey }) {
  const entry = PROVIDERS[provider];
  if (!entry) throw new Error(`Unknown provider "${provider}".`);
  return entry.listModels({ apiKey });
}

export async function runClassifyItems({ provider, model, apiKey, items, existingLabels }) {
  const entry = PROVIDERS[provider];
  if (!entry) throw new Error(`Unknown provider "${provider}".`);
  return entry.classifyItems({ apiKey, model, items, existingLabels });
}

export async function runClassifyMerchants({ provider, model, apiKey, merchants }) {
  const entry = PROVIDERS[provider];
  if (!entry) throw new Error(`Unknown provider "${provider}".`);
  return entry.classifyMerchants({ apiKey, model, merchants });
}
