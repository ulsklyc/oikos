/**
 * Modul: Authentifizierung (Auth)
 * Zweck: Login-Route, Session-Middleware, Auth-Guard für geschützte Routen
 * Abhängigkeiten: express, bcrypt, express-session, connect-sqlite3, server/db.js
 */

'use strict';

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const { generateToken } = require('./middleware/csrf');
const router = express.Router();

// --------------------------------------------------------
// Session-Store (SQLite)
// --------------------------------------------------------
const SQLiteStore = require('connect-sqlite3')(session);

const sessionStore = new SQLiteStore({
  db: 'sessions.db',
  dir: process.env.DB_PATH ? require('path').dirname(process.env.DB_PATH) : '.',
  ttl: 60 * 60 * 24 * 7, // 7 Tage in Sekunden
});

/**
 * Session-Middleware konfigurieren.
 * Wird in server/index.js eingebunden.
 */
const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'dev-secret-AENDERN-IN-PRODUKTION',
  resave: false,
  saveUninitialized: false,
  name: 'oikos.sid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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
        secure: process.env.NODE_ENV === 'production',
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
router.post('/logout', requireAuth, (req, res) => {
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
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, display_name, password, avatar_color = '#007AFF', role = 'member' } = req.body;

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Benutzername, Anzeigename und Passwort erforderlich.', code: 400 });
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
 * DELETE /api/v1/auth/users/:id
 * Admin only. Löscht ein Familienmitglied.
 * Response: { ok: true }
 */
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
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
