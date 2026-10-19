import {
  createClient
} from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from './config.js';
import {
  $,
  escapeHTML as e,
  money,
  datePY,
  dateInput,
  daysUntil,
  toast,
  requestError,
  setBusy,
  noStoreFetch,
  applyTheme,
  syncThemeFromStorage
} from './utils.js';

let supabase;
let salons = [];
const SALON_PAGE_SIZE = 25;
let salonPage = 0;
const BACKUP_PAGE_SIZE = 250;
const BACKUP_REMINDER_KEY = 'agendapora-admin-last-backup';
const BACKUP_TABLES = [
  'perfiles', 'clientas', 'servicios', 'turnos', 'turno_servicios', 'pagos', 'plantillas',
  'gastos', 'productos', 'empleadas', 'solicitudes_reserva', 'solicitudes_reserva_servicios',
  'pagos_suscripcion', 'horarios_especiales', 'fotos_clienta'
];

function credentialsReady() {
  if (SUPABASE_URL === 'SUPABASE_URL' || SUPABASE_ANON_KEY === 'SUPABASE_ANON_KEY') throw new Error('Configurá Supabase en js/config.js antes de usar el panel.');
  if (supabase) return;
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    global: {
      fetch: noStoreFetch
    }
  });
}

function openModal(title, body, footer) {
  $('#admin-modal-title').textContent = title;
  $('#admin-modal-body').innerHTML = body;
  $('#admin-modal-footer').innerHTML = footer;
  $('#admin-modal').showModal();
}

function summaryHTML(data) {
  return [
    ['Cuentas', data.total],
    ['Activas', data.activas],
    ['Vencidas o pausadas', data.vencidas],
    ['MRR estimado', money(data.mrr_gs)]
  ].map(([label, value]) => `<article class="metric-card"><div class="metric-label">${e(label)}</div><div class="metric-value">${e(value)}</div><div class="metric-note">${label==='MRR estimado'?'Planes con pago vigente':'Salones registrados'}</div></article>`).join('');
}

function salonStatus(s) {
  const remaining = daysUntil(s.vence_el);
  return s.activo && remaining !== null && remaining >= 0 ? 'Activa' : 'Vencida / pausada';
}

function renderSalons() {
  if (!salons.length) {
    $('#salons-list').innerHTML = `<div class="empty-state"><strong>Todavía no hay salones</strong><span>Las cuentas creadas en Supabase Auth aparecerán acá.</span></div>`;
    return;
  }
  const pages = Math.ceil(salons.length / SALON_PAGE_SIZE);
  salonPage = Math.min(salonPage, pages - 1);
  const start = salonPage * SALON_PAGE_SIZE;
  const rows = salons.slice(start, start + SALON_PAGE_SIZE).map(s => `<tr><td><strong>${e(s.nombre)}</strong><small class="muted">${e(s.slug)}</small></td><td>${e(s.email_contacto||'—')}</td><td>${datePY(s.created_at)}</td><td>${s.ultimo_acceso?new Intl.DateTimeFormat('es-PY',{timeZone:'America/Asuncion',dateStyle:'short',timeStyle:'short'}).format(new Date(s.ultimo_acceso)):'Nunca'}</td><td>${Number(s.cantidad_clientas)} / ${Number(s.cantidad_turnos)}</td><td>${e(salonStatus(s))}<small class="muted"> vence ${datePY(s.vence_el)}</small></td><td>${s.ultimo_pago?datePY(s.ultimo_pago):'Sin pago'}</td><td><div class="table-actions"><button class="small-button primary" data-admin-action="edit" data-id="${e(s.user_id)}">Gestionar</button><button class="small-button" data-admin-action="payment" data-id="${e(s.user_id)}">Registrar pago</button></div></td></tr>`).join('');
  const pagination = pages <= 1 ? '' : `<nav id="salon-pagination" class="table-pagination" aria-label="Paginación de salones"><span aria-live="polite">Mostrando ${start + 1}–${Math.min(start + SALON_PAGE_SIZE, salons.length)} de ${salons.length}</span><div><button class="button ghost" type="button" data-admin-page="-1" ${salonPage===0?'disabled':''}>Anterior</button><span>Página ${salonPage + 1} de ${pages}</span><button class="button ghost" type="button" data-admin-page="1" ${salonPage + 1 >= pages?'disabled':''}>Siguiente</button></div></nav>`;
  $('#salons-list').innerHTML = `<table><thead><tr><th>Salón</th><th>Email</th><th>Alta</th><th>Último acceso</th><th>Clientas / turnos</th><th>Estado de cuenta</th><th>Último pago</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>${pagination}`;
}
async function refresh() {
  const [dashboard, listing] = await Promise.all([supabase.rpc('admin_dashboard'), supabase.rpc('admin_list_salones')]);
  if (dashboard.error) throw dashboard.error;
  if (listing.error) throw listing.error;
  $('#admin-summary').innerHTML = summaryHTML(dashboard.data);
  salons = listing.data || [];
  salonPage = Math.min(salonPage, Math.max(0, Math.ceil(salons.length / SALON_PAGE_SIZE) - 1));
  renderSalons();
}

function backupDatePY(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderBackupReminder() {
  const warning = $('#admin-backup-warning');
  let lastBackup = null;
  try {
    const stored = localStorage.getItem(BACKUP_REMINDER_KEY);
    if (stored) lastBackup = new Date(stored);
  } catch {}
  const validLast = lastBackup && Number.isFinite(lastBackup.getTime());
  const elapsed = validLast ? Date.now() - lastBackup.getTime() : null;
  const days = validLast ? Math.ceil(elapsed / 86400000) : null;
  if (validLast && elapsed <= 7 * 86400000) {
    warning.hidden = true;
    warning.textContent = '';
    return;
  }
  warning.hidden = false;
  warning.textContent = validLast
    ? `El último respaldo descargado en este navegador fue hace ${days} días. Descargá uno nuevo para mantener una copia reciente.`
    : 'No hay un respaldo reciente registrado en este navegador. Descargá un respaldo completo para guardar una copia.';
}

async function fetchBackupTable(table, onProgress) {
  const rows = [];
  let offset = 0;
  let total = null;
  do {
    const { data, error } = await supabase.rpc('admin_respaldo_pagina', {
      p_tabla: table,
      p_offset: offset,
      p_limite: BACKUP_PAGE_SIZE
    });
    if (error) throw error;
    if (!data || data.tabla !== table || !Array.isArray(data.filas)) {
      throw new Error(`Respuesta inválida al leer ${table}.`);
    }
    const pageTotal = Number(data.total);
    if (!Number.isSafeInteger(pageTotal) || pageTotal < 0) throw new Error(`Total inválido al leer ${table}.`);
    total = total === null ? pageTotal : Math.max(total, pageTotal);
    if (!data.filas.length && offset < total) throw new Error(`El respaldo de ${table} quedó incompleto.`);
    rows.push(...data.filas);
    offset += data.filas.length;
    onProgress(table, offset, total);
  } while (offset < total);
  return rows;
}

async function downloadBackup(button) {
  const status = $('#admin-backup-status');
  setBusy(button, true, 'Preparando respaldo…');
  status.textContent = 'Conectando con Supabase…';
  try {
    const tables = {};
    const counts = {};
    for (let index = 0; index < BACKUP_TABLES.length; index += 1) {
      const table = BACKUP_TABLES[index];
      status.textContent = `Leyendo ${table} (${index + 1} de ${BACKUP_TABLES.length})…`;
      tables[table] = await fetchBackupTable(table, (name, loaded, total) => {
        status.textContent = `Leyendo ${name}: ${loaded.toLocaleString('es-PY')} de ${total.toLocaleString('es-PY')} filas…`;
      });
      counts[table] = tables[table].length;
    }
    const date = backupDatePY();
    const backup = {
      formato: 'AgendaPorã respaldo completo',
      version: 1,
      fecha: date,
      generado_en: new Date().toISOString(),
      tablas: tables,
      cantidades: counts
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `respaldo-${date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { localStorage.setItem(BACKUP_REMINDER_KEY, new Date().toISOString()); } catch {}
    renderBackupReminder();
    status.textContent = `Respaldo descargado: ${Object.values(counts).reduce((sum, count) => sum + count, 0).toLocaleString('es-PY')} filas en ${BACKUP_TABLES.length} tablas.`;
    toast(`Respaldo descargado: respaldo-${date}.json`);
  } catch (error) {
    status.textContent = 'No se pudo completar el respaldo. Revisá la conexión y volvé a intentar.';
    toast(requestError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function editSalon(id) {
  const s = salons.find(x => x.user_id === id);
  if (!s) return;
  openModal(`Gestionar · ${s.nombre}`, `<form id="salon-form" class="form-grid"><label class="field wide">Nombre<input value="${e(s.nombre)}" disabled></label><label class="field wide">Correo<input value="${e(s.email_contacto||'')}" disabled></label><label class="field">Vencimiento<input name="vence_el" type="date" value="${e(s.vence_el)}" required></label><label class="field">Precio mensual (Gs.)<input name="precio_mensual_gs" type="number" value="${Number(s.precio_mensual_gs)}" min="0" required></label><label class="check-field wide"><input name="activo" type="checkbox" ${s.activo?'checked':''}> Cuenta activa</label><label class="field wide">Notas internas<textarea name="notas_internas" maxlength="5000" rows="5">${e(s.notas_internas||'')}</textarea></label></form>`, `<button class="button ghost" type="button" data-modal-close>Cancelar</button><button class="button primary" type="button" id="save-salon">Guardar cambios</button>`);
  $('#save-salon').addEventListener('click', async ev => {
    const form = $('#salon-form');
    if (!form.reportValidity()) return;
    const b = ev.currentTarget;
    setBusy(b, true);
    try {
      const fd = new FormData(form),
        {
          error
        } = await supabase.rpc('admin_update_salon', {
          p_user_id: id,
          p_activo: form.elements.activo.checked,
          p_vence_el: fd.get('vence_el'),
          p_notas_internas: fd.get('notas_internas'),
          p_precio_mensual_gs: Number(fd.get('precio_mensual_gs'))
        });
      if (error) throw error;
      $('#admin-modal').close();
      toast('Cuenta actualizada');
      await refresh();
    } catch (error) {
      toast(requestError(error), 'error');
    } finally {
      setBusy(b, false);
    }
  });
}

function recordPayment(id) {
  const s = salons.find(x => x.user_id === id);
  if (!s) return;
  openModal(`Registrar pago · ${s.nombre}`, `<form id="payment-form" class="form-grid"><label class="field">Monto recibido (Gs.)<input name="monto_gs" type="number" min="1" value="${Number(s.precio_mensual_gs)}" required></label><label class="field">Fecha del pago<input name="fecha" type="date" value="${dateInput()}" required></label><label class="field wide">Meses de acceso<input name="meses" type="number" min="1" max="12" value="1" required><small class="muted">El nuevo vencimiento se calcula en el servidor desde la fecha vigente o la fecha de hoy.</small></label><label class="field wide">Nota interna<textarea name="nota" maxlength="1000" rows="3"></textarea></label></form>`, `<button class="button ghost" type="button" data-modal-close>Cancelar</button><button class="button primary" type="button" id="save-payment">Registrar pago</button>`);
  const paymentForm = $('#payment-form');
  paymentForm.elements.meses.addEventListener('input', () => {
    if (paymentForm.elements.monto_gs.dataset.manual !== 'true') {
      paymentForm.elements.monto_gs.value = Number(s.precio_mensual_gs) * Math.max(1, Number(paymentForm.elements.meses.value) || 1);
    }
  });
  paymentForm.elements.monto_gs.addEventListener('input', () => { paymentForm.elements.monto_gs.dataset.manual = 'true'; });
  $('#save-payment').addEventListener('click', async ev => {
    const form = $('#payment-form');
    if (!form.reportValidity()) return;
    const b = ev.currentTarget;
    setBusy(b, true);
    try {
      const fd = new FormData(form),
        {
          error
        } = await supabase.rpc('admin_registrar_pago', {
          p_user_id: id,
          p_monto_gs: Number(fd.get('monto_gs')),
          p_fecha: fd.get('fecha'),
          p_meses: Number(fd.get('meses')),
          p_nota: fd.get('nota') || null
        });
      if (error) throw error;
      $('#admin-modal').close();
      await refresh();
      const updated = salons.find(salon => salon.user_id === id);
      toast(updated
        ? `Pago registrado. ${salonStatus(updated)} hasta ${datePY(updated.vence_el)}.`
        : 'Pago registrado y vencimiento extendido.');
    } catch (error) {
      toast(requestError(error), 'error');
    } finally {
      setBusy(b, false);
    }
  });
}
async function verifyAdmin() {
  const {
    data,
    error
  } = await supabase.rpc('admin_dashboard');
  if (error) throw error;
  return data;
}

function showAdmin() {
  $('#admin-login').classList.add('hidden');
  $('#admin-content').classList.remove('hidden');
  $('#admin-logout').classList.remove('hidden');
  renderBackupReminder();
  refresh().catch(error => toast(requestError(error), 'error'));
}

function init() {
  applyTheme(localStorage.getItem('agendapora-theme') || 'light');
  syncThemeFromStorage();
  $('#salons-list').setAttribute('tabindex', '0');
  $('#salons-list').setAttribute('role', 'region');
  $('#salons-list').setAttribute('aria-label', 'Lista de salones desplazable');
  $('#admin-login-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = ev.submitter;
    setBusy(b, true, 'Ingresando…');
    $('#admin-error').textContent = '';
    try {
      credentialsReady();
      const {
        error
      } = await supabase.auth.signInWithPassword({
        email: $('#admin-email').value.trim(),
        password: $('#admin-password').value
      });
      if (error) throw error;
    } catch (error) {
      $('#admin-error').textContent = error.code === '42501' ? 'Esta cuenta no tiene permisos de administración.' : requestError(error);
      try {
        await supabase?.auth.signOut();
      } catch {}
    } finally {
      setBusy(b, false);
    }
  });
  $('#admin-refresh').addEventListener('click', () => refresh().then(() => toast('Datos actualizados')).catch(error => toast(requestError(error), 'error')));
  $('#admin-backup-download').addEventListener('click', ev => downloadBackup(ev.currentTarget));
  $('#salons-list').addEventListener('click', ev => {
    const pageButton = ev.target.closest('[data-admin-page]');
    if (pageButton) {
      const delta = Number(pageButton.dataset.adminPage);
      salonPage = Math.max(0, Math.min(Math.ceil(salons.length / SALON_PAGE_SIZE) - 1, salonPage + delta));
      renderSalons();
      $(`#salon-pagination [data-admin-page="${delta}"]`)?.focus();
      return;
    }
    const b = ev.target.closest('[data-admin-action]');
    if (!b) return;
    if (b.dataset.adminAction === 'edit') editSalon(b.dataset.id);
    if (b.dataset.adminAction === 'payment') recordPayment(b.dataset.id);
  });
  $('#admin-logout').addEventListener('click', async ev => {
    const button = ev.currentTarget;
    setBusy(button, true, 'Saliendo…');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      toast(requestError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });
  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-modal-close]')) ev.target.closest('dialog')?.close();
  });
  try {
    credentialsReady();
    supabase.auth.onAuthStateChange((event, session) => {
      if (session && ['INITIAL_SESSION', 'SIGNED_IN'].includes(event)) {
        queueMicrotask(() => verifyAdmin().then(showAdmin).catch(error => {
          $('#admin-error').textContent = error.code === '42501' ? 'Esta cuenta no tiene permisos de administración.' : requestError(error);
          supabase.auth.signOut().catch(() => {});
        }));
      } else if (!session && event === 'SIGNED_OUT') {
        $('#admin-content').classList.add('hidden');
        $('#admin-login').classList.remove('hidden');
        $('#admin-logout').classList.add('hidden');
      }
    });
  } catch {
    /* Configuración requerida en js/config.js. */ }
}
init();
