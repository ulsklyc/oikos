# Oikos - Product Specification

Self-hosted family planner web app for a single household (2–6 people). No app store, no public access. Deployment via Docker on a private Linux server behind an Nginx reverse proxy with SSL.

---

## Data Model

Every table: `id INTEGER PRIMARY KEY`, `created_at TEXT`, `updated_at TEXT` (ISO 8601).

### Users
| Column | Type | Constraint |
|--------|------|-----------|
| username | TEXT | UNIQUE NOT NULL |
| display_name | TEXT | |
| password_hash | TEXT | bcrypt |
| avatar_color | TEXT | HEX color code |
| role | TEXT | 'admin' or 'member' |

### Tasks
| Column | Type | Constraint |
|--------|------|-----------|
| title | TEXT | NOT NULL |
| description | TEXT | |
| category | TEXT | Household, School, Shopping, Repairs, Other |
| priority | TEXT | none (default), low, medium, high, urgent |
| status | TEXT | open, in_progress, done |
| due_date | TEXT | DATE, nullable |
| due_time | TEXT | TIME, nullable |
| assigned_to | INTEGER | FK → Users |
| created_by | INTEGER | FK → Users, NOT NULL |
| is_recurring | INTEGER | 0/1 |
| recurrence_rule | TEXT | iCal RRULE |
| parent_task_id | INTEGER | FK → Tasks (max 2 levels) |

### Shopping Lists
| Column | Type | Constraint |
|--------|------|-----------|
| name | TEXT | NOT NULL (e.g. "Supermarket", "Hardware store") |

### Shopping Items
| Column | Type | Constraint |
|--------|------|-----------|
| list_id | INTEGER | FK → Shopping Lists, NOT NULL |
| name | TEXT | NOT NULL |
| quantity | TEXT | e.g. "500g", "2 pieces" |
| category | TEXT | Fruit & Vegetables, Dairy, Meat & Fish, Bakery, Drinks, Frozen, Household, Drugstore, Other |
| is_checked | INTEGER | 0/1 |
| added_from_meal | INTEGER | FK → Meals, nullable |

### Meals
| Column | Type | Constraint |
|--------|------|-----------|
| date | TEXT | DATE, NOT NULL |
| meal_type | TEXT | breakfast, lunch, dinner, snack |
| title | TEXT | NOT NULL |
| notes | TEXT | |
| created_by | INTEGER | FK → Users, NOT NULL |

### Meal Ingredients
| Column | Type | Constraint |
|--------|------|-----------|
| meal_id | INTEGER | FK → Meals, NOT NULL |
| name | TEXT | NOT NULL |
| quantity | TEXT | |
| on_shopping_list | INTEGER | 0/1 |

### Calendar Events
| Column | Type | Constraint |
|--------|------|-----------|
| title | TEXT | NOT NULL |
| description | TEXT | |
| start_datetime | TEXT | DATETIME, NOT NULL |
| end_datetime | TEXT | DATETIME |
| all_day | INTEGER | 0/1 |
| location | TEXT | |
| color | TEXT | HEX |
| assigned_to | INTEGER | FK → Users |
| created_by | INTEGER | FK → Users, NOT NULL |
| external_calendar_id | TEXT | ID from external calendar |
| external_source | TEXT | local, google, apple |
| recurrence_rule | TEXT | iCal RRULE |

### Notes
| Column | Type | Constraint |
|--------|------|-----------|
| title | TEXT | nullable |
| content | TEXT | NOT NULL |
| color | TEXT | HEX |
| pinned | INTEGER | 0/1 |
| created_by | INTEGER | FK → Users, NOT NULL |

### Contacts
| Column | Type | Constraint |
|--------|------|-----------|
| name | TEXT | NOT NULL |
| category | TEXT | Doctor, School/Nursery, Authority, Insurance, Tradesperson, Emergency, Other |
| phone | TEXT | |
| email | TEXT | |
| address | TEXT | |
| notes | TEXT | |

### Budget Entries
| Column | Type | Constraint |
|--------|------|-----------|
| title | TEXT | NOT NULL |
| amount | REAL | NOT NULL (positive = income, negative = expense) |
| category | TEXT | Groceries, Rent, Insurance, Transport, Leisure, Clothing, Health, Education, Other |
| date | TEXT | DATE, NOT NULL |
| is_recurring | INTEGER | 0/1 |
| recurrence_rule | TEXT | iCal RRULE |
| recurrence_parent_id | INTEGER | FK → Budget Entries (generated instance points to original) |
| created_by | INTEGER | FK → Users, NOT NULL |

### Budget Recurrence Skipped
Stores instances of a recurring entry deleted by the user so they are not re-generated.

| Column | Type | Constraint |
|--------|------|-----------|
| parent_id | INTEGER | FK → Budget Entries, NOT NULL |
| month | TEXT | YYYY-MM, NOT NULL |
| PRIMARY KEY | | (parent_id, month) |

### Sync Config
Key-value table for OAuth tokens and CalDAV credentials.

| Column | Type | Constraint |
|--------|------|-----------|
| key | TEXT | PRIMARY KEY |
| value | TEXT | NOT NULL |

---

## Modules

### Dashboard (`/`)

Responsive grid: 1 column on mobile, 2 on tablet, 3 on desktop.

**Widgets:**
- Greeting: "Good [morning/afternoon/evening], [Name]" + date
- Weather: OpenWeatherMap proxy, 3-day preview, refresh every 30 min, hide widget on API error
- Upcoming events: next 3–5, color-coded by person
- Urgent tasks: priority urgent/high + due_date ≤48h
- Today's meals: meals for the current day
- Pinboard preview: 2–3 pinned notes
- FAB (quick actions): + Task, + Event, + Shopping list item, + Note

Skeleton loading instead of spinners. Clicking any widget navigates to that module.

### Tasks (`/tasks`)

**Views:**
- List view (default): grouped by category or due date (toggleable), filter: person, priority, status
- Kanban: columns Open → In Progress → Done, drag & drop
- View mode persisted in localStorage; URL parameter `?view=kanban` overrides (useful for tablet kiosk setups)

**Features:**
- CRUD + subtasks (max 2 levels, checkbox list, progress bar)
- Assignment to users (avatar color as indicator)
- Priorities shown visually via color/icon
- Recurring: automatically create next instance on completion
- Mobile swipe: left = done, right = edit
- Badge for overdue tasks

### Shopping Lists (`/shopping`)

- Multiple lists in parallel
- Items: name, category, quantity, checkbox
- Grouping by category (aisle logic)
- Integration with meal plan: "Add ingredients to shopping list" transfers with source reference
- Checked items shown with strikethrough + moved to bottom
- "Clear list" = remove checked items only
- Autocomplete from previous entries (local)
- Mobile swipe: left = check/uncheck, right = delete; × delete button hidden on mobile (swipe takes over)

### Meal Plan (`/meals`)

Weekly view (Mon–Sun), slots: breakfast / lunch / dinner / snack.

- Meal: title + notes + ingredient list
- "→ Shopping list" button: transfer unchecked ingredients of the week to a selected list
- Week navigation forward/back
- Drag & drop between days/slots
- Autocomplete from meal history

### Calendar (`/calendar`)

**Views:** Month (default, dot indicators), Week (hour grid), Day (timeline), Agenda (list).

- CRUD: title, description, start/end, all-day, location, color, assignment
- Color-coding per person
- Recurring via iCal RRULE
- **Google Calendar:** OAuth 2.0, Calendar API v3, two-way sync
- **Apple Calendar:** CalDAV (tsdav), two-way sync
- Configurable sync interval (default 15 min)
- External events visually distinguishable
- Conflicts: external event wins, local additions are preserved

### Notes (`/notes`)

Masonry grid with colored sticky notes.

- CRUD: title (optional), content, color
- Pin → appears at top + on dashboard
- Creator shown (avatar color)
- Markdown-light: bold, italic, lists (regex-based)
- Full-text search: client-side filter bar, filters instantly by title + content

### Contacts (`/contacts`)

- CRUD with category filter
- Phone: `tel:` link, email: `mailto:` link
- Address: Maps link (Google/Apple via user agent)
- Real-time search filter
- vCard export: each contact downloadable as `.vcf` (`GET /api/v1/contacts/:id/vcard`)
- vCard import: upload file → client-side parser (FN, TEL, EMAIL, ADR, NOTE, CATEGORIES) → create contact

### Login (`/login`)

Unauthenticated users are redirected here. No public registration form - admin creates users via setup wizard (`setup.js`) or Settings.

- Username + password form
- Error display for wrong credentials
- Rate limiting: 5 attempts/min/IP, 15-min lockout
- After successful login: redirect to dashboard

### Settings (`/settings`)

User management and app configuration. Logged-in users only.

- **Profile:** change display name, avatar color, password
- **User management (admin):** create new users, edit/delete existing users, assign roles (admin/member)
- **Calendar integration:** connect/disconnect Google Calendar OAuth, store Apple Calendar (CalDAV) credentials, configure sync interval
- **Weather:** configure OpenWeatherMap location
- **Language:** System (follows `navigator.language`), German, English - via `oikos-locale-picker` web component; switch without page reload
- **App info:** version, license

### Budget (`/budget`)

**Views:**
- Monthly overview: income vs. expenses, balance, bar chart by category (Canvas, no library)
- Transaction list: chronological, filterable

- CRUD: title, amount, category, date
- Recurring entries
- Monthly comparison (current vs. previous month)
- CSV export

---

## Design System

### Colors (CSS Custom Properties)

```css
:root {
  --color-bg: #F5F5F7;
  --color-surface: #FFFFFF;
  --color-border: #E5E5EA;
  --color-text-primary: #1C1C1E;
  --color-text-secondary: #8E8E93;
  --color-accent: #007AFF;
  --color-accent-light: #E3F2FF;
  --color-success: #34C759;
  --color-warning: #FF9500;
  --color-danger: #FF3B30;
  --color-info: #5AC8FA;
  --color-priority-none: var(--neutral-400);
  --color-priority-low: #8E8E93;
  --color-priority-medium: #FF9500;
  --color-priority-high: #FF6B35;
  --color-priority-urgent: #FF3B30;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.1);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1C1C1E;
    --color-surface: #2C2C2E;
    --color-border: #3A3A3C;
    --color-text-primary: #F5F5F7;
    --color-text-secondary: #8E8E93;
  }
}
```

### Typography
- System font stack, headings 600–700
- Body: 16px mobile, 15px desktop, line-height 1.5
- Caption: 13px, `var(--color-text-secondary)`

### Components
- **Cards:** `var(--color-surface)`, `var(--radius-md)`, `var(--shadow-sm)`. Consistent padding `var(--space-4)` (16px) across all modules.
- **Buttons:** Primary = accent + white. Secondary = outline. Min-height 44px. Submit buttons show success (checkmark, 700ms green via `.btn--success`) and error (shake via `.btn--shaking`).
- **Inputs:** `var(--radius-sm)`, 1.5px border, padding 12px 16px. `[required]` fields receive validation status on blur (`.form-field--error` / `.form-field--valid`). Enter moves focus to the next field; Enter on the last field triggers submit.
- **FAB (Floating Action Button):** Color follows the module accent token (`--module-accent`) - each module defines its own accent color. Hidden when the virtual keyboard is open (`visualViewport.resize`, threshold 75% of window height).
- **Module accent colors:** `--module-accent` is applied on three visual layers - (1) active nav tab (bottom bar + sidebar stripe), (2) toolbar `border-top: 3px`, (3) cards/rows `border-left: 3px`. The active accent is written to `--active-module-accent` on `:root` on every navigation change. Falls back to `--color-accent` for pages without a module context.
- **Navigation:** Bottom tab bar on mobile (Dashboard, Tasks, Calendar, Meals, More). Sidebar on desktop.
- **Transitions:** Directional slide-X animation on page change (forward = from right, back = from left, 200ms). Respects `prefers-reduced-motion`.
- **Empty states:** Consistent `.empty-state` class across all modules (icon + title + description, centered). Compact variant `.empty-state--compact` for meal slots.
- **Modals:** Centered panel on desktop. On mobile (< 768px) bottom sheet - slides in from below, sheet handle visible, swipe-to-close (> 80px downward). `focusin` scrolls inputs into view when the virtual keyboard is open.
- **List animation:** Staggered fade-in on load (`stagger()` from `public/utils/ux.js`) - max 5 elements staggered (30ms gap), rest appear immediately.
- **Vibration:** `vibrate()` from `public/utils/ux.js` - short pulses for light actions (10–40ms), pattern `[30, 50, 30]` for destructive actions (delete). Respects `prefers-reduced-motion`.
- **PWA install prompt:** Appears only after 2 user interactions. Dismiss window 7 days; interaction counter resets after dismiss.
- **PWA offline fallback:** Service worker serves `/offline.html` when the network is unreachable and `index.html` is not cached. Includes a reload button.

### Breakpoints
- Mobile: < 768px (1 column, bottom nav)
- Tablet: 768–1024px (2 columns, bottom nav)
- Desktop: > 1024px (sidebar + content)

---

## Internationalization (i18n)

All UI strings are managed via `public/i18n.js`. No hardcoded text in JS files outside of locale files.

### Architecture

- **Module:** `public/i18n.js` - exports: `initI18n()`, `setLocale()`, `t(key, params?)`, `getLocale()`, `getSupportedLocales()`, `formatDate(date)`, `formatTime(date)`
- **Locale files:** `public/locales/de.json` (reference), `public/locales/en.json` - structure: `{ "module.camelCaseKey": "Value" }`
- **Variables:** `{{variable}}` syntax in translation strings, e.g. `t('tasks.assignedTo', { name: 'Anna' })`
- **Fallback chain:** active locale → German (`de`) → key itself
- **Date format:** `Intl.DateTimeFormat` with current locale - use `formatDate()` and `formatTime()` from `i18n.js`

### Language Detection

1. `localStorage` entry `oikos-locale` (manual selection)
2. `navigator.languages[0]` (browser language)
3. Fallback: `de`

### Supported Languages

| Code | Language | Status |
|------|----------|--------|
| `de` | German | Reference locale (all keys defined here) |
| `en` | English | Full translation |
| `it` | Italian | Full translation (added v0.5.8) |

### Adding a New Language

1. Create `public/locales/xx.json` (copy of `de.json`, translate)
2. Add `'xx'` to `SUPPORTED_LOCALES` in `public/i18n.js`
3. Add label in `oikos-locale-picker` (`LOCALE_LABELS['xx'] = 'Name'`)

### Locale Switching

`setLocale(locale)` saves the selection, loads the new locale file, and fires the `locale-changed` custom event. All page modules and web components listen to this event and re-render - no page reload required.
