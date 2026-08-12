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

## Loading And Failure Behavior

Yuvomi scans `modules/` and validates each `module.json`. Invalid modules are shown as errored in Settings and are not loaded. Disabled modules are not served to the browser and do not appear in navigation. If a module page fails while rendering, Yuvomi shows an error for that page without changing core application code.

Admins can enable, disable, and order modules in Settings -> Personal -> Navigation. Ordering is per user and open to every member; the enable/disable switches are admin-only. Copying a new folder into `modules/` makes it appear there automatically.

## Compatibility Across Yuvomi Releases

`module.json` records the module's own version, not the Yuvomi version it was written against, and Yuvomi does not gate loading on a compatibility range. A module that calls an endpoint a later release renamed or moved therefore keeps loading and fails at the point of use, in front of the user.

Two endpoints help, though they answer at different times:

- `GET /api/v1/version` returns the running Yuvomi version to any caller holding a session or an API token. Without a credential the response still describes the instance, but omits the version.
- `GET /api/v1/openapi.json` describes the operations that version actually serves. It is admin-only, so treat it as a check you run while developing and against a new release before shipping, not as something every module instance can call at startup.

Compare the operations the module requires - method, path, and the response fields it reads - against that document while building, and again when a Yuvomi release moves. At runtime, where the document is usually out of reach, watch the version instead and read the failure: a `404` or `405` on an endpoint that worked before means the operation moved, and that is the point to degrade rather than retry. Three outcomes cover the realistic cases: run normally; keep stored data, review and export readable while blocking writes; or show a dependency error with a retry control. Refusing a write is better than issuing it against an endpoint whose meaning has changed.

Third-party modules should build on `/api/v1` and the public browser libraries described above; breaking changes to those are called out in the CHANGELOG. Direct database access, private helpers under `server/`, and undocumented response fields sit outside that line and may change in any release without notice.

## Docker / Podman

The default `docker-compose.yml` mounts `${MODULES_DIR:-./modules}` to `/app/modules`. To keep modules outside the Yuvomi checkout, set `MODULES_DIR=/absolute/path/to/yuvomi-modules` in `.env` and restart the compose service. New or changed module folders are scanned at runtime; rebuilding the image is not required.

On Podman (RHEL/Fedora/CentOS Stream) use `podman-compose.yml` instead — it mounts the same `/app/modules` path with the SELinux `:Z` relabel so the rootless container can read your modules.

On Portainer the stack mounts a named volume (`oikos_modules`) at `/app/modules`, since a Portainer deployment has no repository checkout to bind-mount from. Copy module folders into that volume (for example via `docker cp` into the running container, or a temporary container mounting the volume); a bind mount to a host path works too if you edit the stack.
