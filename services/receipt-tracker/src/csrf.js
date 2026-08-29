/**
 * Double-submit CSRF cookie, independent of Yuvomi's own CSRF token
 * (MODULES.md: "Yuvomi's CSRF token protects Yuvomi's endpoints, not a
 * module's"). Also requires Origin to match the public host.
 */
import crypto from 'node:crypto';

const COOKIE_NAME = 'receipt-tracker-csrf';
const HEADER_NAME = 'x-receipt-tracker-csrf';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';

export function issueCsrfCookie(req, res) {
  let token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.SESSION_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
  }
  return token;
}

export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  if (PUBLIC_ORIGIN && req.headers.origin && req.headers.origin !== PUBLIC_ORIGIN) {
    return res.status(403).json({ error: 'Origin mismatch.', code: 403 });
  }

  const cookieToken = req.cookies?.[COOKIE_NAME];
  const headerToken = req.headers[HEADER_NAME];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid CSRF token.', code: 403 });
  }
  next();
}

export { COOKIE_NAME, HEADER_NAME };
