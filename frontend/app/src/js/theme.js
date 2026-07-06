// theme.js — light/dark theme and offline mode toggle

import { state } from './state.js';
import { toast } from './utils.js';
import { rebuildLayerControl } from './map.js';

export function applyTheme() {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.dataset.theme = t;
  document.getElementById('theme-btn').textContent = t === 'dark' ? '☀️ Theme' : '🌙 Theme';
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  document.getElementById('theme-btn').textContent = next === 'dark' ? '☀️ Theme' : '🌙 Theme';
}

export function toggleOfflineMode() {
  state.offlineMode = !state.offlineMode;
  const btn = document.getElementById('hd-offline');

  if (state.offlineMode) {
    btn.textContent = '📴 Offline';
    btn.classList.add('active');
    if (state.map.hasLayer(state.osmLayer)) state.map.removeLayer(state.osmLayer);
    if (state.map.hasLayer(state.satelliteLayer)) state.map.removeLayer(state.satelliteLayer);
    if (state.map.hasLayer(state.noneLayer)) state.map.removeLayer(state.noneLayer);
    toast('Offline mode: Showing MBTiles only', 'inf');
  } else {
    btn.textContent = '📶 Online';
    btn.classList.remove('active');
    state.osmLayer.addTo(state.map);
    toast('Online mode: Base maps enabled', 'inf');
  }

  rebuildLayerControl();
}

// Assign to window for onclick= handlers in index.html
window.toggleTheme = toggleTheme;
window.toggleOfflineMode = toggleOfflineMode;
