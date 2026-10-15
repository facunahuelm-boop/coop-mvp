import { all, get } from "@/lib/db";
import { hoyEnUruguay, sumarDias, lunesDe } from "@/lib/horasObra";
import type { SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { esDirectiva } from "@/lib/qrPermisos";
import { puedeGestionarComision } from "@/lib/comisionAuth";

/**
 * Comisión de Obra según el Reglamento de UFAMA (Art. 5, 8, 10, 11, 18).
 * Todas las lecturas toleran una migración que todavía no corrió (vacío).
 */

const tolerar = <T,>(p: Promise<T>, def: T) => p.catch(() => def);

// ---------- Integración (Art. 10a) ----------

export const REPRESENTA = {
  compras: "Subcomisión de Compras",
  administracion: "Subcomisión de Administración",
  tesoreria: "Tesorería",
  direccion_obra: "Dirección de Obra (IAT)",
  capataz: "Capataz",
  socio_votado: "Socio/a votado/a en asamblea",
} as const;
export type Representa = keyof typeof REPRESENTA;
export const REPRESENTA_CLAVES = Object.keys(REPRESENTA) as Representa[];
/** Lo que pide el Art. 10a: uno de cada uno, y al menos tres socios votados. */
export const SOCIOS_VOTADOS_MINIMOS = 3;

export type IntegranteObra = { user_id: number; nombre: string; rol_en_comision: string; representa: string | null };
export type Integracion = {
  integrantes: IntegranteObra[];
  faltan: { clave: Representa; etiqueta: string; falta: number }[];
  completa: boolean;
};

export async function cargarIntegracion(comisionId: number): Promise<Integracion> {
  const integrantes = await tolerar(
    all<IntegranteObra>(
      `SELECT m.user_id, u.nombre, m.rol_en_comision, m.representa
         FROM comision_miembros m JOIN users u ON u.id = m.user_id
        WHERE m.comision_id = ? AND m.activo = 1 ORDER BY u.nombre`,
      [comisionId]
    ),
    []
  );
  const faltan = REPRESENTA_CLAVES.map((clave) => {
    const tiene = integrantes.filter((i) => i.representa === clave).length;
    const pide = clave === "socio_votado" ? SOCIOS_VOTADOS_MINIMOS : 1;
    return { clave, etiqueta: REPRESENTA[clave], falta: Math.max(0, pide - tiene) };
  }).filter((f) => f.falta > 0);
  return { integrantes, faltan, completa: faltan.length === 0 };
}

// ---------- Planes de trabajo (Art. 11b) ----------

export type PlanTarea = { id: number; tipo: "semanal" | "mensual"; desde: string; hasta: string; tarea: string; responsable: string | null; responsable_id: number | null; estado: "pendiente" | "en_curso" | "hecha" };

export async function cargarPlanes(): Promise<PlanTarea[]> {
  const hoy = hoyEnUruguay();
  return tolerar(
    all<PlanTarea>(
      `SELECT p.id, p.tipo, p.desde, p.hasta, p.tarea, p.estado, p.responsable_id, u.nombre AS responsable
         FROM plan_trabajo_obra p LEFT JOIN users u ON u.id = p.responsable_id
        WHERE p.anulado_en IS NULL AND p.hasta >= ?
        ORDER BY p.desde, p.id`,
      [sumarDias(hoy, -30)]
    ),
    []
  );
}

// ---------- Horario extendido (Art. 18) ----------

export type TurnoExtendido = { id: number; fecha: string; tipo: "extendido" | "sabado"; hora_inicio: string; hora_fin: string; tarea: string; supervision: string | null; encargado: string; estado: "planificado" | "realizado" | "cancelado" };

export async function cargarTurnosExtendidos(): Promise<TurnoExtendido[]> {
  const hoy = hoyEnUruguay();
  return tolerar(
    all<TurnoExtendido>(
      `SELECT t.id, t.fecha, t.tipo, t.hora_inicio, t.hora_fin, t.tarea, t.supervision, t.estado, u.nombre AS encargado
         FROM turnos_extendidos_obra t JOIN users u ON u.id = t.encargado_id
        WHERE t.fecha >= ? ORDER BY t.fecha, t.hora_inicio`,
      [sumarDias(hoy, -14)]
    ),
    []
  );
}

// ---------- Calidad (Art. 11d) ----------

export type ControlCalidad = { id: number; fecha: string; actividad: string; rubro: string | null; resultado: "conforme" | "observado" | "rechazado"; materiales_ok: number; observaciones: string | null; evaluador: string | null };

export async function cargarControlesCalidad(): Promise<ControlCalidad[]> {
  return tolerar(
    all<ControlCalidad>(
      `SELECT c.id, c.fecha, c.actividad, r.nombre AS rubro, c.resultado, c.materiales_ok, c.observaciones, u.nombre AS evaluador
         FROM controles_calidad_obra c LEFT JOIN obra_rubros r ON r.id = c.rubro_id LEFT JOIN users u ON u.id = c.evaluado_por_id
        WHERE c.anulado_en IS NULL ORDER BY c.fecha DESC, c.id DESC LIMIT 60`
    ),
    []
  );
}

export async function rubrosParaSelect(): Promise<{ id: number; nombre: string }[]> {
  return tolerar(all<{ id: number; nombre: string }>(`SELECT id, nombre FROM obra_rubros ORDER BY nombre`), []);
}

// ---------- Personal contratado y licitaciones (Art. 5, 11c) ----------

export type Contratado = { id: number; nombre: string; documento: string | null; oficio: string; desde: string | null; hasta: string | null; estado: "propuesto" | "aprobado" | "rechazado" | "finalizado"; observaciones: string | null };
export type OfertaLic = { id: number; licitacion_id: number; proveedor_nombre: string; monto: number; plazo: string | null; observaciones: string | null };
export type Licitacion = { id: number; titulo: string; descripcion: string | null; estado: "abierta" | "adjudicada" | "desierta"; oferta_elegida_id: number | null; justificacion: string | null; ofertas: OfertaLic[] };

export async function cargarContratados(): Promise<Contratado[]> {
  return tolerar(
    all<Contratado>(`SELECT id, nombre, documento, oficio, desde, hasta, estado, observaciones FROM personal_contratado_obra ORDER BY (estado = 'finalizado'), (estado = 'rechazado'), id DESC LIMIT 80`),
    []
  );
}

export async function cargarLicitaciones(): Promise<Licitacion[]> {
  const lics = await tolerar(all<Omit<Licitacion, "ofertas">>(`SELECT id, titulo, descripcion, estado, oferta_elegida_id, justificacion FROM licitaciones_obra ORDER BY (estado <> 'abierta'), id DESC LIMIT 40`), []);
  if (!lics.length) return [];
  const ofertas = await tolerar(
    all<OfertaLic>(`SELECT id, licitacion_id, proveedor_nombre, monto::float AS monto, plazo, observaciones FROM ofertas_licitacion WHERE anulada_en IS NULL ORDER BY monto`),
    []
  );
  return lics.map((l) => ({ ...l, ofertas: ofertas.filter((o) => o.licitacion_id === l.id).map((o) => ({ ...o, monto: Number(o.monto) })) }));
}

/** Nombre ya cargado como socio/a o integrante de un núcleo (Art. 5c: no se puede contratar socios/as). */
export async function esSocioOIntegrante(nombre: string, documento: string | null): Promise<boolean> {
  const n = nombre.trim().toLowerCase();
  const porNombre = await tolerar(
    get<{ x: number }>(
      `SELECT 1 AS x FROM socios WHERE estado <> 'baja' AND lower(nombre) = ?
       UNION ALL SELECT 1 FROM socio_integrantes WHERE estado <> 'baja' AND lower(trim(nombre || ' ' || coalesce(apellido, ''))) = ? LIMIT 1`,
      [n, n]
    ),
    undefined
  );
  if (porNombre) return true;
  if (!documento) return false;
  const porDoc = await tolerar(
    get<{ x: number }>(`SELECT 1 AS x FROM socios WHERE estado <> 'baja' AND documento = ? UNION ALL SELECT 1 FROM socio_integrantes WHERE estado <> 'baja' AND documento = ? LIMIT 1`, [documento, documento]),
    undefined
  );
  return !!porDoc;
}

// ---------- Guardias y serenatas (Art. 8o, 18h, 34) ----------

export const HORARIO_GUARDIA = { guardia: "17:00 a 22:00", serenata: "22:00 a 07:00" } as const;
export type Guardia = { id: number; fecha: string; tipo: "guardia" | "serenata"; nucleo_id: number; nucleo: string; estado: "asignada" | "cumplida" | "falta_justificada" | "falta_injustificada"; observaciones: string | null };

export async function cargarGuardias(): Promise<Guardia[]> {
  const hoy = hoyEnUruguay();
  return tolerar(
    all<Guardia>(
      `SELECT g.id, g.fecha, g.tipo, g.nucleo_id, n.nombre AS nucleo, g.estado, g.observaciones
         FROM guardias_obra g JOIN nucleos_familiares n ON n.id = g.nucleo_id
        WHERE g.fecha >= ? ORDER BY g.fecha, g.tipo`,
      [sumarDias(hoy, -30)]
    ),
    []
  );
}

export async function nucleosParaSelect(): Promise<{ id: number; nombre: string }[]> {
  return tolerar(all<{ id: number; nombre: string }>(`SELECT id, nombre FROM nucleos_familiares ORDER BY nombre`), []);
}

export async function personasParaSelect(): Promise<{ id: number; nombre: string }[]> {
  return tolerar(all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 AND estado_cuenta = 'activa' ORDER BY nombre`), []);
}

// ---------- Permisos ----------

export const ERROR_SIN_PERMISO_OBRA = "No tenés permiso para cargar esto: hace falta integrar la Comisión de Obra o ser de la conducción.";

/** ¿Puede cargar en la gestión de Obra de esta comisión? (integrante activo o conducción). */
export async function puedeGestionarObra(user: SessionUser, comisionId: number): Promise<boolean> {
  return puedeGestionarComision(user, comisionId);
}
/** El Consejo Directivo aprueba las contrataciones (Art. 5c). */
export function puedeAprobarContratacion(user: SessionUser): boolean {
  return esDirectiva(user) || canEdit(user.rol, "finanzas");
}

export { lunesDe };
