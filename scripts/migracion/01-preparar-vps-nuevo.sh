#!/usr/bin/env bash
# Prepara el VPS NUEVO (82.25.74.242) desde cero. Se corre UNA vez, con sudo.
#
# El 6/9/2026 se comprobó que el nuevo ya viene con el usuario `shelo`, la
# clave id_ed25519 autorizada y el login por contraseña apagado (lo hizo el
# panel de Hostinger al crearlo). Por eso se entra como shelo y se eleva:
#
#   scp scripts/migracion/01-preparar-vps-nuevo.sh shelo@82.25.74.242:~/
#   ssh -t shelo@82.25.74.242 "sudo bash ~/01-preparar-vps-nuevo.sh"
#
# Los pasos de usuario y clave quedan igual: si ya están, no hacen nada.
#
# Deja el servidor igual que el viejo en lo que importa: usuario `shelo` con la
# misma clave SSH, Docker con compose, nginx, certbot y —esto el viejo NO lo
# tiene— un firewall que sólo deja pasar 22, 80 y 443.
#
# Es idempotente: se puede volver a correr si algo cortó a la mitad.
#
# ⚠️ NO desactiva el login por contraseña. Eso se hace a mano DESPUÉS de
#    comprobar que `ssh shelo@82.25.74.242` entra con la clave. Si se apaga
#    antes y la clave falla, el servidor queda sin puerta.
set -euo pipefail

USUARIO=shelo
# La misma clave pública que ya está autorizada en el VPS viejo (id_ed25519).
CLAVE_PUBLICA='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKdSjBw3kNmCYCwhCQ/YuDiWzvPSuQsjGCt5uNtrHRXO shelo@igwtstore'

paso() { echo; echo "──── $* ────"; }

[ "$(id -u)" -eq 0 ] || { echo "correr como root"; exit 1; }
. /etc/os-release
echo "Sistema: $PRETTY_NAME"
case "${ID:-}" in ubuntu|debian) ;; *) echo "Este script espera Ubuntu/Debian"; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive

paso "1. Paquetes del sistema al día"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg git ufw fail2ban nginx certbot python3-certbot-nginx unattended-upgrades rsync

paso "2. Usuario $USUARIO con sudo y la clave SSH"
if ! id "$USUARIO" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USUARIO"
fi
usermod -aG sudo "$USUARIO"
install -d -m 700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
touch "/home/$USUARIO/.ssh/authorized_keys"
grep -qF "$CLAVE_PUBLICA" "/home/$USUARIO/.ssh/authorized_keys" || echo "$CLAVE_PUBLICA" >> "/home/$USUARIO/.ssh/authorized_keys"
chmod 600 "/home/$USUARIO/.ssh/authorized_keys"; chown -R "$USUARIO:$USUARIO" "/home/$USUARIO/.ssh"
# sudo sin contraseña para shelo: en el viejo pedía contraseña y eso trabó la
# mitad del inventario. Si preferís que la pida, borrá este archivo.
echo "$USUARIO ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$USUARIO; chmod 440 /etc/sudoers.d/90-$USUARIO

paso "3. Docker Engine + compose (repo oficial, mismo método que DOCKER.md)"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$USUARIO"
systemctl enable --now docker
docker --version; docker compose version

paso "4. Firewall: sólo SSH, HTTP y HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

paso "5. fail2ban para el SSH (config mínima)"
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
JAIL
systemctl enable --now fail2ban

paso "6. nginx arriba y certbot con su timer"
systemctl enable --now nginx
systemctl list-timers | grep -i certbot || echo "⚠️ no aparece certbot.timer"

paso "7. Zona horaria y swap"
# El viejo corre en UTC y los backups salen 23:59 UTC. Se mantiene igual para
# que los horarios de cron y de la rotación no cambien de significado.
timedatectl set-timezone UTC
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

paso "LISTO"
echo "Ahora, DESDE TU MÁQUINA, comprobá que entra con la clave:"
echo "    ssh $USUARIO@$(hostname -I | awk '{print $1}')"
echo "Recién cuando eso ande, se apaga el login por contraseña (paso aparte)."
