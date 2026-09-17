import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { resumenFinanciero, resumenCuotasSocios } from "@/lib/logic";
import { Card, PageHeader, StatTile, EmptyState, SectionTitle, Badge } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import { BuscadorFilas } from "@/components/BuscadorFilas";
import Link from "next/link";
import dayjs from "dayjs";
import { Pagination, paginaDe } from "@/components/Pagination";
import {
  AgregarCompromisoForm,
  RegistrarMovimientoForm,
  EditarMovimientoForm,
  EliminarMovimientoBoton,
  GenerarCuotaMensualForm,
  NuevoConvenioFormConSelector,
} from "@/components/finanzas/FinanzasFormularios";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
// Fase 5 (consistencia visual): antes era un array de 6 hex sueltos, sin
// relación con la paleta del sistema (globals.css) — se reemplaza por
// variables CSS ya definidas ahí, para que un cambio de paleta a futuro
// también actualice este gráfico sin tocar código.
const CATEGORY_COLORS = [
  "var(--color-brand-800)",
  "var(--color-brand-600)",
  "var(--accent-teal)",
  "var(--color-amarillo)",
  "var(--color-rojo)",
  "var(--color-verde)",
];
const POR_PAGINA = 20;

export default async function FinanzasPage({
  searchParams,
}: {
  // Next.js 16: searchParams llega como Promise — ver la nota en
  // documentos/page.tsx sobre el bug que esto causa si no se hace await.
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "finanzas")) redirect("/dashboard");

  const detalle = ROLES_FINANZAS_DETALLE.includes(user.rol);
  const puedeEditar = canEdit(user.rol, "finanzas");
  const sp = await searchParams;
  const page = paginaDe(sp);
  // Fase 8 (paginación/búsqueda/filtros), hallazgo H-10: tenía un LIMIT 15
  // fijo — se reemplaza por paginación real (COUNT + LIMIT/OFFSET), y la
  // sección deja de llamarse "recientes" porque ahora sí se puede ver todo.
  const [fin, totalMovimientosRow, movimientos, compromisos, cuotas, socios] = await Promise.all([
    resumenFinanciero(),
    get<{ total: string }>(`SELECT COUNT(*) as total FROM movimientos_financieros`),
    all<any>(
      `SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m LEFT JOIN users u ON u.id = m.registrado_por_id ORDER BY fecha DESC LIMIT ? OFFSET ?`,
      [POR_PAGINA, (page - 1) * POR_PAGINA]
    ),
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

  return (
    <div>
      <PageHeader
        title="Finanzas"
        subtitle="Ingresos, egresos, presupuesto y disponible"
        action={
          detalle ? (
            <a
              href="/api/reportes/finanzas"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-800)] text-white hover:bg-[var(--color-brand-900)] px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap"
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
          tabs={[
            {
              id: "resumen",
              label: "Resumen",
              content: (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    <StatTile label="Ingresos totales" value={money(fin.ingresos)} />
                    <StatTile label="Egresos totales" value={money(fin.egresos)} />
                    <StatTile label="Comprometido" value={money(fin.comprometido)} />
                    <StatTile label="Disponible prudencial" value={money(fin.disponiblePrudencial)} color={fin.disponiblePrudencial < 0 ? "rojo" : fin.disponiblePrudencial < fin.gastosProyectados ? "amarillo" : "verde"} />
                  </div>

                  <p className="text-xs text-ink/50 mb-6">
                    Saldo actual ({money(fin.saldo)}) menos pagos y compromisos ya asumidos ({money(fin.comprometido)}) = disponible prudencial. Esto no es lo mismo que el saldo bancario: es lo que queda después de descontar lo comprometido.
                  </p>

                  <SectionTitle>Gasto por categoría</SectionTitle>
                  <Card className="mb-6">
                    <div className="space-y-2">
                      {fin.porCategoria.map((c: any, i: number) => (
                        <div key={c.categoria} className="flex items-center gap-3 text-sm">
                          <span className="w-32 shrink-0 text-ink/60 truncate">{c.categoria}</span>
                          <div className="flex-1 h-3 rounded-full bg-ink/5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(c.total / maxCategoria) * 100}%`, backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                          </div>
                          <span className="w-24 text-right font-medium">{money(c.total)}</span>
                        </div>
                      ))}
                      {fin.porCategoria.length === 0 && <EmptyState>Sin egresos registrados.</EmptyState>}
                    </div>
                  </Card>

                  <SectionTitle>Presupuesto vs. gasto real</SectionTitle>
                  <Card className="mb-6">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-ink/50 border-b border-ink/10"><th className="py-2">Categoría</th><th>Presupuestado</th><th>Gastado</th><th>Desvío</th></tr></thead>
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
                  </Card>

                  <SectionTitle>Próximos pagos / compromisos</SectionTitle>
                  <Card className="mb-4">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-ink/50 border-b border-ink/10"><th className="py-2">Descripción</th><th>Origen</th><th>Fecha</th><th className="text-right">Monto</th></tr></thead>
                      <tbody>
                        {compromisos.map((c) => (
                          <tr key={c.id} className="border-b border-ink/5 last:border-0">
                            <td className="py-2 font-medium">{c.descripcion}</td>
                            <td className="text-ink/60">{c.origen}</td>
                            <td className="text-ink/60">{dayjs(c.fecha_estimada).format("DD/MM/YYYY")}</td>
                            <td className="text-right font-bold">{money(c.monto)}</td>
                          </tr>
                        ))}
                        {compromisos.length === 0 && (
                          <tr><td colSpan={4}><EmptyState>Sin compromisos futuros cargados.</EmptyState></td></tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                  {puedeEditar && <AgregarCompromisoForm />}
                </>
              ),
            },
            {
              id: "cuotas",
              label: "Cuotas y convenios",
              content: (
                <>
                  {/* Rediseño profundo de Finanzas (pedido explícito, 16/09):
                      reemplaza la vieja "Cuentas por cobrar a socios" (solo
                      total adeudado por socio) por esta vista consolidada —
                      cuotas pendientes/vencidas, próximo vencimiento y
                      convenio activo, todo en columnas compactas, sin abrir
                      cada ficha para saber "cómo va la cuota". Cada fila
                      lleva a la ficha del socio (mismo lugar de siempre)
                      para editar/eliminar un movimiento puntual o gestionar
                      su convenio, en vez de duplicar esa lógica acá. */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                    <StatTile label="Total adeudado" value={money(cuotas.totalAdeudado)} color={cuotas.totalAdeudado > 0 ? "rojo" : "verde"} />
                    <StatTile label="Cuotas vencidas" value={String(cuotas.totalVencidas)} color={cuotas.totalVencidas > 0 ? "rojo" : "verde"} />
                    <StatTile label="Convenios activos" value={String(cuotas.convenioActivos)} />
                  </div>

                  {puedeEditar && (
                    <div className="flex flex-wrap gap-3 mb-5">
                      <GenerarCuotaMensualForm />
                      <NuevoConvenioFormConSelector socios={socios} />
                    </div>
                  )}

                  <BuscadorFilas
                    placeholder="Buscar socio, vivienda o núcleo..."
                    claves={cuotas.filas.map((f) => [f.nombre, f.viviendaNumero, f.nucleoNombre].filter(Boolean).join(" "))}
                    encabezado={
                      <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                        <th className="py-2 pr-3">Socio</th>
                        <th className="py-2 pr-3">Vivienda / Núcleo</th>
                        <th className="py-2 pr-3 text-right">Pendientes</th>
                        <th className="py-2 pr-3 text-right">Vencidas</th>
                        <th className="py-2 pr-3 text-right">Adeudado</th>
                        <th className="py-2 pr-3">Próx. vencimiento</th>
                        <th className="py-2 pr-3">Convenio</th>
                      </tr>
                    }
                    sinResultadosTexto="No se encontraron socios para esa búsqueda."
                  >
                    {cuotas.filas.map((f) => (
                      <tr key={f.socioId} className="border-b border-ink/5 last:border-0 hover:bg-ink/[0.02]">
                        <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">
                          <Link href={`/socios/${f.socioId}`} className="hover:underline underline-offset-2">{f.nombre}</Link>
                        </td>
                        <td className="py-2 pr-3 text-ink/60">{[f.viviendaNumero, f.nucleoNombre].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="py-2 pr-3 text-right">{f.cuotasPendientes || "—"}</td>
                        <td className={`py-2 pr-3 text-right ${f.cuotasVencidas > 0 ? "text-[var(--color-rojo)] font-semibold" : ""}`}>{f.cuotasVencidas || "—"}</td>
                        <td className="py-2 pr-3 text-right font-medium">{f.totalAdeudado > 0 ? money(f.totalAdeudado) : "—"}</td>
                        <td className="py-2 pr-3 text-ink/60">{f.proximoVencimiento ? dayjs(f.proximoVencimiento).format("DD/MM/YYYY") : "—"}</td>
                        <td className="py-2 pr-3">{f.convenio ? <Badge color="brand">{f.convenio.motivo}</Badge> : "—"}</td>
                      </tr>
                    ))}
                  </BuscadorFilas>
                </>
              ),
            },
            {
              id: "movimientos",
              label: "Movimientos",
              content: (
                <>
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
                          <tr><td colSpan={puedeEditar ? 6 : 5}><EmptyState>Sin movimientos registrados todavía.</EmptyState></td></tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                  <Pagination page={page} totalPages={totalPages} basePath="/finanzas" searchParams={sp} />
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
