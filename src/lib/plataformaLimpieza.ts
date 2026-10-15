import { conCooperativa } from "@/lib/plataformaCoop";

/**
 * Vista previa de la limpieza de datos de prueba de una cooperativa (solo
 * lectura). No borra nada: arma la lista de lo que PODRÍA limpiarse y lo
 * clasifica:
 *   - "prueba": el nombre, el email o las notas dicen explícitamente que es
 *     de prueba (prueba, test, demo, ficticio, ejemplo…). Es lo único que
 *     viene tildado de entrada.
 *   - "revisar": no se puede asegurar que sea de prueba. Nunca viene tildado:
 *     solo se limpia si la persona lo tilda a propósito.
 * Los administradores del sistema y de plataforma no aparecen nunca.
 */

const PATRON_PRUEBA = /(\bprueba\b|\bpruebas\b|\btest\b|\btesting\b|\bdemo\b|ficticio|dummy|example|\bejemplo\b|@.*\.test$)/i;

export type ClasificacionLimpieza = "prueba" | "revisar";

export type CandidatoSocio = {
  id: number;
  numero_nucleo: number | null;
  nombre: string;
  estado: string;
  notas: string | null;
  usuario_nombre: string | null;
  integrantes: number;
  clasificacion: ClasificacionLimpieza;
};

export type CandidatoUsuario = {
  id: number;
  nombre: string;
  email: string | null;
  rol: string;
  activo: boolean;
  numero_nucleo: number | null;
  comisiones: number;
  clasificacion: ClasificacionLimpieza;
};

export type RespaldoLimpieza = { id: number; creado_en: string; motivo: string; cantidad_registros: number; restaurado: boolean };

export type VistaPreviaLimpieza = {
  socios: CandidatoSocio[];
  usuarios: CandidatoUsuario[];
  respaldos: RespaldoLimpieza[];
};

function clasificar(...textos: (string | null | undefined)[]): ClasificacionLimpieza {
  return textos.some((t) => t && PATRON_PRUEBA.test(t)) ? "prueba" : "revisar";
}

export async function leerVistaPreviaLimpieza(orgId: number): Promise<VistaPreviaLimpieza> {
  return conCooperativa(orgId, async (tx, admin) => {
    const socios = await tx.all<{
      id: number;
      numero_nucleo: number | null;
      nombre: string;
      estado: string;
      notas: string | null;
      email: string | null;
      usuario_nombre: string | null;
      integrantes: string;
    }>(
      `SELECT s.id, s.numero_nucleo, s.nombre, s.estado, s.notas, s.email, u.nombre AS usuario_nombre,
              (SELECT count(*) FROM socio_integrantes i WHERE i.socio_id = s.id)::text AS integrantes
         FROM socios s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.estado <> 'baja'
        ORDER BY s.numero_nucleo ASC NULLS LAST, s.nombre ASC`
    );
    const usuarios = await tx.all<{
      id: number;
      nombre: string;
      email: string | null;
      rol: string;
      activo: number;
      numero_nucleo: number | null;
      comisiones: string;
    }>(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, s.numero_nucleo,
              (SELECT count(*) FROM comision_miembros m WHERE m.user_id = u.id AND m.activo = 1)::text AS comisiones
         FROM users u LEFT JOIN socios s ON s.user_id = u.id AND s.estado <> 'baja'
        WHERE u.rol <> 'admin' AND u.es_platform_admin = false AND u.id <> ? AND u.estado_cuenta <> 'baja'
        ORDER BY u.nombre ASC`,
      [admin.id]
    );
    const respaldos = await tx.all<{ id: number; creado_en: string; motivo: string; cantidad: string; restaurado: boolean }>(
      `SELECT id, creado_en::text AS creado_en, motivo,
              (jsonb_array_length(contenido->'socios') + jsonb_array_length(contenido->'users'))::text AS cantidad,
              (restaurado_en IS NOT NULL) AS restaurado
         FROM respaldos_limpieza ORDER BY id DESC LIMIT 10`
    );
    return {
      socios: socios.map((s) => ({
        id: s.id,
        numero_nucleo: s.numero_nucleo,
        nombre: s.nombre,
        estado: s.estado,
        notas: s.notas,
        usuario_nombre: s.usuario_nombre,
        integrantes: Number(s.integrantes),
        clasificacion: clasificar(s.nombre, s.notas, s.email),
      })),
      usuarios: usuarios.map((u) => ({
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        rol: u.rol,
        activo: u.activo === 1,
        numero_nucleo: u.numero_nucleo,
        comisiones: Number(u.comisiones),
        clasificacion: clasificar(u.nombre, u.email),
      })),
      respaldos: respaldos.map((r) => ({ id: r.id, creado_en: r.creado_en, motivo: r.motivo, cantidad_registros: Number(r.cantidad), restaurado: r.restaurado })),
    };
  });
}

export async function leerRespaldoLimpieza(orgId: number, respaldoId: number): Promise<unknown | null> {
  return conCooperativa(orgId, async (tx) => {
    const fila = await tx.get<{ contenido: unknown }>(`SELECT contenido FROM respaldos_limpieza WHERE id = ?`, [respaldoId]);
    return fila?.contenido ?? null;
  });
}
