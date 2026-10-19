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
  toast,
  setBusy,
  requestError,
  applyBrandColor,
  noStoreFetch,
  applyTheme,
  syncThemeFromStorage
} from './utils.js';

const bookingPathMatch = location.pathname.match(/\/reservar\/([^/]+)\/?$/i);
let pathSlug = '';
try { pathSlug = bookingPathMatch ? decodeURIComponent(bookingPathMatch[1]) : ''; } catch { pathSlug = ''; }
let supabase, salonSlug = pathSlug || new URLSearchParams(location.search).get('salon'),
  salon = null,
  slotsRequest = 0,
  availableSlots = [];

function paraguayDateInput(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function shiftISODate(value, days) {
  const [year,month,day]=value.split('-').map(Number), date=new Date(Date.UTC(year,month-1,day+days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
function bookingErrorMessage(error) {
  const raw=String(error?.message||error?.details||'').toLocaleLowerCase('es');
  if (raw.includes('ya fue tomado')||raw.includes('ya no está disponible')) return 'Ese horario ya fue tomado, elegí otro.';
  if (raw.includes('no abre ese día')) return 'El salón no abre ese día.';
  if (raw.includes('no entra antes del cierre')) return 'Ese servicio no entra antes del cierre.';
  if (raw.includes('pausa')) return 'Ese horario coincide con la pausa del salón.';
  if (raw.includes('anticipación')||raw.includes('anticipacion')) return 'Elegí un horario con más anticipación.';
  if (raw.includes('límite de reservas')) return 'La fecha supera el límite de reservas del salón.';
  return requestError(error);
}

function config() {
  if (SUPABASE_URL === 'SUPABASE_URL' || SUPABASE_ANON_KEY === 'SUPABASE_ANON_KEY') throw new Error('El salón todavía no publicó su agenda.');
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: { fetch: noStoreFetch }
  });
}
function selectedServiceIds() {
  return [...document.querySelectorAll('#booking-services input[type="checkbox"]:checked')].map(input => input.value);
}
function ensureBookingServicePicker() {
  let picker = $('#booking-services');
  if (picker) return picker;

  // Durante un deploy estático, HTML y JS pueden actualizarse en momentos distintos.
  // Convierte el selector antiguo para que el JS nuevo también funcione con ese HTML.
  const oldSelect = $('#booking-service');
  const host = document.createElement('fieldset');
  host.className = 'field wide booking-service-field';
  const legend = document.createElement('legend');
  legend.append('Servicios ');
  const hint = document.createElement('span');
  hint.className = 'muted';
  hint.textContent = '(podés elegir varios)';
  legend.append(hint);
  picker = document.createElement('div');
  picker.id = 'booking-services';
  picker.className = 'booking-services';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Elegí uno o varios servicios');
  const summary = document.createElement('p');
  summary.id = 'booking-services-summary';
  summary.className = 'booking-services-summary';
  summary.setAttribute('aria-live', 'polite');
  host.append(legend, picker, summary);
  if (oldSelect) oldSelect.closest('.field')?.replaceWith(host);
  else $('#booking-form')?.prepend(host);
  if (!$('#booking-services')) throw new Error('No se encontró el formulario público de reservas. Actualizá la página e intentá de nuevo.');
  return $('#booking-services');
}
function renderServiceSummary() {
  if (!$('#booking-services-summary')) return;
  const selected = selectedServiceIds().map(id => salon.servicios.find(service => service.id === id)).filter(Boolean);
  const price = selected.reduce((sum, service) => sum + Number(service.precio_gs || 0), 0);
  const duration = selected.reduce((sum, service) => sum + Number(service.duracion_min || 0), 0);
  $('#booking-services-summary').textContent = selected.length
    ? `${selected.length} ${selected.length === 1 ? 'servicio' : 'servicios'} · ${money(price)} · ${duration} min en total`
    : 'Elegí al menos un servicio para ver los horarios disponibles.';
}
async function loadSalon() {
  const {
    data,
    error
  } = await supabase.rpc('public_info', {
    p_slug: salonSlug
  });
  if (error) throw error;
  if (!data) throw new Error('Este salón no está recibiendo reservas en este momento.');
  salon = data;
  document.title = `Reservar · ${salon.nombre}`;
  $('#salon-name').textContent = salon.nombre;
  $('#salon-logo').src = salon.logo_url || 'icons/icon.svg';
  $('#salon-logo').onerror = () => $('#salon-logo').src = 'icons/icon.svg';
  applyBrandColor(salon.color_principal);
  $('#booking-intro').textContent = [salon.direccion, salon.horario_texto].filter(Boolean).join(' · ') || 'Elegí un servicio y un horario que te quede cómodo.';
  const services = ensureBookingServicePicker();
  services.innerHTML = salon.servicios.map(s=>`<label class="booking-service-option"><input type="checkbox" value="${e(s.id)}"><span><strong>${e(s.nombre)}</strong><small>${money(s.precio_gs)} · ${Number(s.duracion_min)} min</small></span></label>`).join('');
  if (!salon.servicios.length) throw new Error('El salón todavía no publicó servicios disponibles.');
  renderServiceSummary();
  const today=paraguayDateInput();
  $('#booking-date').min = today;
  $('#booking-date').max = shiftISODate(today,Number(salon.max_dias_reserva||60));
  $('#booking-date').value = today;
  $('#booking-form').classList.remove('hidden');
}
async function loadSlots(silent = false) {
  const date = $('#booking-date')?.value || '',
    services = selectedServiceIds(),
    servicesKey = services.join(','),
    select = $('#booking-time'),
    previousTime = select?.value || '';
  if (!select || !$('#booking-date')) {
    toast('No se encontró el formulario de horarios. Actualizá la página e intentá de nuevo.', 'error');
    return;
  }
  const requestId = ++slotsRequest;
  availableSlots = [];
  select.disabled = true;
  select.innerHTML = '<option value="">Cargando horarios…</option>';
  if (!date || !services.length) {
    select.innerHTML = '<option value="">Elegí servicio y día</option>';
    select.disabled = false;
    return;
  }
  try {
    const {
      data,
      error
    } = await supabase.rpc('public_slots_multiple', {
      p_slug: salonSlug,
      p_fecha: date,
      p_servicio_ids: services
    });
    if (error) throw error;
    if (requestId !== slotsRequest || date !== $('#booking-date').value || servicesKey !== selectedServiceIds().join(',')) return;
    const options = (data || []).map(row => row.hora || row).map(value => String(value).slice(0, 5));
    availableSlots = [...new Set(options)];
    let emptyMessage='No hay horarios libres para ese día.';
    if (!availableSlots.length) {
      const statusResult=await supabase.rpc('public_booking_status',{p_slug:salonSlug,p_fecha:date,p_servicio_ids:services});
      if (statusResult.error) throw statusResult.error;
      const messages={closed:'El salón no abre ese día.',too_long:'Ese servicio no entra antes del cierre.',lead_time:'No quedan horarios con la anticipación mínima.',date_limit:'La fecha supera el límite de reservas del salón.',busy:'No hay horarios libres para ese día.'};
      emptyMessage=messages[statusResult.data]||emptyMessage;
    }
    if (requestId !== slotsRequest || date !== $('#booking-date').value || servicesKey !== selectedServiceIds().join(',')) return;
    select.innerHTML = availableSlots.length ? `<option value="">Elegí un horario</option>${availableSlots.map(time=>`<option value="${e(time)}">${e(time)}</option>`).join('')}` : `<option value="">${e(emptyMessage)}</option>`;
    if (availableSlots.includes(previousTime)) select.value = previousTime;
    select.disabled = false;
    if (!availableSlots.length && !silent) toast(emptyMessage, 'info');
  } catch (error) {
    if (requestId !== slotsRequest) return;
    select.innerHTML = '<option value="">No se pudieron cargar horarios</option>';
    select.disabled = true;
    if (!silent) toast(requestError(error), 'error');
  }
}
async function submit(ev) {
  ev.preventDefault();
  const form = ev.currentTarget,
    b = ev.submitter;
  $('#booking-error').textContent = '';
  const phone = $('#booking-phone').value.trim();
  const email = $('#booking-email').value.trim().toLowerCase();
  if (!/^[+0-9() .-]{7,24}$/.test(phone)) {
    $('#booking-error').textContent = 'Revisá el número de teléfono.';
    return;
  }
  if (email && (email.length > 160 || !$('#booking-email').validity.valid)) {
    $('#booking-error').textContent = 'Revisá el correo o dejalo vacío.';
    return;
  }
  if ($('#booking-website').value) return;
  const selectedTime = $('#booking-time').value;
  const services = selectedServiceIds();
  if (!services.length) {
    $('#booking-error').textContent = 'Elegí al menos un servicio.';
    return;
  }
  if (!selectedTime || !availableSlots.includes(selectedTime)) {
    $('#booking-error').textContent = 'Ese horario ya no está disponible. Actualizamos la lista; elegí otro horario.';
    await loadSlots();
    return;
  }
  setBusy(b, true, 'Enviando…');
  try {
    const {
      error
    } = await supabase.rpc('public_request_booking_multiple', {
      p_slug: salonSlug,
      p_servicio_ids: services,
      p_fecha: $('#booking-date').value,
      p_hora: $('#booking-time').value,
      p_nombre: $('#booking-client-name').value.trim(),
      p_telefono: phone,
      p_email: email,
      p_website: $('#booking-website').value
    });
    if (error) throw error;
    $('#booking-form').classList.add('hidden');
    $('#booking-intro').classList.add('hidden');
    $('#booking-success').classList.remove('hidden');
  } catch (error) {
    $('#booking-error').textContent = bookingErrorMessage(error);
    await loadSlots();
  } finally {
    setBusy(b, false);
  }
}
async function init() {
  applyTheme(localStorage.getItem('agendapora-theme') || 'light');
  syncThemeFromStorage();
  try {
    if (!salonSlug || salonSlug.length > 80) throw new Error('Falta el enlace del salón. Pedile el link de reservas a tu peluquera.');
    config();
    await loadSalon();
    ensureBookingServicePicker().addEventListener('change', () => {
      renderServiceSummary();
      loadSlots();
    });
    $('#booking-date').addEventListener('change', () => loadSlots());
    $('#booking-form').addEventListener('submit', submit);
    await loadSlots();
    // Las reservas que otra clienta acaba de enviar deben desaparecer también
    // de páginas que ya estaban abiertas. El RPC sigue siendo la validación final.
    window.setInterval(() => {
      if (document.visibilityState === 'visible') loadSlots(true);
    }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadSlots(true);
    });
  } catch (error) {
    $('#booking-intro').textContent = requestError(error);
    $('#booking-form').classList.add('hidden');
  }
}
init();
