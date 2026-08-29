/**
 * Household-wide vision-provider configuration. One admin sets this up
 * once; every household member using the module gets it automatically —
 * nobody else needs their own API key. Reads are open to any authenticated
 * member (so the UI can show what's configured); writes are admin-only.
 * The key value itself is never returned, only whether one is set.
 */
import express from 'express';
import * as db from '../db.js';
import { requireYuvomiSession, requireYuvomiAdmin } from '../auth.js';
import { requireCsrf } from '../csrf.js';
import { providerCatalog, PROVIDERS, runListModels } from '../providers/index.js';

const router = express.Router();

function keyFieldFor(provider) {
  return `${provider}_api_key`;
}

router.get('/', requireYuvomiSession, (_req, res) => {
  const provider = db.getSetting('vision_provider') || 'gemini';
  const model = db.getSetting('vision_model') || PROVIDERS[provider]?.defaultModel || null;
  const hasApiKey = Boolean(db.getSetting(keyFieldFor(provider)) || process.env[`${provider.toUpperCase()}_API_KEY`]);

  res.json({
    data: {
      provider,
      model,
      hasApiKey,
      providers: providerCatalog(),
      categories: JSON.parse(db.getSetting('categories') || '[]'),
    },
  });
});

router.put('/', requireYuvomiAdmin, requireCsrf, (req, res) => {
  const { provider, model, apiKey } = req.body || {};

  if (!provider || !PROVIDERS[provider]) {
    return res.status(400).json({ error: 'Unknown or missing provider.', code: 400 });
  }

  db.setSetting('vision_provider', provider);
  db.setSetting('vision_model', model || PROVIDERS[provider].defaultModel);

  // Only overwrite the stored key if one was actually sent — leaves it
  // untouched when the admin is just switching the model, not rotating keys.
  if (typeof apiKey === 'string' && apiKey.trim()) {
    db.setSetting(keyFieldFor(provider), apiKey.trim());
  }

  res.json({
    data: {
      provider,
      model: db.getSetting('vision_model'),
      hasApiKey: Boolean(db.getSetting(keyFieldFor(provider))),
    },
  });
});

// POST /settings/models — live list of models the configured (or a
// not-yet-saved, just-typed) key can actually use, instead of hand-typing
// a model name and finding out it's wrong at scan time. Admin-only: same
// key-handling trust boundary as the write above, and it's what makes
// testing a brand-new key before saving it possible.
router.post('/models', requireYuvomiAdmin, requireCsrf, async (req, res) => {
  const { provider } = req.body || {};
  if (!provider || !PROVIDERS[provider]) {
    return res.status(400).json({ error: 'Unknown or missing provider.', code: 400 });
  }

  // A key typed into the form but not yet saved takes priority, so an
  // admin can check a new key before committing it.
  const typedKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  const apiKey = typedKey || db.getSetting(keyFieldFor(provider)) || process.env[`${provider.toUpperCase()}_API_KEY`] || null;

  if (!apiKey) {
    return res.status(409).json({ error: `No ${provider} API key to check yet — paste one first.`, code: 409 });
  }

  try {
    const models = await runListModels({ provider, apiKey });
    res.json({ data: { models } });
  } catch (err) {
    res.status(502).json({ error: `Could not list ${provider} models: ${err.message}`, code: 502 });
  }
});

export default router;
