-- CUENTA PLANTILLA · datos completamente ficticios para probar AgendaPorã.
-- Crear primero la cuenta indicada en Supabase Auth. Este script solo lee auth.users.
-- v_reiniciar=true reemplaza los datos operativos de esa cuenta, nunca los de otras cuentas.
begin;

create temporary table if not exists seed_plantilla_resumen (
  cantidad_clientas integer not null,
  cantidad_turnos integer not null,
  cantidad_pagos integer not null,
  deuda_total_gs bigint not null,
  ingresos_mes_gs bigint not null
) on commit preserve rows;
truncate table pg_temp.seed_plantilla_resumen;

do $seed$
declare
  v_email text := 'prueba1@agenda.com';
  v_reiniciar boolean := true;
  v_slug text := 'plantilla-1';
  v_user uuid;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
  v_lunes_proximo date;
  v_proximo_habil date;
  v_segundo_habil date;
  v_hoy_slot time;
  v_hora_actual timestamp;
  v_apertura_hoy time;
  v_cierre_hoy time;
  v_dia_hoy integer;
  v_no_vino_disponible boolean := false;
  v_turnos_esperados integer := 55;
  v_perfil_ok boolean := false;
  v_clientas_ok boolean := false;
  v_servicios_ok boolean := false;
  v_empleadas_ok boolean := false;
  v_plantillas_ok boolean := false;
  v_turnos_ok boolean := false;
  v_pagos_ok boolean := false;
  v_gastos_ok boolean := false;
  v_productos_ok boolean := false;
  v_solicitudes_ok boolean := false;
  v_fotos_ok boolean := false;
  v_caja_ok boolean := false;
  v_horarios_especiales_ok boolean := false;
  v_config_reservas_ok boolean := false;
  v_cantidad_clientas integer := 0;
  v_cantidad_turnos integer := 0;
  v_cantidad_pagos integer := 0;
  v_clientas_con_deuda integer := 0;
  v_deuda_total_gs bigint := 0;
  v_ingresos_mes_gs bigint := 0;
  v_visitas_casi_premio integer;
  v_visitas_premio integer;
begin
  v_hoy := (now() at time zone 'America/Asuncion')::date;
  v_lunes_proximo := v_hoy + (8 - extract(isodow from v_hoy)::integer);
  if v_lunes_proximo <= v_hoy + 2 then
    v_lunes_proximo := v_lunes_proximo + 7;
  end if;
  v_proximo_habil:=v_hoy+1;
  if extract(dow from v_proximo_habil)::integer=0 then v_proximo_habil:=v_proximo_habil+1; end if;
  v_segundo_habil:=v_proximo_habil+1;
  if extract(dow from v_segundo_habil)::integer=0 then v_segundo_habil:=v_segundo_habil+1; end if;
  v_hora_actual:=now() at time zone 'America/Asuncion';
  v_dia_hoy:=extract(dow from v_hoy)::integer;
  if v_dia_hoy between 1 and 5 then v_apertura_hoy:=time '08:00'; v_cierre_hoy:=time '18:00';
  elsif v_dia_hoy=6 then v_apertura_hoy:=time '08:00'; v_cierre_hoy:=time '16:00'; end if;
  if v_apertura_hoy is not null and v_hora_actual::time<v_cierre_hoy-interval '120 minutes' then
    v_hoy_slot:=v_apertura_hoy+make_interval(mins=>greatest(0,ceil(extract(epoch from (greatest(v_apertura_hoy,v_hora_actual::time+interval '120 minutes')-v_apertura_hoy))/900.0)::integer*15));
    if v_hoy_slot+interval '60 minutes'>v_cierre_hoy then v_hoy_slot:=null; end if;
  end if;

  if to_regclass('auth.users') is null then
    raise exception 'No se encuentra auth.users. Verificá que este script se ejecute en el proyecto Supabase correcto.';
  end if;
  if to_regclass('public.perfiles') is null then
    raise exception 'No existe public.perfiles. Ejecutá supabase/schema.sql antes de cargar la cuenta plantilla.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='perfiles' and column_name='user_id'
  ) then
    raise exception 'Falta public.perfiles.user_id; ejecutá supabase/schema.sql antes de cargar la cuenta plantilla.';
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email)=lower(v_email)
  order by u.created_at desc
  limit 1;
  if v_user is null then
    raise exception 'No existe la cuenta % en Supabase Auth. Creala primero en Authentication → Users con Auto Confirm y volvé a ejecutar este script.', v_email;
  end if;
  if not exists(select 1 from public.perfiles p where p.user_id=v_user) then
    raise exception 'La cuenta % existe en Supabase Auth, pero no tiene perfil. Verificá que schema.sql y el trigger de perfiles estén aplicados.', v_email;
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'El slug % no tiene el formato permitido. Usá minúsculas, números y guiones.', v_slug;
  end if;

  select count(*)=17 into v_perfil_ok
  from information_schema.columns
  where table_schema='public' and table_name='perfiles'
    and column_name=any(array['user_id','nombre','slug','email_contacto','telefono','direccion','logo_url','color_principal','horario_texto','horarios','vence_el','activo','es_admin','visitas_premio','premio_descripcion','google_review_url','onboarding_estado']::text[]);
  if v_perfil_ok and exists(select 1 from public.perfiles p where p.slug=v_slug and p.user_id<>v_user) then
    raise exception 'El slug % ya pertenece a otra cuenta. Cambiá v_slug por un slug único y volvé a ejecutar.', v_slug;
  end if;

  select count(*)=9 into v_clientas_ok from information_schema.columns
  where table_schema='public' and table_name='clientas'
    and column_name=any(array['id','user_id','nombre','telefono','email','fecha_nacimiento','notas','deuda_gs','visitas']::text[]);
  select count(*)=6 into v_servicios_ok from information_schema.columns
  where table_schema='public' and table_name='servicios'
    and column_name=any(array['id','user_id','nombre','precio_gs','duracion_min','activo']::text[]);
  select count(*)=6 into v_empleadas_ok from information_schema.columns
  where table_schema='public' and table_name='empleadas'
    and column_name=any(array['id','user_id','nombre','telefono','comision_pct','activa']::text[]);
  select count(*)=5 into v_plantillas_ok from information_schema.columns
  where table_schema='public' and table_name='plantillas'
    and column_name=any(array['id','user_id','clave','nombre','contenido']::text[]);
  select count(*)=12 into v_turnos_ok from information_schema.columns
  where table_schema='public' and table_name='turnos'
    and column_name=any(array['id','user_id','clienta_id','servicio_id','empleada_id','fecha','hora','precio_gs','precio_cierre_gs','comision_pct_aplicada','estado','notas']::text[]);
  select count(*)=8 into v_pagos_ok from information_schema.columns
  where table_schema='public' and table_name='pagos'
    and column_name=any(array['id','user_id','turno_id','clienta_id','fecha','monto_gs','medio','nota']::text[]);
  select count(*)=7 into v_gastos_ok from information_schema.columns
  where table_schema='public' and table_name='gastos'
    and column_name=any(array['id','user_id','fecha','concepto','categoria','monto_gs','nota']::text[]);
  select count(*)=7 into v_productos_ok from information_schema.columns
  where table_schema='public' and table_name='productos'
    and column_name=any(array['id','user_id','nombre','unidad','stock_actual','stock_minimo','costo_gs']::text[]);
  select count(*)=8 into v_solicitudes_ok from information_schema.columns
  where table_schema='public' and table_name='solicitudes_reserva'
    and column_name=any(array['id','user_id','servicio_id','fecha','hora','nombre','telefono','estado']::text[]);
  select count(*)=1 into v_fotos_ok from information_schema.columns
  where table_schema='public' and table_name='fotos_clienta' and column_name='user_id';
  select count(*)=8 into v_horarios_especiales_ok from information_schema.columns
  where table_schema='public' and table_name='horarios_especiales'
    and column_name=any(array['user_id','fecha','cerrado','inicio','fin','pausa_inicio','pausa_fin','nota']::text[]);
  select count(*)=4 into v_config_reservas_ok from information_schema.columns
  where table_schema='public' and table_name='perfiles'
    and column_name=any(array['intervalo_reservas_min','anticipacion_reserva_min','max_dias_reserva','buffer_reserva_min']::text[]);
  select to_regclass('public.cajas') is not null and to_regclass('public.caja_movimientos') is not null
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='pagos' and column_name='caja_id')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='gastos' and column_name='caja_id')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='gastos' and column_name='medio_pago')
    into v_caja_ok;

  if not v_perfil_ok then raise notice 'Se omite la actualización del perfil: falta alguna columna requerida en public.perfiles.'; end if;
  if not v_clientas_ok then raise notice 'Se omite la carga de clientas: falta public.clientas o alguna columna requerida.'; end if;
  if not v_servicios_ok then raise notice 'Se omite la carga de servicios: falta public.servicios o alguna columna requerida.'; end if;
  if not v_empleadas_ok then raise notice 'Se omite la carga de empleadas: falta public.empleadas o alguna columna requerida.'; end if;
  if not v_plantillas_ok then raise notice 'Se omite la carga de plantillas: falta public.plantillas o alguna columna requerida.'; end if;
  if not v_turnos_ok then raise notice 'Se omite la carga de turnos: falta public.turnos o alguna columna requerida.'; end if;
  if not v_pagos_ok then raise notice 'Se omite la carga de pagos: falta public.pagos o alguna columna requerida.'; end if;
  if not v_gastos_ok then raise notice 'Se omite la carga de gastos: falta public.gastos o alguna columna requerida.'; end if;
  if not v_productos_ok then raise notice 'Se omite la carga de productos: falta public.productos o alguna columna requerida.'; end if;
  if not v_solicitudes_ok then raise notice 'Se omite la carga de solicitudes: falta public.solicitudes_reserva o alguna columna requerida.'; end if;
  if not v_fotos_ok then raise notice 'No existe public.fotos_clienta.user_id; no se cargan fotos en esta plantilla.'; end if;
  if not v_horarios_especiales_ok then raise notice 'Se omiten las fechas especiales: falta public.horarios_especiales o alguna columna requerida. Ejecutá migracion_16.sql.'; end if;
  if not v_config_reservas_ok then raise notice 'Se omiten los límites configurables de reserva: faltan columnas de migracion_16.sql.'; end if;
  if not v_caja_ok then raise notice 'Se omite la sesión de caja ficticia: aplicá supabase/migracion_19.sql.'; end if;

  if v_turnos_ok then
    select exists(
      select 1 from pg_constraint pc
      where pc.conrelid=to_regclass('public.turnos') and pc.contype='c'
        and lower(pg_get_constraintdef(pc.oid)) like '%no_vino%'
    ) into v_no_vino_disponible;
  end if;
  if not v_no_vino_disponible then
    raise notice 'El esquema no admite el estado no_vino en turnos; se omite ese ejemplo.';
  else
    v_turnos_esperados := 56;
  end if;

  if v_reiniciar then
    perform set_config('agendapora.seed_caja_reset','on',true);
    if v_fotos_ok then delete from public.fotos_clienta where user_id=v_user; end if;
    if v_caja_ok then delete from public.caja_movimientos where user_id=v_user; end if;
    if v_pagos_ok then delete from public.pagos where user_id=v_user; end if;
    if v_turnos_ok then delete from public.turnos where user_id=v_user; end if;
    if v_solicitudes_ok then delete from public.solicitudes_reserva where user_id=v_user; end if;
    if v_horarios_especiales_ok then delete from public.horarios_especiales where user_id=v_user; end if;
    if v_gastos_ok then delete from public.gastos where user_id=v_user; end if;
    if v_caja_ok then delete from public.cajas where user_id=v_user; end if;
    if v_productos_ok then delete from public.productos where user_id=v_user; end if;
    if v_empleadas_ok then delete from public.empleadas where user_id=v_user; end if;
    if v_plantillas_ok then delete from public.plantillas where user_id=v_user; end if;
    if v_servicios_ok then delete from public.servicios where user_id=v_user; end if;
    if v_clientas_ok then delete from public.clientas where user_id=v_user; end if;
  else
    raise notice 'Reinicio desactivado: se conservan datos ajenos a esta plantilla y se actualizan sus filas determinísticas.';
  end if;

  if v_perfil_ok then
    update public.perfiles set
      nombre='Estudio Aurora Plantilla',
      slug=v_slug,
      email_contacto=v_email,
      telefono='0900-000-000',
      direccion='Calle Modelo 000, Barrio Aurora, Asunción',
      logo_url=null,
      color_principal='#b25c7a',
      horario_texto='Lun a vie · 08:00 a 18:00 · sáb · 08:00 a 16:00',
      horarios='{"1":{"inicio":"08:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"2":{"inicio":"08:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"3":{"inicio":"08:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"4":{"inicio":"08:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"5":{"inicio":"08:00","fin":"18:00","pausa_inicio":"12:00","pausa_fin":"13:00"},"6":{"inicio":"08:00","fin":"16:00","pausa_inicio":"12:00","pausa_fin":"13:00"}}'::jsonb,
      vence_el=v_hoy+365,
      activo=true,
      es_admin=false,
      visitas_premio=8,
      premio_descripcion='Brushing ficticio de regalo al completar 8 visitas',
      google_review_url='https://example.test/resena',
      onboarding_estado='completado'
    where user_id=v_user;
  end if;

  if v_reiniciar and v_caja_ok then
    insert into public.cajas(id,user_id,fecha,abierta_por,monto_inicial_gs)
      values(md5(v_user::text||':caja:plantilla')::uuid,v_user,v_hoy,v_user,150000);
    insert into public.caja_movimientos(id,user_id,caja_id,created_by,tipo,categoria,concepto,monto_gs)
      values
        (md5(v_user::text||':caja:plantilla:entrada')::uuid,v_user,md5(v_user::text||':caja:plantilla')::uuid,v_user,'entrada','cambio','Cambio inicial ficticio',30000),
        (md5(v_user::text||':caja:plantilla:salida')::uuid,v_user,md5(v_user::text||':caja:plantilla')::uuid,v_user,'salida','retiro','Retiro de prueba ficticio',10000);
  end if;
  if v_perfil_ok and v_config_reservas_ok then
    update public.perfiles set intervalo_reservas_min=15,anticipacion_reserva_min=120,max_dias_reserva=60,buffer_reserva_min=15
    where user_id=v_user;
  end if;
  if v_horarios_especiales_ok then
    insert into public.horarios_especiales(user_id,fecha,cerrado,nota)
      values(v_user,v_hoy+40,true,'Feriado ficticio de la plantilla')
    on conflict(user_id,fecha) do update set cerrado=true,inicio=null,fin=null,pausa_inicio=null,pausa_fin=null,nota=excluded.nota;
  end if;

  if v_servicios_ok then
    insert into public.servicios as actual(id,user_id,nombre,precio_gs,duracion_min,activo) values
      (md5(v_user::text||':servicio:1')::uuid,v_user,'Corte y brushing',80000,60,true),
      (md5(v_user::text||':servicio:2')::uuid,v_user,'Coloración completa',280000,180,true),
      (md5(v_user::text||':servicio:3')::uuid,v_user,'Balayage',520000,240,true),
      (md5(v_user::text||':servicio:4')::uuid,v_user,'Manicura semipermanente',105000,75,true),
      (md5(v_user::text||':servicio:5')::uuid,v_user,'Pedicura spa',90000,75,true),
      (md5(v_user::text||':servicio:6')::uuid,v_user,'Tratamiento nutritivo',160000,90,true)
    on conflict(user_id,nombre) do update set precio_gs=excluded.precio_gs,duracion_min=excluded.duracion_min,activo=excluded.activo;
  end if;

  if v_empleadas_ok then
    insert into public.empleadas as actual(id,user_id,nombre,telefono,comision_pct,activa) values
      (md5(v_user::text||':empleada:1')::uuid,v_user,'Profesional Plantilla 1','0900-900-001',35,true),
      (md5(v_user::text||':empleada:2')::uuid,v_user,'Profesional Plantilla 2','0900-900-002',30,true)
    on conflict(id) do update set nombre=excluded.nombre,telefono=excluded.telefono,comision_pct=excluded.comision_pct,activa=excluded.activa
    where actual.user_id=excluded.user_id;
  end if;

  if v_plantillas_ok then
    insert into public.plantillas as actual(id,user_id,clave,nombre,contenido) values
      (md5(v_user::text||':plantilla:recordatorio')::uuid,v_user,'recordatorio','Recordatorio de turno','Hola {nombre} 😊 Te recuerdo tu turno en {salon} el {fecha} a las {hora}. ¡Te esperamos!'),
      (md5(v_user::text||':plantilla:deuda')::uuid,v_user,'deuda','Aviso de saldo','Hola {nombre}, tu saldo pendiente en {salon} es {deuda}. Cualquier consulta estamos a las órdenes.'),
      (md5(v_user::text||':plantilla:promo')::uuid,v_user,'promo','Promoción','Hola {nombre} 💕 Tenemos una promo ficticia en {salon}. Escribinos para reservar.'),
      (md5(v_user::text||':plantilla:cumple')::uuid,v_user,'cumple','Cumpleaños','¡Feliz cumpleaños, {nombre}! 🎂 Te deseamos un hermoso día. Te esperamos en {salon}.'),
      (md5(v_user::text||':plantilla:reactivacion')::uuid,v_user,'reactivacion','Te extrañamos','Hola {nombre} 💖 Hace un tiempo no te vemos por {salon}. ¿Agendamos?'),
      (md5(v_user::text||':plantilla:agradecimiento')::uuid,v_user,'agradecimiento','Agradecimiento y reseña','Gracias por venir, {nombre} 💕 ¿Cómo te fue con {servicio}? ¿Nos dejás una reseña? {resena}')
    on conflict(user_id,clave) do update set nombre=excluded.nombre,contenido=excluded.contenido;
  end if;

  if v_clientas_ok then
    with targets as (
      select g.i,
        case when g.i=1 then v_hoy+1
             when g.i=2 then v_hoy+3
             when g.i=3 then v_hoy+5
             when g.i=4 then date_trunc('month',v_hoy)::date+9
             else v_hoy+((g.i*13)%330) end as cumple_objetivo
      from generate_series(1,25) as g(i)
    )
    insert into public.clientas as actual(id,user_id,nombre,telefono,email,fecha_nacimiento,notas)
    select md5(v_user::text||':clienta:'||t.i::text)::uuid,
      v_user,
      'Clienta Plantilla '||lpad(t.i::text,2,'0'),
      '0900-'||lpad((100+t.i)::text,3,'0')||'-'||lpad((100+t.i*7)::text,3,'0'),
      'clienta'||lpad(t.i::text,2,'0')||'@plantilla.test',
      make_date(1990,extract(month from t.cumple_objetivo)::integer,
        least(extract(day from t.cumple_objetivo)::integer,
          extract(day from (make_date(1990,extract(month from t.cumple_objetivo)::integer,1)+interval '1 month - 1 day')::date)::integer)),
      case t.i
        when 1 then 'Fórmula ficticia de prueba: 6.3 castaño dorado + oxidante 20 vol.'
        when 2 then 'Fórmula ficticia de prueba: 7.1 ceniza + oxidante 10 vol. Revisar mechón.'
        when 3 then 'Dato ficticio de demostración: sensibilidad a fragancia artificial; confirmar antes del servicio.'
        when 4 then 'Fórmula ficticia de prueba: 5.0 natural con reflejo cálido.'
        when 8 then 'Dato ficticio: prueba de alergia realizada en la demostración.'
        when 20 then 'Clienta ficticia sin visita reciente: más de 90 días.'
        when 21 then 'Clienta ficticia sin visita reciente: más de 90 días.'
        when 22 then 'Clienta ficticia sin visita reciente: más de 60 días.'
        when 23 then 'Clienta ficticia sin visita reciente: más de 60 días.'
        else null
      end
    from targets t
    on conflict(id) do update set nombre=excluded.nombre,telefono=excluded.telefono,email=excluded.email,
      fecha_nacimiento=excluded.fecha_nacimiento,notas=excluded.notas
    where actual.user_id=excluded.user_id;
  end if;

  if v_turnos_ok and v_clientas_ok and v_servicios_ok and v_empleadas_ok then
    with base(seq,clienta_n,servicio_n,fecha,hora,empleada_n,estado,notas) as (
      select g.i,g.i,((g.i-1)%6)+1,v_hoy-(g.i*3),time '09:00',1,'hecho'::text,
        case g.i when 2 then 'Fórmula ficticia: 6.3 + reflejo dorado, oxidante 20 vol.'
                 when 3 then 'Nota ficticia de prueba de sensibilidad a fragancia.' else null end
      from generate_series(1,18) as g(i)
      union all
      select d.seq,d.clienta_n,d.servicio_n,v_hoy-d.dias_atras,time '09:00',1,'hecho'::text,d.notas
      from (values
        (19,19,1,100,'Visita ficticia antigua para probar Reactivar.'::text),
        (20,20,2,125,'Visita ficticia antigua para probar Reactivar.'::text),
        (21,21,3,140,'Visita ficticia antigua para probar Reactivar.'::text),
        (22,22,4,70,'Visita ficticia antigua para probar Reactivar.'::text),
        (23,23,5,65,'Visita ficticia antigua para probar Reactivar.'::text)
      ) as d(seq,clienta_n,servicio_n,dias_atras,notas)
      union all
      select 23+g.i,24,((g.i-1)%6)+1,v_hoy-(3*g.i+1),time '09:00',1,'hecho'::text,null::text
      from generate_series(1,7) as g(i)
      union all
      select 30+g.i,25,((g.i-1)%6)+1,v_hoy-(3*g.i+2),time '09:00',1,'hecho'::text,null::text
      from generate_series(1,8) as g(i)
      union all select 39,1,1,case when v_hoy_slot is null then v_lunes_proximo+3 else v_hoy end,coalesce(v_hoy_slot,time '09:00'),1,'pendiente',null::text
      union all select 40,2,2,v_lunes_proximo+3,time '13:00',1,'pendiente',null::text
      union all select 41,3,1,v_lunes_proximo+3,time '13:00',2,'pendiente',null::text
      union all select 42,4,4,v_lunes_proximo+3,time '09:00',2,'pendiente',null::text
      union all select 43,5,6,v_lunes_proximo+5,time '09:00',1,'pendiente',null::text
      union all select 44,6,2,v_hoy+2,time '13:00',1,'cancelado','Turno ficticio cancelado.'::text
      union all select 45,6,5,v_proximo_habil,time '09:00',1,'pendiente',null::text
      union all select 46,7,3,v_proximo_habil,time '13:00',2,'pendiente',null::text
      union all select 47,8,2,v_segundo_habil,time '09:00',1,'pendiente',null::text
      union all select 48,9,4,v_proximo_habil,time '09:00',2,'pendiente',null::text
      union all select 49,10,1,v_hoy+1,time '16:00',2,'cancelado','Turno ficticio cancelado.'::text
      union all select 50,10,1,v_lunes_proximo,time '09:00',1,'pendiente',null::text
      union all select 51,11,2,v_lunes_proximo,time '13:00',2,'pendiente',null::text
      union all select 52,12,5,v_lunes_proximo+1,time '09:00',1,'pendiente',null::text
      union all select 53,13,6,v_lunes_proximo+1,time '10:15',2,'pendiente',null::text
      union all select 54,14,4,v_lunes_proximo+2,time '09:00',1,'pendiente',null::text
      union all select 55,15,3,v_lunes_proximo+2,time '13:00',2,'pendiente',null::text
      union all
      select 56,16,1,v_lunes_proximo+4,time '16:00',1,'no_vino','Ejemplo ficticio de inasistencia.'::text
      where v_no_vino_disponible
    ), dated as (
      select b.*,row_number() over(partition by b.fecha order by b.seq) as dia_orden
      from base b
    )
    insert into public.turnos as actual(id,user_id,clienta_id,servicio_id,empleada_id,fecha,hora,precio_gs,estado,notas,precio_cierre_gs,comision_pct_aplicada)
    select md5(v_user::text||':turno:'||d.seq::text)::uuid,v_user,
      md5(v_user::text||':clienta:'||d.clienta_n::text)::uuid,s.id,
      e.id,d.fecha,d.hora,s.precio_gs,d.estado,d.notas,
      case when d.estado='hecho' then s.precio_gs else null end,
      case when d.estado='hecho' then e.comision_pct else null end
    from dated d
    join public.servicios s on s.user_id=v_user and s.nombre=case d.servicio_n
      when 1 then 'Corte y brushing' when 2 then 'Coloración completa' when 3 then 'Balayage'
      when 4 then 'Manicura semipermanente' when 5 then 'Pedicura spa' else 'Tratamiento nutritivo' end
    join public.empleadas e on e.user_id=v_user
      and e.id=md5(v_user::text||':empleada:'||
        (case when d.estado='hecho' then case when d.dia_orden%2=0 then 2 else 1 end else d.empleada_n end)::text)::uuid
    on conflict(id) do update set clienta_id=excluded.clienta_id,servicio_id=excluded.servicio_id,
      empleada_id=excluded.empleada_id,fecha=excluded.fecha,hora=excluded.hora,precio_gs=excluded.precio_gs,
      estado=excluded.estado,notas=excluded.notas,precio_cierre_gs=excluded.precio_cierre_gs,
      comision_pct_aplicada=excluded.comision_pct_aplicada
    where actual.user_id=excluded.user_id;
  elsif v_turnos_ok then
    raise notice 'Se omiten los turnos: también se necesitan las tablas clientas, servicios y empleadas con sus columnas requeridas.';
  end if;

  if v_pagos_ok and v_turnos_ok and v_clientas_ok then
    with hechos as (
      select t.id,t.clienta_id,t.fecha,t.precio_gs,
        row_number() over(order by t.fecha,t.id) as orden
      from public.turnos t
      where t.user_id=v_user and t.estado='hecho'
        and t.id in (select md5(v_user::text||':turno:'||g.i::text)::uuid from generate_series(1,38) as g(i))
    ), pagos_seed as (
    select h.id as turno_id,h.clienta_id,case when v_reiniciar and h.orden=1 then v_hoy else h.fecha end as fecha,
        case when h.clienta_id=md5(v_user::text||':clienta:1')::uuid then 25000
             when h.clienta_id=md5(v_user::text||':clienta:2')::uuid then 200000
             when h.clienta_id=md5(v_user::text||':clienta:3')::uuid then 390000
             when h.clienta_id=md5(v_user::text||':clienta:4')::uuid then 65000
             else h.precio_gs end as monto_gs,
        case (h.orden-1)%3 when 0 then 'Efectivo' when 1 then 'Transferencia' else 'Tigo Money' end as medio,
        1 as parte
      from hechos h
      union all
      select h.id,h.clienta_id,h.fecha,25000,'Transferencia',2
      from hechos h where h.clienta_id=md5(v_user::text||':clienta:1')::uuid
    )
    insert into public.pagos as actual(id,user_id,turno_id,clienta_id,fecha,monto_gs,medio,nota)
    select md5(v_user::text||':pago:'||p.turno_id::text||':'||p.parte::text)::uuid,
      v_user,p.turno_id,p.clienta_id,p.fecha,p.monto_gs,p.medio,'Pago ficticio de plantilla'
    from pagos_seed p
    on conflict(id) do update set turno_id=excluded.turno_id,clienta_id=excluded.clienta_id,
      fecha=excluded.fecha,monto_gs=excluded.monto_gs,medio=excluded.medio,nota=excluded.nota
    where actual.user_id=excluded.user_id;
  elsif v_pagos_ok then
    raise notice 'Se omiten los pagos: también se necesitan public.turnos y public.clientas.';
  end if;

  if v_gastos_ok then
    insert into public.gastos as actual(id,user_id,fecha,concepto,categoria,monto_gs,nota) values
      (md5(v_user::text||':gasto:1')::uuid,v_user,v_hoy,'Alquiler del local','Alquiler',2300000,'Gasto ficticio de demostración.'),
      (md5(v_user::text||':gasto:2')::uuid,v_user,v_hoy-3,'Tintes y oxidantes','Insumos',465000,'Compra ficticia de coloración.'),
      (md5(v_user::text||':gasto:3')::uuid,v_user,v_hoy-5,'Internet del salón','Servicios',180000,null),
      (md5(v_user::text||':gasto:4')::uuid,v_user,v_hoy-7,'Electricidad','Servicios',290000,null),
      (md5(v_user::text||':gasto:5')::uuid,v_user,v_hoy-10,'Limpieza del salón','Limpieza',95000,null),
      (md5(v_user::text||':gasto:6')::uuid,v_user,v_hoy-13,'Esmaltes y bases','Insumos',310000,'Importes ficticios.'),
      (md5(v_user::text||':gasto:7')::uuid,v_user,v_hoy-17,'Agua y café','Servicios',85000,null),
      (md5(v_user::text||':gasto:8')::uuid,v_user,v_hoy-21,'Guantes y descartables','Insumos',125000,null),
      (md5(v_user::text||':gasto:9')::uuid,v_user,v_hoy-25,'Mantenimiento de herramientas','Mantenimiento',210000,null),
      (md5(v_user::text||':gasto:10')::uuid,v_user,v_hoy-29,'Lavandería de toallas','Servicios',115000,null)
    on conflict(id) do update set fecha=excluded.fecha,concepto=excluded.concepto,categoria=excluded.categoria,
      monto_gs=excluded.monto_gs,nota=excluded.nota
    where actual.user_id=excluded.user_id;
  end if;

  if v_productos_ok then
    insert into public.productos as actual(id,user_id,nombre,unidad,stock_actual,stock_minimo,costo_gs) values
      (md5(v_user::text||':producto:1')::uuid,v_user,'Oxidante 20 vol','litro',0.50,2.00,68000),
      (md5(v_user::text||':producto:2')::uuid,v_user,'Tinte castaño 6.3','tubo',1.00,3.00,45000),
      (md5(v_user::text||':producto:3')::uuid,v_user,'Shampoo nutritivo','litro',4.00,2.00,98000),
      (md5(v_user::text||':producto:4')::uuid,v_user,'Guantes descartables','caja',8.00,2.00,32000),
      (md5(v_user::text||':producto:5')::uuid,v_user,'Esmalte semipermanente','frasco',5.00,2.00,38000),
      (md5(v_user::text||':producto:6')::uuid,v_user,'Crema para tratamiento','litro',3.00,1.00,115000)
    on conflict(id) do update set nombre=excluded.nombre,unidad=excluded.unidad,stock_actual=excluded.stock_actual,
      stock_minimo=excluded.stock_minimo,costo_gs=excluded.costo_gs
    where actual.user_id=excluded.user_id;
  end if;

  if v_solicitudes_ok and v_servicios_ok then
    insert into public.solicitudes_reserva as actual(id,user_id,servicio_id,fecha,hora,nombre,telefono,estado) values
      (md5(v_user::text||':solicitud:1')::uuid,v_user,
        (select s.id from public.servicios s where s.user_id=v_user and s.nombre='Corte y brushing'),
        v_lunes_proximo+3,time '11:00','Reserva Plantilla A','0900-050-001','pendiente'),
      (md5(v_user::text||':solicitud:2')::uuid,v_user,
        (select s.id from public.servicios s where s.user_id=v_user and s.nombre='Manicura semipermanente'),
        v_lunes_proximo+4,time '10:00','Reserva Plantilla B','0900-050-002','pendiente')
    on conflict(id) do update set servicio_id=excluded.servicio_id,fecha=excluded.fecha,hora=excluded.hora,
      nombre=excluded.nombre,telefono=excluded.telefono,estado=excluded.estado
    where actual.user_id=excluded.user_id;
  elsif v_solicitudes_ok then
    raise notice 'Se omiten las solicitudes: también se necesita public.servicios.';
  end if;

  if v_reiniciar and v_clientas_ok and v_turnos_ok and v_pagos_ok and v_servicios_ok and v_empleadas_ok then
    select count(*) into v_cantidad_clientas from public.clientas c where c.user_id=v_user;
    select count(*) into v_cantidad_turnos from public.turnos t where t.user_id=v_user;
    select count(*) into v_cantidad_pagos from public.pagos p where p.user_id=v_user;
    select coalesce(sum(c.deuda_gs),0) into v_deuda_total_gs from public.clientas c where c.user_id=v_user;
    if v_cantidad_clientas<>25 or v_cantidad_turnos<>v_turnos_esperados or v_cantidad_pagos<>39 then
      raise exception 'El resumen esperado es 25 clientas, 55/56 turnos y 39 pagos; se encontraron %, % y %.',v_cantidad_clientas,v_cantidad_turnos,v_cantidad_pagos;
    end if;
    if v_deuda_total_gs<>280000 then
      raise exception 'La deuda ficticia esperada es Gs. 280.000, pero los triggers calcularon Gs. %.',v_deuda_total_gs;
    end if;
    select count(*) into v_clientas_con_deuda from public.clientas c where c.user_id=v_user and c.deuda_gs>0;
    if v_clientas_con_deuda<>4 then
      raise exception 'La plantilla esperaba 4 clientas con saldo pendiente, pero encontró %; revisá los triggers de deuda.',v_clientas_con_deuda;
    end if;
    select c.visitas into v_visitas_casi_premio from public.clientas c
      where c.user_id=v_user and c.id=md5(v_user::text||':clienta:24')::uuid;
    select c.visitas into v_visitas_premio from public.clientas c
      where c.user_id=v_user and c.id=md5(v_user::text||':clienta:25')::uuid;
    if v_visitas_casi_premio<>7 or v_visitas_premio<>8 then
      raise exception 'Las visitas de fidelización no se recalcularon como se esperaba (clientas 24 y 25: % y %).',v_visitas_casi_premio,v_visitas_premio;
    end if;
  end if;

  if v_clientas_ok then
    select count(*) into v_cantidad_clientas from public.clientas c where c.user_id=v_user;
    select coalesce(sum(c.deuda_gs),0) into v_deuda_total_gs from public.clientas c where c.user_id=v_user;
  end if;
  if v_turnos_ok then
    select count(*) into v_cantidad_turnos from public.turnos t where t.user_id=v_user;
  end if;
  if v_pagos_ok then
    select count(*) into v_cantidad_pagos from public.pagos p where p.user_id=v_user;
    select coalesce(sum(p.monto_gs),0) into v_ingresos_mes_gs
    from public.pagos p
    where p.user_id=v_user and p.fecha>=date_trunc('month',v_hoy)::date and p.fecha<=v_hoy;
  end if;

  insert into pg_temp.seed_plantilla_resumen values
    (v_cantidad_clientas,v_cantidad_turnos,v_cantidad_pagos,v_deuda_total_gs,v_ingresos_mes_gs);
  raise notice 'Cuenta plantilla cargada para %. Reinicio: %.',v_email,v_reiniciar;
end;
$seed$;

select cantidad_clientas,cantidad_turnos,cantidad_pagos,deuda_total_gs,ingresos_mes_gs
from seed_plantilla_resumen;
commit;
