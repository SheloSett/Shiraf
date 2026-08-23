import type { QueryClient } from "@tanstack/react-query";
import { api, ErrorDeApi } from "@/lib/api";
import type { Permission } from "@/lib/permissions";

/**
 * Quién está conectada, en una sola consulta.
 *
 * ── QUÉ REEMPLAZA ─────────────────────────────────────────────────────────
 *
 * Antes esto eran tres cosas separadas y 26 llamadas a `supabase.auth.*`:
 *
 *   · la sesión, que la guardaba supabase-js y avisaba por `onAuthStateChange`;
 *   · los roles, en `rolesQuery()` contra `user_roles`;
 *   · los permisos y la ficha de profesional, en `useAccess` contra
 *     `user_permissions` y la RPC `my_professional_id`.
 *
 * Ahora es un solo `GET /api/auth/me`. El servidor ya tiene que abrir la sesión
 * para responder cualquier cosa, así que devolver de paso los roles y los
 * permisos no cuesta nada — y evita que la pantalla arme su idea de quién sos
 * juntando tres consultas que pueden llegar desincronizadas.
 *
 * ── NO HAY `onAuthStateChange` ────────────────────────────────────────────
 *
 * Era un suscriptor: supabase-js avisaba solo cuando la sesión cambiaba. Con una
 * cookie no hay a quién suscribirse. En su lugar, **al entrar y al salir se
 * borra esta consulta** con `olvidarSesion()`, que es lo mismo pero explícito.
 */

export type Sesion = {
  id: string;
  email: string;
  emailVerificado: boolean;
  nombre: string | null;
  telefono: string | null;
  roles: string[];
  permisos: Permission[];
  /** La ficha de profesional atada a esta cuenta, si hay alguna y está activa. */
  professionalId: string | null;
};

export const CLAVE_SESION = ["sesion"] as const;

export function sesionQuery() {
  return {
    queryKey: CLAVE_SESION,
    // Los accesos cambian por afuera de esta pestaña: la dueña destilda una
    // casilla desde su propia sesión. Sin esto, la empleada seguía viendo el
    // menú viejo hasta apretar F5.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Sesion | null> => {
      try {
        return (await api<{ user: Sesion }>("/api/auth/me")).user;
      } catch (error) {
        // 401 no es una falla: es "no hay nadie conectado", que es una
        // respuesta perfectamente normal en las páginas públicas. Si se dejara
        // tirar, react-query lo reintentaría y el header quedaría en estado de
        // error para cualquier visitante sin cuenta.
        if (error instanceof ErrorDeApi && error.status === 401) return null;
        throw error;
      }
    },
  };
}

/**
 * La sesión para los `beforeLoad` del router, que corren fuera de React y no
 * pueden usar un hook.
 *
 * Va por `ensureQueryData` y no por un `fetch` suelto para que comparta la
 * caché con los hooks: entrar al panel dispara el `beforeLoad` y además monta el
 * header, y sin esto serían dos consultas idénticas seguidas.
 */
export async function pedirSesion(queryClient: QueryClient): Promise<Sesion | null> {
  try {
    return await queryClient.ensureQueryData(sesionQuery());
  } catch {
    // Un error de red no es lo mismo que no tener sesión, pero desde un
    // `beforeLoad` la única salida es mandar al login igual. Devolver null hace
    // eso; el mensaje de "no se pudo conectar" lo da la pantalla de login.
    return null;
  }
}

/**
 * Borra lo que se sepa de la sesión. Se llama al entrar y al salir.
 *
 * ── 🔴 `removeQueries` Y NO `invalidateQueries` ───────────────────────────
 *
 * Parecen lo mismo y no lo son. `invalidateQueries` marca la consulta como
 * vencida pero **deja el valor viejo en la caché**, y `ensureQueryData` —que es
 * por donde pasan `pedirSesion` y todos los `beforeLoad`— devuelve lo que haya
 * en la caché sin volver a preguntar.
 *
 * Con `invalidate` esto pasaba al ingresar, y era desconcertante:
 *
 *   1. `/auth` carga, pide `/api/auth/me`, recibe 401 y **cachea `null`**
 *   2. entrás bien: el servidor deja la cookie, la sesión existe
 *   3. `invalidateQueries` marca vencido, pero el `null` sigue ahí
 *   4. `goToMyPlace` lee ese `null` → "no sos del centro" → va a `/mi-cuenta`
 *   5. el guard de `/mi-cuenta` lee **el mismo `null`** → te rebota a `/auth`
 *
 * O sea: entrabas bien y te quedabas en el formulario de ingreso, sin ningún
 * error en pantalla. Al refrescar entrabas, porque la caché arrancaba vacía —
 * que es exactamente el síntoma que se reportó.
 *
 * `removeQueries` saca el valor de la caché, así que la próxima lectura **tiene**
 * que ir al servidor. Es lo correcto en los dos momentos en que se llama: al
 * entrar y al salir, lo que se sabía de la sesión anterior ya no vale nada.
 */
export function olvidarSesion(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: CLAVE_SESION });
}

/**
 * ¿Esta cuenta es del centro (la dueña o alguien del equipo) y no de una
 * clienta?
 *
 * Es la pregunta que decide a dónde va cada quien al ingresar. Nada más: quién
 * puede hacer qué lo decide el servidor.
 */
export function esDelCentro(sesion: Sesion | null): boolean {
  return sesion?.roles.includes("admin") === true || sesion?.roles.includes("staff") === true;
}
