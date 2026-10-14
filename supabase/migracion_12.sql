-- Permite asociar varios servicios a un mismo turno con precio y duración combinados.
-- Ejecutar en Supabase → SQL Editor como postgres. Es idempotente.
begin;

alter table public.turnos add column if not exists duracion_min integer;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.turnos'::regclass and conname='turnos_duracion_min_check') then
    alter table public.turnos add constraint turnos_duracion_min_check check (duracion_min is null or duracion_min between 1 and 1440);
  end if;
end $$;

create table if not exists public.turno_servicios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  turno_id uuid not null,
  servicio_id uuid,
  servicio_nombre text not null check (char_length(servicio_nombre) between 1 and 100),
  precio_gs bigint not null check (precio_gs >= 0),
  duracion_min integer not null check (duracion_min between 1 and 1440),
  orden integer not null default 1 check (orden between 1 and 20),
  constraint turno_servicios_turno_fk foreign key(user_id,turno_id) references public.turnos(user_id,id) on delete cascade,
  constraint turno_servicios_servicio_fk foreign key(user_id,servicio_id) references public.servicios(user_id,id) on delete set null (servicio_id),
  unique(user_id,id),
  unique(user_id,turno_id,servicio_id)
);

create index if not exists turno_servicios_user_turno_idx on public.turno_servicios(user_id,turno_id,orden);
alter table public.turno_servicios enable row level security;
drop policy if exists turno_servicios_select_own on public.turno_servicios;
create policy turno_servicios_select_own on public.turno_servicios for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists turno_servicios_insert_own on public.turno_servicios;
create policy turno_servicios_insert_own on public.turno_servicios for insert to authenticated with check (false);
drop policy if exists turno_servicios_update_own on public.turno_servicios;
create policy turno_servicios_update_own on public.turno_servicios for update to authenticated using (false) with check (false);
drop policy if exists turno_servicios_delete_own on public.turno_servicios;
create policy turno_servicios_delete_own on public.turno_servicios for delete to authenticated using (false);
grant select on public.turno_servicios to authenticated;
revoke insert,update,delete on public.turno_servicios from authenticated,anon,public;

-- Conserva el servicio único de los turnos existentes como una línea histórica.
update public.turnos t
set duracion_min=coalesce(t.duracion_min,s.duracion_min,60)
from public.servicios s
where s.user_id=t.user_id and s.id=t.servicio_id and t.duracion_min is null;

insert into public.turno_servicios(user_id,turno_id,servicio_id,servicio_nombre,precio_gs,duracion_min,orden)
select t.user_id,t.id,s.id,s.nombre,t.precio_gs,coalesce(t.duracion_min,s.duracion_min,60),1
from public.turnos t
join public.servicios s on s.user_id=t.user_id and s.id=t.servicio_id
on conflict(user_id,turno_id,servicio_id) do nothing;

-- La agenda pública también calcula los choques usando la duración total del turno.
create or replace function public.reserva_slot_disponible(p_user_id uuid,p_fecha date,p_hora time,p_duracion_min integer,p_excluir_solicitud uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_horarios jsonb; v_dow text; v_inicio time; v_fin time; v_hoy date; v_ahora time;
begin
  if p_user_id is null or p_fecha is null or p_hora is null or p_duracion_min is null or p_duracion_min not between 5 and 600 then return false; end if;
  v_hoy:=(pg_catalog.now() at time zone 'America/Asuncion')::date;
  v_ahora:=(pg_catalog.now() at time zone 'America/Asuncion')::time;
  if p_fecha<v_hoy or p_fecha>v_hoy+90 or (p_fecha=v_hoy and p_hora<=v_ahora) then return false; end if;
  if pg_catalog.date_part('second',p_hora)<>0 or pg_catalog.mod(pg_catalog.date_part('minute',p_hora)::integer,15)<>0 then return false; end if;
  select p.horarios into v_horarios from public.perfiles p where p.user_id=p_user_id and p.activo and p.vence_el>=v_hoy;
  if not found then return false; end if;
  v_dow:=extract(dow from p_fecha)::integer::text;
  if not (v_horarios ? v_dow) then return false; end if;
  begin
    v_inicio:=(v_horarios->v_dow->>'inicio')::time;
    v_fin:=(v_horarios->v_dow->>'fin')::time;
  exception when others then return false;
  end;
  if v_inicio is null or v_fin is null or p_hora<v_inicio or (p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min))>(p_fecha+v_fin) then return false; end if;
  if exists(
    select 1 from public.turnos t left join public.servicios s on s.user_id=t.user_id and s.id=t.servicio_id
    where t.user_id=p_user_id and t.fecha=p_fecha and t.estado<>'cancelado'
      and (p_fecha+p_hora)<(t.fecha+t.hora+pg_catalog.make_interval(mins=>coalesce(t.duracion_min,s.duracion_min,60)))
      and (t.fecha+t.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min))
  ) then return false; end if;
  if exists(
    select 1 from public.solicitudes_reserva r join public.servicios s on s.user_id=r.user_id and s.id=r.servicio_id
    where r.user_id=p_user_id and r.fecha=p_fecha and r.estado='pendiente' and r.id is distinct from p_excluir_solicitud
      and (p_fecha+p_hora)<(r.fecha+r.hora+pg_catalog.make_interval(mins=>s.duracion_min))
      and (r.fecha+r.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min))
  ) then return false; end if;
  return true;
end $$;

-- Los intervalos existentes y futuros usan la suma de duraciones del turno.
create or replace function public.validar_disponibilidad_turno()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inicio timestamp; v_fin timestamp; v_solapado boolean; v_duracion integer;
begin
  if new.estado='cancelado' or current_setting('agendapora.allow_overlap',true)='on' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text || ':' || new.fecha::text,0));
  select coalesce(new.duracion_min,s.duracion_min,60) into v_duracion
  from (select 1) q left join public.servicios s on s.user_id=new.user_id and s.id=new.servicio_id;
  v_inicio:=new.fecha+new.hora;
  v_fin:=v_inicio+pg_catalog.make_interval(mins=>v_duracion);
  select exists(
    select 1 from public.turnos t
    left join public.servicios s on s.user_id=t.user_id and s.id=t.servicio_id
    where t.user_id=new.user_id and t.fecha=new.fecha and t.estado<>'cancelado' and t.id is distinct from new.id
      and (new.fecha+new.hora)<(t.fecha+t.hora+pg_catalog.make_interval(mins=>coalesce(t.duracion_min,s.duracion_min,60)))
      and (t.fecha+t.hora)<v_fin
  ) into v_solapado;
  if v_solapado then raise exception 'Ese horario se superpone con otro turno' using errcode='23P01'; end if;
  return new;
end $$;

create or replace function public.guardar_turno_multiple(
  p_turno_id uuid,
  p_clienta_id uuid,
  p_servicio_ids uuid[],
  p_fecha date,
  p_hora time,
  p_empleada_id uuid,
  p_estado text,
  p_notas text,
  p_permitir_solapamiento boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
  v_first_service uuid;
  v_price bigint;
  v_duration integer;
  v_service_count integer;
  v_existing_estado text;
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  if p_fecha is null or p_hora is null or p_estado is null or p_estado not in ('pendiente','cancelado') or char_length(coalesce(p_notas,''))>2000
    or p_servicio_ids is null or pg_catalog.cardinality(p_servicio_ids)<1 or pg_catalog.cardinality(p_servicio_ids)>8 then
    raise exception 'Datos del turno inválidos; elegí de uno a ocho servicios' using errcode='22023';
  end if;
  if (select count(distinct requested.id) from pg_catalog.unnest(p_servicio_ids) as requested(id))<>pg_catalog.cardinality(p_servicio_ids) then
    raise exception 'No repitas servicios en el mismo turno' using errcode='22023';
  end if;
  if p_turno_id is not null then
    select t.estado into v_existing_estado from public.turnos t where t.id=p_turno_id and t.user_id=v_user for update;
    if not found then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
    if v_existing_estado='hecho' then raise exception 'Los turnos realizados no se pueden editar' using errcode='23514'; end if;
  end if;
  perform 1 from public.servicios s where s.user_id=v_user and s.id=any(p_servicio_ids) order by s.id for share;
  select count(*)::integer,coalesce(sum(s.precio_gs),0)::bigint,coalesce(sum(s.duracion_min),0)::integer
    into v_service_count,v_price,v_duration
  from pg_catalog.unnest(p_servicio_ids) with ordinality requested(id,orden)
  join public.servicios s on s.user_id=v_user and s.id=requested.id
    and (s.activo or (p_turno_id is not null and exists(select 1 from public.turno_servicios previous where previous.user_id=v_user and previous.turno_id=p_turno_id and previous.servicio_id=s.id)));
  if v_service_count<>pg_catalog.cardinality(p_servicio_ids) then
    raise exception 'Uno o más servicios ya no están disponibles' using errcode='23503';
  end if;
  if v_duration>1440 then raise exception 'La duración total no puede superar 24 horas' using errcode='22023'; end if;
  select s.id into v_first_service from public.servicios s
    where s.user_id=v_user and s.id=p_servicio_ids[1]
      and (s.activo or (p_turno_id is not null and exists(select 1 from public.turno_servicios previous where previous.user_id=v_user and previous.turno_id=p_turno_id and previous.servicio_id=s.id)));
  if p_clienta_id is not null and not exists(select 1 from public.clientas c where c.id=p_clienta_id and c.user_id=v_user) then
    raise exception 'Clienta inválida' using errcode='23503';
  end if;
  if p_empleada_id is not null and not exists(select 1 from public.empleadas e where e.id=p_empleada_id and e.user_id=v_user) then
    raise exception 'Empleada inválida' using errcode='23503';
  end if;
  if p_permitir_solapamiento then perform pg_catalog.set_config('agendapora.allow_overlap','on',true); end if;
  if p_turno_id is null then
    insert into public.turnos(user_id,clienta_id,servicio_id,fecha,hora,precio_gs,duracion_min,empleada_id,estado,notas)
      values(v_user,p_clienta_id,v_first_service,p_fecha,p_hora,v_price,v_duration,p_empleada_id,p_estado,nullif(p_notas,'')) returning id into v_id;
  else
    update public.turnos set clienta_id=p_clienta_id,servicio_id=v_first_service,fecha=p_fecha,hora=p_hora,
      precio_gs=v_price,duracion_min=v_duration,empleada_id=p_empleada_id,estado=p_estado,notas=nullif(p_notas,'')
    where id=p_turno_id and user_id=v_user returning id into v_id;
  end if;
  delete from public.turno_servicios where user_id=v_user and turno_id=v_id;
  insert into public.turno_servicios(user_id,turno_id,servicio_id,servicio_nombre,precio_gs,duracion_min,orden)
  select v_user,v_id,s.id,s.nombre,s.precio_gs,s.duracion_min,requested.orden::integer
  from pg_catalog.unnest(p_servicio_ids) with ordinality requested(id,orden)
  join public.servicios s on s.user_id=v_user and s.id=requested.id;
  return v_id;
end $$;

revoke all on function public.guardar_turno_multiple(uuid,uuid,uuid[],date,time,uuid,text,text,boolean) from public,anon;
grant execute on function public.guardar_turno_multiple(uuid,uuid,uuid[],date,time,uuid,text,text,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
