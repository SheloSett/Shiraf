/**
 * Le pone slug a los tratamientos que no lo tienen.
 *
 * `services.slug` nacio opcional porque `prisma db push` no puede agregar una
 * columna NOT NULL y unica a una tabla que ya tiene filas: no hay valor que
 * ponerles. Este script es ese valor. Corre una vez despues del push, y despues
 * de eso no hace nada — el panel ya escribe el slug al crear y al editar.
 *
 * Es idempotente y NO pisa lo que ya esta: filtra por `slug: null`. Correrlo de
 * nuevo no le cambia la URL a un tratamiento que ya la tiene, que es justo lo
 * que arruinaria los enlaces que alguien compartio.
 *
 * Uso:
 *   docker compose -f docker-compose.dev.yml run --rm app bun scripts/rellenar-slugs.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { aSlug } from "../src/lib/shiraf";

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("[slugs] Falta DATABASE_URL.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  // Los que ya tienen slug, para no chocar contra el indice unico. Se leen de
  // la base y no se asumen: puede haber tratamientos creados desde el panel
  // despues del push, con slug propio.
  const ocupados = new Set(
    (await prisma.services.findMany({ where: { NOT: { slug: null } }, select: { slug: true } }))
      .map((s) => s.slug)
      .filter((s): s is string => s !== null),
  );

  // Por fecha de creacion y no por nombre: si dos se llaman igual, el sufijo se
  // lo lleva el mas nuevo. El original conserva la URL limpia, que es lo que
  // esperaria cualquiera que ya lo tenia enlazado.
  const sinSlug = await prisma.services.findMany({
    where: { slug: null },
    select: { id: true, name: true },
    orderBy: { created_at: "asc" },
  });

  if (sinSlug.length === 0) {
    console.log("[slugs] Nada que hacer: los " + ocupados.size + " tratamientos ya tienen slug.");
    await prisma.$disconnect();
    return;
  }

  for (const s of sinSlug) {
    // El mismo "" -> "tratamiento" que hace slugLibre en el servidor.
    const base = aSlug(s.name) || "tratamiento";
    let slug = base;
    for (let n = 2; ocupados.has(slug); n++) slug = base + "-" + n;
    ocupados.add(slug);

    await prisma.services.update({ where: { id: s.id }, data: { slug } });
    console.log("  " + s.name.padEnd(28) + " -> /servicios/" + slug);
  }

  console.log("\n[slugs] " + sinSlug.length + " tratamiento(s) actualizados.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
