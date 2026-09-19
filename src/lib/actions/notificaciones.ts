"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, run } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseForm, zId } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

// Fase 7 del sistema de gestión de Comisiones (19/09, sección "comunicaciones/
// notificaciones"): bandeja real de eventos puntuales por usuario (tabla
// `notificaciones`, migración 0029) — distinta y complementaria de `alertas`
// (motor de reglas recalculado que ya existía y sigue funcionando exactamente
// igual, ver upsertAlerta en db.ts). Una alerta es una regla que se
// recalcula ("hay 3 cuotas vencidas"); una notificación es un evento puntual
// que ya pasó ("te llegó esta solicitud", "te asignaron esta tarea").
//
// `crearNotificacion`/`crearNotificacionesParaUsuarios` son helpers que
// llaman las OTRAS acciones del sistema (solicitudes.ts, tareas.ts,
// reuniones.ts, decisiones.ts, comunicaciones.ts) para avisar a la persona
// correcta apenas pasa el evento real — a propósito NUNCA hacen fallar la
// acción original si algo sale mal acá (una notificación que no se pudo
// crear no debería tirar abajo, por ejemplo, la creación de una solicitud
// real). Ver el catch interno de crearNotificacion.
//
// Alcance deliberado de esta fase: se cubren los eventos que ya tienen una
// acción concreta que los dispara ahora mismo (solicitud recibida, solicitud
// cambia de estado, tarea asignada, invitación a una reunión, votación
// abierta, decisión publicada, comunicación nueva). "vencimiento_proximo" y
// "tarea_vencida" (de la lista completa en el comentario de la migración)
// necesitan un job programado que recalcule fechas — no existe todavía en
// este entorno (mismo tipo de infraestructura que el motor de `alertas`, que
// sí lo tiene) — y "documento_relevante" depende de Documentos con contexto,
// que es la Fase 8. Quedan para más adelante, no es un olvido.

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
    // `notificaciones` todavía no exista en esta base (migración 0029
    // pendiente) ni por ningún otro error puntual.
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

const marcarLeidaSchema = z.object({ id: zId });

export async function marcarNotificacionLeidaAction(formData: FormData) {
  const user = await requireUser();
  const { id } = parseForm(marcarLeidaSchema, formData);
  await run(`UPDATE notificaciones SET leida = true WHERE id = ? AND user_id = ?`, [id, user.id]);
  revalidatePath("/notificaciones");
}

export async function marcarNotificacionLeidaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => marcarNotificacionLeidaAction(formData));
}

export async function marcarTodasNotificacionesLeidasAction() {
  const user = await requireUser();
  await run(`UPDATE notificaciones SET leida = true WHERE user_id = ? AND leida = false`, [user.id]);
  revalidatePath("/notificaciones");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma fija que exige useActionState/ActionForm, esta acción no necesita ningún campo del formulario.
export async function marcarTodasNotificacionesLeidasFormAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => marcarTodasNotificacionesLeidasAction());
}
