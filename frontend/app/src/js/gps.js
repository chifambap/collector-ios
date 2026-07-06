// gps.js — GPS location tracking and select-mode toggle

import { state } from './state.js';
import { toast } from './utils.js';

// Callback wired by app.js to avoid circular dep (gps.js needs setMode from entries.js)
let _setMode = null;
export function setModeCallback(fn) { _setMode = fn; }

// Follow mode: map pans to keep the arrow centred. It is broken by ANY manual
// map gesture — pan, zoom (wheel / pinch / zoom buttons / double-click) — so the
// user can freely explore other areas without the map snapping back on the next
// GPS fix. We listen for genuine USER input signals (not Leaflet's generic
// zoomstart, which also fires for our own programmatic recentre), so there is no
// race between our auto-pan and the user's gesture.
let _followMode = false;
let _interactionBound = false;

function _breakFollowOnUserGesture() {
  if (!_followMode) return;
  _disableFollow();
  toast('Map unlocked — tap 🌐 to recentre on your location', 'inf');
}

// Attach user-gesture listeners exactly once for the map's lifetime.
function _bindInteractionOnce() {
  if (_interactionBound || !state.map) return;
  _interactionBound = true;
  const brk = _breakFollowOnUserGesture;

  state.map.on('dragstart', brk);   // one-finger / mouse pan (user-only in Leaflet)
  state.map.on('dblclick', brk);    // double-click / double-tap zoom

  const c = state.map.getContainer();
  c.addEventListener('wheel', brk, { passive: true });                 // scroll zoom
  c.addEventListener('touchstart', (e) => {                            // pinch zoom
    if (e.touches && e.touches.length >= 2) brk();
  }, { passive: true });
  // Zoom control +/- buttons
  c.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.leaflet-control-zoom')) brk();
  });
}

// Recentre / follow the arrow ourselves. Pass a zoom to also set zoom (initial
// fix / manual recentre); omit to pan only. These are programmatic and do NOT
// trip the user-gesture listeners above.
function _selfMoveTo(latlng, zoom) {
  if (zoom != null) state.map.setView(latlng, zoom, { animate: true });
  else state.map.panTo(latlng, { animate: true, duration: 0.5, easeLinearity: 0.5 });
}

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

// Last known real-world heading (degrees clockwise from true north), or null.
let _lastHeading = null;

// On-screen rotation for the arrow = real-world heading + current map bearing.
// The marker icon is NOT rotated with the map (leaflet-rotate rotateWithView is
// false), while the terrain pane IS rotated by +bearing. So we add the bearing
// ourselves; otherwise the arrow keeps pointing screen-relative and no longer
// matches the roads/fields once the user rotates the map.
function _arrowScreenDeg() {
  const bearing = state.map && state.map.getBearing ? state.map.getBearing() : 0;
  return (_lastHeading != null ? _lastHeading : 0) + bearing;
}

// Build the arrow icon HTML at a given screen rotation (degrees, 0 = up)
function _arrowHtml(deg) {
  const rot = (deg != null && !isNaN(deg)) ? deg : 0;
  return `<div class="gps-arrow" style="transform:rotate(${rot}deg)">
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <polygon points="18,2 4,34 18,24 32,34" fill="#6b6b6b"/>
    </svg>
  </div>`;
}

// Store a new heading (if given) and re-apply the on-screen arrow rotation.
// Called on each GPS fix (new heading) and on every map 'rotate' (bearing change).
function _applyArrowRotation(heading) {
  if (heading != null && !isNaN(heading)) _lastHeading = heading;
  const el = state.gpsMarker?.getElement?.()?.querySelector('.gps-arrow');
  if (el) el.style.transform = `rotate(${_arrowScreenDeg()}deg)`;
}

// Map 'rotate' handler: re-orient the arrow to the new bearing (no new fix).
function _onMapRotate() {
  if (state.gpsMarker) _applyArrowRotation();
}

// Enable follow mode: map pans to arrow on every position update
function _enableFollow() {
  _bindInteractionOnce();
  _followMode = true;
  const btn = document.getElementById('locate-btn');
  if (btn) btn.classList.add('follow');
}

function _disableFollow() {
  _followMode = false;
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
      _selfMoveTo(state.gpsMarker.getLatLng(), Math.max(state.map.getZoom(), 14));
      return;
    }

    // Stop GPS
    if (state.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(state.gpsWatchId);
      state.gpsWatchId = null;
    }
    if (state.map.getBearing) state.map.off('rotate', _onMapRotate);
    _lastHeading = null;
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
        _applyArrowRotation(heading);
      } else {
        if (heading != null && !isNaN(heading)) _lastHeading = heading;
        state.gpsMarker = L.marker(latlng, {
          icon: L.divIcon({
            html: _arrowHtml(_arrowScreenDeg()),
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
          }),
          zIndexOffset: 1000
        }).addTo(state.map);
        // Keep the arrow aligned with the terrain while the map is rotated.
        if (state.map.getBearing) state.map.on('rotate', _onMapRotate);
        // First fix: centre map and start following
        _enableFollow();
        _selfMoveTo(latlng, Math.max(state.map.getZoom(), 14));
      }

      // Pan map to keep arrow centred when in follow mode
      if (_followMode) {
        _selfMoveTo(latlng);
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
