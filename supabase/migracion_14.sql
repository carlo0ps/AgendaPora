-- Permite que cada salón cambie su slug público desde Mi salón.
-- La restricción de formato y el índice UNIQUE existentes siguen validando
-- el valor; no se alteran RLS ni los campos administrativos del perfil.
begin;

create or replace function public.proteger_campos_perfil()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.es_admin() then
    if new.es_admin is distinct from old.es_admin
      or new.activo is distinct from old.activo
      or new.vence_el is distinct from old.vence_el
      or new.notas_internas is distinct from old.notas_internas
      or new.precio_mensual_gs is distinct from old.precio_mensual_gs then
      raise exception 'No se pueden cambiar los campos reservados a administración' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists perfiles_proteger_campos on public.perfiles;
create trigger perfiles_proteger_campos
  before update on public.perfiles
  for each row execute function public.proteger_campos_perfil();

revoke all on function public.proteger_campos_perfil() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
