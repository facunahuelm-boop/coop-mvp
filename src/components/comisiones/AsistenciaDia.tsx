"use client";

// Fase 1B "Horas con un solo número" — asistencia del día en la Comisión de
// Trabajo. Pensado para usarse en la obra, desde el celular, por un
// voluntario: una fila grande por turno y tres botones con texto ("Vino",
// "Llegó tarde o se fue antes", "Faltó"). Lo que no se marca se toma como
// hecho cuando el día ya pasó, así que alcanza con marcar las excepciones.

import Link from "next/link";
import { ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import { Badge, Label, inputClass, EmptyState, Card } from "@/components/ui";
import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import {
  marcarAsistenciaFormAction,
  deshacerAsistenciaFormAction,
  confirmarTodosPresentesFormAction,
  registrarSinTurnoFormAction,
  revisarAvisoAusenciaFormAction,
} from "@/lib/actions/asistenciaHoras";
import { textoHoras, type HorarioObra, aMinutos, aHora } from "@/lib/horasObra";

export type TurnoDelDia = {
  asignacionId: number;
  nucleoId: number;
  nucleo: string;
  horaInicio: string;
  horaFin: string;
  minutos: number;
  estado: string; // presente | tarde | ... | presunto | pendiente
  estadoTexto: string;
  minutosReales: number;
  asistenciaId: number | null;
  observaciones: string | null;
  aviso: { id: number; motivo: string; estado: string; tieneAdjunto: boolean } | null;
};

export type AvisoPendiente = {
  id: number;
  nucleo: string;
  turno: string;
  motivo: string;
  avisadoPor: string | null;
  adjuntoHref: string | null;
};

const COLOR: Record<string, "verde" | "amarillo" | "rojo" | "gray" | "azul" | "naranja"> = {
  presente: "verde",
  tarde: "amarillo",
  retiro_anticipado: "amarillo",
  ausente_justificada: "azul",
  ausente_injustificada: "rojo",
  presunto: "gray",
  pendiente: "gray",
};

function opcionesHora(h: HorarioObra): string[] {
  const out: string[] = [];
  for (let m = aMinutos(h.inicio); m <= aMinutos(h.fin); m += 15) out.push(aHora(m));
  return out;
}

const botonFila =
  "inline-flex items-center justify-center rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors min-h-[44px]";

export function AsistenciaDia({
  comisionId,
  fecha,
  textoFecha,
  hrefAnterior,
  hrefSiguiente,
  hrefHoy,
  esHoy,
  esFuturo,
  semanaCerrada,
  turnos,
  sinTurno,
  avisosPendientes,
  puedeMarcar,
  nucleos,
  horario,
}: {
  comisionId: number;
  fecha: string;
  textoFecha: string;
  hrefAnterior: string;
  hrefSiguiente: string;
  hrefHoy: string;
  esHoy: boolean;
  esFuturo: boolean;
  semanaCerrada: boolean;
  turnos: TurnoDelDia[];
  sinTurno: { id: number; nucleo: string; horario: string; minutos: number }[];
  avisosPendientes: AvisoPendiente[];
  puedeMarcar: boolean;
  nucleos: { id: number; nombre: string }[];
  horario: HorarioObra;
}) {
  const horas = opcionesHora(horario);
  const editable = puedeMarcar && !esFuturo && !semanaCerrada;
  const sinMarcar = turnos.filter((t) => !t.asistenciaId).length;

  return (
    <div className="space-y-4">
      {puedeMarcar && avisosPendientes.length > 0 && (
        <Card className="!border-[var(--color-amarillo)]/40">
          <p className="text-base font-bold text-ink mb-2">
            Avisos de ausencia para revisar ({avisosPendientes.length})
          </p>
          <ul className="divide-y divide-border">
            {avisosPendientes.map((a) => (
              <li key={a.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{a.nucleo} — {a.turno}</p>
                  <p className="text-[15px] text-ink">«{a.motivo}»</p>
                  <p className="text-sm text-ink-muted">
                    {a.avisadoPor ? `Avisó ${a.avisadoPor}` : ""}
                    {a.adjuntoHref && (
                      <>
                        {" · "}
                        <a href={a.adjuntoHref} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
                          <Paperclip size={13} /> Ver certificado
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BotonAccion
                    action={revisarAvisoAusenciaFormAction}
                    ocultos={{ comision_id: comisionId, aviso_id: a.id, decision: "aprobado" }}
                    mensajeExito="Falta justificada."
                  >
                    Aprobar
                  </BotonAccion>
                  <FormularioEnModal
                    textoBoton="Rechazar"
                    titulo={`Rechazar el aviso de ${a.nucleo}`}
                    action={revisarAvisoAusenciaFormAction}
                    ocultos={{ comision_id: comisionId, aviso_id: a.id, decision: "rechazado" }}
                    textoConfirmar="Rechazar aviso"
                    peligro
                    mensajeExito="Aviso rechazado."
                  >
                    <label className="block">
                      <Label required>¿Por qué? (lo va a leer el socio)</Label>
                      <textarea name="respuesta" required rows={3} maxLength={300} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={hrefAnterior} className={`${botonFila} border-border bg-surface`} aria-label="Día anterior">
            <ChevronLeft size={18} /> <span className="hidden sm:inline">Anterior</span>
          </Link>
          <p className="text-lg font-bold text-ink px-1">{textoFecha}</p>
          <Link href={hrefSiguiente} className={`${botonFila} border-border bg-surface`} aria-label="Día siguiente">
            <span className="hidden sm:inline">Siguiente</span> <ChevronRight size={18} />
          </Link>
          {!esHoy && (
            <Link href={hrefHoy} className="text-sm font-semibold underline underline-offset-2 text-[var(--color-brand-800)] ml-1">
              Ir a hoy
            </Link>
          )}
        </div>
        {editable && sinMarcar > 0 && (
          <BotonAccion action={confirmarTodosPresentesFormAction} ocultos={{ comision_id: comisionId, fecha }}>
            Marcar los {sinMarcar} que faltan como «Vino»
          </BotonAccion>
        )}
      </div>

      {semanaCerrada && (
        <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[15px] text-ink">
          Esta semana ya está cerrada en la libreta de horas: se puede consultar pero no cambiar.
        </p>
      )}
      {esFuturo && turnos.length > 0 && (
        <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[15px] text-ink">
          Todavía no llegó este día: la asistencia se marca el día del turno o después.
        </p>
      )}

      {turnos.length === 0 ? (
        <Card>
          <EmptyState>No hay turnos planificados para este día.</EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {turnos.map((t) => (
            <li key={t.asignacionId} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-ink">{t.nucleo}</p>
                  <p className="text-[15px] text-ink-muted">
                    Turno {t.horaInicio} a {t.horaFin} hs · {textoHoras(t.minutos)}
                  </p>
                </div>
                <Badge color={COLOR[t.estado] ?? "gray"}>{t.estadoTexto}</Badge>
              </div>
              {(t.estado === "tarde" || t.estado === "retiro_anticipado") && (
                <p className="mt-1 text-[15px] text-ink">Hizo {textoHoras(t.minutosReales)}.</p>
              )}
              {t.observaciones && <p className="mt-1 text-[15px] text-ink">Nota: {t.observaciones}</p>}
              {t.aviso && t.aviso.estado === "pendiente" && (
                <p className="mt-1 text-[15px] text-[var(--color-amarillo)]">Avisó que no puede venir: «{t.aviso.motivo}» (falta revisar)</p>
              )}

              {editable && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.estado !== "presente" && (
                    <BotonAccion
                      action={marcarAsistenciaFormAction}
                      ocultos={{ comision_id: comisionId, asignacion_id: t.asignacionId, estado: "presente" }}
                      className="!border-[var(--color-verde)]/40"
                    >
                      Vino
                    </BotonAccion>
                  )}
                  <FormularioEnModal
                    textoBoton="Llegó tarde o se fue antes"
                    titulo={`${t.nucleo}: horario real`}
                    descripcion={`El turno era de ${t.horaInicio} a ${t.horaFin} hs. ¿A qué hora llegó y a qué hora se fue?`}
                    action={marcarAsistenciaFormAction}
                    ocultos={{ comision_id: comisionId, asignacion_id: t.asignacionId, estado: "tarde" }}
                    mensajeExito="Horario guardado."
                    claseBoton={`${botonFila} border-border bg-surface`}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <Label required>Llegó a las</Label>
                        <select name="hora_inicio" defaultValue={t.horaInicio} className={inputClass}>
                          {horas.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <Label required>Se fue a las</Label>
                        <select name="hora_fin" defaultValue={t.horaFin} className={inputClass}>
                          {horas.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <Label>Nota (opcional)</Label>
                      <input name="observaciones" maxLength={300} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                  <FormularioEnModal
                    textoBoton="Faltó"
                    titulo={`${t.nucleo} faltó`}
                    action={marcarAsistenciaFormAction}
                    ocultos={{ comision_id: comisionId, asignacion_id: t.asignacionId }}
                    textoConfirmar="Guardar falta"
                    mensajeExito="Falta registrada."
                    claseBoton={`${botonFila} border-border bg-surface`}
                  >
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-semibold text-ink mb-1">¿Avisó o tiene justificación?</legend>
                      <label className="flex items-center gap-3 rounded-xl border border-border px-3 py-3">
                        <input type="radio" name="estado" value="ausente_justificada" defaultChecked={!!t.aviso} className="h-5 w-5" />
                        <span>Sí, falta justificada <span className="text-ink-muted">(no le genera deuda)</span></span>
                      </label>
                      <label className="flex items-center gap-3 rounded-xl border border-border px-3 py-3">
                        <input type="radio" name="estado" value="ausente_injustificada" defaultChecked={!t.aviso} className="h-5 w-5" />
                        <span>No, falta sin justificar</span>
                      </label>
                    </fieldset>
                    <label className="block">
                      <Label>Motivo (obligatorio si es justificada)</Label>
                      <textarea name="observaciones" rows={2} maxLength={300} defaultValue={t.aviso?.motivo ?? ""} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                  {t.asistenciaId && (
                    <BotonAccion
                      action={deshacerAsistenciaFormAction}
                      ocultos={{ comision_id: comisionId, asistencia_id: t.asistenciaId }}
                      className="!text-ink-muted"
                      mensajeExito="Marca deshecha."
                    >
                      Deshacer
                    </BotonAccion>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {sinTurno.length > 0 && (
        <Card>
          <p className="font-semibold text-ink mb-1">Vinieron sin turno</p>
          <ul className="text-[15px] text-ink space-y-1">
            {sinTurno.map((s) => (
              <li key={s.id}>{s.nucleo} — {s.horario} ({textoHoras(s.minutos)})</li>
            ))}
          </ul>
        </Card>
      )}

      {editable && (
        <FormularioEnModal
          textoBoton="+ Vino un núcleo sin turno"
          titulo="Registrar horas sin turno planificado"
          action={registrarSinTurnoFormAction}
          ocultos={{ comision_id: comisionId, fecha }}
          textoConfirmar="Registrar horas"
          mensajeExito="Horas registradas."
        >
          <label className="block">
            <Label required>Núcleo</Label>
            <select name="nucleo_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegí el núcleo</option>
              {nucleos.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label required>Desde</Label>
              <select name="hora_inicio" defaultValue={horario.inicio} className={inputClass}>
                {horas.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label className="block">
              <Label required>Hasta</Label>
              <select name="hora_fin" defaultValue={horario.descansoInicio} className={inputClass}>
                {horas.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <Label>Nota (opcional)</Label>
            <input name="observaciones" maxLength={300} className={inputClass} />
          </label>
        </FormularioEnModal>
      )}
    </div>
  );
}
