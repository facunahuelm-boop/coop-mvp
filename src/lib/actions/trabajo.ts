"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { proponerDistribucionJornada } from "@/lib/logic";
import { parseForm, zId, zFecha, zTextoOpcional, zNumeroOpcionalConDefault, zCheckbox } from "@/lib/validation";

const crearJornadaSchema = z.object({
  fecha: zFecha,
  descripcion: zTextoOpcional(1000),
  herramientas_necesarias: zTextoOpcional(1000),
  tareas: z.string().max(5000).optional().or(z.literal("")),
});

export async function crearJornadaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "trabajo")) throw new Error("No autorizado");
  const datos = parseForm(crearJornadaSchema, formData);
  const id = await insert("jornadas_trabajo", {
    fecha: datos.fecha,
    descripcion: datos.descripcion,
    herramientas_necesarias: datos.herramientas_necesarias,
    estado: "planificada",
  });
  const nombres = String(datos.tareas || "")
    .split("\n")
    .map((s) => s.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 100); // techo razonable: una jornada no va a tener más de 100 tareas cargadas a mano
  await Promise.all(
    nombres.map((nombre) => insert("tareas_jornada", { jornada_id: id, nombre, prioridad: "media", personas_necesarias: 3 }))
  );
  revalidatePath("/trabajo");
}

export async function proponerDistribucionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "trabajo")) throw new Error("No autorizado");
  const { jornada_id: jornadaId } = parseForm(z.object({ jornada_id: zId }), formData);
  await proponerDistribucionJornada(jornadaId);
  revalidatePath("/trabajo");
}

export async function confirmarAsignacionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "trabajo")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("asignaciones_jornada", id, { confirmado: 1 });
  revalidatePath("/trabajo");
}

export async function anotarmeAction(formData: FormData) {
  const user = await requireUser();
  if (!user.nucleo_id) throw new Error("Tu usuario no tiene un núcleo familiar asociado.");
  const { tarea_jornada_id: tareaJornadaId, jornada_id: jornadaId } = parseForm(
    z.object({ tarea_jornada_id: zId, jornada_id: zId }),
    formData
  );
  await insert("asignaciones_jornada", { jornada_id: jornadaId, tarea_jornada_id: tareaJornadaId, nucleo_id: user.nucleo_id, propuesta_por_ia: 0, confirmado: 1 });
  revalidatePath("/trabajo");
}

const registrarAsistenciaSchema = z.object({
  jornada_id: zId,
  nucleo_id: zId,
  presente: zCheckbox,
  horas: zNumeroOpcionalConDefault(0, 24),
});

export async function registrarAsistenciaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "trabajo")) throw new Error("No autorizado");
  const { jornada_id: jornadaId, nucleo_id: nucleoId, presente: presenteBool, horas } = parseForm(registrarAsistenciaSchema, formData);
  const presente = presenteBool ? 1 : 0;
  const existing = await get<any>(`SELECT id FROM asistencias WHERE jornada_id = ? AND nucleo_id = ?`, [jornadaId, nucleoId]);
  if (existing) {
    await update("asistencias", existing.id, { presente, horas });
  } else {
    await insert("asistencias", { jornada_id: jornadaId, nucleo_id: nucleoId, presente, horas });
  }
  if (presente && horas > 0) {
    const nucleo = await get<any>(`SELECT * FROM nucleos_familiares WHERE id = ?`, [nucleoId]);
    await update("nucleos_familiares", nucleoId, { horas_acumuladas: (nucleo?.horas_acumuladas || 0) + horas });
  }
  await audit({ usuario_id: user.id, accion: "registrar_asistencia", entidad: "asistencias", entidad_id: nucleoId, valor_nuevo: { jornadaId, presente, horas } });
  revalidatePath(`/trabajo/${jornadaId}`);
}

export async function marcarJornadaRealizadaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "trabajo")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("jornadas_trabajo", id, { estado: "realizada" });
  revalidatePath("/trabajo");
  revalidatePath(`/trabajo/${id}`);
}
