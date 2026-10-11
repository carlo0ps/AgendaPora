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
  toast,
  requestError,
  setBusy
} from './utils.js';

let supabase;
let salons = [];

function credentialsReady() {
  if (SUPABASE_URL === 'SUPABASE_URL' || SUPABASE_ANON_KEY === 'SUPABASE_ANON_KEY') throw new Error('Configurá Supabase en js/config.js antes de usar el panel.');
  if (supabase) return;
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
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
  return s.activo && s.vence_el >= dateInput() ? 'Activa' : 'Vencida / pausada';
}

function renderSalons() {
  const rows = salons.map(s => `<tr><td><strong>${e(s.nombre)}</strong><small class="muted">${e(s.slug)}</small></td><td>${e(s.email_contacto||'—')}</td><td>${datePY(s.created_at)}</td><td>${s.ultimo_acceso?new Intl.DateTimeFormat('es-PY',{timeZone:'America/Asuncion',dateStyle:'short',timeStyle:'short'}).format(new Date(s.ultimo_acceso)):'Nunca'}</td><td>${Number(s.cantidad_clientas)} / ${Number(s.cantidad_turnos)}</td><td>${e(salonStatus(s))}<small class="muted"> vence ${datePY(s.vence_el)}</small></td><td>${s.ultimo_pago?datePY(s.ultimo_pago):'Sin pago'}</td><td><div class="table-actions"><button class="small-button primary" data-admin-action="edit" data-id="${e(s.user_id)}">Gestionar</button><button class="small-button" data-admin-action="payment" data-id="${e(s.user_id)}">Registrar pago</button></div></td></tr>`).join('');
  $('#salons-list').innerHTML = rows ? `<table><thead><tr><th>Salón</th><th>Email</th><th>Alta</th><th>Último acceso</th><th>Clientas / turnos</th><th>Estado de cuenta</th><th>Último pago</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty-state"><strong>Todavía no hay salones</strong><span>Las cuentas creadas en Supabase Auth aparecerán acá.</span></div>`;
}
async function refresh() {
  const [dashboard, listing] = await Promise.all([supabase.rpc('admin_dashboard'), supabase.rpc('admin_list_salones')]);
  if (dashboard.error) throw dashboard.error;
  if (listing.error) throw listing.error;
  $('#admin-summary').innerHTML = summaryHTML(dashboard.data);
  salons = listing.data || [];
  renderSalons();
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
  openModal(`Registrar pago · ${s.nombre}`, `<form id="payment-form" class="form-grid"><label class="field">Monto recibido (Gs.)<input name="monto_gs" type="number" min="1" value="${Number(s.precio_mensual_gs)}" required></label><label class="field">Fecha del pago<input name="fecha" type="date" value="${new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion'}).format(new Date())}" required></label><label class="field wide">Extender acceso hasta<input name="periodo_hasta" type="date" value="${new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion'}).format(new Date(Date.now()+30*86400000))}" required></label><label class="field wide">Nota interna<textarea name="nota" maxlength="1000" rows="3"></textarea></label></form>`, `<button class="button ghost" type="button" data-modal-close>Cancelar</button><button class="button primary" type="button" id="save-payment">Registrar pago</button>`);
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
          p_periodo_hasta: fd.get('periodo_hasta'),
          p_nota: fd.get('nota') || null
        });
      if (error) throw error;
      $('#admin-modal').close();
      toast('Pago registrado y vencimiento extendido');
      await refresh();
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
  refresh().catch(error => toast(requestError(error), 'error'));
}

function init() {
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
  $('#salons-list').addEventListener('click', ev => {
    const b = ev.target.closest('[data-admin-action]');
    if (!b) return;
    if (b.dataset.adminAction === 'edit') editSalon(b.dataset.id);
    if (b.dataset.adminAction === 'payment') recordPayment(b.dataset.id);
  });
  $('#admin-logout').addEventListener('click', () => supabase?.auth.signOut());
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
    /* Configuración completada en js/config.js al instalar. */ }
}
init();
