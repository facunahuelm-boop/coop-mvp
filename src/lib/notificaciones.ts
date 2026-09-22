import "server-only";
import { insert } from "@/lib/db";

// Fase 11 (auditoría de seguridad, 22/09) — HALLAZGO S-1.
//
// Estos dos helpers vivían en `src/lib/actions/notificaciones.ts`, que
// empieza con "use server". En el App Router eso no es un detalle de estilo:
// TODA función exportada desde un módulo "use server" se compila como un
// endpoint RPC con un id público que viaja en el bundle del cliente. Es
// decir, `crearNotificacion` —pensada como helper interno que llaman otras
// acciones ya autenticadas— quedaba expuesta como acción invocable desde el
// navegador, y no tenía (ni tenía por qué tener) ninguna comprobación de
// sesión propia.
//
// Consecuencia concreta: un usuario autenticado de la cooperativa podía
// llamarla directamente con un `user_id` ajeno y fabricar notificaciones
// falsas en la bandeja de cualquier otra persona ("Tu compra fue aprobada",
// con un ref_tabla/ref_id elegido por él). No es una fuga de datos —
// `insert()` inyecta el organization_id de la sesión de quien llama, así que
// RLS sigue impidiendo cruzar de cooperativa — pero sí es suplantación del
// sistema dentro de una misma cooperativa, que es exactamente el tipo de
// mensaje que la gente cree sin dudar.
//
// El arreglo es mover los helpers a este módulo SIN "use server": se siguen
// ejecutando en el servidor y las acciones los siguen importando igual, pero
// dejan de ser endpoints. `server-only` hace que el build falle si alguien
// los importa desde un componente cliente por error.
//
// En `actions/notificaciones.ts` quedan solo las acciones de verdad
// (marcar leída / marcar todas), que sí deben ser endpoints y sí validan
// sesión con requireUser().

/** Crea una notificación para un usuario. Nunca hace fallar la acción real
 * que la dispara: si algo sale mal, lo loguea y sigue. */
export async function crearNotificacion(params: {
  user_id: number;
  tipo: string;
  titulo: string;
  cuerpo?: string | null;
  ref_tabla?: string | null;
  ref_id?: number | null;
}): Promise<void> {
  try {
    await insert("notificaciones", {
      user_id: params.user_id,
      tipo: params.tipo,
      titulo: params.titulo,
      cuerpo: params.cuerpo ?? null,
      ref_tabla: params.ref_tabla ?? null,
      ref_id: params.ref_id ?? null,
      leida: false,
    });
  } catch (err) {
    // No debe hacer fallar la acción real que la dispara (crear una
    // solicitud, asignar una tarea, etc.) — ni porque la tabla
    // `notificaciones` todavía no exista en esta base ni por ningún otro
    // error puntual.
    console.error("[notificaciones] no se pudo crear la notificación:", err);
  }
}

/** Mismo helper que arriba, para avisar a varias personas del mismo evento
 * (ej: todos los integrantes activos de una comisión). Deduplica ids por si
 * alguna consulta los trae repetidos. */
export async function crearNotificacionesParaUsuarios(
  userIds: number[],
  datos: Omit<Parameters<typeof crearNotificacion>[0], "user_id">
): Promise<void> {
  const unicos = Array.from(new Set(userIds));
  for (const user_id of unicos) {
    await crearNotificacion({ ...datos, user_id });
  }
}
