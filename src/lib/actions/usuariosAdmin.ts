"use server";

import { z } from "zod";
import { requireUser, hashPassword } from "@/lib/auth";
import { get, insert, update, audit } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { parseForm, zTexto, zId, zEnumSeguro, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { ROLES } from "@/lib/roles";

/**
 * Fase 4 ("Seguridad y permisos granulares(16) + Seguridad de cuentas/2FA/
 * sesiones(17) + Eliminación segura/archivar en vez de borrar(18)") —
 * Sub-fase 4.1: Gestión de usuarios (sección 16).
 *
 * Hallazgo de la auditoría previa: no existía NINGUNA forma de crear,
 * desactivar o cambiarle el rol a una cuenta de otra persona más que con
 * SQL directo contra la base — `usuarios.ts` solo tenía acciones sobre uno
 * mismo (cambiar la propia contraseña/foto). `usuarios/[id]/page.tsx` (Fase
 * 6 del Plan Maestro) ya había anticipado esto explícitamente en su propio
 * comentario: "Deliberadamente FUERA de esta fase: no hay edición de
 * nombre/rol/estado de otra cuenta ni alta de usuarios nuevos — eso es
 * 'gestión de usuarios' [...] un alcance mayor". Este archivo es exactamente
 * eso.
 *
 * A propósito NO se toca el modelo de permisos (roles.ts, MATRIX,
 * tienePermiso): sigue siendo por módulo, no por campo — construir un
 * sistema de permisos configurable por cooperativa sería un alcance mucho
 * mayor que "administrar cuentas", y la auditoría no encontró ningún caso
 * real que lo necesite hoy.
 *
 * Gate: solo `admin` (no se amplía a `consejo_directivo` como sí hace
 * `/configuracion`) — mismo criterio ya usado para las acciones más
 * sensibles del sistema (`user.rol !== "admin"` en
 * documentos.ts/proveedores.ts/compras.ts para hard-deletes, y en los
 * endpoints `/api/admin/*`): gestionar quién tiene acceso al sistema es al
 * menos tan sensible como borrar un documento.
 */
async function requireAdmin() {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede gestionar usuarios.");
  return user;
}

const ROLES_VALORES = ROLES as unknown as [string, ...string[]];

const emailUsuario = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, "Máximo 200 caracteres.")
  .refine((v) => z.string().email().safeParse(v).success, "Ingresá un email válido.");

const passwordNueva = z
  .string()
  .min(8, "Tiene que tener al menos 8 caracteres.")
  .max(200, "Máximo 200 caracteres.");

const crearUsuarioSchema = z.object({
  nombre: zTexto(200),
  email: emailUsuario,
  rol: zEnumSeguro(ROLES_VALORES),
  password: passwordNueva,
});

export async function crearUsuarioAction(formData: FormData) {
  const admin = await requireAdmin();
  const datos = parseForm(crearUsuarioSchema, formData);

  // Chequeo previo con mensaje claro pegado al campo — sin esto, el mismo
  // caso cae en la restricción UNIQUE(organization_id, email) de la base y
  // sale como "Ocurrió un problema al procesar la solicitud" (ver
  // esErrorTecnico en actionState.ts), que no le dice a el/la admin qué
  // pasó realmente.
  const existe = await get<{ id: number }>(`SELECT id FROM users WHERE email = ?`, [datos.email]);
  if (existe) throw new ValidationError("email", "Ya existe un usuario con ese email en esta cooperativa.");

  const hash = await hashPassword(datos.password);
  const id = await insert("users", {
    nombre: datos.nombre,
    email: datos.email,
    password_hash: hash,
    rol: datos.rol,
    activo: 1,
  });

  // Sin la contraseña en la auditoría, ni en texto plano ni el hash — mismo
  // criterio que cambiarPasswordAction en usuarios.ts.
  await audit({
    usuario_id: admin.id,
    accion: "crear_usuario",
    entidad: "users",
    entidad_id: id,
    valor_nuevo: { nombre: datos.nombre, email: datos.email, rol: datos.rol },
  });
  revalidatePath("/usuarios");
}

export async function crearUsuarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearUsuarioAction(formData));
}

const cambiarRolSchema = z.object({ id: zId, rol: zEnumSeguro(ROLES_VALORES) });

export async function cambiarRolUsuarioAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, rol } = parseForm(cambiarRolSchema, formData);

  // No se puede tocar el propio rol desde acá — evita que el único admin
  // activo se quite a sí mismo el rol de admin por error y deje a la
  // cooperativa sin nadie que pueda revertirlo (ni siquiera otro admin,
  // porque puede no haber otro). Cambiar el propio rol le corresponde a
  // otro administrador, nunca a uno mismo.
  if (id === admin.id) {
    throw new Error("No podés cambiar tu propio rol desde acá — pedile a otro administrador que lo haga.");
  }

  const usuario = await get<{ rol: string }>(`SELECT rol FROM users WHERE id = ?`, [id]);
  if (!usuario) throw new Error("Ese usuario ya no existe.");
  if (usuario.rol === rol) return; // nada que hacer, evita una fila de auditoría vacía

  await update("users", id, { rol });
  await audit({
    usuario_id: admin.id,
    accion: "cambiar_rol",
    entidad: "users",
    entidad_id: id,
    valor_anterior: { rol: usuario.rol },
    valor_nuevo: { rol },
  });
  revalidatePath("/usuarios");
  revalidatePath(`/usuarios/${id}`);
}

export async function cambiarRolUsuarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarRolUsuarioAction(formData));
}

const alternarActivoSchema = z.object({ id: zId, activo: zEnumSeguro(["true", "false"] as const) });

export async function alternarActivoUsuarioAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, activo } = parseForm(alternarActivoSchema, formData);
  const nuevoActivo = activo === "true";

  // Mismo criterio que el rol: no te podés desactivar a vos mismo. Con esto
  // más el bloqueo de arriba, es imposible que la cooperativa se quede sin
  // ningún admin activo por una acción hecha contra la propia cuenta —
  // desactivar a OTRO admin (si hay más de uno) sigue dejando a quien hace
  // la acción activo.
  if (id === admin.id && !nuevoActivo) {
    throw new Error("No podés desactivar tu propia cuenta.");
  }

  const usuario = await get<{ nombre: string }>(`SELECT nombre FROM users WHERE id = ?`, [id]);
  if (!usuario) throw new Error("Ese usuario ya no existe.");

  // getCurrentUser() (auth.ts) vuelve a consultar `users.activo` en cada
  // pedido — desactivar acá invalida cualquier sesión abierta de esa
  // persona de inmediato, en el próximo pedido que haga, sin necesidad de
  // ningún mecanismo extra de revocación de sesión.
  await update("users", id, { activo: nuevoActivo ? 1 : 0 });
  await audit({
    usuario_id: admin.id,
    accion: nuevoActivo ? "activar_usuario" : "desactivar_usuario",
    entidad: "users",
    entidad_id: id,
  });
  revalidatePath("/usuarios");
  revalidatePath(`/usuarios/${id}`);
}

export async function alternarActivoUsuarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => alternarActivoUsuarioAction(formData));
}

const restablecerPasswordSchema = z.object({ id: zId, password: passwordNueva });

/**
 * Restablecer la contraseña de OTRA persona (a diferencia de
 * cambiarPasswordAction en usuarios.ts, que solo opera sobre uno mismo y
 * exige la contraseña actual). Cubre la necesidad real de hoy — alguien
 * olvidó su contraseña y no hay ningún flujo de autoservicio todavía (eso
 * es la Sub-fase 4.3, "recuperación por email", pendiente) — sin
 * confundirse con ese flujo futuro: acá es siempre un admin actuando a
 * pedido de la persona, nunca la propia persona sin sesión.
 */
export async function restablecerPasswordUsuarioAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, password } = parseForm(restablecerPasswordSchema, formData);

  const usuario = await get<{ nombre: string }>(`SELECT nombre FROM users WHERE id = ?`, [id]);
  if (!usuario) throw new Error("Ese usuario ya no existe.");

  const hash = await hashPassword(password);
  await update("users", id, { password_hash: hash });
  // Sin valor_anterior/valor_nuevo a propósito, mismo criterio que
  // cambiarPasswordAction: la auditoría registra QUE cambió, nunca su
  // contenido.
  await audit({ usuario_id: admin.id, accion: "restablecer_password", entidad: "users", entidad_id: id });
  revalidatePath(`/usuarios/${id}`);
}

export async function restablecerPasswordUsuarioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => restablecerPasswordUsuarioAction(formData));
}
