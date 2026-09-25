"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run, relanzarConMensajeSiFaltaTabla } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFecha, zCheckbox } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { CATEGORIAS_ACTIVIDAD, COLORES_PERSONALIZADOS, RECORDATORIO_OPCIONES } from "@/lib/calendarCategories";

// Notas de calendario personalizadas (pedido explícito original, 15/09): a
// diferencia del resto del calendario (que solo muestra fechas que ya existen
// en otro módulo — reuniones, obra, etc.), esto es texto libre que cualquiera
// puede escribir directo en una fecha, con su propia categoría, desde el
// Dashboard o desde /calendario — las dos pantallas usan las mismas acciones.
//
// Rediseño del Calendario, Etapa 1 (25/09, pedido explícito): "nota" pasa a
// ser una "actividad" mucho más rica — responsable, comisión, ubicación,
// "todo el día", color propio para actividades personalizadas y preferencia
// de recordatorio, todos opcionales (sólo título+fecha son obligatorios,
// punto 29 del pedido: "el sistema debe validar solamente lo necesario").
// Los nombres de función/tabla siguen diciendo "Nota" a propósito — mismo
// criterio ya establecido en este archivo para la columna "color" (sigue
// llamándose así en la base aunque hoy es la categoría): renombrar
// funciones/archivo agregaría movimiento de código sin ningún beneficio
// funcional. El texto que ve la persona (en MonthCalendar.tsx) sí dice
// "Actividad" en todos lados, que es lo que importa.
//
// El campo "color" sigue guardando la CATEGORÍA (ver calendarCategories.ts),
// no un color literal — ver el comentario original más abajo. Lo nuevo es que
// ahora puede ser NULL ("sin categoría", migración 0042, punto 8 del pedido:
// "no obligar al usuario a asignar una categoría").
const notaSchema = z.object({
  fecha: zFecha,
  hora: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{2}:\d{2}$/.test(v), "Hora inválida."),
  todo_el_dia: zCheckbox,
  titulo: zTexto(150),
  // Categoría: opcional (vacío -> null = "sin categoría"). El catálogo real
  // que ofrece el <select> es CATEGORIAS_ACTIVIDAD (10 valores, ver
  // calendarCategories.ts) — a propósito más chico que CATEGORIAS_EVENTO
  // completo, que además tiene valores legacy (obra/importante/personal) que
  // ya no se ofrecen para elegir de nuevo, sólo se siguen leyendo bien en
  // notas viejas que los tengan guardados.
  color: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || (CATEGORIAS_ACTIVIDAD as readonly string[]).includes(v), "Tiene que ser una categoría válida."),
  color_personalizado: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || (COLORES_PERSONALIZADOS as readonly string[]).includes(v), "Color inválido."),
  descripcion: zTextoOpcional(1000),
  responsable_id: zIdOpcional,
  comision_id: zIdOpcional,
  ubicacion: zTextoOpcional(200),
  recordatorio: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || (RECORDATORIO_OPCIONES as readonly string[]).includes(v), "Recordatorio inválido."),
});

/**
 * Categoría "personalizada" (punto 7 del pedido): exige elegir un color
 * propio — para el resto de las categorías, color_personalizado no tiene
 * sentido (se ignora si viene cargado igual, no se guarda) y "sin categoría"
 * tampoco lo necesita.
 */
function validarColorPersonalizado<T extends { color: string | null; color_personalizado: string | null }>(datos: T): T {
  if (datos.color === "personalizada" && !datos.color_personalizado) {
    throw new Error("Elegí un color para la actividad personalizada.");
  }
  return datos.color === "personalizada" ? datos : { ...datos, color_personalizado: null };
}

/** "Todo el día" (punto 11): si está tildado, la hora no aplica — se limpia
 * acá en vez de confiar en que el formulario nunca mande las dos cosas juntas. */
function limpiarHoraSiTodoElDia<T extends { todo_el_dia: boolean; hora: string | null }>(datos: T): T {
  return datos.todo_el_dia ? { ...datos, hora: null } : datos;
}

function puedeModificar(user: SessionUser, autorId: number) {
  return autorId === user.id || user.rol === "admin" || user.rol === "consejo_directivo";
}

const MENSAJE_TABLA_FALTANTE =
  "Todavía no se activaron las actividades de calendario en esta cooperativa — falta correr una actualización pendiente del sistema.";

export async function crearNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const datos = limpiarHoraSiTodoElDia(validarColorPersonalizado(parseForm(notaSchema, formData)));
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
  const { id, ...datosSinLimpiar } = parseForm(notaConIdSchema, formData);
  const datos = limpiarHoraSiTodoElDia(validarColorPersonalizado(datosSinLimpiar));
  try {
    const nota = await get<{ autor_id: number }>(`SELECT autor_id FROM notas_calendario WHERE id = ?`, [id]);
    if (!nota) throw new Error("Esa actividad ya no existe — puede que alguien ya la haya borrado.");
    if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés editar una actividad que no creaste vos.");
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
    if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés borrar una actividad que no creaste vos.");
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
