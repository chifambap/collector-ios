// map.js — Leaflet map init, layers, drawing tools

import { state } from './state.js';
import { CROP_COLORS, CROP_EMOJI } from './constants.js';
import { showHint, cap } from './utils.js';

// Callbacks wired by app.js to avoid circular deps
let _onLayerClick = null;
let _onDrawCreated = null;

export function setLayerClickCallback(fn) { _onLayerClick = fn; }
export function setDrawCreatedCallback(fn) { _onDrawCreated = fn; }

export function initMap() {
  state.map = L.map('map', {
    zoomControl: true,
    rotate: true,
    bearing: 0,
    touchRotate: true,
    shiftKeyRotate: true,
    rotateControl: false,   // we use our own compass rose instead
    layers: []
  }).setView([-19.0154, 29.1549], 7);

  // Base layers
  state.noneLayer = L.tileLayer('', { attribution: 'No base map' });
  state.osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19
  });
  state.satelliteLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: '© Google',
    maxZoom: 21,
    subdomains: ['0', '1', '2', '3']
  });

  state.osmLayer.addTo(state.map);

  state.activeLayerCtrl = L.control.layers(
    {
      '⬜ None': state.noneLayer,
      '🗺️ OpenStreetMap': state.osmLayer,
      '🛰️ Google Satellite': state.satelliteLayer
    },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(state.map);

  state.drawnItems = new L.FeatureGroup().addTo(state.map);
  updateDrawControl();

  state.map.on(L.Draw.Event.CREATED, e => {
    if (state.mode !== 'collect') return;
    if (state.pendingLayer) state.drawnItems.removeLayer(state.pendingLayer);
    state.pendingLayer = e.layer;
    styleLayer(state.pendingLayer, null);
    state.drawnItems.addLayer(state.pendingLayer);
    showHint(false);
    if (_onDrawCreated) _onDrawCreated();
  });

  state.map.on('click', e => {
    // Auto-collapse sidebar on mobile map click
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-toggle');
    if (sidebar.classList.contains('open') && window.innerWidth <= 768) {
      sidebar.classList.remove('open');
      btn.textContent = '📋 Show Panel';
    }

    // Validation hit finding
    if (state.mode !== 'validate') return;
    let hit = null;
    state.drawnItems.eachLayer(l => {
      if (l._isPending) return;
      if (l.getLatLng && l.getLatLng().distanceTo(e.latlng) < 30) hit = l;
      else if (l.getBounds && l.getBounds().contains(e.latlng)) hit = l;
    });
    if (hit && hit._fi !== undefined && _onLayerClick) {
      _onLayerClick(hit._fi);
    }
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => state.map.setView([p.coords.latitude, p.coords.longitude], 13),
      () => {}
    );
  }

  // Scale bar (dynamic — updates automatically on zoom, metric only)
  L.control.scale({
    position: 'bottomleft',
    metric: true,
    imperial: false,
    maxWidth: 160
  }).addTo(state.map);

  // Compass rose — magnetometer-based (like Garmin GPS), draggable, double-tap to hide
  const compass = document.getElementById('compass-rose');
  if (compass) {
    let deviceHeading = null;  // degrees from true north (null = no sensor)

    // Update compass rotation: combines device heading + map bearing
    function updateCompass() {
      const mapBearing = state.map.getBearing();
      const heading = deviceHeading !== null ? deviceHeading : 0;
      compass.style.transform = `rotate(${-(heading + mapBearing)}deg)`;
    }

    // Device orientation handler — reads magnetometer
    function onOrientation(e) {
      if (e.webkitCompassHeading !== undefined) {
        // iOS: webkitCompassHeading is degrees from magnetic north (0-360)
        deviceHeading = e.webkitCompassHeading;
      } else if (e.alpha !== null) {
        // Android: alpha is degrees relative to screen, invert for compass heading
        deviceHeading = (360 - e.alpha) % 360;
      }
      updateCompass();
    }

    // Start listening for device orientation (magnetometer)
    function startCompass() {
      if ('ondeviceorientationabsolute' in window) {
        // Android: absolute gives true north
        window.addEventListener('deviceorientationabsolute', onOrientation);
      } else if ('ondeviceorientation' in window) {
        // iOS / fallback: relative orientation
        window.addEventListener('deviceorientation', onOrientation);
      }
    }

    // iOS 13+ requires permission request (must be triggered by user gesture)
    async function requestPermissionAndStart() {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const perm = await DeviceOrientationEvent.requestPermission();
          if (perm === 'granted') startCompass();
        } catch (_) { /* user denied */ }
      } else {
        startCompass();
      }
    }

    // Start sensor immediately (works on Android + desktop)
    requestPermissionAndStart();

    // Also update when map is manually rotated
    state.map.on('rotate', updateCompass);

    // Single click: reset map north (skip if just dragged)
    // On iOS, also triggers permission request if sensor not yet active
    let wasDragged = false;
    compass.addEventListener('click', async () => {
      if (wasDragged) { wasDragged = false; return; }
      // If no sensor data yet, try requesting permission (iOS)
      if (deviceHeading === null) {
        await requestPermissionAndStart();
      }
      state.map.setBearing(0);
    });

    // Double-click: hide compass
    compass.addEventListener('dblclick', e => {
      e.stopPropagation();
      compass.style.display = 'none';
      localStorage.setItem('gc_compass_hidden', '1');
    });

    // Drag support
    let dragging = false, offsetX = 0, offsetY = 0;
    compass.addEventListener('pointerdown', e => {
      dragging = false;
      offsetX = e.clientX - compass.getBoundingClientRect().left;
      offsetY = e.clientY - compass.getBoundingClientRect().top;
      compass.setPointerCapture(e.pointerId);

      const onMove = ev => {
        dragging = true;
        const wrap = document.getElementById('map-wrap').getBoundingClientRect();
        compass.style.right = 'auto';
        compass.style.left = (ev.clientX - wrap.left - offsetX) + 'px';
        compass.style.top = (ev.clientY - wrap.top - offsetY) + 'px';
      };
      const onUp = () => {
        compass.removeEventListener('pointermove', onMove);
        compass.removeEventListener('pointerup', onUp);
        if (dragging) {
          wasDragged = true;
          localStorage.setItem('gc_compass_pos', JSON.stringify({
            left: compass.style.left, top: compass.style.top
          }));
        }
      };
      compass.addEventListener('pointermove', onMove);
      compass.addEventListener('pointerup', onUp);
    });

    // Restore saved position
    const saved = localStorage.getItem('gc_compass_pos');
    if (saved) {
      const pos = JSON.parse(saved);
      compass.style.right = 'auto';
      compass.style.left = pos.left;
      compass.style.top = pos.top;
    }

    // Restore hidden state
    if (localStorage.getItem('gc_compass_hidden') === '1') {
      compass.style.display = 'none';
    }
  }
}

// Re-show compass (called from UI toggle)
export function toggleCompass() {
  const compass = document.getElementById('compass-rose');
  if (!compass) return;
  const hidden = compass.style.display === 'none';
  compass.style.display = hidden ? '' : 'none';
  localStorage.setItem('gc_compass_hidden', hidden ? '0' : '1');
}
window.toggleCompass = toggleCompass;

export function updateDrawControl() {
  if (state.drawControl) state.map.removeControl(state.drawControl);
  state.drawControl = null;

  if (state.mode !== 'collect' || !localStorage.getItem('gc_access')) {
    showHint(false);
    return;
  }

  state.drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: { shapeOptions: { color: '#2d6a28', fillOpacity: 0.2 } },
      marker: {},
      polyline: false, circle: false, rectangle: false, circlemarker: false
    },
    edit: { featureGroup: state.drawnItems, remove: false }
  });
  state.map.addControl(state.drawControl);
  showHint(true);
}

export function styleLayer(layer, cropType) {
  const color = cropType ? (CROP_COLORS[cropType] || '#64748b') : '#94a3b8';
  if (layer.setStyle) {
    layer.setStyle({ color, fillColor: color, fillOpacity: cropType ? 0.25 : 0.1, weight: 2.5 });
  } else if (layer.setIcon) {
    layer.setIcon(L.divIcon({
      html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>`,
      className: '', iconAnchor: [9, 9]
    }));
  }
}

export function rebuildLayers() {
  state.drawnItems.clearLayers();
  state.fields.forEach((f, i) => {
    const layer = createLayer(f.geometry);
    if (!layer) return;
    layer._fi = i;
    styleLayer(layer, f.properties.cropType);
    layer.bindPopup(makePopup(f));
    layer.on('click', () => {
      if (state.mode === 'validate' && _onLayerClick) _onLayerClick(i);
    });
    state.drawnItems.addLayer(layer);
    f._layer = layer;
  });
}

export function createLayer(geo) {
  if (!geo) return null;
  if (geo.type === 'Point') {
    const [lng, lat] = geo.coordinates;
    return L.marker([lat, lng]);
  }
  if (geo.type === 'Polygon') {
    return L.polygon(geo.coordinates[0].map(c => [c[1], c[0]]));
  }
  return null;
}

export function makePopup(f) {
  const p = f.properties;
  const e = CROP_EMOJI[p.cropType] || '🌿';
  return `<b>${e} ${cap(p.cropType)}</b><br>
    ${p.growthStage ? '📈 ' + p.growthStage + '<br>' : ''}
    ${p.cropCondition ? '🌾 ' + cap(p.cropCondition.replace('_', ' ')) + '<br>' : ''}
    ${p.irrigation ? '💧 ' + cap(p.irrigation) + '<br>' : ''}
    ${p.plantingDate ? '📅 Planted: ' + p.plantingDate + '<br>' : ''}
    ${p.notes ? '📝 ' + p.notes + '<br>' : ''}
    ${p.validation ? '✅ ' + p.validation.status + ' (' + p.validation.confidence + '⭐)<br>' : ''}
    <small style="color:#888">${new Date(p.timestamp).toLocaleDateString()}</small>`;
}

export function rebuildLayerControl() {
  if (state.activeLayerCtrl) {
    state.map.removeControl(state.activeLayerCtrl);
    state.activeLayerCtrl = null;
  }

  const overlays = {};
  Object.keys(state.mbtilesLayers).forEach(id => {
    const btn = document.getElementById(`mbt-btn-${id}`);
    const label = btn
      ? btn.closest('div').querySelector('div').textContent.trim()
      : `Layer ${id}`;
    overlays[label] = state.mbtilesLayers[id];
  });
  Object.keys(state.overlayLayers).forEach(id => {
    const name = state.overlayLayers[id]._overlayName || `Route ${id}`;
    overlays['📍 ' + name] = state.overlayLayers[id];
  });
  // Local layers (on-device)
  Object.keys(state.localMBTilesLayers).forEach(key => {
    const layer = state.localMBTilesLayers[key];
    const name = layer._overlayName || key;
    overlays['📱 ' + name] = layer;
  });
  Object.keys(state.localOverlayLayers).forEach(key => {
    const layer = state.localOverlayLayers[key];
    const name = layer._overlayName || key;
    overlays['📱 ' + name] = layer;
  });

  if (state.offlineMode) {
    state.activeLayerCtrl = L.control.layers(
      overlays, {}, { position: 'topright', collapsed: true }
    ).addTo(state.map);
  } else {
    state.activeLayerCtrl = L.control.layers(
      {
        '⬜ None': state.noneLayer,
        '🗺️ OpenStreetMap': state.osmLayer,
        '🛰️ Google Satellite': state.satelliteLayer
      },
      overlays,
      { position: 'topright', collapsed: true }
    ).addTo(state.map);
  }
}
