/**
 * Traducciones entre lo que devuelve Prisma y lo que espera la pantalla.
 *
 * ── POR QUÉ ESTO EXISTE ───────────────────────────────────────────────────
 *
 * `supabase-js` entregaba los tipos de Postgres ya convertidos a algo que
 * JavaScript entiende: `numeric` como número, `time` como `"09:00:00"`. Prisma
 * no: entrega `Decimal` y `Date`.
 *
 * Y en el medio hay un `fetch`, así que **TypeScript no ve nada**. Si un
 * `Decimal` sale sin convertir, `formatMoney()` escribe `[object Object]`; si
 * sale un `Date` donde se esperaba texto, `.slice(0, 5)` explota. Las dos cosas
 * aparecen recién en la pantalla, corriendo.
 *
 * Por eso las conversiones viven acá y no sueltas en cada controller: son
 * siempre las mismas cuatro, y tenerlas juntas hace evidente cuáles son.
 */

/** Un `Decimal` de Prisma como número, que es lo que espera `formatMoney()`. */
export function comoNumero(valor: { toNumber(): number }): number {
  return valor.toNumber();
}

/**
 * Un `@db.Time` como `"09:00:00"`.
 *
 * Prisma devuelve las columnas `time` como un Date parado en el epoch, con la
 * hora en UTC. Lo único que vale es la hora: es hora de pared del centro, sin
 * zona. Ver el comentario de `professional_schedules` en `schema.prisma`.
 */
export function comoHora(valor: Date): string {
  return valor.toISOString().slice(11, 19);
}

/**
 * Al revés: `"09:00"` o `"09:00:00"` → el Date que Prisma quiere para un
 * `@db.Time`.
 *
 * ⚠️ Se arma en UTC a propósito. Con `new Date("1970-01-01T09:00")` —sin la Z—
 * el navegador o el servidor lo interpretarían en su zona horaria, y en Buenos
 * Aires eso guarda las 12:00. El horario de una profesional no tiene zona: dice
 * "de 9 a 17" y significa lo mismo mire quien lo mire.
 */
export function horaDesdeTexto(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valor.trim());
  if (!m) return null;
  const [hh, mm, ss] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return new Date(Date.UTC(1970, 0, 1, hh, mm, ss));
}
