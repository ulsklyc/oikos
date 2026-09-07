<div align="center">
  <img src="docs/logo.svg" alt="" width="92" />

  <h1>Yuvomi</h1>

  <p><strong>One private home for everything that keeps a household running.</strong></p>

  <p>
    Tasks, calendar, budget, groceries, meals, health and more - for a family, a couple,
    or just you. Nineteen modules for one household of up to six people, on a server you
    own, and the only thing that leaves it is a version check.
  </p>

  <p>
    <a href="https://github.com/ulsklyc/yuvomi/releases"><img src="https://img.shields.io/github/v/release/ulsklyc/yuvomi?style=flat-square&color=6C3AED&label=release" alt="Latest release"></a>
    <a href="https://github.com/ulsklyc/yuvomi/stargazers"><img src="https://img.shields.io/github/stars/ulsklyc/yuvomi?style=flat-square&color=6C3AED&label=stars" alt="GitHub stars"></a>
    <a href="https://github.com/ulsklyc/yuvomi/pkgs/container/yuvomi"><img src="https://img.shields.io/badge/ghcr.io-yuvomi-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker image"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license"></a>
  </p>

  <p>
    <a href="#install"><strong>→ Install in minutes</strong></a> &nbsp;·&nbsp;
    <a href="https://yuvomi.cloud/"><strong>Screenshots &amp; tour</strong></a> &nbsp;·&nbsp;
    <a href="#documentation"><strong>Docs</strong></a> &nbsp;·&nbsp;
    <a href="CHANGELOG.md"><strong>Changelog</strong></a>
  </p>

  <sub><a href="README.de.md">Auf Deutsch lesen</a></sub>

  <br><br>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dashboard-dark-web.webp">
    <img src="docs/screenshots/dashboard-light-web.webp" alt="The Yuvomi dashboard: today's tasks, calendar events, meals and the shopping list on one screen" width="820">
  </picture>

  <sub><b>19</b> modules &nbsp;·&nbsp; <b>24</b> languages &nbsp;·&nbsp; <b>0</b> trackers &nbsp;·&nbsp; optional <b>AES-256</b> database encryption &nbsp;·&nbsp; <b>MIT</b></sub>
</div>

Most households glue their life together from a dozen paid apps, each with its own account, its
own subscription and its own copy of your data on someone else's server. Yuvomi puts all of it in
one place that belongs to you, running as a container on any home server or NAS. Every module is
independent, so you use what fits and switch off what doesn't.

---

## One app instead of a dozen subscriptions

| Instead of juggling… | Yuvomi gives you |
|---|---|
| a to-do &amp; task app | **Tasks** - Kanban, deadlines, recurring, multi-assignment |
| a shared calendar subscription | **Calendar** - sync, subscriptions, per-event visibility |
| a cost-splitting app | **Shared expenses** - shared costs with debt simplification |
| a budgeting app | **Budget** - income, expenses, accounts, savings goals |
| a meal planner &amp; recipe app | **Meals &amp; Recipes** - weekly planner with shopping export |
| a grocery-list app | **Shopping** - shared, aisle-organized lists |
| a pantry &amp; expiry tracker | **Pantry** - stock, storage location, best-before dates |
| a document manager | **Documents** - tagged, searchable family files |
| a home-inventory app | **Inventory** - owned belongings, purchase price, warranty, linked receipts |
| a notes app &amp; contacts sync | **Notes &amp; Contacts** - Markdown notes, CardDAV sync |

## The modules talk to each other

This is the part a folder full of separate apps cannot do:

- **The week's meal plan writes the shopping list.** Plan Thursday, and the ingredients are on the list before anyone walks to the shop.
- **The last jar out of the pantry is already on the list.** Tick items off after a shop and they book back into the pantry with their quantity.
- **A ticked-off chore pays out.** Points on a task land on the assigned member's account, and the reward catalog spends them.
- **A filed receipt hangs on the booking.** Upload it once and it belongs to the transaction, the shared expense and the inventory item at the same time.

## The nineteen modules

Turn on what your household needs; the rest stays out of the way.

| Module | In one line |
|---|---|
| **Tasks** | Kanban board with deadlines, priorities, subtasks, tags, recurring schedules and multi-member assignment. Attach documents and discuss a task in comments. A history view shows what was completed, grouped by day, with who ticked it off - and when a recurring chore was last done. Lock a task so only its creator and admins can redefine it, while everyone else can still tick it off. |
| **Shopping** | Shared lists grouped by aisle and ordered to match your shop, with swipe gestures and one-tap import from the meal plan. Send a list to whoever is doing the run by email. |
| **Meals** | Weekly drag-and-drop planner with a recipe sidebar and direct export to the shopping list. |
| **Recipes** | Create, duplicate and scale recipes, then pre-fill meal slots or send the ingredients to a shopping list. A Mealie or Tandoor instance can be mirrored read-only. |
| **Pantry** | What is actually in the house: amount, storage location and best-before date, with expiry and low-stock filters and a notification before a date is reached. |
| **Calendar** | Two-way sync with Google and CalDAV, one-way Outlook push via Microsoft Graph, calendar subscriptions, recurring events, holiday overlays, filtering by person and per-event visibility. |
| **Documents** | Upload, tag, preview and organize family files, with optional WebDAV or Google Drive storage. |
| **Inventory** | What you own: purchase price, warranty, condition and storage location, with linked receipts and deadline reminders. Off by default; households turn it on. |
| **Budget** | Income, expenses, accounts, loans, subscriptions and per-category planning, with a personal mode. An entry can share its amount while keeping its title and category private, so a shared account's balance stays right. |
| **Housekeeping** | Household staff: schedules, check-in/out, daily or hourly billing, chores and supply requests. |
| **Rewards** | Points on tasks credit the assigned member, with a parent-approved catalog and an auditable ledger. |
| **Health** | Per-member vitals, medications, labs, activity and cycle tracking, with trend charts. |
| **Schedule** | Rotating shift patterns and fixed weekly timetables from one cycle model, with per-day overrides and an explicit free day. The calendar shows them as a read-only overlay computed on read, so changing a pattern leaves no stale appointments behind. Off by default. |
| **Notes &amp; Contacts** | Colored Markdown sticky notes with checklists you tick off by tapping them, plus a contact directory with CardDAV sync and vCard import/export. |
| **Birthdays** | Birthday and optional name-day tracker with automatic calendar events, age display and reminders. |
| **Family** | Member profiles with roles, photos and contact details. New members join through an invite link and pick their own password. |
| **Reminders** | Reminders on tasks, events, subscription renewals, warranties, inventory deadlines and best-before dates, via in-app badges, opt-in push, and household Gotify, ntfy, webhook or email channels. A reminder on a shared event reaches everyone assigned to it, each with their own copy to move or dismiss. |
| **API Tokens** | Bearer / X-API-Key tokens with an OpenAPI 3.0 spec and a built-in MCP endpoint for AI agents. Writes are retry-safe via an optional `Idempotency-Key` header. |
| **Backup** | Manual and scheduled backup/restore with pre-restore rollback and optional cloud upload. |

Two more things you only get on your own server: **wall mode** turns the kitchen tablet into a
readable-from-across-the-room display, and an **Immich screensaver** rotates your own photos when
the screen goes idle. Every module in full detail is in the [spec](docs/SPEC.md); building your own
drop-in module - with its own dashboard widgets, permissions and translations - is covered in the
[module guide](MODULES.md).

---

## Install

- **Image** - `ghcr.io/ulsklyc/`<wbr>`yuvomi:latest`, about 500 MB.
- **Needs** - 256 MB RAM and one port, 3000 by default.
- **Writes** - four volumes you own: data, backups, modules, documents.
- **Outbound** - one update check against the GitHub releases API, nothing else. Block it and nothing breaks: the changelog then reads the history that ships with your installation, only the hint about a newer version stays away. Weather, calendar sync and cloud backup stay off until you fill in credentials.
- **Your data** - one SQLite file at `/data/yuvomi.db`. Copying it is the whole export, unless you moved document storage to a folder, WebDAV or Drive; those files then need their own backup.

### Docker or Podman

```bash
curl -O https://raw.githubusercontent.com/ulsklyc/yuvomi/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/ulsklyc/yuvomi/main/.env.example
cp .env.example .env
# two values: one for SESSION_SECRET, one for DB_ENCRYPTION_KEY
openssl rand -hex 32
openssl rand -hex 32
```

> **Now open `.env` and replace both `REPLACE_WITH_…` placeholders** with the two values you just
> generated. Once a database is encrypted, a lost or changed key never opens it again, not by you
> and not by us, so write the value down. To run without encryption, clear the line instead of
> filling it.

```bash
docker compose up -d
```

Open `http://localhost:3000`. The first visit walks you through creating your admin account.

On Podman, take `podman-compose.yml` instead of `docker-compose.yml` above and start it with
`podman compose -f podman-compose.yml up -d`; it carries the SELinux `:Z` volume labels that
RHEL, Fedora and CentOS Stream need. Both installers detect Podman on their own.

### Guided setup

A setup wizard in your browser, in 24 languages. It detects Docker or Podman, configures HTTPS,
single sign-on and scheduled backups, then starts the container and creates your admin account.

```bash
git clone https://github.com/ulsklyc/yuvomi.git && cd yuvomi
node tools/installer/install-server.js
```

Open **http://localhost:8090**. Needs Node.js 18+ on the host; the container ships its own Node 22.

### From your NAS app store

**TrueNAS SCALE**, **Umbrel** and **Unraid** all carry Yuvomi: search for it in the app catalog and
install, no terminal required. New to containers? The **[installation guide](docs/installation.md)**
covers engine setup, HTTPS, backups and troubleshooting step by step.

<details>
<summary><b>Worth reading before you go live</b></summary>

<br>

> **Health is not a medical device.** No diagnostic claims are made. Health data is sensitive, so enable database encryption (`DB_ENCRYPTION_KEY`, SQLCipher).

> **External document storage needs its own backup.** Database backups hold document metadata and links, not binaries stored in a local folder, on WebDAV, or in Google Drive; back up the selected target separately. Yuvomi visibility settings only control access through Yuvomi. Anyone with access to the connected `Yuvomi/Documents` Google Drive folder can view all files stored there.

> **Internal (LAN / private IP) targets are blocked by default.** Server-side request protection rejects private, loopback, link-local and internal-DNS URLs for calendar subscriptions, WebDAV document storage and recipe mirrors. To use an internally-resolving URL, set the matching opt-in in your deployment environment. See the [installation guide](docs/installation.md#environment-variables).

> **Some catalog slugs still carry the legacy name `oikos`** (e.g. Unraid `oikos-…`). The app shows and installs as Yuvomi everywhere; where the technical slug stays `oikos`, it is kept so existing installations upgrade seamlessly. Search for **Yuvomi**; if a store still surfaces an entry as *oikos*, it is the same app.

</details>

---

## Before you commit

**What if this project stops?** Nothing changes on your machine. It is MIT-licensed and
self-hosted, there is no server of ours anywhere in the path, and the only thing that leaves your
machine is a version check against the GitHub releases API. The container you already pulled keeps
running exactly as it does today, with or without us.

**What if you want your data somewhere else?** Copying one file is the whole export, as long as
documents live in the database. Everything else is in that single SQLite file on your own disk. Scheduled backups write a restorable archive on top
of that, and the documented API pulls anything out in whatever shape you need.

**What does it cost?** Nothing. Yuvomi is free and MIT-licensed. You provide the server; there is
no subscription, no upsell and no paid tier.

---

## Under the hood

- **No build step** - pure ES modules and plain CSS. No bundler, no transpiler, no framework, no runtime CDN.
- **Apple HIG in the Liquid Glass language** - the system font stack and Apple's type scale, capsule controls, inset-grouped lists and spring motion, verified for WCAG AA in light and dark.
- **Privacy first** - fully self-hosted, optional SQLCipher AES-256 database encryption, zero telemetry.
- **Sign-in that scales to a household** - optional two-factor authentication (TOTP with recovery codes, enforceable household-wide), optional single sign-on via any OIDC provider (with a switch for whether an unknown identity gets an account, so a provider that serves more than this household does not hand everyone a way in, and another for making SSO the only way in at all), invite links instead of handed-over passwords, and optional self-service password reset by email.
- **24 languages** with automatic detection. A separate household setting decides the language of entries Yuvomi creates itself, so an exported calendar speaks your household's language instead of English.

<p align="center">
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/SQLite%20%2F%20SQLCipher-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite / SQLCipher">
  <img src="https://img.shields.io/badge/Vanilla_JS_(ES_Modules)-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="Vanilla JS">
  <img src="https://img.shields.io/badge/Plain_CSS-1572B6?style=flat-square&logo=css3&logoColor=white" alt="Plain CSS">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22 or newer">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/Podman-892CA0?style=flat-square&logo=podman&logoColor=white" alt="Podman">
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA">
</p>

---

## Documentation

[Installation](docs/installation.md) &nbsp;·&nbsp; [Spec &amp; data model](docs/SPEC.md) &nbsp;·&nbsp; [Third-party modules](MODULES.md) &nbsp;·&nbsp; [Notification webhooks](docs/notification-webhooks.md) &nbsp;·&nbsp; [Immich screensaver](docs/immich-screensaver.md) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md) &nbsp;·&nbsp; [Releasing](docs/RELEASING.md) &nbsp;·&nbsp; [Security](SECURITY.md) &nbsp;·&nbsp; [Changelog](CHANGELOG.md) &nbsp;·&nbsp; [Backlog](BACKLOG.md) &nbsp;·&nbsp; [Scope](docs/SCOPE.md) &nbsp;·&nbsp; [Decisions](docs/DECISIONS.md) &nbsp;·&nbsp; [Roadmap](docs/ROADMAP.md)

**User guide (community-maintained):** @Kyrodan writes a [user documentation site](https://kyrodan.github.io/yuvomi-docs/)
in his own repository. It is not part of this project and can lag behind a release, so where it and
the sources above disagree, the ones above are right.

If you self-host Yuvomi in a GDPR context (EU/EEA, processing other people's data), read
[privacy for self-hosters](docs/PRIVACY-FOR-SELFHOSTERS.md) before going live. It covers
third-country assessments for every external service, data-processing-agreement notes,
log-retention guidance and a records-of-processing template.

<details>
<summary>Coming from <b>Oikos</b>? This project was renamed, and nothing about the app changes.</summary>

<br>

Yuvomi was renamed from **Oikos** to avoid a trademark conflict with an unrelated product. Same code, same data, same maintainer.

- Old links (`github.com/ulsklyc/oikos`) redirect here automatically.
- The Docker image moved to `ghcr.io/ulsklyc/yuvomi`; the old `ghcr.io/ulsklyc/oikos` keeps working, so update at your convenience.
- Existing data and settings are fully preserved on upgrade.

</details>

---

<div align="center">
  <br>
  <h3>Take back control of your family's data.</h3>
  <p>
    You install it once and it is yours after that. No account with us,<br>
    no subscription, and nothing of ours between your household and its data.
  </p>
  <p>
    <a href="#install"><strong>→ Install in minutes</strong></a> &nbsp;·&nbsp;
    <a href="https://github.com/ulsklyc/yuvomi/discussions"><strong>Ask a question</strong></a>
  </p>
  <br>
  <sub>MIT licensed, see <a href="LICENSE">LICENSE</a>.</sub>
</div>


## 🌐 Web Resources & Interactive Index
- [CATEGORY MAHJONG37](https://eduquestsfr.pages.dev/category-mahjong37.html)
- [CATEGORY MERGE 2](https://brainquestsfr.pages.dev/category-merge-2.html)
- [ITALIAN BRAINROT PUZZLE](https://ieduquests.web.app/italian-brainrot-puzzle.html)
- [OBBY TSUNAMI ESCAPE 1 BY CAR](https://learnaction.github.io/obby-tsunami-escape-1-by-car.html)
- [KAWAII CLAW MERGE](https://learnaction.github.io/kawaii-claw-merge.html)
- [CATEGORY CASUAL](https://eduquests.netlify.app/category-casual.html)
- [CATEGORY CAR 2](https://welearnaction.onrender.com/category-car-2.html)
- [CATEGORY UNBLOCKED WEBSITES](https://eduquests.github.io/category-unblocked-websites.html)
- [ULTIMATE YATZY](https://learnaction.netlify.app/ultimate-yatzy.html)
- [ULTIMATE FLYING CAR 2](https://eduquests.github.io/ultimate-flying-car-2.html)
- [FASHION VALKYRIES SAGA OF STYLE](https://eduquests.github.io/fashion-valkyries-saga-of-style.html)
- [KITTEN NEVER DIES](https://eduquests.netlify.app/kitten-never-dies.html)
- [NINJA OBBY PARKOUR](https://eduquests.onrender.com/ninja-obby-parkour.html)
- [CAR PAINT](https://learnaction.github.io/car-paint.html)
- [MASTER BLENDER](https://learnaction.netlify.app/master-blender.html)
- [CATEGORY LOGIC538](https://learnaction.netlify.app/category-logic538.html)
- [CONSTRUCTION SET 3D BUILDER](https://learnaction.netlify.app/construction-set-3d-builder.html)
- [MAHJONG CLASSIC](https://learnaction.netlify.app/mahjong-classic.html)
- [BRICK BREAKER](https://learnaction.github.io/brick-breaker.html)
- [NUMBER MASTER RUN AND MERGE](https://learnaction.github.io/number-master-run-and-merge.html)
- [BASKET SPORT STARS](https://eduquests.netlify.app/basket-sport-stars.html)
- [CATEGORY DEFENSE174](https://learnaction.netlify.app/category-defense174.html)
- [CATEGORY AVOID295](https://eduquests.onrender.com/category-avoid295.html)
- [EGG DASH](https://learnaction.netlify.app/egg-dash.html)
- [TAILOR STYLIST FASHION DIARY](https://eduquests.onrender.com/tailor-stylist-fashion-diary.html)
- [POP ADVENTURE](https://eduquests.github.io/pop-adventure.html)
- [BELL MADNESS](https://eduquests.onrender.com/bell-madness.html)
- [HEDGIES](https://learnaction.netlify.app/hedgies.html)
- [OFFROAD JEEP GAME SIMULATOR](https://learnaction.github.io/offroad-jeep-game-simulator.html)
- [CHAMPIONS FC](https://learnaction.netlify.app/champions-fc.html)
- [CAR PAINT](https://eduquests.netlify.app/car-paint.html)
- [MR RECKLESS CAR CHASE SIMULATOR](https://eduquests.github.io/mr-reckless-car-chase-simulator.html)
- [TAP IT AWAY 3D](https://learnaction.github.io/tap-it-away-3d.html)
- [HIDDEN OBJECTS ISLAND](https://learnaction.netlify.app/hidden-objects-island.html)
- [QUIZ 10 SECONDS MATH](https://learnaction.github.io/quiz-10-seconds-math.html)
- [INDEX6](https://eduquests.github.io/index6.html)
- [KITTEN NEVER DIES](https://learnaction.netlify.app/kitten-never-dies.html)
- [CATEGORY SOLDIER](https://ieduquests.web.app/category-soldier.html)
- [FOOTBALL RUSH 3D](https://eduquests.github.io/football-rush-3d.html)
- [PIXEL SHOOT](https://eduquests.onrender.com/pixel-shoot.html)
- [BILLIARD DIAMOND CHALLENGE](https://learnaction.netlify.app/billiard-diamond-challenge.html)
- [CATEGORY CAT](https://learnaction.netlify.app/category-cat.html)
- [CLONEUP STACK YOURSELF](https://eduquests.github.io/cloneup-stack-yourself.html)
- [CATEGORY CASUAL 3](https://learnaction.netlify.app/category-casual-3.html)
- [TOWER DEFENSE DRAGON MERGE](https://brainquests.pages.dev/tower-defense-dragon-merge.html)
- [MOJICON GARDEN JIGSOLITAIRE](https://eduquests.onrender.com/mojicon-garden-jigsolitaire.html)
- [CATEGORY FLASH](https://learnaction.netlify.app/category-flash.html)
- [STICK KILL 3D](https://learnaction.netlify.app/stick-kill-3d.html)
- [MATE IN CHESS](https://eduquests.github.io/mate-in-chess.html)
- [TANK STARS BATTLE ARENA](https://eduquests.github.io/tank-stars-battle-arena.html)
- [MERGE PLANETS](https://brainquests.pages.dev/merge-planets.html)
- [CATEGORY CRAFTING45](https://learnaction.netlify.app/category-crafting45.html)
- [SPACE CLEANER](https://eduquests.github.io/space-cleaner.html)
- [CAR COLLISION MASTER](https://learnaction.github.io/car-collision-master.html)
- [BIG BAD APE](https://eduquests.netlify.app/big-bad-ape.html)
- [CATEGORY CUTE](https://learnaction.netlify.app/category-cute.html)
- [SAUSAGE FLIP FREE](https://eduquests.onrender.com/sausage-flip-free.html)
- [INDEX4](https://welearnaction.onrender.com/index4.html)
- [CATEGORY 2D1 070](https://welearnaction.onrender.com/category-2d1-070.html)
- [CATEGORY CASUAL 9](https://learnaction.netlify.app/category-casual-9.html)
- [ANGRY CITY SMASHER](https://learnaction.github.io/angry-city-smasher.html)
- [GT MICRO RACERS](https://brainquests.pages.dev/gt-micro-racers.html)
- [STICKMAN DINOSAUR ARENA](https://eduquests.onrender.com/stickman-dinosaur-arena.html)
- [MOVE THE RUBBER BANDS LOGIC PUZZLE](https://learnaction.netlify.app/move-the-rubber-bands-logic-puzzle.html)
- [CATEGORY BUBBLE SHOOTER27](https://ieduquests.web.app/category-bubble-shooter27.html)
- [FROG KNIGHT](https://eduquestses.pages.dev/frog-knight.html)
- [COUNT AND BOUNCE](https://ieduquests.web.app/count-and-bounce.html)
- [CATEGORY COLOR](https://learnaction.netlify.app/category-color.html)
- [MOTO ATTACK](https://learnaction.netlify.app/moto-attack.html)
- [INDEX19](https://welearnaction.onrender.com/index19.html)
- [STEAL BRAINROT ARENA](https://brainquests.pages.dev/steal-brainrot-arena.html)
- [HEIST DEFENDER](https://eduquests.pages.dev/heist-defender.html)
- [CATEGORY MMO25](https://eduquestses.pages.dev/category-mmo25.html)
- [CAR SIMULATOR 3D CAR GAME 3D](https://eduquests.onrender.com/car-simulator-3d-car-game-3d.html)
- [CHAMPIONS FC](https://eduquestspt.pages.dev/champions-fc.html)
- [FURRY KUNG FU](https://eduquests.github.io/furry-kung-fu.html)
- [DREAM PET HOTEL](https://brainquests.pages.dev/dream-pet-hotel.html)
- [SOLITAIRE LAMOUR](https://eduquests.pages.dev/solitaire-lamour.html)
- [CRICKET CLASH PONG](https://eduquests.github.io/cricket-clash-pong.html)
- [ZOMBIE ARENA 2 FURY ROAD](https://eduquestses.pages.dev/zombie-arena-2-fury-road.html)
- [SURVIVAL ISLAND](https://ieduquests.web.app/survival-island.html)
- [FLYORDIEIO](https://learnaction.netlify.app/flyordieio.html)
- [CATEGORY WAR137](https://eduquestsfr.pages.dev/category-war137.html)
- [WORD SEARCH UNIVERSE](https://eduquests.github.io/word-search-universe.html)
- [CARS VS ZOMBIES](https://eduquestsfr.pages.dev/cars-vs-zombies.html)
- [COLOR NUTS BOLTS PUZZLE](https://eduquestspt.pages.dev/color-nuts-bolts-puzzle.html)
- [CHILDRENS DOCTOR TREATING EARS](https://eduquestspt.pages.dev/childrens-doctor-treating-ears.html)
- [ITALIAN BRAINROT FIND THE STARS](https://brainquests.pages.dev/italian-brainrot-find-the-stars.html)
- [MUSIC CAT PIANO TILES GAME 3D](https://eduquests.pages.dev/music-cat-piano-tiles-game-3d.html)
- [NEON GRAVITY](https://learnaction.netlify.app/neon-gravity.html)
- [CUDDLE MONSTER FUSION](https://eduquestses.pages.dev/cuddle-monster-fusion.html)
- [TENTRIX](https://learnaction.netlify.app/tentrix.html)
- [THRILL ROLLER COASTER](https://learnaction.github.io/thrill-roller-coaster.html)
- [SKILLFUL FINGER](https://eduquestspt.pages.dev/skillful-finger.html)
- [CATEGORY SIDE SCROLLING184](https://eduquestkr.pages.dev/category-side-scrolling184.html)
- [DUDU ENGINEERING TRUCK](https://eduquestses.pages.dev/dudu-engineering-truck.html)
- [MOTO X3M DEAD AHEAD](https://eduquestspt.pages.dev/moto-x3m-dead-ahead.html)
- [RUN N SHOOT](https://eduquestses.pages.dev/run-n-shoot.html)
- [CATEGORY BASKETBALL 2](https://welearnaction.onrender.com/category-basketball-2.html)
- [PAINT POP 3D](https://eduquestkr.pages.dev/paint-pop-3d.html)
- [FARM OF WORDS](https://eduquestspt.pages.dev/farm-of-words.html)
- [SOPHIES FARM](https://ieduquests.web.app/sophies-farm.html)
- [BLOCK STACKING](https://eduquests.netlify.app/block-stacking.html)
- [SCREW NUTS BOLTS WOOD SOLVE](https://eduquestkr.pages.dev/screw-nuts-bolts-wood-solve.html)
- [CATEGORY ADVENTURE 4](https://ieduquests.web.app/category-adventure-4.html)
- [WORD RUSH](https://eduquestsfr.pages.dev/word-rush.html)
- [BLOCK PUZZLE TRAVEL](https://learnaction.netlify.app/block-puzzle-travel.html)
- [CATEGORY IO](https://eduquestsfr.pages.dev/category-io.html)
- [PUT THE FRUIT TOGETHER](https://eduquests.onrender.com/put-the-fruit-together.html)
- [TRICKY ARROW 2](https://eduquestses.pages.dev/tricky-arrow-2.html)
- [FLAMES FORTUNE](https://learnaction.github.io/flames-fortune.html)
- [CIRCUIT MASTER](https://eduquests.onrender.com/circuit-master.html)
- [NINJAROOF](https://learnaction.github.io/ninjaroof.html)
- [HERITAGE MAHJONG CLASSIC](https://eduquestsfr.pages.dev/heritage-mahjong-classic.html)
- [YOUTUBER MCRAFT 2PLAYER](https://brainquests.pages.dev/youtuber-mcraft-2player.html)
- [DINO SHOOTER PRO](https://brainquests.pages.dev/dino-shooter-pro.html)
- [CUDDLE MONSTER FUSION](https://eduquestspt.pages.dev/cuddle-monster-fusion.html)
- [MAHJONG 3D MATCH](https://brainquests.pages.dev/mahjong-3d-match.html)
- [BED WARS](https://brainquests.pages.dev/bed-wars.html)
- [SLIDING PUZZLE](https://brainquests.pages.dev/sliding-puzzle.html)
- [12 MINUTE ESCAPE](https://eduquests.pages.dev/12-minute-escape.html)
- [LINK FLOW](https://brainquests.pages.dev/link-flow.html)
- [PATTERNS](https://eduquests.onrender.com/patterns.html)
- [CATEGORY ROBOT49](https://eduquestkr.pages.dev/category-robot49.html)
- [BRIDGE WARS](https://eduquestsfr.pages.dev/bridge-wars.html)
- [CATEGORY CASUAL 12](https://eduquestsfr.pages.dev/category-casual-12.html)
- [FISH OUT OF WATER](https://brainquests.pages.dev/fish-out-of-water.html)
- [MERGE FOOD PUZZLE](https://eduquestkr.pages.dev/merge-food-puzzle.html)
- [SORT TILES](https://ieduquests.web.app/sort-tiles.html)
- [CATEGORY DRESS UP97](https://learnaction.netlify.app/category-dress-up97.html)
