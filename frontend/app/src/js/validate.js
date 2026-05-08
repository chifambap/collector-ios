// validate.js — validation workflow

import { state } from './state.js';
import { CROP_EMOJI } from './constants.js';
import { cap, toast, persist, f2b } from './utils.js';
import { rebuildLayers } from './map.js';
import { updateStats, renderEntries, showPanel } from './entries.js';

export function selectForValidation(idx) {
  const f = state.fields[idx];
  if (!f) return;
  state.validatingTarget = idx;
  document.getElementById('validate-selected').style.display = 'block';
  document.getElementById('val-feat-name').textContent =
    `${CROP_EMOJI[f.properties.cropType] || '🌿'} ${cap(f.properties.cropType)} — ${new Date(f.properties.timestamp).toLocaleDateString()}`;
  rebuildLayers();
  if (f._layer && f._layer.setStyle) {
    f._layer.setStyle({ color: '#2980b9', weight: 3.5, dashArray: '7,5' });
  }
  showPanel('validate');
  toast('Feature selected — complete the validation form', 'inf');
}

export async function submitValidation() {
  if (state.validatingTarget === null) {
    toast('Click a field on the map first', 'err');
    return;
  }
  const status = document.getElementById('v-status').value;
  const conf = document.getElementById('v-confidence').value;
  if (!status || !conf) { toast('Please fill in Status and Confidence', 'err'); return; }

  const files = document.getElementById('v-photo').files;
  const photos = await Promise.all(Array.from(files).map(f2b));

  state.fields[state.validatingTarget].properties.validation = {
    status, confidence: conf,
    note: document.getElementById('v-note').value,
    photos, timestamp: new Date().toISOString()
  };

  persist();
  rebuildLayers();
  updateStats();
  renderEntries();

  document.getElementById('v-status').value = '';
  document.getElementById('v-confidence').value = '';
  document.getElementById('v-note').value = '';
  document.getElementById('v-photo').value = '';
  document.getElementById('validate-selected').style.display = 'none';
  state.validatingTarget = null;
  toast('✅ Validation saved!', 'ok');

  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
    document.getElementById('sidebar-toggle').textContent = '📋 Show Panel';
  }
}

// Assign to window for onclick= handlers
window.selectForValidation = selectForValidation;
window.submitValidation    = submitValidation;
