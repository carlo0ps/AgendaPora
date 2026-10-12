-- Mis Clientas · esquema inicial multi-tenant para Supabase.
-- Ejecutar en SQL Editor como postgres. Todas las funciones privilegiadas fijan un search_path vacío.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Una fila por cuenta autenticada. La fila se crea con el trigger de auth.users.
create table if not exists public.perfiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  nombre text not null default 'Mi salón' check (char_length(nombre) between 1 and 100),
  slug text not null unique,
  email_contacto text,
  telefono text check (telefono is null or char_length(telefono) <= 24),
  direccion text check (direccion is null or char_length(direccion) <= 180),
  logo_url text,
  color_principal text not null default '#a84462' check (color_principal ~ '^#[0-9A-Fa-f]{6}$'),
  horario_texto text,
  horarios jsonb not null default '{"1":{"inicio":"08:00","fin":"18:00"},"2":{"inicio":"08:00","fin":"18:00"},"3":{"inicio":"08:00","fin":"18:00"},"4":{"inicio":"08:00","fin":"18:00"},"5":{"inicio":"08:00","fin":"18:00"},"6":{"inicio":"08:00","fin":"16:00"}}'::jsonb,
  vence_el date not null default (((now() at time zone 'America/Asuncion')::date) + 7),
  activo boolean not null default true,
  es_admin boolean not null default false,
  notas_internas text,
  precio_mensual_gs bigint not null default 99000 check (precio_mensual_gs >= 0),
  visitas_premio integer not null default 10 check (visitas_premio between 2 and 100),
  premio_descripcion text not null default 'Servicio o descuento especial',
  telefono_soporte text,
  onboarding_estado text not null default 'pendiente',
  constraint perfiles_slug_formato check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Actualización idempotente para proyectos que ya tienen perfiles.
alter table public.perfiles add column if not exists onboarding_estado text not null default 'pendiente';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.perfiles'::regclass and conname='perfiles_onboarding_estado_check') then
    alter table public.perfiles add constraint perfiles_onboarding_estado_check check (onboarding_estado in ('pendiente','omitido','completado'));
  end if;
end $$;

create table if not exists public.clientas (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), nombre text not null check (char_length(nombre) between 1 and 100),
  telefono text check (telefono is null or char_length(telefono) <= 24), email text check (email is null or char_length(email) <= 160),
  fecha_nacimiento date, notas text check (notas is null or char_length(notas) <= 4000), deuda_gs bigint not null default 0 check (deuda_gs >= 0), visitas integer not null default 0 check (visitas >= 0),
  unique(user_id,id)
);

create table if not exists public.servicios (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), nombre text not null check (char_length(nombre) between 1 and 100),
  precio_gs bigint not null default 0 check (precio_gs >= 0), duracion_min integer not null default 60 check (duracion_min between 5 and 600), activo boolean not null default true,
  unique(user_id,id), unique(user_id,nombre)
);

create table if not exists public.empleadas (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), nombre text not null check (char_length(nombre) between 1 and 100),
  telefono text check (telefono is null or char_length(telefono) <= 24), comision_pct numeric(5,2) not null default 0 check (comision_pct between 0 and 100), activa boolean not null default true,
  unique(user_id,id)
);

create table if not exists public.turnos (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), clienta_id uuid, servicio_id uuid, empleada_id uuid,
  fecha date not null, hora time not null, precio_gs bigint not null default 0 check (precio_gs >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','hecho','cancelado')),
  notas text check (notas is null or char_length(notas) <= 2000), nombre_publico text, telefono_publico text,
  constraint turnos_clienta_fk foreign key(user_id,clienta_id) references public.clientas(user_id,id) on delete set null (clienta_id),
  constraint turnos_servicio_fk foreign key(user_id,servicio_id) references public.servicios(user_id,id) on delete set null (servicio_id),
  constraint turnos_empleada_fk foreign key(user_id,empleada_id) references public.empleadas(user_id,id) on delete set null (empleada_id),
  unique(user_id,id)
);

create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), turno_id uuid not null, clienta_id uuid,
  fecha date not null default ((now() at time zone 'America/Asuncion')::date), monto_gs bigint not null check (monto_gs > 0),
  medio text not null default 'Efectivo' check (char_length(medio) between 1 and 40), nota text check (nota is null or char_length(nota) <= 500),
  constraint pagos_turno_fk foreign key(user_id,turno_id) references public.turnos(user_id,id) on delete restrict,
  constraint pagos_clienta_fk foreign key(user_id,clienta_id) references public.clientas(user_id,id) on delete set null (clienta_id),
  unique(user_id,id)
);

create table if not exists public.plantillas (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), clave text not null check (clave in ('recordatorio','deuda','promo','cumple','reactivacion')),
  nombre text not null check (char_length(nombre) between 1 and 80), contenido text not null check (char_length(contenido) between 1 and 1500),
  unique(user_id,id), unique(user_id,clave)
);

create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), fecha date not null default ((now() at time zone 'America/Asuncion')::date), concepto text not null check (char_length(concepto) between 1 and 120),
  categoria text check (categoria is null or char_length(categoria) <= 60), monto_gs bigint not null check (monto_gs > 0), nota text check (nota is null or char_length(nota) <= 1000),
  unique(user_id,id)
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), nombre text not null check (char_length(nombre) between 1 and 100),
  unidad text not null default 'unidad' check (char_length(unidad) between 1 and 30), stock_actual numeric(12,2) not null default 0 check (stock_actual >= 0),
  stock_minimo numeric(12,2) not null default 0 check (stock_minimo >= 0), costo_gs bigint not null default 0 check (costo_gs >= 0), unique(user_id,id)
);

create table if not exists public.solicitudes_reserva (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), servicio_id uuid not null, fecha date not null, hora time not null,
  nombre text not null check (char_length(nombre) between 1 and 80), telefono text not null check (char_length(telefono) between 7 and 24),
  estado text not null default 'pendiente' check (estado in ('pendiente','aceptada','rechazada')),
  constraint solicitudes_servicio_fk foreign key(user_id,servicio_id) references public.servicios(user_id,id) on delete cascade,
  unique(user_id,id)
);

create table if not exists public.pagos_suscripcion (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), fecha date not null default ((now() at time zone 'America/Asuncion')::date), monto_gs bigint not null check (monto_gs > 0),
  periodo_hasta date, nota_interna text check (nota_interna is null or char_length(nota_interna) <= 1000), registrado_por uuid references auth.users(id) on delete set null,
  unique(user_id,id)
);

create table if not exists public.fotos_clienta (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), clienta_id uuid not null, storage_path text not null check (char_length(storage_path) <= 500),
  tipo text not null default 'Antes' check (tipo in ('Antes','Después','Despues')), nota text check (nota is null or char_length(nota) <= 500),
  constraint fotos_clienta_fk foreign key(user_id,clienta_id) references public.clientas(user_id,id) on delete cascade,
  unique(user_id,id), unique(user_id,storage_path)
);

-- Índices por tenant y por los campos que usa la agenda, búsqueda e informes.
create index if not exists clientas_user_nombre_idx on public.clientas(user_id, nombre);
create index if not exists clientas_user_telefono_idx on public.clientas(user_id, telefono);
create index if not exists clientas_user_cumple_idx on public.clientas(user_id, fecha_nacimiento);
create index if not exists servicios_user_activo_idx on public.servicios(user_id, activo);
create index if not exists turnos_user_fecha_hora_idx on public.turnos(user_id, fecha, hora);
create index if not exists turnos_user_clienta_fecha_idx on public.turnos(user_id, clienta_id, fecha desc);
create index if not exists pagos_user_fecha_idx on public.pagos(user_id, fecha);
create index if not exists pagos_user_clienta_idx on public.pagos(user_id, clienta_id);
create index if not exists gastos_user_fecha_idx on public.gastos(user_id, fecha desc);
create index if not exists productos_user_nombre_idx on public.productos(user_id, nombre);
create index if not exists solicitudes_user_estado_fecha_idx on public.solicitudes_reserva(user_id, estado, fecha, hora);
create index if not exists solicitudes_phone_created_idx on public.solicitudes_reserva(user_id, telefono, created_at desc);
create index if not exists pagos_suscripcion_user_fecha_idx on public.pagos_suscripcion(user_id, fecha desc);
create index if not exists fotos_clienta_user_clienta_idx on public.fotos_clienta(user_id, clienta_id);

-- Trigger que agrega una cuenta de prueba por siete días cuando Auth crea un usuario.
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_base text; v_slug text;
begin
  v_base := lower(regexp_replace(split_part(coalesce(new.email,'salon'), '@', 1), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'salon'; end if;
  v_slug := left(v_base, 42) || '-' || left(replace(new.id::text,'-',''), 8);
  insert into public.perfiles(user_id,nombre,slug,email_contacto,vence_el,activo)
  values(new.id,'Mi salón',v_slug,new.email,(now() at time zone 'America/Asuncion')::date + 7,true)
  on conflict(user_id) do nothing;
  return new;
end $$;
drop trigger if exists auth_user_crea_perfil on auth.users;
create trigger auth_user_crea_perfil after insert on auth.users for each row execute function public.crear_perfil_nuevo_usuario();

-- Helpers de autorización. El rol real se consulta en la tabla protegida, no en datos enviados por el navegador.
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfiles p where p.user_id = (select auth.uid()) and p.es_admin)
$$;
create or replace function public.cuenta_activa()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perfiles p where p.user_id = (select auth.uid()) and (
    p.es_admin or (p.activo and p.vence_el >= (now() at time zone 'America/Asuncion')::date)
  ))
$$;
revoke all on function public.es_admin() from public, anon;
revoke all on function public.cuenta_activa() from public, anon;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.cuenta_activa() to authenticated;

-- Impide que una usuaria se autoasigne privilegios o extensión de suscripción vía update directo.
create or replace function public.proteger_campos_perfil()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.es_admin() then
    if new.es_admin is distinct from old.es_admin or new.activo is distinct from old.activo or new.vence_el is distinct from old.vence_el or new.notas_internas is distinct from old.notas_internas or new.precio_mensual_gs is distinct from old.precio_mensual_gs or new.slug is distinct from old.slug then
      raise exception 'No se pueden cambiar los campos reservados a administración' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists perfiles_proteger_campos on public.perfiles;
create trigger perfiles_proteger_campos before update on public.perfiles for each row execute function public.proteger_campos_perfil();

-- Los valores derivados de deuda y fidelización no se editan desde el navegador.
create or replace function public.proteger_saldo_clienta()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.es_admin() and current_setting('mis_clientas.internal_recalculation',true) is distinct from 'on' then
    if tg_op='INSERT' and (new.deuda_gs<>0 or new.visitas<>0) then raise exception 'La deuda y las visitas se calculan desde turnos y pagos' using errcode='42501'; end if;
    if tg_op='UPDATE' and (new.deuda_gs is distinct from old.deuda_gs or new.visitas is distinct from old.visitas) then raise exception 'La deuda y las visitas se calculan desde turnos y pagos' using errcode='42501'; end if;
  end if;
  return new;
end $$;
drop trigger if exists clientas_proteger_saldo on public.clientas;
create trigger clientas_proteger_saldo before insert or update on public.clientas for each row execute function public.proteger_saldo_clienta();

-- Mantiene la atribución de pagos: un turno cobrado no puede cambiar de clienta ni perderla al borrarla.
create or replace function public.proteger_clienta_turno_con_pagos()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.clienta_id is distinct from old.clienta_id
    and exists(select 1 from public.pagos p where p.user_id=old.user_id and p.turno_id=old.id) then
    raise exception 'No se puede cambiar o eliminar la clienta de un turno con pagos asociados' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists turnos_proteger_clienta_con_pagos on public.turnos;
create trigger turnos_proteger_clienta_con_pagos before update of clienta_id on public.turnos for each row execute function public.proteger_clienta_turno_con_pagos();

-- Cualquier modificación que marque un turno como realizado recalcula visitas y deuda desde la fuente transaccional.
create or replace function public.recalcular_cliente(p_user_id uuid,p_clienta_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_visitas integer; v_deuda bigint;
begin
  if p_clienta_id is null then return; end if;
  select count(*)::integer into v_visitas from public.turnos t where t.user_id=p_user_id and t.clienta_id=p_clienta_id and t.estado='hecho';
  select coalesce(sum(greatest(t.precio_gs-coalesce(pg.total_pagado,0),0)),0)::bigint
    into v_deuda from public.turnos t
    left join (select p.turno_id,sum(p.monto_gs) as total_pagado from public.pagos p where p.user_id=p_user_id and p.clienta_id=p_clienta_id group by p.turno_id) pg
      on pg.turno_id=t.id
    where t.user_id=p_user_id and t.clienta_id=p_clienta_id and t.estado='hecho';
  perform pg_catalog.set_config('mis_clientas.internal_recalculation','on',true);
  update public.clientas set visitas=v_visitas,deuda_gs=v_deuda where user_id=p_user_id and id=p_clienta_id;
  perform pg_catalog.set_config('mis_clientas.internal_recalculation','off',true);
end $$;
create or replace function public.turno_recalcula_cliente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then perform public.recalcular_cliente(old.user_id,old.clienta_id); return old; end if;
  if tg_op='UPDATE' and old.clienta_id is distinct from new.clienta_id then perform public.recalcular_cliente(old.user_id,old.clienta_id); end if;
  perform public.recalcular_cliente(new.user_id,new.clienta_id); return new;
end $$;
drop trigger if exists turnos_recalcular_cliente on public.turnos;
create trigger turnos_recalcular_cliente after insert or update or delete on public.turnos for each row execute function public.turno_recalcula_cliente();
create or replace function public.pago_recalcula_cliente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then perform public.recalcular_cliente(old.user_id,old.clienta_id); return old; end if;
  if tg_op='UPDATE' and (old.clienta_id is distinct from new.clienta_id or old.user_id is distinct from new.user_id) then perform public.recalcular_cliente(old.user_id,old.clienta_id); end if;
  perform public.recalcular_cliente(new.user_id,new.clienta_id); return new;
end $$;
drop trigger if exists pagos_recalcular_cliente on public.pagos;
create trigger pagos_recalcular_cliente after insert or update or delete on public.pagos for each row execute function public.pago_recalcula_cliente();

-- Evita solapamientos entre turnos con duración de servicio. La cerradura serializa reservas concurrentes del mismo día.
create or replace function public.validar_disponibilidad_turno()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inicio timestamp; v_fin timestamp; v_solapado boolean;
begin
  if new.estado='cancelado' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || new.fecha::text, 0));
  v_inicio := new.fecha + new.hora;
  select v_inicio + make_interval(mins => coalesce(s.duracion_min,60)) into v_fin from (select 1) q left join public.servicios s on s.user_id=new.user_id and s.id=new.servicio_id;
  select exists(select 1 from public.turnos t left join public.servicios s on s.user_id=t.user_id and s.id=t.servicio_id
    where t.user_id=new.user_id and t.fecha=new.fecha and t.estado<>'cancelado' and t.id is distinct from new.id
      and (new.fecha+new.hora) < (t.fecha+t.hora+make_interval(mins=>coalesce(s.duracion_min,60)))
      and (t.fecha+t.hora) < v_fin) into v_solapado;
  if v_solapado then raise exception 'Ese horario ya está ocupado' using errcode='23P01'; end if;
  return new;
end $$;
drop trigger if exists turnos_validar_disponibilidad on public.turnos;
create trigger turnos_validar_disponibilidad before insert or update of fecha,hora,servicio_id,estado on public.turnos for each row execute function public.validar_disponibilidad_turno();

-- Pagos de turnos: una sola transacción y deuda recalculada por el trigger anterior.
create or replace function public.registrar_pago_turno(p_turno_id uuid,p_monto_gs bigint,p_fecha date default ((now() at time zone 'America/Asuncion')::date),p_medio text default 'Efectivo',p_nota text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_clienta uuid; v_pago uuid;
begin
  if v_user is null or not public.cuenta_activa() then raise exception 'Cuenta sin acceso de escritura' using errcode='42501'; end if;
  if p_monto_gs is null or p_monto_gs <= 0 then raise exception 'El monto debe ser mayor que cero' using errcode='22023'; end if;
  select t.clienta_id into v_clienta from public.turnos t where t.id=p_turno_id and t.user_id=v_user for update;
  if not found then raise exception 'No se encontró un turno de esta cuenta' using errcode='P0002'; end if;
  insert into public.pagos(user_id,turno_id,clienta_id,fecha,monto_gs,medio,nota)
  values(v_user,p_turno_id,v_clienta,p_fecha,p_monto_gs,left(coalesce(p_medio,'Efectivo'),40),nullif(left(coalesce(p_nota,''),500),'')) returning id into v_pago;
  return v_pago;
end $$;

-- Publicación mínima: datos del salón/servicios; nunca se exponen nombres o teléfonos de turnos existentes.
create or replace function public.public_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_perfil public.perfiles%rowtype; v_servicios jsonb;
begin
  select * into v_perfil from public.perfiles p where p.slug=p_slug and p.activo and p.vence_el>=(now() at time zone 'America/Asuncion')::date;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'nombre',s.nombre,'precio_gs',s.precio_gs,'duracion_min',s.duracion_min) order by s.nombre),'[]'::jsonb)
    into v_servicios from public.servicios s where s.user_id=v_perfil.user_id and s.activo;
  return jsonb_build_object('nombre',v_perfil.nombre,'direccion',v_perfil.direccion,'telefono',v_perfil.telefono,'logo_url',v_perfil.logo_url,'color_principal',v_perfil.color_principal,'horario_texto',v_perfil.horario_texto,'servicios',v_servicios);
end $$;

create or replace function public.public_slots(p_slug text,p_fecha date,p_servicio_id uuid)
returns table(hora time) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid; v_hours jsonb; v_dow text; v_start time; v_end time; v_duration integer; v_slot time; v_taken boolean; v_today date; v_local_time time;
begin
  v_today := (now() at time zone 'America/Asuncion')::date;
  v_local_time := (now() at time zone 'America/Asuncion')::time;
  select p.user_id,p.horarios into v_user,v_hours from public.perfiles p where p.slug=p_slug and p.activo and p.vence_el>=v_today;
  if v_user is null or p_fecha<v_today or p_fecha>v_today+90 then return; end if;
  select s.duracion_min into v_duration from public.servicios s where s.user_id=v_user and s.id=p_servicio_id and s.activo;
  if v_duration is null then return; end if;
  v_dow:=extract(dow from p_fecha)::integer::text;
  if not (v_hours ? v_dow) then return; end if;
  begin v_start:=(v_hours->v_dow->>'inicio')::time; v_end:=(v_hours->v_dow->>'fin')::time; exception when others then return; end;
  v_slot:=v_start;
  while v_slot + make_interval(mins=>v_duration) <= v_end loop
    v_taken:=exists(select 1 from public.turnos t left join public.servicios ts on ts.user_id=t.user_id and ts.id=t.servicio_id
      where t.user_id=v_user and t.fecha=p_fecha and t.estado<>'cancelado'
        and (p_fecha+v_slot)<(t.fecha+t.hora+make_interval(mins=>coalesce(ts.duracion_min,60)))
        and (t.fecha+t.hora)<(p_fecha+v_slot+make_interval(mins=>v_duration)))
      or exists(select 1 from public.solicitudes_reserva r join public.servicios rs on rs.user_id=r.user_id and rs.id=r.servicio_id
        where r.user_id=v_user and r.fecha=p_fecha and r.estado='pendiente'
          and (p_fecha+v_slot)<(r.fecha+r.hora+make_interval(mins=>rs.duracion_min))
          and (r.fecha+r.hora)<(p_fecha+v_slot+make_interval(mins=>v_duration)));
    if not v_taken and (p_fecha>v_today or v_slot>v_local_time) then hora:=v_slot; return next; end if;
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
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_fecha::text,0));
  if not exists(select 1 from public.public_slots(p_slug,p_fecha,p_servicio_id) sl where sl.hora=p_hora) then
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
  select * into v_service from public.servicios s where s.user_id=v_user and s.id=v_req.servicio_id;
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

-- Panel del producto: estas RPC nunca filtran datos si el llamante no es es_admin().
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_total integer; v_active integer; v_overdue integer; v_mrr bigint;
begin
  if not public.es_admin() then raise exception 'Solo administración' using errcode='42501'; end if;
  select count(*)::integer,count(*) filter(where p.activo and p.vence_el>=(now() at time zone 'America/Asuncion')::date)::integer,count(*) filter(where not p.activo or p.vence_el<(now() at time zone 'America/Asuncion')::date)::integer,
    coalesce(sum(p.precio_mensual_gs) filter(where p.activo and p.vence_el>=(now() at time zone 'America/Asuncion')::date and exists(select 1 from public.pagos_suscripcion ps where ps.user_id=p.user_id and ps.periodo_hasta>=(now() at time zone 'America/Asuncion')::date)),0)::bigint
    into v_total,v_active,v_overdue,v_mrr from public.perfiles p where p.es_admin = false;
  return jsonb_build_object('total',v_total,'activas',v_active,'vencidas',v_overdue,'mrr_gs',v_mrr);
end $$;
create or replace function public.admin_list_salones()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if not public.es_admin() then raise exception 'Solo administración' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_rows from (
    select p.user_id,p.nombre,p.slug,p.email_contacto,(select u.last_sign_in_at from auth.users u where u.id=p.user_id) as ultimo_acceso,p.created_at,p.vence_el,p.activo,p.notas_internas,p.precio_mensual_gs,
      (select count(*)::integer from public.clientas c where c.user_id=p.user_id) as cantidad_clientas,
      (select count(*)::integer from public.turnos t where t.user_id=p.user_id) as cantidad_turnos,
      (select max(ps.fecha) from public.pagos_suscripcion ps where ps.user_id=p.user_id) as ultimo_pago
    from public.perfiles p where p.es_admin = false
  ) x;
  return v_rows;
end $$;
create or replace function public.admin_update_salon(p_user_id uuid,p_activo boolean,p_vence_el date,p_notas_internas text,p_precio_mensual_gs bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then raise exception 'Solo administración' using errcode='42501'; end if;
  if p_vence_el is null or char_length(coalesce(p_notas_internas,''))>5000 or (p_precio_mensual_gs is not null and p_precio_mensual_gs<0) then raise exception 'Datos inválidos' using errcode='22023'; end if;
  update public.perfiles set activo=p_activo,vence_el=p_vence_el,notas_internas=nullif(p_notas_internas,''),precio_mensual_gs=coalesce(p_precio_mensual_gs,precio_mensual_gs) where user_id=p_user_id and not es_admin;
  if not found then raise exception 'Salón no encontrado' using errcode='P0002'; end if;
end $$;
-- Retirar cualquier versión anterior: PostgREST requiere nombres y tipos de argumentos exactos.
do $$
declare v_argumentos text;
begin
  for v_argumentos in
    select pg_catalog.pg_get_function_identity_arguments(p.oid)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_registrar_pago' and p.prokind='f'
  loop
    execute pg_catalog.format('drop function public.admin_registrar_pago(%s)',v_argumentos);
  end loop;
end $$;
create function public.admin_registrar_pago(p_user_id uuid,p_monto_gs bigint,p_fecha date,p_meses integer,p_nota text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_hoy date := (pg_catalog.now() at time zone 'America/Asuncion')::date;
  v_vence date;
begin
  if not public.es_admin() then raise exception 'Solo administración' using errcode='42501'; end if;
  if p_monto_gs is null or p_monto_gs<=0 or p_fecha is null or p_meses is null or p_meses not between 1 and 12 or char_length(coalesce(p_nota,''))>1000 then
    raise exception 'Datos de pago inválidos' using errcode='22023';
  end if;
  select vence_el into v_vence from public.perfiles where user_id=p_user_id and not es_admin for update;
  if not found then raise exception 'Salón no encontrado' using errcode='P0002'; end if;
  v_vence := (greatest(coalesce(v_vence,v_hoy),v_hoy)::timestamp + pg_catalog.make_interval(months => p_meses))::date;
  insert into public.pagos_suscripcion(user_id,monto_gs,fecha,periodo_hasta,nota_interna,registrado_por)
    values(p_user_id,p_monto_gs,p_fecha,v_vence,nullif(p_nota,''),auth.uid()) returning id into v_id;
  update public.perfiles set vence_el=v_vence,activo=true where user_id=p_user_id and not es_admin;
  if not found then raise exception 'Salón no encontrado' using errcode='P0002'; end if;
  return v_id;
end $$;

-- RLS se aplica a cada tabla. Select propio sigue disponible en lectura tras vencimiento; mutaciones exigen suscripción vigente.
alter table public.perfiles enable row level security;
alter table public.clientas enable row level security;
alter table public.servicios enable row level security;
alter table public.turnos enable row level security;
alter table public.pagos enable row level security;
alter table public.plantillas enable row level security;
alter table public.gastos enable row level security;
alter table public.productos enable row level security;
alter table public.empleadas enable row level security;
alter table public.solicitudes_reserva enable row level security;
alter table public.pagos_suscripcion enable row level security;
alter table public.fotos_clienta enable row level security;

drop policy if exists perfiles_select_propio_admin on public.perfiles;
create policy perfiles_select_propio_admin on public.perfiles for select to authenticated using ((select auth.uid())=user_id or (select public.es_admin()));
drop policy if exists perfiles_update_propio on public.perfiles;
create policy perfiles_update_propio on public.perfiles for update to authenticated using ((select auth.uid())=user_id and (select public.cuenta_activa())) with check ((select auth.uid())=user_id and (select public.cuenta_activa()) or (select public.es_admin()));
drop policy if exists perfiles_update_admin on public.perfiles;
create policy perfiles_update_admin on public.perfiles for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
drop policy if exists perfiles_insert_no_client on public.perfiles;
create policy perfiles_insert_no_client on public.perfiles for insert to authenticated with check (false);
drop policy if exists perfiles_delete_no_client on public.perfiles;
create policy perfiles_delete_no_client on public.perfiles for delete to authenticated using (false);

-- Generate four distinct CRUD policies for each tenant-owned table.
do $$
declare t text; pol text;
begin
  foreach t in array array['clientas','servicios','turnos','pagos','plantillas','gastos','productos','empleadas','fotos_clienta'] loop
    execute format('drop policy if exists %I on public.%I',t||'_select_own',t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=user_id)',t||'_select_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert_active',t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid())=user_id and (select public.cuenta_activa()))',t||'_insert_active',t);
    execute format('drop policy if exists %I on public.%I',t||'_update_active',t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid())=user_id and (select public.cuenta_activa())) with check ((select auth.uid())=user_id and (select public.cuenta_activa()))',t||'_update_active',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete_active',t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid())=user_id and (select public.cuenta_activa()))',t||'_delete_active',t);
  end loop;
end $$;

-- La app registra cobros mediante la RPC transaccional. El historial queda de solo lectura para el salón.
-- Se aplican después del bloque genérico para que sus políticas permisivas no habiliten escritura directa.
drop policy if exists pagos_insert_active on public.pagos;
drop policy if exists pagos_insert_rpc_only on public.pagos;
create policy pagos_insert_rpc_only on public.pagos for insert to authenticated with check (false);
drop policy if exists pagos_update_active on public.pagos;
drop policy if exists pagos_update_rpc_only on public.pagos;
create policy pagos_update_rpc_only on public.pagos for update to authenticated using (false) with check (false);
drop policy if exists pagos_delete_active on public.pagos;
drop policy if exists pagos_delete_rpc_only on public.pagos;
create policy pagos_delete_rpc_only on public.pagos for delete to authenticated using (false);

drop policy if exists solicitudes_select_own on public.solicitudes_reserva;
create policy solicitudes_select_own on public.solicitudes_reserva for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists solicitudes_insert_rpc_only on public.solicitudes_reserva;
create policy solicitudes_insert_rpc_only on public.solicitudes_reserva for insert to authenticated with check (false);
drop policy if exists solicitudes_update_active on public.solicitudes_reserva;
create policy solicitudes_update_active on public.solicitudes_reserva for update to authenticated using ((select auth.uid())=user_id and (select public.cuenta_activa())) with check ((select auth.uid())=user_id and (select public.cuenta_activa()));
drop policy if exists solicitudes_delete_active on public.solicitudes_reserva;
create policy solicitudes_delete_active on public.solicitudes_reserva for delete to authenticated using ((select auth.uid())=user_id and (select public.cuenta_activa()));

drop policy if exists pagos_suscripcion_admin_select on public.pagos_suscripcion;
create policy pagos_suscripcion_admin_select on public.pagos_suscripcion for select to authenticated using ((select public.es_admin()));
drop policy if exists pagos_suscripcion_admin_insert_rpc on public.pagos_suscripcion;
create policy pagos_suscripcion_admin_insert_rpc on public.pagos_suscripcion for insert to authenticated with check (false);
drop policy if exists pagos_suscripcion_admin_update_rpc on public.pagos_suscripcion;
create policy pagos_suscripcion_admin_update_rpc on public.pagos_suscripcion for update to authenticated using (false) with check (false);
drop policy if exists pagos_suscripcion_admin_delete_rpc on public.pagos_suscripcion;
create policy pagos_suscripcion_admin_delete_rpc on public.pagos_suscripcion for delete to authenticated using (false);

-- Privilegios API explícitos; RLS sigue filtrando cada fila.
grant usage on schema public to anon, authenticated;
grant select,insert,update,delete on public.perfiles,public.clientas,public.servicios,public.turnos,public.pagos,public.plantillas,public.gastos,public.productos,public.empleadas,public.solicitudes_reserva,public.pagos_suscripcion,public.fotos_clienta to authenticated;
-- Las notas internas y los campos de administración se leen solo por las RPC seguras.
revoke select on public.perfiles from authenticated;
grant select(user_id,nombre,slug,telefono,direccion,logo_url,color_principal,horario_texto,horarios,vence_el,activo,visitas_premio,premio_descripcion,telefono_soporte,onboarding_estado) on public.perfiles to authenticated;
grant execute on function public.registrar_pago_turno(uuid,bigint,date,text,text) to authenticated;
grant execute on function public.resolver_solicitud_reserva(uuid,boolean) to authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_list_salones() to authenticated;
grant execute on function public.admin_update_salon(uuid,boolean,date,text,bigint) to authenticated;
grant execute on function public.admin_registrar_pago(uuid,bigint,date,integer,text) to authenticated;
grant execute on function public.public_info(text) to anon,authenticated;
grant execute on function public.public_slots(text,date,uuid) to anon,authenticated;
grant execute on function public.public_request_booking(text,uuid,date,time,text,text,text) to anon,authenticated;
revoke all on function public.registrar_pago_turno(uuid,bigint,date,text,text) from public,anon;
revoke all on function public.resolver_solicitud_reserva(uuid,boolean) from public,anon;
revoke all on function public.admin_dashboard() from public,anon;
revoke all on function public.admin_list_salones() from public,anon;
revoke all on function public.admin_update_salon(uuid,boolean,date,text,bigint) from public,anon;
revoke all on function public.admin_registrar_pago(uuid,bigint,date,integer,text) from public,anon;
notify pgrst, 'reload schema';
revoke all on function public.public_info(text) from public;
revoke all on function public.public_slots(text,date,uuid) from public;
revoke all on function public.public_request_booking(text,uuid,date,time,text,text,text) from public;
grant execute on function public.public_info(text) to anon,authenticated;
grant execute on function public.public_slots(text,date,uuid) to anon,authenticated;
grant execute on function public.public_request_booking(text,uuid,date,time,text,text,text) to anon,authenticated;
revoke all on function public.crear_perfil_nuevo_usuario() from public,anon,authenticated;
revoke all on function public.proteger_campos_perfil() from public,anon,authenticated;
revoke all on function public.proteger_saldo_clienta() from public,anon,authenticated;
revoke all on function public.recalcular_cliente(uuid,uuid) from public,anon,authenticated;
revoke all on function public.turno_recalcula_cliente() from public,anon,authenticated;
revoke all on function public.pago_recalcula_cliente() from public,anon,authenticated;
revoke all on function public.validar_disponibilidad_turno() from public,anon,authenticated;
revoke all on function public.proteger_clienta_turno_con_pagos() from public,anon,authenticated;

-- Buckets: fotos privadas por usuario y logos públicos de marca. La app conserva rutas por UID.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fotos-clientas','fotos-clientas',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('logos-salones','logos-salones',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists fotos_select_mi_carpeta on storage.objects;
create policy fotos_select_mi_carpeta on storage.objects for select to authenticated using (bucket_id='fotos-clientas' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists fotos_insert_mi_carpeta on storage.objects;
create policy fotos_insert_mi_carpeta on storage.objects for insert to authenticated with check (bucket_id='fotos-clientas' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa()));
drop policy if exists fotos_update_mi_carpeta on storage.objects;
create policy fotos_update_mi_carpeta on storage.objects for update to authenticated using (bucket_id='fotos-clientas' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa())) with check (bucket_id='fotos-clientas' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa()));
drop policy if exists fotos_delete_mi_carpeta on storage.objects;
create policy fotos_delete_mi_carpeta on storage.objects for delete to authenticated using (bucket_id='fotos-clientas' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa()));
drop policy if exists logos_public_read on storage.objects;
create policy logos_public_read on storage.objects for select to anon,authenticated using (bucket_id='logos-salones');
drop policy if exists logos_insert_mi_carpeta on storage.objects;
create policy logos_insert_mi_carpeta on storage.objects for insert to authenticated with check (bucket_id='logos-salones' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa()));
drop policy if exists logos_update_mi_carpeta on storage.objects;
create policy logos_update_mi_carpeta on storage.objects for update to authenticated using (bucket_id='logos-salones' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa())) with check (bucket_id='logos-salones' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa()));
drop policy if exists logos_delete_mi_carpeta on storage.objects;
create policy logos_delete_mi_carpeta on storage.objects for delete to authenticated using (bucket_id='logos-salones' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.cuenta_activa()));

comment on table public.perfiles is 'Perfil del salón, prueba y control de suscripción; la app solo puede cambiar campos de presentación.';
comment on table public.solicitudes_reserva is 'Solicitudes de reserva. El público solo inserta mediante RPC de seguridad definida; el salón las revisa con RLS.';
comment on table public.pagos_suscripcion is 'Registro de pagos mensuales administrado exclusivamente por el panel del producto.';
comment on function public.public_request_booking(text,uuid,date,time,text,text,text) is 'RPC pública anti-spam: valida horario, limita solicitudes por teléfono y jamás entrega datos de otras reservas.';
