-- DEMO únicamente. Crear antes en Supabase Auth el usuario demo@agendapora.test.
-- Repetir el script reemplaza los datos de ese usuario demo; no toca otras cuentas.
begin;
do $$
declare v_user uuid;
begin
  select id into v_user from auth.users where email='demo@agendapora.test' limit 1;
  if v_user is null then raise exception 'Creá demo@agendapora.test en Authentication antes de ejecutar este seed'; end if;
  if not exists(select 1 from public.perfiles where user_id=v_user) then raise exception 'Ejecutá schema.sql primero para crear el perfil'; end if;

  delete from public.fotos_clienta where user_id=v_user;
  delete from public.pagos where user_id=v_user;
  delete from public.turnos where user_id=v_user;
  delete from public.solicitudes_reserva where user_id=v_user;
  delete from public.gastos where user_id=v_user;
  delete from public.productos where user_id=v_user;
  delete from public.empleadas where user_id=v_user;
  delete from public.plantillas where user_id=v_user;
  delete from public.servicios where user_id=v_user;
  delete from public.clientas where user_id=v_user;

  update public.perfiles set nombre='Bella Luna Estudio',slug='bella-luna-demo',email_contacto='demo@agendapora.test',
    telefono='0000000000',direccion='Villa Morra · Asunción',color_principal='#a84462',horario_texto='Lun a sáb · 08:00 a 18:00',
    horarios='{"1":{"inicio":"08:00","fin":"18:00"},"2":{"inicio":"08:00","fin":"18:00"},"3":{"inicio":"08:00","fin":"18:00"},"4":{"inicio":"08:00","fin":"18:00"},"5":{"inicio":"08:00","fin":"18:00"},"6":{"inicio":"08:00","fin":"16:00"}}'::jsonb,
    vence_el=(now() at time zone 'America/Asuncion')::date+90,activo=true,visitas_premio=8,premio_descripcion='Brushing de regalo'
    where user_id=v_user;

  insert into public.servicios(user_id,nombre,precio_gs,duracion_min,activo) values
    (v_user,'Corte y brushing',85000,60,true),(v_user,'Coloración completa',260000,180,true),(v_user,'Balayage',480000,240,true),
    (v_user,'Manicura semipermanente',95000,75,true),(v_user,'Tratamiento capilar',150000,90,true);
  insert into public.empleadas(user_id,nombre,telefono,comision_pct,activa) values
    (v_user,'Camila Benítez','0000000001',35,true),(v_user,'Micaela Rojas','0000000002',30,true);
  insert into public.plantillas(user_id,clave,nombre,contenido) values
    (v_user,'recordatorio','Recordatorio de turno','Hola {nombre} 😊 Te recuerdo tu turno en {salon} el {fecha} a las {hora}. ¡Te esperamos!'),
    (v_user,'deuda','Aviso de saldo','Hola {nombre}, tu saldo pendiente en {salon} es {deuda}.'),
    (v_user,'promo','Promoción','Hola {nombre} 💕 Tenemos una promo especial en {salon}. ¡Escribinos para reservar!'),
    (v_user,'cumple','Cumpleaños','¡Feliz cumpleaños, {nombre}! 🎂 Te deseamos un hermoso día. Te esperamos en {salon}.'),
    (v_user,'reactivacion','Te extrañamos','Hola {nombre} 💖 Hace un tiempo no te vemos por {salon}. ¿Agendamos?');

  insert into public.clientas(user_id,nombre,telefono,email,fecha_nacimiento,notas)
  select v_user,n.nombre,'00000000'||lpad(i::text,2,'0'),'clienta'||i||'@demo.test',
    ((now() at time zone 'America/Asuncion')::date - ((i*13+28)%360)),
    case when i%4=0 then 'Fórmula habitual: tono castaño cálido. Confirmar alergias antes de aplicar.' else null end
  from (values
    (1,'Ana Martínez'),(2,'Lucía González'),(3,'Sofía Benítez'),(4,'Micaela López'),(5,'Valentina Giménez'),
    (6,'Camila Fernández'),(7,'Julieta Rojas'),(8,'María Duarte'),(9,'Carolina Acosta'),(10,'Belén Vera'),
    (11,'Milagros Ramírez'),(12,'Agustina Ortiz'),(13,'Paola Ferreira'),(14,'Nadia Villalba'),(15,'Florencia Cáceres'),
    (16,'Rocío Franco'),(17,'Daniela Ayala'),(18,'Natalia Silva'),(19,'Cecilia Cabrera'),(20,'Noelia Aquino')
  ) as n(i,nombre);

  -- Catorce turnos en fechas distintas muestran historial, caja y agenda sin solapamientos.
  insert into public.turnos(user_id,clienta_id,servicio_id,empleada_id,fecha,hora,precio_gs,estado,notas)
  select v_user,c.id,s.id,e.id,
    (now() at time zone 'America/Asuncion')::date + case when g.i<=8 then -(g.i*3) else (g.i-8)*2 end,
    time '09:00' + ((g.i%4)*interval '90 minutes'),s.precio_gs,
    case when g.i<=8 then 'hecho' else 'pendiente' end,
    case when g.i=2 then 'Fórmula: 6.3 + reflejo dorado, oxidante 20 vol.' else null end
  from generate_series(1,14) g(i)
  join public.clientas c on c.user_id=v_user and c.nombre=(array['Ana Martínez','Lucía González','Sofía Benítez','Micaela López','Valentina Giménez','Camila Fernández','Julieta Rojas','María Duarte','Carolina Acosta','Belén Vera','Milagros Ramírez','Agustina Ortiz','Paola Ferreira','Nadia Villalba'])[g.i]
  join public.servicios s on s.user_id=v_user and s.nombre=(array['Corte y brushing','Coloración completa','Balayage','Manicura semipermanente','Tratamiento capilar'])[((g.i-1)%5)+1]
  join public.empleadas e on e.user_id=v_user and e.nombre=case when g.i%2=0 then 'Camila Benítez' else 'Micaela Rojas' end;

  insert into public.pagos(user_id,turno_id,clienta_id,fecha,monto_gs,medio,nota)
  select v_user,t.id,t.clienta_id,t.fecha,t.precio_gs,case when extract(day from t.fecha)::integer%2=0 then 'Efectivo' else 'Transferencia' end,'Pago demo'
  from public.turnos t where t.user_id=v_user and t.estado='hecho' and t.fecha < (now() at time zone 'America/Asuncion')::date-8
  order by t.fecha limit 5;

  insert into public.gastos(user_id,fecha,concepto,categoria,monto_gs,nota) values
    (v_user,(now() at time zone 'America/Asuncion')::date-2,'Reposición de tintes','Insumos',380000,'Tonos de coloración'),
    (v_user,(now() at time zone 'America/Asuncion')::date-5,'Alquiler del local','Local',2200000,null),
    (v_user,(now() at time zone 'America/Asuncion')::date-8,'Productos de cuidado','Insumos',540000,null),
    (v_user,(now() at time zone 'America/Asuncion')::date-12,'Servicio de internet','Servicios',180000,null),
    (v_user,(now() at time zone 'America/Asuncion')::date-16,'Limpieza del salón','Local',125000,null);
  insert into public.productos(user_id,nombre,unidad,stock_actual,stock_minimo,costo_gs) values
    (v_user,'Oxidante 20 vol','litro',1,2,65000),(v_user,'Tinte castaño 6.3','tubo',5,3,42000),(v_user,'Shampoo hidratante','litro',2,2,95000),(v_user,'Guantes descartables','caja',7,2,28000);

  insert into public.solicitudes_reserva(user_id,servicio_id,fecha,hora,nombre,telefono)
  select v_user,s.id,(now() at time zone 'America/Asuncion')::date+1,time '14:00','Brenda Demo','0000000003'
  from public.servicios s where s.user_id=v_user and s.nombre='Corte y brushing';
end $$;
commit;
