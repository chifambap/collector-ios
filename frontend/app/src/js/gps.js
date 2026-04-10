// gps.js — GPS location tracking and select-mode toggle

import { state } from './state.js';
import { toast } from './utils.js';

// Callback wired by app.js to avoid circular dep (gps.js needs setMode from entries.js)
let _setMode = null;
export function setModeCallback(fn) { _setMode = fn; }

export function toggleSelectMode() {
  const btn = document.getElementById('select-btn');
  if (state.mode === 'validate') {
    if (_setMode) _setMode('collect');
    btn.classList.remove('active');
    toast('Select mode off — back to collection', 'inf');
  } else {
    if (_setMode) _setMode('validate');
    btn.classList.add('active');
    toast('👆 Tap a field on the map to select it for validation', 'inf');
  }
}

export function locateUser() {
  const btn = document.getElementById('locate-btn');

  if (state.gpsActive) {
    if (state.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(state.gpsWatchId);
      state.gpsWatchId = null;
    }
    if (state.gpsMarker) { state.map.removeLayer(state.gpsMarker); state.gpsMarker = null; }
    if (state.gpsAccuracyCircle) { state.map.removeLayer(state.gpsAccuracyCircle); state.gpsAccuracyCircle = null; }
    document.getElementById('coords-chip').classList.remove('show');
    btn.classList.remove('active');
    state.gpsActive = false;
    toast('GPS tracking stopped', 'inf');
    return;
  }

  if (!navigator.geolocation) {
    toast('Geolocation is not supported by your browser', 'err');
    return;
  }

  state.gpsActive = true;
  btn.classList.add('active');
  toast('🌐 Getting your location…', 'inf');

  state.gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      const latlng = [lat, lng];

      if (state.gpsMarker) {
        state.gpsMarker.setLatLng(latlng);
      } else {
        state.gpsMarker = L.marker(latlng, {
          icon: L.divIcon({
            html: '<div class="gps-dot"></div>',
            className: '',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          }),
          zIndexOffset: 1000
        }).addTo(state.map);
        state.map.setView(latlng, Math.max(state.map.getZoom(), 14));
      }

      if (state.gpsAccuracyCircle) {
        state.gpsAccuracyCircle.setLatLng(latlng);
        state.gpsAccuracyCircle.setRadius(acc);
      } else {
        state.gpsAccuracyCircle = L.circle(latlng, {
          radius: acc,
          className: 'gps-accuracy',
          weight: 2,
          fillOpacity: 0.08,
          interactive: false
        }).addTo(state.map);
      }

      document.getElementById('coords-text').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('coords-chip').classList.add('show');
    },
    (err) => {
      toast('🌐 Location error: ' + err.message, 'err');
      btn.classList.remove('active');
      state.gpsActive = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// Assign to window for onclick= handlers
window.toggleSelectMode = toggleSelectMode;
window.locateUser       = locateUser;
