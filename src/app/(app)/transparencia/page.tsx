import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { resumenFinanciero, cuentasPorCobrar } from "@/lib/logic";
import { canRead, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { Card, PageHeader, StatTile, EmptyState } from "@/components/ui";
import dayjs from "dayjs";

// Fase 2 ("Transparencia, Auditoría, Historial, Cumplimiento", sección 37 del
// prompt) — Sub-fase 2.1: Centro de Transparencia (sección 10).
//
// Decisión de diseño, confirmada con el usuario: a diferencia de /finanzas y
// /compras (que dependen de canRead("finanzas"/"compras") y hoy no los ve,
// por ejemplo, comisión de obra/trabajo/seguridad ni técnico), esta pantalla
// es "transparencia básica" — la ve CUALQUIER usuario autenticado, sin
// depender de ningún módulo puntual (mismo criterio sin `mod` que ya usan
// /gastos, /contactos, /mi-trabajo en Nav.tsx). No amplía ni reemplaza el
// acceso a Finanzas/Compras completos, que siguen exactamente igual de
// restringidos que antes.
//
// Guardrail no negociable: acá NUNCA se muestra información individual de
// socios (nombres, viviendas, quién debe cuánto) — solo agregados de toda la
// cooperativa. cuentasPorCobrar() devuelve `filas` con nombre por socio;
// esta pantalla usa a propósito solo `totalACobrar` y descarta `filas`.
// El detalle con nombres sigue viviendo donde ya vivía (Finanzas/Socios),
// con los mismos permisos de siempre.
//
// "Niveles" de la sección 10 (pública/socios/órganos/restringida): no se
// crea un sistema de permisos nuevo y paralelo al que ya existe — se mapea
// sobre el que ya hay: esta pantalla = "para socios" (agregado, todos);
// /finanzas y /compras completos = "para órganos" (canRead finanzas/compras,
// como ya era); /configuracion y /auditoria = "restringida" (ya lo eran).
export default async function TransparenciaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const desdeMes = dayjs().startOf("month").format("YYYY-MM-DD");
  const hastaMes = dayjs().endOf("month").format("YYYY-MM-DD");

  const [fin, cobros, gastoComprasPorCategoria, comprasPorEstado] = await Promise.all([
    resumenFinanciero(),
    cuentasPorCobrar(),
    all<{ categoria: string; total: string }>(
      `SELECT sc.categoria, COALESCE(SUM(dc.monto), 0) as total
       FROM decisiones_compra dc
       JOIN solicitudes_compra sc ON sc.id = dc.solicitud_id
       WHERE dc.fecha >= ? AND dc.fecha <= ?
       GROUP BY sc.categoria
       ORDER BY total DESC`,
      [desdeMes, hastaMes]
    ).catch(() => []),
    all<{ estado: string; cantidad: string }>(
      `SELECT estado, COUNT(*) as cantidad FROM solicitudes_compra GROUP BY estado`
    ).catch(() => []),
  ]);

  const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
  const cantidadPorEstado = (estados: string[]) =>
    comprasPorEstado.filter((r) => estados.includes(r.estado)).reduce((acc, r) => acc + Number(r.cantidad || 0), 0);
  const gastoComprasMes = gastoComprasPorCategoria.reduce((acc, r) => acc + Number(r.total || 0), 0);

  const detalleFinanzas = canRead(user.rol, "finanzas") && ROLES_FINANZAS_DETALLE.includes(user.rol);
  const detalleCompras = canRead(user.rol, "compras");

  return (
    <div>
      <PageHeader
        title="Transparencia"
        subtitle="Resumen agregado de toda la cooperativa — información general, sin datos individuales de socios"
      />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          🔎 Esta pantalla muestra totales de toda la cooperativa (nunca nombres ni datos de un socio en particular). Quien
          tiene permiso para ver el detalle completo puede hacerlo en Finanzas y Compras.
        </p>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Finanzas del mes</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile label="Ingresos del mes" value={money(fin.ingresosMes)} color="verde" />
        <StatTile label="Egresos del mes" value={money(fin.egresosMes)} color="amarillo" />
        <StatTile label="Saldo acumulado" value={money(fin.saldo)} />
        <StatTile
          label="Disponible prudencial"
          value={money(fin.disponiblePrudencial)}
          color={fin.disponiblePrudencial < 0 ? "rojo" : "verde"}
        />
      </div>
      {detalleFinanzas && (
        <p className="text-xs text-ink/40 -mt-4 mb-6">
          <Link href="/finanzas" className="underline underline-offset-2">Ver el detalle completo en Finanzas →</Link>
        </p>
      )}

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Compras</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <StatTile label="Pendientes de cotizar" value={String(cantidadPorEstado(["pendiente_cotizacion"]))} />
        <StatTile label="En comparación" value={String(cantidadPorEstado(["en_comparacion"]))} />
        <StatTile label="Aprobadas / en curso" value={String(cantidadPorEstado(["aprobada", "pedida"]))} />
        <StatTile label="Entregadas" value={String(cantidadPorEstado(["entregada"]))} />
      </div>
      <Card className="mb-6">
        <p className="text-xs text-ink/50 mb-2">Gasto en compras este mes: <strong className="text-ink">{money(gastoComprasMes)}</strong></p>
        {gastoComprasPorCategoria.length === 0 ? (
          <EmptyState>Sin compras decididas este mes.</EmptyState>
        ) : (
          <div className="space-y-1">
            {gastoComprasPorCategoria.map((c) => (
              <div key={c.categoria} className="flex items-center justify-between text-xs">
                <span className="text-ink/70">{c.categoria}</span>
                <span className="font-mono text-ink">{money(Number(c.total))}</span>
              </div>
            ))}
          </div>
        )}
        {detalleCompras && (
          <p className="text-xs text-ink/40 mt-2">
            <Link href="/compras" className="underline underline-offset-2">Ver el detalle completo en Compras →</Link>
          </p>
        )}
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Presupuesto vs. ejecución</h3>
      <Card className="mb-6">
        {fin.presupuestoVsReal.length === 0 ? (
          <EmptyState>Todavía no se cargó un presupuesto general.</EmptyState>
        ) : (
          <div className="space-y-1.5">
            {fin.presupuestoVsReal.map((p: { categoria: string; monto_presupuestado: number; gastado: number }) => {
              const pct = p.monto_presupuestado > 0 ? Math.round((Number(p.gastado) / Number(p.monto_presupuestado)) * 100) : 0;
              return (
                <div key={p.categoria} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-ink/70">{p.categoria}</span>
                    <span className="font-mono text-ink">{money(Number(p.gastado))} / {money(Number(p.monto_presupuestado))} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink/5 mt-1 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct > 100 ? "bg-[var(--color-rojo)]" : "bg-[var(--color-brand-700)]"}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Cobros</h3>
      <Card>
        <p className="text-xs text-ink/70">
          Total pendiente de cobro a socios (agregado de toda la cooperativa, sin identificar a nadie en particular):{" "}
          <strong className="text-ink">{money(cobros.totalACobrar)}</strong>
        </p>
      </Card>
    </div>
  );
}
