import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { get } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { generarReciboPdf } from "@/lib/reciboPdf";
import { codigoDePago } from "@/lib/reglamento";
import { urlBaseApp } from "@/lib/email";

export const dynamic = "force-dynamic";

// Fase 1C: recibo de pago en PDF. Lo pueden abrir quienes ven el detalle de
// Finanzas y el propio socio dueño del pago (mismo criterio que el
// comprobante de un movimiento, /api/archivos/cuota/[id]).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: "Recibo inválido." }, { status: 400 });

  const recibo = await get<{
    id: number; numero: number; movimiento_id: number; socio_id: number; monto: number; fecha: string; concepto: string | null;
    metodo_pago: string | null; codigo_verificacion: string; anulado_en: string | null; motivo_anulacion: string | null;
  }>(`SELECT * FROM recibos WHERE id = ?`, [idNum]).catch(() => undefined);
  if (!recibo) return NextResponse.json({ error: "Ese recibo no existe." }, { status: 404 });

  const socio = await get<{ nombre: string; nucleo_id: number | null; user_id: number | null }>(
    `SELECT nombre, nucleo_id, user_id FROM socios WHERE id = ?`,
    [recibo.socio_id]
  );
  const esDueño = socio?.user_id === user.id;
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol) && !esDueño) {
    return NextResponse.json({ error: "No tenés permiso para ver este recibo." }, { status: 403 });
  }

  const org = await get<{ slug: string; nombre: string; color_primario: string | null }>(
    `SELECT slug, nombre, color_primario FROM organizations WHERE id = ?`,
    [user.organization_id]
  );
  const { cuotas } = calcularCuotasSocio(await cargarMovimientosCuenta(recibo.socio_id));
  const aplicadoA = recibo.anulado_en ? [] : cuotas
    .map((c) => ({ concepto: c.concepto, monto: c.pagos.filter((p) => p.pagoId === recibo.movimiento_id).reduce((s, p) => s + p.monto, 0) }))
    .filter((x) => x.monto > 0);

  const pdf = await generarReciboPdf({
    organizacion: { nombre: org?.nombre ?? user.organizacion.nombre, color_primario: org?.color_primario },
    numero: Number(recibo.numero),
    fecha: recibo.fecha,
    socio: socio?.nombre ?? "—",
    codigoPago: org ? codigoDePago(org.slug, socio?.nucleo_id ?? null, recibo.socio_id) : null,
    monto: Number(recibo.monto),
    concepto: recibo.concepto,
    metodoPago: recibo.metodo_pago,
    aplicadoA,
    linkVerificacion: `${urlBaseApp()}/verificar/${org?.slug ?? "coova"}/${recibo.codigo_verificacion}`,
    codigoVerificacion: recibo.codigo_verificacion,
    anulado: recibo.anulado_en ? { motivo: recibo.motivo_anulacion } : null,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${recibo.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
