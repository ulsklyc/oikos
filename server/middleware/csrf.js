/**
 * Modul: CSRF-Schutz (Double Submit Cookie Pattern)
 * Zweck: Schützt state-ändernde API-Endpunkte vor Cross-Site Request Forgery
 * Abhängigkeiten: node:crypto
 *
 * Funktionsweise:
 *   1. Beim ersten authentifizierten Request wird ein 32-Byte-Hex-Token in der Session gespeichert.
 *   2. Das Token wird als nicht-httpOnly-Cookie gesetzt (lesbar durch JavaScript).
 *   3. Das Frontend liest das Cookie und sendet es als X-CSRF-Token-Header.
 *   4. Der Server vergleicht Header und Session-Token per timingSafeEqual.
 *   5. GET/HEAD/OPTIONS sind ausgenommen (safe methods).
 */

'use strict';

const crypto = require('node:crypto');

const TOKEN_LENGTH = 32; // Bytes → 64 Hex-Zeichen

/**
 * Generiert einen kryptographisch sicheren CSRF-Token.
 * @returns {string} 64-stelliger Hex-String
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * CSRF-Middleware für authentifizierte API-Routen.
 * Muss NACH requireAuth eingebunden werden.
 */
function csrfMiddleware(req, res, next) {
  // Token generieren falls noch nicht vorhanden (erste Request nach Login)
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }

  // Cookie bei jedem Request erneuern (SameSite=Strict, nicht httpOnly → JS-lesbar)
  res.cookie('csrf-token', req.session.csrfToken, {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage (gleich wie Session)
  });

  // Safe Methods benötigen keine Validierung
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // CSRF-Token aus Header prüfen
  const headerToken   = req.headers['x-csrf-token'] ?? '';
  const sessionToken  = req.session.csrfToken;
  const expectedLen   = TOKEN_LENGTH * 2; // 64 Hex-Zeichen

  const tokenValid =
    headerToken.length === expectedLen &&
    sessionToken.length === expectedLen &&
    crypto.timingSafeEqual(
      Buffer.from(headerToken,  'hex'),
      Buffer.from(sessionToken, 'hex')
    );

  if (!tokenValid) {
    return res.status(403).json({ error: 'Ungültiges CSRF-Token.', code: 403 });
  }

  next();
}

module.exports = { csrfMiddleware, generateToken };
