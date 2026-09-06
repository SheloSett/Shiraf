# Migración del VPS viejo al nuevo

Decidido el 6/9/2026: **se mudan los tres sitios y el viejo se da de baja,
pero de a uno.** Shiraf primero porque es el más simple; manhattan después;
el ecommerce último porque hay que ordenarlo antes (ver al final).

|        | Viejo                      | Nuevo                            |
| ------ | -------------------------- | -------------------------------- |
| IP     | `177.7.59.16` (srv1745446) | `82.25.74.242` (Hostinger KVM 4) |
| Entrar | `ssh shelo@177.7.59.16`    | `ssh shelo@82.25.74.242`         |
| Shiraf | `/home/shelo/shiraf`       | `/home/shelo/shiraf`             |
| Proxy  | nginx + certbot en el host | **Caddy** en contenedor, `/srv/proxy` |

Los dos servidores sólo aceptan la clave `id_ed25519`, que tiene passphrase:
cada `ssh`/`scp` la pide. Es molesto y es correcto. En el nuevo `sudo` no
pide contraseña; en el viejo sí.

**Todos los comandos son para PowerShell en tu máquina**, desde la carpeta del
proyecto (`cd C:\Users\shelo\Desktop\workspace\shiraf\Shiraf`). Los archivos
de paso caen en `C:\Users\shelo\migracion-vps`, que tiene el `.env` y volcados
con datos de clientas: **cuando termine todo, se borra.**

La regla de toda la migración: **el viejo no se apaga ni se borra hasta que el
nuevo lleve al menos dos semanas andando.** Es el único rollback.

---

## Lo que hay en el viejo (inventario del 6/9/2026)

Salió de `scripts/migracion/inventario-vps.sh` e `inventario-sudo.sh`. Las
salidas completas están en `inventario-vps-viejo.txt` e `inventario-sudo.txt`
(fuera del repo).

- **Shiraf**: 3 contenedores (`shiraf-app`, `shiraf-db`, `shiraf-backup`), un
  volumen (`shiraf_shiraf-pgdata`), base de 9 MB, `.env`, backups en
  `~/shiraf/backups`. WhatsApp/Evolution apagado. Repo en `main`, limpio.
- **manhattan**: todo en Docker en `/opt/inmobiliaria-manhattan` (3
  contenedores, volumen `inmobiliaria-manhattan_manhattan_data`, `.env`,
  `DEPLOY.md`). Cron de backup a las 3:30 (`~/scripts/backup-manhattan.sh`).
- **igwtstore (Ecommerce_mm)**: a medias fuera de Docker. nginx manda `/api/`
  a un **Node suelto en el puerto 4000, abierto a internet**, que usa el
  **PostgreSQL instalado en el host** (`ecommerce_db`, 10 MB). El contenedor
  `igwtstore_backend` del 4001 no lo usa nadie. pm2 está vacío: ese Node lo
  arrancó alguien a mano y no vuelve solo después de un reinicio. Cron de
  backup a las 3:00.
- **nginx** con tres sitios y **certbot** renovando con el plugin de nginx.
- **Sin firewall ni fail2ban.**
- 21 GB de caché de build de Docker. No afecta a nada.

## Lo que hay en el nuevo (inventario del 6/9/2026)

Salió de `scripts/migracion/inventario-vps-nuevo.sh` (`inventario-vps-nuevo.txt`).

- Ubuntu 24.04, 4 núcleos, 15 GB de RAM, 193 GB de disco. Docker ya venía.
- **Un Caddy en `/srv/proxy`** (contenedor `proxy`, del usuario `jony`) es el
  único que escucha en 80/443. Reparte por nombre de host a los contenedores
  que estén en la red de Docker **`edge`**, y saca los certificados solo. Cada
  sitio es un archivo en `/srv/proxy/sites/*.caddy`. Ya sirve dos sitios del
  padre (shukmamtakim.com.ar y ohel-moed.com.ar), cada uno también con un
  nombre `*.82-25-74-242.sslip.io` para probar por IP con certificado real.
- Después de Shiraf, manhattan y el ecommerce, va un tercer sitio del padre.
- `01-preparar-vps-nuevo.sh` (paso 1) dejó ufw con 22/80/443, fail2ban, swap
  de 2 GB, y **un nginx que no se usa**: no puede arrancar porque el 80 es de
  Caddy, y quedó deshabilitado. Los certificados los maneja Caddy, no certbot.

**Consecuencia para Shiraf:** no se copia el certificado ni se instala nginx.
La app se une a la red `edge` (con `docker-compose.override.yml`) y se agrega
`shiraf.caddy` al proxy. Y el limitador de login usa `TRUST_PROXY=docker`,
un modo agregado el 6/9/2026 en `loginLimiter.ts`: Caddy le llega desde la
red de Docker y no por loopback, así que el modo `loopback` del viejo no le
creería la IP a nadie.

---

## Shiraf, paso a paso

### Paso 1 — Preparar el nuevo ✅ (hecho el 6/9/2026)

`01-preparar-vps-nuevo.sh` corrió bien. nginx quedó deshabilitado a mano
(`sudo systemctl disable --now nginx`).

### Paso 2 — Clonar el repo y traer lo que el repo no tiene ✅ (6/9/2026)

**2a. El código**, en el nuevo. Se clona `main`, que desde el 6/9/2026 ya
tiene el modo `docker` del limitador (la rama `migracion-vps` se mezcló):

```powershell
ssh shelo@82.25.74.242 "git clone https://github.com/SheloSett/Shiraf.git ~/shiraf && cd ~/shiraf && git log --oneline -1"
```

**2b. El `.env`** (secretos: pasa por tu máquina y no por el repo), y un
cambio: `TRUST_PROXY` pasa de `loopback` a `docker`. El resto queda igual
(`APP_URL`, `APP_BIND=127.0.0.1`, `DB_PORT`, Cloudinary, Brevo):

```powershell
scp shelo@177.7.59.16:~/shiraf/.env C:\Users\shelo\migracion-vps\shiraf.env
(Get-Content C:\Users\shelo\migracion-vps\shiraf.env) -replace '^TRUST_PROXY=.*', 'TRUST_PROXY=docker' | Set-Content -Encoding ascii C:\Users\shelo\migracion-vps\shiraf.env
Select-String -Path C:\Users\shelo\migracion-vps\shiraf.env -Pattern '^TRUST_PROXY'
scp C:\Users\shelo\migracion-vps\shiraf.env shelo@82.25.74.242:~/shiraf/.env
```

La tercera línea tiene que mostrar `TRUST_PROXY=docker`.

**2c. El complemento de compose** que une la app a la red `edge`:

```powershell
scp scripts\migracion\docker-compose.override.yml shelo@82.25.74.242:~/shiraf/docker-compose.override.yml
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose config --services && docker compose config | grep -A3 'edge:'"
```

Tiene que listar los servicios sin error y mostrar `edge:` con `external: true`.

**2d. Los backups viejos**, para no perder el historial de la rotación:

```powershell
scp -r shelo@177.7.59.16:~/shiraf/backups C:\Users\shelo\migracion-vps\shiraf-backups
scp -r C:\Users\shelo\migracion-vps\shiraf-backups\* shelo@82.25.74.242:~/shiraf/backups/
```

**2e. El sitio en Caddy**, por ahora sólo con el nombre de prueba por IP (el
dominio real va en otro archivo que se copia en el corte; el porqué está en
`shiraf.caddy`):

```powershell
scp scripts\migracion\shiraf.caddy shelo@82.25.74.242:~/
ssh shelo@82.25.74.242 "sudo cp ~/shiraf.caddy /srv/proxy/sites/shiraf.caddy && docker exec proxy caddy validate --config /etc/caddy/Caddyfile && docker exec proxy caddy reload --config /etc/caddy/Caddyfile && echo RECARGADO"
```

Tiene que terminar en `RECARGADO`. Los sitios del padre no se cortan con un
reload.

### Paso 3 — Construir la imagen en el nuevo ✅ (6/9/2026)

Tarda varios minutos y no toca ninguna base. Conviene hacerlo ahora y no en
medio del corte:

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose build 2>&1 | tail -5"
```

### Paso 4 — Ensayo: copia de la base y sitio andando en el nuevo, sin tocar el DNS ✅ (6/9/2026)

> Resultado: volcado restaurado sin errores, `migrate` en sync con las reglas
> verificadas, `shiraf-app` en la red `edge`, y la huella de los conteos
> igual en los dos servidores (`de38e64c27ec`). El sitio abrió en
> https://shiraf.82-25-74-242.sslip.io con certificado válido.

El objetivo es ver el sitio completo en el nuevo, con los datos reales,
mientras el viejo sigue sirviendo a todo el mundo. Lo que se restaure acá se
va a pisar en el corte con una copia más nueva; es un ensayo.

**4a. Volcado del viejo** (no frena nada; la app sigue andando):

```powershell
ssh shelo@177.7.59.16 "docker exec shiraf-db pg_dump -U shiraf --clean --if-exists shiraf | gzip > ~/shiraf-ensayo.sql.gz && ls -la ~/shiraf-ensayo.sql.gz"
scp shelo@177.7.59.16:~/shiraf-ensayo.sql.gz C:\Users\shelo\migracion-vps\
scp C:\Users\shelo\migracion-vps\shiraf-ensayo.sql.gz shelo@82.25.74.242:~/
```

**4b. Levantar sólo la base en el nuevo y restaurar encima** (está vacía):

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose up -d db && sleep 15 && docker ps --filter name=shiraf-db --format '{{.Names}} {{.Status}}'"
ssh shelo@82.25.74.242 "gunzip -c ~/shiraf-ensayo.sql.gz | docker exec -i shiraf-db psql -U shiraf -d shiraf -q 2>&1 | grep -E 'ERROR|FATAL' ; echo '(si arriba no hay ERROR, restauro bien)'"
```

**4c. Levantar el resto.** `migrate` va a decir que el esquema ya está en
sync (viene entero en el volcado, triggers incluidos) y va a verificar las
reglas; después arranca la app y se une a `edge`:

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose up -d && sleep 20 && docker compose logs migrate | tail -8 && docker ps --filter name=shiraf --format '{{.Names}} {{.Status}}' && docker network inspect edge --format '{{range .Containers}}{{.Name}} {{end}}'"
```

La última línea tiene que incluir `shiraf-app` junto a `proxy`.

**4d. Comparar los dos servidores.** La última línea de cada salida es una
huella de los conteos: tienen que coincidir (salvo que en el viejo alguien
haya cargado algo entre el volcado y ahora, y eso se ve en «lo más reciente»):

```powershell
Get-Content scripts\migracion\verificar-shiraf.sh -Raw | ssh shelo@177.7.59.16 'bash -s'
Get-Content scripts\migracion\verificar-shiraf.sh -Raw | ssh shelo@82.25.74.242 'bash -s'
```

**4e. Ver el sitio nuevo en el navegador**, con certificado real y sin tocar
nada en tu máquina: **https://shiraf.82-25-74-242.sslip.io**. Tiene que tener
candado, mostrar los tratamientos con fotos, dejar entrar al panel y ver la
agenda. Si el candado tarda un minuto en aparecer es Caddy pidiendo el
certificado; se mira con:

```powershell
ssh shelo@82.25.74.242 "docker logs proxy --since 5m 2>&1 | grep -iE 'shiraf|error' | tail -10"
```

Y que el limitador esté leyendo la IP de verdad (no tiene que aparecer el
aviso de que quedó apagado):

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose logs app --since 10m | grep -iE 'limiter|error' ; echo '(sin lineas = bien)'"
```

### Paso 5 — El corte

Requisitos antes de empezar: el paso 4 salió bien, y tener abierto el panel
de Cloudflare en DNS → Records de shiraf.com.ar (el TTL ya es 300 por la nube
gris; ver «DNS» abajo). Elegir un momento de poco uso: el sitio no responde
unos minutos entre 5a y 5f.

**5a. Frenar la app del viejo.** Desde acá el sitio no responde (nginx da 502)
hasta el 5f. Con la base de 9 MB son unos minutos:

```powershell
ssh shelo@177.7.59.16 "cd ~/shiraf && docker compose stop app && docker ps --filter name=shiraf --format '{{.Names}} {{.Status}}'"
```

**5b. Volcado final** (ya no entra nada nuevo en el viejo):

```powershell
ssh shelo@177.7.59.16 "docker exec shiraf-db pg_dump -U shiraf --clean --if-exists shiraf | gzip > ~/shiraf-final.sql.gz && ls -la ~/shiraf-final.sql.gz"
scp shelo@177.7.59.16:~/shiraf-final.sql.gz C:\Users\shelo\migracion-vps\
scp C:\Users\shelo\migracion-vps\shiraf-final.sql.gz shelo@82.25.74.242:~/
```

**5c. En el nuevo: guardar la copia del ensayo, frenar la app, restaurar el
final, levantar.** El `--clean` del volcado pisa las tablas del ensayo: es el
único paso destructivo de toda la migración, cae sobre una copia, y aun así
va precedido por un respaldo de esa copia.

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker exec shiraf-db pg_dump -U shiraf shiraf | gzip > backups/ensayo-antes-del-corte.sql.gz && docker compose stop app"
ssh shelo@82.25.74.242 "gunzip -c ~/shiraf-final.sql.gz | docker exec -i shiraf-db psql -U shiraf -d shiraf -q 2>&1 | grep -E 'ERROR|FATAL' ; echo '(si arriba no hay ERROR, restauro bien)'"
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose up -d && sleep 20 && docker compose logs migrate | tail -5 && docker ps --filter name=shiraf --format '{{.Names}} {{.Status}}'"
```

**5d. Comparar otra vez** (paso 4d). Ahora la huella tiene que coincidir
exacto, porque el viejo está frenado.

**5e. Cambiar el DNS y, enseguida, declarar el dominio en Caddy.** Primero
el DNS: registros A de `shiraf.com.ar` y `www.shiraf.com.ar` →
`82.25.74.242`. Después, sin esperar, se copia al proxy el archivo con el
dominio real (`shiraf-dominio.caddy`; hasta acá sólo estaba el nombre de
prueba) y se recarga:

```powershell
scp scripts\migracion\shiraf-dominio.caddy shelo@82.25.74.242:~/
ssh shelo@82.25.74.242 "sudo cp ~/shiraf-dominio.caddy /srv/proxy/sites/shiraf-dominio.caddy && docker exec proxy caddy validate --config /etc/caddy/Caddyfile && docker exec proxy caddy reload --config /etc/caddy/Caddyfile && echo RECARGADO"
```

Tiene que decir `RECARGADO`. Caddy pide el certificado en cuanto Let's
Encrypt resuelve la IP nueva; si el primer intento falla porque el DNS todavía
no propagó, reintenta solo en un minuto. Ver que propagó y que el certificado
salió:

```powershell
nslookup shiraf.com.ar 8.8.8.8
ssh shelo@82.25.74.242 "docker exec proxy sh -c 'ls -R /data/caddy/certificates | grep shiraf.com.ar'"
```

**5f. Puente en el viejo, para los que todavía resuelven la IP vieja.** En vez
de un 502, el nginx viejo reenvía al nuevo mientras el DNS termina de cambiar.
Así nadie escribe en la base vieja después del corte. Recién después de que
el certificado del 5e exista:

```powershell
scp scripts\migracion\nginx-shiraf-puente.conf shelo@177.7.59.16:~/
ssh -t shelo@177.7.59.16 "sudo cp /etc/nginx/sites-available/shiraf /home/shelo/nginx-shiraf-viejo.bak && sudo cp ~/nginx-shiraf-puente.conf /etc/nginx/sites-available/shiraf && sudo nginx -t && sudo systemctl reload nginx"
```

Durante esas horas, quienes entren por el puente le llegan al nuevo con la IP
del viejo, así que el freno de intentos de login los cuenta como una sola
persona. Es por un rato y no hay nada que hacer al respecto.

**5g. Comprobar**: entrar a https://shiraf.com.ar desde el celular (con
datos, no con el wifi), iniciar sesión, mirar la agenda, pedir un mail de
recuperación de contraseña y ver que llega. Y que el backup diario del nuevo
esté vivo:

```powershell
ssh shelo@82.25.74.242 "docker ps --filter name=shiraf-backup --format '{{.Names}} {{.Status}}'"
```

### Paso 6 — Después

- **El viejo queda con `shiraf-app` frenado y la base y el volumen intactos**
  durante dos semanas. Ni `down -v`, ni `volume rm`, ni borrar la carpeta.
- A la semana: `ssh shelo@82.25.74.242 "ls -la ~/shiraf/backups/daily"` tiene
  que mostrar archivos nuevos cada día.
- Cuando estén los tres sitios en el nuevo y pasen las dos semanas: se da de
  baja el viejo desde el panel de Hostinger, se borra
  `C:\Users\shelo\migracion-vps`, y se actualizan `DOCKER.md`, `TODO.md` y
  `ESTADO.md` con la IP nueva. El deploy de ahí en más es el mismo
  `git pull && docker compose up -d --build` de siempre, en `~/shiraf`.

---

## DNS

Resuelto el 6/9/2026: los tres dominios están registrados en **NIC Argentina**
y delegados a **Cloudflare** (`natasha.ns.cloudflare.com`, `scott.ns.cloudflare.com`).
Comprobado con `nslookup` contra 1.1.1.1:

| Dominio                                | Resuelve a      | Nube             |
| -------------------------------------- | --------------- | ---------------- |
| shiraf.com.ar y www                    | `177.7.59.16`   | gris (sólo DNS)  |
| manhattannegociosinmobiliarios.com.ar  | `177.7.59.16`   | gris (sólo DNS)  |
| igwtstore.com.ar                       | `104.21.88.135` | **naranja** (pasa por Cloudflare) |

Consecuencias:

- **Shiraf y manhattan**: con nube gris Cloudflare usa TTL «Auto» = 300 s, así
  que no hay que bajar nada un día antes. El corte se hace cambiando los
  registros A de `shiraf.com.ar` y `www` a `82.25.74.242` en el panel de
  Cloudflare (DNS → Records → Edit), **dejando la nube gris**. Aplica en
  segundos.
- **igwtstore**: pasa por Cloudflare, así que cuando le toque hay que seguir
  «Si en vez de nginx va Cloudflare» de `DOCKER.md` adaptado a Caddy:
  `TRUST_PROXY=cloudflare` en su configuración y el origen cerrado a lo que
  no venga de Cloudflare. Y en el corte, cambiar el A sin tocar la nube.

---

## Después de Shiraf: manhattan y el ecommerce

**manhattan** repite el mismo esquema: clonar/copiar `/opt/inmobiliaria-manhattan`
con su `.env`, volcar `manhattan_db`, unir su frontend a la red `edge`, un
`manhattan.caddy` (con el `client_max_body_size 110M` y los timeouts de
300 s traducidos a Caddy: `request_body { max_size 110MB }` y
`transport http { response_header_timeout 300s }`, que costaron encontrar) y
el cron de backup.

**igwtstore** primero hay que ordenarlo, porque hoy nadie sabe con certeza qué
arranca el Node del 4000 ni desde qué carpeta. Antes de moverlo:

- averiguar con `ps -o pid,cmd -p 416105` y `ls -l /proc/416105/cwd` qué es y
  de dónde corre;
- volcar `ecommerce_db` del Postgres del host (`sudo -u postgres pg_dump
  ecommerce_db`), que es la base real, y no la del contenedor;
- decidir si en el nuevo va con el `docker-compose.vps.yml` que ya existe en
  el repo o con el mismo Node suelto pero bajo systemd y **sin el puerto 4000
  abierto a internet** (en el nuevo, ufw lo bloquearía igual).

Eso se planifica cuando Shiraf ya esté del otro lado.
