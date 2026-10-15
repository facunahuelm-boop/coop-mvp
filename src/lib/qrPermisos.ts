import type { SessionUser } from "@/lib/auth";

/**
 * Quién es "directiva" para el QR de asistencia de la obra. Hoy los cargos
 * todavía no están configurados, así que se toma el rol del Consejo Directivo
 * (y el administrador de la cooperativa, que lo configura todo). Cuando se
 * carguen los cargos, este es el único lugar que hay que cambiar.
 */
export function esDirectiva(user: Pick<SessionUser, "rol">): boolean {
  return user.rol === "consejo_directivo" || user.rol === "admin";
}
