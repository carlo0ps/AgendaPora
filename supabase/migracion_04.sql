-- Migración idempotente: agenda visual, cobro atómico, caja y agradecimientos.
-- Ejecutar en Supabase → SQL Editor como postgres.
begin;
alter table public.perfiles add column if not exists google_review_url text;
alter table public.turnos add column if not exists agradecido_at timestamptz;
alter table public.turnos add column if not exists precio_cierre_gs bigint;
alter table public.turnos add column if not exists comision_pct_aplicada numeric(5,2);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.perfiles'::regclass and conname='perfiles_google_review_url_check') then
    alter table public.perfiles add constraint perfiles_google_review_url_check check (google_review_url is null or (char_length(google_review_url)<=500 and google_review_url ~ '^https://'));
  end if;
end $$;

alter table public.plantillas drop constraint if exists plantillas_clave_check;
alter table public.plantillas add constraint plantillas_clave_check check (clave in ('recordatorio','deuda','promo','cumple','reactivacion','agradecimiento'));

create index if not exists turnos_user_fecha_estado_idx on public.turnos(user_id,fecha,estado);
create index if not exists pagos_user_fecha_medio_idx on public.pagos(user_id,fecha,medio);
create index if not exists pagos_user_turno_idx on public.pagos(user_id,turno_id);
create index if not exists gastos_user_fecha_idx on public.gastos(user_id,fecha);

-- Permite la excepción de solapamiento solo dentro de RPCs autenticadas que validan tenant y suscripción.
create or replace function public.validar_disponibilidad_turno()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inicio timestamp; v_fin timestamp; v_solapado boolean;
begin
  if new.estado='cancelado' or current_setting('agendapora.allow_overlap',true)='on' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || new.fecha::text, 0));
  v_inicio := new.fecha + new.hora;
  select v_inicio + make_interval(mins => coalesce(s.duracion_min,60)) into v_fin from (select 1) q left join public.servicios s on s.user_id=new.user_id and s.id=new.servicio_id;
  select exists(select 1 from public.turnos t left join public.servicios s on s.user_id=t.user_id and s.id=t.servicio_id
    where t.user_id=new.user_id and t.fecha=new.fecha and t.estado<>'cancelado' and t.id is distinct from new.id
      and (new.fecha+new.hora) < (t.fecha+t.hora+make_interval(mins=>coalesce(s.duracion_min,60)))
      and (t.fecha+t.hora) < v_fin) into v_solapado;
  if v_solapado then raise exception 'Ese horario se superpone con otro turno' using errcode='23P01'; end if;
  return new;
end $$;

-- Impide saltar el cobro rápido cambiando el estado directamente desde REST.
create or replace function public.proteger_estado_turno()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_marks_done boolean;
begin
  if tg_op='INSERT' then v_marks_done:=new.estado='hecho';
  else v_marks_done:=old.estado is distinct from 'hecho' and new.estado='hecho'; end if;
  if auth.uid() is not null and not public.es_admin() and v_marks_done
    and current_setting('agendapora.quick_charge',true) is distinct from 'on' then
    raise exception 'Usá el cobro rápido para marcar un turno como realizado' using errcode='42501';
  end if;
  if tg_op='UPDATE' and auth.uid() is not null and not public.es_admin() and old.estado='hecho' and new.estado<>'hecho'
    and current_setting('agendapora.undo_charge',true) is distinct from 'on' then
    raise exception 'Anulá el cobro desde el detalle antes de cambiar un turno realizado' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists turnos_proteger_estado on public.turnos;
create trigger turnos_proteger_estado before insert or update on public.turnos for each row execute function public.proteger_estado_turno();

create or replace function public.guardar_turno(
  p_turno_id uuid,p_clienta_id uuid,p_servicio_id uuid,p_fecha date,p_hora time,p_precio_gs bigint,
  p_empleada_id uuid,p_estado text,p_notas text,p_permitir_solapamiento boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  if p_fecha is null or p_hora is null or p_precio_gs is null or p_precio_gs<0 or p_estado is null or p_estado not in ('pendiente','hecho','cancelado') or char_length(coalesce(p_notas,''))>2000 then raise exception 'Datos del turno inválidos' using errcode='22023'; end if;
  if not exists(select 1 from public.servicios s where s.id=p_servicio_id and s.user_id=v_user) then raise exception 'Servicio inválido' using errcode='23503'; end if;
  if p_clienta_id is not null and not exists(select 1 from public.clientas c where c.id=p_clienta_id and c.user_id=v_user) then raise exception 'Clienta inválida' using errcode='23503'; end if;
  if p_empleada_id is not null and not exists(select 1 from public.empleadas e where e.id=p_empleada_id and e.user_id=v_user) then raise exception 'Empleada inválida' using errcode='23503'; end if;
  if p_permitir_solapamiento then perform set_config('agendapora.allow_overlap','on',true); end if;
  if p_turno_id is null then
    insert into public.turnos(user_id,clienta_id,servicio_id,fecha,hora,precio_gs,empleada_id,estado,notas)
      values(v_user,p_clienta_id,p_servicio_id,p_fecha,p_hora,p_precio_gs,p_empleada_id,p_estado,nullif(p_notas,'')) returning id into v_id;
  else
    update public.turnos set clienta_id=p_clienta_id,servicio_id=p_servicio_id,fecha=p_fecha,hora=p_hora,precio_gs=p_precio_gs,empleada_id=p_empleada_id,estado=p_estado,notas=nullif(p_notas,'')
      where id=p_turno_id and user_id=v_user returning id into v_id;
    if v_id is null then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.mover_turno(p_turno_id uuid,p_fecha date,p_hora time,p_permitir_solapamiento boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  if p_fecha is null or p_hora is null then raise exception 'Fecha u hora inválida' using errcode='22023'; end if;
  if p_permitir_solapamiento then perform set_config('agendapora.allow_overlap','on',true); end if;
  update public.turnos set fecha=p_fecha,hora=p_hora where id=p_turno_id and user_id=v_user and estado<>'cancelado';
  if not found then raise exception 'Turno no encontrado o cancelado' using errcode='P0002'; end if;
end $$;

create or replace function public.cobrar_turno_rapido(p_turno_id uuid,p_monto_gs bigint,p_fecha date,p_medio text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_turno public.turnos%rowtype; v_pago uuid; v_comision numeric(5,2); v_precio bigint;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  select * into v_turno from public.turnos t where t.id=p_turno_id and t.user_id=v_user for update;
  if not found then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
  if exists(select 1 from public.pagos p where p.user_id=v_user and p.turno_id=p_turno_id) then raise exception 'Este turno ya tiene un pago registrado' using errcode='23505'; end if;
  if p_fecha is null or p_medio is null or p_medio not in ('Efectivo','Transferencia','Tigo Money','Deuda') then raise exception 'Medio o fecha inválidos' using errcode='22023'; end if;
  v_precio:=coalesce(v_turno.precio_cierre_gs,v_turno.precio_gs);
  if p_medio='Deuda' then
    if p_monto_gs is distinct from 0 then raise exception 'Para cargar a deuda no se recibe un monto' using errcode='22023'; end if;
  elsif v_precio=0 then
    if p_monto_gs is distinct from 0 then raise exception 'Este servicio no tiene saldo para cobrar' using errcode='22023'; end if;
  elsif p_monto_gs is null or p_monto_gs<=0 or p_monto_gs>v_precio then raise exception 'El monto cobrado debe ser mayor que cero y no superar el precio' using errcode='22023';
  end if;
  v_comision:=coalesce((select e.comision_pct from public.empleadas e where e.user_id=v_user and e.id=v_turno.empleada_id),0);
  perform set_config('agendapora.quick_charge','on',true);
  update public.turnos set estado='hecho',precio_cierre_gs=coalesce(v_turno.precio_cierre_gs,v_turno.precio_gs),comision_pct_aplicada=coalesce(v_turno.comision_pct_aplicada,v_comision) where id=p_turno_id and user_id=v_user;
  if p_medio<>'Deuda' and p_monto_gs>0 then
    insert into public.pagos(user_id,turno_id,clienta_id,fecha,monto_gs,medio,nota)
      values(v_user,p_turno_id,v_turno.clienta_id,p_fecha,p_monto_gs,p_medio,'Cobro rápido') returning id into v_pago;
  end if;
  return jsonb_build_object('turno_id',p_turno_id,'pago_id',v_pago,'monto_gs',coalesce(p_monto_gs,0),'deuda_gs',case when p_medio='Deuda' then v_precio else v_precio-p_monto_gs end);
end $$;

create or replace function public.anular_cobro_turno(p_turno_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  perform 1 from public.turnos where id=p_turno_id and user_id=v_user for update;
  if not found then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
  if (select count(*) from public.pagos where user_id=v_user and turno_id=p_turno_id)>1 then
    raise exception 'Este turno tiene varios abonos; revisá el historial antes de anularlos' using errcode='23514';
  end if;
  delete from public.pagos where user_id=v_user and turno_id=p_turno_id;
  perform set_config('agendapora.undo_charge','on',true);
  update public.turnos set estado='pendiente',agradecido_at=null,precio_cierre_gs=null,comision_pct_aplicada=null where id=p_turno_id and user_id=v_user;
end $$;

create or replace function public.marcar_agradecido(p_turno_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  update public.turnos set agradecido_at=coalesce(agradecido_at,now()) where id=p_turno_id and user_id=v_user and estado='hecho';
  if not found then raise exception 'Turno no encontrado o no realizado' using errcode='P0002'; end if;
end $$;

-- Añade la plantilla solo si falta, preservando cualquier edición existente al repetir la migración.
create or replace function public.crear_plantilla_agradecimiento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.plantillas(user_id,clave,nombre,contenido)
  values(new.user_id,'agradecimiento','Agradecimiento y reseña','Gracias por venir, {nombre} 💕 ¿Nos dejás una reseña? {resena}')
  on conflict(user_id,clave) do nothing;
  return new;
end $$;
drop trigger if exists perfiles_plantilla_agradecimiento on public.perfiles;
create trigger perfiles_plantilla_agradecimiento after insert on public.perfiles for each row execute function public.crear_plantilla_agradecimiento();

insert into public.plantillas(user_id,clave,nombre,contenido)
select p.user_id,'agradecimiento','Agradecimiento y reseña','Gracias por venir, {nombre} 💕 ¿Nos dejás una reseña? {resena}'
from public.perfiles p
on conflict (user_id,clave) do nothing;

-- El enlace de reseñas solo lo puede editar su propietaria activa, mediante columna permitida.
grant select(google_review_url) on public.perfiles to authenticated;
grant update(google_review_url) on public.perfiles to authenticated;

grant execute on function public.guardar_turno(uuid,uuid,uuid,date,time,bigint,uuid,text,text,boolean) to authenticated;
grant execute on function public.mover_turno(uuid,date,time,boolean) to authenticated;
grant execute on function public.cobrar_turno_rapido(uuid,bigint,date,text) to authenticated;
grant execute on function public.anular_cobro_turno(uuid) to authenticated;
grant execute on function public.marcar_agradecido(uuid) to authenticated;
revoke all on function public.crear_plantilla_agradecimiento() from public,anon,authenticated;
revoke all on function public.proteger_estado_turno() from public,anon,authenticated;
revoke all on function public.guardar_turno(uuid,uuid,uuid,date,time,bigint,uuid,text,text,boolean) from public,anon;
revoke all on function public.mover_turno(uuid,date,time,boolean) from public,anon;
revoke all on function public.cobrar_turno_rapido(uuid,bigint,date,text) from public,anon;
revoke all on function public.anular_cobro_turno(uuid) from public,anon;
revoke all on function public.marcar_agradecido(uuid) from public,anon;
commit;
