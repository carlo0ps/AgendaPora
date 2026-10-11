import {
  createClient
} from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPPORT_WHATSAPP,
  PHOTO_BUCKET,
  BRAND_BUCKET
} from './config.js';
import {
  $,
  $$,
  escapeHTML as e,
  money,
  datePY,
  dateInput,
  shiftDate,
  weekdayPY,
  timePY,
  toast,
  setBusy,
  downloadFile,
  csvEscape,
  csvRows,
  waLink,
  fillTemplate,
  beginningOfWeek,
  requestError,
  applyBrandColor
} from './utils.js';

const NAV = [
  ['inicio', '⌂', 'Inicio'],
  ['clientas', '♡', 'Clientas'],
  ['agenda', '▦', 'Agenda'],
  ['solicitudes', '✉', 'Reservas'],
  ['servicios', '✦', 'Servicios'],
  ['recordatorios', '◷', 'Mañana'],
  ['reactivar', '↗', 'Reactivar'],
  ['reportes', '▥', 'Reportes'],
  ['gastos', '−', 'Gastos'],
  ['productos', '◇', 'Insumos'],
  ['empleadas', '♙', 'Equipo'],
  ['configuracion', '⚙', 'Mi salón']
];
const TABLES = ['clientas', 'servicios', 'turnos', 'pagos', 'plantillas', 'gastos', 'productos', 'empleadas', 'solicitudes_reserva', 'fotos_clienta'];
const TEMPLATES = [
  ['recordatorio', 'Recordatorio de turno', 'Hola {nombre} 😊 Te recuerdo tu turno en {salon} el {fecha} a las {hora}. ¡Te esperamos!'],
  ['deuda', 'Aviso de saldo', 'Hola {nombre}, te escribimos de {salon}. Tu saldo pendiente es {deuda}. Cualquier consulta estamos a las órdenes.'],
  ['promo', 'Promoción', 'Hola {nombre} 💕 Tenemos una promo especial en {salon}. ¡Escribinos para reservar!'],
  ['cumple', 'Cumpleaños', '¡Feliz cumpleaños, {nombre}! 🎂 Te deseamos un hermoso día. Te esperamos en {salon} para celebrar.'],
  ['reactivacion', 'Te extrañamos', 'Hola {nombre} 💖 Hace un tiempo no te vemos por {salon}. Nos encantaría volver a atenderte. ¿Agendamos?']
];
const state = {
  client: null,
  profile: null,
  data: Object.fromEntries(TABLES.map(t => [t, []])),
  view: 'inicio',
  search: '',
  agendaDate: dateInput(),
  agendaMode: 'dia',
  reportMode: 'mes',
  installPrompt: null,
  detailsClient: null
};
let supabase;

function readyClient() {
  if (SUPABASE_URL === 'SUPABASE_URL' || SUPABASE_ANON_KEY === 'SUPABASE_ANON_KEY') throw new Error('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en js/config.js.');
  if (supabase) return;
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

function editable() {
  const profile = state.profile;
  return !!profile?.activo && !!profile?.vence_el && profile.vence_el >= dateInput();
}

function logoURL() {
  return state.profile?.logo_url || 'icons/icon.svg';
}

function salonName() {
  return state.profile?.nombre || 'Mi salón';
}

function salonSlug() {
  return state.profile?.slug || '';
}

function bookingURL() {
  return `${location.origin}${location.pathname.replace(/index\.html?$/,'')}reservar.html?salon=${encodeURIComponent(salonSlug())}`;
}

function activeNav(view) {
  return NAV.find(n => n[0] === view) || NAV[0];
}

function navMarkup(mobile = false) {
  const quick = mobile ? [...NAV.filter(([id]) => ['inicio', 'clientas', 'agenda', 'solicitudes'].includes(id)), ['configuracion', '•••', 'Más']] : NAV;
  return quick.map(([id, icon, label]) => {
    const selected = id === 'configuracion' ? !['inicio', 'clientas', 'agenda', 'solicitudes'].includes(state.view) : state.view === id;
    return `<a class="nav-link ${selected?'active':''}" href="#${id}" data-nav="${id}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${e(label)}</span></a>`;
  }).join('');
}

function renderNav() {
  $('#side-nav').innerHTML = navMarkup();
  $('#bottom-nav').innerHTML = navMarkup(true);
}

function setBrand() {
  $('#brand-name').textContent = salonName();
  $('#brand-logo').src = logoURL();
  $('#brand-logo').onerror = () => $('#brand-logo').src = 'icons/icon.svg';
  applyBrandColor(validColor(state.profile?.color_principal) ? state.profile.color_principal : '#a84462');
  const publicLink = $('#public-booking-link');
  publicLink.href = bookingURL();
  publicLink.dataset.copy = bookingURL();
}

function setTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('mis-clientas-theme', theme);
}

function setSubscription() {
  const days = state.profile?.vence_el ? Math.ceil((new Date(`${state.profile.vence_el}T00:00:00Z`) - new Date(`${dateInput()}T00:00:00Z`)) / 86400000) : -1;
  const badge = $('#subscription-badge'),
    alert = $('#subscription-alert');
  badge.textContent = editable() ? `Plan activo · ${days} días` : 'Solo lectura';
  badge.classList.toggle('warn', days <= 7 || !editable());
  if (editable() && days <= 7) {
    alert.innerHTML = `Tu suscripción vence el <strong>${e(datePY(state.profile.vence_el))}</strong>. <a href="${waLink(state.profile.telefono_soporte || SUPPORT_WHATSAPP,`Hola, quiero renovar Mis Clientas para ${salonName()}.`)}" target="_blank" rel="noopener">Consultar renovación</a>`;
    alert.classList.remove('hidden');
  } else alert.classList.add('hidden');
}
async function getProfile() {
  const {
    data,
    error
  } = await supabase.from('perfiles').select('user_id,nombre,slug,telefono,direccion,logo_url,color_principal,horario_texto,horarios,vence_el,activo,visitas_premio,premio_descripcion,telefono_soporte').eq('user_id', state.client.id).single();
  if (error) throw error;
  state.profile = data;
  setBrand();
  setSubscription();
}
async function loadData() {
  const results = await Promise.all(TABLES.map(async table => {
    const rows = [];
    for (let offset = 0;; offset += 1000) {
      const { data, error } = await supabase.from(table).select('*')
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 999);
      if (error && table !== 'solicitudes_reserva') throw error;
      if (error) break;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return [table, rows];
  }));
  for (const [table, data] of results) state.data[table] = data;
}

function clientsSorted() {
  return [...state.data.clientas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function clientById(id) {
  return state.data.clientas.find(c => c.id === id);
}

function serviceById(id) {
  return state.data.servicios.find(s => s.id === id);
}

function employeeById(id) {
  return state.data.empleadas.find(x => x.id === id);
}

function appointments(date) {
  return state.data.turnos.filter(a => a.fecha === date && a.estado !== 'cancelado').sort((a, b) => a.hora.localeCompare(b.hora));
}


function empty(title, body, icon = '♡') {
  return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${icon}</div><strong>${e(title)}</strong><span>${e(body)}</span></div>`;
}

function table(headers, rows) {
  return rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : empty('Todavía está vacío', 'Cuando agregues información, aparecerá acá.', '✦');
}

function metric(label, value, note = '') {
  return `<article class="metric-card"><div class="metric-label">${e(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${e(note)}</div></article>`;
}

function heading(title, sub, actions = '') {
  return `<div class="section-heading"><div><p class="eyebrow">${e(sub)}</p><h2>${e(title)}</h2></div>${actions}</div>`;
}

function applyView() {
  if (!state.client) return;
  state.view = location.hash.replace('#', '') || 'inicio';
  if (!NAV.some(n => n[0] === state.view)) state.view = 'inicio';
  const nav = activeNav(state.view);
  $('#page-title').textContent = nav[2];
  $('#page-kicker').textContent = salonName();
  renderNav();
  const renderers = {
    inicio: renderHome,
    clientas: renderClients,
    agenda: renderAgenda,
    solicitudes: renderRequests,
    servicios: renderServices,
    recordatorios: renderReminders,
    reactivar: renderReactivation,
    reportes: renderReports,
    gastos: renderExpenses,
    productos: renderProducts,
    empleadas: renderEmployees,
    configuracion: renderSettings
  };
  $('#view-root').innerHTML = renderers[state.view]();
  bindView();
}

function renderHome() {
  const today = dateInput(),
    startWeek = dateInput(beginningOfWeek()),
    month = today.slice(0, 7);
  const dayAppointments = appointments(today),
    sumWhere = predicate => state.data.pagos.filter(predicate).reduce((n, payment) => n + Number(payment.monto_gs || 0), 0),
    todayIncome = sumWhere(payment => payment.fecha === today),
    weekIncome = sumWhere(payment => payment.fecha >= startWeek && payment.fecha <= today),
    monthIncome = sumWhere(payment => payment.fecha.startsWith(month));
  const debt = state.data.clientas.reduce((n, c) => n + Number(c.deuda_gs || 0), 0),
    birthdays = state.data.clientas.filter(c => birthdayInWeek(c.fecha_nacimiento)),
    pending = state.data.solicitudes_reserva.filter(r => r.estado === 'pendiente');
  const scheduleRows = dayAppointments.slice(0, 7).map(a => {
    const c = clientById(a.clienta_id),
      s = serviceById(a.servicio_id);
    return `<div class="list-row"><div class="avatar">${e((c?.nombre||a.nombre_publico||'?').slice(0,1).toUpperCase())}</div><div class="list-row-main"><strong>${e(timePY(a.hora))} · ${e(c?.nombre||a.nombre_publico||'Clienta')}</strong><small>${e(s?.nombre||a.servicio_nombre||'Servicio')} · ${money(a.precio_gs)}</small></div><span class="status ${e(a.estado)}">${e(a.estado)}</span></div>`
  });
  const birthdayRows = birthdays.slice(0, 5).map(c => `<div class="list-row"><div class="avatar">🎂</div><div class="list-row-main"><strong>${e(c.nombre)}</strong><small>${e(datePY(c.fecha_nacimiento))}</small></div><a class="small-button primary" href="${waLink(c.telefono,templateMessage('cumple',c,{fecha:'',hora:''}))}" target="_blank" rel="noopener">Saludar</a></div>`);
  return `<div class="page-stack"><div class="metrics-grid">${metric('Turnos de hoy',dayAppointments.length,'En la agenda de hoy')}${metric('Ingresos hoy',money(todayIncome),'Pagos registrados hoy')}${metric('Ingresos semana / mes',`${money(weekIncome)} / ${money(monthIncome)}`,'Abonos cobrados · mes actual')}${metric('Deuda total',money(debt),`${state.data.clientas.filter(c=>Number(c.deuda_gs)>0).length} clientas con saldo`)}</div>
    ${pending.length?`<a class="notice" href="#solicitudes"><strong>${pending.length} solicitud${pending.length>1?'es':''} de reserva pendiente${pending.length>1?'s':''}.</strong> Revisar ahora →</a>`:''}
    <div class="content-grid"><section class="panel"><div class="panel-head"><h2>Agenda de hoy</h2><a href="#agenda">Ver agenda →</a></div><div class="list">${scheduleRows.join('')||empty('Un día para organizar','Todavía no tenés turnos para hoy. Agregá uno o compartí tu link de reservas.','▦')}</div><div class="toolbar" style="margin-top:1rem"><button class="button primary" data-action="new-appointment">＋ Nuevo turno</button><button class="button soft" data-action="share-booking">Compartir reservas</button></div></section><section class="panel"><div class="panel-head"><h2>Cumpleaños de la semana</h2><span>🎂</span></div><div class="list">${birthdayRows.join('')||empty('Esta semana está tranquila','Los próximos cumpleaños van a aparecer acá.','🎂')}</div></section></div>
    <section class="panel"><div class="panel-head"><div><h2>Accesos rápidos</h2><p class="muted tiny">Lo que necesitás, a mano.</p></div></div><div class="toolbar"><button class="button soft" data-action="new-client">＋ Agregar clienta</button><button class="button soft" data-action="share-catalog">Compartir catálogo</button><a class="button ghost" href="#recordatorios">Turnos de mañana</a><button class="button ghost" data-action="backup-json">Descargar respaldo</button></div></section></div>`;
}

function birthdayInWeek(value) {
  if (!value) return false;
  const [year, month, day] = dateInput().split('-').map(Number);
  const now = new Date(Date.UTC(year, month - 1, day)),
    end = new Date(Date.UTC(year, month - 1, day + 7));
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  const candidate = new Date(Date.UTC(year, m - 1, d));
  if (candidate < now) candidate.setUTCFullYear(candidate.getUTCFullYear() + 1);
  return candidate >= now && candidate <= end;
}

function renderClients() {
  const search = state.search.trim().toLocaleLowerCase('es');
  const clients = clientsSorted().filter(c => !search || `${c.nombre} ${c.telefono} ${c.notas||''}`.toLocaleLowerCase('es').includes(search));
  const rows = clients.map(c => `<tr><td><button class="text-button" data-action="client-details" data-id="${e(c.id)}">${e(c.nombre)}</button></td><td>${e(c.telefono||'—')}</td><td>${e(c.email||'—')}</td><td>${money(c.deuda_gs)}</td><td>${Number(c.visitas||0)} visitas${Number(c.visitas||0)>=Number(state.profile?.visitas_premio||10)?' · 🎁':''}</td><td><div class="table-actions"><button class="small-button" data-action="client-details" data-id="${e(c.id)}">Ficha</button><button class="small-button" data-action="edit-client" data-id="${e(c.id)}">Editar</button><button class="small-button danger" data-action="delete-row" data-table="clientas" data-id="${e(c.id)}">Borrar</button>${c.telefono?`<a class="small-button primary" href="${waLink(c.telefono,templateMessage(Number(c.deuda_gs)>0?'deuda':'promo',c))}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div></td></tr>`);
  return `${heading('Clientas','Tu comunidad',`<button class="button primary" data-action="new-client">＋ Agregar clienta</button>`)}<div class="toolbar"><input class="search" id="client-search" type="search" placeholder="Buscar por nombre, teléfono o notas…" value="${e(state.search)}"><button class="button soft" data-action="import-clients">Importar CSV</button><button class="button ghost" data-action="export-clients">Exportar CSV</button></div>${table(['Nombre','Teléfono','Correo','Deuda','Fidelización',''],rows)}`;
}

function renderAgenda() {
  const date = state.agendaDate,
    list = state.agendaMode === 'dia' ? appointments(date) : state.data.turnos.filter(a => a.fecha >= date && a.fecha <= weekEnd(date)).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  const rows = list.map(a => `<tr><td>${state.agendaMode==='semana'?datePY(a.fecha):e(timePY(a.hora))}</td>${state.agendaMode==='semana'?`<td>${e(timePY(a.hora))}</td>`:''}<td><strong>${e(clientById(a.clienta_id)?.nombre||a.nombre_publico||'Clienta')}</strong></td><td>${e(serviceById(a.servicio_id)?.nombre||a.servicio_nombre||'Servicio')}</td><td>${money(a.precio_gs)}</td><td><span class="status ${e(a.estado)}">${e(a.estado)}</span></td><td>${e(employeeById(a.empleada_id)?.nombre||'—')}</td><td><div class="table-actions"><button class="small-button" data-action="edit-appointment" data-id="${e(a.id)}">Editar</button><button class="small-button" data-action="pay-appointment" data-id="${e(a.id)}">Cobrar</button><button class="small-button danger" data-action="delete-row" data-table="turnos" data-id="${e(a.id)}">Borrar</button></div></td></tr>`);
  return `${heading('Agenda','Turnos',`<button class="button primary" data-action="new-appointment">＋ Nuevo turno</button>`)}<div class="toolbar"><button class="button ghost" data-action="agenda-prev">← Anterior</button><label class="field"><span class="tiny muted">Fecha</span><input id="agenda-date" type="date" value="${e(date)}"></label><button class="button ghost" data-action="agenda-next">Siguiente →</button><button class="button ${state.agendaMode==='dia'?'soft':'ghost'}" data-action="agenda-day">Día</button><button class="button ${state.agendaMode==='semana'?'soft':'ghost'}" data-action="agenda-week">Semana</button></div>${table(state.agendaMode==='dia'?['Hora','Clienta','Servicio','Precio','Estado','Empleada','']:['Fecha','Hora','Clienta','Servicio','Precio','Estado','Empleada',''],rows)}`;
}

function weekEnd(start) {
  return shiftDate(start, 6);
}

function renderRequests() {
  const requests = state.data.solicitudes_reserva.filter(r => r.estado === 'pendiente').sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  const rows = requests.map(r => `<tr><td>${e(datePY(r.fecha))} · ${e(timePY(r.hora))}</td><td><strong>${e(r.nombre)}</strong></td><td>${e(r.telefono)}</td><td>${e(serviceById(r.servicio_id)?.nombre||'Servicio')} · ${money(serviceById(r.servicio_id)?.precio_gs||0)}</td><td><div class="table-actions"><button class="small-button primary" data-action="accept-request" data-id="${e(r.id)}">Aceptar</button><button class="small-button danger" data-action="reject-request" data-id="${e(r.id)}">Rechazar</button><a class="small-button" href="${waLink(r.telefono,`Hola ${r.nombre}, recibimos tu solicitud para ${datePY(r.fecha)} a las ${timePY(r.hora)}. Te confirmamos en breve.`)}" target="_blank" rel="noopener">WhatsApp</a></div></td></tr>`);
  return `${heading('Solicitudes de reserva','Reservas públicas',`<button class="button soft" data-action="share-booking">Copiar link</button>`)}<p class="muted">Aceptá para crear el turno en tu agenda. La clienta todavía no recibió confirmación.</p>${table(['Día y hora','Clienta','Teléfono','Servicio','Acciones'],rows)}`;
}

function renderServices() {
  const rows = [...state.data.servicios].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(s => `<tr><td><strong>${e(s.nombre)}</strong></td><td>${money(s.precio_gs)}</td><td>${Number(s.duracion_min)} min</td><td>${s.activo?'Activo':'Oculto'}</td><td><div class="table-actions"><button class="small-button" data-action="edit-service" data-id="${e(s.id)}">Editar</button><button class="small-button danger" data-action="delete-row" data-table="servicios" data-id="${e(s.id)}">Borrar</button></div></td></tr>`);
  return `${heading('Servicios y precios','Catálogo',`<button class="button primary" data-action="new-service">＋ Agregar servicio</button>`)}<div class="toolbar"><button class="button soft" data-action="share-catalog">Compartir por WhatsApp</button></div>${table(['Servicio','Precio','Duración','Estado',''],rows)}`;
}

function renderReminders() {
  const tomorrow = shiftDate(dateInput(), 1),
    key = `reminders:${state.client.id}:${tomorrow}`,
    sent = JSON.parse(localStorage.getItem(key) || '[]');
  const rows = appointments(tomorrow).map(a => {
    const c = clientById(a.clienta_id),
      phone = c?.telefono || a.telefono_publico,
      hasSent = sent.includes(a.id);
    const url = waLink(phone, templateMessage('recordatorio', c || {
      nombre: a.nombre_publico,
      telefono: a.telefono_publico
    }, {
      fecha: datePY(a.fecha),
      hora: timePY(a.hora)
    }));
    return `<tr><td>${e(timePY(a.hora))}</td><td>${e(c?.nombre||a.nombre_publico||'Clienta')}</td><td>${e(phone||'Sin teléfono')}</td><td>${e(serviceById(a.servicio_id)?.nombre||'Servicio')}</td><td>${hasSent?'<span class="status hecho">Enviado</span>':`<div class="table-actions"><a class="small-button primary" href="${url}" target="_blank" rel="noopener">Enviar WhatsApp</a><button class="small-button" data-action="mark-reminder" data-id="${e(a.id)}">Marcar enviado</button></div>`}</td></tr>`
  });
  return `${heading('Turnos de mañana','Recordatorios',`<button class="button soft" data-action="send-all-reminders">Abrir siguiente mensaje</button>`)}<p class="muted">Abrí una conversación por vez. Después de enviar el mensaje desde WhatsApp, marcá esa fila y seguí con la siguiente.</p>${table(['Hora','Clienta','Teléfono','Servicio','Mensaje'],rows)}`;
}

function lastVisit(clientId) {
  return state.data.turnos.filter(a => a.clienta_id === clientId && a.estado === 'hecho').sort((a, b) => b.fecha.localeCompare(a.fecha))[0]?.fecha || null;
}

function renderReactivation() {
  const days = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('dias')) || Number(localStorage.getItem('reactivate-days')) || 60;
  const cut = shiftDate(dateInput(), -days);
  const results = clientsSorted().map(c => ({
    ...c,
    last: lastVisit(c.id)
  })).filter(c => !c.last || c.last <= cut).sort((a, b) => (a.last || '').localeCompare(b.last || ''));
  const rows = results.map(c => `<tr><td><strong>${e(c.nombre)}</strong></td><td>${e(c.telefono||'—')}</td><td>${c.last?datePY(c.last):'Sin turnos registrados'}</td><td>${money(c.deuda_gs)}</td><td><a class="small-button primary" href="${waLink(c.telefono,templateMessage('reactivacion',c))}" target="_blank" rel="noopener">Escribir</a></td></tr>`);
  return `${heading('Volver a conectar','Reactivación')}<div class="toolbar"><label class="field"><span class="tiny muted">Sin venir por</span><select id="reactivate-days"><option value="30" ${days===30?'selected':''}>30 días</option><option value="60" ${days===60?'selected':''}>60 días</option><option value="90" ${days===90?'selected':''}>90 días</option></select></label></div>${table(['Clienta','Teléfono','Última visita','Saldo',''],rows)}`;
}

function renderReports() {
  const appointmentsById = new Map(state.data.turnos.map(appointment => [appointment.id, appointment]));
  const rows = [...state.data.pagos].sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.created_at).localeCompare(String(b.created_at)));
  let filtered = rows,
    labels = [],
    values = [];
  const now = dateInput();
  if (state.reportMode === 'dia') {
    filtered = rows.filter(a => a.fecha === now);
    labels = filtered.map(payment => timePY(payment.created_at));
    values = filtered.map(payment => Number(payment.monto_gs));
  } else if (state.reportMode === 'semana') {
    const start = dateInput(beginningOfWeek());
    filtered = rows.filter(a => a.fecha >= start && a.fecha <= now);
    const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    labels = days;
    values = days.map((_, i) => filtered.filter(a => {
      return (weekdayPY(a.fecha) + 6) % 7 === i
    }).reduce((n, payment) => n + Number(payment.monto_gs), 0));
  } else {
    const month = now.slice(0, 7);
    filtered = rows.filter(a => a.fecha.startsWith(month));
    labels = Array.from({
      length: 31
    }, (_, i) => String(i + 1));
    values = labels.map((_, i) => filtered.filter(payment => Number(payment.fecha.slice(-2)) === i + 1).reduce((n, payment) => n + Number(payment.monto_gs), 0));
  }
  state.chart = {
    labels,
    values
  };
  const total = filtered.reduce((n, payment) => n + Number(payment.monto_gs || 0), 0),
    serviceTotals = new Map(),
    employeeTotals = new Map();
  for (const payment of filtered) {
    const appointment = appointmentsById.get(payment.turno_id);
    const sn = serviceById(appointment?.servicio_id)?.nombre || 'Servicio';
    serviceTotals.set(sn, (serviceTotals.get(sn) || 0) + Number(payment.monto_gs || 0));
    const en = employeeById(appointment?.empleada_id)?.nombre || 'Sin asignar';
    employeeTotals.set(en, (employeeTotals.get(en) || 0) + Number(payment.monto_gs || 0));
  }
  const breakdown = map => [...map].sort((a, b) => b[1] - a[1]).map(([name, value]) => `<div class="list-row"><div class="list-row-main"><strong>${e(name)}</strong></div><strong>${money(value)}</strong></div>`).join('') || empty('Sin movimientos', 'Los pagos registrados aparecerán acá.');
  return `${heading('Ingresos','Reportes')}<div class="toolbar"><button class="button ${state.reportMode==='dia'?'soft':'ghost'}" data-report="dia">Día</button><button class="button ${state.reportMode==='semana'?'soft':'ghost'}" data-report="semana">Semana</button><button class="button ${state.reportMode==='mes'?'soft':'ghost'}" data-report="mes">Mes</button></div><div class="metrics-grid">${metric('Ingresos del período',money(total),`${filtered.length} pagos registrados`)}</div><div class="content-grid"><section class="panel"><div class="panel-head"><h2>Ingresos por ${state.reportMode==='dia'?'hora de pago':state.reportMode==='semana'?'día':'día del mes'}</h2></div><div class="chart-box"><canvas id="income-chart" aria-label="Gráfico de ingresos"></canvas></div></section><section class="panel"><h2>Por servicio</h2><div class="list">${breakdown(serviceTotals)}</div></section><section class="panel"><h2>Por empleada</h2><div class="list">${breakdown(employeeTotals)}</div></section></div>`;
}

function renderExpenses() {
  const rows = [...state.data.gastos].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(x => `<tr><td>${datePY(x.fecha)}</td><td>${e(x.concepto)}</td><td>${e(x.categoria||'—')}</td><td>${money(x.monto_gs)}</td><td><button class="small-button danger" data-action="delete-row" data-table="gastos" data-id="${e(x.id)}">Borrar</button></td></tr>`);
  const month = dateInput().slice(0, 7),
    total = state.data.gastos.filter(x => x.fecha.startsWith(month)).reduce((n, x) => n + Number(x.monto_gs), 0);
  return `${heading('Gastos','Control del salón',`<button class="button primary" data-action="new-expense">＋ Registrar gasto</button>`)}<div class="metrics-grid">${metric('Gastos este mes',money(total),'Registrados en el mes actual')}</div>${table(['Fecha','Concepto','Categoría','Monto',''],rows)}`;
}

function renderProducts() {
  const rows = [...state.data.productos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(x => `<tr><td><strong>${e(x.nombre)}</strong></td><td>${e(x.unidad||'unidad')}</td><td>${Number(x.stock_actual)}</td><td>${Number(x.stock_minimo)}</td><td>${Number(x.stock_actual)<=Number(x.stock_minimo)?'<span class="status pendiente">Stock bajo</span>':'<span class="status hecho">OK</span>'}</td><td><div class="table-actions"><button class="small-button" data-action="edit-product" data-id="${e(x.id)}">Editar</button><button class="small-button danger" data-action="delete-row" data-table="productos" data-id="${e(x.id)}">Borrar</button></div></td></tr>`);
  return `${heading('Productos e insumos','Inventario',`<button class="button primary" data-action="new-product">＋ Agregar producto</button>`)}${table(['Producto','Unidad','Stock actual','Alerta bajo','Estado',''],rows)}`;
}

function renderEmployees() {
  const rows = state.data.empleadas.map(x => `<tr><td><strong>${e(x.nombre)}</strong></td><td>${e(x.telefono||'—')}</td><td>${Number(x.comision_pct)}%</td><td>${x.activa?'Activa':'Inactiva'}</td><td><div class="table-actions"><button class="small-button" data-action="edit-employee" data-id="${e(x.id)}">Editar</button><button class="small-button" data-action="employee-commission" data-id="${e(x.id)}">Comisión del mes</button><button class="small-button danger" data-action="delete-row" data-table="empleadas" data-id="${e(x.id)}">Borrar</button></div></td></tr>`);
  return `${heading('Equipo','Empleadas',`<button class="button primary" data-action="new-employee">＋ Agregar empleada</button>`)}${table(['Nombre','Teléfono','Comisión','Estado',''],rows)}`;
}

function renderSettings() {
  const p = state.profile,
    templates = TEMPLATES.map(([key, label, defaultText]) => ({
      key,
      label,
      row: state.data.plantillas.find(t => t.clave === key),
      defaultText
    }));
  const moreLinks = NAV.filter(([id]) => !['inicio','clientas','agenda','solicitudes','configuracion'].includes(id)).map(([id, icon, label]) => `<a class="button ghost" href="#${id}">${icon} ${e(label)}</a>`).join('');
  return `${heading('Perfil del salón','Configuración')}<section class="panel"><div class="panel-head"><h2>Más herramientas</h2></div><div class="toolbar">${moreLinks}</div></section><div class="content-grid"><form id="profile-form" class="panel form-grid"><label class="field wide">Nombre del salón<input name="nombre" maxlength="100" required value="${e(p.nombre||'')}"></label><label class="field">Slug de reservas<input value="${e(p.slug||'')}" disabled><small class="muted">Tu enlace público incluye este identificador.</small></label><label class="field">Teléfono del salón<input name="telefono" type="tel" maxlength="24" value="${e(p.telefono||'')}"></label><label class="field wide">Dirección<input name="direccion" maxlength="180" value="${e(p.direccion||'')}"></label><label class="field">Color principal<input name="color_principal" type="color" value="${e(validColor(p.color_principal)?p.color_principal:'#a84462')}"></label><label class="field">Visitas para premio<input name="visitas_premio" type="number" min="2" max="100" value="${Number(p.visitas_premio||10)}"></label><label class="field">Premio de fidelidad<input name="premio_descripcion" maxlength="100" value="${e(p.premio_descripcion||'Servicio o descuento especial')}"></label><label class="field">Link WhatsApp renovación<input name="telefono_soporte" type="tel" maxlength="24" value="${e(p.telefono_soporte||'')}"></label><label class="field wide">Horario de atención<input name="horario_texto" maxlength="180" placeholder="Lun a sáb · 08:00 a 18:00" value="${e(p.horario_texto||'')}"></label><label class="field wide">Horario semanal para reservas (JSON)<textarea name="horarios_json" rows="5">${e(JSON.stringify(p.horarios||defaultHours(),null,2))}</textarea><small class="muted">Usá formato 24 h y días 0 domingo… 6 sábado. Ej.: {"1":{"inicio":"08:00","fin":"18:00"}}.</small></label><label class="field wide">Logo del salón<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label><div class="field wide"><button class="button primary" type="submit">Guardar perfil</button></div></form>
    <div class="page-stack"><section class="panel"><h2>Reservas públicas</h2><p class="muted tiny">Compartí el enlace para que tus clientas soliciten horario.</p><input class="input" readonly value="${e(bookingURL())}"><div class="toolbar"><button class="button soft" data-action="share-booking">Copiar link</button><button class="button ghost" data-action="whatsapp-booking">Compartir por WhatsApp</button></div></section><section class="panel"><h2>Fidelización</h2><p class="muted">Cada ${Number(p.visitas_premio||10)} visitas: ${e(p.premio_descripcion||'un premio especial')}.</p></section><section class="panel"><h2>Respaldo y datos</h2><p class="muted tiny">El respaldo contiene la información del salón que puede leer tu cuenta.</p><div class="toolbar"><button class="button soft" data-action="backup-json">Descargar JSON</button><button class="button ghost" data-action="backup-csv">Descargar CSV</button></div></section><section class="panel"><h2>Mensajes de WhatsApp</h2><p class="muted tiny">Editá las plantillas. Variables: {nombre}, {fecha}, {hora}, {deuda}, {salon}.</p>${templates.map(t=>`<label class="field">${e(t.label)}<textarea class="template-input" data-template="${e(t.key)}" rows="3">${e(t.row?.contenido||t.defaultText)}</textarea></label>`).join('')}<button class="button primary" data-action="save-templates">Guardar mensajes</button></section><section class="panel"><h2>Modo de pantalla</h2><p class="muted">Se guarda en este dispositivo.</p><button class="button ghost" data-action="toggle-theme">Cambiar tema</button></section></div></div>`;
}

function validColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}

function defaultHours() {
  return {
    1: {
      inicio: '08:00',
      fin: '18:00'
    },
    2: {
      inicio: '08:00',
      fin: '18:00'
    },
    3: {
      inicio: '08:00',
      fin: '18:00'
    },
    4: {
      inicio: '08:00',
      fin: '18:00'
    },
    5: {
      inicio: '08:00',
      fin: '18:00'
    },
    6: {
      inicio: '08:00',
      fin: '16:00'
    }
  };
}

function templateMessage(key, client, extra = {}) {
  const t = state.data.plantillas.find(x => x.clave === key),
    def = TEMPLATES.find(x => x[0] === key)?.[2] || '';
  return fillTemplate(t?.contenido || def, {
    nombre: client?.nombre || '',
    fecha: extra.fecha || '',
    hora: extra.hora || '',
    deuda: money(client?.deuda_gs || 0),
    salon: salonName()
  });
}

function drawChart(labels, values) {
  const canvas = $('#income-chart');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect(),
    ratio = devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const w = rect.width,
    h = rect.height,
    pad = {
      l: 12,
      r: 12,
      t: 18,
      b: 24
    },
    max = Math.max(...values, 1),
    n = values.length,
    slot = (w - pad.l - pad.r) / n,
    bar = Math.max(3, Math.min(22, slot * .58));
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--line');
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted');
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  for (let i = 0; i < 4; i++) {
    const y = pad.t + (h - pad.t - pad.b) * i / 3;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }
  values.forEach((value, i) => {
    const bh = (h - pad.t - pad.b) * value / max,
      x = pad.l + i * slot + (slot - bar) / 2,
      y = h - pad.b - bh;
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--brand');
    ctx.beginPath();
    ctx.roundRect(x, y, bar, Math.max(bh, 2), 4);
    ctx.fill();
    if (n <= 10 || i % 5 === 0 || i === n - 1) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted');
      ctx.fillText(labels[i], x + bar / 2, h - 7);
    }
  });
}

function bindView() {
  $('#client-search')?.addEventListener('input', ev => {
    state.search = ev.target.value;
    const pos = ev.target.selectionStart;
    applyView();
    const next = $('#client-search');
    next?.focus();
    next?.setSelectionRange(pos, pos);
  });
  $('#agenda-date')?.addEventListener('change', ev => {
    state.agendaDate = ev.target.value;
    applyView();
  });
  $('#reactivate-days')?.addEventListener('change', ev => {
    localStorage.setItem('reactivate-days', ev.target.value);
    applyView();
  });
  if (state.view === 'reportes') {
    drawChart(state.chart?.labels || [], state.chart?.values || []);
    addEventListener('resize', () => drawChart(state.chart?.labels || [], state.chart?.values || []), {
      once: true
    });
  }
  $('#profile-form')?.addEventListener('submit', ev => saveProfile(ev).catch(error => toast(requestError(error), 'error')));
  $$('[data-report]').forEach(b => b.addEventListener('click', () => {
    state.reportMode = b.dataset.report;
    applyView();
  }));
  $('#view-root').onchange = ev => {
    if (ev.target.matches('[data-template]')) ev.target.dataset.changed = '1';
  };
}

function showModal(title, body, submitLabel = 'Guardar') {
  const dialog = $('#modal'),
    alreadyOpen = dialog.open;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-footer').innerHTML = `<button class="button ghost" type="button" data-modal-close>Cancelar</button><button class="button primary" type="button" id="modal-submit">${e(submitLabel)}</button>`;
  if (!alreadyOpen) dialog.showModal();
  return dialog;
}

function formField(label, name, value = '', type = 'text', opts = {}) {
  const required = opts.required ? 'required' : '',
    min = opts.min !== undefined ? `min="${e(opts.min)}"` : '',
    max = opts.max !== undefined ? `max="${e(opts.max)}"` : '',
    maxlength = opts.maxlength ? `maxlength="${e(opts.maxlength)}"` : '';
  if (type === 'textarea') return `<label class="field ${opts.wide?'wide':''}">${e(label)}<textarea name="${e(name)}" ${maxlength} ${required}>${e(value)}</textarea></label>`;
  return `<label class="field ${opts.wide?'wide':''}">${e(label)}<input name="${e(name)}" type="${e(type)}" value="${e(value)}" ${min} ${max} ${maxlength} ${required}></label>`;
}

function selectField(label, name, options, value = '', required = true) {
  return `<label class="field">${e(label)}<select name="${e(name)}" ${required?'required':''}><option value="">Seleccionar…</option>${options.map(([id,label])=>`<option value="${e(id)}" ${String(value)===String(id)?'selected':''}>${e(label)}</option>`).join('')}</select></label>`;
}

function boolField(label, name, value) {
  return `<label class="check-field"><input name="${e(name)}" type="checkbox" ${value?'checked':''}>${e(label)}</label>`;
}

function serviceOptions() {
  return state.data.servicios.filter(s => s.activo).map(s => [s.id, `${s.nombre} · ${money(s.precio_gs)}`]);
}

function employeeOptions() {
  return state.data.empleadas.filter(x => x.activa).map(x => [x.id, x.nombre]);
}

function currentFormData() {
  const form = $('#modal-body form');
  return form ? new FormData(form) : new FormData();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function modalSubmit(fn) {
  const b = $('#modal-submit');
  const submit = async () => {
    const form = $('#modal-body form');
    if (form && !form.reportValidity()) return;
    setBusy(b, true);
    try {
      await fn(form, form ? new FormData(form) : new FormData());
      $('#modal').close();
    } catch (error) {
      toast(requestError(error), 'error');
    } finally {
      setBusy(b, false);
    }
  };
  b.addEventListener('click', submit);
  $('#modal-body form')?.addEventListener('submit', ev => {
    ev.preventDefault();
    submit();
  });
}

function newClientForm(client = {}) {
  const edit = !!client.id;
  showModal(edit ? 'Editar clienta' : 'Nueva clienta', `<form id="entity-form" class="form-grid">${formField('Nombre completo','nombre',client.nombre||'','text',{required:true,maxlength:100})}${formField('Teléfono / WhatsApp','telefono',client.telefono||'','tel',{maxlength:24})}${formField('Correo electrónico','email',client.email||'','email',{maxlength:160})}${formField('Cumpleaños','fecha_nacimiento',client.fecha_nacimiento||'','date')}${formField('Notas / fórmula técnica','notas',client.notas||'','textarea',{wide:true,maxlength:2000})}</form>`, edit ? 'Guardar cambios' : 'Agregar clienta');
  modalSubmit(async form => {
    const raw = formObject(form),
      payload = {
        nombre: raw.nombre.trim(),
        telefono: raw.telefono.trim() || null,
        email: raw.email.trim() || null,
        fecha_nacimiento: raw.fecha_nacimiento || null,
        notas: raw.notas.trim() || null
      };
    const result = edit ? await supabase.from('clientas').update(payload).eq('id', client.id) : await supabase.from('clientas').insert(payload);
    if (result.error) throw result.error;
    toast(edit ? 'Ficha actualizada' : 'Clienta agregada');
    await refresh();
  });
}

function newServiceForm(service = {}) {
  const edit = !!service.id;
  showModal(edit ? 'Editar servicio' : 'Nuevo servicio', `<form id="entity-form" class="form-grid">${formField('Nombre','nombre',service.nombre||'','text',{required:true,maxlength:100})}${formField('Precio (Gs.)','precio_gs',service.precio_gs||0,'number',{required:true,min:0})}${formField('Duración (minutos)','duracion_min',service.duracion_min||60,'number',{required:true,min:5,max:600})}${boolField('Visible en reservas públicas','activo',service.activo!==false)}</form>`, edit ? 'Guardar cambios' : 'Agregar servicio');
  modalSubmit(async form => {
    const raw = formObject(form),
      payload = {
        nombre: raw.nombre.trim(),
        precio_gs: Number(raw.precio_gs),
        duracion_min: Number(raw.duracion_min),
        activo: form.elements.activo.checked
      };
    const result = edit ? await supabase.from('servicios').update(payload).eq('id', service.id) : await supabase.from('servicios').insert(payload);
    if (result.error) throw result.error;
    toast('Servicio guardado');
    await refresh();
  });
}

function appointmentForm(item = {}) {
  const edit = !!item.id;
  showModal(edit ? 'Editar turno' : 'Nuevo turno', `<form id="entity-form" class="form-grid">${selectField('Clienta','clienta_id',clientsSorted().map(c=>[c.id,c.nombre]),item.clienta_id||'')}${selectField('Servicio','servicio_id',serviceOptions(),item.servicio_id||'')}${formField('Fecha','fecha',item.fecha||state.agendaDate,'date',{required:true})}${formField('Hora','hora',timePY(item.hora)||'09:00','time',{required:true})}${formField('Precio (Gs.)','precio_gs',item.precio_gs||0,'number',{required:true,min:0})}${selectField('Empleada','empleada_id',employeeOptions(),item.empleada_id||'',false)}${selectField('Estado','estado',[['pendiente','Pendiente'],['hecho','Hecho'],['cancelado','Cancelado']],item.estado||'pendiente')}${formField('Notas','notas',item.notas||'','textarea',{wide:true,maxlength:1000})}</form>`, edit ? 'Guardar cambios' : 'Agendar turno');
  const form = $('#modal-body form');
  form.elements.servicio_id.addEventListener('change', () => {
    const service = serviceById(form.elements.servicio_id.value);
    if (service) form.elements.precio_gs.value = service.precio_gs;
  });
  modalSubmit(async form => {
    const r = formObject(form),
      payload = {
        clienta_id: r.clienta_id || null,
        servicio_id: r.servicio_id,
        fecha: r.fecha,
        hora: r.hora,
        precio_gs: Number(r.precio_gs),
        empleada_id: r.empleada_id || null,
        estado: r.estado,
        notas: r.notas?.trim() || null
      };
    const result = edit ? await supabase.from('turnos').update(payload).eq('id', item.id) : await supabase.from('turnos').insert(payload);
    if (result.error) throw result.error;
    toast(edit ? 'Turno actualizado' : 'Turno agregado');
    await refresh();
  });
}

function paymentForm(item) {
  const c = clientById(item.clienta_id);
  showModal('Registrar pago', `<form id="entity-form" class="form-grid"><p class="wide muted">${e(c?.nombre||'Clienta')} · ${e(serviceById(item.servicio_id)?.nombre||'Turno')} · ${datePY(item.fecha)} ${timePY(item.hora)}</p>${formField('Monto recibido (Gs.)','monto_gs',item.precio_gs,'number',{required:true,min:1})}${formField('Fecha de pago','fecha',dateInput(),'date',{required:true})}<label class="field">Medio<select name="medio"><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>${formField('Nota','nota','','text',{maxlength:240})}</form>`, 'Registrar pago');
  modalSubmit(async form => {
    const r = formObject(form);
    const {
      error
    } = await supabase.rpc('registrar_pago_turno', {
      p_turno_id: item.id,
      p_monto_gs: Number(r.monto_gs),
      p_fecha: r.fecha,
      p_medio: r.medio,
      p_nota: r.nota || null
    });
    if (error) throw error;
    toast('Pago registrado y deuda recalculada');
    await refresh();
  });
}

function expenseForm() {
  showModal('Registrar gasto', `<form id="entity-form" class="form-grid">${formField('Fecha','fecha',dateInput(),'date',{required:true})}${formField('Concepto','concepto','','text',{required:true,maxlength:120})}${formField('Categoría','categoria','','text',{maxlength:60})}${formField('Monto (Gs.)','monto_gs','','number',{required:true,min:1})}${formField('Nota','nota','','textarea',{wide:true,maxlength:500})}</form>`);
  modalSubmit(async form => {
    const r = formObject(form),
      {
        error
      } = await supabase.from('gastos').insert({
        fecha: r.fecha,
        concepto: r.concepto.trim(),
        categoria: r.categoria.trim() || null,
        monto_gs: Number(r.monto_gs),
        nota: r.nota.trim() || null
      });
    if (error) throw error;
    toast('Gasto registrado');
    await refresh();
  });
}

function productForm(item = {}) {
  const edit = !!item.id;
  showModal(edit ? 'Editar producto' : 'Nuevo producto', `<form id="entity-form" class="form-grid">${formField('Nombre','nombre',item.nombre||'','text',{required:true,maxlength:100})}${formField('Unidad','unidad',item.unidad||'unidad','text',{maxlength:30})}${formField('Stock actual','stock_actual',item.stock_actual||0,'number',{required:true,min:0})}${formField('Alerta bajo','stock_minimo',item.stock_minimo||0,'number',{required:true,min:0})}${formField('Costo unitario (Gs.)','costo_gs',item.costo_gs||0,'number',{min:0})}</form>`);
  modalSubmit(async form => {
    const r = formObject(form),
      payload = {
        nombre: r.nombre.trim(),
        unidad: r.unidad.trim() || 'unidad',
        stock_actual: Number(r.stock_actual),
        stock_minimo: Number(r.stock_minimo),
        costo_gs: Number(r.costo_gs) || 0
      };
    const result = edit ? await supabase.from('productos').update(payload).eq('id', item.id) : await supabase.from('productos').insert(payload);
    if (result.error) throw result.error;
    toast('Producto guardado');
    await refresh();
  });
}

function employeeForm(item = {}) {
  const edit = !!item.id;
  showModal(edit ? 'Editar empleada' : 'Agregar empleada', `<form id="entity-form" class="form-grid">${formField('Nombre','nombre',item.nombre||'','text',{required:true,maxlength:100})}${formField('Teléfono','telefono',item.telefono||'','tel',{maxlength:24})}${formField('Comisión (%)','comision_pct',item.comision_pct||0,'number',{required:true,min:0,max:100})}${boolField('Activa', 'activa',item.activa!==false)}</form>`);
  modalSubmit(async form => {
    const r = formObject(form),
      payload = {
        nombre: r.nombre.trim(),
        telefono: r.telefono.trim() || null,
        comision_pct: Number(r.comision_pct),
        activa: form.elements.activa.checked
      };
    const result = edit ? await supabase.from('empleadas').update(payload).eq('id', item.id) : await supabase.from('empleadas').insert(payload);
    if (result.error) throw result.error;
    toast('Equipo actualizado');
    await refresh();
  });
}
async function handleAction(ev) {
  const b = ev.currentTarget,
    action = b.dataset.action,
    id = b.dataset.id;
  try {
    if (['new-client'].includes(action)) return newClientForm();
    if (action === 'edit-client') return newClientForm(clientById(id));
    if (action === 'client-details') return clientDetails(id);
    if (action === 'new-service') return newServiceForm();
    if (action === 'edit-service') return newServiceForm(state.data.servicios.find(s => s.id === id));
    if (action === 'new-appointment') return editable() ? appointmentForm() : toast('La cuenta está en modo de solo lectura.', 'error');
    if (action === 'new-client-appointment') return editable() ? appointmentForm({
      clienta_id: id
    }) : toast('La cuenta está en modo de solo lectura.', 'error');
    if (action === 'edit-appointment') return editable() ? appointmentForm(state.data.turnos.find(a => a.id === id)) : toast('La cuenta está en modo de solo lectura.', 'error');
    if (action === 'done-appointment') return changeAppointment(id, {
      estado: 'hecho'
    });
    if (action === 'pay-appointment') return paymentForm(state.data.turnos.find(a => a.id === id));
    if (action === 'new-expense') return expenseForm();
    if (action === 'new-product') return productForm();
    if (action === 'edit-product') return productForm(state.data.productos.find(a => a.id === id));
    if (action === 'new-employee') return employeeForm();
    if (action === 'edit-employee') return employeeForm(state.data.empleadas.find(a => a.id === id));
    if (action === 'employee-commission') return showCommission(id);
    if (action === 'delete-row') return deleteRow(b.dataset.table, id);
    if (action === 'agenda-prev' || action === 'agenda-next') {
      state.agendaDate = shiftDate(state.agendaDate, (action === 'agenda-prev' ? -1 : 1) * (state.agendaMode === 'semana' ? 7 : 1));
      return applyView();
    }
    if (action === 'agenda-day' || action === 'agenda-week') {
      state.agendaMode = action === 'agenda-day' ? 'dia' : 'semana';
      return applyView();
    }
    if (action === 'share-booking' || action === 'whatsapp-booking') {
      const url = bookingURL();
      if (action === 'whatsapp-booking') window.open(waLink('', `¡Reservá tu próximo turno en ${salonName()}! ${url}`), '_blank', 'noopener');
      else {
        await navigator.clipboard.writeText(url);
        toast('Link de reservas copiado');
      }
      return;
    }
    if (action === 'share-catalog') {
      const text = `Servicios de ${salonName()}:\n${state.data.servicios.filter(s=>s.activo).map(s=>`• ${s.nombre}: ${money(s.precio_gs)}`).join('\n')}\nReservas: ${bookingURL()}`;
      window.open(waLink('', text), '_blank', 'noopener');
      return;
    }
    if (action === 'mark-reminder') {
      const tomorrow = shiftDate(dateInput(), 1),
        key = `reminders:${state.client.id}:${tomorrow}`,
        sent = JSON.parse(localStorage.getItem(key) || '[]');
      if (!sent.includes(id)) sent.push(id);
      localStorage.setItem(key, JSON.stringify(sent));
      toast('Recordatorio marcado como enviado');
      return applyView();
    }
    if (action === 'accept-request') return resolveRequest(id, true);
    if (action === 'reject-request') return resolveRequest(id, false);
    if (action === 'backup-json') return backupJSON();
    if (action === 'backup-csv') return backupCSV();
    if (action === 'export-clients') return exportClients();
    if (action === 'import-clients') return importClients();
    if (action === 'toggle-theme') {
      setTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
      return;
    }
    if (action === 'save-templates') return saveTemplates();
    if (action === 'send-all-reminders') {
      const tomorrow = shiftDate(dateInput(), 1),
        items = appointments(tomorrow),
        key = `reminders:${state.client.id}:${tomorrow}`,
        sent = JSON.parse(localStorage.getItem(key) || '[]'),
        next = items.find(a => !sent.includes(a.id));
      if (!next) return toast('Ya revisaste todos los turnos de mañana.', 'info');
      const c = clientById(next.clienta_id),
        phone = c?.telefono || next.telefono_publico;
      if (!phone) return toast(`A ${c?.nombre||next.nombre_publico||'esta clienta'} le falta el teléfono.`, 'error');
      window.open(waLink(phone, templateMessage('recordatorio', c || {
        nombre: next.nombre_publico
      }, {
        fecha: datePY(next.fecha),
        hora: timePY(next.hora)
      })), '_blank', 'noopener');
      return;
    }
  } catch (error) {
    toast(requestError(error), 'error');
  }
}
async function changeAppointment(id, payload) {
  if (!editable()) throw new Error('La cuenta está en modo de solo lectura.');
  const {
    error
  } = await supabase.from('turnos').update(payload).eq('id', id);
  if (error) throw error;
  toast('Turno actualizado');
  await refresh();
}
async function resolveRequest(id, accept) {
  if (!editable()) throw new Error('La cuenta está en modo de solo lectura.');
  const {
    data,
    error
  } = await supabase.rpc('resolver_solicitud_reserva', {
    p_solicitud_id: id,
    p_aceptar: accept
  });
  if (error) throw error;
  toast(accept ? 'Reserva aceptada y turno creado' : 'Solicitud rechazada');
  await refresh();
  if (accept && data?.telefono) {
    showModal('Turno confirmado', `<div class="success-panel"><div class="success-icon">✓</div><h3>${e(data.nombre)}, el turno ya está en tu agenda.</h3><p class="muted">${datePY(data.fecha)} · ${e(timePY(data.hora))}</p><a class="button primary" href="${waLink(data.telefono,`Hola ${data.nombre}, tu turno en ${salonName()} quedó confirmado para ${datePY(data.fecha)} a las ${timePY(data.hora)}. ¡Te esperamos!`)}" target="_blank" rel="noopener">Enviar confirmación por WhatsApp</a></div>`, 'Listo');
    $('#modal-footer').innerHTML = '<button class="button ghost" type="button" data-modal-close>Listo</button>';
  }
}
async function deleteRow(table, id) {
  if (!editable()) throw new Error('La cuenta está en modo de solo lectura.');
  if (table === 'clientas' && state.data.turnos.some(appointment => appointment.clienta_id === id && state.data.pagos.some(payment => payment.turno_id === appointment.id))) {
    throw new Error('Esta clienta tiene turnos con pagos asociados; conservá su ficha para mantener el historial financiero.');
  }
  if (table === 'turnos' && state.data.pagos.some(payment => payment.turno_id === id)) {
    throw new Error('Este turno tiene pagos asociados y conserva su historial. Marcá el turno como cancelado si ya no corresponde.');
  }
  if (!confirm('¿Querés borrar este registro? Esta acción no se puede deshacer.')) return;
  if (table === 'clientas') {
    const paths = state.data.fotos_clienta.filter(photo => photo.clienta_id === id).map(photo => photo.storage_path);
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
      if (storageError) throw storageError;
    }
  } else if (table === 'fotos_clienta') {
    const photo = state.data.fotos_clienta.find(item => item.id === id);
    if (photo) {
      const { error: storageError } = await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
      if (storageError) throw storageError;
    }
  }
  const {
    error
  } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
  toast('Registro eliminado');
  await refresh();
  if (table === 'fotos_clienta' && state.detailsClient) return clientDetails(state.detailsClient);
}
async function clientDetails(id) {
  const c = clientById(id);
  if (!c) return;
  state.detailsClient = id;
  const visits = state.data.turnos.filter(a => a.clienta_id === id).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const photos = state.data.fotos_clienta.filter(p => p.clienta_id === id);
  const payments = state.data.pagos.filter(p => p.clienta_id === id).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const signed = {};
  await Promise.all(photos.map(async p => {
    const r = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path, 1800);
    if (!r.error) signed[p.id] = r.data.signedUrl;
  }));
  const history = visits.map(a => `<div class="list-row"><div class="list-row-main"><strong>${datePY(a.fecha)} · ${e(timePY(a.hora))} · ${e(serviceById(a.servicio_id)?.nombre||'Servicio')}</strong><small>${e(a.estado)} · ${money(a.precio_gs)} · ${e(a.notas||'')}</small></div></div>`).join('') || empty('Sin historial', 'Los turnos de esta clienta aparecerán acá.');
  const photoHTML = photos.map(p => signed[p.id] ? `<div class="photo-tile"><a href="${e(signed[p.id])}" target="_blank" rel="noopener"><img src="${e(signed[p.id])}" alt="Foto ${e(p.tipo)}"><small>${e(p.tipo)}</small></a><button class="photo-delete" data-action="delete-row" data-table="fotos_clienta" data-id="${e(p.id)}" aria-label="Eliminar foto">×</button></div>` : '').join('');
  const paymentHistory = payments.map(p => `<div class="list-row"><div class="list-row-main"><strong>${datePY(p.fecha)} · ${money(p.monto_gs)}</strong><small>${e(p.medio)} · ${e(p.nota||'Abono')}</small></div></div>`).join('') || '<p class="muted tiny">Todavía no hay pagos registrados.</p>';
  const loyalty = Number(c.visitas || 0),
    goal = Number(state.profile.visitas_premio || 10),
    award = loyalty > 0 && loyalty % goal === 0;
  const paymentButtons = visits.filter(a => a.estado !== 'cancelado').map(a => `<div class="list-row"><div class="list-row-main"><strong>${datePY(a.fecha)} · ${e(serviceById(a.servicio_id)?.nombre||'Servicio')}</strong><small>${e(a.estado)} · ${money(a.precio_gs)}</small></div><button class="small-button primary" data-action="pay-appointment" data-id="${e(a.id)}">Registrar abono</button></div>`).join('') || '<p class="muted tiny">No hay turnos para asociar un pago.</p>';
  const body = `<div class="profile-layout">
    <section class="profile-side panel"><div class="avatar">${e(c.nombre.slice(0,1).toUpperCase())}</div><div><h3>${e(c.nombre)}</h3><p class="muted tiny">${e(c.telefono||'Sin teléfono')}<br>${e(c.email||'')}</p><strong>${money(c.deuda_gs)}</strong><small class="muted"> saldo pendiente</small></div></section>
    <section class="profile-detail"><div class="loyalty-box">💝 ${loyalty} visitas · ${award?'¡Le corresponde premio!':`${Math.max(0,goal-loyalty%goal)} para su próximo premio (${e(state.profile.premio_descripcion||'premio')})`}</div>
      <div class="panel"><div class="panel-head"><h3>Historial de turnos</h3><button class="small-button primary" data-action="new-client-appointment" data-id="${e(c.id)}">Nuevo turno</button></div><div class="list">${history}</div></div>
      <div class="panel"><div class="panel-head"><h3>Fórmulas y notas técnicas</h3><button class="small-button" data-action="edit-client" data-id="${e(c.id)}">Editar notas</button></div><p class="muted">${e(c.notas||'Sin notas técnicas registradas.')}</p></div>
      <div class="panel"><div class="panel-head"><h3>Fotos antes y después</h3><label class="small-button primary">＋ Subir foto<input id="client-photo-upload" type="file" accept="image/jpeg,image/png,image/webp" hidden></label></div><div class="photo-grid">${photoHTML||'<p class="muted tiny">Todavía no hay fotos guardadas.</p>'}</div></div>
      <div class="panel"><h3>Pagos y abonos</h3><div class="list">${paymentHistory}</div><h3>Registrar un abono</h3>${paymentButtons}</div>
    </section></div>`;
  showModal(c.nombre, body, 'Cerrar');
  $('#modal-footer').innerHTML = '<button class="button ghost" type="button" data-modal-close>Cerrar ficha</button>';
  $('#modal-body').onchange = ev => {
    if (ev.target.id === 'client-photo-upload') handlePhotoUpload(ev).catch(error => toast(requestError(error), 'error'));
  };
  $('#modal-body').onclick = ev => {
    const action = ev.target.closest('[data-action]');
    if (action) handleAction({
      currentTarget: action
    });
  };
}
async function handlePhotoUpload(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) throw new Error('La foto debe pesar menos de 8 MB.');
  const kind = prompt('¿La foto es Antes o Después?', 'Antes') || 'Antes',
    safeKind = ['antes', 'despues', 'después'].includes(kind.toLowerCase()) ? kind : 'Antes',
    path = `${state.client.id}/${state.detailsClient}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g,'_')}`;
  const {
    error: uploadError
  } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type
  });
  if (uploadError) throw uploadError;
  const {
    error
  } = await supabase.from('fotos_clienta').insert({
    clienta_id: state.detailsClient,
    storage_path: path,
    tipo: safeKind
  });
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
  toast('Foto guardada de forma privada');
  await refresh();
  clientDetails(state.detailsClient);
}

function showCommission(id) {
  const employee = employeeById(id),
    month = dateInput().slice(0, 7),
    worked = state.data.turnos.filter(a => a.empleada_id === id && a.estado === 'hecho' && a.fecha.startsWith(month)).reduce((n, a) => n + Number(a.precio_gs), 0),
    amount = Math.round(worked * Number(employee.comision_pct) / 100);
  showModal(`Comisión · ${employee.nombre}`, `<div class="metric-card"><span class="metric-label">Ingresos asignados este mes</span><div class="metric-value">${money(worked)}</div><span class="metric-note">${employee.comision_pct}% · estimado ${money(amount)}</span></div>`, 'Cerrar');
  $('#modal-footer').innerHTML = '<button class="button ghost" type="button" data-modal-close>Cerrar</button>';
}
async function saveTemplates() {
  if (!editable()) throw new Error('La cuenta está en modo de solo lectura.');
  const inputs = $$('[data-template]'),
    rows = inputs.map(input => ({
      clave: input.dataset.template,
      nombre: TEMPLATES.find(t => t[0] === input.dataset.template)?.[1] || input.dataset.template,
      contenido: input.value.trim()
    }));
  for (const row of rows) {
    const current = state.data.plantillas.find(t => t.clave === row.clave);
    const result = current ? await supabase.from('plantillas').update({
      nombre: row.nombre,
      contenido: row.contenido
    }).eq('id', current.id) : await supabase.from('plantillas').insert(row);
    if (result.error) throw result.error;
  }
  toast('Plantillas actualizadas');
  await refresh();
}
async function saveProfile(ev) {
  ev.preventDefault();
  if (!editable()) return toast('La cuenta está en modo de solo lectura.', 'error');
  const form = ev.currentTarget,
    fd = new FormData(form);
  let horarios;
  try {
    horarios = JSON.parse(fd.get('horarios_json'));
  } catch {
    return toast('Revisá el JSON del horario.', 'error');
  }
  const color = fd.get('color_principal');
  if (!validColor(color)) return toast('El color debe ser hexadecimal.', 'error');
  const payload = {
    nombre: String(fd.get('nombre')).trim(),
    telefono: String(fd.get('telefono')).trim() || null,
    direccion: String(fd.get('direccion')).trim() || null,
    color_principal: color,
    visitas_premio: Number(fd.get('visitas_premio')) || 10,
    premio_descripcion: String(fd.get('premio_descripcion')).trim(),
    telefono_soporte: String(fd.get('telefono_soporte')).trim() || null,
    horario_texto: String(fd.get('horario_texto')).trim() || null,
    horarios
  };
  const {
    error
  } = await supabase.from('perfiles').update(payload).eq('user_id', state.client.id);
  if (error) {
    toast(requestError(error), 'error');
    return;
  }
  const file = fd.get('logo');
  if (file instanceof File && file.size) {
    if (file.size > 2 * 1024 * 1024) return toast('El logo debe pesar menos de 2 MB.', 'error');
    const path = `${state.client.id}/logo-${Date.now()}.${file.name.split('.').pop().replace(/[^a-z0-9]/gi,'')}`;
    const up = await supabase.storage.from(BRAND_BUCKET).upload(path, file, {
      upsert: true
    });
    if (up.error) return toast(requestError(up.error), 'error');
    const url = supabase.storage.from(BRAND_BUCKET).getPublicUrl(path).data.publicUrl;
    const r = await supabase.from('perfiles').update({
      logo_url: url
    }).eq('user_id', state.client.id);
    if (r.error) return toast(requestError(r.error), 'error');
  }
  toast('Perfil del salón guardado');
  await refresh();
}
async function backupJSON() {
  const payload = {
    respaldo: 'Mis Clientas',
    exportado_en: new Date().toISOString(),
    salon: salonName(),
    perfil: state.profile,
    tablas: state.data
  };
  downloadFile(`mis-clientas-${salonSlug()}-${dateInput()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Respaldo JSON descargado');
}

function backupCSV() {
  for (const tableName of ['clientas', 'turnos', 'pagos', 'gastos']) {
    const rows = state.data[tableName] || [];
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const data = [keys.map(csvEscape).join(','), ...rows.map(row => keys.map(k => csvEscape(row[k])).join(','))].join('\r\n');
    downloadFile(`${tableName}-${dateInput()}.csv`, data, 'text/csv;charset=utf-8');
  }
  toast('Archivos CSV descargados');
}

function exportClients() {
  const rows = clientsSorted(),
    keys = ['nombre', 'telefono', 'email', 'fecha_nacimiento', 'notas', 'deuda_gs', 'visitas'];
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => csvEscape(r[k])).join(','))].join('\r\n');
  downloadFile(`clientas-${dateInput()}.csv`, csv, 'text/csv;charset=utf-8');
}
async function importClients() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.onchange = async () => {
    try {
      const file = input.files[0];
      if (!file) return;
      const parsed = csvRows(await file.text());
      if (parsed.length < 2) throw new Error('El CSV no tiene clientas para importar.');
      const headers = parsed.shift().map(x => x.replace(/^\uFEFF/, '').trim().toLowerCase());
      const records = parsed.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))).filter(r => r.nombre?.trim()).map(r => ({
        nombre: r.nombre.trim().slice(0, 100),
        telefono: (r.telefono || '').trim().slice(0, 24) || null,
        email: (r.email || '').trim().slice(0, 160) || null,
        fecha_nacimiento: validISODate(r.fecha_nacimiento) ? r.fecha_nacimiento : null,
        notas: (r.notas || '').slice(0, 2000) || null
      }));
      if (!records.length) throw new Error('No encontré filas con nombre.');
      const {
        error
      } = await supabase.from('clientas').insert(records);
      if (error) throw error;
      toast(`${records.length} clientas importadas`);
      await refresh();
    } catch (error) {
      toast(requestError(error), 'error');
    }
  };
  input.click();
}

function validISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}
async function refresh() {
  await getProfile();
  await loadData();
  applyView();
}

function showBlocked() {
  $('#app-shell').classList.add('hidden');
  $('#blocked-screen').classList.remove('hidden');
  $('#blocked-message').textContent = state.profile.activo ? 'La suscripción venció el ' + datePY(state.profile.vence_el) + '. Tus datos siguen protegidos.' : 'La cuenta fue desactivada. Contactá al equipo para renovar el acceso.';
  $('#renew-link').href = waLink(state.profile.telefono_soporte || SUPPORT_WHATSAPP, `Hola, quiero renovar Mis Clientas para el salón ${salonName()}.`);
}

async function syncAccountStatus() {
  if (!state.client) return;
  const wasBlocked = !$('#blocked-screen').classList.contains('hidden');
  try {
    await getProfile();
    if (!editable()) showBlocked();
    else if (wasBlocked) await showApp({
      user: state.client
    });
  } catch (error) {
    if (navigator.onLine) toast(requestError(error), 'error');
  }
}

function signOut() {
  supabase.auth.signOut();
}
async function showApp(session) {
  state.client = session.user;
  $('#login-screen').classList.add('hidden');
  $('#blocked-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  $('#view-root').innerHTML = '<section class="panel loading-panel" role="status">Cargando los datos de tu salón…</section>';
  try {
    await getProfile();
    if (!editable()) {
      showBlocked();
      return;
    }
    await loadData();
    applyView();
  } catch (error) {
    $('#app-shell').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#login-error').textContent = `No se pudo abrir el salón: ${requestError(error)}`;
  }
}
async function init() {
  setTheme(localStorage.getItem('mis-clientas-theme') || 'light');
  $('#support-login').href = waLink(SUPPORT_WHATSAPP, 'Hola, necesito ayuda con Mis Clientas.');
  $('#login-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const button = ev.submitter;
    setBusy(button, true, 'Ingresando…');
    $('#login-error').textContent = '';
    try {
      readyClient();
      const {
        error
      } = await supabase.auth.signInWithPassword({
        email: $('#login-email').value.trim(),
        password: $('#login-password').value
      });
      if (error) throw error;
    } catch (error) {
      $('#login-error').textContent = requestError(error);
    } finally {
      setBusy(button, false);
    }
  });
  $('#logout-button').addEventListener('click', signOut);
  $('#blocked-logout').addEventListener('click', signOut);
  $('#theme-toggle').addEventListener('click', () => setTheme(document.body.classList.contains('dark') ? 'light' : 'dark'));
  $('#mobile-menu').addEventListener('click', () => {
    location.hash = '#configuracion';
  });
  window.addEventListener('hashchange', applyView);
  $('#view-root').addEventListener('click', ev => {
    if (ev.target.closest('[data-action]')) handleAction({
      currentTarget: ev.target.closest('[data-action]')
    });
  });
  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-modal-close]')) ev.target.closest('dialog')?.close();
  });
  const installButtons = [$('#install-button'), $('#install-button-top')];
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    state.installPrompt = ev;
    installButtons.forEach(b => b?.classList.remove('hidden'));
  });
  for (const b of installButtons) b?.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    installButtons.forEach(x => x?.classList.add('hidden'));
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try {
    readyClient();
    supabase.auth.onAuthStateChange((event, session) => {
      if (session && ['INITIAL_SESSION', 'SIGNED_IN'].includes(event)) {
        queueMicrotask(() => showApp(session));
      } else if (!session && event === 'SIGNED_OUT') {
        state.client = null;
        $('#app-shell').classList.add('hidden');
        $('#blocked-screen').classList.add('hidden');
        $('#login-screen').classList.remove('hidden');
      }
    });
    setInterval(syncAccountStatus, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncAccountStatus();
    });
  } catch {
    /* Credentials are entered in config.js before connecting the service. */ }
}
init();
