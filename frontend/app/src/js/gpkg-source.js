// gpkg-source.js — read a GeoPackage by viewport instead of converting it whole.
//
// WHY THIS EXISTS
// A GeoPackage used to be converted to GeoJSON in full at import time. That is
// the worst possible representation for large data: GeoJSON is ~1.5x larger
// than the source, must be parsed completely before anything draws, and turns
// every coordinate into a JS array of ~100 bytes instead of 16 packed bytes.
// A 100 MB .gpkg became ~1 GB of heap and tens of thousands of SVG paths.
//
// Instead the .gpkg is kept exactly as it is on the device and only the
// features in the current viewport are ever decoded, so cost scales with what
// the collector is looking at rather than with file size.
//
// WHY NOT THE R-TREE: a GeoPackage ships an R-tree spatial index, but the
// vendored sql.js is compiled WITHOUT SQLite's rtree module — querying
// rtree_<table>_<geom> fails with "no such module: rtree". The index tables
// are listed in sqlite_master, so their presence cannot be used as a probe
// either. Instead the bounding box in each geometry's own header is read with
// substr(geom, 1, 40), which returns just the 40-byte header rather than the
// whole blob, and that builds an in-memory index. Filtering it is plain
// numeric comparison over typed arrays.
//
// SRS NOTE: coordinates are passed through unprojected, matching the previous
// converter. Layers must therefore be in EPSG:4326 (WGS84) to line up with the
// basemap — the same constraint as before, now stated explicitly.

import { getSqlJs } from './sqljs.js';

/** Escape an identifier for safe interpolation (table names come from the file). */
const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

/** Rowids per fetch query — keeps IN lists well inside SQLite's limits. */
const ROWID_CHUNK = 500;

/** GeoPackage envelope sizes by indicator, per the binary header spec. */
const ENVELOPE_SIZES = [0, 32, 48, 48, 64];

/**
 * Bytes read per feature when indexing. Enough for the GeoPackage header plus
 * the largest envelope (64), and enough that an envelope-less PointZM
 * (8 + 1 + 4 + 32 = 45) can be decoded from it.
 */
const HEADER_BYTES = 80;

export class GpkgSource {
  constructor(db, layers) {
    this.db = db;
    this.layers = layers;   // [{ table, geomCol, minX, minY, maxX, maxY, count, index }]
  }

  /**
   * Open a GeoPackage from raw bytes.
   *
   * sql.js holds the database in WASM memory, so this costs roughly the file
   * size — flat, regardless of how many vertices it contains. That is the
   * trade: one bounded allocation instead of an unbounded JS object graph.
   */
  static async open(bytes) {
    const SQL = await getSqlJs();
    const db = new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

    let layers;
    try {
      layers = GpkgSource._discover(db);
    } catch (e) {
      db.close();
      throw e;
    }
    if (!layers.length) {
      db.close();
      throw new Error('No feature tables found in GeoPackage');
    }
    return new GpkgSource(db, layers);
  }

  static _discover(db) {
    const layers = [];

    const contents = db.exec(
      "SELECT table_name, min_x, min_y, max_x, max_y FROM gpkg_contents WHERE data_type='features'"
    );
    if (!contents.length) return layers;

    // Set of real tables, so a gpkg_contents row pointing at a missing
    // table is skipped rather than failing the whole open.
    const tableNames = new Set();
    const master = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view')");
    if (master.length) for (const [n] of master[0].values) tableNames.add(n);

    for (const [table, minX, minY, maxX, maxY] of contents[0].values) {
      if (!tableNames.has(table)) continue;   // listed but missing

      let geomCol = 'geom';
      try {
        const gc = db.exec(
          `SELECT column_name FROM gpkg_geometry_columns WHERE table_name=${escapeLiteral(table)}`
        );
        if (gc.length && gc[0].values.length) geomCol = gc[0].values[0][0];
      } catch (_) { /* fall back to the conventional name */ }

      let count = 0;
      try {
        const c = db.exec(`SELECT COUNT(*) FROM ${q(table)}`);
        count = c.length ? c[0].values[0][0] : 0;
      } catch (_) { /* unreadable table — reported as empty */ }

      layers.push({
        table, geomCol,
        minX, minY, maxX, maxY,
        count,
        index: null,   // built lazily on first viewport query
      });
    }
    return layers;
  }

  /**
   * Build the envelope index for one layer: rowid + bbox for every feature.
   *
   * Reads only substr(geom, 1, 40) so full geometries never cross into JS.
   * Costs ~40 bytes per feature of typed-array memory (about 5 MB for 120k
   * features) and is built once, when the layer is first shown.
   */
  _buildIndex(layer) {
    if (layer.index) return layer.index;

    const n = layer.count;
    const ids  = new Float64Array(n);
    const bbox = new Float64Array(n * 4);   // minX, maxX, minY, maxY interleaved
    let written = 0;

    const stmt = this.db.prepare(
      `SELECT rowid, substr(${q(layer.geomCol)}, 1, ${HEADER_BYTES}) FROM ${q(layer.table)}`
    );
    try {
      while (stmt.step() && written < n) {
        const [rowid, header] = stmt.get();
        if (!header) continue;

        // Writers omit the envelope for Points, since it would just repeat the
        // coordinate — so a point layer would otherwise get no filtering at
        // all. A Point's WKB fits inside the bytes already fetched, so read it
        // directly rather than treating it as unbounded.
        let env = readEnvelope(header) || readPointAsEnvelope(header);
        if (!env) {
          // Genuinely unbounded: a non-Point geometry with no envelope. Treat
          // as always-visible — only ever over-inclusive, never hiding data.
          env = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
        }
        ids[written] = rowid;
        const o = written * 4;
        bbox[o] = env.minX; bbox[o + 1] = env.maxX;
        bbox[o + 2] = env.minY; bbox[o + 3] = env.maxY;
        written++;
      }
    } finally { stmt.free(); }

    layer.index = { ids, bbox, length: written };
    return layer.index;
  }

  /** Total features and overall bounds — read from metadata, nothing decoded. */
  metadata() {
    let featureCount = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const l of this.layers) {
      featureCount += l.count;
      if ([l.minX, l.minY, l.maxX, l.maxY].every(v => typeof v === 'number')) {
        minX = Math.min(minX, l.minX); minY = Math.min(minY, l.minY);
        maxX = Math.max(maxX, l.maxX); maxY = Math.max(maxY, l.maxY);
      }
    }

    // gpkg_contents bounds are optional. When absent, fall back to the envelope
    // index — more expensive (it reads every geometry header) but still never
    // decodes a geometry, and it only happens for files missing the metadata.
    if (minX === Infinity) {
      for (const l of this.layers) {
        const { bbox, length } = this._buildIndex(l);
        for (let i = 0; i < length; i++) {
          const o = i * 4;
          if (!isFinite(bbox[o])) continue;
          if (bbox[o] < minX) minX = bbox[o];
          if (bbox[o + 1] > maxX) maxX = bbox[o + 1];
          if (bbox[o + 2] < minY) minY = bbox[o + 2];
          if (bbox[o + 3] > maxY) maxY = bbox[o + 3];
        }
      }
    }

    const bounds = minX === Infinity ? '' : `${minX},${minY},${maxX},${maxY}`;
    return { featureCount, bounds, layerCount: this.layers.length };
  }

  /**
   * Features intersecting [minLng, minLat, maxLng, maxLat] as a FeatureCollection.
   *
   * `limit` caps how much is decoded for one screen; hitting it is reported via
   * `truncated` so the UI can tell the user to zoom in rather than silently
   * showing a partial layer.
   */
  queryBBox([minLng, minLat, maxLng, maxLat], limit = 3000) {
    const features = [];
    let truncated = false;

    for (const layer of this.layers) {
      if (features.length >= limit) { truncated = true; break; }

      const index = this._buildIndex(layer);
      const { ids, bbox, length } = index;

      // Standard bbox overlap test, over typed arrays — no SQL, no allocation.
      const hits = [];
      const room = limit - features.length;
      for (let i = 0; i < length; i++) {
        const o = i * 4;
        if (bbox[o] > maxLng || bbox[o + 1] < minLng ||
            bbox[o + 2] > maxLat || bbox[o + 3] < minLat) continue;
        if (hits.length >= room) { truncated = true; break; }
        hits.push(ids[i]);
      }
      if (!hits.length) continue;

      // Fetch only the matching rows. Chunked because a single IN list of
      // thousands of terms can exceed SQLite's expression-depth limits.
      for (let start = 0; start < hits.length; start += ROWID_CHUNK) {
        const chunk = hits.slice(start, start + ROWID_CHUNK);
        // rowids are integers straight from the index, safe to inline.
        const stmt = this.db.prepare(
          `SELECT * FROM ${q(layer.table)} WHERE rowid IN (${chunk.join(',')})`
        );
        try {
          const columns = stmt.getColumnNames();
          const geomIdx = columns.indexOf(layer.geomCol);

          while (stmt.step()) {
            const row = stmt.get();
            const blob = geomIdx >= 0 ? row[geomIdx] : null;
            if (!blob) continue;

            let geometry = null;
            try { geometry = parseGpkgGeometry(blob); } catch (_) { continue; }
            if (!geometry) continue;

            const properties = {};
            for (let i = 0; i < columns.length; i++) {
              if (i === geomIdx) continue;
              if (row[i] !== null) properties[columns[i]] = row[i];
            }
            features.push({ type: 'Feature', geometry, properties });
          }
        } finally { stmt.free(); }
      }
    }

    return { type: 'FeatureCollection', features, truncated };
  }

  close() {
    try { this.db.close(); } catch (_) { /* already closed */ }
    this.db = null;
  }
}

/** SQLite string literal, for the one place a value must be inlined. */
function escapeLiteral(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Bounding box from a GeoPackage geometry blob header, without decoding WKB.
 * Returns null when the geometry carries no envelope.
 *
 * Header layout: 'GP', version, flags, srs_id(4), then the envelope as
 * minX, maxX, minY, maxY — note that order is x-pair then y-pair, not
 * min-corner then max-corner.
 */
export function readEnvelope(blob) {
  const buf = (blob instanceof Uint8Array) ? blob : new Uint8Array(blob);
  if (buf.length < 8 || buf[0] !== 0x47 || buf[1] !== 0x50) return null;

  const flags = buf[3];
  const envelopeType = (flags >> 1) & 0x07;
  if (!envelopeType || !ENVELOPE_SIZES[envelopeType]) return null;

  const le = (flags & 0x01) === 1;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    minX: dv.getFloat64(8, le),
    maxX: dv.getFloat64(16, le),
    minY: dv.getFloat64(24, le),
    maxY: dv.getFloat64(32, le),
  };
}

/**
 * Degenerate envelope for a Point stored without one, read straight from the
 * bytes fetched for indexing. Returns null for anything that is not a Point,
 * or if the slice is too short to contain one.
 */
export function readPointAsEnvelope(blob) {
  const buf = (blob instanceof Uint8Array) ? blob : new Uint8Array(blob);
  if (buf.length < 8 || buf[0] !== 0x47 || buf[1] !== 0x50) return null;

  const envelopeType = (buf[3] >> 1) & 0x07;
  if (envelopeType !== 0) return null;              // has a real envelope

  const wkbStart = 8;
  if (buf.length < wkbStart + 21) return null;      // too short for a Point

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = buf[wkbStart] === 1;
  const typeRaw = dv.getUint32(wkbStart + 1, le);
  if (typeRaw % 1000 !== 1) return null;            // not a Point

  const x = dv.getFloat64(wkbStart + 5, le);
  const y = dv.getFloat64(wkbStart + 13, le);
  if (!isFinite(x) || !isFinite(y)) return null;
  return { minX: x, maxX: x, minY: y, maxY: y };
}

/** GeoPackage geometry blob → GeoJSON geometry (skips the header envelope). */
export function parseGpkgGeometry(blob) {
  const buf = (blob instanceof Uint8Array) ? blob : new Uint8Array(blob);
  if (buf[0] !== 0x47 || buf[1] !== 0x50) throw new Error('Invalid GeoPackage geometry');
  const flags = buf[3];
  const envelopeType = (flags >> 1) & 0x07;
  const wkbOffset = 8 + (ENVELOPE_SIZES[envelopeType] || 0);
  return parseWKB(buf, wkbOffset);
}

export function parseWKB(buf, offset) {
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
