"use server";

import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";

export async function crearReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const tipo = String(formData.get("tipo") || "comision"); // asamblea | consejo_directivo | comision
  const comisionIdRaw = String(formData.get("comision_id") || "");
  const titulo = String(formData.get("titulo") || "").trim();
  const fecha = String(formData.get("fecha") || "");
  if (!titulo || !fecha) throw new Error("Faltan datos obligatorios (título y fecha)");

  const id = await insert("reuniones", {
    tipo,
    comision_id: tipo === "comision" && comisionIdRaw ? Number(comisionIdRaw) : null,
    titulo,
    fecha,
    lugar: String(formData.get("lugar") || "") || null,
    orden_del_dia: String(formData.get("orden_del_dia") || "") || null,
    estado: "planificada",
    creado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "reuniones", entidad_id: id, valor_nuevo: { titulo, fecha, tipo } });
  revalidatePath("/reuniones");
}

export async function cancelarReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  await update("reuniones", id, { estado: "cancelada" });
  await audit({ usuario_id: user.id, accion: "cancelar", entidad: "reuniones", entidad_id: id });
  revalidatePath("/reuniones");
  revalidatePath(`/reuniones/${id}`);
}

/**
 * Registra o actualiza la asistencia de un núcleo familiar a una reunión.
 * Mismo criterio que las asistencias de jornadas de trabajo: se guarda por
 * núcleo, no por persona individual.
 */
export async function registrarAsistenciaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const reunion_id = Number(formData.get("reunion_id"));
  const nucleo_id = Number(formData.get("nucleo_id"));
  const presente = formData.get("presente") === "on" ? 1 : 0;
  const justificacion = String(formData.get("justificacion") || "") || null;

  const existente = await get<{ id: number }>(
    `SELECT id FROM reunion_asistencias WHERE reunion_id = ? AND nucleo_id = ?`,
    [reunion_id, nucleo_id]
  );
  if (existente) {
    await update("reunion_asistencias", existente.id, { presente, justificacion });
  } else {
    await insert("reunion_asistencias", { reunion_id, nucleo_id, presente, justificacion });
  }
  revalidatePath(`/reuniones/${reunion_id}`);
}

/**
 * Cierra una reunión: la marca como realizada y genera (o reutiliza) el acta
 * correspondiente, enlazada a la reunión. La tabla "actas" ya existía en el
 * sistema (documentos > Actas y resoluciones); acá se completa el circuito
 * para que no haya que cargarla suelta a mano.
 */
export async function cerrarReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const reunion_id = Number(formData.get("id"));
  const resumen = String(formData.get("resumen") || "").trim();
  if (!resumen) throw new Error("Falta el resumen del acta");

  const reunion = await get<any>(`SELECT * FROM reuniones WHERE id = ?`, [reunion_id]);
  if (!reunion) throw new Error("Reunión no encontrada");

  let actaId = reunion.acta_id;
  if (!actaId) {
    actaId = await insert("actas", {
      organo: reunion.tipo, // asamblea | consejo_directivo | comision
      fecha: reunion.fecha,
      titulo: reunion.titulo,
      resumen,
      reunion_id,
    });
  } else {
    await update("actas", actaId, { resumen });
  }

  await update("reuniones", reunion_id, { estado: "realizada", acta_id: actaId });
  await audit({ usuario_id: user.id, accion: "cerrar", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: { acta_id: actaId } });
  revalidatePath("/reuniones");
  revalidatePath(`/reuniones/${reunion_id}`);
  revalidatePath("/documentos");
}
