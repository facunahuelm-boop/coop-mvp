import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, canApprove, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { resumenFinanciero, resumenCuotasSocios, flujoDeCajaCooperativa } from "@/lib/logic";
import {
  opcionesLibro,
  saldosPor,
  compromisosPendientes,
  facturasAPagar,
  presupuestoDelAnio,
  listarPeriodos,
  textoPeriodo,
} from "@/lib/finanzasLibro";
import {
  TransferirForm,
  CorregirMovimientoForm,
  NuevoCompromisoForm,
  CancelarCompromisoForm,
  CumplirCompromisoForm,
  NuevaFacturaForm,
  PagarFacturaForm,
  AnularFacturaForm,
  LineaPresupuestoForm,
  QuitarLineaPresupuestoBoton,
  CopiarPresupuestoBoton,
} from "@/components/finanzas/LibroFormularios";
import { obtenerReglasCooperativa } from "@/lib/reglas";
import { Card, PageHeader, EmptyState, SectionTitle, Badge, Label, inputClass } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import Link from "next/link";
import dayjs from "dayjs";
import { Pagination, paginaDe } from "@/components/Pagination";
import { ResumenFinanzas, type ResumenTileDef } from "@/components/finanzas/ResumenFinanzas";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";
import { EstadoCuotaBadge } from "@/components/cuotas/EstadoCuota";
import {
  AgregarFinanzaModal,
  RegistrarMovimientoForm,
  EditarMovimientoForm,
  AnularMovimientoBoton,
  GenerarCuotaMensualForm,
  NuevoConvenioFormConSelector,
} from "@/components/finanzas/FinanzasFormularios";

/**
 * Rediseño de Finanzas (pedido explícito, 18/09: "quedo excelente quiero
 * que hagas lo mismo con la parte de finanzas" — mismo pedido ya aplicado a
 * Contactos/Proveedores/Núcleos/Compras). Mismo criterio en cada pestaña:
 *
 * - "Resumen" y "Cuotas y convenios": los StatTiles fijos de siempre pasan a
 *   ser botones (ResumenFinanzas.tsx, mismo patrón que ResumenCompras.tsx)
 *   que abren un pop-up con el detalle real detrás del número — sin agregar
 *   consultas nuevas, salvo un desglose de INGRESOS por categoría que no
 *   existía (resumenFinanciero() lo agrega, ver logic.ts).
 * - "Cuotas y convenios": la tabla (antes BuscadorFilas + <tr> planas) pasa
 *   a TablaFiltrable + FilaConDetalle, igual que Compras/Proveedores — con
 *   un filtro por "Situación" (al día / pendiente / vencida / con convenio),
 *   un campo sintetizado a partir de los datos que ya trae
 *   resumenCuotasSocios(), no una columna nueva en la base.
 * - "Movimientos": a diferencia de las otras pestañas, esta tabla puede
 *   crecer sin límite (por eso tiene paginación real desde la Fase 8,
 *   hallazgo H-10: COUNT + LIMIT/OFFSET). Convertirla a TablaFiltrable
 *   (100% cliente, carga todo en memoria) reintroduciría ese mismo bug. En
 *   cambio, se agrega una barra de filtros compacta por GET (mismo patrón
 *   ya usado en /gastos: principal siempre visible + "Más filtros"
 *   plegado), que arma el WHERE en el servidor y convive con la paginación
 *   existente sin tocarla.
 *
 * Al filtrar o cambiar de página en "Movimientos" la pantalla se recarga
 * (form GET / <Link> de Pagination) — sin esto, <Tabs> siempre volvía a
 * abrir en "Resumen" después de tocar "Página siguiente", perdiendo el
 * lugar donde se estaba. Se agrega `defaultTab` para que, si la URL trae
 * cualquier parámetro de Movimientos, esa pestaña quede abierta de entrada.
 */

const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-UY")}`;
// Fase 5 (consistencia visual): antes era un array de 6 hex sueltos, sin
// relación con la paleta del sistema (globals.css) — se reemplaza por
// variables CSS ya definidas ahí, para que un cambio de paleta a futuro
// también actualice este gráfico sin tocar código.
// Rediseño visual global (18/09): tras remapear la paleta de marca a verde,
// brand-800/brand-600/--color-verde son ahora 3 tonos de verde — mal para un
// gráfico donde cada categoría necesita distinguirse a simple vista. Se
// reemplazan por acentos ya definidos en el sistema (los mismos 4 acentos de
// módulo + amarillo/rojo del semáforo), evitando repetir el mismo hex en dos
// lugares y sin agregar colores nuevos a la paleta.
const CATEGORY_COLORS = [
  "var(--color-brand-800)",
  "var(--accent-blue)",
  "var(--accent-violet)",
  "var(--color-amarillo)",
  "var(--color-rojo)",
  "var(--accent-teal)",
];
const POR_PAGINA = 20;

type SituacionCuota = "vencida" | "convenio" | "pendiente" | "al_dia";
const SITUACION_LABEL: Record<SituacionCuota, string> = {
  vencida: "Vencida",
  convenio: "Con convenio",
  pendiente: "Pendiente",
  al_dia: "Al día",
};
function situacionDeCuota(f: { cuotasVencidas: number; cuotasPendientes: number; convenio: unknown }): SituacionCuota {
  if (f.cuotasVencidas > 0) return "vencida";
  if (f.convenio) return "convenio";
  if (f.cuotasPendientes > 0) return "pendiente";
  return "al_dia";
}
// Panel de morosidad (04/10): mismos colores que el estado de cada cuota —
// rojo vencida, azul en convenio, amarillo pendiente, verde al día.
const SITUACION_COLOR: Record<SituacionCuota, "rojo" | "azul" | "amarillo" | "verde"> = {
  vencida: "rojo",
  convenio: "azul",
  pendiente: "amarillo",
  al_dia: "verde",
};
type TramoAtraso = "1-30" | "31-60" | "61-90" | "90+";
const TRAMO_LABEL: Record<TramoAtraso, string> = {
  "1-30": "Hasta 30 días",
  "31-60": "31 a 60 días",
  "61-90": "61 a 90 días",
  "90+": "Más de 90 días",
};
function tramoDeAtraso(dias: number): TramoAtraso | null {
  if (dias <= 0) return null;
  if (dias <= 30) return "1-30";
  if (dias <= 60) return "31-60";
  if (dias <= 90) return "61-90";
  return "90+";
}
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function etiquetaPeriodo(p: string): string {
  const [a, m] = p.split("-");
  return MESES[Number(m) - 1] ? `${MESES[Number(m) - 1]} ${a}` : p;
}
function antiguedadTexto(dias: number): string {
  if (dias <= 0) return "—";
  if (dias < 30) return `${dias} día${dias === 1 ? "" : "s"}`;
  const meses = Math.floor(dias / 30);
  return `${dias} días (${meses} mes${meses === 1 ? "" : "es"})`;
}

type Filtros = { page?: string; tipo?: string; categoria?: string; desde?: string; hasta?: string; cuenta?: string; fondo?: string; anio?: string; tab?: string };
const fechaCorta = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

export default async function FinanzasPage({
  searchParams,
}: {
  // Next.js 16: searchParams llega como Promise — ver la nota en
  // documentos/page.tsx sobre el bug que esto causa si no se hace await.
  searchParams: Promise<Filtros>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "finanzas")) redirect("/dashboard");

  const detalle = ROLES_FINANZAS_DETALLE.includes(user.rol);
  const puedeEditar = canEdit(user.rol, "finanzas");
  // Sub-fase 4.4: anular un movimiento queda restringido a admin (antes lo
  // podía hacer cualquiera con canEdit(finanzas) — administración, tesorería
  // y consejo directivo también) — ver anularMovimientoAction en
  // actions/finanzas.ts para el porqué. Editar sigue igual que siempre.
  const puedeAnular = user.rol === "admin";
  const f = await searchParams;
  const page = paginaDe(f);

  // Rediseño 18/09: barra de filtros por GET para Movimientos (ver nota de
  // arriba sobre por qué esta pestaña NO usa TablaFiltrable). Mismo criterio
  // que /gastos: condiciones armadas a mano, siempre con `?` parametrizado.
  const condiciones: string[] = [];
  const params: (string | number)[] = [];
  if (f.tipo) { condiciones.push(`m.tipo = ?`); params.push(f.tipo); }
  if (f.categoria) { condiciones.push(`m.categoria = ?`); params.push(f.categoria); }
  if (f.desde) { condiciones.push(`m.fecha >= ?`); params.push(f.desde); }
  if (f.hasta) { condiciones.push(`left(m.fecha, 10) <= ?`); params.push(f.hasta); }
  // Fase 2A: filtrar por cuenta y por fondo.
  if (f.cuenta && /^\d+$/.test(f.cuenta)) { condiciones.push(`m.cuenta_id = ?`); params.push(Number(f.cuenta)); }
  if (f.fondo && /^\d+$/.test(f.fondo)) { condiciones.push(`m.fondo_id = ?`); params.push(Number(f.fondo)); }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const hayFiltrosMovimientos = Boolean(f.tipo || f.categoria || f.desde || f.hasta || f.cuenta || f.fondo);
  const puedeConfigurar = canApprove(user.rol, "finanzas");
  const anioPresupuesto = f.anio && /^\d{4}$/.test(f.anio) ? f.anio : new Date().getFullYear().toString();

  // Fase 8 (paginación/búsqueda/filtros), hallazgo H-10: tenía un LIMIT 15
  // fijo — se reemplaza por paginación real (COUNT + LIMIT/OFFSET), y la
  // sección deja de llamarse "recientes" porque ahora sí se puede ver todo.
  const [fin, totalMovimientosRow, movimientos, categoriasMovimiento, compromisos, cuotas, socios, reglas] = await Promise.all([
    resumenFinanciero(),
    get<{ total: string }>(`SELECT COUNT(*) as total FROM movimientos_financieros m ${where}`, params).catch(() => ({ total: "0" })),
    all<any>(
      `SELECT m.*, u.nombre as registrado_por, c.nombre AS cuenta_nombre, fo.nombre AS fondo_nombre
         FROM movimientos_financieros m
         LEFT JOIN users u ON u.id = m.registrado_por_id
         LEFT JOIN cuentas_financieras c ON c.id = m.cuenta_id
         LEFT JOIN fondos fo ON fo.id = m.fondo_id
         ${where} ORDER BY m.fecha DESC, m.id DESC LIMIT ? OFFSET ?`,
      [...params, POR_PAGINA, (page - 1) * POR_PAGINA]
    ).catch(async (err) => {
      if (!["42P01", "42703"].includes(err?.code)) throw err;
      return all<any>(
        `SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m LEFT JOIN users u ON u.id = m.registrado_por_id ${where.replace(/AND m\.(cuenta|fondo)_id = \?/g, "")} ORDER BY fecha DESC LIMIT ? OFFSET ?`,
        [...params.slice(0, params.length - (f.cuenta ? 1 : 0) - (f.fondo ? 1 : 0)), POR_PAGINA, (page - 1) * POR_PAGINA]
      );
    }),
    all<{ categoria: string }>(`SELECT DISTINCT categoria FROM movimientos_financieros ORDER BY categoria ASC`),
    compromisosPendientes(),
    // Rediseño profundo de Finanzas (16/09): reemplaza la vieja "Cuentas por
    // cobrar a socios" (solo total adeudado) por la vista consolidada de
    // cuotas/convenios — ver resumenCuotasSocios() en logic.ts.
    resumenCuotasSocios(),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado NOT IN ('baja', 'egresado', 'excluido') ORDER BY nombre ASC`),
    // Fase 3, Sub-fase 3.1 ("Reglas de la cooperativa"): mismo umbral de
    // desvío de presupuesto que usa recalcularAlertas() — antes hardcodeado
    // en 0.15 acá también, solo para el color de esta celda.
    obtenerReglasCooperativa(),
  ]);
  // Fase 2A: cuentas, fondos, lo que hay que pagar, flujo, presupuesto y meses cerrados.
  const [opciones, saldosCuentas, saldosFondos, facturas, flujo, presupuesto, periodos, proveedores, comprasSinFactura] = detalle
    ? await Promise.all([
        opcionesLibro(),
        saldosPor("cuenta"),
        saldosPor("fondo"),
        facturasAPagar(),
        flujoDeCajaCooperativa().catch(() => null),
        presupuestoDelAnio(anioPresupuesto),
        listarPeriodos(),
        all<{ id: number; nombre: string }>(`SELECT id, nombre FROM proveedores ORDER BY nombre`).catch(() => []),
        all<{ id: number; material: string; proveedor: string | null }>(
          `SELECT s.id, s.material, p.nombre AS proveedor FROM compromisos_futuros c
             JOIN solicitudes_compra s ON s.id = c.solicitud_compra_id LEFT JOIN proveedores p ON p.id = c.proveedor_id
            WHERE c.estado = 'pendiente' ORDER BY s.id DESC LIMIT 100`
        ).catch(() => []),
      ])
    : [null, [], [], [], null, { lineas: [], sinPresupuesto: [] }, [], [], []];
  const mesesCerrados = new Set((periodos ?? []).filter((p) => p.estado !== "abierto").map((p) => p.periodo));
  const hoyUy = opciones?.hoy ?? new Date().toISOString().slice(0, 10);
  const facturasVencidas = facturas.filter((fa) => fa.fecha_vencimiento && fa.fecha_vencimiento < hoyUy);
  const totalAPagar = facturas.reduce((a, fa) => a + fa.monto, 0) + compromisos.filter((c) => c.tipo === "egreso").reduce((a, c) => a + c.monto, 0);
  const mesAnterior = (() => {
    const [y, m] = hoyUy.slice(0, 7).split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const estadoMesAnterior = (periodos ?? []).find((p) => p.periodo === mesAnterior);
  // Ingresos generados por un pago de cuota (04/10): a qué socio pertenecen,
  // para mostrarlo y llevar a su ficha (ahí se corrigen, no acá). Tolerante a
  // que la migración 0048 todavía no esté aplicada.
  const idsPagoCuota = movimientos.map((m) => m.movimiento_cuenta_socio_id).filter(Boolean) as number[];
  const socioDePago = new Map<number, { socio_id: number; nombre: string }>();
  if (idsPagoCuota.length) {
    const filasPago = await all<{ id: number; socio_id: number; nombre: string }>(
      `SELECT mcs.id, mcs.socio_id, s.nombre FROM movimientos_cuenta_socio mcs JOIN socios s ON s.id = mcs.socio_id
       WHERE mcs.id IN (${idsPagoCuota.map(() => "?").join(",")})`,
      idsPagoCuota
    ).catch(() => []);
    for (const r of filasPago) socioDePago.set(r.id, r);
  }
  const totalMovimientos = Number(totalMovimientosRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalMovimientos / POR_PAGINA));
  const maxCategoria = Math.max(1, ...fin.porCategoria.map((c: any) => c.total));

  const tilesResumen: ResumenTileDef[] = [
    {
      id: "ingresos",
      label: "Ingresos totales",
      value: money(fin.ingresos),
      items: fin.porCategoriaIngreso
        .filter((c) => Number(c.total) > 0)
        .map((c) => ({ label: c.categoria, sublabel: money(Number(c.total)) })),
      vacioTexto: "Sin ingresos registrados.",
    },
    {
      id: "egresos",
      label: "Egresos totales",
      value: money(fin.egresos),
      items: fin.porCategoria
        .filter((c) => Number(c.total) > 0)
        .map((c) => ({ label: c.categoria, sublabel: money(Number(c.total)) })),
      vacioTexto: "Sin egresos registrados.",
    },
    {
      id: "comprometido",
      label: "Comprometido",
      value: money(fin.comprometido),
      intro: "Compras aprobadas y otros pagos ya decididos, más las facturas que todavía no se pagaron.",
      items: [
        ...facturas.map((fa) => ({
          label: `Factura${fa.numero ? ` N° ${fa.numero}` : ""}${fa.proveedor_nombre ? ` — ${fa.proveedor_nombre}` : ""}`,
          sublabel: `${fa.fecha_vencimiento ? `vence ${fechaCorta(fa.fecha_vencimiento)} · ` : ""}${money(fa.monto)}`,
        })),
        ...compromisos
          .filter((c) => c.tipo === "egreso")
          .map((c) => ({
            label: c.descripcion,
            sublabel: `${c.origen ?? ""} · ${dayjs(c.fecha_estimada).format("DD/MM/YYYY")} · ${money(c.monto)}`,
          })),
      ],
      vacioTexto: "No hay nada pendiente de pago.",
    },
    {
      id: "disponible",
      label: "Disponible prudencial",
      value: money(fin.disponiblePrudencial),
      color: fin.disponiblePrudencial < 0 ? "rojo" : fin.disponiblePrudencial < fin.gastosProyectados ? "amarillo" : "verde",
      intro: "Saldo actual menos pagos y compromisos ya asumidos. Esto no es lo mismo que el saldo bancario: es lo que queda después de descontar lo comprometido.",
      items: [
        { label: "Saldo actual", sublabel: money(fin.saldo) },
        { label: "Comprometido", sublabel: `− ${money(fin.comprometido)}` },
        { label: "Disponible prudencial", sublabel: money(fin.disponiblePrudencial) },
        { label: "Gastos proyectados (30 días)", sublabel: money(fin.gastosProyectados) },
      ],
    },
    // Fase 9 del sistema de gestión de Comisiones (20/09, "integración
    // Compras/Proveedores/Finanzas"): mismo patrón resumen→click→pop-up que
    // el resto de esta pestaña, agregando qué comisión gastó cuánto (dato
    // que ya existe en gastos_comision desde hace fases, pero que Finanzas
    // nunca mostraba agrupado).
    {
      id: "por-comision",
      label: "Gastos por comisión",
      value: money(fin.porComision.reduce((acc, c) => acc + Number(c.total || 0), 0)),
      items: fin.porComision
        .filter((c) => Number(c.total) > 0)
        .map((c) => ({ label: c.comision, sublabel: money(Number(c.total)) })),
      vacioTexto: "Ninguna comisión tiene gastos pagados todavía.",
    },
  ];

  const tilesCuotas: ResumenTileDef[] = [
    {
      id: "adeudado",
      label: "Total adeudado",
      value: money(cuotas.totalAdeudado),
      color: cuotas.totalAdeudado > 0 ? "rojo" : "verde",
      items: cuotas.filas
        .filter((f) => f.totalAdeudado > 0)
        .sort((a, b) => b.totalAdeudado - a.totalAdeudado)
        .map((f) => ({ label: f.nombre, sublabel: money(f.totalAdeudado), href: `/socios/${f.socioId}` })),
      vacioTexto: "Ningún socio tiene saldo pendiente.",
    },
    {
      id: "vencidas",
      label: "Cuotas vencidas",
      value: String(cuotas.totalVencidas),
      color: cuotas.totalVencidas > 0 ? "rojo" : "verde",
      items: cuotas.filas
        .filter((f) => f.cuotasVencidas > 0)
        .sort((a, b) => b.cuotasVencidas - a.cuotasVencidas)
        .map((f) => ({ label: f.nombre, sublabel: `${f.cuotasVencidas} cuota(s)`, href: `/socios/${f.socioId}` })),
      vacioTexto: "No hay cuotas vencidas.",
    },
    {
      id: "monto-vencido",
      label: "Monto vencido",
      value: money(cuotas.filas.reduce((a, f) => a + f.montoVencido, 0)),
      color: cuotas.filas.some((f) => f.montoVencido > 0) ? "rojo" : "verde",
      intro: "Deuda ya vencida e impaga (sin contar lo que todavía no venció). Ordenado por antigüedad.",
      items: cuotas.filas
        .filter((f) => f.montoVencido > 0)
        .sort((a, b) => b.diasDeAtraso - a.diasDeAtraso)
        .map((f) => ({ label: f.nombre, sublabel: `${money(f.montoVencido)} · ${f.diasDeAtraso} días de atraso`, href: `/socios/${f.socioId}` })),
      vacioTexto: "No hay deuda vencida.",
    },
    {
      id: "convenios",
      label: "Convenios activos",
      value: String(cuotas.convenioActivos),
      items: cuotas.filas
        .filter((f) => f.convenio)
        .map((f) => ({ label: f.nombre, sublabel: f.convenio!.motivo, href: `/socios/${f.socioId}` })),
      vacioTexto: "No hay convenios de pago activos.",
    },
  ];

  const periodosConDeuda = [...new Set(cuotas.filas.flatMap((f) => f.periodosConDeuda))].sort().reverse();
  const filtrosCuotas: FiltroDef[] = [
    {
      id: "situacion",
      label: "Estado",
      opciones: (Object.keys(SITUACION_LABEL) as SituacionCuota[]).map((v) => ({ value: v, label: SITUACION_LABEL[v] })),
      valores: cuotas.filas.map(situacionDeCuota),
    },
    {
      id: "atraso",
      label: "Antigüedad de la deuda",
      opciones: (Object.keys(TRAMO_LABEL) as TramoAtraso[]).map((v) => ({ value: v, label: TRAMO_LABEL[v] })),
      valores: cuotas.filas.map((f) => tramoDeAtraso(f.diasDeAtraso)),
    },
    {
      id: "periodo",
      label: "Período adeudado",
      secundario: true,
      opciones: periodosConDeuda.map((p) => ({ value: p, label: etiquetaPeriodo(p) })),
      valores: cuotas.filas.map((f) => f.periodosConDeuda),
    },
    {
      id: "convenio",
      label: "Convenio",
      secundario: true,
      opciones: [
        { value: "con", label: "Con convenio activo" },
        { value: "sin", label: "Sin convenio" },
      ],
      valores: cuotas.filas.map((f) => (f.convenio ? "con" : "sin")),
    },
  ];
  const clavesCuotas = cuotas.filas.map((f) => [f.nombre, f.viviendaNumero, f.nucleoNombre].filter(Boolean).join(" "));

  return (
    <div>
      <PageHeader
        title="Finanzas"
        subtitle="Ingresos, egresos, presupuesto y disponible"
        action={
          detalle ? (
            <div className="flex flex-wrap items-center gap-2">
              {puedeEditar && opciones && <AgregarFinanzaModal opciones={opciones} />}
              <Link href="/finanzas/cierre" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken whitespace-nowrap">
                Cierre del mes
              </Link>
              <Link href="/finanzas/conciliacion" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken whitespace-nowrap">
                Conciliar con el banco
              </Link>
              <Link href="/finanzas/cuentas" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken whitespace-nowrap">
                Cuentas y fondos
              </Link>
              <a
                href="/api/reportes/finanzas"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-800)] text-white hover:bg-[var(--color-brand-700)] px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap"
              >
                📄 Descargar reporte PDF
              </a>
            </div>
          ) : undefined
        }
      />

      {!detalle ? (
        <Card><EmptyState>Tu rol ve un resumen general de finanzas. Los montos detallados y movimientos los administra Tesorería y Administración.</EmptyState></Card>
      ) : (
        <Tabs
          defaultTab={f.tab && ["resumen", "pagar", "movimientos", "cuotas", "presupuesto"].includes(f.tab) ? f.tab : hayFiltrosMovimientos || page > 1 ? "movimientos" : f.anio ? "presupuesto" : undefined}
          tabs={[
            {
              id: "resumen",
              label: "Resumen",
              content: (
                <>
                  {/* Rediseño visual (19/09, pedido explícito: "que no queden
                      espacios largos", "todo en uno más lindo con pop-ups y
                      súper práctico"). Dos cambios sobre la versión anterior:
                      (1) la explicación de "disponible prudencial" (antes un
                      párrafo siempre visible) pasa a ser el `intro` del pop-up
                      de ese mismo tile — no se pierde el texto, sólo deja de
                      ocupar espacio permanente en la pantalla; (2) "Gasto por
                      categoría" y "Presupuesto vs. gasto real" pasan de estar
                      apiladas (dos Cards angostas, una debajo de la otra) a
                      una grilla de 2 columnas — mismo contenido, la mitad del
                      alto. La vieja tabla "Próximos pagos / compromisos" se
                      elimina por completo: es exactamente lo que ya muestra
                      el pop-up del tile "Comprometido" de arriba (ahora con
                      el origen incluido en el detalle) — mantenerla como
                      tabla aparte era duplicar la misma información dos
                      veces en la misma pantalla. */}
                  <ResumenFinanzas tiles={tilesResumen} columnas={5} />

                  {/* Fase 2A: avisos de lo que hay que hacer, dónde está la plata y cuánta va a haber. */}
                  {(facturasVencidas.length > 0 || (estadoMesAnterior && estadoMesAnterior.movimientos > 0 && estadoMesAnterior.estado === "abierto")) && (
                    <div className="mb-5 space-y-2">
                      {facturasVencidas.length > 0 && (
                        <p className="rounded-xl bg-[var(--color-rojo-bg)] px-4 py-3 text-[15px] text-[var(--color-rojo)]">
                          Hay {facturasVencidas.length} factura(s) vencida(s) sin pagar. <Link href="/finanzas?tab=pagar" className="font-semibold underline">Ver lo que hay que pagar</Link>
                        </p>
                      )}
                      {estadoMesAnterior && estadoMesAnterior.movimientos > 0 && estadoMesAnterior.estado === "abierto" && (
                        <p className="rounded-xl bg-[var(--color-amarillo-bg)] px-4 py-3 text-[15px] text-ink">
                          {textoPeriodo(mesAnterior)} todavía no está cerrado. <Link href="/finanzas/cierre" className="font-semibold underline">Ir al cierre del mes</Link>
                        </p>
                      )}
                    </div>
                  )}

                  {saldosCuentas.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
                      <div>
                        <SectionTitle>Dónde está la plata</SectionTitle>
                        <Card>
                          <ul className="divide-y divide-border text-[15px]">
                            {saldosCuentas.map((c) => (
                              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                                <Link href={`/finanzas?cuenta=${c.id}&tab=movimientos`} className="text-ink hover:underline">{c.nombre}</Link>
                                <span className={`font-semibold ${c.saldo < 0 ? "text-[var(--color-rojo)]" : "text-ink"}`}>{money(c.saldo)}</span>
                              </li>
                            ))}
                            <li className="flex items-center justify-between gap-3 py-2 font-bold">
                              <span>Total</span>
                              <span>{money(saldosCuentas.reduce((a, c) => a + c.saldo, 0))}</span>
                            </li>
                          </ul>
                        </Card>
                      </div>
                      <div>
                        <SectionTitle>Para qué es la plata</SectionTitle>
                        <Card>
                          <ul className="divide-y divide-border text-[15px]">
                            {saldosFondos.map((fo) => (
                              <li key={fo.id} className="flex items-center justify-between gap-3 py-2">
                                <Link href={`/finanzas?fondo=${fo.id}&tab=movimientos`} className="text-ink hover:underline">{fo.nombre}</Link>
                                <span className={`font-semibold ${fo.saldo < 0 ? "text-[var(--color-rojo)]" : "text-ink"}`}>{money(fo.saldo)}</span>
                              </li>
                            ))}
                            <li className="flex items-center justify-between gap-3 py-2 font-bold">
                              <span>Total</span>
                              <span>{money(saldosFondos.reduce((a, x) => a + x.saldo, 0))}</span>
                            </li>
                          </ul>
                          {Math.round(saldosFondos.reduce((a, x) => a + x.saldo, 0)) !== Math.round(saldosCuentas.reduce((a, c) => a + c.saldo, 0)) && (
                            <p className="mt-2 text-[13px] text-[var(--color-rojo)]">El total de los fondos no coincide con el de las cuentas: revisá los saldos iniciales en «Cuentas y fondos».</p>
                          )}
                        </Card>
                      </div>
                    </div>
                  )}

                  {flujo && (
                    <div className="mb-5">
                      <SectionTitle>¿Cuánta plata vamos a tener?</SectionTitle>
                      <Card>
                        <p className="text-[15px] text-ink-muted mb-3">
                          Lo que hay hoy ({money(flujo.saldoHoy)}), más lo que se espera cobrar, menos lo que hay que pagar.
                          {flujo.deudaAtrasada > 0 && <> La deuda atrasada de socios ({money(flujo.deudaAtrasada)}) no se cuenta: si se cobra, mejor.</>}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[15px]">
                            <thead>
                              <tr className="text-left text-sm text-ink-muted border-b border-border">
                                <th className="py-2 pr-3"></th>
                                {flujo.horizontes.map((h) => <th key={h.dias} className="py-2 pr-3 text-right">En {h.dias} días<div className="font-normal">{fechaCorta(h.hasta)}</div></th>)}
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-border/60"><td className="py-2 pr-3">Hoy hay</td>{flujo.horizontes.map((h) => <td key={h.dias} className="py-2 pr-3 text-right">{money(flujo.saldoHoy)}</td>)}</tr>
                              {flujo.horizontes[0].entradas.map((_, i) => (
                                <tr key={`e${i}`} className="border-b border-border/60">
                                  <td className="py-2 pr-3 text-[var(--color-verde)]">+ {flujo.horizontes[2].entradas[i]?.texto ?? flujo.horizontes[0].entradas[i].texto}</td>
                                  {flujo.horizontes.map((h) => <td key={h.dias} className="py-2 pr-3 text-right">{money(h.entradas[i]?.monto ?? 0)}</td>)}
                                </tr>
                              ))}
                              {flujo.horizontes[0].salidas.map((l, i) => (
                                <tr key={`s${i}`} className="border-b border-border/60">
                                  <td className="py-2 pr-3 text-[var(--color-rojo)]">− {l.texto}</td>
                                  {flujo.horizontes.map((h) => <td key={h.dias} className="py-2 pr-3 text-right">{money(h.salidas[i]?.monto ?? 0)}</td>)}
                                </tr>
                              ))}
                              <tr className="font-bold">
                                <td className="py-2 pr-3">Quedaría</td>
                                {flujo.horizontes.map((h) => <td key={h.dias} className={`py-2 pr-3 text-right ${h.saldoFinal < 0 ? "text-[var(--color-rojo)]" : ""}`}>{money(h.saldoFinal)}</td>)}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
                    <div>
                      <SectionTitle>Gasto por categoría</SectionTitle>
                      <Card>
                        <div className="space-y-2">
                          {fin.porCategoria.map((c: any, i: number) => (
                            <div key={c.categoria} className="flex items-center gap-3 text-sm">
                              <span className="w-24 shrink-0 text-ink/60 truncate">{c.categoria}</span>
                              <div className="flex-1 h-3 rounded-full bg-ink/5 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${(c.total / maxCategoria) * 100}%`, backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                              </div>
                              <span className="w-20 text-right font-medium">{money(c.total)}</span>
                            </div>
                          ))}
                          {fin.porCategoria.length === 0 && <EmptyState>Sin egresos registrados.</EmptyState>}
                        </div>
                      </Card>
                    </div>

                    <div>
                      <SectionTitle>Presupuesto {anioPresupuesto}</SectionTitle>
                      <Card>
                        {presupuesto.lineas.length === 0 ? (
                          <EmptyState>Sin presupuesto cargado para {anioPresupuesto}.</EmptyState>
                        ) : (
                          <ul className="space-y-2 text-[15px]">
                            {presupuesto.lineas.slice(0, 6).map((l) => (
                              <li key={l.id}>
                                <div className="flex justify-between gap-2"><span>{l.categoria}</span><span className={l.porcentaje >= reglas.porcentajeDesvioPresupuesto * 100 + 100 ? "font-semibold text-[var(--color-rojo)]" : "text-ink-muted"}>{l.porcentaje}% usado</span></div>
                                <div className="h-2 rounded-full bg-ink/5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, l.porcentaje)}%`, backgroundColor: l.porcentaje >= 100 ? "var(--color-rojo)" : l.porcentaje >= 90 ? "var(--color-amarillo)" : "var(--color-brand-800)" }} /></div>
                              </li>
                            ))}
                          </ul>
                        )}
                        <Link href="/finanzas?tab=presupuesto" className="mt-3 inline-block text-sm font-semibold text-[var(--color-brand-800)] underline">Ver todo el presupuesto</Link>
                      </Card>
                    </div>
                  </div>


                </>
              ),
            },
            {
              id: "pagar",
              label: facturasVencidas.length ? `Lo que hay que pagar (${facturasVencidas.length} vencida${facturasVencidas.length === 1 ? "" : "s"})` : "Lo que hay que pagar",
              content: (
                <>
                  <p className="mb-4 text-[15px] text-ink-muted">
                    Facturas que todavía no se pagaron y compras o gastos ya decididos. En total: <b className="text-ink">{money(totalAPagar)}</b>.
                  </p>
                  {puedeEditar && opciones && (
                    <div className="mb-4 flex flex-wrap gap-3">
                      <NuevaFacturaForm opciones={opciones} proveedores={proveedores} compras={comprasSinFactura} />
                      <NuevoCompromisoForm opciones={opciones} />
                    </div>
                  )}
                  <SectionTitle>Facturas a pagar</SectionTitle>
                  <Card className="mb-5">
                    {facturas.length === 0 ? (
                      <EmptyState>No hay facturas pendientes de pago.</EmptyState>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[15px]">
                          <thead>
                            <tr className="text-left text-sm text-ink-muted border-b border-border">
                              <th className="py-2 pr-3">Proveedor</th><th className="pr-3">Factura</th><th className="pr-3">Vence</th><th className="pr-3 text-right">Monto</th><th className="pr-3"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {facturas.map((fa) => {
                              const vencida = Boolean(fa.fecha_vencimiento && fa.fecha_vencimiento < hoyUy);
                              return (
                                <tr key={fa.id} className="border-b border-border/60 last:border-0">
                                  <td className="py-2 pr-3">{fa.proveedor_nombre ?? "—"}{fa.solicitud_compra_id && <div className="text-xs"><Link href={`/compras/${fa.solicitud_compra_id}`} className="underline">Ver la compra</Link></div>}</td>
                                  <td className="pr-3">{fa.numero ? `N° ${fa.numero}` : "—"}{fa.archivo_url && <> · <a href={fa.archivo_url} target="_blank" rel="noreferrer" className="underline text-sm">ver archivo</a></>}<div className="text-xs text-ink-muted">{fa.descripcion}</div></td>
                                  <td className="pr-3 whitespace-nowrap">{fa.fecha_vencimiento ? fechaCorta(fa.fecha_vencimiento) : "—"} {vencida && <Badge color="rojo">Vencida</Badge>}</td>
                                  <td className="pr-3 text-right font-semibold">{money(fa.monto)}</td>
                                  <td className="pr-3 text-right">
                                    {puedeEditar && opciones && (
                                      <div className="flex flex-wrap items-center justify-end gap-3">
                                        <PagarFacturaForm factura={{ id: fa.id, monto: fa.monto, texto: `${fa.proveedor_nombre ?? "la factura"}${fa.numero ? ` N° ${fa.numero}` : ""} (${money(fa.monto)})` }} opciones={opciones} />
                                        <AnularFacturaForm id={fa.id} />
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                  <SectionTitle>Compras y otros pagos ya decididos</SectionTitle>
                  <Card className="mb-5">
                    {compromisos.filter((c) => c.tipo === "egreso").length === 0 ? (
                      <EmptyState>No hay compromisos pendientes.</EmptyState>
                    ) : (
                      <ul className="divide-y divide-border text-[15px]">
                        {compromisos.filter((c) => c.tipo === "egreso").map((c) => (
                          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <span>
                              <span className="font-medium text-ink">{c.descripcion}</span>
                              <span className="block text-sm text-ink-muted">
                                {[c.origen, c.proveedor_nombre, `para el ${fechaCorta(c.fecha_estimada)}`].filter(Boolean).join(" · ")}
                                {c.solicitud_compra_id && <> · <Link href={`/compras/${c.solicitud_compra_id}`} className="underline">ver la compra</Link></>}
                              </span>
                            </span>
                            <span className="flex flex-wrap items-center gap-3">
                              <b>{money(c.monto)}</b>
                              {puedeEditar && opciones && !c.solicitud_compra_id && <CumplirCompromisoForm compromiso={c} opciones={opciones} />}
                              {puedeEditar && <CancelarCompromisoForm id={c.id} />}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  {compromisos.some((c) => c.tipo === "ingreso") && (
                    <>
                      <SectionTitle>Plata que se espera que entre</SectionTitle>
                      <Card>
                        <ul className="divide-y divide-border text-[15px]">
                          {compromisos.filter((c) => c.tipo === "ingreso").map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                              <span><span className="font-medium text-ink">{c.descripcion}</span><span className="block text-sm text-ink-muted">para el {fechaCorta(c.fecha_estimada)}</span></span>
                              <span className="flex flex-wrap items-center gap-3">
                                <b className="text-[var(--color-verde)]">{money(c.monto)}</b>
                                {puedeEditar && opciones && <CumplirCompromisoForm compromiso={c} opciones={opciones} />}
                                {puedeEditar && <CancelarCompromisoForm id={c.id} />}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    </>
                  )}
                </>
              ),
            },
            {
              id: "cuotas",
              label: "Cuotas y convenios",
              content: (
                <>
                  {/* Rediseño profundo de Finanzas (16/09) + rediseño visual
                      (18/09, mismo patrón que Compras/Proveedores): la vieja
                      "Cuentas por cobrar a socios" (solo total adeudado) ya
                      había pasado a esta vista consolidada — ahora además los
                      3 números de arriba son botones con pop-up y la tabla
                      usa el mismo filtro + fila-con-detalle que el resto del
                      sistema, en vez de una búsqueda de texto sola. Cada fila
                      sigue llevando a la ficha del socio (mismo lugar de
                      siempre) para editar/eliminar un movimiento puntual o
                      gestionar su convenio, en vez de duplicar esa lógica acá. */}
                  <ResumenFinanzas tiles={tilesCuotas} columnas={4} />

                  {puedeEditar && (
                    <div className="flex flex-wrap gap-3 mb-5">
                      <GenerarCuotaMensualForm />
                      <NuevoConvenioFormConSelector socios={socios} />
                    </div>
                  )}

                  {cuotas.filas.length === 0 ? (
                    <Card><EmptyState>No hay socios activos con cuentas registradas.</EmptyState></Card>
                  ) : (
                    <TablaFiltrable
                      placeholder="Buscar núcleo, socio o vivienda…"
                      claves={clavesCuotas}
                      filtros={filtrosCuotas}
                      sinResultadosTexto="No se encontraron núcleos para esa búsqueda."
                      encabezado={
                        <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                          <th className="py-2 pr-3">Núcleo / socio</th>
                          <th className="py-2 pr-3 text-right">Total adeudado</th>
                          <th className="py-2 pr-3 text-right">Vencido</th>
                          <th className="py-2 pr-3 text-right">Cuotas vencidas</th>
                          <th className="py-2 pr-3">Antigüedad</th>
                          <th className="py-2 pr-3">Convenio</th>
                          <th className="py-2 pr-3">Estado</th>
                          <th className="py-2 pr-3"></th>
                        </tr>
                      }
                    >
                      {cuotas.filas.map((f) => {
                        const situacion = situacionDeCuota(f);
                        return (
                        <FilaConDetalle
                          key={f.socioId}
                          titulo={f.nombre}
                          subtitulo={[f.viviendaNumero ? `Vivienda ${f.viviendaNumero}` : null, f.nucleoNombre].filter(Boolean).join(" · ") || undefined}
                          editarHref={`/socios/${f.socioId}`}
                          secciones={[
                            {
                              titulo: "Situación",
                              items: [
                                { label: "Estado", valor: <Badge color={SITUACION_COLOR[situacion]}>{SITUACION_LABEL[situacion]}</Badge> },
                                { label: "Total adeudado", valor: f.totalAdeudado > 0 ? money(f.totalAdeudado) : "—" },
                                { label: "Monto vencido", valor: f.montoVencido > 0 ? <span className="text-[var(--color-rojo)] font-semibold">{money(f.montoVencido)}</span> : "—" },
                                { label: "Cuotas vencidas", valor: f.cuotasVencidas || "—" },
                                { label: "Cuotas pendientes (sin vencer)", valor: f.cuotasPendientes || "—" },
                                { label: "Vencida más antigua", valor: f.vencidaMasAntigua ? dayjs(f.vencidaMasAntigua).format("DD/MM/YYYY") : "—" },
                                { label: "Antigüedad", valor: antiguedadTexto(f.diasDeAtraso) },
                                { label: "Próximo vencimiento", valor: f.proximoVencimiento ? dayjs(f.proximoVencimiento).format("DD/MM/YYYY") : "—" },
                              ],
                            },
                            {
                              titulo: "Detalle de la deuda",
                              items: f.detalleDeuda.length
                                ? f.detalleDeuda.map((c) => ({
                                    label: `${c.concepto} · ${etiquetaPeriodo(c.periodo)}`,
                                    valor: (
                                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                                        <span>{money(c.montoPendiente)}{c.montoPendiente < c.monto ? ` de ${money(c.monto)}` : ""}</span>
                                        <EstadoCuotaBadge estado={c.estado} conPagoParcial={c.montoPendiente < c.monto} />
                                        {c.fechaVencimiento && <span className="text-ink/50">vence {dayjs(c.fechaVencimiento).format("DD/MM/YYYY")}</span>}
                                      </span>
                                    ),
                                  }))
                                : [{ label: "Cuotas", valor: "Sin deuda" }],
                            },
                            {
                              titulo: "Convenio de pago",
                              items: f.convenio
                                ? [
                                    { label: "Motivo", valor: f.convenio.motivo },
                                    { label: "Monto de cuota", valor: money(f.convenio.monto_cuota) },
                                  ]
                                : [{ label: "Estado", valor: "Sin convenio activo" }],
                            },
                          ]}
                        >
                          <td className="py-2 pr-3">
                            <Link href={`/socios/${f.socioId}`} className="font-medium text-[var(--color-brand-900)] hover:underline underline-offset-2">{f.nombre}</Link>
                            {(f.viviendaNumero || f.nucleoNombre) && (
                              <div className="text-xs text-ink/50">{[f.viviendaNumero ? `Viv. ${f.viviendaNumero}` : null, f.nucleoNombre].filter(Boolean).join(" · ")}</div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-medium">{f.totalAdeudado > 0 ? money(f.totalAdeudado) : "—"}</td>
                          <td className={`py-2 pr-3 text-right ${f.montoVencido > 0 ? "text-[var(--color-rojo)] font-semibold" : ""}`}>{f.montoVencido > 0 ? money(f.montoVencido) : "—"}</td>
                          <td className={`py-2 pr-3 text-right ${f.cuotasVencidas > 0 ? "text-[var(--color-rojo)] font-semibold" : ""}`}>{f.cuotasVencidas || "—"}</td>
                          <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{f.diasDeAtraso > 0 ? `${f.diasDeAtraso} días` : "—"}</td>
                          <td className="py-2 pr-3">{f.convenio ? <Badge color="azul">{f.convenio.motivo}</Badge> : "—"}</td>
                          <td className="py-2 pr-3"><Badge color={SITUACION_COLOR[situacion]}>{SITUACION_LABEL[situacion]}</Badge></td>
                        </FilaConDetalle>
                        );
                      })}
                    </TablaFiltrable>
                  )}
                </>
              ),
            },
            {
              id: "movimientos",
              label: "Movimientos",
              content: (
                <>
                  {/* Rediseño visual (18/09): a diferencia de las otras dos
                      pestañas, esta NO pasa a TablaFiltrable — la tabla de
                      Movimientos puede crecer sin límite y ya tiene
                      paginación real en el servidor (Fase 8, hallazgo H-10).
                      Filtrar 100% en el cliente exigiría volver a traer TODOS
                      los movimientos de siempre a la vez, reintroduciendo el
                      mismo problema que esa paginación vino a resolver. En
                      cambio, se agrega una barra de filtros compacta por GET
                      (mismo patrón que /gastos) que arma el WHERE en el
                      servidor y convive con el LIMIT/OFFSET existente. */}
                  <form className="mb-4 flex flex-wrap items-center gap-2" method="GET">
                    <select
                      name="tipo"
                      defaultValue={f.tipo || ""}
                      aria-label="Tipo"
                      className="rounded-lg border border-ink/10 bg-surface px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30 focus:border-[var(--color-brand-800)]"
                    >
                      <option value="">Tipo: todos</option>
                      <option value="ingreso">🟢 Ingreso</option>
                      <option value="egreso">🔴 Egreso</option>
                    </select>
                    <details className="relative" open={Boolean(f.categoria || f.desde || f.hasta || f.cuenta || f.fondo)}>
                      <summary className="cursor-pointer select-none list-none rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
                        Más filtros {Boolean(f.categoria || f.desde || f.hasta || f.cuenta || f.fondo) && "●"}
                      </summary>
                      <div className="absolute z-10 mt-2 w-64 space-y-2.5 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-lg)]">
                        <div>
                          <Label>Categoría</Label>
                          <select name="categoria" defaultValue={f.categoria || ""} className={inputClass}>
                            <option value="">Todas</option>
                            {categoriasMovimiento.map((c) => (
                              <option key={c.categoria} value={c.categoria}>{c.categoria}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><Label>Desde</Label><input type="date" name="desde" defaultValue={f.desde || ""} className={inputClass} /></div>
                          <div><Label>Hasta</Label><input type="date" name="hasta" defaultValue={f.hasta || ""} className={inputClass} /></div>
                        </div>
                        {opciones && opciones.cuentas.length > 0 && (
                          <>
                            <div>
                              <Label>Cuenta</Label>
                              <select name="cuenta" defaultValue={f.cuenta || ""} className={inputClass}>
                                <option value="">Todas</option>
                                {opciones.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                              </select>
                            </div>
                            <div>
                              <Label>Fondo</Label>
                              <select name="fondo" defaultValue={f.fondo || ""} className={inputClass}>
                                <option value="">Todos</option>
                                {opciones.fondos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                              </select>
                            </div>
                          </>
                        )}
                      </div>
                    </details>
                    <button className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-1.5 text-xs font-semibold">Filtrar</button>
                    {hayFiltrosMovimientos && (
                      <a href="/finanzas" className="text-xs text-ink-muted underline underline-offset-2">
                        Limpiar filtros
                      </a>
                    )}
                  </form>

                  <Card>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-ink/50 border-b border-ink/10">
                          <th className="py-2">Fecha</th><th>Tipo</th><th>Rubro</th><th>Cuenta · fondo</th><th>Descripción</th><th className="text-right">Monto</th>
                          {(puedeEditar || puedeAnular) && <th className="text-right">Acciones</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {movimientos.map((m) => {
                          const anulado = m.estado === "anulado";
                          const mesCerrado = mesesCerrados.has(String(m.fecha).slice(0, 7));
                          const pase = Boolean(m.transferencia_id);
                          const pagoCuota = m.movimiento_cuenta_socio_id ? socioDePago.get(m.movimiento_cuenta_socio_id) : undefined;
                          return (
                          <tr key={m.id} className={`border-b border-ink/5 last:border-0${anulado ? " opacity-50" : ""}`}>
                            <td className="py-2 whitespace-nowrap">{fechaCorta(m.fecha)}</td>
                            <td>
                              {pase ? "↔ pase interno" : m.tipo === "ingreso" ? "🟢 ingreso" : "🔴 egreso"}
                              {anulado && <Badge color="gray">Anulado</Badge>}
                              {m.contra_de_id && <Badge color="amarillo">Corrección</Badge>}
                              {mesCerrado && <span className="ml-1" title="Mes cerrado">🔒</span>}
                            </td>
                            <td>{m.categoria}</td>
                            <td className="text-ink-muted text-xs">{[m.cuenta_nombre, m.fondo_nombre].filter(Boolean).join(" · ") || "—"}</td>
                            <td className="text-ink/60">
                              {m.descripcion}
                              {m.movimiento_cuenta_socio_id && (
                                <div className="mt-0.5">
                                  {pagoCuota ? (
                                    <Link href={`/socios/${pagoCuota.socio_id}`} title="Se corrige o anula desde la cuenta del socio">
                                      <Badge color="azul">Pago de cuota — {pagoCuota.nombre}</Badge>
                                    </Link>
                                  ) : (
                                    <Badge color="azul">Pago de cuota</Badge>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="text-right font-medium">{money(m.monto)}</td>
                            {(puedeEditar || puedeAnular) && (
                              <td className="text-right">
                                {!anulado && m.movimiento_cuenta_socio_id ? (
                                  <span className="text-xs text-ink/40">Desde la ficha del socio</span>
                                ) : !anulado && (mesCerrado || m.factura_id) ? (
                                  puedeEditar && opciones && !pase && !m.contra_de_id ? (
                                    <CorregirMovimientoForm id={m.id} texto={`${m.tipo === "ingreso" ? "el ingreso" : "el egreso"} de ${money(m.monto)} (${m.categoria}) del ${fechaCorta(m.fecha)}`} hoy={opciones.hoy} />
                                  ) : (
                                    <span className="text-xs text-ink/40">Mes cerrado</span>
                                  )
                                ) : !anulado && (
                                  <div className="flex items-center justify-end gap-3">
                                    {puedeEditar && opciones && !pase && <EditarMovimientoForm movimiento={m} opciones={opciones} />}
                                    {puedeAnular && <AnularMovimientoBoton id={m.id} categoria={pase ? "pase interno (se anulan las dos partes)" : m.categoria} />}
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                          );
                        })}
                        {movimientos.length === 0 && (
                          <tr><td colSpan={(puedeEditar || puedeAnular) ? 7 : 6}><EmptyState>{hayFiltrosMovimientos ? "No hay movimientos que coincidan con estos filtros." : "Sin movimientos registrados todavía."}</EmptyState></td></tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                  <Pagination page={page} totalPages={totalPages} basePath="/finanzas" searchParams={f} />
                  {puedeEditar && opciones && (
                    <div className="mt-4 flex flex-wrap items-start gap-3">
                      <RegistrarMovimientoForm opciones={opciones} />
                      {opciones.cuentas.length > 0 && <div className="mt-4"><TransferirForm opciones={opciones} /></div>}
                    </div>
                  )}
                </>
              ),
            },
            {
              id: "presupuesto",
              label: "Presupuesto",
              content: (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <Link href={`/finanzas?anio=${Number(anioPresupuesto) - 1}`} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">← {Number(anioPresupuesto) - 1}</Link>
                    <span className="text-lg font-bold text-ink">Presupuesto {anioPresupuesto}</span>
                    <Link href={`/finanzas?anio=${Number(anioPresupuesto) + 1}`} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">{Number(anioPresupuesto) + 1} →</Link>
                    {puedeConfigurar && opciones && <LineaPresupuestoForm anio={anioPresupuesto} opciones={opciones} />}
                    {puedeConfigurar && presupuesto.lineas.length === 0 && <CopiarPresupuestoBoton desde={String(Number(anioPresupuesto) - 1)} hasta={anioPresupuesto} />}
                  </div>
                  <p className="mb-3 text-[15px] text-ink-muted">«Usado» suma lo que ya se gastó y lo que ya está comprometido (compras aprobadas y facturas a pagar) en ese rubro.</p>
                  <Card className="mb-5">
                    {presupuesto.lineas.length === 0 ? (
                      <EmptyState>Todavía no hay presupuesto para {anioPresupuesto}.</EmptyState>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[15px]">
                          <thead>
                            <tr className="text-left text-sm text-ink-muted border-b border-border">
                              <th className="py-2 pr-3">Rubro</th><th className="pr-3 text-right">Presupuestado</th><th className="pr-3 text-right">Gastado</th><th className="pr-3 text-right">Comprometido</th><th className="pr-3">Usado</th><th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {presupuesto.lineas.map((l) => (
                              <tr key={l.id} className="border-b border-border/60 last:border-0">
                                <td className="py-2 pr-3 font-medium">{l.categoria}</td>
                                <td className="pr-3 text-right">{money(l.presupuestado)}</td>
                                <td className="pr-3 text-right">{money(l.gastado)}</td>
                                <td className="pr-3 text-right">{money(l.comprometido)}</td>
                                <td className="pr-3 min-w-[9rem]">
                                  <div className="flex items-center gap-2">
                                    <div className="h-2.5 flex-1 rounded-full bg-ink/5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, l.porcentaje)}%`, backgroundColor: l.porcentaje >= 100 ? "var(--color-rojo)" : l.porcentaje >= 90 ? "var(--color-amarillo)" : "var(--color-brand-800)" }} /></div>
                                    <span className={l.porcentaje >= 100 ? "font-semibold text-[var(--color-rojo)]" : ""}>{l.porcentaje}%</span>
                                  </div>
                                </td>
                                <td className="text-right whitespace-nowrap">
                                  {puedeConfigurar && opciones && (
                                    <span className="inline-flex items-center gap-2">
                                      <LineaPresupuestoForm anio={anioPresupuesto} linea={l} opciones={opciones} />
                                      <QuitarLineaPresupuestoBoton id={l.id} />
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                            <tr className="font-bold">
                              <td className="py-2 pr-3">Total</td>
                              <td className="pr-3 text-right">{money(presupuesto.lineas.reduce((a, l) => a + l.presupuestado, 0))}</td>
                              <td className="pr-3 text-right">{money(presupuesto.lineas.reduce((a, l) => a + l.gastado, 0))}</td>
                              <td className="pr-3 text-right">{money(presupuesto.lineas.reduce((a, l) => a + l.comprometido, 0))}</td>
                              <td></td><td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                  {presupuesto.sinPresupuesto.length > 0 && (
                    <>
                      <SectionTitle>Gastos de {anioPresupuesto} en rubros sin presupuesto</SectionTitle>
                      <Card>
                        <ul className="divide-y divide-border text-[15px]">
                          {presupuesto.sinPresupuesto.map((x) => (
                            <li key={x.categoria} className="flex justify-between gap-3 py-2"><span>{x.categoria}</span><b>{money(x.gastado)}</b></li>
                          ))}
                        </ul>
                      </Card>
                    </>
                  )}
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
