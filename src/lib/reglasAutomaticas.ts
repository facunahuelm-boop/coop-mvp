import "server-only";
import { all, insert } from "./db";
import { crearAlerta } from "./logic";
import {
  EVENTOS_VALIDOS,
  type AccionTipo,
  type AccionDatosNotificar,
  type AccionDatosAlerta,
  type ReglaAutomatica,
} from "./reglasAutomaticasCatalogo";

// Fase 3 ("Reglas de la cooperativa, Estatuto/Reglamentos como
// configuración, Motor de reglas evento-condición-acción") — Sub-fase 3.3:
// Motor de reglas evento-condición-acción (sección 14). Ver migración 0035
// para el porqué completo del alcance acotado (evento = condición, catálogo
// cerrado de 2 acciones seguras).
//
// Los catálogos (eventos, acciones, severidades, roles) y los tipos viven en
// reglasAutomaticasCatalogo.ts (SIN "server-only") — este archivo es
// "server-only" porque toca la base de datos, y un componente cliente no
// puede importarlo. Ver el comentario en reglasAutomaticasCatalogo.ts para
// el porqué completo de la separación.

export async function obtenerReglasAutomaticas(): Promise<ReglaAutomatica[]> {
  return all<ReglaAutomatica>(
    `SELECT id, nombre, evento, accion_tipo, accion_datos, activa, creado_en FROM reglas_automaticas ORDER BY creado_en DESC`
  ).catch(() => [] as ReglaAutomatica[]);
}

/**
 * Contexto mínimo disponible en cada evento — literalmente los mismos
 * campos que ya recibe crearNotificacion (título/cuerpo/referencia). No hay
 * datos de negocio estructurados (monto, prioridad) porque los 14 puntos
 * donde se disparan estos eventos hoy no los pasan — ver la nota de
 * alcance en la migración 0035.
 */
type ContextoEvento = {
  titulo: string;
  cuerpo?: string | null;
  ref_tabla?: string | null;
  ref_id?: number | null;
};

/**
 * Punto de entrada del motor: se llama UNA VEZ por cada ocurrencia real de
 * un evento (ver el enganche en notificaciones.ts, que evita llamarla una
 * vez por destinatario cuando un mismo evento notifica a varias personas).
 * Nunca hace fallar la acción real que la disparó — mismo criterio que
 * crearNotificacion.
 */
export async function ejecutarReglasAutomaticas(evento: string, contexto: ContextoEvento): Promise<void> {
  if (!EVENTOS_VALIDOS.has(evento)) return;
  try {
    const reglas = await all<{ id: number; accion_tipo: AccionTipo; accion_datos: AccionDatosNotificar | AccionDatosAlerta }>(
      `SELECT id, accion_tipo, accion_datos FROM reglas_automaticas WHERE evento = ? AND activa = true`,
      [evento]
    );
    for (const regla of reglas) {
      await ejecutarAccion(regla, contexto);
    }
  } catch (err) {
    console.error("[reglasAutomaticas] no se pudieron ejecutar las reglas:", err);
  }
}

async function ejecutarAccion(
  regla: { id: number; accion_tipo: AccionTipo; accion_datos: AccionDatosNotificar | AccionDatosAlerta },
  contexto: ContextoEvento
): Promise<void> {
  if (regla.accion_tipo === "notificar_rol") {
    // No se llama a crearNotificacionesParaUsuarios (notificaciones.ts) a
    // propósito: ese módulo es el que llama a ejecutarReglasAutomaticas
    // (ver el enganche ahí), así que importar en sentido contrario acá
    // crearía una dependencia circular entre los dos archivos. El insert
    // de abajo es exactamente el mismo que hace crearNotificacion — mismo
    // criterio de "nunca hacer fallar la acción real" con el try/catch de
    // ejecutarReglasAutomaticas que envuelve a esta función.
    const datos = regla.accion_datos as AccionDatosNotificar;
    const destinatarios = await all<{ id: number }>(`SELECT id FROM users WHERE rol = ? AND activo = 1`, [datos.rol]);
    for (const { id: user_id } of destinatarios) {
      await insert("notificaciones", {
        user_id,
        tipo: "regla_automatica",
        titulo: datos.mensaje || contexto.titulo,
        cuerpo: contexto.cuerpo ?? null,
        ref_tabla: contexto.ref_tabla ?? null,
        ref_id: contexto.ref_id ?? null,
        leida: false,
      });
    }
  } else if (regla.accion_tipo === "crear_alerta") {
    const datos = regla.accion_datos as AccionDatosAlerta;
    // El `tipo` de la alerta incluye el id de la regla para que dos reglas
    // distintas sobre el mismo evento/referencia no se pisen entre sí en el
    // upsert de crearAlerta (que dedupe por tipo+ref_tabla+ref_id).
    await crearAlerta({
      tipo: `regla_automatica_${regla.id}`,
      severidad: datos.severidad,
      origen_modulo: "reglas_automaticas",
      titulo: datos.titulo || contexto.titulo,
      descripcion: contexto.cuerpo || contexto.titulo,
      asignado_a_rol: datos.rol,
      ref_tabla: contexto.ref_tabla ?? null,
      ref_id: contexto.ref_id ?? null,
    });
  }
}
