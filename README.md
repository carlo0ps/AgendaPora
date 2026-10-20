# AgendaPorã

CRM, agenda y reservas para peluquerías y salones de belleza. Interfaz en español de Paraguay, moneda en guaraníes y alojada como archivos estáticos. Cada salón es una cuenta Supabase Auth y el aislamiento se aplica en PostgreSQL con RLS.

## Configuración y publicación paso a paso

### 1. Crear el proyecto Supabase

Creá un proyecto en [Supabase](https://supabase.com/dashboard), elegí una región cercana a Paraguay si está disponible y guardá la contraseña de la base en un lugar seguro. Esperá a que termine de aprovisionarse.

### 2. Crear el esquema

En **SQL Editor → New query**, pegá el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y ejecutalo como administrador del proyecto. El script crea las tablas, índices, triggers, RPCs, políticas RLS y los dos buckets de Storage.

Si ya tenías una instalación anterior, ejecutá en **SQL Editor → New query**, en orden, las migraciones 01 a 19 (incluidas [`supabase/migracion_16.sql`](supabase/migracion_16.sql), [`supabase/migracion_17.sql`](supabase/migracion_17.sql), [`supabase/migracion_18.sql`](supabase/migracion_18.sql) y [`supabase/migracion_19.sql`](supabase/migracion_19.sql)) y confirmá `Success` en cada una. La 16 unifica la disponibilidad pública e interna, agrega fechas especiales, pausas semanales, asignación por empleada, anticipación, horizonte, intervalos configurables y buffer. La 17 revoca el acceso directo de lectura de `anon` y `PUBLIC` a las tablas; las reservas públicas siguen usando RPCs. La 18 agrega el respaldo administrativo paginado. La 19 agrega sesiones de caja, movimientos automáticos de efectivo y el cierre inmutable. En una instalación nueva, ejecutá `schema.sql` y luego las migraciones 04, 06 a 19 en orden; las migraciones son idempotentes.

Para llenar una cuenta de demostración, aplicá las migraciones hasta la 19 y después creá en Authentication un usuario dedicado con el correo reservado `demo@agendapora.test`. Ejecutá [`supabase/seed_demo.sql`](supabase/seed_demo.sql). El seed reemplaza únicamente los datos de esa cuenta e incluye pausas semanales, una fecha especial y una caja ficticia abierta.

Para que las clientas elijan servicios múltiples, cambiar el slug y guardar el correo opcional, ejecutá las migraciones 13, 14 y 15 en ese orden. La migración 16 es necesaria para las reglas completas de disponibilidad descritas abajo.

Después de aplicar la migración 16, configurá en **Mi salón** el intervalo de 15/30 minutos, anticipación, horizonte y preparación entre turnos. La pausa semanal se define con `pausa_inicio` y `pausa_fin` dentro del JSON de horarios. En **Fechas especiales** podés cerrar una fecha o reemplazar su horario y pausa. Luego de aplicar la migración 19, ejecutá [`supabase/tests_reservas.sql`](supabase/tests_reservas.sql) y [`supabase/tests_seguridad.sql`](supabase/tests_seguridad.sql) como postgres en SQL Editor; ambos muestran `PASS`/`FAIL` y revierten los datos de prueba. La prueba SQL de concurrencia secuencia las dos llamadas en una sesión; para comprobar la carrera real, repetí la reserva del mismo horario desde dos sesiones/navegadores casi a la vez y verificá que solo una solicitud quede pendiente.

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

### Respaldo completo

1. Aplicá [`supabase/migracion_18.sql`](supabase/migracion_18.sql) y después [`supabase/migracion_19.sql`](supabase/migracion_19.sql). Las RPC `admin_respaldo_pagina` y `admin_respaldo_caja_pagina` exigen sesión autenticada, cuenta activa y `es_admin()` en el servidor.
2. Iniciá sesión en `admin.html` y elegí **Respaldo completo**. El navegador descarga `respaldo-AAAA-MM-DD.json`; la RPC entrega como máximo 250 filas por página y tabla.
3. El archivo incluye perfiles de salones (sin perfiles administradores), clientas, servicios, turnos y sus servicios, pagos, plantillas, gastos, productos, empleadas, solicitudes y servicios solicitados, pagos de suscripción, horarios especiales, cajas, movimientos de caja y metadatos de fotos. No consulta `auth.users` ni incluye contraseñas o credenciales. Los archivos de imagen almacenados en Storage requieren un respaldo separado.
4. El aviso aparece si no hay una descarga registrada en ese navegador o si pasaron más de siete días. La fecha se guarda en `localStorage` del navegador y no en Supabase.

### Caja y cierres

1. Aplicá [`supabase/migracion_19.sql`](supabase/migracion_19.sql) después de la migración 18. La migración agrega `cajas`, `caja_movimientos`, `pagos.caja_id`, `gastos.caja_id` y `gastos.medio_pago`, además de RLS, triggers y RPCs. Repetirla es seguro.
2. Abrí **Cierre de caja** e ingresá el efectivo inicial. El servidor registra fecha y hora de `America/Asuncion`; un índice único y un bloqueo transaccional impiden más de una caja abierta por salón.
3. Cuando hay una caja abierta para hoy, los pagos y gastos con fecha de hoy se asocian a ella. Efectivo requiere esa caja y genera un movimiento automáticamente. Transferencia, Tigo Money y otros medios se desglosan en el cierre sin cambiar el efectivo físico. Los registros históricos con fecha anterior no se atribuyen a la caja actual.
4. En la sesión podés registrar entradas y salidas manuales. Para corregir una diferencia usá la categoría **Ajuste** e ingresá un motivo. Los movimientos son inmutables; un cierre guarda el efectivo contado, esperado, la diferencia y un snapshot de pagos y gastos por medio.
5. El historial permite filtrar por fechas y diferencias. Desde una sesión activa o un cierre guardado, **Imprimir A4 / 80 mm** imprime solo esa caja: oculta navegación, filtros e historial, evita dejar el título solo en una hoja y ajusta las columnas al papel. Elegí el tamaño disponible en la impresora. **Enviar por WhatsApp** prepara el resumen.
6. Para cargar los datos ficticios de los seeds, aplicá migración 19 antes de ejecutar `seed_demo.sql` o `seed_plantilla.sql`. Cada seed crea una caja abierta de prueba con movimientos inventados y el reinicio borra solo la cuenta objetivo.

### Decisiones

- Una caja abierta puede mantenerse tras medianoche para permitir su cierre; no admite nuevos movimientos manuales en un día distinto. Para empezar a operar ese día, primero cerrá la caja anterior.
- Cobros y gastos con una fecha anterior se conservan como historial y no alteran el efectivo esperado de la sesión actual. Las correcciones posteriores al cierre se registran como ajuste con motivo en una caja abierta.
- Transferencias y Tigo Money siempre quedan en el resumen por medio de pago y nunca se suman al efectivo físico.

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

### Cuenta plantilla

1. En **Supabase → Authentication → Users → Add user**, creá una cuenta ficticia para la demostración y activá **Auto Confirm**. El valor inicial de `v_email` está al comienzo de [`supabase/seed_plantilla.sql`](supabase/seed_plantilla.sql); el script no crea usuarios de Auth, no modifica `auth.users` ni guarda contraseñas.
2. Abrí **SQL Editor → New query**, pegá el contenido completo de `supabase/seed_plantilla.sql` y ejecutalo en el proyecto que contiene esa cuenta.
3. Revisá la tabla que devuelve al final: con el reinicio activo debe mostrar 25 clientas, 55 turnos y 39 pagos; la deuda de prueba suma Gs. 280.000. Los ingresos cambian según la fecha. El seed configura lunes a sábado con pausa, domingo cerrado y un cierre ficticio dentro de 40 días. Aplicá migracion_16.sql antes del seed; si faltan la tabla o las columnas nuevas, lo informa con `RAISE NOTICE`.
4. Para usar otra cuenta, cambiá `v_email` al correo creado en Auth. Si usás varias cuentas plantilla, asigná también un `v_slug` distinto y libre; el valor inicial es `plantilla-1`.
5. Para recargarla desde cero, dejá `v_reiniciar := true` y ejecutá el script otra vez. El reinicio elimina los datos operativos solo del usuario asociado a `v_email`, en orden de claves foráneas, y vuelve a generar los mismos datos ficticios. Con `v_reiniciar := false`, conserva los datos adicionales de esa cuenta y actualiza las filas de plantilla identificadas por el script.

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
4. Compartí el enlace de acceso de `index.html`. La primera vez, la peluquera puede completar el asistente de cuatro pasos para configurar salón, servicios, horario y primera clienta. Puede omitirlo y retomarlo desde el checklist “Primeros pasos” del inicio. El slug se puede cambiar desde Mi salón; al cambiarlo, hay que compartir el nuevo link.

Los enlaces nuevos de reservas usan `/reservar/SLUG` (por ejemplo, `https://carlo0ps.github.io/AgendaPora/reservar/nombre-del-salon`). En GitHub Pages, `404.html` resuelve la ruta dinámica manteniendo el enlace corto; si más adelante configurás un dominio propio en **Settings → Pages**, el mismo camino seguirá funcionando. Podés editar el slug en **Mi salón**; elegí uno único y compartí el link nuevo, porque el anterior deja de funcionar. Los enlaces antiguos `reservar.html?salon=SLUG` también se aceptan mientras ese slug siga vigente.

### 10. Checklist de verificación

- [ ] Creá dos cuentas de salón. Cargá una clienta en cada una; confirmá que no se cruzan clientas, agenda, pagos, servicios, fotos ni reportes.
- [ ] Publicá un servicio y un horario, copiá el link desde la app (formato `/reservar/SLUG`) y hacé una solicitud. Revisá que muestre solo servicios/horarios y que aparezca como pendiente dentro de `index.html`.
- [ ] Aceptá la solicitud. Debe crear una clienta y un turno una sola vez; enviá la confirmación por WhatsApp desde el enlace.
- [ ] Marcá un turno como hecho y registrá un abono. Verificá que el pago se registre y que la deuda se recalcule desde turnos hechos menos pagos.
- [ ] Desde `admin.html`, fijá una fecha de vencimiento pasada o desactivá temporalmente la peluquera. Su sesión debe mostrar la pantalla de bloqueo completa, sin datos ni navegación; exportá CSV/JSON y confirmá que PostgreSQL rechace insert/update/delete aun si se llama la API directamente.
- [ ] Iniciá `admin.html` con una cuenta normal: el RPC debe negar el acceso. Intentá editar `es_admin`, `vence_el` y `activo` desde esa cuenta: el trigger debe rechazarlo.
- [ ] Subí una foto desde la ficha y confirmá que otra cuenta no puede obtener su URL firmada ni leer su carpeta.
- [ ] Probá exportar JSON/CSV e importar clientas desde un CSV con columnas `nombre,telefono,email,fecha_nacimiento,notas`.
- [ ] En un salón de prueba, intentá reservar en domingo, fecha cerrada, antes de abrir, dentro de la pausa, después del cierre y con un servicio que no entra. Verificá que no se acepte tampoco llamando directamente a `public_request_booking_multiple` o a la RPC legacy `public_request_booking`.
- [ ] Configurá dos empleadas y un turno para A. El mismo tramo debe aparecer si B está libre; cuando ambas estén ocupadas no debe aparecer. Confirmá que turno cancelado libera el intervalo y que un turno pendiente/hecho bloquea su duración completa más el buffer.
- [ ] Probá hoy con el margen mínimo, una fecha más allá del horizonte, mover un turno y aceptar una solicitud que dejó de estar disponible. El servidor debe rechazar los casos inválidos aunque el navegador manipule la fecha u hora.
- [ ] Ejecutá [`supabase/tests_reservas.sql`](supabase/tests_reservas.sql) y [`supabase/tests_seguridad.sql`](supabase/tests_seguridad.sql) después de la migración 19. Ambos deben terminar con resultados `PASS`; revisá cada fila `FAIL` antes de publicar.
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
- Los horarios se validan en PostgreSQL con `America/Asuncion`; la fecha del navegador solo ayuda a completar el formulario. La grilla inicia en la apertura y avanza 15 o 30 minutos. Se exige que el servicio completo quepa antes del cierre y no cruce la pausa.
- Las empleadas son recursos independientes: una reserva pública sin preferencia se asigna a una empleada activa libre; si no hay empleadas activas, el salón opera como un solo recurso. Un turno sin empleada asignada bloquea a todas. Los turnos cancelados no bloquean; los pendientes y hechos sí.
- Las solicitudes públicas pendientes bloquean el recurso asignado durante 20 minutos. Al aceptar, crear o mover un turno se vuelve a validar bajo un bloqueo transaccional por salón y fecha. La dueña puede confirmar un solapamiento desde la agenda, pero esa excepción no omite horario, pausa, duración, anticipación ni fecha especial.
- El horizonte por defecto es 60 días, el margen mínimo 120 minutos y el buffer global 0 minutos; la dueña los puede configurar en Mi salón. Las excepciones de fecha prevalecen sobre el horario semanal. Horas y fechas se comparan en la zona IANA `America/Asuncion` del servidor.
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

## Interfaz y guía visual

La dirección visual del producto es **boutique de belleza moderna**: ciruela y rosa como acentos, superficies cálidas, radios generosos y tipografía Bricolage Grotesque para títulos junto a Inter para lectura y formularios. Los tokens completos de modo claro/oscuro, espaciado, radios, elevación, foco y movimiento están en [css/style.css](css/style.css). Los colores de estados mantienen texto legible sobre su superficie; los precios y horarios usan cifras tabulares.

Abrí [guia-ui.html](guia-ui.html) en el navegador para revisar tipografía, paleta, botones, campos y errores, estados, tarjetas, tablas, gráficos, pestañas, paginación, diálogos y esqueletos. Es una página de referencia independiente: no está enlazada desde la navegación del salón ni contiene datos de clientas. La implementación mantiene HTML/CSS/JS sin build ni frameworks pesados.

Decisiones visuales: se conserva el onboarding guiado existente. El inicio comparte un resumen por WhatsApp y muestra accesos contextuales; la agenda del día se puede imprimir. La ficha agrupa Resumen, Turnos, Pagos, Notas y Fotos en pestañas accesibles, y las reservas ofrecen horarios en cuadrícula mientras el formulario mantiene su selector y RPC actuales. Login, recuperación y estados vacíos usan motivos SVG propios. El modo de pantalla puede seguir al sistema o fijarse en claro/oscuro; también hay mostrar/ocultar contraseña, aviso offline y movimiento reducido. Cancelar un turno ofrece Deshacer por unos segundos. No se agregan logros persistentes ni novedades porque requieren estado nuevo; no se puede recuperar un borrado de fotos con las operaciones actuales. Se conservaron las etiquetas de los controles y la ayuda de atajos; el gráfico brinda una lista de valores accesible en vez de depender de tooltips de canvas.
## Archivos principales

- [`index.html`](index.html): app móvil de la peluquera.
- [`admin.html`](admin.html): panel protegido en Postgres para administración.
- [`reservar.html`](reservar.html): página pública para solicitudes de turnos.
- [`supabase/schema.sql`](supabase/schema.sql): tablas, restricciones, triggers, RPC, RLS y Storage.
- [`supabase/seed_demo.sql`](supabase/seed_demo.sql): datos ficticios de demostración.
