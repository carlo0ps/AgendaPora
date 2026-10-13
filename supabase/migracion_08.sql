-- Evita validar de nuevo el horario al marcar un turno pendiente como hecho/cobrado.
-- Ejecutar en Supabase → SQL Editor como postgres. Es idempotente.
begin;

create or replace function public.validar_disponibilidad_turno()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inicio timestamp; v_fin timestamp; v_solapado boolean;
begin
  if new.estado='cancelado' or current_setting('agendapora.allow_overlap',true)='on' then return new; end if;
  -- Registrar un cobro cambia el estado, no la hora. Un horario que se
  -- aceptó explícitamente al agendar no debe impedir completar el cobro.
  if tg_op='UPDATE' then
    if old.estado='pendiente' and new.estado='hecho'
      and new.fecha is not distinct from old.fecha
      and new.hora is not distinct from old.hora
      and new.servicio_id is not distinct from old.servicio_id then
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || new.fecha::text,0)
  );
  v_inicio := new.fecha + new.hora;
  select v_inicio + pg_catalog.make_interval(mins => coalesce(s.duracion_min,60))
    into v_fin
    from (select 1) q
    left join public.servicios s on s.user_id=new.user_id and s.id=new.servicio_id;
  select exists(
    select 1 from public.turnos t
    left join public.servicios s on s.user_id=t.user_id and s.id=t.servicio_id
    where t.user_id=new.user_id and t.fecha=new.fecha and t.estado<>'cancelado' and t.id is distinct from new.id
      and (new.fecha+new.hora)<(t.fecha+t.hora+pg_catalog.make_interval(mins=>coalesce(s.duracion_min,60)))
      and (t.fecha+t.hora)<v_fin
  ) into v_solapado;
  if v_solapado then raise exception 'Ese horario se superpone con otro turno' using errcode='23P01'; end if;
  return new;
end $$;

commit;
