-- Agrega el estado persistente del asistente de primeros pasos.
-- Ejecutar una vez (o de nuevo sin riesgo) en Supabase → SQL Editor.
begin;

alter table public.perfiles
  add column if not exists onboarding_estado text not null default 'pendiente';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.perfiles'::regclass
      and conname = 'perfiles_onboarding_estado_check'
  ) then
    alter table public.perfiles
      add constraint perfiles_onboarding_estado_check
      check (onboarding_estado in ('pendiente','omitido','completado'));
  end if;
end
$$;

grant select (onboarding_estado) on public.perfiles to authenticated;
notify pgrst, 'reload schema';

commit;
