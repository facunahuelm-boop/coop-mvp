import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { resumenFinanciero, cuentasPorCobrar } from "@/lib/logic";
import { Card, PageHeader, StatTile, EmptyState, Label, inputClass, SectionTitle } from "@/components/ui";
import Link from "next/link";
import dayjs from "dayjs";
import { registrarMovimientoAction, agregarCompromisoAction } from "@/lib/actions/finanzas";
import { Pagination, paginaDe } from "@/components/Pagination";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
const CATEGORY_COLORS = ["#1F4E5F", "#3A7A8C", "#7FA8B3", "#A15C00", "#B3261E", "#5B7553"];
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
  const [fin, totalMovimientosRow, movimientos, compromisos, cobrar] = await Promise.all([
    resumenFinanciero(),
    get<{ total: string }>(`SELECT COUNT(*) as total FROM movimientos_financieros`),
    all<any>(
      `SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m LEFT JOIN users u ON u.id = m.registrado_por_id ORDER BY fecha DESC LIMIT ? OFFSET ?`,
      [POR_PAGINA, (page - 1) * POR_PAGINA]
    ),
    all<any>(`SELECT * FROM compromisos_futuros ORDER BY fecha_estimada ASC`),
    cuentasPorCobrar(),
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
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatTile label="Ingresos totales" value={money(fin.ingresos)} />
            <StatTile label="Egresos totales" value={money(fin.egresos)} />
            <StatTile label="Comprometido" value={money(fin.comprometido)} />
            <StatTile label="Disponible prudencial" value={money(fin.disponiblePrudencial)} color={fin.disponiblePrudencial < 0 ? "rojo" : fin.disponiblePrudencial < fin.gastosProyectados ? "amarillo" : "verde"} />
          </div>

          <Card className="mb-6 text-xs text-ink/60">
            Saldo actual ({money(fin.saldo)}) menos pagos y compromisos ya asumidos ({money(fin.comprometido)}) = disponible prudencial. Esto no es lo mismo que el saldo bancario: es lo que queda después de descontar lo comprometido.
          </Card>

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
          <div className="space-y-2 mb-4">
            {compromisos.map((c) => (
              <Card key={c.id} className="flex items-center justify-between text-sm">
                <div><p className="font-medium">{c.descripcion}</p><p className="text-xs text-ink/50">{c.origen} · {dayjs(c.fecha_estimada).format("DD/MM/YYYY")}</p></div>
                <p className="font-bold">{money(c.monto)}</p>
              </Card>
            ))}
            {compromisos.length === 0 && <EmptyState>Sin compromisos futuros cargados.</EmptyState>}
          </div>
          {puedeEditar && (
            <details className="mb-8"><summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Agregar compromiso futuro</summary>
              <Card className="mt-3">
                <form action={agregarCompromisoAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2"><Label>Descripción</Label><input name="descripcion" required className={inputClass} /></div>
                  <div><Label>Monto</Label><input name="monto" type="number" required className={inputClass} /></div>
                  <div><Label>Fecha estimada</Label><input type="date" name="fecha_estimada" required className={inputClass} /></div>
                  <div><Label>Origen</Label><input name="origen" className={inputClass} /></div>
                  <div className="sm:col-span-3"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Guardar</button></div>
                </form>
              </Card>
            </details>
          )}

          <SectionTitle action={cobrar.filas.length > 0 ? <span className="text-sm font-bold text-[var(--color-brand-900)]">{money(cobrar.totalACobrar)}</span> : undefined}>
            Cuentas por cobrar a socios
          </SectionTitle>
          <Card className="mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                    <th className="py-2 pr-3">Socio</th>
                    <th className="py-2 pr-3">Vivienda</th>
                    <th className="py-2 pr-3 text-right">Debe</th>
                  </tr>
                </thead>
                <tbody>
                  {cobrar.filas.map((f) => (
                    <tr key={f.socio_id} className="border-b border-ink/5 last:border-0">
                      <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">
                        <Link href={`/socios/${f.socio_id}`} className="hover:underline underline-offset-2">{f.nombre}</Link>
                      </td>
                      <td className="py-2 pr-3 text-ink/60">{f.vivienda_numero || "—"}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-[var(--color-rojo)]">{money(f.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cobrar.filas.length === 0 && <EmptyState>Ningún socio tiene saldo pendiente registrado.</EmptyState>}
            </div>
          </Card>

          <SectionTitle>Movimientos</SectionTitle>
          <Card>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink/50 border-b border-ink/10"><th className="py-2">Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th className="text-right">Monto</th></tr></thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} className="border-b border-ink/5 last:border-0">
                    <td className="py-2">{dayjs(m.fecha).format("DD/MM")}</td>
                    <td>{m.tipo === "ingreso" ? "🟢 ingreso" : "🔴 egreso"}</td>
                    <td>{m.categoria}</td>
                    <td className="text-ink/60">{m.descripcion}</td>
                    <td className="text-right font-medium">{money(m.monto)}</td>
                  </tr>
                ))}
                {movimientos.length === 0 && (
                  <tr><td colSpan={5}><EmptyState>Sin movimientos registrados todavía.</EmptyState></td></tr>
                )}
              </tbody>
            </table>
          </Card>
          <Pagination page={page} totalPages={totalPages} basePath="/finanzas" searchParams={sp} />
          {puedeEditar && (
            <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Registrar movimiento</summary>
              <Card className="mt-3">
                <form action={registrarMovimientoAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Tipo</Label>
                    <select name="tipo" className={inputClass} defaultValue="egreso"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select>
                  </div>
                  <div><Label>Monto</Label><input name="monto" type="number" required className={inputClass} /></div>
                  <div><Label>Categoría</Label><input name="categoria" required className={inputClass} placeholder="Estructura, Administración…" /></div>
                  <div><Label>Descripción</Label><input name="descripcion" className={inputClass} /></div>
                  <div className="sm:col-span-2"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Registrar</button></div>
                </form>
              </Card>
            </details>
          )}
        </>
      )}
    </div>
  );
}
