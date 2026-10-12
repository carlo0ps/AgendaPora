-- Restaura el campo opcional de reseñas si la migración 04 no se aplicó correctamente.
-- Idempotente: ejecutar en Supabase → SQL Editor con rol postgres.
begin;
alter table public.perfiles
  add column if not exists google_review_url text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.perfiles'::regclass
      and conname = 'perfiles_google_review_url_check'
  ) then
    alter table public.perfiles
      add constraint perfiles_google_review_url_check
      check (google_review_url is null or (char_length(google_review_url) <= 500 and google_review_url ~ '^https://'));
  end if;
end $$;
grant select (google_review_url) on public.perfiles to authenticated;
grant update (google_review_url) on public.perfiles to authenticated;
notify pgrst, 'reload schema';
commit;
