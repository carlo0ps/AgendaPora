-- Impide mover turnos realizados y devuelve un error claro al calendario.
-- Ejecutar en Supabase → SQL Editor como postgres. Es idempotente.
begin;

create or replace function public.mover_turno(
  p_turno_id uuid,
  p_fecha date,
  p_hora time,
  p_permitir_solapamiento boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_estado text;
begin
  if v_user is null or not public.cuenta_activa() then
    raise exception 'Cuenta sin acceso de escritura' using errcode='42501';
  end if;
  if p_fecha is null or p_hora is null then
    raise exception 'Fecha u hora inválida' using errcode='22023';
  end if;

  select t.estado into v_estado
  from public.turnos t
  where t.id=p_turno_id and t.user_id=v_user
  for update;
  if not found or v_estado='cancelado' then
    raise exception 'Turno no encontrado o cancelado' using errcode='P0002';
  end if;
  if v_estado='hecho' then
    raise exception 'Este turno ya fue realizado y no se puede mover' using errcode='22023';
  end if;

  if p_permitir_solapamiento then
    perform pg_catalog.set_config('agendapora.allow_overlap','on',true);
  end if;
  update public.turnos
  set fecha=p_fecha,hora=p_hora
  where id=p_turno_id and user_id=v_user and estado='pendiente';
  if not found then
    raise exception 'El turno cambió mientras se intentaba mover' using errcode='40001';
  end if;
end $$;

revoke all on function public.mover_turno(uuid,date,time,boolean) from public,anon;
grant execute on function public.mover_turno(uuid,date,time,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
