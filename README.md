<div align="center">

<br>

<img src="public/screenshots/dashboard.png" width="120" alt="Oikos Dashboard" />

<br><br>

# Oikos

**Dein Familienplaner. Dein Server. Deine Daten.**

Eine selbstgehostete Web-App, die den Alltag deiner Familie organisiert — <br>
vom Einkaufszettel bis zum Kalender, vom Essensplan bis zum Budget. <br>
Ohne Cloud. Ohne Abo. Ohne Tracking.

<br>

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com)
[![SQLite](https://img.shields.io/badge/SQLite-verschl%C3%BCsselt-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.zetetic.net/sqlcipher/)
[![PWA](https://img.shields.io/badge/PWA-offline--f%C3%A4hig-5A0FC8?style=flat-square)](https://web.dev/progressive-web-apps/)
[![WCAG](https://img.shields.io/badge/WCAG_2.2-AA-228B22?style=flat-square)](https://www.w3.org/WAI/WCAG22/quickref/)
[![Lizenz](https://img.shields.io/badge/Lizenz-MIT-green?style=flat-square)](./LICENSE)

<br>

[Warum Oikos?](#-warum-open-source--privacy) · [Funktionen](#-module) · [Screenshots](#-screenshots) · [Installation](#-schnellstart) · [FAQ](#-faq)

</div>

<br>

---

<br>

## Warum Open Source & Privacy?

Termine, Einkaufslisten, Finanzen, Kontakte von Kinderärzten, Schulzeiten, Medikamentenpläne — ein Familienplaner speichert **die intimsten Details eines Haushalts**. Wer wann wo ist. Was eingekauft wird. Wie viel Geld wofür ausgegeben wird. Namen und Daten der Kinder.

Die meisten Familienplaner sind Cloud-Dienste. Deine Daten liegen auf fremden Servern, werden analysiert, monetarisiert, oder sind einem Datenleck ausgesetzt. Du hast keine Kontrolle — und oft nicht einmal Einblick, was mit den Informationen deiner Familie passiert.

**Das muss nicht so sein.**

> *Oikos* (griech. *oíkos*) bedeutet „Haus" oder „Haushalt" — der Ursprung des Wortes *Ökonomie*. <br> Eine App, die deinen Haushalt organisiert, sollte auch dort bleiben: **bei dir zuhause.**

<br>

### Das Problem mit der Cloud

<table>
<tr>
<td width="50%">

**Cloud-Familienplaner**

- Daten liegen auf fremden Servern
- Geschäftsmodell basiert auf deinen Daten
- Dienst wird eingestellt? Daten weg.
- Abo-Kosten, oft pro Familienmitglied
- Tracking, Analyse, Werbeprofiling
- Datenschutz der Kinder abhängig vom Anbieter

</td>
<td width="50%">

**Oikos (selbstgehostet)**

- Daten bleiben auf deinem Server
- Kein Tracking. Keine Telemetrie. **Nichts.**
- Du hast die volle Kontrolle — dauerhaft
- Einmal einrichten, kostenlos nutzen
- Kein Byte verlässt dein Netzwerk
- DSGVO? Kein Thema — du bist der Betreiber

</td>
</tr>
</table>

<br>

### Warum das für Familien besonders wichtig ist

Ein Familienplaner aggregiert Daten, die einzeln harmlos wirken, zusammen aber ein **vollständiges Profil** ergeben:

- **Tagesabläufe** — Wann sind die Kinder in der Schule? Wann ist niemand zuhause?
- **Gesundheitsdaten** — Arzttermine, Allergien in Essensplänen, Medikamenten-Erinnerungen
- **Finanzverhalten** — Einkommen, Ausgaben, finanzielle Engpässe
- **Einkaufsgewohnheiten** — Was wird gekauft, wie oft, in welchen Mengen?
- **Soziales Netz** — Kontakte zu Schulen, Ärzten, Betreuern — mit Adressen und Telefonnummern

Bei kommerziellen Cloud-Diensten fließen diese Daten durch Drittanbieter-Infrastruktur, unterliegen deren AGBs und sind potenziell Gegenstand von Data Breaches.

**Open Source bedeutet:** Der Code ist einsehbar. Niemand kann versteckte Tracker einbauen. Du kannst jede Zeile prüfen — oder jemanden bitten, es für dich zu tun. Und wenn du Oikos nicht mehr brauchst, löschst du den Container. Ende.

<br>

---

<br>

## Module

Oikos ist modular aufgebaut — jedes Modul löst ein konkretes Problem im Familienalltag:

<br>

> **Dashboard** &ensp;·&ensp; Dein Tagesstart auf einen Blick: Wetter, Termine, dringende Aufgaben, heutiges Essen und angepinnte Notizen.

> **Aufgaben** &ensp;·&ensp; Erstellen, priorisieren, zuweisen. Mit Teilaufgaben, Wiederholungen, Statusfiltern und Swipe-Gesten auf dem Handy.

> **Einkauf** &ensp;·&ensp; Mehrere Listen parallel (REWE, dm, Baumarkt). Automatische Gruppierung nach Kategorien. Die ganze Familie befüllt gemeinsam.

> **Essensplan** &ensp;·&ensp; Wochenplan für alle Mahlzeiten. Zutaten erfassen und mit einem Klick auf die Einkaufsliste übernehmen.

> **Kalender** &ensp;·&ensp; Vier Ansichten (Monat, Woche, Tag, Agenda), farbcodiert pro Person. Optional mit Google Calendar und Apple iCloud synchronisierbar.

> **Pinnwand** &ensp;·&ensp; Farbige Sticky Notes für Erinnerungen, Nachrichten an die Familie oder Ideen. Mit Markdown-Light.

> **Kontakte** &ensp;·&ensp; Kinderarzt, Schule, Handwerker, Versicherung — mit Direktanruf, E-Mail und Kartennavigation.

> **Budget** &ensp;·&ensp; Einnahmen und Ausgaben tracken, nach Kategorien auswerten, Monate vergleichen. Mit wiederkehrenden Buchungen und CSV-Export.

<br>

---

<br>

## Screenshots

<div align="center">

### Light Mode

<table>
  <tr>
    <td align="center">
      <img src="public/screenshots/dashboard.png" width="200" alt="Dashboard" /><br/>
      <sub><b>Dashboard</b></sub><br/>
      <sub>Wetter, Termine, Aufgaben, Essen</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/tasks.png" width="200" alt="Aufgaben" /><br/>
      <sub><b>Aufgaben</b></sub><br/>
      <sub>Prioritäten, Zuweisung, Filter</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/calendar.png" width="200" alt="Kalender" /><br/>
      <sub><b>Kalender</b></sub><br/>
      <sub>Monatsansicht, Tagesdetails</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="public/screenshots/shopping.png" width="200" alt="Einkaufsliste" /><br/>
      <sub><b>Einkauf</b></sub><br/>
      <sub>Mehrere Listen, Kategorien</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/meals.png" width="200" alt="Essensplan" /><br/>
      <sub><b>Essensplan</b></sub><br/>
      <sub>Wochenplan, Zutaten</sub>
    </td>
    <td align="center">
      &nbsp;
    </td>
  </tr>
</table>

<br>

### Dark Mode

<table>
  <tr>
    <td align="center">
      <img src="public/screenshots/dashboard-dark.png" width="200" alt="Dashboard Dark" /><br/>
      <sub><b>Dashboard</b></sub>
    </td>
    <td align="center">
      <img src="public/screenshots/tasks-dark.png" width="200" alt="Aufgaben Dark" /><br/>
      <sub><b>Aufgaben</b></sub>
    </td>
    <td align="center">
      <img src="public/screenshots/calendar-dark.png" width="200" alt="Kalender Dark" /><br/>
      <sub><b>Kalender</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="public/screenshots/shopping-dark.png" width="200" alt="Einkaufsliste Dark" /><br/>
      <sub><b>Einkauf</b></sub>
    </td>
    <td align="center">
      <img src="public/screenshots/meals-dark.png" width="200" alt="Essensplan Dark" /><br/>
      <sub><b>Essensplan</b></sub>
    </td>
    <td align="center">
      &nbsp;
    </td>
  </tr>
</table>

<sub>Dark Mode folgt automatisch deiner Systemeinstellung oder lässt sich manuell umschalten.</sub>

</div>

<br>

---

<br>

## Technik

Oikos setzt bewusst auf einen minimalen, wartungsarmen Stack — keine 200 npm-Pakete, kein Build-Step, kein Framework-Lock-in.

| Schicht | Technologie |
|:---|:---|
| **Server** | Node.js + Express.js |
| **Datenbank** | SQLite + SQLCipher (AES-256-Verschlüsselung at rest) |
| **Frontend** | Vanilla JS (ES-Module), eigenes CSS — kein React, kein Vue, kein Bundler |
| **Auth** | Session-basiert, bcrypt (Cost 12), CSRF-Schutz, Rate Limiting |
| **Deployment** | Docker (ein Container, ein Volume) |
| **PWA** | Service Worker + Manifest — installierbar, offline-fähig |
| **Accessibility** | WCAG 2.2 AA — Skip-Links, Touch-Targets, Reduced Motion, aria-Labels |
| **Kalender-Sync** | Google Calendar API v3 (OAuth) + Apple iCloud CalDAV (optional) |

<details>
<summary><b>Sicherheitsmaßnahmen im Detail</b></summary>

<br>

| Maßnahme | Details |
|:---|:---|
| **Verschlüsselte Datenbank** | SQLCipher (AES-256) — Daten sind auch bei physischem Serverzugriff geschützt |
| **Passwort-Hashing** | bcrypt mit Cost Factor 12 — kein Klartext, nie |
| **Session-Schutz** | `httpOnly`, `SameSite=Strict`, `Secure`-Cookies, 7 Tage Ablauf |
| **CSRF-Schutz** | Double Submit Cookie mit `crypto.timingSafeEqual` |
| **Rate Limiting** | 5 Login-Versuche pro Minute, dann 15 Min. Sperre |
| **Input-Validation** | Zentrale Validierung auf allen Endpoints (Länge, Typ, Whitelist) |
| **SQL-Injection-Schutz** | Parametrisierte Queries — kein String-Zusammenbau |
| **Security Headers** | CSP, HSTS, X-Frame-Options via Helmet |
| **Kein offener Zugang** | Jeder API-Endpoint erfordert Authentifizierung (außer Login) |
| **Keine Telemetrie** | Kein externer Request, kein Analytics, kein Font-Loading |

</details>

<br>

---

<br>

## Schnellstart

> **Voraussetzungen:** Ein Linux-System mit [Docker](https://docs.docker.com/engine/install/) + Docker Compose und Git.
> <br> Ein günstiger VPS (Hetzner, Netcup) oder ein Raspberry Pi 4 reichen aus — Oikos braucht minimal 512 MB RAM.

<br>

**1. Repository klonen**

```bash
git clone https://github.com/ulsklyc/oikos.git && cd oikos
```

**2. Konfiguration anlegen**

```bash
cp .env.example .env
nano .env
```

Mindestens diese zwei Werte setzen (jeweils mit `openssl rand -base64 32` generieren):

```env
SESSION_SECRET=dein_zufaelliger_string
DB_ENCRYPTION_KEY=dein_verschluesselungs_key
```

**3. Starten**

```bash
docker compose up -d --build
```

Der erste Build dauert 2–3 Minuten (SQLCipher-Kompilierung). Danach:

```bash
docker compose exec oikos node setup.js   # Ersten Admin-Account anlegen
```

**4. Öffnen**

```
http://<deine-server-ip>:3000
```

> Ohne HTTPS-Reverse-Proxy: `SESSION_SECURE=false` in der `.env` setzen. Für den Produktionsbetrieb empfehlen wir HTTPS — [Einrichtung siehe unten](#https-einrichten).

<br>

---

<br>

## Konfiguration

### Pflichtfelder

| Variable | Beschreibung |
|:---|:---|
| `SESSION_SECRET` | Zufälliger String (mind. 32 Zeichen) — `openssl rand -base64 32` |
| `DB_ENCRYPTION_KEY` | SQLCipher-Schlüssel (AES-256) — leer = keine Verschlüsselung |

### Optionale Features

| Variable | Standard | Beschreibung |
|:---|:---|:---|
| `OPENWEATHER_API_KEY` | — | API-Key für Wetter-Widget ([openweathermap.org](https://openweathermap.org/api), kostenlos) |
| `OPENWEATHER_CITY` | — | Stadt für Wettervorhersage (z.B. `Berlin`) |
| `SESSION_SECURE` | `true` | Auf `false` setzen wenn kein HTTPS (nur zum Testen) |
| `PORT` | `3000` | Server-Port im Container |
| `SYNC_INTERVAL_MINUTES` | `15` | Kalender-Sync-Intervall |

Alle Optionen mit Erklärungen: [`.env.example`](./.env.example)

<br>

---

<br>

## HTTPS einrichten

Für den dauerhaften Betrieb sollte Oikos hinter einem Reverse Proxy mit SSL laufen.

<details>
<summary><b>Nginx Proxy Manager (empfohlen für Einsteiger)</b></summary>

<br>

1. [Nginx Proxy Manager installieren](https://nginxproxymanager.com/guide/)
2. Neuen Proxy Host anlegen: Domain → `oikos.deine-domain.de`, Port → `3000`
3. SSL-Tab: Let's Encrypt Zertifikat ausstellen (kostenlos, automatisch)
4. Advanced-Tab: Inhalt von [`nginx.conf.example`](./nginx.conf.example) einfügen

</details>

<details>
<summary><b>Nginx manuell</b></summary>

<br>

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/oikos
sudo ln -s /etc/nginx/sites-available/oikos /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-available/oikos   # Domain anpassen
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d oikos.deine-domain.de
sudo nginx -t && sudo systemctl reload nginx
```

</details>

Danach `SESSION_SECURE=false` aus der `.env` entfernen und Container neu starten.

<br>

---

<br>

## Kalender-Synchronisation

<details>
<summary><b>Google Calendar</b></summary>

<br>

1. [Google Cloud Console](https://console.cloud.google.com) → Neues Projekt → Google Calendar API aktivieren
2. OAuth 2.0-Client-ID erstellen (Webanwendung), Redirect-URI:
   ```
   https://oikos.deine-domain.de/api/v1/calendar/google/callback
   ```
3. In `.env` eintragen:
   ```env
   GOOGLE_CLIENT_ID=deine-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=dein-client-secret
   GOOGLE_REDIRECT_URI=https://oikos.deine-domain.de/api/v1/calendar/google/callback
   ```
4. In Oikos: Einstellungen → Kalender-Synchronisation → Mit Google verbinden

**Sync-Verhalten:** Bidirektional. Erster Sync: 3 Monate zurück, 12 Monate voraus. Bei Konflikten gewinnt Google, lokale Ergänzungen bleiben erhalten.

</details>

<details>
<summary><b>Apple Calendar (iCloud)</b></summary>

<br>

1. [appleid.apple.com](https://appleid.apple.com) → App-spezifisches Passwort generieren
2. In `.env` eintragen:
   ```env
   APPLE_CALDAV_URL=https://caldav.icloud.com
   APPLE_USERNAME=deine@apple-id.de
   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```
3. Container neu starten — Sync-Button erscheint in den Einstellungen

</details>

<br>

---

<br>

## Wartung

### Updates

```bash
cd oikos && git pull && docker compose up -d --build
```

Datenbank-Migrationen laufen automatisch. Alle Daten im Volume bleiben erhalten.

### Backup & Restore

```bash
# Backup erstellen
docker run --rm -v oikos_oikos_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/oikos-backup-$(date +%Y%m%d).tar.gz /data

# Backup wiederherstellen
docker compose down
docker run --rm -v oikos_oikos_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/oikos-backup-YYYYMMDD.tar.gz -C /
docker compose up -d
```

### Familienmitglieder verwalten

Neue Accounts nur durch Admins — **keine öffentliche Registrierung** (by design).

- **In der App:** Einstellungen → Familienmitglieder → Mitglied hinzufügen
- **Per Terminal:** `docker compose exec oikos node setup.js`

<br>

---

<br>

## Lokale Entwicklung

```bash
git clone https://github.com/ulsklyc/oikos.git && cd oikos
npm install
cp .env.example .env    # SESSION_SECRET setzen, DB_ENCRYPTION_KEY leer lassen
npm run dev             # Auto-Reload bei Änderungen
npm test                # 146 Tests, 7 Suiten (In-Memory-SQLite)
```

<br>

---

<br>

## FAQ

<details>
<summary><b>Brauche ich Docker-Erfahrung?</b></summary>
Nein. Die Installation besteht aus wenigen Befehlen, die du kopieren und einfügen kannst.
</details>

<details>
<summary><b>Läuft Oikos auf einem Raspberry Pi?</b></summary>
Ja — Raspberry Pi 4 (ARM64) funktioniert problemlos. Der Build dauert dort ~5 Min, danach läuft die App flüssig.
</details>

<details>
<summary><b>Ist Oikos auf dem Handy nutzbar?</b></summary>
Ja. Oikos ist eine PWA — installierbar auf dem Homescreen, mit Offline-Grundfunktionen. Keine App-Store-Abhängigkeit.
</details>

<details>
<summary><b>Wie viele Familienmitglieder werden unterstützt?</b></summary>
Konzipiert für 2–6 Personen. Kein technisches Limit, aber das UI ist für kleine Familien und WGs optimiert.
</details>

<details>
<summary><b>Ist die Kalender-Synchronisation Pflicht?</b></summary>
Nein. Der integrierte Kalender funktioniert eigenständig. Google- und Apple-Sync sind optional.
</details>

<details>
<summary><b>Kann ich das Design anpassen?</b></summary>
Ja. Alle Farben, Abstände und Schriften sind als CSS Custom Properties in <code>public/styles/tokens.css</code> definiert — ohne Build-Step änderbar.
</details>

<details>
<summary><b>Was passiert bei einem Update mit meinen Daten?</b></summary>
Daten liegen in einem Docker-Volume und bleiben erhalten. Migrationen laufen automatisch. Vor Updates empfehlen wir ein Backup.
</details>

<br>

---

<br>

<div align="center">

**Oikos** ist Open Source und wird mit Sorgfalt entwickelt.

Deine Familiendaten gehören dir — nicht einem Cloud-Anbieter.

<br>

Feedback, Ideen und Beiträge sind willkommen — [Issues](https://github.com/ulsklyc/oikos/issues) · [MIT-Lizenz](./LICENSE)

</div>
