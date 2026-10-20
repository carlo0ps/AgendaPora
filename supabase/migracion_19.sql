-- Caja por sesiones, movimientos de efectivo y cierres inmutables.
-- Ejecutar como postgres después de migracion_18.sql. Idempotente.
begin;

create table if not exists public.cajas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fecha date not null default ((now() at time zone 'America/Asuncion')::date),
  created_at timestamptz not null default now(),
  abierta_at timestamptz not null default now(),
  abierta_por uuid not null default auth.uid(),
  monto_inicial_gs bigint not null check (monto_inicial_gs >= 0),
  cerrada_at timestamptz,
  cerrada_por uuid,
  efectivo_contado_gs bigint,
  efectivo_esperado_gs bigint,
  diferencia_gs bigint,
  snapshot jsonb,
  unique(user_id,id),
  constraint cajas_cierre_check check (
    (cerrada_at is null and cerrada_por is null and efectivo_contado_gs is null
      and efectivo_esperado_gs is null and diferencia_gs is null and snapshot is null)
    or (cerrada_at is not null and cerrada_por is not null and efectivo_contado_gs is not null
      and efectivo_esperado_gs is not null and diferencia_gs is not null and snapshot is not null)
  )
);
alter table public.cajas add column if not exists created_at timestamptz not null default now();
create unique index if not exists cajas_una_abierta_por_salon_uidx
  on public.cajas(user_id) where cerrada_at is null;
create index if not exists cajas_user_fecha_idx on public.cajas(user_id,fecha desc,abierta_at desc);

alter table public.pagos add column if not exists caja_id uuid;
alter table public.gastos add column if not exists caja_id uuid;
alter table public.gastos add column if not exists medio_pago text not null default 'Efectivo';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.pagos'::regclass and conname='pagos_caja_fk') then
    alter table public.pagos add constraint pagos_caja_fk
      foreign key(user_id,caja_id) references public.cajas(user_id,id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.gastos'::regclass and conname='gastos_caja_fk') then
    alter table public.gastos add constraint gastos_caja_fk
      foreign key(user_id,caja_id) references public.cajas(user_id,id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.gastos'::regclass and conname='gastos_medio_pago_check') then
    alter table public.gastos add constraint gastos_medio_pago_check
      check (char_length(medio_pago) between 1 and 40);
  end if;
end $$;

create table if not exists public.caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  caja_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  tipo text not null check (tipo in ('entrada','salida')),
  categoria text not null check (categoria in ('retiro','adelanto','cambio','otros','ajuste','cobro_efectivo','gasto_efectivo')),
  concepto text not null check (char_length(btrim(concepto)) between 1 and 120),
  monto_gs bigint not null check (monto_gs > 0),
  motivo text check (motivo is null or char_length(btrim(motivo)) between 1 and 500),
  pago_id uuid,
  gasto_id uuid,
  unique(user_id,id),
  constraint caja_movimientos_caja_fk foreign key(user_id,caja_id)
    references public.cajas(user_id,id) on delete cascade,
  constraint caja_movimientos_pago_fk foreign key(user_id,pago_id)
    references public.pagos(user_id,id) on delete cascade,
  constraint caja_movimientos_gasto_fk foreign key(user_id,gasto_id)
    references public.gastos(user_id,id) on delete cascade,
  constraint caja_movimientos_origen_check check (
    (pago_id is null and gasto_id is null and categoria in ('retiro','adelanto','cambio','otros','ajuste'))
    or (pago_id is not null and gasto_id is null and tipo='entrada' and categoria='cobro_efectivo')
    or (pago_id is null and gasto_id is not null and tipo='salida' and categoria='gasto_efectivo')
  ),
  constraint caja_movimientos_ajuste_motivo_check check (categoria<>'ajuste' or motivo is not null)
);
create index if not exists caja_movimientos_user_caja_fecha_idx
  on public.caja_movimientos(user_id,caja_id,created_at,id);
create unique index if not exists caja_movimientos_pago_uidx
  on public.caja_movimientos(pago_id) where pago_id is not null;
create unique index if not exists caja_movimientos_gasto_uidx
  on public.caja_movimientos(gasto_id) where gasto_id is not null;

alter table public.cajas enable row level security;
alter table public.caja_movimientos enable row level security;
drop policy if exists cajas_select_own on public.cajas;
create policy cajas_select_own on public.cajas for select to authenticated
  using ((select auth.uid())=user_id);
drop policy if exists cajas_insert_rpc_only on public.cajas;
create policy cajas_insert_rpc_only on public.cajas for insert to authenticated
  with check ((select auth.uid())=user_id and false);
drop policy if exists cajas_update_rpc_only on public.cajas;
create policy cajas_update_rpc_only on public.cajas for update to authenticated
  using ((select auth.uid())=user_id and false) with check ((select auth.uid())=user_id and false);
drop policy if exists cajas_delete_rpc_only on public.cajas;
create policy cajas_delete_rpc_only on public.cajas for delete to authenticated
  using ((select auth.uid())=user_id and false);
drop policy if exists caja_movimientos_select_own on public.caja_movimientos;
create policy caja_movimientos_select_own on public.caja_movimientos for select to authenticated
  using ((select auth.uid())=user_id);
drop policy if exists caja_movimientos_insert_rpc_only on public.caja_movimientos;
create policy caja_movimientos_insert_rpc_only on public.caja_movimientos for insert to authenticated
  with check ((select auth.uid())=user_id and false);
drop policy if exists caja_movimientos_update_rpc_only on public.caja_movimientos;
create policy caja_movimientos_update_rpc_only on public.caja_movimientos for update to authenticated
  using ((select auth.uid())=user_id and false) with check ((select auth.uid())=user_id and false);
drop policy if exists caja_movimientos_delete_rpc_only on public.caja_movimientos;
create policy caja_movimientos_delete_rpc_only on public.caja_movimientos for delete to authenticated
  using ((select auth.uid())=user_id and false);
revoke all on public.cajas,public.caja_movimientos from anon,public,authenticated;
grant select on public.cajas,public.caja_movimientos to authenticated;

-- Los datos financieros se escriben mediante RPC; el estado de caja se calcula al registrar.
drop policy if exists gastos_insert_active on public.gastos;
drop policy if exists gastos_insert_rpc_only on public.gastos;
create policy gastos_insert_rpc_only on public.gastos for insert to authenticated with check (false);
drop policy if exists gastos_update_active on public.gastos;
drop policy if exists gastos_update_rpc_only on public.gastos;
create policy gastos_update_rpc_only on public.gastos for update to authenticated using (false) with check (false);
drop policy if exists gastos_delete_active on public.gastos;
drop policy if exists gastos_delete_rpc_only on public.gastos;
create policy gastos_delete_rpc_only on public.gastos for delete to authenticated using (false);
revoke insert,update,delete on public.gastos from authenticated;

create or replace function public.proteger_caja()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    if pg_catalog.current_setting('agendapora.seed_caja_reset',true)='on' then return old; end if;
    if pg_catalog.pg_trigger_depth()>1 then return old; end if;
    raise exception 'Las cajas no se pueden borrar' using errcode='42501';
  end if;
  if old.cerrada_at is not null then
    raise exception 'La caja está cerrada y no se puede modificar; registrá un ajuste en una caja abierta' using errcode='42501';
  end if;
  if pg_catalog.current_setting('agendapora.cash_close',true) is distinct from 'on'
    or new.user_id is distinct from old.user_id
    or new.fecha is distinct from old.fecha
    or new.abierta_at is distinct from old.abierta_at
    or new.abierta_por is distinct from old.abierta_por
    or new.monto_inicial_gs is distinct from old.monto_inicial_gs then
    raise exception 'La caja abierta solo puede cerrarse mediante la operación de cierre' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists cajas_proteger on public.cajas;
create trigger cajas_proteger before update or delete on public.cajas
  for each row execute function public.proteger_caja();

create or replace function public.proteger_movimiento_caja()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' and pg_catalog.current_setting('agendapora.seed_caja_reset',true)='on' then return old; end if;
  if pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if tg_op='DELETE' then
    raise exception 'Los movimientos de caja son inmutables; registrá un ajuste con motivo' using errcode='42501';
  end if;
  raise exception 'Los movimientos de caja son inmutables; registrá un ajuste con motivo' using errcode='42501';
end $$;
drop trigger if exists caja_movimientos_proteger on public.caja_movimientos;
create trigger caja_movimientos_proteger before update or delete on public.caja_movimientos
  for each row execute function public.proteger_movimiento_caja();

create or replace function public.preparar_pago_caja()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_hoy date; v_caja uuid; v_cerrada timestamptz;
begin
  if tg_op='UPDATE' or tg_op='DELETE' then
    if tg_op='DELETE' and pg_catalog.current_setting('agendapora.seed_caja_reset',true)='on' then return old; end if;
    if old.caja_id is not null then
      select c.cerrada_at into v_cerrada from public.cajas c
        where c.user_id=old.user_id and c.id=old.caja_id for update;
      if v_cerrada is not null then
        raise exception 'El pago pertenece a una caja cerrada; registrá un ajuste con motivo' using errcode='42501';
      end if;
    end if;
    if tg_op='DELETE' then return old; end if;
    if new.user_id is distinct from old.user_id or new.caja_id is distinct from old.caja_id then
      raise exception 'No se puede mover un pago entre salones o cajas' using errcode='42501';
    end if;
    return new;
  end if;

  v_hoy := (pg_catalog.now() at time zone 'America/Asuncion')::date;
  new.caja_id := null;
  if new.fecha=v_hoy then
    select c.id into v_caja from public.cajas c
      where c.user_id=new.user_id and c.fecha=v_hoy and c.cerrada_at is null for update;
    if lower(btrim(new.medio))='efectivo' and v_caja is null then
      raise exception 'Abrí una caja para registrar un pago en efectivo' using errcode='23514';
    end if;
    new.caja_id := v_caja;
  end if;
  return new;
end $$;
drop trigger if exists pagos_preparar_caja on public.pagos;
create trigger pagos_preparar_caja before insert or update or delete on public.pagos
  for each row execute function public.preparar_pago_caja();

create or replace function public.sincronizar_pago_caja()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op<>'INSERT' then delete from public.caja_movimientos m where m.pago_id=old.id; end if;
  if tg_op<>'DELETE' and new.caja_id is not null and lower(btrim(new.medio))='efectivo' then
    insert into public.caja_movimientos(user_id,caja_id,created_by,tipo,categoria,concepto,monto_gs,pago_id)
    values(new.user_id,new.caja_id,new.user_id,'entrada','cobro_efectivo','Cobro de turno',new.monto_gs,new.id)
    on conflict(pago_id) where pago_id is not null do update
      set monto_gs=excluded.monto_gs,caja_id=excluded.caja_id,user_id=excluded.user_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists pagos_sincronizar_caja on public.pagos;
create trigger pagos_sincronizar_caja after insert or update or delete on public.pagos
  for each row execute function public.sincronizar_pago_caja();

create or replace function public.preparar_gasto_caja()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_hoy date; v_caja uuid; v_cerrada timestamptz;
begin
  if tg_op='UPDATE' or tg_op='DELETE' then
    if tg_op='DELETE' and pg_catalog.current_setting('agendapora.seed_caja_reset',true)='on' then return old; end if;
    if old.caja_id is not null then
      select c.cerrada_at into v_cerrada from public.cajas c
        where c.user_id=old.user_id and c.id=old.caja_id for update;
      if v_cerrada is not null then
        raise exception 'El gasto pertenece a una caja cerrada; registrá un ajuste con motivo' using errcode='42501';
      end if;
    end if;
    if tg_op='DELETE' then return old; end if;
    if new.user_id is distinct from old.user_id or new.caja_id is distinct from old.caja_id then
      raise exception 'No se puede mover un gasto entre salones o cajas' using errcode='42501';
    end if;
    return new;
  end if;

  v_hoy := (pg_catalog.now() at time zone 'America/Asuncion')::date;
  new.caja_id := null;
  if new.fecha=v_hoy then
    select c.id into v_caja from public.cajas c
      where c.user_id=new.user_id and c.fecha=v_hoy and c.cerrada_at is null for update;
    if lower(btrim(new.medio_pago))='efectivo' and v_caja is null then
      raise exception 'Abrí una caja para registrar un gasto en efectivo' using errcode='23514';
    end if;
    new.caja_id := v_caja;
  end if;
  return new;
end $$;
drop trigger if exists gastos_preparar_caja on public.gastos;
create trigger gastos_preparar_caja before insert or update or delete on public.gastos
  for each row execute function public.preparar_gasto_caja();

create or replace function public.sincronizar_gasto_caja()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op<>'INSERT' then delete from public.caja_movimientos m where m.gasto_id=old.id; end if;
  if tg_op<>'DELETE' and new.caja_id is not null and lower(btrim(new.medio_pago))='efectivo' then
    insert into public.caja_movimientos(user_id,caja_id,created_by,tipo,categoria,concepto,monto_gs,gasto_id)
    values(new.user_id,new.caja_id,new.user_id,'salida','gasto_efectivo',new.concepto,new.monto_gs,new.id)
    on conflict(gasto_id) where gasto_id is not null do update
      set monto_gs=excluded.monto_gs,caja_id=excluded.caja_id,user_id=excluded.user_id,concepto=excluded.concepto;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists gastos_sincronizar_caja on public.gastos;
create trigger gastos_sincronizar_caja after insert or update or delete on public.gastos
  for each row execute function public.sincronizar_gasto_caja();

create or replace function public.caja_resumen_actual(p_user_id uuid,p_caja_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_caja public.cajas%rowtype;
  v_entradas bigint; v_salidas bigint; v_cobros bigint; v_gastos_efectivo bigint;
  v_entradas_manuales bigint; v_salidas_manuales bigint; v_pagos jsonb; v_gastos jsonb;
begin
  select * into v_caja from public.cajas c where c.user_id=p_user_id and c.id=p_caja_id;
  if not found then return null; end if;
  select coalesce(sum(m.monto_gs) filter(where m.tipo='entrada'),0)::bigint,
      coalesce(sum(m.monto_gs) filter(where m.tipo='salida'),0)::bigint,
      coalesce(sum(m.monto_gs) filter(where m.pago_id is not null),0)::bigint,
      coalesce(sum(m.monto_gs) filter(where m.gasto_id is not null),0)::bigint,
      coalesce(sum(m.monto_gs) filter(where m.tipo='entrada' and m.pago_id is null and m.gasto_id is null),0)::bigint,
      coalesce(sum(m.monto_gs) filter(where m.tipo='salida' and m.pago_id is null and m.gasto_id is null),0)::bigint
    into v_entradas,v_salidas,v_cobros,v_gastos_efectivo,v_entradas_manuales,v_salidas_manuales
    from public.caja_movimientos m where m.user_id=p_user_id and m.caja_id=p_caja_id;
  select coalesce(jsonb_object_agg(q.medio,q.total),'{}'::jsonb) into v_pagos from (
    select p.medio,sum(p.monto_gs)::bigint as total from public.pagos p
    where p.user_id=p_user_id and p.caja_id=p_caja_id group by p.medio
  ) q;
  select coalesce(jsonb_object_agg(q.medio,q.total),'{}'::jsonb) into v_gastos from (
    select g.medio_pago as medio,sum(g.monto_gs)::bigint as total from public.gastos g
    where g.user_id=p_user_id and g.caja_id=p_caja_id group by g.medio_pago
  ) q;
  return jsonb_build_object(
    'efectivo_inicial_gs',v_caja.monto_inicial_gs,
    'cobros_efectivo_gs',v_cobros,
    'gastos_efectivo_gs',v_gastos_efectivo,
    'entradas_manuales_gs',v_entradas_manuales,
    'salidas_manuales_gs',v_salidas_manuales,
    'entradas_totales_gs',v_entradas,
    'salidas_totales_gs',v_salidas,
    'efectivo_esperado_gs',v_caja.monto_inicial_gs+v_entradas-v_salidas,
    'pagos_por_medio',v_pagos,
    'gastos_por_medio',v_gastos
  );
end $$;

create or replace function public.abrir_caja(p_monto_inicial_gs bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_hoy date;
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  if p_monto_inicial_gs is null or p_monto_inicial_gs<0 then
    raise exception 'El monto inicial debe ser cero o mayor' using errcode='22023';
  end if;
  v_hoy := (pg_catalog.now() at time zone 'America/Asuncion')::date;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':caja',0));
  if exists(select 1 from public.cajas c where c.user_id=v_user and c.cerrada_at is null) then
    raise exception 'Ya hay una caja abierta para este salón' using errcode='23505';
  end if;
  insert into public.cajas(user_id,fecha,abierta_at,abierta_por,monto_inicial_gs)
    values(v_user,v_hoy,pg_catalog.clock_timestamp(),v_user,p_monto_inicial_gs) returning id into v_id;
  return public.caja_detalle(v_id);
end $$;

create or replace function public.registrar_movimiento_caja(
  p_tipo text,p_categoria text,p_concepto text,p_monto_gs bigint,p_motivo text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_caja public.cajas%rowtype; v_id uuid;
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  if p_tipo is null or p_tipo not in ('entrada','salida')
    or p_categoria is null or p_categoria not in ('retiro','adelanto','cambio','otros','ajuste')
    or p_concepto is null or char_length(btrim(p_concepto)) not between 1 and 120
    or p_monto_gs is null or p_monto_gs<=0
    or (p_categoria='ajuste' and (nullif(btrim(p_motivo),'') is null or char_length(btrim(p_motivo))>500))
    or (p_categoria<>'ajuste' and p_motivo is not null and char_length(btrim(p_motivo))>500) then
    raise exception 'Revisá tipo, categoría, concepto, monto y motivo del movimiento' using errcode='22023';
  end if;
  select * into v_caja from public.cajas c where c.user_id=v_user and c.fecha=(pg_catalog.now() at time zone 'America/Asuncion')::date
    and c.cerrada_at is null for update;
  if not found then raise exception 'Abrí una caja antes de registrar movimientos' using errcode='P0002'; end if;
  insert into public.caja_movimientos(user_id,caja_id,created_by,tipo,categoria,concepto,monto_gs,motivo)
    values(v_user,v_caja.id,v_user,p_tipo,p_categoria,btrim(p_concepto),p_monto_gs,nullif(btrim(p_motivo),'')) returning id into v_id;
  return v_id;
end $$;

create or replace function public.registrar_gasto(
  p_fecha date,p_concepto text,p_categoria text,p_monto_gs bigint,p_medio_pago text default 'Efectivo',p_nota text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  if p_fecha is null or p_concepto is null or char_length(btrim(p_concepto)) not between 1 and 120
    or p_categoria is not null and char_length(btrim(p_categoria))>60
    or p_monto_gs is null or p_monto_gs<=0
    or p_medio_pago is null or p_medio_pago not in ('Efectivo','Transferencia','Tigo Money','Otro')
    or p_nota is not null and char_length(p_nota)>1000 then
    raise exception 'Revisá fecha, concepto, categoría, monto y medio de pago del gasto' using errcode='22023';
  end if;
  insert into public.gastos(user_id,fecha,concepto,categoria,monto_gs,medio_pago,nota)
    values(v_user,p_fecha,btrim(p_concepto),nullif(btrim(p_categoria),''),p_monto_gs,p_medio_pago,nullif(btrim(p_nota),'')) returning id into v_id;
  return v_id;
end $$;

create or replace function public.eliminar_gasto(p_gasto_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  delete from public.gastos g where g.user_id=v_user and g.id=p_gasto_id;
  if not found then raise exception 'No se encontró un gasto de esta cuenta' using errcode='P0002'; end if;
end $$;

create or replace function public.caja_detalle(p_caja_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_caja public.cajas%rowtype; v_movimientos jsonb;
begin
  if v_user is null then raise exception 'Iniciá sesión para consultar la caja' using errcode='42501'; end if;
  perform public.cuenta_activa(); -- La consulta conserva acceso de solo lectura para cuentas vencidas.
  select * into v_caja from public.cajas c where c.user_id=v_user and c.id=p_caja_id;
  if not found then raise exception 'Caja no encontrada' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb) into v_movimientos
    from public.caja_movimientos m where m.user_id=v_user and m.caja_id=p_caja_id;
  return jsonb_build_object('caja',to_jsonb(v_caja),'movimientos',v_movimientos);
end $$;

create or replace function public.caja_datos(p_desde date default null,p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid(); v_caja public.cajas%rowtype; v_activa jsonb; v_movimientos jsonb; v_historial jsonb;
begin
  if v_user is null then raise exception 'Iniciá sesión para consultar la caja' using errcode='42501'; end if;
  perform public.cuenta_activa(); -- Las lecturas propias siguen disponibles tras el vencimiento.
  if p_desde is not null and p_hasta is not null and p_desde>p_hasta then
    raise exception 'El rango de fechas no es válido' using errcode='22023';
  end if;
  select * into v_caja from public.cajas c where c.user_id=v_user and c.cerrada_at is null;
  if found then
    v_activa:=to_jsonb(v_caja)||jsonb_build_object('totales_actuales',public.caja_resumen_actual(v_user,v_caja.id));
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb) into v_movimientos
      from public.caja_movimientos m where m.user_id=v_user and m.caja_id=v_caja.id;
  else
    v_activa:=null;
    v_movimientos:='[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.fecha desc,h.abierta_at desc),'[]'::jsonb) into v_historial
  from (
    select c.id,c.fecha,c.abierta_at,c.abierta_por,c.monto_inicial_gs,c.cerrada_at,c.cerrada_por,
      c.efectivo_contado_gs,c.efectivo_esperado_gs,c.diferencia_gs,c.snapshot
    from public.cajas c where c.user_id=v_user and c.cerrada_at is not null
      and (p_desde is null or c.fecha>=p_desde) and (p_hasta is null or c.fecha<=p_hasta)
    order by c.fecha desc,c.abierta_at desc
  ) h;
  return jsonb_build_object('caja_abierta',v_activa,'movimientos',v_movimientos,'historial',v_historial);
end $$;

create or replace function public.cerrar_caja(p_efectivo_contado_gs bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid(); v_caja public.cajas%rowtype; v_snapshot jsonb;
  v_esperado bigint; v_diferencia bigint; v_cerrada_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  if p_efectivo_contado_gs is null or p_efectivo_contado_gs<0 then
    raise exception 'El efectivo contado debe ser cero o mayor' using errcode='22023';
  end if;
  select * into v_caja from public.cajas c where c.user_id=v_user and c.cerrada_at is null for update;
  if not found then raise exception 'No hay una caja abierta para cerrar' using errcode='P0002'; end if;
  v_snapshot:=public.caja_resumen_actual(v_user,v_caja.id);
  v_esperado:=(v_snapshot->>'efectivo_esperado_gs')::bigint;
  v_diferencia:=p_efectivo_contado_gs-v_esperado;
  v_snapshot:=v_snapshot||jsonb_build_object(
    'cerrada_at',v_cerrada_at,
    'efectivo_contado_gs',p_efectivo_contado_gs,
    'diferencia_gs',v_diferencia,
    'resultado',case when v_diferencia>0 then 'sobrante' when v_diferencia<0 then 'faltante' else 'sin diferencia' end
  );
  perform pg_catalog.set_config('agendapora.cash_close','on',true);
  update public.cajas set cerrada_at=v_cerrada_at,cerrada_por=v_user,
    efectivo_contado_gs=p_efectivo_contado_gs,efectivo_esperado_gs=v_esperado,
    diferencia_gs=v_diferencia,snapshot=v_snapshot where id=v_caja.id and user_id=v_user;
  return jsonb_build_object('id',v_caja.id,'efectivo_esperado_gs',v_esperado,
    'efectivo_contado_gs',p_efectivo_contado_gs,'diferencia_gs',v_diferencia,'snapshot',v_snapshot);
end $$;

-- Extiende el respaldo administrativo existente con la nueva información de caja.
create or replace function public.admin_respaldo_caja_pagina(
  p_tabla text,p_offset integer default 0,p_limite integer default 250
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_total bigint; v_filas jsonb;
begin
  if auth.uid() is null or not public.es_admin() or not public.cuenta_activa() then
    raise exception 'Solo administración' using errcode='42501';
  end if;
  if p_tabla is null or p_tabla not in ('cajas','caja_movimientos') then
    raise exception 'Tabla de respaldo inválida' using errcode='22023';
  end if;
  if p_offset is null or p_offset<0 or p_limite is null or p_limite not between 1 and 500 then
    raise exception 'Parámetros de paginación inválidos' using errcode='22023';
  end if;
  if p_tabla='cajas' then
    select count(*) into v_total from public.cajas c
      where exists(select 1 from public.perfiles p where p.user_id=c.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.fecha,x.abierta_at,x.id),'[]'::jsonb) into v_filas
      from (select c.* from public.cajas c
        where exists(select 1 from public.perfiles p where p.user_id=c.user_id and not p.es_admin)
        order by c.user_id,c.fecha,c.abierta_at,c.id limit p_limite offset p_offset) x;
  else
    select count(*) into v_total from public.caja_movimientos m
      where exists(select 1 from public.perfiles p where p.user_id=m.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.caja_id,x.created_at,x.id),'[]'::jsonb) into v_filas
      from (select m.* from public.caja_movimientos m
        where exists(select 1 from public.perfiles p where p.user_id=m.user_id and not p.es_admin)
        order by m.user_id,m.caja_id,m.created_at,m.id limit p_limite offset p_offset) x;
  end if;
  return jsonb_build_object('tabla',p_tabla,'offset',p_offset,'limite',p_limite,'total',v_total,'filas',v_filas);
end $$;

revoke all on function public.proteger_caja() from public,anon,authenticated;
revoke all on function public.proteger_movimiento_caja() from public,anon,authenticated;
revoke all on function public.preparar_pago_caja() from public,anon,authenticated;
revoke all on function public.sincronizar_pago_caja() from public,anon,authenticated;
revoke all on function public.preparar_gasto_caja() from public,anon,authenticated;
revoke all on function public.sincronizar_gasto_caja() from public,anon,authenticated;
revoke all on function public.caja_resumen_actual(uuid,uuid) from public,anon,authenticated;
revoke all on function public.abrir_caja(bigint) from public,anon;
revoke all on function public.registrar_movimiento_caja(text,text,text,bigint,text) from public,anon;
revoke all on function public.registrar_gasto(date,text,text,bigint,text,text) from public,anon;
revoke all on function public.eliminar_gasto(uuid) from public,anon;
revoke all on function public.caja_detalle(uuid) from public,anon;
revoke all on function public.caja_datos(date,date) from public,anon;
revoke all on function public.cerrar_caja(bigint) from public,anon;
revoke all on function public.admin_respaldo_caja_pagina(text,integer,integer) from public,anon;
grant execute on function public.abrir_caja(bigint) to authenticated;
grant execute on function public.registrar_movimiento_caja(text,text,text,bigint,text) to authenticated;
grant execute on function public.registrar_gasto(date,text,text,bigint,text,text) to authenticated;
grant execute on function public.eliminar_gasto(uuid) to authenticated;
grant execute on function public.caja_detalle(uuid) to authenticated;
grant execute on function public.caja_datos(date,date) to authenticated;
grant execute on function public.cerrar_caja(bigint) to authenticated;
grant execute on function public.admin_respaldo_caja_pagina(text,integer,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
