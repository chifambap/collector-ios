// overlay-colors.js — per-overlay colours for route/boundary layers.
//
// Every overlay used to draw in the same red, so two layers on screen at once
// were indistinguishable. Each overlay now gets its own colour from a palette,
// and the collector can override it.
//
// Colours are stored per device in localStorage rather than on the server: a
// server overlay is shared between users, but which colour reads best depends
// on the basemap and the phone screen in front of you, so it is a local
// display preference. It also means the override works offline and applies to
// on-device overlays that the server never sees.

import { attr } from './utils.js';

const STORAGE_KEY = 'gc_overlay_colors';

/**
 * Distinct hues that stay readable over satellite and terrain basemaps.
 * Red stays first so a single existing overlay keeps the colour users know.
 */
export const OVERLAY_PALETTE = [
  '#e63946', // red
  '#1d7fdb', // blue
  '#f4a261', // orange
  '#2a9d8f', // teal
  '#9b5de5', // purple
  '#ffd166', // yellow
  '#06d6a0', // mint
  '#ef476f', // pink
  '#8ac926', // lime
  '#7f5539', // brown
];

function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch (_) { return {}; }
}

function saveOverrides(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); }
  catch (_) { /* private mode / quota — colour just won't persist */ }
}

/**
 * Default palette slot for an overlay key.
 *
 * Keys look like `local_ov_3` or `srv_ov_7`, so the trailing number is used
 * directly: consecutive imports get consecutive, visibly different colours
 * rather than whatever a hash happens to collide on.
 */
function paletteIndex(key) {
  const trailing = String(key).match(/(\d+)\s*$/);
  if (trailing) return Number(trailing[1]) % OVERLAY_PALETTE.length;

  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % OVERLAY_PALETTE.length;
}

/** Current colour for an overlay — the user's override, else its palette slot. */
export function getOverlayColor(key) {
  const override = loadOverrides()[key];
  if (typeof override === 'string' && /^#[0-9a-f]{6}$/i.test(override)) return override;
  return OVERLAY_PALETTE[paletteIndex(key)];
}

export function setOverlayColor(key, hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const map = loadOverrides();
  map[key] = hex;
  saveOverrides(map);
  return true;
}

/** Drop the override so the overlay returns to its palette colour. */
export function resetOverlayColor(key) {
  const map = loadOverrides();
  delete map[key];
  saveOverrides(map);
}

// ─── Leaflet style helpers ───────────────────────────────────────────────────

export function overlayFeatureStyle(feature, color) {
  const isLine = feature?.geometry && feature.geometry.type.includes('Line');
  return {
    color,
    weight: 3,
    opacity: 0.8,
    fillColor: color,
    fillOpacity: 0.15,
    dashArray: isLine ? '8,4' : null,
  };
}

export function overlayPointMarker(latlng, color) {
  return L.circleMarker(latlng, {
    radius: 6, color, weight: 2, fillColor: color, fillOpacity: 0.5,
  });
}

/**
 * Style/pointToLayer pair bound to an overlay key.
 *
 * These read the colour at draw time rather than capturing it, so a viewport
 * re-render (which rebuilds features on every pan) always uses the current
 * colour without needing to be rewired after a change.
 */
export function styleFnsFor(key) {
  return {
    style: (feature) => overlayFeatureStyle(feature, getOverlayColor(key)),
    pointToLayer: (feature, latlng) => overlayPointMarker(latlng, getOverlayColor(key)),
  };
}

/** Restyle an already-drawn Leaflet layer in place. */
export function applyColorToLayer(layer, key) {
  if (!layer) return;
  const color = getOverlayColor(key);
  layer.setStyle(feature => overlayFeatureStyle(feature, color));
}

/** Colour picker markup for an overlay row. */
export function colorSwatchHtml(key, handlerName) {
  // The key lands inside an inline handler, and native overlay ids come from
  // the platform rather than from us, so it is escaped like any other value.
  return `<input type="color" value="${getOverlayColor(key)}"
                 title="Layer colour"
                 onchange="${handlerName}('${attr(key)}', this.value)"
                 style="width:26px;height:26px;padding:0;border:1px solid var(--border);
                        border-radius:5px;background:none;cursor:pointer;flex:none">`;
}
