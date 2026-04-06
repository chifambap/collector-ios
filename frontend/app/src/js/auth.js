// auth.js — authentication: login, register, logout, modal UI

import { state } from './state.js';
import { toast } from './utils.js';
import { authAPI, auth, isNetworkError, verifyOfflineCredentials } from './api.js';

// Callbacks wired by app.js to avoid circular deps
let _onLoginSuccess = null;
let _onLogout = null;

export function setAuthCallbacks({ onLoginSuccess, onLogout }) {
  _onLoginSuccess = onLoginSuccess;
  _onLogout = onLogout;
}

export function initAuth() {
  const user = auth.user;
  if (user && (auth.isLoggedIn() || auth.refresh)) {
    state.currentUser = user;
    state.offlineAuthenticated = !auth.isLoggedIn();
    updateAuthUI();
    hideLoginGate();
    if (state.offlineAuthenticated) showOfflineIndicator();
  }
}

function hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.classList.add('hidden');
}

function showLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.classList.remove('hidden');
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
  }
}

export function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.add('show');
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
    updateAuthUI();
    closeAuthModal();
    hideLoginGate();
    toast('Logged in as ' + state.currentUser.username, 'ok');
    e.target.reset();
    if (_onLoginSuccess) _onLoginSuccess();
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
    updateAuthUI();
    hideLoginGate();
    toast('Logged in as ' + state.currentUser.username, 'ok');
    e.target.reset();
    if (_onLoginSuccess) _onLoginSuccess();
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

// Unified offline fallback for both gate and modal login
function _handleLoginError(err, username, password, showErr, onSuccess) {
  const networkFail = isNetworkError(err);

  // Priority 1: JWT offline — if we have cached session data, use it directly
  if (networkFail && auth.hasSession()) {
    state.currentUser = auth.user;
    state.offlineAuthenticated = true;
    updateAuthUI();
    showOfflineIndicator();
    toast('Offline — using cached session', 'inf');
    onSuccess();
    if (_onLoginSuccess) _onLoginSuccess();
    return;
  }

  // Priority 2: Password hash offline — verify entered credentials against cached hash
  if (networkFail) {
    const result = verifyOfflineCredentials(username, password);
    if (result.ok) {
      state.currentUser = result.user;
      state.offlineAuthenticated = true;
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

  // Priority 3: Server returned an error — show it directly
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
  updateAuthUI();
  closeAuthModal();
  showLoginGate();
  hideOfflineIndicator();
  toast('Logged out', 'inf');
  if (_onLogout) _onLogout();
}

// Assign to window for onclick= handlers
window.openAuthModal   = openAuthModal;
window.closeAuthModal  = closeAuthModal;
window.switchAuthTab   = switchAuthTab;
window.handleLogin     = handleLogin;
window.handleGateLogin = handleGateLogin;
window.handleRegister  = handleRegister;
window.handleLogout    = handleLogout;
window.hideLoginGate   = hideLoginGate;
