-- Corrige disponibilidad pública: intervalos completos y revalidación al aceptar.
-- Ejecutar en Supabase → SQL Editor como postgres.
begin;
-- Valida un intervalo completo, no solo la hora de inicio. También se usa al
-- insertar y aceptar reservas para que la lista y el guardado compartan reglas.
create or replace function public.reserva_slot_disponible(p_user_id uuid,p_fecha date,p_hora time,p_duracion_min integer,p_excluir_solicitud uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_horarios jsonb; v_dow text; v_inicio time; v_fin time; v_hoy date; v_ahora time;
begin
  if p_user_id is null or p_fecha is null or p_hora is null or p_duracion_min is null or p_duracion_min not between 5 and 600 then return false; end if;
  v_hoy := (pg_catalog.now() at time zone 'America/Asuncion')::date;
  v_ahora := (pg_catalog.now() at time zone 'America/Asuncion')::time;
  if p_fecha < v_hoy or p_fecha > v_hoy + 90 or (p_fecha=v_hoy and p_hora<=v_ahora) then return false; end if;
  if date_part('second',p_hora)<>0 or mod(date_part('minute',p_hora)::integer,15)<>0 then return false; end if;
  select p.horarios into v_horarios from public.perfiles p
    where p.user_id=p_user_id and p.activo and p.vence_el>=v_hoy;
  if not found then return false; end if;
  v_dow:=extract(dow from p_fecha)::integer::text;
  if not (v_horarios ? v_dow) then return false; end if;
  begin
    v_inicio:=(v_horarios->v_dow->>'inicio')::time;
    v_fin:=(v_horarios->v_dow->>'fin')::time;
  exception when others then return false;
  end;
  if v_inicio is null or v_fin is null or p_hora<v_inicio or
      (p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min))>(p_fecha+v_fin) then return false; end if;
  if exists(
    select 1 from public.turnos t left join public.servicios s on s.user_id=t.user_id and s.id=t.servicio_id
    where t.user_id=p_user_id and t.fecha=p_fecha and t.estado<>'cancelado'
      and (p_fecha+p_hora)<(t.fecha+t.hora+pg_catalog.make_interval(mins=>coalesce(s.duracion_min,60)))
      and (t.fecha+t.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min))
  ) then return false; end if;
  if exists(
    select 1 from public.solicitudes_reserva r join public.servicios s on s.user_id=r.user_id and s.id=r.servicio_id
    where r.user_id=p_user_id and r.fecha=p_fecha and r.estado='pendiente'
      and r.id is distinct from p_excluir_solicitud
      and (p_fecha+p_hora)<(r.fecha+r.hora+pg_catalog.make_interval(mins=>s.duracion_min))
      and (r.fecha+r.hora)<(p_fecha+p_hora+pg_catalog.make_interval(mins=>p_duracion_min))
  ) then return false; end if;
  return true;
end $$;

create or replace function public.public_slots(p_slug text,p_fecha date,p_servicio_id uuid)
returns table(hora time) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid; v_hours jsonb; v_dow text; v_start time; v_end time; v_duration integer; v_slot time; v_today date;
begin
  v_today := (pg_catalog.now() at time zone 'America/Asuncion')::date;
  select p.user_id,p.horarios into v_user,v_hours from public.perfiles p where p.slug=p_slug and p.activo and p.vence_el>=v_today;
  if v_user is null or p_fecha<v_today or p_fecha>v_today+90 then return; end if;
  select s.duracion_min into v_duration from public.servicios s where s.user_id=v_user and s.id=p_servicio_id and s.activo;
  if v_duration is null then return; end if;
  v_dow:=extract(dow from p_fecha)::integer::text;
  if not (v_hours ? v_dow) then return; end if;
  begin v_start:=(v_hours->v_dow->>'inicio')::time; v_end:=(v_hours->v_dow->>'fin')::time; exception when others then return; end;
  if v_start is null or v_end is null then return; end if;
  v_slot:=v_start;
  while (p_fecha+v_slot+pg_catalog.make_interval(mins=>v_duration)) <= (p_fecha+v_end) loop
    if public.reserva_slot_disponible(v_user,p_fecha,v_slot,v_duration,null) then hora:=v_slot; return next; end if;
    v_slot:=v_slot+interval '15 minutes';
  end loop;
end $$;

create or replace function public.public_request_booking(p_slug text,p_servicio_id uuid,p_fecha date,p_hora time,p_nombre text,p_telefono text,p_website text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_duration integer; v_phone text; v_id uuid; v_today date;
begin
  v_today := (now() at time zone 'America/Asuncion')::date;
  if coalesce(p_website,'')<>'' then raise exception 'Solicitud no válida' using errcode='22023'; end if;
  if char_length(coalesce(p_nombre,'')) not between 1 and 80 then raise exception 'Ingresá un nombre válido' using errcode='22023'; end if;
  if char_length(coalesce(p_telefono,'')) not between 7 and 24 or p_telefono !~ '^[+0-9() .-]{7,24}$' then raise exception 'Ingresá un teléfono válido' using errcode='22023'; end if;
  if p_fecha<v_today or p_fecha>v_today+90 then raise exception 'La fecha no está disponible' using errcode='22023'; end if;
  v_phone:=regexp_replace(p_telefono,'\D','','g');
  if char_length(v_phone) not between 7 and 15 then raise exception 'Ingresá un teléfono válido' using errcode='22023'; end if;
  if char_length(v_phone)=9 then v_phone:='595'||v_phone;
  elsif left(v_phone,1)='0' then v_phone:='595'||substr(v_phone,2); end if;
  select p.user_id into v_user from public.perfiles p where p.slug=p_slug and p.activo and p.vence_el>=v_today;
  if v_user is null then raise exception 'El salón no recibe reservas actualmente' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':phone:' || v_phone,0));
  if (select count(*) from public.solicitudes_reserva r where r.user_id=v_user and
      (case when char_length(regexp_replace(r.telefono,'\D','','g'))=9 then '595'||regexp_replace(r.telefono,'\D','','g')
            when left(regexp_replace(r.telefono,'\D','','g'),1)='0' then '595'||substr(regexp_replace(r.telefono,'\D','','g'),2)
            else regexp_replace(r.telefono,'\D','','g') end)=v_phone and r.created_at>now()-interval '1 hour')>=3 then
    raise exception 'Llegaste al límite de solicitudes por ahora' using errcode='22023';
  end if;
  select s.duracion_min into v_duration from public.servicios s where s.user_id=v_user and s.id=p_servicio_id and s.activo;
  if v_duration is null then raise exception 'El servicio ya no está disponible' using errcode='P0002'; end if;
  -- Usa la misma cerradura que el trigger de turnos; revalida después de
  -- obtenerla para que dos solicitudes simultáneas no ocupen el mismo tramo.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || p_fecha::text,0));
  if not public.reserva_slot_disponible(v_user,p_fecha,p_hora,v_duration,null) then
    raise exception 'Ese horario ya no está disponible' using errcode='23P01';
  end if;
  insert into public.solicitudes_reserva(user_id,servicio_id,fecha,hora,nombre,telefono)
    values(v_user,p_servicio_id,p_fecha,p_hora,btrim(p_nombre),btrim(p_telefono)) returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.resolver_solicitud_reserva(p_solicitud_id uuid,p_aceptar boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_req public.solicitudes_reserva%rowtype; v_service public.servicios%rowtype; v_client uuid; v_turno uuid;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  select * into v_req from public.solicitudes_reserva r where r.id=p_solicitud_id and r.user_id=v_user and r.estado='pendiente' for update;
  if not found then raise exception 'La solicitud ya fue atendida o no existe' using errcode='P0002'; end if;
  if not p_aceptar then update public.solicitudes_reserva set estado='rechazada' where id=v_req.id and user_id=v_user; return jsonb_build_object('ok',true); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || v_req.fecha::text,0));
  select * into v_service from public.servicios s where s.user_id=v_user and s.id=v_req.servicio_id and s.activo for share;
  if not found or not public.reserva_slot_disponible(v_user,v_req.fecha,v_req.hora,v_service.duracion_min,v_req.id) then
    raise exception 'Ese horario ya no está disponible; rechazá la solicitud o elegí otro horario' using errcode='23P01';
  end if;
  select c.id into v_client from public.clientas c
    where c.user_id=v_user
      and (case when char_length(regexp_replace(coalesce(c.telefono,''),'\D','','g'))=9 then '595'||regexp_replace(coalesce(c.telefono,''),'\D','','g')
                when left(regexp_replace(coalesce(c.telefono,''),'\D','','g'),1)='0' then '595'||substr(regexp_replace(coalesce(c.telefono,''),'\D','','g'),2)
                else regexp_replace(coalesce(c.telefono,''),'\D','','g') end)
          = (case when char_length(regexp_replace(v_req.telefono,'\D','','g'))=9 then '595'||regexp_replace(v_req.telefono,'\D','','g')
                  when left(regexp_replace(v_req.telefono,'\D','','g'),1)='0' then '595'||substr(regexp_replace(v_req.telefono,'\D','','g'),2)
                  else regexp_replace(v_req.telefono,'\D','','g') end)
    order by c.created_at limit 1;
  if v_client is null then
    insert into public.clientas(user_id,nombre,telefono) values(v_user,v_req.nombre,v_req.telefono) returning id into v_client;
  end if;
  insert into public.turnos(user_id,clienta_id,servicio_id,fecha,hora,precio_gs,estado,nombre_publico,telefono_publico)
    values(v_user,v_client,v_req.servicio_id,v_req.fecha,v_req.hora,v_service.precio_gs,'pendiente',v_req.nombre,v_req.telefono) returning id into v_turno;
  update public.solicitudes_reserva set estado='aceptada' where id=v_req.id and user_id=v_user;
  return jsonb_build_object('ok',true,'id',v_turno,'nombre',v_req.nombre,'telefono',v_req.telefono,'fecha',v_req.fecha,'hora',v_req.hora);
end $$;
revoke all on function public.reserva_slot_disponible(uuid,date,time,integer,uuid) from public,anon,authenticated;
revoke all on function public.public_slots(text,date,uuid) from public;
revoke all on function public.public_request_booking(text,uuid,date,time,text,text,text) from public;
revoke all on function public.resolver_solicitud_reserva(uuid,boolean) from public,anon;
grant execute on function public.public_slots(text,date,uuid) to anon,authenticated;
grant execute on function public.public_request_booking(text,uuid,date,time,text,text,text) to anon,authenticated;
grant execute on function public.resolver_solicitud_reserva(uuid,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
