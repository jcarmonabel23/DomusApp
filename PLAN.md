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

### Fase 5 · Finanzas
- Cuotas ordinarias y extraordinarias, intereses moratorios, multas y cargos especiales por filial. Las cuotas recurrentes se generan solas cada mes.
- Estado de cuenta del Propietario o Inquilino.
- Pago **en línea** con la pasarela simulada, o **manual** con comprobante y aprobación del administrador.
- Gastos del condominio, cuentas bancarias y reporte de morosidad.

### Fase 6 · Áreas comunes y reservaciones
- Áreas con foto, reglamento, horario, duración máxima, anticipación, capacidad y costo.
- Calendario por hora con estados disponible, reservado, feriado y no disponible, y aprobación opcional.
- Restricción de áreas por parte de la administración, para todos o para una filial.

### Fase 7 · Gestión administrativa
- **Casos**: daños, mejoras, quejas, sugerencias y denuncias, con fotos y documentos, seguimiento por estados y respuesta.
- Asambleas y seguimiento de acuerdos, reglamentos y documentos, proveedores (contratos, personal y contactos) e inventarios.

### Fase 8 · Reportes y tablero
- Indicadores: ingresos, morosidad, accesos, incidentes y tiempos de atención de alertas. Todo se puede exportar.

### Fase 9 · Publicación
- Ambientes `qa` y `prod` con despliegue desde las ramas, HTTPS con Caddy y correo SMTP real (igual que el DEPLOY de FabriHub).
- Builds con EAS y publicación en Google Play y App Store.
