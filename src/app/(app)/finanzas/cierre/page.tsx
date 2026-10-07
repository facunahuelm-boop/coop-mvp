import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { Card, PageHeader, Badge, SectionTitle, EmptyState } from "@/components/ui";
import {
  listarPeriodos,
  verificacionesDeCierre,
  resumenDePeriodo,
  textoPeriodo,
  money,
  puedeCerrarMes,
  ESTADO_PERIODO_LABEL,
  type EstadoPeriodo,
} from "@/lib/finanzasLibro";
import { hoyEnUruguay } from "@/lib/horasObra";
import { CerrarMesBoton, VisarMesBoton, ObservarMesForm, ReabrirMesForm } from "@/components/finanzas/LibroFormularios";

/**
 * Fase 2A — Cierre del mes. Tesorería cierra (el mes queda bloqueado en la
 * base) y la Comisión Fiscal le da el visto o lo devuelve con una
 * observación. Objetivo del plan: el cierre mensual tarda menos de 2 horas y
 * la Fiscal revisa el mes sin pedir planillas.
 */

const COLOR_ESTADO: Record<EstadoPeriodo, "amarillo" | "azul" | "verde"> = { abierto: "amarillo", cerrado: "azul", visado: "verde" };
const Mes = (p: string) => { const t = textoPeriodo(p); return t.charAt(0).toUpperCase() + t.slice(1); };
const fechaCorta = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

export default async function CierreDelMesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) redirect("/finanzas");

  const cierra = puedeCerrarMes(user.rol);
  const esFiscal = user.rol === "fiscal";
  const actual = hoyEnUruguay().slice(0, 7);
  const periodos = await listarPeriodos();
  // El mes para cerrar: el más viejo que sigue abierto (y ya terminó).
  const paraCerrar = [...periodos].reverse().find((p) => p.estado === "abierto" && p.periodo < actual && p.movimientos > 0) ?? null;
  const paraVisar = periodos.filter((p) => p.estado === "cerrado");
  const [verificaciones, resumen] = paraCerrar
    ? await Promise.all([verificacionesDeCierre(paraCerrar.periodo), resumenDePeriodo(paraCerrar.periodo)])
    : [[], null];
  const bloqueado = verificaciones.some((v) => v.bloquea);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Cierre del mes"
        subtitle="Tesorería cierra cada mes y la Comisión Fiscal le da el visto. Un mes cerrado ya no se puede cambiar."
        action={
          <Link href="/finanzas" className="inline-flex items-center rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken">
            ← Volver a Finanzas
          </Link>
        }
      />

      {esFiscal && (
        <div className="mb-5">
          <SectionTitle>Meses esperando tu visto</SectionTitle>
          <Card>
            {paraVisar.length === 0 ? (
              <EmptyState>No hay meses esperando tu visto.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {paraVisar.map((p) => (
                  <li key={p.periodo} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[15px]">
                    <span>
                      <b>{Mes(p.periodo)}</b>
                      <span className="block text-ink-muted">
                        Cerrado el {fechaCorta(p.cerrado_en)} por {p.cerrado_por ?? "—"} · Entró {money(p.ingresos)} · Salió {money(p.egresos)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <a href={`/api/reportes/cierre/${p.periodo}`} target="_blank" rel="noreferrer" className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">
                        📄 Ver el cierre (PDF)
                      </a>
                      <Link href={`/finanzas?desde=${p.periodo}-01&hasta=${p.periodo}-31&tab=movimientos`} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">
                        Ver los movimientos
                      </Link>
                      <ObservarMesForm periodo={p.periodo} texto={textoPeriodo(p.periodo)} />
                      <VisarMesBoton periodo={p.periodo} texto={textoPeriodo(p.periodo)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {paraCerrar && resumen && (
        <div className="mb-5">
          <SectionTitle>
            {Mes(paraCerrar.periodo)} está listo para cerrar
          </SectionTitle>
          <Card>
            {paraCerrar.observacion_fiscal && (
              <p className="mb-3 rounded-xl bg-[var(--color-amarillo-bg)] px-4 py-3 text-[15px] text-ink">
                <b>Observación de la Fiscal ({fechaCorta(paraCerrar.observado_en)}):</b> {paraCerrar.observacion_fiscal}
              </p>
            )}
            <h3 className="font-semibold text-ink">Antes de cerrar se revisó:</h3>
            <ul className="mt-2 space-y-1.5 text-[15px]">
              {verificaciones.map((v, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className={v.ok ? "text-[var(--color-verde)]" : v.bloquea ? "text-[var(--color-rojo)]" : "text-[var(--color-amarillo)]"}>
                    {v.ok ? "✔" : v.bloquea ? "✖" : "!"}
                  </span>
                  <span>{v.texto}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[15px]">
              <div className="rounded-xl bg-surface-sunken px-4 py-3">Entró<div className="text-lg font-bold">{money(resumen.ingresos)}</div></div>
              <div className="rounded-xl bg-surface-sunken px-4 py-3">Salió<div className="text-lg font-bold">{money(resumen.egresos)}</div></div>
              <div className="rounded-xl bg-surface-sunken px-4 py-3">Resultado del mes<div className={`text-lg font-bold ${resumen.ingresos - resumen.egresos < 0 ? "text-[var(--color-rojo)]" : ""}`}>{money(resumen.ingresos - resumen.egresos)}</div></div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="text-left text-sm text-ink-muted border-b border-border">
                    <th className="py-2 pr-3">Fondo</th><th className="pr-3 text-right">Al empezar</th><th className="pr-3 text-right">Entró</th><th className="pr-3 text-right">Salió</th><th className="pr-3 text-right">Al terminar</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.porFondo.map((x) => (
                    <tr key={x.nombre} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3">{x.nombre}</td>
                      <td className="pr-3 text-right">{money(x.inicial)}</td>
                      <td className="pr-3 text-right">{money(x.ingresos)}</td>
                      <td className="pr-3 text-right">{money(x.egresos)}</td>
                      <td className="pr-3 text-right font-semibold">{money(x.final)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a href={`/api/reportes/cierre/${paraCerrar.periodo}`} target="_blank" rel="noreferrer" className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">
                📄 Ver el borrador (PDF)
              </a>
              {cierra && !bloqueado && <CerrarMesBoton periodo={paraCerrar.periodo} texto={textoPeriodo(paraCerrar.periodo)} />}
              {cierra && bloqueado && <span className="text-[15px] text-[var(--color-rojo)]">Resolvé lo marcado con ✖ para poder cerrar.</span>}
              {!cierra && <span className="text-[15px] text-ink-muted">El mes lo cierra tesorería.</span>}
            </div>
          </Card>
        </div>
      )}

      {!paraCerrar && !esFiscal && (
        <Card className="mb-5">
          <p className="text-[15px] text-ink">✔ No hay meses para cerrar: los meses que ya terminaron están cerrados (o no tuvieron movimientos).</p>
        </Card>
      )}

      <SectionTitle>Todos los meses</SectionTitle>
      <Card>
        {periodos.length === 0 ? (
          <EmptyState>Todavía no hay movimientos.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="text-left text-sm text-ink-muted border-b border-border">
                  <th className="py-2 pr-3">Mes</th><th className="pr-3">Estado</th><th className="pr-3 text-right">Entró</th><th className="pr-3 text-right">Salió</th><th className="pr-3">Quién</th><th></th>
                </tr>
              </thead>
              <tbody>
                {periodos.map((p) => (
                  <tr key={p.periodo} className="border-b border-border/60 last:border-0 align-top">
                    <td className="py-2 pr-3 font-medium">{Mes(p.periodo)}</td>
                    <td className="py-2 pr-3">
                      <Badge color={COLOR_ESTADO[p.estado]}>{p.periodo === actual && p.estado === "abierto" ? "Mes en curso" : ESTADO_PERIODO_LABEL[p.estado]}</Badge>
                      {p.estado === "abierto" && p.observacion_fiscal && <div className="text-xs text-ink-muted mt-1">Devuelto por la Fiscal</div>}
                    </td>
                    <td className="py-2 pr-3 text-right">{money(p.ingresos)}</td>
                    <td className="py-2 pr-3 text-right">{money(p.egresos)}</td>
                    <td className="py-2 pr-3 text-sm text-ink-muted">
                      {p.cerrado_en && p.estado !== "abierto" && <div>Cerró {p.cerrado_por ?? "—"} el {fechaCorta(p.cerrado_en)}</div>}
                      {p.visado_en && p.estado === "visado" && <div>Visó {p.visado_por ?? "—"} el {fechaCorta(p.visado_en)}</div>}
                    </td>
                    <td className="py-2 text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        {p.movimientos > 0 && (
                          <a href={`/api/reportes/cierre/${p.periodo}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[var(--color-brand-800)] underline">
                            PDF
                          </a>
                        )}
                        {cierra && p.estado === "cerrado" && <ReabrirMesForm periodo={p.periodo} texto={textoPeriodo(p.periodo)} />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
