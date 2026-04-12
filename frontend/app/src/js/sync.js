/**
 * sync.js — Offline queue and device sync manager
 *
 * When offline: entries are queued in IndexedDB.
 * When back online: queue is flushed to the server via /api/sync/push/
 * Pull from server: merge server entries into local state.
 */

import { syncAPI } from './api.js';

const DB_NAME    = 'geocrop_offline';
const STORE_NAME = 'pending_entries';
const META_STORE = 'meta';
const DB_VERSION = 1;

let db = null;

// ─── IndexedDB setup ──────────────────────────────────────────────────────────
export async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        idb.createObjectStore(STORE_NAME, { keyPath: 'client_uuid' });
      }
      if (!idb.objectStoreNames.contains(META_STORE)) {
        idb.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbGet(store, key) {
  const idb = await openDB();
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbPut(store, value) {
  const idb = await openDB();
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbDelete(store, key) {
  const idb = await openDB();
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

async function idbGetAll(store) {
  const idb = await openDB();
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/** Queue an entry when offline. */
export async function queueEntry(entry) {
  if (!entry.client_uuid) {
    entry.client_uuid = generateUUID();
  }
  await idbPut(STORE_NAME, entry);
  return entry.client_uuid;
}

/** Get count of pending (unsynced) entries. */
export async function pendingCount() {
  const all = await idbGetAll(STORE_NAME);
  return all.length;
}

/** Flush all pending entries to the server. Returns sync result. */
export async function flushPending() {
  const pending = await idbGetAll(STORE_NAME);
  if (!pending.length) return { pushed: 0, errors: [] };

  const result = await syncAPI.push(pending);

  // Remove successfully synced entries from the queue
  const errorUUIDs = new Set(
    (result.errors || []).map(e => pending[e.index]?.client_uuid).filter(Boolean)
  );
  for (const entry of pending) {
    if (!errorUUIDs.has(entry.client_uuid)) {
      await idbDelete(STORE_NAME, entry.client_uuid);
    }
  }

  return { pushed: result.created, errors: result.errors || [] };
}

/** Pull new entries from server since last sync. */
export async function pullFromServer() {
  const meta = await idbGet(META_STORE, 'last_pull_ts');
  const since = meta?.value || null;

  const result = await syncAPI.pull(since);

  // Save new server_ts
  await idbPut(META_STORE, { key: 'last_pull_ts', value: result.server_ts });

  return result.entries || [];
}

/** Full sync: flush pending → pull from server. */
export async function fullSync(onProgress) {
  const log = msg => { if (onProgress) onProgress(msg); };
  const report = { pushed: 0, pulled: 0, errors: [] };

  try {
    log('Pushing offline entries…');
    const pushResult = await flushPending();
    report.pushed = pushResult.pushed;
    report.errors = pushResult.errors;
    log(`Pushed ${pushResult.pushed} entries.`);
  } catch (e) {
    log('Push failed: ' + e.message);
    report.pushError = e.message;
  }

  try {
    log('Pulling server updates…');
    const pulled = await pullFromServer();
    report.pulled = pulled.length;
    log(`Pulled ${pulled.length} new/updated entries.`);
    return { ...report, pulled_entries: pulled };
  } catch (e) {
    log('Pull failed: ' + e.message);
    report.pullError = e.message;
    return report;
  }
}
