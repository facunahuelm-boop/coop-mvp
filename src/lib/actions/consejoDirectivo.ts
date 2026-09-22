"use server";

// Sub-fase 1.4 ("Consejo Directivo — vista propia", 22/09): igual que las
// actas y la asistencia ya existían antes de crear el "libro" (Sub-fase
// 1.2), la composición de cargos es lo único que faltaba de verdad — ver
// el comentario completo en migrations/0033_consejo_directivo_cargos.sql.
//
// Guardrail no-negociable de esta fase: esto es un registro documental, no
// un mecanismo de autorización. canApprove/canEdit/canRead siguen
// dependiendo exclusivamente de `users.rol` — esta tabla nunca se consulta
// para decidir qué puede hacer alguien en el sistema, solo para mostrar
// quién ocupa cada cargo a efectos de actas y representación institucional.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canApprove } from "@/lib/roles";
import { parseForm, zId, zFecha, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { CARGOS_CONSEJO, type CargoConsejo } from "@/lib/consejoDirectivoCargos";

// Presidente/Secretario/Tesorero son unipersonales (ver el índice único
// parcial de la migración 0033) — Vocal se deja afuera a propósito porque
// un Consejo suele tener varios vocales al mismo tiempo.
const CARGOS_UNIPERSONALES: readonly CargoConsejo[] = ["presidente", "secretario", "tesorero"];

const asignarCargoSchema = z.object({
  user_id: zId,
  cargo: zEnumSeguro(CARGOS_CONSEJO, "vocal"),
  fecha_inicio: zFecha,
});

/**
 * Asigna un cargo (Presidente/Secretario/Tesorero/Vocal) a un integrante
 * del Consejo Directivo. Si el cargo es unipersonal y ya tiene un titular
 * vigente, cierra ese mandato (fecha_fin = fecha de la nueva asignación)
 * antes de crear el nuevo — así una reelección o un recambio quedan
 * registrados como dos mandatos distintos, no como una edición silenciosa
 * del mismo registro.
 */
export async function asignarCargoConsejoAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "comisiones")) throw new Error("No tenés permiso para modificar la composición del Consejo Directivo.");

  const datos = parseForm(asignarCargoSchema, formData);

  const destino = await get<{ id: number; rol: string; activo: number; nombre: string }>(
    `SELECT id, rol, activo, nombre FROM users WHERE id = ?`,
    [datos.user_id]
  );
  if (!destino || !destino.activo) throw new Error("Esa persona no existe o está inactiva.");
  if (destino.rol !== "consejo_directivo") {
    throw new Error("Solo se puede asignar un cargo a alguien con rol Consejo Directivo.");
  }

  let nuevoId: number;
  try {
    if (CARGOS_UNIPERSONALES.includes(datos.cargo)) {
      const titularActual = await get<{ id: number }>(
        `SELECT id FROM consejo_directivo_cargos WHERE cargo = ? AND fecha_fin IS NULL`,
        [datos.cargo]
      );
      if (titularActual) {
        await update("consejo_directivo_cargos", titularActual.id, { fecha_fin: datos.fecha_inicio });
      }
    }

    nuevoId = await insert("consejo_directivo_cargos", {
      user_id: datos.user_id,
      cargo: datos.cargo,
      fecha_inicio: datos.fecha_inicio,
      creado_por_id: user.id,
    });
  } catch (err: any) {
    // 42P01 = "relation does not exist": la migración 0033 todavía no
    // corrió en este entorno. 23505 = red de seguridad ante una carrera
    // entre dos asignaciones simultáneas del mismo cargo unipersonal
    // (idx_consejo_directivo_cargo_unico_vigente). Cualquier otro error se
    // deja pasar tal cual.
    if (err?.code === "42P01") {
      throw new Error("Todavía no se aplicó la actualización de base de datos necesaria para asignar cargos — probá de nuevo en unos minutos.");
    }
    if (err?.code === "23505") {
      throw new Error("Ya se asignó ese cargo justo ahora desde otra sesión — recargá la página para ver el estado actual.");
    }
    throw err;
  }

  await audit({
    usuario_id: user.id,
    accion: "crear",
    entidad: "consejo_directivo_cargos",
    entidad_id: nuevoId,
    valor_nuevo: { user_id: datos.user_id, cargo: datos.cargo, fecha_inicio: datos.fecha_inicio, nombre: destino.nombre },
  });
  revalidatePath("/consejo-directivo");
}

export async function asignarCargoConsejoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => asignarCargoConsejoAction(formData));
}

const finalizarCargoSchema = z.object({ id: zId, fecha_fin: zFecha });

/**
 * Cierra un mandato vigente sin reemplazo inmediato (vacancia) — para el
 * caso de reemplazo directo, alcanza con asignar el cargo a la nueva
 * persona (asignarCargoConsejoAction ya cierra el anterior automáticamente).
 */
export async function finalizarCargoConsejoAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "comisiones")) throw new Error("No tenés permiso para modificar la composición del Consejo Directivo.");

  const { id, fecha_fin } = parseForm(finalizarCargoSchema, formData);
  let cargo: { id: number; fecha_fin: string | null } | undefined;
  try {
    cargo = await get<{ id: number; fecha_fin: string | null }>(`SELECT id, fecha_fin FROM consejo_directivo_cargos WHERE id = ?`, [id]);
  } catch (err: any) {
    if (err?.code === "42P01") throw new Error("Todavía no se aplicó la actualización de base de datos necesaria para esto.");
    throw err;
  }
  if (!cargo) throw new Error("Ese cargo ya no existe.");
  if (cargo.fecha_fin) throw new Error("Ese mandato ya estaba finalizado.");

  await update("consejo_directivo_cargos", id, { fecha_fin });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "consejo_directivo_cargos", entidad_id: id, valor_nuevo: { fecha_fin } });
  revalidatePath("/consejo-directivo");
}

export async function finalizarCargoConsejoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => finalizarCargoConsejoAction(formData));
}
