# AgendaPorã

CRM, agenda y reservas para peluquerías y salones de belleza. Interfaz en español de Paraguay, moneda en guaraníes y alojada como archivos estáticos. Cada salón es una cuenta Supabase Auth y el aislamiento se aplica en PostgreSQL con RLS.

## Configuración y publicación paso a paso

### 1. Crear el proyecto Supabase

Creá un proyecto en [Supabase](https://supabase.com/dashboard), elegí una región cercana a Paraguay si está disponible y guardá la contraseña de la base en un lugar seguro. Esperá a que termine de aprovisionarse.

### 2. Crear el esquema

En **SQL Editor → New query**, pegá el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y ejecutalo como administrador del proyecto. El script crea las tablas, índices, triggers, RPCs, políticas RLS y los dos buckets de Storage.

Si ya tenías una instalación anterior, ejecutá en **SQL Editor → New query**, en este orden, [`supabase/migracion_01.sql`](supabase/migracion_01.sql), [`supabase/migracion_02.sql`](supabase/migracion_02.sql), [`supabase/migracion_03.sql`](supabase/migracion_03.sql), [`supabase/migracion_04.sql`](supabase/migracion_04.sql), [`supabase/migracion_05.sql`](supabase/migracion_05.sql), [`supabase/migracion_06.sql`](supabase/migracion_06.sql), [`supabase/migracion_07.sql`](supabase/migracion_07.sql), [`supabase/migracion_08.sql`](supabase/migracion_08.sql), [`supabase/migracion_09.sql`](supabase/migracion_09.sql), [`supabase/migracion_10.sql`](supabase/migracion_10.sql), [`supabase/migracion_11.sql`](supabase/migracion_11.sql) y [`supabase/migracion_12.sql`](supabase/migracion_12.sql), confirmando `Success` en cada una. La 01 actualiza pagos de suscripción; la 02 agrega el progreso del asistente; la 03 excluye administradores del panel; la 04 agrega calendario, cobro rápido y agradecimientos; la 05 restaura el campo de reseñas si faltaba; la 06 fija el precio y porcentaje de comisión al completar un turno para que los cierres no cambien al editar el catálogo o las comisiones; la 07 excluye de la lista los horarios que se superponen con turnos o solicitudes pendientes y revalida la disponibilidad al reservar o aceptar; la 08 evita que el cobro vuelva a rechazar un horario cuyo solapamiento se aceptó al agendar; la 09 impide mover turnos realizados y muestra un aviso específico; la 10 permite registrar abonos parciales y deja como saldo pendiente la diferencia; la 11 reemplaza el botón Deuda por Otro y guarda la especificación del medio de pago; la 12 permite incluir hasta ocho servicios en un turno, suma sus precios y duraciones, y conserva el desglose histórico para agenda, ficha y cierre de caja. Son idempotentes. La 06 inicializa turnos ya realizados con los valores actuales, porque no existe historial previo. En una instalación nueva, ejecutá `schema.sql` y luego `migracion_04.sql`, `migracion_06.sql`, `migracion_07.sql`, `migracion_08.sql`, `migracion_09.sql`, `migracion_10.sql`, `migracion_11.sql` y `migracion_12.sql`.

Para llenar una cuenta de demostración, primero creá en Authentication un usuario dedicado con el correo reservado `demo@agendapora.test`. Después ejecutá [`supabase/seed_demo.sql`](supabase/seed_demo.sql). El seed reemplaza únicamente los datos de ese usuario demo y agrega veinte clientas ficticias, servicios, turnos, pagos, gastos, stock y una solicitud pendiente. Los teléfonos son números ficticios no operativos y los correos usan dominios reservados de prueba.

Para que las clientas puedan elegir varios servicios en una reserva pública, ejecutá también [`supabase/migracion_13.sql`](supabase/migracion_13.sql) después de `migracion_12.sql` (tanto en instalaciones existentes como nuevas). La migración guarda el desglose y los precios/duraciones acordados con la solicitud, calcula disponibilidad con la duración combinada y conserva la conversión de solicitudes existentes al aceptarlas.

### 3. Verificar Storage

En **Storage**, confirmá que existan:

- `fotos-clientas`: privado, máximo 8 MB por imagen; las rutas comienzan con el UUID de la cuenta.
- `logos-salones`: público para lectura de logos, máximo 2 MB; las escrituras quedan limitadas a la carpeta del propio salón.

Las políticas se crean al ejecutar `schema.sql`. En **Storage → Policies**, verificá las políticas `fotos_*` y `logos_*`. No hagas público el bucket de fotos.

### 4. Desactivar el registro público

En **Authentication → Settings → User Signups**, desactivá **Allow new users to sign up**. Las peluqueras se dan de alta desde el panel de Supabase Auth, no desde la página pública.

### 5. Crear tu cuenta de administración

En **Authentication → Users**, elegí **Add user**, ingresá tu correo y una contraseña fuerte, y confirmá el usuario. El trigger del esquema crea el perfil y da siete días de prueba. En SQL Editor ejecutá esta consulta, sustituyendo el correo:

```sql
update public.perfiles
set es_admin = true
where user_id = (
  select id from auth.users where email = 'admin@agendapora.test'
);
```

El cambio de `es_admin`, `activo` y `vence_el` está protegido por trigger y por RPC; las usuarias normales no pueden asignárselo desde la aplicación.

### 6. Conectar la aplicación

Abrí [`js/config.js`](js/config.js) y reemplazá `SUPABASE_URL` y `SUPABASE_ANON_KEY` por la URL y la clave **anon/public** de **Project Settings → API Keys**. Configurá `SUPPORT_WHATSAPP` con el número de soporte en formato internacional. Nunca pegues una `service_role` key en el navegador ni en Git.

#### Enlaces de recuperación de contraseña

En Supabase abrí **Authentication → URL Configuration**:

1. En **Site URL**, colocá la URL publicada del proyecto. Para GitHub Pages puede ser `https://TU-USUARIO.github.io/TU-REPOSITORIO/` (si usás un dominio propio, usá ese dominio).
2. En **Redirect URLs**, agregá la ruta de la app publicada, por ejemplo `https://TU-USUARIO.github.io/TU-REPOSITORIO/index.html`.
3. Para desarrollo local, agregá `http://localhost:8000/index.html` y, si usás esa dirección, `http://127.0.0.1:8000/index.html`.

El enlace “Olvidé mi contraseña” redirige a `index.html`. Al abrir el enlace de correo, la app permite definir una contraseña nueva de al menos ocho caracteres. La pantalla confirma el envío con el mismo mensaje exista o no una cuenta con ese correo.

### 7. Probar en local

Desde la carpeta del repositorio, ejecutá:

```bash
python -m http.server 8000
```

Abrí `http://localhost:8000/`. Los módulos ES no deben abrirse como `file://`. Probá con el usuario de administración y luego con una cuenta peluquera separada.

### 8. Publicar en GitHub Pages

Creá en GitHub un repositorio vacío (sin README, licencia ni `.gitignore` inicial) y, desde la carpeta del proyecto, reemplazá `USUARIO` y `REPOSITORIO` por sus nombres exactos:

```powershell
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

El workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica el sitio en cada push a `main`. Para habilitar Pages por la interfaz, abrí **Settings → Pages → Build and deployment → Source → GitHub Actions**. También podés hacerlo con GitHub CLI autenticado:

```powershell
gh api --method POST repos/USUARIO/REPOSITORIO/pages -f build_type=workflow
```

La URL aparece en **Settings → Pages** y en la ejecución exitosa de Actions. No se requieren secretos de deploy.


### 9. Dar de alta un salón y cobrar la suscripción

1. En **Supabase → Authentication → Users → Add user**, creá el acceso de la peluquera y confirmá su correo. El trigger crea su perfil y vencimiento de prueba a siete días.
2. Abrí `admin.html` desde el sitio publicado e ingresá con tu cuenta `es_admin`.
3. En **Gestionar**, verificá precio, fecha de vencimiento, estado y notas internas. En **Registrar pago**, anotá monto, fecha y meses de acceso. La RPC calcula el próximo vencimiento en `America/Asuncion`, desde la fecha más lejana entre el vencimiento actual y hoy, y actualiza el estado de la fila al terminar.
4. Compartí el enlace de acceso de `index.html`. La primera vez, la peluquera puede completar el asistente de cuatro pasos para configurar salón, servicios, horario y primera clienta. Puede omitirlo y retomarlo desde el checklist “Primeros pasos” del inicio. El slug de reservas se crea una sola vez y no se edita desde el perfil.

Los enlaces nuevos de reservas usan `/reservar/SLUG` (por ejemplo, `https://carlo0ps.github.io/AgendaPora/reservar/nombre-del-salon`). En GitHub Pages, `404.html` resuelve la ruta dinámica manteniendo el enlace corto; si más adelante configurás un dominio propio en **Settings → Pages**, el mismo camino seguirá funcionando. Los enlaces antiguos `reservar.html?salon=SLUG` también se aceptan.

### 10. Checklist de verificación

- [ ] Creá dos cuentas de salón. Cargá una clienta en cada una; confirmá que no se cruzan clientas, agenda, pagos, servicios, fotos ni reportes.
- [ ] Publicá un servicio y un horario, copiá el link desde la app (formato `/reservar/SLUG`) y hacé una solicitud. Revisá que muestre solo servicios/horarios y que aparezca como pendiente dentro de `index.html`.
- [ ] Aceptá la solicitud. Debe crear una clienta y un turno una sola vez; enviá la confirmación por WhatsApp desde el enlace.
- [ ] Marcá un turno como hecho y registrá un abono. Verificá que el pago se registre y que la deuda se recalcule desde turnos hechos menos pagos.
- [ ] Desde `admin.html`, fijá una fecha de vencimiento pasada o desactivá temporalmente la peluquera. Su sesión debe mostrar la pantalla de bloqueo completa, sin datos ni navegación; exportá CSV/JSON y confirmá que PostgreSQL rechace insert/update/delete aun si se llama la API directamente.
- [ ] Iniciá `admin.html` con una cuenta normal: el RPC debe negar el acceso. Intentá editar `es_admin`, `vence_el` y `activo` desde esa cuenta: el trigger debe rechazarlo.
- [ ] Subí una foto desde la ficha y confirmá que otra cuenta no puede obtener su URL firmada ni leer su carpeta.
- [ ] Probá exportar JSON/CSV e importar clientas desde un CSV con columnas `nombre,telefono,email,fecha_nacimiento,notas`.
- Para la importación, las fechas de nacimiento admiten `dd/mm/aaaa` o `aaaa-mm-dd`; las fechas imposibles y teléfonos/correos inválidos se rechazan antes de guardar.

### 11. Respaldo y disponibilidad de Supabase

Descargá con frecuencia el respaldo JSON desde **Mi salón** y guardalo en un lugar protegido; también podés exportar clientas, turnos, pagos y gastos a CSV. Si la cuenta está vencida o desactivada, usá **Exportar datos** en la pantalla de bloqueo para descargar esos cuatro grupos en CSV y JSON. El backup del navegador no incluye los archivos binarios de Storage, por lo que descargá aparte las fotos o conservá un respaldo de Storage si necesitás archivarlas.

En el plan gratuito, Supabase puede pausar proyectos con poca actividad de base de datos durante siete días; unos pocos accesos reales a la app por día suelen evitarlo, pero no es una garantía. Revisá los avisos por correo y abrí el proyecto desde Dashboard si recibís una alerta. Un proyecto pausado puede reanudarse desde Dashboard dentro de la ventana indicada por Supabase. La documentación vigente está en [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing). Para un servicio comercial que requiera disponibilidad continua, presupuestá un plan pago y verificá las condiciones actuales antes de vender disponibilidad 24/7.

### 12. Cómo vender

**Precios vigentes:** piloto para los primeros 5 salones: Gs. 40.000/mes de por vida, con carga inicial gratis a cambio de un testimonio y una opinión honesta. El plan normal cuesta Gs. 150.000 por la instalación (incluye carga inicial de hasta 100 clientas) más Gs. 60.000/mes. El plan anual cuesta Gs. 600.000 por 12 meses (equivale a 2 meses gratis); la instalación se cobra aparte en nuevas altas. Todos los planes se cobran por adelantado por transferencia, Tigo Money o efectivo.

**Demo en cuatro minutos:**

1. Mostrá el inicio: agenda del día, ingresos y deuda.
2. Abrí una clienta: notas de color, historial, visitas y abonos.
3. Agendá un turno y registrá un pago para mostrar el saldo recalculado.
4. Abrí su link público, simulá una solicitud y aceptala desde la app.
5. Cerrá enseñando los recordatorios por WhatsApp, el catálogo y el respaldo exportable.

**Mensaje para WhatsApp:**

> Hola, ¿cómo estás? Estoy probando AgendaPorã, una agenda para peluquerías donde podés ordenar turnos, fichas e historial de tus clientas, controlar pagos y compartir un link para recibir reservas. Te muestro una demo corta con datos de ejemplo y, si te sirve, tenés 7 días para probarlo. ¿Qué día te queda cómodo?

## Decisiones

- La creación de salones se hace exclusivamente en Supabase Auth; no hay registro público ni credenciales administrativas en el frontend.
- Las reservas públicas llaman RPCs de `SECURITY DEFINER` con `search_path` vacío. No existe política pública de lectura sobre perfiles, servicios, turnos o solicitudes; la RPC entrega solo la ficha pública y disponibilidad agregada.
- La cuenta vencida conserva acceso de lectura únicamente a sus propias filas. Todas las escrituras pasan por RLS y requieren cuenta activa y no vencida; cobros, aceptación de reservas y cambios administrativos son transaccionales en RPC.
- La deuda se calcula como el valor de turnos hechos menos pagos registrados, con un mínimo de cero. Para trasladar un saldo previo, cargalo como turno realizado y registrá los abonos correspondientes.
- Las visitas de fidelización cuentan turnos marcados como hechos. El premio se informa cada múltiplo de la meta configurada.
- Los horarios públicos usan bloques de 15 minutos, respetan duración de servicio y excluyen turnos y solicitudes pendientes que se solapan. Se ofrecen fechas hasta 90 días adelante y se evalúan en `America/Asuncion`.
- Las fotos son privadas y se muestran mediante URL firmadas con expiración de 30 minutos; los logos son públicos para que aparezcan en reservas.
- El service worker solo guarda el shell estático. Supabase Auth, RPC, REST y Storage no se guardan en caché; trabajar con datos privados requiere conexión.
- Los recordatorios abren WhatsApp sin API. La usuaria marca el envío manualmente porque el navegador no puede confirmar si el mensaje se envió desde WhatsApp.
- GitHub Pages sirve la aplicación; Supabase sigue siendo el backend. No se guarda una service-role key en el repositorio.

### Protección de secretos del repositorio

El workflow [`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml) ejecuta Gitleaks en cada `push` y `pull_request`, con historial completo, y falla si encuentra un secreto. Revisá el resultado en **GitHub → Actions**. La clave `sb_publishable_…` de `js/config.js` es pública para el cliente; no copies ahí una `sb_secret_…` ni una `service_role`.

Opcionalmente instalá el CLI de Gitleaks y activá el hook local desde la raíz del repo:

```powershell
git config core.hooksPath .githooks
gitleaks version
```

El hook revisa los archivos preparados antes de cada commit. Si querés desactivarlo, ejecutá `git config --unset core.hooksPath`. `.gitignore` excluye archivos `.env*`, CSV/XLSX locales, respaldos, logs y SQL fuera de `supabase/`; no uses `git add -f` para forzar datos privados.

## Archivos principales

- [`index.html`](index.html): app móvil de la peluquera.
- [`admin.html`](admin.html): panel protegido en Postgres para administración.
- [`reservar.html`](reservar.html): página pública para solicitudes de turnos.
- [`supabase/schema.sql`](supabase/schema.sql): tablas, restricciones, triggers, RPC, RLS y Storage.
- [`supabase/seed_demo.sql`](supabase/seed_demo.sql): datos ficticios de demostración.
