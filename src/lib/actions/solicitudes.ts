"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, run, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaOpcional, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacion, crearNotificacionesParaUsuarios } from "@/lib/actions/notificaciones";

// Fase 3 del sistema de gestión de Comisiones (19/09, pedido explícito,
// sección 3): solicitudes entre comisiones con derivación y trazabilidad
// completa. Ver ARQUITECTURA_COMISIONES.md para el diseño de datos
// (tablas solicitudes_comision / solicitud_comentarios / solicitud_eventos,
// migración 0029).
//
// Modelo de permisos (mismo criterio de doble capa que Gastos/Compras/
// Tareas — módulo + instancia, ver comisionAuth.ts): quien puede CREAR una
// solicitud es quien integra (o gestiona) la comisión de ORIGEN; quien
// puede RESPONDERLA (revisar/pedir información/aprobar/rechazar/resolver/
// derivar) es quien integra la comisión de DESTINO en ese momento —
// literalmente "a quién le llegó el planteo". Comentar es más permisivo:
// cualquiera de los dos lados puede pedir/dar información. Cancelar es
// potestad de quien la creó (o de conducción) — "me arrepentí, la bajo".

const TIPOS = ["informacion", "aprobacion", "compra", "presupuesto", "tarea", "documento", "consulta", "informe", "derivacion", "incidente", "urgente", "otro"] as const;
const PRIORIDADES = ["baja", "normal", "alta", "urgente"] as const;
const ESTADOS_RESPUESTA = ["en_revision", "esperando_informacion", "en_proceso", "aprobada", "rechazada", "resuelta"] as const;

function esOversightComisiones(rol: Parameters<typeof canEdit>[0]): boolean {
  return canEdit(rol, "finanzas");
}

async function puedeInteractuarConSolicitud(
  user: SessionUser,
  solicitud: { comision_origen_id: number; comision_destino_id: number }
): Promise<boolean> {
  if (esOversightComisiones(user.rol)) return true;
  return (
    (await puedeGestionarComision(user, solicitud.comision_origen_id)) ||
    (await puedeGestionarComision(user, solicitud.comision_destino_id))
  );
}

async function asignarNumero(id: number) {
  const year = new Date().getFullYear();
  await run(`UPDATE solicitudes_comision SET numero = ? WHERE id = ?`, [`SOL-${year}-${String(id).padStart(4, "0")}`, id]);
}

const crearSolicitudSchema = z
  .object({
    tipo: zEnumSeguro(TIPOS, "otro"),
    titulo: zTexto(200),
    descripcion: zTextoOpcional(3000),
    comision_origen_id: zId,
    comision_destino_id: zId,
    responsable_id: zIdOpcional,
    prioridad: zEnumSeguro(PRIORIDADES, "normal"),
    fecha_limite: zFechaOpcional,
  })
  .refine((d) => d.comision_origen_id !== d.comision_destino_id, {
    message: "La comisión de origen y destino no pueden ser la misma.",
    path: ["comision_destino_id"],
  });

export async function crearSolicitudComisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearSolicitudSchema, formData);
  if (!(await puedeGestionarComision(user, datos.comision_origen_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const id = await insert("solicitudes_comision", { ...datos, creado_por_id: user.id });
  await asignarNumero(id);
  await insert("solicitud_eventos", {
    solicitud_id: id,
    evento: "creada",
    de_comision_id: datos.comision_origen_id,
    a_comision_id: datos.comision_destino_id,
    usuario_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "solicitudes_comision", entidad_id: id, valor_nuevo: { titulo: datos.titulo, comision_destino_id: datos.comision_destino_id } });

  // Fase 7 (notificaciones): avisa a los integrantes activos de la comisión
  // destino — "recibí una solicitud" es el ejemplo textual de la sección 24
  // del pedido original. Nunca hace fallar la creación si algo sale mal acá.
  const miembrosDestino = await all<{ user_id: number }>(
    `SELECT user_id FROM comision_miembros WHERE comision_id = ? AND activo = 1`,
    [datos.comision_destino_id]
  ).catch(() => []);
  await crearNotificacionesParaUsuarios(
    miembrosDestino.map((m) => m.user_id).filter((uid) => uid !== user.id),
    { tipo: "solicitud_recibida", titulo: `Nueva solicitud: ${datos.titulo}`, ref_tabla: "solicitudes_comision", ref_id: id }
  );

  revalidatePath("/solicitudes");
}

export async function crearSolicitudComisionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearSolicitudComisionAction(formData));
}

const responderSchema = z.object({
  id: zId,
  estado: z.enum(ESTADOS_RESPUESTA),
  responsable_id: zIdOpcional,
  motivo: zTextoOpcional(2000),
});

// Responder = mover el estado desde el lado que la recibió (comisión
// destino en este momento — importante: si ya fue derivada varias veces,
// "destino" es siempre la comisión actual, no la original).
export async function responderSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, estado, responsable_id, motivo } = parseForm(responderSchema, formData);
  const solicitud = await get<{ comision_destino_id: number; estado: string; creado_por_id: number; titulo: string }>(
    `SELECT comision_destino_id, estado, creado_por_id, titulo FROM solicitudes_comision WHERE id = ?`,
    [id]
  );
  if (!solicitud) throw new Error("Esa solicitud ya no existe.");
  if (["resuelta", "rechazada", "cancelada"].includes(solicitud.estado)) {
    throw new Error("Esta solicitud ya está cerrada — no se puede cambiar su estado.");
  }
  if (!(await puedeGestionarComision(user, solicitud.comision_destino_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const cambios: Record<string, unknown> = { estado, actualizado_en: new Date().toISOString() };
  if (responsable_id) cambios.responsable_id = responsable_id;
  await update("solicitudes_comision", id, cambios);
  await insert("solicitud_eventos", { solicitud_id: id, evento: estado, usuario_id: user.id, detalle: motivo || null });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "solicitudes_comision", entidad_id: id, valor_nuevo: { estado } });

  // Fase 7 (notificaciones): avisa a quien la creó de que cambió de estado.
  if (solicitud.creado_por_id !== user.id) {
    await crearNotificacion({
      user_id: solicitud.creado_por_id,
      tipo: "solicitud_cambio_estado",
      titulo: `Tu solicitud "${solicitud.titulo}" pasó a "${estado}"`,
      ref_tabla: "solicitudes_comision",
      ref_id: id,
    });
  }

  revalidatePath("/solicitudes");
  revalidatePath(`/solicitudes/${id}`);
}

export async function responderSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => responderSolicitudAction(formData));
}

const derivarSchema = z.object({ id: zId, nueva_comision_destino_id: zId, motivo: zTextoOpcional(2000) });

export async function derivarSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, nueva_comision_destino_id, motivo } = parseForm(derivarSchema, formData);
  const solicitud = await get<{ comision_destino_id: number; estado: string }>(
    `SELECT comision_destino_id, estado FROM solicitudes_comision WHERE id = ?`,
    [id]
  );
  if (!solicitud) throw new Error("Esa solicitud ya no existe.");
  if (["resuelta", "rechazada", "cancelada"].includes(solicitud.estado)) {
    throw new Error("Esta solicitud ya está cerrada — no se puede derivar.");
  }
  if (nueva_comision_destino_id === solicitud.comision_destino_id) {
    throw new Error("Elegí una comisión distinta de la actual para derivar.");
  }
  if (!(await puedeGestionarComision(user, solicitud.comision_destino_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  await update("solicitudes_comision", id, { comision_destino_id: nueva_comision_destino_id, estado: "pendiente", actualizado_en: new Date().toISOString() });
  await insert("solicitud_eventos", {
    solicitud_id: id,
    evento: "derivada",
    de_comision_id: solicitud.comision_destino_id,
    a_comision_id: nueva_comision_destino_id,
    usuario_id: user.id,
    detalle: motivo || null,
  });
  await audit({ usuario_id: user.id, accion: "derivar", entidad: "solicitudes_comision", entidad_id: id, valor_nuevo: { de: solicitud.comision_destino_id, a: nueva_comision_destino_id } });
  revalidatePath("/solicitudes");
  revalidatePath(`/solicitudes/${id}`);
}

export async function derivarSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => derivarSolicitudAction(formData));
}

const comentarSchema = z.object({ id: zId, cuerpo: zTexto(3000) });

export async function comentarSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, cuerpo } = parseForm(comentarSchema, formData);
  const solicitud = await get<{ comision_origen_id: number; comision_destino_id: number }>(
    `SELECT comision_origen_id, comision_destino_id FROM solicitudes_comision WHERE id = ?`,
    [id]
  );
  if (!solicitud) throw new Error("Esa solicitud ya no existe.");
  if (!(await puedeInteractuarConSolicitud(user, solicitud))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  await insert("solicitud_comentarios", { solicitud_id: id, autor_id: user.id, cuerpo });
  await insert("solicitud_eventos", { solicitud_id: id, evento: "comentario", usuario_id: user.id });
  await audit({ usuario_id: user.id, accion: "comentar", entidad: "solicitudes_comision", entidad_id: id });
  revalidatePath(`/solicitudes/${id}`);
}

export async function comentarSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => comentarSolicitudAction(formData));
}

const cancelarSchema = z.object({ id: zId, motivo: zTextoOpcional(2000) });

export async function cancelarSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, motivo } = parseForm(cancelarSchema, formData);
  const solicitud = await get<{ comision_origen_id: number; creado_por_id: number; estado: string }>(
    `SELECT comision_origen_id, creado_por_id, estado FROM solicitudes_comision WHERE id = ?`,
    [id]
  );
  if (!solicitud) throw new Error("Esa solicitud ya no existe.");
  if (["resuelta", "rechazada", "cancelada"].includes(solicitud.estado)) {
    throw new Error("Esta solicitud ya está cerrada.");
  }
  const puedeCancelar =
    user.id === solicitud.creado_por_id ||
    esOversightComisiones(user.rol) ||
    (await puedeGestionarComision(user, solicitud.comision_origen_id));
  if (!puedeCancelar) throw new Error("Sólo quien creó la solicitud (o su comisión) puede cancelarla.");

  await update("solicitudes_comision", id, { estado: "cancelada", actualizado_en: new Date().toISOString() });
  await insert("solicitud_eventos", { solicitud_id: id, evento: "cancelada", usuario_id: user.id, detalle: motivo || null });
  await audit({ usuario_id: user.id, accion: "cancelar", entidad: "solicitudes_comision", entidad_id: id });
  revalidatePath("/solicitudes");
  revalidatePath(`/solicitudes/${id}`);
}

export async function cancelarSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cancelarSolicitudAction(formData));
}
