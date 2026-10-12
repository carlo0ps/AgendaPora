# Auditoría de Mis Clientas

Fecha: 11/10/2026. Revisión del código fuente, pantallas locales, service worker y esquema Supabase.

## 1. Hallazgos corregidos

### Móvil

1. **El botón ☰ no abría un menú.** En [index.html](index.html) y [js/app.js](js/app.js), el botón ahora abre un diálogo accesible con todas las secciones, instalar, reservas, tema y cerrar sesión. Se cierra al tocar afuera, al presionar Escape y al seleccionar una opción; el foco vuelve al botón que lo abrió.
2. **Había controles con áreas táctiles menores a 44 px y acciones móviles difíciles de encontrar.** En [css/style.css](css/style.css) se ajustaron los botones de tabla, iconos, enlaces accionables, borrado de fotos y paginación. Instalar sigue en la navegación inferior y en el menú; cerrar sesión está en el menú móvil. Los duplicados del encabezado se ocultan en móvil para evitar que se amontonen.
3. **El encabezado, los diálogos y la pantalla de acceso no contemplaban bien el alto disponible, el teclado ni las zonas seguras.** El encabezado permite que el título largo envuelva; login y bloqueo usan el viewport dinámico y safe-area; el contenido de los diálogos puede desplazarse con el teclado abierto. La navegación inferior reserva espacio para no tapar el contenido.
4. **El contraste de mensajes y fotos dependía del color de marca aunque el fondo fuera verde, rojo o una imagen oscura.** Se agregaron variables de texto para fondos de estado y superposiciones. Se midieron contrastes de texto comunes: mínimo 5,49:1 en las combinaciones evaluadas, por encima de 4,5:1. Los colores de texto, controles, placeholders, banners, tablas, modales y gráficos usan tokens de tema.

### PC y listas extensas

5. **Las tablas de la peluquera pintaban todas las filas a la vez.** [js/app.js](js/app.js) ahora muestra 40 filas por página. La región de tabla acepta foco de teclado y mantiene el desplazamiento horizontal contenido, sin ensanchar la página.
6. **El panel de administración mostraba todos los salones en una sola tabla sin navegación por teclado.** [js/admin.js](js/admin.js) pagina a 25 filas y marca la tabla como región desplazable y enfocada. En [css/style.css](css/style.css) se añadieron estados de foco y hover visibles. Se conservaron los máximos de contenido existentes para app, panel y reservas.

### Funcional y seguridad

7. **La importación de cumpleaños solo comprobaba el formato con una expresión regular, no que la fecha existiera, y no reconocía `dd/mm/aaaa`.** [js/app.js](js/app.js) ahora acepta `dd/mm/aaaa` y `aaaa-mm-dd`, valida el calendario y rechaza filas con fechas, teléfonos o correos inválidos antes de insertar. También valida nombres obligatorios, teléfonos de clientas/equipo y horarios semanales; limita los mensajes editables a 1500 caracteres.
8. **El botón de cierre de sesión del admin descartaba la respuesta de Supabase.** [js/admin.js](js/admin.js) ahora maneja y muestra errores, y presenta estado de carga durante el cierre.
9. **El service worker seguía en v5 y borraba cualquier caché del mismo origen al activar.** [sw.js](sw.js) usa `mis-clientas-shell-v6` y elimina solamente versiones anteriores de su propio caché. Conserva network-first, `skipWaiting()`, `clients.claim()` y el bypass de llamadas a Supabase.

La revisión de seguridad no encontró una política RLS que permitiera cruzar salones ni una RPC pública que devolviera datos personales. Se confirmó en [supabase/schema.sql](supabase/schema.sql) que las lecturas propias siguen habilitadas tras el vencimiento, que las escrituras dependen de `cuenta_activa()`, que los campos administrativos del perfil están protegidos y que las RPC privilegiadas fijan `search_path`. Las fotos usan carpetas privadas por UID; los endpoints públicos de reservas exponen servicios y horarios, no los datos de turnos existentes. No se encontró una clave `service_role` en el código.

## 2. Pendientes y límites de esta revisión

- **No ejecuté el recorrido autenticado completo contra el proyecto Supabase.** En el entorno local no hay credenciales de prueba de una peluquera ni un admin de staging. Por eso quedan por validar manualmente login real, CRUD con dos tenants, pago y renovación transaccional, reserva con un slug real, colisión concurrente, bloqueo por vencimiento, políticas en ejecución y fotos en Storage. El checklist está abajo; no creé cuentas ni datos de prueba en un proyecto que podría ser producción.
- El SQL de esquema, seed y migración pasó un parser PostgreSQL; también se analizaron 18 cuerpos PL/pgSQL. Eso valida sintaxis, no que el esquema se haya ejecutado en el proyecto Supabase conectado. No modifiqué el esquema; por eso no corresponde una migración nueva.
- La UI de tablas ya pagina filas, y las consultas existentes descargan resultados en bloques de 1000. Los cálculos globales y las exportaciones todavía requieren cargar el historial completo en memoria. No apliqué un límite que pudiera esconder registros, deuda o ingresos; para salones de mucho volumen conviene mover agregados y exportaciones a consultas/RPC paginadas.

## 3. Mejoras recomendadas

| Prioridad | Mejora | Impacto probable en venta o retención | Esfuerzo |
|---|---|---|---|
| Alta | **Onboarding guiado** para nombre, horarios, servicios, primera clienta y enlace de reservas; checklist de primeros pasos y tutorial breve. | Reduce el tiempo hasta el primer turno y hace más fácil que una peluquera termine la prueba y pague. | 3–5 días |
| Alta | **Recuperación de contraseña** con Supabase Auth, enlace de retorno seguro y mensajes claros. | Evita perder cuentas por contraseñas olvidadas y reduce tickets de soporte. | 1–2 días |
| Alta | **Asistente de importación Excel/CSV** con vista previa, mapeo de columnas, detección de duplicados y errores por fila. | Reduce la fricción para migrar desde cuadernos u otros sistemas y mejora la conversión de demos. | 3–5 días |
| Alta | **Estadísticas accionables**: clientas que vuelven, ticket promedio, servicios más rentables, ausencias y saldos antiguos. | Ayuda a demostrar retorno económico y da motivos periódicos para volver a la app. | 4–7 días |
| Media | **Notificaciones PWA** de agenda del día, nuevas reservas y vencimiento, con preferencias por usuaria. | Reduce ausencias y consultas manuales; puede reforzar el uso recurrente. | 5–8 días |
| Media | **Paquetes de mensajes por rubro** (barbería, manicura, estética, odontología) con variables y textos editables. | Hace el producto más fácil de vender a nuevos segmentos con una demo más pertinente. | 1–2 días |
| Media | **Interfaz español/guaraní** con selector de idioma y formatos revisados por hablantes locales. | Diferencia el producto en Paraguay y amplía la adopción en salones que prefieren guaraní. | 5–10 días |
| Media | **Recibos descargables** de pagos a clientas y comprobantes de gastos, con numeración y datos configurables. | Aumenta confianza y utilidad diaria; validar por separado los requisitos de facturación electrónica antes de prometer cumplimiento fiscal. | 4–8 días |
| Baja | **Cobro recurrente de suscripción** con proveedor de pagos y avisos automáticos. | Puede disminuir renovaciones olvidadas, aunque agrega comisiones, soporte y conciliación. | 1–2 semanas |

## 4. Checklist de pruebas manuales

### Pantallas y accesibilidad

- [ ] En `index.html`, `admin.html` y `reservar.html`, revisar 360, 390 y 430 px en tema claro y oscuro; confirmar que no se desplaza la página horizontalmente y que los controles se pueden leer y tocar.
- [ ] En app móvil, abrir ☰, cerrar con toque afuera y Escape, elegir una sección y confirmar que el foco vuelve al botón. Verificar Instalar y Cerrar sesión dentro del menú, y que la barra inferior no cubra el último contenido al abrir el teclado.
- [ ] En PC a 1280 y 1920 px, recorrer con Tab y Shift+Tab, probar foco visible, hover, sidebar y tablas largas; confirmar el ancho máximo y el desplazamiento interno de las tablas.
- [ ] Instalar desde Android/Chrome y escritorio; comprobar la guía de iPhone/Safari y la explicación HTTPS en local. Una app instalada no debe seguir ofreciendo instalar.

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
