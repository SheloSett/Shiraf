#!/usr/bin/env bash
# Segunda parte del inventario: lo que necesita root. Sólo lee.
#
# El primer script (inventario-vps.sh) se quedó sin estas secciones porque
# `sudo` pide contraseña y por un pipe no se puede tipear. Éste se copia al
# servidor y se corre con una terminal de verdad, así sudo puede preguntar:
#
#   scp scripts/migracion/inventario-sudo.sh shelo@177.7.59.16:~/
#   ssh -t shelo@177.7.59.16 "sudo bash ~/inventario-sudo.sh | tee ~/inventario-sudo.txt"
#   scp shelo@177.7.59.16:~/inventario-sudo.txt .
#
# ⚠️ La salida incluye la configuración completa de nginx. No tiene secretos,
#    pero tampoco va al repo: está en .gitignore.

t() { echo; echo "════════ $* ════════"; }

t "NGINX: configuración completa de cada sitio"
for f in /etc/nginx/sites-enabled/*; do
  echo; echo "──── $f ────"; cat "$(readlink -f "$f")"
done
echo; echo "── nginx.conf (por si hay algo global) ──"; grep -vE '^\s*(#|$)' /etc/nginx/nginx.conf

t "CERTIFICADOS"
certbot certificates 2>&1
echo "-- cómo renueva (hook / authenticator):"
grep -RhE 'authenticator|installer|renew_hook|pre_hook|post_hook' /etc/letsencrypt/renewal/ 2>/dev/null | sort -u

t "CRON DE ROOT"
crontab -l 2>/dev/null || echo "(vacío)"
echo "-- /etc/cron.d/docker-builder-prune:"; cat /etc/cron.d/docker-builder-prune 2>/dev/null

t "SSHD"
grep -RhE '^(PasswordAuthentication|PermitRootLogin|Port|PubkeyAuthentication)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null

t "POSTGRES DEL HOST (postgresql.service, puerto 5432 fuera de docker)"
systemctl is-active postgresql; 
sudo -u postgres psql -tAc "select datname || '  ' || pg_size_pretty(pg_database_size(datname)) from pg_database where not datistemplate" 2>&1

t "PM2 (pm2-shelo.service)"
systemctl is-active pm2-shelo
sudo -u shelo bash -lc 'pm2 ls 2>/dev/null; pm2 jlist 2>/dev/null | grep -oE "\"(name|cwd|script|pm_exec_path)\":\"[^\"]*\"" | sort -u'

t "QUÉ ESCUCHA EN CADA PUERTO (con proceso)"
ss -tlnp | awk 'NR==1 || /LISTEN/' | sed -E 's/ +/ /g'

t "VOLÚMENES DE DOCKER con tamaño"
docker system df -v --format '{{range .Volumes}}{{.Name}}\t{{.Size}}\t{{.Links}} contenedores{{"\n"}}{{end}}' 2>/dev/null || docker volume ls

t "DOCKER: disco total"
docker system df

t "/opt (manhattan vive ahí)"
ls -la /opt /opt/inmobiliaria-manhattan 2>/dev/null
echo "-- .env de manhattan (sólo nombres):"; grep -oE '^[A-Z_]+' /opt/inmobiliaria-manhattan/.env 2>/dev/null | sort

t "FIN"
