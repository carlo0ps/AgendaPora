-- Comprobaciones de permisos/RLS relacionadas con migraciones 17 a 19.
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
  v_regular_cash_backup_denied boolean:=false;
  v_caja_user_a uuid:=gen_random_uuid();
  v_caja_user_b uuid:=gen_random_uuid();
  v_caja_email_a text;
  v_caja_email_b text;
  v_caja_id uuid;
  v_caja_result jsonb;
  v_caja_data jsonb;
  v_open_denied boolean:=false;
  v_isolation_ok boolean:=false;
  v_close_denied boolean:=false;
  v_expired_denied boolean:=false;
  v_caja_check boolean;
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
    and not has_function_privilege('anon','public.admin_respaldo_caja_pagina(text,integer,integer)','EXECUTE')
    and has_function_privilege('authenticated','public.admin_respaldo_pagina(text,integer,integer)','EXECUTE')
    into v_ok;
  insert into pg_temp.reserva_security_results values('Respaldo no ejecutable por anon',case when v_ok then 'PASS' else 'FAIL' end,'Las RPC de respaldo general y caja excluyen a anon; authenticated puede invocarlas y la función comprueba es_admin().');

  select coalesce(c.relrowsecurity,false) into v_ok from pg_catalog.pg_class c where c.oid='public.cajas'::regclass;
  select coalesce(v_ok,false) and coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid='public.caja_movimientos'::regclass),false)
    and not has_table_privilege('authenticated','public.cajas','INSERT')
    and not has_table_privilege('authenticated','public.cajas','UPDATE')
    and not has_table_privilege('authenticated','public.cajas','DELETE')
    and not has_table_privilege('authenticated','public.caja_movimientos','INSERT')
    and not has_table_privilege('authenticated','public.caja_movimientos','UPDATE')
    and not has_table_privilege('authenticated','public.caja_movimientos','DELETE')
    and (select count(*)=8 from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename in ('cajas','caja_movimientos')
      and p.policyname in ('cajas_select_own','cajas_insert_rpc_only','cajas_update_rpc_only','cajas_delete_rpc_only',
        'caja_movimientos_select_own','caja_movimientos_insert_rpc_only','caja_movimientos_update_rpc_only','caja_movimientos_delete_rpc_only'))
    into v_caja_check;
  insert into pg_temp.reserva_security_results values('RLS completo de caja',case when v_caja_check then 'PASS' else 'FAIL' end,'Ambas tablas tienen RLS y políticas separadas para select, insert, update y delete.');

  select not has_table_privilege('anon','public.cajas','SELECT')
    and not has_table_privilege('anon','public.caja_movimientos','SELECT')
    and not has_function_privilege('anon','public.abrir_caja(bigint)','EXECUTE')
    and not has_function_privilege('anon','public.registrar_movimiento_caja(text,text,text,bigint,text)','EXECUTE')
    and not has_function_privilege('anon','public.registrar_gasto(date,text,text,bigint,text,text)','EXECUTE')
    and not has_function_privilege('anon','public.cerrar_caja(bigint)','EXECUTE')
    into v_ok;
  insert into pg_temp.reserva_security_results values('Anon no lee ni modifica caja',case when v_ok then 'PASS' else 'FAIL' end,'Anon no tiene SELECT ni EXECUTE en las RPC privadas de caja.');

  v_caja_email_a:='caja-a-'||left(v_caja_user_a::text,8)||'@example.invalid';
  v_caja_email_b:='caja-b-'||left(v_caja_user_b::text,8)||'@example.invalid';
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values
      (v_caja_user_a,'authenticated','authenticated',v_caja_email_a,now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
      (v_caja_user_b,'authenticated','authenticated',v_caja_email_b,now(),'{}'::jsonb,'{}'::jsonb,now(),now());
  update public.perfiles set activo=true,vence_el=(now() at time zone 'America/Asuncion')::date+30,es_admin=false
    where user_id in (v_caja_user_a,v_caja_user_b);

  perform set_config('request.jwt.claim.sub',v_caja_user_a::text,true);
  v_caja_result:=public.abrir_caja(50000);
  v_caja_id:=(v_caja_result->'caja'->>'id')::uuid;
  begin
    perform public.abrir_caja(10000);
    v_open_denied:=false;
  exception when others then
    v_open_denied:=sqlstate='23505';
  end;
  insert into pg_temp.reserva_security_results values('Una sola caja abierta por salón',case when v_open_denied then 'PASS' else 'FAIL' end,'La segunda apertura de la misma cuenta es rechazada.');

  perform set_config('request.jwt.claim.sub',v_caja_user_b::text,true);
  v_caja_data:=public.caja_datos(null,null);
  v_isolation_ok:=coalesce(v_caja_data->'caja_abierta','null'::jsonb)='null'::jsonb;
  begin
    perform public.caja_detalle(v_caja_id);
    v_isolation_ok:=false;
  exception when others then
    v_isolation_ok:=v_isolation_ok and sqlstate='P0002';
  end;
  insert into pg_temp.reserva_security_results values('Aislamiento de caja entre salones',case when v_isolation_ok then 'PASS' else 'FAIL' end,'La cuenta B no ve la caja abierta de la cuenta A ni puede consultar su detalle por UUID.');

  perform set_config('request.jwt.claim.sub',v_caja_user_a::text,true);
  perform public.registrar_movimiento_caja('entrada','otros','Entrada ficticia de prueba',10000,null);
  perform public.registrar_movimiento_caja('salida','ajuste','Corrección ficticia de prueba',5000,'Motivo ficticio de test');
  v_caja_result:=public.cerrar_caja(55000);
  v_close_denied:=coalesce((v_caja_result->>'diferencia_gs')::bigint,1)=0;
  begin
    update public.cajas set monto_inicial_gs=1 where user_id=v_caja_user_a and id=v_caja_id;
    v_close_denied:=false;
  exception when others then
    v_close_denied:=v_close_denied and sqlstate='42501';
  end;
  insert into pg_temp.reserva_security_results values('Cierre de caja inmutable',case when v_close_denied then 'PASS' else 'FAIL' end,'El snapshot queda guardado y una actualización posterior de la caja cerrada es rechazada.');

  perform set_config('request.jwt.claim.sub','',true);
  update public.perfiles set vence_el=(now() at time zone 'America/Asuncion')::date-1 where user_id=v_caja_user_b;
  perform set_config('request.jwt.claim.sub',v_caja_user_b::text,true);
  begin
    perform public.abrir_caja(0);
    v_expired_denied:=false;
  exception when others then
    v_expired_denied:=sqlstate='42501';
  end;
  insert into pg_temp.reserva_security_results values('Cuenta vencida sin escrituras de caja',case when v_expired_denied then 'PASS' else 'FAIL' end,'abrir_caja valida cuenta_activa() y rechaza una suscripción vencida.');

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
  begin
    perform public.admin_respaldo_caja_pagina('cajas',0,1);
    v_regular_cash_backup_denied:=false;
  exception when others then
    v_regular_cash_backup_denied:=sqlstate='42501';
  end;
  insert into pg_temp.reserva_security_results values('Usuaria común no exporta cajas',case when v_regular_cash_backup_denied then 'PASS' else 'FAIL' end,'La RPC de respaldo de caja también exige es_admin() en el servidor.');
end $$;

select caso,resultado,detalle from pg_temp.reserva_security_results order by caso;
rollback;
