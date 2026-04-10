// survey.js — Survey CRUD UI for admin users

import { state } from './state.js';
import { toast } from './utils.js';
import { surveyAPI, auth } from './api.js';

let _surveys = [];

export function getSurveys() { return _surveys; }

export async function loadSurveys() {
  if (!auth.isLoggedIn()) return;
  try {
    const res = await surveyAPI.list();
    _surveys = res.results || res;
    populateSurveyDropdown();
    updateSurveysBtnVisibility();
  } catch (e) {
    console.warn('Failed to load surveys:', e);
  }
}

export function populateSurveyDropdown() {
  const sel = document.getElementById('survey-select');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="" disabled selected></option>';
  _surveys.filter(s => s.is_active).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

export function updateSurveysBtnVisibility() {
  const btn = document.getElementById('surveys-btn');
  if (!btn) return;
  btn.style.display = (state.currentUser?.role === 'admin') ? '' : 'none';
}

export function openSurveyManager() {
  renderSurveyList();
  document.getElementById('survey-modal').classList.add('show');
}

export function closeSurveyManager() {
  document.getElementById('survey-modal').classList.remove('show');
}

function renderSurveyList() {
  const el = document.getElementById('survey-list');
  if (!_surveys.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--txt2);padding:1rem;font-size:.85rem">No surveys yet. Create one above.</div>';
    return;
  }
  el.innerHTML = _surveys.map(s => `
    <div class="survey-row">
      <span class="survey-name">${s.name}</span>
      <span class="survey-count">${s.entry_count || 0} entries</span>
      <button class="survey-toggle ${s.is_active ? 'active' : ''}" onclick="toggleSurveyActive(${s.id}, ${!s.is_active})">${s.is_active ? 'Active' : 'Inactive'}</button>
      <button class="survey-del" onclick="deleteSurvey(${s.id})" title="Delete survey"${s.entry_count ? ' disabled style="opacity:.2;cursor:not-allowed"' : ''}>🗑</button>
    </div>
  `).join('');
}

export async function createSurvey() {
  const input = document.getElementById('new-survey-name');
  const name = input.value.trim();
  if (!name) { toast('Enter a survey name', 'err'); return; }
  try {
    await surveyAPI.create({ name });
    input.value = '';
    await loadSurveys();
    renderSurveyList();
    toast('Survey created', 'ok');
  } catch (e) {
    toast('Failed: ' + e.message, 'err');
  }
}

export async function toggleSurveyActive(id, active) {
  try {
    await surveyAPI.update(id, { is_active: active });
    await loadSurveys();
    renderSurveyList();
  } catch (e) {
    toast('Failed: ' + e.message, 'err');
  }
}

export async function deleteSurvey(id) {
  if (!confirm('Delete this survey?')) return;
  try {
    await surveyAPI.delete(id);
    await loadSurveys();
    renderSurveyList();
    toast('Survey deleted', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

// Close modal on outside click or Escape
document.addEventListener('click', e => {
  if (e.target.id === 'survey-modal') closeSurveyManager();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('survey-modal').classList.contains('show')) {
    closeSurveyManager();
  }
});

// Assign to window for onclick= handlers
window.openSurveyManager    = openSurveyManager;
window.closeSurveyManager   = closeSurveyManager;
window.createSurvey         = createSurvey;
window.toggleSurveyActive   = toggleSurveyActive;
window.deleteSurvey         = deleteSurvey;
