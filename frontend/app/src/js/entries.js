// entries.js — field entry CRUD, list rendering, stats, legend

import { state } from './state.js';
import { CROP_COLORS, CROP_EMOJI } from './constants.js';
import { cap, toast, persist, f2b, showHint } from './utils.js';
import { createLayer, styleLayer, rebuildLayers, makePopup, updateDrawControl } from './map.js';

export function setMode(m) {
  state.mode = m;
  document.getElementById('hd-collect').classList.toggle('active', m === 'collect');
  document.getElementById('hd-validate').classList.toggle('active', m === 'validate');
  const selBtn = document.getElementById('select-btn');
  if (selBtn) selBtn.classList.toggle('active', m === 'validate');

  updateDrawControl();

  if (m === 'validate') {
    if (state.pendingLayer) {
      state.drawnItems.removeLayer(state.pendingLayer);
      state.pendingLayer = null;
    }
    showPanel('validate');
    toast('Click any mapped field to select it for validation', 'inf');
  } else {
    state.validatingTarget = null;
    document.getElementById('validate-selected').style.display = 'none';
  }
  rebuildLayers();
}

export function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('show');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'export') updateExportSummary();
}

export async function saveEntry() {
  if (!state.pendingLayer) {
    toast('Draw a field boundary or drop a marker on the map first!', 'err');
    showHint(true);
    return;
  }
  const surveyEl = document.getElementById('survey-select');
  const surveyId = surveyEl.value;
  if (!surveyId) { toast('Please select a Survey', 'err'); return; }
  const surveyName = surveyEl.selectedOptions[0]?.text || '';
  const sector = document.getElementById('crop-sector').value;
  if (!sector) { toast('Please select a Sector', 'err'); return; }
  const cropType = document.getElementById('crop-type').value;
  if (!cropType) { toast('Please select a Crop Type', 'err'); return; }

  let geometry;
  if (state.pendingLayer.getLatLng) {
    const ll = state.pendingLayer.getLatLng();
    geometry = { type: 'Point', coordinates: [ll.lng, ll.lat] };
  } else {
    const raw = state.pendingLayer.getLatLngs()[0].map(p => [p.lng, p.lat]);
    if (!raw.length) { toast('Invalid polygon', 'err'); return; }
    const closed = (raw[0][0] !== raw[raw.length - 1][0]) ? [...raw, raw[0]] : raw;
    geometry = { type: 'Polygon', coordinates: [closed] };
  }

  const files = document.getElementById('photo-input').files;
  const photos = await Promise.all(Array.from(files).map(f2b));

  const feat = {
    type: 'Feature', geometry,
    properties: {
      surveyId, surveyName,
      sector, cropType,
      season: document.getElementById('crop-season').value,
      plantingDate: document.getElementById('planting-date').value,
      harvestDate: document.getElementById('harvest-date').value,
      growthStage: document.getElementById('growth-stage').value,
      cropCondition: document.getElementById('crop-condition').value,
      irrigation: document.getElementById('irrigation').value,
      notes: document.getElementById('notes').value,
      areaHa: document.getElementById('area-ha').value || null,
      seedUsedKg: document.getElementById('seed-used-kg').value || null,
      fertiliserUsedKg: document.getElementById('fertiliser-used-kg').value || null,
      yieldTonnes: document.getElementById('yield-tonnes').value || null,
      prevYieldTonnes: document.getElementById('prev-yield-tonnes').value || null,
      photos, timestamp: new Date().toISOString(), type: 'collection'
    }
  };

  const idx = state.fields.length;
  state.fields.push(feat);
  persist();

  state.drawnItems.removeLayer(state.pendingLayer);
  state.pendingLayer = null;

  const layer = createLayer(geometry);
  if (layer) {
    layer._fi = idx;
    styleLayer(layer, cropType);
    layer.bindPopup(makePopup(feat));
    state.drawnItems.addLayer(layer);
    feat._layer = layer;
  }

  // Reset form
  ['crop-sector', 'crop-type', 'crop-season', 'growth-stage', 'crop-condition', 'irrigation'].forEach(id => {
    document.getElementById(id).value = '';
    document.getElementById(id).closest('.f')?.classList.remove('sv');
  });
  document.getElementById('planting-date').value = '';
  document.getElementById('harvest-date').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('area-ha').value = '';
  document.getElementById('seed-used-kg').value = '';
  document.getElementById('fertiliser-used-kg').value = '';
  document.getElementById('yield-tonnes').value = '';
  document.getElementById('prev-yield-tonnes').value = '';
  document.getElementById('photo-input').value = '';
  document.getElementById('photo-previews').innerHTML = '';
  document.getElementById('photo-label').textContent = 'Attach field photos (optional)';

  updateStats();
  renderEntries();
  buildLegend();
  toast(`✅ ${cap(cropType)} saved!`, 'ok');

  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open')) toggleSidebar();
}

export function renderEntries() {
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const crop = document.getElementById('filter-crop').value;
  const el = document.getElementById('entries-list');

  const list = state.fields.filter(f => {
    const p = f.properties;
    if (crop && p.cropType !== crop) return false;
    if (q) return [p.sector, p.cropType, p.notes, p.growthStage, p.cropCondition, p.irrigation]
      .join(' ').toLowerCase().includes(q);
    return true;
  });

  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="ei">🌾</div><p>${state.fields.length ? 'No entries match your filter.' : 'No entries yet.<br>Start by drawing a field on the map.'}</p></div>`;
    return;
  }

  el.innerHTML = list.map(f => {
    const ri = state.fields.indexOf(f);
    const p = f.properties;
    const em = CROP_EMOJI[p.cropType] || '🌿';
    const co = CROP_COLORS[p.cropType] || '#64748b';
    const vChip = p.validation
      ? `<span class="chip ${p.validation.status === 'correct' ? 'c-green' : p.validation.status === 'incorrect' ? 'c-red' : 'c-amber'}">${p.validation.status}</span>`
      : '<span class="chip c-grey">Unvalidated</span>';
    const gChip = p.growthStage ? `<span class="chip c-teal">${p.growthStage}</span>` : '';
    const cChip = p.cropCondition ? `<span class="chip c-amber">${p.cropCondition.replace('_', ' ')}</span>` : '';
    const iChip = p.irrigation ? `<span class="chip c-blue">${p.irrigation}</span>` : '';
    const thumb = p.photos && p.photos[0]
      ? `<img src="${p.photos[0]}" alt="">`
      : `<span>${em}</span>`;

    return `<div class="entry" onclick="zoomTo(${ri})">
      <div class="entry-thumb" style="background:${co}22;border:2px solid ${co}44">${thumb}</div>
      <div class="entry-body">
        <div class="entry-name">${em} ${cap(p.cropType || 'Unknown')}</div>
        <div class="entry-meta">${new Date(p.timestamp).toLocaleDateString()} · ${f.geometry.type}</div>
        <div class="entry-chips">${vChip}${gChip}${cChip}${iChip}</div>
      </div>
      <button class="entry-del" onclick="delEntry(${ri});event.stopPropagation()">🗑</button>
    </div>`;
  }).join('');
}

export function zoomTo(i) {
  const f = state.fields[i];
  if (!f) return;
  if (f.geometry.type === 'Point') {
    state.map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], 16);
  } else {
    state.map.fitBounds(
      L.latLngBounds(f.geometry.coordinates[0].map(c => [c[1], c[0]])),
      { padding: [30, 30] }
    );
  }
  if (f._layer) f._layer.openPopup();
}

export function delEntry(i) {
  if (!confirm('Delete this entry?')) return;
  if (state.fields[i]._layer) state.drawnItems.removeLayer(state.fields[i]._layer);
  state.fields.splice(i, 1);
  persist();
  rebuildLayers();
  updateStats();
  renderEntries();
  buildLegend();
  toast('Entry deleted', 'inf');
}

export function updateStats() {
  const total = state.fields.length;
  const valList = state.fields.filter(f => f.properties.validation);
  const validated = valList.length;
  const polygons = state.fields.filter(f => f.geometry?.type === 'Polygon').length;
  const correct = valList.filter(f => f.properties.validation.status === 'correct').length;
  const incorrect = valList.filter(f => f.properties.validation.status === 'incorrect').length;
  const uncertain = valList.filter(f => f.properties.validation.status === 'uncertain').length;
  const pct = total ? Math.round(validated / total * 100) : 0;

  document.getElementById('s-total').textContent = total;
  document.getElementById('s-val').textContent = validated;
  document.getElementById('s-poly').textContent = polygons;
  document.getElementById('tab-badge').textContent = total;
  document.getElementById('v-correct').textContent = correct;
  document.getElementById('v-incorrect').textContent = incorrect;
  document.getElementById('v-uncertain').textContent = uncertain;
  document.getElementById('v-prog').style.width = pct + '%';
  document.getElementById('v-pct').textContent = pct + '% validated';

  const ct = document.getElementById('chip-total');
  const cv = document.getElementById('chip-val');
  ct.style.display = total ? '' : 'none';
  cv.style.display = validated ? '' : 'none';
  document.getElementById('chip-total-val').textContent = total;
  document.getElementById('chip-val-n').textContent = validated;
}

export function buildLegend() {
  const used = [...new Set(state.fields.map(f => f.properties.cropType).filter(Boolean))];
  const el = document.getElementById('legend-list');
  if (!used.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--txt2)">No crops mapped yet.</div>';
    return;
  }
  el.innerHTML = used.map(c => {
    const cnt = state.fields.filter(f => f.properties.cropType === c).length;
    return `<div class="legend-row">
      <div class="l-dot" style="background:${CROP_COLORS[c] || '#64748b'}"></div>
      <span>${CROP_EMOJI[c] || '🌿'} ${cap(c)}</span>
      <span style="margin-left:auto;font-family:var(--mono);font-size:.7rem;color:var(--txt2)">${cnt}</span>
    </div>`;
  }).join('');
}

export function updateExportSummary() {
  const t = state.fields.length;
  const poly = state.fields.filter(f => f.geometry?.type === 'Polygon').length;
  const pts = state.fields.filter(f => f.geometry?.type === 'Point').length;
  const val = state.fields.filter(f => f.properties.validation).length;
  const crops = [...new Set(state.fields.map(f => f.properties.cropType).filter(Boolean))].join(', ') || '—';
  document.getElementById('export-summary').innerHTML =
    `Total entries: <b>${t}</b> &nbsp;·&nbsp; Polygons: <b>${poly}</b> &nbsp;·&nbsp; Points: <b>${pts}</b><br>Validated: <b>${val}</b><br>Crops: <b>${crops}</b>`;
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  const isOpen = sidebar.classList.toggle('open');
  btn.textContent = isOpen ? '🗺️ Show Map' : '📋 Show Panel';
}

// Assign onclick-referenced functions to window
window.zoomTo        = zoomTo;
window.delEntry      = delEntry;
window.saveEntry     = saveEntry;
window.showPanel     = showPanel;
window.setMode       = setMode;
window.toggleSidebar = toggleSidebar;
window.renderEntries = renderEntries;
