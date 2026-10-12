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
// Build the local calendar date from parts so it stays correct across browser locales/timezones.
export const dateInput = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
export const daysUntil = (dateValue, today = dateInput()) => {
  if (!dateValue) return null;
  const parse = value => {
    const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.floor((parse(dateValue) - parse(today)) / 86400000);
};
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
export function noStoreFetch(input, init = {}) {
  return fetch(input, { ...init, cache: 'no-store' });
}
export function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  const brandColor = getComputedStyle(document.body).getPropertyValue('--primary-fill').trim();
  applyBrandColor(brandColor);
}
export function syncThemeFromStorage() {
  window.addEventListener('storage', event => {
    if (event.key === 'agendapora-theme') applyTheme(event.newValue || 'light');
  });
}
export function applyBrandColor(value, root = document.body) {
  if (!/^#[0-9a-f]{6}$/i.test(String(value || ''))) return;
  const parts = value.slice(1).match(/../g).map(c => parseInt(c, 16));
  const mix = (target, ratio) => '#' + parts.map(n => Math.round(n * (1 - ratio) + target * ratio).toString(16).padStart(2, '0')).join('');
  const luminance = color => color.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const darkText = getComputedStyle(root).getPropertyValue('--on-primary-dark').trim();
  const lightText = getComputedStyle(root).getPropertyValue('--on-primary-light').trim();
  const foreground = color => luminance(color) > .179 ? darkText : lightText;
  const hover = mix(0, .22);
  const darkMode = root.classList.contains('dark');
  root.style.setProperty('--primary-fill', value);
  root.style.setProperty('--primary-hover', hover);
  root.style.setProperty('--primary-soft', mix(darkMode ? 0 : 255, darkMode ? .56 : .91));
  root.style.setProperty('--on-primary', foreground(value));
  root.style.setProperty('--on-primary-hover', foreground(hover));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = value;
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
  return String(template ?? '').replace(/\{(nombre|fecha|hora|deuda|salon|servicio|resena)\}/g, (_, key) => String(data[key] ?? ''));
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
  if (error.code === 'PGRST202' || error.code === 'PGRST203') {
    const missing = String(error.message || '').toLocaleLowerCase('es');
    return /guardar_turno|mover_turno|cobrar_turno_rapido|anular_cobro_turno|marcar_agradecido/.test(missing)
      ? 'Falta publicar las funciones nuevas. Ejecutá supabase/migracion_04.sql en Supabase → SQL Editor y volvé a intentar.'
      : 'La base todavía no tiene publicada la función de pagos actualizada. Ejecutá supabase/migracion_01.sql en el SQL Editor de Supabase y volvé a intentar.';
  }
  if (error.code === '42501' || error.code === 'PGRST301') return 'Tu cuenta está en modo de solo lectura. Renová la suscripción o contactá a soporte para seguir editando.';
  return error.message || 'Ocurrió un error inesperado.';
}
