# Oikos — Selbstgehosteter Familienplaner

Oikos ist eine self-hosted Progressive Web App für Familien. Sie läuft vollständig auf deinem eigenen Server — keine Cloud-Abhängigkeiten, keine Datenweitergabe.

## Features

- **Dashboard** — Begrüßung, Wetter-Widget, anstehende Termine, dringende Aufgaben, Essen, Pinnwand
- **Aufgaben** — Listenansicht (Kategorie/Fälligkeit), Kanban-Board, Teilaufgaben, Swipe-Gesten, wiederkehrende Aufgaben
- **Einkaufslisten** — Mehrere Listen, Kategorien, Essensplan-Integration
- **Essensplan** — Wochenansicht, Zutatenverwaltung, Übertrag auf Einkaufsliste
- **Kalender** — Monats-/Wochen-/Tages-/Agenda-Ansicht, Familienfarben, wiederkehrende Termine
- **Pinnwand** — Farbige Sticky Notes mit Markdown-Light
- **Kontakte** — Wichtige Kontakte mit Kategorie-Filter, tel:/mailto:/Maps-Links
- **Budget** — Einnahmen/Ausgaben, Monatsauswertung, CSV-Export
- **PWA** — Offline-fähig, installierbar auf iOS/Android/Desktop

## Voraussetzungen

- **Docker & Docker Compose** (empfohlen) oder **Node.js ≥ 20**
- Ein Linux-Server hinter Nginx Reverse Proxy mit SSL (empfohlen)

---

## Schnellstart mit Docker (empfohlen)

### 1. Repository klonen

```bash
git clone https://github.com/ulsklyc/oikos.git
cd oikos
```

### 2. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

Pflichtfelder in `.env` anpassen:

```env
SESSION_SECRET=ein-langer-zufaelliger-string-min-32-zeichen
DB_ENCRYPTION_KEY=ein-starkes-passwort-fuer-die-datenbank
```

Optional: Wetter-Widget aktivieren

```env
OPENWEATHER_API_KEY=dein-api-key-von-openweathermap.org
OPENWEATHER_CITY=Berlin
```

### 3. Starten

```bash
docker compose up -d
```

Die App ist unter `http://localhost:3000` erreichbar.

### 4. Erster Login

Beim ersten Start wird automatisch ein Admin-Account erstellt:

```
Benutzername: admin
Passwort:     admin
```

**Passwort sofort ändern!** → Einstellungen → Passwort ändern

---

## Ohne Docker (direkt mit Node.js)

```bash
npm install
cp .env.example .env
# .env anpassen (siehe oben)
npm start
```

Entwicklungsmodus (Auto-Reload):

```bash
npm run dev
```

---

## Nginx Reverse Proxy

Beispiel-Konfiguration für Nginx Proxy Manager oder direktes Nginx:

```nginx
server {
    listen 443 ssl;
    server_name oikos.deine-domain.de;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Die Datei `nginx.conf.example` im Repository enthält eine vollständige Konfiguration.

---

## Familienmitglieder verwalten

Neue Mitglieder können nur Admins anlegen:

1. **Einstellungen** → **Familienmitglieder** → **+ Neu**
2. Benutzername, Anzeigename, Passwort, Avatarfarbe und Rolle festlegen
3. Login-Daten dem Familienmitglied mitteilen

---

## Umgebungsvariablen — Referenz

| Variable | Pflicht | Standard | Beschreibung |
|---|---|---|---|
| `PORT` | — | `3000` | Server-Port |
| `NODE_ENV` | — | `development` | `production` für Deployment |
| `SESSION_SECRET` | ✓ | — | Langer Zufalls-String (≥ 32 Zeichen) |
| `DB_PATH` | — | `./oikos.db` | Pfad zur SQLite-Datenbankdatei |
| `DB_ENCRYPTION_KEY` | — | — | SQLCipher-Schlüssel (leer = keine Verschlüsselung) |
| `OPENWEATHER_API_KEY` | — | — | API-Key von openweathermap.org |
| `OPENWEATHER_CITY` | — | `Berlin` | Stadtname für Wetter-Abfrage |
| `OPENWEATHER_UNITS` | — | `metric` | `metric` = °C, `imperial` = °F |
| `OPENWEATHER_LANG` | — | `de` | Sprache der Wetterbeschreibungen |
| `RATE_LIMIT_WINDOW_MS` | — | `60000` | Login Rate-Limit Fenster (ms) |
| `RATE_LIMIT_MAX_ATTEMPTS` | — | `5` | Max. Login-Versuche pro Fenster |

---

## Sicherheit

- Sessions sind `httpOnly`, `SameSite=Strict` und in Produktion `Secure`
- CSRF-Schutz via Double Submit Cookie auf allen zustandsändernden Requests
- Passwörter mit bcrypt (Cost Factor 12) gehasht
- Globaler Rate-Limiter auf allen API-Endpoints (300 req/min)
- Strikter Login-Rate-Limiter (5 Versuche/Minute)
- Content Security Policy via Helmet
- Datenbank optional mit SQLCipher verschlüsselt

---

## Datensicherung

Die gesamte Datenbank liegt in einer einzigen Datei:

```bash
# Backup
cp /data/oikos.db /backup/oikos-$(date +%Y%m%d).db

# Docker-Volume sichern
docker run --rm -v oikos_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/oikos-backup.tar.gz /data
```

---

## Tests ausführen

```bash
npm test
```

Die Tests verwenden In-Memory-SQLite und benötigen keine laufende App-Instanz.

---

## Lizenz

Privates Projekt — nicht für den öffentlichen Einsatz lizenziert.
