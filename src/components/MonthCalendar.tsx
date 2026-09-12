"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import dayjs, { Dayjs } from "dayjs";
import { ChevronLeft, ChevronRight, Pencil, Trash2, Plus } from "lucide-react";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import { FieldError, FormError, useToast } from "./ui-client";

// Calendario visual, compartido entre /calendario (vista completa, con
// navegación de mes) y el Dashboard (versión compacta, semana actual). No
// trae datos propios: recibe los eventos que ya arma cada página (reuniones,
// jornadas, hitos de obra, vencimientos) MÁS las notas de calendario propias
// del sistema (ver lib/actions/calendarioNotas.ts) — texto libre que
// cualquiera puede escribir en una fecha, con su propio color, sin tener que
// pasar por otro módulo. Los eventos que vienen de otro módulo siguen siendo
// de solo lectura acá (llevan a su propia pantalla); las notas se pueden
// crear, editar y borrar desde acá mismo — en el Dashboard o en /calendario,
// las dos pantallas usan las mismas tres acciones.

export type EventoCalendario = {
  id: string;
  fecha: string; // YYYY-MM-DD (o timestamp — se usan los primeros 10 caracteres)
  titulo: string;
  tipo: string;
  href: string;
  hora?: string | null; // HH:mm, solo cuando la fecha de origen tiene hora real (ej: reuniones)
};

export type NotaCalendario = {
  id: number;
  fecha: string; // YYYY-MM-DD
  hora: string | null;
  titulo: string;
  color: string; // brand | verde | amarillo | rojo | gray
  autorNombre: string;
  esPropia: boolean; // si la persona que mira puede editarla/borrarla
};

// Fase 3: las tres acciones ahora son las variantes "FormAction" pensadas
// para useActionState (ver lib/actions/calendarioNotas.ts) — ya no un simple
// `(formData) => void` que dejaba que cualquier error terminara en la
// pantalla genérica de Next.js.
type AccionNota = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

const TIPO_COLOR_DOT: Record<string, string> = {
  reunion: "bg-[var(--color-brand-700)]",
  asamblea: "bg-[var(--color-brand-700)]",
  jornada: "bg-[var(--color-brand-700)]",
  obra: "bg-[var(--color-amarillo)]",
  finanzas: "bg-[var(--color-rojo)]",
  seguridad: "bg-[var(--color-amarillo)]",
};

const TIPO_LABEL: Record<string, string> = {
  reunion: "Reunión",
  asamblea: "Asamblea",
  jornada: "Jornada de trabajo",
  obra: "Obra",
  finanzas: "Vencimiento",
  seguridad: "Seguridad",
};

// Misma paleta que ya usa <Badge> (components/ui.tsx) — así el color que se
// elige para una nota se siente parte del mismo sistema visual, no un color
// suelto inventado para el calendario.
const COLOR_DOT: Record<string, string> = {
  brand: "bg-[var(--color-brand-700)]",
  verde: "bg-[var(--color-verde)]",
  amarillo: "bg-[var(--color-amarillo)]",
  rojo: "bg-[var(--color-rojo)]",
  gray: "bg-ink/40",
};

const COLOR_OPCIONES: { value: string; label: string }[] = [
  { value: "brand", label: "Institucional" },
  { value: "verde", label: "Verde" },
  { value: "amarillo", label: "Amarillo" },
  { value: "rojo", label: "Rojo" },
  { value: "gray", label: "Gris" },
];

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

function isoDate(d: Dayjs) {
  return d.format("YYYY-MM-DD");
}

// Fase 3: formulario de agregar/editar nota como componente aparte, para que
// `useActionState` viva en su propia instancia — con `key` distinto por nota
// (ver más abajo, donde se usa) React lo desmonta y remonta solo al cambiar
// de "agregar" a "editar otra nota", así el estado (error, campo con foco)
// nunca queda pegado de una nota a la siguiente.
function NotaFormulario({
  notaEnEdicion,
  fecha,
  crearNota,
  editarNota,
  onGuardado,
  onCancelar,
}: {
  notaEnEdicion: NotaCalendario | null;
  fecha: string;
  crearNota: AccionNota;
  editarNota: AccionNota;
  onGuardado: () => void;
  onCancelar: () => void;
}) {
  const [estado, formAction] = useActionState(notaEnEdicion ? editarNota : crearNota, ESTADO_INICIAL);

  useEffect(() => {
    if (estado.ok) onGuardado();
    // Solo nos interesa reaccionar cuando cambia el resultado de un envío,
    // no en cada re-render por otro motivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="mt-2 rounded-lg border border-border bg-surface-sunken p-2.5 space-y-2">
      <input type="hidden" name="fecha" value={fecha} />
      {notaEnEdicion && <input type="hidden" name="id" value={notaEnEdicion.id} />}
      <div>
        <input
          name="titulo"
          required
          maxLength={150}
          placeholder="¿Qué hay este día? Ej: Asamblea de fin de año"
          defaultValue={notaEnEdicion?.titulo ?? ""}
          className="w-full rounded-md border border-ink/10 bg-surface px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30"
        />
        <FieldError message={estado.fieldErrors?.titulo} />
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <input
          name="hora"
          type="time"
          defaultValue={notaEnEdicion?.hora ?? ""}
          className="rounded-md border border-ink/10 bg-surface px-2 py-1.5 text-xs"
        />
        <div className="flex gap-1.5">
          {COLOR_OPCIONES.map((c) => (
            <label key={c.value} title={c.label} className="cursor-pointer">
              <input
                type="radio"
                name="color"
                value={c.value}
                defaultChecked={(notaEnEdicion?.color ?? "brand") === c.value}
                className="peer sr-only"
              />
              <span
                className={`block h-5 w-5 rounded-full ${COLOR_DOT[c.value]} ring-2 ring-offset-1 ring-offset-surface-sunken ring-transparent peer-checked:ring-[var(--color-brand-900)]`}
              />
            </label>
          ))}
        </div>
      </div>
      {!estado.ok && <FormError message={estado.error} />}
      <div className="flex items-center gap-3">
        <BotonGuardarNota esEdicion={!!notaEnEdicion} />
        <button type="button" onClick={onCancelar} className="text-xs text-ink-faint underline underline-offset-2">
          Cancelar
        </button>
      </div>
    </form>
  );
}

// Mismo tamaño "chico" que ya tenía este botón antes de Fase 3 (el Button
// compartido de ui.tsx es más grande, pensado para pantallas completas, no
// para un formulario que vive adentro de la celda de un día). useFormStatus
// lee el <form> padre — por eso este botón tiene que ser su propio
// componente, separado de NotaFormulario, y no un simple <button> ahí mismo.
function BotonGuardarNota({ esEdicion }: { esEdicion: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
    >
      {pending ? "Guardando…" : esEdicion ? "Guardar cambios" : "Agregar"}
    </button>
  );
}

// Fase 3: mismo motivo que NotaFormulario — cada nota tiene su propio botón
// de borrar con su propia instancia de useActionState, para que si falla
// (por ejemplo, alguien intenta borrar una nota ajena por una condición de
// carrera) el aviso salga como toast en vez de perderse.
function NotaBorrarForm({ id, eliminarNota }: { id: number; eliminarNota: AccionNota }) {
  const { show } = useToast();
  const [estado, formAction] = useActionState(eliminarNota, ESTADO_INICIAL);

  useEffect(() => {
    if (!estado.ok && estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-ink-faint hover:text-[var(--color-rojo)]" title="Borrar">
        <Trash2 size={12} />
      </button>
    </form>
  );
}

export function MonthCalendar({
  eventos,
  notas = [],
  compact = false,
  verMasHref,
  crearNota,
  editarNota,
  eliminarNota,
}: {
  eventos: EventoCalendario[];
  notas?: NotaCalendario[];
  compact?: boolean;
  verMasHref?: string;
  /** Si no se pasan las tres, la sección de "agregar/editar" no aparece — el
   * calendario queda solo de lectura, como antes. */
  crearNota?: AccionNota;
  editarNota?: AccionNota;
  eliminarNota?: AccionNota;
}) {
  const hoy = dayjs();
  const [mes, setMes] = useState(() => hoy.startOf("month"));
  const [seleccionado, setSeleccionado] = useState<string | null>(() => isoDate(hoy));
  const [notaEditandoId, setNotaEditandoId] = useState<number | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const puedeEscribir = !!(crearNota && editarNota && eliminarNota);

  const eventosPorDia = new Map<string, EventoCalendario[]>();
  for (const e of eventos) {
    const key = e.fecha.slice(0, 10);
    const arr = eventosPorDia.get(key) || [];
    arr.push(e);
    eventosPorDia.set(key, arr);
  }
  const notasPorDia = new Map<string, NotaCalendario[]>();
  for (const n of notas) {
    const arr = notasPorDia.get(n.fecha) || [];
    arr.push(n);
    notasPorDia.set(n.fecha, arr);
  }
  const dotsDia = (key: string) => [
    ...(eventosPorDia.get(key) || []).map((e) => TIPO_COLOR_DOT[e.tipo] || "bg-ink/30"),
    ...(notasPorDia.get(key) || []).map((n) => COLOR_DOT[n.color] || "bg-ink/30"),
  ];

  const eventosSeleccionado = seleccionado ? eventosPorDia.get(seleccionado) || [] : [];
  const notasSeleccionado = seleccionado ? notasPorDia.get(seleccionado) || [] : [];
  const notaEnEdicion = notaEditandoId !== null ? notasSeleccionado.find((n) => n.id === notaEditandoId) || null : null;
  const hayAlgo = eventosSeleccionado.length > 0 || notasSeleccionado.length > 0;

  function cerrarFormulario() {
    setMostrarForm(false);
    setNotaEditandoId(null);
  }

  // Panel de detalle del día elegido: lista de lo que hay +, si se pasaron
  // las acciones de notas, el formulario para agregar o editar. Se usa igual
  // en la versión compacta (Dashboard) y en la completa (/calendario).
  function panelDetalle(tamano: "sm" | "xs") {
    const txt = tamano === "sm" ? "text-sm" : "text-xs";
    const txtChico = "text-[10px]";
    return (
      <div className={`mt-3 ${compact ? "min-h-[1.75rem]" : "min-h-[2.5rem]"}`}>
        {seleccionado ? (
          <>
            {hayAlgo ? (
              <ul className="space-y-1.5">
                {eventosSeleccionado.map((e) => (
                  <li key={e.id}>
                    <Link href={e.href} className={`flex items-center gap-2 ${txt} text-ink hover:underline`}>
                      <span className={`h-2 w-2 rounded-full shrink-0 ${TIPO_COLOR_DOT[e.tipo] || "bg-ink/30"}`} />
                      <span className="truncate">{e.titulo}</span>
                      {e.hora && <span className={`${txtChico} text-ink-faint shrink-0`}>· {e.hora}</span>}
                      <span className={`${txtChico} text-ink-faint shrink-0`}>· {TIPO_LABEL[e.tipo] || e.tipo}</span>
                    </Link>
                  </li>
                ))}
                {notasSeleccionado.map((n) =>
                  n.id === notaEditandoId ? null : (
                    <li key={`n${n.id}`} className="flex items-center justify-between gap-2">
                      <span className={`flex items-center gap-2 ${txt} text-ink min-w-0`}>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${COLOR_DOT[n.color] || "bg-ink/30"}`} />
                        <span className="truncate">{n.titulo}</span>
                        {n.hora && <span className={`${txtChico} text-ink-faint shrink-0`}>· {n.hora}</span>}
                      </span>
                      {n.esPropia && (
                        <span className="flex items-center gap-2 shrink-0">
                          <button type="button" onClick={() => setNotaEditandoId(n.id)} className="text-ink-faint hover:text-[var(--color-brand-800)]" title="Editar">
                            <Pencil size={12} />
                          </button>
                          {eliminarNota && <NotaBorrarForm id={n.id} eliminarNota={eliminarNota} />}
                        </span>
                      )}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className={`${txt} text-ink-faint`}>Nada agendado para el {dayjs(seleccionado).format("D [de] MMMM")}.</p>
            )}

            {puedeEscribir && (mostrarForm || notaEnEdicion) && seleccionado && (
              <NotaFormulario
                key={notaEnEdicion ? `editar-${notaEnEdicion.id}` : "crear"}
                notaEnEdicion={notaEnEdicion}
                fecha={seleccionado}
                crearNota={crearNota!}
                editarNota={editarNota!}
                onGuardado={cerrarFormulario}
                onCancelar={cerrarFormulario}
              />
            )}

            {puedeEscribir && !mostrarForm && !notaEnEdicion && (
              <button
                type="button"
                onClick={() => setMostrarForm(true)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-brand-800)]"
              >
                <Plus size={13} /> Agregar algo para este día
              </button>
            )}
          </>
        ) : (
          <p className={`${txt} text-ink-faint`}>Tocá un día para ver qué hay.</p>
        )}
      </div>
    );
  }

  // Versión compacta (Dashboard): en vez de la grilla del mes completo
  // (5-6 filas), se ve solo la semana actual (lunes a domingo), sin flechas
  // para cambiar de mes — para eso está el botón "Ver calendario completo",
  // que lleva a /calendario, donde sigue estando la grilla mensual.
  if (compact) {
    const inicioSemana = hoy.subtract((hoy.day() + 6) % 7, "day");
    const diasSemana = Array.from({ length: 7 }, (_, i) => inicioSemana.add(i, "day"));
    return (
      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-ink-faint uppercase mb-1">
          {DIAS.map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {diasSemana.map((d, i) => {
            const key = isoDate(d);
            const dots = dotsDia(key);
            const esHoy = key === isoDate(hoy);
            const esSeleccionado = key === seleccionado;
            return (
              <button
                type="button"
                key={i}
                onClick={() => {
                  setSeleccionado(esSeleccionado ? null : key);
                  cerrarFormulario();
                }}
                className={`mx-auto h-9 w-9 rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                  esSeleccionado
                    ? "bg-[var(--color-brand-800)] text-white"
                    : esHoy
                    ? "bg-brand-100 text-[var(--color-brand-900)] font-bold"
                    : "text-ink hover:bg-surface-sunken"
                }`}
              >
                <span>{d.date()}</span>
                {dots.length > 0 && (
                  <span className="flex gap-0.5">
                    {dots.slice(0, 3).map((c, j) => (
                      <span key={j} className={`h-1.5 w-1.5 rounded-full ${esSeleccionado ? "bg-white" : c}`} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {panelDetalle("xs")}

        {verMasHref && (
          <div className="mt-2 text-right">
            <Link href={verMasHref} className="text-xs font-semibold text-[var(--color-brand-800)]">
              Ver calendario completo →
            </Link>
          </div>
        )}
      </div>
    );
  }

  // day() da 0=domingo..6=sábado; acá la semana arranca el lunes.
  const offset = (mes.startOf("month").day() + 6) % 7;
  const diasEnMes = mes.daysInMonth();
  const celdas: (Dayjs | null)[] = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(mes.date(d));
  while (celdas.length % 7 !== 0) celdas.push(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setMes(mes.subtract(1, "month"))}
          aria-label="Mes anterior"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-surface-sunken text-ink-muted"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-bold text-ink capitalize">{mes.format("MMMM YYYY")}</p>
        <button
          type="button"
          onClick={() => setMes(mes.add(1, "month"))}
          aria-label="Mes siguiente"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-surface-sunken text-ink-muted"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-ink-faint uppercase mb-1">
        {DIAS.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celdas.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = isoDate(d);
          const dots = dotsDia(key);
          const esHoy = key === isoDate(hoy);
          const esSeleccionado = key === seleccionado;
          return (
            <button
              type="button"
              key={i}
              onClick={() => {
                setSeleccionado(esSeleccionado ? null : key);
                cerrarFormulario();
              }}
              className={`mx-auto h-10 w-10 rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                esSeleccionado
                  ? "bg-[var(--color-brand-800)] text-white"
                  : esHoy
                  ? "bg-brand-100 text-[var(--color-brand-900)] font-bold"
                  : "text-ink hover:bg-surface-sunken"
              }`}
            >
              <span>{d.date()}</span>
              {dots.length > 0 && (
                <span className="flex gap-0.5">
                  {dots.slice(0, 3).map((c, j) => (
                    <span key={j} className={`h-1.5 w-1.5 rounded-full ${esSeleccionado ? "bg-white" : c}`} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {panelDetalle("sm")}
    </div>
  );
}
