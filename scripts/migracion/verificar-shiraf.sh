#!/usr/bin/env bash
# Foto de Shiraf en el servidor donde se corre: contenedores, tamaño de la base,
# filas exactas por tabla, triggers, y si el sitio responde. Sólo lee.
#
# Se corre en los DOS servidores y se comparan las salidas. La última línea es
# una huella de los conteos: si coincide en los dos, la base es la misma.
#
#   ssh shelo@177.7.59.16  'bash -s' < scripts/migracion/verificar-shiraf.sh
#   ssh shelo@82.25.74.242 'bash -s' < scripts/migracion/verificar-shiraf.sh
#
# En PowerShell el `<` no existe; es:
#   Get-Content scripts\migracion\verificar-shiraf.sh -Raw | ssh shelo@IP 'bash -s'

echo "════ $(hostname)  $(date -u '+%F %T UTC') ════"
docker ps -a --filter name=shiraf --format '{{.Names}}\t{{.Status}}'
echo
# Sin `-i` y con la entrada cerrada: el script entero le llega a bash por
# stdin (`bash -s`), y un `docker exec -i` acá adentro se lo TRAGA como si
# fuera la entrada de psql. Pasó el 6/9/2026: la salida se cortaba después de
# la primera consulta. El único que necesita stdin es el de los conteos, que
# recibe la consulta por un pipe y por eso lleva su propio `docker exec -i`.
psql() { docker exec shiraf-db psql -U shiraf -d shiraf -tA "$@" < /dev/null; }
psql -c "select 'tamaño: '||pg_size_pretty(pg_database_size('shiraf'))"
psql -c "select 'triggers: '||count(*) from information_schema.triggers where trigger_schema='public'"
psql -c "select 'índices: '||count(*) from pg_indexes where schemaname='public'"
echo "-- filas por tabla (count exacto):"
# El primer psql escribe la consulta (un count por tabla); el segundo la ejecuta.
CONTEOS=$(psql -c "select string_agg(format('select %L as t, count(*) as n from %I', table_name, table_name), ' union all ' order by table_name) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" | docker exec -i shiraf-db psql -U shiraf -d shiraf -tA -F $'\t')
echo "$CONTEOS" | column -t
echo "-- lo más reciente (para ver que no falte lo último que se cargó):"
psql -c "select 'último turno creado:   '||coalesce(max(created_at)::text,'-') from appointments"
psql -c "select 'último usuario creado: '||coalesce(max(created_at)::text,'-') from users"
echo
curl -s -o /dev/null -w "sitio en 127.0.0.1:3000 → HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "sitio en 3000: no responde"
echo "HUELLA DE LOS CONTEOS: $(echo "$CONTEOS" | md5sum | cut -c1-12)"
