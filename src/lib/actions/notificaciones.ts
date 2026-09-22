"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/db";
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
// Los helpers que CREAN notificaciones (`crearNotificacion` /
// `crearNotificacionesParaUsuarios`), que llaman las otras acciones del
// sistema para avisar a la persona correcta apenas pasa el evento real, ya
// no viven acá: están en `src/lib/notificaciones.ts` por el hallazgo S-1 de
// la Fase 11 que se explica más abajo.
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

// Fase 11 (auditoría de seguridad, 22/09) — HALLAZGO S-1: `crearNotificacion`
// y `crearNotificacionesParaUsuarios` se MUDARON a `src/lib/notificaciones.ts`
// (módulo normal, sin "use server"). Estaban exportadas desde acá, y en el App
// Router toda función exportada de un módulo "use server" queda expuesta como
// endpoint RPC invocable desde el navegador — con lo cual cualquier usuario
// autenticado podía fabricar notificaciones falsas en la bandeja de otro.
// Acá quedan solo las acciones reales, que sí validan sesión con requireUser().

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
