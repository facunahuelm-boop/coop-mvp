"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run, relanzarConMensajeSiFaltaTabla } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { parseForm, zId, zTexto, zTextoOpcional, zFecha, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { CATEGORIAS_EVENTO } from "@/lib/calendarCategories";

// Notas de calendario personalizadas (pedido explícito): a diferencia del
// resto del calendario (que solo muestra fechas que ya existen en otro
// módulo — reuniones, obra, etc.), esto es texto libre que cualquiera puede
// escribir directo en una fecha, con su propia categoría, desde el
// Dashboard o desde /calendario — las dos pantallas usan las mismas tres
// acciones.
//
// Rediseño del Calendario (15/09): el campo sigue llamándose "color" en la
// base (notas_calendario.color, migración 0015) — se reutiliza esa misma
// columna TEXT sin CHECK constraint para guardar una de las 6 categorías
// nuevas del rediseño, en vez de agregar una columna "categoria" aparte o
// renombrar la existente (ambas hubieran sido una migración innecesaria
// para lo mismo). Ver `calendarCategories.ts` para el mapeo de compatibilidad
// con notas viejas que todavía tengan uno de los 5 valores anteriores
// (brand/verde/amarillo/rojo/gray) — siguen mostrándose bien, y en cuanto se
// editan y guardan de nuevo quedan con una categoría nueva.
const notaSchema = z.object({
  fecha: zFecha,
  hora: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{2}:\d{2}$/.test(v), "Hora inválida."),
  titulo: zTexto(150),
  color: zEnumSeguro(CATEGORIAS_EVENTO, "personal"),
  descripcion: zTextoOpcional(1000),
});

function puedeModificar(user: SessionUser, autorId: number) {
  return autorId === user.id || user.rol === "admin" || user.rol === "consejo_directivo";
}

const MENSAJE_TABLA_FALTANTE =
  "Todavía no se activaron las notas de calendario en esta cooperativa — falta correr una actualización pendiente del sistema.";

export async function crearNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const datos = parseForm(notaSchema, formData);
  try {
    await insert("notas_calendario", { ...datos, autor_id: user.id });
  } catch (err) {
    await relanzarConMensajeSiFaltaTabla(err, MENSAJE_TABLA_FALTANTE, {
      usuario_id: user.id,
      accion: "crear",
      entidad: "notas_calendario",
      entidad_id: 0,
    });
  }
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
}

/**
 * Fase 3 (sistema global de errores): variante de `crearNotaCalendarioAction`
 * pensada para `useActionState` (ver components/MonthCalendar.tsx) — esta es
 * la que se conecta al formulario. La acción original queda intacta y sigue
 * pudiendo llamarse directo si hiciera falta en otro lado.
 */
export async function crearNotaCalendarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearNotaCalendarioAction(formData));
}

const notaConIdSchema = notaSchema.extend({ id: zId });

export async function editarNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const { id, ...datos } = parseForm(notaConIdSchema, formData);
  try {
    const nota = await get<{ autor_id: number }>(`SELECT autor_id FROM notas_calendario WHERE id = ?`, [id]);
    if (!nota) throw new Error("Esa nota ya no existe — puede que alguien ya la haya borrado.");
    if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés editar una nota que no escribiste vos.");
    await update("notas_calendario", id, datos);
  } catch (err) {
    await relanzarConMensajeSiFaltaTabla(err, MENSAJE_TABLA_FALTANTE, {
      usuario_id: user.id,
      accion: "editar",
      entidad: "notas_calendario",
      entidad_id: id,
    });
  }
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
}

export async function editarNotaCalendarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarNotaCalendarioAction(formData));
}

export async function eliminarNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const { id } = parseForm(z.object({ id: zId }), formData);
  try {
    const nota = await get<{ autor_id: number }>(`SELECT autor_id FROM notas_calendario WHERE id = ?`, [id]);
    if (!nota) return; // ya no está, no hay nada que borrar
    if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés borrar una nota que no escribiste vos.");
    await run(`DELETE FROM notas_calendario WHERE id = ?`, [id]);
  } catch (err) {
    await relanzarConMensajeSiFaltaTabla(err, MENSAJE_TABLA_FALTANTE, {
      usuario_id: user.id,
      accion: "eliminar",
      entidad: "notas_calendario",
      entidad_id: id,
    });
  }
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
}

export async function eliminarNotaCalendarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarNotaCalendarioAction(formData));
}
