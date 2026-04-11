// auth.js — authentication: login, register, logout, modal UI, local app lock (PIN)
// Trust: device unlock + app PIN gate who may use cached identity when offline.

import { state } from './state.js';
import { toast } from './utils.js';
import {
  authAPI,
  auth,
  isNetworkError,
  verifyOfflineCredentials,
  isLocalLockEnabled,
  isWithinLocalLockGrace,
  markLocalUnlock,
  verifyLocalLockPin,
  setLocalLockPin,
  disableLocalLock,
  isValidAppPin,
} from './api.js';

let _onLoginSuccess = null;
let _onLogout = null;
/** Deferred until local PIN unlock on cold start (session bootstrap). */
let _pendingSessionReady = null;

export function setAuthCallbacks({ onLoginSuccess, onLogout }) {
  _onLoginSuccess = onLoginSuccess;
  _onLogout = onLogout;
}

function hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.classList.add('hidden');
}

function showLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.classList.remove('hidden');
}

export function hideAppUnlockGate() {
  const el = document.getElementById('app-unlock-gate');
  if (el) el.classList.add('hidden');
  document.body.classList.remove('app-locked');
  const pin = document.getElementById('app-unlock-pin');
  if (pin) pin.value = '';
  const err = document.getElementById('app-unlock-error');
  if (err) err.classList.remove('show');
}

function showAppUnlockGate(onSessionReady) {
  _pendingSessionReady = typeof onSessionReady === 'function' ? onSessionReady : null;
  const el = document.getElementById('app-unlock-gate');
  if (el) el.classList.remove('hidden');
  document.body.classList.add('app-locked');
}

function applyRestoredUser(user) {
  state.currentUser = user;
  state.offlineAuthenticated = !auth.isLoggedIn();
  updateAuthUI();
  hideLoginGate();
  hideAppUnlockGate();
  if (state.offlineAuthenticated) showOfflineIndicator();
  else hideOfflineIndicator();
}

/**
 * Bootstrap auth. If app lock is on and grace expired, cached identity is NOT applied
 * until PIN succeeds. Then onSessionReady runs (map/MBTiles bootstrap).
 */
export function initAuth(onSessionReady) {
  state.sessionReady = false;
  state.currentUser = null;

  const user = auth.user;
  const hasIdent = user && (auth.isLoggedIn() || auth.hasSession());

  if (!hasIdent) {
    updateAuthUI();
    showLoginGate();
    hideAppUnlockGate();
    onSessionReady?.();
    return;
  }

  hideLoginGate();

  if (isLocalLockEnabled()) {
    if (isWithinLocalLockGrace()) {
      applyRestoredUser(user);
      state.sessionReady = true;
      onSessionReady?.();
      return;
    }
    showAppUnlockGate(onSessionReady);
    return;
  }

  applyRestoredUser(user);
  state.sessionReady = true;
  onSessionReady?.();
}

/** Resume / tab focus: re-lock if idle past grace (no network). */
export function setupAppLockResume() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!isLocalLockEnabled()) return;
    if (!auth.user || !(auth.isLoggedIn() || auth.hasSession())) return;
    if (isWithinLocalLockGrace()) return;

    const el = document.getElementById('app-unlock-gate');
    if (el && !el.classList.contains('hidden')) return;

    showAppUnlockGate(null);
  });
}

function completeUnlockWithPin() {
  markLocalUnlock();
  if (!state.currentUser && auth.user) {
    applyRestoredUser(auth.user);
    state.sessionReady = true;
    if (_pendingSessionReady) {
      _pendingSessionReady();
      _pendingSessionReady = null;
    }
  } else {
    hideAppUnlockGate();
  }
}

export function handleAppUnlock(e) {
  e.preventDefault();
  const pin = (document.getElementById('app-unlock-pin')?.value || '').trim();
  const errEl = document.getElementById('app-unlock-error');
  if (!verifyLocalLockPin(pin)) {
    if (errEl) {
      errEl.textContent = 'Incorrect PIN';
      errEl.classList.add('show');
    }
    return;
  }
  if (errEl) errEl.classList.remove('show');
  completeUnlockWithPin();
}


export function closePinSetupModal(e) {
  e?.preventDefault?.();
  const m = document.getElementById('pin-setup-modal');
  if (m) m.classList.add('hidden');
}

export function handlePinSetupSave(e) {
  e.preventDefault();
  const p1 = document.getElementById('pin-setup-1')?.value?.trim() || '';
  const p2 = document.getElementById('pin-setup-2')?.value?.trim() || '';
  if (p1 !== p2) {
    toast('PINs do not match', 'inf');
    return;
  }
  try {
    setLocalLockPin(p1);
    toast('App lock enabled', 'ok');
    closePinSetupModal();
    refreshAppLockSection();
  } catch (err) {
    toast(err.message || 'Invalid PIN', 'inf');
  }
}

function maybePromptPinSetup() {
  if (isLocalLockEnabled()) return;
  const m = document.getElementById('pin-setup-modal');
  if (m) m.classList.remove('hidden');
}

export function refreshAppLockSection() {
  const on = isLocalLockEnabled();
  const dis = document.getElementById('app-lock-disabled-panel');
  const en = document.getElementById('app-lock-enabled-panel');
  if (dis) dis.style.display = on ? 'none' : 'block';
  if (en) en.style.display = on ? 'block' : 'none';
}

export function handleAccountEnableAppLock(e) {
  e.preventDefault();
  const p1 = document.getElementById('acct-pin-new')?.value?.trim() || '';
  const p2 = document.getElementById('acct-pin-new2')?.value?.trim() || '';
  if (p1 !== p2) {
    toast('PINs do not match', 'inf');
    return;
  }
  try {
    setLocalLockPin(p1);
    markLocalUnlock();
    toast('App lock enabled', 'ok');
    refreshAppLockSection();
  } catch (err) {
    toast(err.message || 'Invalid PIN', 'inf');
  }
}

export function handleAccountDisableAppLock(e) {
  e.preventDefault();
  disableLocalLock();
  toast('App lock disabled', 'inf');
  refreshAppLockSection();
}

function showOfflineIndicator() {
  const bar = document.getElementById('offline-auth-bar');
  if (bar) bar.classList.add('show');
}

export function hideOfflineIndicator() {
  const bar = document.getElementById('offline-auth-bar');
  if (bar) bar.classList.remove('show');
}

export function updateAuthUI() {
  const btn = document.getElementById('account-btn');
  if (!btn) return;
  if (state.currentUser) {
    btn.textContent = '✓ ' + state.currentUser.username;
    btn.style.background = 'rgba(39,174,96,.25)';
    btn.style.borderColor = 'rgba(39,174,96,.4)';
  } else {
    btn.textContent = '👤 Login';
    btn.style.background = '';
    btn.style.borderColor = '';
  }
}

export function openAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (state.currentUser) {
    switchAuthTab('account');
    document.getElementById('user-avatar').textContent =
      state.currentUser.username.charAt(0).toUpperCase();
    document.getElementById('user-name').textContent = state.currentUser.username;
    document.getElementById('user-role').textContent = state.currentUser.role || 'collector';
    refreshAppLockSection();
  } else {
    switchAuthTab('login');
  }
  modal.classList.add('show');
  document.getElementById('auth-error').classList.remove('show');
}

export function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('show');
}

export function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('show'));
  document.getElementById('auth-error').classList.remove('show');

  if (tab === 'login') {
    document.querySelectorAll('.auth-tab')[0].classList.add('active');
    document.getElementById('form-login').classList.add('show');
    document.getElementById('auth-tabs').style.display = 'flex';
  } else if (tab === 'register') {
    document.querySelectorAll('.auth-tab')[1].classList.add('active');
    document.getElementById('form-register').classList.add('show');
    document.getElementById('auth-tabs').style.display = 'flex';
  } else if (tab === 'pending') {
    document.getElementById('form-pending').classList.add('show');
    document.getElementById('auth-tabs').style.display = 'none';
  } else if (tab === 'account') {
    document.getElementById('form-account').classList.add('show');
    document.getElementById('auth-tabs').style.display = 'none';
    refreshAppLockSection();
  }
}

export function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.add('show');
}

function afterSuccessfulServerLogin() {
  markLocalUnlock();
  state.sessionReady = true;
}

export async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const data = await authAPI.login(username, password);
    state.currentUser = data.user;
    state.offlineAuthenticated = false;
    afterSuccessfulServerLogin();
    updateAuthUI();
    closeAuthModal();
    hideLoginGate();
    toast('Logged in as ' + state.currentUser.username, 'ok');
    e.target.reset();
    if (_onLoginSuccess) _onLoginSuccess();
    maybePromptPinSetup();
  } catch (err) {
    _handleLoginError(err, username, password, showAuthError, () => {
      closeAuthModal();
      hideLoginGate();
      e.target.reset();
    });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

export async function handleGateLogin(e) {
  e.preventDefault();
  const username = document.getElementById('gate-username').value;
  const password = document.getElementById('gate-password').value;
  const btn = document.getElementById('gate-btn');
  const errEl = document.getElementById('gate-error');
  btn.disabled = true;
  btn.textContent = 'Logging in...';
  errEl.classList.remove('show');

  const showErr = (msg) => { errEl.textContent = msg; errEl.classList.add('show'); };

  try {
    const data = await authAPI.login(username, password);
    state.currentUser = data.user;
    state.offlineAuthenticated = false;
    afterSuccessfulServerLogin();
    updateAuthUI();
    hideLoginGate();
    toast('Logged in as ' + state.currentUser.username, 'ok');
    e.target.reset();
    if (_onLoginSuccess) _onLoginSuccess();
    maybePromptPinSetup();
  } catch (err) {
    _handleLoginError(err, username, password, showErr, () => {
      hideLoginGate();
      e.target.reset();
    });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

function _handleLoginError(err, username, password, showErr, onSuccess) {
  const networkFail = isNetworkError(err);

  if (networkFail && auth.hasSession()) {
    state.currentUser = auth.user;
    state.offlineAuthenticated = true;
    markLocalUnlock();
    state.sessionReady = true;
    updateAuthUI();
    showOfflineIndicator();
    toast('Offline — using cached session', 'inf');
    onSuccess();
    if (_onLoginSuccess) _onLoginSuccess();
    return;
  }

  if (networkFail) {
    const result = verifyOfflineCredentials(username, password);
    if (result.ok) {
      state.currentUser = result.user;
      state.offlineAuthenticated = true;
      markLocalUnlock();
      state.sessionReady = true;
      updateAuthUI();
      showOfflineIndicator();
      toast('Offline login as ' + state.currentUser.username, 'inf');
      onSuccess();
      if (_onLoginSuccess) _onLoginSuccess();
      return;
    }
    showErr('Cannot reach server. ' + result.reason);
    return;
  }

  showErr(err.message);
}

export async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value;
  const email    = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const org      = document.getElementById('reg-org').value;
  const btn = document.getElementById('reg-btn');

  if (password !== password2) { showAuthError('Passwords do not match'); return; }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    await authAPI.register({ username, email, password, password2, organisation: org });
    e.target.reset();
    switchAuthTab('pending');
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

export async function handleLogout() {
  try {
    await authAPI.logout();
  } catch (e) {
    // Ignore logout API errors
  } finally {
    _logout();
  }
}

function _logout() {
  state.currentUser = null;
  state.offlineAuthenticated = false;
  state.sessionReady = false;
  updateAuthUI();
  closeAuthModal();
  closePinSetupModal();
  showLoginGate();
  hideAppUnlockGate();
  hideOfflineIndicator();
  toast('Logged out', 'inf');
  if (_onLogout) _onLogout();
}

window.openAuthModal   = openAuthModal;
window.closeAuthModal  = closeAuthModal;
window.switchAuthTab   = switchAuthTab;
window.handleLogin     = handleLogin;
window.handleGateLogin = handleGateLogin;
window.handleRegister  = handleRegister;
window.handleLogout    = handleLogout;
window.hideLoginGate   = hideLoginGate;
window.handleAppUnlock = handleAppUnlock;
window.closePinSetupModal = closePinSetupModal;
window.handlePinSetupSave = handlePinSetupSave;
window.handleAccountEnableAppLock = handleAccountEnableAppLock;
window.handleAccountDisableAppLock = handleAccountDisableAppLock;
