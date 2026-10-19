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
  daysUntil,
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
  applyBrandColor,
  applyTheme,
  syncThemeFromStorage,
  noStoreFetch
} from './utils.js';

const NAV = [
  ['inicio', '⌂', 'Inicio'],
  ['clientas', '♡', 'Clientas'],
  ['agenda', '▦', 'Agenda'],
  ['caja', '＄', 'Cierre de caja'],
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
const TABLES = ['clientas', 'servicios', 'turnos', 'turno_servicios', 'pagos', 'plantillas', 'gastos', 'productos', 'empleadas', 'solicitudes_reserva', 'fotos_clienta'];
const MUTATING_ACTIONS = new Set(['new-client','edit-client','new-service','edit-service','new-appointment','new-client-appointment','edit-appointment','done-appointment','pay-appointment','new-expense','new-product','edit-product','new-employee','edit-employee','delete-row','delete-appointment','accept-request','reject-request','import-clients','save-templates','cancel-appointment','undo-payment','mark-thanks']);
const TEMPLATES = [
  ['recordatorio', 'Recordatorio de turno', 'Hola {nombre} 😊 Te recuerdo tu turno en {salon} el {fecha} a las {hora}. ¡Te esperamos!'],
  ['deuda', 'Aviso de saldo', 'Hola {nombre}, te escribimos de {salon}. Tu saldo pendiente es {deuda}. Cualquier consulta estamos a las órdenes.'],
  ['promo', 'Promoción', 'Hola {nombre} 💕 Tenemos una promo especial en {salon}. ¡Escribinos para reservar!'],
  ['cumple', 'Cumpleaños', '¡Feliz cumpleaños, {nombre}! 🎂 Te deseamos un hermoso día. Te esperamos en {salon} para celebrar.'],
  ['reactivacion', 'Te extrañamos', 'Hola {nombre} 💖 Hace un tiempo no te vemos por {salon}. Nos encantaría volver a atenderte. ¿Agendamos?'],
  ['agradecimiento', 'Agradecimiento y reseña', 'Gracias por venir, {nombre} 💕 ¿Nos dejás una reseña? {resena}']
];
const ONBOARDING_SERVICES = [
  { nombre: 'Corte', precio_gs: 40000, duracion_min: 45 },
  { nombre: 'Coloración', precio_gs: 180000, duracion_min: 150 },
  { nombre: 'Brushing', precio_gs: 50000, duracion_min: 45 },
  { nombre: 'Tratamiento capilar', precio_gs: 100000, duracion_min: 90 },
  { nombre: 'Manicura', precio_gs: 50000, duracion_min: 60 }
];
const WEEKDAYS = [['0','Domingo'],['1','Lunes'],['2','Martes'],['3','Miércoles'],['4','Jueves'],['5','Viernes'],['6','Sábado']];
const state = {
  client: null,
  profile: null,
  locked: false,
  exportLoaded: false,
  exportLoading: null,
  data: Object.fromEntries(TABLES.map(t => [t, []])),
  view: 'inicio',
  search: '',
  agendaDate: dateInput(),
  agendaMode: innerWidth <= 720 ? 'dia' : 'semana',
  reportMode: 'mes',
  detailsClient: null,
  onboardingStep: 0,
  passwordRecoverySession: null,
  onboardingSchemaMissing: false,
  googleReviewSchemaMissing: false,
  drag: null,
  cashDate: dateInput(),
  cashLoading: false,
  cashData: null,
  cashError: '',
  cashLoadId: 0,
  searchResults: [],
  searchActive: 0,
  searchTimer: null,
  quickThanks: false
};
let supabase;
let appSessionUserId = null;
let serviceWorkerReloading = false;
let pendingAuthUserId = null;
let profileReadQueue = Promise.resolve();
let passwordRecoveryActive = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
let onboardingCompletionPending = false;
let suppressCalendarClickUntil = 0;
const TABLE_PAGE_SIZE = 40;
const tablePageData = new Map();
let tableRenderIndex = 0;

function readyClient() {
  const projectUrl = String(SUPABASE_URL || '').trim();
  const anonKey = String(SUPABASE_ANON_KEY || '').trim();
  if (!projectUrl || projectUrl === 'SUPABASE_URL' || !anonKey || anonKey === 'SUPABASE_ANON_KEY') {
    throw new Error('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en js/config.js.');
  }
  try {
    const url = new URL(projectUrl);
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
  } catch {
    throw new Error('La SUPABASE_URL de js/config.js no es válida. Usá la URL HTTPS de tu proyecto.');
  }
  if (supabase) return;
  supabase = createClient(projectUrl, anonKey, {
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

function editable() {
  const profile = state.profile;
  return !!profile?.activo && daysUntil(profile.vence_el) !== null && daysUntil(profile.vence_el) >= 0;
}

function readOnlyReason() {
  return state.profile?.activo === false
    ? 'Cuenta desactivada. Contactá a soporte.'
    : 'Tu suscripción venció. Renová para seguir editando.';
}

function requireEditable() {
  if (editable()) return true;
  toast(readOnlyReason(), 'error');
  return false;
}

function applyReadOnlyControls() {
  const readOnly = !editable();
  $('#view-root').classList.toggle('read-only', readOnly);
  $$('[data-action]').forEach(control => {
    if (!MUTATING_ACTIONS.has(control.dataset.action)) return;
    control.setAttribute('aria-disabled', String(readOnly));
    control.classList.toggle('read-only-control', readOnly);
    if (readOnly) control.title = readOnlyReason();
    else control.removeAttribute('title');
  });
  const profileForm = $('#profile-form');
  for (const form of [profileForm, $('#modal-body form')].filter(Boolean)) {
    form.querySelectorAll('input,textarea,select').forEach(control => {
      if (control.type === 'submit') return;
      if (['checkbox','file','color'].includes(control.type) || control.tagName === 'SELECT') control.disabled = readOnly;
      else control.readOnly = readOnly;
    });
  }
  for (const button of [profileForm?.querySelector('button[type="submit"]'), $('#modal-submit')].filter(Boolean)) {
    button.setAttribute('aria-disabled', String(readOnly));
    button.classList.toggle('read-only-control', readOnly);
    if (readOnly) button.title = readOnlyReason();
    else button.removeAttribute('title');
  }
  $$('[data-template]').forEach(control => { control.readOnly = readOnly; });
  const upload = $('#client-photo-upload');
  if (upload) upload.disabled = readOnly;
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
  const appRoot = location.pathname.replace(/index\.html?$/i, '').replace(/\/*$/, '/');
  return `${location.origin}${appRoot}reservar/${encodeURIComponent(salonSlug())}`;
}

function activeNav(view) {
  return NAV.find(n => n[0] === view) || NAV[0];
}

function navMarkup(mobile = false) {
  const quick = mobile ? [...NAV.filter(([id]) => ['inicio', 'clientas', 'agenda', 'solicitudes'].includes(id)), ['configuracion', '•••', 'Más']] : NAV;
  const links = quick.map(([id, icon, label]) => {
    const selected = id === 'configuracion' ? !['inicio', 'clientas', 'agenda', 'solicitudes'].includes(state.view) : state.view === id;
    return `<a class="nav-link ${selected?'active':''}" href="#${id}" data-nav="${id}" ${selected?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span><span>${e(label)}</span></a>`;
  }).join('');
  return links;
}

function renderNav() {
  $('#side-nav').innerHTML = navMarkup();
  $('#bottom-nav').innerHTML = navMarkup(true);
  $('#mobile-menu-nav').innerHTML = navMarkup();
  $('#mobile-public-booking-link').href = bookingURL();
}

function setBrand() {
  $('#brand-name').textContent = salonName();
  $('#brand-logo').src = logoURL();
  $('#brand-logo').onerror = () => $('#brand-logo').src = 'icons/icon.svg';
  applyBrandColor(validColor(state.profile?.color_principal) ? state.profile.color_principal : getComputedStyle(document.body).getPropertyValue('--primary-fill').trim());
  const publicLink = $('#public-booking-link');
  publicLink.href = bookingURL();
  publicLink.dataset.copy = bookingURL();
}

function setTheme(theme) {
  applyTheme(theme);
  localStorage.setItem('agendapora-theme', theme);
}

function setSubscription() {
  const days = daysUntil(state.profile?.vence_el) ?? -1;
  const badge = $('#subscription-badge'),
    alert = $('#subscription-alert');
  const profile = state.profile;
  badge.textContent = editable() ? `Plan activo · ${days} días` : 'Solo lectura';
  badge.classList.toggle('warn', days <= 7 || !editable());
  alert.classList.remove('expired','deactivated');
  const support = SUPPORT_WHATSAPP || profile?.telefono_soporte || '';
  const supportMessage = profile?.activo === false
    ? `Hola, la cuenta del salón ${salonName()} está desactivada. Necesito ayuda con el acceso a AgendaPorã.`
    : `Hola, quiero renovar AgendaPorã para el salón ${salonName()}.`;
  const contactLabel = profile?.activo === false ? 'Contactar a soporte por WhatsApp' : 'Renovar por WhatsApp';
  const contact = `<a href="${e(waLink(support,supportMessage))}" target="_blank" rel="noopener">${contactLabel}</a>`;
  if (profile?.activo === false) {
    alert.innerHTML = `<strong>Cuenta desactivada. Contactá a soporte.</strong> ${contact}`;
    alert.classList.add('deactivated');
    alert.classList.remove('hidden');
  } else if (days < 0) {
    alert.innerHTML = `<strong>Tu suscripción venció el ${e(datePY(profile?.vence_el))}. Renová para seguir editando.</strong> ${contact}`;
    alert.classList.add('expired');
    alert.classList.remove('hidden');
  } else if (days <= 7) {
    const remaining = days === 0 ? 'vence hoy' : `vence en ${days} ${days === 1 ? 'día' : 'días'}`;
    alert.innerHTML = `<strong>Tu suscripción ${remaining} (${e(datePY(profile.vence_el))}): renová para seguir editando.</strong> ${contact}`;
    alert.classList.remove('hidden');
  } else alert.classList.add('hidden');
  const schemaNotices = [];
  if (state.onboardingSchemaMissing) schemaNotices.push('<strong>Falta actualizar la base para guardar “Primeros pasos”.</strong> Ejecutá <code>supabase/migracion_02.sql</code> en Supabase → SQL Editor.');
  if (state.googleReviewSchemaMissing) schemaNotices.push('<strong>Falta actualizar la base para el link de reseñas.</strong> Ejecutá <code>supabase/migracion_05.sql</code> en Supabase → SQL Editor.');
  alert.classList.toggle('onboarding-migration-alert', schemaNotices.length > 0 && editable());
  if (schemaNotices.length && editable()) {
    const notices = schemaNotices.join('<br>');
    alert.innerHTML = alert.classList.contains('hidden') ? notices : alert.innerHTML + '<br>' + notices;
    alert.classList.remove('hidden');
  }
}
async function getProfile() {
  const userId = state.client?.id;
  if (!userId) return null;
  const read = async () => {
    const baseColumns = 'user_id,nombre,slug,telefono,direccion,logo_url,color_principal,horario_texto,horarios,vence_el,activo,visitas_premio,premio_descripcion,telefono_soporte';
    const missingColumns = new Set();
    let data = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const optionalColumns = ['onboarding_estado', 'google_review_url'].filter(column => !missingColumns.has(column));
      const result = await supabase.from('perfiles')
        .select([baseColumns, ...optionalColumns].join(','))
        .eq('user_id', userId).single();
      if (!result.error) { data = result.data; break; }
      const missingColumn = ['onboarding_estado', 'google_review_url'].find(column => missingProfileColumn(result.error, column));
      if (!missingColumn || missingColumns.has(missingColumn)) throw result.error;
      missingColumns.add(missingColumn);
    }
    if (!data) throw new Error('No se pudo cargar el perfil del salón.');
    if (state.client?.id !== userId) return null;
    state.onboardingSchemaMissing = missingColumns.has('onboarding_estado');
    state.googleReviewSchemaMissing = missingColumns.has('google_review_url');
    state.profile = {
      ...data,
      ...(state.onboardingSchemaMissing ? { onboarding_estado: 'migracion_requerida' } : {}),
      ...(state.googleReviewSchemaMissing ? { google_review_url: null } : {})
    };
    setBrand();
    setSubscription();
    return state.profile;
  };
  const pendingRead = profileReadQueue.catch(() => {}).then(read);
  profileReadQueue = pendingRead;
  return pendingRead;
}

function missingProfileColumn(error, column) {
  const message = String(error?.message || '').toLocaleLowerCase('es');
  return message.includes(column) && (
    error?.code === '42703' || error?.code === 'PGRST204' ||
    message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find')
  );
}
async function loadTables(tableNames, { strictTables = [] } = {}) {
  const results = await Promise.all(tableNames.map(async table => {
    const rows = [];
    for (let offset = 0;; offset += 1000) {
      const { data, error } = await supabase.from(table).select('*')
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 999);
      if (error && (table !== 'solicitudes_reserva' || strictTables.includes(table))) throw error;
      if (error) break;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return [table, rows];
  }));
  return Object.fromEntries(results);
}

async function loadData() {
  state.data = { ...state.data, ...await loadTables(TABLES) };
  state.exportLoaded = true;
}

async function loadLockedExportData() {
  if (state.exportLoaded) return;
  if (!state.exportLoading) {
    const ownerId = state.client?.id;
    state.exportLoading = loadTables(['clientas','turnos','turno_servicios','pagos','gastos']).then(data => {
      if (state.client?.id === ownerId && state.locked) {
        state.data = { ...state.data, ...data };
        state.exportLoaded = true;
      }
    }).finally(() => {
      if (state.client?.id === ownerId) state.exportLoading = null;
    });
  }
  await state.exportLoading;
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

function appointmentServices(turn) {
  const saved = (state.data.turno_servicios || []).filter(row => row.turno_id === turn?.id).sort((a,b)=>Number(a.orden||0)-Number(b.orden||0));
  if (saved.length) return saved.map(row => ({
    id: row.servicio_id,
    nombre: row.servicio_nombre || serviceById(row.servicio_id)?.nombre || 'Servicio eliminado',
    precio_gs: Number(row.precio_gs || 0),
    duracion_min: Number(row.duracion_min || 0)
  }));
  const service=serviceById(turn?.servicio_id);
  return turn ? [{id:service?.id||turn.servicio_id||'sin-servicio',nombre:service?.nombre||turn.servicio_nombre||'Servicio',precio_gs:Number(turn.precio_gs??service?.precio_gs??0),duracion_min:Number(turn.duracion_min??service?.duracion_min??60)}] : [];
}

function appointmentServiceLabel(turn) {
  return appointmentServices(turn).map(service=>service.nombre).join(' + ') || 'Servicio';
}

function appointmentDuration(turn) {
  const total=appointmentServices(turn).reduce((sum,service)=>sum+Number(service.duracion_min||0),0);
  return Number(turn?.duracion_min||total||60);
}

function allocateServiceAmount(amount, services) {
  if (!services.length) return [];
  const weights=services.map(service=>Math.max(0,Number(service.precio_gs||0))), weightTotal=weights.reduce((sum,value)=>sum+value,0);
  if (!weightTotal) return services.map((service,index)=>({service,amount:index===0?amount:0}));
  let remaining=amount;
  return services.map((service,index)=>{
    const share=index===services.length-1?remaining:Math.floor(amount*weights[index]/weightTotal);
    remaining-=share;
    return {service,amount:share};
  });
}

function outstandingTurnDebt(turn) {
  if (turn?.estado !== 'hecho') return 0;
  const price = Number(turn.precio_cierre_gs ?? turn.precio_gs ?? 0);
  const paid = state.data.pagos
    .filter(payment => payment.turno_id === turn.id)
    .reduce((total, payment) => total + Number(payment.monto_gs || 0), 0);
  return Math.max(0, price - paid);
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
  const isPaginated = Array.isArray(rows);
  const rowList = isPaginated ? Array.from(rows) : [];
  const rowMarkup = isPaginated ? rowList.join('') : typeof rows === 'string' ? rows : '';
  if (!rowMarkup) return empty('Todavía está vacío', 'Cuando agregues información, aparecerá acá.', '✦');
  const id = ++tableRenderIndex;
  if (isPaginated) tablePageData.set(id, { rows: rowList, page: 0 });
  const firstPage = isPaginated ? rowList.filter((_, index) => index < TABLE_PAGE_SIZE).join('') : rowMarkup;
  return `<section class="table-component"><div class="table-wrap" tabindex="0" role="region" aria-label="Tabla desplazable"><table><thead><tr>${headers.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody id="table-page-body-${id}">${firstPage}</tbody></table></div>${isPaginated ? tablePagination(id,0,rows.length) : ''}</section>`;
}
function tablePagination(id, page, total) {
  if (total <= TABLE_PAGE_SIZE) return '';
  const pages = Math.ceil(total / TABLE_PAGE_SIZE), first = page * TABLE_PAGE_SIZE + 1,
    last = Math.min((page + 1) * TABLE_PAGE_SIZE, total);
  return `<nav id="table-pager-${id}" class="table-pagination" aria-label="Paginación de tabla"><span aria-live="polite">Mostrando ${first}–${last} de ${total}</span><div><button class="button ghost" type="button" data-table-page="${id}" data-page-delta="-1" ${page===0?'disabled':''}>Anterior</button><span>Página ${page+1} de ${pages}</span><button class="button ghost" type="button" data-table-page="${id}" data-page-delta="1" ${page+1>=pages?'disabled':''}>Siguiente</button></div></nav>`;
}

function changeTablePage(id, delta) {
  const data = tablePageData.get(id);
  if (!data) return;
  const pages = Math.ceil(data.rows.length / TABLE_PAGE_SIZE);
  data.page = Math.max(0, Math.min(pages - 1, data.page + delta));
  const start = data.page * TABLE_PAGE_SIZE;
  $(`#table-page-body-${id}`).innerHTML = data.rows.filter((_, index) => index >= start && index < start + TABLE_PAGE_SIZE).join('');
  const pager = $(`#table-pager-${id}`);
  if (pager) {
    pager.outerHTML = tablePagination(id, data.page, data.rows.length);
    $(`#table-pager-${id} [data-page-delta="${delta}"]`)?.focus();
  }
}

function metric(label, value, note = '') {
  return `<article class="metric-card"><div class="metric-label">${e(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${e(note)}</div></article>`;
}

function onboardingChecks() {
  const profile = state.profile || {};
  return [
    { label: 'Nombre del salón (logo opcional)', done: !!profile.nombre && profile.nombre !== 'Mi salón' },
    { label: 'Servicios y precios', done: state.data.servicios.length > 0 },
    { label: 'Horario de atención', done: !!String(profile.horario_texto || '').trim() && validSchedule(profile.horarios) },
    { label: 'Primera clienta', done: state.data.clientas.length > 0 }
  ];
}

function onboardingChecklist() {
  if (state.onboardingSchemaMissing) return `<section class="panel onboarding-migration-notice" role="status"><p class="eyebrow">Configuración inicial</p><h2>Hace falta actualizar la base</h2><p>El resto de la app puede seguir usándose, pero para guardar el progreso de “Primeros pasos” ejecutá <code>supabase/migracion_02.sql</code> en Supabase → SQL Editor.</p><button class="button soft" type="button" data-action="check-onboarding-migration">Volver a comprobar</button></section>`;
  if (state.profile?.onboarding_estado === 'completado') return '';
  const checks = onboardingChecks(), complete = checks.filter(item => item.done).length,
    next = checks.findIndex(item => !item.done);
  return `<section class="panel onboarding-checklist" aria-labelledby="onboarding-checklist-title"><div class="panel-head"><div><p class="eyebrow">Tu cuenta</p><h2 id="onboarding-checklist-title">Primeros pasos</h2><p class="muted tiny">Configurá lo esencial para empezar a usar tu salón.</p></div><strong>${complete} de 4</strong></div><progress class="onboarding-progress" max="4" value="${complete}" aria-label="${complete} de 4 pasos completados"></progress><ol class="onboarding-checklist-items">${checks.map((item,index)=>`<li class="${item.done?'is-done':''}"><span aria-hidden="true">${item.done?'✓':'○'}</span><span>${e(item.label)}</span>${item.done?'<span class="muted tiny">Listo</span>':`<button class="small-button primary" type="button" data-action="onboarding-open" data-step="${index}">Completar</button>`}</li>`).join('')}</ol><button class="button soft" type="button" data-action="onboarding-open" data-step="${next < 0 ? 0 : next}">Continuar configuración</button></section>`;
}

function heading(title, sub, actions = '') {
  return `<div class="section-heading"><div><p class="eyebrow">${e(sub)}</p><h2>${e(title)}</h2></div>${actions}</div>`;
}

function applyView() {
  if (!state.client) return;
  if (state.locked || (state.profile && !editable())) {
    if (state.profile && !editable() && !state.locked) state.exportLoaded = false;
    showBlocked();
    return;
  }
  state.view = location.hash.replace('#', '') || 'inicio';
  if (!NAV.some(n => n[0] === state.view)) state.view = 'inicio';
  const nav = activeNav(state.view);
  $('#page-title').textContent = nav[2];
  $('#page-kicker').textContent = salonName();
  renderNav();
  const renderers = {
    inicio: renderHome,
    caja: renderCashClose,
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
  tablePageData.clear();
  tableRenderIndex = 0;
  $('#view-root').innerHTML = renderers[state.view]();
  bindView();
  applyReadOnlyControls();
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
  const thanksPending=state.data.turnos.filter(a=>a.estado==='hecho'&&!a.agradecido_at&&a.fecha>=shiftDate(today,-3)&&a.fecha<=today).sort((a,b)=>b.fecha.localeCompare(a.fecha)||b.hora.localeCompare(a.hora));
  const scheduleRows = dayAppointments.slice(0, 7).map(a => {
    const c = clientById(a.clienta_id);
    return `<div class="list-row dashboard-appointment-row"><div class="avatar">${e((c?.nombre||a.nombre_publico||'?').slice(0,1).toUpperCase())}</div><div class="list-row-main"><strong>${e(timePY(a.hora))} · ${e(c?.nombre||a.nombre_publico||'Clienta')}</strong><small>${e(appointmentServiceLabel(a))} · ${money(a.precio_gs)}</small></div><div class="dashboard-appointment-actions ${a.estado==='pendiente'?'has-pending':''}"><span class="dashboard-call">${callLink(c?.telefono||a.telefono_publico)}</span><span class="status ${e(a.estado)}">${e(a.estado)}</span>${a.estado==='pendiente'?`<button class="small-button primary" data-action="done-appointment" data-id="${e(a.id)}">Hecho / cobrar</button><button class="small-button danger" data-action="delete-appointment" data-id="${e(a.id)}">Eliminar</button>`:''}</div></div>`
  });
  const birthdayRows = birthdays.slice(0, 5).map(c => `<div class="list-row"><div class="avatar">🎂</div><div class="list-row-main"><strong>${e(c.nombre)}</strong><small>${e(datePY(c.fecha_nacimiento))}</small></div><a class="small-button primary" href="${waLink(c.telefono,templateMessage('cumple',c,{fecha:'',hora:''}))}" target="_blank" rel="noopener">Saludar</a></div>`);
  return `<div class="page-stack">${onboardingChecklist()}<div class="metrics-grid">${metric('Turnos de hoy',dayAppointments.length,'En la agenda de hoy')}${metric('Ingresos hoy',money(todayIncome),'Pagos registrados hoy')}${metric('Ingresos semana / mes',`${money(weekIncome)} / ${money(monthIncome)}`,'Abonos cobrados · mes actual')}${metric('Deuda total',money(debt),`${state.data.clientas.filter(c=>Number(c.deuda_gs)>0).length} clientas con saldo`)}</div>
    ${pending.length?`<a class="notice" href="#solicitudes"><strong>${pending.length} solicitud${pending.length>1?'es':''} de reserva pendiente${pending.length>1?'s':''}.</strong> Revisar ahora →</a>`:''}
    ${thanksPending.length?`<section class="panel"><div class="panel-head"><div><h2>Agradecimientos pendientes</h2><p class="muted tiny">Turnos hechos en los últimos tres días.</p></div></div><div class="list">${thanksPending.map(a=>{const c=clientById(a.clienta_id),phone=c?.telefono||a.telefono_publico;return `<div class="list-row thanks-pending-row"><div class="list-row-main"><strong>${e(c?.nombre||a.nombre_publico||'Clienta')}</strong><small>${datePY(a.fecha)} · ${e(appointmentServiceLabel(a))}</small></div><div class="table-actions thanks-pending-actions">${callLink(phone)}${phone?`<button class="small-button primary" data-action="send-thanks" data-id="${e(a.id)}">WhatsApp</button>`:''}<button class="small-button" data-action="mark-thanks" data-id="${e(a.id)}">Marcar enviado</button></div></div>`}).join('')}</div></section>`:''}
    <div class="content-grid"><section class="panel"><div class="panel-head"><h2>Agenda de hoy</h2><a href="#agenda">Ver agenda →</a></div><div class="list">${scheduleRows.join('')||empty('Un día para organizar','Todavía no tenés turnos para hoy. Agregá uno o compartí tu link de reservas.','▦')}</div><div class="toolbar mt-1"><button class="button primary" data-action="new-appointment">＋ Nuevo turno</button><button class="button soft" data-action="share-booking">Compartir reservas</button></div></section><section class="panel"><div class="panel-head"><h2>Cumpleaños de la semana</h2><span>🎂</span></div><div class="list">${birthdayRows.join('')||empty('Esta semana está tranquila','Los próximos cumpleaños van a aparecer acá.','🎂')}</div></section></div>
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
  const rows = clients.map(c => `<tr><td><button class="text-button" data-action="client-details" data-id="${e(c.id)}">${e(c.nombre)}</button></td><td>${e(c.telefono||'—')}</td><td>${e(c.email||'—')}</td><td>${money(c.deuda_gs)}</td><td>${Number(c.visitas||0)} visitas${Number(c.visitas||0)>=Number(state.profile?.visitas_premio||10)?' · 🎁':''}</td><td><div class="table-actions"><button class="small-button" data-action="client-details" data-id="${e(c.id)}">Ficha</button>${callLink(c.telefono)}<button class="small-button" data-action="edit-client" data-id="${e(c.id)}">Editar</button><button class="small-button danger" data-action="delete-row" data-table="clientas" data-id="${e(c.id)}">Borrar</button>${c.telefono?`<a class="small-button primary" href="${waLink(c.telefono,templateMessage(Number(c.deuda_gs)>0?'deuda':'promo',c))}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div></td></tr>`);
  return `${heading('Clientas','Tu comunidad',`<button class="button primary" data-action="new-client">＋ Agregar clienta</button>`)}<div class="toolbar"><input class="search" id="client-search" type="search" placeholder="Buscar por nombre, teléfono o notas…" value="${e(state.search)}"><button class="button soft" data-action="import-clients">Importar CSV</button><button class="button ghost" data-action="export-clients">Exportar CSV</button></div>${table(['Nombre','Teléfono','Correo','Deuda','Fidelización',''],rows)}`;
}

function renderAgenda() {
  const date = state.agendaDate;
  const weekStart=dateInput(beginningOfWeek(new Date(`${date}T12:00:00`)));
  const dates = state.agendaMode === 'dia' ? [date] : Array.from({length:7},(_,i)=>shiftDate(weekStart,i));
  const actualDates = state.agendaMode === 'dia' ? [date] : dates;
  const hours = validSchedule(state.profile?.horarios) ? state.profile.horarios : defaultHours();
  const weekdayOf=d=>new Date(`${d}T12:00:00-03:00`).getUTCDay();
  const workingHours=actualDates.map(d=>hours[String(weekdayOf(d))]).filter(Boolean);
  const openMinutes = workingHours.length?Math.min(...workingHours.map(h=>minutesOf(h.inicio))):480;
  const closeMinutes = workingHours.length?Math.max(...workingHours.map(h=>minutesOf(h.fin))):1200;
  const start = Math.floor(openMinutes/60)*60, end = Math.ceil(closeMinutes/60)*60, rowHeight = 64;
  const ticks = Array.from({length:Math.max(1,(end-start)/60)},(_,i)=>`<div class="cal-hour" style="top:${i*rowHeight}px">${String(Math.floor(start/60)+i).padStart(2,'0')}:00</div>`).join('');
  const columns = actualDates.map(day => {
    const weekday = weekdayOf(day), shift = hours[String(weekday)], closed = !shift;
    const min = shift ? Number(shift.inicio.slice(0,2))*60+Number(shift.inicio.slice(3,5)) : start;
    const max = shift ? Number(shift.fin.slice(0,2))*60+Number(shift.fin.slice(3,5)) : end;
    const blocks = state.data.turnos.filter(a=>a.fecha===day).map(a=>{
      const c=clientById(a.clienta_id), minute=Number(a.hora.slice(0,2))*60+Number(a.hora.slice(3,5));
      const duration=appointmentDuration(a), top=(minute-start)/60*rowHeight, height=Math.max(38,duration/60*rowHeight-3);
      const debt=outstandingTurnDebt(a);
      return `<button type="button" class="cal-event state-${e(a.estado)} ${debt?'has-debt':''} ${a.empleada_id?'staff-'+(state.data.empleadas.findIndex(x=>x.id===a.empleada_id)%5):''}" title="${debt?`Saldo pendiente: ${money(debt)}`:''}" style="top:${top}px;height:${height}px" data-action="appointment-details" data-id="${e(a.id)}" data-drag-id="${e(a.id)}"><strong>${e(timePY(a.hora))} · ${e(c?.nombre||a.nombre_publico||'Clienta')}</strong><span>${e(appointmentServiceLabel(a))}</span>${debt?`<span class="cal-debt">Debe ${money(debt)}</span>`:''}</button>`;
    }).join('');
    const isToday=day===dateInput(), nowParts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Asuncion',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()), nowMinute=Number(nowParts.find(p=>p.type==='hour')?.value||0)*60+Number(nowParts.find(p=>p.type==='minute')?.value||0);
    const nowLine=isToday&&nowMinute>=start&&nowMinute<=end?`<i class="cal-now" style="top:${(nowMinute-start)/60*rowHeight}px" aria-label="Hora actual"></i>`:'';
    return `<div class="cal-day-column ${closed?'is-closed':''}" data-calendar-date="${e(day)}"><header>${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][weekday]} <strong>${e(day.slice(8,10))}</strong>${closed?'<small>Cerrado</small>':''}</header><div class="cal-day-grid" style="height:${(end-start)/60*rowHeight}px;--calendar-start:${start}px" data-calendar-date="${e(day)}">${nowLine}${blocks}</div></div>`;
  }).join('');
  const title=state.agendaMode==='dia'?datePY(date):`${datePY(actualDates[0])} — ${datePY(actualDates.at(-1))}`;
  return `${heading('Agenda','Turnos',`<button class="button primary" data-action="new-appointment">＋ Nuevo turno</button>`)}<div class="toolbar agenda-toolbar"><div class="agenda-date-controls"><button class="button ghost" data-action="agenda-prev" aria-label="Período anterior">←</button><label class="field agenda-date-field"><span class="tiny muted">${e(title)}</span><input id="agenda-date" type="date" value="${e(date)}"></label><button class="button ghost" data-action="agenda-next" aria-label="Período siguiente">→</button><button class="button soft" data-action="agenda-today">Hoy</button></div><div class="agenda-view-toggle"><button class="button ${state.agendaMode==='dia'?'soft':'ghost'}" data-action="agenda-day">Día</button><button class="button ${state.agendaMode==='semana'?'soft':'ghost'}" data-action="agenda-week">Semana</button></div></div><p class="muted tiny">Tocá un espacio libre para agendar. Mantené presionado un turno para moverlo. Los turnos amarillos tienen saldo pendiente.</p><div class="calendar-scroll ${state.agendaMode==='semana'?'week-view':''}"><div class="calendar-grid" style="--cal-hours:${(end-start)/60};--cal-row:${rowHeight}px"><div class="cal-time-axis">${ticks}</div>${columns}</div></div>`;
}

function weekEnd(start) {
  return shiftDate(start, 6);
}

function normalizedPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('595')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return `+595${digits}`;
}

function callLink(phone, label = 'Llamar') {
  const normalized = normalizedPhone(phone);
  return normalized ? `<a class="small-button" href="tel:${e(normalized)}">${e(label)}</a>` : '';
}

function minutesOf(time) { const [h,m]=String(time||'00:00').slice(0,5).split(':').map(Number); return h*60+m; }
function timeAtMinutes(value) { const m=Math.max(0,Math.round(value/15)*15); return `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
function turnOverlap(candidate, exceptId = null) {
  const duration=appointmentDuration(candidate), start=minutesOf(candidate.hora), end=start+duration;
  return state.data.turnos.find(t=>t.id!==exceptId&&t.fecha===candidate.fecha&&t.estado!=='cancelado'&&
    (!candidate.empleada_id || !t.empleada_id || t.empleada_id===candidate.empleada_id) &&
    start<minutesOf(t.hora)+appointmentDuration(t)&&minutesOf(t.hora)<end);
}

async function onCalendarPointerDown(ev) {
  const block=ev.target.closest('[data-drag-id]');
  if (!block || ev.button>0) return;
  const turn=state.data.turnos.find(t=>t.id===block.dataset.dragId);
  if (!turn||turn.estado==='cancelado') return;
  const startDrag=()=>{ state.drag={turn,block,pointerId:ev.pointerId,startX:ev.clientX,startY:ev.clientY,active:true}; block.classList.add('is-dragging'); };
  if (ev.pointerType==='touch') {
    const timer=setTimeout(startDrag,300);
    const cancel=()=>clearTimeout(timer);
    block.addEventListener('pointerup',cancel,{once:true}); block.addEventListener('pointercancel',cancel,{once:true});
  } else startDrag();
}

function calendarPointerMove(ev) {
  const drag=state.drag; if(!drag?.active) return;
  const grid=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.cal-day-grid');
  if(!grid) return;
  const bounds=grid.getBoundingClientRect(), current=parseInt(getComputedStyle(grid).getPropertyValue('--calendar-start')||'480',10), minutes=Math.round((ev.clientY-bounds.top+grid.scrollTop)/64*60+current);
  const hour=timeAtMinutes(minutes); drag.preview={fecha:grid.dataset.calendarDate,hora:hour};
  drag.block.style.transform=`translate(${ev.clientX-drag.startX}px,${ev.clientY-drag.startY}px)`;
  drag.block.dataset.preview=`${datePY(drag.preview.fecha)} ${hour}`;
  drag.block.classList.add('has-preview');
}

async function calendarPointerUp(ev) {
  const drag=state.drag; if(!drag) return;
  state.drag=null; drag.block.classList.remove('is-dragging','has-preview'); drag.block.style.transform='';
  if(!drag.active||!drag.preview) return;
  const positionChanged=drag.preview.fecha!==drag.turn.fecha||minutesOf(drag.preview.hora)!==minutesOf(drag.turn.hora);
  if(!positionChanged) return;
  suppressCalendarClickUntil=Date.now()+600;
  if(drag.turn.estado==='hecho') {
    toast('Este turno ya fue realizado y no se puede mover.','info');
    return;
  }
  const overlap=turnOverlap({...drag.turn,...drag.preview},drag.turn.id);
  const force=overlap?confirm(`Este horario se superpone con ${clientById(overlap.clienta_id)?.nombre||'otro turno'}. ¿Guardar igual?`):false;
  if(overlap&&!force) return;
  try {
    const {error}=await supabase.rpc('mover_turno',{p_turno_id:drag.turn.id,p_fecha:drag.preview.fecha,p_hora:drag.preview.hora,p_permitir_solapamiento:force});
    if(error) throw error; toast('Turno movido'); await refresh();
  } catch(error) { toast(requestError(error),'error'); applyView(); }
}

function renderRequests() {
  const requests = state.data.solicitudes_reserva.filter(r => r.estado === 'pendiente').sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  const rows = requests.map(r => `<tr><td>${e(datePY(r.fecha))} · ${e(timePY(r.hora))}</td><td><strong>${e(r.nombre)}</strong>${r.email?`<small class="muted">${e(r.email)}</small>`:''}</td><td>${e(r.telefono)}</td><td>${e(serviceById(r.servicio_id)?.nombre||'Servicio')} · ${money(serviceById(r.servicio_id)?.precio_gs||0)}</td><td><div class="table-actions"><button class="small-button primary" data-action="accept-request" data-id="${e(r.id)}">Aceptar</button><button class="small-button danger" data-action="reject-request" data-id="${e(r.id)}">Rechazar</button><a class="small-button" href="${waLink(r.telefono,`Hola ${r.nombre}, recibimos tu solicitud para ${datePY(r.fecha)} a las ${timePY(r.hora)}. Te confirmamos en breve.`)}" target="_blank" rel="noopener">WhatsApp</a></div></td></tr>`);
  return `${heading('Solicitudes de reserva','Reservas públicas',`<div class="button-group"><button class="button soft" type="button" data-action="refresh-booking-requests">↻ Actualizar</button><button class="button ghost" data-action="share-booking">Copiar link</button></div>`)}<p class="muted">Aceptá para crear el turno en tu agenda. La clienta todavía no recibió confirmación.</p>${table(['Día y hora','Clienta','Teléfono','Servicio','Acciones'],rows)}`;
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
    return `<tr><td>${e(timePY(a.hora))}</td><td>${e(c?.nombre||a.nombre_publico||'Clienta')}</td><td>${e(phone||'Sin teléfono')}</td><td>${e(appointmentServiceLabel(a))}</td><td>${hasSent?'<span class="status hecho">Enviado</span>':`<div class="table-actions"><a class="small-button primary" href="${url}" target="_blank" rel="noopener">Enviar WhatsApp</a><button class="small-button" data-action="mark-reminder" data-id="${e(a.id)}">Marcar enviado</button></div>`}</td></tr>`
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

function summarizeCashClose(cash) {
  const date = cash.date;
  const appointments = Array.isArray(cash.appointments) ? cash.appointments : [];
  const payments = Array.isArray(cash.payments) ? cash.payments : [];
  const servicePayments = Array.isArray(cash.servicePayments) ? cash.servicePayments : payments;
  const expenses = Array.isArray(cash.expenses) ? cash.expenses : [];
  const completed = appointments.filter(appointment => appointment.estado === 'hecho');
  const paymentTotals = new Map();
  for (const payment of servicePayments) {
    paymentTotals.set(payment.turno_id, (paymentTotals.get(payment.turno_id) || 0) + Number(payment.monto_gs || 0));
  }
  const methods = ['Efectivo', 'Transferencia', 'Tigo Money'];
  const byMethod = Object.fromEntries(methods.map(method => [method,
    payments.filter(payment => payment.medio === method).reduce((sum, payment) => sum + Number(payment.monto_gs || 0), 0)
  ]));
  const otherPayments = payments.filter(payment => !methods.includes(payment.medio) && payment.medio !== 'Deuda')
    .reduce((sum, payment) => sum + Number(payment.monto_gs || 0), 0);
  const debtGenerated = completed.reduce((sum, appointment) =>
    sum + Math.max(0, Number(appointment.precio_cierre_gs ?? appointment.precio_gs ?? 0) - (paymentTotals.get(appointment.id) || 0)), 0);
  const debtPaid = payments.filter(payment => {
    const related = Array.isArray(payment.turno) ? payment.turno[0] : payment.turno;
    return Boolean(related?.fecha && related.fecha < date);
  }).reduce((sum, payment) => sum + Number(payment.monto_gs || 0), 0);
  const expensesTotal = expenses.reduce((sum, expense) => sum + Number(expense.monto_gs || 0), 0);
  const collected = Object.values(byMethod).reduce((sum, amount) => sum + amount, 0) + otherPayments;
  const services = new Map();
  const employees = new Map();
  for (const appointment of completed) {
    const lines=(cash.turnoServices||[]).filter(line=>line.turno_id===appointment.id);
    const items=lines.length?lines.map(line=>({id:line.servicio_id||line.servicio_nombre,nombre:line.servicio_nombre,precio_gs:Number(line.precio_gs||0)})):appointmentServices(appointment);
    const allocated=allocateServiceAmount(Number(appointment.precio_cierre_gs??appointment.precio_gs??0),items);
    for(const item of allocated){
      const serviceId=item.service.id||item.service.nombre||'sin-servicio';
      const service=services.get(serviceId)||{name:item.service.nombre||'Servicio',count:0,total:0};
      service.count+=1; service.total+=item.amount; services.set(serviceId,service);
    }

    if (appointment.empleada_id) {
      const employee = employeeById(appointment.empleada_id);
      const commissionRate = Number(appointment.comision_pct_aplicada ?? employee?.comision_pct ?? 0);
      const commission = Math.round(Number(appointment.precio_cierre_gs ?? appointment.precio_gs ?? 0) * commissionRate / 100);
      const employeeSummary = employees.get(appointment.empleada_id) || { name: employee?.nombre || 'Empleada', total: 0, count: 0 };
      employeeSummary.total += commission;
      employeeSummary.count += 1;
      employees.set(appointment.empleada_id, employeeSummary);
    }
  }
  return { date, appointments, completed, payments, expenses, byMethod, otherPayments, debtGenerated, debtPaid, expensesTotal, collected, net: collected - expensesTotal, services, employees };
}

function renderCashClose() {
  const cash = state.cashData;
  const date = state.cashDate;
  if (state.cashError) return `${heading('Cierre de caja', 'Control diario')}<div class="toolbar"><label class="field"><span class="tiny muted">Fecha del cierre</span><input id="cash-date" type="date" value="${e(date)}"></label></div><section class="panel" role="alert"><p>${e(state.cashError)}</p><button class="button primary" data-action="refresh-cash">Reintentar</button></section>`;
  if (!cash) return `${heading('Cierre de caja', 'Control diario')}<div class="toolbar"><label class="field"><span class="tiny muted">Fecha del cierre</span><input id="cash-date" type="date" value="${e(date)}"></label><span class="muted" role="status">${state.cashLoading ? 'Cargando movimientos…' : 'Seleccioná un día para consultar los movimientos.'}</span></div>`;

  const summary = summarizeCashClose(cash);
  const serviceRows = [...summary.services.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map(item => `<div class="cash-breakdown-row"><div><strong>${e(item.name)}</strong><small>${item.count} ${item.count === 1 ? 'turno' : 'turnos'}</small></div><strong class="cash-breakdown-amount">${money(item.total)}</strong></div>`).join('')
    || empty('Sin servicios', 'No hay turnos realizados en esta fecha.');
  const employeeRows = [...summary.employees.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map(item => `<div class="cash-breakdown-row"><div><strong>${e(item.name)}</strong><small>${item.count} ${item.count === 1 ? 'turno' : 'turnos'}</small></div><strong class="cash-breakdown-amount">${money(item.total)}</strong></div>`).join('')
    || empty('Sin comisiones', 'No hay turnos realizados con empleada asignada en esta fecha.');
  const expenseRows = summary.expenses
    .map(item => `<div class="cash-breakdown-row"><div><strong>${e(item.concepto)}</strong><small>${e(item.categoria || 'Gasto del día')}</small></div><strong class="cash-breakdown-amount">${money(item.monto_gs)}</strong></div>`).join('')
    || empty('Sin gastos', 'No hay gastos registrados en esta fecha.');
  const otherMetric = summary.otherPayments ? metric('Otros cobros', money(summary.otherPayments), '') : '';

  return `<div class="cash-print-area">${heading('Cierre de caja', 'Control diario', `<div class="button-group"><button class="button soft" data-action="cash-print">Imprimir</button><button class="button ghost" data-action="cash-whatsapp">Enviar por WhatsApp</button></div>`)}
    <div class="toolbar no-print"><label class="field"><span class="tiny muted">Fecha del cierre</span><input id="cash-date" type="date" value="${e(summary.date)}"></label><span class="muted">${summary.completed.length} ${summary.completed.length === 1 ? 'turno realizado' : 'turnos realizados'}</span></div>
    <h2 class="cash-date-title">${e(datePY(summary.date))} · ${e(salonName())}</h2>
    <div class="metrics-grid cash-metrics">${metric('Efectivo', money(summary.byMethod.Efectivo), '')}${metric('Transferencia', money(summary.byMethod.Transferencia), '')}${metric('Tigo Money', money(summary.byMethod['Tigo Money']), '')}${otherMetric}${metric('Deuda generada', money(summary.debtGenerated), '')}${metric('Abonos de deuda', money(summary.debtPaid), '')}${metric('Gastos', money(summary.expensesTotal), '')}${metric('Neto', money(summary.net), 'Cobrado − gastos')}</div>
    <div class="content-grid cash-breakdown-grid"><section class="panel cash-breakdown-panel"><h2>Servicios realizados</h2><div class="cash-breakdown-list">${serviceRows}</div></section><section class="panel cash-breakdown-panel"><h2>Comisiones por empleada</h2><div class="cash-breakdown-list">${employeeRows}</div></section><section class="panel cash-breakdown-panel"><h2>Gastos del día</h2><div class="cash-breakdown-list">${expenseRows}</div></section></div>
  </div>`;
}

async function loadCashClose(date, force = false) {
  if (!date || (state.cashLoading && !force)) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    state.cashError = 'Seleccioná una fecha válida para el cierre.';
    if (state.view === 'caja') applyView();
    return;
  }
  const requestId = ++state.cashLoadId;
  state.cashLoading = true;
  state.cashError = '';
  state.cashData = null;
  if (state.view === 'caja') applyView();
  try {
    const [appointmentsResult, paymentsResult, expensesResult] = await Promise.all([
      supabase.from('turnos').select('*').eq('fecha', date).order('hora'),
      supabase.from('pagos')
        .select('id,turno_id,clienta_id,fecha,monto_gs,medio,nota,turno:turnos!pagos_turno_fk(fecha)')
        .eq('fecha', date),
      supabase.from('gastos').select('id,fecha,concepto,categoria,monto_gs').eq('fecha', date)
    ]);
    for (const result of [appointmentsResult, paymentsResult, expensesResult]) {
      if (result.error) throw result.error;
    }
    const appointments = appointmentsResult.data || [];
    const completedIds = appointments.filter(appointment => appointment.estado === 'hecho').map(appointment => appointment.id);
    let servicePayments = [], turnoServices = [];
    if (completedIds.length) {
      const [servicePaymentsResult,turnoServicesResult] = await Promise.all([
        supabase.from('pagos').select('turno_id,monto_gs').in('turno_id', completedIds),
        supabase.from('turno_servicios').select('turno_id,servicio_id,servicio_nombre,precio_gs,duracion_min,orden').in('turno_id', completedIds).order('orden')
      ]);
      if (servicePaymentsResult.error) throw servicePaymentsResult.error;
      if (turnoServicesResult.error) throw turnoServicesResult.error;
      servicePayments = servicePaymentsResult.data || [];
      turnoServices = turnoServicesResult.data || [];
    }
    if (requestId === state.cashLoadId) {
      state.cashData = {
        date,
        appointments,
        turnoServices,
        payments: paymentsResult.data || [],
        servicePayments,
        expenses: expensesResult.data || []
      };
    }
  } catch (error) {
    if (requestId === state.cashLoadId) state.cashError = requestError(error);
  } finally {
    if (requestId === state.cashLoadId) {
      state.cashLoading = false;
      if (state.view === 'caja') applyView();
    }
  }
}

function shareCashClose() {
  if (!state.cashData) return toast('Esperá a que cargue el cierre.', 'error');
  const summary = summarizeCashClose(state.cashData);
  const lines = [
    `Cierre de caja · ${datePY(summary.date)} · ${salonName()}`,
    `Turnos hechos: ${summary.completed.length}`,
    `Efectivo: ${money(summary.byMethod.Efectivo)}`,
    `Transferencia: ${money(summary.byMethod.Transferencia)}`,
    `Tigo Money: ${money(summary.byMethod['Tigo Money'])}`,
    ...(summary.otherPayments ? [`Otros cobros: ${money(summary.otherPayments)}`] : []),
    `Deuda generada: ${money(summary.debtGenerated)}`,
    `Abonos de deuda: ${money(summary.debtPaid)}`,
    `Gastos: ${money(summary.expensesTotal)}`,
    `Neto cobrado − gastos: ${money(summary.net)}`
  ];
  window.open(waLink('', lines.join('\n')), '_blank', 'noopener');
}

function foldText(value) { return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es'); }
function openGlobalSearch() { const dialog=$('#global-search-dialog'); dialog.showModal(); $('#global-search-input').value=''; $('#global-search-input').focus(); renderGlobalSearch(''); }
function renderGlobalSearch(query) {
  const target=$('#global-search-results'), q=foldText(query.trim());
  if(!q) { target.innerHTML='<p class="muted">Buscá una clienta, turno o servicio.</p>'; return; }
  target.innerHTML='<p class="muted" role="status">Buscando…</p>';
  clearTimeout(state.searchTimer);
  state.searchTimer=setTimeout(()=>{
    const clients=state.data.clientas.filter(c=>foldText(`${c.nombre} ${c.telefono}`).includes(q)).slice(0,8);
    const appointments=state.data.turnos.filter(a=>foldText(`${clientById(a.clienta_id)?.nombre||a.nombre_publico||''} ${appointmentServiceLabel(a)} ${datePY(a.fecha)} ${a.fecha}`).includes(q)).slice(0,8);
    const services=state.data.servicios.filter(s=>foldText(s.nombre).includes(q)).slice(0,8);
    state.searchResults=[...clients.map(x=>({kind:'client',item:x})),...appointments.map(x=>({kind:'appointment',item:x})),...services.map(x=>({kind:'service',item:x}))];state.searchActive=0;
    const groups=[['client','Clientas','♡',x=>`${x.nombre} · ${x.telefono||'Sin teléfono'}`],['appointment','Turnos','▦',x=>`${datePY(x.fecha)} ${timePY(x.hora)} · ${clientById(x.clienta_id)?.nombre||x.nombre_publico||'Clienta'} · ${appointmentServiceLabel(x)}`],['service','Servicios','✦',x=>`${x.nombre} · ${money(x.precio_gs)}`]];
    const html=groups.map(([kind,label,icon,text])=>{const items=state.searchResults.filter(r=>r.kind===kind);return items.length?`<section><h3>${icon} ${label}</h3>${items.map((r,i)=>`<button role="option" aria-selected="${state.searchActive===state.searchResults.indexOf(r)}" id="global-search-option-${state.searchResults.indexOf(r)}" class="search-result" data-action="global-search-result" data-kind="${kind}" data-id="${e(r.item.id)}"><span>${e(text(r.item))}</span><span aria-hidden="true">↗</span></button>`).join('')}</section>`:''}).join('');
    target.innerHTML=html||'<p class="empty-state">No encontramos coincidencias.</p>'; $('#global-search-input').setAttribute('aria-activedescendant',state.searchResults.length?'global-search-option-0':'');
  },250);
}
function moveSearchActive(delta) {
  if(!state.searchResults.length) return;
  state.searchActive=(state.searchActive+delta+state.searchResults.length)%state.searchResults.length;
  $$('.search-result').forEach((el,i)=>el.setAttribute('aria-selected',String(i===state.searchActive)));
  $('#global-search-input').setAttribute('aria-activedescendant',`global-search-option-${state.searchActive}`);
  document.getElementById(`global-search-option-${state.searchActive}`)?.scrollIntoView({block:'nearest'});
}
function openSearchResult(kind,id) {
  $('#global-search-dialog').close();
  if(kind==='client') return clientDetails(id);
  if(kind==='service') return newServiceForm(state.data.servicios.find(s=>s.id===id));
  const appointment=state.data.turnos.find(a=>a.id===id); if(!appointment) return;
  state.agendaDate=appointment.fecha;state.agendaMode='dia';location.hash='#agenda';setTimeout(()=>appointmentDetails(id),0);
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
    const services=appointment?appointmentServices(appointment):[];
    const allocated=allocateServiceAmount(Number(payment.monto_gs||0),services);
    for(const item of allocated){const sn=item.service.nombre||'Servicio';serviceTotals.set(sn,(serviceTotals.get(sn)||0)+item.amount);}
    const en = employeeById(appointment?.empleada_id)?.nombre || 'Sin asignar';
    employeeTotals.set(en, (employeeTotals.get(en) || 0) + Number(payment.monto_gs || 0));
  }
  const breakdown = map => [...map].sort((a, b) => b[1] - a[1]).map(([name, value]) => `<div class="list-row"><div class="list-row-main"><strong>${e(name)}</strong></div><strong>${money(value)}</strong></div>`).join('') || empty('Sin movimientos', 'Los pagos registrados aparecerán acá.');
  return `${heading('Ingresos','Reportes')}<div class="toolbar"><button class="button ${state.reportMode==='dia'?'soft':'ghost'}" data-report="dia">Día</button><button class="button ${state.reportMode==='semana'?'soft':'ghost'}" data-report="semana">Semana</button><button class="button ${state.reportMode==='mes'?'soft':'ghost'}" data-report="mes">Mes</button></div><div class="metrics-grid">${metric('Ingresos del período',money(total),`${filtered.length} pagos registrados`)}</div><div class="content-grid"><section class="panel"><div class="panel-head"><h2>Ingresos por ${state.reportMode==='dia'?'hora de pago':state.reportMode==='semana'?'día':'día del mes'}</h2></div><div class="chart-box"><div class="chart-legend" aria-hidden="true"><span><i class="chart-legend-rose"></i>Ingresos</span><span><i class="chart-legend-champagne"></i>Promedio</span></div><canvas id="income-chart" aria-label="Gráfico lineal de ingresos con referencia de promedio"></canvas></div></section><section class="panel"><h2>Por servicio</h2><div class="list">${breakdown(serviceTotals)}</div></section><section class="panel"><h2>Por empleada</h2><div class="list">${breakdown(employeeTotals)}</div></section></div>`;
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
  return `${heading('Perfil del salón','Configuración')}<section class="panel"><div class="panel-head"><h2>Más herramientas</h2></div><div class="toolbar">${moreLinks}</div></section><div class="content-grid"><form id="profile-form" class="panel form-grid"><label class="field wide">Nombre del salón<input name="nombre" maxlength="100" required value="${e(p.nombre||'')}"></label><label class="field">Slug de reservas<input name="slug" maxlength="60" required autocomplete="off" spellcheck="false" value="${e(p.slug||'')}"><small class="muted">Solo letras sin tilde, números y guiones. Ej.: adw. Si lo cambiás, el link anterior dejará de funcionar.</small></label><label class="field">Teléfono del salón<input name="telefono" type="tel" maxlength="24" value="${e(p.telefono||'')}"></label><label class="field wide">Dirección<input name="direccion" maxlength="180" value="${e(p.direccion||'')}"></label><label class="field">Color principal<input name="color_principal" type="color" value="${e(validColor(p.color_principal)?p.color_principal:getComputedStyle(document.body).getPropertyValue('--primary-fill').trim())}"></label><label class="field">Visitas para premio<input name="visitas_premio" type="number" min="2" max="100" value="${Number(p.visitas_premio||10)}"></label><label class="field">Premio de fidelidad<input name="premio_descripcion" maxlength="100" value="${e(p.premio_descripcion||'Servicio o descuento especial')}"></label><label class="field wide">Link de reseñas de Google<input name="google_review_url" type="url" maxlength="500" placeholder="https://g.page/r/.../review" value="${e(p.google_review_url||'')}"><small class="muted">Obtenelo desde Perfil de Empresa de Google → Pedir reseñas. Usá un enlace HTTPS.</small></label><label class="field wide">Horario de atención<input name="horario_texto" maxlength="180" placeholder="Lun a sáb · 08:00 a 18:00" value="${e(p.horario_texto||'')}"></label><label class="field wide">Horario semanal para reservas (JSON)<textarea name="horarios_json" rows="5">${e(JSON.stringify(p.horarios||defaultHours(),null,2))}</textarea><small class="muted">Usá formato 24 h y días 0 domingo… 6 sábado. Ej.: {"1":{"inicio":"08:00","fin":"18:00"}}.</small></label><label class="field wide">Logo del salón<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label><div class="field wide"><button class="button primary" type="submit">Guardar perfil</button></div></form>
    <div class="page-stack"><section class="panel"><h2>Reservas públicas</h2><p class="muted tiny">Compartí el enlace para que tus clientas soliciten horario.</p><input class="input" readonly value="${e(bookingURL())}"><div class="toolbar"><button class="button soft" data-action="share-booking">Copiar link</button><button class="button ghost" data-action="whatsapp-booking">Compartir por WhatsApp</button></div></section><section class="panel"><h2>Fidelización</h2><p class="muted">Cada ${Number(p.visitas_premio||10)} visitas: ${e(p.premio_descripcion||'un premio especial')}.</p></section><section class="panel"><h2>Respaldo y datos</h2><p class="muted tiny">El respaldo contiene la información del salón que puede leer tu cuenta.</p><div class="toolbar"><button class="button soft" data-action="backup-json">Descargar JSON</button><button class="button ghost" data-action="backup-csv">Descargar CSV</button></div></section><section class="panel"><h2>Mensajes de WhatsApp</h2><p class="muted tiny">Editá las plantillas. Variables: {nombre}, {fecha}, {hora}, {deuda}, {salon}; agradecimiento usa también {servicio} y {resena}.</p>${templates.map(t=>`<label class="field">${e(t.label)}<textarea class="template-input" data-template="${e(t.key)}" rows="3">${e(t.row?.contenido||t.defaultText)}</textarea></label>`).join('')}<button class="button primary" data-action="save-templates">Guardar mensajes</button></section><section class="panel"><h2>Cambiar contraseña</h2><p class="muted tiny">Usá una contraseña nueva de al menos ocho caracteres.</p><form id="logged-password-form" class="password-settings-form"><label class="field">Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label class="field">Confirmar contraseña<input name="password_confirm" type="password" autocomplete="new-password" minlength="8" required></label><button class="button primary password-save" type="submit">Guardar contraseña</button><p id="logged-password-message" class="password-settings-message form-error" role="status" aria-live="polite"></p></form></section><section class="panel"><h2>Modo de pantalla</h2><p class="muted">Se guarda en este dispositivo.</p><button class="button ghost" data-action="toggle-theme">Cambiar tema</button></section></div></div>`;
}

function validColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}

function validPhone(value) {
  const raw = String(value || ''), digits = raw.replace(/\D/g, '');
  return /^[+0-9() .-]{7,24}$/.test(raw) && digits.length >= 7 && digits.length <= 15;
}

function validSchedule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const days = Object.entries(value), timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return days.length > 0 && days.every(([day, hours]) => {
    if (!/^[0-6]$/.test(day) || !hours || typeof hours !== 'object' || Array.isArray(hours)) return false;
    const start = String(hours.inicio || ''), end = String(hours.fin || '');
    return timePattern.test(start) && timePattern.test(end) && start < end;
  });
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

function onboardingFirstIncomplete() {
  const index = onboardingChecks().findIndex(item => !item.done);
  return index < 0 ? 0 : index;
}

function renderOnboardingStep() {
  const index = Math.max(0, Math.min(3, state.onboardingStep)), profile = state.profile || {};
  state.onboardingStep = index;
  const progress = $('#onboarding-progress');
  progress.value = index + 1;
  $('#onboarding-step-label').textContent = `Paso ${index + 1} de 4`;
  $('#onboarding-progress-value').textContent = `${Math.round((index + 1) / 4 * 100)}%`;
  $('#onboarding-back').classList.toggle('hidden', index === 0);
  $('#onboarding-next').textContent = index === 3 ? 'Finalizar' : 'Continuar';
  const contents = [
    `<div><h3>Nombre y logo del salón</h3><p class="muted">Así te van a reconocer tus clientas. El logo es opcional y podés cambiarlo después.</p></div><form id="onboarding-form" class="form-grid"><label class="field wide">Nombre del salón<input name="salon_nombre" maxlength="100" required value="${e(profile.nombre === 'Mi salón' ? '' : profile.nombre || '')}" placeholder="Ej.: Salón Bella"></label><label class="field wide">Logo del salón (opcional)<input name="salon_logo" type="file" accept="image/png,image/jpeg,image/webp"><small class="muted">PNG, JPG o WebP · máximo 2 MB.</small></label></form>`,
    `<div><h3>Servicios y precios</h3><p class="muted">Los precios sugeridos son un punto de partida. Editalos o desmarcá los que no ofrecés.</p></div><form id="onboarding-form" class="onboarding-service-list">${ONBOARDING_SERVICES.map((suggestion,i)=>{const existing=state.data.servicios.find(service=>service.nombre.toLocaleLowerCase('es')===suggestion.nombre.toLocaleLowerCase('es'));return `<div class="onboarding-service-row"><input type="checkbox" name="service-enabled" value="${i}" aria-label="Incluir ${e(suggestion.nombre)}" checked><input name="service-name-${i}" aria-label="Nombre del servicio" maxlength="100" required value="${e(existing?.nombre||suggestion.nombre)}"><input name="service-price-${i}" aria-label="Precio en guaraníes" type="number" min="0" max="100000000" step="1000" required value="${Number(existing?.precio_gs??suggestion.precio_gs)}"><input class="onboarding-duration" name="service-duration-${i}" aria-label="Duración en minutos" type="number" min="5" max="600" step="5" required value="${Number(existing?.duracion_min??suggestion.duracion_min)}"></div>`;}).join('')}</form><p class="tiny muted">Cada fila: activar, servicio, Gs. y duración en minutos.</p>`,
    `<div><h3>Horario de atención</h3><p class="muted">Marcá los días en que abrís y ajustá las horas. Se usarán también para las reservas.</p></div><form id="onboarding-form" class="onboarding-days">${WEEKDAYS.map(([day,label])=>{const hours=(profile.horarios||defaultHours())[day]||{},checked=!!profile.horarios?.[day]||(!profile.horario_texto&&!!defaultHours()[day]);return `<div class="onboarding-day"><label class="onboarding-day-name"><input type="checkbox" name="schedule-day" value="${day}" ${checked?'checked':''}>${e(label)}</label><label class="field">Abre<input type="time" name="schedule-start-${day}" value="${e(hours.inicio||'08:00')}" aria-label="Hora de apertura ${e(label)}"></label><label class="field">Cierra<input type="time" name="schedule-end-${day}" value="${e(hours.fin||'18:00')}" aria-label="Hora de cierre ${e(label)}"></label></div>`;}).join('')}<label class="field wide">Resumen del horario<input name="schedule-label" maxlength="180" value="${e(profile.horario_texto||'')}" placeholder="Lun a sáb · 08:00 a 18:00"></label></form>`,
    state.data.clientas.length
      ? `<div><h3>Primera clienta</h3><p class="muted">Ya cargaste ${state.data.clientas.length} clienta${state.data.clientas.length===1?'':'s'}. Este paso está completo.</p></div><div class="empty-state"><div class="empty-icon" aria-hidden="true">♡</div><strong>Tu agenda ya tiene una clienta</strong><span>Podés terminar el asistente.</span></div>`
      : `<div><h3>Agregá tu primera clienta</h3><p class="muted">Empezá con una ficha y completá los demás datos cuando quieras.</p></div><form id="onboarding-form" class="form-grid"><label class="field wide">Nombre completo<input name="client-name" maxlength="100" required autocomplete="name"></label><label class="field wide">Teléfono / WhatsApp (opcional)<input name="client-phone" type="tel" maxlength="24" autocomplete="tel" placeholder="09XX XXX XXX"></label></form>`
  ];
  $('#onboarding-description').innerHTML = contents[index];
}

function openOnboarding(step = onboardingFirstIncomplete()) {
  if (state.onboardingSchemaMissing) return toast('Primero ejecutá supabase/migracion_02.sql en Supabase → SQL Editor.', 'error');
  if (!requireEditable()) return;
  state.onboardingStep = Number.isInteger(Number(step)) ? Number(step) : onboardingFirstIncomplete();
  renderOnboardingStep();
  const dialog = $('#onboarding-dialog');
  if (!dialog.open) dialog.showModal();
  $('#onboarding-next').focus();
}

async function updateOnboardingStatus(status) {
  if (state.onboardingSchemaMissing) throw new Error('Falta ejecutar supabase/migracion_02.sql en Supabase → SQL Editor.');
  const { error } = await supabase.from('perfiles').update({ onboarding_estado: status }).eq('user_id', state.client.id);
  if (error) throw error;
  await getProfile();
}

async function saveOnboardingStep() {
  if (!requireEditable()) return;
  const index = state.onboardingStep, form = $('#onboarding-description form'), data = form ? new FormData(form) : new FormData();
  if (form && !form.reportValidity()) return;
  if (index === 0) {
    const nombre = String(data.get('salon_nombre') || '').trim(), file = form.elements.salon_logo.files[0];
    if (!nombre || nombre.length > 100) return toast('Ingresá el nombre del salón.', 'error');
    if (file && (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) return toast('Elegí un logo PNG, JPG o WebP de hasta 2 MB.', 'error');
    const result = await supabase.from('perfiles').update({ nombre }).eq('user_id', state.client.id);
    if (result.error) throw result.error;
    if (file) {
      const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${state.client.id}/logo-${Date.now()}.${extension}`;
      const uploaded = await supabase.storage.from(BRAND_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (uploaded.error) throw uploaded.error;
      const logo_url = supabase.storage.from(BRAND_BUCKET).getPublicUrl(path).data.publicUrl;
      const saved = await supabase.from('perfiles').update({ logo_url }).eq('user_id', state.client.id);
      if (saved.error) throw saved.error;
    }
    await getProfile();
  } else if (index === 1) {
    const enabled = new Set([...form.querySelectorAll('[name="service-enabled"]:checked')].map(input => Number(input.value)));
    if (!enabled.size) return toast('Elegí al menos un servicio para agregar.', 'error');
    const rows = [...enabled].map(i => ({
      id: state.data.servicios.find(service=>service.nombre.toLocaleLowerCase('es')===String(data.get(`service-name-${i}`)).trim().toLocaleLowerCase('es'))?.id || null,
      nombre: String(data.get(`service-name-${i}`) || '').trim(),
      precio_gs: Number(data.get(`service-price-${i}`)),
      duracion_min: Number(data.get(`service-duration-${i}`)),
      activo: true
    }));
    if (rows.some(row => !row.nombre || row.nombre.length > 100 || !Number.isInteger(row.precio_gs) || row.precio_gs < 0 || row.precio_gs > 100000000 || !Number.isInteger(row.duracion_min) || row.duracion_min < 5 || row.duracion_min > 600)) return toast('Revisá los nombres, precios y duración de los servicios.', 'error');
    if (new Set(rows.map(row=>row.nombre.toLocaleLowerCase('es'))).size !== rows.length) return toast('Cada servicio debe tener un nombre diferente.', 'error');
    const externalNames = new Set(state.data.servicios.filter(service=>!rows.some(row=>row.id===service.id)).map(service=>service.nombre.toLocaleLowerCase('es')));
    if (rows.some(row=>externalNames.has(row.nombre.toLocaleLowerCase('es')))) return toast('Ya existe un servicio con ese nombre. Cambiá el nombre sugerido.', 'error');
    for (const row of rows) {
      const payload = { nombre: row.nombre, precio_gs: row.precio_gs, duracion_min: row.duracion_min, activo: true };
      const result = row.id ? await supabase.from('servicios').update(payload).eq('id',row.id) : await supabase.from('servicios').insert(payload);
      if (result.error) throw result.error;
    }
    state.data.servicios = (await loadTables(['servicios'])).servicios;
  } else if (index === 2) {
    const days = [...form.querySelectorAll('[name="schedule-day"]:checked')].map(input => input.value), horarios = {};
    for (const day of days) {
      const inicio = String(data.get(`schedule-start-${day}`) || ''), fin = String(data.get(`schedule-end-${day}`) || '');
      horarios[day] = { inicio, fin };
    }
    if (!validSchedule(horarios)) return toast('Elegí al menos un día y revisá las horas de apertura y cierre.', 'error');
    const selectedDays = days.map(day=>WEEKDAYS.find(item=>item[0]===day)?.[1].slice(0,3)).join(', ');
    const firstHours = horarios[days[0]], summary = String(data.get('schedule-label') || '').trim() || `${selectedDays} · ${firstHours.inicio} a ${firstHours.fin}`;
    const result = await supabase.from('perfiles').update({ horarios, horario_texto: summary }).eq('user_id', state.client.id);
    if (result.error) throw result.error;
    await getProfile();
  } else {
    if (!state.data.clientas.length) {
      const nombre = String(data.get('client-name') || '').trim(), telefono = String(data.get('client-phone') || '').trim();
      if (!nombre || nombre.length > 100) return toast('Ingresá el nombre de la primera clienta.', 'error');
      if (telefono && !validPhone(telefono)) return toast('Ingresá un teléfono válido (entre 7 y 15 dígitos).', 'error');
      const result = await supabase.from('clientas').insert({ nombre, telefono: telefono || null });
      if (result.error) throw result.error;
      state.data.clientas = (await loadTables(['clientas'])).clientas;
    }
    await updateOnboardingStatus('completado');
    $('#onboarding-dialog').close();
    toast('Configuración inicial completada. ¡Tu salón ya está listo!');
    return refresh();
  }
  state.onboardingStep += 1;
  renderOnboardingStep();
}

async function skipOnboarding() {
  if (!requireEditable()) return;
  try {
    await updateOnboardingStatus('omitido');
    $('#onboarding-dialog').close();
    applyView();
    toast('Podés continuar la configuración desde “Primeros pasos”.', 'info');
  } catch (error) {
    toast(requestError(error), 'error');
  }
}

async function completeOnboardingIfReady() {
  if (!state.client || state.onboardingSchemaMissing || !editable() || state.profile?.onboarding_estado === 'completado' || onboardingCompletionPending) return;
  if (onboardingChecks().every(item=>item.done)) {
    onboardingCompletionPending = true;
    try { await updateOnboardingStatus('completado'); }
    finally { onboardingCompletionPending = false; }
  }
}

function templateMessage(key, client, extra = {}) {
  const t = state.data.plantillas.find(x => x.clave === key),
    def = TEMPLATES.find(x => x[0] === key)?.[2] || '';
  return fillTemplate(t?.contenido || def, {
    nombre: client?.nombre || '',
    fecha: extra.fecha || '',
    hora: extra.hora || '',
    deuda: money(client?.deuda_gs || 0),
    salon: salonName(),
    servicio: extra.servicio || '',
    resena: state.profile?.google_review_url ? `\n${state.profile.google_review_url}` : ''
  });
}

function appointmentDetails(id) {
  const a=state.data.turnos.find(t=>t.id===id); if(!a) return;
  const c=clientById(a.clienta_id),services=appointmentServiceLabel(a),payments=state.data.pagos.filter(p=>p.turno_id===id),phone=c?.telefono||a.telefono_publico;
  const name=c?.nombre||a.nombre_publico||'Clienta';
  const call=callLink(phone), wa=phone&&a.estado!=='cancelado'?`<a class="small-button primary" href="${e(waLink(phone,appointmentConfirmationMessage({nombre:name,fecha:a.fecha,hora:a.hora,servicio:services})))}" target="_blank" rel="noopener">Confirmar por WhatsApp</a>`:'';
  const paymentActions=payments.length?`<p><strong>Cobrado:</strong> ${money(payments.reduce((n,p)=>n+Number(p.monto_gs),0))}</p>`:'';
  const deleteAction=a.estado==='pendiente'?(payments.length?'<p class="muted tiny">No se puede eliminar: este turno tiene pagos asociados. Cancelalo para conservar el historial.</p>':`<button class="button danger" data-action="delete-appointment" data-id="${e(id)}">Eliminar turno</button>`):'';
  const undoAction=a.estado==='hecho'?`<button class="button danger" data-action="undo-payment" data-id="${e(id)}">Anular cobro / deuda</button>`:'';
  const thanks=a.agradecido_at?'<span class="status hecho">Agradecimiento enviado</span>':a.estado==='hecho'?`<button class="button soft" data-action="send-thanks" data-id="${e(id)}">Enviar agradecimiento</button>`:'';
  showModal('Detalle del turno',`<div class="appointment-detail"><h3>${e(c?.nombre||a.nombre_publico||'Clienta')}</h3><p>${e(datePY(a.fecha))} · ${e(timePY(a.hora))}</p><p>${e(services)} · ${money(a.precio_gs)} · ${appointmentDuration(a)} min</p><p><span class="status ${e(a.estado)}">${e(a.estado)}</span> · ${e(employeeById(a.empleada_id)?.nombre||'Sin empleada')}</p><div class="toolbar">${call}${wa}</div><div class="toolbar"><button class="button ghost" data-action="edit-appointment" data-id="${e(id)}">Editar</button>${a.estado==='pendiente'?`<button class="button primary" data-action="done-appointment" data-id="${e(id)}">Marcar hecho y cobrar</button><button class="button danger" data-action="cancel-appointment" data-id="${e(id)}">Cancelar turno</button>`:''}</div><div class="toolbar">${paymentActions}${undoAction}${thanks}${deleteAction}</div></div>`,'Cerrar');
  $('#modal-footer').innerHTML='<button class="button ghost" type="button" data-modal-close>Cerrar</button>';
}

async function undoPayment(id) {
  if(!requireEditable()||!confirm('¿Anular el cobro y volver el turno a pendiente?')) return;
  const {error}=await supabase.rpc('anular_cobro_turno',{p_turno_id:id}); if(error) throw error;
  toast('Cobro anulado y saldo recalculado'); $('#modal').close(); await refresh();
}

async function deletePendingAppointment(id) {
  if (!requireEditable()) return;
  const appointment = state.data.turnos.find(turn => turn.id === id);
  if (!appointment || appointment.estado !== 'pendiente') {
    toast('Solo se pueden eliminar turnos pendientes.', 'error');
    return;
  }
  if (state.data.pagos.some(payment => payment.turno_id === id)) {
    toast('Este turno tiene pagos asociados. Cancelalo para conservar el historial.', 'error');
    return;
  }
  const client = clientById(appointment.clienta_id);
  const name = client?.nombre || appointment.nombre_publico || 'la clienta';
  if (!confirm(`¿Eliminar el turno de ${name} del ${datePY(appointment.fecha)} a las ${timePY(appointment.hora)}? Esta acción no se puede deshacer.`)) return;
  const { data, error } = await supabase.from('turnos').delete()
    .eq('id', id).eq('estado', 'pendiente').select('id').maybeSingle();
  if (error) {
    if (error.code === '23503') throw new Error('No se puede eliminar porque el turno tiene pagos asociados. Cancelalo para conservar el historial.');
    throw error;
  }
  if (!data) {
    toast('El turno ya no está pendiente o fue eliminado.', 'error');
    return;
  }
  $('#modal').close();
  toast('Turno eliminado');
  await refresh();
}

function thanksMessage(turn) {
  const client=clientById(turn.clienta_id)||{nombre:turn.nombre_publico||'Clienta'},template=state.data.plantillas.find(x=>x.clave==='agradecimiento');
  let content=template?.contenido||TEMPLATES.find(x=>x[0]==='agradecimiento')[2];
  if(!state.profile?.google_review_url) content=content.replace(/\s*¿Nos dejás una reseña\?\s*\{resena\}/i,'');
  return fillTemplate(content,{
    nombre:client.nombre,salon:salonName(),servicio:appointmentServiceLabel(turn),
    resena:state.profile?.google_review_url?`\n${state.profile.google_review_url}`:''
  }).replace(/\s*\{resena\}/g,'').trim();
}

async function sendThanks(id) {
  const turn=state.data.turnos.find(a=>a.id===id),client=turn&&clientById(turn.clienta_id),phone=client?.telefono||turn?.telefono_publico;
  if(!turn||turn.agradecido_at) return toast('Este turno ya tiene agradecimiento marcado.');
  if(!phone) return toast('No hay teléfono para abrir WhatsApp.','error');
  const popup=window.open('about:blank','_blank');
  try {
    const {data,error}=await supabase.from('turnos').select('agradecido_at').eq('id',id).maybeSingle();
    if(error) throw error;
    if(data?.agradecido_at) { turn.agradecido_at=data.agradecido_at; popup?.close(); return toast('Este turno ya tiene agradecimiento marcado.'); }
    if(popup) popup.location.href=waLink(phone,thanksMessage(turn));
    else return toast('El navegador bloqueó la ventana de WhatsApp. Permití ventanas emergentes e intentá de nuevo.','error');
  } catch(error) { popup?.close(); throw error; }
  toast('Después de enviar el mensaje, marcá el agradecimiento como enviado.');
}

async function markThanksSent(id) {
  if(!requireEditable()) return;
  const {error}=await supabase.rpc('marcar_agradecido',{p_turno_id:id}); if(error) throw error;
  toast('Agradecimiento marcado como enviado'); await refresh();
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
      t: 42,
      b: 24
    },
    max = Math.max(...values, 1),
    n = values.length,
    slot = (w - pad.l - pad.r) / n,
    average = n ? values.reduce((sum, value) => sum + value, 0) / n : 0,
    plotHeight = h - pad.t - pad.b,
    pointX = i => pad.l + i * slot + slot / 2,
    pointY = value => h - pad.b - plotHeight * value / max;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--border');
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--color-slate');
  ctx.font = '12px Inter, system-ui';
  ctx.textAlign = 'center';
  for (let i = 0; i < 4; i++) {
    const y = pad.t + (h - pad.t - pad.b) * i / 3;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--color-champagne');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pointY(average));
  ctx.lineTo(w - pad.r, pointY(average));
  ctx.stroke();
  ctx.restore();
  if (n) {
    ctx.beginPath();
    values.forEach((value, i) => {
      if (i === 0) ctx.moveTo(pointX(i), pointY(value));
      else ctx.lineTo(pointX(i), pointY(value));
    });
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--color-rose');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    values.forEach((value, i) => {
      ctx.beginPath();
      ctx.arc(pointX(i), pointY(value), 3, 0, Math.PI * 2);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--color-rose');
      ctx.fill();
    });
  }
  labels.forEach((label, i) => {
    if (n <= 10 || i % 5 === 0 || i === n - 1) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--color-slate');
      ctx.fillText(label, pointX(i), h - 7);
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
  $('#cash-date')?.addEventListener('change', ev => {
    state.cashDate = ev.target.value || dateInput();
    loadCashClose(state.cashDate,true).catch(error => toast(requestError(error), 'error'));
  });
  if (state.view === 'caja' && state.cashData?.date !== state.cashDate && !state.cashLoading && !state.cashError) loadCashClose(state.cashDate).catch(error => toast(requestError(error), 'error'));
  if (state.view === 'reportes') {
    drawChart(state.chart?.labels || [], state.chart?.values || []);
    addEventListener('resize', () => drawChart(state.chart?.labels || [], state.chart?.values || []), {
      once: true
    });
  }
  $('#profile-form')?.addEventListener('submit', ev => saveProfile(ev).catch(error => toast(requestError(error), 'error')));
  $('#logged-password-form')?.addEventListener('submit', changeLoggedPassword);
  $$('[data-report]').forEach(b => b.addEventListener('click', () => {
    state.reportMode = b.dataset.report;
    applyView();
  }));
  $('#view-root').onchange = ev => {
    if (ev.target.matches('[data-template]')) ev.target.dataset.changed = '1';
  };
}

async function changeLoggedPassword(ev) {
  ev.preventDefault();
  const form = ev.currentTarget, password = form.elements.password.value, confirmation = form.elements.password_confirm.value,
    button = form.querySelector('button[type="submit"]'), message = $('#logged-password-message');
  message.textContent = '';
  message.classList.remove('form-success');
  message.classList.add('form-error');
  if (password.length < 8) return message.textContent = 'La contraseña debe tener al menos 8 caracteres.';
  if (password !== confirmation) return message.textContent = 'Las contraseñas no coinciden.';
  setBusy(button, true, 'Guardando…');
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    form.reset();
    message.classList.remove('form-error');
    message.classList.add('form-success');
    message.textContent = 'Tu contraseña se actualizó correctamente.';
  } catch (error) {
    message.textContent = requestError(error);
  } finally {
    setBusy(button, false);
  }
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

function appointmentConfirmationMessage({ nombre, fecha, hora, servicio }) {
  return `${nombre ? `Hola ${nombre}` : 'Hola'}, tu turno en ${salonName()} quedó confirmado para el ${datePY(fecha)} a las ${timePY(hora)} hs.${servicio ? ` Servicio: ${servicio}.` : ''} ¡Te esperamos!`;
}

function showAppointmentConfirmation({ nombre, telefono, fecha, hora, servicio }) {
  const name = nombre || 'Hola';
  const message = appointmentConfirmationMessage({ nombre, fecha, hora, servicio });
  const whatsapp = telefono
    ? `<a class="button primary" href="${e(waLink(telefono, message))}" target="_blank" rel="noopener">Enviar confirmación por WhatsApp</a>`
    : '<p class="muted">Esta clienta no tiene teléfono cargado. Agregalo a su ficha para enviarle la confirmación por WhatsApp.</p>';
  showModal('Turno confirmado', `<div class="success-panel"><div class="success-icon">✓</div><h3>${e(name)}, el turno ya está en tu agenda.</h3><p class="muted">${e(datePY(fecha))} · ${e(timePY(hora))}${servicio ? ` · ${e(servicio)}` : ''}</p>${whatsapp}</div>`, 'Listo');
  $('#modal-footer').innerHTML = '<button class="button ghost" type="button" data-modal-close>Listo</button>';
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
    if (!requireEditable()) return;
    const form = $('#modal-body form');
    if (form && !form.reportValidity()) return;
    const blankRequiredText = form && [...form.querySelectorAll('input[required][type="text"]')].find(input => !input.value.trim());
    if (blankRequiredText) {
      blankRequiredText.focus();
      return toast('Completá los campos obligatorios.', 'error');
    }
    setBusy(b, true);
    try {
      const afterSubmit = await fn(form, form ? new FormData(form) : new FormData());
      $('#modal').close();
      if (typeof afterSubmit === 'function') afterSubmit();
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
      phone = raw.telefono.trim(),
      payload = {
        nombre: raw.nombre.trim(),
        telefono: phone || null,
        email: raw.email.trim() || null,
        fecha_nacimiento: raw.fecha_nacimiento || null,
        notas: raw.notas.trim() || null
      };
    if (!payload.nombre) return toast('Ingresá el nombre de la clienta.', 'error');
    if (phone && !validPhone(phone)) return toast('Ingresá un teléfono válido (entre 7 y 15 dígitos).', 'error');
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
  if(item.estado==='hecho') return toast('Los turnos realizados no se pueden editar. Anulá el cobro si necesitás corregirlo.','error');
  const currentServiceIds=(state.data.turno_servicios||[]).filter(row=>row.turno_id===item.id).sort((a,b)=>Number(a.orden||0)-Number(b.orden||0)).map(row=>row.servicio_id).filter(Boolean);
  if(!currentServiceIds.length&&item.servicio_id) currentServiceIds.push(item.servicio_id);
  const offeredServices=state.data.servicios.filter(service=>service.activo||currentServiceIds.includes(service.id));
  const serviceChoices=offeredServices.map(service=>{const price=Number(service.precio_gs)||0,duration=Number(service.duracion_min)||60;return `<label class="check-field"><input type="checkbox" name="servicio_ids" value="${e(service.id)}" data-price="${price}" data-duration="${duration}" ${currentServiceIds.includes(service.id)?'checked':''}>${e(service.nombre)} · ${money(price)} · ${duration} min</label>`}).join('');
  const selectedServices=offeredServices.filter(service=>currentServiceIds.includes(service.id));
  const initialPrice=selectedServices.reduce((sum,service)=>sum+Number(service.precio_gs||0),0);
  const initialDuration=selectedServices.reduce((sum,service)=>sum+Number(service.duracion_min||60),0);
  const statusOptions=item.estado==='hecho'?[['hecho','Hecho']]:[['pendiente','Pendiente'],['cancelado','Cancelado']];
  showModal(edit ? 'Editar turno' : 'Nuevo turno', `<form id="entity-form" class="form-grid">${selectField('Clienta','clienta_id',clientsSorted().map(c=>[c.id,c.nombre]),item.clienta_id||'')}<fieldset class="service-choice-field wide"><legend>Servicios del turno</legend><div class="service-choice-grid">${serviceChoices||'<p class="muted">Primero agregá servicios al catálogo.</p>'}</div><small id="appointment-service-summary" class="muted">${currentServiceIds.length} servicio${currentServiceIds.length===1?'':'s'} · ${initialDuration} min</small></fieldset>${formField('Fecha','fecha',item.fecha||state.agendaDate,'date',{required:true})}${formField('Hora','hora',timePY(item.hora)||'09:00','time',{required:true})}<label class="field">Precio total (Gs.)<input id="appointment-total-price" name="precio_gs" type="number" value="${initialPrice||0}" readonly></label>${selectField('Empleada','empleada_id',employeeOptions(),item.empleada_id||'',false)}${selectField('Estado','estado',statusOptions,item.estado||'pendiente')}${formField('Notas','notas',item.notas||'','textarea',{wide:true,maxlength:1000})}</form>`, edit ? 'Guardar cambios' : 'Agendar turno');
  const form = $('#modal-body form');
  const updateServiceTotal=()=>{
    const selected=[...form.querySelectorAll('input[name="servicio_ids"]:checked')];
    const price=selected.reduce((sum,input)=>sum+Number(input.dataset.price||0),0);
    const duration=selected.reduce((sum,input)=>sum+Number(input.dataset.duration||60),0);
    form.elements.precio_gs.value=price;
    $('#appointment-service-summary').textContent=`${selected.length} servicio${selected.length===1?'':'s'} · ${duration} min`;
  };
  form.querySelectorAll('input[name="servicio_ids"]').forEach(input=>input.addEventListener('change',updateServiceTotal));
  modalSubmit(async form => {
    const r = formObject(form), serviceIds=[...form.querySelectorAll('input[name="servicio_ids"]:checked')].map(input=>input.value);
    if(!serviceIds.length) throw new Error('Elegí al menos un servicio para el turno.');
    const selected=offeredServices.filter(service=>serviceIds.includes(service.id));
    const payload = {
        clienta_id: r.clienta_id || null,
        servicio_ids: serviceIds,
        servicio_id: serviceIds[0],
        fecha: r.fecha,
        hora: r.hora,
        precio_gs: Number(r.precio_gs),
        duracion_min: selected.reduce((sum,service)=>sum+Number(service.duracion_min||60),0),
        empleada_id: r.empleada_id || null,
        estado: r.estado,
        notas: r.notas?.trim() || null
      };
    const overlap=turnOverlap(payload,edit?item.id:null), force=overlap?confirm(`Este horario se superpone con ${clientById(overlap.clienta_id)?.nombre||'otro turno'}. ¿Guardar igual?`):false;
    if(overlap&&!force) return;
    const {data:turnoId,error}=await supabase.rpc('guardar_turno_multiple',{p_turno_id:edit?item.id:null,p_clienta_id:payload.clienta_id,p_servicio_ids:payload.servicio_ids,p_fecha:payload.fecha,p_hora:payload.hora,p_empleada_id:payload.empleada_id,p_estado:payload.estado,p_notas:payload.notas,p_permitir_solapamiento:force});
    if (error) throw error;
    toast(edit ? 'Turno actualizado' : 'Turno agregado');
    await refresh();
    if (!edit && payload.estado === 'pendiente') {
      const saved = state.data.turnos.find(turn => turn.id === turnoId);
      const client = clientById(payload.clienta_id);
      return () => showAppointmentConfirmation({
        nombre: client?.nombre || saved?.nombre_publico,
        telefono: client?.telefono || saved?.telefono_publico,
        fecha: payload.fecha,
        hora: payload.hora,
        servicio: selected.map(service=>service.nombre).join(' + ')
      });
    }
  });
}

function paymentForm(item) {
  if (!item) return;
  const c = clientById(item.clienta_id);
  if(item.estado==='hecho'&&state.data.pagos.some(p=>p.turno_id===item.id)) return toast('Este turno ya tiene un pago. Abrí su detalle para ver o anular el cobro.');
  state.quickThanks=false;
  showModal('Cobro rápido', `<form id="quick-payment-form" class="form-grid"><p class="wide muted">${e(c?.nombre||'Clienta')} · ${e(appointmentServiceLabel(item))} · ${datePY(item.fecha)} ${timePY(item.hora)}</p>${formField('Monto recibido (Gs.)','monto_gs',item.precio_cierre_gs??item.precio_gs,'number',{required:true,min:0,max:item.precio_cierre_gs??item.precio_gs})}${formField('Fecha de pago','fecha',dateInput(),'date',{required:true})}<label class="check-field wide"><input name="agradecer" type="checkbox">Enviar agradecimiento por WhatsApp</label><div class="cash-methods wide"><button type="button" class="button primary" data-action="cash-medium" data-cash-medium="Efectivo" data-turn-id="${e(item.id)}">Efectivo</button><button type="button" class="button soft" data-action="cash-medium" data-cash-medium="Transferencia" data-turn-id="${e(item.id)}">Transferencia</button><button type="button" class="button soft" data-action="cash-medium" data-cash-medium="Tigo Money" data-turn-id="${e(item.id)}">Tigo Money</button><button type="button" class="button ghost" data-action="cash-medium" data-cash-medium="Otro" data-turn-id="${e(item.id)}">Otro medio</button></div><div id="other-medium-fields" class="wide" hidden>${formField('Especificá cómo pagó','otro_detalle','','text',{maxlength:60})}<button type="button" class="button primary" data-action="cash-other-confirm" data-cash-medium="Otro" data-turn-id="${e(item.id)}">Registrar pago</button></div><p class="wide muted tiny">Si abonás menos del precio, la diferencia queda como saldo pendiente en la ficha de la clienta.</p></form>`, '');
  $('#quick-payment-form').addEventListener('submit',ev=>ev.preventDefault());
  $('#modal-submit')?.remove(); $('#modal-footer').innerHTML='<button class="button ghost" type="button" data-modal-close>Cancelar</button>';
}

function selectOtherPayment(button) {
  const fields=$('#other-medium-fields');
  if(!fields) return;
  fields.hidden=false;
  fields.querySelector('input[name="otro_detalle"]')?.focus();
}

async function completeQuickPayment(button) {
  if(!requireEditable()) return;
  const form=$('#quick-payment-form'), id=button.dataset.turnId, medio=button.dataset.cashMedium, item=state.data.turnos.find(a=>a.id===id);
  const amount=Number(form.elements.monto_gs.value), price=Number(item?.precio_cierre_gs??item?.precio_gs??0), date=form.elements.fecha.value;
  if(!Number.isInteger(amount)||amount<0||amount>price||(amount===0&&price>0)) return toast('Ingresá un monto mayor que cero y que no supere el precio del servicio.','error');
  const otherDetail=medio==='Otro'?form.elements.otro_detalle.value.trim():'';
  if(medio==='Otro'&&(!otherDetail||otherDetail.length>60)) return toast('Especificá cómo pagó (máximo 60 caracteres).','error');
  const thanks=form.elements.agradecer.checked, client=clientById(item?.clienta_id), thanksPhone=client?.telefono||item?.telefono_publico;
  if(thanks&&!thanksPhone) return toast('Esta clienta no tiene teléfono. Desmarcá el agradecimiento o completá su número.','error');
  setBusy(button,true,'Guardando…');
  const thanksWindow=thanks?window.open('about:blank','_blank'):null;
  try {
    const {error}=await supabase.rpc('cobrar_turno_rapido',{p_turno_id:id,p_monto_gs:amount,p_fecha:date,p_medio:medio,p_otro_detalle:otherDetail||null});
    if(error) throw error;
    $('#modal').close();
    toast(amount<price?`Pago parcial de ${money(amount)} registrado; queda ${money(price-amount)} pendiente.`:'Cobro registrado; la deuda se actualizó.');
    await refresh(); if(thanks&&thanksWindow) { thanksWindow.location.href=waLink(thanksPhone,thanksMessage(item)); }
  } catch(error) { thanksWindow?.close(); toast(requestError(error),'error'); setBusy(button,false); }
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
      phone = r.telefono.trim(),
      payload = {
        nombre: r.nombre.trim(),
        telefono: phone || null,
        comision_pct: Number(r.comision_pct),
        activa: form.elements.activa.checked
      };
    if (!payload.nombre) return toast('Ingresá el nombre de la empleada.', 'error');
    if (phone && !validPhone(phone)) return toast('Ingresá un teléfono válido (entre 7 y 15 dígitos).', 'error');
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
    if (MUTATING_ACTIONS.has(action) && !requireEditable()) return;
    if (action === 'onboarding-open') return openOnboarding(Number(b.dataset.step));
    if (action === 'check-onboarding-migration') {
      await refresh();
      if (state.onboardingSchemaMissing) toast('La columna todavía no aparece. Ejecutá supabase/migracion_02.sql en Supabase → SQL Editor y volvé a comprobar.', 'error');
      else if (state.profile?.onboarding_estado === 'pendiente' && !$('#onboarding-dialog').open) openOnboarding();
      else if (!state.onboardingSchemaMissing) toast('La actualización está aplicada; el asistente ya puede guardar su progreso.');
      return;
    }
    if (action === 'retry-load') return showApp({ user: state.client });
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
    if (action === 'done-appointment') return paymentForm(state.data.turnos.find(a => a.id === id));
    if (action === 'cash-medium') return b.dataset.cashMedium==='Otro' ? selectOtherPayment(b) : completeQuickPayment(b);
    if (action === 'cash-other-confirm') return completeQuickPayment(b);
    if (action === 'cancel-appointment') return changeAppointment(id,{estado:'cancelado'}).then(()=>$('#modal').close());
    if (action === 'delete-appointment') return deletePendingAppointment(id);
    if (action === 'appointment-details') return appointmentDetails(id);
    if (action === 'quick-search-open') return openGlobalSearch();
    if (action === 'quick-search-close') return $('#global-search-dialog').close();
    if (action === 'keyboard-help') { showModal('Atajos de teclado','<ul><li><kbd>n</kbd> Nuevo turno</li><li><kbd>/</kbd> o <kbd>Ctrl+K</kbd> Búsqueda global</li><li><kbd>?</kbd> Ver esta ayuda</li></ul>','Cerrar'); return; }
    if (action === 'global-search-result') return openSearchResult(b.dataset.kind, id);
    if (action === 'refresh-cash') return loadCashClose(state.cashDate,true);
    if (action === 'cash-print') return window.print();
    if (action === 'cash-whatsapp') return shareCashClose();
    if (action === 'fab-toggle') { const open=$('#quick-actions').classList.toggle('open'); b.setAttribute('aria-expanded',String(open)); return; }
    if (action === 'fab-appointment') { $('#quick-actions').classList.remove('open'); return appointmentForm(); }
    if (action === 'fab-client') { $('#quick-actions').classList.remove('open'); return newClientForm(); }
    if (action === 'fab-expense') { $('#quick-actions').classList.remove('open'); return expenseForm(); }
    if (action === 'mark-thanks') return markThanksSent(id);
    if (action === 'send-thanks') return sendThanks(id);
    if (action === 'undo-payment') return undoPayment(id);
    if (action === 'pay-appointment') return paymentForm(state.data.turnos.find(a => a.id === id));
    if (action === 'new-expense') return expenseForm();
    if (action === 'new-product') return productForm();
    if (action === 'edit-product') return productForm(state.data.productos.find(a => a.id === id));
    if (action === 'new-employee') return employeeForm();
    if (action === 'edit-employee') return employeeForm(state.data.empleadas.find(a => a.id === id));
    if (action === 'employee-commission') return showCommission(id);
    if (action === 'delete-row') return deleteRow(b.dataset.table, id);
    if (action === 'agenda-today') { state.agendaDate = dateInput(); return applyView(); }
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
    if (action === 'refresh-booking-requests') {
      setBusy(b, true, 'Actualizando…');
      try {
        const fresh = await loadTables(['solicitudes_reserva'], { strictTables: ['solicitudes_reserva'] });
        state.data.solicitudes_reserva = fresh.solicitudes_reserva || [];
        applyView();
        toast('Solicitudes actualizadas');
      } finally {
        setBusy(b, false);
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
  if (!requireEditable()) return;
  const {
    error
  } = await supabase.from('turnos').update(payload).eq('id', id);
  if (error) throw error;
  toast('Turno actualizado');
  await refresh();
}
async function resolveRequest(id, accept) {
  if (!requireEditable()) return;
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
  if (accept) {
    const saved = state.data.turnos.find(turn => turn.id === data?.id);
    showAppointmentConfirmation({
      nombre: data?.nombre || saved?.nombre_publico,
      telefono: data?.telefono || saved?.telefono_publico,
      fecha: data?.fecha || saved?.fecha,
      hora: data?.hora || saved?.hora,
      servicio: appointmentServiceLabel(saved)
    });
  }
}
async function deleteRow(table, id) {
  if (!requireEditable()) return;
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
  const history = visits.map(a => {
    const due=outstandingTurnDebt(a);
    return `<div class="list-row ${due?'turn-has-debt':''}"><div class="list-row-main"><button class="text-button" data-action="appointment-details" data-id="${e(a.id)}"><strong>${datePY(a.fecha)} · ${e(timePY(a.hora))} · ${e(appointmentServiceLabel(a))}</strong></button><small>${e(a.estado)} · ${money(a.precio_cierre_gs??a.precio_gs)}${due?` · Saldo pendiente: ${money(due)}`:''} · ${e(a.notas||'')}</small></div>${callLink(c.telefono)}<button class="small-button" data-action="appointment-details" data-id="${e(a.id)}">Detalle</button></div>`;
  }).join('') || empty('Sin historial', 'Los turnos de esta clienta aparecerán acá.');
  const photoHTML = photos.map(p => signed[p.id] ? `<div class="photo-tile"><a href="${e(signed[p.id])}" target="_blank" rel="noopener"><img src="${e(signed[p.id])}" alt="Foto ${e(p.tipo)}"><small>${e(p.tipo)}</small></a><button class="photo-delete" data-action="delete-row" data-table="fotos_clienta" data-id="${e(p.id)}" aria-label="Eliminar foto">×</button></div>` : '').join('');
  const paymentHistory = payments.map(p => `<div class="list-row"><div class="list-row-main"><strong>${datePY(p.fecha)} · ${money(p.monto_gs)}</strong><small>${e(p.medio)} · ${e(p.nota||'Abono')}</small></div></div>`).join('') || '<p class="muted tiny">Todavía no hay pagos registrados.</p>';
  const loyalty = Number(c.visitas || 0),
    goal = Number(state.profile.visitas_premio || 10),
    award = loyalty > 0 && loyalty % goal === 0;
  const paymentButtons = visits.filter(a => a.estado !== 'cancelado').map(a => `<div class="list-row"><div class="list-row-main"><strong>${datePY(a.fecha)} · ${e(appointmentServiceLabel(a))}</strong><small>${e(a.estado)} · ${money(a.precio_gs)}</small></div><button class="small-button primary" data-action="pay-appointment" data-id="${e(a.id)}">Registrar abono</button></div>`).join('') || '<p class="muted tiny">No hay turnos para asociar un pago.</p>';
  const body = `<div class="profile-layout">
    <section class="profile-side panel"><div class="avatar">${e(c.nombre.slice(0,1).toUpperCase())}</div><div><h3>${e(c.nombre)}</h3><p class="muted tiny">${e(c.telefono||'Sin teléfono')}<br>${e(c.email||'')}</p><div class="table-actions">${callLink(c.telefono)}${c.telefono?`<a class="small-button primary" href="${waLink(c.telefono,'Hola '+c.nombre)}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div><strong>${money(c.deuda_gs)}</strong><small class="muted"> saldo pendiente</small></div></section>
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
}
async function handlePhotoUpload(ev) {
  if (!requireEditable()) {
    ev.target.value = '';
    return;
  }
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
  if (!requireEditable()) return;
  const inputs = $$('[data-template]'),
    rows = inputs.map(input => ({
      clave: input.dataset.template,
      nombre: TEMPLATES.find(t => t[0] === input.dataset.template)?.[1] || input.dataset.template,
      contenido: input.value.trim()
    }));
  if (rows.some(row => !row.contenido || row.contenido.length > 1500)) return toast('Cada mensaje debe tener entre 1 y 1500 caracteres.', 'error');
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
  if (!requireEditable()) return;
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
  const phone = String(fd.get('telefono')).trim();
  if (phone && !validPhone(phone)) return toast('Ingresá un teléfono válido (entre 7 y 15 dígitos).', 'error');
  const salon = String(fd.get('nombre')).trim(), reviewUrl=String(fd.get('google_review_url')||'').trim();
  const slug = String(fd.get('slug') || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  if (reviewUrl) { try { const parsed=new URL(reviewUrl); if(parsed.protocol!=='https:'||reviewUrl.length>500) throw new Error(); } catch { return toast('El link de reseñas debe ser una URL HTTPS válida.','error'); } }
  if (!salon) return toast('Ingresá el nombre del salón.', 'error');
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return toast('Ingresá un slug válido, por ejemplo: adw.', 'error');
  if (!validSchedule(horarios)) return toast('Revisá el horario: elegí al menos un día y usá horas válidas de inicio y cierre.', 'error');
  const payload = {
    nombre: salon,
    slug,
    telefono: phone || null,
    direccion: String(fd.get('direccion')).trim() || null,
    color_principal: color,
    visitas_premio: Number(fd.get('visitas_premio')) || 10,
    premio_descripcion: String(fd.get('premio_descripcion')).trim(),
    ...(!state.googleReviewSchemaMissing ? { google_review_url: reviewUrl || null } : {}),
    horario_texto: String(fd.get('horario_texto')).trim() || null,
    horarios
  };
  const {
    error
  } = await supabase.from('perfiles').update(payload).eq('user_id', state.client.id);
  if (error) {
    toast(error.code === '23505' ? 'Ese slug ya está en uso. Elegí otro.' : requestError(error), 'error');
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
  toast(state.googleReviewSchemaMissing ? 'Perfil guardado. Ejecutá supabase/migracion_05.sql para habilitar el link de reseñas.' : 'Perfil y link de reservas guardados');
  await refresh();
}
async function backupJSON() {
  const payload = {
    respaldo: 'AgendaPorã',
    exportado_en: new Date().toISOString(),
    salon: salonName(),
    perfil: state.profile,
    tablas: state.data
  };
  downloadFile(`agendapora-${salonSlug()}-${dateInput()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Respaldo JSON descargado');
}

function backupCSV() {
  for (const tableName of ['clientas', 'turnos', 'turno_servicios', 'pagos', 'gastos']) {
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
      const sourceRows = parsed.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))).filter(r => r.nombre?.trim());
      const records = sourceRows.map((r, index) => {
        const phone = (r.telefono || '').trim(), email = (r.email || '').trim(), birthday = validISODate(r.fecha_nacimiento);
        if (r.fecha_nacimiento?.trim() && !birthday) throw new Error(`La fecha de cumpleaños de la fila ${index + 2} no es válida. Usá dd/mm/aaaa o aaaa-mm-dd.`);
        if (phone && !validPhone(phone)) throw new Error(`El teléfono de la fila ${index + 2} no es válido.`);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`El correo de la fila ${index + 2} no es válido.`);
        return {
          nombre: r.nombre.trim().slice(0, 100),
          telefono: phone.slice(0, 24) || null,
          email: email.slice(0, 160) || null,
          fecha_nacimiento: birthday,
          notas: (r.notas || '').slice(0, 2000) || null
        };
      });
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
  const raw = String(value || '').trim();
  let year, month, day;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const paraguay = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso) [year, month, day] = iso.slice(1).map(Number);
  else if (paraguay) [day, month, year] = paraguay.slice(1).map(Number);
  else return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
async function refresh() {
  const migrationWasMissing = state.onboardingSchemaMissing;
  await getProfile();
  await loadData();
  await completeOnboardingIfReady();
  applyView();
  if (migrationWasMissing && !state.onboardingSchemaMissing && state.profile?.onboarding_estado === 'pendiente') openOnboarding();
}

async function showBlocked() {
  state.locked = true;
  $('#login-screen').classList.add('hidden');
  $('#password-screen').classList.add('hidden');
  $('#app-shell').classList.add('hidden');
  $('#blocked-screen').classList.remove('hidden');
  $('#view-root').replaceChildren();
  $('#side-nav').replaceChildren();
  $('#bottom-nav').replaceChildren();
  for (const table of TABLES) {
    if (!['clientas','turnos','pagos','gastos'].includes(table)) state.data[table] = [];
  }
  state.detailsClient = null;
  if ($('#modal').open) $('#modal').close();
  if ($('#onboarding-dialog').open) $('#onboarding-dialog').close();
  if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  const profile = state.profile;
  $('#blocked-salon-name').textContent = salonName();
  $('#blocked-message').textContent = profile?.activo === false
    ? 'Cuenta desactivada. Contactá a soporte'
    : `Tu suscripción venció el ${datePY(profile?.vence_el)}`;
  const expiry = profile?.vence_el ? datePY(profile.vence_el) : 'sin fecha registrada';
  $('#blocked-renew').href = waLink(SUPPORT_WHATSAPP,
    `Hola, quiero renovar AgendaPorã para el salón ${salonName()}. Fecha de vencimiento: ${expiry}.`);
  if (!state.exportLoaded) {
    try { await loadLockedExportData(); }
    catch { state.exportLoaded = false; }
  }
}

async function exportBlockedData() {
  try {
    await loadLockedExportData();
    const tableNames = ['clientas','turnos','pagos','gastos'];
    const backup = Object.fromEntries(tableNames.map(name => [name, state.data[name] || []]));
    const records = tableNames.flatMap(tabla => backup[tabla].map(row => ({ tabla, ...row })));
    const columns = ['tabla', ...new Set(records.flatMap(row => Object.keys(row).filter(key => key !== 'tabla')))];
    const csvValue = value => value && typeof value === 'object' ? JSON.stringify(value) : value;
    const csv = [columns.map(csvEscape).join(','), ...records.map(row => columns.map(key => csvEscape(csvValue(row[key]))).join(','))].join('\r\n');
    const date = dateInput();
    downloadFile(`agendapora-${salonSlug()}-${date}.csv`, csv, 'text/csv;charset=utf-8');
    downloadFile(`agendapora-${salonSlug()}-${date}.json`, JSON.stringify({ respaldo: 'AgendaPorã', exportado_en: new Date().toISOString(), salon: salonName(), vence_el: state.profile?.vence_el || null, tablas: backup }, null, 2), 'application/json');
    toast('Se descargaron el CSV y el JSON de clientas, turnos, pagos y gastos.');
  } catch (error) {
    toast(`No se pudieron exportar los datos: ${requestError(error)}`, 'error');
  }
}

function handleAppNavigation() {
  if (state.locked || (state.profile && !editable())) {
    if (state.profile && !editable() && !state.locked) state.exportLoaded = false;
    showBlocked();
    return;
  }
  applyView();
}

async function syncAccountStatus() {
  if (!state.client) return;
  const wasLocked = state.locked;
  const wasEditable = editable();
  const onboardingMigrationWasMissing = state.onboardingSchemaMissing;
  try {
    await getProfile();
    if (!editable()) {
      if (!wasLocked) state.exportLoaded = false;
      await showBlocked();
    } else if (wasLocked) {
      state.exportLoaded = false;
      await loadData();
      state.locked = false;
      $('#blocked-screen').classList.add('hidden');
      $('#app-shell').classList.remove('hidden');
      await completeOnboardingIfReady();
      applyView();
      if (state.profile?.onboarding_estado === 'pendiente') openOnboarding();
    } else if (wasEditable !== editable()) applyView();
    else if (onboardingMigrationWasMissing && !state.onboardingSchemaMissing) {
      await loadData();
      await completeOnboardingIfReady();
      applyView();
      if (state.profile?.onboarding_estado === 'pendiente') openOnboarding();
    }
    else applyReadOnlyControls();
  } catch (error) {
    if (navigator.onLine) toast(requestError(error), 'error');
  }
}

async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    toast(requestError(error), 'error');
  }
}
async function showApp(session) {
  if (passwordRecoveryActive) return;
  state.client = session.user;
  appSessionUserId = session.user.id;
  state.locked = false;
  state.exportLoaded = false;
  state.exportLoading = null;
  state.profile = null;
  state.data = Object.fromEntries(TABLES.map(table => [table, []]));
  state.cashData=null; state.cashError=''; state.cashLoading=false; state.cashLoadId++;
  $('#login-screen').classList.add('hidden');
  $('#password-screen').classList.add('hidden');
  $('#blocked-screen').classList.add('hidden');
  $('#app-shell').classList.add('hidden');
  try {
    await getProfile();
    if (!editable()) {
      await showBlocked();
      return;
    }
    $('#app-shell').classList.remove('hidden');
    $('#view-root').innerHTML = '<section class="panel loading-panel" role="status">Cargando los datos de tu salón…</section>';
    await loadData();
    await completeOnboardingIfReady();
    applyView();
    if (state.profile?.onboarding_estado === 'pendiente') openOnboarding();
  } catch (error) {
    $('#app-shell').classList.remove('hidden');
    $('#view-root').innerHTML = `<section class="panel" role="alert"><h2>No se pudieron cargar los datos</h2><p class="muted">${e(requestError(error))} Tu sesión sigue abierta; revisá la conexión e intentá de nuevo.</p><button class="button primary" data-action="retry-load">Reintentar</button></section>`;
  }
}

function startAppSession(session) {
  if (!session?.user || passwordRecoveryActive) return;
  if (state.client?.id === session.user.id && appSessionUserId === session.user.id) return;
  if (pendingAuthUserId === session.user.id) return;
  pendingAuthUserId = session.user.id;
  queueMicrotask(() => {
    showApp(session).finally(() => {
      if (pendingAuthUserId === session.user.id) pendingAuthUserId = null;
    });
  });
}

function clearAuthRecoveryUrl() {
  if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}

function showPasswordRequest() {
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.add('hidden');
  $('#blocked-screen').classList.add('hidden');
  $('#password-screen').classList.remove('hidden');
  $('#password-request-panel').classList.remove('hidden');
  $('#password-update-panel').classList.add('hidden');
  $('#password-screen-title').textContent = 'Recuperar contraseña';
  $('#recovery-email').value = $('#login-email').value.trim();
  $('#password-request-message').textContent = '';
  $('#recovery-email').focus();
}

function showPasswordRecovery(session) {
  passwordRecoveryActive = true;
  state.passwordRecoverySession = session || state.passwordRecoverySession;
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.add('hidden');
  $('#blocked-screen').classList.add('hidden');
  $('#password-screen').classList.remove('hidden');
  $('#password-request-panel').classList.add('hidden');
  $('#password-update-panel').classList.remove('hidden');
  $('#password-screen-title').textContent = 'Elegí una contraseña nueva';
  $('#password-recovery-message').textContent = '';
  clearAuthRecoveryUrl();
  $('#recovery-password').focus();
}

async function submitPasswordRecovery(ev) {
  ev.preventDefault();
  const form = ev.currentTarget, password = $('#recovery-password').value,
    confirmation = $('#recovery-password-confirm').value, button = form.querySelector('button[type="submit"]'),
    message = $('#password-recovery-message');
  message.textContent = '';
  message.classList.remove('form-success');
  if (password.length < 8) return message.textContent = 'La contraseña debe tener al menos 8 caracteres.';
  if (password !== confirmation) return message.textContent = 'Las contraseñas no coinciden.';
  if (!state.passwordRecoverySession && !passwordRecoveryActive) return message.textContent = 'Este enlace ya no está activo. Solicitá uno nuevo desde el inicio de sesión.';
  setBusy(button, true, 'Guardando…');
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    const session = state.passwordRecoverySession;
    passwordRecoveryActive = false;
    state.passwordRecoverySession = null;
    clearAuthRecoveryUrl();
    $('#password-screen').classList.add('hidden');
    toast('Contraseña actualizada. Ya podés continuar.', 'success');
    if (session?.user) await showApp(session);
    else {
      $('#login-screen').classList.remove('hidden');
      $('#login-error').textContent = 'Contraseña actualizada. Ingresá con tu nueva contraseña.';
    }
  } catch (error) {
    message.textContent = requestError(error);
  } finally {
    setBusy(button, false);
  }
}

async function requestPasswordReset(ev) {
  ev.preventDefault();
  const email = $('#recovery-email').value.trim(), button = ev.currentTarget.querySelector('button[type="submit"]'),
    message = $('#password-request-message');
  message.textContent = '';
  message.classList.remove('form-success');
  setBusy(button, true, 'Enviando…');
  try {
    readyClient();
    const redirectTo = new URL('./index.html', location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    message.classList.add('form-success');
    message.textContent = 'Si hay una cuenta asociada a ese correo, recibirás un enlace para recuperar tu contraseña. Revisá también correo no deseado.';
  } catch {
    message.textContent = 'No pudimos procesar la solicitud. Revisá tu conexión e intentá de nuevo.';
  } finally {
    setBusy(button, false);
  }
}

async function init() {
  syncThemeFromStorage();
  setTheme(localStorage.getItem('agendapora-theme') || 'light');
  $('#support-login').href = waLink(SUPPORT_WHATSAPP, 'Hola, necesito ayuda con AgendaPorã.');
  $('#forgot-password-link').addEventListener('click', ev => { ev.preventDefault(); showPasswordRequest(); });
  $('#password-back-login').addEventListener('click', ev => {
    ev.preventDefault();
    passwordRecoveryActive = false;
    state.passwordRecoverySession = null;
    clearAuthRecoveryUrl();
    $('#password-screen').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#login-email').focus();
  });
  $('#password-request-form').addEventListener('submit', requestPasswordReset);
  $('#password-recovery-form').addEventListener('submit', ev => submitPasswordRecovery(ev).catch(error => toast(requestError(error), 'error')));
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
  $('#logout-button-top').addEventListener('click', signOut);
  $('#mobile-logout-button').addEventListener('click', signOut);
  $('#blocked-logout').addEventListener('click', signOut);
  $('#blocked-export').addEventListener('click', exportBlockedData);
  $('#onboarding-next').addEventListener('click', () => saveOnboardingStep().catch(error => toast(requestError(error), 'error')));
  $('#onboarding-back').addEventListener('click', () => {
    if (state.onboardingStep > 0) state.onboardingStep -= 1;
    renderOnboardingStep();
  });
  $('#onboarding-skip').addEventListener('click', skipOnboarding);
  $('#onboarding-dialog').addEventListener('click', ev => {
    if (ev.target.closest('[data-onboarding-skip]')) skipOnboarding();
  });
  $('#onboarding-dialog').addEventListener('cancel', ev => {
    ev.preventDefault();
    skipOnboarding();
  });
  $('#theme-toggle').addEventListener('click', () => setTheme(document.body.classList.contains('dark') ? 'light' : 'dark'));
  $('#mobile-theme-toggle').addEventListener('click', () => setTheme(document.body.classList.contains('dark') ? 'light' : 'dark'));
  $('#mobile-menu').addEventListener('click', () => {
    if (!state.locked) {
      $('#mobile-menu').setAttribute('aria-expanded', 'true');
      $('#mobile-menu-dialog').showModal();
    }
  });
  $('#mobile-menu-dialog').addEventListener('click', ev => {
    if (ev.target === ev.currentTarget || ev.target.closest('[data-mobile-menu-close],[data-nav],#mobile-public-booking-link,#mobile-theme-toggle,#mobile-logout-button')) ev.currentTarget.close();
  });
  $('#mobile-menu-dialog').addEventListener('close', () => $('#mobile-menu').setAttribute('aria-expanded', 'false'));
  window.addEventListener('hashchange', handleAppNavigation);
  window.addEventListener('popstate', handleAppNavigation);
  window.addEventListener('pageshow', () => {
    if (state.client) syncAccountStatus();
  });
  $('#view-root').addEventListener('click', ev => {
    const pageButton = ev.target.closest('[data-table-page]');
    if (pageButton) {
      changeTablePage(Number(pageButton.dataset.tablePage), Number(pageButton.dataset.pageDelta));
      return;
    }
    if (ev.target.closest('[data-action]')) {
      const action=ev.target.closest('[data-action]');
      if(action.dataset.dragId&&Date.now()<suppressCalendarClickUntil) return;
      handleAction({currentTarget:action});
    }
    else if(ev.target.closest('.cal-day-grid')) {
      const grid=ev.target.closest('.cal-day-grid'), rect=grid.getBoundingClientRect(), start=Number.parseInt(getComputedStyle(grid).getPropertyValue('--calendar-start'))||480;
      const at=timeAtMinutes(start+(ev.clientY-rect.top+grid.scrollTop)/64*60);
      appointmentForm({fecha:grid.dataset.calendarDate,hora:at});
    }
  });
  $('#view-root').addEventListener('pointerdown',onCalendarPointerDown);
  document.addEventListener('pointermove',calendarPointerMove);
  document.addEventListener('pointerup',calendarPointerUp);
  $('#global-search-input').addEventListener('input',ev=>renderGlobalSearch(ev.target.value));
  $('#global-search-input').addEventListener('keydown',ev=>{
    if(ev.key==='ArrowDown'){ev.preventDefault();moveSearchActive(1)}
    else if(ev.key==='ArrowUp'){ev.preventDefault();moveSearchActive(-1)}
    else if(ev.key==='Enter'&&state.searchResults[state.searchActive]){ev.preventDefault();const r=state.searchResults[state.searchActive];openSearchResult(r.kind,r.item.id)}
    else if(ev.key==='Escape') $('#global-search-dialog').close();
  });
  document.addEventListener('keydown',ev=>{
    if(ev.key==='Escape') { $('#quick-actions').classList.remove('open'); $('[data-action="fab-toggle"]')?.setAttribute('aria-expanded','false'); }
    if(!state.client||state.locked) return;
    if(ev.target.matches('input,textarea,select,[contenteditable="true"]')||$('#modal').open||$('#onboarding-dialog').open||$('#global-search-dialog').open) return;
    if(ev.key==='/'||(ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();openGlobalSearch()}
    else if(ev.key.toLowerCase()==='n'&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey){ev.preventDefault();appointmentForm()}
    else if(ev.key==='?') showModal('Atajos de teclado','<ul><li><kbd>n</kbd> Nuevo turno</li><li><kbd>/</kbd> o <kbd>Ctrl+K</kbd> Búsqueda global</li><li><kbd>?</kbd> Ver esta ayuda</li></ul>','Cerrar');
  });
  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-modal-close]')) ev.target.closest('dialog')?.close();
    const globalAction=ev.target.closest('[data-action]');
    if(globalAction&&!globalAction.closest('#view-root')) handleAction({currentTarget:globalAction});
  });
  $('#modal').addEventListener('close',()=>$('#quick-actions').classList.remove('open'));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (serviceWorkerReloading) return;
      serviceWorkerReloading = true;
      const reloadKey = 'agendapora-sw-reload-pending';
      if (sessionStorage.getItem(reloadKey) === '1') {
        sessionStorage.removeItem(reloadKey);
        return;
      }
      sessionStorage.setItem(reloadKey, '1');
      location.reload();
    });
    if (sessionStorage.getItem('agendapora-sw-reload-pending') === '1') {
      sessionStorage.removeItem('agendapora-sw-reload-pending');
    }
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
  try {
    readyClient();
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        showPasswordRecovery(session);
        return;
      }
      if (event === 'TOKEN_REFRESHED') return;
      if (passwordRecoveryActive && event !== 'SIGNED_OUT') return;
      if (session && event === 'INITIAL_SESSION') {
        if (!state.client) startAppSession(session);
      } else if (session && event === 'SIGNED_IN') {
        startAppSession(session);
      } else if (!session && event === 'SIGNED_OUT') {
        state.client = null;
        appSessionUserId = null;
        pendingAuthUserId = null;
        state.profile = null;
        state.locked = false;
        state.exportLoaded = false;
        state.exportLoading = null;
        state.data = Object.fromEntries(TABLES.map(table => [table, []]));
        state.cashData=null; state.cashError=''; state.cashLoading=false; state.cashLoadId++;
        state.passwordRecoverySession = null;
        passwordRecoveryActive = false;
        state.onboardingSchemaMissing = false;
        if ($('#onboarding-dialog').open) $('#onboarding-dialog').close();
        $('#app-shell').classList.add('hidden');
        $('#blocked-screen').classList.add('hidden');
        $('#password-screen').classList.add('hidden');
        $('#login-screen').classList.remove('hidden');
      }
    });
    setInterval(syncAccountStatus, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncAccountStatus();
    });
    window.addEventListener('online', syncAccountStatus);
  } catch (error) {
    $('#login-error').textContent = requestError(error);
  }
}
init();
