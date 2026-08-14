// export.js — CSV, GeoJSON, KML export; clearAll; sendToServer

import { state } from './state.js';
import { toast, dlFile, today, persist, generateUUID } from './utils.js';
import { updateStats, renderEntries, buildLegend, updateExportSummary } from './entries.js';
import { syncAPI, auth } from './api.js';
import { SYNC_BATCH_SIZE } from './constants.js';

export function exportCSV() {
  if (!state.fields.length) return toast('No data to export', 'err');
  const rows = state.fields.map(f => {
    const p = f.properties;
    const row = {
      Survey: p.surveyName || '', Sector: p.sector || '', CropType: p.cropType || '', Season: p.season || '',
      PlantingDate: p.plantingDate || '', HarvestDate: p.harvestDate || '',
      GrowthStage: p.growthStage || '', CropCondition: p.cropCondition || '',
      Irrigation: p.irrigation || '',
      AreaHa: p.areaHa || '', SeedUsedKg: p.seedUsedKg || '', FertiliserUsedKg: p.fertiliserUsedKg || '',
      ExpectedYield_t_ha: p.yieldTonnes || '', PrevYield_t_ha: p.prevYieldTonnes || '',
      Notes: p.notes || '', Timestamp: p.timestamp || '', GeomType: f.geometry?.type || '',
      ValidationStatus: p.validation?.status || '', ValidationConf: p.validation?.confidence || '',
      ValidationNote: p.validation?.note || ''
    };
    if (f.geometry?.type === 'Point') {
      row.Latitude = f.geometry.coordinates[1].toFixed(8);
      row.Longitude = f.geometry.coordinates[0].toFixed(8);
    } else if (f.geometry?.type === 'Polygon') {
      const cs = f.geometry.coordinates[0];
      row.CentroidLat = (cs.reduce((s, c) => s + c[1], 0) / cs.length).toFixed(8);
      row.CentroidLng = (cs.reduce((s, c) => s + c[0], 0) / cs.length).toFixed(8);
    }
    return row;
  });
  dlFile(Papa.unparse(rows), `crop-data-${today()}.csv`, 'text/csv');
  toast('CSV exported', 'ok');
}

export function exportGeoJSON() {
  if (!state.fields.length) return toast('No data to export', 'err');
  const fc = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    features: state.fields.filter(f => f.geometry).map(f => ({
      type: 'Feature', geometry: { ...f.geometry },
      properties: {
        ...f.properties, photos: undefined, _layer: undefined,
        validation: f.properties.validation
          ? { ...f.properties.validation, photos: undefined }
          : undefined
      }
    }))
  };
  dlFile(JSON.stringify(fc, null, 2), `crop-data-${today()}.geojson`, 'application/json');
  toast('GeoJSON exported', 'ok');
}

export function exportKML() {
  if (!state.fields.length) return toast('No data to export', 'err');
  const ns = 'http://www.opengis.net/kml/2.2';
  const doc = document.implementation.createDocument(ns, 'kml', null);
  const kml = doc.documentElement;
  kml.setAttribute('xmlns', ns);
  const docEl = doc.createElement('Document');
  kml.appendChild(docEl);

  state.fields.forEach(f => {
    const p = f.properties;
    const pm = doc.createElement('Placemark');
    const nm = doc.createElement('name');
    nm.textContent = (p.cropType || 'Unknown').charAt(0).toUpperCase() + (p.cropType || '').slice(1);
    pm.appendChild(nm);
    const de = doc.createElement('description');
    de.appendChild(doc.createCDATASection(
      `<b>${(p.cropType || '').charAt(0).toUpperCase() + (p.cropType || '').slice(1)}</b><br>
      ${p.sector ? 'Sector: ' + p.sector.toUpperCase() + '<br>' : ''}
      ${p.season ? 'Season: ' + p.season + '<br>' : ''}
      ${p.growthStage ? 'Stage: ' + p.growthStage + '<br>' : ''}
      ${p.cropCondition ? 'Condition: ' + p.cropCondition.replace('_', ' ') + '<br>' : ''}
      ${p.irrigation ? 'Irrigation: ' + p.irrigation + '<br>' : ''}
      ${p.plantingDate ? 'Planted: ' + p.plantingDate + '<br>' : ''}
      ${p.notes ? 'Notes: ' + p.notes + '<br>' : ''}
      ${p.validation ? 'Validation: ' + p.validation.status + ' (' + p.validation.confidence + '⭐)<br>' : ''}`
    ));
    pm.appendChild(de);

    if (f.geometry?.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      const pt = doc.createElement('Point'), co = doc.createElement('coordinates');
      co.textContent = `${lng},${lat},0`; pt.appendChild(co); pm.appendChild(pt);
    } else if (f.geometry?.type === 'Polygon') {
      const pl = doc.createElement('Polygon'), ob = doc.createElement('outerBoundaryIs'),
        lr = doc.createElement('LinearRing'), co = doc.createElement('coordinates');
      co.textContent = f.geometry.coordinates[0].map(c => `${c[0]},${c[1]},0`).join(' ');
      lr.appendChild(co); ob.appendChild(lr); pl.appendChild(ob); pm.appendChild(pl);
    }
    docEl.appendChild(pm);
  });

  dlFile(
    '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc),
    `crop-data-${today()}.kml`,
    'application/vnd.google-earth.kml+xml'
  );
  toast('KML exported', 'ok');
}

// ─── Danger Zone: slide to unlock ────────────────────────────────────────────
// Clearing wipes field data that may not have reached the server yet, and on a
// phone a single stray tap — a pocket press, a frozen screen catching up on
// queued touches — used to be enough to trigger it. Unlocking now needs a drag
// across the whole track, which a stray tap cannot produce, and it re-locks on
// its own so the app is never left armed.

const ARM_WINDOW_MS = 10000;

/** i18n.js is a plain global script, so guard it like the other modules do. */
const tr = (key, fallback) => (window.t ? window.t(key, fallback) : fallback);

let _armed = false;
let _armTimer = null;
let _tick = null;
let _secondsLeft = 0;

function armEls() {
  return {
    slide: document.querySelector('.arm-slide'),
    range: document.getElementById('danger-arm'),
    label: document.getElementById('danger-arm-label'),
    btn:   document.getElementById('clear-all-btn'),
  };
}

/** Single place the label text is produced, so it survives a language switch. */
function paintLabel() {
  const { label } = armEls();
  if (!label) return;
  label.textContent = _armed
    ? `${tr('upload.armed', '🔓 Unlocked')} — ${_secondsLeft}s`
    : tr('upload.armhint', '🔒 Slide to unlock →');
}

function disarm() {
  _armed = false;
  clearTimeout(_armTimer); clearInterval(_tick);
  const { slide, range, btn } = armEls();
  if (range) range.value = 0;
  if (slide) slide.classList.remove('armed');
  if (btn)   btn.disabled = true;
  paintLabel();
}

function arm() {
  const { slide, btn } = armEls();
  _armed = true;
  if (slide) slide.classList.add('armed');
  if (btn)   btn.disabled = false;

  // Visible countdown, so re-locking never looks like a glitch.
  _secondsLeft = Math.ceil(ARM_WINDOW_MS / 1000);
  paintLabel();
  clearInterval(_tick);
  _tick = setInterval(() => {
    _secondsLeft -= 1;
    if (_secondsLeft >= 0) paintLabel();
  }, 1000);

  clearTimeout(_armTimer);
  _armTimer = setTimeout(disarm, ARM_WINDOW_MS);
}

export function initDangerZone() {
  const { range } = armEls();
  if (!range) return;

  range.addEventListener('input', () => {
    if (Number(range.value) >= Number(range.max)) arm();
  });
  // Released short of the end — snap back rather than leaving it part-armed.
  const settle = () => { if (!_armed) disarm(); };
  range.addEventListener('change', settle);
  range.addEventListener('pointerup', settle);
  range.addEventListener('touchend', settle);
  range.addEventListener('blur', settle);

  // A language switch re-applies data-i18n over the label; repaint after it so
  // a running countdown is not replaced by the locked-state text.
  window.addEventListener('gc:langchange', paintLabel);

  // Leaving the Upload panel should not leave the app armed in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _armed) disarm();
  });

  disarm();
}

export function clearAll() {
  // Gate the action itself, not just the button: this stays correct however the
  // function is reached (console, a stale onclick, a future caller).
  if (!_armed) {
    toast(tr('upload.armfirst', 'Slide to unlock first'), 'err');
    return;
  }

  const count = state.fields.length;
  const unsent = state.fields.filter(f => !f._clientUUID).length;
  const warning = unsent
    ? `\n\n${unsent} of them have never been sent to the server.`
    : '';
  if (!confirm(`Delete all ${count} saved entr${count === 1 ? 'y' : 'ies'} from this device?${warning}\n\nThis cannot be undone.`)) {
    disarm();
    return;
  }

  state.fields = [];
  persist();
  state.drawnItems.clearLayers();
  updateStats();
  renderEntries();
  buildLegend();
  disarm();
  toast(`All data cleared (${count} entries)`, 'inf');
}

export async function sendToServer() {
  if (!state.fields.length) { toast('No entries to send', 'err'); return; }
  if (!auth.isLoggedIn()) { toast('Please login first', 'err'); window.openAuthModal(); return; }

  const btn = document.getElementById('send-server-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Sending…';

  try {
    // Assign client UUIDs for deduplication, persist them back
    const entries = state.fields.map(f => {
      const p = f.properties;
      if (!f._clientUUID) f._clientUUID = generateUUID();
      return {
        client_uuid: f._clientUUID,
        geometry: f.geometry,
        survey: p.surveyId ? parseInt(p.surveyId) : null,
        sector: p.sector || '',
        crop_type: p.cropType,
        season: p.season || '',
        growth_stage: p.growthStage || '',
        crop_condition: p.cropCondition || '',
        irrigation: p.irrigation || '',
        planting_date: p.plantingDate || null,
        harvest_date: p.harvestDate || null,
        notes: p.notes || '',
        area_ha: p.areaHa || null,
        seed_used_kg: p.seedUsedKg || null,
        fertiliser_used_kg: p.fertiliserUsedKg || null,
        yield_tonnes: p.yieldTonnes || null,
        prev_yield_tonnes: p.prevYieldTonnes || null,
        validation: p.validation ? {
          status: p.validation.status,
          confidence: p.validation.confidence,
          note: p.validation.note || ''
        } : undefined
      };
    });
    persist();

    // Send in batches: one request carrying every entry grows without bound and
    // the server rejects oversized bodies. Batching also lets the button show
    // real progress on a slow rural link.
    let created = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < entries.length; i += SYNC_BATCH_SIZE) {
      const batch = entries.slice(i, i + SYNC_BATCH_SIZE);
      const data  = await syncAPI.push(batch);

      created += data.created || 0;
      skipped += data.skipped || 0;
      // Re-base each error's index onto the full list so it identifies the entry.
      (data.errors || []).forEach(e => errors.push({ ...e, index: i + (e.index ?? 0) }));

      if (entries.length > SYNC_BATCH_SIZE) {
        const done = Math.min(i + batch.length, entries.length);
        btn.textContent = `⏳ Sending ${done}/${entries.length}…`;
      }
    }

    if (errors.length) {
      toast(`⚠️ Sent: ${created} new, ${skipped} already on server, ${errors.length} errors`, 'err');
      console.warn('Sync errors:', errors);
    } else {
      toast(`✅ Synced ${created} entries to server (${skipped} already existed)`, 'ok');
    }
  } catch (e) {
    toast('❌ Send failed: ' + e.message, 'err');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 Send to Server';
  }
}

// Assign to window for onclick= handlers
window.exportCSV     = exportCSV;
window.exportGeoJSON = exportGeoJSON;
window.exportKML     = exportKML;
window.clearAll      = clearAll;
window.sendToServer  = sendToServer;

// Modules are deferred, so the DOM is normally parsed by now; the readyState
// check covers the case where it is not.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDangerZone);
} else {
  initDangerZone();
}
