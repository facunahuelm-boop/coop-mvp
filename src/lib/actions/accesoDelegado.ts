"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseForm, zId, zTextoOpcional, ValidationError } from "@/lib/validation";
import { MENSAJES } from "@/lib/mensajesValidacion";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { usuarioParaDelegar } from "@/lib/accesoDelegado";

/** Fase 3G — el socio le da (o le saca) acceso a un familiar para que lo ayude. */

async function miSocio(userId: number) {
  const s = await get<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE user_id = ? ORDER BY (estado = 'activo') DESC, id LIMIT 1`, [userId]);
  if (!s) throw new Error("Tu usuario no está vinculado a una ficha de socio. Pedile a la administración que lo vincule.");
  return s;
}

const darSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200, "Máximo 200 caracteres.")
    .refine((v) => z.string().email().safeParse(v).success, MENSAJES.email),
  relacion: zTextoOpcional(60),
  puede_actuar: z.string().optional(),
});

export async function darAccesoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    const user = await requireUser();
    const socio = await miSocio(user.id);
    const d = parseForm(darSchema, fd);
    if (d.email === user.email.toLowerCase()) throw new ValidationError("email", "Ese es tu propio email: poné el de tu familiar.");
    const u = await usuarioParaDelegar(d.email);
    const ya = await get<{ id: number }>(`SELECT id FROM accesos_delegados WHERE socio_id = ? AND delegado_user_id = ? AND revocado_en IS NULL`, [socio.id, u.id]);
    if (ya) throw new ValidationError("email", "Esa persona ya tiene acceso.");
    const id = await insert("accesos_delegados", {
      socio_id: socio.id,
      delegado_user_id: u.id,
      relacion: d.relacion,
      puede_actuar: d.puede_actuar === "1" ? 1 : 0,
      otorgado_por_id: user.id,
    });
    await audit({
      usuario_id: user.id,
      accion: "dar_acceso_delegado",
      entidad: "accesos_delegados",
      entidad_id: id,
      valor_nuevo: { socio: socio.nombre, familiar: u.nombre, email: d.email, relacion: d.relacion, puede_actuar: d.puede_actuar === "1" },
    });
    revalidatePath("/acceso-familiar");
    aviso = `Listo: ${u.nombre} ya puede ayudarte desde su cuenta.`;
  });
  return r.ok ? { ...r, aviso } : r;
}

export async function revocarAccesoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(async () => {
    const user = await requireUser();
    const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTextoOpcional(300) }), fd);
    const a = await get<{ socio_id: number; delegado_user_id: number; revocado_en: string | null }>(`SELECT socio_id, delegado_user_id, revocado_en FROM accesos_delegados WHERE id = ?`, [id]);
    if (!a || a.revocado_en) throw new Error("Ese acceso ya no está vigente.");
    const socio = await get<{ user_id: number | null }>(`SELECT user_id FROM socios WHERE id = ?`, [a.socio_id]);
    // Lo revoca el socio, el propio familiar (deja de ayudar) o la administración.
    const puede = socio?.user_id === user.id || a.delegado_user_id === user.id || ["admin", "administracion", "consejo_directivo"].includes(user.rol);
    if (!puede) throw new Error("No podés cambiar este acceso.");
    await update("accesos_delegados", id, { revocado_en: new Date().toISOString(), revocado_por_id: user.id, motivo_revocacion: motivo });
    await audit({ usuario_id: user.id, accion: "revocar_acceso_delegado", entidad: "accesos_delegados", entidad_id: id, valor_nuevo: { motivo } });
    revalidatePath("/acceso-familiar");
  });
}
