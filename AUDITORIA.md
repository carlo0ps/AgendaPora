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
- [ ] **Caja por sesiones:** abrir con monto inicial, comprobar fecha/hora de Asunción y que una segunda caja sea rechazada; registrar entrada, retiro y ajuste con motivo. Cobrar en efectivo y pagar un gasto en efectivo y verificar los movimientos automáticos. Confirmar que transferencia y Tigo Money aparecen aparte, sin cambiar efectivo esperado.
- [ ] **Cierre e historial:** contar un importe distinto del esperado, confirmar sobrante/faltante y snapshot por medio, intentar modificar la caja cerrada y comprobar el rechazo. Filtrar por fecha y diferencia; imprimir desde vista previa A4 y 80 mm y preparar el resumen para WhatsApp.
- [ ] **Búsqueda global:** buscar nombre y teléfono de clientas, nombre de servicio y fecha/servicio/clienta de turnos con y sin tildes. Probar debounce, máximo ocho resultados por grupo, navegación con flechas/Enter/Escape, `/`, `Ctrl+K` y apertura de ficha/detalle/edición.
- [ ] **Atajos y llamadas:** abrir/cerrar el FAB, probar sus tres accesos y verificar que desaparece con cualquier modal y en pantalla de bloqueo. Probar `n`, `/`, `Ctrl+K`, `?`; desde ficha/lista/detalle llamar a teléfonos con `098…`, `59598…` y `+595 98…` y confirmar que todos generan un solo prefijo `+595`.
- [ ] **Agradecimiento y reseña:** guardar una URL HTTPS desde Mi salón; probar rechazo de HTTP e URL inválida. Cobrar con el checkbox, enviar desde el detalle y marcar como enviado. Revisar que el mensaje use el servicio/link, que sin link no incluya la petición de reseña y que el inicio deje de mostrar la fila tras marcarla. Confirmar que no vuelva a aparecer para un turno con `agradecido_at`.
- [ ] Repetir todo en tema claro/oscuro y PC a 1280/1920 px; confirmar foco visible, botones táctiles de al menos 44 px, sin scroll horizontal de página, sin errores de consola y que `sw.js` usa `agendapora-shell-v39`.

## 6. Pruebas manuales para servicios múltiples en reservas públicas

- [ ] En un enlace público, elegir dos o más servicios y comprobar que el resumen muestra precio y duración total combinados; cambiar selección y verificar que la lista de horarios se actualiza.
- [ ] Solicitar el turno, confirmar que el horario deja de ofrecerse a otras clientas, y aceptar la solicitud desde la app. Verificar que se crea un solo turno con el conjunto completo de servicios, precio y duración correctos.
- [ ] Probar que no se pueda reservar un hueco menor que la duración combinada, ni repetir un servicio, superar ocho selecciones, omitir todos los servicios, usar un horario ocupado o enviar una solicitud con el honeypot lleno.
- [ ] Confirmar que el flujo anterior de una reserva de un solo servicio sigue funcionando y que solicitudes antiguas se aceptan con su servicio original.
- [ ] Enviar una reserva con el correo vacío y otra con un correo válido; confirmar que ambas se aceptan, que el email aparece en la solicitud y que al aceptar se completa la ficha sin sobrescribir un email anterior. Enviar uno inválido e intentar registrarlo también directamente por RPC; ambos deben rechazarse.

## 13. Auditoría de caja por sesiones · 20/10/2026

### Cómo funcionaba antes

La pantalla existente de **Cierre de caja** era un reporte diario, no una sesión contable. `renderCashClose()` en `js/app.js` tomaba la fecha elegida y `loadCashClose()` consultaba `turnos`, `pagos` y `gastos` directamente. El cobro rápido de `completeQuickPayment()` llamaba a la RPC `cobrar_turno_rapido` de `supabase/migracion_11.sql`, que marcaba el turno como realizado y agregaba `pagos`, pero no había una caja abierta ni un registro de efectivo esperado. `expenseForm()` insertaba gastos directamente en la tabla y el borrado se hacía con `deleteRow()`. Transferencias, gastos en efectivo y cobros en efectivo no tenían relación persistente con un cierre.

### Flujo actual

1. `renderCashClose()` en `js/app.js` pide `caja_datos()` al abrir la sección. La RPC devuelve la sesión activa, sus movimientos, y el historial filtrado por fechas. Para cada cierre guardado, `caja_detalle()` devuelve el snapshot inmutable y los movimientos de esa sesión.
2. `openCashSession()` llama `abrir_caja()`. El servidor registra la fecha de `America/Asuncion`, `clock_timestamp()` y `auth.uid()`. Un bloqueo transaccional más un índice único parcial garantizan como máximo una caja abierta por salón.
3. `cashMovementForm()` llama `registrar_movimiento_caja()`. El servidor asocia cada movimiento a la caja abierta, valida tipo/categoría/monto y exige motivo para un ajuste.
4. El cobro sigue usando el flujo existente `completeQuickPayment()` → `cobrar_turno_rapido()` → `pagos`. El trigger `pagos_preparar_caja` encuentra y bloquea la caja abierta para una fecha de hoy; el trigger `pagos_sincronizar_caja` agrega un movimiento de efectivo. Transferencia/Tigo Money quedan asociados para el snapshot por medio, pero no generan efectivo.
5. El gasto ahora sigue `expenseForm()` → `registrar_gasto()` → `gastos`. El trigger `gastos_preparar_caja` asocia el registro actual y `gastos_sincronizar_caja` resta del efectivo solo cuando `medio_pago = 'Efectivo'`. `eliminar_gasto()` permite borrar solo mientras la caja asociada siga abierta.
6. `caja_resumen_actual()` calcula `monto_inicial + entradas − salidas` y arma totales por medio de pago/gasto. `cashCloseForm()` llama `cerrar_caja()`, que bloquea la fila de caja, calcula el efectivo esperado, guarda el contado, diferencia y snapshot en una sola transacción.
7. `proteger_caja()` impide editar o borrar cierres. `proteger_movimiento_caja()` hace inmutables los movimientos; la corrección se registra con categoría Ajuste y motivo en una caja abierta. Las tablas `cajas` y `caja_movimientos` tienen RLS y políticas CRUD separadas; las escrituras pasan por RPC SECURITY DEFINER de `supabase/migracion_19.sql`, con `search_path` fijo, sesión y cuenta activa verificadas.
8. El respaldo administrativo agrega `cajas` y `caja_movimientos` mediante `admin_respaldo_caja_pagina()` y `js/admin.js`. El respaldo propio y la exportación de cuentas bloqueadas incluyen las dos tablas.

### Validaciones y límites

- `supabase/tests_seguridad.sql` incluye aislamiento entre dos salones, segunda apertura rechazada, cierre inmutable, cuenta vencida sin escritura, RLS, y restricción de anon y usuaria común sobre el respaldo de caja.
- `seed_demo.sql` y `seed_plantilla.sql` recrean una caja ficticia con efectivo inicial y movimientos determinísticos; también incluyen un cobro y gasto de fecha actual para comprobar sincronización automática.
- Los pagos y gastos con fecha de hoy se asocian a una caja abierta de hoy. Un pago o gasto en efectivo se rechaza si no existe una caja abierta de hoy; un registro histórico fechado antes no cambia el efectivo esperado.
- Si queda una caja abierta después de medianoche, primero hay que cerrarla. La dueña puede continuar con un ajuste motivado en otra caja abierta; un cierre anterior nunca se edita.
- La revisión de SQL fue estática. No hay credenciales de staging en este entorno para ejecutar migraciones o `tests_seguridad.sql` en Supabase; el paso de ejecución está en el checklist manual.

## 14. Rediseño visual · 20/10/2026

- Se definió la dirección **boutique de belleza moderna** y se centralizaron los tokens de color, tipografía, escala, espaciado, radios, elevaciones, tiempos de movimiento y capas en [css/style.css](css/style.css).
- Bricolage Grotesque queda para títulos y valores destacados; Inter para texto y controles, con fuentes de respaldo. Modo claro y oscuro tienen superficies y colores de estado propios.
- Contraste calculado con la fórmula WCAG para texto, texto secundario, CTA, etiquetas de estado y mensajes sobre fondos claros y oscuros: **todas las combinaciones evaluadas superan 4,5:1**. Mínimos en estas combinaciones: 5,67:1 en oscuro (texto claro sobre CTA) y 5,98:1 en claro (texto secundario sobre superficie suave).
- [guia-ui.html](guia-ui.html) es una referencia local sin datos reales ni enlace desde el menú del salón.

### Checklist visual para revisar a mano

- [ ] Abrir [guia-ui.html](guia-ui.html) a 360 px y 1280 px, con el tema claro y oscuro; recorrer botones, campos, errores, estados, paginación y diálogo de muestra.
- [ ] Revisar [index.html](index.html) a 360, 430 y 1280 px en ambos temas; confirmar navegación, búsqueda, tarjetas del inicio y calendario sin desbordamiento horizontal.
- [ ] En login, recuperación y bloqueo, probar texto largo, teclado móvil, foco visible, links y botones de al menos 44 px.
- [ ] En agenda, comprobar modo día y semana, línea de hora actual, estados, deudas y que el desplazamiento semanal quede dentro del calendario.
- [ ] En clientas, revisar búsqueda, acciones rápidas, ficha e historial; comprobar que teléfono y WhatsApp abran enlaces correctos.
- [ ] En caja y reportes, verificar cifras tabulares, filtros, gráficos, historial e impresión A4/80 mm.
- [ ] En reservas públicas, comprobar selector de servicios, fecha, opciones de horario, resumen, mensajes de error y confirmación con un salón de pruebas.
- [ ] Verificar admin en móvil y escritorio: métricas, respaldo, precios y listado paginado.
- [ ] Con teclado, recorrer las páginas, usar /, Ctrl+K, ?, Escape en diálogos y revisar el indicador de foco.
- [ ] Probar la preferencia de movimiento reducido del sistema y el cambio de tema; no usar capturas con datos reales.

- [ ] En la navegación móvil, verificar los cuatro destinos visibles (Inicio, Agenda, Clientas y Caja) y que Más abra todas las demás secciones; confirmar el estado activo y que la ventana cierra con Escape, toque afuera y selección.
- [ ] En escritorio, colapsar y expandir la barra lateral; revisar que los iconos conserven nombre accesible, que la búsqueda global siga visible y que la preferencia sobreviva a una recarga.

### Fase 3 · pantallas clave · 20/10/2026

- Inicio: saludo en hora de Paraguay, fecha, turnos del día, ingresos, deuda, variación y accesos de agenda; el resumen compartible usa WhatsApp. Cumpleaños y reactivaciones abren acciones existentes.
- Agenda: se conserva el movimiento de turnos y se agrega impresión solo para la vista diaria. La impresión oculta controles y prioriza el calendario.
- Clientas: avatar de iniciales con tono estable, deuda y última visita en la lista. La ficha ofrece pestañas con navegación por flechas, Inicio y Fin; las acciones de pago, edición, turno y fotos conservan sus hooks.
- Reserva: selector `#booking-time` y RPC siguen vigentes. La grilla táctil expone horarios como radios, con flechas, Inicio y Fin; el resumen de servicios queda pegado al borde inferior durante el formulario.
- Cobro y reportes: cuatro medios de pago con iconos; el monto recibido queda destacado. Ingresos comparan el tramo actual con el mismo tramo anterior y el gráfico ofrece sus valores en una lista accesible.
- Revisión estática: sintaxis JS, referencias, IDs, CSS y contraste calculado. No se inició sesión ni se consultaron datos reales. La vista previa local quedó omitida porque la herramienta de navegador no aceptó `file://`.
- No se agrega deshacer para borrar: la eliminación de clientas también borra sus fotos privadas y las RPC existentes no ofrecen una restauración segura. No se agregan rachas/logros persistentes ni pantalla de novedades porque requieren estado y reglas de negocio nuevos.

### Pruebas manuales recomendadas

- [ ] En 360 px y 1280 px, abrir Inicio en claro/oscuro: revisar los cuatro indicadores, saludo, agenda, resumen por WhatsApp y tarjetas accionables.
- [ ] En Agenda, abrir vista Día, imprimir y comprobar que los controles no salen en papel; alternar a Semana y comprobar el desplazamiento horizontal dentro del calendario.
- [ ] En Clientas, abrir una ficha y recorrer las cinco pestañas con clic, Tab, flechas, Inicio y Fin; desde Pagos registrar un abono y desde Fotos subir una imagen de prueba.
- [ ] En Reservas, elegir servicios y fecha; seleccionar horario con toque, teclado y flechas; enviar una solicitud de prueba y verificar que el resumen quede visible al desplazarse.
- [ ] En Cobro rápido, comprobar el monto protagonista y los cuatro medios de pago; registrar un pago parcial de prueba y revisar el saldo restante.
- [ ] En Reportes, comparar día, semana y mes; abrir “Consultar valores del gráfico” y confirmar que coincida con la línea.
- [ ] Revisar Admin, bloqueo por vencimiento, estados vacíos, carga, tablas móviles, foco y áreas táctiles en ambos temas.