-- Cierre diario: fija precio y comisión al completar un turno y protege esos valores.
-- Idempotente. Ejecutar en Supabase → SQL Editor después de migracion_04.sql y migracion_05.sql.
begin;

alter table public.turnos add column if not exists precio_cierre_gs bigint;
alter table public.turnos add column if not exists comision_pct_aplicada numeric(5,2);
create index if not exists pagos_user_turno_idx on public.pagos(user_id,turno_id);
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.turnos'::regclass and conname = 'turnos_precio_cierre_gs_check'
  ) then
    alter table public.turnos add constraint turnos_precio_cierre_gs_check
      check (precio_cierre_gs is null or precio_cierre_gs >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.turnos'::regclass and conname = 'turnos_comision_pct_aplicada_check'
  ) then
    alter table public.turnos add constraint turnos_comision_pct_aplicada_check
      check (comision_pct_aplicada is null or comision_pct_aplicada between 0 and 100);
  end if;
end $$;

-- Para cierres anteriores se toma la tarifa y comisión actuales como mejor dato disponible.
update public.turnos t
set precio_cierre_gs = coalesce(t.precio_cierre_gs, t.precio_gs),
    comision_pct_aplicada = coalesce(t.comision_pct_aplicada, (
      select e.comision_pct from public.empleadas e
      where e.user_id = t.user_id and e.id = t.empleada_id
    ), 0)
where t.estado = 'hecho'
  and (t.precio_cierre_gs is null or t.comision_pct_aplicada is null);

create or replace function public.cobrar_turno_rapido(p_turno_id uuid,p_monto_gs bigint,p_fecha date,p_medio text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_turno public.turnos%rowtype;
  v_pago uuid;
  v_comision numeric(5,2);
  v_precio bigint;
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  select * into v_turno from public.turnos t
    where t.id = p_turno_id and t.user_id = v_user for update;
  if not found then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
  if exists(select 1 from public.pagos p where p.user_id = v_user and p.turno_id = p_turno_id) then
    raise exception 'Este turno ya tiene un pago registrado' using errcode='23505';
  end if;
  if p_fecha is null or p_medio is null or p_medio not in ('Efectivo','Transferencia','Tigo Money','Deuda') then
    raise exception 'Medio o fecha inválidos' using errcode='22023';
  end if;
  v_precio := coalesce(v_turno.precio_cierre_gs, v_turno.precio_gs);
  if p_medio = 'Deuda' then
    if p_monto_gs is distinct from 0 then raise exception 'Para cargar a deuda no se recibe un monto' using errcode='22023'; end if;
  elsif v_precio = 0 then
    if p_monto_gs is distinct from 0 then raise exception 'Este servicio no tiene saldo para cobrar' using errcode='22023'; end if;
  elsif p_monto_gs is null or p_monto_gs <= 0 or p_monto_gs > v_precio then
    raise exception 'El monto cobrado debe ser mayor que cero y no superar el precio' using errcode='22023';
  end if;
  v_comision := coalesce((select e.comision_pct from public.empleadas e where e.user_id = v_user and e.id = v_turno.empleada_id), 0);
  perform set_config('agendapora.quick_charge', 'on', true);
  update public.turnos
    set estado = 'hecho',
        precio_cierre_gs = coalesce(v_turno.precio_cierre_gs, v_turno.precio_gs),
        comision_pct_aplicada = coalesce(v_turno.comision_pct_aplicada, v_comision)
    where id = p_turno_id and user_id = v_user;
  if p_medio <> 'Deuda' and p_monto_gs > 0 then
    insert into public.pagos(user_id,turno_id,clienta_id,fecha,monto_gs,medio,nota)
    values(v_user,p_turno_id,v_turno.clienta_id,p_fecha,p_monto_gs,p_medio,'Cobro rápido') returning id into v_pago;
  end if;
  return jsonb_build_object('turno_id',p_turno_id,'pago_id',v_pago,'monto_gs',coalesce(p_monto_gs,0),
    'deuda_gs',case when p_medio = 'Deuda' then v_precio else v_precio - p_monto_gs end);
end $$;

create or replace function public.anular_cobro_turno(p_turno_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  perform 1 from public.turnos where id = p_turno_id and user_id = v_user for update;
  if not found then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
  if (select count(*) from public.pagos where user_id = v_user and turno_id = p_turno_id) > 1 then
    raise exception 'Este turno tiene varios abonos; revisá el historial antes de anularlos' using errcode='23514';
  end if;
  delete from public.pagos where user_id = v_user and turno_id = p_turno_id;
  perform set_config('agendapora.undo_charge', 'on', true);
  update public.turnos
    set estado = 'pendiente', agradecido_at = null, precio_cierre_gs = null, comision_pct_aplicada = null
    where id = p_turno_id and user_id = v_user;
end $$;

create or replace function public.proteger_datos_cierre_turno()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.es_admin()
    and current_setting('agendapora.quick_charge', true) is distinct from 'on'
    and current_setting('agendapora.undo_charge', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      if new.precio_cierre_gs is not null or new.comision_pct_aplicada is not null then
        raise exception 'Los valores de cierre se fijan al cobrar el turno' using errcode='42501';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.precio_cierre_gs is distinct from old.precio_cierre_gs
        or new.comision_pct_aplicada is distinct from old.comision_pct_aplicada then
        raise exception 'Los valores históricos del cierre no se pueden modificar' using errcode='42501';
      end if;
      if old.estado = 'hecho' and (
        new.estado is distinct from old.estado
        or new.fecha is distinct from old.fecha
        or new.hora is distinct from old.hora
        or new.precio_gs is distinct from old.precio_gs
        or new.servicio_id is distinct from old.servicio_id
        or new.empleada_id is distinct from old.empleada_id
        or new.clienta_id is distinct from old.clienta_id
      ) then
        raise exception 'Anulá el cobro antes de cambiar un turno realizado' using errcode='42501';
      end if;
    elsif tg_op = 'DELETE' and old.estado = 'hecho' then
      raise exception 'Anulá el cobro antes de borrar un turno realizado' using errcode='42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists turnos_proteger_datos_cierre on public.turnos;
create trigger turnos_proteger_datos_cierre before insert or update or delete on public.turnos
  for each row execute function public.proteger_datos_cierre_turno();

notify pgrst, 'reload schema';
commit;
