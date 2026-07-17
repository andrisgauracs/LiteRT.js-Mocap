// Small DOM helpers for the status layer (loading / error states) and toasts.

const layer = () => document.getElementById('status-layer');
const card = () => document.getElementById('status-card');

export function setStatus(title, detail = '', progress = null) {
  layer().classList.remove('hidden');
  card().classList.remove('error');
  document.getElementById('status-title').textContent = title;
  document.getElementById('status-detail').textContent = detail;
  const bar = document.getElementById('status-progress');
  if (progress === null) {
    bar.style.visibility = 'hidden';
  } else {
    bar.style.visibility = 'visible';
    document.getElementById('status-progress-fill').style.width = `${Math.round(progress * 100)}%`;
  }
}

export function hideStatus() {
  layer().classList.add('hidden');
}

export function showError(title, detail = '') {
  layer().classList.remove('hidden');
  card().classList.add('error');
  document.getElementById('status-title').textContent = title;
  document.getElementById('status-detail').textContent = detail;
}

let toastTimer = null;
export function toast(message, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
