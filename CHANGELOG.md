# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.7] - 2026-04-03

### Fixed
- Fix recurring calendar events not expanding - RRULE parser now strips the `RRULE:` prefix used by ICS/CalDAV, which previously caused all recurrence rules to be silently ignored
- Fix recurring multi-day events not appearing when their start date falls before the view window but the event spans into it
- Fix all-day recurring event instances getting datetime end values instead of date-only format
- Add YEARLY recurrence frequency support for birthday and anniversary events

## [0.5.6] - 2026-04-03

### Fixed
- Fix all-day calendar events appearing on the correct day and the following day - ICS DTEND for DATE values is exclusive per RFC 5545, now correctly adjusted (fixes #5)
- Fix multi-day events not showing when using DURATION instead of DTEND - add ICS DURATION property support in CalDAV parser
- Fix birthdays from Apple Calendar not syncing - birthday calendars are no longer excluded from sync
- Fix outbound ICS builder using inclusive DTEND for all-day events - now correctly emits exclusive DTEND per RFC 5545

## [0.5.5] - 2026-04-03

### Fixed
- Fix iCloud Calendar sync failing with FOREIGN KEY constraint error - `created_by` was hardcoded to user ID 1 instead of resolving dynamically (fixes #4)
- Sync all iCloud calendars instead of only the first one - previously only a single calendar was imported, ignoring Family, subscribed, and other calendars
- Add missing `cfgDel` helper function used by `clearCredentials` - disconnecting Apple Calendar would crash
- Skip unreachable or broken calendars gracefully instead of aborting the entire sync

## [0.5.4] - 2026-04-03

### Fixed
- Fix SQLCipher PRAGMA key syntax error on fresh install - hex-encoded key must be wrapped in double quotes for valid PRAGMA syntax (fixes #3)

## [0.5.3] - 2026-04-03

### Security
- Fix SQLCipher PRAGMA key interpolation - encryption keys containing single quotes no longer crash on startup; key is now hex-encoded
- Enforce minimum password length (8 characters) when admin creates new users - previously any 1-character password was accepted
- Add length bounds on username (64 chars) and display_name (128 chars) to prevent unbounded input
- Add input length bounds on login (username 64 chars, password 1024 chars)
- Invalidate all other sessions when a user changes their password - previously active sessions survived password reset
- Session and CSRF cookies now have `secure: true` by default; HTTP is only allowed when `SESSION_SECURE=false` is explicitly set in `.env` - previously cookies were sent without `Secure` flag in non-production environments
- Document authorization model in SECURITY.md - clarify that all family members share read/write access to all data by design

### Changed
- Use multi-stage Docker build to exclude build tools (python3, make, g++) from runtime image
- Exclude `docs/` directory from Docker image via `.dockerignore`
- Consolidate `dotenv.config()` to single call in `server/index.js` - remove duplicate calls from `server/db.js` and `server/auth.js`

## [0.5.2] - 2026-04-01

### Security
- Add rate limiting to SPA fallback route to prevent file system hammering via unauthenticated wildcard requests
- Add CSRF protection to auth routes that change state (logout, create user, change password, delete user) - previously bypassed global CSRF middleware due to router registration order
- Fix incomplete vCard escaping in contacts export - backslash characters are now escaped first before other special characters (`,`, `;`, newline), preventing injection via contact fields
- Restrict CI workflow GITHUB_TOKEN to `contents: read` (principle of least privilege)

## [0.5.1] - 2026-04-01

### Fixed
- Meals: fixed crash when dragging a meal slot - `dragging` state is now destructured before `cleanup()` runs, preventing a null-reference error on drop
- i18n: `t()` now resolves dot-notation keys against nested locale JSON objects (e.g. `t('nav.tasks')` correctly returns `"Aufgaben"` instead of the raw key string); affects all pages, components, and navigation
- PWA: replaced placeholder "O" icons with the actual Oikos house logo across all icon variants (192, 512, maskable 192, maskable 512, apple-touch-icon, favicon); maskable variants use full-bleed background with logo within the 80% safe zone - fixes Android home screen showing only a blue circle
- PWA: weather widget icons (OpenWeatherMap) now render correctly in installed PWA on Android; service worker no longer intercepts cross-origin image requests (opaque responses caused silent rendering failures in standalone mode)
- Settings: language selector replaced from cramped radio buttons to a native `<select>` dropdown using the standard `form-input` style

### Changed
- PWA manifest: added `id` field and `display_override` array for reliable Chrome Android PWA recognition; `manifest.json` is now served with `Content-Type: application/manifest+json`
- Service worker (v22): `/i18n.js` and locale files added to app-shell cache; cross-origin asset requests excluded from cache-first strategy

## [0.5.0] - 2026-03-31

### Added
- i18n: full internationalisation system (`public/i18n.js`) with German (de) and English (en) support; language auto-detected from `navigator.language`, overridable via Settings
- i18n: all user-facing strings moved to locale files (`public/locales/de.json`, `public/locales/en.json`); 489 translation keys covering all modules
- i18n: locale switch without page reload - all pages, components and navigation re-render via `locale-changed` custom event
- i18n: `oikos-locale-picker` Web Component in Settings - three options: System (follows browser language), Deutsch, English
- i18n: dates and times formatted with `Intl.DateTimeFormat` using the active locale; `formatDate()` and `formatTime()` exported from `i18n.js`
- i18n: fallback chain (active locale → German → key) ensures no untranslated keys are shown even if a future locale file is incomplete
- i18n: adding a new language requires only one JSON file (`public/locales/xx.json`) and one line in `SUPPORTED_LOCALES`

## [0.4.0] - 2026-03-31

### Fixed
- Mobile: toast notifications no longer overlap with the bottom navigation bar - introduced `--nav-bottom-height` token (scroll area 56px + dots indicator 12px) used consistently by toast container and app content padding
- Mobile: FAB and page-FAB are now hidden when the virtual keyboard is open, preventing them from covering form inputs; detection uses `visualViewport.resize` with a 75% height threshold
- UI: added missing dark-mode colour overrides for shopping, notes, contacts, budget, and settings module tokens - accent stripes now render at readable pastel values in dark theme
- UI: meals week-navigation bar now shows module accent top-border stripe; settings page now declares --module-accent for consistency with all other modules

### Added
- Shopping: swipe-left to toggle checked/unchecked, swipe-right to delete items on mobile; × delete button hidden on mobile in favour of swipe gesture
- Notes: client-side full-text search bar in toolbar - filters by title and content instantly; shows "Keine Treffer" empty state when no match
- Dashboard: weather widget refresh button (top-right corner) + automatic 30-minute refresh interval; interval is cleared when navigating away
- Contacts: vCard export button per contact (downloads .vcf file); vCard import via file input in toolbar (parses FN, TEL, EMAIL, ADR, NOTE, CATEGORIES fields)
- PWA: offline fallback page (`/offline.html`) served by service worker when network is unavailable and index.html is not cached; page includes a reload button
- UI: module accent colours now applied to three visual layers - active nav tab (bottom bar + sidebar), toolbar top-border stripe, and list/card left-border stripe - giving each module a distinct colour identity

## [0.3.0] - 2026-03-31

### Added
- Calendar: recurring events are now expanded in GET /api/v1/calendar - all occurrences within the requested date window are returned as virtual instances; duration is preserved; instances are marked with is_recurring_instance=1 and shown with a ↻ icon in the agenda view; /upcoming also expands recurring events within a 90-day window
- Budget: recurring entries auto-generate instances for each viewed month; instances deleted by the user are skipped permanently via `budget_recurrence_skipped` table; generated instances are marked with ↩ in the transaction list
- Budget: month-over-month comparison in summary cards - each card (Einnahmen, Ausgaben, Saldo) shows a trend line (▲/▼ + delta amount vs. previous month); previous month summary is fetched in parallel with current month
- Meals: drag & drop between slots and days using Pointer Events (touch + mouse); ghost element follows pointer; drop on occupied slot swaps meals; reduced-motion: no ghost animation, interaction still works
- Settings: Apple CalDAV credentials form (URL, Apple-ID, app-specific password) with live connection test; admin can connect and disconnect via UI without restarting the server; DB-stored credentials take precedence over .env vars; auto-sync runs every 15 min (configurable via SYNC_INTERVAL_MINUTES)

## [0.2.1] - 2026-03-30

### Fixed
- Accumulating click listeners on `#notes-grid`: listener is now registered once in `render()` via event delegation instead of re-registered in every `renderGrid()` call
- Accumulating anonymous `document` click listener in dashboard FAB: `initFab()` now accepts an AbortSignal; `render()` aborts the previous signal before creating a new one, eliminating listener leaks across navigation cycles
- Add `btnError()` shake feedback to notes.js save error handler for consistency with other modules
- Calendar event popup `closePopup` listener now checks `popup.isConnected` to self-remove correctly after navigation without a click

### Added
- CSS alias `.form-label` alongside `.label` to cover usage in `notes.js` and `settings.js` without requiring a mass-rename
- Tests for `wireBlurValidation`, `btnSuccess`, and `btnError` (12 cases) in `test-modal-utils.js`

## [0.2.0] - 2026-03-30

### Changed
- Directional slide-x page transitions (forward = right, backward = left) with race condition guard
- PWA install prompt delayed until 2 user interactions; dismiss window reduced from 30 to 7 days; interaction counter resets on dismiss
- Unified card padding to 16px (`--space-4`) across tasks, contacts, budget, and meals modules

### Added
- Staggered fade-in animation for list items on page load across all modules (tasks, shopping, meals, contacts, budget, notes, calendar agenda)
- Unified empty states using shared `.empty-state` class across all modules (replaces per-module CSS)
- `stagger()` and `vibrate()` UX utilities in `public/utils/ux.js` with full test coverage
- Proportional opacity on swipe-reveal action areas in tasks (already implemented, confirmed)
- FAB colors tied to per-module accent tokens via CSS custom properties
- `scrollIntoView` for focused inputs when virtual keyboard opens in modals (300ms delay)
- Consistent vibration feedback via `vibrate()` utility across tasks, shopping, contacts, budget, and notes
- Bottom sheet modal on mobile (< 768px) with drag handle, slide-in animation, and swipe-to-close
- Enter-key navigation between form fields in modals; Enter on last field triggers submit
- Blur-triggered inline validation for required fields with error/success border states
- `wireBlurValidation()`, `btnSuccess()`, and `btnError()` exported from `modal.js`
- Submit button checkmark-success (700ms) and shake-error feedback animations

## [0.1.0] - 2026-03-29

Initial release of Oikos - a self-hosted family planner for 2–6 person households. Runs as a Docker container behind Nginx with SSL, no cloud dependency.

### Added

- **Dashboard** with time-of-day greeting, urgent tasks, upcoming events, today's meals, pinned notes, and weather widget (OpenWeatherMap integration with 3–5 day forecast scaling by screen size)
- **Task management** with categories, priorities, due dates, subtasks (max 2 levels), list and Kanban views, swipe gestures on mobile (swipe left = toggle done, swipe right = edit), and recurring tasks via iCal RRULE
- **Shopping lists** with multiple named lists, supermarket-aisle sorting, autocomplete from history, optimistic checkbox toggle, and bulk-clear of checked items
- **Weekly meal planner** with breakfast/lunch/dinner/snack grid (Mon–Sun), ingredient tracking per meal, and one-click transfer of ingredients to shopping lists
- **Calendar** with month, week, day, and agenda views, multi-day event support, color-coded entries, and family member assignment
- **Google Calendar sync** via OAuth 2.0 with incremental sync tokens and **Apple CalDAV sync** via tsdav, both bidirectional
- **Pinboard** (notes) with color-coded sticky notes, pin-to-top, Markdown formatting toolbar (bold, italic, lists, headings, code, links), and automatic text contrast based on background color
- **Contacts** directory with category filtering (doctor, emergency, trades, etc.), full-text search, and direct tel:/mailto:/maps: links
- **Budget tracker** with income/expense logging, monthly navigation, category breakdown bar charts (pure CSS), and CSV export
- **Settings page** for password change, calendar sync status, and family member management
- **Authentication** with session-based login (bcrypt, httpOnly/secure/sameSite cookies, 7-day TTL), admin-only user creation, and rate-limited login (5 attempts/min with 15-min lockout)
- **CSRF protection** using Double Submit Cookie pattern with timing-safe comparison
- **Progressive Web App** with app-shell caching (service worker with stale-while-revalidate for static assets, network-first for navigation, network-only for API), custom install prompt for Android and iOS, dynamic theme-color per module, safe area inset handling, and offline fallback
- **Responsive design** with mobile bottom navigation (swipeable pages with dot indicator), collapsible sidebar on tablet, and full sidebar on desktop
- **Dark mode** with system preference detection and manual toggle, warm-tinted neutral color scale
- **Design system** with CSS custom properties (tokens for colors, spacing, typography, shadows, radii, z-indices), module-specific accent colors, and consistent component patterns
- **Accessibility** improvements: skip link, sr-only headings on all pages, aria-hidden decorative icons, aria-label on icon-only buttons, token-based touch targets (44–48px), 12px minimum font size, and prefers-reduced-motion support
- **Docker deployment** with docker-compose, optional SQLCipher encryption (AES-256), and nginx.conf example
- **Setup script** (`node setup.js`) for initial admin account creation with LAN-reachable URL display
- **Input validation** middleware with centralized rules (string length, date/time format, enum, color) across all API routes
- **Content Security Policy** via Helmet with strict CSP, self-hosted Lucide Icons (no CDN at runtime)
- **Lazy loading** with per-page ES module imports cached in memory, Cache-Control headers (immutable for assets, must-revalidate for code), and service worker update notification

### Security

- Fail-fast on missing `SESSION_SECRET` in production
- Rate limiting on login endpoint and global API limiter (300 req/min/IP)
- No user data cached by service worker (API requests are network-only)
- Hardened `.gitignore` and `.dockerignore` to prevent accidental secret or binary leakage

[Unreleased]: https://github.com/ulsklyc/oikos/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/ulsklyc/oikos/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ulsklyc/oikos/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ulsklyc/oikos/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ulsklyc/oikos/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ulsklyc/oikos/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/ulsklyc/oikos/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ulsklyc/oikos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ulsklyc/oikos/releases/tag/v0.1.0
