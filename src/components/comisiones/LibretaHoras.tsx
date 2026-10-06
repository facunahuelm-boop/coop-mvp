"use client";

// Fase 1B — Libreta de horas de cada núcleo: lo que hizo esta semana, su
// saldo acumulado (semanas cerradas) y el historial semana por semana. Un
// solo número oficial por núcleo. Desde acá la comisión registra licencias y
// cierra (o reabre) semanas.

import { useState } from "react";
import Link from "next/link";
import { Badge, Label, inputClass, EmptyState, Card } from "@/components/ui";
import { Modal } from "@/components/ui-client";
import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import { cerrarSemanaFormAction, reabrirSemanaFormAction, registrarLicenciaFormAction, anularLicenciaFormAction } from "@/lib/actions/asistenciaHoras";
import { textoHoras, textoSemana, textoSaldo } from "@/lib/horasObra";
import type { SemanaLibreta } from "@/lib/libretaHoras";

export type FilaLibreta = {
  nucleoId: number;
  nombre: string;
  objetivoHoras: number;
  estaSemana: { realMin: number; exigibleMin: number; faltanMin: number; justificadoMin: number; licenciaMin: number } | null;
  saldoAcumuladoMin: number;
  horasAnteriores: number;
  semanas: SemanaLibreta[];
  licencias: { id: number; desde: string; hasta: string; motivo: string }[];
};


const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function LibretaHoras({
  comisionId,
  filas,
  semanasPendientes,
  ultimasCerradas,
  puedeGestionar,
  hrefRegistroAnterior,
}: {
  comisionId: number;
  filas: FilaLibreta[];
  semanasPendientes: string[];
  ultimasCerradas: { lunes: string; cerradoPor: string }[];
  puedeGestionar: boolean;
  hrefRegistroAnterior: string | null;
}) {
  // Se guarda el id (no la fila) para que, al registrar una licencia, el
  // pop-up muestre los datos ya actualizados por el servidor.
  const [abiertoId, setAbiertoId] = useState<number | null>(null);
  const abierto = filas.find((f) => f.nucleoId === abiertoId) ?? null;
  const conDeuda = filas.filter((f) => f.saldoAcumuladoMin < 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-ink-muted">Núcleos</p>
          <p className="text-2xl font-bold text-ink">{filas.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-ink-muted">Con deuda de horas</p>
          <p className={`text-2xl font-bold ${conDeuda ? "text-[var(--color-rojo)]" : "text-ink"}`}>{conDeuda}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-ink-muted">Semanas sin cerrar</p>
          <p className={`text-2xl font-bold ${semanasPendientes.length ? "text-[var(--color-amarillo)]" : "text-ink"}`}>{semanasPendientes.length}</p>
        </div>
      </div>

      {puedeGestionar && semanasPendientes.length > 0 && (
        <Card className="!border-[var(--color-amarillo)]/40">
          <p className="font-bold text-ink">Semanas terminadas para cerrar</p>
          <p className="text-[15px] text-ink-muted mb-3">
            Al cerrar una semana se guarda el saldo de cada núcleo en su libreta. El sistema también las cierra solo cada lunes.
          </p>
          <ul className="space-y-2">
            {semanasPendientes.map((l) => (
              <li key={l} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[15px] text-ink">{textoSemana(l)}</span>
                <BotonAccion action={cerrarSemanaFormAction} ocultos={{ comision_id: comisionId, semana: l }} mensajeExito="Semana cerrada.">
                  Cerrar semana
                </BotonAccion>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {filas.length === 0 ? (
        <Card>
          <EmptyState>Todavía no hay núcleos cargados.</EmptyState>
        </Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="text-left text-sm text-ink-muted border-b border-border">
                  <th className="py-3 px-4">Núcleo</th>
                  <th className="py-3 px-4">Esta semana</th>
                  <th className="py-3 px-4">Saldo de horas</th>
                  <th className="py-3 px-4 sr-only">Ver</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const s = textoSaldo(f.saldoAcumuladoMin);
                  const e = f.estaSemana;
                  return (
                    <tr key={f.nucleoId} className="border-b border-border last:border-0 hover:bg-surface-sunken cursor-pointer" onClick={() => setAbiertoId(f.nucleoId)}>
                      <td className="py-3 px-4 font-semibold text-ink">{f.nombre}</td>
                      <td className="py-3 px-4 text-ink">
                        {e ? (
                          <>
                            {textoHoras(e.realMin)} de {textoHoras(e.exigibleMin)}
                            {e.faltanMin > 0 && <span className="block text-sm text-ink-muted">Faltan {textoHoras(e.faltanMin)}</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge color={s.color}>{s.texto}</Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">Ver libreta</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {puedeGestionar && ultimasCerradas.length > 0 && (
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="cursor-pointer font-semibold text-ink">Semanas cerradas (reabrir si hubo un error)</summary>
          <ul className="mt-3 space-y-2">
            {ultimasCerradas.map((c) => (
              <li key={c.lunes} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                <span>
                  {textoSemana(c.lunes)} <span className="text-ink-muted">· cerró {c.cerradoPor}</span>
                </span>
                <FormularioEnModal
                  textoBoton="Reabrir"
                  titulo={`Reabrir ${textoSemana(c.lunes).toLowerCase()}`}
                  descripcion="Mientras esté reabierta se puede corregir la asistencia. Después volvé a cerrarla para que cuente en la libreta."
                  action={reabrirSemanaFormAction}
                  ocultos={{ comision_id: comisionId, semana: c.lunes }}
                  textoConfirmar="Reabrir semana"
                  mensajeExito="Semana reabierta."
                >
                  <label className="block">
                    <Label required>¿Por qué? (queda registrado)</Label>
                    <textarea name="motivo" required rows={2} maxLength={300} className={inputClass} />
                  </label>
                </FormularioEnModal>
              </li>
            ))}
          </ul>
        </details>
      )}

      {hrefRegistroAnterior && (
        <p className="text-sm text-ink-muted">
          Las horas cargadas antes de este sistema siguen guardadas en el{" "}
          <Link href={hrefRegistroAnterior} className="underline underline-offset-2">registro anterior de jornadas</Link> y se muestran aparte en cada libreta.
        </p>
      )}

      <Modal open={!!abierto} onClose={() => setAbiertoId(null)} title={abierto ? `Libreta de horas — ${abierto.nombre}` : ""} size="lg">
        {abierto && (
          <div className="space-y-4 text-[15px]">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-surface-sunken p-3">
                <p className="text-sm text-ink-muted">Saldo de horas</p>
                <p className="text-xl font-bold text-ink">{textoSaldo(abierto.saldoAcumuladoMin).texto}</p>
              </div>
              <div className="rounded-xl bg-surface-sunken p-3">
                <p className="text-sm text-ink-muted">Objetivo semanal</p>
                <p className="text-xl font-bold text-ink">{textoHoras(Math.round(abierto.objetivoHoras * 60))}</p>
              </div>
              <div className="rounded-xl bg-surface-sunken p-3">
                <p className="text-sm text-ink-muted">Registro anterior</p>
                <p className="text-xl font-bold text-ink">{abierto.horasAnteriores ? `${Math.round(abierto.horasAnteriores)} h` : "—"}</p>
              </div>
            </div>

            <div>
              <p className="font-semibold text-ink mb-2">Semana por semana</p>
              {abierto.semanas.length === 0 ? (
                <p className="text-ink-muted">Todavía no hay semanas cerradas.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-ink-muted border-b border-border">
                        <th className="py-2 pr-3">Semana</th>
                        <th className="py-2 pr-3">Hizo</th>
                        <th className="py-2 pr-3">Debía</th>
                        <th className="py-2 pr-3">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {abierto.semanas.map((s) => {
                        const t = textoSaldo(s.saldoMin);
                        const debia = s.objetivoMin - s.licenciaMin;
                        return (
                          <tr key={s.semana} className="border-b border-border last:border-0">
                            <td className="py-2 pr-3">{textoSemana(s.semana).replace("Semana del ", "")}</td>
                            <td className="py-2 pr-3">
                              {textoHoras(s.realMin)}
                              {s.justificadoMin > 0 && <span className="block text-sm text-ink-muted">{textoHoras(s.justificadoMin)} justificadas</span>}
                            </td>
                            <td className="py-2 pr-3">
                              {textoHoras(debia)}
                              {s.licenciaMin > 0 && <span className="block text-sm text-ink-muted">con licencia</span>}
                            </td>
                            <td className="py-2 pr-3"><Badge color={t.color}>{t.texto}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <p className="font-semibold text-ink mb-2">Licencias</p>
              {abierto.licencias.length === 0 ? (
                <p className="text-ink-muted">Sin licencias.</p>
              ) : (
                <ul className="space-y-2">
                  {abierto.licencias.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Del {fechaCorta(l.desde)} al {fechaCorta(l.hasta)} — {l.motivo}
                      </span>
                      {puedeGestionar && (
                        <FormularioEnModal
                          textoBoton="Anular"
                          titulo="Anular licencia"
                          action={anularLicenciaFormAction}
                          ocultos={{ comision_id: comisionId, licencia_id: l.id }}
                          textoConfirmar="Anular licencia"
                          peligro
                          enLinea
                          mensajeExito="Licencia anulada."
                        >
                          <label className="block">
                            <Label required>¿Por qué?</Label>
                            <textarea name="motivo" required rows={2} maxLength={300} className={inputClass} />
                          </label>
                        </FormularioEnModal>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {puedeGestionar && (
                <div className="mt-3">
                  <FormularioEnModal
                    textoBoton="+ Registrar licencia"
                    titulo={`Licencia para ${abierto.nombre}`}
                    descripcion="Durante la licencia el núcleo no debe horas (por ejemplo: enfermedad, maternidad o paternidad)."
                    action={registrarLicenciaFormAction}
                    ocultos={{ comision_id: comisionId, nucleo_id: abierto.nucleoId }}
                    textoConfirmar="Registrar licencia"
                    enLinea
                    mensajeExito="Licencia registrada."
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <Label required>Desde</Label>
                        <input type="date" name="desde" required className={inputClass} />
                      </label>
                      <label className="block">
                        <Label required>Hasta</Label>
                        <input type="date" name="hasta" required className={inputClass} />
                      </label>
                    </div>
                    <label className="block">
                      <Label required>Motivo</Label>
                      <textarea name="motivo" required rows={2} maxLength={300} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
