import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { all } from "@/lib/db";
import { resumenFinanciero } from "@/lib/logic";
import { Card, PageHeader, StatTile, EmptyState, Label, inputClass, SectionTitle } from "@/components/ui";
import dayjs from "dayjs";
import { registrarMovimientoAction, agregarCompromisoAction } from "@/lib/actions/finanzas";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
const CATEGORY_COLORS = ["#1F4E5F", "#3A7A8C", "#7FA8B3", "#A15C00", "#B3261E", "#5B7553"];

export default async function FinanzasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "finanzas")) redirect("/dashboard");

  const detalle = ROLES_FINANZAS_DETALLE.includes(user.rol);
  const puedeEditar = canEdit(user.rol, "finanzas");
  const [fin, movimientos, compromisos] = await Promise.all([
    resumenFinanciero(),
    all<any>(`SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m LEFT JOIN users u ON u.id = m.registrado_por_id ORDER BY fecha DESC LIMIT 15`),
    all<any>(`SELECT * FROM compromisos_futuros ORDER BY fecha_estimada ASC`),
  ]);
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f4e5f] text-white hover:bg-[#123240] px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap"
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

          <Card className="mb-6 text-xs text-black/60">
            Saldo actual ({money(fin.saldo)}) menos pagos y compromisos ya asumidos ({money(fin.comprometido)}) = disponible prudencial. Esto no es lo mismo que el saldo bancario: es lo que queda después de descontar lo comprometido.
          </Card>

          <SectionTitle>Gasto por categoría</SectionTitle>
          <Card className="mb-6">
            <div className="space-y-2">
              {fin.porCategoria.map((c: any, i: number) => (
                <div key={c.categoria} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 text-black/60 truncate">{c.categoria}</span>
                  <div className="flex-1 h-3 rounded-full bg-black/5 overflow-hidden">
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
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/10"><th className="py-2">Categoría</th><th>Presupuestado</th><th>Gastado</th><th>Desvío</th></tr></thead>
              <tbody>
                {fin.presupuestoVsReal.map((p: any) => {
                  const desv = p.monto_presupuestado > 0 ? (p.gastado - p.monto_presupuestado) / p.monto_presupuestado : 0;
                  return (
                    <tr key={p.categoria} className="border-b border-black/5 last:border-0">
                      <td className="py-2">{p.categoria}</td>
                      <td>{money(p.monto_presupuestado)}</td>
                      <td>{money(p.gastado)}</td>
                      <td className={desv > 0.15 ? "text-[var(--color-rojo)] font-semibold" : "text-black/60"}>{Math.round(desv * 100)}%</td>
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
                <div><p className="font-medium">{c.descripcion}</p><p className="text-xs text-black/50">{c.origen} · {dayjs(c.fecha_estimada).format("DD/MM/YYYY")}</p></div>
                <p className="font-bold">{money(c.monto)}</p>
              </Card>
            ))}
            {compromisos.length === 0 && <EmptyState>Sin compromisos futuros cargados.</EmptyState>}
          </div>
          {puedeEditar && (
            <details className="mb-8"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Agregar compromiso futuro</summary>
              <Card className="mt-3">
                <form action={agregarCompromisoAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2"><Label>Descripción</Label><input name="descripcion" required className={inputClass} /></div>
                  <div><Label>Monto</Label><input name="monto" type="number" required className={inputClass} /></div>
                  <div><Label>Fecha estimada</Label><input type="date" name="fecha_estimada" required className={inputClass} /></div>
                  <div><Label>Origen</Label><input name="origen" className={inputClass} /></div>
                  <div className="sm:col-span-3"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Guardar</button></div>
                </form>
              </Card>
            </details>
          )}

          <SectionTitle>Movimientos recientes</SectionTitle>
          <Card>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/10"><th className="py-2">Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th className="text-right">Monto</th></tr></thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} className="border-b border-black/5 last:border-0">
                    <td className="py-2">{dayjs(m.fecha).format("DD/MM")}</td>
                    <td>{m.tipo === "ingreso" ? "🟢 ingreso" : "🔴 egreso"}</td>
                    <td>{m.categoria}</td>
                    <td className="text-black/60">{m.descripcion}</td>
                    <td className="text-right font-medium">{money(m.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {puedeEditar && (
            <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Registrar movimiento</summary>
              <Card className="mt-3">
                <form action={registrarMovimientoAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Tipo</Label>
                    <select name="tipo" className={inputClass} defaultValue="egreso"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select>
                  </div>
                  <div><Label>Monto</Label><input name="monto" type="number" required className={inputClass} /></div>
                  <div><Label>Categoría</Label><input name="categoria" required className={inputClass} placeholder="Estructura, Administración…" /></div>
                  <div><Label>Descripción</Label><input name="descripcion" className={inputClass} /></div>
                  <div className="sm:col-span-2"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Registrar</button></div>
                </form>
              </Card>
            </details>
          )}
        </>
      )}
    </div>
  );
}
