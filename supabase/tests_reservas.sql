-- Pruebas transaccionales de disponibilidad. Ejecutar como postgres después de migracion_17.sql.
-- Crea fixtures con identidad/email reservados y revierte todo al final; no guarda contraseñas.
begin;
create temporary table reserva_test_results(caso text not null,resultado text not null,detalle text not null) on commit drop;

do $$
declare
  v_user uuid:=gen_random_uuid(); v_slug text; v_today date:=(now() at time zone 'America/Asuncion')::date;
  v_booking_day date; v_second_day date; v_closed_day date; v_special_day date; v_special_open_day date; v_week jsonb;
  v_day_key text; v_local_now timestamp; v_near_time time; v_rule text; v_ok boolean;
  v_service_short uuid; v_service_90 uuid; v_service_180 uuid; v_employee_a uuid; v_employee_b uuid; v_done_turno uuid;
  v_phone text; v_race_ok boolean:=false; v_invalid_ok boolean:=false; v_message text;
begin
  v_slug:='reservas-test-'||left(v_user::text,8);
  v_local_now:=now() at time zone 'America/Asuncion';
  v_booking_day:=v_today+1;
  while extract(dow from v_booking_day)::integer=0 loop v_booking_day:=v_booking_day+1; end loop;
  v_second_day:=v_booking_day+1;
  if extract(dow from v_second_day)::integer=0 then v_second_day:=v_second_day+1; end if;
  v_closed_day:=v_booking_day + ((7-extract(dow from v_booking_day)::integer)%7);
  v_special_day:=v_booking_day+7;
  v_special_open_day:=v_booking_day+14;
  v_week:='{"1":{"inicio":"09:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"2":{"inicio":"09:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"3":{"inicio":"09:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"4":{"inicio":"09:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"5":{"inicio":"09:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"6":{"inicio":"09:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"}}'::jsonb;

  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(v_user,'authenticated','authenticated',v_slug||'@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
  insert into public.perfiles(user_id,nombre,slug,horario_texto,horarios,vence_el,activo,intervalo_reservas_min,anticipacion_reserva_min,max_dias_reserva,buffer_reserva_min)
    values(v_user,'Salón de prueba ficticio',v_slug,'Lun a sáb · 09:00 a 18:00',v_week,v_today+30,true,15,0,60,0)
    on conflict(user_id) do update set nombre=excluded.nombre,slug=excluded.slug,horarios=excluded.horarios,
      vence_el=excluded.vence_el,activo=true,intervalo_reservas_min=15,anticipacion_reserva_min=0,max_dias_reserva=60,buffer_reserva_min=0;
  perform set_config('request.jwt.claim.sub',v_user::text,true);

  insert into public.servicios(user_id,nombre,precio_gs,duracion_min,activo) values
    (v_user,'Prueba breve ficticia',10000,30,true),(v_user,'Prueba noventa ficticia',20000,90,true),(v_user,'Prueba larga ficticia',30000,180,true);
  select id into v_service_short from public.servicios where user_id=v_user and nombre='Prueba breve ficticia';
  select id into v_service_90 from public.servicios where user_id=v_user and nombre='Prueba noventa ficticia';
  select id into v_service_180 from public.servicios where user_id=v_user and nombre='Prueba larga ficticia';
  insert into public.empleadas(user_id,nombre,activa) values(v_user,'Empleada A ficticia',true),(v_user,'Empleada B ficticia',true);
  select id into v_employee_a from public.empleadas where user_id=v_user and nombre='Empleada A ficticia';
  select id into v_employee_b from public.empleadas where user_id=v_user and nombre='Empleada B ficticia';
  insert into public.horarios_especiales(user_id,fecha,cerrado,nota)
    values(v_user,v_special_day,true,'Cierre ficticio para prueba');
  insert into public.horarios_especiales(user_id,fecha,cerrado,inicio,fin,pausa_inicio,pausa_fin,nota)
    values(v_user,v_special_open_day,false,time '10:00',time '16:00',time '12:00',time '13:00','Apertura especial ficticia');

  -- Una reserva de 30 min a las 14:00 ocupa a A. El estado cancelado de las 16:00 no ocupa.
  insert into public.turnos(user_id,servicio_id,fecha,hora,precio_gs,duracion_min,empleada_id,buffer_min,estado)
    values(v_user,v_service_short,v_booking_day,time '14:00',10000,30,v_employee_a,0,'pendiente'),
      (v_user,v_service_short,v_booking_day,time '16:00',10000,30,v_employee_a,0,'cancelado');
  insert into public.turnos(user_id,servicio_id,fecha,hora,precio_gs,duracion_min,empleada_id,buffer_min,estado)
    values(v_user,v_service_short,v_booking_day,time '15:00',10000,30,v_employee_b,0,'pendiente')
    returning id into v_done_turno;
  -- Los turnos hechos deben pasar por el mismo cobro rápido que usa la aplicación.
  perform public.cobrar_turno_rapido(v_done_turno,10000,v_booking_day,'Efectivo',null);
  insert into public.turnos(user_id,servicio_id,fecha,hora,precio_gs,duracion_min,empleada_id,buffer_min,estado)
    values(v_user,v_service_180,v_second_day,time '13:00',30000,180,v_employee_a,0,'pendiente');

  v_ok:=public.public_booking_status(v_slug,v_closed_day,array[v_service_short])='closed'
    and not exists(select 1 from public.public_slots_multiple(v_slug,v_closed_day,array[v_service_short]));
  insert into pg_temp.reserva_test_results values('Día semanal cerrado',case when v_ok then 'PASS' else 'FAIL' end,'El domingo sin horario no publica intervalos.');

  v_ok:=public.public_booking_status(v_slug,v_special_day,array[v_service_short])='closed'
    and not exists(select 1 from public.public_slots_multiple(v_slug,v_special_day,array[v_service_short]));
  insert into pg_temp.reserva_test_results values('Fecha especial cerrada',case when v_ok then 'PASS' else 'FAIL' end,'La fecha especial cerrada prevalece sobre el horario semanal.');

  v_ok:=exists(select 1 from public.public_slots_multiple(v_slug,v_special_open_day,array[v_service_short]) where hora=time '10:00')
    and not exists(select 1 from public.public_slots_multiple(v_slug,v_special_open_day,array[v_service_short]) where hora<time '10:00');
  insert into pg_temp.reserva_test_results values('Fecha especial con horario propio',case when v_ok then 'PASS' else 'FAIL' end,'La apertura especial reemplaza el horario semanal, incluso en un domingo cerrado habitualmente.');

  update public.perfiles set intervalo_reservas_min=30 where user_id=v_user;
  v_ok:=exists(select 1 from public.public_slots_multiple(v_slug,v_booking_day,array[v_service_short]) where hora=time '09:00')
    and exists(select 1 from public.public_slots_multiple(v_slug,v_booking_day,array[v_service_short]) where hora=time '09:30')
    and not exists(select 1 from public.public_slots_multiple(v_slug,v_booking_day,array[v_service_short]) where hora=time '09:15');
  insert into pg_temp.reserva_test_results values('Grilla configurable de 30 minutos',case when v_ok then 'PASS' else 'FAIL' end,'La grilla comienza a las 09:00 y avanza en pasos de 30 minutos.');
  update public.perfiles set intervalo_reservas_min=15 where user_id=v_user;

  v_rule:=public.reserva_slot_reglas(v_user,v_booking_day,time '08:45',30,0);
  insert into pg_temp.reserva_test_results values('Antes de abrir',case when v_rule='antes_de_abrir' then 'PASS' else 'FAIL' end,'08:45 no se acepta cuando la apertura es 09:00.');

  v_rule:=public.reserva_slot_reglas(v_user,v_booking_day,time '18:00',30,0);
  insert into pg_temp.reserva_test_results values('Después del cierre',case when v_rule='no_entra' then 'PASS' else 'FAIL' end,'El servicio debe terminar antes o justo al cierre.');

  v_rule:=public.reserva_slot_reglas(v_user,v_booking_day,time '17:00',90,0);
  insert into pg_temp.reserva_test_results values('Servicio de 90 min no entra a las 17:00',case when v_rule='no_entra' then 'PASS' else 'FAIL' end,'17:00 + 90 min no cabe hasta las 18:00.');

  v_ok:=public.public_booking_status(v_slug,v_booking_day,array[v_service_short,v_service_short])='invalid';
  insert into pg_temp.reserva_test_results values('RPC de estado valida servicios repetidos',case when v_ok then 'PASS' else 'FAIL' end,'La consulta pública rechaza una lista duplicada de servicios.');

  v_ok:=not exists(select 1 from public.reserva_empleadas_libres(v_user,v_booking_day,time '13:00',180,v_employee_a,null,null,0,false));
  insert into pg_temp.reserva_test_results values('Servicio largo que pisa un turno',case when v_ok then 'PASS' else 'FAIL' end,'El turno candidato de tres horas incluye el turno de A a las 14:00.');

  v_ok:=not exists(select 1 from public.reserva_empleadas_libres(v_user,v_booking_day,time '14:00',30,v_employee_a,null,null,0,false))
    and exists(select 1 from public.reserva_empleadas_libres(v_user,v_booking_day,time '14:00',30,v_employee_b,null,null,0,false));
  insert into pg_temp.reserva_test_results values('Disponibilidad por empleada',case when v_ok then 'PASS' else 'FAIL' end,'A está ocupada y B puede atender el mismo horario.');

  v_ok:=exists(select 1 from public.reserva_empleadas_libres(v_user,v_booking_day,time '16:00',30,v_employee_a,null,null,0,false));
  insert into pg_temp.reserva_test_results values('Turno cancelado no bloquea',case when v_ok then 'PASS' else 'FAIL' end,'El turno cancelado de A a las 16:00 no ocupa el horario.');

  v_ok:=not exists(select 1 from public.reserva_empleadas_libres(v_user,v_booking_day,time '15:00',30,v_employee_b,null,null,0,false));
  insert into pg_temp.reserva_test_results values('Turno hecho bloquea',case when v_ok then 'PASS' else 'FAIL' end,'Un turno hecho dentro del horario ocupa su recurso hasta el fin.');

  v_ok:=not exists(select 1 from public.reserva_empleadas_libres(v_user,v_second_day,time '13:15',30,v_employee_a,null,null,0,false))
    and not exists(select 1 from public.reserva_empleadas_libres(v_user,v_second_day,time '15:45',30,v_employee_a,null,null,0,false))
    and exists(select 1 from public.reserva_empleadas_libres(v_user,v_second_day,time '16:00',30,v_employee_a,null,null,0,false));
  insert into pg_temp.reserva_test_results values('Turno de 3 horas bloquea toda su duración',case when v_ok then 'PASS' else 'FAIL' end,'El turno 13:00–16:00 ocupa sus intervalos completos y libera las 16:00.');

  v_rule:=public.reserva_slot_reglas(v_user,v_booking_day,time '12:00',30,0);
  insert into pg_temp.reserva_test_results values('Pausa de almuerzo',case when v_rule='pausa' then 'PASS' else 'FAIL' end,'No se permiten servicios que crucen la pausa 12:00–13:00.');

  v_day_key:=extract(dow from v_today)::integer::text;
  update public.perfiles set horarios=jsonb_set(v_week,array[v_day_key],'{"inicio":"00:00","fin":"23:59"}'::jsonb,true),anticipacion_reserva_min=0
    where user_id=v_user;
  v_rule:=public.reserva_slot_reglas(v_user,v_today,time '00:00',30,0);
  insert into pg_temp.reserva_test_results values('Hoy con hora pasada',case when v_rule='anticipacion' then 'PASS' else 'FAIL' end,'La hora local de hoy que ya pasó se rechaza en el servidor.');

  update public.perfiles set anticipacion_reserva_min=120 where user_id=v_user;
  v_near_time:=(v_local_now+interval '30 minutes')::time;
  v_rule:=public.reserva_slot_reglas(v_user,v_today,v_near_time,30,0);
  insert into pg_temp.reserva_test_results values('Margen mínimo',case when v_rule='anticipacion' then 'PASS' else 'FAIL' end,'Una reserva a menos de 120 minutos se rechaza.');
  update public.perfiles set horarios=v_week,anticipacion_reserva_min=0 where user_id=v_user;

  -- La llamada directa prueba que el servidor rechaza una hora manipulada fuera de la grilla.
  begin
    perform public.public_request_booking_multiple(v_slug,array[v_service_short],v_booking_day,time '08:30','Clienta ficticia de prueba','0900-000-101',null,'');
    v_invalid_ok:=false;
  exception when others then
    v_invalid_ok:=sqlstate='22023' and sqlerrm ilike '%horario%';
  end;
  insert into pg_temp.reserva_test_results values('RPC directa rechaza horario inválido',case when v_invalid_ok then 'PASS' else 'FAIL' end,'Una llamada directa a las 08:30 no puede saltar la apertura ni la validación del cliente.');

  begin
    perform public.public_request_booking(v_slug,v_service_short,v_booking_day,time '08:30','Clienta ficticia compatibilidad','0900-000-104','');
    v_invalid_ok:=false;
  exception when others then
    v_invalid_ok:=sqlstate='22023' and sqlerrm ilike '%horario%';
  end;
  insert into pg_temp.reserva_test_results values('RPC pública antigua reusa validación',case when v_invalid_ok then 'PASS' else 'FAIL' end,'La interfaz legacy no puede crear una reserva fuera del horario.');

  -- Sin B, dos solicitudes al mismo recurso/hora serializadas por la RPC no pueden entrar ambas.
  update public.empleadas set activa=false where id=v_employee_b and user_id=v_user;
  begin
    perform public.public_request_booking_multiple(v_slug,array[v_service_short],v_booking_day,time '09:00','Clienta ficticia de carrera A','0900-000-102',null,'');
    begin
      perform public.public_request_booking_multiple(v_slug,array[v_service_short],v_booking_day,time '09:00','Clienta ficticia de carrera B','0900-000-103',null,'');
      v_race_ok:=false;
    exception when sqlstate '23P01' then v_race_ok:=true;
    end;
  exception when others then v_race_ok:=false;
  end;
  insert into pg_temp.reserva_test_results values('Dos reservas concurrentes al mismo recurso',case when v_race_ok then 'PASS' else 'FAIL' end,'El bloqueo por salón/fecha deja una solicitud y rechaza la segunda.');

  select string_agg(c.relname,', ' order by c.relname) into v_message
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and has_table_privilege('anon',c.oid,'SELECT');
  v_ok:=v_message is null;
  insert into pg_temp.reserva_test_results values('Anon no puede leer ninguna tabla',case when v_ok then 'PASS' else 'FAIL' end,
    coalesce('Tablas que anon puede leer: '||v_message,'El rol anon no tiene SELECT directo sobre tablas del esquema public.'));
end $$;

select caso,resultado,detalle from pg_temp.reserva_test_results order by caso;
rollback;
