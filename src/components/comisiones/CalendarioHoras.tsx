"use client";

// Comisión de Trabajo (05/10) — calendario semanal de horas de obra por
// núcleo. Es la herramienta principal de la comisión, así que se priorizó
// que se lea bien en escritorio (siete columnas, mañana / descanso / tarde)
// y que en el celular siga siendo usable (scroll horizontal).
//
// Vista administrativa (quien organiza las horas): asignar, editar,
// reprogramar y cancelar. Vista informativa (el resto de la cooperativa):
// la misma planificación, sin ningún botón que la modifique — y el servidor
// rechaza cualquier cambio igual (ver actions/horasTrabajo.ts).

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays, Rows3, Coffee } from "lucide-react";
import { Modal, FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButton, Badge, Button, Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import {
  asignarHorasFormAction,
  editarAsignacionHorasFormAction,
  cancelarAsignacionHorasFormAction,
} from "@/lib/actions/horasTrabajo";
import {
  calcularTramo,
  seSuperponen,
  aMinutos,
  aHora,
  textoHoras,
  textoDia,
  textoEstadoHoras,
  estadoHorasNucleo,
  NOMBRE_DIA,
  ESTADO_HORAS_LABEL,
  type HorarioObra,
  type EstadoHorasNucleo,
} from "@/lib/horasObra";
import type { AsignacionHoras, NucleoSemana, SemanaHoras } from "@/lib/horasTrabajo";

const COLOR_ESTADO: Record<EstadoHorasNucleo, "verde" | "amarillo" | "naranja" | "gray"> = {
  completo: "verde",
  pendiente: "amarillo",
  exceso: "naranja",
  sin_horas: "gray",
};
const BORDE_ESTADO: Record<EstadoHorasNucleo, string> = {
  completo: "var(--color-verde)",
  pendiente: "var(--color-amarillo)",
  exceso: "var(--color-naranja)",
  sin_horas: "var(--color-border, #d4d4d8)",
};

type Props = {
  comisionId: number;
  semana: SemanaHoras;
  dias: string[];
  hoy: string;
  textoSemana: string;
  hrefAnterior: string;
  hrefSiguiente: string;
  hrefActual: string;
  horario: HorarioObra;
  puedePlanificar: boolean;
};

/** Opciones de hora cada 30 minutos dentro del horario de obra, sin las que caen DENTRO del descanso. */
function opcionesHora(h: HorarioObra): string[] {
  const out: string[] = [];
  const dIni = aMinutos(h.descansoInicio);
  const dFin = aMinutos(h.descansoFin);
  for (let m = aMinutos(h.inicio); m <= aMinutos(h.fin); m += 30) {
    if (m > dIni && m < dFin) continue;
    out.push(aHora(m));
  }
  return out;
}

export function CalendarioHoras(props: Props) {
  const { semana, dias, hoy, horario, puedePlanificar } = props;
  const [vista, setVista] = useState<"calendario" | "nucleos">("calendario");
  const [filtroNucleo, setFiltroNucleo] = useState("");
  const [filtroDia, setFiltroDia] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [formulario, setFormulario] = useState<{ asignacion: AsignacionHoras | null; fecha?: string; franja?: "manana" | "tarde" } | null>(null);
  const [detalle, setDetalle] = useState<AsignacionHoras | null>(null);

  const nucleoPorId = useMemo(() => new Map(semana.nucleos.map((n) => [n.id, n])), [semana.nucleos]);
  const nucleosVisibles = semana.nucleos.filter(
    (n) =>
      (!filtroNucleo || String(n.id) === filtroNucleo) &&
      (!filtroEstado || n.estado === filtroEstado || (filtroEstado === "faltan" && (n.estado === "pendiente" || n.estado === "sin_horas")))
  );
  const idsVisibles = new Set(nucleosVisibles.map((n) => n.id));
  const asignacionesVisibles = semana.asignaciones.filter((a) => idsVisibles.has(a.nucleo_id) && (!filtroDia || a.fecha === filtroDia));
  const diasVisibles = filtroDia ? dias.filter((d) => d === filtroDia) : dias;
  const hayFiltros = Boolean(filtroNucleo || filtroDia || filtroEstado);
  const r = semana.resumen;
  const dIni = aMinutos(horario.descansoInicio);

  return (
    <div className="space-y-4">
      {/* Navegación de semanas + acción principal (arriba a la derecha). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Link href={props.hrefAnterior} scroll={false} className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken" aria-label="Semana anterior">
            <ChevronLeft size={16} /> <span className="hidden sm:inline">Semana anterior</span>
          </Link>
          <div className="px-2 text-center">
            <p className="text-sm sm:text-base font-bold text-[var(--color-brand-900)]">{props.textoSemana}</p>
          </div>
          <Link href={props.hrefSiguiente} scroll={false} className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken" aria-label="Semana siguiente">
            <span className="hidden sm:inline">Semana siguiente</span> <ChevronRight size={16} />
          </Link>
          {!dias.includes(hoy) && (
            <Link href={props.hrefActual} scroll={false} className="ml-1 text-xs text-[var(--color-brand-800)] underline underline-offset-2">
              Ir a esta semana
            </Link>
          )}
        </div>
        {puedePlanificar && <AddButton onClick={() => setFormulario({ asignacion: null })}>Asignar horas</AddButton>}
      </div>

      {/* Resumen de la semana — chico, no un tablero. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Dato label="Núcleos" valor={String(r.nucleos)} />
        <Dato
          label="Horas programadas"
          valor={`${textoHoras(r.minutosProgramados).replace(" h", "")} / ${textoHoras(r.minutosObjetivo)}`}
        />
        <Dato label="Semana completa" valor={String(r.completos)} tono="verde" onClick={() => setFiltroEstado(filtroEstado === "completo" ? "" : "completo")} activo={filtroEstado === "completo"} />
        <Dato label="Con horas pendientes" valor={String(r.pendientes + r.sinHoras)} tono="amarillo" onClick={() => setFiltroEstado(filtroEstado === "faltan" ? "" : "faltan")} activo={filtroEstado === "faltan"} />
        <Dato label="Con exceso" valor={String(r.exceso)} tono="naranja" onClick={() => setFiltroEstado(filtroEstado === "exceso" ? "" : "exceso")} activo={filtroEstado === "exceso"} />
      </div>

      {/* Filtros + vista */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
        <select aria-label="Núcleo" value={filtroNucleo} onChange={(e) => setFiltroNucleo(e.target.value)} className="rounded-lg border border-ink/10 bg-surface px-3 py-1.5 text-sm">
          <option value="">Núcleo: todos</option>
          {semana.nucleos.map((n) => (
            <option key={n.id} value={n.id}>{n.nombre}</option>
          ))}
        </select>
        <select aria-label="Día" value={filtroDia} onChange={(e) => setFiltroDia(e.target.value)} className="rounded-lg border border-ink/10 bg-surface px-3 py-1.5 text-sm">
          <option value="">Día: todos</option>
          {dias.map((d) => (
            <option key={d} value={d}>{textoDia(d)}</option>
          ))}
        </select>
        <select aria-label="Estado de horas" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded-lg border border-ink/10 bg-surface px-3 py-1.5 text-sm">
          <option value="">Estado: todos</option>
          <option value="faltan">Les faltan horas (pendientes o sin horas)</option>
          {(Object.keys(ESTADO_HORAS_LABEL) as EstadoHorasNucleo[]).map((e) => (
            <option key={e} value={e}>{ESTADO_HORAS_LABEL[e]}</option>
          ))}
        </select>
        {hayFiltros && (
          <button type="button" onClick={() => { setFiltroNucleo(""); setFiltroDia(""); setFiltroEstado(""); }} className="text-xs text-ink-muted underline underline-offset-2">
            Limpiar
          </button>
        )}
        <div className="ml-auto inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista">
          <button type="button" onClick={() => setVista("calendario")} aria-pressed={vista === "calendario"} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${vista === "calendario" ? "bg-[var(--color-brand-800)] text-white" : "text-ink-muted"}`}>
            <CalendarDays size={14} /> Calendario
          </button>
          <button type="button" onClick={() => setVista("nucleos")} aria-pressed={vista === "nucleos"} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${vista === "nucleos" ? "bg-[var(--color-brand-800)] text-white" : "text-ink-muted"}`}>
            <Rows3 size={14} /> Por núcleo
          </button>
        </div>
      </div>
      <p className="text-xs text-ink-faint -mt-2">
        Horario de obra {horario.inicio} a {horario.fin} · Descanso {horario.descansoInicio} a {horario.descansoFin} (no se cuenta como trabajado)
      </p>

      {vista === "calendario" ? (
        // Una sola grilla: columna de franjas a la izquierda + un día por
        // columna; las filas (encabezado, mañana, descanso, tarde) quedan
        // alineadas en todos los días y el descanso es una banda continua.
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <div
            className="grid min-w-[980px]"
            style={{ gridTemplateColumns: `80px repeat(${diasVisibles.length}, minmax(0, 1fr))`, gridTemplateRows: "auto minmax(120px, auto) auto minmax(110px, auto)" }}
          >
            {/* Fila 1: encabezados */}
            <div className="border-b border-r border-border bg-surface-sunken/60" />
            {diasVisibles.map((d) => {
              const delDia = asignacionesVisibles.filter((a) => a.fecha === d);
              const minutosDia = delDia.reduce((s2, a) => s2 + a.minutos, 0);
              const esHoy = d === hoy;
              return (
                <div key={`h-${d}`} className={`px-3 py-2.5 border-b border-r border-border last:border-r-0 ${esHoy ? "bg-[var(--accent-blue-bg)]" : "bg-surface-sunken/60"}`}>
                  <p className={`text-sm font-bold leading-tight ${esHoy ? "text-[var(--accent-blue)]" : "text-[var(--color-brand-900)]"}`}>{NOMBRE_DIA[dias.indexOf(d)]}</p>
                  <p className="text-[11px] text-ink-faint">{d.slice(8, 10)}/{d.slice(5, 7)}</p>
                  <p className="text-[11px] text-ink-muted">
                    {delDia.length ? `${new Set(delDia.map((a) => a.nucleo_id)).size} núcleo${new Set(delDia.map((a) => a.nucleo_id)).size === 1 ? "" : "s"} · ${textoHoras(minutosDia)}` : "Sin horas"}
                  </p>
                </div>
              );
            })}

            {/* Fila 2: mañana */}
            <Franja titulo="Mañana" rango={`${horario.inicio}–${horario.descansoInicio}`} />
            {diasVisibles.map((d) => (
              <Celda
                key={`m-${d}`}
                items={asignacionesVisibles.filter((a) => a.fecha === d && aMinutos(a.hora_inicio) < dIni)}
                nucleoPorId={nucleoPorId}
                horario={horario}
                onAbrir={setDetalle}
                onAsignar={puedePlanificar ? () => setFormulario({ asignacion: null, fecha: d, franja: "manana" }) : undefined}
              />
            ))}

            {/* Fila 3: descanso (banda continua) */}
            <div
              className="flex items-center justify-center gap-1 py-2 text-[11px] font-semibold text-ink-faint border-b border-border"
              style={{ gridColumn: `1 / span ${diasVisibles.length + 1}`, backgroundImage: "repeating-linear-gradient(135deg, rgba(100,116,139,0.10) 0 6px, transparent 6px 12px)" }}
              title="Descanso: no se puede asignar trabajo en este horario"
            >
              <Coffee size={13} /> Descanso {horario.descansoInicio} a {horario.descansoFin} — no se asignan horas ni se cuentan como trabajadas
            </div>

            {/* Fila 4: tarde */}
            <Franja titulo="Tarde" rango={`${horario.descansoFin}–${horario.fin}`} ultima />
            {diasVisibles.map((d) => (
              <Celda
                key={`t-${d}`}
                ultima
                items={asignacionesVisibles.filter((a) => a.fecha === d && aMinutos(a.hora_inicio) >= dIni)}
                nucleoPorId={nucleoPorId}
                horario={horario}
                onAbrir={setDetalle}
                onAsignar={puedePlanificar ? () => setFormulario({ asignacion: null, fecha: d, franja: "tarde" }) : undefined}
              />
            ))}
          </div>
        </div>
      ) : (
        <VistaPorNucleo nucleos={nucleosVisibles} asignaciones={asignacionesVisibles} dias={diasVisibles} todosLosDias={dias} onAsignacion={setDetalle} />
      )}

      {/* Control rápido: estado de cada núcleo en la semana (toca para filtrar). */}
      {vista === "calendario" && (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Horas de cada núcleo</p>
          {semana.nucleos.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {nucleosVisibles.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setFiltroNucleo(filtroNucleo === String(n.id) ? "" : String(n.id))}
                  className={`text-left rounded-xl border bg-surface px-3 py-2 hover:bg-surface-sunken transition-colors ${filtroNucleo === String(n.id) ? "border-[var(--color-brand-800)]" : "border-border"}`}
                  style={{ borderLeft: `3px solid ${BORDE_ESTADO[n.estado]}` }}
                >
                  <p className="text-sm font-semibold truncate">{n.nombre}</p>
                  <p className="text-xs text-ink-muted">
                    {textoHoras(n.minutos).replace(" h", "")} / {textoHoras(Math.round(n.objetivoHoras * 60))}
                  </p>
                  <p className="text-[11px] text-ink-faint">{textoEstadoHoras(n.minutos, n.objetivoHoras)}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">No hay núcleos cargados en la cooperativa.</p>
          )}
        </div>
      )}

      {detalle && (
        <DetalleAsignacion
          a={detalle}
          nucleo={nucleoPorId.get(detalle.nucleo_id)}
          horario={horario}
          comisionId={props.comisionId}
          puedePlanificar={puedePlanificar}
          onClose={() => setDetalle(null)}
          onEditar={() => {
            setFormulario({ asignacion: detalle });
            setDetalle(null);
          }}
        />
      )}
      {formulario && (
        <FormularioAsignacion
          key={formulario.asignacion?.id ?? `nuevo-${formulario.fecha ?? ""}-${formulario.franja ?? ""}`}
          comisionId={props.comisionId}
          asignacion={formulario.asignacion}
          fechaInicial={formulario.fecha}
          franja={formulario.franja}
          semana={semana}
          dias={dias}
          horario={horario}
          onClose={() => setFormulario(null)}
        />
      )}
    </div>
  );
}

function Dato({ label, valor, tono, onClick, activo }: { label: string; valor: string; tono?: "verde" | "amarillo" | "naranja"; onClick?: () => void; activo?: boolean }) {
  const color = tono ? `var(--color-${tono})` : undefined;
  const contenido = (
    <>
      <p className="text-[11px] text-ink-faint flex items-center gap-1.5">
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
        {label}
      </p>
      <p className="text-lg font-bold text-ink leading-tight">{valor}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`text-left rounded-xl border bg-surface px-3 py-2 hover:bg-surface-sunken ${activo ? "border-[var(--color-brand-800)]" : "border-border"}`}>
      {contenido}
    </button>
  ) : (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">{contenido}</div>
  );
}

function Franja({ titulo, rango, ultima }: { titulo: string; rango: string; ultima?: boolean }) {
  return (
    <div className={`px-3 py-2.5 border-r border-border bg-surface-sunken/30 ${ultima ? "" : "border-b"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{titulo}</p>
      <p className="text-[11px] text-ink-faint">{rango}</p>
    </div>
  );
}

function Celda({
  items,
  nucleoPorId,
  horario,
  onAbrir,
  onAsignar,
  ultima,
}: {
  items: AsignacionHoras[];
  nucleoPorId: Map<number, NucleoSemana>;
  horario: HorarioObra;
  onAbrir: (a: AsignacionHoras) => void;
  onAsignar?: () => void;
  ultima?: boolean;
}) {
  return (
    <div className={`p-1.5 space-y-1.5 border-r border-border last:border-r-0 ${ultima ? "" : "border-b"}`}>
      {items.map((a) => (
        <Bloque key={a.id} a={a} estado={nucleoPorId.get(a.nucleo_id)?.estado ?? "pendiente"} horario={horario} onClick={() => onAbrir(a)} />
      ))}
      {onAsignar && (
        <button type="button" onClick={onAsignar} className="w-full rounded-md border border-dashed border-ink/10 py-1 text-[11px] text-ink-faint hover:text-[var(--color-brand-800)] hover:border-[var(--color-brand-800)]/40">
          + Asignar
        </button>
      )}
    </div>
  );
}

function Bloque({ a, estado, horario, onClick }: { a: AsignacionHoras; estado: EstadoHorasNucleo; horario: HorarioObra; onClick: () => void }) {
  const atraviesa = calcularTramo(a.hora_inicio, a.hora_fin, horario).atraviesaDescanso;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-surface px-2.5 py-1.5 shadow-[var(--shadow-sm)] hover:border-[var(--color-brand-800)]/40 transition-colors"
      style={{ borderLeft: `3px solid ${BORDE_ESTADO[estado]}` }}
      title={atraviesa ? "Incluye el descanso, que no se cuenta" : undefined}
    >
      <p className="text-[13px] font-semibold text-ink leading-snug break-words">{a.nucleo_nombre}</p>
      <p className="text-xs text-ink-muted">{a.hora_inicio} – {a.hora_fin}</p>
      <p className="text-[11px] text-ink-faint">
        {textoHoras(a.minutos)}
        {atraviesa ? " · descanso descontado" : ""}
      </p>
    </button>
  );
}

function VistaPorNucleo({
  nucleos,
  asignaciones,
  dias,
  todosLosDias,
  onAsignacion,
}: {
  nucleos: NucleoSemana[];
  asignaciones: AsignacionHoras[];
  dias: string[];
  todosLosDias: string[];
  onAsignacion: (a: AsignacionHoras) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-faint border-b border-border bg-surface-sunken/60">
            <th className="py-2.5 px-3 font-semibold">Núcleo</th>
            {dias.map((d) => (
              <th key={d} className="py-2.5 px-2 font-semibold">{NOMBRE_DIA[todosLosDias.indexOf(d)].slice(0, 3)} {d.slice(8, 10)}/{d.slice(5, 7)}</th>
            ))}
            <th className="py-2.5 px-3 font-semibold text-right">Semana</th>
          </tr>
        </thead>
        <tbody>
          {nucleos.map((n) => (
            <tr key={n.id} className="border-b border-border/60 last:border-0 align-top">
              <td className="py-2 px-3 font-medium whitespace-nowrap">{n.nombre}</td>
              {dias.map((d) => {
                const tramos = asignaciones.filter((a) => a.nucleo_id === n.id && a.fecha === d);
                return (
                  <td key={d} className="py-2 px-2">
                    <div className="space-y-1">
                      {tramos.map((a) => (
                        <button key={a.id} type="button" onClick={() => onAsignacion(a)} className="block w-full rounded-md bg-[var(--accent-blue-bg)] px-1.5 py-0.5 text-left text-[11px] text-[var(--color-brand-900)] hover:underline">
                          {a.hora_inicio}–{a.hora_fin} <span className="text-ink-faint">({textoHoras(a.minutos)})</span>
                        </button>
                      ))}
                      {!tramos.length && <span className="text-ink/20">—</span>}
                    </div>
                  </td>
                );
              })}
              <td className="py-2 px-3 text-right whitespace-nowrap">
                <p className="font-semibold">{textoHoras(n.minutos).replace(" h", "")} / {textoHoras(Math.round(n.objetivoHoras * 60))}</p>
                <Badge color={COLOR_ESTADO[n.estado]}>{textoEstadoHoras(n.minutos, n.objetivoHoras)}</Badge>
              </td>
            </tr>
          ))}
          {!nucleos.length && (
            <tr><td colSpan={dias.length + 2} className="py-6 text-center text-ink-faint">No hay núcleos con estos filtros.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DetalleAsignacion({
  a,
  nucleo,
  horario,
  comisionId,
  puedePlanificar,
  onClose,
  onEditar,
}: {
  a: AsignacionHoras;
  nucleo: NucleoSemana | undefined;
  horario: HorarioObra;
  comisionId: number;
  puedePlanificar: boolean;
  onClose: () => void;
  onEditar: () => void;
}) {
  const [cancelando, setCancelando] = useState(false);
  const [estado, formAction] = useActionState(cancelarAsignacionHorasFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) {
      show("Asignación cancelada. Las horas de la semana se actualizaron.");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  const tramo = calcularTramo(a.hora_inicio, a.hora_fin, horario);
  return (
    <Modal open onClose={onClose} title={a.nucleo_nombre}>
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div><dt className="text-xs text-ink-faint">Día</dt><dd className="font-medium">{textoDia(a.fecha)}</dd></div>
          <div><dt className="text-xs text-ink-faint">Horario</dt><dd className="font-medium">{a.hora_inicio} – {a.hora_fin}</dd></div>
          <div><dt className="text-xs text-ink-faint">Horas</dt><dd className="font-medium">{textoHoras(a.minutos)}</dd></div>
          {nucleo && (
            <div>
              <dt className="text-xs text-ink-faint">Semana del núcleo</dt>
              <dd className="font-medium">{textoHoras(nucleo.minutos).replace(" h", "")} / {textoHoras(Math.round(nucleo.objetivoHoras * 60))}</dd>
            </div>
          )}
        </dl>
        {tramo.atraviesaDescanso && (
          <p className="text-xs text-ink-muted">
            Se descuenta el descanso: {tramo.partes.map((p) => `${p.inicio}–${p.fin} (${textoHoras(p.minutos)})`).join(" + ")}.
          </p>
        )}
        {a.observaciones && <p className="text-ink-muted">Observaciones: {a.observaciones}</p>}
        {a.creado_por_nombre && <p className="text-xs text-ink-faint">Asignada por {a.creado_por_nombre}</p>}

        {puedePlanificar && !cancelando && (
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={() => setCancelando(true)}>Cancelar asignación</Button>
            <Button type="button" onClick={onEditar}>Editar o reprogramar</Button>
          </div>
        )}
        {puedePlanificar && cancelando && (
          <form action={formAction} className="space-y-2 pt-2 border-t border-border">
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="comision_id" value={comisionId} />
            <Label>Motivo (opcional)</Label>
            <input name="motivo" className={inputClass} placeholder="Ej: el núcleo avisó que no puede venir" />
            <p className="text-xs text-ink-faint">Deja de contar en las horas de la semana; queda registrada en el historial.</p>
            <FormError message={estado.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelando(false)}>Volver</Button>
              <SubmitButton variant="danger" pendingLabel="Cancelando…">Confirmar cancelación</SubmitButton>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

function FormularioAsignacion({
  comisionId,
  asignacion,
  fechaInicial,
  franja,
  semana,
  dias,
  horario,
  onClose,
}: {
  comisionId: number;
  asignacion: AsignacionHoras | null;
  fechaInicial?: string;
  franja?: "manana" | "tarde";
  semana: SemanaHoras;
  dias: string[];
  horario: HorarioObra;
  onClose: () => void;
}) {
  const editando = !!asignacion;
  const [estado, formAction] = useActionState(editando ? editarAsignacionHorasFormAction : asignarHorasFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  const horas = useMemo(() => opcionesHora(horario), [horario]);
  const [nucleoId, setNucleoId] = useState(asignacion ? String(asignacion.nucleo_id) : "");
  const [fecha, setFecha] = useState(asignacion?.fecha ?? fechaInicial ?? dias[0]);
  const [ini, setIni] = useState(asignacion?.hora_inicio ?? (franja === "tarde" ? horario.descansoFin : horario.inicio));
  const [fin, setFin] = useState(asignacion?.hora_fin ?? (franja === "tarde" ? horario.fin : horario.descansoInicio));
  const cerrado = useRef(false);

  useEffect(() => {
    if (estado.ok && !cerrado.current) {
      cerrado.current = true;
      if (estado.aviso) show(estado.aviso, "warning");
      else show(editando ? "Asignación actualizada." : "Horas asignadas.");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const tramo = calcularTramo(ini, fin, horario);
  const nucleo = semana.nucleos.find((n) => String(n.id) === nucleoId);
  // Proyección de la semana del núcleo con este cambio (sin la versión
  // anterior de esta misma asignación, si se está editando).
  const minutosOtros = nucleo
    ? semana.asignaciones.filter((a) => a.nucleo_id === nucleo.id && a.id !== asignacion?.id).reduce((s, a) => s + a.minutos, 0)
    : 0;
  const total = minutosOtros + (tramo.error ? 0 : tramo.minutos);
  const objetivo = nucleo ? Math.round(nucleo.objetivoHoras * 60) : 0;
  const choque = nucleo
    ? semana.asignaciones.find((a) => a.nucleo_id === nucleo.id && a.fecha === fecha && a.id !== asignacion?.id && seSuperponen(a, { hora_inicio: ini, hora_fin: fin }))
    : undefined;
  const estadoProyectado = nucleo ? estadoHorasNucleo(total, nucleo.objetivoHoras) : null;

  return (
    <Modal open onClose={onClose} title={editando ? "Editar o reprogramar horas" : "Asignar horas"} size="lg">
      <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
        <input type="hidden" name="comision_id" value={comisionId} />
        {asignacion && <input type="hidden" name="id" value={asignacion.id} />}
        <div className="sm:col-span-2">
          <Label required>Núcleo</Label>
          <select name="nucleo_id" required value={nucleoId} onChange={(e) => setNucleoId(e.target.value)} className={inputClass}>
            <option value="" disabled>Elegir núcleo…</option>
            {semana.nucleos.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nombre} — {textoHoras(n.minutos).replace(" h", "")}/{textoHoras(Math.round(n.objetivoHoras * 60))} esta semana
              </option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.nucleo_id} />
        </div>
        <div className="sm:col-span-2">
          <Label required>Día</Label>
          <select name="fecha" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass}>
            {(dias.includes(fecha) ? dias : [fecha, ...dias]).map((d) => (
              <option key={d} value={d}>{textoDia(d)}</option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.fecha} />
        </div>
        <div>
          <Label required>Hora de inicio</Label>
          <select name="hora_inicio" required value={ini} onChange={(e) => setIni(e.target.value)} className={inputClass}>
            {horas.slice(0, -1).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.hora_inicio} />
        </div>
        <div>
          <Label required>Hora de finalización</Label>
          <select name="hora_fin" required value={fin} onChange={(e) => setFin(e.target.value)} className={inputClass}>
            {horas.slice(1).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.hora_fin} />
        </div>

        {/* Cálculo en vivo — el mismo que hace el servidor. */}
        <div className="sm:col-span-2 rounded-xl border border-border bg-surface-sunken/50 px-3 py-2.5 text-sm space-y-1">
          {tramo.error ? (
            <p className="text-[var(--color-rojo)] font-medium">{tramo.error}</p>
          ) : (
            <>
              <p>
                <span className="text-ink-faint">Horas de esta asignación: </span>
                <span className="font-semibold">{textoHoras(tramo.minutos)}</span>
              </p>
              {tramo.atraviesaDescanso && (
                <p className="text-xs text-ink-muted">
                  Atraviesa el descanso, que no se cuenta: {tramo.partes.map((p) => `${p.inicio}–${p.fin} = ${textoHoras(p.minutos)}`).join(" + ")} → {textoHoras(tramo.minutos)}.
                </p>
              )}
            </>
          )}
          {choque && (
            <p className="text-[var(--color-rojo)] text-xs font-medium">
              Se superpone con otro horario de este núcleo ese día ({choque.hora_inicio}–{choque.hora_fin}).
            </p>
          )}
          {nucleo && !tramo.error && (
            <p className={`text-xs font-medium ${estadoProyectado === "exceso" ? "text-[var(--color-naranja)]" : estadoProyectado === "completo" ? "text-[var(--color-verde)]" : "text-ink-muted"}`}>
              {nucleo.nombre} queda con {textoHoras(total).replace(" h", "")} / {textoHoras(objetivo)} esta semana — {textoEstadoHoras(total, nucleo.objetivoHoras)}.
              {estadoProyectado === "exceso" ? " Se puede guardar igual si hay un motivo." : ""}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Label>Observaciones</Label>
          <textarea name="observaciones" rows={2} defaultValue={asignacion?.observaciones ?? ""} className={inputClass} placeholder="Opcional — ej. tarea o sector de la obra" />
          <FieldError message={estado.fieldErrors?.observaciones} />
        </div>
        <div className="sm:col-span-2"><FormError message={estado.error} /></div>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <SubmitButton pendingLabel="Guardando…">{editando ? "Guardar cambios" : "Asignar horas"}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
