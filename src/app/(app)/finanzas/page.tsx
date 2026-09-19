import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { resumenFinanciero, resumenCuotasSocios } from "@/lib/logic";
import { Card, PageHeader, EmptyState, SectionTitle, Badge, Label, inputClass } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import Link from "next/link";
import dayjs from "dayjs";
import { Pagination, paginaDe } from "@/components/Pagination";
import { ResumenFinanzas, type ResumenTileDef } from "@/components/finanzas/ResumenFinanzas";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";
import {
  AgregarCompromisoForm,
  RegistrarMovimientoForm,
  EditarMovimientoForm,
  EliminarMovimientoBoton,
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

type Filtros = { page?: string; tipo?: string; categoria?: string; desde?: string; hasta?: string };

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
  if (f.hasta) { condiciones.push(`m.fecha <= ?`); params.push(f.hasta); }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const hayFiltrosMovimientos = Boolean(f.tipo || f.categoria || f.desde || f.hasta);

  // Fase 8 (paginación/búsqueda/filtros), hallazgo H-10: tenía un LIMIT 15
  // fijo — se reemplaza por paginación real (COUNT + LIMIT/OFFSET), y la
  // sección deja de llamarse "recientes" porque ahora sí se puede ver todo.
  const [fin, totalMovimientosRow, movimientos, categoriasMovimiento, compromisos, cuotas, socios] = await Promise.all([
    resumenFinanciero(),
    get<{ total: string }>(`SELECT COUNT(*) as total FROM movimientos_financieros m ${where}`, params),
    all<any>(
      `SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m LEFT JOIN users u ON u.id = m.registrado_por_id ${where} ORDER BY fecha DESC LIMIT ? OFFSET ?`,
      [...params, POR_PAGINA, (page - 1) * POR_PAGINA]
    ),
    all<{ categoria: string }>(`SELECT DISTINCT categoria FROM movimientos_financieros ORDER BY categoria ASC`),
    all<any>(`SELECT * FROM compromisos_futuros ORDER BY fecha_estimada ASC`),
    // Rediseño profundo de Finanzas (16/09): reemplaza la vieja "Cuentas por
    // cobrar a socios" (solo total adeudado) por la vista consolidada de
    // cuotas/convenios — ver resumenCuotasSocios() en logic.ts.
    resumenCuotasSocios(),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado != 'baja' ORDER BY nombre ASC`),
  ]);
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
      items: compromisos.map((c) => ({
        label: c.descripcion,
        sublabel: `${c.origen} · ${dayjs(c.fecha_estimada).format("DD/MM/YYYY")} · ${money(c.monto)}`,
      })),
      vacioTexto: "Sin compromisos futuros cargados.",
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
      id: "convenios",
      label: "Convenios activos",
      value: String(cuotas.convenioActivos),
      items: cuotas.filas
        .filter((f) => f.convenio)
        .map((f) => ({ label: f.nombre, sublabel: f.convenio!.motivo, href: `/socios/${f.socioId}` })),
      vacioTexto: "No hay convenios de pago activos.",
    },
  ];

  const filtrosCuotas: FiltroDef[] = [
    {
      id: "situacion",
      label: "Situación",
      opciones: (Object.keys(SITUACION_LABEL) as SituacionCuota[]).map((v) => ({ value: v, label: SITUACION_LABEL[v] })),
      valores: cuotas.filas.map(situacionDeCuota),
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
            <a
              href="/api/reportes/finanzas"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-800)] text-white hover:bg-[var(--color-brand-700)] px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap"
            >
              📄 Descargar reporte PDF
            </a>
          ) : undefined
        }
      />

      {!detalle ? (
        <Card><EmptyState>Tu rol ve un resumen general de finanzas. Los montos detallados y movimientos los administra Tesorería y Administración.</EmptyState></Card>
      ) : (
        <Tabs
          defaultTab={hayFiltrosMovimientos || page > 1 ? "movimientos" : undefined}
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
                  <ResumenFinanzas tiles={tilesResumen} columnas={4} />

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
                      <SectionTitle>Presupuesto vs. gasto real</SectionTitle>
                      <Card>
                        {fin.presupuestoVsReal.length === 0 ? (
                          <EmptyState>Sin presupuesto cargado todavía.</EmptyState>
                        ) : (
                          <table className="w-full text-sm">
                            <thead><tr className="text-left text-xs text-ink/50 border-b border-ink/10"><th className="py-2">Categoría</th><th>Presup.</th><th>Gastado</th><th>Desvío</th></tr></thead>
                            <tbody>
                              {fin.presupuestoVsReal.map((p: any) => {
                                const desv = p.monto_presupuestado > 0 ? (p.gastado - p.monto_presupuestado) / p.monto_presupuestado : 0;
                                return (
                                  <tr key={p.categoria} className="border-b border-ink/5 last:border-0">
                                    <td className="py-2">{p.categoria}</td>
                                    <td>{money(p.monto_presupuestado)}</td>
                                    <td>{money(p.gastado)}</td>
                                    <td className={desv > 0.15 ? "text-[var(--color-rojo)] font-semibold" : "text-ink/60"}>{Math.round(desv * 100)}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </Card>
                    </div>
                  </div>

                  {puedeEditar && <AgregarCompromisoForm />}
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
                  <ResumenFinanzas tiles={tilesCuotas} columnas={3} />

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
                      placeholder="Buscar socio, vivienda o núcleo…"
                      claves={clavesCuotas}
                      filtros={filtrosCuotas}
                      sinResultadosTexto="No se encontraron socios para esa búsqueda."
                      encabezado={
                        <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                          <th className="py-2 pr-3">Socio</th>
                          <th className="py-2 pr-3">Vivienda / Núcleo</th>
                          <th className="py-2 pr-3 text-right">Pendientes</th>
                          <th className="py-2 pr-3 text-right">Vencidas</th>
                          <th className="py-2 pr-3 text-right">Adeudado</th>
                          <th className="py-2 pr-3">Próx. vencimiento</th>
                          <th className="py-2 pr-3">Convenio</th>
                          <th className="py-2 pr-3"></th>
                        </tr>
                      }
                    >
                      {cuotas.filas.map((f) => (
                        <FilaConDetalle
                          key={f.socioId}
                          titulo={f.nombre}
                          subtitulo={[f.viviendaNumero ? `Vivienda ${f.viviendaNumero}` : null, f.nucleoNombre].filter(Boolean).join(" · ") || undefined}
                          editarHref={`/socios/${f.socioId}`}
                          secciones={[
                            {
                              titulo: "Cuotas",
                              items: [
                                { label: "Pendientes", valor: f.cuotasPendientes || "—" },
                                { label: "Vencidas", valor: f.cuotasVencidas > 0 ? <span className="text-[var(--color-rojo)] font-semibold">{f.cuotasVencidas}</span> : "—" },
                                { label: "Total adeudado", valor: f.totalAdeudado > 0 ? money(f.totalAdeudado) : "—" },
                                { label: "Próximo vencimiento", valor: f.proximoVencimiento ? dayjs(f.proximoVencimiento).format("DD/MM/YYYY") : "—" },
                              ],
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
                          <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">
                            <Link href={`/socios/${f.socioId}`} className="hover:underline underline-offset-2">{f.nombre}</Link>
                          </td>
                          <td className="py-2 pr-3 text-ink/60">{[f.viviendaNumero, f.nucleoNombre].filter(Boolean).join(" · ") || "—"}</td>
                          <td className="py-2 pr-3 text-right">{f.cuotasPendientes || "—"}</td>
                          <td className={`py-2 pr-3 text-right ${f.cuotasVencidas > 0 ? "text-[var(--color-rojo)] font-semibold" : ""}`}>{f.cuotasVencidas || "—"}</td>
                          <td className="py-2 pr-3 text-right font-medium">{f.totalAdeudado > 0 ? money(f.totalAdeudado) : "—"}</td>
                          <td className="py-2 pr-3 text-ink/60">{f.proximoVencimiento ? dayjs(f.proximoVencimiento).format("DD/MM/YYYY") : "—"}</td>
                          <td className="py-2 pr-3">{f.convenio ? <Badge color="brand">{f.convenio.motivo}</Badge> : "—"}</td>
                        </FilaConDetalle>
                      ))}
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
                    <details className="relative" open={Boolean(f.categoria || f.desde || f.hasta)}>
                      <summary className="cursor-pointer select-none list-none rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
                        Más filtros {Boolean(f.categoria || f.desde || f.hasta) && "●"}
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
                          <th className="py-2">Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th className="text-right">Monto</th>
                          {puedeEditar && <th className="text-right">Acciones</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {movimientos.map((m) => (
                          <tr key={m.id} className="border-b border-ink/5 last:border-0">
                            <td className="py-2">{dayjs(m.fecha).format("DD/MM")}</td>
                            <td>{m.tipo === "ingreso" ? "🟢 ingreso" : "🔴 egreso"}</td>
                            <td>{m.categoria}</td>
                            <td className="text-ink/60">{m.descripcion}</td>
                            <td className="text-right font-medium">{money(m.monto)}</td>
                            {puedeEditar && (
                              <td className="text-right">
                                <div className="flex items-center justify-end gap-3">
                                  <EditarMovimientoForm movimiento={m} />
                                  <EliminarMovimientoBoton id={m.id} categoria={m.categoria} />
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                        {movimientos.length === 0 && (
                          <tr><td colSpan={puedeEditar ? 6 : 5}><EmptyState>{hayFiltrosMovimientos ? "No hay movimientos que coincidan con estos filtros." : "Sin movimientos registrados todavía."}</EmptyState></td></tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                  <Pagination page={page} totalPages={totalPages} basePath="/finanzas" searchParams={f} />
                  {puedeEditar && <RegistrarMovimientoForm />}
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
