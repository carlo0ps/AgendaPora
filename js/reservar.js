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
  dateInput,
  toast,
  setBusy,
  requestError,
  applyBrandColor,
  noStoreFetch,
  applyTheme,
  syncThemeFromStorage
} from './utils.js';

let supabase, salonSlug = new URLSearchParams(location.search).get('salon'),
  salon = null,
  slotsRequest = 0,
  availableSlots = [];

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
function renderServiceSummary() {
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
  const services = $('#booking-services');
  services.innerHTML = salon.servicios.map(s=>`<label class="booking-service-option"><input type="checkbox" value="${e(s.id)}"><span><strong>${e(s.nombre)}</strong><small>${money(s.precio_gs)} · ${Number(s.duracion_min)} min</small></span></label>`).join('');
  if (!salon.servicios.length) throw new Error('El salón todavía no publicó servicios disponibles.');
  renderServiceSummary();
  $('#booking-date').min = dateInput();
  $('#booking-date').value = dateInput();
  $('#booking-form').classList.remove('hidden');
}
async function loadSlots(silent = false) {
  const date = $('#booking-date').value,
    services = selectedServiceIds(),
    servicesKey = services.join(','),
    select = $('#booking-time'),
    previousTime = select.value;
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
    select.innerHTML = availableSlots.length ? `<option value="">Elegí un horario</option>${availableSlots.map(time=>`<option value="${e(time)}">${e(time)}</option>`).join('')}` : '<option value="">No hay horarios libres</option>';
    if (availableSlots.includes(previousTime)) select.value = previousTime;
    select.disabled = false;
    if (!availableSlots.length && !silent) toast('No hay horarios libres para ese día. Elegí otra fecha.', 'info');
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
  if (!/^[+0-9() .-]{7,24}$/.test(phone)) {
    $('#booking-error').textContent = 'Revisá el número de teléfono.';
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
      p_website: $('#booking-website').value
    });
    if (error) throw error;
    $('#booking-form').classList.add('hidden');
    $('#booking-intro').classList.add('hidden');
    $('#booking-success').classList.remove('hidden');
  } catch (error) {
    $('#booking-error').textContent = requestError(error);
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
    $('#booking-services').addEventListener('change', () => {
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
