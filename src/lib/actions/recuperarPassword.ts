"use server";

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { rootGet, get, update, audit } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { setOrgContext } from "@/lib/tenant";
import { enviarEmailRecuperacion } from "@/lib/email";

/**
 * Fase 4 ("Seguridad y permisos granulares(16) + Seguridad de cuentas/2FA/
 * sesiones(17) + Eliminación segura(18)") — Sub-fase 4.3: Recuperación de
 * contraseña por email (sección 17, último de los 3 problemas reales que
 * tenía esa sección junto a 4.1 y 4.2).
 *
 * Mismo estilo de retorno que loginAction (auth.ts) a propósito — estas dos
 * acciones son, como el login, pantallas públicas sin sesión, no una acción
 * más del área autenticada — en vez de sumar un tercer patrón de estado de
 * formulario (ActionState/conEstadoDeAccion) a los dos que ya existen.
 */

const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "coova";
const VALIDEZ_HORAS = 1;
const REENVIO_MINUTOS = 2;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// HALLAZGO REAL de la Sub-fase 4.2 (incidente en producción, ver CHANGELOG):
// desplegar código que lee una columna nueva ANTES de correr su migración
// puede tirar "column does not exist" (42703) en cualquier consulta que la
// mencione. Ahí ese error tumbaba el login de todo el mundo porque
// getCurrentUser() corre en cada pedido; acá el radio de impacto ya es mucho
// menor (una sola pantalla nueva, no una que ya use nadie), pero se aplica
// la misma lección desde el principio en vez de esperar a que vuelva a
// pasar: si esta columna todavía no existe, se degrada con el MISMO mensaje
// genérico que ya se muestra siempre (nunca se inventa un token, nunca se
// cae con un error crudo) y se loggea para que quede visible.
function esColumnaInexistente(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "42703";
}

/** Mensaje idéntico exista o no la cuenta, esté activa o no, y se haya
 * podido mandar el email o no — mismo criterio anti-enumeración que ya usa
 * loginAction: decir la verdad puntual ("esa cuenta no existe" / "ya
 * pediste uno, esperá") le daría a cualquiera una forma de confirmar qué
 * emails están registrados en el sistema, o de saber si un envío de SMTP
 * está roto en esta cooperativa. */
const MENSAJE_GENERICO =
  "Si existe una cuenta activa con ese email en esta cooperativa, te enviamos un enlace para elegir una contraseña nueva. Revisá tu casilla (y la carpeta de spam).";

export async function solicitarRecuperacionAction(
  _prev: { ok?: boolean; mensaje?: string; error?: string } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 200);
  if (!email) return { error: "Completá tu email." };

  const slug = (await cookies()).get("coop_slug")?.value || DEFAULT_SLUG;
  const org = await rootGet<{ id: number; activo: number }>(`SELECT id, activo FROM organizations WHERE slug = ?`, [
    slug,
  ]);
  if (!org || !org.activo) {
    // Esto sí es un mensaje distinto: no es sobre SI existe una cuenta, es
    // sobre si el enlace que la persona usó para llegar acá es válido — lo
    // mismo que ya hace loginAction en el mismo caso.
    return { error: "No encontramos esa cooperativa. Verificá el enlace de acceso." };
  }
  setOrgContext(org.id);

  let user: { id: number; nombre: string; activo: number; reset_solicitado_en: string | null } | undefined;
  try {
    user = await get<{ id: number; nombre: string; activo: number; reset_solicitado_en: string | null }>(
      `SELECT id, nombre, activo, reset_solicitado_en FROM users WHERE email = ? AND organization_id = ?`,
      [email, org.id]
    );
  } catch (err) {
    if (!esColumnaInexistente(err)) throw err;
    console.error("[recuperar-password] Migración 0037 todavía no corrió — no se generó ningún token.", err);
    return { ok: true, mensaje: MENSAJE_GENERICO };
  }

  if (user && user.activo) {
    const pidioHaceRato =
      !user.reset_solicitado_en || Date.now() - new Date(user.reset_solicitado_en).getTime() > REENVIO_MINUTOS * 60_000;

    // Si pidió un enlace hace menos de REENVIO_MINUTOS, no se genera uno
    // nuevo ni se reenvía el mail — evita que alguien use este formulario
    // para bombardear de emails la casilla de otra persona. El mensaje que
    // ve quien lo pide es igual en los dos casos, a propósito.
    if (pidioHaceRato) {
      const token = crypto.randomBytes(32).toString("hex");
      const ahora = new Date();
      const expira = new Date(ahora.getTime() + VALIDEZ_HORAS * 60 * 60_000);
      await update("users", user.id, {
        reset_token_hash: hashToken(token),
        reset_token_expira_en: expira.toISOString(),
        reset_solicitado_en: ahora.toISOString(),
      });

      const h = await headers();
      const host = h.get("host") || "";
      const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
      const link = `${proto}://${host}/restablecer-password?token=${token}`;

      const resultado = await enviarEmailRecuperacion(email, user.nombre, link).catch((err) => {
        console.error("[recuperar-password] Error inesperado enviando el email:", err);
        return { ok: false, error: String(err) };
      });
      if (!resultado.ok) {
        // Nunca cambia lo que ve la persona (ver MENSAJE_GENERICO) — esto es
        // solo para que quede visible en el servidor si el SMTP de esta
        // cooperativa está mal configurado o caído.
        console.error(`[recuperar-password] No se pudo enviar el email a ${email}:`, resultado.error);
      }

      await audit({
        usuario_id: user.id,
        accion: "solicitar_recuperacion_password",
        entidad: "users",
        entidad_id: user.id,
      }).catch((err) => console.error("[recuperar-password] No se pudo registrar en la auditoría:", err));
    }
  }

  return { ok: true, mensaje: MENSAJE_GENERICO };
}

const passwordNueva = { min: 8, max: 200 };

export async function restablecerPasswordAction(
  _prev: { error?: string } | undefined,
  formData: FormData
) {
  const token = String(formData.get("token") || "").trim();
  const nueva = String(formData.get("nueva") || "");
  const confirmar = String(formData.get("confirmar") || "");

  if (!token) return { error: "Enlace inválido — pedí uno nuevo desde la pantalla de inicio de sesión." };
  if (nueva.length < passwordNueva.min || nueva.length > passwordNueva.max) {
    return { error: `La contraseña tiene que tener entre ${passwordNueva.min} y ${passwordNueva.max} caracteres.` };
  }
  if (nueva !== confirmar) return { error: "Las contraseñas no coinciden." };

  const slug = (await cookies()).get("coop_slug")?.value || DEFAULT_SLUG;
  const org = await rootGet<{ id: number; activo: number }>(`SELECT id, activo FROM organizations WHERE slug = ?`, [
    slug,
  ]);
  if (!org || !org.activo) {
    return { error: "No encontramos esa cooperativa. Verificá el enlace de acceso." };
  }
  setOrgContext(org.id);

  const hash = hashToken(token);
  let user: { id: number } | undefined;
  try {
    user = await get<{ id: number }>(
      `SELECT id FROM users
       WHERE reset_token_hash = ? AND reset_token_expira_en > NOW() AND organization_id = ? AND activo = 1`,
      [hash, org.id]
    );
  } catch (err) {
    if (!esColumnaInexistente(err)) throw err;
    // Si la migración 0037 todavía no corrió, nadie pudo haber generado un
    // token real todavía (solicitarRecuperacionAction se degrada antes de
    // llegar a esto) — el mensaje real sigue siendo "no hay ningún enlace
    // válido acá".
    console.error("[recuperar-password] Migración 0037 todavía no corrió.", err);
    user = undefined;
  }
  if (!user) {
    return { error: "El enlace no es válido o ya venció. Pedí uno nuevo desde la pantalla de inicio de sesión." };
  }

  const nuevoHash = await hashPassword(nueva);
  // Un solo uso: se limpia el token apenas se usa, así el mismo link no
  // sirve dos veces. password_changed_en (Sub-fase 4.2) invalida además
  // cualquier otra sesión que hubiera quedado abierta con la contraseña
  // vieja — mismo mecanismo que ya usan cambiarPasswordAction y
  // restablecerPasswordUsuarioAction, sin nada nuevo que construir acá.
  await update("users", user.id, {
    password_hash: nuevoHash,
    password_changed_en: new Date().toISOString(),
    reset_token_hash: null,
    reset_token_expira_en: null,
  });

  // Sin valor_anterior/valor_nuevo a propósito, mismo criterio que el resto
  // de los cambios de contraseña: la auditoría registra QUE cambió, nunca
  // su contenido.
  await audit({
    usuario_id: user.id,
    accion: "recuperar_password",
    entidad: "users",
    entidad_id: user.id,
  }).catch((err) => console.error("[recuperar-password] No se pudo registrar en la auditoría:", err));

  redirect("/login?recuperada=1");
}
