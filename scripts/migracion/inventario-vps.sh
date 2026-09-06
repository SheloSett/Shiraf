#!/usr/bin/env bash
# Inventario del VPS ANTES de migrar. Sólo lee: no cambia nada.
#
# Uso desde tu máquina (imprime todo por pantalla):
#     ssh shelo@177.7.59.16 'bash -s' < scripts/migracion/inventario-vps.sh
#
# O para guardarlo en un archivo:
#     ssh shelo@177.7.59.16 'bash -s' < scripts/migracion/inventario-vps.sh > inventario-vps-viejo.txt
#
# La idea es que NADA del servidor viejo se quede sin lista: contenedores,
# volúmenes, sitios de nginx, certificados, crons, firewall, otros proyectos.
# Lo que no está en la lista no se migra, y lo que no se migra se pierde.

t() { echo; echo "════════ $* ════════"; }

t "HOST"
hostname; grep -E '^(PRETTY_NAME|VERSION_ID)' /etc/os-release; uname -r; uptime
echo "usuario: $(whoami)  sudo sin password: $(sudo -n true 2>/dev/null && echo sí || echo no)"

t "DISCO Y MEMORIA"
df -h / /home 2>/dev/null | sort -u; free -h

t "USUARIOS CON HOME"
ls -la /home

t "DOCKER"
docker --version; docker compose version
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

t "PROYECTOS DE COMPOSE (carpeta de cada uno)"
docker ps -a --format '{{.Names}}' | while read -r c; do
  printf '%-28s %s\n' "$c" "$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
done

t "VOLÚMENES (con tamaño)"
docker system df -v 2>/dev/null | sed -n '/^Local Volumes/,/^$/p'

t "IMÁGENES"
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'

t "NGINX"
nginx -v 2>&1
echo "-- sites-enabled:"; ls -la /etc/nginx/sites-enabled 2>/dev/null
echo "-- conf.d:"; ls -la /etc/nginx/conf.d 2>/dev/null
echo "-- server_name / proxy_pass:"
sudo grep -RhE 'server_name|proxy_pass|listen' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sed 's/^[ \t]*//' | sort -u

t "CERTIFICADOS (certbot)"
sudo certbot certificates 2>/dev/null || echo "certbot no instalado o sin permisos"
echo "-- timers de renovación:"; systemctl list-timers 2>/dev/null | grep -i certbot

t "CRONS"
echo "-- $(whoami):"; crontab -l 2>/dev/null || echo "(vacío)"
echo "-- root:"; sudo crontab -l 2>/dev/null || echo "(vacío o sin permisos)"
echo "-- /etc/cron.d:"; ls -la /etc/cron.d 2>/dev/null

t "SERVICIOS SYSTEMD PROPIOS (no del sistema)"
systemctl list-unit-files --type=service --state=enabled 2>/dev/null | grep -viE 'systemd|dbus|getty|ssh|cron|networkd|resolved|rsyslog|apparmor|snapd|cloud|ufw|unattended|apt|polkit|multipathd|qemu|open-vm|lvm|blk|e2scrub|docker|containerd|nginx|fail2ban'

t "FIREWALL"
sudo ufw status verbose 2>/dev/null || echo "ufw no instalado"
echo "-- fail2ban:"; sudo fail2ban-client status 2>/dev/null || echo "fail2ban no instalado"

t "PUERTOS ESCUCHANDO"
sudo ss -tlnp 2>/dev/null || ss -tln

t "SSH: claves autorizadas y config"
echo "authorized_keys de $(whoami): $(wc -l < ~/.ssh/authorized_keys 2>/dev/null || echo 0) claves"
sudo grep -E '^(PasswordAuthentication|PermitRootLogin|Port)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null

t "SHIRAF: repo"
cd ~/shiraf 2>/dev/null && {
  git remote -v | head -1; git branch --show-current; git log --oneline -1; git status --short | head
  echo "-- dueño de .git (el bug del pull):"; stat -c '%U:%G' .git .git/objects
  echo "-- .env (sólo nombres de variables):"; grep -oE '^[A-Z_]+' .env | sort
  echo "-- backups:"; ls -la backups 2>/dev/null | tail -n +2
  echo "-- perfiles activos (¿whatsapp?):"; docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null
} || echo "no existe ~/shiraf"

t "SHIRAF: base de datos"
docker exec shiraf-db psql -U shiraf -d shiraf -tAc "
  select 'tamaño: ' || pg_size_pretty(pg_database_size('shiraf'));
  select 'versión: ' || version();
  select rpad(table_name,32) || count from (
    select c.relname as table_name, c.reltuples::bigint as count
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by 1) t;" 2>/dev/null || echo "no pude consultar shiraf-db"

t "OTRAS CARPETAS EN EL HOME (otros proyectos)"
ls -la ~ | grep -vE '^\.|\.\w+$' 
echo "-- carpetas con docker-compose fuera de shiraf:"
find ~ /opt /srv /var/www -maxdepth 3 \( -name 'docker-compose*.yml' -o -name 'compose*.yml' \) -not -path '*/node_modules/*' -not -path '*/shiraf/*' 2>/dev/null

t "FIN"
