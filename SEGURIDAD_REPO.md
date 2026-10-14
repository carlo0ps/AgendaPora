# Auditoría de seguridad del repositorio

Auditoría del árbol de trabajo y de los 24 commits alcanzables desde `main` y `origin/main` (ambas ramas estaban en el mismo commit). El escaneo recorrió archivos ocultos fuera de `.git`, los blobs de cada commit y los nombres de archivos en cada árbol. Se buscaron claves/tokens, JWT `eyJ…`, marcadores PEM, URLs con credenciales, conexiones `postgres://`, emails, teléfonos con formato paraguayo, rutas `C:\Users\…` y archivos de respaldo/datos/exportación.

## Hallazgos

| Severidad | Archivo / commit | Causa | Estado |
|---|---|---|---|
| Baja | `README.md:42` | Antes contenía un email de ejemplo con prefijo `tu-c` y dominio público de ejemplo; no era un email personal. | Reemplazado por un email de dominio reservado `.test`. La mención histórica es solo un placeholder. |
| Baja | `js/app.js:998`, `js/app.js:1070`, `reservar.html:29` | Placeholders de teléfono con formato parecido a un número asignable (`5959` / `0981` al inicio), no datos de una clienta. | Cambiados por `09XX XXX XXX`. |
| Media, requiere confirmación del propietario | `supabase/seed_demo.sql:32`, commit `0f0dd7177e60` | Una versión histórica del seed tenía teléfonos con prefijos `0981` y `0971`. Estaban dentro del seed de demo; no hay evidencia en el repo de que fueran contactos reales. | El seed actual usa secuencias no operativas `000…`. No reescribí el historial. Confirmá manualmente que los teléfonos históricos eran ficticios; si pertenecían a personas reales, seguí las instrucciones de purga de abajo. |

## Valores públicos permitidos

- `js/config.js:2`: URL pública del proyecto Supabase.
- `js/config.js:3`: clave con prefijo `sb_p` y formato `sb_publishable_…`. No es un JWT, así que no tiene un payload que decodificar. Supabase documenta que una publishable key usa el rol `anon` cuando no hay sesión y el rol `authenticated` después del login; es la clave pública prevista para el frontend. No encontré ninguna clave `sb_secret_…` ni `service_role` con valor.
- `js/config.js:5`: `SUPPORT_WHATSAPP` comienza con `5959`; coincide con el número que el propietario designó para soporte y se conserva intencionalmente como dato público.

## Historial de Git

Ramas revisadas: `main` y `origin/main`; commits revisados: 24. No aparecieron claves privadas, JWT, credenciales de base de datos, URLs con usuario/contraseña, rutas de PC ni archivos de exportación/backup en los blobs históricos.

Los placeholders de email y teléfono reaparecieron sin cambios en estos commits; las cadenas son ejemplos ficticios, no credenciales ni datos personales confirmados:

- Placeholder de email en `README.md`: `b2ce873043a2`, `d2f2a48c0449`, `e8d190bdd8df`, `e6a7f0c8faf1`, `43575817b046`, `115d58343356`, `f3cd0103eb1b`, `5f50aa32406b`, `e30e774a0b2f`, `02af33a95650`, `a376f9bf54b1`, `b96a2b5f8b1c`, `4c0c45e21490`, `f55d54160961`, `612576c1f9e5`, `c1d531fc7a03`, `b09ae2bf0742`, `1e21abdb29a9`, `7eca2f14a197`, `4280809f4732`, `53a875fcff84`, `5ab78f6af758`, `0cdc3c8523f4`, `0f0dd7177e60`.
- Placeholder de teléfono en `js/app.js`: los mismos commits excepto `0f0dd7177e60`.
- Placeholder de teléfono en `reservar.html`: los 24 commits de la lista anterior.
- Teléfonos tipo demo en `supabase/seed_demo.sql`: `0f0dd7177e60` solamente.

No se reescribió el historial porque no se confirmó que los registros históricos fueran reales. Si confirmás que los datos del seed del commit indicado pertenecían a clientas reales, purgá el archivo completo de la historia y restaurá después el seed ficticio actual. Esto fuerza una reescritura y un push forzado de todas las ramas/tags; coordiná con cualquier colaborador antes de hacerlo:

```powershell
Set-Location (git rev-parse --show-toplevel)
Copy-Item .\supabase\seed_demo.sql ..\seed_demo.sql.safe
$remoteUrl = git remote get-url origin
git filter-repo --path supabase/seed_demo.sql --invert-paths
Copy-Item ..\seed_demo.sql.safe .\supabase\seed_demo.sql
git remote add origin $remoteUrl
git add supabase/seed_demo.sql
git commit -m "Restaurar seed de demostración ficticio"
git push --force --all origin
git push --force --tags origin
```

## Archivos actuales y controles agregados

- No hay `.env*`, CSV/XLSX de clientas o prospectos, dumps, backups, logs ni exportaciones entre los archivos seguidos por Git. Los únicos `.sql` seguidos son scripts del proyecto en `supabase/`.
- Las tres imágenes seguidas son iconos PNG; no hay capturas ni fotos de personas. Los iconos SVG no contienen datos personales.
- Los archivos locales de audio y su generador estaban sin seguimiento; `.gitignore` ahora los excluye junto con archivos locales de datos y temporales. No se borraron del disco.
- `.gitignore` excluye `.env*`, SQL fuera de `supabase/`, `*.csv`, `*.xlsx`, backups JSON, logs, node_modules y archivos del sistema.
- `.github/workflows/secret-scan.yml` ejecuta Gitleaks en cada push, pull request y ejecución manual, escaneando el historial completo. El job falla cuando Gitleaks detecta un secreto.
- `.githooks/pre-commit` agrega un control opcional para los archivos preparados. La activación está documentada en el README.

## Revisión local reproducible

```powershell
git status --short
git branch --all --verbose --no-abbrev
git rev-list --all --count
git ls-files
git log --all --oneline
```

El workflow de GitHub ejecutará Gitleaks sobre el historial completo al subir este commit. No se ejecutó ni se reescribió el historial remoto durante esta auditoría.
