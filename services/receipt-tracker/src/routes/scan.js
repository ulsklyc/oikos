/**
 * POST /scan — runs the configured vision model over an uploaded receipt
 * photo and returns a draft extraction. Nothing is written to the receipts
 * table here: the client shows this in the review screen first, and only
 * a subsequent POST /receipts (with the human-edited payload) persists it.
 */
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as db from '../db.js';
import { requireYuvomiSession } from '../auth.js';
import { requireCsrf } from '../csrf.js';
import { runExtraction } from '../providers/index.js';

const router = express.Router();
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

const DATA_DIR = process.env.DATA_DIR || './data';
const STAGED_DIR = path.join(DATA_DIR, 'images', 'staged');
fs.mkdirSync(STAGED_DIR, { recursive: true });

router.post('/', requireYuvomiSession, requireCsrf, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.', code: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
    return res.status(415).json({
      error: `Unsupported file type "${req.file.mimetype}". Upload a photo (JPEG/PNG/WebP/HEIC) or a PDF.`,
      code: 415,
    });
  }

  const provider = db.getSetting('vision_provider') || 'gemini';
  const model = db.getSetting('vision_model') || null;
  const apiKey =
    db.getSetting(`${provider}_api_key`) || process.env[`${provider.toUpperCase()}_API_KEY`] || null;

  if (!apiKey) {
    return res.status(409).json({
      error: `No API key configured for ${provider}. An admin needs to set one under Receipts → Settings.`,
      code: 409,
    });
  }

  // Stage the image now so a save right after doesn't need a second upload.
  const stagedId = crypto.randomUUID();
  const ext = (req.file.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const stagedPath = path.join(STAGED_DIR, `${stagedId}.${ext}`);
  fs.writeFileSync(stagedPath, req.file.buffer);

  try {
    const draft = await runExtraction({
      provider,
      model,
      apiKey,
      base64: req.file.buffer.toString('base64'),
      mimeType: req.file.mimetype,
    });

    res.json({ data: { stagedImageId: `${stagedId}.${ext}`, provider, model, draft } });
  } catch (err) {
    res.status(502).json({ error: `Extraction failed: ${err.message}`, code: 502 });
  }
});

export default router;
