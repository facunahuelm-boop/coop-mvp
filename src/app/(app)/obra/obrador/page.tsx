import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { tareasObraConSemaforo } from "@/lib/logic";
import { cargarRubros, avanceFisico, origenFinanciero, gastoObra, planificadoAl, curvaAvance, textoMesCorto, ORIGEN_FINANCIERO_LABEL } from "@/lib/avanceObra";
import { hoyEnUruguay } from "@/lib/horasObra";
import { ImprimirBoton } from "@/components/obra/FicharBotones";

/**
 * Vista del obrador (Art. 5e): cronograma y flujo financiero para imprimir y
 * exhibir en la obra. Sólo lectura; el detalle se edita en Avance de obra.
 */

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-UY")}`;
const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "—");
const ESTADO: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const SEMAFORO: Record<string, string> = { verde: "En fecha", amarillo: "Atención", rojo: "Atrasada" };

export default async function ObradorPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "obra")) redirect("/dashboard");

  const hoy = hoyEnUruguay();
  const origen = await origenFinanciero();
  const [tareas, rubros] = await Promise.all([tareasObraConSemaforo().catch(() => []), cargarRubros()]);
  const presupuesto = rubros.reduce((a, r) => a + r.monto, 0);
  const gasto = presupuesto > 0 ? await gastoObra(origen) : 0;
  const [plan, curva] = await Promise.all([planificadoAl(hoy.slice(0, 7)), curvaAvance(presupuesto, origen).catch(() => [])]);
  const fisico = avanceFisico(rubros);

  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/obra" className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">← Obra</Link>
        <ImprimirBoton />
      </div>
      <h1 className="text-2xl font-bold text-ink">Obrador · Cronograma y flujo financiero</h1>
      <p className="mb-4 text-sm text-ink-muted">Actualizado al {dmy(hoy)}</p>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-bold text-ink">Cronograma</h2>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-border text-sm text-ink-muted"><th className="py-1.5 pr-3">Tarea</th><th className="pr-3">Responsable</th><th className="pr-3">Inicio</th><th className="pr-3">Fin previsto</th><th className="pr-3">Estado</th><th>Semáforo</th></tr>
          </thead>
          <tbody>
            {tareas.map((t: any) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-1.5 pr-3 font-medium">{t.nombre}</td>
                <td className="pr-3">{t.responsable_nombre ?? "—"}</td>
                <td className="pr-3">{dmy(t.fecha_inicio)}</td>
                <td className="pr-3">{dmy(t.fecha_fin_prevista)}</td>
                <td className="pr-3">{ESTADO[t.estado] ?? t.estado}</td>
                <td>{SEMAFORO[t.semaforo] ?? t.semaforo}</td>
              </tr>
            ))}
            {tareas.length === 0 && <tr><td colSpan={6} className="py-3 text-ink-muted">Todavía no hay tareas de obra cargadas.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-bold text-ink">Avance por rubro</h2>
        <table className="w-full text-left text-[15px]">
          <thead><tr className="border-b border-border text-sm text-ink-muted"><th className="py-1.5 pr-3">Rubro</th><th className="pr-3 text-right">Presupuesto</th><th className="text-right">Avance</th></tr></thead>
          <tbody>
            {rubros.map((r) => (
              <tr key={r.id} className="border-b border-border/60"><td className="py-1.5 pr-3">{r.nombre}</td><td className="pr-3 text-right">{pesos(r.monto)}</td><td className="text-right">{r.avance.toLocaleString("es-UY")} %</td></tr>
            ))}
            {rubros.length === 0 && <tr><td colSpan={3} className="py-3 text-ink-muted">Todavía no hay rubros cargados.</td></tr>}
          </tbody>
        </table>
        <p className="mt-2 text-[15px]">Avance físico: <b>{fisico.toLocaleString("es-UY")} %</b>{plan != null ? <> · planificado: <b>{plan.toLocaleString("es-UY")} %</b></> : null}</p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-bold text-ink">Flujo financiero</h2>
        <p className="text-[15px]">Presupuesto: <b>{pesos(presupuesto)}</b> · Gastado: <b>{pesos(gasto)}</b>{presupuesto > 0 ? <> ({(Math.round((gasto / presupuesto) * 1000) / 10).toLocaleString("es-UY")} %)</> : null}</p>
        <p className="mb-2 text-sm text-ink-muted">Se cuenta: {ORIGEN_FINANCIERO_LABEL[origen].toLowerCase()}.</p>
        {curva.length > 0 && (
          <table className="w-full text-left text-[15px]">
            <thead><tr className="border-b border-border text-sm text-ink-muted"><th className="py-1.5 pr-3">Mes</th><th className="pr-3 text-right">Planificado</th><th className="pr-3 text-right">Físico</th><th className="text-right">Financiero</th></tr></thead>
            <tbody>
              {curva.map((p) => (
                <tr key={p.mes} className="border-b border-border/60">
                  <td className="py-1.5 pr-3">{textoMesCorto(p.mes)}</td>
                  <td className="pr-3 text-right">{p.planificado != null ? `${p.planificado} %` : "—"}</td>
                  <td className="pr-3 text-right">{p.fisico} %</td>
                  <td className="text-right">{p.financiero != null ? `${p.financiero} %` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
