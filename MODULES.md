# Yuvomi Modules

Yuvomi loads third-party modules from the repository-level `modules/` directory. Each module lives in its own folder and must include a `module.json` manifest. Modules are separate code: do not edit Yuvomi core files to install one.

## Folder Layout

```text
modules/
  example-module/
    module.json
    index.js
    style.css
```

The folder name must match the manifest `id`.

## Manifest

```json
{
  "id": "example-module",
  "name": "Example Module",
  "version": "1.0.0",
  "description": "Adds a small page to Yuvomi.",
  "entry": "index.js",
  "style": "style.css",
  "icon": "box",
  "accent": "#6366F1",
  "menu": {
    "show": true,
    "label": "Example",
    "icon": "box",
    "order": 100
  }
}
```

Required fields:

- `id`: lowercase letters, numbers and hyphens only. Must match the module folder.
- `entry`: a relative `.js` file exporting a `render(container, context)` function.

Optional fields:

- `style`: a relative `.css` file loaded only for this module page.
- `menu.show`: set to `false` if the module should not appear in the left menu.
- `menu.label`, `menu.icon`, `menu.order`: left-menu label, Lucide icon name, and order.
- `accent`: a `#RRGGBB` color. It is your module's **tone**: the app exposes it as
  `--active-module-accent` while your page is open, so your own content can use it, and it colors
  the browser/PWA status bar on your route. Since v2.2.0 it no longer colors the app's chrome -
  the navigation, the action button and shared controls carry the app's own accent in every module
  (see the one-voice rule in `docs/SPEC.md`), so the frame does not change color when a visitor
  opens your page.

## Client Entry

```js
import { api } from '/api.js';
import { esc } from '/utils/html.js';

export async function render(container, context) {
  const me = await api.get('/auth/me');
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="page">
      <div class="page__header">
        <h1 class="page__title">Example Module</h1>
      </div>
      <section class="settings-card">
        <p>Hello, ${esc(me.user.display_name)}</p>
      </section>
    </div>
  `);
}
```

Modules may import public Yuvomi browser libraries such as `/api.js`, `/i18n.js`, and utilities under `/utils/`. For calls to Yuvomi's built-in REST API, prefer `import { api } from '/api.js'`: it prefixes requests with `/api/v1`, sends the current session credentials, handles CSRF tokens, and uses non-cached fetches for user data.

If a module calls a separate backend service through a reverse proxy, expose that service on a same-origin `/api/...` path whenever the response is dynamic. Yuvomi's service worker deliberately bypasses `/api/` requests, while other same-origin GET requests may be handled by the app-shell caching strategy. A dynamic proxy path such as `/ext/myservice/...` can therefore return stale cached responses unless you also change the service-worker strategy.

Modules must follow the same frontend security rules as core Yuvomi:

- Use `replaceChildren()` and `insertAdjacentHTML()`.
- Escape untrusted values before inserting HTML.
- Do not use external CDNs.
- Do not use `innerHTML`.
- Do not bypass authentication, authorization, CSRF, or CSP.

## Modules With A Backend Service

A module page is browser code with no server of its own. When a module needs stored state, scheduled work, or a third-party credential, run that as a separate service beside Yuvomi rather than as a patch to core, and leave Yuvomi on its official image. What follows is what such a module needs in order to survive a Yuvomi upgrade.

Serve the service from the same origin under an `/api/` path; `/api/extensions/<module-id>/` is a reasonable convention. Browser requests then carry the Yuvomi session cookie, and the service worker leaves them alone. The stale-cache trap described above applies to any dynamic path outside `/api/`.

Do not open `yuvomi.db`. It is core's private storage: the schema changes between releases without notice, and a second writer breaks Yuvomi's own migrations. Read and write through `/api/v1` instead. If the data a module needs is not reachable through the API, that is a missing endpoint worth an issue, not a reason to reach for the file.

Re-check identity on the server for every request. Forward the incoming Yuvomi session cookie to `GET /api/v1/auth/me` over the internal Yuvomi URL, and trust only that response for the user id, role, and permissions. The browser half of a module is not a trusted caller: never accept a user id or role from a request body.

Cache that answer briefly rather than resolving it on every call. Yuvomi rate-limits `/api/` to 300 requests per minute per IP, and a service that does not forward the caller's address spends that budget from its own container IP for all of its users at once - the first symptom is a `429` for everyone. A few seconds of cache keyed on the session cookie is enough, and short enough that a logout still takes effect.

Yuvomi's CSRF token protects Yuvomi's endpoints, not a module's. State-changing routes on the service should independently require:

- a valid Yuvomi session, verified as above;
- an `Origin` matching the public host;
- the service's own double-submit CSRF cookie and header pair;
- an endpoint-specific role or ownership check.

Scheduled jobs have no session. Issue an API token under Settings -> Admin -> API Access (admin-only, so a module that needs one has to ask the household's admin for it) with only the scopes the module needs - `budget:read` and `budget:write`, for example - and keep it in the service's secrets, never in the module folder, a Compose file, or browser storage. Keep the service's own state in the service's own database, and treat stored secrets as write-only: expose `has_api_token: true`, never a fragment of the token itself.

## Loading And Failure Behavior

Yuvomi scans `modules/` and validates each `module.json`. Invalid modules are shown as errored in Settings and are not loaded. Disabled modules are not served to the browser and do not appear in navigation. If a module page fails while rendering, Yuvomi shows an error for that page without changing core application code.

Admins can enable, disable, and order modules in Settings -> Personal -> Navigation. Ordering is per user and open to every member; the enable/disable switches are admin-only. Copying a new folder into `modules/` makes it appear there automatically.

## Docker / Podman

The default `docker-compose.yml` mounts `${MODULES_DIR:-./modules}` to `/app/modules`. To keep modules outside the Yuvomi checkout, set `MODULES_DIR=/absolute/path/to/yuvomi-modules` in `.env` and restart the compose service. New or changed module folders are scanned at runtime; rebuilding the image is not required.

On Podman (RHEL/Fedora/CentOS Stream) use `podman-compose.yml` instead — it mounts the same `/app/modules` path with the SELinux `:Z` relabel so the rootless container can read your modules.

On Portainer the stack mounts a named volume (`oikos_modules`) at `/app/modules`, since a Portainer deployment has no repository checkout to bind-mount from. Copy module folders into that volume (for example via `docker cp` into the running container, or a temporary container mounting the volume); a bind mount to a host path works too if you edit the stack.
