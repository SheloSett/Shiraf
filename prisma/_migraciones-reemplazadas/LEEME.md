# Migraciones reemplazadas por `db push`

Estas tres migraciones **funcionaban** —se aplicaron y se probaron contra un
Postgres real el 20/8/2026— pero el proyecto cambió de mecanismo: ahora el
esquema se sincroniza con `prisma db push`, igual que en `Ecommerce_mm`.

## Dónde quedó cada cosa

| Estaba acá | Ahora vive en |
| --- | --- |
| Las 16 tablas, enums, FK e índices simples | `prisma/schema.prisma` — lo aplica `db push` |
| Los 3 triggers y sus funciones | `prisma/sql/reglas.sql` |
| El `CHECK` de `appointments` | `prisma/sql/reglas.sql` |
| Los 4 índices parciales y `normalize_phone` | `prisma/sql/reglas.sql` |

**No se perdió nada.** Lo que `db push` no sabe manejar se aplica después, con
`scripts/post-push.mjs`, que además verifica que las reglas hayan quedado
puestas y falla si falta alguna.

## Se puede borrar esta carpeta

Queda sólo como respaldo por si hubiera que volver atrás. Una vez que
`npm run db:sync` haya corrido bien unas cuantas veces, no aporta nada.
