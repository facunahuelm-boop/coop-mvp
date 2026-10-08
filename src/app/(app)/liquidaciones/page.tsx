import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { canRead, canEdit, canApprove } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { hoyEnUruguay } from "@/lib/horasObra";
import { datosParaLiquidacion } from "@/lib/habitada";
import { crearLiquidacionFormAction, cambiarEstadoLiquidacionFormAction } from "@/lib/actions/habitada";

const pesos = (n: number) => `$ ${Number(n).toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;
const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");
const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-4 py-2.5 text-sm font-semibold text-white";
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";
const ESTADO: Record<string, { t: string; c: "gray" | "amarillo" | "verde" | "rojo" }> = {
  borrador: { t: "Borrador", c: "gray" },
  aprobada: { t: "Aprobada", c: "amarillo" },
  pagada: { t: "Pagada", c: "verde" },
  anulada: { t: "Anulada", c: "rojo" },
};

type Liq = { id: number; socio_id: number; socio: string; fecha: string; aportes: number; porcentaje_reintegro: number; deuda: number; otros_descuentos: number; detalle_descuentos: string | null; monto_final: number; forma_devolucion: string | null; estado: string };

/** Fase 3H — liquidación de egreso: cuando un socio se va, cuánto se le devuelve (o debe). */
export default async function LiquidacionesPage({ searchParams }: { searchParams: Promise<{ socio?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "finanzas")) redirect("/dashboard");
  const puede = canEdit(user.rol, "finanzas");
  const aprueba = canApprove(user.rol, "finanzas");
  const sp = await searchParams;
  const hoy = hoyEnUruguay();
  const [liqs, socios] = await Promise.all([
    all<Liq>(
      `SELECT l.id, l.socio_id, s.nombre AS socio, l.fecha, l.aportes, l.porcentaje_reintegro, l.deuda, l.otros_descuentos, l.detalle_descuentos, l.monto_final, l.forma_devolucion, l.estado
         FROM liquidaciones_egreso l JOIN socios s ON s.id = l.socio_id ORDER BY (l.estado = 'anulada'), l.fecha DESC, l.id DESC`
    ).catch(() => [] as Liq[]),
    puede ? all<{ id: number; nombre: string; estado: string }>(`SELECT id, nombre, estado FROM socios WHERE estado IN ('renunciante', 'activo', 'suspendido', 'egresado', 'baja') ORDER BY (estado = 'renunciante') DESC, nombre`).catch(() => []) : Promise.resolve([]),
  ]);
  const socioSel = Number(sp.socio) > 0 ? await get<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE id = ?`, [Number(sp.socio)]).catch(() => undefined) : undefined;
  const calculo = socioSel && puede ? await datosParaLiquidacion(socioSel.id) : null;

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Liquidaciones de egreso" subtitle="Cuando un socio se va: lo que aportó, lo que debe y lo que se le devuelve" />
      <Card>
        <p className="text-[15px] text-ink-muted">
          COOVA hace la cuenta con lo que tiene cargado; los valores se pueden corregir (por ejemplo, el porcentaje que el estatuto manda reintegrar). Lo aprueba el Consejo. No reemplaza el asesoramiento contable o legal.
        </p>
      </Card>

      {puede && (
        <Card>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[260px]">
              <Label>Nueva liquidación para</Label>
              <select name="socio" defaultValue={socioSel?.id ?? ""} className={inputClass}>
                <option value="">Elegí el socio…</option>
                {socios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                    {s.estado === "renunciante" ? " (renunciante)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">Calcular</button>
          </form>
          {socioSel && calculo && (
            <div className="mt-4 rounded-xl bg-surface-sunken p-4 text-[15px]">
              <p className="font-semibold text-ink">{socioSel.nombre}</p>
              <p>Pagó en total: {pesos(calculo.aportes)} · Debe hoy: {pesos(calculo.deuda)}</p>
              <div className="mt-3">
                <FormularioEnModal textoBoton="Armar la liquidación" claseBoton={botonPrincipal} titulo={`Liquidación de ${socioSel.nombre}`} action={crearLiquidacionFormAction} ocultos={{ socio_id: socioSel.id }} textoConfirmar="Guardar borrador">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <Label required>Fecha</Label>
                      <input name="fecha" type="date" required defaultValue={hoy} className={inputClass} />
                    </label>
                    <label className="block">
                      <Label required>Total aportado ($)</Label>
                      <input name="aportes" type="number" step="0.01" min={0} required defaultValue={calculo.aportes} className={inputClass} />
                    </label>
                    <label className="block">
                      <Label required>% que se reintegra</Label>
                      <input name="porcentaje_reintegro" type="number" step="0.1" min={0} max={100} required defaultValue={100} className={inputClass} />
                    </label>
                    <label className="block">
                      <Label required>Deuda a descontar ($)</Label>
                      <input name="deuda" type="number" step="0.01" min={0} required defaultValue={calculo.deuda} className={inputClass} />
                    </label>
                    <label className="block">
                      <Label>Otros descuentos ($)</Label>
                      <input name="otros_descuentos" type="number" step="0.01" min={0} className={inputClass} />
                    </label>
                    <label className="block">
                      <Label>¿Qué se descuenta?</Label>
                      <input name="detalle_descuentos" maxLength={1000} className={inputClass} placeholder="Reparaciones de la vivienda…" />
                    </label>
                  </div>
                  <label className="block">
                    <Label>Cómo se devuelve</Label>
                    <input name="forma_devolucion" maxLength={500} className={inputClass} placeholder="En 6 cuotas a partir del ingreso del nuevo socio" />
                  </label>
                  <label className="block">
                    <Label>Notas</Label>
                    <textarea name="notas" rows={2} maxLength={2000} className={inputClass} />
                  </label>
                </FormularioEnModal>
              </div>
            </div>
          )}
        </Card>
      )}

      <SectionTitle>Liquidaciones</SectionTitle>
      <div className="space-y-3">
        {liqs.map((l) => (
          <Card key={l.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-[15px]">
                <p className="font-semibold text-ink">
                  <Link href={`/socios/${l.socio_id}`} className="underline underline-offset-2">{l.socio}</Link> · {dmy(l.fecha)}
                </p>
                <p className="text-ink-muted">
                  Aportó {pesos(l.aportes)} × {Number(l.porcentaje_reintegro)} % − deuda {pesos(l.deuda)}
                  {Number(l.otros_descuentos) ? ` − otros ${pesos(l.otros_descuentos)}` : ""}
                </p>
                <p className="text-lg font-bold text-ink">{Number(l.monto_final) >= 0 ? `A devolver: ${pesos(l.monto_final)}` : `Debe: ${pesos(-l.monto_final)}`}</p>
                {l.forma_devolucion && <p className="text-sm text-ink-muted">{l.forma_devolucion}</p>}
                <a href={`/api/reportes/liquidacion/${l.id}`} target="_blank" rel="noopener" className="text-sm underline underline-offset-2">
                  Liquidación (PDF)
                </a>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge color={ESTADO[l.estado]?.c ?? "gray"}>{ESTADO[l.estado]?.t ?? l.estado}</Badge>
                {aprueba && l.estado === "borrador" && (
                  <FormularioEnModal textoBoton="Aprobar" claseBoton={botonLink} titulo="Aprobar la liquidación" action={cambiarEstadoLiquidacionFormAction} ocultos={{ id: l.id, estado: "aprobada" }} textoConfirmar="Aprobar" />
                )}
                {puede && l.estado === "aprobada" && (
                  <FormularioEnModal textoBoton="Marcar pagada" claseBoton={botonLink} titulo="Marcar como pagada" action={cambiarEstadoLiquidacionFormAction} ocultos={{ id: l.id, estado: "pagada" }} textoConfirmar="Marcar pagada" />
                )}
                {puede && (l.estado === "borrador" || l.estado === "aprobada") && (
                  <FormularioEnModal textoBoton="Anular" claseBoton="text-sm text-ink-muted underline underline-offset-2" titulo="Anular la liquidación" action={cambiarEstadoLiquidacionFormAction} ocultos={{ id: l.id, estado: "anulada" }} textoConfirmar="Anular" peligro>
                    <label className="block">
                      <Label required>Motivo</Label>
                      <input name="motivo" required maxLength={300} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                )}
              </div>
            </div>
          </Card>
        ))}
        {liqs.length === 0 && <EmptyState>Todavía no hay liquidaciones.</EmptyState>}
      </div>
    </div>
  );
}
