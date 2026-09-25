"use server";

// Fase 5 (Multicooperativa/arquitectura SaaS(19) + Administrador de
// plataforma(20) + Planes y módulos(21) + Soporte(22)) — Sub-fase 5.4:
// Soporte (sección 22, última de esta fase, migración 0040).
//
// Este archivo tiene las acciones del lado de LA COOPERATIVA (crear un
// ticket, agregar un mensaje al hilo, abrir/cerrar el propio ticket). Las
// acciones del lado del admin de plataforma (ver TODOS los tickets de TODAS
// las cooperativas, responder, cambiar estado) viven en actions/
// plataforma.ts junto al resto de lo que ya opera sobre todas las
// cooperativas a la vez — no se duplica ese mecanismo acá.
//
// Quién puede crear/ver un ticket: CUALQUIER usuario autenticado, sin
// depender de ningún módulo (decisión a propósito, documentada en
// lib/planes.ts: el acceso a soporte nunca debería depender del plan de la
// cooperativa). Además del creador, el `admin` de la cooperativa puede ver
// TODOS los tickets de su propia cooperativa (mismo nivel que /usuarios,
// la pantalla más administrativa que ya existe) — el resto de los roles
// solo ve los suyos.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CATEGORIA_TICKET_LABEL } from "@/lib/constants";
import { parseForm, zId, zTexto, zEnumSeguro, clavesDe } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

const crearTicketSchema = z.object({
  asunto: zTexto(150),
  categoria: zEnumSeguro(clavesDe(CATEGORIA_TICKET_LABEL), "consulta"),
  mensaje: zTexto(4000),
});

export async function crearTicketAction(formData: FormData) {
  const user = await requireUser();
  const datos = parseForm(crearTicketSchema, formData);

  const ticketId = await insert("tickets_soporte", {
    creado_por_id: user.id,
    asunto: datos.asunto,
    categoria: datos.categoria,
    estado: "abierto",
  });
  await insert("ticket_soporte_mensajes", {
    ticket_id: ticketId,
    autor_user_id: user.id,
    autor_es_platform_admin: false,
    texto: datos.mensaje,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "tickets_soporte", entidad_id: ticketId, valor_nuevo: { asunto: datos.asunto } });
  revalidatePath("/soporte");
}

export async function crearTicketFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearTicketAction(formData));
}

/** Puede actuar sobre un ticket (agregar mensaje / cambiar estado) quien lo
 * creó, o el admin de su propia cooperativa — mismo criterio que
 * `puedeCancelar` en solicitudes/[id]/page.tsx (creador u oversight). RLS ya
 * garantiza que nunca es un ticket de OTRA cooperativa (organization_id se
 * fija solo con la del que llama), pero igual se valida acá el creador/admin
 * para que un socio cualquiera no pueda responder o cerrar el ticket de otro
 * socio de su misma cooperativa. */
async function requierePropioOAdmin(ticketId: number) {
  const user = await requireUser();
  const ticket = await get<{ id: number; creado_por_id: number; estado: string }>(
    `SELECT id, creado_por_id, estado FROM tickets_soporte WHERE id = ?`,
    [ticketId]
  );
  if (!ticket) throw new Error("Ese ticket ya no existe.");
  if (ticket.creado_por_id !== user.id && user.rol !== "admin") throw new Error("No autorizado");
  return { user, ticket };
}

const agregarMensajeSchema = z.object({ id: zId, texto: zTexto(4000) });

export async function agregarMensajeTicketAction(formData: FormData) {
  const { id, texto } = parseForm(agregarMensajeSchema, formData);
  const { user } = await requierePropioOAdmin(id);

  await insert("ticket_soporte_mensajes", {
    ticket_id: id,
    autor_user_id: user.id,
    autor_es_platform_admin: false,
    texto,
  });
  await update("tickets_soporte", id, { actualizado_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "responder", entidad: "tickets_soporte", entidad_id: id });
  revalidatePath(`/soporte/${id}`);
  revalidatePath("/soporte");
}

export async function agregarMensajeTicketFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarMensajeTicketAction(formData));
}

/** Abrir/cerrar el propio ticket desde el lado de la cooperativa — a
 * diferencia del admin de plataforma (que además puede marcarlo "en
 * proceso", ver responderTicketPlataformaAction en actions/plataforma.ts),
 * acá solo alterna entre "abierto" y "resuelto": "en proceso" es una señal
 * de que la plataforma ya lo está mirando, no algo que la propia cooperativa
 * pueda saber ni declarar. */
const cambiarEstadoSchema = z.object({ id: zId, estado: zEnumSeguro(["abierto", "resuelto"] as const) });

export async function cambiarEstadoTicketAction(formData: FormData) {
  const { id, estado } = parseForm(cambiarEstadoSchema, formData);
  const { user } = await requierePropioOAdmin(id);

  await update("tickets_soporte", id, { estado, actualizado_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: estado === "resuelto" ? "cerrar" : "reabrir", entidad: "tickets_soporte", entidad_id: id });
  revalidatePath(`/soporte/${id}`);
  revalidatePath("/soporte");
}

export async function cambiarEstadoTicketFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarEstadoTicketAction(formData));
}
