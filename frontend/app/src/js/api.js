/**
 * api.js — Thin API client for Geo-Crop Collector
 * Handles JWT auth headers, token refresh, and all REST calls.
 */

import { LOCAL_LOCK_GRACE_MS } from './constants.js';
import { hashSecret, verifySecret, generateSalt } from './crypto.js';

const _isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
function _getApiBase() {
  if (window.APP_CONFIG?.apiBase) return window.APP_CONFIG.apiBase;
  const domain = localStorage.getItem('gc_server_domain') || 'geos.zingsageocrops.com';
  if (window.Capacitor) return `https://${domain}/api`;
  if (_isLocal) return `http://${window.location.hostname}:8001/api`;
  return `${window.location.protocol}//${window.location.hostname}/api`;
}
export const API_BASE = _getApiBase();

// ─── Token storage ────────────────────────────────────────────────────────────
export const auth = {
  get access()  { return localStorage.getItem('gc_access'); },
  get refresh() { return localStorage.getItem('gc_refresh'); },
  get user()    { return JSON.parse(localStorage.getItem('gc_user') || 'null'); },

  setTokens(access, refresh, user) {
    localStorage.setItem('gc_access',  access);
    localStorage.setItem('gc_refresh', refresh);
    if (user) localStorage.setItem('gc_user', JSON.stringify(user));
  },
  clear() {
    ['gc_access','gc_refresh','gc_user','gc_pwd_hash','gc_pwd_salt','gc_pwd_user']
      .forEach(k => localStorage.removeItem(k));
    // Keep app PIN + gc_local_lock_enabled; clear only “session unlocked” marker
    clearLocalLockSession();
  },
  isLoggedIn() { return !!this.access; },
  hasSession() { return !!(this.refresh && this.user); },
};

// ─── Offline credential helpers ──────────────────────────────────────────────
// Hashing lives in crypto.js: it uses the platform's PBKDF2 where available
// (~17 ms) and keeps the old pure-JS path as a fallback, so PIN unlock is fast
// without locking out a device that lacks crypto.subtle.

export function isNetworkError(err) {
  return err instanceof TypeError && /failed to fetch|network/i.test(err.message);
}

export async function verifyOfflineCredentials(username, password) {
  const storedUser = localStorage.getItem('gc_pwd_user');
  const storedHash = localStorage.getItem('gc_pwd_hash');
  const storedSalt = localStorage.getItem('gc_pwd_salt');
  const userData   = auth.user;

  if (!storedUser || !storedHash || !storedSalt || !userData) {
    return { ok: false, reason: 'No offline credentials cached. You must log in online first.' };
  }
  if (username !== storedUser) {
    return { ok: false, reason: 'Offline login only available for user "' + storedUser + '".' };
  }
  const { ok, upgraded } = await verifySecret(password, storedSalt, storedHash);
  if (!ok) {
    return { ok: false, reason: 'Incorrect password.' };
  }
  // Rewrite a slow-format hash now that we hold the plaintext, so the next
  // offline login uses the fast path.
  if (upgraded) localStorage.setItem('gc_pwd_hash', upgraded);
  return { ok: true, user: userData };
}

// ─── Local app lock (PIN) — device + app unlock trust model; separate from server JWT ─
// Trust: whoever passes device lock + this PIN may use cached identity offline.

const LS_LOCK_ENABLED = 'gc_local_lock_enabled';
const LS_PIN_HASH = 'gc_local_pin_hash';
const LS_PIN_SALT = 'gc_local_pin_salt';
const LS_LAST_OK = 'gc_local_lock_last_ok_ts';

export { LOCAL_LOCK_GRACE_MS };

/** Clear only the “recently unlocked” timestamp (e.g. on logout). PIN config may remain. */
export function clearLocalLockSession() {
  localStorage.removeItem(LS_LAST_OK);
}

export function isLocalLockEnabled() {
  return localStorage.getItem(LS_LOCK_ENABLED) === '1';
}

export function markLocalUnlock() {
  localStorage.setItem(LS_LAST_OK, String(Date.now()));
}

export function isWithinLocalLockGrace() {
  const t = parseInt(localStorage.getItem(LS_LAST_OK) || '0', 10);
  if (!t) return false;
  return (Date.now() - t) < LOCAL_LOCK_GRACE_MS;
}

/** Validate PIN format: exactly 6 digits. */
export function isValidAppPin(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

export async function setLocalLockPin(pin) {
  if (!isValidAppPin(pin)) throw new Error('PIN must be exactly 6 digits.');
  const salt = generateSalt();
  const hash = await hashSecret(pin, salt);
  localStorage.setItem(LS_PIN_SALT, salt);
  localStorage.setItem(LS_PIN_HASH, hash);
  localStorage.setItem(LS_LOCK_ENABLED, '1');
  markLocalUnlock();
}

export async function verifyLocalLockPin(pin) {
  const salt = localStorage.getItem(LS_PIN_SALT);
  const hash = localStorage.getItem(LS_PIN_HASH);
  if (!salt || !hash) return false;

  const { ok, upgraded } = await verifySecret(pin, salt, hash);
  // A PIN stored by the old slow scheme is rewritten on its first successful
  // unlock, so only that one unlock pays the old cost.
  if (ok && upgraded) localStorage.setItem(LS_PIN_HASH, upgraded);
  return ok;
}

/** Remove app lock entirely (PIN and settings). */
export function disableLocalLock() {
  localStorage.removeItem(LS_LOCK_ENABLED);
  localStorage.removeItem(LS_PIN_HASH);
  localStorage.removeItem(LS_PIN_SALT);
  localStorage.removeItem(LS_LAST_OK);
}

// ─── Token refresh ────────────────────────────────────────────────────────────
// One refresh at a time. The app fires several requests together (stats, map
// data, entries, surveys), so when the access token expires they all get a 401
// at once and would each POST /auth/refresh/ independently. Sharing a single
// in-flight promise means one request refreshes and the rest wait for it.
let _refreshInFlight = null;

/** Seconds of remaining validity below which the access token is renewed early. */
const REFRESH_MARGIN_S = 60;

/** Expiry of a JWT, or null if it cannot be read. */
function tokenExpiry(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp : null;
  } catch (_) {
    return null;   // opaque or malformed — fall back to reacting to a 401
  }
}

/**
 * Renew the access token *before* using it if it is about to expire.
 *
 * Reacting to a 401 costs an extra round trip on a slow link, and for an upload
 * it is worse than that: apiUpload had no refresh at all, so once the access
 * token aged out a collector's basemap or overlay upload simply failed. Far
 * better to spend 200 ms refreshing first than to push megabytes at a request
 * that cannot succeed.
 */
async function ensureFreshAccess() {
  if (!auth.access || !auth.refresh) return;
  const exp = tokenExpiry(auth.access);
  if (exp === null) return;
  if (exp - Date.now() / 1000 > REFRESH_MARGIN_S) return;
  try {
    await refreshAccessToken();
  } catch (err) {
    // A definitive rejection has already cleared credentials and signalled
    // logout — surface that, so the user is told to sign in again rather than
    // seeing whatever error the next unauthenticated request produces.
    if (!auth.refresh) throw err;
    // Otherwise offline or server trouble: carry on with the current token and
    // let the request itself report the failure.
  }
}

function refreshAccessToken() {
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    const res = await fetch(`${API_BASE}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: auth.refresh }),
    });

    if (res.ok) {
      const data = await res.json();
      auth.setTokens(data.access, data.refresh ?? auth.refresh, auth.user);
      return data.access;
    }

    // Only a definitive rejection ends the session. Anything else (a captive
    // portal, a 502 from a restarting server) must not throw away credentials
    // a collector cannot re-enter until they are back in signal.
    if (res.status === 401 || res.status === 403) {
      auth.clear();
      window.dispatchEvent(new Event('auth:logout'));
      throw new Error('Session ended. Please log in again.');
    }
    throw new Error(`Could not refresh session (${res.status}).`);
  })().finally(() => { _refreshInFlight = null; });

  return _refreshInFlight;
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  await ensureFreshAccess();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  if (auth.access) headers['Authorization'] = `Bearer ${auth.access}`;

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Token expired → refresh once, then retry. A network failure here throws
  // from fetch and propagates as an offline error, leaving the session intact.
  if (res.status === 401 && auth.refresh) {
    const access = await refreshAccessToken();
    headers['Authorization'] = `Bearer ${access}`;
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw Object.assign(new Error(err.detail || JSON.stringify(err)), { status: res.status, data: err });
  }

  return res.status === 204 ? null : res.json();
}

// Multipart form (for file uploads — no Content-Type header so browser sets boundary)
/**
 * Multipart upload with progress.
 *
 * Uses XMLHttpRequest rather than fetch because fetch cannot report upload
 * progress. Large basemaps and overlays take minutes on a rural link, and
 * without progress the UI cannot distinguish "still transferring" from
 * "server has hung" — both just sit on 'Uploading…'.
 *
 * onProgress(pct, phase): phase is 'upload' while bytes are in flight, then
 * 'processing' once the last byte is sent and the server is converting.
 */
async function apiUpload(path, formData, onProgress) {
  // Refresh before sending, not after failing: a rejected upload would have to
  // re-send the whole file.
  await ensureFreshAccess();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    if (auth.access) xhr.setRequestHeader('Authorization', `Bearer ${auth.access}`);

    if (onProgress) {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct, pct < 100 ? 'upload' : 'processing');
        }
      };
      xhr.upload.onload = () => onProgress(100, 'processing');
    }

    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      const detail = body?.detail || JSON.stringify(body) || xhr.statusText;
      reject(Object.assign(new Error(detail), { status: xhr.status }));
    };
    xhr.onerror   = () => reject(new Error('Network error during upload'));
    xhr.onabort   = () => reject(new Error('Upload cancelled'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));

    xhr.send(formData);
  });
}

// ─── Auth endpoints ────────────────────────────────────────────────────────────
export const authAPI = {
  async login(username, password) {
    const data = await apiFetch('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    auth.setTokens(data.access, data.refresh, data.user);

    // Cache password hash for offline login
    try {
      const salt = generateSalt();
      const hash = await hashSecret(password, salt);
      localStorage.setItem('gc_pwd_salt', salt);
      localStorage.setItem('gc_pwd_hash', hash);
      localStorage.setItem('gc_pwd_user', username);
    } catch (e) { console.warn('Offline credential caching failed:', e); }

    return data;
  },

  async register(payload) {
    return apiFetch('/auth/register/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async logout() {
    try {
      // Short timeout — don't hang if offline
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      await apiFetch('/auth/logout/', {
        method: 'POST',
        body: JSON.stringify({ refresh: auth.refresh }),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } finally {
      auth.clear();
    }
  },

  me:    () => apiFetch('/auth/me/'),
};

// ─── Fields endpoints ─────────────────────────────────────────────────────────
export const fieldsAPI = {
  list:       (params = {}) => apiFetch('/fields/?' + new URLSearchParams(params)),
  geojson:    ()            => apiFetch('/fields/geojson/'),
  get:        (id)          => apiFetch(`/fields/${id}/`),
  stats:      ()            => apiFetch('/fields/stats/'),

  create: (payload) => apiFetch('/fields/', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  update: (id, payload) => apiFetch(`/fields/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),

  delete: (id) => apiFetch(`/fields/${id}/`, { method: 'DELETE' }),

  uploadPhotos: (id, files) => {
    const fd = new FormData();
    files.forEach(f => fd.append('images', f));
    return apiUpload(`/fields/${id}/photos/`, fd);
  },

  validate: (id, payload) => apiFetch(`/fields/${id}/validate/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
};

// ─── MBTiles endpoints ────────────────────────────────────────────────────────
export const mbtilesAPI = {
  list: () => apiFetch('/mbtiles/'),
  get:  (id) => apiFetch(`/mbtiles/${id}/`),

  upload: (file, name, description = '', onProgress) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    fd.append('description', description);
    return apiUpload('/mbtiles/', fd, onProgress);
  },

  delete: (id) => apiFetch(`/mbtiles/${id}/`, { method: 'DELETE' }),

  /**
   * Stream-download a .mbtiles file into a single Uint8Array.
   * Calls onProgress(bytesReceived, totalBytes) on each chunk so the UI
   * can show a % counter. totalBytes is 0 if Content-Length is missing.
   */
  downloadWithProgress: async (id, onProgress) => {
    const url = `${API_BASE}/mbtiles/${id}/download/`;

    const _doFetch = (token) => fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    await ensureFreshAccess();
    let res = await _doFetch(auth.access || '');

    // Token expired → refresh once and retry, through the shared single-flight
    // helper. This used to run its own refresh and clear credentials on any
    // failed response, so a 502 part-way through a long basemap download over
    // a weak link logged the collector out — the worst possible moment, since
    // they are usually preparing to go offline when they use this.
    if (res.status === 401 && auth.refresh) {
      const access = await refreshAccessToken();
      res = await _doFetch(access);
    }

    if (!res.ok) throw new Error(`Download failed (${res.status})`);

    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(received, total);
    }

    // Concatenate all chunks into one Uint8Array — single memory allocation
    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    return buffer;
  },

  /** Clean download URL (no token in query string) — for native Capacitor use. */
  downloadUrl: (id) => `${API_BASE}/mbtiles/${id}/download/`,

  /**
   * Returns a Leaflet-compatible tile URL template with the JWT appended
   * as a query param so tile image requests are authenticated.
   * e.g. https://example.com/api/mbtiles/3/tiles/{z}/{x}/{y}.png?token=eyJ...
   */
  tileUrlWithToken: (id) => {
    const token = auth.access || '';
    return `${API_BASE}/mbtiles/${id}/tiles/{z}/{x}/{y}.png?token=${token}`;
  },
};

// ─── Survey endpoints ─────────────────────────────────────────────────────────
export const surveyAPI = {
  list:   ()          => apiFetch('/surveys/'),
  create: (data)      => apiFetch('/surveys/', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data)  => apiFetch(`/surveys/${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id)        => apiFetch(`/surveys/${id}/`, { method: 'DELETE' }),
};

// ─── Route Overlay endpoints ──────────────────────────────────────────────
export const overlayAPI = {
  list:    () => apiFetch('/overlays/'),
  get:     (id) => apiFetch(`/overlays/${id}/`),
  geojson: (id) => apiFetch(`/overlays/${id}/geojson/`),
  upload:  (file, name, description = '', onProgress) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    fd.append('description', description);
    return apiUpload('/overlays/', fd, onProgress);
  },
  delete: (id) => apiFetch(`/overlays/${id}/`, { method: 'DELETE' }),
};

// ─── Sync endpoints ───────────────────────────────────────────────────────────
export const syncAPI = {
  status: () => apiFetch('/sync/status/'),

  push: (entries) => apiFetch('/sync/push/', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  }),

  pull: (since) => apiFetch('/sync/pull/?' + (since ? `since=${encodeURIComponent(since)}` : '')),
};
