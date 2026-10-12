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
  salon = null;

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
  const select = $('#booking-service');
  select.innerHTML = `<option value="">Elegí un servicio</option>${salon.servicios.map(s=>`<option value="${e(s.id)}">${e(s.nombre)} · ${money(s.precio_gs)} · ${Number(s.duracion_min)} min</option>`).join('')}`;
  if (!salon.servicios.length) throw new Error('El salón todavía no publicó servicios disponibles.');
  $('#booking-date').min = dateInput();
  $('#booking-date').value = dateInput();
  $('#booking-form').classList.remove('hidden');
}
async function loadSlots() {
  const date = $('#booking-date').value,
    service = $('#booking-service').value,
    select = $('#booking-time');
  select.innerHTML = '<option value="">Cargando horarios…</option>';
  if (!date || !service) {
    select.innerHTML = '<option value="">Elegí servicio y día</option>';
    return;
  }
  try {
    const {
      data,
      error
    } = await supabase.rpc('public_slots', {
      p_slug: salonSlug,
      p_fecha: date,
      p_servicio_id: service
    });
    if (error) throw error;
    const options = (data || []).map(row => row.hora || row).map(value => String(value).slice(0, 5));
    select.innerHTML = options.length ? `<option value="">Elegí un horario</option>${options.map(time=>`<option value="${e(time)}">${e(time)}</option>`).join('')}` : '<option value="">No hay horarios libres</option>';
    if (!options.length) toast('No hay horarios para ese día. Elegí otra fecha.', 'info');
  } catch (error) {
    select.innerHTML = '<option value="">No se pudieron cargar horarios</option>';
    toast(requestError(error), 'error');
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
  setBusy(b, true, 'Enviando…');
  try {
    const {
      error
    } = await supabase.rpc('public_request_booking', {
      p_slug: salonSlug,
      p_servicio_id: $('#booking-service').value,
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
    $('#booking-service').addEventListener('change', loadSlots);
    $('#booking-date').addEventListener('change', loadSlots);
    $('#booking-form').addEventListener('submit', submit);
    await loadSlots();
  } catch (error) {
    $('#booking-intro').textContent = requestError(error);
    $('#booking-form').classList.add('hidden');
  }
}
init();
