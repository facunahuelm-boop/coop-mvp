"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zFechaOpcional, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacion } from "@/lib/notificaciones";

/** Fase 3I — encuestas rápidas y medidas propuestas (A25). */

async function conAviso(fn: () => Promise<string>): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await fn();
  });
  return r.ok ? { ...r, aviso } : r;
}
const emite = (u: SessionUser) => canEdit(u.rol, "socios") || canEdit(u.rol, "finanzas") || u.rol === "consejo_directivo";

// ---------- Encuestas ----------

const encuestaSchema = z.object({
  pregunta: zTexto(300),
  opciones: zTexto(2000),
  multiple: z.string().optional(),
  anonima: z.string().optional(),
  cierra_en: zFechaOpcional,
});

export async function crearEncuestaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    if (!emite(user)) throw new Error("Las encuestas las mandan la administración, la tesorería o el Consejo.");
    const d = parseForm(encuestaSchema, fd);
    const opciones = [...new Set(d.opciones.split("\n").map((o) => o.trim()).filter(Boolean))].slice(0, 10);
    if (opciones.length < 2) throw new ValidationError("opciones", "Poné al menos dos opciones, una por renglón.");
    const id = await insert("encuestas", {
      pregunta: d.pregunta,
      opciones: JSON.stringify(opciones),
      multiple: d.multiple === "1" ? 1 : 0,
      anonima: d.anonima === "0" ? 0 : 1,
      cierra_en: d.cierra_en ?? null,
      creado_por_id: user.id,
    });
    await audit({ usuario_id: user.id, accion: "crear", entidad: "encuestas", entidad_id: id, valor_nuevo: { pregunta: d.pregunta, opciones } });
    const usuarios = await all<{ id: number }>(`SELECT id FROM users WHERE activo = 1 AND id <> ?`, [user.id]).catch(() => []);
    for (const u of usuarios) await crearNotificacion({ user_id: u.id, tipo: "encuesta", titulo: `Encuesta: ${d.pregunta}`, ref_tabla: "encuestas", ref_id: id }).catch(() => {});
    revalidatePath("/encuestas");
    revalidatePath("/dashboard");
    return `Encuesta enviada a ${usuarios.length} persona(s).`;
  });
}

export async function responderEncuestaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    const { encuesta_id, comentario } = parseForm(z.object({ encuesta_id: zId, comentario: zTextoOpcional(500) }), fd);
    const e = await get<{ estado: string; opciones: string[]; multiple: number; cierra_en: string | null }>(`SELECT estado, opciones, multiple, cierra_en FROM encuestas WHERE id = ?`, [encuesta_id]);
    if (!e || e.estado !== "abierta" || (e.cierra_en && e.cierra_en < new Date().toISOString().slice(0, 10))) throw new Error("Esa encuesta ya está cerrada.");
    const elegidas = fd.getAll("opcion").map(String).filter((o) => e.opciones.includes(o));
    if (!elegidas.length) throw new ValidationError("opcion", "Elegí una opción.");
    if (!e.multiple && elegidas.length > 1) throw new ValidationError("opcion", "Elegí una sola opción.");
    const ya = await get<{ id: number }>(`SELECT id FROM encuesta_respuestas WHERE encuesta_id = ? AND user_id = ?`, [encuesta_id, user.id]);
    if (ya) await update("encuesta_respuestas", ya.id, { opciones: JSON.stringify(elegidas), comentario });
    else await insert("encuesta_respuestas", { encuesta_id, user_id: user.id, opciones: JSON.stringify(elegidas), comentario });
    await audit({ usuario_id: user.id, accion: "responder_encuesta", entidad: "encuestas", entidad_id: encuesta_id });
    revalidatePath("/encuestas");
    revalidatePath("/dashboard");
    return ya ? "Cambiaste tu respuesta." : "¡Gracias por responder!";
  });
}

export async function cerrarEncuestaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    if (!emite(user)) throw new Error("No tenés permiso para cerrar encuestas.");
    const { id, estado } = parseForm(z.object({ id: zId, estado: z.enum(["cerrada", "anulada"]) }), fd);
    const e = await get<{ estado: string }>(`SELECT estado FROM encuestas WHERE id = ?`, [id]);
    if (!e || e.estado !== "abierta") throw new Error("Esa encuesta ya no está abierta.");
    await update("encuestas", id, { estado, cerrada_en: new Date().toISOString() });
    await audit({ usuario_id: user.id, accion: estado === "cerrada" ? "cerrar_encuesta" : "anular", entidad: "encuestas", entidad_id: id });
    revalidatePath("/encuestas");
    return estado === "cerrada" ? "Encuesta cerrada: ya se ven los resultados finales." : "Encuesta anulada.";
  });
}

// ---------- Medidas propuestas (A25) ----------

export async function decidirMedidaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    if (!["consejo_directivo", "admin"].includes(user.rol)) throw new Error("Las medidas las decide el Consejo Directivo.");
    const d = parseForm(z.object({ id: zId, decision: z.enum(["aprobada", "descartada"]), motivo: zTextoOpcional(500) }), fd);
    const m = await get<{ estado: string; titulo: string; medida: string; nucleo_id: number | null }>(`SELECT estado, titulo, medida, nucleo_id FROM medidas_propuestas WHERE id = ?`, [d.id]);
    if (!m || m.estado !== "propuesta") throw new Error("Esa medida ya fue decidida.");
    if (d.decision === "descartada" && !d.motivo) throw new ValidationError("motivo", "Contá por qué se descarta.");
    await update("medidas_propuestas", d.id, { estado: d.decision, decidido_por_id: user.id, decidido_en: new Date().toISOString(), motivo: d.motivo });
    await audit({ usuario_id: user.id, accion: d.decision === "aprobada" ? "aprobar_medida" : "descartar_medida", entidad: "medidas_propuestas", entidad_id: d.id, valor_nuevo: { titulo: m.titulo, medida: m.medida, motivo: d.motivo } });
    if (d.decision === "aprobada" && m.nucleo_id) {
      const socios = await all<{ user_id: number }>(`SELECT user_id FROM socios WHERE nucleo_id = ? AND user_id IS NOT NULL AND estado = 'activo'`, [m.nucleo_id]).catch(() => []);
      for (const s of socios) await crearNotificacion({ user_id: s.user_id, tipo: "medida_aprobada", titulo: `La cooperativa resolvió: ${m.medida}`, cuerpo: m.titulo }).catch(() => {});
    }
    revalidatePath("/medidas");
    revalidatePath("/dashboard");
    return d.decision === "aprobada" ? "Medida aprobada. Se le avisó al núcleo." : "Medida descartada.";
  });
}
