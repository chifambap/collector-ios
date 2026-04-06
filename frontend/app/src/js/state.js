// state.js — singleton shared mutable state, imported by all modules

export const state = {
  // Map objects
  map: null,
  drawnItems: null,
  drawControl: null,
  noneLayer: null,
  osmLayer: null,
  satelliteLayer: null,
  activeLayerCtrl: null,
  mbtilesLayers: {},
  overlayLayers: {},
  localMBTilesLayers: {},
  localOverlayLayers: {},

  // App mode
  offlineMode: false,
  offlineAuthenticated: false,
  mode: 'collect',          // 'collect' | 'validate'
  pendingLayer: null,       // drawn but not yet saved
  validatingTarget: null,   // index of field being validated
  currentUser: null,

  // GPS
  gpsMarker: null,
  gpsAccuracyCircle: null,
  gpsWatchId: null,
  gpsActive: false,

  // Field data — loaded from localStorage on startup
  fields: JSON.parse(localStorage.getItem('crop_v3') || '[]'),
};
