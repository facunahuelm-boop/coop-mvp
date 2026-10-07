import { all } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";

/**
 * Fase 2G — A17: convenio vigente con una cuota impaga (vencida y pasados
 * los días de gracia). COOVA avisa y lo pone como tema del Consejo; dar el
 * convenio por incumplido lo decide una persona (cambia la deuda del socio).
 */
export type ConvenioEnAtraso = { convenioId: number; socioId: number; nombre: string; cuotas: number; monto: number; desde: string; cuotaIds: number[] };

export async function conveniosConCuotaImpaga(diasGracia: number): Promise<ConvenioEnAtraso[]> {
  const convenios = await all<{ id: number; socio_id: number; nombre: string }>(
    `SELECT cv.id, cv.socio_id, s.nombre FROM convenios_pago cv JOIN socios s ON s.id = cv.socio_id WHERE cv.estado = 'activo' AND cv.anulado_en IS NULL`
  ).catch(() => []);
  if (!convenios.length) return [];
  const resultado: ConvenioEnAtraso[] = [];
  const porSocio = new Map<number, Awaited<ReturnType<typeof cargarMovimientosCuenta>>>();
  for (const c of convenios) {
    if (!porSocio.has(c.socio_id)) porSocio.set(c.socio_id, await cargarMovimientosCuenta(c.socio_id).catch(() => []));
    const impagas = calcularCuotasSocio(porSocio.get(c.socio_id) ?? []).cuotas.filter(
      (q) => q.convenioId === c.id && q.estado === "vencida" && q.diasVencida > diasGracia
    );
    if (impagas.length) {
      resultado.push({
        convenioId: c.id,
        socioId: c.socio_id,
        nombre: c.nombre,
        cuotas: impagas.length,
        monto: Math.round(impagas.reduce((a, q) => a + q.montoPendiente, 0) * 100) / 100,
        desde: impagas.map((q) => q.fechaVencimiento ?? "").sort()[0],
        cuotaIds: impagas.map((q) => q.id),
      });
    }
  }
  return resultado;
}
