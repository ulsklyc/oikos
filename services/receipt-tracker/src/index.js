import express from 'express';
import cookieParser from 'cookie-parser';
import { issueCsrfCookie } from './csrf.js';
import { requireYuvomiSession } from './auth.js';
import settingsRouter from './routes/settings.js';
import scanRouter from './routes/scan.js';
import receiptsRouter from './routes/receipts.js';
import statsRouter from './routes/stats.js';
import merchantGroupsRouter from './routes/merchant-groups.js';
import reclassifyRouter from './routes/reclassify.js';
import exportRouter from './routes/export.js';

const app = express();
const PORT = process.env.PORT || 4100;

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Every response under this router gets a CSRF cookie issued/renewed so the
// client always has a fresh double-submit token to echo back.
app.use((req, res, next) => {
  issueCsrfCookie(req, res);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// A cheap endpoint the client hits once on load to confirm session + get
// the user's role for UI purposes only — the server independently
// re-checks role on every write, this is just so the Settings tab can hide
// itself for non-admins.
app.get('/whoami', requireYuvomiSession, (req, res) => res.json({ data: req.yuvomiUser }));

app.use('/settings', settingsRouter);
app.use('/scan', scanRouter);
app.use('/receipts', receiptsRouter);
app.use('/stats', statsRouter);
app.use('/merchant-groups', merchantGroupsRouter);
app.use('/reclassify', reclassifyRouter);
app.use('/export.csv', exportRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error.', code: 500 });
});

app.listen(PORT, () => {
  console.log(`[receipt-tracker-service] listening on :${PORT}`);
});
