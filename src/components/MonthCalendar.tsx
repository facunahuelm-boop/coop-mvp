"use client";

import { useActionState, useEffect, useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import dayjs, { Dayjs } from "dayjs";
import { ChevronLeft, ChevronRight, Pencil, Trash2, Plus } from "lucide-react";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import { FieldError, FormError, useToast, Modal } from "./ui-client";
import { AddButton, Label, inputClass } from "./ui";
import {
  CATEGORIAS_EVENTO,
  CATEGORIAS_ACTIVIDAD,
  COLORES_PERSONALIZADOS,
  COLOR_PERSONALIZADO_LABEL,
  RECORDATORIO_OPCIONES,
  RECORDATORIO_LABEL,
  CATEGORIA_EVENTO_LABEL,
  CATEGORIA_EVENTO_NOMBRE,
  CATEGORIA_EVENTO_COLOR_VAR,
  CATEGORIA_EVENTO_COLOR_BG_VAR,
  categoriaDeTipoEvento,
  categoriaDeNota,
  nombreCategoriaActividad,
  colorVarDeActividad,
  colorBgVarDeActividad,
  type CategoriaEvento,
} from "@/lib/calendarCategories";

// Calendario visual, compartido entre /calendario (vista completa, con
// navegación de mes) y el Dashboard (versión compacta, semana actual). No
// trae datos propios: recibe los eventos que ya arma cada página (reuniones,
// jornadas, hitos de obra, vencimientos) MÁS las actividades propias del
// sistema (ver lib/actions/calendarioNotas.ts) — creadas directo desde acá,
// con su propia categoría, sin tener que pasar por otro módulo. Los eventos
// que vienen de otro módulo siguen siendo de solo lectura acá (llevan a su
// propia pantalla, sin ningún cambio); las actividades se pueden crear,
// editar y borrar desde acá mismo — en el Dashboard o en /calendario, las dos
// pantallas usan las mismas tres acciones.
//
// Rediseño del Calendario, Etapa 1 (25/09, pedido explícito de 32 puntos):
// la "nota de calendario" (texto + categoría nada más) pasa a ser una
// "actividad" rica — responsable, comisión, ubicación, todo el día, color
// propio para personalizadas y recordatorio — y la interacción cambia de
// "un formulario que se abre adentro de la celda" a modales chicos,
// reusando el componente Modal ya existente en el resto del sistema (mismo
// criterio ya usado en TareaDetalleModal/SubirNuevaVersionForm):
//   - Doble clic en un día vacío → modal "Nueva actividad" con esa fecha ya
//     puesta.
//   - Clic simple en una actividad → modal chico de resumen (con Editar y
//     Eliminar).
//   - Doble clic en una actividad → modal de "Editar actividad" directo.
// Un clic simple en el día (sin doble clic) sigue sólo seleccionando/
// resaltando el día, como antes — ya no abre ningún formulario solo.

export type EventoCalendario = {
  id: string;
  fecha: string; // YYYY-MM-DD (o timestamp — se usan los primeros 10 caracteres)
  titulo: string;
  tipo: string;
  href: string;
  hora?: string | null; // HH:mm, solo cuando la fecha de origen tiene hora real (ej: reuniones)
};

/** Rediseño del Calendario, Etapa 1: "nota" ahora es una actividad rica —
 * ver el comentario grande de calendarioNotas.ts sobre por qué el nombre de
 * tipo/tabla/funciones sigue diciendo "Nota". `color` puede ser `null`
 * ("sin categoría", punto 8 del pedido: no obligar a elegir una). */
export type NotaCalendario = {
  id: number;
  fecha: string; // YYYY-MM-DD
  hora: string | null;
  todoElDia: boolean;
  titulo: string;
  color: string | null; // categoría (ver calendarCategories.ts) — la columna en la base sigue llamándose "color"
  colorPersonalizado: string | null; // sólo aplica cuando color === "personalizada"
  descripcion?: string | null;
  responsableId: number | null;
  responsableNombre: string | null;
  comisionId: number | null;
  comisionNombre: string | null;
  ubicacion: string | null;
  recordatorio: string | null;
  autorNombre: string;
  esPropia: boolean; // si la persona que mira puede editarla/borrarla
};

type Opcion = { id: number; nombre: string };

// Fase 3: las tres acciones son las variantes "FormAction" pensadas para
// useActionState (ver lib/actions/calendarioNotas.ts) — cualquier error de
// negocio (fecha inválida, sin permiso, etc.) sale como aviso, no como la
// pantalla genérica de error de Next.js.
type AccionNota = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

/** Item unificado para pintar una celda/fila del calendario, ya sea que
 * venga de un evento de otro módulo (solo lectura) o de una actividad propia
 * (editable) — colores ya resueltos acá (no un enum de categoría) para que
 * el renderizado no necesite saber de dónde salió cada item. */
type ItemDia = {
  key: string;
  colorVar: string;
  bgVar: string;
  categoriaNombre: string;
  titulo: string;
  hora?: string | null;
  href?: string; // sólo eventos de otro módulo
  nota?: NotaCalendario; // sólo actividades propias
};

/** Estado de los 3 modales posibles — mutuamente excluyentes, un solo
 * `useState` en vez de la pareja `notaEditandoId`/`mostrarForm` que había
 * antes (ambos representaban en el fondo "qué modal está abierto"). */
type ModalEstado =
  | { tipo: "crear"; fecha: string }
  | { tipo: "editar"; nota: NotaCalendario }
  | { tipo: "resumen"; nota: NotaCalendario }
  | null;

function fondoSuave(colorVar: string, bgVar: string): CSSProperties {
  return { color: `var(${colorVar})`, backgroundColor: `var(${bgVar})` };
}
function soloDot(colorVar: string): CSSProperties {
  return { backgroundColor: `var(${colorVar})` };
}

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
const MAX_CHIPS_CELDA = 2;

function isoDate(d: Dayjs) {
  return d.format("YYYY-MM-DD");
}

/** Leyenda chica de categorías (pedido explícito: "discreta, no una barra de
 * colores grande") — misma orden/etiquetas en toda la app; cubre las 13
 * categorías realmente en uso (las 6 originales que siguen viniendo de otros
 * módulos + las 7 nuevas de la actividad enriquecida). */
function LeyendaCategorias() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint mb-2">
      {CATEGORIAS_EVENTO.map((cat) => (
        <span key={cat} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full shrink-0" style={soloDot(CATEGORIA_EVENTO_COLOR_VAR[cat])} />
          {CATEGORIA_EVENTO_NOMBRE[cat]}
        </span>
      ))}
    </div>
  );
}

// Mismo tamaño "chico" que ya tenía este botón antes de Fase 3 (el Button
// compartido de ui.tsx es más grande, pensado para pantallas completas, no
// para un modal chico). useFormStatus lee el <form> padre — por eso este
// botón tiene que ser su propio componente, separado del formulario.
function BotonGuardarActividad({ esEdicion }: { esEdicion: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-verde)] text-[var(--color-verde)] bg-transparent hover:bg-[var(--color-verde-bg)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50 transition-colors"
    >
      {!pending && <Plus size={13} aria-hidden />}
      {pending ? "Guardando…" : esEdicion ? "Guardar cambios" : "Guardar actividad"}
    </button>
  );
}

// Formulario de "Nueva actividad" / "Editar actividad" — vive entero adentro
// de `children` del Modal (ver ui-client.tsx: `children` y `footer` son
// divs hermanos, no anidados, así que un único <form> que tenga que incluir
// los botones no puede repartirse entre los dos; mismo patrón que ya usa
// SubirNuevaVersionForm en DocumentosFormularios.tsx). `key` distinto por
// actividad (ver donde se instancia, más abajo) para que React lo desmonte y
// remonte solo al cambiar de actividad, así ningún estado (categoría
// elegida, "todo el día") queda pegado de una a la siguiente.
function ActividadFormulario({
  fecha,
  notaEnEdicion,
  comisiones,
  usuarios,
  crearNota,
  editarNota,
  onGuardado,
  onCancelar,
}: {
  fecha: string;
  notaEnEdicion: NotaCalendario | null;
  comisiones: Opcion[];
  usuarios: Opcion[];
  crearNota: AccionNota;
  editarNota: AccionNota;
  onGuardado: () => void;
  onCancelar: () => void;
}) {
  const [estado, formAction] = useActionState(notaEnEdicion ? editarNota : crearNota, ESTADO_INICIAL);
  const [categoria, setCategoria] = useState<CategoriaEvento | "">(categoriaDeNota(notaEnEdicion?.color ?? null) ?? "");
  const [todoElDia, setTodoElDia] = useState(notaEnEdicion?.todoElDia ?? false);

  useEffect(() => {
    if (estado.ok) onGuardado();
    // Sólo interesa reaccionar cuando cambia el resultado de un envío.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="space-y-2.5">
      {notaEnEdicion && <input type="hidden" name="id" value={notaEnEdicion.id} />}

      <div>
        <Label>Título</Label>
        <input
          name="titulo"
          required
          autoFocus
          maxLength={150}
          placeholder="¿Qué hay que hacer o recordar?"
          defaultValue={notaEnEdicion?.titulo ?? ""}
          className={inputClass}
        />
        <FieldError message={estado.fieldErrors?.titulo} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Label>Fecha</Label>
          <input name="fecha" type="date" required defaultValue={notaEnEdicion?.fecha ?? fecha} className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha} />
        </div>
        <div>
          <Label>Tipo</Label>
          <select
            name="color"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as CategoriaEvento | "")}
            className={inputClass}
          >
            <option value="">Sin categoría</option>
            {CATEGORIAS_ACTIVIDAD.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORIA_EVENTO_LABEL[cat]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {categoria === "personalizada" && (
        <div>
          <Label>Color</Label>
          <select name="color_personalizado" defaultValue={notaEnEdicion?.colorPersonalizado ?? "gris"} className={inputClass}>
            {COLORES_PERSONALIZADOS.map((c) => (
              <option key={c} value={c}>
                {COLOR_PERSONALIZADO_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 items-end">
        <div>
          <Label>Hora</Label>
          <input
            name="hora"
            type="time"
            disabled={todoElDia}
            defaultValue={notaEnEdicion?.hora ?? ""}
            className={`${inputClass} ${todoElDia ? "opacity-40" : ""}`}
          />
          <FieldError message={estado.fieldErrors?.hora} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted pb-2 cursor-pointer">
          <input
            type="checkbox"
            name="todo_el_dia"
            checked={todoElDia}
            onChange={(e) => setTodoElDia(e.target.checked)}
            className="rounded border-ink/20"
          />
          Todo el día
        </label>
      </div>

      <div>
        <Label>Descripción</Label>
        <textarea
          name="descripcion"
          maxLength={1000}
          rows={2}
          placeholder="Opcional"
          defaultValue={notaEnEdicion?.descripcion ?? ""}
          className={`${inputClass} resize-none`}
        />
        <FieldError message={estado.fieldErrors?.descripcion} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Label>Responsable</Label>
          <select name="responsable_id" defaultValue={notaEnEdicion?.responsableId ?? ""} className={inputClass}>
            <option value="">Sin asignar</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Comisión</Label>
          <select name="comision_id" defaultValue={notaEnEdicion?.comisionId ?? ""} className={inputClass}>
            <option value="">Ninguna</option>
            {comisiones.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label>Ubicación</Label>
        <input name="ubicacion" maxLength={200} placeholder="Opcional" defaultValue={notaEnEdicion?.ubicacion ?? ""} className={inputClass} />
        <FieldError message={estado.fieldErrors?.ubicacion} />
      </div>

      <div>
        <Label>Recordatorio</Label>
        <select name="recordatorio" defaultValue={notaEnEdicion?.recordatorio ?? "ninguno"} className={inputClass}>
          {RECORDATORIO_OPCIONES.map((r) => (
            <option key={r} value={r}>
              {RECORDATORIO_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      {!estado.ok && <FormError message={estado.error} />}

      <div className="flex items-center justify-end gap-3 pt-1">
        <button type="button" onClick={onCancelar} className="text-xs text-ink-faint underline underline-offset-2">
          Cancelar
        </button>
        <BotonGuardarActividad esEdicion={!!notaEnEdicion} />
      </div>
    </form>
  );
}

// Modal chico de resumen (punto 13 del pedido): clic simple en una actividad
// ya guardada — título, tipo, fecha/hora, descripción, responsable, comisión
// y ubicación, con Editar/Eliminar. "Estado" y "Ver detalles" del pedido
// original quedan deliberadamente afuera: esta actividad no tiene concepto
// de estado ni una pantalla de detalle propia aparte de este mismo resumen
// (documentado en el CHANGELOG de esta etapa).
function ActividadResumen({
  nota,
  eliminarNota,
  onEditar,
  onCerrar,
}: {
  nota: NotaCalendario;
  eliminarNota: AccionNota;
  onEditar: () => void;
  onCerrar: () => void;
}) {
  const categoria = categoriaDeNota(nota.color);
  const colorVar = colorVarDeActividad(categoria, nota.colorPersonalizado);
  const [estado, formAction] = useActionState(eliminarNota, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) onCerrar();
    if (!estado.ok && estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <div className="space-y-3">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: `var(${colorVar})` }}>
        <span className="h-2 w-2 rounded-full shrink-0" style={soloDot(colorVar)} />
        {nombreCategoriaActividad(categoria)}
      </span>

      <p className="text-xs text-ink-muted">
        {dayjs(nota.fecha).format("dddd D [de] MMMM YYYY")}
        {nota.todoElDia ? " · Todo el día" : nota.hora ? ` · ${nota.hora}` : ""}
      </p>

      {nota.descripcion && <p className="text-sm text-ink/80 whitespace-pre-wrap">{nota.descripcion}</p>}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted pt-1 border-t border-border">
        <p className="pt-2">Responsable: {nota.responsableNombre ?? "Sin asignar"}</p>
        <p className="pt-2">Comisión: {nota.comisionNombre ?? "Ninguna"}</p>
        {nota.ubicacion && <p className="col-span-2">Ubicación: {nota.ubicacion}</p>}
      </div>

      {nota.esPropia && (
        <div className="flex items-center justify-end gap-4 pt-2 border-t border-border">
          <form action={formAction}>
            <input type="hidden" name="id" value={nota.id} />
            <button type="submit" className="inline-flex items-center gap-1 text-xs text-[var(--color-rojo)] hover:underline underline-offset-2">
              <Trash2 size={12} /> Eliminar
            </button>
          </form>
          <button
            type="button"
            onClick={onEditar}
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-verde)] text-[var(--color-verde)] hover:bg-[var(--color-verde-bg)] px-3 py-1.5 text-xs font-semibold"
          >
            <Pencil size={12} /> Editar
          </button>
        </div>
      )}
    </div>
  );
}

export function MonthCalendar({
  eventos,
  notas = [],
  comisiones = [],
  usuarios = [],
  compact = false,
  verMasHref,
  crearNota,
  editarNota,
  eliminarNota,
}: {
  eventos: EventoCalendario[];
  notas?: NotaCalendario[];
  /** Para los selects de Responsable/Comisión del formulario — si no se
   * pasan, esos selects sólo ofrecen "Sin asignar"/"Ninguna" (nunca bloquean
   * guardar, punto 25 del pedido: sólo título+fecha son obligatorios). */
  comisiones?: Opcion[];
  usuarios?: Opcion[];
  compact?: boolean;
  verMasHref?: string;
  /** Si no se pasan las tres, no aparece ninguna forma de crear/editar — el
   * calendario queda solo de lectura, como antes. */
  crearNota?: AccionNota;
  editarNota?: AccionNota;
  eliminarNota?: AccionNota;
}) {
  const hoy = dayjs();
  const [mes, setMes] = useState(() => hoy.startOf("month"));
  const [seleccionado, setSeleccionado] = useState<string | null>(() => isoDate(hoy));
  const [modal, setModal] = useState<ModalEstado>(null);
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
   * actividad propia) con sus colores de categoría ya resueltos — una sola
   * lista para pintar tanto la celda del mes como la vista agenda/panel de
   * detalle, ordenada por hora cuando la hay. */
  function itemsDia(key: string): ItemDia[] {
    const items: ItemDia[] = [
      ...(eventosPorDia.get(key) || []).map((e) => {
        const cat = categoriaDeTipoEvento(e.tipo);
        return {
          key: `e${e.id}`,
          colorVar: CATEGORIA_EVENTO_COLOR_VAR[cat],
          bgVar: CATEGORIA_EVENTO_COLOR_BG_VAR[cat],
          categoriaNombre: CATEGORIA_EVENTO_NOMBRE[cat],
          titulo: e.titulo,
          hora: e.hora,
          href: e.href,
        };
      }),
      ...(notasPorDia.get(key) || []).map((n) => {
        const cat = categoriaDeNota(n.color);
        return {
          key: `n${n.id}`,
          colorVar: colorVarDeActividad(cat, n.colorPersonalizado),
          bgVar: colorBgVarDeActividad(cat, n.colorPersonalizado),
          categoriaNombre: nombreCategoriaActividad(cat),
          titulo: n.titulo,
          hora: n.todoElDia ? null : n.hora,
          nota: n,
        };
      }),
    ];
    items.sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
    return items;
  }

  /** Clic simple en un día: sólo selecciona/resalta (o deselecciona, si ya
   * estaba) — ya NO abre ningún formulario solo (eso ahora es doble clic,
   * ver dobleClickDia). */
  function tocarDia(key: string) {
    setSeleccionado(key === seleccionado ? null : key);
  }

  /** Doble clic en un día vacío o no (punto 3 del pedido): abre "Nueva
   * actividad" con esa fecha ya puesta. */
  function dobleClickDia(key: string) {
    if (!puedeEscribir) return;
    setSeleccionado(key);
    setModal({ tipo: "crear", fecha: key });
  }

  function abrirResumen(nota: NotaCalendario) {
    setModal({ tipo: "resumen", nota });
  }
  /** Doble clic en una actividad ya guardada (punto 14): abre "Editar
   * actividad" directo. Si la persona no puede editarla (no es propia ni
   * admin/consejo), se degrada al resumen — no debería llegar acá con el
   * botón de Editar ya oculto, pero un doble clic directo en la celda igual
   * podría intentarlo. */
  function abrirEditar(nota: NotaCalendario) {
    if (!nota.esPropia) {
      abrirResumen(nota);
      return;
    }
    setModal({ tipo: "editar", nota });
  }
  function cerrarModal() {
    setModal(null);
  }

  // Panel de detalle del día elegido: lista de lo que hay ese día. Los
  // eventos de otro módulo siguen siendo un <Link> de solo lectura; las
  // actividades propias abren el modal de resumen (clic) o edición (doble
  // clic) — ya no tienen un formulario ni botones de editar/borrar sueltos
  // acá, todo eso vive en el modal. Se usa igual en la versión compacta
  // (Dashboard) y en la completa (/calendario).
  function panelDetalle(tamano: "sm" | "xs") {
    const txt = tamano === "sm" ? "text-sm" : "text-xs";
    const txtChico = "text-[10px]";
    const items = seleccionado ? itemsDia(seleccionado) : [];
    return (
      <div className={`mt-3 ${compact ? "min-h-[1.75rem]" : "min-h-[2.5rem]"}`}>
        {seleccionado ? (
          <>
            {items.length > 0 ? (
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <li key={it.key}>
                    {it.href ? (
                      <Link href={it.href} className={`flex items-center gap-2 ${txt} text-ink hover:underline`}>
                        <span className="h-2 w-2 rounded-full shrink-0" style={soloDot(it.colorVar)} />
                        <span className="truncate">{it.titulo}</span>
                        {it.hora && <span className={`${txtChico} text-ink-faint shrink-0`}>· {it.hora}</span>}
                        <span className={`${txtChico} text-ink-faint shrink-0`}>· {it.categoriaNombre}</span>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => abrirResumen(it.nota!)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          abrirEditar(it.nota!);
                        }}
                        className={`w-full flex items-center gap-2 ${txt} text-ink text-left hover:underline underline-offset-2`}
                      >
                        <span className="h-2 w-2 rounded-full shrink-0" style={soloDot(it.colorVar)} />
                        <span className="truncate">{it.titulo}</span>
                        {it.nota?.todoElDia ? (
                          <span className={`${txtChico} text-ink-faint shrink-0`}>· Todo el día</span>
                        ) : (
                          it.hora && <span className={`${txtChico} text-ink-faint shrink-0`}>· {it.hora}</span>
                        )}
                        <span className={`${txtChico} text-ink-faint shrink-0`}>· {it.categoriaNombre}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`${txt} text-ink-faint`}>Nada agendado para el {dayjs(seleccionado).format("D [de] MMMM")}.</p>
            )}

            {puedeEscribir && (
              <AddButton onClick={() => setModal({ tipo: "crear", fecha: seleccionado })} className="mt-2 text-xs px-3 py-1.5">
                Nueva actividad
              </AddButton>
            )}
          </>
        ) : (
          <p className={`${txt} text-ink-faint`}>Tocá un día para ver qué hay — doble clic para agregar una actividad.</p>
        )}
      </div>
    );
  }

  // Los dos modales de actividad (crear/editar comparten formulario;
  // resumen es su propio contenido) — se instancian una sola vez acá abajo,
  // fuera de la grilla, sin importar en qué celda se hayan disparado.
  const modalesActividad = puedeEscribir && (
    <>
      <Modal
        open={modal?.tipo === "crear" || modal?.tipo === "editar"}
        onClose={cerrarModal}
        title={modal?.tipo === "editar" ? "Editar actividad" : "Nueva actividad"}
        size="lg"
      >
        {modal && (modal.tipo === "crear" || modal.tipo === "editar") && (
          <ActividadFormulario
            key={modal.tipo === "editar" ? `editar-${modal.nota.id}` : `crear-${modal.fecha}`}
            fecha={modal.tipo === "crear" ? modal.fecha : modal.nota.fecha}
            notaEnEdicion={modal.tipo === "editar" ? modal.nota : null}
            comisiones={comisiones}
            usuarios={usuarios}
            crearNota={crearNota!}
            editarNota={editarNota!}
            onGuardado={cerrarModal}
            onCancelar={cerrarModal}
          />
        )}
      </Modal>

      <Modal open={modal?.tipo === "resumen"} onClose={cerrarModal} title={modal?.tipo === "resumen" ? modal.nota.titulo : ""} size="md">
        {modal && modal.tipo === "resumen" && (
          <ActividadResumen
            nota={modal.nota}
            eliminarNota={eliminarNota!}
            onEditar={() => setModal({ tipo: "editar", nota: modal.nota })}
            onCerrar={cerrarModal}
          />
        )}
      </Modal>
    </>
  );

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
                onDoubleClick={() => dobleClickDia(key)}
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
                      <span key={it.key} className="h-1.5 w-1.5 rounded-full" style={esSeleccionado ? { backgroundColor: "#fff" } : soloDot(it.colorVar)} />
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

        {modalesActividad}
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
                onDoubleClick={() => dobleClickDia(key)}
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
                      <span className="block truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight" style={fondoSuave(it.colorVar, it.bgVar)}>
                        {it.hora ? `${it.hora} ` : it.nota?.todoElDia ? "Todo el día · " : ""}
                        {it.titulo}
                      </span>
                    );
                    return it.href ? (
                      <Link key={it.key} href={it.href}>
                        {contenido}
                      </Link>
                    ) : (
                      <button
                        key={it.key}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirResumen(it.nota!);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          abrirEditar(it.nota!);
                        }}
                        className="text-left"
                      >
                        {contenido}
                      </button>
                    );
                  })}
                  {restantes > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        tocarDia(key);
                      }}
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
                  <button type="button" onClick={() => tocarDia(key)} onDoubleClick={() => dobleClickDia(key)} className="w-full flex items-center gap-2 text-left">
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
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={soloDot(it.colorVar)} />
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
              setModal({ tipo: "crear", fecha: isoDate(hoy) });
            }}
            className="mt-2 text-xs px-3 py-1.5"
          >
            Nueva actividad
          </AddButton>
        )}
      </div>

      {panelDetalle("sm")}

      {modalesActividad}
    </div>
  );
}
