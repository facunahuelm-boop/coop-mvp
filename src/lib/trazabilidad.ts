import { all } from "@/lib/db";

/**
 * Gestión cooperativa integrada (04/10) — recorrido de una decisión:
 * Asamblea → Consejo → Comisión → Tarea → Resultado, sin duplicar nada.
 *
 * Una "resolución" es un punto del orden del día de una reunión (asamblea,
 * consejo o comisión) con su resultado (`reunion_agenda_items.resultado`).
 * De ella pueden salir, en sus propios módulos:
 *   - tareas (`tareas.agenda_item_id`),
 *   - solicitudes de compra (`solicitudes_compra.agenda_item_id`),
 *   - decisiones de comisión (`decisiones_comision.agenda_item_id`),
 *   - puntos en otra reunión (`reunion_agenda_items.origen_item_id`), ej. el
 *     Consejo toma una resolución de la Asamblea, y de ahí una comisión.
 * El recorrido es flexible: cualquier paso se puede saltear.
 *
 * Todas las consultas toleran que la migración 0049 todavía no esté aplicada
 * (devuelven vacío y la pantalla se ve como antes).
 */

export type TareaVinculada = {
  id: number;
  titulo: string;
  estado: string;
  resultado: string | null;
  comision_id: number;
  comision_nombre: string | null;
  responsable_nombre: string | null;
  agenda_item_id: number;
};
export type CompraVinculada = { id: number; material: string; estado: string; agenda_item_id: number };
export type DecisionVinculada = { id: number; tema: string; resultado: string; comision_nombre: string | null; agenda_item_id: number };
export type PuntoEnReunion = {
  id: number;
  titulo: string;
  resultado: string | null;
  reunion_id: number;
  reunion_titulo: string;
  reunion_tipo: string;
  reunion_fecha: string;
  reunion_estado: string;
  comision_nombre: string | null;
  origen_item_id: number | null;
};

export type VinculosResolucion = {
  tareas: TareaVinculada[];
  compras: CompraVinculada[];
  decisiones: DecisionVinculada[];
  /** Puntos de otras reuniones que salieron de esta resolución. */
  seguimientos: PuntoEnReunion[];
  total: number;
};

export const TIPO_REUNION_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};

const vacio = <T,>() => [] as T[];
const marcas = (ids: number[]) => ids.map(() => "?").join(",");

const SELECT_PUNTO = `SELECT ai.id, ai.titulo, ai.resultado, ai.origen_item_id,
         r.id AS reunion_id, r.titulo AS reunion_titulo, r.tipo AS reunion_tipo, r.fecha AS reunion_fecha,
         r.estado AS reunion_estado, c.nombre AS comision_nombre
    FROM reunion_agenda_items ai
    JOIN reuniones r ON r.id = ai.reunion_id
    LEFT JOIN comisiones c ON c.id = r.comision_id`;

/** Todo lo que salió de cada una de estas resoluciones. */
export async function vinculosDeAgendaItem(ids: number[]): Promise<Map<number, VinculosResolucion>> {
  const resultado = new Map<number, VinculosResolucion>();
  for (const id of ids) resultado.set(id, { tareas: [], compras: [], decisiones: [], seguimientos: [], total: 0 });
  if (ids.length === 0) return resultado;

  const [tareas, compras, decisiones, seguimientos] = await Promise.all([
    all<TareaVinculada>(
      `SELECT t.id, t.titulo, t.estado, t.resultado, t.comision_id, c.nombre AS comision_nombre,
              u.nombre AS responsable_nombre, t.agenda_item_id
         FROM tareas t
         LEFT JOIN comisiones c ON c.id = t.comision_id
         LEFT JOIN users u ON u.id = t.responsable_id
        WHERE t.agenda_item_id IN (${marcas(ids)})
        ORDER BY t.creado_en ASC`,
      ids
    ).catch(vacio<TareaVinculada>),
    all<CompraVinculada>(
      `SELECT id, material, estado, agenda_item_id FROM solicitudes_compra
        WHERE agenda_item_id IN (${marcas(ids)}) ORDER BY creado_en ASC`,
      ids
    ).catch(vacio<CompraVinculada>),
    all<DecisionVinculada>(
      `SELECT d.id, d.tema, d.resultado, c.nombre AS comision_nombre, d.agenda_item_id
         FROM decisiones_comision d LEFT JOIN comisiones c ON c.id = d.comision_id
        WHERE d.agenda_item_id IN (${marcas(ids)}) ORDER BY d.creado_en ASC`,
      ids
    ).catch(vacio<DecisionVinculada>),
    all<PuntoEnReunion>(`${SELECT_PUNTO} WHERE ai.origen_item_id IN (${marcas(ids)}) ORDER BY r.fecha ASC`, ids).catch(
      vacio<PuntoEnReunion>
    ),
  ]);

  for (const t of tareas) resultado.get(t.agenda_item_id)?.tareas.push(t);
  for (const c of compras) resultado.get(c.agenda_item_id)?.compras.push(c);
  for (const d of decisiones) resultado.get(d.agenda_item_id)?.decisiones.push(d);
  for (const s of seguimientos) if (s.origen_item_id) resultado.get(s.origen_item_id)?.seguimientos.push(s);
  for (const v of resultado.values()) v.total = v.tareas.length + v.compras.length + v.decisiones.length + v.seguimientos.length;
  return resultado;
}

/** Datos de un conjunto de puntos de agenda (con su reunión). */
export async function puntosDeAgenda(ids: number[]): Promise<Map<number, PuntoEnReunion>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return new Map();
  const filas = await all<PuntoEnReunion>(`${SELECT_PUNTO} WHERE ai.id IN (${marcas(unicos)})`, unicos).catch(vacio<PuntoEnReunion>);
  return new Map(filas.map((f) => [f.id, f]));
}

// ---------- Recorrido completo (árbol) ----------

export type NodoRecorrido = {
  punto: PuntoEnReunion;
  tareas: TareaVinculada[];
  compras: CompraVinculada[];
  decisiones: DecisionVinculada[];
  hijos: NodoRecorrido[];
};

const PROFUNDIDAD_MAXIMA = 8;

/**
 * Recorrido completo de la resolución a la que pertenece `itemId`: sube
 * hasta el punto de origen (ej. la Asamblea) y desde ahí arma el árbol de
 * todo lo que salió. Devuelve null si el punto no existe o si nunca salió
 * nada de él ni vino de ningún lado (no hay recorrido que mostrar).
 */
export async function recorridoDeResolucion(itemId: number): Promise<NodoRecorrido | null> {
  // Subir hasta la raíz (con tope, por si alguien armara un ciclo a mano).
  let actual = (await puntosDeAgenda([itemId])).get(itemId);
  if (!actual) return null;
  const vistos = new Set<number>([actual.id]);
  for (let i = 0; i < PROFUNDIDAD_MAXIMA && actual.origen_item_id && !vistos.has(actual.origen_item_id); i++) {
    const padre: PuntoEnReunion | undefined = (await puntosDeAgenda([actual.origen_item_id])).get(actual.origen_item_id);
    if (!padre) break;
    vistos.add(padre.id);
    actual = padre;
  }

  const visitados = new Set<number>();
  async function armar(punto: PuntoEnReunion, profundidad: number): Promise<NodoRecorrido> {
    visitados.add(punto.id);
    const v = (await vinculosDeAgendaItem([punto.id])).get(punto.id)!;
    const hijos: NodoRecorrido[] = [];
    if (profundidad < PROFUNDIDAD_MAXIMA) {
      for (const s of v.seguimientos) if (!visitados.has(s.id)) hijos.push(await armar(s, profundidad + 1));
    }
    return { punto, tareas: v.tareas, compras: v.compras, decisiones: v.decisiones, hijos };
  }
  const raiz = await armar(actual, 0);
  const hayAlgo = raiz.hijos.length + raiz.tareas.length + raiz.compras.length + raiz.decisiones.length > 0;
  return hayAlgo ? raiz : null;
}
