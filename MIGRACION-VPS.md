# Migración del VPS viejo al nuevo

Decidido el 6/9/2026: **se mudan los tres sitios y el viejo se da de baja,
pero de a uno.** Shiraf primero porque es el más simple; manhattan después;
el ecommerce último porque hay que ordenarlo antes (ver al final).

|        | Viejo                      | Nuevo                            |
| ------ | -------------------------- | -------------------------------- |
| IP     | `177.7.59.16` (srv1745446) | `82.25.74.242` (Hostinger KVM 4) |
| Entrar | `ssh shelo@177.7.59.16`    | `ssh shelo@82.25.74.242`         |
| Shiraf | `/home/shelo/shiraf`       | `/home/shelo/shiraf`             |

Los dos servidores sólo aceptan la clave `id_ed25519`, que tiene passphrase:
cada `ssh`/`scp` la pide. Es molesto y es correcto.

**Todos los comandos son para PowerShell en tu máquina**, salvo que digan lo
contrario. Antes de empezar, en la terminal:

```powershell
cd C:\Users\shelo\Desktop\workspace\shiraf\Shiraf
mkdir C:\Users\shelo\migracion-vps -Force   # acá caen los archivos de paso (fuera del repo)
```

> `C:\Users\shelo\migracion-vps` va a tener el `.env` y volcados de la base
> con datos de clientas. Cuando termine todo, se borra.

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
- **Sin firewall ni fail2ban.** El nuevo los tiene desde el paso 1.
- 21 GB de caché de build de Docker. No afecta a nada.

---

## Shiraf, paso a paso

### Paso 1 — Preparar el nuevo (una sola vez, sirve para los tres sitios)

Instala Docker, nginx, certbot, ufw (22/80/443) y fail2ban. Pide la
passphrase dos veces y la contraseña de sudo de `shelo` en el nuevo.

```powershell
scp scripts\migracion\01-preparar-vps-nuevo.sh shelo@82.25.74.242:~/
ssh -t shelo@82.25.74.242 "sudo bash ~/01-preparar-vps-nuevo.sh 2>&1 | tee ~/preparacion.log"
```

Comprobar (en una sesión nueva, porque el grupo `docker` se aplica al volver a
entrar):

```powershell
ssh shelo@82.25.74.242 "docker ps; docker compose version; sudo ufw status; nproc; free -h; df -h /"
```

Tiene que responder `docker ps` sin `permission denied` y el firewall en
`active` con 22, 80 y 443.

### Paso 2 — Clonar el repo y traer lo que el repo no tiene

**2a. El código**, en el nuevo:

```powershell
ssh shelo@82.25.74.242 "git clone https://github.com/SheloSett/Shiraf.git ~/shiraf && cd ~/shiraf && git log --oneline -1"
```

Tiene que mostrar el mismo commit que el viejo (`git log --oneline -1` allá).

**2b. El `.env`** (secretos: pasa por tu máquina y no por el repo):

```powershell
scp shelo@177.7.59.16:~/shiraf/.env C:\Users\shelo\migracion-vps\shiraf.env
scp C:\Users\shelo\migracion-vps\shiraf.env shelo@82.25.74.242:~/shiraf/.env
```

No hace falta cambiarle nada: `APP_URL`, `TRUST_PROXY=loopback` y
`APP_BIND=127.0.0.1` valen igual en el nuevo. `DB_PORT` (5435 en el viejo,
porque el 5432 lo tenía el Postgres del host) también puede quedar.

**2c. Los backups viejos**, para no perder el historial de la rotación:

```powershell
scp -r shelo@177.7.59.16:~/shiraf/backups C:\Users\shelo\migracion-vps\shiraf-backups
scp -r C:\Users\shelo\migracion-vps\shiraf-backups\* shelo@82.25.74.242:~/shiraf/backups/
```

**2d. El certificado**, para que el nuevo sirva HTTPS desde el primer minuto y
se pueda probar antes de tocar el DNS. Se empaqueta con sudo en el viejo, pasa
por tu máquina, y se desempaqueta con sudo en el nuevo:

```powershell
ssh -t shelo@177.7.59.16 "sudo tar czf /home/shelo/letsencrypt-shiraf.tgz -C / etc/letsencrypt/live/shiraf.com.ar etc/letsencrypt/archive/shiraf.com.ar etc/letsencrypt/renewal/shiraf.com.ar.conf etc/letsencrypt/options-ssl-nginx.conf etc/letsencrypt/ssl-dhparams.pem && sudo chown shelo:shelo /home/shelo/letsencrypt-shiraf.tgz && ls -la /home/shelo/letsencrypt-shiraf.tgz"
scp shelo@177.7.59.16:~/letsencrypt-shiraf.tgz C:\Users\shelo\migracion-vps\
scp C:\Users\shelo\migracion-vps\letsencrypt-shiraf.tgz shelo@82.25.74.242:~/
ssh -t shelo@82.25.74.242 "sudo tar xzf ~/letsencrypt-shiraf.tgz -C / && sudo ls -la /etc/letsencrypt/live/shiraf.com.ar/"
```

Tiene que listar `fullchain.pem` y `privkey.pem` como enlaces a `../../archive`.

**2e. nginx del nuevo**:

```powershell
scp scripts\migracion\nginx-shiraf.conf shelo@82.25.74.242:~/
ssh -t shelo@82.25.74.242 "sudo cp ~/nginx-shiraf.conf /etc/nginx/sites-available/shiraf && sudo ln -sf /etc/nginx/sites-available/shiraf /etc/nginx/sites-enabled/shiraf && sudo nginx -t && sudo systemctl reload nginx"
```

`nginx -t` tiene que decir `syntax is ok` y `test is successful`.

### Paso 3 — Construir la imagen en el nuevo

Tarda varios minutos y no toca ninguna base. Conviene hacerlo ahora y no en
medio del corte:

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose build 2>&1 | tail -5"
```

### Paso 4 — Ensayo: copia de la base y sitio andando en el nuevo, sin tocar el DNS

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
reglas; después arranca la app:

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose up -d && sleep 20 && docker compose logs migrate | tail -8 && docker ps --filter name=shiraf --format '{{.Names}} {{.Status}}'"
```

**4d. Comparar los dos servidores.** La última línea de cada salida es una
huella de los conteos: tienen que coincidir (salvo que en el viejo alguien
haya cargado algo entre el volcado y ahora, y eso se ve en «lo más reciente»):

```powershell
Get-Content scripts\migracion\verificar-shiraf.sh -Raw | ssh shelo@177.7.59.16 'bash -s'
Get-Content scripts\migracion\verificar-shiraf.sh -Raw | ssh shelo@82.25.74.242 'bash -s'
```

**4e. Ver el sitio nuevo en el navegador, con el dominio real.** Se le dice a
tu máquina —y sólo a la tuya— que `shiraf.com.ar` es la IP nueva. Bloc de
notas **como administrador**, abrir `C:\Windows\System32\drivers\etc\hosts` y
agregar al final:

```
82.25.74.242 shiraf.com.ar www.shiraf.com.ar
```

Después `ipconfig /flushdns`, y entrar a https://shiraf.com.ar: tiene que
tener candado (es el mismo certificado), mostrar los tratamientos con fotos,
dejar entrar al panel y ver la agenda. Para saber que estás mirando el nuevo:

```powershell
ssh shelo@82.25.74.242 "cd ~/shiraf && docker compose logs app --since 2m | tail -5"
```

**Cuando termines, borrá esa línea del `hosts`** y volvé a hacer `flushdns`.
Si no, vas a seguir viendo el nuevo aunque el DNS apunte a otro lado y no vas
a poder distinguir nada.

### Paso 5 — El corte

Requisitos antes de empezar: el paso 4 salió bien, y el **TTL del registro A
de shiraf.com.ar está bajado a 300** desde al menos un día antes (se hace en
el panel del DNS; ver «DNS» abajo). Elegir un momento de poco uso.

**5a. Frenar la app del viejo.** Desde acá el sitio no responde (nginx da 502)
hasta el 5e. Con la base de 9 MB son unos minutos:

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

**5e. Cambiar el DNS**: registros A de `shiraf.com.ar` y `www.shiraf.com.ar`
→ `82.25.74.242`. Ver que propagó:

```powershell
nslookup shiraf.com.ar 8.8.8.8
```

**5f. Puente en el viejo, para los que todavía resuelven la IP vieja.** En vez
de un 502, el nginx viejo reenvía al nuevo mientras el DNS termina de cambiar.
Así nadie escribe en la base vieja después del corte. Se copia un archivo con
el bloque ya escrito (`scripts/migracion/nginx-shiraf-puente.conf`):

```powershell
scp scripts\migracion\nginx-shiraf-puente.conf shelo@177.7.59.16:~/
ssh -t shelo@177.7.59.16 "sudo cp /etc/nginx/sites-available/shiraf /home/shelo/nginx-shiraf-viejo.bak && sudo cp ~/nginx-shiraf-puente.conf /etc/nginx/sites-available/shiraf && sudo nginx -t && sudo systemctl reload nginx"
```

Durante esas horas, quienes entren por el puente le llegan al nuevo con la IP
del viejo, así que el freno de intentos de login los cuenta como una sola
persona. Es por un rato y no hay nada que hacer al respecto.

**5g. Comprobar**: entrar al sitio desde el celular (con datos, no con el
wifi), iniciar sesión, mirar la agenda, pedir un mail de recuperación de
contraseña y ver que llega. Y que el backup diario del nuevo esté vivo y el
certificado sepa renovarse desde acá:

```powershell
ssh shelo@82.25.74.242 "docker ps --filter name=shiraf-backup --format '{{.Names}} {{.Status}}'"
ssh -t shelo@82.25.74.242 "sudo certbot renew --dry-run 2>&1 | tail -6"
```

### Paso 6 — Después

- **El viejo queda con `shiraf-app` frenado y la base y el volumen intactos**
  durante dos semanas. Ni `down -v`, ni `volume rm`, ni borrar la carpeta.
- A la semana: `ssh shelo@82.25.74.242 "ls -la ~/shiraf/backups/daily"` tiene
  que mostrar archivos nuevos cada día.
- Cuando estén los tres sitios en el nuevo y pasen las dos semanas: se da de
  baja el viejo desde el panel de Hostinger, se borra
  `C:\Users\shelo\migracion-vps`, y se actualizan `DOCKER.md`, `TODO.md` y
  `ESTADO.md` con la IP nueva.

---

## DNS

**Pendiente saber dónde se administran los tres dominios `.com.ar`** (NIC
Argentina delega a algún servidor de DNS: puede ser el panel de Hostinger, el
del registrador, o Cloudflare). Hace falta para:

1. Bajar el TTL de los registros A a 300 **un día antes** de cada corte.
2. Cambiar el A y el `www` en el corte.
3. Si alguno pasa por Cloudflare, el plan cambia: ver «Si en vez de nginx va
   Cloudflare» en `DOCKER.md`.

---

## Después de Shiraf: manhattan y el ecommerce

**manhattan** repite el mismo esquema: clonar/copiar `/opt/inmobiliaria-manhattan`
con su `.env`, volcar `manhattan_db`, traer el certificado, su bloque de nginx
(con el `client_max_body_size 110M` y los timeouts de 300 s, que costaron
encontrar) y el cron de backup.

**igwtstore** primero hay que ordenarlo, porque hoy nadie sabe con certeza qué
arranca el Node del 4000 ni desde qué carpeta. Antes de moverlo:

- averiguar con `ps -o pid,cmd -p 416105` y `ls -l /proc/416105/cwd` qué es y
  de dónde corre;
- volcar `ecommerce_db` del Postgres del host (`sudo -u postgres pg_dump
  ecommerce_db`), que es la base real, y no la del contenedor;
- decidir si en el nuevo va con el `docker-compose.vps.yml` que ya existe en
  el repo o con el mismo Node suelto pero bajo systemd/pm2 y **sin el puerto
  4000 abierto a internet**.

Eso se planifica cuando Shiraf ya esté del otro lado.
