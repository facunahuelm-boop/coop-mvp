import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead, canEdit } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { CumplirCompromisoForm } from "@/components/finanzas/LibroFormularios";
import { opcionesLibro } from "@/lib/finanzasLibro";
import { hoyEnUruguay } from "@/lib/horasObra";
import { puedeEscribirDiario } from "@/lib/obraRecursos";
import {
  cargarRubros,
  avanceFisico,
  origenFinanciero,
  gastoObra,
  planificadoAl,
  cargarDesembolsos,
  datosPrestamo,
  desembolsosParaPedir,
  curvaAvance,
  textoMesCorto,
  ORIGEN_FINANCIERO_LABEL,
  type PuntoCurva,
} from "@/lib/avanceObra";
import {
  guardarRubroFormAction,
  desactivarRubroFormAction,
  registrarAvanceFormAction,
  anularAvanceFormAction,
  guardarPlanFormAction,
  configurarPrestamoFormAction,
  crearDesembolsoFormAction,
  marcarSolicitadoFormAction,
  anularDesembolsoFormAction,
} from "@/lib/actions/avanceObra";

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-UY")}`;
const pc = (n: number) => `${n.toLocaleString("es-UY", { maximumFractionDigits: 1 })} %`;
const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "—");
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";
const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90";

/** Curva en SVG: planificado (punteado), físico real y financiero, en % acumulado. */
function Curva({ puntos }: { puntos: PuntoCurva[] }) {
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const n = puntos.length;
  const x = (i: number) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - pad.t - pad.b);
  const linea = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
      .filter(Boolean)
      .join(" ");
  const series = [
    { nombre: "Planificado", vals: puntos.map((p) => p.planificado), color: "var(--color-ink-muted, #6b7280)", dash: "6 4" },
    { nombre: "Físico real", vals: puntos.map((p) => p.fisico), color: "var(--color-brand-800, #1e3a8a)", dash: undefined },
    { nombre: "Financiero", vals: puntos.map((p) => p.financiero), color: "var(--color-amarillo, #b45309)", dash: undefined },
  ];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Avance planificado, físico y financiero por mes">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.1} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.6}>
              {v}%
            </text>
          </g>
        ))}
        {puntos.map((p, i) => (
          <text key={p.mes} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor" opacity={0.6}>
            {n > 12 && i % 2 ? "" : textoMesCorto(p.mes)}
          </text>
        ))}
        {series.map((s) =>
          s.vals.some((v) => v != null) ? (
            <g key={s.nombre}>
              <polyline points={linea(s.vals)} fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dash} />
              {s.vals.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />))}
            </g>
          ) : null
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-sm">
        {series.map((s) => (
          <span key={s.nombre} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5" style={{ background: s.color }} /> {s.nombre}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Fase 3D — avance físico contra planificado y contra financiero, y los desembolsos del préstamo. */
export default async function AvanceObraPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "obra")) redirect("/dashboard");
  const puedeObra = await puedeEscribirDiario(user);
  const puedeFin = canEdit(user.rol, "finanzas");
  const hoy = hoyEnUruguay();
  const [rubros, origen, plan, desembolsos, prestamo, mediciones] = await Promise.all([
    cargarRubros(),
    origenFinanciero(),
    planificadoAl(hoy.slice(0, 7)),
    cargarDesembolsos(),
    datosPrestamo(),
    all<{ id: number; rubro: string; fecha: string; avance_pct: number; observaciones: string | null; autor: string | null }>(
      `SELECT a.id, r.nombre AS rubro, a.fecha, a.avance_pct, a.observaciones, u.nombre AS autor
         FROM obra_avances_rubro a JOIN obra_rubros r ON r.id = a.rubro_id LEFT JOIN users u ON u.id = a.registrado_por_id
        WHERE a.anulado_en IS NULL ORDER BY a.fecha DESC, a.id DESC LIMIT 15`
    ).catch(() => []),
  ]);
  const presupuesto = rubros.reduce((a, r) => a + r.monto, 0);
  const pesoTotal = Math.round(rubros.reduce((a, r) => a + r.peso_pct, 0) * 10) / 10;
  const fisico = avanceFisico(rubros);
  const gasto = presupuesto > 0 ? await gastoObra(origen) : 0;
  const financiero = presupuesto > 0 ? Math.round((gasto / presupuesto) * 1000) / 10 : null;
  const cobrado = desembolsos.filter((d) => d.estado === "cobrado").reduce((a, d) => a + Number(d.monto_cobrado ?? d.monto_previsto), 0);
  const previsto = desembolsos.reduce((a, d) => a + d.monto_previsto, 0);
  const totalPrestamo = prestamo.total || previsto;
  const paraPedir = desembolsosParaPedir(desembolsos, fisico);
  const curva = await curvaAvance(presupuesto, origen);
  const opciones = puedeFin ? await opcionesLibro() : null;
  const diferenciaPlan = plan != null ? Math.round((fisico - plan) * 10) / 10 : null;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Avance físico y financiero"
        subtitle="Cuánto se construyó, cuánto se gastó y qué desembolsos del préstamo corresponden"
        action={<Link href="/obra" className="text-sm font-semibold underline underline-offset-2">Volver a Obra</Link>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card>
          <p className="text-sm text-ink-muted">Avance físico</p>
          <p className="text-2xl font-bold text-ink">{rubros.length ? pc(fisico) : "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-muted">Planificado a este mes</p>
          <p className="text-2xl font-bold text-ink">{plan != null ? pc(plan) : "—"}</p>
          {diferenciaPlan != null && rubros.length > 0 && (
            <Badge color={diferenciaPlan >= -2 ? "verde" : diferenciaPlan >= -10 ? "amarillo" : "rojo"}>
              {diferenciaPlan >= 0 ? `${diferenciaPlan.toLocaleString("es-UY")} puntos adelantados` : `${(-diferenciaPlan).toLocaleString("es-UY")} puntos atrasados`}
            </Badge>
          )}
        </Card>
        <Card>
          <p className="text-sm text-ink-muted">Avance financiero (gastado)</p>
          <p className="text-2xl font-bold text-ink">{financiero != null ? pc(financiero) : "—"}</p>
          <p className="text-sm text-ink-muted">{presupuesto > 0 ? `${pesos(gasto)} de ${pesos(presupuesto)}` : "Falta el monto de los rubros"}</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-muted">Préstamo cobrado</p>
          <p className="text-2xl font-bold text-ink">{totalPrestamo > 0 ? pc(Math.round((cobrado / totalPrestamo) * 1000) / 10) : "—"}</p>
          <p className="text-sm text-ink-muted">{totalPrestamo > 0 ? `${pesos(cobrado)} de ${pesos(totalPrestamo)}` : "Sin desembolsos cargados"}</p>
        </Card>
      </div>

      {financiero != null && rubros.length > 0 && financiero - fisico > 10 && (
        <Card className="mb-5 !border-[var(--color-amarillo)]/40">
          <p className="text-[15px] text-ink">
            Ojo: se gastó bastante más ({pc(financiero)}) de lo que se construyó ({pc(fisico)}). Conviene revisarlo con el técnico y la tesorería.
          </p>
        </Card>
      )}
      {paraPedir.length > 0 && (
        <Card className="mb-5 !border-[var(--color-verde)]/40">
          <p className="text-[15px] text-ink">
            Con el avance de hoy ({pc(fisico)}) ya se {paraPedir.length === 1 ? "puede" : "pueden"} pedir: {paraPedir.map((d) => `el desembolso ${d.numero} (exige ${pc(d.avance_requerido_pct!)})`).join(", ")}.
          </p>
        </Card>
      )}

      <SectionTitle>Curva de avance</SectionTitle>
      <Card className="mb-6">
        {curva.length ? <Curva puntos={curva} /> : <EmptyState>Cuando se cargue el plan o la primera medición, acá se ve la curva mes a mes.</EmptyState>}
        {puedeObra && (
          <div className="mt-3">
            <FormularioEnModal textoBoton="Cargar el plan de un mes" claseBoton={botonLink} titulo="Avance planificado (acumulado)" action={guardarPlanFormAction}>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <Label required>Mes</Label>
                  <input name="mes" type="month" required defaultValue={hoy.slice(0, 7)} className={inputClass} />
                </label>
                <label className="block">
                  <Label required>Avance planificado (%)</Label>
                  <input name="avance_pct" type="number" step="0.1" min={0} max={100} required className={inputClass} />
                </label>
              </div>
            </FormularioEnModal>
          </div>
        )}
      </Card>

      <SectionTitle>{`Rubros (incidencia total ${pc(pesoTotal)})`}</SectionTitle>
      <Card className="mb-3 overflow-x-auto">
        {rubros.length ? (
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-ink-muted">
                <th className="py-1.5 pr-3">Rubro</th>
                <th className="py-1.5 pr-3">Incidencia</th>
                <th className="py-1.5 pr-3">Avance</th>
                <th className="py-1.5 pr-3">Aporta</th>
                <th className="py-1.5 pr-3">Monto</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rubros.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">
                    {r.nombre}
                    {r.ultima && <span className="block text-sm text-ink-muted">medido el {dmy(r.ultima)}</span>}
                  </td>
                  <td className="py-2 pr-3">{pc(r.peso_pct)}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 rounded-full bg-surface-sunken overflow-hidden">
                        <div className="h-full bg-[var(--color-brand-800)]" style={{ width: `${r.avance}%` }} />
                      </div>
                      {pc(r.avance)}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{pesoTotal > 0 ? pc(Math.round(((r.peso_pct * r.avance) / pesoTotal) * 10) / 10) : "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.monto ? pesos(r.monto) : "—"}</td>
                  <td className="py-2 whitespace-nowrap">
                    {puedeObra && (
                      <span className="flex gap-3">
                        <FormularioEnModal textoBoton="Medir" claseBoton={botonLink} titulo={`Avance de ${r.nombre}`} action={registrarAvanceFormAction} ocultos={{ rubro_id: r.id }}>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <Label required>Avance acumulado (%)</Label>
                              <input name="avance_pct" type="number" step="0.1" min={0} max={100} required defaultValue={r.avance} className={inputClass} />
                            </label>
                            <label className="block">
                              <Label required>Fecha</Label>
                              <input name="fecha" type="date" required max={hoy} defaultValue={hoy} className={inputClass} />
                            </label>
                          </div>
                          <label className="block">
                            <Label>Observaciones</Label>
                            <input name="observaciones" maxLength={500} className={inputClass} />
                          </label>
                        </FormularioEnModal>
                        <FormularioEnModal textoBoton="Editar" claseBoton="text-sm text-ink-muted underline underline-offset-2" titulo={`Editar ${r.nombre}`} action={guardarRubroFormAction} ocultos={{ id: r.id }}>
                          <CamposRubro rubro={r} />
                        </FormularioEnModal>
                        <FormularioEnModal
                          textoBoton="Sacar"
                          claseBoton="text-sm text-ink-muted underline underline-offset-2"
                          titulo={`Sacar ${r.nombre} del cálculo`}
                          descripcion="Deja de contar en el avance. Sus mediciones quedan en el historial."
                          action={desactivarRubroFormAction}
                          ocultos={{ id: r.id }}
                          textoConfirmar="Sacar"
                          peligro
                        />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState>Cargá los rubros de la obra con su incidencia (como en el presupuesto del técnico).</EmptyState>
        )}
      </Card>
      {puedeObra && (
        <div className="mb-6">
          <FormularioEnModal textoBoton="+ Agregar rubro" claseBoton={botonPrincipal} titulo="Nuevo rubro de la obra" action={guardarRubroFormAction}>
            <CamposRubro />
          </FormularioEnModal>
        </div>
      )}

      {mediciones.length > 0 && (
        <>
          <SectionTitle>Últimas mediciones</SectionTitle>
          <Card className="mb-6">
            <ul className="divide-y divide-border">
              {mediciones.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                  <span>
                    {dmy(m.fecha)} · {m.rubro} al {pc(Number(m.avance_pct))}
                    <span className="block text-sm text-ink-muted">{[m.observaciones, m.autor ? `midió ${m.autor}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  {puedeObra && (
                    <FormularioEnModal textoBoton="Anular" claseBoton="text-sm text-ink-muted underline underline-offset-2" titulo="Anular la medición" action={anularAvanceFormAction} ocultos={{ id: m.id }} textoConfirmar="Anular" peligro>
                      <label className="block">
                        <Label required>Motivo</Label>
                        <input name="motivo" required maxLength={300} className={inputClass} />
                      </label>
                    </FormularioEnModal>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <SectionTitle>{`Desembolsos del préstamo${prestamo.entidad ? ` (${prestamo.entidad})` : ""}`}</SectionTitle>
      <Card className="mb-3">
        <ul className="divide-y divide-border">
          {desembolsos.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
              <span>
                <span className="font-semibold">Desembolso {d.numero}</span>
                {d.descripcion && ` — ${d.descripcion}`} · {pesos(d.monto_previsto)}
                <span className="block text-sm text-ink-muted">
                  {d.avance_requerido_pct != null && `Exige ${pc(d.avance_requerido_pct)} de avance · `}
                  {d.estado === "cobrado"
                    ? `Cobrado el ${dmy(d.fecha_cobro)}${d.monto_cobrado != null && d.monto_cobrado !== d.monto_previsto ? ` (${pesos(d.monto_cobrado)})` : ""}`
                    : d.estado === "solicitado"
                      ? `Pedido el ${dmy(d.fecha_solicitud)}`
                      : `Previsto para el ${dmy(d.fecha_prevista)}`}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-3">
                <Badge color={d.estado === "cobrado" ? "verde" : d.estado === "solicitado" ? "amarillo" : "gray"}>
                  {d.estado === "cobrado" ? "Cobrado" : d.estado === "solicitado" ? "Pedido" : "Previsto"}
                </Badge>
                {puedeFin && d.estado === "previsto" && (
                  <FormularioEnModal textoBoton="Lo pedimos" claseBoton={botonLink} titulo={`Desembolso ${d.numero}: se pidió`} action={marcarSolicitadoFormAction} ocultos={{ id: d.id }}>
                    <label className="block">
                      <Label required>Fecha del pedido</Label>
                      <input name="fecha" type="date" required max={hoy} defaultValue={hoy} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                )}
                {puedeFin && opciones && d.estado !== "cobrado" && d.compromiso_id && d.compromiso_estado === "pendiente" && (
                  <CumplirCompromisoForm compromiso={{ id: d.compromiso_id, descripcion: `Desembolso ${d.numero} del préstamo`, monto: d.monto_previsto, tipo: "ingreso" }} opciones={opciones} />
                )}
                {puedeFin && d.estado !== "cobrado" && (
                  <FormularioEnModal textoBoton="Anular" claseBoton="text-sm text-ink-muted underline underline-offset-2" titulo={`Anular el desembolso ${d.numero}`} action={anularDesembolsoFormAction} ocultos={{ id: d.id }} textoConfirmar="Anular" peligro>
                    <label className="block">
                      <Label required>Motivo</Label>
                      <input name="motivo" required maxLength={300} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                )}
              </span>
            </li>
          ))}
          {desembolsos.length === 0 && <EmptyState>Todavía no se cargaron desembolsos.</EmptyState>}
        </ul>
      </Card>
      {puedeFin && (
        <div className="mb-6 flex flex-wrap gap-3">
          <FormularioEnModal textoBoton="+ Cargar desembolso" claseBoton={botonPrincipal} titulo="Nuevo desembolso previsto" action={crearDesembolsoFormAction}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <Label required>Monto previsto ($)</Label>
                <input name="monto_previsto" type="number" step="0.01" min={0.01} required className={inputClass} />
              </label>
              <label className="block">
                <Label required>Fecha prevista</Label>
                <input name="fecha_prevista" type="date" required className={inputClass} />
              </label>
              <label className="block">
                <Label>Avance que exige (%)</Label>
                <input name="avance_requerido_pct" type="number" step="0.1" min={0} max={100} className={inputClass} />
              </label>
              <label className="block">
                <Label>Descripción</Label>
                <input name="descripcion" maxLength={200} className={inputClass} placeholder="Ej.: certificado de mayo" />
              </label>
            </div>
          </FormularioEnModal>
          <FormularioEnModal textoBoton="Datos del préstamo" claseBoton={botonLink} titulo="Préstamo y avance financiero" action={configurarPrestamoFormAction}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <Label>Entidad</Label>
                <input name="prestamo_entidad" maxLength={120} defaultValue={prestamo.entidad} className={inputClass} placeholder="MVOT, ANV…" />
              </label>
              <label className="block">
                <Label>Monto total del préstamo ($)</Label>
                <input name="prestamo_monto_total" type="number" step="0.01" min={0} defaultValue={prestamo.total || ""} className={inputClass} />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Qué gastos cuentan para el avance financiero?</legend>
              {(Object.keys(ORIGEN_FINANCIERO_LABEL) as (keyof typeof ORIGEN_FINANCIERO_LABEL)[]).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="radio" name="avance_financiero_origen" value={k} defaultChecked={origen === k} /> {ORIGEN_FINANCIERO_LABEL[k]}
                </label>
              ))}
            </fieldset>
          </FormularioEnModal>
        </div>
      )}
      <p className="text-sm text-ink-muted">El avance financiero cuenta: {ORIGEN_FINANCIERO_LABEL[origen].toLowerCase()}.</p>
    </div>
  );
}

function CamposRubro({ rubro }: { rubro?: { nombre: string; peso_pct: number; monto: number; orden: number } }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block sm:col-span-2">
        <Label required>Nombre</Label>
        <input name="nombre" required maxLength={120} defaultValue={rubro?.nombre} className={inputClass} placeholder="Ej.: Estructura de hormigón" />
      </label>
      <label className="block">
        <Label required>Incidencia (% del total)</Label>
        <input name="peso_pct" type="number" step="0.01" min={0} max={100} required defaultValue={rubro?.peso_pct} className={inputClass} />
      </label>
      <label className="block">
        <Label>Monto en el presupuesto ($)</Label>
        <input name="monto" type="number" step="0.01" min={0} defaultValue={rubro?.monto || ""} className={inputClass} />
      </label>
      <label className="block">
        <Label>Orden</Label>
        <input name="orden" type="number" min={0} max={999} defaultValue={rubro?.orden ?? ""} className={inputClass} />
      </label>
    </div>
  );
}
