<div align="center">
  <img src="docs/logo.svg" alt="Oikos" width="120" />
  <h1>Oikos</h1>
  <p><strong>Self-hosted family planner for small households</strong></p>
  <p>Tasks · Shopping Lists · Meal Planning · Calendar Sync · Budget · Notes · Contacts</p>

  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/ulsklyc/oikos/releases"><img src="https://img.shields.io/github/v/release/ulsklyc/oikos?style=flat-square&color=007AFF&label=release" alt="Latest Release"></a>
  <a href="https://www.docker.com"><img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="https://github.com/ulsklyc/oikos/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome"></a>
</div>

<br>

<table>
  <tr>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-dashboard-2.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-dashboard-2.png">
        <img src="docs/screenshots/mobile-light/mobile-light-dashboard-2.png" alt="Dashboard" width="240">
      </picture>
    </td>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-tasks-2.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-tasks-2.png">
        <img src="docs/screenshots/mobile-light/mobile-light-tasks-2.png" alt="Tasks" width="240">
      </picture>
    </td>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-meal.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-meal.png">
        <img src="docs/screenshots/mobile-light/mobile-light-meal.png" alt="Meals" width="240">
      </picture>
    </td>
  </tr>
</table>

<p align="center"><sub>Toggle GitHub light/dark mode to see both themes.</sub></p>

## Highlights

📋 **Task Management:** Shared tasks with deadlines, priorities, subtasks, recurring schedules, and Kanban view

🛒 **Shopping Lists:** Collaborative lists with aisle categories and one-click import from meal plans

🍽️ **Meal Planning:** Weekly drag-and-drop planner with ingredient lists and shopping export

📅 **Calendar Sync:** Two-way sync with Google Calendar (OAuth) and Apple iCloud (CalDAV)

💰 **Budget Tracking:** Income and expenses, recurring entries, monthly trends, CSV export

📌 **Notes & Contacts:** Colored sticky notes with Markdown, contact directory with vCard import/export

⚡ **Zero Build Step:** Pure ES modules, no bundler, no transpiler, no framework. Ships what you write.

🔒 **Privacy First:** SQLCipher AES-256 encrypted database, fully self-hosted, zero telemetry

📱 **PWA Native Feel:** Installable on any device, works offline, dark mode, responsive from phone to desktop

🌍 **Multilingual:** German and English UI with automatic locale detection

## Quick Start

```bash
git clone https://github.com/ulsklyc/oikos.git && cd oikos
cp .env.example .env     # then edit .env - set SESSION_SECRET and DB_ENCRYPTION_KEY
docker compose up -d --build
docker compose exec oikos node setup.js
```

Then open `http://localhost:3000` and log in with the admin credentials you set in the previous step. Add family members from Settings.

> **New to Docker?** The **[Installation Guide](docs/installation.md)** walks you through every step: From installing Docker to HTTPS setup, backups, and troubleshooting.

## Tech Stack

<p>
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/SQLite%20%2F%20SQLCipher-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Vanilla_JS_(ES_Modules)-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="Vanilla JS">
  <img src="https://img.shields.io/badge/Plain_CSS-1572B6?style=flat-square&logo=css3&logoColor=white" alt="CSS">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA">
</p>

## Documentation

| 🚀 [Installation](docs/installation.md) | 📖 [Spec & Data Model](docs/SPEC.md) | 🤝 [Contributing](CONTRIBUTING.md) | 🔒 [Security](SECURITY.md) | 📋 [Changelog](CHANGELOG.md) | 📌 [Backlog](BACKLOG.md) |
|---|---|---|---|---|---|

## Roadmap

✅ Core modules - Dashboard, Tasks, Shopping, Meals, Calendar, Notes, Contacts, Budget

✅ Calendar sync - Google Calendar + Apple iCloud bidirectional sync

✅ PWA - Service worker, offline mode, install prompt

📋 Push notifications for deadlines and reminders

📋 Household inventory tracking

## License

<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>

<div align="center">
  <sub>Built with care for families who value privacy and simplicity.</sub>
</div>
