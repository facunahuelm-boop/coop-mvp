"use client";

import { useActionState, useEffect, useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import dayjs, { Dayjs } from "dayjs";
import { ChevronLeft, ChevronRight, Pencil, Trash2, Plus } from "lucide-react";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import { FieldError, FormError, useToast } from "./ui-client";
import { AddButton } from "./ui";
import {
  CATEGORIAS_EVENTO,
  CATEGORIA_EVENTO_LABEL,
  CATEGORIA_EVENTO_NOMBRE,
  CATEGORIA_EVENTO_COLOR_VAR,
  CATEGORIA_EVENTO_COLOR_BG_VAR,
  categoriaDeTipoEvento,
  categoriaDeNota,
  type CategoriaEvento,
} from "@/lib/calendarCategories";

// Calendario visual, compartido entre /calendario (vista completa, con
// navegación de mes) y el Dashboard (versión compacta, semana actual). No
// trae datos propios: recibe los eventos que ya arma cada página (reuniones,
// jornadas, hitos de obra, vencimientos) MÁS las notas de calendario propias
// del sistema (ver lib/actions/calendarioNotas.ts) — texto libre que
// cualquiera puede escribir en una fecha, con su propia categoría, sin tener
// que pasar por otro módulo. Los eventos que vienen de otro módulo siguen
// siendo de solo lectura acá (llevan a su propia pantalla); las notas se
// pueden crear, editar y borrar desde acá mismo — en el Dashboard o en
// /calendario, las dos pantallas usan las mismas tres acciones.
//
// Rediseño del Calendario (15/09, pedido explícito): los cambios grandes de
// esta vuelta son (a) las celdas del mes ahora muestran el CONTENIDO real de
// cada evento/nota (título + hora), no sólo un puntito de color, con un
// "+N más" cuando no entran todos; (b) categorías centralizadas en
// lib/calendarCategories.ts en vez de los 3 mapas tipo→color triplicados que
// había antes; (c) botón "Hoy" y una leyenda chica de categorías; (d) en
// mobile (`sm:hidden`) se reemplaza la grilla del mes — que a ese ancho
// queda ilegible con contenido real adentro — por una vista de agenda
// (lista de los días del mes que tienen algo, en orden); (e) al tocar un día
// VACÍO con permiso de escritura, el formulario de "nuevo" se abre directo,
// sin el paso intermedio de tocar "+ Agregar algo para este día".

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
  color: string; // categoría (ver calendarCategories.ts) — el nombre de columna en la base sigue siendo "color", ver nota en calendarioNotas.ts
  descripcion?: string | null;
  autorNombre: string;
  esPropia: boolean; // si la persona que mira puede editarla/borrarla
};

// Fase 3: las tres acciones ahora son las variantes "FormAction" pensadas
// para useActionState (ver lib/actions/calendarioNotas.ts) — ya no un simple
// `(formData) => void` que dejaba que cualquier error terminara en la
// pantalla genérica de Next.js.
type AccionNota = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

/** Item unificado para pintar una celda/fila del calendario, ya sea que
 * venga de un evento de otro módulo (solo lectura) o de una nota propia
 * (editable). Un solo tipo así el renderizado de celda/agenda no necesita
 * dos caminos distintos para "qué mostrar". */
type ItemDia = {
  key: string;
  categoria: CategoriaEvento;
  titulo: string;
  hora?: string | null;
  href?: string; // sólo eventos de otro módulo
  notaId?: number; // sólo notas propias
};

function fondoSuave(categoria: CategoriaEvento): CSSProperties {
  return {
    color: `var(${CATEGORIA_EVENTO_COLOR_VAR[categoria]})`,
    backgroundColor: `var(${CATEGORIA_EVENTO_COLOR_BG_VAR[categoria]})`,
  };
}
function soloDot(categoria: CategoriaEvento): CSSProperties {
  return { backgroundColor: `var(${CATEGORIA_EVENTO_COLOR_VAR[categoria]})` };
}

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
const MAX_CHIPS_CELDA = 2;

function isoDate(d: Dayjs) {
  return d.format("YYYY-MM-DD");
}

/** Leyenda chica de categorías (pedido explícito: "discreta, no una barra de
 * colores grande") — misma orden/etiquetas en toda la app. */
function LeyendaCategorias() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint mb-2">
      {CATEGORIAS_EVENTO.map((cat) => (
        <span key={cat} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full shrink-0" style={soloDot(cat)} />
          {CATEGORIA_EVENTO_NOMBRE[cat]}
        </span>
      ))}
    </div>
  );
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

  const categoriaActual = categoriaDeNota(notaEnEdicion?.color ?? "personal");

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
      <div className="flex items-center gap-2 flex-wrap">
        <input
          name="hora"
          type="time"
          defaultValue={notaEnEdicion?.hora ?? ""}
          aria-label="Hora"
          className="rounded-md border border-ink/10 bg-surface px-2 py-1.5 text-xs"
        />
        <select
          name="color"
          defaultValue={categoriaActual}
          aria-label="Categoría"
          className="rounded-md border border-ink/10 bg-surface px-2 py-1.5 text-xs flex-1 min-w-[8rem]"
        >
          {CATEGORIAS_EVENTO.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORIA_EVENTO_LABEL[cat]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <textarea
          name="descripcion"
          maxLength={1000}
          rows={2}
          placeholder="Descripción (opcional)"
          defaultValue={notaEnEdicion?.descripcion ?? ""}
          className="w-full rounded-md border border-ink/10 bg-surface px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30"
        />
        <FieldError message={estado.fieldErrors?.descripcion} />
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
      className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-verde)] text-[var(--color-verde)] bg-transparent hover:bg-[var(--color-verde-bg)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50 transition-colors"
    >
      {!pending && <Plus size={13} aria-hidden />}
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

  /** Todo lo que hay en un día, ya normalizado (evento de otro módulo o
   * nota propia) — una sola lista para pintar tanto la celda del mes como
   * la fila de la vista agenda (mobile), ordenada por hora cuando la hay. */
  function itemsDia(key: string): ItemDia[] {
    const items: ItemDia[] = [
      ...(eventosPorDia.get(key) || []).map((e) => ({
        key: `e${e.id}`,
        categoria: categoriaDeTipoEvento(e.tipo),
        titulo: e.titulo,
        hora: e.hora,
        href: e.href,
      })),
      ...(notasPorDia.get(key) || []).map((n) => ({
        key: `n${n.id}`,
        categoria: categoriaDeNota(n.color),
        titulo: n.titulo,
        hora: n.hora,
        notaId: n.id,
      })),
    ];
    items.sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
    return items;
  }

  const eventosSeleccionado = seleccionado ? eventosPorDia.get(seleccionado) || [] : [];
  const notasSeleccionado = seleccionado ? notasPorDia.get(seleccionado) || [] : [];
  const notaEnEdicion = notaEditandoId !== null ? notasSeleccionado.find((n) => n.id === notaEditandoId) || null : null;
  const hayAlgo = eventosSeleccionado.length > 0 || notasSeleccionado.length > 0;

  function cerrarFormulario() {
    setMostrarForm(false);
    setNotaEditandoId(null);
  }

  /** Selecciona (o deselecciona, si ya estaba) un día — y si queda vacío y
   * hay permiso de escritura, abre directo el formulario de "nuevo" (pedido
   * explícito: "tocar un día vacío abre 'Nuevo evento' con esa fecha ya
   * puesta", sin el paso intermedio de tocar "+ Agregar"). */
  function tocarDia(key: string) {
    const eraSeleccionado = key === seleccionado;
    setSeleccionado(eraSeleccionado ? null : key);
    cerrarFormulario();
    const vacio = (eventosPorDia.get(key)?.length ?? 0) === 0 && (notasPorDia.get(key)?.length ?? 0) === 0;
    if (!eraSeleccionado && vacio && puedeEscribir) setMostrarForm(true);
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
                {eventosSeleccionado.map((e) => {
                  const cat = categoriaDeTipoEvento(e.tipo);
                  return (
                    <li key={e.id}>
                      <Link href={e.href} className={`flex items-center gap-2 ${txt} text-ink hover:underline`}>
                        <span className="h-2 w-2 rounded-full shrink-0" style={soloDot(cat)} />
                        <span className="truncate">{e.titulo}</span>
                        {e.hora && <span className={`${txtChico} text-ink-faint shrink-0`}>· {e.hora}</span>}
                        <span className={`${txtChico} text-ink-faint shrink-0`}>· {CATEGORIA_EVENTO_NOMBRE[cat]}</span>
                      </Link>
                    </li>
                  );
                })}
                {notasSeleccionado.map((n) => {
                  if (n.id === notaEditandoId) return null;
                  const cat = categoriaDeNota(n.color);
                  return (
                    <li key={`n${n.id}`} className="flex items-start justify-between gap-2">
                      <span className={`flex flex-col gap-0.5 min-w-0`}>
                        <span className={`flex items-center gap-2 ${txt} text-ink min-w-0`}>
                          <span className="h-2 w-2 rounded-full shrink-0" style={soloDot(cat)} />
                          <span className="truncate">{n.titulo}</span>
                          {n.hora && <span className={`${txtChico} text-ink-faint shrink-0`}>· {n.hora}</span>}
                          <span className={`${txtChico} text-ink-faint shrink-0`}>· {CATEGORIA_EVENTO_NOMBRE[cat]}</span>
                        </span>
                        {n.descripcion && <span className={`${txtChico} text-ink-muted pl-4 truncate`}>{n.descripcion}</span>}
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
                  );
                })}
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
              <AddButton onClick={() => setMostrarForm(true)} className="mt-2 text-xs px-3 py-1.5">
                Agregar algo para este día
              </AddButton>
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
            const items = itemsDia(key);
            const esHoy = key === isoDate(hoy);
            const esSeleccionado = key === seleccionado;
            return (
              <button
                type="button"
                key={i}
                onClick={() => tocarDia(key)}
                className={`mx-auto h-9 w-9 rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                  esSeleccionado
                    ? "bg-[var(--color-brand-800)] text-white"
                    : esHoy
                    ? "bg-brand-100 text-[var(--color-brand-900)] font-bold"
                    : "text-ink hover:bg-surface-sunken"
                }`}
              >
                <span>{d.date()}</span>
                {items.length > 0 && (
                  <span className="flex gap-0.5">
                    {items.slice(0, 3).map((it) => (
                      <span key={it.key} className="h-1.5 w-1.5 rounded-full" style={esSeleccionado ? { backgroundColor: "#fff" } : soloDot(it.categoria)} />
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

  // Vista agenda (mobile, `sm:hidden`): sólo los días del mes visible que
  // tienen algo, en orden — pedido explícito: en una pantalla angosta, una
  // grilla de mes con contenido real adentro de cada celda queda ilegible,
  // así que ahí se reemplaza por una lista.
  const diasConAlgo = celdas.filter((d): d is Dayjs => !!d && itemsDia(isoDate(d)).length > 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <button
          type="button"
          onClick={() => setMes(mes.subtract(1, "month"))}
          aria-label="Mes anterior"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-surface-sunken text-ink-muted shrink-0"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-bold text-ink capitalize truncate">{mes.format("MMMM YYYY")}</p>
          <button
            type="button"
            onClick={() => {
              setMes(hoy.startOf("month"));
              setSeleccionado(isoDate(hoy));
              cerrarFormulario();
            }}
            className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            Hoy
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMes(mes.add(1, "month"))}
          aria-label="Mes siguiente"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-surface-sunken text-ink-muted shrink-0"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <LeyendaCategorias />

      {/* Grilla del mes — sólo desde `sm:` para arriba (ver vista agenda debajo). */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-ink-faint uppercase mb-1">
          {DIAS.map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {celdas.map((d, i) => {
            if (!d) return <div key={i} />;
            const key = isoDate(d);
            const items = itemsDia(key);
            const visibles = items.slice(0, MAX_CHIPS_CELDA);
            const restantes = items.length - visibles.length;
            const esHoy = key === isoDate(hoy);
            const esSeleccionado = key === seleccionado;
            return (
              <div
                key={i}
                className={`rounded-lg border transition-colors min-h-[76px] p-1 flex flex-col gap-0.5 ${
                  esSeleccionado
                    ? "border-[var(--color-brand-800)] bg-brand-50"
                    : "border-border hover:border-ink/20 hover:bg-surface-sunken"
                }`}
              >
                <button
                  type="button"
                  onClick={() => tocarDia(key)}
                  className={`self-start h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs transition-colors ${
                    esSeleccionado
                      ? "bg-[var(--color-brand-800)] text-white font-bold"
                      : esHoy
                      ? "bg-brand-100 text-[var(--color-brand-900)] font-bold"
                      : "text-ink hover:bg-surface"
                  }`}
                >
                  {d.date()}
                </button>
                <div className="flex flex-col gap-0.5 min-w-0">
                  {visibles.map((it) => {
                    const contenido = (
                      <span className="block truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight" style={fondoSuave(it.categoria)}>
                        {it.hora ? `${it.hora} ` : ""}
                        {it.titulo}
                      </span>
                    );
                    return it.href ? (
                      <Link key={it.key} href={it.href}>
                        {contenido}
                      </Link>
                    ) : (
                      <button key={it.key} type="button" onClick={() => tocarDia(key)} className="text-left">
                        {contenido}
                      </button>
                    );
                  })}
                  {restantes > 0 && (
                    <button
                      type="button"
                      onClick={() => tocarDia(key)}
                      className="text-left text-[10px] font-semibold text-ink-faint hover:text-ink px-1"
                    >
                      +{restantes} más
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vista agenda — sólo debajo de `sm:` (ver comentario grande arriba). */}
      <div className="sm:hidden">
        {diasConAlgo.length === 0 ? (
          <p className="text-sm text-ink-faint py-4 text-center">Sin nada agendado este mes.</p>
        ) : (
          <ul className="divide-y divide-border">
            {diasConAlgo.map((d) => {
              const key = isoDate(d);
              const esHoy = key === isoDate(hoy);
              const esSeleccionado = key === seleccionado;
              return (
                <li key={key} className="py-2">
                  <button
                    type="button"
                    onClick={() => tocarDia(key)}
                    className="w-full flex items-center gap-2 text-left"
                  >
                    <span
                      className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        esSeleccionado ? "bg-[var(--color-brand-800)] text-white" : esHoy ? "bg-brand-100 text-[var(--color-brand-900)]" : "bg-surface-sunken text-ink"
                      }`}
                    >
                      {d.date()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-ink-faint capitalize">{d.format("dddd")}</span>
                      <span className="flex flex-col gap-0.5 mt-0.5">
                        {itemsDia(key).map((it) => (
                          <span key={it.key} className="flex items-center gap-1.5 text-sm text-ink truncate">
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={soloDot(it.categoria)} />
                            <span className="truncate">{it.titulo}</span>
                            {it.hora && <span className="text-xs text-ink-faint shrink-0">· {it.hora}</span>}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {puedeEscribir && !seleccionado && (
          <AddButton
            onClick={() => {
              setSeleccionado(isoDate(hoy));
              setMostrarForm(true);
            }}
            className="mt-2 text-xs px-3 py-1.5"
          >
            Agregar evento
          </AddButton>
        )}
      </div>

      {panelDetalle("sm")}
    </div>
  );
}
