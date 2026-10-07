import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/db";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { crearLibroExcel, respuestaExcel } from "@/lib/excel";
import { reporte, type TablaReporte } from "@/lib/reportesCatalogo";
import { hoyEnUruguay } from "@/lib/horasObra";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const pesos = (n: number) => `$ ${n.toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function celdaPdf(v: string | number | null | undefined, tipo?: string): string | number {
  if (v === null || v === undefined || v === "") return "";
  if (tipo === "monto") return pesos(Number(v));
  if (tipo === "fecha") return String(v).slice(0, 10).split("-").reverse().join("/");
  return v;
}

function tablaPdf(t: TablaReporte): SeccionPdf {
  const filas = t.filas.map((f) => t.columnas.map((c) => celdaPdf(f[c.clave], c.tipo)));
  if (t.totales && t.filas.length) {
    filas.push(
      t.columnas.map((c, i) =>
        i === 0 ? "Total" : c.tipo === "monto" || (c.tipo === "numero" && c.clave !== "n" && c.clave !== "id") ? celdaPdf(t.filas.reduce((a, f) => a + Number(f[c.clave] || 0), 0), c.tipo) : ""
      )
    );
  }
  return { tipo: "tabla", encabezado: t.titulo, columnas: t.columnas.map((c) => c.titulo), filas: filas.length ? filas : [t.columnas.map((_c, i) => (i === 0 ? "Sin datos" : ""))] };
}

/** Fase 2H — reportes de la sección 13: el mismo contenido en PDF (oficial) o Excel (para analizar). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clave: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const def = reporte((await params).clave);
  if (!def) return NextResponse.json({ error: "Ese reporte no existe" }, { status: 404 });
  if (!def.puede(user)) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const formato = sp.get("formato") === "xlsx" ? "xlsx" : "pdf";
  if (!def.formatos.includes(formato)) return NextResponse.json({ error: "Ese formato no está disponible para este reporte" }, { status: 400 });
  const hoy = hoyEnUruguay();
  const desde = FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : `${hoy.slice(0, 7)}-01`;
  const hasta = FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : hoy;
  if (desde > hasta) return NextResponse.json({ error: "La fecha «desde» es posterior a «hasta»" }, { status: 400 });

  const contenido = await def.generar({ user, hoy, desde, hasta });
  const rango = def.periodo ? `Del ${desde.split("-").reverse().join("/")} al ${hasta.split("-").reverse().join("/")}` : `Al ${hoy.split("-").reverse().join("/")}`;
  await audit({ usuario_id: user.id, accion: "descargar_reporte", entidad: "reportes", entidad_id: null, valor_nuevo: { reporte: def.titulo, formato, desde: def.periodo ? desde : null, hasta: def.periodo ? hasta : null } }).catch(() => {});
  const nombre = `${def.clave}-${def.periodo ? `${desde}_${hasta}` : hoy}`;

  if (formato === "xlsx") {
    const buffer = await crearLibroExcel(
      contenido.tablas.map((t) => ({
        nombre: t.titulo.slice(0, 30),
        encabezado: [user.organizacion.nombre, `${def.titulo} — ${rango}${contenido.subtitulo ? ` — ${contenido.subtitulo}` : ""}`],
        columnas: t.columnas.map((c) => ({ titulo: c.titulo, clave: c.clave, tipo: c.tipo, ancho: c.ancho })),
        filas: t.filas,
        totales: t.totales,
      }))
    );
    return respuestaExcel(buffer, `${nombre}.xlsx`);
  }
  const secciones: SeccionPdf[] = contenido.tablas.map(tablaPdf);
  if (contenido.notas?.length) secciones.push({ tipo: "texto", parrafos: contenido.notas });
  const pdf = await generarPdfBuffer({
    titulo: def.titulo,
    subtitulo: [rango, contenido.subtitulo].filter(Boolean).join(" · "),
    organizacion: user.organizacion,
    secciones,
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nombre}.pdf"`, "Cache-Control": "no-store" },
  });
}
