/**
 * api.js — Thin API client for Geo-Crop Collector
 * Handles JWT auth headers, token refresh, and all REST calls.
 */

import { LOCAL_LOCK_GRACE_MS } from './constants.js';

// For Capacitor Android builds, replace this IP with your Django server's public IP address before compiling.
const _SERVER_DOMAIN = 'geos.zingsageocrops.com';
const _isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
export const API_BASE = window.APP_CONFIG?.apiBase || (
  window.Capacitor
    ? `https://${_SERVER_DOMAIN}/api`
    : (_isLocal
        ? `http://${window.location.hostname}:8001/api`
        : `${window.location.protocol}//${window.location.hostname}/api`)
);

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
// Pure JS SHA-256 (no crypto.subtle needed — works in insecure WebView contexts)
function sha256(msg) {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  const rr = (v,n) => (v>>>n)|(v<<(32-n));
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const bytes = typeof msg==='string' ? new TextEncoder().encode(msg) : msg;
  const bl = bytes.length*8;
  const pad = new Uint8Array(((bytes.length+9+63)&~63));
  pad.set(bytes); pad[bytes.length]=0x80;
  new DataView(pad.buffer).setUint32(pad.length-4, bl, false);
  for (let off=0; off<pad.length; off+=64) {
    const w = new Int32Array(64);
    for (let i=0;i<16;i++) w[i]=new DataView(pad.buffer).getInt32(off+i*4,false);
    for (let i=16;i<64;i++){const s0=rr(w[i-15],7)^rr(w[i-15],18)^(w[i-15]>>>3);const s1=rr(w[i-2],17)^rr(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0;}
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i=0;i<64;i++){const S1=rr(e,6)^rr(e,11)^rr(e,25);const ch=(e&f)^(~e&g);const t1=(h+S1+ch+K[i]+w[i])|0;const S0=rr(a,2)^rr(a,13)^rr(a,22);const mj=(a&b)^(a&c)^(b&c);const t2=(S0+mj)|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+h)|0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}

function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hashPassword(password, saltHex) {
  // Iterated SHA-256: hash(salt+password) 10000 times
  let h = sha256(saltHex + password);
  for (let i = 0; i < 9999; i++) h = sha256(saltHex + h);
  return h;
}

export function isNetworkError(err) {
  return err instanceof TypeError && /failed to fetch|network/i.test(err.message);
}

export function verifyOfflineCredentials(username, password) {
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
  const hash = hashPassword(password, storedSalt);
  if (hash !== storedHash) {
    return { ok: false, reason: 'Incorrect password.' };
  }
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

export function setLocalLockPin(pin) {
  if (!isValidAppPin(pin)) throw new Error('PIN must be exactly 6 digits.');
  const salt = generateSalt();
  const hash = hashPassword(pin, salt);
  localStorage.setItem(LS_PIN_SALT, salt);
  localStorage.setItem(LS_PIN_HASH, hash);
  localStorage.setItem(LS_LOCK_ENABLED, '1');
  markLocalUnlock();
}

export function verifyLocalLockPin(pin) {
  const salt = localStorage.getItem(LS_PIN_SALT);
  const hash = localStorage.getItem(LS_PIN_HASH);
  if (!salt || !hash) return false;
  return hashPassword(pin, salt) === hash;
}

/** Remove app lock entirely (PIN and settings). */
export function disableLocalLock() {
  localStorage.removeItem(LS_LOCK_ENABLED);
  localStorage.removeItem(LS_PIN_HASH);
  localStorage.removeItem(LS_PIN_SALT);
  localStorage.removeItem(LS_LAST_OK);
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  if (auth.access) headers['Authorization'] = `Bearer ${auth.access}`;

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Token expired → try refresh
  if (res.status === 401 && auth.refresh) {
    const refreshed = await fetch(`${API_BASE}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: auth.refresh }),
    });
    if (refreshed.ok) {
      const data = await refreshed.json();
      auth.setTokens(data.access, data.refresh ?? auth.refresh, auth.user);
      headers['Authorization'] = `Bearer ${data.access}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } else {
      auth.clear();
      window.dispatchEvent(new Event('auth:logout'));
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw Object.assign(new Error(err.detail || JSON.stringify(err)), { status: res.status, data: err });
  }

  return res.status === 204 ? null : res.json();
}

// Multipart form (for file uploads — no Content-Type header so browser sets boundary)
async function apiUpload(path, formData) {
  const headers = {};
  if (auth.access) headers['Authorization'] = `Bearer ${auth.access}`;
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw Object.assign(new Error(err.detail || JSON.stringify(err)), { status: res.status });
  }
  return res.json();
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
      const hash = hashPassword(password, salt);
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

  upload: (file, name, description = '') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    fd.append('description', description);
    return apiUpload('/mbtiles/', fd);
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

    let res = await _doFetch(auth.access || '');

    // Token expired → refresh once and retry (same pattern as apiFetch)
    if (res.status === 401 && auth.refresh) {
      const refreshed = await fetch(`${API_BASE}/auth/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: auth.refresh }),
      });
      if (refreshed.ok) {
        const data = await refreshed.json();
        auth.setTokens(data.access, data.refresh ?? auth.refresh, auth.user);
        res = await _doFetch(data.access);
      } else {
        auth.clear();
        window.dispatchEvent(new Event('auth:logout'));
        throw new Error('Session expired. Please log in again.');
      }
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
  upload:  (file, name, description = '') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    fd.append('description', description);
    return apiUpload('/overlays/', fd);
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
