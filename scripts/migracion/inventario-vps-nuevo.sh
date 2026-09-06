#!/usr/bin/env bash
# Inventario del VPS NUEVO, centrado en el Caddy que ya está sirviendo los
# proyectos del padre de Shelo. Sólo lee. Shiraf tiene que entrar por ese
# Caddy, así que hay que ver cómo está configurado y en qué red de Docker vive.
#
#   Get-Content scripts\migracion\inventario-vps-nuevo.sh -Raw | ssh shelo@82.25.74.242 'bash -s'

t() { echo; echo "════════ $* ════════"; }

t "HOST"
hostname; grep -E '^PRETTY_NAME' /etc/os-release; nproc; free -h | sed -n '1,2p'; df -h / | tail -1
echo "grupos de $(whoami): $(id -Gn)"

t "CONTENEDORES"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

t "CARPETA DE COMPOSE DE CADA UNO"
docker ps -a --format '{{.Names}}' | while read -r c; do
  printf '%-22s %s\n' "$c" "$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
done

t "REDES DE DOCKER y quién está en cada una"
for n in $(docker network ls --format '{{.Name}}' | grep -vE '^(bridge|host|none)$'); do
  echo "-- $n: $(docker network inspect "$n" --format '{{range .Containers}}{{.Name}} {{end}}')"
done

t "EL PROXY (caddy): montajes y redes"
docker inspect proxy --format '{{range .Mounts}}{{.Type}}  {{.Source}}  ->  {{.Destination}}{{println}}{{end}}'
docker inspect proxy --format '{{range $k,$v := .NetworkSettings.Networks}}red: {{$k}}{{println}}{{end}}'

t "CADDYFILE"
CADDYFILE=$(docker inspect proxy --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
if [ -n "$CADDYFILE" ] && [ -r "$CADDYFILE" ]; then
  echo "($CADDYFILE)"; cat "$CADDYFILE"
elif [ -n "$CADDYFILE" ]; then
  echo "($CADDYFILE, leído con sudo)"; sudo cat "$CADDYFILE"
else
  echo "no está montado como archivo; lo que Caddy tiene cargado:"
  docker exec proxy cat /etc/caddy/Caddyfile 2>/dev/null || docker exec proxy wget -qO- http://localhost:2019/config/ 2>/dev/null
fi

t "COMPOSE DEL PROXY"
DIR=$(docker inspect proxy --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
echo "($DIR)"; ls -la "$DIR" 2>/dev/null
for f in "$DIR"/docker-compose.yml "$DIR"/compose.yml "$DIR"/docker-compose.yaml "$DIR"/compose.yaml; do
  [ -f "$f" ] && { echo "-- $f:"; cat "$f"; }
done

t "CÓMO ESTÁ CONECTADO UNO DE LOS SITIOS DEL PADRE (para copiar el esquema)"
docker inspect shuk-sitio --format '{{range $k,$v := .NetworkSettings.Networks}}red: {{$k}}{{println}}{{end}}puertos publicados: {{json .HostConfig.PortBindings}}{{println}}' 2>/dev/null

t "CERTIFICADOS QUE CADDY YA EMITIÓ"
docker exec proxy sh -c 'ls -R /data/caddy/certificates 2>/dev/null | grep -E "\.crt$"' 2>/dev/null || echo "(no se pudo listar)"

t "PUERTOS ESCUCHANDO"
sudo ss -tlnp | awk 'NR==1 || /LISTEN/' | sed -E 's/ +/ /g' | cut -c1-120

t "NGINX DEL APT (instalado por 01-preparar; no puede arrancar porque Caddy tiene el 80)"
systemctl is-enabled nginx 2>/dev/null; systemctl is-active nginx 2>/dev/null

t "HOME"
ls -la ~

t "FIN"
