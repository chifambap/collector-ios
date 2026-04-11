// gps.js — GPS location tracking and select-mode toggle

import { state } from './state.js';
import { toast } from './utils.js';

// Callback wired by app.js to avoid circular dep (gps.js needs setMode from entries.js)
let _setMode = null;
export function setModeCallback(fn) { _setMode = fn; }

// Follow mode: map pans to keep arrow centred. Disabled when user manually pans.
let _followMode = false;
let _dragListener = null;

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

// Build the arrow icon HTML at a given rotation (degrees, 0 = north/up)
function _arrowHtml(deg) {
  const rot = (deg != null && !isNaN(deg)) ? deg : 0;
  return `<div class="gps-arrow" style="transform:rotate(${rot}deg)">
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <polygon points="18,3 10,30 18,24" fill="#1a6db5"/>
      <polygon points="18,3 26,30 18,24" fill="#2980b9"/>
      <polygon points="18,3 26,30 18,24" fill="rgba(255,255,255,0.22)"/>
      <polygon points="10,30 18,24 26,30 18,27" fill="rgba(41,128,185,0.45)"/>
    </svg>
  </div>`;
}

// Update arrow rotation without recreating the marker
function _updateArrowRotation(deg) {
  if (deg == null || isNaN(deg)) return;
  const el = state.gpsMarker?.getElement?.()?.querySelector('.gps-arrow');
  if (el) el.style.transform = `rotate(${deg}deg)`;
}

// Enable follow mode: map pans to arrow on every position update
function _enableFollow() {
  _followMode = true;
  const btn = document.getElementById('locate-btn');
  if (btn) btn.classList.add('follow');

  // Stop following when user manually drags the map
  if (!_dragListener) {
    _dragListener = () => {
      _followMode = false;
      const b = document.getElementById('locate-btn');
      if (b) b.classList.remove('follow');
    };
    state.map.once('dragstart', _dragListener);
  }
}

function _disableFollow() {
  _followMode = false;
  _dragListener = null;
  const btn = document.getElementById('locate-btn');
  if (btn) btn.classList.remove('follow');
}

export function locateUser() {
  const btn = document.getElementById('locate-btn');

  // GPS already active: if follow mode lost, re-centre and re-enable follow.
  // If already following, stop GPS entirely.
  if (state.gpsActive) {
    if (!_followMode && state.gpsMarker) {
      // Re-centre and resume follow
      _enableFollow();
      state.map.setView(state.gpsMarker.getLatLng(), Math.max(state.map.getZoom(), 14), { animate: true });
      return;
    }

    // Stop GPS
    if (state.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(state.gpsWatchId);
      state.gpsWatchId = null;
    }
    if (state.gpsMarker) { state.map.removeLayer(state.gpsMarker); state.gpsMarker = null; }
    if (state.gpsAccuracyCircle) { state.map.removeLayer(state.gpsAccuracyCircle); state.gpsAccuracyCircle = null; }
    document.getElementById('coords-chip').classList.remove('show');
    btn.classList.remove('active');
    _disableFollow();
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

      // Heading: GPS-derived when moving, compass fallback when stationary
      const heading = pos.coords.heading ?? state.compassHeading ?? null;

      if (state.gpsMarker) {
        state.gpsMarker.setLatLng(latlng);
        _updateArrowRotation(heading);
      } else {
        state.gpsMarker = L.marker(latlng, {
          icon: L.divIcon({
            html: _arrowHtml(heading),
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
          }),
          zIndexOffset: 1000
        }).addTo(state.map);
        // First fix: centre map and start following
        state.map.setView(latlng, Math.max(state.map.getZoom(), 14), { animate: true });
        _enableFollow();
      }

      // Pan map to keep arrow centred when in follow mode
      if (_followMode) {
        state.map.panTo(latlng, { animate: true, duration: 0.5, easeLinearity: 0.5 });
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
      _disableFollow();
      state.gpsActive = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// Assign to window for onclick= handlers
window.toggleSelectMode = toggleSelectMode;
window.locateUser       = locateUser;
