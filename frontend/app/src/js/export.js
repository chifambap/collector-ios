// export.js — CSV, GeoJSON, KML export; clearAll; sendToServer

import { state } from './state.js';
import { toast, dlFile, today, persist, generateUUID } from './utils.js';
import { updateStats, renderEntries, buildLegend, updateExportSummary } from './entries.js';
import { syncAPI, auth } from './api.js';

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

export function clearAll() {
  if (!confirm('Clear ALL data? This cannot be undone.')) return;
  state.fields = [];
  persist();
  state.drawnItems.clearLayers();
  updateStats();
  renderEntries();
  buildLegend();
  if (arguments.length === 0) toast('All data cleared', 'inf');
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

    const data = await syncAPI.push(entries);
    const created = data.created || 0;
    const skipped = data.skipped || 0;
    const errors = data.errors || [];

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
