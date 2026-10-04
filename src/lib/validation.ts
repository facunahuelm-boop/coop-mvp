import { z } from "zod";
import { MENSAJES, esNombreValido, esDocumentoValido, esTelefonoValido } from "./mensajesValidacion";

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
 * Fase 3 (sistema global de errores, REQUIREMENTS.md): error de validación de
 * UN campo puntual. `.message` queda exactamente igual que el Error genérico
 * que se lanzaba antes (nada que ya capture `err.message` se rompe), pero
 * ahora también viaja `.field` — el nombre del campo — para que quien atrapa
 * el error (ver src/lib/actionState.ts) pueda mostrar el mensaje pegado al
 * campo exacto en el formulario, no solo como un cartel general.
 */
export class ValidationError extends Error {
  field: string;
  /** Testing funcional (04/10): TODOS los campos con error (campo -> mensaje),
   * no sólo el primero. Opcional para no romper ningún `throw new
   * ValidationError(campo, mensaje)` existente — sin él, vale sólo `field`. */
  fields: Record<string, string>;
  constructor(field: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
    this.fields = fields ?? { [field]: message };
  }
}

/**
 * Valida un FormData contra un esquema Zod. Si algo no cumple, tira un
 * ValidationError con un mensaje en español (mismo criterio que ya usa el
 * resto del código: `throw new Error("Falta el nombre del socio")`, etc.),
 * así llega igual de claro a la pantalla que ve la persona que cargó el
 * formulario — y, en los formularios ya migrados al sistema centralizado de
 * errores (Fase 3), pegado al campo exacto en vez de solo un cartel general.
 */
export function parseForm<T extends z.ZodTypeAny>(schema: T, formData: FormData): z.infer<T> {
  const datos = formToObject(formData);
  const result = schema.safeParse(datos);
  if (!result.success) {
    // Testing funcional aislado (04/10) — dos problemas reales detectados
    // probando los formularios de punta a punta:
    //  1. Sólo se reportaba el PRIMER campo con error: con Nombre, Documento
    //     y Teléfono mal, la persona veía un solo mensaje, corregía, volvía a
    //     enviar y recién ahí se enteraba del siguiente. Ahora se juntan
    //     todos (el primer mensaje de cada campo).
    //  2. El mensaje llevaba un prefijo técnico — `Dato inválido en
    //     "telefono": ...` — que muestra el nombre INTERNO del campo, justo lo
    //     que el pedido de validaciones (28/09) pide no mostrar nunca. Ahora
    //     el mensaje es sólo el texto en español, pegado al campo.
    const porCampo: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const campo = issue.path?.length ? String(issue.path[issue.path.length - 1]) : "";
      if (!campo || porCampo[campo]) continue;
      // Los errores de conversión de tipo (ej: "monto" no es un número) traen
      // un mensaje interno en inglés — para esos usamos un texto en español.
      // Revisión 04/10 (secciones 7, 11 y 12 del pedido): si el campo llegó
      // vacío, cualquier error es por faltar un dato obligatorio — un campo
      // opcional vacío nunca falla —, así que se dice siempre lo mismo:
      // "Este campo es obligatorio." Si vino algo que no es un número en un
      // campo numérico (ej. "ABC" en un importe), "Ingresá un valor numérico
      // válido.".
      const vacio = datos[campo] === undefined || String(datos[campo]).trim() === "";
      const esperabaNumero = issue.code === "invalid_type" && (issue as { expected?: string }).expected === "number";
      const generico = issue.code === "invalid_type" || issue.code === "invalid_format" || !issue.message;
      porCampo[campo] = vacio
        ? MENSAJES.obligatorio
        : esperabaNumero
          ? MENSAJES.numero
          : generico
            ? "El valor ingresado no es válido."
            : issue.message;
    }
    const campos = Object.keys(porCampo);
    if (campos.length) throw new ValidationError(campos[0], porCampo[campos[0]], porCampo);
    throw new Error("Datos inválidos.");
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
export const zTexto = (max = 300) => z.string().trim().min(1, MENSAJES.obligatorio).max(max, `Máximo ${max} caracteres.`);

/** Texto opcional: recorta espacios, techo de longitud, vacío -> null (mismo
 * criterio que ya usaba el código con `String(x || "") || null`).
 *
 * H-7 (auditoría integral, 27/09): además de `undefined`/`""`, acepta `null`
 * como entrada válida (`.nullable()`) — el flujo de Importar (`/importar`)
 * valida cada fila dos veces: primero en la vista previa, y de nuevo al
 * confirmar, usando el MISMO esquema sobre el resultado YA transformado de
 * la primera pasada (que ya convirtió los campos vacíos a `null`, ver el
 * `.transform` de abajo). Sin `.nullable()` acá, ese `null` no pasaba el
 * `safeParse` de la segunda vuelta y la fila se descartaba en silencio
 * aunque la vista previa la hubiera marcado como válida — confirmado en
 * vivo con Playwright en los dos importadores (socios y movimientos). No
 * cambia ningún comportamiento para el resto del sistema: todo lo demás
 * sigue mandando `undefined`/`""` desde un FormData real, nunca `null`. */
export const zTextoOpcional = (max = 3000) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .optional()
    .or(z.literal(""))
    .nullable()
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
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= max), MENSAJES.numero);

/** Cantidad opcional numérica >= 0, default un valor fijo si no viene. */
export const zNumeroOpcionalConDefault = (def: number, max = 1_000_000) =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v !== undefined && v !== "" ? Number(v) : def))
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= max, MENSAJES.numero);

/** Entero opcional (ej: días de plazo de entrega): vacío -> null. */
export const zEnteroOpcional = (max = 100_000) =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= max), MENSAJES.numero);

/** Claves de un Record<string, string> como tupla no vacía — para reusar los
 * mapas de etiquetas de constants.ts (CATEGORIA_COMPRA_LABEL, etc.) como la
 * lista de valores permitidos en un enum, sin mantener la lista dos veces. */
export function clavesDe<T extends Record<string, unknown>>(record: T): [string, ...string[]] {
  const keys = Object.keys(record);
  if (keys.length === 0) throw new Error("clavesDe: el record está vacío");
  return keys as [string, ...string[]];
}

/** Fecha "YYYY-MM-DD" (lo que mandan los <input type="date">) obligatoria. */
export const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, MENSAJES.fecha);

/** Fecha y hora "YYYY-MM-DDTHH:mm" (lo que mandan los <input type="datetime-local">). */
export const zFechaHora = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, MENSAJES.fechaHora);

/** Fecha opcional: vacío -> null.
 *
 * H-7 (auditoría integral, 27/09): agregado `.nullable()` — mismo motivo que
 * en `zTextoOpcional` de arriba (el flujo de Importar re-valida cada fila con
 * el mismo esquema sobre datos ya transformados en la vista previa, donde los
 * campos vacíos ya vinieron convertidos a `null`). El `.refine` ya trataba
 * `null` como válido (`v === null || ...`), así que no hace falta tocarlo. */
export const zFechaOpcional = z
  .string()
  .optional()
  .or(z.literal(""))
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), MENSAJES.fecha);

/** Email opcional: formato válido o vacío -> null (documento de contacto,
 * no de login).
 *
 * H-7 (auditoría integral, 27/09): agregado `.nullable()` — mismo motivo que
 * en `zTextoOpcional`/`zFechaOpcional` de arriba. El `.refine` ya trataba
 * valores falsy (incluido `null`) como válidos (`!v || ...`), así que no hace
 * falta tocarlo. */
export const zEmailOpcional = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .optional()
  .or(z.literal(""))
  .nullable()
  .refine((v) => !v || z.string().email().safeParse(v).success, MENSAJES.email)
  .transform((v) => (v ? v : null));

/** Nombre de persona/empresa (mejora global de validaciones, 28/09, pedido
 * explícito — sección 3): mismo criterio de `zTexto` (obligatorio, recorta
 * espacios, techo de longitud) más un rechazo puntual de lo que claramente
 * NO es un nombre: un valor compuesto 100% por dígitos (ej. "123456"
 * cargado por error en el campo equivocado). A propósito LAXO en todo lo
 * demás — números de casa/piso dentro de un nombre compuesto ("Juan Carlos
 * 2do"), apóstrofes, guiones, tildes, etc. siguen aceptándose sin problema:
 * el pedido es evitar el caso obvio, no imponer una gramática estricta de
 * nombres propios. Se usa para Nombre/Apellido/nombre de contacto/proveedor/
 * comisión/empresa — donde antes se usaba `zTexto` sin este chequeo extra. */
export const zNombre = (max = 200) =>
  z
    .string()
    .trim()
    .min(1, MENSAJES.obligatorio)
    .max(max, `Máximo ${max} caracteres.`)
    .refine(esNombreValido, MENSAJES.nombre);

/** Documento de identidad (cédula, RUT, número de identificación) —
 * obligatorio (mejora global de validaciones, 28/09, pedido explícito —
 * sección 4). Sólo rechaza lo que el pedido pide rechazar explícitamente:
 * letras. A propósito NO fuerza un largo de dígitos fijo ni un formato con
 * puntos/guión específico — cada cooperativa/país tiene su propio formato
 * (cédula uruguaya "1.234.567-8", RUT de empresa con más dígitos, un
 * documento extranjero) y el pedido es explícito en "respetar el formato
 * actual del sistema, no eliminar caracteres válidos" — mismo criterio laxo
 * que ya usa `zTelefonoOpcional` de abajo para el mismo motivo. Acepta
 * dígitos y los separadores que ya se usan al tipear un documento (puntos,
 * guión, espacios). */
export const zDocumento = (max = 50) =>
  z
    .string()
    .trim()
    .min(1, MENSAJES.obligatorio)
    .max(max, `Máximo ${max} caracteres.`)
    .refine(esDocumentoValido, MENSAJES.documento);

/** Documento opcional: mismo criterio que `zDocumento`, vacío -> null. */
export const zDocumentoOpcional = (max = 50) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .optional()
    .or(z.literal(""))
    .nullable()
    .refine((v) => !v || esDocumentoValido(v), MENSAJES.documento)
    .transform((v) => (v ? v : null));

/** Teléfono obligatorio: mismo formato/criterio laxo que `zTelefonoOpcional`
 * de abajo, pero sin permitir vacío — para los formularios donde el celular
 * pasa a ser un campo requerido (mejora global de validaciones, 28/09). */
export const zTelefono = z
  .string()
  .trim()
  .min(1, MENSAJES.obligatorio)
  .max(50)
  .refine(esTelefonoValido, MENSAJES.telefono);

/** Teléfono opcional (15/09, pedido explícito — antes no existía ninguna
 * validación de formato acá, todo teléfono era `zTextoOpcional(50)`, texto
 * libre). A propósito LAXO en el formato: cada cooperativa/país escribe un
 * teléfono distinto (con o sin código de país, con o sin guiones/paréntesis:
 * "+54 9 11 1234-5678", "(011) 15-1234-5678", "1123456789") — el pedido es
 * explícito en "permitir formatos razonables según configuración regional,
 * no ser demasiado rígido". Sólo rechaza lo que claramente NO es un
 * teléfono: letras, o muy pocos dígitos reales. Vacío -> null. */
/* H-7 (auditoría integral, 27/09): agregado `.nullable()` — mismo motivo que
 * en los validadores de arriba. Ambos `.refine` ya trataban valores falsy
 * (incluido `null`) como válidos (`!v || ...`), así que no hace falta
 * tocarlos. */
export const zTelefonoOpcional = z
  .string()
  .trim()
  .max(50)
  .optional()
  .or(z.literal(""))
  .nullable()
  .refine((v) => !v || esTelefonoValido(v), MENSAJES.telefono)
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
