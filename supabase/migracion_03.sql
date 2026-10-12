-- Mantiene fuera del panel comercial a los perfiles administradores del producto.
-- Además, las cuentas es_admin no quedan bloqueadas por vencimiento.
-- Es seguro ejecutar esta migración más de una vez.
begin;

create or replace function public.cuenta_activa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.user_id = (select auth.uid())
      and (
        p.es_admin = true
        or (p.activo = true and p.vence_el >= (pg_catalog.now() at time zone 'America/Asuncion')::date)
      )
  )
$$;

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_active integer;
  v_overdue integer;
  v_mrr bigint;
  v_hoy date := (pg_catalog.now() at time zone 'America/Asuncion')::date;
begin
  if not public.es_admin() then
    raise exception 'Solo administración' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(*) filter (where p.activo = true and p.vence_el >= v_hoy)::integer,
    count(*) filter (where p.activo = false or p.vence_el < v_hoy)::integer,
    coalesce(
      sum(p.precio_mensual_gs) filter (
        where p.activo = true
          and p.vence_el >= v_hoy
          and exists (
            select 1
            from public.pagos_suscripcion ps
            where ps.user_id = p.user_id
              and ps.periodo_hasta >= v_hoy
          )
      ),
      0
    )::bigint
  into v_total, v_active, v_overdue, v_mrr
  from public.perfiles p
  where p.es_admin = false;

  return pg_catalog.jsonb_build_object(
    'total', v_total,
    'activas', v_active,
    'vencidas', v_overdue,
    'mrr_gs', v_mrr
  );
end;
$$;

create or replace function public.admin_list_salones()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo administración' using errcode = '42501';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.created_at desc),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      p.user_id,
      p.nombre,
      p.slug,
      p.email_contacto,
      (select u.last_sign_in_at from auth.users u where u.id = p.user_id) as ultimo_acceso,
      p.created_at,
      p.vence_el,
      p.activo,
      p.notas_internas,
      p.precio_mensual_gs,
      (select count(*)::integer from public.clientas c where c.user_id = p.user_id) as cantidad_clientas,
      (select count(*)::integer from public.turnos t where t.user_id = p.user_id) as cantidad_turnos,
      (select max(ps.fecha) from public.pagos_suscripcion ps where ps.user_id = p.user_id) as ultimo_pago
    from public.perfiles p
    where p.es_admin = false
  ) x;

  return v_rows;
end;
$$;

revoke all on function public.cuenta_activa() from public, anon;
grant execute on function public.cuenta_activa() to authenticated;
revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;
revoke all on function public.admin_list_salones() from public, anon;
grant execute on function public.admin_list_salones() to authenticated;

notify pgrst, 'reload schema';
commit;
