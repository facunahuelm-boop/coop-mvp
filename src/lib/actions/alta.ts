"use server";

import crypto from "node:crypto";
import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { all, get, insert, update, audit } from "@/lib/db";
import { requireUser, hashPassword } from "@/lib/auth";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/roles";
import { parseForm, zNombre, zEnumSeguro, ValidationError } from "@/lib/validation";
import { MENSAJES } from "@/lib/mensajesValidacion";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { plantillaAlta, comisionesSugeridas, PLANTILLAS_TEXTO_BASE, PLANTILLAS_ALTA, type Modalidad } from "@/lib/plantillasAlta";
import { PLANTILLA_HITOS } from "@/lib/tramitesTexto";
import { enviarEmailAvisoSistema } from "@/lib/email";
import type { EtapaCooperativa } from "@/lib/comisionesFunciones";

/**
 * Fase 2H — asistente de alta de cooperativa («Tu cooperativa está lista»).
 * Sólo el admin de la cooperativa. Todo lo que carga se puede cambiar
 * después; nada automático queda prendido.
 */
async function requireAdmin() {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Sólo la administración del sistema puede usar el asistente de alta.");
  return user;
}

function revalidar() {
  revalidatePath("/alta");
  revalidatePath("/", "layout");
}

/** Crea las comisiones sugeridas que todavía no existen (por nombre). Devuelve cuántas creó. */
async function crearComisiones(modalidad: Modalidad, etapa: EtapaCooperativa, userId: number): Promise<number> {
  const existentes = new Set((await all<{ nombre: string }>(`SELECT nombre FROM comisiones`)).map((c) => c.nombre.trim().toLowerCase()));
  let n = 0;
  for (const c of comisionesSugeridas(modalidad, etapa)) {
    if (existentes.has(c.nombre.toLowerCase())) continue;
    const id = await insert("comisiones", { nombre: c.nombre, descripcion: c.descripcion, funcion: c.funcion, activa: 1 });
    await audit({ usuario_id: userId, accion: "crear", entidad: "comisiones", entidad_id: id, valor_nuevo: { nombre: c.nombre, funcion: c.funcion, origen: "asistente de alta" } });
    n++;
  }
  return n;
}

const datosSchema = z.object({
  nombre: zNombre(150),
  plantilla: zEnumSeguro(PLANTILLAS_ALTA.map((p) => p.clave) as [string, ...string[]], "ayuda_mutua_obra"),
});

/** Paso 1: datos, modalidad y etapa (con la plantilla de alta). */
export async function guardarDatosAltaAction(formData: FormData): Promise<string> {
  const user = await requireAdmin();
  const d = parseForm(datosSchema, formData);
  const p = plantillaAlta(d.plantilla)!;
  const org = await get<{ modulos_override: Record<string, string> | null }>(`SELECT modulos_override FROM organizations WHERE id = ?`, [user.organization_id]);
  const modulos = { ...(org?.modulos_override ?? {}) };
  for (const m of p.ocultar) modulos[m] = "ocultar";
  await update("organizations", user.organization_id, { nombre: d.nombre, modalidad: p.modalidad, etapa: p.etapa, modulos_override: modulos });

  // Reglamento: sólo lo que la cooperativa todavía no definió.
  let reglas = 0;
  for (const [clave, valor] of Object.entries(p.reglamento)) {
    const existe = await get<{ id: number }>(`SELECT id FROM configuracion_reglas WHERE clave = ?`, [clave]);
    if (existe) continue;
    await insert("configuracion_reglas", { organization_id: user.organization_id, clave, valor, actualizado_por_id: user.id });
    reglas++;
  }
  const comisiones = await crearComisiones(p.modalidad, p.etapa, user.id);
  // Plantillas de texto base (si no hay ninguna con ese nombre).
  const nombres = new Set((await all<{ nombre: string }>(`SELECT nombre FROM plantillas_texto WHERE activo = 1`).catch(() => [])).map((x) => x.nombre));
  let textos = 0;
  for (const t of PLANTILLAS_TEXTO_BASE) {
    if (nombres.has(t.nombre)) continue;
    await insert("plantillas_texto", { ...t, creado_por_id: user.id });
    textos++;
  }
  // Pre-obra: los pasos típicos de los trámites.
  let hitos = 0;
  if (p.hitos) {
    const hay = await get<{ n: string }>(`SELECT COUNT(*) AS n FROM tramites_hitos WHERE activo = 1`).catch(() => ({ n: "1" }));
    if (Number(hay?.n ?? 1) === 0) {
      let orden = 0;
      for (const h of PLANTILLA_HITOS) {
        await insert("tramites_hitos", { ...h, orden: ++orden, creado_por_id: user.id });
        hitos++;
      }
    }
  }
  await audit({
    usuario_id: user.id,
    accion: "alta_datos",
    entidad: "organizations",
    entidad_id: user.organization_id,
    valor_nuevo: { nombre: d.nombre, plantilla: p.nombre, comisiones, reglas, textos, hitos },
  });
  revalidar();
  const partes = [comisiones ? `${comisiones} comisiones` : "", textos ? `${textos} plantillas de texto` : "", hitos ? `${hitos} pasos de trámites` : ""].filter(Boolean);
  return `Guardado. ${partes.length ? `Se cargaron ${partes.join(", ")}.` : ""}`.trim();
}
export async function guardarDatosAltaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await guardarDatosAltaAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

/** Paso 4: comisiones sugeridas según la etapa. */
export async function crearComisionesSugeridasFormAction(): Promise<ActionState> {
  let n = 0;
  const r = await conEstadoDeAccion(async () => {
    const user = await requireAdmin();
    const org = await get<{ modalidad: Modalidad; etapa: EtapaCooperativa }>(`SELECT modalidad, etapa FROM organizations WHERE id = ?`, [user.organization_id]);
    n = await crearComisiones(org?.modalidad ?? "ayuda_mutua", org?.etapa ?? "obra", user.id);
    revalidar();
    revalidatePath("/comisiones", "layout");
  });
  return r.ok ? { ...r, aviso: n ? `Se crearon ${n} comisiones.` : "Ya estaban todas las comisiones sugeridas." } : r;
}

const invitarSchema = z.object({
  nombre: zNombre(200),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200, "Máximo 200 caracteres.")
    .refine((v) => z.string().email().safeParse(v).success, MENSAJES.email),
  rol: zEnumSeguro(ROLES as unknown as [string, ...string[]]),
});

const DIAS_INVITACION = 7;

/**
 * Paso 5: invitar a una persona. Se crea su usuario sin contraseña conocida
 * y le llega un email con un link (válido 7 días) para elegirla. Si el email
 * no se puede mandar, se le muestra el link a quien invita (una sola vez,
 * no se guarda) para pasárselo por otro medio.
 */
export async function invitarUsuarioAction(formData: FormData): Promise<string> {
  const admin = await requireAdmin();
  const d = parseForm(invitarSchema, formData);
  const email = d.email.toLowerCase();
  if (await get<{ id: number }>(`SELECT id FROM users WHERE lower(email) = ?`, [email])) {
    throw new ValidationError("email", "Ya hay un usuario con ese email en esta cooperativa.");
  }
  const token = crypto.randomBytes(32).toString("hex");
  const id = await insert("users", {
    nombre: d.nombre,
    email,
    rol: d.rol,
    activo: 1,
    password_hash: await hashPassword(crypto.randomBytes(24).toString("base64url")),
    reset_token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    reset_token_expira_en: new Date(Date.now() + DIAS_INVITACION * 86400000).toISOString(),
    reset_solicitado_en: new Date().toISOString(),
  });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.includes(".localhost") ? "http" : "https";
  const link = `${proto}://${host}/restablecer-password?token=${token}`;
  const r = await enviarEmailAvisoSistema(email, d.nombre.split(" ")[0] || d.nombre, {
    asunto: `Te invitaron a ${admin.organizacion.nombre} en COOVA`,
    titulo: "Te damos la bienvenida",
    parrafos: [
      `Te crearon un usuario en COOVA, el sistema de ${admin.organizacion.nombre}, con el rol «${ROLE_LABELS[d.rol as Role]}».`,
      `Tocá el botón para elegir tu contraseña. El link vale ${DIAS_INVITACION} días.`,
    ],
    boton: { texto: "Elegir mi contraseña", link },
  }).catch(() => ({ ok: false }));
  await audit({ usuario_id: admin.id, accion: "invitar_usuario", entidad: "users", entidad_id: id, valor_nuevo: { nombre: d.nombre, email, rol: d.rol, email_enviado: r.ok } });
  revalidar();
  revalidatePath("/usuarios");
  return r.ok
    ? `Listo: le mandamos la invitación a ${email}.`
    : `Se creó el usuario, pero no se pudo mandar el email (revisá la configuración de email). Pasale este link por otro medio; vale ${DIAS_INVITACION} días: ${link}`;
}
export async function invitarUsuarioFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await invitarUsuarioAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

/** Paso 6: «Tu cooperativa está lista». */
export async function completarAltaFormAction(): Promise<ActionState> {
  const r = await conEstadoDeAccion(async () => {
    const user = await requireAdmin();
    await update("organizations", user.organization_id, { alta_completada_en: new Date().toISOString() });
    await audit({ usuario_id: user.id, accion: "alta_completada", entidad: "organizations", entidad_id: user.organization_id });
    revalidar();
  });
  return r.ok ? { ...r, aviso: "¡Listo! Tu cooperativa ya está funcionando en COOVA." } : r;
}
