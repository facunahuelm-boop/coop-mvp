import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canApprove, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { Card, PageHeader, Badge, SectionTitle, EmptyState, Label, inputClass } from "@/components/ui";
import { obtenerCuentas, obtenerFondos, saldosPor, opcionesLibro, money, TIPO_FONDO_LABEL } from "@/lib/finanzasLibro";
import { hoyEnUruguay } from "@/lib/horasObra";
import { CuentaForm, FondoForm, TransferirForm, MapeoContableFila } from "@/components/finanzas/LibroFormularios";

/**
 * Fase 2A — Cuentas (dónde está la plata) y fondos (para qué es), pases entre
 * ellos y la planilla para el contador con su plan de cuentas simple.
 */
export default async function CuentasYFondosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) redirect("/finanzas");
  const configura = canApprove(user.rol, "finanzas");
  const registra = canEdit(user.rol, "finanzas");

  const [cuentas, fondos, sCuentas, sFondos, opciones, comisiones, rubros, mapeo] = await Promise.all([
    obtenerCuentas(true),
    obtenerFondos(true),
    saldosPor("cuenta"),
    saldosPor("fondo"),
    opcionesLibro(),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones ORDER BY nombre`).catch(() => []),
    all<{ categoria: string }>(
      `SELECT DISTINCT categoria FROM movimientos_financieros WHERE categoria IS NOT NULL AND categoria <> '' AND transferencia_id IS NULL ORDER BY categoria`
    ).catch(() => []),
    all<{ categoria: string; codigo: string | null; nombre_contable: string | null }>(`SELECT categoria, codigo, nombre_contable FROM mapeo_contable`).catch(() => []),
  ]);
  const saldoDe = (lista: { id: number; saldo: number }[], id: number) => lista.find((x) => x.id === id)?.saldo ?? 0;
  const mapa = new Map(mapeo.map((m) => [m.categoria, m]));
  const hoy = hoyEnUruguay();

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Cuentas y fondos"
        subtitle="Dónde está la plata (banco o caja) y para qué está separada (obra, reserva, mantenimiento…)."
        action={
          <Link href="/finanzas" className="inline-flex items-center rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken">
            ← Volver a Finanzas
          </Link>
        }
      />

      {cuentas.length === 0 ? (
        <Card>
          <EmptyState>Falta aplicar una actualización de la base de datos para usar cuentas y fondos.</EmptyState>
        </Card>
      ) : (
        <>
          {registra && (
            <div className="mb-5">
              <TransferirForm opciones={opciones} />
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div>
              <SectionTitle action={configura ? <CuentaForm /> : undefined}>Cuentas</SectionTitle>
              <Card>
                <ul className="divide-y divide-border text-[15px]">
                  {cuentas.map((c) => (
                    <li key={c.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${c.activa ? "" : "opacity-60"}`}>
                      <span>
                        <b className="text-ink">{c.nombre}</b>{" "}
                        {c.predeterminada ? <Badge color="brand">Principal</Badge> : null} {c.para_efectivo ? <Badge color="verde">Cobros en efectivo</Badge> : null}{" "}
                        {!c.activa && <Badge color="gray">Dada de baja</Badge>}
                        <span className="block text-sm text-ink-muted">
                          {c.tipo === "banco" ? `Banco${c.banco ? ` ${c.banco}` : ""}` : "Caja en efectivo"}
                          {c.referencia ? ` · ${c.referencia}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <b>{money(saldoDe(sCuentas, c.id))}</b>
                        {configura && <CuentaForm cuenta={c} />}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <div>
              <SectionTitle action={configura ? <FondoForm comisiones={comisiones} /> : undefined}>Fondos</SectionTitle>
              <Card>
                <ul className="divide-y divide-border text-[15px]">
                  {fondos.map((f) => (
                    <li key={f.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${f.activo ? "" : "opacity-60"}`}>
                      <span>
                        <b className="text-ink">{f.nombre}</b> {f.predeterminado ? <Badge color="brand">Principal</Badge> : null}{" "}
                        {f.recibe_cuotas ? <Badge color="verde">Recibe las cuotas</Badge> : null} {!f.activo && <Badge color="gray">Dado de baja</Badge>}
                        <span className="block text-sm text-ink-muted">
                          {TIPO_FONDO_LABEL[f.tipo] ?? f.tipo}
                          {f.descripcion ? ` · ${f.descripcion}` : ""}
                          {f.tope ? ` · tope ${money(f.tope)}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <b>{money(saldoDe(sFondos, f.id))}</b>
                        {configura && <FondoForm fondo={f} comisiones={comisiones} />}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          <SectionTitle>Planilla para el contador</SectionTitle>
          <Card className="mb-4">
            <p className="text-[15px] text-ink-muted mb-3">
              Un Excel con todos los movimientos del período, el resumen por rubro, los saldos y el estado de los cierres. Abajo podés indicar cómo se llama cada rubro en el plan de cuentas del contador.
            </p>
            <form method="GET" action="/api/exportar/contador" className="flex flex-wrap items-end gap-3">
              <label>
                <Label>Desde</Label>
                <input type="date" name="desde" defaultValue={`${hoy.slice(0, 4)}-01-01`} className={inputClass} />
              </label>
              <label>
                <Label>Hasta</Label>
                <input type="date" name="hasta" defaultValue={hoy} className={inputClass} />
              </label>
              <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 text-sm font-semibold">📊 Descargar Excel</button>
            </form>
          </Card>
          {configura && rubros.length > 0 && (
            <Card>
              <h3 className="font-semibold text-ink mb-1">Plan de cuentas (opcional)</h3>
              <p className="text-[15px] text-ink-muted mb-2">Código y nombre de la cuenta contable para cada rubro. Si lo dejás vacío, la planilla sale igual.</p>
              {rubros.map((r) => (
                <MapeoContableFila key={r.categoria} categoria={r.categoria} codigo={mapa.get(r.categoria)?.codigo ?? null} nombre={mapa.get(r.categoria)?.nombre_contable ?? null} />
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
