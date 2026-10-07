import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get, audit } from "@/lib/db";
import { generarPdfBuffer } from "@/lib/pdf";
import { completarPlantilla } from "@/lib/plantillasAlta";
import { puedeUsarPlantillas } from "@/lib/actions/plantillasTexto";
import { hoyEnUruguay } from "@/lib/horasObra";

export const dynamic = "force-dynamic";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (iso: string | null | undefined) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
};

/** Fase 2H — una plantilla de texto completada con los datos del socio, en PDF. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeUsarPlantillas(user.rol))) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const id = Number((await params).id);
  const p = await get<{ nombre: string; cuerpo: string }>(`SELECT nombre, cuerpo FROM plantillas_texto WHERE id = ? AND activo = 1`, [id]).catch(() => undefined);
  if (!p) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const socioId = Number(sp.get("socio")) || null;
  const socio = socioId
    ? await get<{ nombre: string; documento: string | null; fecha_ingreso: string | null; nucleo: string | null }>(
        `SELECT s.nombre, s.documento, s.fecha_ingreso, n.nombre AS nucleo FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id WHERE s.id = ?`,
        [socioId]
      )
    : undefined;
  const montoTxt = (sp.get("monto") || "").replace(/[^\d.,]/g, "");
  const monto = montoTxt ? Number(montoTxt.replace(/\./g, "").replace(",", ".")) : NaN;
  const texto = completarPlantilla(p.cuerpo, {
    cooperativa: user.organizacion.nombre,
    socio: socio?.nombre,
    documento: socio?.documento,
    nucleo: socio?.nucleo ? (socio.nucleo.toLowerCase().startsWith("núcleo") ? socio.nucleo : `núcleo ${socio.nucleo}`) : null,
    fecha_ingreso: fechaLarga(socio?.fecha_ingreso),
    monto: Number.isFinite(monto) ? `$ ${monto.toLocaleString("es-UY", { maximumFractionDigits: 2 })}` : null,
    fecha: fechaLarga(hoyEnUruguay()),
    lugar: (sp.get("lugar") || "").slice(0, 80) || null,
  });
  const pdf = await generarPdfBuffer({
    titulo: p.nombre,
    organizacion: user.organizacion,
    secciones: [{ tipo: "texto", parrafos: texto.split(/\n+/).filter(Boolean) }],
  });
  await audit({ usuario_id: user.id, accion: "generar_desde_plantilla", entidad: "plantillas_texto", entidad_id: id, valor_nuevo: { plantilla: p.nombre, socio: socio?.nombre ?? null } }).catch(() => {});
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${p.nombre.replace(/[^\w\- ]/g, "").slice(0, 60) || "documento"}.pdf"`, "Cache-Control": "no-store" },
  });
}
