# Migraciones: dejar de copiar y pegar en el SQL Editor

Hasta acá cada migración se aplicaba a mano —abrir el SQL Editor de Supabase,
pegar el archivo, apretar Run— y lo único que registraba cuáles ya se habían
corrido era una tabla escrita a mano en `TODO.md`.

Eso es lo que hay que dejar de hacer, y no hace falta cambiar de base para
lograrlo: la CLI ya lleva ese registro sola.

## El problema concreto que resuelve

Con el método manual no hay forma de preguntarle a la base qué le falta. El
19/8/2026, para contestar "¿están todas las migraciones corridas?", hubo que
escribir un script que consultara el esquema por la API y fuera comprobando
tabla por tabla y función por función si cada objeto existía. Con la CLI eso es:

    npx supabase migration list

y devuelve las dos columnas, local y remoto, con lo que falta de cada lado.

El segundo problema es peor y ya mordió: si nadie sabe con certeza qué versión
de una función está viva, se termina reescribiendo una función a partir de una
copia vieja. Es exactamente lo que pasó con `enforce_appointment_client_scope()`
en `20260818030000`, que revirtió sin querer dos cambios de `20260816020000` y
dejó a la empleada sin poder confirmar turnos. Ver
`20260819000000_fix_appointment_client_scope.sql`.

## Puesta a punto — una sola vez

Las 22 migraciones hasta `20260818030000` ya están corridas a mano, pero la
tabla de historial del proyecto no lo sabe. Si se corriera `db push` sin este
paso, intentaría aplicarlas todas de nuevo y fallaría en el primer
`CREATE TYPE` repetido. No rompe nada —Postgres aborta la transacción— pero no
avanza.

```bash
# 1. Entrar. Abre el navegador para autorizar.
npx supabase login

# 2. Atar esta carpeta al proyecto. Pide la contraseña de la base
#    (Project Settings → Database → Database password).
npx supabase link --project-ref btqqzbhrlwakglaooddg

# 3. Ver el desfasaje: van a aparecer las 22 como locales y ninguna como remota.
npx supabase migration list

# 4. Decirle que esas 22 YA están aplicadas. No ejecuta nada:
#    sólo escribe el historial.
npx supabase migration repair --status applied \
  20260805164122 20260805164143 20260805165256 20260805165325 20260805165527 \
  20260813000000 20260813010000 20260813020000 20260813030000 20260813040000 \
  20260813050000 20260813060000 20260813070000 20260814000000 20260814010000 \
  20260816000000 20260816010000 20260816020000 20260818000000 20260818010000 \
  20260818020000 20260818030000

# 5. Comprobar: ahora las 22 tienen que figurar de los dos lados, y
#    20260819000000 sólo del local.
npx supabase migration list
```

## De ahí en adelante

```bash
# Crear una migración vacía con el timestamp bien puesto
npx supabase migration new lo_que_hace

# Aplicar a la base lo que falte
npx supabase db push

# Ver qué falta
npx supabase migration list
```

`db push` aplica **sólo lo pendiente** y en orden. No hay que acordarse de nada
ni tachar nada en un TODO.

## ⚠️ El comando que no hay que correr

    supabase db reset --linked

**Borra la base entera** y la reconstruye desde los archivos. Está pensado para
la copia local de desarrollo. Contra el proyecto de producción se lleva puestos
los turnos, las clientas y las cuentas. `db push` nunca borra nada; `db reset`
sí.

## Lo que la CLI no cubre

Los datos y la configuración que no son esquema siguen a mano:

- Las **plantillas de mail** de Authentication (ver `supabase/emails/README.md`).
- El **SMTP** y las **Redirect URLs**.
- Las **extensiones** `pg_cron` y `pg_net` para los recordatorios.
- El **bucket** de Storage, si algún día se vuelve a usar (hoy las fotos van a
  Cloudinary).
