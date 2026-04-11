// local-layers.js — Local on-device storage for MBTiles and overlays
// Capacitor APK: native file-based SQLite (supports 8GB+ files)
// Web browser: sql.js WebAssembly (smaller files only)

import { state } from './state.js';
import { toast } from './utils.js';
import { rebuildLayerControl } from './map.js';

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

// ─── sql.js singleton (web only fallback) ────────────────────────────────────

let _SQL = null;

async function getSqlJs() {
  if (_SQL) return _SQL;
  if (!window.initSqlJs) throw new Error('sql.js not loaded');
  const wasmUrl = new URL('./src/vendor/sql-wasm.wasm', window.location.href).href;
  const wasmResponse = await fetch(wasmUrl);
  const wasmBinary = await wasmResponse.arrayBuffer();
  _SQL = await window.initSqlJs({ wasmBinary });
  return _SQL;
}

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
  if (uint8Array.byteLength > 500 * 1024 * 1024) {
    throw new Error(`File is ${(uint8Array.byteLength / (1024 * 1024)).toFixed(0)} MB — too large for browser. Use the Android app for files over 500 MB.`);
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
    minZoom: parseInt(meta.minzoom || '0', 10),
    maxZoom: parseInt(meta.maxzoom || '18', 10),
    bounds: meta.bounds || '',
    center: meta.center || '',
    importedAt: new Date().toISOString(),
  };

  _webMBTilesDbs[id] = db;
  _webMBTilesMeta[id] = record;
  _saveWebMBTilesMeta();
  return record;
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
    minZoom: parseInt(meta.minzoom || '0', 10),
    maxZoom: parseInt(meta.maxzoom || '18', 10),
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

export function createLocalMBTilesLayer(id, name) {
  if (isCapacitor) {
    return createNativeTileLayer(id, name);
  }
  return createWebTileLayer(id, name);
}

function createNativeTileLayer(id, name) {
  const plugin = getNativePlugin();
  const maxNative = _webMBTilesMeta[id]?.maxZoom || 18;
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
    minZoom: 0, maxZoom: 24, maxNativeZoom: _webMBTilesMeta[id]?.maxZoom || 18, tileSize: 256,
    attribution: `📱 ${name} (local)`
  });
}

function createWebTileLayer(id, name) {
  const maxNative = _webMBTilesMeta[id]?.maxZoom || 18;
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
    minZoom: 0, maxZoom: 24, maxNativeZoom: _webMBTilesMeta[id]?.maxZoom || 18, tileSize: 256,
    attribution: `📱 ${name} (local)`
  });
}

export function toggleLocalMBTilesLayer(id, name, boundsStr) {
  const key = `local_${id}`;
  const btn = document.getElementById(`lmbt-btn-${id}`);

  if (state.localMBTilesLayers[key]) {
    state.map.removeLayer(state.localMBTilesLayers[key]);
    delete state.localMBTilesLayers[key];
    if (btn) { btn.textContent = '🗺 Load'; btn.style.color = ''; }
    rebuildLayerControl();
    return;
  }

  const layer = createLocalMBTilesLayer(id, name);
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
// Local Overlay import (IndexedDB — works on both web and Capacitor)
// ═══════════════════════════════════════════════════════════════════════════════

export async function importLocalOverlay(file, name) {
  let geojson;

  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'gpkg') {
    const arrayBuffer = await file.arrayBuffer();
    geojson = await gpkgToGeoJSON(arrayBuffer);
  } else {
    const text = await file.text();
    if (ext === 'geojson' || ext === 'json') {
      geojson = JSON.parse(text);
    } else if (ext === 'kml') {
      geojson = kmlToGeoJSON(text);
    } else {
      throw new Error('Supported formats: .geojson, .kml, .gpkg');
    }
  }

  const featureCount = (geojson.features || []).length;
  const bounds = extractBounds(geojson);

  const record = {
    name,
    geojson,
    fileSize: file.size,
    fileFormat: ext === 'kml' ? 'kml' : (ext === 'gpkg' ? 'gpkg' : 'geojson'),
    featureCount,
    bounds,
    importedAt: new Date().toISOString(),
  };

  const id = await idbPut(OV_STORE, record);
  return { ...record, id };
}

export async function listLocalOverlays() {
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
  await idbDelete(OV_STORE, id);
}

export async function toggleLocalOverlayLayer(id, name, boundsStr) {
  const key = `local_ov_${id}`;
  const btn = document.getElementById(`lov-btn-${id}`);

  if (state.localOverlayLayers[key]) {
    state.map.removeLayer(state.localOverlayLayers[key]);
    delete state.localOverlayLayers[key];
    if (btn) { btn.textContent = '📍 Load'; btn.style.color = ''; }
    rebuildLayerControl();
    return;
  }

  if (btn) { btn.textContent = '⏳…'; btn.disabled = true; }

  try {
    const record = await idbGet(OV_STORE, id);
    if (!record) throw new Error('Overlay not found');

    const layer = L.geoJSON(record.geojson, {
      style: overlayStyle,
      pointToLayer: pointToLayer,
      onEachFeature: onEachFeature,
    });

    layer._overlayName = name;
    layer.addTo(state.map);
    state.localOverlayLayers[key] = layer;

    if (btn) { btn.textContent = '✅ Loaded'; btn.style.color = 'var(--earth)'; }

    if (boundsStr) {
      const [minLng, minLat, maxLng, maxLat] = boundsStr.split(',').map(Number);
      if (!isNaN(minLng)) state.map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
    }

    rebuildLayerControl();
    toast(`✅ Local overlay loaded: ${name}`, 'ok');
  } catch (e) {
    toast('Load error: ' + e.message, 'err');
    if (btn) { btn.textContent = '📍 Load'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Overlay rendering helpers ───────────────────────────────────────────────

function overlayStyle(feature) {
  const isLine = feature.geometry && feature.geometry.type.includes('Line');
  return { color: '#e63946', weight: 3, opacity: 0.8, fillOpacity: 0.15, dashArray: isLine ? '8,4' : null };
}

function pointToLayer(feature, latlng) {
  return L.circleMarker(latlng, { radius: 6, color: '#e63946', weight: 2, fillColor: '#e63946', fillOpacity: 0.5 });
}

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

async function gpkgToGeoJSON(arrayBuffer) {
  const SQL = await getSqlJs();
  const db = new SQL.Database(new Uint8Array(arrayBuffer));
  const features = [];

  try {
    const tables = db.exec("SELECT table_name FROM gpkg_contents WHERE data_type='features'");
    if (!tables.length || !tables[0].values.length) throw new Error('No feature tables found in GeoPackage');

    for (const [tableName] of tables[0].values) {
      let geomCol = 'geom';
      try {
        const gc = db.exec(`SELECT column_name FROM gpkg_geometry_columns WHERE table_name='${tableName}'`);
        if (gc.length && gc[0].values.length) geomCol = gc[0].values[0][0];
      } catch (_) {}

      const rows = db.exec(`SELECT * FROM "${tableName}"`);
      if (!rows.length) continue;

      const columns = rows[0].columns;
      const geomIdx = columns.indexOf(geomCol);

      for (const row of rows[0].values) {
        const props = {};
        for (let i = 0; i < columns.length; i++) {
          if (i === geomIdx) continue;
          if (row[i] !== null) props[columns[i]] = row[i];
        }
        let geometry = null;
        if (row[geomIdx]) {
          try { geometry = parseGpkgGeometry(row[geomIdx]); } catch (_) {}
        }
        if (geometry) features.push({ type: 'Feature', properties: props, geometry });
      }
    }
  } finally { db.close(); }

  if (!features.length) throw new Error('No features could be parsed from GeoPackage');
  return { type: 'FeatureCollection', features };
}

function parseGpkgGeometry(blob) {
  const buf = (blob instanceof Uint8Array) ? blob : new Uint8Array(blob);
  if (buf[0] !== 0x47 || buf[1] !== 0x50) throw new Error('Invalid GeoPackage geometry');
  const flags = buf[3];
  const envelopeType = (flags >> 1) & 0x07;
  const envelopeSizes = [0, 32, 48, 48, 64];
  const wkbOffset = 8 + (envelopeSizes[envelopeType] || 0);
  return parseWKB(buf, wkbOffset);
}

function parseWKB(buf, offset) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  function readGeometry() {
    const le = buf[offset] === 1;
    offset += 1;
    const typeRaw = le ? dv.getUint32(offset, true) : dv.getUint32(offset, false);
    offset += 4;
    const type = typeRaw % 1000;
    const hasZ = (typeRaw >= 1000 && typeRaw < 2000) || typeRaw >= 3000;
    const hasM = typeRaw >= 2000;

    const readDouble = () => { const v = le ? dv.getFloat64(offset, true) : dv.getFloat64(offset, false); offset += 8; return v; };
    const readUint32 = () => { const v = le ? dv.getUint32(offset, true) : dv.getUint32(offset, false); offset += 4; return v; };
    const readCoord = () => { const lng = readDouble(), lat = readDouble(); if (hasZ) readDouble(); if (hasM) readDouble(); return [lng, lat]; };
    const readCoordArray = () => { const n = readUint32(); const c = []; for (let i = 0; i < n; i++) c.push(readCoord()); return c; };
    const readRings = () => { const n = readUint32(); const r = []; for (let i = 0; i < n; i++) r.push(readCoordArray()); return r; };

    switch (type) {
      case 1: return { type: 'Point', coordinates: readCoord() };
      case 2: return { type: 'LineString', coordinates: readCoordArray() };
      case 3: return { type: 'Polygon', coordinates: readRings() };
      case 4: { const n = readUint32(); const c = []; for (let i = 0; i < n; i++) { const g = readGeometry(); c.push(g.coordinates); } return { type: 'MultiPoint', coordinates: c }; }
      case 5: { const n = readUint32(); const c = []; for (let i = 0; i < n; i++) { const g = readGeometry(); c.push(g.coordinates); } return { type: 'MultiLineString', coordinates: c }; }
      case 6: { const n = readUint32(); const c = []; for (let i = 0; i < n; i++) { const g = readGeometry(); c.push(g.coordinates); } return { type: 'MultiPolygon', coordinates: c }; }
      case 7: { const n = readUint32(); const g = []; for (let i = 0; i < n; i++) g.push(readGeometry()); return { type: 'GeometryCollection', geometries: g }; }
      default: throw new Error(`Unsupported WKB type: ${type}`);
    }
  }

  return readGeometry();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractBounds(geojson) {
  const coords = [];
  function collect(geom) {
    const t = geom.type;
    if (t === 'Point') coords.push(geom.coordinates.slice(0, 2));
    else if (t === 'LineString' || t === 'MultiPoint') geom.coordinates.forEach(c => coords.push(c.slice(0, 2)));
    else if (t === 'Polygon' || t === 'MultiLineString') geom.coordinates.forEach(r => r.forEach(c => coords.push(c.slice(0, 2))));
    else if (t === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(r => r.forEach(c => coords.push(c.slice(0, 2)))));
  }
  (geojson.features || []).forEach(f => { if (f.geometry) collect(f.geometry); });
  if (!coords.length) return '';
  const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
  return `${Math.min(...lngs)},${Math.min(...lats)},${Math.max(...lngs)},${Math.max(...lats)}`;
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
              📱 ${mbt.name}
            </div>
            <div style="font-size:.67rem;color:var(--txt2);font-family:var(--mono)">
              z${mbt.minZoom}–${mbt.maxZoom} · ${mbt.fileSizeMB} MB · local
            </div>
          </div>
          <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.7rem${loaded ? ';color:var(--earth)' : ''}"
                  onclick="toggleLocalMBTilesLayer('${mbt.id}', '${mbt.name.replace(/'/g, "\\'")}', '${mbt.bounds}')"
                  id="lmbt-btn-${mbt.id}">
            ${loaded ? '✅ Loaded' : '🗺 Load'}
          </button>
          <button class="entry-del" onclick="deleteLocalMBTilesAndRefresh('${mbt.id}')" title="Delete">🗑</button>
        </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="font-size:.75rem;color:var(--danger)">${e.message}</div>`;
  }
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
      const icon = icons[ov.fileFormat] || '📍';
      return `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${icon} ${ov.name}
            </div>
            <div style="font-size:.67rem;color:var(--txt2);font-family:var(--mono)">
              ${ov.fileFormat.toUpperCase()} · ${ov.featureCount} features · local
            </div>
          </div>
          <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.7rem${loaded ? ';color:var(--earth)' : ''}"
                  onclick="toggleLocalOverlayLayer(${ov.id}, '${ov.name.replace(/'/g, "\\'")}', '${ov.bounds}')"
                  id="lov-btn-${ov.id}">
            ${loaded ? '✅ Loaded' : '📍 Load'}
          </button>
          <button class="entry-del" onclick="deleteLocalOverlayAndRefresh(${ov.id})" title="Delete">🗑</button>
        </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="font-size:.75rem;color:var(--danger)">${e.message}</div>`;
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
      toggleLocalMBTilesLayer(info.id, info.name, info.bounds || '');
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
      toggleLocalMBTilesLayer(info.id, info.name, info.bounds || '');
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
  const fileInput = document.getElementById('local-overlay-file-input');
  const nameInput = document.getElementById('local-overlay-name');
  const file = fileInput.files[0];
  if (!file) { toast('Choose an overlay file first', 'err'); return; }

  const btn = document.getElementById('local-overlay-import-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Importing…';

  try {
    const info = await importLocalOverlay(file, nameInput.value || file.name.replace(/\.[^.]+$/, ''));
    toast(`✅ Imported locally: ${info.name} (${info.featureCount} features)`, 'ok');

    fileInput.value = '';
    nameInput.value = '';
    nameInput.closest('.f')?.classList.remove('sv');
    document.getElementById('local-overlay-file-label').textContent = 'Choose overlay file…';

    await renderLocalOverlaysList();
    toggleLocalOverlayLayer(info.id, info.name, info.bounds || '');
  } catch (e) {
    toast('Import error: ' + e.message, 'err');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '📱 Import to Device';
  }
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
