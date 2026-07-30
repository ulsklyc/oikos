/**
 * Modul: Mealie-Integration Routen
 * Zweck: Mealie-Accounts verwalten (Admin) und Rezept-Sync anstoßen/beobachten.
 * Abhängigkeiten: express, server/db.js, server/services/mealie-sync.js
 */
import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';
import { str, MAX_TITLE, MAX_URL } from '../middleware/validate.js';
import { getAdapter, sync, syncOne, getStatus } from '../services/mealie-sync.js';

const log = createLogger('Mealie');
const router = express.Router();

function isAdmin(req) { return req.authRole === 'admin' || req.session?.role === 'admin'; }
function userId(req) { return req.authUserId || req.session?.userId; }

function publicAccount(row) {
  if (!row) return null;
  const { api_token, ...rest } = row;
  return { ...rest, has_token: Boolean(api_token) };
}

function getAccount(id) {
  return db.get().prepare('SELECT * FROM mealie_accounts WHERE id = ?').get(id);
}

router.get('/accounts', (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const rows = db.get().prepare('SELECT * FROM mealie_accounts ORDER BY name COLLATE NOCASE').all();
    res.json({ data: rows.map(publicAccount) });
  } catch (err) {
    log.error('GET /accounts error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
    const vUrl = str(req.body.base_url, 'Base URL', { max: MAX_URL });
    const vToken = str(req.body.api_token, 'API token', { max: 500 });
    for (const v of [vName, vUrl, vToken]) if (v.error) return res.status(400).json({ error: v.error, code: 400 });
    if (!/^https?:\/\//i.test(vUrl.value)) return res.status(400).json({ error: 'Base URL must start with http(s)://', code: 400 });

    // Optional: eine von außen erreichbare Adresse für "In Mealie öffnen"-Links,
    // falls base_url (z. B. ein Docker-internes Compose-Hostname) für den
    // Browser des Nutzers nicht erreichbar ist. Leer = base_url dient auch dafür.
    let externalUrl = null;
    if (req.body.external_url) {
      const vExternal = str(req.body.external_url, 'External URL', { max: MAX_URL });
      if (vExternal.error) return res.status(400).json({ error: vExternal.error, code: 400 });
      if (!/^https?:\/\//i.test(vExternal.value)) {
        return res.status(400).json({ error: 'External URL must start with http(s)://', code: 400 });
      }
      externalUrl = vExternal.value.replace(/\/+$/, '');
    }

    const baseUrl = vUrl.value.replace(/\/+$/, '');
    const test = await getAdapter({ base_url: baseUrl, api_token: vToken.value }).testConnection();
    if (!test.ok) {
      return res.status(502).json({ error: 'Could not connect to Mealie with these credentials.', code: 502 });
    }

    if (!process.env.DB_ENCRYPTION_KEY) {
      log.warn('WARNING: DB_ENCRYPTION_KEY is not set - Mealie API token will be stored unencrypted.');
    }

    const result = db.get().prepare(`
      INSERT INTO mealie_accounts (name, base_url, external_url, api_token, created_by) VALUES (?, ?, ?, ?, ?)
    `).run(vName.value, baseUrl, externalUrl, vToken.value, userId(req));
    res.status(201).json({ data: publicAccount(getAccount(result.lastInsertRowid)) });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A Mealie account with this URL already exists.', code: 409 });
    }
    log.error('POST /accounts error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.patch('/accounts/:id', (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const account = getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'Mealie account not found.', code: 404 });

    const enabled = req.body.enabled === undefined ? account.enabled : (req.body.enabled ? 1 : 0);
    let name = account.name;
    if (req.body.name !== undefined) {
      const vName = str(req.body.name, 'Name', { max: MAX_TITLE });
      if (vName.error) return res.status(400).json({ error: vName.error, code: 400 });
      name = vName.value;
    }

    let externalUrl = account.external_url;
    if (req.body.external_url !== undefined) {
      if (!req.body.external_url) {
        externalUrl = null;
      } else {
        const vExternal = str(req.body.external_url, 'External URL', { max: MAX_URL });
        if (vExternal.error) return res.status(400).json({ error: vExternal.error, code: 400 });
        if (!/^https?:\/\//i.test(vExternal.value)) {
          return res.status(400).json({ error: 'External URL must start with http(s)://', code: 400 });
        }
        externalUrl = vExternal.value.replace(/\/+$/, '');
      }
    }

    db.get().prepare('UPDATE mealie_accounts SET name = ?, enabled = ?, external_url = ? WHERE id = ?')
      .run(name, enabled, externalUrl, account.id);
    res.json({ data: publicAccount(getAccount(account.id)) });
  } catch (err) {
    log.error('PATCH /accounts/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.delete('/accounts/:id', (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const id = Number(req.params.id);
    const existing = getAccount(id);
    if (!existing) return res.status(404).json({ error: 'Mealie account not found.', code: 404 });
    // Löscht per FK-Kaskade auch alle von diesem Account gespiegelten Rezepte
    // (recipes.mealie_account_id ON DELETE CASCADE) - ein Mirror-Rezept hat ohne
    // seinen Quell-Account keinen eigenständigen Inhalt mehr.
    db.get().prepare('DELETE FROM mealie_accounts WHERE id = ?').run(id);
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /accounts/:id error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/accounts/:id/test', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const account = getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'Mealie account not found.', code: 404 });
    const result = await getAdapter(account).testConnection();
    if (!result.ok) db.get().prepare('UPDATE mealie_accounts SET last_error = ? WHERE id = ?').run(result.error || `HTTP ${result.status}`, account.id);
    res.json({ data: result });
  } catch (err) {
    log.error('POST /accounts/:id/test error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/accounts/:id/sync', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const account = getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'Mealie account not found.', code: 404 });
    const result = await syncOne(account.id);
    res.json({ data: result });
  } catch (err) {
    log.error('POST /accounts/:id/sync error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

router.post('/sync', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized.', code: 403 });
    const result = await sync();
    res.json({ data: result });
  } catch (err) {
    log.error('POST /sync error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

// Auch für Nicht-Admins lesbar: die Rezepte-Seite zeigt "zuletzt synchronisiert"
// pro Account, ohne den API-Token selbst offenzulegen (publicAccount-Strip greift
// hier ohnehin nicht, getStatus() liefert nie den Token).
router.get('/status', (_req, res) => {
  try {
    res.json({ data: getStatus() });
  } catch (err) {
    log.error('GET /status error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export default router;
