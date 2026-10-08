import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { all, get, audit } from "@/lib/db";
import { generarPdfBuffer } from "@/lib/pdf";
import { hoyEnUruguay } from "@/lib/horasObra";
import { buscarPersona, puedeGestionarSeguridad } from "@/lib/seguridadObra";

export const dynamic = "force-dynamic";

const dmy = (f: string) => f.slice(0, 10).split("-").reverse().join("/");

/** Fase 3E — constancia de entrega de EPP de una persona, para imprimir y firmar. */
export async function GET(_req: Request, { params }: { params: Promise<{ persona: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const p = await buscarPersona((await params).persona);
  if (!p) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (!(await puedeGestionarSeguridad(user))) {
    const s = await get<{ user_id: number | null }>(`SELECT user_id FROM socios WHERE id = ?`, [p.socio_id]);
    if (s?.user_id !== user.id) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const filas = await all<{ elemento: string; talle: string | null; cantidad: number; fecha: string; entregado_por: string | null }>(
    `SELECT e.elemento, e.talle, e.cantidad, e.fecha, u.nombre AS entregado_por
       FROM epp_entregas e LEFT JOIN users u ON u.id = e.entregado_por_id
      WHERE e.anulado_en IS NULL AND e.socio_id = ? AND ${p.integrante_id ? "e.integrante_id = ?" : "e.integrante_id IS NULL"}
      ORDER BY e.fecha, e.id`,
    p.integrante_id ? [p.socio_id, p.integrante_id] : [p.socio_id]
  );
  const hoy = hoyEnUruguay();
  const pdf = await generarPdfBuffer({
    titulo: "Constancia de entrega de elementos de protección personal",
    subtitulo: `Al ${dmy(hoy)}`,
    organizacion: user.organizacion,
    secciones: [
      { tipo: "texto", parrafos: [`Persona: ${p.nombre}${p.nucleo ? ` — ${p.nucleo}` : ""}`] },
      {
        tipo: "tabla",
        encabezado: "Elementos entregados",
        columnas: ["Fecha", "Elemento", "Talle", "Cantidad", "Entregó"],
        filas: filas.length ? filas.map((f) => [dmy(f.fecha), f.elemento, f.talle ?? "", f.cantidad, f.entregado_por ?? ""]) : [["", "Sin entregas registradas", "", "", ""]],
      },
      {
        tipo: "texto",
        parrafos: [
          "Recibí los elementos de protección personal detallados arriba. Me comprometo a usarlos en la obra, cuidarlos y avisar a la Comisión de Seguridad si se rompen o se pierden.",
          "",
          "Firma: ______________________________          Aclaración: ______________________________",
          "",
          "Fecha: ____ / ____ / ________",
        ],
      },
    ],
  });
  await audit({ usuario_id: user.id, accion: "descargar_constancia_epp", entidad: "epp_entregas", entidad_id: p.socio_id, valor_nuevo: { persona: p.nombre } }).catch(() => {});
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="constancia-epp-${p.clave}-${hoy}.pdf"`, "Cache-Control": "no-store" },
  });
}
