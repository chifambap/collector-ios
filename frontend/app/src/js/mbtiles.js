// mbtiles.js — MBTiles upload, listing, tile layer management

import { state } from './state.js';
import { toast } from './utils.js';
import { mbtilesAPI, auth, API_BASE } from './api.js';
import { rebuildLayerControl } from './map.js';
import { importMBTilesFromBuffer, renderLocalMBTilesList } from './local-layers.js';

const isCapacitor = !!window.Capacitor;

export function onMBTilesFileChosen(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('mbt-file-label').textContent = file.name;
  if (!document.getElementById('mbt-name').value) {
    document.getElementById('mbt-name').value = file.name.replace('.mbtiles', '');
    document.getElementById('mbt-name').closest('.f').classList.add('sv');
  }
}

export async function uploadMBTiles() {
  const fileInput = document.getElementById('mbt-file-input');
  const nameInput = document.getElementById('mbt-name');
  const file = fileInput.files[0];
  if (!file) { toast('Choose a .mbtiles file first', 'err'); return; }

  const btn = document.getElementById('mbt-upload-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading…';

  try {
    const data = await mbtilesAPI.upload(file, nameInput.value || file.name.replace('.mbtiles', ''));
    toast(`✅ Uploaded: ${data.name}`, 'ok');

    fileInput.value = '';
    nameInput.value = '';
    nameInput.closest('.f').classList.remove('sv');
    document.getElementById('mbt-file-label').textContent = 'Choose .mbtiles file…';

    await loadMBTilesList();
    addMBTilesLayerToMap(data);
  } catch (e) {
    toast('Upload error: ' + e.message, 'err');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '⬆️ Upload to Server';
  }
}

export async function loadMBTilesList() {
  const listEl = document.getElementById('mbt-layers-list');
  try {
    const data = await mbtilesAPI.list();
    const items = data.results || data;

    if (!items.length) {
      listEl.innerHTML = '<div style="font-size:.76rem;color:var(--txt2);padding:.3rem 0">No MBTiles uploaded yet.</div>';
      return;
    }

    const isAdmin = auth.user?.role === 'admin';
    listEl.innerHTML = items.map(mbt => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            📂 ${mbt.name}
          </div>
          <div style="font-size:.67rem;color:var(--txt2);font-family:var(--mono)">
            z${mbt.min_zoom}–${mbt.max_zoom} · ${mbt.file_size_mb} MB
          </div>
        </div>
        <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.7rem"
                onclick="toggleMBTilesLayer(${mbt.id}, '${mbt.name}', '${mbt.bounds || ''}')"
                id="mbt-btn-${mbt.id}">
          🗺 Load
        </button>
        ${!isAdmin ? `
        <button class="btn btn-ghost" style="padding:.3rem .6rem;font-size:.7rem"
                onclick="saveForOffline(${mbt.id}, '${mbt.name}')"
                id="mbt-save-${mbt.id}" title="Download for offline use">
          💾 Save Offline
        </button>` : ''}
        ${isAdmin ? `<button class="entry-del" onclick="deleteMBTiles(${mbt.id})" title="Delete">🗑</button>` : ''}
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="font-size:.75rem;color:var(--danger)">${e.message}</div>`;
  }
}

export function toggleMBTilesLayer(id, name, boundsStr) {
  const btn = document.getElementById(`mbt-btn-${id}`);

  if (state.mbtilesLayers[id]) {
    state.map.removeLayer(state.mbtilesLayers[id]);
    delete state.mbtilesLayers[id];
    if (btn) { btn.textContent = '🗺 Load'; btn.style.background = ''; }
    rebuildLayerControl();
    document.getElementById('offline-status').textContent = '—';
    return;
  }

  // Use mbtilesAPI.tileUrlWithToken so JWT is appended correctly
  const authUrl = mbtilesAPI.tileUrlWithToken(id);

  const layer = L.tileLayer(authUrl, {
    minZoom: 0, maxZoom: 24, tileSize: 256,
    attribution: `📂 ${name}`,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  });

  layer.addTo(state.map);
  state.mbtilesLayers[id] = layer;

  if (btn) { btn.textContent = '✅ Loaded'; btn.style.color = 'var(--earth)'; }

  if (boundsStr) {
    const [minLng, minLat, maxLng, maxLat] = boundsStr.split(',').map(Number);
    if (!isNaN(minLng)) state.map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
  }

  rebuildLayerControl();
  document.getElementById('offline-status').textContent = `📂 ${name} active`;
  toast(`✅ Layer loaded: ${name}`, 'ok');
}

export function addMBTilesLayerToMap(mbt) {
  toggleMBTilesLayer(mbt.id, mbt.name, mbt.bounds || '');
}

export async function saveForOffline(id, name) {
  const btn = document.getElementById(`mbt-save-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 0%'; }

  try {
    if (isCapacitor) {
      // On Capacitor: native plugin streams file directly from server to device disk
      const plugin = window.Capacitor?.Plugins?.MBTilesPlugin;
      if (!plugin?.importFromUrl) {
        toast('Update the app to use this feature', 'err');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Save Offline'; }
        return;
      }
      // Ensure fresh access token — native code can't auto-refresh
      let token = auth.access || '';
      if (auth.refresh) {
        try {
          const r = await fetch(`${API_BASE}/auth/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: auth.refresh }),
          });
          if (r.ok) {
            const d = await r.json();
            auth.setTokens(d.access, d.refresh ?? auth.refresh, auth.user);
            token = d.access;
          }
        } catch (_) { /* offline — use existing token */ }
      }
      const url = mbtilesAPI.downloadUrl(id);
      if (btn) btn.textContent = '⏳ 0%';

      // Listen for progress events from the native download loop
      let progressHandle = null;
      try { progressHandle = await plugin.addListener('mbtDownloadProgress', ({ received, total }) => {
        if (!btn) return;
        if (total > 0) {
          btn.textContent = `⏳ ${Math.round(received / total * 100)}%`;
        } else {
          btn.textContent = `⏳ ${(received / (1024 * 1024)).toFixed(1)} MB`;
        }
      }); } catch (_) {}

      let result;
      try {
        result = await plugin.importFromUrl({ url, token, name });
      } finally {
        if (progressHandle) progressHandle.remove();
      }

      await renderLocalMBTilesList();
      toast(`✅ "${result.name}" saved for offline use`, 'ok');
      if (btn) { btn.textContent = '✅ Saved'; btn.style.color = 'var(--earth)'; btn.disabled = false; }
    } else {
      // Web: stream directly into Uint8Array (single allocation), show % progress
      const buffer = await mbtilesAPI.downloadWithProgress(id, (recv, total) => {
        if (!btn) return;
        if (total > 0) {
          const pct = Math.round(recv / total * 100);
          btn.textContent = `⏳ ${pct}%`;
        } else {
          btn.textContent = `⏳ ${(recv / (1024 * 1024)).toFixed(1)} MB`;
        }
      });
      if (btn) btn.textContent = '⏳ Importing…';
      await importMBTilesFromBuffer(buffer, name);
      await renderLocalMBTilesList();
      toast(`✅ "${name}" saved for offline use`, 'ok');
      if (btn) { btn.textContent = '✅ Saved'; btn.style.color = 'var(--earth)'; btn.disabled = false; }
    }
  } catch (e) {
    toast('Save failed: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save Offline'; }
  }
}

export async function deleteMBTiles(id) {
  if (!confirm('Delete this MBTiles file from the server?')) return;
  try {
    await mbtilesAPI.delete(id);
    if (state.mbtilesLayers[id]) {
      state.map.removeLayer(state.mbtilesLayers[id]);
      delete state.mbtilesLayers[id];
    }
    rebuildLayerControl();
    toast('MBTiles deleted', 'inf');
    loadMBTilesList();
  } catch (e) {
    toast('Delete error: ' + e.message, 'err');
  }
}

// Assign to window for onclick= handlers
window.onMBTilesFileChosen = onMBTilesFileChosen;
window.uploadMBTiles       = uploadMBTiles;
window.toggleMBTilesLayer  = toggleMBTilesLayer;
window.deleteMBTiles       = deleteMBTiles;
window.saveForOffline       = saveForOffline;
