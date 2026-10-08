import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get, audit } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { generarPdfBuffer } from "@/lib/pdf";

export const dynamic = "force-dynamic";

const pesos = (n: number) => `$ ${Number(n).toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;
const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");
const ESTADO: Record<string, string> = { borrador: "Borrador (falta aprobar)", aprobada: "Aprobada", pagada: "Pagada", anulada: "Anulada" };

/** Fase 3H — la liquidación de egreso en PDF (Finanzas o el propio socio). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const l = await get<{ id: number; socio_id: number; socio: string; documento: string | null; user_id: number | null; fecha: string; aportes: number; porcentaje_reintegro: number; deuda: number; otros_descuentos: number; detalle_descuentos: string | null; monto_final: number; forma_devolucion: string | null; estado: string; notas: string | null }>(
    `SELECT l.*, s.nombre AS socio, s.documento, s.user_id FROM liquidaciones_egreso l JOIN socios s ON s.id = l.socio_id WHERE l.id = ?`,
    [Number((await params).id)]
  ).catch(() => undefined);
  if (!l) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (!canRead(user.rol, "finanzas") && l.user_id !== user.id) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const reintegro = Math.round(Number(l.aportes) * (Number(l.porcentaje_reintegro) / 100) * 100) / 100;
  const pdf = await generarPdfBuffer({
    titulo: "Liquidación de egreso",
    subtitulo: `${l.socio}${l.documento ? ` — C.I. ${l.documento}` : ""} · ${dmy(l.fecha)} · ${ESTADO[l.estado] ?? l.estado}`,
    organizacion: user.organizacion,
    secciones: [
      {
        tipo: "tabla",
        encabezado: "Cuenta",
        columnas: ["Concepto", "Monto"],
        filas: [
          ["Total aportado", pesos(l.aportes)],
          [`Se reintegra el ${Number(l.porcentaje_reintegro)} %`, pesos(reintegro)],
          ["Menos: deuda con la cooperativa", `− ${pesos(l.deuda)}`],
          ...(Number(l.otros_descuentos) ? [[`Menos: ${l.detalle_descuentos ?? "otros descuentos"}`, `− ${pesos(l.otros_descuentos)}`]] : []),
          [Number(l.monto_final) >= 0 ? "A devolver al socio" : "El socio debe", pesos(Math.abs(Number(l.monto_final)))],
        ],
      },
      {
        tipo: "texto",
        parrafos: [
          ...(l.forma_devolucion ? [`Forma de devolución: ${l.forma_devolucion}`] : []),
          ...(l.notas ? [l.notas] : []),
          "Esta liquidación la calcula COOVA con los datos cargados y la aprueba el Consejo Directivo según el estatuto.",
          "",
          "Firma del socio: ______________________________          Por la cooperativa: ______________________________",
        ],
      },
    ],
  });
  await audit({ usuario_id: user.id, accion: "descargar_liquidacion", entidad: "liquidaciones_egreso", entidad_id: l.id }).catch(() => {});
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="liquidacion-egreso-${l.id}.pdf"`, "Cache-Control": "no-store" } });
}
