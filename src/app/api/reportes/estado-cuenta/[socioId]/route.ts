import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get, audit } from "@/lib/db";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { calcularCuotasSocio, cargarMovimientosCuenta, resumenDeCuotas } from "@/lib/logic";
import { hoyEnUruguay } from "@/lib/horasObra";

export const dynamic = "force-dynamic";

const pesos = (n: number) => `$ ${n.toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;
const dmy = (f: string | null | undefined) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");
const ESTADO: Record<string, string> = { pendiente: "Por vencer", vencida: "Vencida", pagada: "Pagada", parcial: "Pago parcial", convenio: "En convenio" };

/** Fase 2H — estado de cuenta del núcleo en PDF (sección 13). Lo baja el propio socio o Finanzas. */
export async function GET(_req: Request, { params }: { params: Promise<{ socioId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const socioId = Number((await params).socioId);
  const socio = await get<{ id: number; nombre: string; documento: string | null; user_id: number | null; nucleo: string | null }>(
    `SELECT s.id, s.nombre, s.documento, s.user_id, n.nombre AS nucleo FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id WHERE s.id = ?`,
    [socioId]
  );
  if (!socio) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol) && socio.user_id !== user.id) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const movs = await cargarMovimientosCuenta(socioId);
  const { cuotas, saldo } = calcularCuotasSocio(movs);
  const r = resumenDeCuotas(cuotas);
  const pagos = movs.filter((m) => m.tipo === "pago" && m.estado !== "anulado");
  const hoy = hoyEnUruguay();
  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [
        `${socio.nombre}${socio.documento ? ` — C.I. ${socio.documento}` : ""}${socio.nucleo ? ` — ${socio.nucleo}` : ""}`,
        saldo > 0 ? `Saldo a pagar: ${pesos(saldo)}.` : saldo < 0 ? `Saldo a favor: ${pesos(-saldo)}.` : "No tiene saldo pendiente.",
        r.cuotasVencidas ? `Cuotas vencidas: ${r.cuotasVencidas} (${pesos(r.montoVencido)}), la más antigua del ${dmy(r.vencidaMasAntigua)}.` : "No tiene cuotas vencidas.",
      ],
    },
    {
      tipo: "tabla",
      encabezado: "Cuotas",
      columnas: ["Concepto", "Vence", "Monto", "Pagado", "Pendiente", "Estado"],
      filas: cuotas.length
        ? cuotas.map((c) => [c.concepto, dmy(c.fechaVencimiento), pesos(c.monto), pesos(c.montoPagado), pesos(c.montoPendiente), ESTADO[c.estado] ?? c.estado])
        : [["Sin cuotas", "", "", "", "", ""]],
    },
    {
      tipo: "tabla",
      encabezado: "Pagos",
      columnas: ["Fecha", "Concepto", "Forma de pago", "Monto"],
      filas: pagos.length ? pagos.map((p) => [dmy(p.fecha), p.concepto, p.metodo_pago ?? "", pesos(Number(p.monto))]) : [["Sin pagos", "", "", ""]],
    },
  ];
  const pdf = await generarPdfBuffer({ titulo: "Estado de cuenta", subtitulo: `Al ${dmy(hoy)}`, organizacion: user.organizacion, secciones });
  await audit({ usuario_id: user.id, accion: "descargar_estado_cuenta", entidad: "socios", entidad_id: socioId }).catch(() => {});
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="estado-de-cuenta-${socioId}-${hoy}.pdf"`, "Cache-Control": "no-store" },
  });
}
