export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
} [char]));
export const money = value => `Gs. ${new Intl.NumberFormat('es-PY',{maximumFractionDigits:0}).format(Number(value)||0)}`;
export const datePY = value => {
  if (!value) return '—';
  const raw = String(value);
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T12:00:00-03:00`);
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
};
export const dateInput = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Asuncion'
}).format(date);
export const shiftDate = (value, days) => {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return dateInput(new Date(Date.UTC(year, month - 1, day + Number(days), 12)));
};
export const weekdayPY = value => {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
};
export const timePY = value => String(value ?? '').includes('T') ? new Intl.DateTimeFormat('es-PY', {
  timeZone: 'America/Asuncion',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
}).format(new Date(value)) : String(value ?? '').slice(0, 5);
export const uuid = () => crypto.randomUUID();
export function applyBrandColor(value, root = document.documentElement) {
  if (!/^#[0-9a-f]{6}$/i.test(String(value || ''))) return;
  const parts = value.slice(1).match(/../g).map(c => parseInt(c, 16));
  const mix = (target, ratio) => '#' + parts.map(n => Math.round(n * (1 - ratio) + target * ratio).toString(16).padStart(2, '0')).join('');
  const luminance = parts.map(n => {
    const c = n / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  root.style.setProperty('--brand', value);
  root.style.setProperty('--brand-dark', mix(0, .22));
  root.style.setProperty('--brand-soft', mix(255, .91));
  root.style.setProperty('--brand-text', luminance > .42 ? '#24191c' : '#ffffff');
}
export function toast(message, kind = 'success') {
  const region = $('#toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  region.append(node);
  setTimeout(() => node.remove(), 4200);
}
export function setBusy(button, busy, label = 'Procesando…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}
export function csvEscape(value) {
  let safe = String(value ?? '');
  if (/^[\t\r ]*[=+@-]/.test(safe)) safe = `'${safe}`;
  return `"${safe.replaceAll('"','""')}"`;
}
export function downloadFile(name, data, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([data], {
    type
  });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: name
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvRows(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(item => item.some(cell => cell.trim()));
}
export function waLink(phone, message) {
  let normalized = String(phone ?? '').replace(/\D/g, '');
  if (normalized.startsWith('0')) normalized = `595${normalized.slice(1)}`;
  else if (normalized && !normalized.startsWith('595') && normalized.length <= 10) normalized = `595${normalized}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
export function fillTemplate(template, data) {
  return String(template ?? '').replace(/\{(nombre|fecha|hora|deuda|salon)\}/g, (_, key) => String(data[key] ?? ''));
}
export function localDateTime(date, time) {
  return new Date(`${date}T${time}:00-03:00`);
}
export function beginningOfWeek(date = new Date()) {
  const [year, month, day] = dateInput(date).split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 15)).getUTCDay();
  return new Date(Date.UTC(year, month - 1, day - ((weekday + 6) % 7), 12));
}
export function requestError(error) {
  if (!error) return 'Ocurrió un error inesperado.';
  if (error.code === '23505') return 'Ese dato ya existe. Revisá e intentá nuevamente.';
  if (error.code === '42501' || error.code === 'PGRST301') return 'Tu cuenta no tiene permiso para esta acción. Revisá tu suscripción.';
  return error.message || 'Ocurrió un error inesperado.';
}
