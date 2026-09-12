import { ValidationError } from "./validation";

/**
 * Fase 3 (sistema global de errores y validaciones, REQUIREMENTS.md): forma
 * común del "estado" que devuelve una Server Action pensada para usarse con
 * `useActionState`, en vez de simplemente `throw`-ear un Error.
 *
 * Por qué hacía falta esto (hallazgo H-6 de la auditoría): salvo el login,
 * ninguna acción del sistema usaba `useActionState` — cualquier Error que
 * lanzara (una validación de Zod, una regla de negocio como "este proveedor
 * ya tiene presupuestos", un chequeo de permisos) terminaba interceptado por
 * la pantalla genérica de error de Next.js (`error.tsx`), que en producción
 * REDACTA el mensaje real: la persona solo veía "Ocurrió un problema" y un
 * código de referencia, sin importar cuán claro fuera el mensaje que el
 * código ya escribía. `conEstadoDeAccion` (más abajo) atrapa esos errores
 * "esperables" del dominio y los devuelve como datos en vez de relanzarlos,
 * para que el formulario los muestre en el momento y lugar correctos: junto
 * al campo si es un error de validación de un campo puntual (`fieldErrors`),
 * o como mensaje general si es una regla de negocio, un permiso o un error
 * de servidor (`error`).
 */
export type ActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export const ESTADO_INICIAL: ActionState = { ok: false };

/** Next.js implementa `redirect()`/`notFound()` lanzando un error especial
 * con un `digest` reconocible — hay que dejarlos pasar tal cual, nunca
 * convertirlos en un estado de formulario, o la redirección/404 no ocurre. */
function esControlDeFlujoDeNextjs(err: unknown): boolean {
  const digest = String((err as { digest?: unknown })?.digest || "");
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

/**
 * Envuelve la lógica real de una Server Action. Usar así:
 *
 *   export async function crearXFormAction(_prev: ActionState, formData: FormData) {
 *     return conEstadoDeAccion(() => crearXAction(formData));
 *   }
 *
 * Un error inesperado (no un `Error`/`ValidationError` armado a propósito en
 * el código — ej. una falla de conexión a la base) igual se loguea acá, pero
 * a la persona se le muestra un mensaje genérico fijo en vez de filtrar
 * detalles técnicos internos.
 */
export async function conEstadoDeAccion(fn: () => Promise<void>): Promise<ActionState> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (esControlDeFlujoDeNextjs(err)) throw err;
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message, fieldErrors: { [err.field]: err.message } };
    }
    if (err instanceof Error) {
      // requireUser() (lib/auth.ts) lanza este mensaje "técnico" cuando la
      // sesión ya no es válida (se cerró en otra pestaña, o venció) mientras
      // la persona seguía con la pantalla abierta — acá se traduce a algo
      // que tiene sentido leer en un formulario.
      if (err.message === "UNAUTHENTICATED") {
        return { ok: false, error: "Tu sesión venció — recargá la página e iniciá sesión de nuevo." };
      }
      return { ok: false, error: err.message };
    }
    console.error("[accion] error inesperado:", err);
    return { ok: false, error: "Ocurrió un problema inesperado. Intentá de nuevo." };
  }
}
