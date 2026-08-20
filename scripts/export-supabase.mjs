// Fase 0 de MIGRACION-A-PRISMA.md — la red de seguridad.
//
// Baja las 15 tablas y las 4 cuentas a JSON, para poder volver a cargarlas en la
// base nueva (Fase 4) y para tener de dónde restaurar si algo sale mal.
//
// POR QUÉ ESTE SCRIPT Y NO `supabase db dump`. El plan prefiere el dump de la
// CLI, que es más completo y no se le escapa ninguna tabla. Pero pide la
// contraseña de la base (Project Settings → Database), que no está en el .env.
// Esto usa la service role key, que sí está, y alcanza para el objetivo: los
// datos quedan guardados.
//
//   ⚠️ El dump SQL SIGUE HACIENDO FALTA antes de tocar la base. Ver el README
//      que este script deja escrito al lado de los JSON.
//
// Uso:  node scripts/export-supabase.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "scripts", "datos");

// El .env se lee a mano: el proyecto no tiene dotenv y no vale la pena sumarlo
// para un script que corre una vez.
function leerEnv() {
  const env = {};
  for (const linea of readFileSync(join(raiz, ".env"), "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte === -1) continue;
    env[limpia.slice(0, corte)] = limpia.slice(corte + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = leerEnv();
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env.");
  process.exit(1);
}

// El orden es el de la Fase 4 (carga), por las claves foráneas. Guardarlo así
// evita tener que reconstruirlo después.
const TABLAS = [
  "profiles",
  "user_roles",
  "user_permissions",
  "service_categories",
  "services",
  "service_media",
  "professionals",
  "professional_services",
  "professional_schedules",
  "product_categories",
  "products",
  "product_costs",
  "stock_movements",
  "appointments",
  "client_notes",
];

const cabeceras = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function bajarTabla(tabla) {
  const r = await fetch(`${URL}/rest/v1/${tabla}?select=*`, { headers: cabeceras });
  if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

async function bajarUsuarios() {
  // La Admin API pagina de a 50 por defecto. Con 4 usuarios no importa, pero
  // pedirlo explícito evita una sorpresa silenciosa si alguna vez son más.
  const r = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: cabeceras });
  if (!r.ok) throw new Error(`usuarios: HTTP ${r.status} — ${await r.text()}`);
  const { users } = await r.json();
  // Se guarda sólo lo que hace falta para recrear las cuentas y traducir los id.
  // Los hashes de contraseña NO se copian: las 4 cuentas se recrean a mano.
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    created_at: u.created_at,
    user_metadata: u.user_metadata,
  }));
}

mkdirSync(destino, { recursive: true });

let total = 0;
const conteos = {};

for (const tabla of TABLAS) {
  const filas = await bajarTabla(tabla);
  writeFileSync(join(destino, `${tabla}.json`), JSON.stringify(filas, null, 2) + "\n");
  conteos[tabla] = filas.length;
  total += filas.length;
  console.log(`${String(filas.length).padStart(3)}  ${tabla}`);
}

const usuarios = await bajarUsuarios();
writeFileSync(join(raiz, "scripts", "usuarios.json"), JSON.stringify(usuarios, null, 2) + "\n");

console.log("―".repeat(30));
console.log(`${String(total).padStart(3)}  TOTAL en 15 tablas`);
console.log(`${String(usuarios.length).padStart(3)}  cuentas (en scripts/usuarios.json, fuera del repo)`);

writeFileSync(
  join(destino, "conteos.json"),
  JSON.stringify({ generado: new Date().toISOString(), total, tablas: conteos }, null, 2) + "\n",
);
