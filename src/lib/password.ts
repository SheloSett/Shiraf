/**
 * Reglas de contraseña, en un solo lugar.
 *
 * Antes había dos mínimos distintos conviviendo: el registro de clientas pedía
 * 6 caracteres y el alta de empleadas 8. Nadie eligió esa diferencia, salió de
 * haber escrito cada formulario por separado — y con dos pantallas nuevas
 * (recuperar y cambiar) el problema se multiplicaba por cuatro.
 *
 * Queda en 8, que es el más estricto de los dos: subir el mínimo sólo puede
 * mejorar las cuentas nuevas, y a las que ya existen no las toca.
 *
 * Ojo: esto valida del lado del navegador. El mínimo real lo impone el proyecto
 * de Supabase (Authentication → Policies), y si allá está en 6 alguien podría
 * crear una de 6 pegándole directo a la API. Es una molestia de UX, no un
 * agujero: la contraseña sigue siendo suya.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Devuelve el texto del error, o null si está bien.
 *
 * Texto y no un booleano porque las cuatro pantallas necesitan explicar qué
 * falta: un campo en rojo sin motivo hace que la persona pruebe al azar.
 */
export function passwordProblem(password: string, confirmation?: string): string | null {
  if (password.length === 0) return "Escribí una contraseña.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    const missing = MIN_PASSWORD_LENGTH - password.length;
    return `Le ${missing === 1 ? "falta 1 caracter" : `faltan ${missing} caracteres`}: el mínimo es ${MIN_PASSWORD_LENGTH}.`;
  }
  if (confirmation !== undefined && confirmation.length > 0 && password !== confirmation) {
    return "Las dos contraseñas no coinciden.";
  }
  return null;
}
