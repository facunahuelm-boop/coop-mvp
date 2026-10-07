"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { get, insert, update, audit, run } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zEnumSeguro, zTelefonoOpcional, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { resolverDestinatarios, type TipoDestinatarios } from "@/lib/avisos";
import { crearNotificacionesParaUsuarios } from "@/lib/notificaciones";
import { enviarEmailAvisoSistema, urlBaseApp } from "@/lib/email";

/**
 * Fase 2F — Avisos oficiales con constancia de envío y lectura, WhatsApp
 * asistido y preferencias de cada persona.
 */

export async function puedeEnviarAvisos(rol: string): Promise<boolean> {
  return canEdit(rol as never, "socios") || canEdit(rol as never, "finanzas") || rol === "consejo_directivo";
}

async function requireEmisor(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await puedeEnviarAvisos(user.rol))) throw new Error("No tenés permiso para mandar avisos oficiales.");
  return user;
}

const avisoSchema = z.object({
  titulo: zTexto(150),
  cuerpo: zTexto(3000),
  destinatarios_tipo: zEnumSeguro(["todos", "socios", "comision", "morosos", "nucleo", "rol"], "todos"),
  destinatario_ref: zTextoOpcional(60),
  urgente: zEnumSeguro(["si", "no"], "no"),
  por_email: zEnumSeguro(["si", "no"], "no"),
});

/** Envía el aviso: queda la lista de destinatarios (constancia) y llega por COOVA y, si se pide, por email. */
export async function enviarAvisoAction(formData: FormData): Promise<number> {
  const user = await requireEmisor();
  const d = parseForm(avisoSchema, formData);
  if (["comision", "nucleo", "rol"].includes(d.destinatarios_tipo) && !d.destinatario_ref) {
    throw new ValidationError("destinatario_ref", "Elegí a quién (la comisión, el núcleo o el rol).");
  }
  const destinatarios = await resolverDestinatarios(d.destinatarios_tipo as TipoDestinatarios, d.destinatario_ref);
  if (!destinatarios.length) throw new Error("Con esa elección no hay a quién mandarle el aviso.");
  const avisoId = await insert("avisos", {
    titulo: d.titulo,
    cuerpo: d.cuerpo,
    destinatarios_tipo: d.destinatarios_tipo,
    destinatario_ref: d.destinatario_ref,
    urgente: d.urgente === "si" ? 1 : 0,
    por_email: d.por_email === "si" ? 1 : 0,
    enviado_por_id: user.id,
  });
  const titulo = `${d.urgente === "si" ? "URGENTE: " : ""}${d.titulo}`;
  let emails = 0;
  for (const p of destinatarios) {
    const destId = await insert("aviso_destinatarios", {
      aviso_id: avisoId,
      user_id: p.user_id,
      socio_id: p.socio_id,
      nombre: p.nombre,
      telefono: p.telefono,
      email: p.email,
      en_app: p.user_id ? 1 : 0,
    });
    if (d.por_email === "si" && p.email && p.quiere_email) {
      const r = await enviarEmailAvisoSistema(p.email, p.nombre.split(" ")[0] || p.nombre, {
        asunto: titulo,
        titulo,
        parrafos: d.cuerpo.split("\n").filter(Boolean),
        boton: p.user_id ? { texto: "Ver en COOVA", link: `${urlBaseApp()}/avisos/${avisoId}` } : undefined,
      }).catch(() => ({ ok: false }));
      if (r.ok) {
        emails++;
        await update("aviso_destinatarios", destId, { email_enviado_en: new Date().toISOString() });
      }
    }
  }
  await crearNotificacionesParaUsuarios(
    destinatarios.filter((p) => p.user_id).map((p) => p.user_id!) as number[],
    { tipo: "aviso_oficial", titulo, cuerpo: d.cuerpo.slice(0, 500), ref_tabla: "avisos", ref_id: avisoId }
  ).catch(() => {});
  await audit({ usuario_id: user.id, accion: "enviar_aviso", entidad: "avisos", entidad_id: avisoId, valor_nuevo: { titulo: d.titulo, a: d.destinatarios_tipo, personas: destinatarios.length, emails } });
  revalidatePath("/avisos");
  return avisoId;
}

export async function enviarAvisoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id = 0;
  const r = await conEstadoDeAccion(async () => {
    id = await enviarAvisoAction(fd);
  });
  return r.ok ? { ...r, aviso: `/avisos/${id}` } : r;
}

/** WhatsApp asistido: se registra que se abrió el chat de esa persona (la app no manda nada sola). */
export async function marcarWhatsappAbiertoAction(destinatarioId: number): Promise<void> {
  await requireEmisor();
  await run(`UPDATE aviso_destinatarios SET whatsapp_abierto_en = COALESCE(whatsapp_abierto_en, ?) WHERE id = ?`, [new Date().toISOString(), destinatarioId]);
}

export async function anularAvisoAction(formData: FormData) {
  const user = await requireEmisor();
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTexto(300) }), formData);
  const a = await get<{ anulado_en: string | null }>(`SELECT anulado_en FROM avisos WHERE id = ?`, [id]);
  if (!a || a.anulado_en) throw new Error("Ese aviso no existe o ya está anulado.");
  await update("avisos", id, { anulado_en: new Date().toISOString(), motivo_anulacion: motivo });
  await audit({ usuario_id: user.id, accion: "anular_aviso", entidad: "avisos", entidad_id: id, valor_nuevo: { motivo } });
  revalidatePath(`/avisos/${id}`);
  revalidatePath("/avisos");
}
export async function anularAvisoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularAvisoAction(fd));
}

// ---------- Preferencias de cada persona ----------

const prefSchema = z.object({
  telefono: zTelefonoOpcional,
  // Casillas: si no vienen marcadas es «no».
  aviso_email: zEnumSeguro(["si", "no"], "no"),
  aviso_whatsapp: zEnumSeguro(["si", "no"], "no"),
  resumen_semanal: zEnumSeguro(["si", "no"], "no"),
});

export async function guardarPreferenciasAvisosAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(prefSchema, formData);
  await update("users", user.id, {
    telefono: d.telefono,
    aviso_email: d.aviso_email === "si" ? 1 : 0,
    aviso_whatsapp: d.aviso_whatsapp === "si" ? 1 : 0,
    resumen_semanal: d.resumen_semanal === "si" ? 1 : 0,
  });
  await audit({ usuario_id: user.id, accion: "preferencias_avisos", entidad: "users", entidad_id: user.id, valor_nuevo: { email: d.aviso_email, whatsapp: d.aviso_whatsapp, resumen: d.resumen_semanal } });
  revalidatePath("/preferencias");
}
export async function guardarPreferenciasAvisosFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => guardarPreferenciasAvisosAction(fd));
  return r.ok ? { ...r, aviso: "Preferencias guardadas." } : r;
}

/** Link personal del calendario (ICS): se crea o se cambia (el anterior deja de funcionar). */
export async function generarLinkCalendarioAction(): Promise<void> {
  const user = await requireUser();
  const token = `${user.organization_id}.${randomBytes(18).toString("base64url")}`;
  await update("users", user.id, { ics_token: token });
  await audit({ usuario_id: user.id, accion: "link_calendario", entidad: "users", entidad_id: user.id });
  revalidatePath("/preferencias");
  revalidatePath("/calendario");
}
export async function generarLinkCalendarioFormAction(): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => generarLinkCalendarioAction());
  return r.ok ? { ...r, aviso: "Link del calendario listo." } : r;
}

/** Quien recibió el aviso lo abrió: queda la constancia de lectura (solo la primera vez). */
export async function marcarAvisoLeidoAction(avisoId: number): Promise<void> {
  const user = await requireUser();
  const id = Number(avisoId);
  if (!Number.isInteger(id) || id <= 0) return;
  await run(`UPDATE aviso_destinatarios SET leido_en = ? WHERE aviso_id = ? AND user_id = ? AND leido_en IS NULL`, [new Date().toISOString(), id, user.id]);
  await run(`UPDATE notificaciones SET leida = true WHERE user_id = ? AND ref_tabla = 'avisos' AND ref_id = ?`, [user.id, id]).catch(() => {});
}
