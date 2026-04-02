# Repository Hygiene Audit — Oikos

**Datum:** 2026-04-02
**Version:** 0.5.2 (Tag `v0.5.2`)
**Branch:** main (Commit `922c0b7`)

---

## Phase 1: Dead Files & Orphans

### 1.1 Verwaiste Dateien

| # | Datei | Status | Begründung | Empfehlung |
|---|-------|--------|------------|------------|
| 1 | `.worktrees/feature/` | Verwaist | Leeres Verzeichnis — Überrest eines abgeschlossenen Git-Worktree. Kein Inhalt. | **Löschen** (`rm -rf .worktrees/feature/`) |

**Keine verwaisten JS/CSS/HTML-Dateien gefunden.** Alle Module in `public/pages/`, `public/components/`, `public/styles/` und `server/routes/` sind korrekt referenziert:

- Alle CSS-Dateien in `public/styles/` sind in `public/index.html` verlinkt
- Alle Page-Module werden vom Router geladen
- Alle Web Components (`oikos-install-prompt`, `oikos-locale-picker`) sind referenziert
- `rrule-ui.js` wird von `calendar.js` und `tasks.js` importiert
- `public/utils/ux.js` wird von 7 Page-Modulen importiert
- `public/offline.html` ist im Service Worker als Offline-Fallback referenziert
- `lucide.min.js` wird in `index.html` geladen
- `sw-register.js` wird in `index.html` geladen

### 1.2 Superseded / Veraltete Dateien

| # | Datei | Status | Begründung | Empfehlung |
|---|-------|--------|------------|------------|
| — | — | — | Keine gefunden. | — |

Keine `.bak`, `.old`, `.tmp`-Dateien vorhanden. Sauber.

### 1.3 Dev Artifacts

| # | Datei | Status | Begründung | Empfehlung |
|---|-------|--------|------------|------------|
| 1 | `.env` | OK | Existiert lokal, **nicht** von Git getrackt, in `.gitignore` gelistet. | Kein Handlungsbedarf |
| 2 | `.claude/` | OK | In `.gitignore`, nicht getrackt. | Kein Handlungsbedarf |
| 3 | `.worktrees/` | OK | In `.gitignore`, nicht getrackt. Leeres `feature/`-Verzeichnis (s. 1.1). | Leeres Subdir löschen |
| 4 | `docs/superpowers/` | OK | In `.gitignore`, nicht getrackt. Enthält 7 Plandokumente (3076 Zeilen) lokal. | Kein Handlungsbedarf — `.gitignore` greift |

### 1.4 Prompt-Dateien

**Keine `prompt-*.md` Dateien im Repository gefunden.** Die `docs/superpowers/`-Pläne und Specs sind Claude-Code-interne Artefakte, korrekt über `.gitignore` ausgeschlossen.

### 1.5 Leere oder Stub-Dateien

| # | Datei | Status | Begründung | Empfehlung |
|---|-------|--------|------------|------------|
| — | — | — | Keine leeren oder Stub-Dateien gefunden. | — |

### 1.6 Sonderfall: Hilfs-/Script-Dateien

| # | Datei | Zeilen | Genutzt von | Empfehlung |
|---|-------|--------|-------------|------------|
| 1 | `server/db-schema-test.js` | 185 | Allen 7 Test-Dateien (`test-*.js`) | **Behalten** — aktiv genutzte Test-Infrastruktur |
| 2 | `scripts/seed-demo.js` | 343 | Manuell (CLI-Script für Screenshots) | **Behalten** — nützliches Dev-Tool |
| 3 | `test-browser-loader.mjs` | — | `package.json` test:modal-utils | **Behalten** — aktiv genutzt für Browser-API-Mocks |

---

## Phase 2: Vollständigkeit der Projektdateien

### 2.1 Muss vorhanden sein

| Datei | Status | Bewertung |
|-------|--------|-----------|
| `.gitignore` | ✅ Vorhanden & vollständig | 47 Zeilen. Deckt ab: node_modules, .env, SQLite DBs (*.db, *.db-shm, *.db-wal), Logs, OS-Dateien (.DS_Store, Thumbs.db), Build-Artefakte (dist/, .cache/, coverage/), Docker-Volume (data/), IDE (.vscode/, .idea/, *.swp), .claude/, .worktrees/, docs/superpowers/, *.txt (mit robots.txt Ausnahme). Sicherheitsnetz für Token-Dateien via `*.txt`-Glob. **CLAUDE.md** ist ebenfalls in .gitignore und nicht mehr getrackt (korrekt). |
| `LICENSE` | ✅ Vorhanden & korrekt | MIT License, Copyright 2026 ulsklyc. |
| `README.md` | ✅ Vorhanden & umfassend | Siehe Phase 2b für Detailaudit. |
| `CONTRIBUTING.md` | ✅ Vorhanden & vollständig | 252 Zeilen. Hard Constraints, Dev Setup, Projekt-Struktur, Workflow (6 Schritte), Conventional Commits mit Oikos-Scopes dokumentiert (tasks, shopping, meals, calendar, budget, notes, contacts, auth, db, ui, pwa), Code Conventions (General/Frontend/Backend/Testing), Changelog-Guide, Issue/PR-Anleitung, Security-Verweis. |
| `SECURITY.md` | ✅ Vorhanden & vollständig | Vulnerability Reporting via GitHub Private Advisories, Scope-Definition, Security-Features-Übersicht, Supported-Versions-Policy. |
| `CHANGELOG.md` | ⚠️ Vorhanden, kleiner Fehler | Keep a Changelog Format, retroaktive Versionierung ab 0.1.0 ✅. **Problem:** Compare-Links am Dateiende: `[Unreleased]` verweist auf `v0.5.1...HEAD` statt `v0.5.2...HEAD`. Außerdem fehlt der `[0.5.2]`-Compare-Link. |
| `CLAUDE.md` | ✅ Vorhanden & aktuell | Behavioral guide (109 Zeilen), nicht von Git getrackt (in .gitignore). Beschreibt Architektur, Konventionen, Security, DB, Deployment, Implementation Status. Keine Duplikation von SPEC.md. |
| `BACKLOG.md` | ✅ Vorhanden & aktuell | Enthält erledigte Features als Referenztabelle (BL-01 bis BL-10 mit Versionszuordnung). Aktiv keine offenen Einträge — korrekt für aktuellen Projektstand. |
| `docs/SPEC.md` | ✅ Vorhanden | Nicht im Detail geprüft (Umfang), aber von CLAUDE.md und README.md referenziert und zentral für alle Module. |
| `.dockerignore` | ⚠️ Vorhanden, kleiner Fehler | Sinnvolle Ausschlüsse. **Problem:** Referenziert `docs/social-preview.html` — diese Datei existiert nicht (nur `docs/social-preview.png` existiert). Harmlos (Ausschluss einer nicht-existenten Datei), aber irreführend. |
| `docker-compose.yml` | ✅ Vorhanden | Nicht im Detail geprüft, aber vorhanden und funktional laut README/CHANGELOG. |
| `Dockerfile` | ✅ Vorhanden | Nicht im Detail geprüft, vorhanden. |
| `.github/ISSUE_TEMPLATE/bug_report.md` | ✅ Vorhanden & vollständig | Gutes Template mit Description, Steps to Reproduce, Expected/Actual Behavior, Environment, Logs (collapsible), Additional Context. |
| `.github/ISSUE_TEMPLATE/feature_request.md` | ✅ Vorhanden & vollständig | Problem/Solution/Alternatives-Struktur, Scope-Checkboxen pro Modul, Constraints-Check (vanilla JS, no build step, no frontend deps). |
| `.github/PULL_REQUEST_TEMPLATE.md` | ✅ Vorhanden & vollständig | Summary, Changes, Checklist (tests, conventions, no deps, i18n, changelog). |

### 2.2 Sollte vorhanden sein

| Datei | Status | Bewertung |
|-------|--------|-----------|
| `docs/` Verzeichnis | ✅ Vorhanden | Enthält SPEC.md, logo.svg, social-preview.png, Screenshots (4 Varianten × 9 Module = 36 Screenshots). |
| `manifest.json` | ✅ Vorhanden | `public/manifest.json` — PWA-Manifest. |
| Service Worker | ✅ Vorhanden | `public/sw.js` + `public/sw-register.js`. |
| `.nvmrc` | ✅ Vorhanden | Inhalt: `22`. Konsistent mit `engines.node: ">=22.0.0"` in package.json. |
| `.env.example` | ✅ Vorhanden & vollständig | 39 Zeilen. Alle dokumentierten Env-Vars abgedeckt: PORT, NODE_ENV, SESSION_SECRET, SESSION_SECURE, DB_PATH, DB_ENCRYPTION_KEY, OpenWeather, Google Calendar, Apple CalDAV, Sync-Intervall, Rate-Limiting. |
| `nginx.conf.example` | ✅ Vorhanden | Referenziert in README. |
| `.github/workflows/ci.yml` | ✅ Vorhanden & sinnvoll | Matrix: Node 22.x + 24.x, `permissions: contents: read` (Least Privilege), actions/checkout@v4, npm ci, npm test. |

### 2.3 Sonstiges

| Element | Status | Bewertung |
|---------|--------|-----------|
| Git Tags | ✅ Konsistent | v0.1.0 bis v0.5.2 — alle CHANGELOG-Versionen haben entsprechende Tags. |
| `scripts/` | ✅ Sinnvoll | `generate-icons.js` (Dev-Tool) und `seed-demo.js` (Screenshot-Generierung). Beide in `.dockerignore` exkludiert. |
| `entrypoint.sh` | ✅ Vorhanden | Docker-Entrypoint. |
| `setup.js` | ✅ Vorhanden | Admin-Setup-Wizard, in README dokumentiert. |

---

## Phase 2b: README-Audit

| Kriterium | Status | Bewertung |
|-----------|--------|-----------|
| Projektname und Kurzbeschreibung | ✅ Vorhanden | Logo + "Oikos" + "The self-hosted family planner that respects your privacy." — klar und prägnant. |
| Badges | ✅ Vorhanden | 7 Badges: Release, License, Node.js, Docker, SQLCipher, PWA, i18n. flat-square Style. |
| Screenshots/Demo | ✅ Vorhanden & hervorragend | 9 Mobile-Screens (dark/light auto-switch via `<picture>`), 8 Tablet-Screens in collapsible Section. Alle 4 Varianten (mobile-dark, mobile-light, tablet-dark, tablet-light). |
| Features-Übersicht | ✅ Vorhanden | 8 Module in 2-Spalten-Tabelle + "And also"-Absatz mit Querschnittsfunktionen. |
| Tech Stack | ✅ Vorhanden | Badges + Detailtabelle (Server, Database, Frontend, Auth, Deployment, Integrations). |
| Voraussetzungen | ✅ Vorhanden | Docker + Docker Compose. Node.js-Version im Badge und Development-Section. |
| Installation/Setup | ✅ Vorhanden | 5-Schritt Quick Start (clone, configure, start, setup admin, open). Klar und Copy-Paste-fähig. |
| Konfiguration (.env) | ✅ Vorhanden | Collapsible "Configuration" Section mit Required/Optional/Weather/Integrations Tabellen. Verweis auf `.env.example`. |
| Nutzung (erster Login) | ✅ Vorhanden | Admin-Account-Erstellung, Family Members via Settings erklärt. |
| Architektur-Überblick | ✅ Vorhanden | In collapsible "Development" Section mit Verzeichnisbaum und Request-Flow-Beschreibung. |
| API-Dokumentation | ✅ Vorhanden | Eigene "API" Section mit Verweis auf `docs/SPEC.md` und `server/routes/`. |
| Contributing-Verweis | ✅ Vorhanden | Link auf CONTRIBUTING.md. |
| Security-Verweis | ✅ Vorhanden | Eigene "Security" Section mit Feature-Tabelle. |
| License-Verweis | ✅ Vorhanden | "MIT © 2026 ulsklyc" mit Link. |
| Roadmap / BACKLOG-Verweis | ✅ Vorhanden | Eigene "Roadmap" Section mit Link auf BACKLOG.md und Feature-Request-Issue-Template. |
| Backup & Restore | ✅ Vorhanden | Collapsible Section mit Docker-Volume Backup/Restore-Befehlen. |
| Updates | ✅ Vorhanden | Collapsible Section mit `git pull && docker compose up -d --build`. |
| Calendar Sync Setup | ✅ Vorhanden | Collapsible Section mit Google + Apple Setup-Anleitungen. |

**Gesamtbewertung README:** Vollständig und professionell. Keine fehlenden Sektionen. Gute Nutzung von collapsible Sections für Detailtiefe ohne die Hauptseite zu überladen.

---

## Phase 3: Priorisierte Aufgabenliste

### [P2] CHANGELOG.md Compare-Links korrigieren

- **Was**: Die Referenz-Links am Ende von CHANGELOG.md sind inkonsistent:
  - `[Unreleased]` verweist auf `v0.5.1...HEAD` → sollte `v0.5.2...HEAD` sein
  - `[0.5.2]`-Link fehlt komplett → `v0.5.1...v0.5.2` ergänzen
- **Warum**: GitHub-Links in der gerenderten CHANGELOG zeigen falschen Diff für Unreleased-Änderungen. Besucher sehen v0.5.2-Änderungen im Unreleased-Diff statt nur echte Unreleased-Änderungen.
- **Aufwand**: 5 Minuten
- **Dateien**: `CHANGELOG.md` (Zeilen 139–147)

### [P2] .dockerignore — Phantomreferenz entfernen

- **Was**: `.dockerignore` exkludiert `docs/social-preview.html`, aber diese Datei existiert nicht (nur `docs/social-preview.png` existiert).
- **Warum**: Irreführend bei Code-Review oder Wartung. Kein funktionaler Impact.
- **Aufwand**: 5 Minuten
- **Dateien**: `.dockerignore` (Zeile mit `docs/social-preview.html`)

### [P3] Leeres Worktree-Verzeichnis aufräumen

- **Was**: `.worktrees/feature/` ist ein leeres Verzeichnis, Überrest eines abgeschlossenen Git-Worktree.
- **Warum**: Kein funktionaler Impact (in .gitignore), aber unnötiger Eintrag im lokalen Dateisystem.
- **Aufwand**: 1 Minute
- **Dateien**: `.worktrees/feature/`

---

## Zusammenfassung

| Kategorie | Ergebnis |
|-----------|----------|
| **Verwaiste Dateien** | 1 Fund (leeres Worktree-Dir) — P3 |
| **Superseded Files** | 0 Funde |
| **Dev Artifacts** | Korrekt durch .gitignore abgedeckt |
| **Prompt-Dateien** | Keine im Repo |
| **Leere Dateien** | 0 Funde |
| **Projektdateien** | 2 Minor-Issues (CHANGELOG-Links, .dockerignore Phantom) — P2 |
| **README** | Vollständig, keine Lücken |
| **P0-Findings** | 0 |
| **P1-Findings** | 0 |
| **P2-Findings** | 2 |
| **P3-Findings** | 1 |

**Gesamtbewertung: Das Repository ist in sehr gutem Zustand.** Alle essenziellen Projektdateien sind vorhanden und inhaltlich vollständig. Die .gitignore ist gut durchdacht. Die README ist professionell und deckt alle relevanten Aspekte ab. Die drei gefundenen Issues sind Minor/Kosmetik-Korrekturen ohne funktionalen Impact.
