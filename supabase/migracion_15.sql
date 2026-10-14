-- Agrega correo opcional a reservas públicas y lo guarda en la ficha al aceptar.
begin;

alter table public.solicitudes_reserva add column if not exists email text;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.solicitudes_reserva'::regclass
      and conname='solicitudes_reserva_email_check'
  ) then
    alter table public.solicitudes_reserva
      add constraint solicitudes_reserva_email_check
      check (email is null or (char_length(email)<=160 and email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'));
  end if;
end $$;

-- Mantiene intacta la RPC anterior para clientes ya abiertos y agrega la entrada con correo.
create or replace function public.public_request_booking_multiple(
  p_slug text,p_servicio_ids uuid[],p_fecha date,p_hora time,p_nombre text,
  p_telefono text,p_email text,p_website text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text; v_result jsonb; v_request_id uuid;
begin
  v_email:=nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,''))),'');
  if v_email is not null and (pg_catalog.char_length(v_email)>160 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$') then
    raise exception 'Ingresá un correo válido o dejá el campo vacío' using errcode='22023';
  end if;
  v_result:=public.public_request_booking_multiple(
    p_slug=>$1,p_servicio_ids=>$2,p_fecha=>$3,p_hora=>$4,p_nombre=>$5,p_telefono=>$6,p_website=>$8
  );
  v_request_id:=(v_result->>'id')::uuid;
  update public.solicitudes_reserva set email=v_email where id=v_request_id;
  if not found then raise exception 'No se pudo guardar la solicitud' using errcode='P0002'; end if;
  return v_result;
end $$;

revoke all on function public.public_request_booking_multiple(text,uuid[],date,time,text,text,text,text) from public;
grant execute on function public.public_request_booking_multiple(text,uuid[],date,time,text,text,text,text) to anon,authenticated;

-- La aceptación usa la función existente; este trigger copia el email a la
-- clienta correspondiente sin reemplazar un correo que ya estuviera guardado.
create or replace function public.reserva_copiar_email_clienta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_client uuid;
begin
  if new.estado <> 'aceptada' or old.estado = 'aceptada' or new.email is null then return new; end if;
  v_phone:=regexp_replace(new.telefono,'\D','','g');
  if char_length(v_phone)=9 then v_phone:='595'||v_phone; elsif left(v_phone,1)='0' then v_phone:='595'||substr(v_phone,2); end if;
  select c.id into v_client from public.clientas c
    where c.user_id=new.user_id
      and (case when char_length(regexp_replace(coalesce(c.telefono,''),'\D','','g'))=9 then '595'||regexp_replace(coalesce(c.telefono,''),'\D','','g')
                when left(regexp_replace(coalesce(c.telefono,''),'\D','','g'),1)='0' then '595'||substr(regexp_replace(coalesce(c.telefono,''),'\D','','g'),2)
                else regexp_replace(coalesce(c.telefono,''),'\D','','g') end)=v_phone
    order by c.created_at limit 1;
  if v_client is not null then
    update public.clientas set email=new.email where id=v_client and user_id=new.user_id and nullif(btrim(email),'') is null;
  end if;
  return new;
end $$;
drop trigger if exists solicitudes_reserva_copiar_email on public.solicitudes_reserva;
create trigger solicitudes_reserva_copiar_email after update of estado on public.solicitudes_reserva
  for each row execute function public.reserva_copiar_email_clienta();
revoke all on function public.reserva_copiar_email_clienta() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
