// local-layers.js — Local on-device storage for MBTiles and overlays
// Capacitor APK: native file-based SQLite (supports 8GB+ files)
// Web browser: sql.js WebAssembly (smaller files only)

import { state } from './state.js';
import { toast, esc, attr } from './utils.js';
import { rebuildLayerControl } from './map.js';
import { getSqlJs } from './sqljs.js';
import { GpkgSource } from './gpkg-source.js';
import { GeoJSONSource } from './geojson-source.js';
import { styleFnsFor, applyColorToLayer, colorSwatchHtml, setOverlayColor } from './overlay-colors.js';

/** Max features decoded for one screen. Beyond this the user is told to zoom in. */
const VIEWPORT_FEATURE_CAP = 3000;

/** Debounce for map movement, so a pan does not fire a query per frame. */
const VIEWPORT_REFRESH_MS = 180;

const isCapacitor = !!window.Capacitor;

// ─── Native plugin bridge (Capacitor only) ──────────────────────────────────

function getNativePlugin() {
  return window.Capacitor?.Plugins?.MBTilesPlugin || null;
}

// ─── IndexedDB for web fallback & overlays ───────────────────────────────────

const DB_NAME    = 'geocrop_local_layers';
const DB_VERSION = 1;
const OV_STORE   = 'local_overlays';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OV_STORE)) {
        db.createObjectStore(OV_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

function idbPut(storeName, record) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function idbGetAll(storeName) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function idbGet(storeName, id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function idbDelete(storeName, id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

// sql.js is shared with gpkg-source.js — see ./sqljs.js

// ═══════════════════════════════════════════════════════════════════════════════
// MBTiles Import — native on Capacitor, sql.js on web
// ═══════════════════════════════════════════════════════════════════════════════

export async function importLocalMBTiles(file, name) {
  if (isCapacitor) {
    return importMBTilesNative(file, name);
  }
  return importMBTilesWeb(file, name);
}

/**
 * Web-only: import an MBTiles file from a Uint8Array (streamed download).
 * Bypasses the Blob→File→ArrayBuffer double-copy to minimise peak memory.
 * On Capacitor, use the native importFromUrl plugin method instead.
 */
export async function importMBTilesFromBuffer(uint8Array, name) {
  if (uint8Array.byteLength > 20000 * 1024 * 1024) {
    throw new Error(`File is ${(uint8Array.byteLength / (1024 * 1024)).toFixed(0)} MB — exceeds the 20,000 MB limit.`);
  }
  const sig = String.fromCharCode(...uint8Array.slice(0, 15));
  if (sig !== 'SQLite format 3') throw new Error('Not a valid MBTiles (SQLite) file.');

  const SQL = await getSqlJs();
  const db = new SQL.Database(uint8Array);
  let meta = {};
  try {
    const result = db.exec('SELECT name, value FROM metadata');
    if (result.length) for (const row of result[0].values) meta[row[0]] = row[1];
  } catch (_) {}

  const id = 'web_' + Date.now();
  const record = {
    id, name,
    fileSize: uint8Array.byteLength,
    fileSizeMB: (uint8Array.byteLength / (1024 * 1024)).toFixed(1),
    ...readZoomRange(db, meta),
    bounds: meta.bounds || '',
    center: meta.center || '',
    importedAt: new Date().toISOString(),
  };

  _webMBTilesDbs[id] = db;
  _webMBTilesMeta[id] = record;
  _saveWebMBTilesMeta();
  return record;
}


/**
 * Zoom range of an MBTiles file, preferring the metadata table but falling
 * back to the tiles themselves.
 *
 * `maxzoom` is often missing or 0 in files exported by GIS tools, and treating
 * that as 18 tells Leaflet detail exists that does not — so it requests tiles
 * that are not there and the basemap goes blank when a collector zooms in.
 * MAX(zoom_level) is answered from the (zoom_level, tile_column, tile_row)
 * index that MBTiles files carry, so it is cheap even on a large file.
 */
function readZoomRange(db, meta) {
  let min = parseInt(meta.minzoom, 10);
  let max = parseInt(meta.maxzoom, 10);

  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(min)) {
    try {
      const r = db.exec('SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles');
      if (r.length && r[0].values.length) {
        const [dbMin, dbMax] = r[0].values[0];
        if (!Number.isFinite(min) && dbMin != null) min = Number(dbMin);
        if ((!Number.isFinite(max) || max <= 0) && dbMax != null) max = Number(dbMax);
      }
    } catch (_) { /* unreadable tiles table — fall through to defaults */ }
  }

  return {
    minZoom: Number.isFinite(min) && min >= 0 ? min : 0,
    maxZoom: Number.isFinite(max) && max > 0 ? max : 18,
  };
}

// ── Native import (Capacitor APK) ────────────────────────────────────────────
// The native plugin streams the file to disk — never loads into memory.
// The file input gives us a content:// URI on Android.

async function importMBTilesNative(file, name) {
  const plugin = getNativePlugin();
  if (!plugin) throw new Error('MBTiles plugin not available');

  // Use native file picker + stream copy (handles files up to 8GB+)
  const result = await plugin.pickAndImport({ name });
  return {
    id: result.id,
    name: result.name,
    fileSize: result.fileSize,
    fileSizeMB: result.fileSizeMB,
    minZoom: result.minZoom,
    maxZoom: result.maxZoom,
    bounds: result.bounds || '',
    center: result.center || '',
  };
}

// ── Web import (browser only — limited by available memory) ──────────────────

async function importMBTilesWeb(file, name) {
  const arrayBuffer = await file.arrayBuffer();
  const header = new Uint8Array(arrayBuffer.slice(0, 16));
  const sig = String.fromCharCode(...header.slice(0, 15));
  if (sig !== 'SQLite format 3') {
    throw new Error('File does not appear to be a valid MBTiles (SQLite) file.');
  }

  const SQL = await getSqlJs();
  const db = new SQL.Database(new Uint8Array(arrayBuffer));
  let meta = {};
  try {
    const result = db.exec('SELECT name, value FROM metadata');
    if (result.length) {
      for (const row of result[0].values) meta[row[0]] = row[1];
    }
  } catch (_) {}

  // Store just the metadata in IndexedDB (not the full file)
  // and keep the sql.js database in memory for the session
  const id = 'web_' + Date.now();
  const record = {
    id,
    name,
    fileSize: file.size,
    fileSizeMB: (file.size / (1024 * 1024)).toFixed(1),
    ...readZoomRange(db, meta),
    bounds: meta.bounds || '',
    center: meta.center || '',
    importedAt: new Date().toISOString(),
  };

  // Cache the open db for tile serving
  _webMBTilesDbs[id] = db;
  // Store metadata only (not the full binary)
  _webMBTilesMeta[id] = record;
  // Persist metadata to localStorage
  _saveWebMBTilesMeta();

  return record;
}

// Web-only: in-memory db cache + localStorage metadata
const _webMBTilesDbs = {};
let _webMBTilesMeta = {};

function _loadWebMBTilesMeta() {
  try {
    _webMBTilesMeta = JSON.parse(localStorage.getItem('gc_local_mbt_meta') || '{}');
  } catch (_) { _webMBTilesMeta = {}; }
}
function _saveWebMBTilesMeta() {
  localStorage.setItem('gc_local_mbt_meta', JSON.stringify(_webMBTilesMeta));
}
_loadWebMBTilesMeta();

// ═══════════════════════════════════════════════════════════════════════════════
// MBTiles List
// ═══════════════════════════════════════════════════════════════════════════════

export async function listLocalMBTiles() {
  if (isCapacitor) {
    const plugin = getNativePlugin();
    if (!plugin) return [];
    const result = await plugin.list();
    const items = result.items || [];
    return items.map(r => ({
      id: r.id, name: r.name,
      fileSize: r.fileSize, fileSizeMB: r.fileSizeMB,
      minZoom: r.minZoom, maxZoom: r.maxZoom,
      bounds: r.bounds || '',
    }));
  }
  // Web: return from localStorage metadata
  return Object.values(_webMBTilesMeta).filter(r => _webMBTilesDbs[r.id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MBTiles Delete
// ═══════════════════════════════════════════════════════════════════════════════

export async function deleteLocalMBTiles(id) {
  const key = `local_${id}`;
  if (state.localMBTilesLayers[key]) {
    state.map.removeLayer(state.localMBTilesLayers[key]);
    delete state.localMBTilesLayers[key];
    rebuildLayerControl();
  }

  if (isCapacitor) {
    const plugin = getNativePlugin();
    if (plugin) await plugin.deleteFile({ id });
  } else {
    if (_webMBTilesDbs[id]) { _webMBTilesDbs[id].close(); delete _webMBTilesDbs[id]; }
    delete _webMBTilesMeta[id];
    _saveWebMBTilesMeta();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MBTiles Tile Layer — serves tiles from native or web
// ═══════════════════════════════════════════════════════════════════════════════

const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Highest zoom the map itself allows; layers scale their own tiles up to it. */
const MAP_MAX_ZOOM = 24;

/**
 * Leaflet zoom options for a tile source that only covers part of the range.
 *
 * min/maxNativeZoom tell Leaflet the deepest and shallowest zoom levels that
 * actually exist in the file. Past those it reuses the nearest real tile and
 * scales it, instead of requesting tiles that were never in the .mbtiles and
 * rendering blank — which is what made the basemap vanish as soon as a
 * collector zoomed in past the file's max zoom.
 *
 * The values are validated rather than trusted: MBTiles metadata is frequently
 * absent or zero, and `maxZoom || 18` quietly turns a missing value into a
 * promise of detail the file does not have.
 */
function nativeZoomOptions(minZoom, maxZoom) {
  const max = Number(maxZoom);
  const min = Number(minZoom);
  const opts = { minZoom: 0, maxZoom: MAP_MAX_ZOOM, tileSize: 256 };

  // Range-checked like the server's _valid_zoom: a value outside 1..24 is not
  // a real zoom level, so it is treated as unknown rather than clamped — that
  // keeps maxNativeZoom strictly below the layer's own maxZoom, which is what
  // leaves Leaflet room to upscale.
  opts.maxNativeZoom = (Number.isFinite(max) && max > 0 && max <= MAP_MAX_ZOOM)
    ? Math.round(max)
    : 18;   // unknown: assume a full-depth source

  if (Number.isFinite(min) && min > 0) opts.minNativeZoom = Math.min(Math.round(min), opts.maxNativeZoom);

  return opts;
}

export function createLocalMBTilesLayer(id, name, minZoom, maxZoom) {
  // Native metadata lives in the plugin, web metadata in _webMBTilesMeta, so
  // the caller passes the values it already has rather than this guessing.
  const meta = _webMBTilesMeta[id] || {};
  const zooms = nativeZoomOptions(
    minZoom != null ? minZoom : meta.minZoom,
    maxZoom != null ? maxZoom : meta.maxZoom,
  );
  return isCapacitor
    ? createNativeTileLayer(id, name, zooms)
    : createWebTileLayer(id, name, zooms);
}

function createNativeTileLayer(id, name, zooms) {
  const plugin = getNativePlugin();
  const maxNative = zooms.maxNativeZoom;
  const LayerClass = L.GridLayer.extend({
    createTile: function(coords, done) {
      const tile = document.createElement('img');
      tile.setAttribute('role', 'presentation');
      const zDiff = Math.max(0, coords.z - maxNative);
      const z = coords.z - zDiff;
      const x = Math.floor(coords.x / Math.pow(2, zDiff));
      const y = Math.floor(coords.y / Math.pow(2, zDiff));

      plugin.getTile({ id, z, x, y }).then(result => {
        if (result.data) {
          tile.onload = () => done(null, tile);
          tile.onerror = () => { tile.src = EMPTY_TILE; done(null, tile); };
          tile.src = `data:${result.contentType || 'image/png'};base64,${result.data}`;
        } else {
          tile.src = EMPTY_TILE;
          done(null, tile);
        }
      }).catch(() => {
        tile.src = EMPTY_TILE;
        done(null, tile);
      });

      return tile;
    }
  });

  return new LayerClass({
    ...zooms,
    attribution: `📱 ${name} (local)`
  });
}

function createWebTileLayer(id, name, zooms) {
  const maxNative = zooms.maxNativeZoom;
  const LayerClass = L.GridLayer.extend({
    createTile: function(coords, done) {
      const tile = document.createElement('img');
      tile.setAttribute('role', 'presentation');
      const zDiff = Math.max(0, coords.z - maxNative);
      const z = coords.z - zDiff;
      const x = Math.floor(coords.x / Math.pow(2, zDiff));
      const y = Math.floor(coords.y / Math.pow(2, zDiff));
      const tmsY = (1 << z) - 1 - y;

      const db = _webMBTilesDbs[id];
      if (!db) { tile.src = EMPTY_TILE; done(null, tile); return tile; }

      try {
        const result = db.exec(
          'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
          [z, x, tmsY]
        );
        if (result.length && result[0].values.length) {
          const data = result[0].values[0][0];
          const blob = new Blob([data], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          tile.onload = () => { URL.revokeObjectURL(url); done(null, tile); };
          tile.onerror = () => { URL.revokeObjectURL(url); tile.src = EMPTY_TILE; done(null, tile); };
          tile.src = url;
        } else {
          tile.src = EMPTY_TILE;
          done(null, tile);
        }
      } catch (_) {
        tile.src = EMPTY_TILE;
        done(null, tile);
      }

      return tile;
    }
  });

  return new LayerClass({
    ...zooms,
    attribution: `📱 ${name} (local)`
  });
}

export function toggleLocalMBTilesLayer(id, name, boundsStr, minZoom, maxZoom) {
  const key = `local_${id}`;
  const btn = document.getElementById(`lmbt-btn-${id}`);

  if (state.localMBTilesLayers[key]) {
    state.map.removeLayer(state.localMBTilesLayers[key]);
    delete state.localMBTilesLayers[key];
    if (btn) { btn.textContent = '🗺 Load'; btn.style.color = ''; }
    rebuildLayerControl();
    return;
  }

  const layer = createLocalMBTilesLayer(id, name, minZoom, maxZoom);
  layer.addTo(state.map);
  layer._overlayName = name;
  state.localMBTilesLayers[key] = layer;

  if (btn) { btn.textContent = '✅ Loaded'; btn.style.color = 'var(--earth)'; }

  if (boundsStr) {
    const [minLng, minLat, maxLng, maxLat] = boundsStr.split(',').map(Number);
    if (!isNaN(minLng)) state.map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
  }

  rebuildLayerControl();
  toast(`✅ Local layer loaded: ${name}`, 'ok');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Local Overlay — Capacitor: file stays on native disk, metadata in localStorage
//                 Web:       full GeoJSON stored in IndexedDB (smaller files)
// ═══════════════════════════════════════════════════════════════════════════════

// Lightweight metadata store for Capacitor native overlays (avoids IndexedDB 64 MB limit)
const _nativeOvMeta = {};
function _loadNativeOvMeta() {
  try { Object.assign(_nativeOvMeta, JSON.parse(localStorage.getItem('gc_native_ov_meta') || '{}')); } catch (_) {}
}
function _saveNativeOvMeta() {
  localStorage.setItem('gc_native_ov_meta', JSON.stringify(_nativeOvMeta));
}
_loadNativeOvMeta();

// Parse GeoJSON / KML from a fetch Response.
// GeoPackages never come through here — they are read by viewport via
// GpkgSource rather than converted to GeoJSON in full.
async function _parseOverlayResponse(response, ext) {
  const text = await response.text();
  if (ext === 'geojson' || ext === 'json') return JSON.parse(text);
  if (ext === 'kml') return kmlToGeoJSON(text);
  throw new Error('Unsupported format: ' + ext);
}

// Web-only import (IndexedDB) — only called when !isCapacitor
export async function importLocalOverlay(file, name) {
  const ext = file.name.split('.').pop().toLowerCase();

  // GeoPackage: keep the file exactly as it is and read only its metadata.
  // Nothing is converted and no geometry is decoded, so import cost is flat
  // no matter how large or how dense the layer is. Rendering later reads just
  // the current viewport through the file's own R-tree index.
  if (ext === 'gpkg') {
    const source = await GpkgSource.open(await file.arrayBuffer());
    let meta;
    try { meta = source.metadata(); } finally { source.close(); }

    const record = {
      name,
      // Stored as a Blob: IndexedDB keeps it as an opaque binary value rather
      // than structured-cloning a huge object graph the way the old parsed
      // GeoJSON did.
      blob: file,
      fileSize: file.size,
      fileFormat: 'gpkg',
      featureCount: meta.featureCount,
      bounds: meta.bounds,
      indexed: true,
      importedAt: new Date().toISOString(),
    };
    const id = await idbPut(OV_STORE, record);
    const { blob, ...light } = record;
    return { ...light, id };
  }

  // GeoJSON / KML are text formats with no spatial index — they can only be
  // read by parsing them in full, so these stay whole-file. Large layers
  // should be supplied as .gpkg.
  const text = await file.text();
  let geojson;
  if (ext === 'geojson' || ext === 'json') geojson = JSON.parse(text);
  else if (ext === 'kml') geojson = kmlToGeoJSON(text);
  else throw new Error('Supported formats: .geojson, .kml, .gpkg');

  const record = {
    name, geojson,
    fileSize: file.size,
    fileFormat: ext === 'kml' ? 'kml' : 'geojson',
    featureCount: (geojson.features || []).length,
    bounds: extractBounds(geojson),
    importedAt: new Date().toISOString(),
  };
  const id = await idbPut(OV_STORE, record);
  return { ...record, id };
}

export async function listLocalOverlays() {
  if (isCapacitor) {
    return Object.values(_nativeOvMeta);
  }
  const all = await idbGetAll(OV_STORE);
  return all.map(r => ({
    id: r.id, name: r.name,
    fileSize: r.fileSize,
    fileSizeMB: (r.fileSize / (1024 * 1024)).toFixed(1),
    fileFormat: r.fileFormat,
    featureCount: r.featureCount,
    bounds: r.bounds,
    importedAt: r.importedAt,
  }));
}

export async function deleteLocalOverlay(id) {
  const key = `local_ov_${id}`;
  if (state.localOverlayLayers[key]) {
    state.map.removeLayer(state.localOverlayLayers[key]);
    delete state.localOverlayLayers[key];
    rebuildLayerControl();
  }
  // Release the open GeoPackage and its map listener, if this one was live.
  _detachViewportLayer(key);
  if (isCapacitor) {
    const plugin = getNativePlugin();
    if (plugin) plugin.deleteOverlayFile({ id: String(id) }).catch(() => {});
    delete _nativeOvMeta[id];
    _saveNativeOvMeta();
  } else {
    await idbDelete(OV_STORE, id);
  }
}

// Active viewport-rendered overlays: key -> { source, layer, onMove, timer }.
// `source` is a GpkgSource (queried straight off the file) or a GeoJSONSource
// (KML / GeoJSON, parsed once then indexed). Both are closed on toggle-off to
// release their memory — for a GeoPackage that is the sql.js WASM heap.
const _viewportLayers = {};

/** Raw bytes for a GeoPackage overlay, from native disk or IndexedDB. */
async function _readOverlayBytes(id) {
  if (isCapacitor) {
    const meta = _nativeOvMeta[id];
    if (!meta) throw new Error('Overlay metadata not found');
    const response = await fetch(window.Capacitor.convertFileSrc(meta.filePath));
    if (!response.ok) throw new Error(`File not found (${response.status})`);
    return response.arrayBuffer();
  }
  const record = await idbGet(OV_STORE, id);
  if (!record) throw new Error('Overlay not found');
  if (!record.blob) throw new Error('Overlay has no stored file');
  return record.blob.arrayBuffer();
}

/** Redraw an overlay for whatever is currently on screen. */
function _renderViewport(key, name) {
  const entry = _viewportLayers[key];
  if (!entry) return;

  const b = state.map.getBounds();
  let result;
  try {
    result = entry.source.queryBBox(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      VIEWPORT_FEATURE_CAP,
    );
  } catch (e) {
    console.error('Overlay viewport query failed:', e);
    return;
  }

  entry.layer.clearLayers();
  if (result.features.length) entry.layer.addData(result);

  // Only nag once per truncation streak, otherwise every pan toasts.
  if (result.truncated && !entry.warned) {
    entry.warned = true;
    toast(`${name}: showing first ${VIEWPORT_FEATURE_CAP} features — zoom in for the rest`, 'inf');
  } else if (!result.truncated) {
    entry.warned = false;
  }
}

function _detachViewportLayer(key) {
  const entry = _viewportLayers[key];
  if (!entry) return;
  clearTimeout(entry.timer);
  state.map.off('moveend zoomend', entry.onMove);
  try { entry.source.close(); } catch (_) { /* already closed */ }
  delete _viewportLayers[key];
}

export async function toggleLocalOverlayLayer(id, name, boundsStr) {
  const key = `local_ov_${id}`;
  const btn = document.getElementById(`lov-btn-${id}`);

  if (state.localOverlayLayers[key]) {
    state.map.removeLayer(state.localOverlayLayers[key]);
    delete state.localOverlayLayers[key];
    _detachViewportLayer(key);
    if (btn) { btn.textContent = '📍 Load'; btn.style.color = ''; }
    rebuildLayerControl();
    return;
  }

  if (btn) { btn.textContent = '⏳…'; btn.disabled = true; }

  try {
    const record = isCapacitor ? _nativeOvMeta[id] : await idbGet(OV_STORE, id);
    if (!record) throw new Error('Overlay not found');

    const format = record.fileFormat || record.ext;
    // A GeoPackage is queried straight off the file, so it needs the original
    // bytes: native overlays always keep them on disk, and on web only
    // overlays imported after this change store a blob. Anything else — KML,
    // GeoJSON, and legacy overlays stored pre-converted — is parsed once and
    // then indexed in memory. Either way rendering is viewport-driven.
    const useGpkgFile = format === 'gpkg' && (isCapacitor || !!record.blob);

    const layer = L.geoJSON(null, {
      ...styleFnsFor(key),
      onEachFeature: onEachFeature,
    });

    let source;
    if (useGpkgFile) {
      source = await GpkgSource.open(await _readOverlayBytes(id));
    } else {
      let geojson;
      if (isCapacitor) {
        const response = await fetch(window.Capacitor.convertFileSrc(record.filePath));
        if (!response.ok) throw new Error(`File not found (${response.status})`);
        geojson = await _parseOverlayResponse(response, record.ext);
      } else {
        geojson = record.geojson;
      }
      if (!geojson) throw new Error('Overlay has no readable data');
      source = GeoJSONSource.fromGeoJSON(geojson);
    }

    const entry = { source, layer, warned: false, timer: null };
    entry.onMove = () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => _renderViewport(key, name), VIEWPORT_REFRESH_MS);
    };
    _viewportLayers[key] = entry;
    state.map.on('moveend zoomend', entry.onMove);

    layer._overlayName = name;
    layer.addTo(state.map);
    state.localOverlayLayers[key] = layer;
    if (btn) { btn.textContent = '✅ Loaded'; btn.style.color = 'var(--earth)'; }

    if (boundsStr) {
      const [minLng, minLat, maxLng, maxLat] = boundsStr.split(',').map(Number);
      if (!isNaN(minLng)) state.map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
    }
    // After fitBounds the viewport is known — draw the first screenful.
    _renderViewport(key, name);

    rebuildLayerControl();
    toast(`✅ Local overlay loaded: ${name}`, 'ok');
  } catch (e) {
    _detachViewportLayer(key);
    toast('Load error: ' + e.message, 'err');
    if (btn) { btn.textContent = '📍 Load'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Overlay rendering helpers ───────────────────────────────────────────────

function onEachFeature(feature, layer) {
  if (!feature.properties) return;
  const rows = Object.entries(feature.properties)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => `<b>${k}</b>: ${v}`)
    .join('<br>');
  if (rows) layer.bindPopup(rows);
}

// ─── KML → GeoJSON ──────────────────────────────────────────────────────────

function kmlToGeoJSON(kmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');
  const features = [];

  for (const pm of doc.querySelectorAll('Placemark')) {
    const name = pm.querySelector('name')?.textContent || '';
    const desc = pm.querySelector('description')?.textContent || '';
    const props = { name, description: desc };

    for (const sd of pm.querySelectorAll('SimpleData')) {
      const key = sd.getAttribute('name');
      if (key) props[key] = sd.textContent;
    }
    for (const d of pm.querySelectorAll('Data')) {
      const key = d.getAttribute('name');
      const val = d.querySelector('value')?.textContent;
      if (key) props[key] = val || '';
    }

    const point = pm.querySelector('Point coordinates');
    const line = pm.querySelector('LineString coordinates');
    const poly = pm.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
    let geometry = null;

    if (point) {
      const [lng, lat] = point.textContent.trim().split(',').map(Number);
      geometry = { type: 'Point', coordinates: [lng, lat] };
    } else if (line) {
      geometry = { type: 'LineString', coordinates: parseKmlCoords(line.textContent) };
    } else if (poly) {
      geometry = { type: 'Polygon', coordinates: [parseKmlCoords(poly.textContent)] };
    }

    if (geometry) features.push({ type: 'Feature', properties: props, geometry });
  }
  return { type: 'FeatureCollection', features };
}

function parseKmlCoords(text) {
  return text.trim().split(/\s+/).map(s => {
    const [lng, lat] = s.split(',').map(Number);
    return [lng, lat];
  });
}

// ─── GPKG → GeoJSON ─────────────────────────────────────────────────────────

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Bounding box of a FeatureCollection, as "minLng,minLat,maxLng,maxLat".
 *
 * Tracks running extremes in a single pass. The previous version collected
 * every vertex into an array and finished with `Math.min(...lngs)`, which
 * passes each coordinate as a separate function argument — that throws
 * RangeError once a layer has more than ~125k vertices (lower in a mobile
 * WebView), which the importer then reported as "File too large to process".
 * It was an argument-count limit, not a memory one, so it fired on modest
 * files with dense linework.
 */
function extractBounds(geojson) {
  let minLng = Infinity, minLat = Infinity;
  let maxLng = -Infinity, maxLat = -Infinity;

  const visit = (c) => {
    const lng = c[0], lat = c[1];
    if (!(typeof lng === 'number' && typeof lat === 'number')) return;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  const collect = (geom) => {
    if (!geom) return;
    const t = geom.type, c = geom.coordinates;
    if (t === 'GeometryCollection') return (geom.geometries || []).forEach(collect);
    if (!c) return;
    if (t === 'Point') visit(c);
    else if (t === 'LineString' || t === 'MultiPoint') c.forEach(visit);
    else if (t === 'Polygon' || t === 'MultiLineString') c.forEach(r => r.forEach(visit));
    else if (t === 'MultiPolygon') c.forEach(p => p.forEach(r => r.forEach(visit)));
  };

  (geojson.features || []).forEach(f => collect(f.geometry));

  if (minLng === Infinity) return '';
  return `${minLng},${minLat},${maxLng},${maxLat}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI List Renderers
// ═══════════════════════════════════════════════════════════════════════════════

export async function renderLocalMBTilesList() {
  const listEl = document.getElementById('local-mbt-layers-list');
  if (!listEl) return;
  try {
    const items = await listLocalMBTiles();
    if (!items.length) {
      listEl.innerHTML = '<div style="font-size:.76rem;color:var(--txt2);padding:.3rem 0">No local MBTiles imported yet.</div>';
      return;
    }
    listEl.innerHTML = items.map(mbt => {
      const key = `local_${mbt.id}`;
      const loaded = !!state.localMBTilesLayers[key];
      return `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(mbt.name)}
            </div>
            <div style="font-size:.67rem;color:var(--txt2);font-family:var(--mono)">
              z${esc(mbt.minZoom)}–${esc(mbt.maxZoom)} · ${esc(mbt.fileSizeMB)} MB · local
            </div>
          </div>
          <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.7rem${loaded ? ';color:var(--earth)' : ''}"
                  onclick="toggleLocalMBTilesLayer('${attr(mbt.id)}', '${attr(mbt.name)}', '${attr(mbt.bounds)}', ${Number(mbt.minZoom) || 0}, ${Number(mbt.maxZoom) || 0})"
                  id="lmbt-btn-${mbt.id}">
            ${loaded ? 'Loaded' : 'Load'}
          </button>
          <button class="entry-del" onclick="deleteLocalMBTilesAndRefresh('${attr(mbt.id)}')" title="Delete">&#x1F5D1;</button>
        </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="font-size:.75rem;color:var(--danger)">${esc(e.message)}</div>`;
  }
}

/**
 * Recolour a local overlay from its swatch.
 *
 * Only restyles what is already drawn — the style functions read the stored
 * colour at draw time, so a later viewport re-render picks it up on its own.
 */
function setLocalOverlayColor(key, hex) {
  if (!setOverlayColor(key, hex)) return;
  applyColorToLayer(state.localOverlayLayers[key], key);
}

export async function renderLocalOverlaysList() {
  const listEl = document.getElementById('local-overlay-layers-list');
  if (!listEl) return;
  try {
    const items = await listLocalOverlays();
    if (!items.length) {
      listEl.innerHTML = '<div style="font-size:.76rem;color:var(--txt2);padding:.3rem 0">No local overlays imported yet.</div>';
      return;
    }
    const icons = { geojson: '🌍', kml: '📌', gpkg: '📦' };
    listEl.innerHTML = items.map(ov => {
      const key = `local_ov_${ov.id}`;
      const loaded = !!state.localOverlayLayers[key];
      const icon = icons[ov.fileFormat] || '';
      return `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${icon} ${esc(ov.name)}
            </div>
            <div style="font-size:.67rem;color:var(--txt2);font-family:var(--mono)">
              ${esc(ov.fileFormat.toUpperCase())} · ${esc(ov.featureCount)} features · local
            </div>
          </div>
          ${colorSwatchHtml(key, 'setLocalOverlayColor')}
          <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.7rem${loaded ? ';color:var(--earth)' : ''}"
                  onclick="toggleLocalOverlayLayer('${attr(ov.id)}', '${attr(ov.name)}', '${attr(ov.bounds)}')"
                  id="lov-btn-${ov.id}">
            ${loaded ? 'Loaded' : 'Load'}
          </button>
          <button class="entry-del" onclick="deleteLocalOverlayAndRefresh('${attr(ov.id)}')" title="Delete">&#x1F5D1;</button>
        </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="font-size:.75rem;color:var(--danger)">${esc(e.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Window handlers for onclick= in HTML
// ═══════════════════════════════════════════════════════════════════════════════

async function handleImportLocalMBTiles() {
  const nameInput = document.getElementById('local-mbt-name');
  const btn = document.getElementById('local-mbt-import-btn');

  if (isCapacitor) {
    // Native: plugin opens Android file picker and streams to disk
    btn.disabled = true;
    btn.textContent = '⏳ Importing…';
    try {
      const layerName = nameInput.value || 'MBTiles Layer';
      const info = await importLocalMBTiles(null, layerName);
      toast(`✅ Imported locally: ${info.name}`, 'ok');
      nameInput.value = '';
      nameInput.closest('.f')?.classList.remove('sv');
      await renderLocalMBTilesList();
      toggleLocalMBTilesLayer(info.id, info.name, info.bounds || '', info.minZoom, info.maxZoom);
    } catch (e) {
      if (!e.message?.includes('cancelled')) toast('Import error: ' + e.message, 'err');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.textContent = '📱 Choose & Import';
    }
  } else {
    // Web: use HTML file input
    const fileInput = document.getElementById('local-mbt-file-input');
    const file = fileInput.files[0];
    if (!file) { toast('Choose a .mbtiles file first', 'err'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Importing…';
    try {
      const info = await importLocalMBTiles(file, nameInput.value || file.name.replace('.mbtiles', ''));
      toast(`✅ Imported locally: ${info.name}`, 'ok');
      fileInput.value = '';
      nameInput.value = '';
      nameInput.closest('.f')?.classList.remove('sv');
      document.getElementById('local-mbt-file-label').textContent = 'Choose .mbtiles file…';
      await renderLocalMBTilesList();
      toggleLocalMBTilesLayer(info.id, info.name, info.bounds || '', info.minZoom, info.maxZoom);
    } catch (e) {
      toast('Import error: ' + e.message, 'err');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.textContent = '📱 Import to Device';
    }
  }
}

async function handleImportLocalOverlay() {
  const nameInput = document.getElementById('local-overlay-name');
  const btn = document.getElementById('local-overlay-import-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Importing…';

  try {
    let info;
    if (isCapacitor) {
      info = await importOverlayNative(nameInput.value || 'Overlay');
    } else {
      const fileInput = document.getElementById('local-overlay-file-input');
      const file = fileInput.files[0];
      if (!file) { toast('Choose an overlay file first', 'err'); return; }

      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (file.size > 50 * 1024 * 1024) {
        toast(`⏳ Reading ${sizeMB} MB — may take a minute…`, 'inf');
        btn.textContent = `⏳ Processing ${sizeMB} MB…`;
        await new Promise(r => setTimeout(r, 80));
      }
      info = await importLocalOverlay(file, nameInput.value || file.name.replace(/\.[^.]+$/, ''));
      fileInput.value = '';
      document.getElementById('local-overlay-file-label').textContent = 'Choose overlay file…';
    }

    toast(`✅ Imported: ${info.name} (${info.featureCount} features)`, 'ok');
    nameInput.value = '';
    nameInput.closest('.f')?.classList.remove('sv');
    await renderLocalOverlaysList();
    toggleLocalOverlayLayer(info.id, info.name, info.bounds || '');
  } catch (e) {
    if (!e.message?.includes('cancelled')) {
      const msg = (e instanceof RangeError || /memory|quota|out of/i.test(e.message))
        ? 'File too large to process. Try a smaller file.'
        : e.message;
      toast('Import error: ' + msg, 'err');
    }
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '📱 Import to Device';
  }
}

// Native overlay import for Capacitor.
// Java stream-copies to app private storage (no size limit).
// Metadata goes to localStorage — GeoJSON is NEVER put in IndexedDB
// (Android WebView IndexedDB rejects records > ~64 MB).
// File stays on disk; fetched via _capacitor_file_ each time the layer is loaded.
async function importOverlayNative(name) {
  const plugin = getNativePlugin();
  if (!plugin) throw new Error('Native plugin not available');

  const result = await plugin.pickAndImportOverlay({ name });
  // result: { id, name, ext, fileSize, fileSizeMB, filePath }

  const sizeMB = result.fileSizeMB;
  const isGpkg = result.ext === 'gpkg';

  // Only text formats have to be parsed whole to be measured; a GeoPackage
  // reports its own feature count and extent from metadata tables.
  if (!isGpkg && parseFloat(sizeMB) > 30) {
    toast(`⏳ Parsing ${sizeMB} MB — please wait…`, 'inf');
    document.getElementById('local-overlay-import-btn').textContent = `⏳ Parsing ${sizeMB} MB…`;
    await new Promise(r => setTimeout(r, 80));
  }

  // Read via Capacitor's local interceptor to extract featureCount + bounds
  const response = await fetch(window.Capacitor.convertFileSrc(result.filePath));
  if (!response.ok) throw new Error(`Could not read file (${response.status})`);

  let featureCount, bounds;
  if (isGpkg) {
    const source = await GpkgSource.open(await response.arrayBuffer());
    try {
      ({ featureCount, bounds } = source.metadata());
    } finally { source.close(); }
  } else {
    const geojson = await _parseOverlayResponse(response, result.ext);
    featureCount = (geojson.features || []).length;
    bounds = extractBounds(geojson);
  }

  const meta = {
    id: result.id,
    name,
    ext: result.ext,
    fileSize: result.fileSize,
    fileSizeMB: sizeMB,
    filePath: result.filePath,
    fileFormat: result.ext === 'kml' ? 'kml' : isGpkg ? 'gpkg' : 'geojson',
    featureCount,
    bounds,
    importedAt: new Date().toISOString(),
  };

  // Save only lightweight metadata — never store the GeoJSON object
  _nativeOvMeta[result.id] = meta;
  _saveNativeOvMeta();

  return meta;
}

function onLocalMBTilesFileChosen(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('local-mbt-file-label').textContent = file.name;
  const nameEl = document.getElementById('local-mbt-name');
  if (!nameEl.value) {
    nameEl.value = file.name.replace('.mbtiles', '');
    nameEl.closest('.f')?.classList.add('sv');
  }
}

function onLocalOverlayFileChosen(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('local-overlay-file-label').textContent = file.name;
  const nameEl = document.getElementById('local-overlay-name');
  if (!nameEl.value) {
    nameEl.value = file.name.replace(/\.(geojson|json|kml|gpkg)$/i, '');
    nameEl.closest('.f')?.classList.add('sv');
  }
}

async function deleteLocalMBTilesAndRefresh(id) {
  if (!confirm('Delete this local MBTiles file from your device?')) return;
  try {
    await deleteLocalMBTiles(id);
    toast('Local MBTiles deleted', 'inf');
    renderLocalMBTilesList();
  } catch (e) {
    toast('Delete error: ' + e.message, 'err');
  }
}

async function deleteLocalOverlayAndRefresh(id) {
  if (!confirm('Delete this local overlay from your device?')) return;
  try {
    await deleteLocalOverlay(id);
    toast('Local overlay deleted', 'inf');
    renderLocalOverlaysList();
  } catch (e) {
    toast('Delete error: ' + e.message, 'err');
  }
}

// Expose to window
window.toggleLocalMBTilesLayer       = toggleLocalMBTilesLayer;
window.toggleLocalOverlayLayer       = toggleLocalOverlayLayer;
window.handleImportLocalMBTiles      = handleImportLocalMBTiles;
window.handleImportLocalOverlay      = handleImportLocalOverlay;
window.onLocalMBTilesFileChosen      = onLocalMBTilesFileChosen;
window.onLocalOverlayFileChosen      = onLocalOverlayFileChosen;
window.deleteLocalMBTilesAndRefresh  = deleteLocalMBTilesAndRefresh;
window.deleteLocalOverlayAndRefresh  = deleteLocalOverlayAndRefresh;
window.setLocalOverlayColor          = setLocalOverlayColor;
