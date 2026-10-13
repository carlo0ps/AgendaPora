-- Permite registrar un abono parcial desde la opción Deuda; el resto queda pendiente.
-- Ejecutar en Supabase → SQL Editor como postgres. Es idempotente.
begin;

create or replace function public.cobrar_turno_rapido(
  p_turno_id uuid,
  p_monto_gs bigint,
  p_fecha date,
  p_medio text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_turno public.turnos%rowtype;
  v_pago uuid;
  v_comision numeric(5,2);
  v_precio bigint;
  v_medio_pago text;
  v_nota text;
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  select * into v_turno
  from public.turnos t
  where t.id=p_turno_id and t.user_id=v_user
  for update;
  if not found then raise exception 'Turno no encontrado' using errcode='P0002'; end if;
  if exists(select 1 from public.pagos p where p.user_id=v_user and p.turno_id=p_turno_id) then
    raise exception 'Este turno ya tiene un pago registrado' using errcode='23505';
  end if;
  if p_fecha is null or p_medio is null or p_medio not in ('Efectivo','Transferencia','Tigo Money','Deuda') then
    raise exception 'Medio o fecha inválidos' using errcode='22023';
  end if;

  v_precio:=coalesce(v_turno.precio_cierre_gs,v_turno.precio_gs);
  if p_medio='Deuda' then
    if p_monto_gs is null or p_monto_gs<0 or p_monto_gs>v_precio then
      raise exception 'El abono debe estar entre cero y el precio del servicio' using errcode='22023';
    end if;
    v_medio_pago:='Abono';
    v_nota:='Abono parcial; medio de pago sin especificar';
  elsif v_precio=0 then
    if p_monto_gs is distinct from 0 then
      raise exception 'Este servicio no tiene saldo para cobrar' using errcode='22023';
    end if;
    v_medio_pago:=p_medio;
    v_nota:='Cobro rápido';
  elsif p_monto_gs is null or p_monto_gs<=0 or p_monto_gs>v_precio then
    raise exception 'El monto cobrado debe ser mayor que cero y no superar el precio' using errcode='22023';
  else
    v_medio_pago:=p_medio;
    v_nota:='Cobro rápido';
  end if;

  v_comision:=coalesce((
    select e.comision_pct from public.empleadas e
    where e.user_id=v_user and e.id=v_turno.empleada_id
  ),0);
  perform pg_catalog.set_config('agendapora.quick_charge','on',true);
  update public.turnos
  set estado='hecho',
      precio_cierre_gs=coalesce(v_turno.precio_cierre_gs,v_turno.precio_gs),
      comision_pct_aplicada=coalesce(v_turno.comision_pct_aplicada,v_comision)
  where id=p_turno_id and user_id=v_user;

  if p_monto_gs>0 then
    insert into public.pagos(user_id,turno_id,clienta_id,fecha,monto_gs,medio,nota)
    values(v_user,p_turno_id,v_turno.clienta_id,p_fecha,p_monto_gs,v_medio_pago,v_nota)
    returning id into v_pago;
  end if;
  return jsonb_build_object(
    'turno_id',p_turno_id,
    'pago_id',v_pago,
    'monto_gs',p_monto_gs,
    'deuda_gs',greatest(v_precio-p_monto_gs,0)
  );
end $$;

revoke all on function public.cobrar_turno_rapido(uuid,bigint,date,text) from public,anon;
grant execute on function public.cobrar_turno_rapido(uuid,bigint,date,text) to authenticated;
notify pgrst, 'reload schema';
commit;
