// app.js — entry point: imports all modules, wires callbacks, bootstraps app

import { applyTheme }                            from './theme.js';
import { initMap, updateDrawControl,
         rebuildLayers,
         setLayerClickCallback,
         setDrawCreatedCallback }                from './map.js';
import { updateStats, renderEntries,
         buildLegend, showPanel, setMode }       from './entries.js';
import { selectForValidation }                   from './validate.js';
import { loadMBTilesList }                       from './mbtiles.js';
import { loadOverlaysList }                      from './overlays.js';
import { renderLocalMBTilesList, renderLocalOverlaysList } from './local-layers.js';
import { initAuth, setAuthCallbacks, hideOfflineIndicator, setupAppLockResume } from './auth.js';
import { setModeCallback }                       from './gps.js';
import { auth, API_BASE }                         from './api.js';
import { state }                                  from './state.js';
import { loadSurveys, updateSurveysBtnVisibility } from './survey.js';
import { APP_VERSION_CODE }                      from './constants.js';
import './export.js';

// ── Wire callbacks (breaks circular deps) ────────────────────────────────────

// map.js needs selectForValidation (validate.js) and showPanel (entries.js)
setLayerClickCallback(i => selectForValidation(i));
setDrawCreatedCallback(() => {
  showPanel('collect', { openSidebar: true });
});

// Show/hide admin vs collector sections based on role
function updateRoleUI() {
  const role = auth.user?.role || '';
  const isAdmin = role === 'admin';
  const loggedIn = state.sessionReady && (auth.isLoggedIn() || auth.hasSession());
  const el = (id) => document.getElementById(id);

  // MBTiles: admin upload vs collector local import
  const mbtAdmin = el('mbt-admin-upload');
  const mbtLocal = el('mbt-local-import');
  if (mbtAdmin) mbtAdmin.style.display = (loggedIn && isAdmin) ? 'block' : 'none';
  if (mbtLocal) mbtLocal.style.display = (loggedIn && !isAdmin) ? 'block' : 'none';

  // Overlays: admin upload vs collector local import
  const ovAdmin = el('overlay-admin-upload');
  const ovLocal = el('overlay-local-import');
  if (ovAdmin) ovAdmin.style.display = (loggedIn && isAdmin) ? 'block' : 'none';
  if (ovLocal) ovLocal.style.display = (loggedIn && !isAdmin) ? 'block' : 'none';

  // Load local layers list for collectors
  if (loggedIn && !isAdmin) {
    renderLocalMBTilesList();
    renderLocalOverlaysList();

    // On Capacitor: hide web file picker for MBTiles (native picker used instead)
    if (window.Capacitor) {
      const webPicker = el('local-mbt-file-picker');
      if (webPicker) webPicker.style.display = 'none';
      const importBtn = el('local-mbt-import-btn');
      if (importBtn) importBtn.textContent = '📱 Choose & Import';
    }
  }
}

// auth.js needs loadMBTilesList (mbtiles.js) and updateDrawControl (map.js)
setAuthCallbacks({
  onLoginSuccess: () => { loadMBTilesList(); loadOverlaysList(); updateDrawControl(); loadSurveys(); updateRoleUI(); },
  onLogout:       () => { updateDrawControl(); updateSurveysBtnVisibility(); updateRoleUI(); },
});

// gps.js needs setMode (entries.js)
setModeCallback(m => setMode(m));

// ── Auto-update check (Capacitor APK only) ───────────────────────────────────
async function checkForUpdate() {
  try {
    const res = await fetch(`https://zingsageocrops.com/api/app/version/`);
    const data = await res.json();
    if (data.version_code > APP_VERSION_CODE) {
      const bar = document.getElementById('update-bar');
      document.getElementById('update-version').textContent = 'v' + data.version_name;
      document.getElementById('update-link').href = `https://zingsageocrops.com${data.download_url}`;
      bar.style.display = 'flex';
    }
  } catch (_) { /* silent — no connectivity */ }
}

// ── Connectivity status ───────────────────────────────────────────────────────
function setConnStatus(online) {
  document.getElementById('conn-dot').className = 'm-dot ' + (online ? 'green' : 'amber');
  document.getElementById('conn-lbl').textContent = online ? 'Online' : 'Offline';
  document.getElementById('offline-bar').classList.toggle('show', !online);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  initAuth(() => {
    if (state.sessionReady && (auth.isLoggedIn() || auth.hasSession())) {
      loadMBTilesList();
      loadOverlaysList();
      loadSurveys();
      updateRoleUI();
    }
  });
  setupAppLockResume();
  initMap();
  rebuildLayers();
  updateStats();
  renderEntries();
  buildLegend();
  setConnStatus(navigator.onLine);
  if (window.Capacitor) {
    const dlBtn = document.getElementById('dl-btn'); if (dlBtn) dlBtn.style.display = 'none';
    if (navigator.onLine) checkForUpdate();
  }

  window.addEventListener('online', async () => {
    setConnStatus(true);
    if (state.offlineAuthenticated && auth.refresh) {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: auth.refresh }),
        });
        if (res.ok) {
          const data = await res.json();
          auth.setTokens(data.access, data.refresh ?? auth.refresh, auth.user);
          state.offlineAuthenticated = false;
          hideOfflineIndicator();
          import('./utils.js').then(({ toast }) => toast('Back online — session restored', 'ok'));
        }
      } catch (_) { /* network still flaky, will retry on next online event */ }
    }
  });
  window.addEventListener('offline', () => setConnStatus(false));

  // Auto-mark selects as "has value" on change
  document.querySelectorAll('.f select').forEach(sel => {
    sel.addEventListener('change', () => {
      sel.closest('.f').classList.toggle('sv', !!sel.value);
    });
  });

  // Close auth modal on Escape or outside click
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.closeAuthModal?.();
  });
  document.addEventListener('click', e => {
    if (e.target.id === 'auth-modal') window.closeAuthModal?.();
  });
});
