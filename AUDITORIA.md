# Auditoría de AgendaPorã

Fecha: 11/10/2026. Revisión del código fuente, pantallas locales, service worker y esquema Supabase.

## 1. Hallazgos corregidos

### Móvil

1. **El botón ☰ no abría un menú.** En [index.html](index.html) y [js/app.js](js/app.js), el botón ahora abre un diálogo accesible con todas las secciones, reservas, tema y cerrar sesión. Se cierra al tocar afuera, al presionar Escape y al seleccionar una opción; el foco vuelve al botón que lo abrió.
2. **Había controles con áreas táctiles menores a 44 px y acciones móviles difíciles de encontrar.** En [css/style.css](css/style.css) se ajustaron los botones de tabla, iconos, enlaces accionables, borrado de fotos y paginación. Cerrar sesión está en el menú móvil. Los duplicados del encabezado se ocultan en móvil para evitar que se amontonen.
3. **El encabezado, los diálogos y la pantalla de acceso no contemplaban bien el alto disponible, el teclado ni las zonas seguras.** El encabezado permite que el título largo envuelva; login y bloqueo usan el viewport dinámico y safe-area; el contenido de los diálogos puede desplazarse con el teclado abierto. La navegación inferior reserva espacio para no tapar el contenido.
4. **El contraste de mensajes y fotos dependía del color de marca aunque el fondo fuera verde, rojo o una imagen oscura.** Se agregaron variables de texto para fondos de estado y superposiciones. Se midieron contrastes de texto comunes: mínimo 5,49:1 en las combinaciones evaluadas, por encima de 4,5:1. Los colores de texto, controles, placeholders, banners, tablas, modales y gráficos usan tokens de tema.

### PC y listas extensas

5. **Las tablas de la peluquera pintaban todas las filas a la vez.** [js/app.js](js/app.js) ahora muestra 40 filas por página. La región de tabla acepta foco de teclado y mantiene el desplazamiento horizontal contenido, sin ensanchar la página.
6. **El panel de administración mostraba todos los salones en una sola tabla sin navegación por teclado.** [js/admin.js](js/admin.js) pagina a 25 filas y marca la tabla como región desplazable y enfocada. En [css/style.css](css/style.css) se añadieron estados de foco y hover visibles. Se conservaron los máximos de contenido existentes para app, panel y reservas.

### Funcional y seguridad

7. **La importación de cumpleaños solo comprobaba el formato con una expresión regular, no que la fecha existiera, y no reconocía `dd/mm/aaaa`.** [js/app.js](js/app.js) ahora acepta `dd/mm/aaaa` y `aaaa-mm-dd`, valida el calendario y rechaza filas con fechas, teléfonos o correos inválidos antes de insertar. También valida nombres obligatorios, teléfonos de clientas/equipo y horarios semanales; limita los mensajes editables a 1500 caracteres.
8. **El botón de cierre de sesión del admin descartaba la respuesta de Supabase.** [js/admin.js](js/admin.js) ahora maneja y muestra errores, y presenta estado de carga durante el cierre.
9. **Se retiró la opción de instalar AgendaPorã como app.** Se eliminaron el manifiesto y los íconos exclusivos de instalación; la app conserva el service worker para uso offline.
10. **El enlace de reservas usaba un parámetro largo.** `js/app.js` ahora genera `/reservar/SLUG`; `404.html` permite resolver esa ruta dinámica en GitHub Pages, y `js/reservar.js` sigue aceptando el formato anterior para enlaces existentes.
11. **El slug se generaba al crear la cuenta y quedaba fijo.** `js/app.js` permite cambiarlo desde Mi salón; `supabase/migracion_14.sql` libera solo ese campo y conserva las restricciones de unicidad/formato y los controles administrativos restantes.
12. **La reserva pública no recogía el correo de la clienta.** `reservar.html`, `404.html` y `js/reservar.js` agregan el campo opcional; `supabase/migracion_15.sql` lo valida, guarda en la solicitud y lo copia a la ficha al aceptar, sin reemplazar un correo que ya existía.

La revisión de seguridad no encontró una política RLS que permitiera cruzar salones ni una RPC pública que devolviera datos personales. Se confirmó en [supabase/schema.sql](supabase/schema.sql) que las lecturas propias siguen habilitadas tras el vencimiento, que las escrituras dependen de `cuenta_activa()`, que los campos administrativos del perfil están protegidos y que las RPC privilegiadas fijan `search_path`. Las fotos usan carpetas privadas por UID; los endpoints públicos de reservas exponen servicios y horarios, no los datos de turnos existentes. No se encontró una clave `service_role` en el código.

## 2. Pendientes y límites de esta revisión

- **No ejecuté el recorrido autenticado completo contra el proyecto Supabase.** En el entorno local no hay credenciales de prueba de una peluquera ni un admin de staging. Por eso quedan por validar manualmente login real, CRUD con dos tenants, pago y renovación transaccional, reserva con un slug real, colisión concurrente, bloqueo por vencimiento, políticas en ejecución y fotos en Storage. El checklist está abajo; no creé cuentas ni datos de prueba en un proyecto que podría ser producción.
- La sintaxis SQL se revisó estáticamente, pero no ejecuté las migraciones contra Supabase ni hice un recorrido autenticado. Aplicá `supabase/migracion_06.sql` y probá los cobros/cierres con una cuenta de staging antes de usarlo con datos contables reales.
- La UI de tablas ya pagina filas, y las consultas existentes descargan resultados en bloques de 1000. Los cálculos globales y las exportaciones todavía requieren cargar el historial completo en memoria. No apliqué un límite que pudiera esconder registros, deuda o ingresos; para salones de mucho volumen conviene mover agregados y exportaciones a consultas/RPC paginadas.

## 3. Mejoras recomendadas

| Prioridad | Mejora | Impacto probable en venta o retención | Esfuerzo |
|---|---|---|---|
| Alta | **Onboarding guiado** para nombre, horarios, servicios, primera clienta y enlace de reservas; checklist de primeros pasos y tutorial breve. | Reduce el tiempo hasta el primer turno y hace más fácil que una peluquera termine la prueba y pague. | 3–5 días |
| Alta | **Recuperación de contraseña** con Supabase Auth, enlace de retorno seguro y mensajes claros. | Evita perder cuentas por contraseñas olvidadas y reduce tickets de soporte. | 1–2 días |
| Alta | **Asistente de importación Excel/CSV** con vista previa, mapeo de columnas, detección de duplicados y errores por fila. | Reduce la fricción para migrar desde cuadernos u otros sistemas y mejora la conversión de demos. | 3–5 días |
| Alta | **Estadísticas accionables**: clientas que vuelven, ticket promedio, servicios más rentables, ausencias y saldos antiguos. | Ayuda a demostrar retorno económico y da motivos periódicos para volver a la app. | 4–7 días |
| Media | **Notificaciones del navegador** de agenda del día, nuevas reservas y vencimiento, con preferencias por usuaria. | Reduce ausencias y consultas manuales; puede reforzar el uso recurrente. | 5–8 días |
| Media | **Paquetes de mensajes por rubro** (barbería, manicura, estética, odontología) con variables y textos editables. | Hace el producto más fácil de vender a nuevos segmentos con una demo más pertinente. | 1–2 días |
| Media | **Interfaz español/guaraní** con selector de idioma y formatos revisados por hablantes locales. | Diferencia el producto en Paraguay y amplía la adopción en salones que prefieren guaraní. | 5–10 días |
| Media | **Recibos descargables** de pagos a clientas y comprobantes de gastos, con numeración y datos configurables. | Aumenta confianza y utilidad diaria; validar por separado los requisitos de facturación electrónica antes de prometer cumplimiento fiscal. | 4–8 días |
| Baja | **Cobro recurrente de suscripción** con proveedor de pagos y avisos automáticos. | Puede disminuir renovaciones olvidadas, aunque agrega comisiones, soporte y conciliación. | 1–2 semanas |

## 4. Checklist de pruebas manuales

### Pantallas y accesibilidad

- [ ] En `index.html`, `admin.html` y `reservar.html`, revisar 360, 390 y 430 px en tema claro y oscuro; confirmar que no se desplaza la página horizontalmente y que los controles se pueden leer y tocar.
- [ ] En app móvil, abrir ☰, cerrar con toque afuera y Escape, elegir una sección y confirmar que el foco vuelve al botón. Verificar Cerrar sesión dentro del menú y que la barra inferior no cubra el último contenido al abrir el teclado.
- [ ] En PC a 1280 y 1920 px, recorrer con Tab y Shift+Tab, probar foco visible, hover, sidebar y tablas largas; confirmar el ancho máximo y el desplazamiento interno de las tablas.

### Flujos del salón

- [ ] Iniciar y cerrar sesión, recargar y volver a la pestaña; probar que el tema se conserva y que errores de red no cierran la sesión.
- [ ] Crear, buscar, editar y borrar clientas; importar CSV con fechas válidas e inválidas, teléfono/correo inválidos y duplicados; exportar CSV y JSON.
- [ ] Crear turnos para día y semana, intentar horarios solapados y comprobar precio, estado y empleada.
- [ ] Registrar pagos parciales y completos; confirmar que la deuda se recalcula y que los ingresos aparecen en día, semana, mes, servicio y empleada.
- [ ] Probar recordatorio, deuda, promoción, cumpleaños y reactivación por WhatsApp; recorrer los turnos de mañana de a uno y marcar enviados.
- [ ] Completar visitas hasta el premio; crear gastos, bajar stock hasta la alerta y calcular comisión de una empleada.
- [ ] Cambiar logo, color, dirección y horarios; validar que una reserva pública ofrece solamente horarios activos.

### Reserva, suscripción y aislamiento

- [ ] Abrir un link con slug real, solicitar un turno y revisar la solicitud pendiente; probar número inválido, honeypot, límite por teléfono y dos solicitudes simultáneas por el mismo horario.
- [ ] Aceptar y rechazar la solicitud; al aceptar, confirmar que crea turno/clienta una sola vez y ofrece la confirmación por WhatsApp.
- [ ] Con dos salones distintos, confirmar aislamiento en clientas, turnos, pagos, fotos, reportes, servicios y reservas.
- [ ] Poner una cuenta vencida y otra desactivada: probar login, pantalla de bloqueo de solo tres acciones, exportación, renovación por WhatsApp, logout y navegación por hash/atrás. Renovar desde admin y confirmar que el nuevo vencimiento se refleja sin borrar datos del navegador.
- [ ] Como usuaria común, intentar acceder a `admin.html`, modificar `es_admin`, `activo` o `vence_el`, y escribir directamente en tablas con la cuenta vencida; todas las escrituras deben ser rechazadas por el servidor.
- [ ] Confirmar que una usuaria no puede leer fotos de otra carpeta; verificar que Auth, REST, RPC y Storage de Supabase no quedan en caché después de probar offline.

## 5. Pruebas manuales para calendario, caja, búsqueda y accesos rápidos

Antes de comenzar, aplicá las migraciones pendientes en el orden documentado en el README. Para este flujo, confirmá que `migracion_12.sql`, `migracion_13.sql` y `migracion_14.sql` terminaron con `Success` en **Supabase → SQL Editor → New query**. Probá con una cuenta activa y datos de prueba; para las verificaciones de rechazo, repetí los intentos con una cuenta vencida.

- [ ] **Calendario visual:** comparar Día/Semana con `perfiles.horarios`, anterior/siguiente/hoy y fecha seleccionada. Confirmar bloque proporcional, estado, empleada y línea de hora actual. Tocar un hueco, crear turno, mantener 300 ms y mover con dedo; repetir con mouse. Probar un choque, cancelar y guardar igualmente. Revisar que Semana se desplaza dentro de su propio contenedor a 360/390/430 px.
- [ ] **Cobro rápido:** desde un turno pendiente, marcar hecho y elegir Efectivo, Transferencia, Tigo Money y Otro; Otro debe exigir la especificación del medio. Probar pago parcial con cada opción y verificar el saldo/visitas de la clienta, recargar y confirmar que no duplica el cobro. Abrir un turno cobrado y anular; el estado debe volver a pendiente y el saldo recalcularse. Repetir una escritura con cuenta vencida y confirmar el rechazo del servidor.
- [ ] **Varios servicios en un turno:** agendar a una clienta seleccionando dos o más servicios (por ejemplo, uñas y coloración). Confirmar que el precio y la duración sumen los de todos los servicios, que la agenda ocupe el intervalo combinado y detecte choques, y que el detalle, el cobro, el reporte por servicio, el cierre de caja y los mensajes muestren el paquete completo. Editar el turno pendiente, quitar/agregar un servicio y comprobar el nuevo total. Verificar que no se permita modificarlo después de realizado.
- [ ] **Cierre de caja:** cambiar día y verificar que turnos, pagos y gastos correspondan exclusivamente a esa fecha. Comparar cobros por medio, deuda generada, abonos de días anteriores, gastos, neto y comisiones. Cambiar después el porcentaje de una empleada y confirmar que el cierre guardado no cambia. Probar fecha sin movimientos, selector en días consecutivos, error/reintento, WhatsApp y listas compactas a 360/390/430 px. Imprimir en A4 y en impresora de 80 mm; enviar el resumen por WhatsApp.
- [ ] **Búsqueda global:** buscar nombre y teléfono de clientas, nombre de servicio y fecha/servicio/clienta de turnos con y sin tildes. Probar debounce, máximo ocho resultados por grupo, navegación con flechas/Enter/Escape, `/`, `Ctrl+K` y apertura de ficha/detalle/edición.
- [ ] **Atajos y llamadas:** abrir/cerrar el FAB, probar sus tres accesos y verificar que desaparece con cualquier modal y en pantalla de bloqueo. Probar `n`, `/`, `Ctrl+K`, `?`; desde ficha/lista/detalle llamar a teléfonos con `098…`, `59598…` y `+595 98…` y confirmar que todos generan un solo prefijo `+595`.
- [ ] **Agradecimiento y reseña:** guardar una URL HTTPS desde Mi salón; probar rechazo de HTTP e URL inválida. Cobrar con el checkbox, enviar desde el detalle y marcar como enviado. Revisar que el mensaje use el servicio/link, que sin link no incluya la petición de reseña y que el inicio deje de mostrar la fila tras marcarla. Confirmar que no vuelva a aparecer para un turno con `agradecido_at`.
- [ ] Repetir todo en tema claro/oscuro y PC a 1280/1920 px; confirmar foco visible, botones táctiles de al menos 44 px, sin scroll horizontal de página, sin errores de consola y que `sw.js` usa `agendapora-shell-v23`.

## 6. Pruebas manuales para servicios múltiples en reservas públicas

- [ ] En un enlace público, elegir dos o más servicios y comprobar que el resumen muestra precio y duración total combinados; cambiar selección y verificar que la lista de horarios se actualiza.
- [ ] Solicitar el turno, confirmar que el horario deja de ofrecerse a otras clientas, y aceptar la solicitud desde la app. Verificar que se crea un solo turno con el conjunto completo de servicios, precio y duración correctos.
- [ ] Probar que no se pueda reservar un hueco menor que la duración combinada, ni repetir un servicio, superar ocho selecciones, omitir todos los servicios, usar un horario ocupado o enviar una solicitud con el honeypot lleno.
- [ ] Confirmar que el flujo anterior de una reserva de un solo servicio sigue funcionando y que solicitudes antiguas se aceptan con su servicio original.
- [ ] Enviar una reserva con el correo vacío y otra con un correo válido; confirmar que ambas se aceptan, que el email aparece en la solicitud y que al aceptar se completa la ficha sin sobrescribir un email anterior. Enviar uno inválido e intentar registrarlo también directamente por RPC; ambos deben rechazarse.
