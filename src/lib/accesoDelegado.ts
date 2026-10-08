import { all, get } from "@/lib/db";
import { ValidationError } from "@/lib/validation";

/**
 * Fase 3G — acceso delegado: un familiar, con su propia cuenta, puede ayudar
 * a un socio (ver su estado de cuenta, sus horas y avisos y, si el socio lo
 * permite, avisar una ausencia en su nombre). Lo otorga y lo revoca el
 * propio socio. Cada vez que el familiar mira o hace algo queda en la
 * auditoría «en nombre de».
 */

export type AccesoDelegado = {
  id: number;
  socio_id: number;
  socio_nombre: string;
  nucleo_id: number | null;
  delegado_user_id: number;
  delegado_nombre: string;
  delegado_email: string;
  relacion: string | null;
  puede_actuar: number;
  creado_en: string;
};

const SELECT = `SELECT a.id, a.socio_id, s.nombre AS socio_nombre, s.nucleo_id, a.delegado_user_id, u.nombre AS delegado_nombre, u.email AS delegado_email,
                       a.relacion, a.puede_actuar, a.creado_en
                  FROM accesos_delegados a JOIN socios s ON s.id = a.socio_id JOIN users u ON u.id = a.delegado_user_id
                 WHERE a.revocado_en IS NULL`;

/** Los socios a los que ayuda esta persona. */
export async function sociosQueAyudo(userId: number): Promise<AccesoDelegado[]> {
  return all<AccesoDelegado>(`${SELECT} AND a.delegado_user_id = ? AND u.activo = 1 ORDER BY s.nombre`, [userId]).catch(() => []);
}

/** Las personas que pueden ayudar a este socio. */
export async function delegadosDeSocio(socioId: number): Promise<AccesoDelegado[]> {
  return all<AccesoDelegado>(`${SELECT} AND a.socio_id = ? ORDER BY a.creado_en`, [socioId]).catch(() => []);
}

/** El acceso vigente de esta persona sobre ese socio (o undefined). */
export async function accesoSobre(userId: number, socioId: number): Promise<AccesoDelegado | undefined> {
  return get<AccesoDelegado>(`${SELECT} AND a.delegado_user_id = ? AND a.socio_id = ? AND u.activo = 1 LIMIT 1`, [userId, socioId]).catch(() => undefined);
}

/** ¿Puede actuar en nombre de algún socio de ese núcleo? Devuelve el socio. */
export async function actuaPorNucleo(userId: number, nucleoId: number): Promise<{ socio_id: number; socio_nombre: string } | undefined> {
  return get<{ socio_id: number; socio_nombre: string }>(
    `SELECT a.socio_id, s.nombre AS socio_nombre FROM accesos_delegados a JOIN socios s ON s.id = a.socio_id
      WHERE a.revocado_en IS NULL AND a.puede_actuar = 1 AND a.delegado_user_id = ? AND s.nucleo_id = ? LIMIT 1`,
    [userId, nucleoId]
  ).catch(() => undefined);
}

/**
 * El familiar tiene que tener su propia cuenta en la cooperativa. Un socio
 * no crea cuentas (eso le daría a alguien de afuera lo que ve cualquier
 * socio): si no tiene, la crea la administración.
 */
export async function usuarioParaDelegar(email: string): Promise<{ id: number; nombre: string }> {
  const ya = await get<{ id: number; nombre: string; activo: number }>(`SELECT id, nombre, activo FROM users WHERE lower(email) = ?`, [email.toLowerCase()]);
  if (!ya) throw new ValidationError("email", "Esa persona todavía no tiene cuenta en COOVA. Pedile a la administración que le cree una y después volvé acá.");
  if (!ya.activo) throw new ValidationError("email", "Esa persona tiene la cuenta dada de baja. Hablá con la administración.");
  return { id: ya.id, nombre: ya.nombre };
}
