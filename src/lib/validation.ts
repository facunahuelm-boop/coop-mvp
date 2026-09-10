import { z } from "zod";

/**
 * Capa de validación en tiempo de ejecución (Zod) para todo lo que llega
 * desde un formulario (FormData) hacia una Server Action.
 *
 * Por qué hace falta esto además de TypeScript: TypeScript solo existe
 * mientras se compila el código — una vez corriendo en el servidor, un
 * "FormData" no tiene ningún tipo real, y nada impide que alguien llame a la
 * Server Action directamente (sin pasar por el formulario de la UI) con
 * cualquier valor en cualquier campo. Antes de esta capa, casi todas las
 * acciones hacían `String(formData.get("x") || "")` o `Number(...)` a mano,
 * sin techo de longitud, sin chequear que un enum (estado, categoría,
 * prioridad) fuera uno de los valores válidos, y sin validar que un monto de
 * dinero fuera un número real y no negativo. Acá se valida la FORMA de los
 * datos — quién puede mandarlos lo sigue decidiendo canEdit/canApprove en
 * cada acción, eso no cambia.
 */

/** FormData -> objeto plano de strings (los campos File, como las fotos, se
 * excluyen a propósito: esos se procesan aparte con saveUploadedFile). */
function formToObject(formData: FormData): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") obj[key] = value;
  }
  return obj;
}

/**
 * Valida un FormData contra un esquema Zod. Si algo no cumple, tira un Error
 * con un mensaje en español (mismo criterio que ya usa el resto del código:
 * `throw new Error("Falta el nombre del socio")`, etc.), así llega igual de
 * claro a la pantalla que ve la persona que cargó el formulario.
 */
export function parseForm<T extends z.ZodTypeAny>(schema: T, formData: FormData): z.infer<T> {
  const result = schema.safeParse(formToObject(formData));
  if (!result.success) {
    const primero = result.error.issues[0];
    const campo = primero?.path?.length ? String(primero.path[primero.path.length - 1]) : "";
    // Los errores de conversión de tipo (ej: "monto" no es un número) trae un
    // mensaje interno en inglés — para esos casos usamos un texto genérico en
    // español en vez del mensaje crudo de Zod.
    const generico = primero?.code === "invalid_type" || primero?.code === "invalid_format";
    const detalle = generico || !primero?.message ? "el valor no es válido" : primero.message;
    throw new Error(campo ? `Dato inválido en "${campo}": ${detalle}` : "Datos inválidos.");
  }
  return result.data;
}

// ---------- Bloques reutilizables ----------

/** Id de fila (entero positivo) — para ids obligatorios que vienen del formulario. */
export const zId = z.coerce.number().int().positive();

/** Id opcional: string vacío/ausente -> null. */
export const zIdOpcional = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? Number(v) : null))
  .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Id inválido.");

/** Texto obligatorio: recorta espacios, exige contenido y pone un techo de
 * longitud razonable (evita que alguien mande un texto gigante en un campo
 * pensado para un título o un nombre corto). */
export const zTexto = (max = 300) => z.string().trim().min(1, "Es obligatorio.").max(max, `Máximo ${max} caracteres.`);

/** Texto opcional: recorta espacios, techo de longitud, vacío -> null (mismo
 * criterio que ya usaba el código con `String(x || "") || null`). */
export const zTextoOpcional = (max = 3000) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null));

/** Monto de dinero: número finito y no negativo, con un techo alto pero real
 * — sin esto, un campo "monto" acepta literalmente cualquier string
 * (incluido texto, o un número absurdo por error de tipeo) sin que nadie se
 * entere hasta el cierre contable. */
export const zMonto = (max = 1_000_000_000) =>
  z.coerce.number().finite().min(0, "No puede ser negativo.").max(max, "El monto es demasiado alto — revisá el valor.");

/** Monto obligatorio y mayor a cero (para movimientos de dinero reales). */
export const zMontoPositivo = (max = 1_000_000_000) =>
  z.coerce.number().finite().gt(0, "Tiene que ser mayor a cero.").max(max, "El monto es demasiado alto — revisá el valor.");

/** Monto opcional: vacío/0 -> null (mismo criterio que ya usaba el código
 * con `Number(x || 0) || null`). */
export const zMontoOpcional = (max = 1_000_000_000) =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) || null : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= max), "Monto inválido.");

/** Cantidad opcional numérica >= 0, default un valor fijo si no viene. */
export const zNumeroOpcionalConDefault = (def: number, max = 1_000_000) =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v !== undefined && v !== "" ? Number(v) : def))
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= max, "Número inválido.");

/** Entero opcional (ej: días de plazo de entrega): vacío -> null. */
export const zEnteroOpcional = (max = 100_000) =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= max), "Número inválido.");

/** Claves de un Record<string, string> como tupla no vacía — para reusar los
 * mapas de etiquetas de constants.ts (CATEGORIA_COMPRA_LABEL, etc.) como la
 * lista de valores permitidos en un enum, sin mantener la lista dos veces. */
export function clavesDe<T extends Record<string, unknown>>(record: T): [string, ...string[]] {
  const keys = Object.keys(record);
  if (keys.length === 0) throw new Error("clavesDe: el record está vacío");
  return keys as [string, ...string[]];
}

/** Fecha "YYYY-MM-DD" (lo que mandan los <input type="date">) obligatoria. */
export const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

/** Fecha y hora "YYYY-MM-DDTHH:mm" (lo que mandan los <input type="datetime-local">). */
export const zFechaHora = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Fecha y hora inválidas.");

/** Fecha opcional: vacío -> null. */
export const zFechaOpcional = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida.");

/** Email opcional: formato válido o vacío -> null (documento de contacto,
 * no de login). */
export const zEmailOpcional = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .optional()
  .or(z.literal(""))
  .refine((v) => !v || z.string().email().safeParse(v).success, "Email inválido.")
  .transform((v) => (v ? v : null));

/** Enum obligatorio contra una lista fija de valores permitidos — para
 * "estado", "categoría", "prioridad", etc. cuando la UI ya ofrece un
 * <select> cerrado: si algo no está en la lista, se rechaza en vez de
 * guardarse tal cual en la base. */
export function zEnumSeguro<T extends readonly [string, ...string[]]>(valores: T, fallback?: T[number]) {
  const mensaje = `Tiene que ser uno de: ${valores.join(", ")}.`;
  const permitidos = new Set<string>(valores);
  if (fallback !== undefined) {
    return z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : fallback) as T[number])
      .refine((v) => permitidos.has(v), mensaje);
  }
  return z.string().refine((v): v is T[number] => permitidos.has(v), mensaje);
}

/** Checkbox HTML: llega como "on" cuando está tildado, o ausente si no. */
export const zCheckbox = z
  .string()
  .optional()
  .transform((v) => v === "on");
