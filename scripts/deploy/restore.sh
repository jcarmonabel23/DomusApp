#!/bin/sh
# =====================================================================
#  DomusApp · restaurar un respaldo de la BD en el servidor
#    sh scripts/deploy/restore.sh backups/daily/domusapp-20261201.sql.gz     (respaldo diario)
#    sh scripts/deploy/restore.sh backups/predeploy/20261201-101500.dump     (respaldo previo a un despliegue)
#  Detiene la API, reemplaza la BD completa por la del respaldo y vuelve a levantar.
#  Los archivos subidos se restauran aparte: backups/uploads/uploads-AAAAMMDD.tar.gz (ver DEPLOY.md).
# =====================================================================
set -e
cd "$(dirname "$0")/../.."

FILE="$1"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Uso: sh scripts/deploy/restore.sh <archivo de respaldo>"
  ls -1t backups/daily backups/predeploy 2>/dev/null | head -n 20
  exit 1
fi

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production"
printf "Esto REEMPLAZA la base de datos actual por %s. Escriba RESTAURAR para seguir: " "$FILE"
read -r answer
[ "$answer" = "RESTAURAR" ] || { echo "Cancelado"; exit 1; }

echo "▶ Deteniendo la API, el panel y los respaldos…"
$COMPOSE stop api admin backup

echo "▶ Restaurando…"
case "$FILE" in
  *.dump | *.sql.gz)
    # Ambos formatos son pg_dump -Fc (el contenedor de respaldos usa -Fc aunque el nombre diga .sql.gz)
    $COMPOSE exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --role="$POSTGRES_USER" --exit-on-error' < "$FILE" ;;
  *) echo "✘ Formato no reconocido: $FILE"; exit 1 ;;
esac

echo "▶ Levantando…"
$COMPOSE up -d --wait
echo "✔ Restaurado desde $FILE"
