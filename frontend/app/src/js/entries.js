// entries.js — field entry CRUD, list rendering, stats, legend

import { state } from './state.js';
import { CROP_COLORS, CROP_EMOJI } from './constants.js';
import { cap, toast, persist, f2b, showHint } from './utils.js';
import { createLayer, styleLayer, rebuildLayers, makePopup, updateDrawControl, startDraw } from './map.js';

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

export function updateGeomStatus() {
  const chip = document.getElementById('geom-status-chip');
  if (!chip) return;
  if (!state.pendingLayer) {
    chip.textContent = '⚠️ No geometry — draw on map or use buttons below';
    chip.className = 'geom-status warn';
  } else if (state.pendingLayer.getLatLng) {
    chip.textContent = '✓ Point captured';
    chip.className = 'geom-status ok';
  } else {
    chip.textContent = '✓ Polygon drawn';
    chip.className = 'geom-status ok';
  }
}

export function startDrawFromForm(type) {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
  startDraw(type);
}

export function showPanel(name, opts = {}) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('show');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'collect') updateGeomStatus();
  if (name === 'export') updateExportSummary();
  if (opts.openSidebar) {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-toggle');
    if (sidebar && btn && !sidebar.classList.contains('open')) {
      sidebar.classList.add('open');
      btn.textContent = '🗺️ Show Map';
    }
  }
}

// ── Multi-crop wizard state (runtime only, not persisted) ────────────────────
let _multiCropList   = [];
let _multiCropIdx    = -1;
let _multiCropDrafts = [];

function getSelectedCropTypes() {
  return Array.from(
    document.querySelectorAll('#crop-picker-dropdown input[type="checkbox"]:checked')
  ).map(cb => cb.value);
}

function clearAttributeFields() {
  ['crop-season', 'growth-stage', 'crop-condition', 'irrigation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.closest('.f')?.classList.remove('sv'); }
  });
  const sectorOtherInp = document.getElementById('crop-sector-other');
  const sectorOtherDiv = document.getElementById('f-sector-other');
  if (sectorOtherInp) sectorOtherInp.value = '';
  if (sectorOtherDiv) sectorOtherDiv.style.display = 'none';
  ['planting-date', 'harvest-date', 'notes', 'area-ha', 'seed-used-kg',
   'fertiliser-used-kg', 'yield-tonnes', 'prev-yield-tonnes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pi = document.getElementById('photo-input'); if (pi) pi.value = '';
  const pp = document.getElementById('photo-previews'); if (pp) pp.innerHTML = '';
  const pl = document.getElementById('photo-label');
  if (pl) pl.textContent = 'Attach field photos (optional)';
}

export function toggleSectorOther(value) {
  const el = document.getElementById('f-sector-other');
  if (el) el.style.display = value === 'other' ? 'block' : 'none';
  if (value !== 'other') {
    const inp = document.getElementById('crop-sector-other');
    if (inp) inp.value = '';
  }
}

export function toggleCropPicker() {
  const dd = document.getElementById('crop-picker-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

export function updateCropPickerUI() {
  const selected = getSelectedCropTypes();
  const chips = document.getElementById('crop-chips');
  chips.innerHTML = selected.map(v => {
    const lbl = document.querySelector(
      `#crop-picker-dropdown input[value="${v}"]`
    )?.parentElement?.textContent?.trim() || v;
    return `<span class="crop-chip">${lbl} <span onclick="uncheckCrop('${v}')" style="cursor:pointer;opacity:.7">✕</span></span>`;
  }).join('');
  document.getElementById('crop-picker-toggle').textContent =
    selected.length ? `${selected.length} crop${selected.length > 1 ? 's' : ''} selected ▾` : 'Select crops… ▾';
  document.getElementById('start-capture-btn').style.display = selected.length ? 'block' : 'none';
}

export function uncheckCrop(value) {
  const cb = document.querySelector(`#crop-picker-dropdown input[value="${value}"]`);
  if (cb) { cb.checked = false; updateCropPickerUI(); }
}

export function startMultiCropWizard() {
  const selected = getSelectedCropTypes();
  if (!selected.length) { toast('Select at least one crop type', 'err'); return; }
  _multiCropList   = selected;
  _multiCropIdx    = 0;
  _multiCropDrafts = [];
  document.getElementById('crop-picker-dropdown').style.display = 'none';
  document.getElementById('start-capture-btn').style.display = 'none';
  if (state.pendingLayer) { state.drawnItems.removeLayer(state.pendingLayer); state.pendingLayer = null; }
  clearAttributeFields();
  showCropWizardStep(0);
}

function showCropWizardStep(idx) {
  const cropType = _multiCropList[idx];
  const total    = _multiCropList.length;
  const emoji    = CROP_EMOJI[cropType] || '';
  const label    = `${emoji} ${cap(cropType)}`.trim();
  const bar      = document.getElementById('crop-wizard-bar');
  bar.style.display = 'block';
  document.getElementById('wizard-progress-text').textContent =
    total === 1 ? `Capturing: ${label}` : `Crop ${idx + 1} of ${total} — ${label}`;
  document.getElementById('wizard-progress-fill').style.width =
    `${((idx + 1) / total) * 100}%`;
  const isLast = idx === total - 1;
  document.getElementById('save-entry-btn').textContent =
    isLast ? '💾 Save All' : 'Next Crop ▶';
  updateGeomStatus();
  showPanel('collect', { openSidebar: true });
}

async function buildDraft(cropType) {
  const surveyEl  = document.getElementById('survey-select');
  const surveyId  = surveyEl.value;
  const surveyName = surveyEl.selectedOptions[0]?.text || '';
  const sectorRaw = document.getElementById('crop-sector').value;
  const sector    = sectorRaw === 'other'
    ? (document.getElementById('crop-sector-other').value.trim() || 'other')
    : sectorRaw;
  let geometry;
  if (state.pendingLayer.getLatLng) {
    const ll = state.pendingLayer.getLatLng();
    geometry = { type: 'Point', coordinates: [ll.lng, ll.lat] };
  } else {
    const raw = state.pendingLayer.getLatLngs()[0].map(p => [p.lng, p.lat]);
    const closed = (raw[0][0] !== raw[raw.length - 1][0]) ? [...raw, raw[0]] : raw;
    geometry = { type: 'Polygon', coordinates: [closed] };
  }
  const files  = document.getElementById('photo-input').files;
  const photos = await Promise.all(Array.from(files).map(f2b));
  return {
    layer: state.pendingLayer,
    feat: {
      type: 'Feature', geometry,
      properties: {
        surveyId, surveyName, sector, cropType,
        season:           document.getElementById('crop-season').value,
        plantingDate:     document.getElementById('planting-date').value,
        harvestDate:      document.getElementById('harvest-date').value,
        growthStage:      document.getElementById('growth-stage').value,
        cropCondition:    document.getElementById('crop-condition').value,
        irrigation:       document.getElementById('irrigation').value,
        notes:            document.getElementById('notes').value,
        areaHa:           document.getElementById('area-ha').value || null,
        seedUsedKg:       document.getElementById('seed-used-kg').value || null,
        fertiliserUsedKg: document.getElementById('fertiliser-used-kg').value || null,
        yieldTonnes:      document.getElementById('yield-tonnes').value || null,
        prevYieldTonnes:  document.getElementById('prev-yield-tonnes').value || null,
        photos, timestamp: new Date().toISOString(), type: 'collection'
      }
    }
  };
}

async function commitAllDrafts() {
  const count = _multiCropDrafts.length;
  for (const draft of _multiCropDrafts) {
    const idx = state.fields.length;
    state.fields.push(draft.feat);
    if (draft.layer && state.drawnItems.hasLayer(draft.layer))
      state.drawnItems.removeLayer(draft.layer);
    const layer = createLayer(draft.feat.geometry);
    if (layer) {
      layer._fi = idx;
      styleLayer(layer, draft.feat.properties.cropType);
      layer.bindPopup(makePopup(draft.feat));
      state.drawnItems.addLayer(layer);
      draft.feat._layer = layer;
    }
  }
  persist();
  _multiCropList = []; _multiCropIdx = -1; _multiCropDrafts = [];
  document.getElementById('crop-wizard-bar').style.display = 'none';
  document.getElementById('save-entry-btn').textContent = '💾 Save Entry';
  document.querySelectorAll('#crop-picker-dropdown input[type="checkbox"]')
    .forEach(cb => cb.checked = false);
  document.getElementById('crop-chips').innerHTML = '';
  document.getElementById('crop-picker-toggle').textContent = 'Select crops… ▾';
  document.getElementById('start-capture-btn').style.display = 'none';
  clearAttributeFields();
  updateStats(); renderEntries(); buildLegend();
  toast(`${count} entr${count === 1 ? 'y' : 'ies'} saved!`, 'ok');
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('open')) toggleSidebar();
}

export async function saveCurrentCrop() {
  if (_multiCropIdx < 0 || !_multiCropList.length) {
    toast('Select crops and tap Start Capture first', 'err'); return;
  }
  if (!state.pendingLayer) {
    toast('Capture geometry for this crop first', 'err'); return;
  }
  const surveyId = document.getElementById('survey-select').value;
  if (!surveyId) { toast('Please select a Survey', 'err'); return; }
  const sector = document.getElementById('crop-sector').value;
  if (!sector) { toast('Please select a Sector', 'err'); return; }

  const cropType = _multiCropList[_multiCropIdx];
  const draft    = await buildDraft(cropType);
  _multiCropDrafts.push(draft);
  styleLayer(state.pendingLayer, cropType);
  state.pendingLayer = null;

  const isLast = _multiCropIdx === _multiCropList.length - 1;
  if (isLast) {
    await commitAllDrafts();
  } else {
    _multiCropIdx++;
    clearAttributeFields();
    showCropWizardStep(_multiCropIdx);
  }
}

export async function saveEntry() { await saveCurrentCrop(); }

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
window.zoomTo               = zoomTo;
window.delEntry             = delEntry;
window.saveEntry            = saveEntry;
window.saveCurrentCrop      = saveCurrentCrop;
window.showPanel            = showPanel;
window.setMode              = setMode;
window.toggleSidebar        = toggleSidebar;
window.renderEntries        = renderEntries;
window.startDrawFromForm    = startDrawFromForm;
window.startMultiCropWizard = startMultiCropWizard;
window.toggleCropPicker     = toggleCropPicker;
window.updateCropPickerUI   = updateCropPickerUI;
window.uncheckCrop          = uncheckCrop;
window.toggleSectorOther    = toggleSectorOther;
