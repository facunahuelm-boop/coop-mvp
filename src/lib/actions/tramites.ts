"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { get, all, insert, update, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaOpcional, zEnumSeguro, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { PLANTILLA_HITOS, ESTADO_HITO_LABEL } from "@/lib/tramitesTexto";
import { crearNotificacionesParaUsuarios } from "@/lib/notificaciones";
import { hoyEnUruguay } from "@/lib/horasObra";

/** Fase 2E — Trámites e hitos: quién los carga y actualiza (Consejo, administración, el IAT). */
export async function puedeEditarTramites(rol: string): Promise<boolean> {
  return canEdit(rol as never, "documentos") || rol === "consejo_directivo" || rol === "tecnico";
}
async function requireEditor(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await puedeEditarTramites(user.rol))) throw new Error("No tenés permiso para cambiar los trámites.");
  return user;
}
function revalidar() {
  revalidatePath("/tramites");
  revalidatePath("/mi-vivienda");
  revalidatePath("/dashboard");
}

const ESTADOS = ["pendiente", "en_curso", "hecho", "trabado", "no_aplica"] as const;
const hitoSchema = z.object({
  id: zIdOpcional,
  titulo: zTexto(200),
  descripcion: zTextoOpcional(1000),
  categoria: zEnumSeguro(["personeria", "terreno", "proyecto", "prestamo", "permisos", "obra", "otro"], "otro"),
  responsable_id: zIdOpcional,
  responsable_texto: zTextoOpcional(120),
  fecha_estimada: zFechaOpcional,
  visible_socios: zEnumSeguro(["si", "no"], "si"),
  nota_para_socios: zTextoOpcional(500),
});

export async function guardarHitoAction(formData: FormData) {
  const user = await requireEditor();
  const d = parseForm(hitoSchema, formData);
  const datos = {
    titulo: d.titulo,
    descripcion: d.descripcion,
    categoria: d.categoria,
    responsable_id: d.responsable_id,
    responsable_texto: d.responsable_texto,
    fecha_estimada: d.fecha_estimada,
    visible_socios: d.visible_socios === "si" ? 1 : 0,
    nota_para_socios: d.nota_para_socios,
    actualizado_en: new Date().toISOString(),
  };
  if (d.id) {
    const antes = await get<{ titulo: string }>(`SELECT titulo FROM tramites_hitos WHERE id = ? AND activo = 1`, [d.id]);
    if (!antes) throw new Error("Ese paso no existe.");
    await update("tramites_hitos", d.id, datos);
    await audit({ usuario_id: user.id, accion: "editar_hito", entidad: "tramites_hitos", entidad_id: d.id, valor_nuevo: datos });
  } else {
    const ultimo = await get<{ max: number | null }>(`SELECT MAX(orden) AS max FROM tramites_hitos`);
    const id = await insert("tramites_hitos", { ...datos, orden: (ultimo?.max || 0) + 1, creado_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "crear_hito", entidad: "tramites_hitos", entidad_id: id, valor_nuevo: datos });
  }
  revalidar();
}

const estadoSchema = z.object({ id: zId, estado: zEnumSeguro(ESTADOS), fecha_real: zFechaOpcional, nota_para_socios: zTextoOpcional(500) });

/** Cambiar el estado de un paso (y avisar a los socios cuando se cumple uno que ellos ven). */
export async function cambiarEstadoHitoAction(formData: FormData) {
  const user = await requireEditor();
  const d = parseForm(estadoSchema, formData);
  const h = await get<{ titulo: string; estado: string; visible_socios: number }>(`SELECT titulo, estado, visible_socios FROM tramites_hitos WHERE id = ? AND activo = 1`, [d.id]);
  if (!h) throw new Error("Ese paso no existe.");
  if (h.estado === d.estado) throw new ValidationError("estado", `Ya está «${ESTADO_HITO_LABEL[d.estado]}».`);
  await update("tramites_hitos", d.id, {
    estado: d.estado,
    fecha_real: d.estado === "hecho" ? d.fecha_real || hoyEnUruguay() : null,
    ...(d.nota_para_socios ? { nota_para_socios: d.nota_para_socios } : {}),
    actualizado_en: new Date().toISOString(),
  });
  await audit({ usuario_id: user.id, accion: "cambiar_estado_hito", entidad: "tramites_hitos", entidad_id: d.id, valor_anterior: { estado: h.estado }, valor_nuevo: { titulo: h.titulo, estado: d.estado } });
  if (d.estado === "hecho" && h.visible_socios) {
    const socios = await all<{ id: number }>(`SELECT id FROM users WHERE rol = 'socio' AND activo = 1`).catch(() => []);
    await crearNotificacionesParaUsuarios(
      socios.map((s) => s.id),
      { tipo: "hito_cumplido", titulo: `¡Avanzamos! Se cumplió: ${h.titulo}`, cuerpo: d.nota_para_socios, ref_tabla: "tramites_hitos", ref_id: d.id }
    ).catch(() => {});
  }
  revalidar();
}

export async function moverHitoAction(formData: FormData) {
  const user = await requireEditor();
  const { id, direccion } = parseForm(z.object({ id: zId, direccion: zEnumSeguro(["arriba", "abajo"]) }), formData);
  const lista = await all<{ id: number; orden: number }>(`SELECT id, orden FROM tramites_hitos WHERE activo = 1 ORDER BY orden, id`);
  const i = lista.findIndex((x) => x.id === id);
  const j = direccion === "arriba" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= lista.length) return;
  // Se renumera todo para que el orden quede limpio.
  const nuevo = [...lista];
  [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
  for (let k = 0; k < nuevo.length; k++) if (nuevo[k].orden !== k + 1) await update("tramites_hitos", nuevo[k].id, { orden: k + 1 });
  await audit({ usuario_id: user.id, accion: "mover_hito", entidad: "tramites_hitos", entidad_id: id, valor_nuevo: { direccion } });
  revalidar();
}

export async function quitarHitoAction(formData: FormData) {
  const user = await requireEditor();
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTexto(300) }), formData);
  const h = await get<{ titulo: string }>(`SELECT titulo FROM tramites_hitos WHERE id = ? AND activo = 1`, [id]);
  if (!h) throw new Error("Ese paso no existe.");
  await update("tramites_hitos", id, { activo: 0, actualizado_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "quitar_hito", entidad: "tramites_hitos", entidad_id: id, valor_anterior: { titulo: h.titulo }, valor_nuevo: { motivo } });
  revalidar();
}

/** Carga los pasos típicos (sólo los que todavía no están). */
export async function cargarPlantillaHitosAction(): Promise<number> {
  const user = await requireEditor();
  const existentes = new Set((await all<{ titulo: string }>(`SELECT titulo FROM tramites_hitos WHERE activo = 1`)).map((x) => x.titulo.toLowerCase()));
  const ultimo = await get<{ max: number | null }>(`SELECT MAX(orden) AS max FROM tramites_hitos`);
  let orden = ultimo?.max || 0;
  let n = 0;
  for (const p of PLANTILLA_HITOS) {
    if (existentes.has(p.titulo.toLowerCase())) continue;
    await insert("tramites_hitos", { ...p, orden: ++orden, creado_por_id: user.id });
    n++;
  }
  await audit({ usuario_id: user.id, accion: "plantilla_hitos", entidad: "tramites_hitos", entidad_id: null, valor_nuevo: { agregados: n } });
  revalidar();
  return n;
}

export async function guardarHitoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarHitoAction(fd));
}
export async function cambiarEstadoHitoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarEstadoHitoAction(fd));
}
export async function moverHitoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => moverHitoAction(fd));
}
export async function quitarHitoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => quitarHitoAction(fd));
}
export async function cargarPlantillaHitosFormAction(): Promise<ActionState> {
  let n = 0;
  const r = await conEstadoDeAccion(async () => {
    n = await cargarPlantillaHitosAction();
  });
  return r.ok ? { ...r, aviso: n ? `Se cargaron ${n} paso(s). Revisá las fechas y los responsables.` : "Ya estaban todos los pasos." } : r;
}
