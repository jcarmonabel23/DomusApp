#!/bin/sh
# =====================================================================
#  DomusApp · despliegue / actualización en el servidor (qa o prod)
#    sh scripts/deploy/deploy.sh            trae lo último de la rama y levanta
#    sh scripts/deploy/deploy.sh --no-pull  levanta lo que ya está en disco
#  Reconstruye y levanta en modo publicación. Los datos (volúmenes de la BD y de archivos,
#  certificados de Caddy y ./backups) se conservan; las migraciones nuevas se aplican solas.
#  Antes de actualizar deja un respaldo de la BD en ./backups/predeploy.
# =====================================================================
set -e
cd "$(dirname "$0")/../.."

ENV_FILE=.env.production
if [ ! -f "$ENV_FILE" ]; then
  echo "✘ Falta $ENV_FILE (cp .env.production.example $ENV_FILE y complételo)"
  exit 1
fi
if grep -q "CAMBIAR" "$ENV_FILE"; then
  echo "✘ $ENV_FILE todavía tiene valores «CAMBIAR»:"
  grep -n "CAMBIAR" "$ENV_FILE"
  exit 1
fi
chmod 600 "$ENV_FILE"

value() { grep "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }
ENVIRONMENT=$(value APP_ENVIRONMENT)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$ENVIRONMENT" in
  qa) [ "$BRANCH" = "qa" ] || echo "⚠ APP_ENVIRONMENT=qa pero la rama es $BRANCH" ;;
  prod) [ "$BRANCH" = "main" ] || { echo "✘ Producción se despliega solo desde main (rama actual: $BRANCH)"; exit 1; } ;;
  *) echo "✘ APP_ENVIRONMENT debe ser qa o prod (es «$ENVIRONMENT»)"; exit 1 ;;
esac

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file $ENV_FILE"

if [ "$1" != "--no-pull" ]; then
  echo "▶ Actualizando el código ($BRANCH)…"
  git pull --ff-only
fi

# Respaldo previo (si la BD ya existe): permite volver atrás si una migración sale mal
if $COMPOSE ps --status running db 2>/dev/null | grep -q domus-db; then
  mkdir -p backups/predeploy
  STAMP=$(date +%Y%m%d-%H%M%S)
  echo "▶ Respaldando la BD en backups/predeploy/$STAMP.dump…"
  $COMPOSE exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z6' > "backups/predeploy/$STAMP.dump"
  ls -1t backups/predeploy/*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f   # conserva los 10 últimos
fi

echo "▶ Construyendo y levantando…"
$COMPOSE up -d --build --remove-orphans --wait
docker image prune -f >/dev/null

$COMPOSE ps
DOMAIN=$(value DOMAIN)
echo
if curl -fsS --max-time 20 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
  echo "✔ DomusApp ($ENVIRONMENT) en https://$DOMAIN"
else
  echo "… DomusApp ($ENVIRONMENT) levantado; https://$DOMAIN aún no responde (el primer certificado puede tardar un minuto)"
fi
echo "   Registros:  $COMPOSE logs -f api caddy"
