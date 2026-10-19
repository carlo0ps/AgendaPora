-- Revoca lectura directa de anon/PUBLIC; reservas públicas usan RPCs seguras.
-- Ejecutar como postgres en Supabase SQL Editor. Idempotente.
begin;

revoke all privileges on all tables in schema public from anon, public;
alter default privileges in schema public revoke all privileges on tables from anon, public;

notify pgrst, 'reload schema';
commit;
