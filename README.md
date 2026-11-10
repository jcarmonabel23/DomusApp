# DomusApp

Gestión condominal en la nube para condominios, residenciales, centros comerciales y oficentros. Tiene tres
perfiles: **Administrador**, **Propietario/Inquilino** y **Guarda de seguridad**. El plan completo está en
[PLAN.md](PLAN.md).

## Arranque

```bash
cp .env.example .env              # cambie TODOS los secretos
openssl rand -hex 32              # → JWT_ACCESS_SECRET
docker compose up -d --build
sh scripts/smoke.sh               # pruebas de humo
```

| Servicio | URL | Nota |
|---|---|---|
| Panel administrativo | http://localhost:8090 | Panel + proxy `/api`. La API y la BD no se publican |
| Mailpit | http://127.0.0.1:8026 | Bandeja de los correos en desarrollo (códigos OTP, accesos) |
| pgAdmin | http://127.0.0.1:5051 | `docker compose --profile tools up -d` |

Los puertos no chocan con los de FabriHub (8080, 8025, 5050), así que puede correr los dos proyectos a la vez.

Para reiniciar la BD desde cero (vuelve a ejecutar `db/init`): `docker compose down -v`.

## Acceso

El ingreso es en dos pasos: contraseña y luego un código de 6 dígitos que llega por correo (en desarrollo, a
Mailpit). No hay registro público: las cuentas las crea un administrador.

- **Administrador de plataforma**: `ADMIN_EMAIL` / `ADMIN_PASSWORD` del `.env`. Al primer ingreso pide cambiar la
  contraseña. Es el único que ve el módulo **Condominios** (alta de condominios y su primer administrador).
- **Datos de demostración** (`SEED_DEMO=true`, contraseña `DEMO_PASSWORD`): dos condominios, *Residencial Las
  Palmas* (Costa Rica, CRC) y *Oficentro Plaza Norte* (Panamá, USD), con estos usuarios:

| Usuario | Rol | Dónde entra |
|---|---|---|
| `admin.demo@domusapp.local` | Administrador de los dos condominios | Panel y app |
| `propietario@domusapp.local` | Propietario de A-101 y B-302 | App |
| `inquilino@domusapp.local` | Inquilino de B-302 | App |
| `guarda@domusapp.local` | Guarda de seguridad | App (interfaz de caseta) |

Para probar el control de acceso, los datos de demostración de Las Palmas incluyen los vehículos `BRT456` y
`MOT120` (A-101) y `CRC789` (B-302), y cuatro autorizados: Rosa Rojas (permanente), Carmen Solano (empleada,
lunes a viernes de 07:00 a 18:00), Carlos Salgado (temporal de hoy a pasado mañana, con llamada de confirmación) y
Andrea Molina (temporal de un solo uso en B-302). También trae algunos movimientos en la bitácora.

Para la fase 3 trae dos comunicados ("Corte de agua programado", fijado, para todos; "Nuevo horario de la
piscina", para residentes), dos alertas ya atendidas (intrusos en A-101 y emergencia médica en B-302) y una
conversación entre la caseta y A-101.

Para la fase 5 (Finanzas) trae la cuota de mantenimiento de ₡85 000 desde hace tres meses (interés 2 % mensual,
5 días de gracia, vence el día 10), dos cuentas bancarias (BCR y BAC), pagos de los meses anteriores, B-302 y
A-202 en mora con su interés, una multa en A-102, una transferencia de B-302 por revisar (`TRF-88231`) y cuatro
gastos. Pasarela de prueba (no cobra nada): `4242 4242 4242 4242` o `5555 5555 5555 4444` aprueban,
`4000 0000 0000 0002` se rechaza y `4000 0000 0000 9995` da fondos insuficientes (cualquier vencimiento futuro y
CVC); otra tarjeta real se rechaza con `NOT_TEST_CARD`. Variables: `PAYMENT_GATEWAY=simulated`,
`PAYMENT_WEBHOOK_SECRET` (cámbiela fuera de desarrollo) y `PAYMENT_SIM_DELAY_MS` (demora del webhook simulado).

Para la fase 6 (Reservaciones) trae cinco áreas: Piscina y Gimnasio (compartidas, gratis), Rancho BBQ (₡10 000,
24 h de anticipación, solo filiales al día), Salón de eventos (₡35 000, con aprobación, 72 h de anticipación) y
Cancha multiuso. Hay reservas próximas de A-101 (rancho y piscina) y de B-302 (cancha), una solicitud del salón
por aprobar (A-102), una cancelada y una pasada; el feriado de Navidad, una limpieza de la piscina en tres días y
una restricción del salón para B-302. Como B-302 está en mora, no puede reservar el rancho.

Para la fase 7 (Gestión administrativa) trae seis proveedores con contactos, personal y cuatro contratos (uno por
vencer y otro vencido), seis casos en distintos estados (uno anónimo y uno del panel con la fecha compromiso
vencida), dos asambleas (una celebrada con su acta en PDF y cuatro acuerdos, otra convocada para dentro de dos
semanas), cinco documentos (uno solo para el personal) y ocho artículos de inventario con su bitácora.

Para la fase 8 (Reportes) trae cinco meses de historia que terminan una semana antes de la creación de la base:
unos 800 ingresos en la caseta (con horas pico, fines de semana más movidos y algunos rechazos), catorce alertas
atendidas con distintos tiempos de respuesta y diez casos resueltos con su calificación. Se genera con una semilla
fija, así que sale igual en cada base nueva.

En producción, `SEED_DEMO=false`.

## App móvil (Expo Go)

```bash
cd apps/mobile
npm install
npx expo start                    # escanee el QR con Expo Go (Android) o con la cámara (iPhone)
```

El teléfono y la PC deben estar en la **misma red Wi-Fi**. La app llega a la API por el panel
(`http://<IP-de-la-PC>:8090`), y esa IP la detecta sola desde Expo. Si Windows pregunta, permita el puerto 8090 en
el firewall. Para usar otro servidor, copie `apps/mobile/.env.example` a `.env` y defina `EXPO_PUBLIC_API_URL`.

La sesión del teléfono se guarda en el almacén seguro del sistema (`expo-secure-store`) y dura 30 días desde el
último uso (`MOBILE_REFRESH_TTL_DAYS`).

**Build interno (sin Expo Go).** Requiere una cuenta de Expo y EAS CLI (`npm i -g eas-cli`):

```bash
cd apps/mobile
eas login
eas init                                   # crea el proyecto; copie el id en app.json → extra.eas.projectId
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value http://<IP-de-la-PC>:8090 --visibility plaintext
eas credentials -p android                 # una vez: clave FCM v1 de Firebase para el push en Android
eas build -p android --profile preview     # APK para instalar en el teléfono con el enlace o QR
```

El perfil `preview` instala "DomusApp (prueba)" (`com.domusapp.mobile.preview`), que convive con la versión de
tienda y permite HTTP para llegar a la API de la LAN. `production` exige HTTPS. En los builds, el push de una
alerta suena con la sirena aunque la app esté cerrada.

**Tiempo real y notificaciones.** Panel y app se conectan por Socket.IO en `/api/socket.io` (pasa por el proxy del
panel). Con la app abierta, las alertas, mensajes y visitas llegan por el socket y se muestran como aviso local y
en la campana. El push remoto (app cerrada) usa el servicio de Expo y necesita un build de EAS con `projectId`;
en Expo Go no hay push remoto (Expo muestra una advertencia, es normal). Para activarlo en la API:
`EXPO_PUSH_ENABLED=true` y, si el proyecto de Expo lo exige, `EXPO_ACCESS_TOKEN`.

## Desarrollo

```bash
cd apps/admin  && npm install && npm run dev    # http://localhost:5173, usa la API del contenedor vía :8090
cd apps/api    && npm install && npm run typecheck
cd apps/mobile && npm run typecheck
```

## Estructura

```
apps/
  api/       Node 22 + TS + Express 5 + pg + zod (un handler por acción, como FabriHub)
  admin/     React 19 + Vite + Mantine 8 + Tailwind 4; server.ts = estáticos + proxy /api + CSP
  mobile/    Expo SDK 58 + Expo Router (src/app); una app con interfaz por rol
db/
  init/        línea base (solo corre con el volumen vacío)
  migrations/  cambios de esquema desde la fase 2: AAAAMMDD_NNNN_descripcion.sql, nunca se editan
scripts/
  smoke.sh          pruebas de humo (fase 0) y llamada a las de fases 1, 2, 3, 5, 6, 7 y 8
  smoke/lib.mjs     utilidades comunes (llamadas a la API, OTP desde Mailpit, login, cliente Socket.IO mínimo)
  smoke/fase1.mjs   login con OTP vía Mailpit, RLS entre condominios, roles, refresh móvil
  smoke/fase2.mjs   autorizados, fotos firmadas, caseta, visitas no anunciadas, bitácora Excel/PDF, logo
  smoke/fase3.mjs   socket, ciclo de alertas en vivo, aislamiento, mensajería, comunicados, campana, push tokens
  smoke/fase5.mjs   saldos y morosidad, FIFO, pagos manuales y en línea (webhook firmado), cargos, cuotas, gastos, exportes
  smoke/fase6.mjs   áreas, disponibilidad, feriados, restricciones, validaciones, concurrencia, aprobación, cargos, bloqueos
  smoke/fase7.mjs   proveedores y contratos, casos (anónimos, estados, archivos, calificación), asambleas, acuerdos, documentos PDF, inventario
  smoke/fase8.mjs   reportes (permisos, período, sumas por sección, cruce con Finanzas, exportes), tablero «Hoy», RLS
```

El límite de intentos de login (60 cada 15 min por IP) vive en memoria: para correr la suite completa dos veces
seguidas, reinicie la API (`docker compose restart api`).

## Ramas

`dev` (desarrollo) → `qa` (pruebas) → `main` (producción). La CI corre en los push y PR hacia las tres.
