"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { get, update, audit } from "@/lib/db";
import { requireUser, createSessionCookie } from "@/lib/auth";
import { cifrar, descifrar } from "@/lib/crypto";
import { generarSecretoTotp, verificarTotp, generarCodigosRespaldo, ROLES_CON_2FA } from "@/lib/totp";
import { obtenerReglamento } from "@/lib/reglamento";
import { parseForm, zId, zTexto, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/**
 * Fase 1E — "Mi seguridad": verificación en dos pasos y cerrar sesión en
 * todos los dispositivos. Todo queda en la auditoría (sin secretos).
 */

const codigoSchema = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Escribí los 6 números que muestra la app.") });

/** Paso 1: genera el secreto (todavía sin activar) para mostrar el QR. */
export async function prepararDosPasosAction() {
  const user = await requireUser();
  if (user.totp_activo) return;
  await update("users", user.id, { totp_secreto: cifrar(generarSecretoTotp()), totp_activado_en: null, totp_respaldo: null });
  revalidatePath("/mi-seguridad");
}

export async function prepararDosPasosFormAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => prepararDosPasosAction());
}

/** Paso 2: confirma con el primer código y activa. Devuelve los códigos de respaldo (se muestran una sola vez). */
export async function confirmarDosPasosAction(formData: FormData): Promise<string[]> {
  const user = await requireUser();
  const { codigo } = parseForm(codigoSchema, formData);
  const fila = await get<{ totp_secreto: string | null; totp_activado_en: string | null }>(`SELECT totp_secreto, totp_activado_en FROM users WHERE id = ?`, [user.id]);
  if (!fila?.totp_secreto) throw new Error("Primero tocá «Activar» para ver el código QR.");
  if (fila.totp_activado_en) throw new Error("La verificación en dos pasos ya está activada.");
  if (!verificarTotp(descifrar(fila.totp_secreto), codigo)) {
    throw new ValidationError("codigo", "Ese código no coincide. Revisá que la hora del celular esté bien y probá con el número que aparece ahora.");
  }
  const { codigos, hashes } = generarCodigosRespaldo();
  await update("users", user.id, { totp_activado_en: new Date().toISOString(), totp_respaldo: JSON.stringify(hashes) });
  await audit({ usuario_id: user.id, accion: "activar_dos_pasos", entidad: "users", entidad_id: user.id });
  // Sin revalidar acá: la pantalla tiene que seguir mostrando los códigos de
  // respaldo hasta que la persona toque "Ya los guardé" (que recarga).
  return codigos;
}

export async function confirmarDosPasosFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let codigos: string[] = [];
  const r = await conEstadoDeAccion(async () => {
    codigos = await confirmarDosPasosAction(formData);
  });
  return r.ok ? { ...r, aviso: codigos.join(" ") } : r;
}

export async function desactivarDosPasosAction(formData: FormData) {
  const user = await requireUser();
  const { codigo } = parseForm(codigoSchema, formData);
  const reglamento = await obtenerReglamento();
  if (reglamento.seguridad.exigir2fa && (ROLES_CON_2FA as readonly string[]).includes(user.rol)) {
    throw new Error("La cooperativa exige la verificación en dos pasos para tu rol: no se puede desactivar.");
  }
  const fila = await get<{ totp_secreto: string | null }>(`SELECT totp_secreto FROM users WHERE id = ?`, [user.id]);
  if (!fila?.totp_secreto || !verificarTotp(descifrar(fila.totp_secreto), codigo)) {
    throw new ValidationError("codigo", "Ese código no coincide.");
  }
  await update("users", user.id, { totp_secreto: null, totp_activado_en: null, totp_respaldo: null });
  await audit({ usuario_id: user.id, accion: "desactivar_dos_pasos", entidad: "users", entidad_id: user.id });
  revalidatePath("/mi-seguridad");
  revalidatePath("/", "layout");
}

export async function desactivarDosPasosFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => desactivarDosPasosAction(formData));
}

/** Cierra todas las otras sesiones (celular perdido, computadora compartida). Esta sigue abierta. */
export async function cerrarOtrasSesionesAction() {
  const user = await requireUser();
  await update("users", user.id, { sesiones_invalidadas_en: new Date().toISOString() });
  await createSessionCookie({ id: user.id, rol: user.rol, organization_id: user.organization_id });
  await audit({ usuario_id: user.id, accion: "cerrar_otras_sesiones", entidad: "users", entidad_id: user.id });
}

export async function cerrarOtrasSesionesFormAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => cerrarOtrasSesionesAction());
  return r.ok ? { ...r, aviso: "Listo: se cerraron las sesiones abiertas en otros dispositivos." } : r;
}

/** Un administrador quita la verificación en dos pasos de otra persona (perdió el celular). */
export async function quitarDosPasosDeUsuarioAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Sólo un administrador puede hacer esto.");
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTexto(300) }), formData);
  const otro = await get<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE id = ?`, [id]);
  if (!otro) throw new Error("Ese usuario no existe.");
  await update("users", id, { totp_secreto: null, totp_activado_en: null, totp_respaldo: null, sesiones_invalidadas_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "quitar_dos_pasos", entidad: "users", entidad_id: id, valor_nuevo: { nombre: otro.nombre, motivo } });
  revalidatePath(`/usuarios/${id}`);
}

export async function quitarDosPasosDeUsuarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => quitarDosPasosDeUsuarioAction(formData));
}
