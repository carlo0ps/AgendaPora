-- Comprobaciones de permisos/RLS relacionadas con migraciones 17 y 18.
-- Ejecutar en Supabase SQL Editor como postgres. No cambia datos persistentes.
begin;
create temporary table reserva_security_results(caso text not null,resultado text not null,detalle text not null) on commit drop;

do $$
declare
  v_ok boolean;
  v_public_tables text;
  v_regular_user uuid:=gen_random_uuid();
  v_regular_slug text;
  v_regular_denied boolean:=false;
begin
  select c.relrowsecurity into v_ok from pg_catalog.pg_class c
  where c.oid='public.horarios_especiales'::regclass;
  insert into pg_temp.reserva_security_results values('RLS en horarios_especiales',case when coalesce(v_ok,false) then 'PASS' else 'FAIL' end,'La tabla debe tener RLS habilitado.');

  select count(*)=4 into v_ok from pg_catalog.pg_policies p
  where p.schemaname='public' and p.tablename='horarios_especiales'
    and p.policyname in ('horarios_especiales_select_own','horarios_especiales_insert_own','horarios_especiales_update_own','horarios_especiales_delete_own');
  insert into pg_temp.reserva_security_results values('Políticas CRUD separadas',case when v_ok then 'PASS' else 'FAIL' end,'Se esperan políticas propias de lectura, inserción, actualización y borrado.');

  select has_column_privilege('authenticated','public.perfiles','intervalo_reservas_min','UPDATE')
    and has_column_privilege('authenticated','public.perfiles','anticipacion_reserva_min','UPDATE')
    and has_column_privilege('authenticated','public.perfiles','max_dias_reserva','UPDATE')
    and has_column_privilege('authenticated','public.perfiles','buffer_reserva_min','UPDATE') into v_ok;
  insert into pg_temp.reserva_security_results values('Dueña puede configurar disponibilidad',case when v_ok then 'PASS' else 'FAIL' end,'La app necesita UPDATE sobre las cuatro opciones de reserva del perfil.');

  select string_agg(c.relname,', ' order by c.relname) into v_public_tables
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and has_table_privilege('anon',c.oid,'SELECT');
  insert into pg_temp.reserva_security_results values('Anon no puede leer tablas públicas',case when v_public_tables is null then 'PASS' else 'FAIL' end,
    coalesce('Tablas legibles por anon: '||v_public_tables,'Ninguna tabla pública concede SELECT a anon.'));

  select not has_function_privilege('anon','public.reserva_slot_reglas(uuid,date,time,integer,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.reserva_slot_reglas(uuid,date,time,integer,integer)','EXECUTE')
    and not has_function_privilege('anon','public.reserva_empleadas_libres(uuid,date,time,integer,uuid,uuid,uuid,integer,boolean)','EXECUTE')
    and not has_function_privilege('authenticated','public.reserva_empleadas_libres(uuid,date,time,integer,uuid,uuid,uuid,integer,boolean)','EXECUTE')
    into v_ok;
  insert into pg_temp.reserva_security_results values('Helpers de disponibilidad privados',case when v_ok then 'PASS' else 'FAIL' end,'Los helpers SECURITY DEFINER no se exponen a roles de aplicación.');

  select has_function_privilege('anon','public.public_slots_multiple(text,date,uuid[])','EXECUTE')
    and has_function_privilege('anon','public.public_booking_status(text,date,uuid[])','EXECUTE')
    and has_function_privilege('anon','public.public_request_booking_multiple(text,uuid[],date,time,text,text,text,text)','EXECUTE')
    and has_function_privilege('anon','public.public_slots(text,date,uuid)','EXECUTE')
    and has_function_privilege('anon','public.public_request_booking(text,uuid,date,time,text,text,text)','EXECUTE')
    into v_ok;
  insert into pg_temp.reserva_security_results values('RPC públicas limitadas',case when v_ok then 'PASS' else 'FAIL' end,'Las RPC legacy delegan en las mismas reglas públicas.');

  select not has_function_privilege('anon','public.admin_respaldo_pagina(text,integer,integer)','EXECUTE')
    and has_function_privilege('authenticated','public.admin_respaldo_pagina(text,integer,integer)','EXECUTE')
    into v_ok;
  insert into pg_temp.reserva_security_results values('Respaldo no ejecutable por anon',case when v_ok then 'PASS' else 'FAIL' end,'Solo authenticated recibe EXECUTE; el rol anon queda excluido.');

  v_regular_slug:='respaldo-prueba-'||left(v_regular_user::text,8);
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(v_regular_user,'authenticated','authenticated',v_regular_slug||'@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
  update public.perfiles set es_admin=false where user_id=v_regular_user;
  perform set_config('request.jwt.claim.sub',v_regular_user::text,true);
  begin
    perform public.admin_respaldo_pagina('perfiles',0,1);
    v_regular_denied:=false;
  exception when others then
    v_regular_denied:=sqlstate='42501';
  end;
  perform set_config('request.jwt.claim.sub','',true);
  insert into pg_temp.reserva_security_results values('Usuaria común no exporta el respaldo',case when v_regular_denied then 'PASS' else 'FAIL' end,'La RPC verifica es_admin() dentro del servidor y rechaza una cuenta sin privilegios.');
end $$;

select caso,resultado,detalle from pg_temp.reserva_security_results order by caso;
rollback;
