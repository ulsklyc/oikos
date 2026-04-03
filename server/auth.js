/**
 * Modul: Authentifizierung (Auth)
 * Zweck: Login-Route, Session-Middleware, Auth-Guard für geschützte Routen
 * Abhängigkeiten: express, bcrypt, express-session, server/db.js
 */

'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const { generateToken, csrfMiddleware } = require('./middleware/csrf');
const router = express.Router();

// --------------------------------------------------------
// Session-Store (better-sqlite3, gleiche DB-Instanz wie App)
// Eigene Implementierung — kein connect-sqlite3 (nutzt sqlite3-Bindings,
// die separat kompiliert werden müssten und die Fehlerquelle waren).
// --------------------------------------------------------
class BetterSQLiteStore extends session.Store {
  constructor() {
    super();
    // Tabelle anlegen falls nicht vorhanden
    db.get().exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid        TEXT PRIMARY KEY,
        sess       TEXT NOT NULL,
        expired_at INTEGER NOT NULL
      )
    `);
    // Abgelaufene Sessions regelmäßig aufräumen (alle 15 Minuten)
    setInterval(() => {
      db.get().prepare('DELETE FROM sessions WHERE expired_at <= ?').run(Date.now());
    }, 15 * 60_000).unref();
  }

  get(sid, callback) {
    try {
      const row = db.get()
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?')
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + ttl;
      db.get()
        .prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sess), expiredAt);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + ttl;
      db.get()
        .prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?')
        .run(expiredAt, sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

const sessionStore = new BetterSQLiteStore();

/**
 * Session-Middleware konfigurieren.
 * Wird in server/index.js eingebunden.
 */
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('[Auth] SESSION_SECRET muss in der .env gesetzt sein (Produktion).');
}

const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'dev-only-secret-not-for-production',
  resave: false,
  saveUninitialized: false,
  name: 'oikos.sid',
  cookie: {
    httpOnly: true,
    // secure=true by default; set SESSION_SECURE=false in .env to allow HTTP (local dev without reverse proxy)
    secure: process.env.SESSION_SECURE !== 'false',
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 Tage in ms
  },
});

// --------------------------------------------------------
// Rate Limiting für Login
// --------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Login-Versuche. Bitte warte kurz.', code: 429 },
});

// --------------------------------------------------------
// Auth-Guard Middleware
// --------------------------------------------------------

/**
 * Prüft ob der Request authentifiziert ist.
 * Schützt alle API-Routen außer /auth/login.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Nicht authentifiziert.', code: 401 });
}

/**
 * Prüft ob der authentifizierte User Admin-Rolle hat.
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Keine Berechtigung.', code: 403 });
}

// --------------------------------------------------------
// Routen
// --------------------------------------------------------

/**
 * POST /api/v1/auth/login
 * Body: { username: string, password: string }
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Benutzername und Passwort erforderlich.', code: 400 });
    }

    if (username.length > 64 || password.length > 1024) {
      return res.status(400).json({ error: 'Eingabe zu lang.', code: 400 });
    }

    const user = db.get().prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      // Timing-Attack-Schutz: trotzdem bcrypt ausführen
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection000000000000000000000');
      return res.status(401).json({ error: 'Ungültige Anmeldedaten.', code: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten.', code: 401 });
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('[Auth] Session-Regenerierung fehlgeschlagen:', err);
        return res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
      }

      req.session.userId    = user.id;
      req.session.role      = user.role;
      req.session.csrfToken = generateToken();

      // CSRF-Token als Cookie setzen (nicht httpOnly → lesbar für JS)
      res.cookie('csrf-token', req.session.csrfToken, {
        httpOnly: false,
        sameSite: 'strict',
        secure: process.env.SESSION_SECURE !== 'false',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      res.json({
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          avatar_color: user.avatar_color,
          role: user.role,
        },
      });
    });
  } catch (err) {
    console.error('[Auth] Login-Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/logout
 * Response: { ok: true }
 */
router.post('/logout', requireAuth, csrfMiddleware, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout-Fehler:', err);
      return res.status(500).json({ error: 'Logout fehlgeschlagen.', code: 500 });
    }
    res.clearCookie('oikos.sid');
    res.json({ ok: true });
  });
});

/**
 * GET /api/v1/auth/me
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.get()
      .prepare('SELECT id, username, display_name, avatar_color, role FROM users WHERE id = ?')
      .get(req.session.userId);

    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Benutzer nicht gefunden.', code: 401 });
    }

    res.json({ user });
  } catch (err) {
    console.error('[Auth] /me Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

/**
 * GET /api/v1/auth/users
 * Admin only. Listet alle Familienmitglieder.
 * Response: { data: User[] }
 */
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.get()
      .prepare('SELECT id, username, display_name, avatar_color, role, created_at FROM users ORDER BY display_name')
      .all();
    res.json({ data: users });
  } catch (err) {
    console.error('[Auth] Users-Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/users
 * Admin only. Erstellt neues Familienmitglied.
 * Body: { username, display_name, password, avatar_color?, role? }
 * Response: { user: { id, username, display_name, avatar_color, role } }
 */
router.post('/users', requireAuth, requireAdmin, csrfMiddleware, async (req, res) => {
  try {
    const { username, display_name, password, avatar_color = '#007AFF', role = 'member' } = req.body;

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Benutzername, Anzeigename und Passwort erforderlich.', code: 400 });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben.', code: 400 });
    }

    if (username.length > 64) {
      return res.status(400).json({ error: 'Benutzername darf maximal 64 Zeichen lang sein.', code: 400 });
    }

    if (display_name.length > 128) {
      return res.status(400).json({ error: 'Anzeigename darf maximal 128 Zeichen lang sein.', code: 400 });
    }

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Ungültige Rolle.', code: 400 });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = db.get()
      .prepare(`
        INSERT INTO users (username, display_name, password_hash, avatar_color, role)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(username, display_name, hash, avatar_color, role);

    res.status(201).json({
      user: { id: result.lastInsertRowid, username, display_name, avatar_color, role },
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben.', code: 409 });
    }
    console.error('[Auth] User-Erstellen-Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

/**
 * PATCH /api/v1/auth/me/password
 * Ändert das eigene Passwort.
 * Body: { current_password: string, new_password: string }
 * Response: { ok: true }
 */
router.patch('/me/password', requireAuth, csrfMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich.', code: 400 });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben.', code: 400 });
    }

    const user = db.get().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.', code: 404 });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Aktuelles Passwort falsch.', code: 401 });

    const hash = await bcrypt.hash(new_password, 12);
    db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);

    // Alle anderen Sessions dieses Users invalidieren (aktuelle behalten)
    const currentSid = req.sessionID;
    const allSessions = db.get().prepare('SELECT sid, sess FROM sessions').all();
    for (const row of allSessions) {
      if (row.sid === currentSid) continue;
      try {
        const sess = JSON.parse(row.sess);
        if (sess.userId === req.session.userId) {
          db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(row.sid);
        }
      } catch { /* ignore malformed session */ }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] Passwort-Ändern-Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

/**
 * DELETE /api/v1/auth/users/:id
 * Admin only. Löscht ein Familienmitglied.
 * Response: { ok: true }
 */
router.delete('/users/:id', requireAuth, requireAdmin, csrfMiddleware, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    if (userId === req.session.userId) {
      return res.status(400).json({ error: 'Eigenes Konto kann nicht gelöscht werden.', code: 400 });
    }

    const result = db.get().prepare('DELETE FROM users WHERE id = ?').run(userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.', code: 404 });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] User-Löschen-Fehler:', err);
    res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
  }
});

module.exports = { router, sessionMiddleware, requireAuth, requireAdmin };
