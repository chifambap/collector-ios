// geojson-source.js — viewport queries over an in-memory FeatureCollection.
//
// KML and GeoJSON are text formats with no spatial index, so unlike a
// GeoPackage they cannot be read incrementally: the whole file has to be
// parsed to know what is in it. That parse is not what made large layers
// unusable though — handing Leaflet every feature at once is. A layer with
// 100k features becomes 100k SVG paths in the DOM, which freezes the map
// regardless of how the data got there.
//
// This wraps parsed features behind the same interface as GpkgSource
// (metadata / queryBBox / close) so both take the identical rendering path:
// build a bounding box per feature once, then hand Leaflet only what is on
// screen. Memory still scales with file size — that is inherent to the format
// — but rendering scales with the viewport.

/** Bounding box of a single GeoJSON geometry, or null if it has no coordinates. */
export function geometryBBox(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const visit = (c) => {
    const x = c[0], y = c[1];
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const walk = (g) => {
    if (!g) return;
    const t = g.type, c = g.coordinates;
    if (t === 'GeometryCollection') return (g.geometries || []).forEach(walk);
    if (!c) return;
    if (t === 'Point') visit(c);
    else if (t === 'LineString' || t === 'MultiPoint') c.forEach(visit);
    else if (t === 'Polygon' || t === 'MultiLineString') c.forEach(r => r.forEach(visit));
    else if (t === 'MultiPolygon') c.forEach(p => p.forEach(r => r.forEach(visit)));
  };

  walk(geom);
  return minX === Infinity ? null : { minX, maxX, minY, maxY };
}

export class GeoJSONSource {
  constructor(features, bbox) {
    this.features = features;
    this.bbox = bbox;           // Float64Array, minX/maxX/minY/maxY interleaved
  }

  /**
   * Index a parsed FeatureCollection.
   *
   * Every vertex is visited exactly once here, and never again — panning after
   * this only compares four numbers per feature.
   */
  static fromGeoJSON(geojson) {
    const all = (geojson && geojson.features) || [];
    const features = [];
    const bbox = new Float64Array(all.length * 4);

    for (const f of all) {
      const box = f && f.geometry ? geometryBBox(f.geometry) : null;
      if (!box) continue;                       // nothing drawable
      const o = features.length * 4;
      bbox[o] = box.minX; bbox[o + 1] = box.maxX;
      bbox[o + 2] = box.minY; bbox[o + 3] = box.maxY;
      features.push(f);
    }
    return new GeoJSONSource(features, bbox);
  }

  metadata() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.features.length; i++) {
      const o = i * 4;
      if (this.bbox[o] < minX) minX = this.bbox[o];
      if (this.bbox[o + 1] > maxX) maxX = this.bbox[o + 1];
      if (this.bbox[o + 2] < minY) minY = this.bbox[o + 2];
      if (this.bbox[o + 3] > maxY) maxY = this.bbox[o + 3];
    }
    return {
      featureCount: this.features.length,
      bounds: minX === Infinity ? '' : `${minX},${minY},${maxX},${maxY}`,
      layerCount: 1,
    };
  }

  /** Features intersecting the viewport, capped at `limit`. */
  queryBBox([minLng, minLat, maxLng, maxLat], limit = 3000) {
    const features = [];
    let truncated = false;

    for (let i = 0; i < this.features.length; i++) {
      const o = i * 4;
      if (this.bbox[o] > maxLng || this.bbox[o + 1] < minLng ||
          this.bbox[o + 2] > maxLat || this.bbox[o + 3] < minLat) continue;
      if (features.length >= limit) { truncated = true; break; }
      features.push(this.features[i]);
    }

    return { type: 'FeatureCollection', features, truncated };
  }

  close() {
    this.features = null;
    this.bbox = null;
  }
}
