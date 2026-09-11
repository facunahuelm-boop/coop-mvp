import { get } from "@/lib/db";
import { canEdit } from "@/lib/roles";
import type { SessionUser } from "@/lib/auth";

/**
 * Permiso a nivel de comisión (sección 7 del pedido: "una comisión no pueda
 * acceder indebidamente a información de otra comisión"). No alcanza con el
 * permiso de módulo (canEdit(rol, "compras")) porque ESO es igual para
 * cualquier comisión — un integrante de Comisión de Seguridad hoy podría,
 * con solo el chequeo de rol, editar gastos de Comisión de Compras. Esta
 * función agrega la segunda capa: además del rol, hace falta ser integrante
 * activo de ESA comisión puntual (tabla comision_miembros), salvo para los
 * roles de conducción/finanzas que gestionan todas por diseño (Admin,
 * Consejo Directivo, Tesorería, Administración — mismos que ya tienen
 * canEdit sobre "finanzas").
 *
 * Se verifica siempre en el servidor (Server Action), nunca solo en la UI —
 * aunque alguien arme el pedido a mano sin pasar por ningún botón, esta
 * función se sigue ejecutando antes de tocar la base.
 */
export async function puedeGestionarComision(user: SessionUser, comisionId: number): Promise<boolean> {
  if (canEdit(user.rol, "finanzas")) return true; // administracion, tesoreria, consejo_directivo, admin
  const miembro = await get<{ id: number }>(
    `SELECT id FROM comision_miembros WHERE comision_id = ? AND user_id = ? AND activo = 1`,
    [comisionId, user.id]
  );
  return !!miembro;
}

/** Mensaje uniforme para cuando falla puedeGestionarComision. */
export const ERROR_SIN_PERMISO_COMISION =
  "No tenés permiso para gestionar esta comisión — hace falta ser integrante activo de ella, o tener un rol de conducción (Admin, Consejo Directivo, Tesorería o Administración).";

/**
 * Gate de módulo para Gastos por Comisión. Vive acá (no en actions/gastos.ts)
 * porque un archivo "use server" solo puede exportar funciones async — ésta
 * es sync porque no necesita consultar la base, solo la matriz de roles.
 *
 * No alcanza con canEdit(rol, "compras") solo, porque "administracion" tiene
 * compras:"read" en la matriz (solo mira compras, no las gestiona) pero SÍ
 * debe poder gestionar gastos — es uno de los roles de "conducción/finanzas"
 * que puedeGestionarComision ya trata como con acceso a todas las comisiones
 * (junto con tesorería, consejo directivo y admin). Se acepta cualquiera de
 * los dos módulos.
 */
export function puedeUsarGastos(rol: Parameters<typeof canEdit>[0]): boolean {
  return canEdit(rol, "compras") || canEdit(rol, "finanzas");
}
