import { all } from "@/lib/db";
import { sumarDias } from "@/lib/horasObra";

/**
 * Fase 2F — A26: cuentas con permisos sensibles (plata, usuarios, control)
 * que nadie usa hace más de 60 días. Una cuenta olvidada con permisos es un
 * riesgo: el admin decide si la desactiva o le cambia el rol.
 */
export const ROLES_SENSIBLES = ["admin", "tesoreria", "administracion", "consejo_directivo", "fiscal"];
export const DIAS_INACTIVIDAD = 60;

export type CuentaInactiva = { id: number; nombre: string; rol: string; ultima: string | null };

export async function cuentasSensiblesInactivas(hoy: string): Promise<CuentaInactiva[]> {
  const limite = sumarDias(hoy, -DIAS_INACTIVIDAD);
  const filas = await all<CuentaInactiva>(
    `SELECT u.id, u.nombre, u.rol,
            GREATEST(
              (SELECT to_char(max(l.creado_en) AT TIME ZONE 'America/Montevideo', 'YYYY-MM-DD') FROM login_intentos l WHERE l.exitoso = 1 AND lower(l.email) = lower(u.email)),
              (SELECT max(left(a.fecha::text, 10)) FROM auditoria a WHERE a.usuario_id = u.id)
            ) AS ultima,
            left(u.creado_en::text, 10) AS creado
       FROM users u
      WHERE u.activo = 1 AND u.rol = ANY(?::text[]) AND COALESCE(u.es_platform_admin, false) = false`,
    [ROLES_SENSIBLES]
  ).catch(() => [] as (CuentaInactiva & { creado?: string })[]);
  return (filas as (CuentaInactiva & { creado?: string | null })[])
    .filter((f) => {
      const referencia = f.ultima ?? f.creado ?? null;
      return !!referencia && referencia < limite;
    })
    .map(({ id, nombre, rol, ultima }) => ({ id, nombre, rol, ultima }));
}
