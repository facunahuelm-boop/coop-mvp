import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { all, audit } from "@/lib/db";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { crearLibroExcel, respuestaExcel } from "@/lib/excel";
import { saldosPor, listarPeriodos, textoPeriodo, ESTADO_PERIODO_LABEL } from "@/lib/finanzasLibro";
import { hoyEnUruguay } from "@/lib/horasObra";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Fase 2A — "Planilla para el contador": libro de movimientos en Excel con
 * un plan de cuentas simple (Finanzas → Cuentas y fondos → Para el
 * contador). No es contabilidad completa: es lo que el contador necesita
 * para pasarlo a su sistema.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const url = new URL(req.url);
  const hoy = hoyEnUruguay();
  const esFecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const desde = esFecha(url.searchParams.get("desde")) ?? `${hoy.slice(0, 4)}-01-01`;
  const hasta = esFecha(url.searchParams.get("hasta")) ?? hoy;

  const [movs, mapeo, cuentas, fondos, periodos] = await Promise.all([
    all<{
      id: number;
      fecha: string;
      tipo: string;
      categoria: string;
      descripcion: string | null;
      monto: number;
      estado: string | null;
      cuenta: string | null;
      fondo: string | null;
      contra_de_id: number | null;
      transferencia_id: string | null;
      registrado_por: string | null;
    }>(
      `SELECT m.id, left(m.fecha, 10) AS fecha, m.tipo, m.categoria, m.descripcion, m.monto, m.estado,
              c.nombre AS cuenta, f.nombre AS fondo, m.contra_de_id, m.transferencia_id, u.nombre AS registrado_por
         FROM movimientos_financieros m
         LEFT JOIN cuentas_financieras c ON c.id = m.cuenta_id
         LEFT JOIN fondos f ON f.id = m.fondo_id
         LEFT JOIN users u ON u.id = m.registrado_por_id
        WHERE left(m.fecha, 10) BETWEEN ? AND ?
        ORDER BY m.fecha ASC, m.id ASC`,
      [desde, hasta]
    ),
    all<{ categoria: string; codigo: string | null; nombre_contable: string | null }>(`SELECT categoria, codigo, nombre_contable FROM mapeo_contable`).catch(() => []),
    saldosPor("cuenta", hasta),
    saldosPor("fondo", hasta),
    listarPeriodos(),
  ]);
  const mapa = new Map(mapeo.map((m) => [m.categoria.trim().toLowerCase(), m]));
  const filas = movs.map((m) => {
    const mp = mapa.get((m.categoria || "").trim().toLowerCase());
    const anulado = m.estado === "anulado";
    return {
      fecha: m.fecha,
      mes: m.fecha.slice(0, 7),
      tipo: m.transferencia_id ? "Pase interno" : m.tipo === "ingreso" ? "Ingreso" : "Egreso",
      rubro: m.categoria,
      codigo: mp?.codigo ?? "",
      cuenta_contable: mp?.nombre_contable ?? "",
      cuenta: m.cuenta ?? "",
      fondo: m.fondo ?? "",
      descripcion: m.descripcion ?? "",
      ingreso: !anulado && m.tipo === "ingreso" ? Number(m.monto) : null,
      egreso: !anulado && m.tipo === "egreso" ? Number(m.monto) : null,
      estado: anulado ? "Anulado" : m.contra_de_id ? `Corrige el N° ${m.contra_de_id}` : "Vigente",
      numero: m.id,
      registrado_por: m.registrado_por ?? "",
    };
  });

  const porRubro = new Map<string, { rubro: string; codigo: string; ingresos: number; egresos: number }>();
  for (const f of filas) {
    if (f.tipo === "Pase interno") continue;
    const r = porRubro.get(f.rubro) ?? { rubro: f.rubro, codigo: f.codigo, ingresos: 0, egresos: 0 };
    r.ingresos += f.ingreso ?? 0;
    r.egresos += f.egreso ?? 0;
    porRubro.set(f.rubro, r);
  }

  const titulo = [user.organizacion.nombre, `Libro de movimientos del ${desde.split("-").reverse().join("/")} al ${hasta.split("-").reverse().join("/")}`, `Generado el ${hoy.split("-").reverse().join("/")} por ${user.nombre}`];
  const buffer = await crearLibroExcel(
    [
      {
        nombre: "Movimientos",
        encabezado: titulo,
        totales: true,
        columnas: [
          { titulo: "Fecha", clave: "fecha", tipo: "fecha" },
          { titulo: "Mes", clave: "mes", ancho: 9 },
          { titulo: "Tipo", clave: "tipo", ancho: 12 },
          { titulo: "Rubro", clave: "rubro", ancho: 22 },
          { titulo: "Código contable", clave: "codigo", ancho: 12 },
          { titulo: "Cuenta contable", clave: "cuenta_contable", ancho: 22 },
          { titulo: "Cuenta (banco/caja)", clave: "cuenta", ancho: 18 },
          { titulo: "Fondo", clave: "fondo", ancho: 16 },
          { titulo: "Descripción", clave: "descripcion", ancho: 40 },
          { titulo: "Ingreso", clave: "ingreso", tipo: "monto" },
          { titulo: "Egreso", clave: "egreso", tipo: "monto" },
          { titulo: "Estado", clave: "estado", ancho: 16 },
          { titulo: "N° interno", clave: "numero", tipo: "numero", ancho: 10 },
          { titulo: "Registrado por", clave: "registrado_por", ancho: 18 },
        ],
        filas,
      },
      {
        nombre: "Resumen por rubro",
        encabezado: titulo,
        totales: true,
        columnas: [
          { titulo: "Rubro", clave: "rubro", ancho: 28 },
          { titulo: "Código contable", clave: "codigo", ancho: 14 },
          { titulo: "Ingresos", clave: "ingresos", tipo: "monto" },
          { titulo: "Egresos", clave: "egresos", tipo: "monto" },
        ],
        filas: [...porRubro.values()].sort((a, b) => a.rubro.localeCompare(b.rubro)),
      },
      {
        nombre: "Saldos",
        encabezado: [user.organizacion.nombre, `Saldos al ${hasta.split("-").reverse().join("/")}`],
        columnas: [
          { titulo: "Dónde / para qué", clave: "nombre", ancho: 28 },
          { titulo: "Tipo", clave: "tipo", ancho: 10 },
          { titulo: "Saldo inicial", clave: "inicial", tipo: "monto" },
          { titulo: "Ingresos", clave: "ingresos", tipo: "monto" },
          { titulo: "Egresos", clave: "egresos", tipo: "monto" },
          { titulo: "Saldo", clave: "saldo", tipo: "monto" },
        ],
        filas: [
          ...cuentas.map((c) => ({ nombre: c.nombre, tipo: "Cuenta", inicial: c.saldoInicial, ingresos: c.ingresos, egresos: c.egresos, saldo: c.saldo })),
          ...fondos.map((f) => ({ nombre: f.nombre, tipo: "Fondo", inicial: f.saldoInicial, ingresos: f.ingresos, egresos: f.egresos, saldo: f.saldo })),
        ],
      },
      {
        nombre: "Cierres",
        columnas: [
          { titulo: "Mes", clave: "mes", ancho: 20 },
          { titulo: "Estado", clave: "estado", ancho: 36 },
          { titulo: "Cerrado por", clave: "cerrado_por", ancho: 20 },
          { titulo: "Visado por", clave: "visado_por", ancho: 20 },
        ],
        filas: periodos
          .filter((p) => p.periodo >= desde.slice(0, 7) && p.periodo <= hasta.slice(0, 7))
          .map((p) => ({ mes: textoPeriodo(p.periodo), estado: ESTADO_PERIODO_LABEL[p.estado], cerrado_por: p.cerrado_por ?? "", visado_por: p.visado_por ?? "" })),
      },
    ],
    user.organizacion.nombre
  );
  await audit({ usuario_id: user.id, accion: "exportar_libro_contador", entidad: "movimientos_financieros", entidad_id: null, valor_nuevo: { desde, hasta, filas: filas.length } }).catch(() => {});
  return respuestaExcel(buffer, `libro-movimientos-${desde}-a-${hasta}.xlsx`);
}
