-- Disponibilidad coherente para reservas públicas y agenda interna.
-- Ejecutar después de migracion_15.sql. Idempotente.
begin;

alter table public.perfiles add column if not exists intervalo_reservas_min smallint not null default 15;
alter table public.perfiles add column if not exists anticipacion_reserva_min integer not null default 120;
alter table public.perfiles add column if not exists max_dias_reserva integer not null default 60;
alter table public.perfiles add column if not exists buffer_reserva_min integer not null default 0;
alter table public.turnos add column if not exists buffer_min integer;
alter table public.solicitudes_reserva add column if not exists buffer_min integer;
alter table public.solicitudes_reserva add column if not exists empleada_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.perfiles'::regclass and conname='perfiles_intervalo_reservas_min_check') then
    alter table public.perfiles add constraint perfiles_intervalo_reservas_min_check check (intervalo_reservas_min in (15,30));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.perfiles'::regclass and conname='perfiles_anticipacion_reserva_min_check') then
    alter table public.perfiles add constraint perfiles_anticipacion_reserva_min_check check (anticipacion_reserva_min between 0 and 10080);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.perfiles'::regclass and conname='perfiles_max_dias_reserva_check') then
    alter table public.perfiles add constraint perfiles_max_dias_reserva_check check (max_dias_reserva between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.perfiles'::regclass and conname='perfiles_buffer_reserva_min_check') then
    alter table public.perfiles add constraint perfiles_buffer_reserva_min_check check (buffer_reserva_min between 0 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.turnos'::regclass and conname='turnos_buffer_min_check') then
    alter table public.turnos add constraint turnos_buffer_min_check check (buffer_min is null or buffer_min between 0 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.solicitudes_reserva'::regclass and conname='solicitudes_reserva_buffer_min_check') then
    alter table public.solicitudes_reserva add constraint solicitudes_reserva_buffer_min_check check (buffer_min is null or buffer_min between 0 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.solicitudes_reserva'::regclass and conname='solicitudes_reserva_empleada_fk') then
    alter table public.solicitudes_reserva add constraint solicitudes_reserva_empleada_fk
      foreign key(user_id,empleada_id) references public.empleadas(user_id,id) on delete set null (empleada_id);
  end if;
end $$;

create table if not exists public.horarios_especiales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  fecha date not null,
  cerrado boolean not null default false,
  inicio time,
  fin time,
  pausa_inicio time,
  pausa_fin time,
  nota text check (nota is null or char_length(nota) between 1 and 120),
  constraint horarios_especiales_user_fecha_unique unique(user_id,fecha),
  constraint horarios_especiales_intervalo_check check (
    (cerrado and inicio is null and fin is null and pausa_inicio is null and pausa_fin is null)
    or (not cerrado and inicio is not null and fin is not null and inicio < fin
      and ((pausa_inicio is null and pausa_fin is null)
        or (pausa_inicio is not null and pausa_fin is not null and inicio <= pausa_inicio
          and pausa_inicio < pausa_fin and pausa_fin <= fin)))
  ),
  unique(user_id,id)
);
create index if not exists horarios_especiales_user_fecha_idx on public.horarios_especiales(user_id,fecha);
alter table public.horarios_especiales enable row level security;
drop policy if exists horarios_especiales_select_own on public.horarios_especiales;
create policy horarios_especiales_select_own on public.horarios_especiales
  for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists horarios_especiales_insert_own on public.horarios_especiales;
create policy horarios_especiales_insert_own on public.horarios_especiales
  for insert to authenticated with check ((select auth.uid())=user_id and public.cuenta_activa());
drop policy if exists horarios_especiales_update_own on public.horarios_especiales;
create policy horarios_especiales_update_own on public.horarios_especiales
  for update to authenticated using ((select auth.uid())=user_id and public.cuenta_activa())
  with check ((select auth.uid())=user_id and public.cuenta_activa());
drop policy if exists horarios_especiales_delete_own on public.horarios_especiales;
create policy horarios_especiales_delete_own on public.horarios_especiales
  for delete to authenticated using ((select auth.uid())=user_id and public.cuenta_activa());
grant select,insert,update,delete on public.horarios_especiales to authenticated;
revoke all on public.horarios_especiales from anon,public;
grant select(intervalo_reservas_min,anticipacion_reserva_min,max_dias_reserva,buffer_reserva_min) on public.perfiles to authenticated;
grant update(intervalo_reservas_min,anticipacion_reserva_min,max_dias_reserva,buffer_reserva_min) on public.perfiles to authenticated;

create or replace function public.public_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_perfil public.perfiles%rowtype; v_servicios jsonb;
begin
  if p_slug is null or char_length(p_slug)>80 then return null; end if;
  select * into v_perfil from public.perfiles p where p.slug=p_slug and p.activo
    and p.vence_el>=(pg_catalog.now() at time zone 'America/Asuncion')::date;
  if not found then return null; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id,'nombre',s.nombre,'precio_gs',s.precio_gs,'duracion_min',s.duracion_min) order by s.nombre),'[]'::jsonb)
    into v_servicios from public.servicios s where s.user_id=v_perfil.user_id and s.activo;
  return pg_catalog.jsonb_build_object('nombre',v_perfil.nombre,'direccion',v_perfil.direccion,'telefono',v_perfil.telefono,
    'logo_url',v_perfil.logo_url,'color_principal',v_perfil.color_principal,'horario_texto',v_perfil.horario_texto,
    'max_dias_reserva',v_perfil.max_dias_reserva,'servicios',v_servicios);
end $$;

-- Devuelve una razón pública genérica sin exponer datos de turnos o clientas.
create or replace function public.reserva_slot_reglas(
  p_user_id uuid,p_fecha date,p_hora time,p_duracion_min integer,p_buffer_min integer default null
) returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile record; v_week jsonb; v_day text; v_open time; v_close time; v_break_start time; v_break_end time;
  v_exception public.horarios_especiales%rowtype; v_local_now timestamp; v_end timestamp; v_step integer;
begin
  if p_user_id is null or p_fecha is null or p_hora is null or p_duracion_min is null
    or p_duracion_min not between 5 and 600 or coalesce(p_buffer_min,0) not between 0 and 180 then return 'invalid'; end if;
  select p.horarios,p.intervalo_reservas_min,p.anticipacion_reserva_min,p.max_dias_reserva,p.activo,p.vence_el
    into v_profile from public.perfiles p where p.user_id=p_user_id;
  if not found or not v_profile.activo then return 'salon_inactivo'; end if;
  v_local_now:=pg_catalog.now() at time zone 'America/Asuncion';
  if v_profile.vence_el < v_local_now::date then return 'salon_inactivo'; end if;
  if p_fecha < v_local_now::date then return 'fecha_pasada'; end if;
  if p_fecha > v_local_now::date + v_profile.max_dias_reserva then return 'fecha_lejana'; end if;
  if ((p_fecha + p_hora) at time zone 'America/Asuncion')
    < pg_catalog.now() + pg_catalog.make_interval(mins=>v_profile.anticipacion_reserva_min) then return 'anticipacion'; end if;
  if pg_catalog.date_part('second',p_hora)<>0 then return 'hora_invalida'; end if;

  select * into v_exception from public.horarios_especiales h where h.user_id=p_user_id and h.fecha=p_fecha;
  if found then
    if v_exception.cerrado then return 'dia_especial_cerrado'; end if;
    v_open:=v_exception.inicio; v_close:=v_exception.fin;
    v_break_start:=v_exception.pausa_inicio; v_break_end:=v_exception.pausa_fin;
  else
    v_week:=v_profile.horarios; v_day:=extract(dow from p_fecha)::integer::text;
    if v_week is null or not (v_week ? v_day) then return 'dia_cerrado'; end if;
    begin
      v_open:=(v_week->v_day->>'inicio')::time; v_close:=(v_week->v_day->>'fin')::time;
      v_break_start:=nullif(v_week->v_day->>'pausa_inicio','')::time;
      v_break_end:=nullif(v_week->v_day->>'pausa_fin','')::time;
    exception when others then return 'horario_invalido'; end;
  end if;
  if v_open is null or v_close is null or v_open>=v_close then return 'horario_invalido'; end if;
  if pg_catalog.date_part('second',v_open)<>0 or pg_catalog.date_part('second',v_close)<>0
    or (v_break_start is not null and (pg_catalog.date_part('second',v_break_start)<>0 or pg_catalog.date_part('second',v_break_end)<>0)) then
    return 'horario_invalido';
  end if;
  if (v_break_start is null)<>(v_break_end is null)
    or (v_break_start is not null and (v_break_start<v_open or v_break_start>=v_break_end or v_break_end>v_close)) then
    return 'horario_invalido';
  end if;
  v_step:=coalesce(v_profile.intervalo_reservas_min,15);
  if p_hora < v_open then return 'antes_de_abrir'; end if;
  if pg_catalog.mod(extract(epoch from (p_hora-v_open))::integer,v_step*60)<>0 then return 'hora_desalineada'; end if;
  v_end:=p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min);
  if v_end > p_fecha+v_close then return 'no_entra'; end if;
  if v_break_start is not null and v_break_end is not null
    and (p_fecha+p_hora)<(p_fecha+v_break_end) and (p_fecha+v_break_start)<v_end then return 'pausa'; end if;
  return 'ok';
end $$;

-- Devuelve una empleada concreta libre o una fila NULL para el salón sin equipo activo.
create or replace function public.reserva_empleadas_libres(
  p_user_id uuid,p_fecha date,p_hora time,p_duracion_min integer,
  p_empleada_id uuid default null,p_excluir_solicitud uuid default null,p_excluir_turno uuid default null,
  p_buffer_min integer default null,p_permitir_solapamiento boolean default false
) returns table(empleada_id uuid) language plpgsql volatile security definer set search_path = '' as $$
declare v_profile_buffer integer; v_buffer integer; v_code text; v_employee_count integer;
begin
  select p.buffer_reserva_min into v_profile_buffer from public.perfiles p where p.user_id=p_user_id;
  v_buffer:=coalesce(p_buffer_min,v_profile_buffer,0);
  v_code:=public.reserva_slot_reglas(p_user_id,p_fecha,p_hora,p_duracion_min,v_buffer);
  if v_code<>'ok' then return; end if;
  select count(*)::integer into v_employee_count from public.empleadas e where e.user_id=p_user_id and e.activa;

  if p_empleada_id is not null then
    if not exists(select 1 from public.empleadas e where e.user_id=p_user_id and e.id=p_empleada_id and e.activa) then return; end if;
    if p_permitir_solapamiento or not exists(
      select 1 from public.turnos t
      where t.user_id=p_user_id and t.fecha=p_fecha and t.id is distinct from p_excluir_turno
        and t.estado in ('pendiente','hecho') and (t.empleada_id=p_empleada_id or t.empleada_id is null)
        and (p_fecha+p_hora)<(t.fecha+t.hora+pg_catalog.make_interval(mins=>coalesce(t.duracion_min,(select s.duracion_min from public.servicios s where s.user_id=t.user_id and s.id=t.servicio_id),60)+coalesce(t.buffer_min,v_profile_buffer,0)))
        and (t.fecha+t.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min+v_buffer))
      union all
      select 1 from public.solicitudes_reserva r
      where r.user_id=p_user_id and r.fecha=p_fecha and r.id is distinct from p_excluir_solicitud
        and r.estado='pendiente' and r.created_at>pg_catalog.now()-interval '20 minutes'
        and (r.empleada_id=p_empleada_id or r.empleada_id is null)
        and (p_fecha+p_hora)<(r.fecha+r.hora+pg_catalog.make_interval(mins=>coalesce((select sum(rs.duracion_min)::integer from public.solicitudes_reserva_servicios rs where rs.user_id=r.user_id and rs.solicitud_id=r.id),(select s.duracion_min from public.servicios s where s.user_id=r.user_id and s.id=r.servicio_id),60)+coalesce(r.buffer_min,v_profile_buffer,0)))
        and (r.fecha+r.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min+v_buffer))
    ) then return query select p_empleada_id; end if;
    return;
  end if;

  if v_employee_count=0 then
    if p_permitir_solapamiento or not exists(
      select 1 from public.turnos t where t.user_id=p_user_id and t.fecha=p_fecha and t.id is distinct from p_excluir_turno and t.estado in ('pendiente','hecho')
        and (p_fecha+p_hora)<(t.fecha+t.hora+pg_catalog.make_interval(mins=>coalesce(t.duracion_min,(select s.duracion_min from public.servicios s where s.user_id=t.user_id and s.id=t.servicio_id),60)+coalesce(t.buffer_min,v_profile_buffer,0)))
        and (t.fecha+t.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min+v_buffer))
      union all
      select 1 from public.solicitudes_reserva r where r.user_id=p_user_id and r.fecha=p_fecha and r.id is distinct from p_excluir_solicitud
        and r.estado='pendiente' and r.created_at>pg_catalog.now()-interval '20 minutes'
        and (p_fecha+p_hora)<(r.fecha+r.hora+pg_catalog.make_interval(mins=>coalesce((select sum(rs.duracion_min)::integer from public.solicitudes_reserva_servicios rs where rs.user_id=r.user_id and rs.solicitud_id=r.id),(select s.duracion_min from public.servicios s where s.user_id=r.user_id and s.id=r.servicio_id),60)+coalesce(r.buffer_min,v_profile_buffer,0)))
        and (r.fecha+r.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min+v_buffer))
    ) then return query select null::uuid; end if;
    return;
  end if;

  return query
    select e.id from public.empleadas e
    where e.user_id=p_user_id and e.activa
      and (p_permitir_solapamiento or not exists(
        select 1 from public.turnos t where t.user_id=p_user_id and t.fecha=p_fecha and t.id is distinct from p_excluir_turno
          and t.estado in ('pendiente','hecho') and (t.empleada_id=e.id or t.empleada_id is null)
          and (p_fecha+p_hora)<(t.fecha+t.hora+pg_catalog.make_interval(mins=>coalesce(t.duracion_min,(select s.duracion_min from public.servicios s where s.user_id=t.user_id and s.id=t.servicio_id),60)+coalesce(t.buffer_min,v_profile_buffer,0)))
          and (t.fecha+t.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min+v_buffer))
        union all
        select 1 from public.solicitudes_reserva r where r.user_id=p_user_id and r.fecha=p_fecha and r.id is distinct from p_excluir_solicitud
          and r.estado='pendiente' and r.created_at>pg_catalog.now()-interval '20 minutes'
          and (r.empleada_id=e.id or r.empleada_id is null)
          and (p_fecha+p_hora)<(r.fecha+r.hora+pg_catalog.make_interval(mins=>coalesce((select sum(rs.duracion_min)::integer from public.solicitudes_reserva_servicios rs where rs.user_id=r.user_id and rs.solicitud_id=r.id),(select s.duracion_min from public.servicios s where s.user_id=r.user_id and s.id=r.servicio_id),60)+coalesce(r.buffer_min,v_profile_buffer,0)))
          and (r.fecha+r.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min+v_buffer))
      )) order by e.created_at,e.id limit 1;
end $$;

create or replace function public.reserva_slot_disponible(
  p_user_id uuid,p_fecha date,p_hora time,p_duracion_min integer,p_excluir_solicitud uuid default null
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reserva_empleadas_libres(p_user_id,p_fecha,p_hora,p_duracion_min,null,p_excluir_solicitud,null,null,false))
$$;

create or replace function public.public_slots_multiple(p_slug text,p_fecha date,p_servicio_ids uuid[])
returns table(hora time) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid; v_week jsonb; v_day text; v_start time; v_end time; v_break_start time; v_break_end time;
  v_duration integer; v_buffer integer; v_step integer; v_slot time; v_minute integer; v_end_minute integer;
  v_count integer; v_exception public.horarios_especiales%rowtype;
begin
  if p_slug is null or char_length(p_slug)>80 or p_fecha is null or p_servicio_ids is null
    or pg_catalog.cardinality(p_servicio_ids) not between 1 and 8
    or (select count(distinct x.id) from pg_catalog.unnest(p_servicio_ids) x(id))<>pg_catalog.cardinality(p_servicio_ids) then return; end if;
  select p.user_id,p.horarios,p.buffer_reserva_min,p.intervalo_reservas_min into v_user,v_week,v_buffer,v_step
    from public.perfiles p where p.slug=p_slug and p.activo and p.vence_el>=(pg_catalog.now() at time zone 'America/Asuncion')::date;
  if v_user is null then return; end if;
  select count(*)::integer,coalesce(sum(s.duracion_min),0)::integer into v_count,v_duration
    from pg_catalog.unnest(p_servicio_ids) requested(id)
    join public.servicios s on s.user_id=v_user and s.id=requested.id and s.activo;
  if v_count<>pg_catalog.cardinality(p_servicio_ids) or v_duration not between 5 and 600 then return; end if;
  select * into v_exception from public.horarios_especiales h where h.user_id=v_user and h.fecha=p_fecha;
  if found then
    if v_exception.cerrado then return; end if;
    v_start:=v_exception.inicio; v_end:=v_exception.fin; v_break_start:=v_exception.pausa_inicio; v_break_end:=v_exception.pausa_fin;
  else
    v_day:=extract(dow from p_fecha)::integer::text;
    if v_week is null or not (v_week ? v_day) then return; end if;
    begin
      v_start:=(v_week->v_day->>'inicio')::time; v_end:=(v_week->v_day->>'fin')::time;
      v_break_start:=nullif(v_week->v_day->>'pausa_inicio','')::time; v_break_end:=nullif(v_week->v_day->>'pausa_fin','')::time;
    exception when others then return; end;
  end if;
  if v_start is null or v_end is null or v_start>=v_end then return; end if;
  v_step:=coalesce(v_step,15); v_buffer:=coalesce(v_buffer,0);
  v_minute:=extract(epoch from v_start)::integer/60; v_end_minute:=extract(epoch from v_end)::integer/60;
  while v_minute < v_end_minute loop
    v_slot:=pg_catalog.make_time(v_minute/60,v_minute%60,0);
    if public.reserva_slot_reglas(v_user,p_fecha,v_slot,v_duration,v_buffer)='ok'
      and exists(select 1 from public.reserva_empleadas_libres(v_user,p_fecha,v_slot,v_duration,null,null,null,v_buffer,false)) then
      hora:=v_slot; return next;
    end if;
    v_minute:=v_minute+v_step;
  end loop;
end $$;

-- RPC antigua de un servicio: conserva su interfaz y delega la disponibilidad.
create or replace function public.public_slots(p_slug text,p_fecha date,p_servicio_id uuid)
returns table(hora time) language sql stable security definer set search_path = '' as $$
  select slots.hora from public.public_slots_multiple(p_slug,p_fecha,array[p_servicio_id]) slots
$$;

create or replace function public.public_booking_status(p_slug text,p_fecha date,p_servicio_ids uuid[])
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid; v_week jsonb; v_day text; v_duration integer; v_open time; v_close time; v_break_start time; v_break_end time;
  v_exception public.horarios_especiales%rowtype; v_count integer; v_segments integer:=0; v_max_days integer;
  v_interval integer; v_slot time; v_minute integer; v_close_minute integer; v_rule text;
  v_has_candidate boolean:=false; v_has_lead_candidate boolean:=false;
begin
  if p_slug is null or char_length(p_slug)>80 or p_fecha is null then return 'invalid'; end if;
  if p_servicio_ids is null or pg_catalog.cardinality(p_servicio_ids)=0 then return 'select_service'; end if;
  if pg_catalog.cardinality(p_servicio_ids)>8
    or (select count(distinct x.id) from pg_catalog.unnest(p_servicio_ids) x(id))<>pg_catalog.cardinality(p_servicio_ids) then return 'invalid'; end if;
  select p.user_id,p.horarios,p.max_dias_reserva,p.intervalo_reservas_min into v_user,v_week,v_max_days,v_interval from public.perfiles p where p.slug=p_slug and p.activo
    and p.vence_el>=(pg_catalog.now() at time zone 'America/Asuncion')::date;
  if v_user is null then return 'unavailable'; end if;
  if p_fecha < (pg_catalog.now() at time zone 'America/Asuncion')::date then return 'date_limit'; end if;
  if p_fecha > (pg_catalog.now() at time zone 'America/Asuncion')::date+v_max_days then return 'date_limit'; end if;
  select count(*)::integer,coalesce(sum(s.duracion_min),0)::integer into v_count,v_duration
    from pg_catalog.unnest(p_servicio_ids) requested(id) join public.servicios s on s.user_id=v_user and s.id=requested.id and s.activo;
  if v_count<>pg_catalog.cardinality(p_servicio_ids) or v_duration not between 5 and 600 then return 'invalid'; end if;
  select * into v_exception from public.horarios_especiales h where h.user_id=v_user and h.fecha=p_fecha;
  if found then
    if v_exception.cerrado then return 'closed'; end if;
    v_open:=v_exception.inicio; v_close:=v_exception.fin; v_break_start:=v_exception.pausa_inicio; v_break_end:=v_exception.pausa_fin;
  else
    v_day:=extract(dow from p_fecha)::integer::text;
    if v_week is null or not(v_week?v_day) then return 'closed'; end if;
    begin
      v_open:=(v_week->v_day->>'inicio')::time; v_close:=(v_week->v_day->>'fin')::time;
      v_break_start:=nullif(v_week->v_day->>'pausa_inicio','')::time; v_break_end:=nullif(v_week->v_day->>'pausa_fin','')::time;
    exception when others then return 'closed'; end;
  end if;
  if v_open is null or v_close is null or v_open>=v_close then return 'closed'; end if;
  if pg_catalog.date_part('second',v_open)<>0 or pg_catalog.date_part('second',v_close)<>0
    or (v_break_start is not null and (pg_catalog.date_part('second',v_break_start)<>0 or pg_catalog.date_part('second',v_break_end)<>0)) then return 'closed'; end if;
  if (v_break_start is null)<>(v_break_end is null)
    or (v_break_start is not null and (v_break_start<v_open or v_break_start>=v_break_end or v_break_end>v_close)) then return 'closed'; end if;
  if v_break_start is null then v_segments:=case when v_close-v_open>=pg_catalog.make_interval(mins=>v_duration) then 1 else 0 end;
  else
    if v_break_start-v_open>=pg_catalog.make_interval(mins=>v_duration) then v_segments:=v_segments+1; end if;
    if v_close-v_break_end>=pg_catalog.make_interval(mins=>v_duration) then v_segments:=v_segments+1; end if;
  end if;
  if v_segments=0 then return 'too_long'; end if;
  v_interval:=coalesce(v_interval,15); v_minute:=extract(epoch from v_open)::integer/60;
  v_close_minute:=extract(epoch from v_close)::integer/60;
  while v_minute<v_close_minute loop
    v_slot:=pg_catalog.make_time(v_minute/60,v_minute%60,0);
    v_rule:=public.reserva_slot_reglas(v_user,p_fecha,v_slot,v_duration,0);
    if v_rule='ok' then v_has_candidate:=true;
    elsif v_rule='anticipacion' then v_has_lead_candidate:=true; end if;
    v_minute:=v_minute+v_interval;
  end loop;
  if v_has_lead_candidate and not v_has_candidate then return 'lead_time'; end if;
  if exists(select 1 from public.public_slots_multiple(p_slug,p_fecha,p_servicio_ids)) then return 'available'; end if;
  return 'busy';
end $$;

create or replace function public.public_request_booking_multiple(
  p_slug text,p_servicio_ids uuid[],p_fecha date,p_hora time,p_nombre text,p_telefono text,
  p_email text,p_website text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_duration integer; v_phone text; v_id uuid; v_today date; v_count integer; v_price bigint; v_first uuid;
  v_email text; v_buffer integer; v_employee uuid; v_rule text;
begin
  if coalesce(p_website,'')<>'' then raise exception 'Solicitud no válida' using errcode='22023'; end if;
  if char_length(coalesce(p_nombre,'')) not between 1 and 80 then raise exception 'Ingresá un nombre válido' using errcode='22023'; end if;
  if char_length(coalesce(p_telefono,'')) not between 7 and 24 or p_telefono !~ '^[+0-9() .-]{7,24}$' then raise exception 'Ingresá un teléfono válido' using errcode='22023'; end if;
  v_email:=nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,''))),'');
  if v_email is not null and (pg_catalog.char_length(v_email)>160 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$') then
    raise exception 'Ingresá un correo válido o dejá el campo vacío' using errcode='22023'; end if;
  if p_slug is null or char_length(p_slug)>80 or p_servicio_ids is null or pg_catalog.cardinality(p_servicio_ids) not between 1 and 8
    or (select count(distinct x.id) from pg_catalog.unnest(p_servicio_ids) x(id))<>pg_catalog.cardinality(p_servicio_ids) then
    raise exception 'Elegí entre uno y ocho servicios distintos' using errcode='22023'; end if;
  v_today:=(pg_catalog.now() at time zone 'America/Asuncion')::date;
  v_phone:=pg_catalog.regexp_replace(p_telefono,'\D','','g');
  if char_length(v_phone) not between 7 and 15 then raise exception 'Ingresá un teléfono válido' using errcode='22023'; end if;
  if char_length(v_phone)=9 then v_phone:='595'||v_phone; elsif left(v_phone,1)='0' then v_phone:='595'||substr(v_phone,2); end if;
  select p.user_id,p.buffer_reserva_min into v_user,v_buffer from public.perfiles p where p.slug=p_slug and p.activo and p.vence_el>=v_today;
  if v_user is null then raise exception 'El salón no recibe reservas actualmente' using errcode='P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':phone:'||v_phone,0));
  if (select count(*) from public.solicitudes_reserva r where r.user_id=v_user and
      (case when char_length(pg_catalog.regexp_replace(r.telefono,'\D','','g'))=9 then '595'||pg_catalog.regexp_replace(r.telefono,'\D','','g')
            when left(pg_catalog.regexp_replace(r.telefono,'\D','','g'),1)='0' then '595'||substr(pg_catalog.regexp_replace(r.telefono,'\D','','g'),2)
            else pg_catalog.regexp_replace(r.telefono,'\D','','g') end)=v_phone and r.created_at>pg_catalog.now()-interval '1 hour')>=3 then
    raise exception 'Llegaste al límite de solicitudes por ahora' using errcode='22023'; end if;
  select count(*)::integer,coalesce(sum(s.duracion_min),0)::integer,coalesce(sum(s.precio_gs),0)::bigint
    into v_count,v_duration,v_price from pg_catalog.unnest(p_servicio_ids) with ordinality requested(id,orden)
    join public.servicios s on s.user_id=v_user and s.id=requested.id and s.activo;
  if v_count<>pg_catalog.cardinality(p_servicio_ids) or v_duration not between 5 and 600 then
    raise exception 'Uno o más servicios ya no están disponibles' using errcode='P0002'; end if;
  if p_fecha is null or p_hora is null then raise exception 'Elegí una fecha y hora válidas' using errcode='22023'; end if;
  v_rule:=public.reserva_slot_reglas(v_user,p_fecha,p_hora,v_duration,v_buffer);
  if v_rule<>'ok' then
    if v_rule in ('dia_cerrado','dia_especial_cerrado') then raise exception 'El salón no abre ese día' using errcode='22023';
    elsif v_rule='no_entra' then raise exception 'Ese servicio no entra antes del cierre' using errcode='22023';
    elsif v_rule='pausa' then raise exception 'Ese horario coincide con la pausa del salón' using errcode='22023';
    elsif v_rule='anticipacion' then raise exception 'Elegí un horario con más anticipación' using errcode='22023';
    elsif v_rule='fecha_lejana' then raise exception 'La fecha supera el límite de reservas del salón' using errcode='22023';
    else raise exception 'Ese horario no está disponible' using errcode='22023'; end if;
  end if;
  v_first:=p_servicio_ids[1];
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_fecha::text,0));
  select l.empleada_id into v_employee from public.reserva_empleadas_libres(v_user,p_fecha,p_hora,v_duration,null,null,null,v_buffer,false) l;
  if not found then raise exception 'Ese horario ya fue tomado, elegí otro' using errcode='23P01'; end if;
  insert into public.solicitudes_reserva(user_id,servicio_id,fecha,hora,nombre,telefono,email,empleada_id,buffer_min)
    values(v_user,v_first,p_fecha,p_hora,pg_catalog.btrim(p_nombre),pg_catalog.btrim(p_telefono),v_email,v_employee,v_buffer) returning id into v_id;
  insert into public.solicitudes_reserva_servicios(user_id,solicitud_id,servicio_id,servicio_nombre,precio_gs,duracion_min,orden)
    select v_user,v_id,s.id,s.nombre,s.precio_gs,s.duracion_min,requested.orden::integer
    from pg_catalog.unnest(p_servicio_ids) with ordinality requested(id,orden)
    join public.servicios s on s.user_id=v_user and s.id=requested.id;
  return jsonb_build_object('ok',true,'cantidad_servicios',v_count,'precio_gs',v_price,'duracion_min',v_duration);
end $$;

-- Firma anterior conservada para páginas públicas desplegadas antes de migracion_15.
create or replace function public.public_request_booking_multiple(
  p_slug text,p_servicio_ids uuid[],p_fecha date,p_hora time,p_nombre text,p_telefono text,p_website text default ''
) returns jsonb language sql security definer set search_path = '' as $$
  select public.public_request_booking_multiple(p_slug,p_servicio_ids,p_fecha,p_hora,p_nombre,p_telefono,null,p_website)
$$;

-- Firma antigua de un solo servicio: delega en la misma validación pública.
create or replace function public.public_request_booking(
  p_slug text,p_servicio_id uuid,p_fecha date,p_hora time,p_nombre text,p_telefono text,p_website text default ''
) returns jsonb language sql security definer set search_path = '' as $$
  select public.public_request_booking_multiple(p_slug,array[p_servicio_id],p_fecha,p_hora,p_nombre,p_telefono,null,p_website)
$$;

create or replace function public.resolver_solicitud_reserva(p_solicitud_id uuid,p_aceptar boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_req public.solicitudes_reserva%rowtype; v_client uuid; v_turno uuid;
  v_price bigint; v_duration integer; v_first_service uuid; v_service_count integer; v_employee uuid; v_rule text;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  if p_solicitud_id is null or p_aceptar is null then raise exception 'Solicitud inválida' using errcode='22023'; end if;
  select * into v_req from public.solicitudes_reserva r where r.id=p_solicitud_id and r.user_id=v_user and r.estado='pendiente' for update;
  if not found then raise exception 'La solicitud ya fue atendida o no existe' using errcode='P0002'; end if;
  if not p_aceptar then update public.solicitudes_reserva set estado='rechazada' where id=v_req.id and user_id=v_user; return jsonb_build_object('ok',true); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||v_req.fecha::text,0));
  select count(*)::integer,coalesce(sum(rs.precio_gs),0)::bigint,coalesce(sum(rs.duracion_min),0)::integer,
    (array_agg(rs.servicio_id order by rs.orden))[1]
    into v_service_count,v_price,v_duration,v_first_service from public.solicitudes_reserva_servicios rs
    where rs.user_id=v_user and rs.solicitud_id=v_req.id;
  if v_service_count=0 then
    select s.precio_gs,s.duracion_min,s.id into v_price,v_duration,v_first_service
      from public.servicios s where s.user_id=v_user and s.id=v_req.servicio_id;
    v_service_count:=1;
  end if;
  v_rule:=public.reserva_slot_reglas(v_user,v_req.fecha,v_req.hora,v_duration,coalesce(v_req.buffer_min,0));
  if v_rule<>'ok' then raise exception 'La solicitud ya no está dentro del horario disponible' using errcode='23P01'; end if;
  select l.empleada_id into v_employee from public.reserva_empleadas_libres(v_user,v_req.fecha,v_req.hora,v_duration,null,v_req.id,null,v_req.buffer_min,false) l;
  if not found then raise exception 'Ese horario ya fue tomado, elegí otro horario para el turno' using errcode='23P01'; end if;
  select c.id into v_client from public.clientas c where c.user_id=v_user
    and (case when char_length(pg_catalog.regexp_replace(coalesce(c.telefono,''),'\D','','g'))=9 then '595'||pg_catalog.regexp_replace(coalesce(c.telefono,''),'\D','','g')
      when left(pg_catalog.regexp_replace(coalesce(c.telefono,''),'\D','','g'),1)='0' then '595'||substr(pg_catalog.regexp_replace(coalesce(c.telefono,''),'\D','','g'),2)
      else pg_catalog.regexp_replace(coalesce(c.telefono,''),'\D','','g') end)
    = (case when char_length(pg_catalog.regexp_replace(v_req.telefono,'\D','','g'))=9 then '595'||pg_catalog.regexp_replace(v_req.telefono,'\D','','g')
      when left(pg_catalog.regexp_replace(v_req.telefono,'\D','','g'),1)='0' then '595'||substr(pg_catalog.regexp_replace(v_req.telefono,'\D','','g'),2)
      else pg_catalog.regexp_replace(v_req.telefono,'\D','','g') end) order by c.created_at limit 1;
  if v_client is null then insert into public.clientas(user_id,nombre,telefono,email)
    values(v_user,v_req.nombre,v_req.telefono,v_req.email) returning id into v_client;
  elsif v_req.email is not null then update public.clientas set email=v_req.email where id=v_client and user_id=v_user and nullif(pg_catalog.btrim(email),'') is null;
  end if;
  -- Sacar la solicitud del conjunto de bloqueos antes del trigger; todo se revierte si falla la inserción.
  update public.solicitudes_reserva set estado='aceptada' where id=v_req.id and user_id=v_user;
  insert into public.turnos(user_id,clienta_id,servicio_id,fecha,hora,precio_gs,duracion_min,empleada_id,buffer_min,estado,nombre_publico,telefono_publico)
    values(v_user,v_client,v_first_service,v_req.fecha,v_req.hora,v_price,v_duration,v_employee,coalesce(v_req.buffer_min,0),'pendiente',v_req.nombre,v_req.telefono)
    returning id into v_turno;
  if exists(select 1 from public.solicitudes_reserva_servicios rs where rs.user_id=v_user and rs.solicitud_id=v_req.id) then
    insert into public.turno_servicios(user_id,turno_id,servicio_id,servicio_nombre,precio_gs,duracion_min,orden)
      select v_user,v_turno,rs.servicio_id,rs.servicio_nombre,rs.precio_gs,rs.duracion_min,rs.orden
      from public.solicitudes_reserva_servicios rs where rs.user_id=v_user and rs.solicitud_id=v_req.id order by rs.orden;
  else
    insert into public.turno_servicios(user_id,turno_id,servicio_id,servicio_nombre,precio_gs,duracion_min,orden)
      select v_user,v_turno,s.id,s.nombre,s.precio_gs,s.duracion_min,1 from public.servicios s where s.user_id=v_user and s.id=v_req.servicio_id;
  end if;
  return jsonb_build_object('ok',true,'id',v_turno,'nombre',v_req.nombre,'telefono',v_req.telefono,'fecha',v_req.fecha,'hora',v_req.hora,'servicios',v_service_count,'precio_gs',v_price);
end $$;

-- El trigger cubre inserciones REST y vuelve a aplicar la regla compartida a cambios del calendario.
create or replace function public.validar_disponibilidad_turno()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_duration integer; v_buffer integer; v_employee uuid; v_force boolean; v_rule text;
begin
  if new.estado='cancelado' then return new; end if;
  -- Los registros hechos anteriores a este momento son historial importado;
  -- cualquier turno hecho futuro sí debe respetar el horario y la capacidad.
  if tg_op='INSERT' and new.estado='hecho'
    and (new.fecha+new.hora)<(pg_catalog.now() at time zone 'America/Asuncion') then return new; end if;
  if tg_op='UPDATE' and old.estado='pendiente' and new.estado='hecho'
    and new.fecha is not distinct from old.fecha and new.hora is not distinct from old.hora
    and new.servicio_id is not distinct from old.servicio_id and new.duracion_min is not distinct from old.duracion_min
    and new.empleada_id is not distinct from old.empleada_id then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text||':'||new.fecha::text,0));
  select coalesce(new.duracion_min,(select sum(ts.duracion_min)::integer from public.turno_servicios ts where ts.user_id=new.user_id and ts.turno_id=new.id),s.duracion_min,60)
    into v_duration from (select 1) q left join public.servicios s on s.user_id=new.user_id and s.id=new.servicio_id;
  select coalesce(new.buffer_min,p.buffer_reserva_min,0) into v_buffer from public.perfiles p where p.user_id=new.user_id;
  new.buffer_min:=v_buffer;
  v_force:=current_setting('agendapora.allow_overlap',true)='on';
  v_rule:=public.reserva_slot_reglas(new.user_id,new.fecha,new.hora,v_duration,v_buffer);
  if v_rule<>'ok' then
    if v_rule in ('dia_cerrado','dia_especial_cerrado') then raise exception 'El salón no abre ese día' using errcode='23P01';
    elsif v_rule='no_entra' then raise exception 'Ese servicio no entra antes del cierre' using errcode='23P01';
    elsif v_rule='pausa' then raise exception 'Ese horario coincide con la pausa del salón' using errcode='23P01';
    elsif v_rule='anticipacion' then raise exception 'Elegí un horario con más anticipación' using errcode='23P01';
    else raise exception 'El turno está fuera de un horario disponible' using errcode='23P01'; end if;
  end if;
  select l.empleada_id into v_employee from public.reserva_empleadas_libres(new.user_id,new.fecha,new.hora,v_duration,new.empleada_id,null,new.id,v_buffer,v_force) l;
  if not found then raise exception 'Ese horario ya fue tomado, elegí otro' using errcode='23P01'; end if;
  new.empleada_id:=v_employee;
  return new;
end $$;
drop trigger if exists turnos_validar_disponibilidad on public.turnos;
create trigger turnos_validar_disponibilidad
  before insert or update of fecha,hora,servicio_id,duracion_min,empleada_id,buffer_min,estado on public.turnos
  for each row execute function public.validar_disponibilidad_turno();

create or replace function public.guardar_turno_multiple(
  p_turno_id uuid,p_clienta_id uuid,p_servicio_ids uuid[],p_fecha date,p_hora time,p_empleada_id uuid,
  p_estado text,p_notas text,p_permitir_solapamiento boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_first_service uuid; v_price bigint; v_duration integer; v_count integer;
  v_existing_estado text; v_employee uuid; v_buffer integer;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  if p_fecha is null or p_hora is null or p_estado is null or p_estado not in ('pendiente','cancelado') or char_length(coalesce(p_notas,''))>2000
    or p_servicio_ids is null or pg_catalog.cardinality(p_servicio_ids) not between 1 and 8
    or (select count(distinct x.id) from pg_catalog.unnest(p_servicio_ids) x(id))<>pg_catalog.cardinality(p_servicio_ids) then
    raise exception 'Datos del turno inválidos; elegí de uno a ocho servicios distintos' using errcode='22023'; end if;
  if p_turno_id is not null then
    select t.estado into v_existing_estado from public.turnos t where t.id=p_turno_id and t.user_id=v_user for update;
    if not found then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
    if v_existing_estado='hecho' then raise exception 'Los turnos realizados no se pueden editar' using errcode='23514'; end if;
  end if;
  perform 1 from public.servicios s where s.user_id=v_user and s.id=any(p_servicio_ids) order by s.id for share;
  select count(*)::integer,coalesce(sum(s.precio_gs),0)::bigint,coalesce(sum(s.duracion_min),0)::integer
    into v_count,v_price,v_duration from pg_catalog.unnest(p_servicio_ids) with ordinality requested(id,orden)
    join public.servicios s on s.user_id=v_user and s.id=requested.id
      and (s.activo or (p_turno_id is not null and exists(select 1 from public.turno_servicios old where old.user_id=v_user and old.turno_id=p_turno_id and old.servicio_id=s.id)));
  if v_count<>pg_catalog.cardinality(p_servicio_ids) then raise exception 'Uno o más servicios ya no están disponibles' using errcode='23503'; end if;
  if v_duration not between 5 and 600 then raise exception 'La duración total debe ser de 5 a 600 minutos' using errcode='22023'; end if;
  v_first_service:=p_servicio_ids[1];
  if p_clienta_id is not null and not exists(select 1 from public.clientas c where c.id=p_clienta_id and c.user_id=v_user) then raise exception 'Clienta inválida' using errcode='23503'; end if;
  if p_empleada_id is not null and not exists(select 1 from public.empleadas e where e.id=p_empleada_id and e.user_id=v_user and e.activa) then raise exception 'Empleada inválida o inactiva' using errcode='23503'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_fecha::text,0));
  select p.buffer_reserva_min into v_buffer from public.perfiles p where p.user_id=v_user;
  if p_estado='pendiente' then
    if p_permitir_solapamiento then perform pg_catalog.set_config('agendapora.allow_overlap','on',true); end if;
    select l.empleada_id into v_employee from public.reserva_empleadas_libres(v_user,p_fecha,p_hora,v_duration,p_empleada_id,null,p_turno_id,v_buffer,p_permitir_solapamiento) l;
    if not found then
      case public.reserva_slot_reglas(v_user,p_fecha,p_hora,v_duration,v_buffer)
        when 'dia_cerrado' then raise exception 'El salón no abre ese día' using errcode='23P01';
        when 'dia_especial_cerrado' then raise exception 'El salón no abre ese día' using errcode='23P01';
        when 'no_entra' then raise exception 'Ese servicio no entra antes del cierre' using errcode='23P01';
        when 'pausa' then raise exception 'Ese horario coincide con la pausa del salón' using errcode='23P01';
        else raise exception 'Ese horario ya fue tomado, elegí otro' using errcode='23P01';
      end case;
    end if;
  else v_employee:=p_empleada_id; end if;
  if p_turno_id is null then
    insert into public.turnos(user_id,clienta_id,servicio_id,fecha,hora,precio_gs,duracion_min,empleada_id,buffer_min,estado,notas)
      values(v_user,p_clienta_id,v_first_service,p_fecha,p_hora,v_price,v_duration,v_employee,v_buffer,p_estado,nullif(p_notas,'')) returning id into v_id;
  else
    update public.turnos set clienta_id=p_clienta_id,servicio_id=v_first_service,fecha=p_fecha,hora=p_hora,precio_gs=v_price,
      duracion_min=v_duration,empleada_id=v_employee,buffer_min=v_buffer,estado=p_estado,notas=nullif(p_notas,'')
      where id=p_turno_id and user_id=v_user returning id into v_id;
  end if;
  delete from public.turno_servicios where user_id=v_user and turno_id=v_id;
  insert into public.turno_servicios(user_id,turno_id,servicio_id,servicio_nombre,precio_gs,duracion_min,orden)
    select v_user,v_id,s.id,s.nombre,s.precio_gs,s.duracion_min,requested.orden::integer
    from pg_catalog.unnest(p_servicio_ids) with ordinality requested(id,orden)
    join public.servicios s on s.user_id=v_user and s.id=requested.id;
  return v_id;
end $$;

create or replace function public.guardar_turno(
  p_turno_id uuid,p_clienta_id uuid,p_servicio_id uuid,p_fecha date,p_hora time,p_precio_gs bigint,
  p_empleada_id uuid,p_estado text,p_notas text,p_permitir_solapamiento boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_duration integer; v_employee uuid; v_buffer integer; v_rule text;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  if p_fecha is null or p_hora is null or p_precio_gs is null or p_precio_gs<0 or p_estado is null or p_estado not in ('pendiente','cancelado') or char_length(coalesce(p_notas,''))>2000 then
    raise exception 'Datos del turno inválidos' using errcode='22023'; end if;
  select s.duracion_min into v_duration from public.servicios s where s.user_id=v_user and s.id=p_servicio_id and s.activo;
  if not found then raise exception 'Servicio inválido o inactivo' using errcode='23503'; end if;
  if p_clienta_id is not null and not exists(select 1 from public.clientas c where c.user_id=v_user and c.id=p_clienta_id) then raise exception 'Clienta inválida' using errcode='23503'; end if;
  if p_empleada_id is not null and not exists(select 1 from public.empleadas e where e.user_id=v_user and e.id=p_empleada_id and e.activa) then raise exception 'Empleada inválida o inactiva' using errcode='23503'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_fecha::text,0));
  select p.buffer_reserva_min into v_buffer from public.perfiles p where p.user_id=v_user;
  if p_estado='pendiente' then
    if p_permitir_solapamiento then perform pg_catalog.set_config('agendapora.allow_overlap','on',true); end if;
    v_rule:=public.reserva_slot_reglas(v_user,p_fecha,p_hora,v_duration,v_buffer);
    if v_rule<>'ok' then
      case v_rule
        when 'dia_cerrado' then raise exception 'El salón no abre ese día' using errcode='23P01';
        when 'dia_especial_cerrado' then raise exception 'El salón no abre ese día' using errcode='23P01';
        when 'no_entra' then raise exception 'Ese servicio no entra antes del cierre' using errcode='23P01';
        when 'pausa' then raise exception 'Ese horario coincide con la pausa del salón' using errcode='23P01';
        when 'anticipacion' then raise exception 'Elegí un horario con más anticipación' using errcode='23P01';
        when 'fecha_lejana' then raise exception 'La fecha supera el límite de reservas del salón' using errcode='23P01';
        else raise exception 'El turno está fuera de un horario disponible' using errcode='23P01';
      end case;
    end if;
    select l.empleada_id into v_employee from public.reserva_empleadas_libres(v_user,p_fecha,p_hora,v_duration,p_empleada_id,null,p_turno_id,v_buffer,p_permitir_solapamiento) l;
    if not found then raise exception 'Ese horario no está disponible' using errcode='23P01'; end if;
  else v_employee:=p_empleada_id; end if;
  if p_turno_id is null then
    insert into public.turnos(user_id,clienta_id,servicio_id,fecha,hora,precio_gs,duracion_min,empleada_id,buffer_min,estado,notas)
      values(v_user,p_clienta_id,p_servicio_id,p_fecha,p_hora,p_precio_gs,v_duration,v_employee,v_buffer,p_estado,nullif(p_notas,'')) returning id into v_id;
  else
    update public.turnos set clienta_id=p_clienta_id,servicio_id=p_servicio_id,fecha=p_fecha,hora=p_hora,precio_gs=p_precio_gs,
      duracion_min=v_duration,empleada_id=v_employee,buffer_min=v_buffer,estado=p_estado,notas=nullif(p_notas,'')
      where id=p_turno_id and user_id=v_user returning id into v_id;
    if v_id is null then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.mover_turno(p_turno_id uuid,p_fecha date,p_hora time,p_permitir_solapamiento boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_turno public.turnos%rowtype; v_duration integer; v_buffer integer; v_employee uuid; v_rule text;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  if p_fecha is null or p_hora is null then raise exception 'Fecha u hora inválida' using errcode='22023'; end if;
  select * into v_turno from public.turnos t where t.id=p_turno_id and t.user_id=v_user for update;
  if not found or v_turno.estado='cancelado' then raise exception 'Turno no encontrado o cancelado' using errcode='P0002'; end if;
  if v_turno.estado='hecho' then raise exception 'Este turno ya fue realizado y no se puede mover' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_fecha::text,0));
  v_duration:=coalesce(v_turno.duracion_min,(select sum(ts.duracion_min)::integer from public.turno_servicios ts where ts.user_id=v_user and ts.turno_id=v_turno.id),(select s.duracion_min from public.servicios s where s.user_id=v_user and s.id=v_turno.servicio_id),60);
  select coalesce(v_turno.buffer_min,p.buffer_reserva_min,0) into v_buffer from public.perfiles p where p.user_id=v_user;
  if p_permitir_solapamiento then perform pg_catalog.set_config('agendapora.allow_overlap','on',true); end if;
  v_rule:=public.reserva_slot_reglas(v_user,p_fecha,p_hora,v_duration,v_buffer);
  if v_rule<>'ok' then
    case v_rule
      when 'dia_cerrado' then raise exception 'El salón no abre ese día' using errcode='23P01';
      when 'dia_especial_cerrado' then raise exception 'El salón no abre ese día' using errcode='23P01';
      when 'no_entra' then raise exception 'Ese servicio no entra antes del cierre' using errcode='23P01';
      when 'pausa' then raise exception 'Ese horario coincide con la pausa del salón' using errcode='23P01';
      when 'anticipacion' then raise exception 'Elegí un horario con más anticipación' using errcode='23P01';
      when 'fecha_lejana' then raise exception 'La fecha supera el límite de reservas del salón' using errcode='23P01';
      else raise exception 'El turno está fuera de un horario disponible' using errcode='23P01';
    end case;
  end if;
  select l.empleada_id into v_employee from public.reserva_empleadas_libres(v_user,p_fecha,p_hora,v_duration,v_turno.empleada_id,null,v_turno.id,v_buffer,p_permitir_solapamiento) l;
  if not found then raise exception 'Ese horario ya fue tomado, elegí otro' using errcode='23P01'; end if;
  update public.turnos set fecha=p_fecha,hora=p_hora,empleada_id=v_employee,buffer_min=v_buffer
    where id=v_turno.id and user_id=v_user and estado='pendiente';
  if not found then raise exception 'El turno cambió mientras se intentaba mover' using errcode='40001'; end if;
end $$;

revoke all on function public.reserva_slot_reglas(uuid,date,time,integer,integer) from public,anon,authenticated;
revoke all on function public.reserva_empleadas_libres(uuid,date,time,integer,uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
revoke all on function public.reserva_slot_disponible(uuid,date,time,integer,uuid) from public,anon,authenticated;
revoke all on function public.public_slots_multiple(text,date,uuid[]) from public;
grant execute on function public.public_slots_multiple(text,date,uuid[]) to anon,authenticated;
revoke all on function public.public_slots(text,date,uuid) from public;
grant execute on function public.public_slots(text,date,uuid) to anon,authenticated;
revoke all on function public.public_info(text) from public;
grant execute on function public.public_info(text) to anon,authenticated;
revoke all on function public.public_booking_status(text,date,uuid[]) from public;
grant execute on function public.public_booking_status(text,date,uuid[]) to anon,authenticated;
revoke all on function public.public_request_booking_multiple(text,uuid[],date,time,text,text,text,text) from public;
grant execute on function public.public_request_booking_multiple(text,uuid[],date,time,text,text,text,text) to anon,authenticated;
revoke all on function public.public_request_booking_multiple(text,uuid[],date,time,text,text,text) from public;
grant execute on function public.public_request_booking_multiple(text,uuid[],date,time,text,text,text) to anon,authenticated;
revoke all on function public.public_request_booking(text,uuid,date,time,text,text,text) from public;
grant execute on function public.public_request_booking(text,uuid,date,time,text,text,text) to anon,authenticated;
revoke all on function public.resolver_solicitud_reserva(uuid,boolean) from public,anon;
grant execute on function public.resolver_solicitud_reserva(uuid,boolean) to authenticated;
revoke all on function public.guardar_turno_multiple(uuid,uuid,uuid[],date,time,uuid,text,text,boolean) from public,anon;
grant execute on function public.guardar_turno_multiple(uuid,uuid,uuid[],date,time,uuid,text,text,boolean) to authenticated;
revoke all on function public.guardar_turno(uuid,uuid,uuid,date,time,bigint,uuid,text,text,boolean) from public,anon;
grant execute on function public.guardar_turno(uuid,uuid,uuid,date,time,bigint,uuid,text,text,boolean) to authenticated;
revoke all on function public.mover_turno(uuid,date,time,boolean) from public,anon;
grant execute on function public.mover_turno(uuid,date,time,boolean) to authenticated;
revoke all on function public.validar_disponibilidad_turno() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
