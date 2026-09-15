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
 * Fase 4 del rediseño (mensajes de error/feedback visual), hallazgo: hasta
 * acá, CUALQUIER `Error` (no sólo los armados a propósito en el código con
 * `throw new Error("mensaje claro para la persona")`) se mostraba tal cual
 * en el formulario — incluyendo errores técnicos genuinos que se escapan de
 * `db.ts` sin pasar por `relanzarConMensajeSiFaltaTabla`/
 * `conFallbackColumnaFaltante` (ej. una restricción de base violada, una
 * columna con un tipo de dato que no matchea, un `TypeError` por un bug). Un
 * mensaje como `duplicate key value violates unique constraint
 * "proveedores_pkey"` no le sirve a un adulto mayor sin conocimientos
 * técnicos y expone detalles internos de la base de datos.
 *
 * En vez de exigir que cada `throw new Error(...)` del código de negocio use
 * una clase nueva (un refactor grande y riesgoso sobre ~40 archivos que hoy
 * funcionan bien), se distingue por FORMA: un error de negocio intencional
 * es siempre un `new Error("texto")` plano, sin más. Un error técnico que se
 * escapó tiene una de estas dos huellas propias, que ningún `throw new
 * Error(...)` de este código usa: (a) es una de las subclases nativas de
 * error de JavaScript (`TypeError`, `RangeError`, etc. — siempre bugs, nunca
 * un mensaje pensado para mostrarse), o (b) trae un `.code` con la forma de
 * un código SQLSTATE de Postgres (5 caracteres alfanuméricos, ej. "42703",
 * "23505") — la huella que deja el driver `pg` en cualquier error que no fue
 * traducido a un mensaje claro más arriba en la cadena.
 */
function esErrorTecnico(err: Error): boolean {
  if (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof EvalError ||
    err instanceof URIError
  ) {
    return true;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
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
      if (esErrorTecnico(err)) {
        console.error("[accion] error técnico oculto al usuario:", err);
        return { ok: false, error: "Ocurrió un problema al procesar la solicitud. Intentá de nuevo en un momento." };
      }
      return { ok: false, error: err.message };
    }
    console.error("[accion] error inesperado:", err);
    return { ok: false, error: "Ocurrió un problema inesperado. Intentá de nuevo." };
  }
}
