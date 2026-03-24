/**
 * Modul: Server Entry Point
 * Zweck: Express-App initialisieren, Middleware einbinden, Routen registrieren
 * Abhängigkeiten: express, helmet, dotenv, server/db.js, server/auth.js, server/routes/*
 */

'use strict';

require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const db         = require('./db');
const { router: authRouter, sessionMiddleware, requireAuth } = require('./auth');
const { csrfMiddleware } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------------------------------------------
// Datenbank initialisieren
// --------------------------------------------------------
db.init();

// --------------------------------------------------------
// Security-Middleware
// --------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        // Alpine.js CDN
        'https://cdn.jsdelivr.net',
        // Lucide Icons CDN
        'https://unpkg.com',
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://openweathermap.org'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// Trust Proxy für korrekte IP hinter Nginx
app.set('trust proxy', 1);

// --------------------------------------------------------
// Request-Parsing
// --------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// --------------------------------------------------------
// Sessions
// --------------------------------------------------------
app.use(sessionMiddleware);

// --------------------------------------------------------
// Statische Dateien (Frontend)
// --------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true,
}));

// --------------------------------------------------------
// Globaler API-Rate-Limiter (Schritt 29)
// Verhindert Brute-Force und DoS auf allen API-Endpunkten.
// Login hat einen eigenen, strengeren Limiter (auth.js).
// --------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 60_000,         // 1 Minute
  max: 300,                 // 300 Requests/Minute pro IP (großzügig für Familien-App)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte warte kurz.', code: 429 },
  skip: (req) => req.path === '/health', // Health-Check ausgenommen
});
app.use('/api/', apiLimiter);

// --------------------------------------------------------
// API-Routen
// --------------------------------------------------------
app.use('/api/v1/auth', authRouter);

// Alle weiteren API-Routen erfordern Authentifizierung + CSRF-Schutz
app.use('/api/v1', requireAuth);
app.use('/api/v1', csrfMiddleware);
app.use('/api/v1/dashboard', require('./routes/dashboard'));
app.use('/api/v1/tasks', require('./routes/tasks'));
app.use('/api/v1/shopping', require('./routes/shopping'));
app.use('/api/v1/meals', require('./routes/meals'));
app.use('/api/v1/calendar', require('./routes/calendar'));
app.use('/api/v1/notes', require('./routes/notes'));
app.use('/api/v1/contacts', require('./routes/contacts'));
app.use('/api/v1/budget', require('./routes/budget'));
app.use('/api/v1/weather', require('./routes/weather'));

// --------------------------------------------------------
// Health-Check (für Docker)
// --------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --------------------------------------------------------
// SPA Fallback: Alle nicht-API-Routen → index.html
// --------------------------------------------------------
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --------------------------------------------------------
// Globaler Error-Handler
// --------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error('[Server] Unbehandelter Fehler:', err);
  res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
});

// --------------------------------------------------------
// Server starten
// --------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[Oikos] Server läuft auf Port ${PORT}`);
  console.log(`[Oikos] Umgebung: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
