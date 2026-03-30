# Oikos — Produktspezifikation

Selbstgehostete Familienplaner-Web-App für eine einzelne Familie (2–6 Personen). Kein App-Store, kein öffentlicher Zugang. Deployment via Docker auf privatem Linux-Server hinter Nginx Reverse Proxy mit SSL.

---

## Datenmodell

Jede Tabelle: `id INTEGER PRIMARY KEY`, `created_at TEXT`, `updated_at TEXT` (ISO 8601).

### Users
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| username | TEXT | UNIQUE NOT NULL |
| display_name | TEXT | |
| password_hash | TEXT | bcrypt |
| avatar_color | TEXT | HEX-Farbcode |
| role | TEXT | 'admin' oder 'member' |

### Tasks
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| title | TEXT | NOT NULL |
| description | TEXT | |
| category | TEXT | Haushalt, Schule, Einkauf, Reparatur, Sonstiges |
| priority | TEXT | low, medium, high, urgent |
| status | TEXT | open, in_progress, done |
| due_date | TEXT | DATE, nullable |
| due_time | TEXT | TIME, nullable |
| assigned_to | INTEGER | FK → Users |
| created_by | INTEGER | FK → Users, NOT NULL |
| is_recurring | INTEGER | 0/1 |
| recurrence_rule | TEXT | iCal RRULE |
| parent_task_id | INTEGER | FK → Tasks (max 2 Ebenen) |

### Shopping Lists
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| name | TEXT | NOT NULL (z.B. "REWE", "Baumarkt") |

### Shopping Items
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| list_id | INTEGER | FK → Shopping Lists, NOT NULL |
| name | TEXT | NOT NULL |
| quantity | TEXT | z.B. "500g", "2 Stück" |
| category | TEXT | Obst & Gemüse, Milchprodukte, Fleisch & Fisch, Backwaren, Getränke, Tiefkühl, Haushalt, Drogerie, Sonstiges |
| is_checked | INTEGER | 0/1 |
| added_from_meal | INTEGER | FK → Meals, nullable |

### Meals
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| date | TEXT | DATE, NOT NULL |
| meal_type | TEXT | breakfast, lunch, dinner, snack |
| title | TEXT | NOT NULL |
| notes | TEXT | |
| created_by | INTEGER | FK → Users, NOT NULL |

### Meal Ingredients
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| meal_id | INTEGER | FK → Meals, NOT NULL |
| name | TEXT | NOT NULL |
| quantity | TEXT | |
| on_shopping_list | INTEGER | 0/1 |

### Calendar Events
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| title | TEXT | NOT NULL |
| description | TEXT | |
| start_datetime | TEXT | DATETIME, NOT NULL |
| end_datetime | TEXT | DATETIME |
| all_day | INTEGER | 0/1 |
| location | TEXT | |
| color | TEXT | HEX |
| assigned_to | INTEGER | FK → Users |
| created_by | INTEGER | FK → Users, NOT NULL |
| external_calendar_id | TEXT | ID aus externem Kalender |
| external_source | TEXT | local, google, apple |
| recurrence_rule | TEXT | iCal RRULE |

### Notes
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| title | TEXT | nullable |
| content | TEXT | NOT NULL |
| color | TEXT | HEX |
| pinned | INTEGER | 0/1 |
| created_by | INTEGER | FK → Users, NOT NULL |

### Contacts
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| name | TEXT | NOT NULL |
| category | TEXT | Arzt, Schule/Kita, Behörde, Versicherung, Handwerker, Notfall, Sonstiges |
| phone | TEXT | |
| email | TEXT | |
| address | TEXT | |
| notes | TEXT | |

### Budget Entries
| Spalte | Typ | Constraint |
|--------|-----|-----------|
| title | TEXT | NOT NULL |
| amount | REAL | NOT NULL (positiv=Einnahme, negativ=Ausgabe) |
| category | TEXT | Lebensmittel, Miete, Versicherung, Mobilität, Freizeit, Kleidung, Gesundheit, Bildung, Sonstiges |
| date | TEXT | DATE, NOT NULL |
| is_recurring | INTEGER | 0/1 |
| recurrence_rule | TEXT | iCal RRULE |
| created_by | INTEGER | FK → Users, NOT NULL |

---

## Module

### Dashboard (`/`)

Responsive Grid: 1 Spalte mobil, 2 Tablet, 3 Desktop.

**Widgets:**
- Begrüßung: "Guten [Morgen/Tag/Abend], [Name]" + Datum
- Wetter: OpenWeatherMap-Proxy, 3-Tage-Vorschau, Refresh 30min, bei API-Fehler Widget ausblenden
- Anstehende Termine: nächste 3–5, farbcodiert nach Person
- Dringende Aufgaben: priority urgent/high + due_date ≤48h
- Heutiges Essen: Mahlzeiten des Tages
- Pinnwand-Vorschau: 2–3 angepinnte Notizen
- FAB (Schnellaktionen): + Aufgabe, + Termin, + Einkaufslisteneintrag, + Notiz

Skeleton-Loading statt Spinner. Klick auf jedes Widget navigiert zum Modul.

### Aufgaben (`/tasks`)

**Ansichten:**
- Listenansicht (Standard): gruppiert nach Kategorie oder Fälligkeit (umschaltbar), Filter: Person, Priorität, Status
- Kanban: Spalten Offen → In Bearbeitung → Erledigt, Drag & Drop

**Features:**
- CRUD + Teilaufgaben (max 2 Ebenen, Checkbox-Liste, Fortschrittsbalken)
- Zuweisung an User (Avatar-Farbe als Indikator)
- Prioritäten visuell durch Farbe/Icon
- Wiederkehrend: bei Erledigung nächste Instanz automatisch erstellen
- Swipe mobil: links = erledigt, rechts = bearbeiten
- Badge bei überfälligen Aufgaben

### Einkaufslisten (`/shopping`)

- Mehrere Listen parallel
- Artikel: Name, Kategorie, Menge, Checkbox
- Gruppierung nach Kategorie (Gang-Logik)
- Integration mit Essensplan: "Zutaten auf Einkaufsliste" überträgt mit Quell-Referenz
- Erledigte Artikel durchgestrichen + nach unten
- "Liste leeren" = nur abgehakte entfernen
- Autocomplete aus bisherigen Einträgen (lokal)

### Essensplan (`/meals`)

Wochenansicht (Mo–So), Slots: Frühstück/Mittag/Abend/Snack.

- Mahlzeit: Titel + Notizen + Zutatenliste
- Button "→ Einkaufsliste": nicht-abgehakte Zutaten der Woche auf wählbare Liste übertragen
- Wochennavigation vor/zurück
- Drag & Drop zwischen Tagen/Slots
- Autocomplete aus Mahlzeiten-Historie

### Kalender (`/calendar`)

**Ansichten:** Monat (Standard, Punkt-Indikatoren), Woche (Stundenraster), Tag (Timeline), Agenda (Liste).

- CRUD: Titel, Beschreibung, Start/Ende, Ganztägig, Ort, Farbe, Zuweisung
- Farbcodierung pro Person
- Wiederkehrend via iCal RRULE
- **Google Calendar:** OAuth 2.0, Calendar API v3, Zwei-Wege-Sync
- **Apple Calendar:** CalDAV (tsdav), Zwei-Wege-Sync
- Sync-Intervall konfigurierbar (Standard 15min)
- Externe Termine visuell unterscheidbar
- Konflikte: externes Event gewinnt, lokale Ergänzungen bleiben

### Pinnwand (`/notes`)

Masonry-Grid mit farbigen Sticky Notes.

- CRUD: Titel (optional), Inhalt, Farbe
- Anpinnen → erscheint oben + Dashboard
- Ersteller angezeigt (Avatar-Farbe)
- Markdown-Light: fett, kursiv, Listen (regex-basiert)

### Kontakte (`/contacts`)

- CRUD mit Kategorie-Filter
- Telefon: `tel:`-Link, E-Mail: `mailto:`-Link
- Adresse: Maps-Link (Google/Apple via User-Agent)
- Echtzeit-Suchfilter

### Login (`/login`)

Nicht-authentifizierte Nutzer werden hierhin umgeleitet. Kein öffentliches Registrierungsformular — Admin erstellt Benutzer über Setup-Wizard (`setup.js`) oder Settings.

- Username + Passwort-Formular
- Fehleranzeige bei falschen Credentials
- Rate-Limiting: 5 Versuche/min/IP, 15-min Lockout
- Nach erfolgreichem Login: Redirect auf Dashboard

### Einstellungen (`/settings`)

Benutzerverwaltung und App-Konfiguration. Nur für eingeloggte Nutzer.

- **Profil:** Display-Name, Avatar-Farbe ändern, Passwort ändern
- **Benutzerverwaltung (Admin):** Neue Benutzer anlegen, bestehende Benutzer bearbeiten/löschen, Rollen zuweisen (admin/member)
- **Kalender-Integration:** Google Calendar OAuth verbinden/trennen, Apple Calendar (CalDAV) Credentials hinterlegen, Sync-Intervall konfigurieren
- **Wetter:** OpenWeatherMap Standort konfigurieren
- **App-Info:** Version, Lizenz

### Budget (`/budget`)

**Ansichten:**
- Monatsübersicht: Einnahmen vs. Ausgaben, Saldo, Balkendiagramm nach Kategorie (Canvas, keine Library)
- Transaktionsliste: chronologisch, filterbar

- CRUD: Titel, Betrag, Kategorie, Datum
- Wiederkehrende Buchungen
- Monatsvergleich (aktuell vs. Vormonat)
- CSV-Export

---

## Design-System

### Farben (CSS Custom Properties)

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

### Typografie
- System Font Stack, Überschriften 600–700
- Body: 16px mobil, 15px Desktop, line-height 1.5
- Caption: 13px, `var(--color-text-secondary)`

### Komponenten
- **Cards:** `var(--color-surface)`, `var(--radius-md)`, `var(--shadow-sm)`. Einheitliches Padding `var(--space-4)` (16px) in allen Modulen.
- **Buttons:** Primär = Accent + weiß. Sekundär = Outline. Min-Höhe 44px. Submit-Buttons zeigen Erfolg (Checkmark, 700ms grün via `.btn--success`) und Fehler (Shake via `.btn--shaking`).
- **Inputs:** `var(--radius-sm)`, 1.5px border, padding 12px 16px. `[required]`-Felder erhalten bei Blur Validierungsstatus (`.form-field--error` / `.form-field--valid`). Enter navigiert zum nächsten Feld; Enter im letzten Feld löst Submit aus.
- **FAB (Floating Action Button):** Farbe folgt dem Modul-Akzent-Token (`--module-accent`) — jedes Modul definiert seine eigene Akzentfarbe.
- **Navigation:** Bottom Tab Bar mobil (Dashboard, Aufgaben, Kalender, Essen, Mehr). Sidebar Desktop.
- **Transitions:** Direktionale Slide-X-Animation bei Seitenwechsel (vorwärts = von rechts, rückwärts = von links, 200ms). Respektiert `prefers-reduced-motion`.
- **Empty States:** Einheitliche `.empty-state`-Klasse in allen Modulen (Icon + Titel + Beschreibung, zentriert). Kompakte Variante `.empty-state--compact` für Mahlzeiten-Slots.
- **Modals:** Auf Desktop zentriertes Panel. Auf Mobile (< 768px) Bottom Sheet — fährt von unten ein, Sheet-Handle sichtbar, Swipe-to-Close (> 80px nach unten). `focusin` scrollt Inputs bei virtueller Tastatur in den sichtbaren Bereich.
- **Listen-Animation:** Staggered Fade-In beim Laden (`stagger()` aus `public/utils/ux.js`) — max. 5 Elemente gestaffelt (30ms Abstand), Rest sofort.
- **Vibration:** `vibrate()` aus `public/utils/ux.js` — kurze Impulse bei leichten Aktionen (10–40ms), Muster `[30, 50, 30]` bei destructiven Aktionen (Löschen). Respektiert `prefers-reduced-motion`.
- **PWA Install Prompt:** Erscheint erst nach 2 Nutzer-Interaktionen. Dismiss-Fenster 7 Tage; nach Dismiss wird der Interaktionszähler zurückgesetzt.

### Breakpoints
- Mobil: < 768px (1 Spalte, Bottom Nav)
- Tablet: 768–1024px (2 Spalten, Bottom Nav)
- Desktop: > 1024px (Sidebar + Content)
