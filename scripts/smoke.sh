#!/bin/sh
# =====================================================================
#  DomusApp · scripts/smoke.sh
#  Pruebas de humo contra el stack levantado (docker compose up -d).
#  Pasa por el panel (WEB_PORT), igual que el navegador y la app móvil.
# =====================================================================
set -eu
cd "$(dirname "$0")/.."
PORT=$(grep '^WEB_PORT=' .env | cut -d= -f2-)
BASE="http://localhost:${PORT:-8090}"
fail=0

check() { # nombre, comando
  if sh -c "$2" >/dev/null 2>&1; then echo "  ✓ $1"; else echo "  ✗ $1"; fail=1; fi
}

echo "════════ Fase 0 · base ($BASE)"
check "panel responde /health"                 "curl -fsS $BASE/health | grep -q '\"ok\"'"
check "SPA del panel (fallback a index.html)"  "curl -fsS $BASE/dashboard | grep -q '<div id=\"root\">'"
check "proxy /api → API con BD"                "curl -fsS $BASE/api/v1/meta/status | grep -q '\"ok\":true'"
check "error uniforme (sin sesión → 401)"      "curl -sS $BASE/api/v1/no-existe | grep -q '\"code\":\"TOKEN_MISSING\"'"
check "trace id en la respuesta"               "curl -sSI $BASE/api/v1/meta/status | grep -qi '^x-trace-id:'"
check "CSP estricta en el panel"               "curl -sSI $BASE/ | grep -qi '^content-security-policy:'"
check "la API no se publica al host (:4000)"   "! curl -fsS --max-time 2 http://localhost:4000/health"

echo
MAILPIT_PORT=$(grep '^MAILPIT_UI_PORT=' .env | cut -d= -f2- || true)
DEMO_PASSWORD=$(grep '^DEMO_PASSWORD=' .env | cut -d= -f2- || true)
BASE="$BASE" MAILPIT="http://127.0.0.1:${MAILPIT_PORT:-8026}" DEMO_PASSWORD="$DEMO_PASSWORD" node scripts/smoke/fase1.mjs || fail=1
echo
BASE="$BASE" MAILPIT="http://127.0.0.1:${MAILPIT_PORT:-8026}" DEMO_PASSWORD="$DEMO_PASSWORD" node scripts/smoke/fase2.mjs || fail=1
echo
BASE="$BASE" MAILPIT="http://127.0.0.1:${MAILPIT_PORT:-8026}" DEMO_PASSWORD="$DEMO_PASSWORD" node scripts/smoke/fase3.mjs || fail=1
echo
BASE="$BASE" MAILPIT="http://127.0.0.1:${MAILPIT_PORT:-8026}" DEMO_PASSWORD="$DEMO_PASSWORD" node scripts/smoke/fase5.mjs || fail=1
echo
BASE="$BASE" MAILPIT="http://127.0.0.1:${MAILPIT_PORT:-8026}" DEMO_PASSWORD="$DEMO_PASSWORD" node scripts/smoke/fase6.mjs || fail=1
echo
BASE="$BASE" MAILPIT="http://127.0.0.1:${MAILPIT_PORT:-8026}" DEMO_PASSWORD="$DEMO_PASSWORD" node scripts/smoke/fase7.mjs || fail=1
echo
BASE="$BASE" MAILPIT="http://127.0.0.1:${MAILPIT_PORT:-8026}" DEMO_PASSWORD="$DEMO_PASSWORD" node scripts/smoke/fase8.mjs || fail=1

[ "$fail" -eq 0 ] && echo "Todo bien." || { echo "Hay fallas."; exit 1; }
