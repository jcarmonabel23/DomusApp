# DomusApp · Plan por fases

Software de gestión condominal en la nube para condominios, residenciales, centros comerciales y oficentros.
Tiene tres frentes: el **panel administrativo** (web), la **app móvil** (Propietario/Inquilino y Guarda) y la
**API** con su base de datos. Usa la misma arquitectura, seguridad y estilo de FabriHub.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Repositorio | Monorepo en `jcarmonabel23/DomusApp` con ramas `dev` → `qa` → `main` |
| API | Node 22 + TypeScript + Express 5 + `pg` + zod. Un handler por acción, igual que en FabriHub |
| Base de datos | PostgreSQL 16. `db/init` es la línea base y `db/migrations` guarda los cambios versionados con checksum. El rol de la app solo hace DML y no puede saltarse RLS |
| Panel | React 19 + Vite + Mantine 8 + Tailwind 4, con el estilo de FabriHub y la paleta azul de DomusApp |
| Móvil | Expo (SDK 58) + Expo Router. Se prueba con Expo Go y se publica con EAS. Es **una sola app**: la interfaz cambia según el rol |
| Multicondominio | Cada condominio está aislado por RLS (`condominium_id`). Un usuario puede pertenecer a **varios condominios**, con un rol distinto en cada uno, y cambiar de condominio activo desde el selector |
| Roles | Administrador de plataforma, Administrador de condominio, Propietario, **Inquilino**, Guarda de seguridad |
| País y moneda | Se eligen **por condominio**. Hay un catálogo de países de Latinoamérica con su moneda, zona horaria, formato de identificación y teléfono |
| Pagos | Hay dos vías. **En línea**, con una pasarela simulada (tarjeta de prueba, aprobada o rechazada, con webhook) que queda detrás de una interfaz para conectar después una pasarela real. **Manual**, con transferencia o depósito y comprobante, que el administrador aprueba |
| Tiempo real | WebSockets (Socket.IO) y notificaciones push de Expo para pánico, visitas y mensajería |
| Archivos | Volumen `uploads` con URLs firmadas, igual que en FabriHub. Más adelante se podrá mover a S3/R2 |

## Fases

### Fase 0 · Base ✅
- Monorepo con `apps/api`, `apps/admin`, `apps/mobile`, `db/` y `scripts/`.
- `docker compose up` levanta db, migrate, api, admin, mailpit y respaldos, todo con health checks. La red de datos no tiene salida a internet y la API no se publica al host.
- La API ofrece `/health` y `/api/v1/meta/status`, con trace id por petición, errores uniformes y configuración validada.
- El panel tiene el header, la barra de módulos, el tablero con el estado del sistema y el mapa de fases. Incluye modo oscuro.
- La app móvil tiene las 5 pestañas del estilo de referencia (Inicio, Autorizados, Mi dashboard, Reservaciones, Mi Condominio) y muestra el estado de conexión con el servidor.
- CI en GitHub Actions: build de cada app y arranque del stack con `scripts/smoke.sh`.

### Fase 1 · Núcleo: seguridad, condominios y personas ✅
- Catálogos: países de Latinoamérica, monedas y zonas horarias.
- **Condominios**: tipo (residencial, condominio, centro comercial, oficentro), país, moneda, zona horaria, logo, color y datos legales.
- **Filiales/unidades**: torre o bloque, número, tipo, área, alícuota o coeficiente, y estado (ocupada por el propietario o alquilada).
- **Personas** y **usuarios**: invitación por correo, membresía por condominio con rol, y propietarios e inquilinos asociados a cada filial.
- Autenticación igual que en FabriHub: login, OTP por correo en el panel, refresh rotativo, bloqueo por intentos, política de contraseñas y auditoría. La app móvil guarda la sesión en `expo-secure-store`.
- RBAC por módulo y por condominio, aplicado tanto en la API como en el panel y la app.
- Login en el panel y en la app, más el selector de condominio activo.
- Queda para la fase 2: el **logo** del condominio (llega junto con la subida de fotos y archivos). Por ahora se usa el color de marca.

### Fase 2 · Control de acceso ✅
- Autorizados **temporales**, **permanentes** y **empleados**, con foto, cédula, placa, fecha o rango, indicaciones para el oficial, "llamar a la casa para confirmar" y "eliminar una vez utilizado".
- Vehículos de la filial.
- Interfaz del **Guarda**: lista del día, búsqueda por nombre, cédula o placa, registro de ingreso y salida con un toque, y visitas no anunciadas que se avisan al propietario.
- Bitácora con fecha y hora, exportable a Excel y PDF.
- Logo del condominio (cabecera del panel, app y PDF), traído de la fase 1.

### Fase 3 · Botón de pánico, alertas y mensajería ✅
- Tipos de alerta: robo, incendio, inundación, intrusos, vandalismo, cortocircuito, violencia doméstica, enfermedad, accidente, etc.
- La alerta llega al guarda en tiempo real con sonido y **sigue activa hasta que el guarda la marca como atendida**: sirena a pantalla completa hasta que alguien la toma ("Voy en camino"), luego queda abierta hasta cerrarla con una resolución. El panel la ve en vivo, con tiempos de respuesta y cierre, e historial exportable.
- Mensajería entre el guarda y los propietarios (un hilo por filial), y comunicados de la administración (módulo nuevo **MESSAGES**, "Comunicados", con audiencia todos / residentes / guardas).
- Notificaciones push y campana con contador. Tiempo real con Socket.IO en `/api/socket.io`; push remoto con Expo (`EXPO_PUSH_ENABLED`), que requiere un build de EAS (fase 4). En Expo Go funcionan el socket, los avisos locales y la campana.

### Fase 4 · Pulido móvil (en paralelo con las fases 2 y 3) ✅
- Identidad del condominio: la app toma el **color de marca** y el **logo** del condominio activo (encabezados, pestañas, botones, chips, perfil) y cambia sola al cambiar de condominio. Si el color no da contraste AA con texto blanco (4.5:1), se oscurece lo justo; el panel muestra la vista previa y avisa del ajuste.
- Estados vacíos ilustrados (ilustración hecha con vistas, sin imágenes) con acción sugerida.
- Accesibilidad: roles, etiquetas y estados en todos los botones, encabezados marcados, áreas táctiles de 44 pt, avisos de error anunciados y la alarma de pánico anunciada al lector de pantalla.
- Builds con EAS listos (`eas.json`, `app.config.ts`): perfil `preview` (APK interno, "DomusApp (prueba)", HTTP permitido para la LAN) y `production`. En los builds, la alerta push suena con la sirena (canal `alerts-siren`). Proyecto `@jcarmona23/domusapp` creado y primer APK `preview` generado. Pendiente para el push con la app cerrada: clave FCM v1 de Firebase (`eas credentials -p android`) y `EXPO_PUSH_ENABLED=true`.

### Fase 5 · Finanzas ✅
- Cuotas ordinarias y extraordinarias, intereses moratorios, multas y cargos especiales por filial. Las cuotas recurrentes (monto fijo, por alícuota o por m²) se generan solas cada mes (programador cada hora, idempotente) o con «Generar mes». El interés se carga una vez al mes sobre el capital vencido después de los días de gracia (sin interés sobre interés). Los cargos no se borran: se anulan con motivo.
- Pagos aplicados FIFO a la deuda más antigua (en la misma fecha, primero el interés). Estado de cuenta con saldo corrido, en la app y en PDF/Excel desde el panel, con envío por correo.
- Pago **en línea** con la pasarela simulada (interfaz `PaymentGateway`, webhook firmado HMAC con tolerancia de 5 min, idempotente; la tarjeta nunca se guarda, solo marca y últimos 4) o **manual** (transferencia / depósito con referencia y foto del comprobante) con aprobación o rechazo con motivo del administrador (permiso nuevo `approve`).
- Panel: módulo **FINANCE** con resumen, saldos y morosidad (exportable), cargos, pagos por revisar, cuotas recurrentes, gastos con factura (exportables) y cuentas bancarias y parámetros. App: tarjeta «Estado de cuenta» en Mi dashboard, movimientos, reporte de pago y pago con tarjeta; avisos `charge` y `payment` en la campana y por push.

### Fase 6 · Áreas comunes y reservaciones ✅
- Áreas con foto, reglamento, horario y días, bloques de 30 min a 2 h, duración máxima, anticipación mínima y máxima, capacidad y costo. Modo **exclusivo** (un grupo a la vez) o **compartido** (varias filiales hasta la capacidad), límite de reservas activas por filial y opción «solo filiales al día» (usa la morosidad de la fase 5).
- Calendario por hora con estados disponible, reservado, por aprobar, feriado y no disponible; aprobación opcional con rechazo con motivo. El costo se carga al estado de cuenta al confirmarse y se anula si la filial cancela con la anticipación del área o si cancela la administración. La reserva bloquea la fila del área para que dos solicitudes simultáneas no tomen el mismo horario.
- Feriados y cierres (de un área o de todas, por día u horas, con fin o indefinidos) y restricciones a una filial; al crearlos puede cancelar las reservas que choquen, avisando a cada filial.
- Panel: módulo **BOOKINGS** con indicadores, calendario semanal por área, reservas (revisión, reserva a nombre de una filial, Excel/PDF), áreas y bloqueos. App: pestaña Reservaciones como en las capturas (saludo, buscador, cuadrícula de áreas), detalle con reglamento y horarios, Mis reservas con cancelación; avisos `booking` en la campana y por push.

### Fase 7 · Gestión administrativa ✅
- **Casos**: daños, mejoras, quejas, sugerencias y denuncias (estas pueden ser anónimas: el panel no ve quién la hizo). Número consecutivo por condominio, prioridad, responsable, proveedor y fecha compromiso; estados abierto, en proceso, resuelto, cerrado y rechazado con su historial; comentarios internos que el residente no ve; hasta 12 fotos o PDF por caso. El residente confirma la solución con una calificación de 1 a 5 o lo reabre. Los casos no se borran.
- **Asambleas**: ordinarias y extraordinarias, presenciales o virtuales, con agenda; aviso opcional a los residentes; al celebrarse se registra asistencia, quórum, resumen y acta (PDF). **Acuerdos** numerados con responsable o proveedor, fecha compromiso, avance y estado; los vencidos se marcan.
- **Documentos**: reglamentos, circulares, actas, manuales, formularios y financieros en PDF o imagen, para residentes o solo para el personal, con aviso opcional.
- **Proveedores**: categoría, datos fiscales, contactos, personal autorizado y contratos (monto, frecuencia, vigencia y archivo, con alerta de vencimiento); los marcados como recomendados forman el directorio de la app.
- **Inventario**: código, categoría, ubicación o área común, cantidad, valor, estado y foto; mantenimiento periódico con próxima fecha (alerta a 15 días) y bitácora de mantenimientos, reparaciones, traslados, cambios de estado y bajas.
- Los PDF se validan por su contenido (encabezado y cierre) y se descargan con su nombre. Panel: módulos **CASES**, **ASSEMBLIES**, **DOCUMENTS**, **SUPPLIERS** e **INVENTORY** con exportes. App: Casos (lista, nuevo con fotos, detalle con conversación, confirmación y reapertura), Documentos, Asambleas con acuerdos, Seguimiento a acuerdos y directorio de proveedores; avisos `case`, `assembly` y `document` en la campana y por push.

### Fase 8 · Reportes y tablero
- Indicadores: ingresos, morosidad, accesos, incidentes y tiempos de atención de alertas. Todo se puede exportar.

### Fase 9 · Publicación
- Ambientes `qa` y `prod` con despliegue desde las ramas, HTTPS con Caddy y correo SMTP real (igual que el DEPLOY de FabriHub).
- Builds con EAS y publicación en Google Play y App Store.
