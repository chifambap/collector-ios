// utils.js — pure helper functions, no external deps except state for persist()

import { state } from './state.js';

export function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

export function today() {
  return new Date().toISOString().split('T')[0];
}

export function toast(msg, type = 'inf') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

export function dlFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function f2b(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function previewPhotos(input) {
  const prev = document.getElementById('photo-previews');
  prev.innerHTML = '';
  const n = input.files.length;
  document.getElementById('photo-label').textContent =
    n ? `${n} photo${n > 1 ? 's' : ''} selected` : 'Attach field photos (optional)';
  Array.from(input.files).slice(0, 5).forEach(file => {
    const img = document.createElement('img');
    const r = new FileReader();
    r.onload = e => { img.src = e.target.result; };
    r.readAsDataURL(file);
    prev.appendChild(img);
  });
}

export function showHint(show) {
  const el = document.getElementById('draw-hint');
  el.classList.toggle('show', show);
  if (show) {
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 5000);
  }
}

export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Assign to window for onchange= handler in index.html
window.previewPhotos = previewPhotos;

export function persist() {
  try {
    const toSave = state.fields.map(f => ({
      type: f.type,
      geometry: f.geometry,
      properties: {
        ...f.properties,
        photos: [],         // don't persist base64 photos in localStorage
        _layer: undefined
      }
    }));
    localStorage.setItem('crop_v3', JSON.stringify(toSave));
  } catch (e) {
    console.warn('localStorage persist failed:', e);
    toast('⚠️ Storage full — data saved in memory only', 'err');
  }
}
