"use server";

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { rootGet, get, insert, update, audit } from "@/lib/db";
import { setOrgContext } from "@/lib/tenant";
import { createSessionCookie, crearIngresoPendiente2FA, leerIngresoPendiente2FA, borrarIngresoPendiente2FA } from "@/lib/auth";
import { descifrar } from "@/lib/crypto";
import { verificarTotp, usarCodigoRespaldo } from "@/lib/totp";
import { enviarEmailAvisoSistema } from "@/lib/email";

/**
 * Fase 1E — formas de entrar pensadas para personas mayores y para cuentas
 * sensibles:
 *  - Link de acceso por email: sin contraseña. Un enlace de un solo uso que
 *    vence a los 15 minutos. Al abrirlo hay que tocar "Entrar" (así los
 *    programas que revisan los mails no lo "gastan" solos).
 *  - Segundo paso: si la cuenta tiene activada la verificación en dos pasos,
 *    después de la contraseña (o del link) se pide el código de 6 números.
 * Mismo estilo de respuesta que loginAction (pantallas públicas sin sesión).
 */

const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "coova";
const VALIDEZ_MINUTOS = 15;
const REENVIO_MINUTOS = 1;
const MAX_INTENTOS = 5;

type Estado = { ok?: boolean; mensaje?: string; error?: string } | undefined;

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

async function orgDelPedido() {
  const slug = (await cookies()).get("coop_slug")?.value || DEFAULT_SLUG;
  const org = await rootGet<{ id: number; activo: number; nombre: string }>(`SELECT id, activo, nombre FROM organizations WHERE slug = ?`, [slug]);
  // Ojo: setOrgContext usa AsyncLocalStorage.enterWith, que sólo vale en la
  // función que lo llama — por eso lo llama cada acción, no este helper.
  if (!org || !org.activo) return null;
  return org;
}

async function intentosFallidos(clave: string, orgId: number): Promise<number> {
  const r = await get<{ c: string }>(
    `SELECT count(*)::text AS c FROM login_intentos WHERE organization_id = ? AND email = ? AND exitoso = 0 AND creado_en > NOW() - interval '15 minutes'`,
    [orgId, clave]
  ).catch(() => undefined);
  return Number(r?.c || 0);
}

const MENSAJE_LINK =
  "Si ese email tiene una cuenta activa en esta cooperativa, te mandamos un link para entrar. Revisá tu correo (y la carpeta de spam). El link sirve por 15 minutos.";

// ---------- 1) Pedir el link ----------
export async function solicitarLinkAccesoAction(_prev: Estado, formData: FormData): Promise<Estado> {
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 200);
  if (!email || !email.includes("@")) return { error: "Escribí tu email." };
  const org = await orgDelPedido();
  if (!org) return { error: "No encontramos esa cooperativa. Verificá el enlace de acceso." };
  setOrgContext(org.id);

  const user = await get<{ id: number; nombre: string; activo: number; acceso_solicitado_en: string | null }>(
    `SELECT id, nombre, activo, acceso_solicitado_en FROM users WHERE email = ? AND organization_id = ?`,
    [email, org.id]
  ).catch((err) => {
    console.error("[acceso] No se pudo buscar la cuenta:", err?.message ?? err);
    return undefined;
  });
  if (user && user.activo) {
    const puede = !user.acceso_solicitado_en || Date.now() - new Date(user.acceso_solicitado_en).getTime() > REENVIO_MINUTOS * 60_000;
    if (puede) {
      const token = crypto.randomBytes(32).toString("base64url");
      const ahora = new Date();
      await update("users", user.id, {
        acceso_token_hash: hash(token),
        acceso_token_expira_en: new Date(ahora.getTime() + VALIDEZ_MINUTOS * 60_000).toISOString(),
        acceso_solicitado_en: ahora.toISOString(),
      });
      const h = await headers();
      const host = h.get("host") || "";
      const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.includes(".localhost") ? "http" : "https";
      const resultado = await enviarEmailAvisoSistema(email, user.nombre.split(" ")[0] || user.nombre, {
        asunto: `Tu link para entrar a ${org.nombre}`,
        titulo: "Entrar a COOVA",
        parrafos: ["Tocá el botón para entrar. El link sirve una sola vez y por 15 minutos.", "Si no pediste entrar, ignorá este mensaje."],
        boton: { texto: "Entrar a COOVA", link: `${proto}://${host}/acceso?token=${token}` },
      }).catch((err) => ({ ok: false, error: String(err) }));
      if (!resultado.ok) console.error("[acceso] No se pudo mandar el link:", resultado.error);
      await audit({ usuario_id: user.id, accion: "pedir_link_acceso", entidad: "users", entidad_id: user.id }).catch(() => {});
    }
  }
  return { ok: true, mensaje: MENSAJE_LINK };
}

// ---------- 2) Usar el link ----------
export async function usarLinkAccesoAction(_prev: Estado, formData: FormData): Promise<Estado> {
  const token = String(formData.get("token") || "").slice(0, 200);
  if (!token) return { error: "El link no es válido." };
  const org = await orgDelPedido();
  if (!org) return { error: "No encontramos esa cooperativa." };
  setOrgContext(org.id);
  const user = await get<{ id: number; rol: string; activo: number; acceso_token_expira_en: string | null; totp_activado_en: string | null }>(
    `SELECT id, rol, activo, acceso_token_expira_en, totp_activado_en FROM users WHERE acceso_token_hash = ? AND organization_id = ?`,
    [hash(token), org.id]
  ).catch(() => undefined);
  if (!user || !user.activo || !user.acceso_token_expira_en || new Date(user.acceso_token_expira_en).getTime() < Date.now()) {
    return { error: "Este link ya se usó o venció. Pedí uno nuevo desde la pantalla de ingreso." };
  }
  // Un solo uso: se borra el token antes de abrir la sesión.
  await update("users", user.id, { acceso_token_hash: null, acceso_token_expira_en: null });
  if (user.totp_activado_en) {
    await crearIngresoPendiente2FA({ id: user.id, organization_id: org.id });
    redirect("/login/verificacion");
  }
  await audit({ usuario_id: user.id, accion: "login_link_email", entidad: "users", entidad_id: user.id }).catch(() => {});
  await createSessionCookie({ id: user.id, rol: user.rol as never, organization_id: org.id });
  redirect("/dashboard");
}

// ---------- 3) Segundo paso: código de 6 números ----------
export async function verificarSegundoPasoAction(_prev: Estado, formData: FormData): Promise<Estado> {
  const codigo = String(formData.get("codigo") || "").trim().slice(0, 20);
  const pendiente = await leerIngresoPendiente2FA();
  if (!pendiente) return { error: "Pasó demasiado tiempo. Volvé a ingresar tu email y contraseña." };
  setOrgContext(pendiente.org);
  const clave = `2fa:${pendiente.uid}`;
  if ((await intentosFallidos(clave, pendiente.org)) >= MAX_INTENTOS) {
    return { error: "Demasiados códigos incorrectos. Esperá 15 minutos e intentá de nuevo." };
  }
  const user = await get<{ id: number; rol: string; activo: number; totp_secreto: string | null; totp_respaldo: string | null }>(
    `SELECT id, rol, activo, totp_secreto, totp_respaldo FROM users WHERE id = ? AND organization_id = ?`,
    [pendiente.uid, pendiente.org]
  );
  if (!user || !user.activo || !user.totp_secreto) return { error: "No se pudo completar el ingreso. Volvé a empezar." };

  let valido = verificarTotp(descifrar(user.totp_secreto), codigo);
  let usoRespaldo = false;
  if (!valido && user.totp_respaldo) {
    const restantes = usarCodigoRespaldo(codigo, JSON.parse(user.totp_respaldo) as string[]);
    if (restantes) {
      valido = true;
      usoRespaldo = true;
      await update("users", user.id, { totp_respaldo: JSON.stringify(restantes) });
    }
  }
  await insert("login_intentos", { organization_id: pendiente.org, email: clave, exitoso: valido ? 1 : 0 }).catch(() => {});
  await audit({
    usuario_id: user.id,
    accion: valido ? "login_segundo_paso" : "login_segundo_paso_fallido",
    entidad: "users",
    entidad_id: user.id,
    valor_nuevo: usoRespaldo ? { codigo_de_respaldo: true } : null,
  }).catch(() => {});
  if (!valido) return { error: "Ese código no es correcto. Fijate en la app y escribí los 6 números que aparecen ahora." };

  await borrarIngresoPendiente2FA();
  await createSessionCookie({ id: user.id, rol: user.rol as never, organization_id: pendiente.org });
  redirect("/dashboard");
}
