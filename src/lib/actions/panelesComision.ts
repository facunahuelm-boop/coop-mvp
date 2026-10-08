"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { hoyEnUruguay } from "@/lib/horasObra";
import { parseForm, zId, zTexto, zTextoOpcional, zFecha, zFechaOpcional, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/** Fase 3B — formularios propios de los paneles: correspondencia (Administrativa) y elecciones (Electoral). */

async function requireComision(fd: FormData) {
  const user = await requireUser();
  const comisionId = Number(fd.get("comision_id"));
  const ok = Number.isInteger(comisionId) && comisionId > 0 && canEdit(user.rol, "comisiones") && (await puedeGestionarComision(user, comisionId));
  if (!ok && !canEdit(user.rol, "documentos")) throw new Error(ERROR_SIN_PERMISO_COMISION);
  return { user, comisionId: ok ? comisionId : null };
}
const revalidar = () => revalidatePath("/comisiones", "layout");
async function conAviso(fn: () => Promise<string>): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await fn();
  });
  return r.ok ? { ...r, aviso } : r;
}

// ---------- Correspondencia ----------

const correspondenciaSchema = z.object({
  tipo: z.enum(["entrada", "salida"], { message: "Elegí si entró o salió." }),
  fecha: zFecha,
  contraparte: zTexto(200),
  asunto: zTexto(300),
  referencia: zTextoOpcional(100),
  requiere_respuesta: z.string().optional(),
  responder_antes: zFechaOpcional,
  responde_a_id: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
});

export async function registrarCorrespondenciaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const { user, comisionId } = await requireComision(fd);
    const d = parseForm(correspondenciaSchema, fd);
    if (d.fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
    const requiere = d.tipo === "entrada" && d.requiere_respuesta === "1";
    const id = await insert("correspondencia", {
      tipo: d.tipo,
      fecha: d.fecha,
      contraparte: d.contraparte,
      asunto: d.asunto,
      referencia: d.referencia,
      requiere_respuesta: requiere ? 1 : 0,
      responder_antes: requiere ? d.responder_antes ?? null : null,
      responsable_id: user.id,
      comision_id: comisionId,
      registrado_por_id: user.id,
    });
    let extra = "";
    if (d.tipo === "salida" && d.responde_a_id) {
      const e = await get<{ id: number; respondida_en: string | null }>(`SELECT id, respondida_en FROM correspondencia WHERE id = ? AND tipo = 'entrada' AND anulado_en IS NULL`, [d.responde_a_id]);
      if (e && !e.respondida_en) {
        await update("correspondencia", e.id, { respondida_en: d.fecha, respuesta_id: id });
        extra = " La nota que se contestaba quedó como respondida.";
      }
    }
    await audit({ usuario_id: user.id, accion: "registrar_correspondencia", entidad: "correspondencia", entidad_id: id, valor_nuevo: { tipo: d.tipo, contraparte: d.contraparte, asunto: d.asunto } });
    revalidar();
    return `${d.tipo === "entrada" ? "Entrada" : "Salida"} registrada.${extra}`;
  });
}

export async function marcarRespondidaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const { user } = await requireComision(fd);
    const { id } = parseForm(z.object({ id: zId }), fd);
    const c = await get<{ respondida_en: string | null; tipo: string }>(`SELECT respondida_en, tipo FROM correspondencia WHERE id = ? AND anulado_en IS NULL`, [id]);
    if (!c || c.tipo !== "entrada") throw new Error("Esa nota no existe.");
    if (c.respondida_en) throw new Error("Ya estaba respondida.");
    await update("correspondencia", id, { respondida_en: hoyEnUruguay() });
    await audit({ usuario_id: user.id, accion: "responder_correspondencia", entidad: "correspondencia", entidad_id: id });
    revalidar();
    return "Marcada como respondida.";
  });
}

// ---------- Elecciones ----------

const eleccionSchema = z.object({
  titulo: zTexto(150),
  organos: zTextoOpcional(200),
  fecha_cierre_listas: zFechaOpcional,
  fecha_eleccion: zFecha,
});

export async function crearEleccionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const { user } = await requireComision(fd);
    const d = parseForm(eleccionSchema, fd);
    if (d.fecha_cierre_listas && d.fecha_cierre_listas > d.fecha_eleccion) {
      throw new ValidationError("fecha_cierre_listas", "El cierre de listas tiene que ser antes de la elección.");
    }
    const id = await insert("elecciones", { ...d, creado_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "crear", entidad: "elecciones", entidad_id: id, valor_nuevo: d });
    revalidar();
    return "Elección cargada en el cronograma.";
  });
}

const listaSchema = z.object({
  eleccion_id: zId,
  nombre: zTexto(150),
  integrantes: zTexto(3000),
  presentada_en: zFecha,
});

export async function registrarListaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const { user } = await requireComision(fd);
    const d = parseForm(listaSchema, fd);
    const e = await get<{ estado: string; fecha_cierre_listas: string | null; titulo: string }>(`SELECT estado, fecha_cierre_listas, titulo FROM elecciones WHERE id = ?`, [d.eleccion_id]);
    if (!e || e.estado !== "abierta") throw new Error("Esa elección no está abierta.");
    const fuera = e.fecha_cierre_listas && d.presentada_en > e.fecha_cierre_listas;
    const id = await insert("listas_electorales", { ...d, registrada_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "presentar_lista", entidad: "listas_electorales", entidad_id: id, valor_nuevo: { eleccion: e.titulo, nombre: d.nombre, fuera_de_plazo: !!fuera } });
    revalidar();
    return fuera ? "Lista registrada. Ojo: se presentó después del cierre de listas." : "Lista registrada.";
  });
}

const estadoListaSchema = z.object({
  id: zId,
  estado: z.enum(["aceptada", "observada", "retirada"], { message: "Elegí el estado." }),
  observaciones: zTextoOpcional(1000),
});

export async function cambiarEstadoListaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const { user } = await requireComision(fd);
    const d = parseForm(estadoListaSchema, fd);
    if (d.estado === "observada" && !d.observaciones) throw new ValidationError("observaciones", "Contá qué se observa.");
    const l = await get<{ estado: string; nombre: string }>(`SELECT estado, nombre FROM listas_electorales WHERE id = ?`, [d.id]);
    if (!l || l.estado === "retirada") throw new Error("Esa lista no existe o fue retirada.");
    await update("listas_electorales", d.id, { estado: d.estado, observaciones: d.observaciones ?? null });
    await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "listas_electorales", entidad_id: d.id, valor_anterior: { estado: l.estado }, valor_nuevo: { estado: d.estado, observaciones: d.observaciones } });
    revalidar();
    return `Lista «${l.nombre}»: ${d.estado}.`;
  });
}
