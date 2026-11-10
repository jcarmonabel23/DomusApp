# DomusApp · publicación (qa y producción)

Dos ambientes, cada uno en **su propio servidor** y siguiendo **su rama**:

| Ambiente | Rama | `APP_ENVIRONMENT` | Para qué |
|---|---|---|---|
| **qa** | `qa` | `qa` | Pruebas con usuarios reales antes de publicar; puede tener datos de demostración y la pasarela simulada |
| **prod** | `main` | `prod` | Producción. Sin demostración; la API no arranca con la pasarela simulada ni con valores de desarrollo |

```
 Internet ──443──▶ caddy (HTTPS) ──▶ admin (panel + proxy /api y WebSocket) ──▶ api ──▶ db
                   único puerto publicado            red_app                     red_datos (interna)
 App móvil ──────▶ https://<dominio>/api   (el mismo dominio que el panel)
```

Un servidor gratuito alcanza para cada ambiente: en **Oracle Cloud Always Free** caben dos máquinas
`VM.Standard.A1.Flex` (ARM) de 2 OCPU / 12 GB, una para qa y otra para producción. Sirve cualquier VPS con
Ubuntu 24.04 (x86 o ARM) y 2 GB de RAM o más.

## 1. Firewall del proveedor: abrir 80 y 443

En Oracle: *Networking → Virtual Cloud Networks → (su VCN) → Subnets → (subred pública) → Security Lists →
Default → Add Ingress Rules*, dos reglas con *Source CIDR* `0.0.0.0/0`, protocolo TCP, puertos `80` y `443`.
En otros proveedores, lo equivalente (Security Group, Firewall…).

El 22 (SSH) ya viene abierto. **No** abra 8090, 5432, 8026 ni 5051: en publicación solo Caddy escucha.

## 2. Dominio

- **Sin dominio propio**: use `<ip-con-guiones>.sslip.io` (p. ej. `203-0-113-10.sslip.io`). `sslip.io` resuelve
  ese nombre a la IP y Caddy obtiene un certificado real de Let's Encrypt.
- **Con dominio**: un registro `A` por ambiente hacia la IP de su servidor (p. ej. `qa.domusapp.com` y
  `app.domusapp.com`). Hágalo **antes** del primer despliegue.

## 3. Correo SMTP

El ingreso exige un código por correo y las cuentas se activan con una invitación: sin SMTP nadie entra.

| Proveedor | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` / `SMTP_PASSWORD` | Límite gratuito |
|---|---|---|---|---|
| **Gmail** | `smtp.gmail.com` | `587` | su Gmail / una **contraseña de aplicación** (exige verificación en 2 pasos) | ~500/día |
| **Brevo** | `smtp-relay.brevo.com` | `587` | usuario y clave SMTP de *SMTP & API* (verifique el remitente) | 300/día |

Con Gmail, `SMTP_FROM` debe ser la misma cuenta: `DomusApp <sucorreo@gmail.com>`. Para producción con muchos
condominios conviene un dominio propio con SPF/DKIM en Brevo, Amazon SES o similar.

## 4. Preparar el servidor (una vez)

```bash
ssh ubuntu@<IP>
curl -fsSL https://raw.githubusercontent.com/jcarmonabel23/DomusApp/main/scripts/deploy/setup-server.sh | BRANCH=main sh   # qa: BRANCH=qa
exit        # salir y volver a entrar para usar docker sin sudo
```

Instala Docker y git, abre 80/443 en el `iptables` de Ubuntu (las imágenes de Oracle lo traen cerrado) y clona
el repositorio en `~/DomusApp` en la rama del ambiente.

## 5. Configurar y desplegar

```bash
ssh ubuntu@<IP>
cd ~/DomusApp
cp .env.production.example .env.production
for i in 1 2 3 4 5; do openssl rand -hex 32; done      # secretos para los campos «CAMBIAR-openssl…»
nano .env.production                                    # reemplazar TODOS los «CAMBIAR»
sh scripts/deploy/deploy.sh
```

- `deploy.sh` se niega a correr si queda algún `CAMBIAR`, si `APP_ENVIRONMENT` no es `qa` o `prod`, o si se
  intenta desplegar producción desde una rama que no es `main`.
- La API también revisa la configuración al arrancar y, en qa o prod, **no levanta** si encuentra la cookie sin
  HTTPS, una URL `http://`, secretos del ejemplo, Mailpit como correo o, en prod, datos de demostración o la
  pasarela simulada. El motivo queda en `logs api`.
- Al terminar, abra `https://<DOMAIN>`, entre con `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD`, escriba el código
  que llega al correo y cambie la contraseña. Luego cree el primer condominio y su administrador.

> Guarde `.env.production` fuera del servidor (gestor de contraseñas): sin `POSTGRES_PASSWORD` y
> `APP_DB_PASSWORD` no se pueden restaurar los respaldos en otro servidor. Nunca lo suba a GitHub.

**Pagos con tarjeta.** Con `PAYMENT_GATEWAY=none` (lo indicado en producción hasta conectar una pasarela real)
la app no ofrece el pago con tarjeta y los residentes reportan sus transferencias; el panel lo advierte en
*Finanzas → Configuración*. En qa puede usar `simulated` para probar el flujo con las tarjetas de prueba.

## 6. Despliegue automático desde las ramas

`.github/workflows/deploy.yml` despliega solo cuando la CI pasa en un push a `qa` (→ servidor de qa) o a `main`
(→ producción). Configúrelo en *GitHub → Settings → Environments*, creando `qa` y `prod` con:

| Tipo | Nombre | Valor |
|---|---|---|
| secret | `SSH_HOST` | IP o dominio del servidor |
| secret | `SSH_USER` | `ubuntu` |
| secret | `SSH_KEY` | llave privada de un par creado para el despliegue (`ssh-keygen -t ed25519 -f domus_deploy`); la pública va en `~/.ssh/authorized_keys` del servidor |
| secret | `SSH_KNOWN_HOSTS` | salida de `ssh-keyscan <IP>` (así GitHub verifica que habla con su servidor) |
| variable | `APP_URL` | `https://<dominio>` (solo para mostrar el enlace) |

En `prod` active **Required reviewers**: cada despliegue a producción espera la aprobación de alguien. Sin
`SSH_HOST` el trabajo se salta, así que el repositorio funciona igual antes de tener servidores. También se puede
lanzar a mano desde *Actions → Deploy → Run workflow*.

El flujo de trabajo es: desarrollo en `dev` → PR a `qa` (se publica en qa y se prueba) → PR a `main` (producción).

## 7. Operación

Prefijo de los comandos (en `~/DomusApp`): `C="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production"`

| Tarea | Comando |
|---|---|
| Actualizar a lo último de la rama | `sh scripts/deploy/deploy.sh` (deja un respaldo en `backups/predeploy`) |
| Registros | `$C logs -f api caddy` |
| Estado | `$C ps` |
| Restaurar la BD | `sh scripts/deploy/restore.sh backups/daily/domusapp-AAAAMMDD.sql.gz` (o un `.dump` de `predeploy`) |
| Restaurar los archivos | `$C stop api` y `docker run --rm -v domusapp_uploads:/u -v $PWD/backups/uploads:/b alpine sh -c "rm -rf /u/* && tar xzf /b/uploads-AAAAMMDD.tar.gz -C /u"`, luego `$C up -d` |
| Copiar los respaldos fuera | `scp -r ubuntu@<IP>:~/DomusApp/backups .` |

Respaldos automáticos en `./backups`: la BD a diario (7 días, 4 semanas, 6 meses) y los archivos subidos a diario
(14 días). Cópielos fuera del servidor con regularidad: si se pierde la máquina, se pierden con ella.

**Nunca** use `down -v` en publicación: borra la base de datos, los archivos y los certificados.

## 8. App móvil: builds y tiendas

Requisitos: cuenta de [Expo](https://expo.dev) (el proyecto ya existe: `owner` y `projectId` en `apps/mobile/app.json`),
`npm i -g eas-cli`, y para publicar, **Google Play Console** (pago único) y **Apple Developer Program** (anual).

**URL del servidor por ambiente** (una vez; el build falla si falta, y en producción exige `https://`):

```bash
cd apps/mobile
eas login
eas env:create --environment preview    --name EXPO_PUBLIC_API_URL --value https://<dominio-de-qa>   --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<dominio-de-prod> --visibility plaintext
```

**Notificaciones push.** Android: cree un proyecto en Firebase, descargue la clave de cuenta de servicio (FCM v1) y
súbala con `eas credentials -p android`. iOS: EAS crea la clave de APNs en el primer build. En el servidor,
`EXPO_PUSH_ENABLED=true`.

| Paso | Comando | Resultado |
|---|---|---|
| Prueba interna (qa) | `eas build -p android --profile preview` | APK de "DomusApp (prueba)" para instalar con el enlace; habla con qa |
| Build de tienda | `eas build -p all --profile production` | AAB (Android) e IPA (iOS) contra producción; la versión de compilación sube sola |
| Enviar a Google Play | `eas submit -p android --profile production` | Pista de **prueba interna** como borrador. La **primera** subida de una app nueva se hace a mano en Play Console |
| Enviar a App Store | `eas submit -p ios --profile production` | Queda en TestFlight; desde App Store Connect se manda a revisión |

Antes de enviar a revisión, en cada tienda:

- **Política de privacidad**: `https://<dominio-de-prod>/privacidad` (la sirve el panel con el correo
  `SUPPORT_EMAIL`; también está en la app, en *Mi condominio*). Revísela con su asesor legal.
- **Eliminación de cuenta**: la misma página explica cómo pedirla (Google Play pide ese enlace).
- **Seguridad de los datos** (Play) y **etiquetas de privacidad** (Apple): datos personales, fotos, identificadores
  del dispositivo para push; nada se usa para publicidad ni rastreo; todo viaja cifrado.
- **Cuenta para el revisor**: las tiendas piden un usuario de prueba. El ingreso exige un código por correo, así
  que cree un condominio de demostración en producción con un correo que usted revise y esté atento a la revisión
  para pasarles el código, o explíquelo en las notas para el revisor.
- **Versión visible**: `version` en `apps/mobile/app.json` (p. ej. `1.0.0`); súbala en cada publicación.

## 9. Más adelante: cambiar a un dominio propio

1. Registro `A` del dominio hacia la IP del servidor.
2. En `.env.production`: `DOMAIN=app.sudominio.com` y `APP_PUBLIC_URL=https://app.sudominio.com`.
3. `sh scripts/deploy/deploy.sh`. Caddy saca el certificado nuevo solo.
4. Actualice `EXPO_PUBLIC_API_URL` en EAS y publique un build nuevo: las apps instaladas siguen usando la URL
   con la que se compilaron, así que mantenga el dominio anterior apuntando al servidor hasta que todos actualicen.
