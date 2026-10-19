-- Respaldo JSON paginado para la cuenta administradora del producto.
-- La RPC solo consulta tablas public y filtra fuera el perfil administrativo.
-- Ejecutar en Supabase SQL Editor como postgres. Idempotente.
begin;

create or replace function public.admin_respaldo_pagina(
  p_tabla text,
  p_offset integer default 0,
  p_limite integer default 250
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint;
  v_filas jsonb;
begin
  if auth.uid() is null or not public.es_admin() or not public.cuenta_activa() then
    raise exception 'Solo administración' using errcode='42501';
  end if;
  if p_tabla is null or p_tabla not in (
    'perfiles','clientas','servicios','turnos','pagos','plantillas','gastos','productos',
    'empleadas','solicitudes_reserva','pagos_suscripcion','horarios_especiales',
    'turno_servicios','solicitudes_reserva_servicios','fotos_clienta'
  ) then
    raise exception 'Tabla de respaldo inválida' using errcode='22023';
  end if;
  if p_offset is null or p_offset < 0 or p_limite is null or p_limite not between 1 and 500 then
    raise exception 'Parámetros de paginación inválidos' using errcode='22023';
  end if;

  if p_tabla='perfiles' then
    select count(*) into v_total from public.perfiles p where not p.es_admin;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]'::jsonb) into v_filas
    from (select p.* from public.perfiles p where not p.es_admin order by p.user_id limit p_limite offset p_offset) x;
  elsif p_tabla='clientas' then
    select count(*) into v_total from public.clientas t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.clientas t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='servicios' then
    select count(*) into v_total from public.servicios t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.servicios t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='turnos' then
    select count(*) into v_total from public.turnos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.turnos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='pagos' then
    select count(*) into v_total from public.pagos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.pagos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='plantillas' then
    select count(*) into v_total from public.plantillas t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.plantillas t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='gastos' then
    select count(*) into v_total from public.gastos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.gastos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='productos' then
    select count(*) into v_total from public.productos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.productos t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='empleadas' then
    select count(*) into v_total from public.empleadas t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.empleadas t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='solicitudes_reserva' then
    select count(*) into v_total from public.solicitudes_reserva t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.solicitudes_reserva t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='pagos_suscripcion' then
    select count(*) into v_total from public.pagos_suscripcion t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.pagos_suscripcion t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='horarios_especiales' then
    select count(*) into v_total from public.horarios_especiales t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.horarios_especiales t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='turno_servicios' then
    select count(*) into v_total from public.turno_servicios t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.turno_servicios t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  elsif p_tabla='solicitudes_reserva_servicios' then
    select count(*) into v_total from public.solicitudes_reserva_servicios t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.solicitudes_reserva_servicios t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  else
    select count(*) into v_total from public.fotos_clienta t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id,x.created_at,x.id),'[]'::jsonb) into v_filas
    from (select t.* from public.fotos_clienta t where exists(select 1 from public.perfiles p where p.user_id=t.user_id and not p.es_admin) order by t.user_id,t.created_at,t.id limit p_limite offset p_offset) x;
  end if;

  return jsonb_build_object('tabla',p_tabla,'offset',p_offset,'limite',p_limite,'total',v_total,'filas',v_filas);
end $$;

revoke all on function public.admin_respaldo_pagina(text,integer,integer) from public,anon;
grant execute on function public.admin_respaldo_pagina(text,integer,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
