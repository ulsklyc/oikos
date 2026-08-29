/**
 * Local-only stand-in for the reverse proxy (nginx/Caddy) that fronts both
 * Yuvomi and this service in production. Forwards
 * /api/extensions/receipt-tracker/* to this service and everything else to
 * Yuvomi core, so the browser sees one origin and the session cookie
 * carries over — exactly the setup MODULES.md describes.
 *
 * Not part of the module or the service itself; only used for
 * `npm run dev-proxy` while developing locally. In production this becomes
 * one `location /api/extensions/receipt-tracker/ { proxy_pass ...; }` block
 * in nginx.conf, alongside Yuvomi's own.
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const YUVOMI_URL = process.env.YUVOMI_INTERNAL_URL || 'http://localhost:3000';
const SERVICE_URL = `http://localhost:${process.env.PORT || 4100}`;
const PROXY_PORT = process.env.DEV_PROXY_PORT || 8090;

const app = express();

app.use(
  '/api/extensions/receipt-tracker',
  createProxyMiddleware({
    target: SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/extensions/receipt-tracker': '' },
  })
);

app.use(createProxyMiddleware({ target: YUVOMI_URL, changeOrigin: true, ws: true }));

app.listen(PROXY_PORT, () => {
  console.log(`[dev-proxy] http://localhost:${PROXY_PORT} -> Yuvomi @ ${YUVOMI_URL}, service @ ${SERVICE_URL}`);
});
