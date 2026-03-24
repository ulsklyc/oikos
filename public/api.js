/**
 * Modul: API-Client
 * Zweck: Fetch-Wrapper mit Session-Auth, einheitlicher Fehlerbehandlung und JSON-Parsing
 * Abhängigkeiten: keine
 */

const API_BASE = '/api/v1';

/** Liest den CSRF-Token aus dem Cookie (gesetzt vom Server nach Login). */
function getCsrfToken() {
  return document.cookie.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csrf-token='))
    ?.slice('csrf-token='.length) ?? '';
}

/**
 * Zentraler Fetch-Wrapper.
 * Setzt Content-Type, handhabt 401-Redirects und parsed JSON-Fehler.
 *
 * @param {string} path - API-Pfad ohne /api/v1 (z.B. '/tasks')
 * @param {RequestInit} options - Fetch-Optionen
 * @returns {Promise<any>} Geparstes JSON oder wirft einen Fehler
 */
async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;

  const method = options.method ?? 'GET';
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(stateChanging ? { 'X-CSRF-Token': getCsrfToken() } : {}),
      ...options.headers,
    },
    ...options,
  });

  if (response.status === 401) {
    // Session abgelaufen → zur Login-Seite
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('Sitzung abgelaufen.');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data;
}

/**
 * Strukturierter API-Fehler mit HTTP-Status-Code.
 */
class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// --------------------------------------------------------
// Convenience-Methoden
// --------------------------------------------------------

const api = {
  get: (path) => apiFetch(path, { method: 'GET' }),

  post: (path, body) => apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  put: (path, body) => apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  patch: (path, body) => apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),

  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};

// --------------------------------------------------------
// Auth-spezifische Methoden
// --------------------------------------------------------

const auth = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  getUsers: () => api.get('/auth/users'),
  createUser: (data) => api.post('/auth/users', data),
  deleteUser: (id) => api.delete(`/auth/users/${id}`),
};

export { api, auth, ApiError };
