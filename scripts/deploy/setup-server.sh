#!/bin/sh
# =====================================================================
#  DomusApp · preparación del servidor (Ubuntu 24.04, x86 o ARM). Se corre UNA vez por servidor:
#    curl -fsSL https://raw.githubusercontent.com/jcarmonabel23/DomusApp/main/scripts/deploy/setup-server.sh | BRANCH=main sh
#  o, si ya clonó el repositorio:   BRANCH=qa sh scripts/deploy/setup-server.sh
#
#  BRANCH elige el ambiente: qa → servidor de pruebas, main → producción (por defecto main).
#  1. Actualiza el sistema e instala Docker (repositorio oficial) y git.
#  2. Abre 80/443 en el firewall de Ubuntu. Las imágenes de Oracle Cloud traen iptables que rechazan
#     todo menos el SSH; en otros proveedores la regla no estorba. (También hay que abrirlos en el
#     firewall del proveedor: Security List en Oracle, Security Group en AWS…)
#  3. Clona el repositorio en ~/DomusApp en la rama elegida.
# =====================================================================
set -e

REPO="${REPO:-https://github.com/jcarmonabel23/DomusApp.git}"
BRANCH="${BRANCH:-main}"
DIR="$HOME/DomusApp"

echo "▶ Actualizando el sistema…"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates openssl iptables-persistent

if ! command -v docker >/dev/null 2>&1; then
  echo "▶ Instalando Docker…"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

echo "▶ Abriendo 80/443 en iptables…"
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  # shellcheck disable=SC2086
  sudo iptables -C INPUT $rule -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 $rule -j ACCEPT
done
sudo netfilter-persistent save

if [ ! -d "$DIR/.git" ]; then
  echo "▶ Clonando $REPO ($BRANCH)…"
  git clone --branch "$BRANCH" "$REPO" "$DIR"
fi

echo
echo "✔ Servidor listo (rama $BRANCH). Siguiente paso:"
echo "   1. Cierre la sesión SSH y vuelva a entrar (para usar docker sin sudo)."
echo "   2. cd ~/DomusApp && cp .env.production.example .env.production && nano .env.production"
echo "   3. sh scripts/deploy/deploy.sh"
