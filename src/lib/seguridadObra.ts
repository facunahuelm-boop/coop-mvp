import { all, get, insert, audit } from "@/lib/db";
import { sumarDias, hoyEnUruguay } from "@/lib/horasObra";
import { canEdit } from "@/lib/roles";
import type { SessionUser } from "@/lib/auth";

/**
 * Fase 3E — Seguridad en la obra: checklist diario en el celular (cada punto
 * que no se cumple genera una tarea correctiva, A22), elementos de protección
 * (EPP) entregados por persona con constancia, e inducción de seguridad
 * (sin inducción se avisa —o no se deja— al asignar horas de obra, según el
 * reglamento).
 */

export const ELEMENTOS_EPP = [
  "Casco",
  "Botas de seguridad",
  "Guantes",
  "Lentes de protección",
  "Protección auditiva",
  "Chaleco reflectivo",
  "Arnés de seguridad",
  "Ropa de trabajo",
  "Tapabocas / máscara",
] as const;

/** Puede hacer el checklist y cargar EPP e inducciones: quien edita Seguridad o integra una Comisión de Seguridad. */
export async function puedeGestionarSeguridad(user: SessionUser): Promise<boolean> {
  if (canEdit(user.rol, "seguridad")) return true;
  const m = await get<{ id: number }>(
    `SELECT cm.id FROM comision_miembros cm JOIN comisiones c ON c.id = cm.comision_id
      WHERE cm.user_id = ? AND cm.activo = 1 AND c.activa = 1 AND c.funcion = 'seguridad' LIMIT 1`,
    [user.id]
  ).catch(() => undefined);
  return !!m;
}

export const ERROR_SIN_PERMISO_SEGURIDAD =
  "No tenés permiso para esto — lo hace la Comisión de Seguridad, el técnico o la conducción de la cooperativa.";

/** La Comisión de Seguridad activa (para las tareas correctivas), o null si no hay. */
export async function comisionSeguridadId(): Promise<number | null> {
  const c = await get<{ id: number }>(`SELECT id FROM comisiones WHERE activa = 1 AND funcion = 'seguridad' ORDER BY id LIMIT 1`).catch(() => undefined);
  return c?.id ?? null;
}

export type Persona = {
  /** "s-12" (socio titular) o "i-34" (integrante del núcleo). */
  clave: string;
  nombre: string;
  socio_id: number;
  integrante_id: number | null;
  nucleo_id: number | null;
  nucleo: string | null;
};

/** Socios activos y los integrantes adultos de su núcleo: quienes pueden ir a la obra. */
export async function personasDeLaCooperativa(): Promise<Persona[]> {
  const socios = await all<{ id: number; nombre: string; nucleo_id: number | null; nucleo: string | null }>(
    `SELECT s.id, s.nombre, s.nucleo_id, n.nombre AS nucleo FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
      WHERE s.estado = 'activo' ORDER BY n.nombre NULLS LAST, s.nombre`
  );
  const integrantes = await all<{ id: number; socio_id: number; nombre: string; apellido: string | null }>(
    `SELECT id, socio_id, nombre, apellido FROM socio_integrantes WHERE estado = 'activo' AND COALESCE(tipo_integrante, 'adulto') = 'adulto' AND COALESCE(relacion, '') <> 'titular' ORDER BY nombre`
  ).catch(() => []);
  const porSocio = new Map<number, typeof integrantes>();
  for (const i of integrantes) porSocio.set(i.socio_id, [...(porSocio.get(i.socio_id) ?? []), i]);
  const out: Persona[] = [];
  for (const s of socios) {
    out.push({ clave: `s-${s.id}`, nombre: s.nombre, socio_id: s.id, integrante_id: null, nucleo_id: s.nucleo_id, nucleo: s.nucleo });
    for (const i of porSocio.get(s.id) ?? []) {
      out.push({ clave: `i-${i.id}`, nombre: [i.nombre, i.apellido].filter(Boolean).join(" "), socio_id: s.id, integrante_id: i.id, nucleo_id: s.nucleo_id, nucleo: s.nucleo });
    }
  }
  return out;
}

/** Interpreta "s-12" / "i-34" contra la cooperativa actual (RLS). */
export async function buscarPersona(clave: string): Promise<Persona | null> {
  const m = /^([si])-(\d{1,9})$/.exec(clave);
  if (!m) return null;
  const id = Number(m[2]);
  if (m[1] === "s") {
    const s = await get<{ id: number; nombre: string; nucleo_id: number | null; nucleo: string | null }>(
      `SELECT s.id, s.nombre, s.nucleo_id, n.nombre AS nucleo FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id WHERE s.id = ?`,
      [id]
    );
    return s ? { clave, nombre: s.nombre, socio_id: s.id, integrante_id: null, nucleo_id: s.nucleo_id, nucleo: s.nucleo } : null;
  }
  const i = await get<{ id: number; socio_id: number; nombre: string; apellido: string | null; nucleo_id: number | null; nucleo: string | null }>(
    `SELECT i.id, i.socio_id, i.nombre, i.apellido, s.nucleo_id, n.nombre AS nucleo
       FROM socio_integrantes i JOIN socios s ON s.id = i.socio_id LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id WHERE i.id = ?`,
    [id]
  );
  return i ? { clave, nombre: [i.nombre, i.apellido].filter(Boolean).join(" "), socio_id: i.socio_id, integrante_id: i.id, nucleo_id: i.nucleo_id, nucleo: i.nucleo } : null;
}

export const clavePersona = (r: { socio_id: number | null; integrante_id: number | null }) =>
  r.integrante_id ? `i-${r.integrante_id}` : r.socio_id ? `s-${r.socio_id}` : null;

/** Claves ("s-12", "i-34") de las personas con inducción vigente. */
export async function personasConInduccion(): Promise<Set<string>> {
  const filas = await all<{ socio_id: number | null; integrante_id: number | null }>(
    `SELECT socio_id, integrante_id FROM inducciones_seguridad WHERE anulado_en IS NULL`
  ).catch(() => []);
  return new Set(filas.map(clavePersona).filter((x): x is string => !!x));
}

/** ¿La cooperativa ya empezó a registrar inducciones? (antes de eso no se controla). */
export async function hayInducciones(): Promise<boolean> {
  const f = await get<{ id: number }>(`SELECT id FROM inducciones_seguridad WHERE anulado_en IS NULL LIMIT 1`).catch(() => undefined);
  return !!f;
}

/** ¿Alguien del núcleo (titular o integrante) tiene la inducción? */
export async function nucleoTieneInduccion(nucleoId: number): Promise<boolean> {
  const f = await get<{ id: number }>(
    `SELECT ind.id FROM inducciones_seguridad ind JOIN socios s ON s.id = ind.socio_id
      WHERE ind.anulado_en IS NULL AND s.nucleo_id = ? LIMIT 1`,
    [nucleoId]
  ).catch(() => undefined);
  return !!f;
}

export type ItemChecklist = { item: string; ok: boolean; na?: boolean; obs?: string | null };

export function leerChecklist(json: string | null | undefined): ItemChecklist[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Puntos a corregir (no cumplidos y que aplican). */
export const fallasDe = (items: ItemChecklist[]) => items.filter((x) => !x.ok && !x.na);

/** Días que tiene la Comisión de Seguridad para corregir un punto del checklist. */
export const DIAS_PARA_CORREGIR = 2;

/**
 * A22 — cada punto no cumplido de un checklist o una inspección genera una
 * tarea correctiva para la Comisión de Seguridad (prioridad alta, vence en
 * DIAS_PARA_CORREGIR días). Devuelve cuántas creó.
 */
export async function crearTareasCorrectivas(
  inspeccionId: number,
  fallas: ItemChecklist[],
  origen: "checklist diario" | "inspección",
  userId: number
): Promise<number> {
  if (!fallas.length) return 0;
  const comisionId = await comisionSeguridadId();
  const hoy = hoyEnUruguay();
  const dmy = hoy.split("-").reverse().join("/");
  for (const f of fallas) {
    const id = await insert("tareas", {
      comision_id: comisionId,
      // Sin Comisión de Seguridad, la tarea queda a cargo de quien hizo el control.
      responsable_id: comisionId ? null : userId,
      titulo: `Corregir: ${f.item}`.slice(0, 200),
      descripcion: `No se cumplía en el ${origen} del ${dmy}.${f.obs ? ` Observación: ${f.obs}` : ""}`,
      prioridad: "alta",
      fecha_vencimiento: sumarDias(hoy, DIAS_PARA_CORREGIR),
      creado_por_id: userId,
      inspeccion_id: inspeccionId,
    });
    await audit({ usuario_id: userId, accion: "crear", entidad: "tareas", entidad_id: id, valor_nuevo: { titulo: `Corregir: ${f.item}`, origen, inspeccion_id: inspeccionId } });
  }
  return fallas.length;
}
