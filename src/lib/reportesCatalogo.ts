import { all } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canRead, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { calcularCuotasSocio, cargarMovimientosCuenta, resumenDeCuotas, flujoDeCajaCooperativa } from "@/lib/logic";
import { presupuestoDelAnio } from "@/lib/finanzasLibro";
import { cargarLibretas } from "@/lib/libretaHoras";
import { estadoDoc, ESTADO_DOC_LABEL, TIPO_DOC_PROVEEDOR_LABEL } from "@/lib/proveedoresDocs";
import { etiquetaEstadoSocio } from "@/lib/sociosEstados";
import { ESTADO_HITO_LABEL } from "@/lib/tramitesTexto";

/**
 * Fase 2H — reportes de la sección 13 del plan. Regla: PDF para lo oficial
 * (se firma, se entrega, va a asamblea) y Excel para analizar o mandar al
 * contador. Cada reporte arma sus tablas una sola vez y la ruta
 * /api/reportes/r/[clave] las imprime en PDF o en Excel.
 */

export type TipoColumna = "texto" | "monto" | "fecha" | "numero";
export type ColumnaReporte = { titulo: string; clave: string; tipo?: TipoColumna; ancho?: number };
export type TablaReporte = { titulo: string; columnas: ColumnaReporte[]; filas: Record<string, string | number | null>[]; totales?: boolean };
export type ContenidoReporte = { subtitulo?: string; tablas: TablaReporte[]; notas?: string[] };
export type Formato = "pdf" | "xlsx";
export type ContextoReporte = { user: SessionUser; hoy: string; desde: string; hasta: string };

export type DefReporte = {
  clave: string;
  titulo: string;
  descripcion: string;
  grupo: "Socios" | "Finanzas" | "Compras" | "Obra y trámites";
  formatos: Formato[];
  /** Pide un rango de fechas (por defecto, el mes actual). */
  periodo?: boolean;
  puede: (u: SessionUser) => boolean;
  generar: (c: ContextoReporte) => Promise<ContenidoReporte>;
};

const finanzas = (u: SessionUser) => ROLES_FINANZAS_DETALLE.includes(u.rol);
const fecha = (f: string | null | undefined) => (f ? f.slice(0, 10) : null);
const OBLIGADOS = "('activo', 'suspendido', 'renunciante')";

async function cuotasPorSocio() {
  const movs = await cargarMovimientosCuenta().catch(() => []);
  const porSocio = new Map<number, typeof movs>();
  for (const m of movs) porSocio.set(m.socio_id, [...(porSocio.get(m.socio_id) ?? []), m]);
  return porSocio;
}

export const REPORTES: DefReporte[] = [
  {
    clave: "morosidad",
    titulo: "Cuotas atrasadas",
    descripcion: "Quién debe, cuántas cuotas y desde cuándo (morosidad nominativa).",
    grupo: "Finanzas",
    formatos: ["pdf", "xlsx"],
    puede: finanzas,
    async generar() {
      const [socios, porSocio] = await Promise.all([
        all<{ id: number; nombre: string; nucleo: string | null; telefono: string | null }>(
          `SELECT s.id, s.nombre, n.nombre AS nucleo, s.telefono FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id WHERE s.estado IN ${OBLIGADOS} ORDER BY s.nombre`
        ),
        cuotasPorSocio(),
      ]);
      const filas = socios
        .map((s) => {
          const r = resumenDeCuotas(calcularCuotasSocio(porSocio.get(s.id) ?? []).cuotas);
          return { nombre: s.nombre, nucleo: s.nucleo ?? "", telefono: s.telefono ?? "", vencidas: r.cuotasVencidas, monto: r.montoVencido, desde: r.vencidaMasAntigua };
        })
        .filter((f) => f.vencidas > 0)
        .sort((a, b) => b.monto - a.monto);
      return {
        subtitulo: `${filas.length} socio${filas.length === 1 ? "" : "s"} con cuotas vencidas`,
        tablas: [
          {
            titulo: "Cuotas vencidas",
            totales: true,
            columnas: [
              { titulo: "Socio", clave: "nombre", ancho: 28 },
              { titulo: "Núcleo", clave: "nucleo", ancho: 20 },
              { titulo: "Teléfono", clave: "telefono", ancho: 14 },
              { titulo: "Cuotas", clave: "vencidas", tipo: "numero", ancho: 8 },
              { titulo: "Monto vencido", clave: "monto", tipo: "monto" },
              { titulo: "Desde", clave: "desde", tipo: "fecha" },
            ],
            filas,
          },
        ],
      };
    },
  },
  {
    clave: "cobranza",
    titulo: "Cobranza del período",
    descripcion: "Todos los pagos de socios registrados entre dos fechas.",
    grupo: "Finanzas",
    formatos: ["xlsx"],
    periodo: true,
    puede: finanzas,
    async generar({ desde, hasta }) {
      const pagos = await all<{ fecha: string; socio: string; concepto: string; monto: string; metodo_pago: string | null }>(
        `SELECT m.fecha, s.nombre AS socio, m.concepto, m.monto, m.metodo_pago FROM movimientos_cuenta_socio m JOIN socios s ON s.id = m.socio_id
          WHERE m.tipo = 'pago' AND COALESCE(m.estado, 'activo') <> 'anulado' AND left(m.fecha, 10) BETWEEN ? AND ? ORDER BY m.fecha, m.id`,
        [desde, hasta]
      );
      return {
        tablas: [
          {
            titulo: "Pagos",
            totales: true,
            columnas: [
              { titulo: "Fecha", clave: "fecha", tipo: "fecha" },
              { titulo: "Socio", clave: "socio", ancho: 28 },
              { titulo: "Concepto", clave: "concepto", ancho: 30 },
              { titulo: "Forma de pago", clave: "metodo", ancho: 16 },
              { titulo: "Monto", clave: "monto", tipo: "monto" },
            ],
            filas: pagos.map((p) => ({ fecha: fecha(p.fecha), socio: p.socio, concepto: p.concepto, metodo: p.metodo_pago ?? "", monto: Number(p.monto) })),
          },
        ],
      };
    },
  },
  {
    clave: "convenios",
    titulo: "Convenios y cumplimiento",
    descripcion: "Cada convenio de pago, cuántas cuotas lleva pagas y si está al día.",
    grupo: "Finanzas",
    formatos: ["xlsx"],
    puede: finanzas,
    async generar({ hoy }) {
      const [convenios, porSocio] = await Promise.all([
        all<{ id: number; socio_id: number; nombre: string; motivo: string; estado: string; monto_total: string; cantidad_cuotas: number; fecha_inicio: string }>(
          `SELECT cv.id, cv.socio_id, s.nombre, cv.motivo, cv.estado, cv.monto_total, cv.cantidad_cuotas, cv.fecha_inicio FROM convenios_pago cv JOIN socios s ON s.id = cv.socio_id
            WHERE cv.anulado_en IS NULL ORDER BY cv.estado = 'activo' DESC, s.nombre`
        ),
        cuotasPorSocio(),
      ]);
      return {
        tablas: [
          {
            titulo: "Convenios",
            columnas: [
              { titulo: "Socio", clave: "nombre", ancho: 26 },
              { titulo: "Motivo", clave: "motivo", ancho: 26 },
              { titulo: "Inicio", clave: "inicio", tipo: "fecha" },
              { titulo: "Estado", clave: "estado", ancho: 12 },
              { titulo: "Total", clave: "total", tipo: "monto" },
              { titulo: "Cuotas", clave: "cuotas", tipo: "numero", ancho: 8 },
              { titulo: "Pagadas", clave: "pagadas", tipo: "numero", ancho: 8 },
              { titulo: "Vencidas sin pagar", clave: "vencidas", tipo: "numero", ancho: 10 },
              { titulo: "Al día", clave: "aldia", ancho: 8 },
            ],
            filas: convenios.map((c) => {
              const q = calcularCuotasSocio(porSocio.get(c.socio_id) ?? []).cuotas.filter((x) => x.convenioId === c.id);
              const vencidas = q.filter((x) => x.estado === "vencida").length;
              return {
                nombre: c.nombre,
                motivo: c.motivo,
                inicio: fecha(c.fecha_inicio),
                estado: c.estado,
                total: Number(c.monto_total),
                cuotas: c.cantidad_cuotas,
                pagadas: q.filter((x) => x.estado === "pagada").length,
                vencidas,
                aldia: c.estado === "activo" ? (vencidas ? "No" : "Sí") : "—",
              };
            }),
          },
        ],
        notas: [`Al ${hoy.split("-").reverse().join("/")}.`],
      };
    },
  },
  {
    clave: "presupuesto",
    titulo: "Presupuesto contra lo real",
    descripcion: "Por rubro: lo presupuestado en el año, lo gastado y lo comprometido.",
    grupo: "Finanzas",
    formatos: ["pdf", "xlsx"],
    puede: finanzas,
    async generar({ hoy }) {
      const anio = hoy.slice(0, 4);
      const p = await presupuestoDelAnio(anio);
      return {
        subtitulo: `Año ${anio}`,
        tablas: [
          {
            titulo: "Rubros con presupuesto",
            totales: true,
            columnas: [
              { titulo: "Rubro", clave: "categoria", ancho: 28 },
              { titulo: "Presupuestado", clave: "presupuestado", tipo: "monto" },
              { titulo: "Gastado", clave: "gastado", tipo: "monto" },
              { titulo: "Comprometido", clave: "comprometido", tipo: "monto" },
              { titulo: "% usado", clave: "porcentaje", tipo: "numero", ancho: 9 },
            ],
            filas: p.lineas.map((l) => ({ categoria: l.categoria, presupuestado: l.presupuestado, gastado: l.gastado, comprometido: l.comprometido, porcentaje: Math.round(l.porcentaje) })),
          },
          ...(p.sinPresupuesto.length
            ? [
                {
                  titulo: "Gastos sin presupuesto",
                  totales: true,
                  columnas: [
                    { titulo: "Rubro", clave: "categoria", ancho: 28 },
                    { titulo: "Gastado", clave: "gastado", tipo: "monto" as const },
                  ],
                  filas: p.sinPresupuesto.map((s) => ({ categoria: s.categoria, gastado: s.gastado })),
                },
              ]
            : []),
        ],
      };
    },
  },
  {
    clave: "flujo",
    titulo: "Flujo de caja proyectado",
    descripcion: "Cuánta plata va a haber en 30, 60 y 90 días.",
    grupo: "Finanzas",
    formatos: ["xlsx"],
    puede: finanzas,
    async generar() {
      const f = await flujoDeCajaCooperativa();
      const filas: Record<string, string | number | null>[] = [];
      for (const h of f.horizontes) {
        for (const e of h.entradas) filas.push({ horizonte: `${h.dias} días`, tipo: "Entra", texto: e.texto, monto: e.monto });
        for (const s of h.salidas) filas.push({ horizonte: `${h.dias} días`, tipo: "Sale", texto: s.texto, monto: -s.monto });
        filas.push({ horizonte: `${h.dias} días`, tipo: "Saldo final", texto: `Al ${h.hasta.split("-").reverse().join("/")}`, monto: h.saldoFinal });
      }
      return {
        subtitulo: `Saldo de hoy: $ ${Math.round(f.saldoHoy).toLocaleString("es-UY")}`,
        tablas: [
          {
            titulo: "Proyección",
            columnas: [
              { titulo: "Horizonte", clave: "horizonte", ancho: 10 },
              { titulo: "Tipo", clave: "tipo", ancho: 12 },
              { titulo: "Detalle", clave: "texto", ancho: 40 },
              { titulo: "Monto", clave: "monto", tipo: "monto" },
            ],
            filas,
          },
        ],
        notas: [`La deuda ya atrasada ($ ${Math.round(f.deudaAtrasada).toLocaleString("es-UY")}) no se cuenta como entrada.`],
      };
    },
  },
  {
    clave: "conciliacion",
    titulo: "Conciliación bancaria",
    descripcion: "Las líneas del banco del período y cómo se conciliaron.",
    grupo: "Finanzas",
    formatos: ["pdf", "xlsx"],
    periodo: true,
    puede: finanzas,
    async generar({ desde, hasta }) {
      const lineas = await all<{ fecha: string; descripcion: string | null; monto: string; estado: string; conciliada_como: string | null; cuenta: string | null }>(
        `SELECT l.fecha, l.descripcion, l.monto, l.estado, l.conciliada_como, c.nombre AS cuenta FROM extracto_lineas l LEFT JOIN cuentas_financieras c ON c.id = l.cuenta_id
          WHERE l.fecha BETWEEN ? AND ? ORDER BY l.fecha, l.id`,
        [desde, hasta]
      ).catch(() => []);
      const ESTADO: Record<string, string> = { pendiente: "Sin conciliar", conciliada: "Conciliada", ignorada: "Ignorada" };
      const pendientes = lineas.filter((l) => l.estado === "pendiente").length;
      return {
        subtitulo: `${lineas.length} líneas · ${pendientes} sin conciliar`,
        tablas: [
          {
            titulo: "Líneas del banco",
            columnas: [
              { titulo: "Fecha", clave: "fecha", tipo: "fecha" },
              { titulo: "Cuenta", clave: "cuenta", ancho: 16 },
              { titulo: "Descripción", clave: "descripcion", ancho: 36 },
              { titulo: "Monto", clave: "monto", tipo: "monto" },
              { titulo: "Estado", clave: "estado", ancho: 14 },
              { titulo: "Cómo", clave: "como", ancho: 18 },
            ],
            filas: lineas.map((l) => ({ fecha: fecha(l.fecha), cuenta: l.cuenta ?? "", descripcion: l.descripcion ?? "", monto: Number(l.monto), estado: ESTADO[l.estado] ?? l.estado, como: l.conciliada_como ?? "" })),
          },
        ],
      };
    },
  },
  {
    clave: "padron",
    titulo: "Padrón de socios",
    descripcion: "Socios con su estado, ingreso y núcleo (para firmar o presentar).",
    grupo: "Socios",
    formatos: ["pdf"],
    puede: (u) => canRead(u.rol, "auditoria") || ROLES_FINANZAS_DETALLE.includes(u.rol) || u.rol === "administracion",
    async generar() {
      const socios = await all<{ nombre: string; documento: string | null; estado: string; fecha_ingreso: string | null; nucleo: string | null }>(
        `SELECT s.nombre, s.documento, s.estado, s.fecha_ingreso, n.nombre AS nucleo FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
          WHERE s.estado NOT IN ('baja', 'egresado', 'excluido') ORDER BY s.fecha_ingreso NULLS LAST, s.nombre`
      );
      return {
        subtitulo: `${socios.length} socios`,
        tablas: [
          {
            titulo: "Padrón",
            columnas: [
              { titulo: "N°", clave: "n", tipo: "numero", ancho: 5 },
              { titulo: "Nombre", clave: "nombre", ancho: 28 },
              { titulo: "Cédula", clave: "documento", ancho: 13 },
              { titulo: "Ingreso", clave: "ingreso", tipo: "fecha" },
              { titulo: "Estado", clave: "estado", ancho: 12 },
              { titulo: "Núcleo", clave: "nucleo", ancho: 20 },
            ],
            filas: socios.map((s, i) => ({ n: i + 1, nombre: s.nombre, documento: s.documento ?? "", ingreso: fecha(s.fecha_ingreso), estado: etiquetaEstadoSocio(s.estado), nucleo: s.nucleo ?? "" })),
          },
        ],
      };
    },
  },
  {
    clave: "horas",
    titulo: "Horas por núcleo",
    descripcion: "Objetivo, horas hechas y saldo de cada núcleo (semanas cerradas del período).",
    grupo: "Obra y trámites",
    formatos: ["pdf", "xlsx"],
    periodo: true,
    puede: (u) => canRead(u.rol, "trabajo") && u.rol !== "socio",
    async generar({ hoy, desde, hasta }) {
      const libretas = await cargarLibretas(hoy).catch(() => []);
      const h = (min: number) => Math.round((min / 60) * 10) / 10;
      const filas = libretas.map((l) => {
        const semanas = l.semanas.filter((s) => s.cerrada && s.semana >= desde && s.semana <= hasta);
        const suma = (k: "objetivoMin" | "realMin" | "justificadoMin" | "injustificadoMin" | "saldoMin") => semanas.reduce((a, s) => a + s[k], 0);
        return {
          nucleo: l.nucleo.nombre,
          semanas: semanas.length,
          objetivo: h(suma("objetivoMin")),
          hechas: h(suma("realMin")),
          justificadas: h(suma("justificadoMin")),
          faltas: h(suma("injustificadoMin")),
          saldo: h(suma("saldoMin")),
          acumulado: h(l.saldoAcumuladoMin),
        };
      });
      return {
        tablas: [
          {
            titulo: "Horas por núcleo",
            totales: true,
            columnas: [
              { titulo: "Núcleo", clave: "nucleo", ancho: 26 },
              { titulo: "Semanas", clave: "semanas", tipo: "numero", ancho: 8 },
              { titulo: "Objetivo (h)", clave: "objetivo", tipo: "numero" },
              { titulo: "Hechas (h)", clave: "hechas", tipo: "numero" },
              { titulo: "Justificadas (h)", clave: "justificadas", tipo: "numero" },
              { titulo: "Faltas (h)", clave: "faltas", tipo: "numero" },
              { titulo: "Saldo del período (h)", clave: "saldo", tipo: "numero" },
              { titulo: "Saldo acumulado (h)", clave: "acumulado", tipo: "numero" },
            ],
            filas,
          },
        ],
      };
    },
  },
  {
    clave: "tramites",
    titulo: "Estado de trámites e hitos",
    descripcion: "Los pasos para llegar a la obra, con su estado y responsable.",
    grupo: "Obra y trámites",
    formatos: ["pdf"],
    puede: (u) => u.rol !== "socio",
    async generar() {
      const hitos = await all<{ titulo: string; estado: string; fecha_estimada: string | null; fecha_real: string | null; responsable: string | null; responsable_texto: string | null }>(
        `SELECT h.titulo, h.estado, h.fecha_estimada, h.fecha_real, u.nombre AS responsable, h.responsable_texto FROM tramites_hitos h LEFT JOIN users u ON u.id = h.responsable_id
          WHERE h.activo = 1 ORDER BY h.orden, h.id`
      ).catch(() => []);
      const hechos = hitos.filter((x) => x.estado === "hecho").length;
      return {
        subtitulo: `${hechos} de ${hitos.filter((x) => x.estado !== "no_aplica").length} pasos cumplidos`,
        tablas: [
          {
            titulo: "Pasos",
            columnas: [
              { titulo: "Paso", clave: "titulo", ancho: 34 },
              { titulo: "Estado", clave: "estado", ancho: 12 },
              { titulo: "Responsable", clave: "responsable", ancho: 18 },
              { titulo: "Previsto", clave: "previsto", tipo: "fecha" },
              { titulo: "Cumplido", clave: "real", tipo: "fecha" },
            ],
            filas: hitos.map((x) => ({
              titulo: x.titulo,
              estado: ESTADO_HITO_LABEL[x.estado as keyof typeof ESTADO_HITO_LABEL] ?? x.estado,
              responsable: x.responsable ?? x.responsable_texto ?? "",
              previsto: fecha(x.fecha_estimada),
              real: fecha(x.fecha_real),
            })),
          },
        ],
      };
    },
  },
  {
    clave: "compras",
    titulo: "Compras del período con presupuestos",
    descripcion: "Cada compra, cuántos presupuestos tuvo, a quién se le compró y por cuánto.",
    grupo: "Compras",
    formatos: ["xlsx"],
    periodo: true,
    puede: (u) => canRead(u.rol, "compras"),
    async generar({ desde, hasta }) {
      const filas = await all<{ id: number; creado_en: string; material: string; comision: string | null; estado: string; presupuestos: string; proveedor: string | null; monto: string | null; excepcion: string | null }>(
        `SELECT s.id, s.creado_en, s.material, s.comision, s.estado,
                (SELECT COUNT(*) FROM presupuestos_proveedor p WHERE p.solicitud_id = s.id) AS presupuestos,
                (SELECT pv.nombre FROM decisiones_compra dc JOIN presupuestos_proveedor pp ON pp.id = dc.presupuesto_id JOIN proveedores pv ON pv.id = pp.proveedor_id WHERE dc.solicitud_id = s.id ORDER BY dc.id DESC LIMIT 1) AS proveedor,
                (SELECT dc.monto FROM decisiones_compra dc WHERE dc.solicitud_id = s.id ORDER BY dc.id DESC LIMIT 1) AS monto,
                (SELECT dc.excepcion_regla FROM decisiones_compra dc WHERE dc.solicitud_id = s.id ORDER BY dc.id DESC LIMIT 1) AS excepcion
           FROM solicitudes_compra s WHERE s.eliminado_en IS NULL AND left(s.creado_en::text, 10) BETWEEN ? AND ? ORDER BY s.creado_en`,
        [desde, hasta]
      ).catch(() => []);
      return {
        tablas: [
          {
            titulo: "Compras",
            totales: true,
            columnas: [
              { titulo: "N°", clave: "id", tipo: "numero", ancho: 6 },
              { titulo: "Fecha", clave: "fecha", tipo: "fecha" },
              { titulo: "Qué", clave: "material", ancho: 30 },
              { titulo: "Comisión", clave: "comision", ancho: 18 },
              { titulo: "Estado", clave: "estado", ancho: 14 },
              { titulo: "Presupuestos", clave: "presupuestos", tipo: "numero", ancho: 10 },
              { titulo: "Proveedor elegido", clave: "proveedor", ancho: 24 },
              { titulo: "Monto", clave: "monto", tipo: "monto" },
              { titulo: "Excepción a la regla de montos", clave: "excepcion", ancho: 30 },
            ],
            filas: filas.map((f) => ({
              id: f.id,
              fecha: fecha(String(f.creado_en)),
              material: f.material,
              comision: f.comision ?? "",
              estado: f.estado,
              presupuestos: Number(f.presupuestos),
              proveedor: f.proveedor ?? "",
              monto: f.monto === null ? null : Number(f.monto),
              excepcion: f.excepcion ?? "",
            })),
          },
        ],
      };
    },
  },
  {
    clave: "proveedores",
    titulo: "Proveedores y documentación",
    descripcion: "Cada proveedor con sus certificados y si están vigentes.",
    grupo: "Compras",
    formatos: ["xlsx"],
    puede: (u) => canRead(u.rol, "compras"),
    async generar({ hoy }) {
      const filas = await all<{ nombre: string; rut: string | null; rubro: string | null; tipo: string | null; descripcion: string | null; fecha_vencimiento: string | null }>(
        `SELECT p.nombre, p.rut, p.rubro, d.tipo, d.descripcion, d.fecha_vencimiento FROM proveedores p
           LEFT JOIN proveedor_documentos d ON d.proveedor_id = p.id AND d.activo = 1
          WHERE p.eliminado_en IS NULL ORDER BY p.nombre, d.fecha_vencimiento`
      ).catch(() => []);
      return {
        tablas: [
          {
            titulo: "Proveedores",
            columnas: [
              { titulo: "Proveedor", clave: "nombre", ancho: 28 },
              { titulo: "RUT", clave: "rut", ancho: 14 },
              { titulo: "Rubro", clave: "rubro", ancho: 16 },
              { titulo: "Documento", clave: "doc", ancho: 24 },
              { titulo: "Vence", clave: "vence", tipo: "fecha" },
              { titulo: "Estado", clave: "estado", ancho: 14 },
            ],
            filas: filas.map((f) => ({
              nombre: f.nombre,
              rut: f.rut ?? "",
              rubro: f.rubro ?? "",
              doc: f.tipo ? `${TIPO_DOC_PROVEEDOR_LABEL[f.tipo] ?? f.tipo}${f.descripcion ? ` (${f.descripcion})` : ""}` : "Sin documentación cargada",
              vence: fecha(f.fecha_vencimiento),
              estado: f.tipo ? ESTADO_DOC_LABEL[estadoDoc(f, hoy)] : "",
            })),
          },
        ],
      };
    },
  },
];

export function reporte(clave: string): DefReporte | undefined {
  return REPORTES.find((r) => r.clave === clave);
}
