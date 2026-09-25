"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run, relanzarConMensajeSiFaltaTabla } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFecha, zFechaOpcional, zCheckbox } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import {
  CATEGORIAS_ACTIVIDAD,
  COLORES_PERSONALIZADOS,
  RECORDATORIO_OPCIONES,
  FRECUENCIAS_RECURRENCIA,
  ALCANCES_SERIE,
  MAX_OCURRENCIAS_SERIE,
  fechasDeSerie,
  type FrecuenciaRecurrencia,
  type AlcanceSerie,
} from "@/lib/calendarCategories";

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
//
// Rediseño del Calendario, Etapa 2 (25/09, pedido explícito, punto 12):
// actividades que se repiten. Decisiones confirmadas con el usuario (ver
// migrations/0043_recurrencia_calendario.sql para el detalle completo):
// presets simples de frecuencia, fecha límite siempre obligatoria, y al
// editar/borrar una actividad de una serie se ofrecen las 3 opciones estilo
// Google Calendar ("solo esta" / "esta y las siguientes" / "todas").
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

/** "no_repite" es el valor del <select> de frecuencia que significa "actividad
 * suelta, sin serie" — no es una FrecuenciaRecurrencia real y nunca se guarda
 * en la base (ver migrations/0043). */
const frecuenciaSchema = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : "no_repite"))
  .refine((v) => v === "no_repite" || (FRECUENCIAS_RECURRENCIA as readonly string[]).includes(v), "Frecuencia inválida.");

const crearConRecurrenciaSchema = notaSchema.extend({
  frecuencia: frecuenciaSchema,
  fecha_fin_serie: zFechaOpcional,
});

export async function crearNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const { frecuencia, fecha_fin_serie, ...resto } = parseForm(crearConRecurrenciaSchema, formData);
  const datos = limpiarHoraSiTodoElDia(validarColorPersonalizado(resto));
  try {
    if (frecuencia === "no_repite") {
      await insert("notas_calendario", { ...datos, autor_id: user.id, serie_id: null });
    } else {
      if (!fecha_fin_serie) throw new Error('Elegí hasta cuándo se repite la actividad ("Repetir hasta").');
      if (fecha_fin_serie < datos.fecha) throw new Error('La fecha de "Repetir hasta" no puede ser anterior a la fecha de la actividad.');
      const fechas = fechasDeSerie(datos.fecha, fecha_fin_serie, frecuencia as FrecuenciaRecurrencia);
      if (fechas.length > MAX_OCURRENCIAS_SERIE) {
        throw new Error(
          `Esa repetición generaría ${fechas.length} actividades — el máximo por serie es ${MAX_OCURRENCIAS_SERIE}. Elegí una fecha de "Repetir hasta" más cercana.`
        );
      }
      const serieId = await insert("series_calendario", {
        autor_id: user.id,
        frecuencia,
        fecha_fin: fecha_fin_serie,
      });
      // Se insertan una por una (no hay helper de insert masivo en este
      // proyecto, ver src/lib/db.ts) — el tope de arriba (MAX_OCURRENCIAS_SERIE)
      // existe justamente para que esto nunca sean más de 200 inserts.
      for (const fecha of fechas) {
        await insert("notas_calendario", { ...datos, fecha, autor_id: user.id, serie_id: serieId });
      }
    }
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

const alcanceSchema = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : "solo"))
  .refine((v) => (ALCANCES_SERIE as readonly string[]).includes(v), "Alcance inválido.");

const notaConIdSchema = notaSchema.extend({ id: zId, alcance_serie: alcanceSchema });

export async function editarNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const { id, alcance_serie, ...datosSinLimpiar } = parseForm(notaConIdSchema, formData);
  const datos = limpiarHoraSiTodoElDia(validarColorPersonalizado(datosSinLimpiar));
  try {
    const nota = await get<{ autor_id: number; serie_id: number | null; fecha: string }>(
      `SELECT autor_id, serie_id, fecha FROM notas_calendario WHERE id = ?`,
      [id]
    );
    if (!nota) throw new Error("Esa actividad ya no existe — puede que alguien ya la haya borrado.");
    if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés editar una actividad que no creaste vos.");

    if (!nota.serie_id || alcance_serie === ("solo" as AlcanceSerie)) {
      // Actividad suelta, o "solo esta actividad" de una serie: se edita
      // exactamente igual que antes de la Etapa 2, incluida la fecha (mover
      // una sola ocurrencia a otro día es válido — pasa a ser una excepción
      // dentro de la serie, sigue contando para "borrar/editar toda la serie").
      await update("notas_calendario", id, datos);
    } else {
      // "esta y las siguientes" / "todas": se aplica a varias filas de la
      // misma serie de una — la fecha de CADA fila no se toca (no tendría
      // sentido pisarlas todas con la misma fecha), el resto de los campos sí.
      const { fecha: _fechaIgnorada, ...datosSinFecha } = datos;
      const params: (string | number | boolean | null)[] = [
        datosSinFecha.hora,
        datosSinFecha.todo_el_dia,
        datosSinFecha.titulo,
        datosSinFecha.color,
        datosSinFecha.color_personalizado,
        datosSinFecha.descripcion,
        datosSinFecha.responsable_id,
        datosSinFecha.comision_id,
        datosSinFecha.ubicacion,
        datosSinFecha.recordatorio,
        nota.serie_id,
      ];
      let sql = `UPDATE notas_calendario SET hora = ?, todo_el_dia = ?, titulo = ?, color = ?, color_personalizado = ?, descripcion = ?, responsable_id = ?, comision_id = ?, ubicacion = ?, recordatorio = ? WHERE serie_id = ?`;
      if (alcance_serie === ("siguientes" as AlcanceSerie)) {
        sql += ` AND fecha >= ?`;
        // Se usa la fecha ORIGINAL de la ocurrencia editada (la que ya tenía
        // en la base antes de este submit), no lo que haya en el campo Fecha
        // del formulario — en "esta y las siguientes"/"todas" ese campo se
        // ignora a propósito (ver datosSinFecha arriba), así que tomar el
        // corte de ahí sería inconsistente si alguien llegó a tocarlo.
        params.push(nota.fecha);
      }
      await run(sql, params);
    }
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

const eliminarSchema = z.object({ id: zId, alcance_serie: alcanceSchema });

export async function eliminarNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const { id, alcance_serie } = parseForm(eliminarSchema, formData);
  try {
    const nota = await get<{ autor_id: number; serie_id: number | null; fecha: string }>(
      `SELECT autor_id, serie_id, fecha FROM notas_calendario WHERE id = ?`,
      [id]
    );
    if (!nota) return; // ya no está, no hay nada que borrar
    if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés borrar una actividad que no creaste vos.");

    if (!nota.serie_id || alcance_serie === ("solo" as AlcanceSerie)) {
      await run(`DELETE FROM notas_calendario WHERE id = ?`, [id]);
    } else if (alcance_serie === ("siguientes" as AlcanceSerie)) {
      await run(`DELETE FROM notas_calendario WHERE serie_id = ? AND fecha >= ?`, [nota.serie_id, nota.fecha]);
    } else {
      await run(`DELETE FROM notas_calendario WHERE serie_id = ?`, [nota.serie_id]);
      // Si no queda ninguna ocurrencia de la serie (que es siempre el caso acá,
      // "todas" borra todas), se borra también la fila de series_calendario —
      // si quedara huérfana no rompe nada (ON DELETE SET NULL), pero no tiene
      // sentido dejar basura acumulándose en esa tabla.
      await run(`DELETE FROM series_calendario WHERE id = ?`, [nota.serie_id]);
    }
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
