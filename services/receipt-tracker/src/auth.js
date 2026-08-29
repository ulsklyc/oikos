/**
 * Identity for every request comes from Yuvomi itself, never from the
 * request body — the browser half of a module is not a trusted caller.
 * We forward the incoming Yuvomi session cookie to the real
 * GET /api/v1/auth/me over the internal URL and trust only that response
 * for user id / role. Cached briefly per cookie value so we don't burn
 * Yuvomi's 300 req/min/IP budget on every call (MODULES.md).
 */

const YUVOMI_INTERNAL_URL = process.env.YUVOMI_INTERNAL_URL || 'http://localhost:3000';
const CACHE_TTL_MS = 5000;

const cache = new Map(); // cookieHeader -> { at, user }

async function resolveUser(cookieHeader) {
  if (!cookieHeader) return null;

  const cached = cache.get(cookieHeader);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.user;
  }

  let user = null;
  try {
    const res = await fetch(`${YUVOMI_INTERNAL_URL}/api/v1/auth/me`, {
      headers: { cookie: cookieHeader },
    });
    if (res.ok) {
      const body = await res.json();
      user = body.user || null;
    }
  } catch {
    // Yuvomi unreachable — treat as unauthenticated rather than throwing,
    // so the failure mode is a clean 401, not a crash.
    user = null;
  }

  cache.set(cookieHeader, { at: Date.now(), user });
  return user;
}

/** Express middleware: attaches req.yuvomiUser or rejects with 401. */
export async function requireYuvomiSession(req, res, next) {
  const user = await resolveUser(req.headers.cookie);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated with Yuvomi.', code: 401 });
  }
  req.yuvomiUser = user;
  next();
}

/** Express middleware: requireYuvomiSession, plus role === 'admin'. */
export async function requireYuvomiAdmin(req, res, next) {
  const user = await resolveUser(req.headers.cookie);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated with Yuvomi.', code: 401 });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.', code: 403 });
  }
  req.yuvomiUser = user;
  next();
}
