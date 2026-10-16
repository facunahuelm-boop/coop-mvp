import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { Card, PageHeader, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { avisarAusenciaFormAction } from "@/lib/actions/asistenciaHoras";
import { cargarLibretas, nucleoDelUsuario, ESTADO_ASISTENCIA_LABEL } from "@/lib/libretaHoras";
import { Clock, Scale, CalendarClock, History, BookOpen, ShieldCheck } from "lucide-react";
import { DashboardGrid, DashboardSection, DashboardCardModal } from "@/components/DashboardCard";
import { DashboardSummaryCard } from "@/components/DashboardSummaryCard";
import { hoyEnUruguay, sumarDias, textoDia, textoHoras, textoSemana, textoSaldo } from "@/lib/horasObra";

/**
 * Fase 1B — "Mis horas": lo que el socio necesita saber de sus horas de
 * ayuda mutua, en lenguaje simple y letra grande: cuánto hizo esta semana,
 * cuánto le falta, su saldo, cuándo le toca y un botón para avisar que no
 * puede ir. Sólo ve las de su propio núcleo.
 */
export default async function MisHorasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const hoy = hoyEnUruguay();
  const nucleoId = await nucleoDelUsuario(user.id, user.nucleo_id);

  if (!nucleoId) {
    return (
      <div>
        <PageHeader title="Mis horas" />
        <Card>
          <EmptyState>Tu usuario todavía no está vinculado a un núcleo. Pedile a la administración de la cooperativa que lo vincule.</EmptyState>
        </Card>
      </div>
    );
  }

  const [libreta] = await cargarLibretas(hoy, nucleoId);
  const nucleo = await get<{ nombre: string }>(`SELECT nombre FROM nucleos_familiares WHERE id = ?`, [nucleoId]);
  const proximos = await all<{ id: number; fecha: string; hora_inicio: string; hora_fin: string; minutos: number; aviso_estado: string | null; aviso_respuesta: string | null }>(
    `SELECT a.id, a.fecha, a.hora_inicio, a.hora_fin, a.minutos,
            (SELECT v.estado FROM avisos_ausencia v WHERE v.asignacion_id = a.id AND v.estado <> 'retirado' ORDER BY v.id DESC LIMIT 1) AS aviso_estado,
            (SELECT v.respuesta FROM avisos_ausencia v WHERE v.asignacion_id = a.id AND v.estado <> 'retirado' ORDER BY v.id DESC LIMIT 1) AS aviso_respuesta
       FROM asignaciones_horas a
      WHERE a.nucleo_id = ? AND a.estado = 'activa' AND a.fecha >= ? AND a.fecha <= ?
      ORDER BY a.fecha, a.hora_inicio`,
    [nucleoId, hoy, sumarDias(hoy, 21)]
  ).catch(() => []);

  const semana = libreta?.semanaActual ?? null;
  const saldo = textoSaldo(libreta?.saldoAcumuladoMin ?? 0);
  const turnosPasados = (semana?.turnos ?? []).filter((t) => t.fecha < hoy);

  // Fase 3E: la seguridad de la persona en la obra (inducción y elementos de protección).
  const socioPropio = await get<{ id: number }>(`SELECT id FROM socios WHERE user_id = ? ORDER BY id LIMIT 1`, [user.id]).catch(() => undefined);
  const induccion = socioPropio
    ? await get<{ fecha: string }>(`SELECT fecha FROM inducciones_seguridad WHERE socio_id = ? AND integrante_id IS NULL AND anulado_en IS NULL ORDER BY fecha LIMIT 1`, [socioPropio.id]).catch(() => undefined)
    : undefined;
  const epp = socioPropio
    ? await all<{ elemento: string; fecha: string }>(`SELECT elemento, fecha FROM epp_entregas WHERE socio_id = ? AND integrante_id IS NULL AND anulado_en IS NULL ORDER BY fecha`, [socioPropio.id]).catch(() => [])
    : [];
  const hayControlInduccion = !!(await get<{ id: number }>(`SELECT id FROM inducciones_seguridad WHERE anulado_en IS NULL LIMIT 1`).catch(() => undefined));

  const botonAviso = "inline-flex items-center justify-center rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken";
  const sigTurno = proximos[0];
  return (
    <div className="space-y-4 text-[15px]">
      <PageHeader title="Mis horas" subtitle={nucleo ? `Núcleo ${nucleo.nombre}` : undefined} />
      <p className="rounded-xl bg-surface-sunken px-4 py-2.5 text-sm text-ink">
        En la obra: escaneá con la cámara del celular el <b>QR del día</b> al llegar y al irte. Tus horas se anotan solas.
      </p>

      <DashboardSection title="Mi resumen">
        <DashboardGrid>
          <DashboardCardModal
            title="Esta semana"
            trigger={
              <DashboardSummaryCard
                icon={<Clock size={18} />}
                title="Esta semana"
                tone="azul"
                value={semana ? `${textoHoras(semana.realMin)} / ${textoHoras(semana.exigibleMin)}` : "—"}
                description={semana ? (semana.faltanMin > 0 ? `Te faltan ${textoHoras(semana.faltanMin)}` : "Semana completa") : "No hay horas esta semana"}
              />
            }
          >
            {semana ? (
              <div className="space-y-2 text-sm text-ink">
                <p className="text-2xl font-bold">{textoHoras(semana.realMin)} <span className="text-base font-semibold text-ink-muted">de {textoHoras(semana.exigibleMin)}</span></p>
                <p>{semana.faltanMin > 0 ? `Te faltan ${textoHoras(semana.faltanMin)}.` : "¡Completaste la semana!"}</p>
                {semana.licenciaMin > 0 && <p className="text-ink-muted">Tenés licencia aprobada esta semana.</p>}
              </div>
            ) : (
              <p className="text-sm text-ink">No hay horas para esta semana.</p>
            )}
          </DashboardCardModal>

          <DashboardCardModal
            title="Tu saldo de horas"
            trigger={<DashboardSummaryCard icon={<Scale size={18} />} title="Mi saldo" tone={saldo.color === "rojo" ? "rojo" : saldo.color === "verde" ? "verde" : "neutro"} value={saldo.texto} description="Semanas ya cerradas" />}
          >
            <p className={`text-2xl font-bold ${saldo.color === "rojo" ? "text-[var(--color-rojo)]" : saldo.color === "verde" ? "text-[var(--color-verde)]" : "text-ink"}`}>{saldo.texto}</p>
            <p className="mt-1 text-sm text-ink-muted">Suma de las semanas ya cerradas.</p>
            {libreta && libreta.nucleo.horasAnteriores > 0 && <p className="mt-2 text-sm text-ink-muted">Además, en el registro anterior tenés {Math.round(libreta.nucleo.horasAnteriores)} h cargadas.</p>}
          </DashboardCardModal>

          <DashboardCardModal
            title="Tus próximos turnos"
            size="lg"
            trigger={
              <DashboardSummaryCard
                icon={<CalendarClock size={18} />}
                title="Próximos turnos"
                tone="teal"
                value={sigTurno ? (sigTurno.fecha === hoy ? "Hoy" : textoDia(sigTurno.fecha)) : "Sin turnos"}
                description={sigTurno ? `${sigTurno.hora_inicio} a ${sigTurno.hora_fin} hs` : "Próximas tres semanas"}
              />
            }
          >
            {proximos.length === 0 ? (
              <p className="text-sm text-ink">No tenés turnos asignados en las próximas tres semanas.</p>
            ) : (
              <ul className="space-y-2">
                {proximos.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                    <div className="text-sm">
                      <p className="font-bold text-ink">{t.fecha === hoy ? "Hoy" : textoDia(t.fecha)}</p>
                      <p className="text-ink">De {t.hora_inicio} a {t.hora_fin} hs · {textoHoras(Number(t.minutos))}</p>
                      {t.aviso_estado === "pendiente" && <p className="mt-1 text-[var(--color-amarillo)]">Avisaste que no podés ir (la comisión lo está revisando).</p>}
                      {t.aviso_estado === "aprobado" && <p className="mt-1 text-[var(--color-verde)]">Tu falta quedó justificada.</p>}
                      {t.aviso_estado === "rechazado" && <p className="mt-1 text-[var(--color-rojo)]">Tu aviso no fue aceptado{t.aviso_respuesta ? `: ${t.aviso_respuesta}` : "."}</p>}
                    </div>
                    {!t.aviso_estado || t.aviso_estado === "rechazado" ? (
                      <FormularioEnModal
                        enLinea
                        textoBoton="Avisar que no puedo ir"
                        titulo={`No puedo ir el ${textoDia(t.fecha).toLowerCase()}`}
                        descripcion="La Comisión de Trabajo va a recibir tu aviso. Si es justificado, esas horas no te quedan como deuda."
                        action={avisarAusenciaFormAction}
                        ocultos={{ asignacion_id: t.id }}
                        textoConfirmar="Enviar aviso"
                        mensajeExito="Aviso enviado a la Comisión de Trabajo."
                        claseBoton={botonAviso}
                      >
                        <label className="block">
                          <Label required>¿Por qué no podés ir?</Label>
                          <textarea name="motivo" required rows={3} maxLength={500} className={inputClass} placeholder="Ej.: tengo consulta médica" />
                        </label>
                        <label className="block">
                          <Label>Certificado o comprobante (opcional)</Label>
                          <input type="file" name="adjunto" accept="image/*,application/pdf" className="block w-full text-sm" />
                        </label>
                      </FormularioEnModal>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DashboardCardModal>

          <DashboardCardModal
            title="Lo que ya pasó esta semana"
            trigger={<DashboardSummaryCard icon={<History size={18} />} title="Esta semana, lo que pasó" tone="violeta" value={`${turnosPasados.length} turno${turnosPasados.length === 1 ? "" : "s"}`} description="Asistencia de los días que ya pasaron" />}
          >
            {turnosPasados.length === 0 ? (
              <p className="text-sm text-ink">Todavía no pasó ningún turno esta semana.</p>
            ) : (
              <ul className="divide-y divide-border">
                {turnosPasados.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>{textoDia(t.fecha)} · {t.hora_inicio}–{t.hora_fin}</span>
                    <Badge color={t.estado === "ausente_injustificada" ? "rojo" : t.estado === "ausente_justificada" ? "azul" : "verde"}>{ESTADO_ASISTENCIA_LABEL[t.estado] ?? t.estado}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCardModal>

          <DashboardCardModal
            title="Tu libreta de horas"
            size="lg"
            trigger={<DashboardSummaryCard icon={<BookOpen size={18} />} title="Mi libreta" tone="ambar" value={`${libreta?.semanas.length ?? 0} semana${(libreta?.semanas.length ?? 0) === 1 ? "" : "s"}`} description="Semanas cerradas" />}
          >
            {!libreta || libreta.semanas.length === 0 ? (
              <p className="text-sm text-ink">Todavía no hay semanas cerradas.</p>
            ) : (
              <ul className="divide-y divide-border">
                {libreta.semanas.slice(0, 12).map((s) => {
                  const t = textoSaldo(s.saldoMin);
                  return (
                    <li key={s.semana} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        {textoSemana(s.semana)}
                        <span className="block text-ink-muted">Hiciste {textoHoras(s.realMin)}{s.justificadoMin ? ` · ${textoHoras(s.justificadoMin)} justificadas` : ""}</span>
                      </span>
                      <Badge color={t.color}>{t.texto}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashboardCardModal>

          {socioPropio && (hayControlInduccion || epp.length > 0) && (
            <DashboardCardModal
              title="Tu seguridad en la obra"
              trigger={<DashboardSummaryCard icon={<ShieldCheck size={18} />} title="Mi seguridad" tone={induccion ? "verde" : "ambar"} value={induccion ? "Inducción hecha" : "Falta la inducción"} description={epp.length ? `${epp.length} elemento${epp.length === 1 ? "" : "s"} de protección` : "Sin elementos entregados"} />}
            >
              <div className="space-y-2 text-sm text-ink">
                <p>
                  {induccion
                    ? `Hiciste la inducción de seguridad el ${induccion.fecha.slice(0, 10).split("-").reverse().join("/")}.`
                    : "Todavía no tenés registrada la inducción de seguridad. Hablá con la Comisión de Seguridad antes de ir a la obra."}
                </p>
                {epp.length > 0 && (
                  <p>
                    Elementos de protección que recibiste: {epp.map((e) => e.elemento).join(", ")}.{" "}
                    <a href={`/api/seguridad/constancia-epp/s-${socioPropio.id}`} target="_blank" rel="noopener" className="underline underline-offset-2">Ver la constancia</a>
                  </p>
                )}
              </div>
            </DashboardCardModal>
          )}
        </DashboardGrid>
      </DashboardSection>
    </div>
  );
}
