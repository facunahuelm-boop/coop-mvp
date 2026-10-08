import { all } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { puedePlanificarHorasTrabajo } from "@/lib/comisionAuth";

/** Fase 3A — ¿puede ver el QR del día y las fichadas? (quien organiza las horas en alguna Comisión de Trabajo). */
export async function comisionTrabajoDe(user: SessionUser): Promise<number | null> {
  const comisiones = await all<{ id: number }>(`SELECT id FROM comisiones WHERE activa = 1 AND funcion = 'trabajo' ORDER BY id`).catch(() => []);
  for (const c of comisiones) if (await puedePlanificarHorasTrabajo(user, c.id)) return c.id;
  return null;
}

export async function puedeOrganizarHoras(user: SessionUser): Promise<boolean> {
  return (await comisionTrabajoDe(user)) !== null;
}
