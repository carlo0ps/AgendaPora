# Seguridad

- No guardes contraseñas, tokens, claves secretas, datos de clientas ni exportaciones en Git.
- En el frontend solo se permite `SUPABASE_URL`, la clave pública `sb_publishable_…` (o la clave heredada `anon`) y `SUPPORT_WHATSAPP` intencionalmente público. Nunca agregues claves `sb_secret_…` o `service_role`.
- RLS debe permanecer habilitado y probado en Supabase; la clave pública no reemplaza las políticas de acceso.
- Si una clave secreta se publica, revocala/rotala inmediatamente en su proveedor y luego evaluá purgar el historial. Borrar el archivo del último commit no invalida una clave ni elimina copias anteriores.
- Reportá exposiciones al propietario del repositorio y no las pegues en issues, chats ni logs.
