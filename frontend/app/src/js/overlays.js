// overlays.js — Route overlay upload, listing, layer management

import { state } from './state.js';
import { toast } from './utils.js';
import { overlayAPI, auth } from './api.js';
import { rebuildLayerControl } from './map.js';

const FORMAT_ICONS = { geojson: '🌍', gpkg: '📦', kml: '📌' };

function overlayStyle(feature) {
  const isLine = feature.geometry && feature.geometry.type.includes('Line');
  return {
    color: '#e63946',
    weight: 3,
    opacity: 0.8,
    fillOpacity: 0.15,
    dashArray: isLine ? '8,4' : null
  };
}

function pointToLayer(feature, latlng) {
  return L.circleMarker(latlng, {
    radius: 6, color: '#e63946', weight: 2,
    fillColor: '#e63946', fillOpacity: 0.5
  });
}

function onEachFeature(feature, layer) {
  if (!feature.properties) return;
  const rows = Object.entries(feature.properties)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => `<b>${k}</b>: ${v}`)
    .join('<br>');
  if (rows) layer.bindPopup(rows);
}

export function onOverlayFileChosen(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('overlay-file-label').textContent = file.name;
  if (!document.getElementById('overlay-name').value) {
    document.getElementById('overlay-name').value = file.name.replace(/\.(geojson|json|gpkg|kml)$/i, '');
    document.getElementById('overlay-name').closest('.f').classList.add('sv');
  }
}

export async function uploadOverlay() {
  const fileInput = document.getElementById('overlay-file-input');
  const nameInput = document.getElementById('overlay-name');
  const file = fileInput.files[0];
  if (!file) { toast('Choose an overlay file first', 'err'); return; }

  const btn = document.getElementById('overlay-upload-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading…';

  try {
    const data = await overlayAPI.upload(file, nameInput.value || file.name.replace(/\.[^.]+$/, ''));
    toast(`✅ Uploaded: ${data.name} (${data.feature_count} features)`, 'ok');

    fileInput.value = '';
    nameInput.value = '';
    nameInput.closest('.f').classList.remove('sv');
    document.getElementById('overlay-file-label').textContent = 'Choose overlay file…';

    await loadOverlaysList();
    toggleOverlayLayer(data.id, data.name, data.bounds || '');
  } catch (e) {
    toast('Upload error: ' + e.message, 'err');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '⬆️ Upload Overlay';
  }
}

export async function loadOverlaysList() {
  const listEl = document.getElementById('overlay-layers-list');
  if (!listEl) return;
  try {
    const data = await overlayAPI.list();
    const items = data.results || data;

    if (!items.length) {
      listEl.innerHTML = '<div style="font-size:.76rem;color:var(--txt2);padding:.3rem 0">No overlays uploaded yet.</div>';
      return;
    }

    const isAdmin = auth.user?.role === 'admin';
    listEl.innerHTML = items.map(ov => {
      const icon = FORMAT_ICONS[ov.file_format] || '📍';
      const loaded = !!state.overlayLayers[ov.id];
      return `
        <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${icon} ${ov.name}
            </div>
            <div style="font-size:.67rem;color:var(--txt2);font-family:var(--mono)">
              ${ov.file_format.toUpperCase()} · ${ov.feature_count} features · ${ov.file_size_mb} MB
            </div>
          </div>
          <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.7rem${loaded ? ';color:var(--earth)' : ''}"
                  onclick="toggleOverlayLayer(${ov.id}, '${ov.name.replace(/'/g, "\\'")}', '${ov.bounds || ''}')"
                  id="ov-btn-${ov.id}">
            ${loaded ? '✅ Loaded' : '📍 Load'}
          </button>
          ${isAdmin ? `<button class="entry-del" onclick="deleteOverlay(${ov.id})" title="Delete">🗑</button>` : ''}
        </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="font-size:.75rem;color:var(--danger)">${e.message}</div>`;
  }
}

export async function toggleOverlayLayer(id, name, boundsStr) {
  const btn = document.getElementById(`ov-btn-${id}`);

  // Toggle off if already loaded
  if (state.overlayLayers[id]) {
    state.map.removeLayer(state.overlayLayers[id]);
    delete state.overlayLayers[id];
    if (btn) { btn.textContent = '📍 Load'; btn.style.color = ''; }
    rebuildLayerControl();
    return;
  }

  // Fetch GeoJSON and add to map
  if (btn) { btn.textContent = '⏳…'; btn.disabled = true; }
  try {
    const geojson = await overlayAPI.geojson(id);
    const layer = L.geoJSON(geojson, {
      style: overlayStyle,
      pointToLayer: pointToLayer,
      onEachFeature: onEachFeature
    });

    layer._overlayName = name;
    layer.addTo(state.map);
    state.overlayLayers[id] = layer;

    if (btn) { btn.textContent = '✅ Loaded'; btn.style.color = 'var(--earth)'; }

    if (boundsStr) {
      const [minLng, minLat, maxLng, maxLat] = boundsStr.split(',').map(Number);
      if (!isNaN(minLng)) state.map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
    }

    rebuildLayerControl();
    toast(`✅ Overlay loaded: ${name}`, 'ok');
  } catch (e) {
    toast('Load error: ' + e.message, 'err');
    if (btn) { btn.textContent = '📍 Load'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function deleteOverlay(id) {
  if (!confirm('Delete this overlay from the server?')) return;
  try {
    await overlayAPI.delete(id);
    if (state.overlayLayers[id]) {
      state.map.removeLayer(state.overlayLayers[id]);
      delete state.overlayLayers[id];
    }
    rebuildLayerControl();
    toast('Overlay deleted', 'inf');
    loadOverlaysList();
  } catch (e) {
    toast('Delete error: ' + e.message, 'err');
  }
}

// Assign to window for onclick= handlers
window.onOverlayFileChosen = onOverlayFileChosen;
window.uploadOverlay       = uploadOverlay;
window.toggleOverlayLayer  = toggleOverlayLayer;
window.deleteOverlay       = deleteOverlay;
