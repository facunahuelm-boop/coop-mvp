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
import { parseForm, zId, zFecha, zFechaOpcional, zEnumSeguro, zTexto, ValidationError } from "@/lib/validation";
import { all } from "@/lib/db";
import { organoDeCargo, rolDeCargo, CARGO_LABEL, ROLES_DE_CARGO } from "@/lib/consejoDirectivoCargos";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { CARGOS_CONSEJO, type CargoConsejo } from "@/lib/consejoDirectivoCargos";

// Presidente/Secretario/Tesorero son unipersonales (ver el índice único
// parcial de la migración 0033) — Vocal se deja afuera a propósito porque
// un Consejo suele tener varios vocales al mismo tiempo.
const CARGOS_UNIPERSONALES: readonly CargoConsejo[] = ["presidente", "secretario", "tesorero"];
const zCheckboxSi = z.string().optional().transform((v) => v === "on" || v === "si");

const asignarCargoSchema = z.object({
  user_id: zId,
  cargo: zEnumSeguro(CARGOS_CONSEJO, "vocal"),
  fecha_inicio: zFecha,
  // Fase 2D: fin previsto del mandato (para avisar antes de que venza) y
  // permisos derivados del cargo.
  fecha_fin_prevista: zFechaOpcional,
  dar_permisos: zCheckboxSi,
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
  if (datos.fecha_fin_prevista && datos.fecha_fin_prevista <= datos.fecha_inicio) {
    throw new ValidationError("fecha_fin_prevista", "El mandato tiene que terminar después de empezar.");
  }
  // Fase 2D: los permisos se derivan del cargo vigente.
  const rolNuevo = rolDeCargo(datos.cargo);
  if (rolNuevo && destino.rol !== rolNuevo && destino.rol !== "admin") {
    if (!datos.dar_permisos) {
      throw new Error(`Para ese cargo, ${destino.nombre} necesita el rol «${rolNuevo === "tesoreria" ? "Tesorería" : rolNuevo === "fiscal" ? "Comisión Fiscal" : "Consejo Directivo"}». Marcá «Darle los permisos del cargo».`);
    }
    await update("users", destino.id, { rol: rolNuevo });
    await audit({ usuario_id: user.id, accion: "cambiar_rol_por_cargo", entidad: "users", entidad_id: destino.id, valor_anterior: { rol: destino.rol }, valor_nuevo: { rol: rolNuevo, cargo: datos.cargo } });
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
      organo: organoDeCargo(datos.cargo),
      fecha_fin_prevista: datos.fecha_fin_prevista,
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

// ---------- Fase 2D: mandatos ----------

/** Extender el mandato (nueva fecha de fin prevista), por ejemplo hasta la próxima elección. */
export async function extenderMandatoAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "comisiones")) throw new Error("No tenés permiso para modificar mandatos.");
  const { id, fecha_fin_prevista, motivo } = parseForm(z.object({ id: zId, fecha_fin_prevista: zFecha, motivo: zTexto(300) }), formData);
  const c = await get<{ fecha_fin: string | null; fecha_fin_prevista: string | null }>(`SELECT fecha_fin, fecha_fin_prevista FROM consejo_directivo_cargos WHERE id = ?`, [id]);
  if (!c || c.fecha_fin) throw new Error("Ese mandato ya terminó.");
  await update("consejo_directivo_cargos", id, { fecha_fin_prevista, aviso_vencimiento_en: null, permisos_revisados_en: null });
  await audit({ usuario_id: user.id, accion: "extender_mandato", entidad: "consejo_directivo_cargos", entidad_id: id, valor_anterior: { fecha_fin_prevista: c.fecha_fin_prevista }, valor_nuevo: { fecha_fin_prevista, motivo } });
  revalidatePath("/consejo-directivo");
  revalidatePath("/dashboard");
}

/**
 * Mandato vencido (decisión del usuario: «aviso y confirma el admin»): el
 * admin cierra el mandato y, si la persona ya no tiene otro cargo vigente,
 * le quita los permisos sensibles (pasa a socio). Nada cambia solo.
 */
export async function cerrarMandatoVencidoAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Sólo un administrador confirma el cambio de permisos.");
  const { id, quitar_permisos } = parseForm(z.object({ id: zId, quitar_permisos: zCheckboxSi }), formData);
  const c = await get<{ id: number; user_id: number; cargo: CargoConsejo; fecha_fin: string | null; fecha_fin_prevista: string | null; nombre: string; rol: string }>(
    `SELECT c.id, c.user_id, c.cargo, c.fecha_fin, c.fecha_fin_prevista, u.nombre, u.rol FROM consejo_directivo_cargos c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [id]
  );
  if (!c) throw new Error("Ese mandato no existe.");
  if (!c.fecha_fin) await update("consejo_directivo_cargos", id, { fecha_fin: c.fecha_fin_prevista || new Date().toISOString().slice(0, 10) });
  await update("consejo_directivo_cargos", id, { permisos_revisados_en: new Date().toISOString() });
  let rolNuevo: string | null = null;
  if (quitar_permisos && ROLES_DE_CARGO.includes(c.rol)) {
    const otros = await all<{ cargo: CargoConsejo }>(`SELECT cargo FROM consejo_directivo_cargos WHERE user_id = ? AND fecha_fin IS NULL AND id <> ?`, [c.user_id, id]);
    const sigue = otros.map((o) => rolDeCargo(o.cargo)).find((r) => r);
    rolNuevo = sigue ?? "socio";
    if (rolNuevo !== c.rol) {
      await update("users", c.user_id, { rol: rolNuevo });
      await audit({ usuario_id: user.id, accion: "cambiar_rol_por_cargo", entidad: "users", entidad_id: c.user_id, valor_anterior: { rol: c.rol }, valor_nuevo: { rol: rolNuevo, motivo: `Terminó su mandato de ${CARGO_LABEL[c.cargo]}` } });
    }
  }
  await audit({ usuario_id: user.id, accion: "cerrar_mandato", entidad: "consejo_directivo_cargos", entidad_id: id, valor_nuevo: { nombre: c.nombre, cargo: c.cargo, rol_nuevo: rolNuevo } });
  revalidatePath("/consejo-directivo");
  revalidatePath("/dashboard");
}

export async function extenderMandatoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => extenderMandatoAction(formData));
}
export async function cerrarMandatoVencidoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cerrarMandatoVencidoAction(formData));
}

// ---------- Fase 2D: orden del día automático del Consejo ----------

const armarSchema = z.object({
  reunion_id: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null)),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Indicá fecha y hora.").optional().or(z.literal("")),
  lugar: z.string().trim().max(200).optional(),
});

/**
 * Arma el orden del día de la próxima reunión del Consejo con lo que espera
 * una decisión (los temas marcados). Si no hay reunión planificada, la crea.
 * Devuelve el id de la reunión.
 */
export async function armarOrdenDelDiaAction(formData: FormData): Promise<number> {
  const user = await requireUser();
  if (!canApprove(user.rol, "comisiones") && user.rol !== "consejo_directivo") throw new Error("Esto lo hace el Consejo Directivo.");
  const d = parseForm(armarSchema, formData);
  const claves = new Set(formData.getAll("tema").map(String));
  if (!claves.size) throw new Error("Marcá al menos un tema.");
  const { temasParaElConsejo, TIPO_TEMA_LABEL } = await import("@/lib/consejo");
  const temas = (await temasParaElConsejo()).filter((t) => claves.has(t.clave));
  if (!temas.length) throw new Error("Esos temas ya no están pendientes.");
  let reunionId = d.reunion_id;
  if (reunionId) {
    const r = await get<{ tipo: string; estado: string }>(`SELECT tipo, estado FROM reuniones WHERE id = ?`, [reunionId]);
    if (!r || r.tipo !== "consejo_directivo" || r.estado !== "planificada") throw new Error("Esa reunión del Consejo ya no está planificada.");
  } else {
    if (!d.fecha) throw new ValidationError("fecha", "Indicá cuándo es la reunión.");
    reunionId = await insert("reuniones", {
      tipo: "consejo_directivo",
      titulo: `Reunión del Consejo Directivo`,
      fecha: d.fecha,
      lugar: d.lugar || null,
      modalidad: "presencial",
      estado: "planificada",
      creado_por_id: user.id,
    });
  }
  const existentes = await all<{ titulo: string; orden: number }>(`SELECT titulo, orden FROM reunion_agenda_items WHERE reunion_id = ?`, [reunionId]);
  let orden = existentes.reduce((m, e) => Math.max(m, Number(e.orden) || 0), 0);
  let agregados = 0;
  for (const t of temas) {
    if (existentes.some((e) => e.titulo === t.texto)) continue;
    await insert("reunion_agenda_items", {
      reunion_id: reunionId,
      orden: ++orden,
      titulo: t.texto.slice(0, 300),
      descripcion: [TIPO_TEMA_LABEL[t.tipo], t.detalle, `Ver: ${t.href}`].filter(Boolean).join(" · ").slice(0, 1000),
    });
    agregados++;
  }
  await audit({ usuario_id: user.id, accion: "armar_orden_del_dia", entidad: "reuniones", entidad_id: reunionId, valor_nuevo: { temas: agregados } });
  revalidatePath("/consejo-directivo");
  revalidatePath(`/reuniones/${reunionId}`);
  return reunionId;
}

export async function armarOrdenDelDiaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let id = 0;
  const r = await conEstadoDeAccion(async () => {
    id = await armarOrdenDelDiaAction(formData);
  });
  return r.ok ? { ...r, aviso: `/reuniones/${id}` } : r;
}
