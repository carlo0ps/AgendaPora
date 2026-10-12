-- Migración idempotente: el pago calcula y activa el nuevo vencimiento en una sola transacción.
begin;

-- Eliminar overloads anteriores y variaciones incompatibles de nombres/tipos para que
-- PostgREST publique una única firma con argumentos coincidentes con js/admin.js.
do $$
declare
  v_argumentos text;
begin
  for v_argumentos in
    select pg_catalog.pg_get_function_identity_arguments(p.oid)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_registrar_pago' and p.prokind='f'
  loop
    execute pg_catalog.format('drop function public.admin_registrar_pago(%s)',v_argumentos);
  end loop;
end;
$$;

create or replace function public.admin_registrar_pago(
  p_user_id uuid,
  p_monto_gs bigint,
  p_fecha date,
  p_meses integer,
  p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_hoy date := (pg_catalog.now() at time zone 'America/Asuncion')::date;
  v_vence date;
begin
  if not public.es_admin() then
    raise exception 'Solo administración' using errcode='42501';
  end if;
  if p_monto_gs is null or p_monto_gs<=0 or p_fecha is null or p_meses is null or p_meses not between 1 and 12 or char_length(coalesce(p_nota,''))>1000 then
    raise exception 'Datos de pago inválidos' using errcode='22023';
  end if;

  select vence_el into v_vence
  from public.perfiles
  where user_id=p_user_id and not es_admin
  for update;
  if not found then
    raise exception 'Salón no encontrado' using errcode='P0002';
  end if;

  v_vence := (greatest(coalesce(v_vence,v_hoy),v_hoy)::timestamp + pg_catalog.make_interval(months => p_meses))::date;
  insert into public.pagos_suscripcion(user_id,monto_gs,fecha,periodo_hasta,nota_interna,registrado_por)
  values(p_user_id,p_monto_gs,p_fecha,v_vence,nullif(p_nota,''),auth.uid())
  returning id into v_id;

  update public.perfiles
  set vence_el=v_vence, activo=true
  where user_id=p_user_id and not es_admin;
  if not found then
    raise exception 'Salón no encontrado' using errcode='P0002';
  end if;
  return v_id;
end;
$$;

revoke all on function public.admin_registrar_pago(uuid,bigint,date,integer,text) from public,anon;
grant execute on function public.admin_registrar_pago(uuid,bigint,date,integer,text) to authenticated;

-- Actualiza de inmediato la caché de funciones RPC de PostgREST.
notify pgrst, 'reload schema';

commit;
