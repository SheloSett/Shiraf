# Historia: cuando Shiraf corría sobre Supabase

Del 5 al 21 de agosto de 2026, la base de este proyecto fue Supabase. El 21 se
mudó a Postgres propio en Docker. Todo lo de esta carpeta es de esa época y
**no lo usa nadie**.

## Por qué no se borró

Las 23 migraciones de `migrations/` no son SQL viejo: son **la única
documentación de por qué el sistema hace lo que hace**. Cada una explica arriba
la decisión de negocio que la motivó, y varias de esas decisiones no están
escritas en ningún otro lado. Ejemplos que aparecieron seguido durante la
mudanza:

| Migración        | Lo que explica                                                          |
| ---------------- | ----------------------------------------------------------------------- |
| `20260813020000` | Por qué el choque de turnos se resuelve en la base y no en el código    |
| `20260813070000` | Por qué el admin está _por encima_ del sistema de permisos y no adentro |
| `20260814010000` | Por qué las notas clínicas y los costos viven en tablas aparte          |
| `20260816010000` | Por qué un turno de invitada no crea una cuenta                         |
| `20260818020000` | Por qué «Mi agenda» no acepta un id de profesional                      |
| `20260819000000` | Cómo se rompió una función por copiarla de una versión vieja            |

Cuando algo del código nuevo parezca arbitrario, la respuesta suele estar acá.
`src/server/PERMISOS.md` referencia estas migraciones por número.

## Dónde quedó cada cosa

| Antes                              | Ahora                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| Las 39 policies RLS                | `src/server/` — la tabla completa está en `src/server/PERMISOS.md` |
| Los 3 triggers y `normalize_phone` | `prisma/sql/reglas.sql`                                            |
| Las 8 funciones RPC                | `src/server/services/`                                             |
| El esquema                         | `prisma/schema.prisma`, sincronizado con `db push`                 |
| El auth (GoTrue)                   | `src/server/controllers/auth.controller.ts`                        |
| Las plantillas de mail             | `emails/`, y las manda Resend                                      |

## Lo que sí se puede borrar, y cuándo

**Toda esta carpeta**, una vez que el Postgres propio lleve **dos semanas
andando** en el VPS y se haya restaurado un backup al menos una vez.

Hasta entonces, el proyecto de Supabase tampoco se pausa: es el único rollback
verdadero que hay. Antes de pausarlo, bajar un `pg_dump` completo y guardarlo
fuera del VPS.
