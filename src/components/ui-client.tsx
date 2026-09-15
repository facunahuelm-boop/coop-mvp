"use client";

// Fase A del rediseño UI/UX: piezas interactivas que no existían todavía
// (Modal, diálogo de confirmación, avisos de guardado/error). Van en un
// archivo aparte de ui.tsx porque necesitan "use client" (manejan estado y
// eventos de teclado) — así ui.tsx sigue siendo liviano para las pantallas
// que sólo renderizan datos del servidor.
//
// Todavía no están conectados a ninguna pantalla: se usan a partir de la
// Fase B, cuando reemplacemos los "¿estás seguro?" implícitos (o inexistentes)
// por confirmaciones y avisos con palabras humanas.

import { createContext, useActionState, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { X, Plus } from "lucide-react";
import { Button } from "./ui";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";

// Rediseño del Inicio (dashboard): los nuevos modales de detalle (Finanzas,
// Tareas, Calendario, una Comisión con muchos integrantes/tareas/gastos...)
// necesitan más espacio que el `max-w-md` pensado originalmente para
// confirmaciones cortas — "no hacer pop-ups innecesariamente pequeños"
// (pedido explícito). `size` es opcional y con `showClose` en true por
// default: quien no pasa ninguno de los dos (todo el código existente hoy,
// vía ConfirmDialog) obtiene EXACTAMENTE el mismo `max-w-md` de antes; el
// botón de cerrar es nuevo pero no interfiere con nada existente (Escape y
// click afuera ya cerraban el modal igual).
const MODAL_SIZES = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function Modal({
  open, onClose, title, children, footer, size = "md", showClose = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof MODAL_SIZES;
  showClose?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 animate-[fadeIn_0.15s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative w-full ${MODAL_SIZES[size]} max-h-[85vh] overflow-y-auto rounded-2xl bg-surface p-5 shadow-[var(--shadow-lg)] animate-[scaleIn_0.15s_ease-out]`}
      >
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-3.5 right-3.5 inline-flex items-center justify-center h-8 w-8 rounded-full text-ink-faint hover:bg-surface-sunken hover:text-ink"
          >
            <X size={17} />
          </button>
        )}
        <h2 className="text-lg font-semibold text-ink mb-2 pr-8">{title}</h2>
        {children && <div className="text-sm text-ink-muted">{children}</div>}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// Reemplaza a los confirm() nativos del navegador (que además de verse feos,
// bloquean la pestaña entera). Pensado para texto humano: "¿Eliminar a Juan
// Pérez de la lista de espera?" en vez de "¿Confirma la operación?".
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Sí, continuar",
  cancelLabel = "Cancelar",
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description}
    </Modal>
  );
}

// Avisos de guardado/error ("Cambios guardados", "No se pudo guardar, probá
// de nuevo") — para que cada acción tenga una confirmación visible en vez de
// que la pantalla simplemente se quede como estaba.
//
// Rediseño de mensajes de error/feedback (15/09, pedido explícito): el
// pedido nombra 4 variantes de estado (🟢 éxito, 🟡 advertencia, 🔴 error,
// 🔵 info) — antes sólo existían "ok"/"error". Se agregan "warning"/"info"
// reusando los mismos tokens de color que ya usa el resto del sistema para
// ese mismo significado (--color-amarillo, --color-info), nada nuevo. Se
// suma además un botón de cierre manual (antes sólo desaparecía solo a los
// 4s, sin forma de cerrarlo ni de volver a leerlo con lector de pantalla
// tranquilo) y `aria-live="polite"` en el contenedor, explícito por
// accesibilidad — pedido del sistema para adultos mayores/lectores de
// pantalla, antes dependía sólo del `role="status"` implícito de cada toast.
type ToastTone = "ok" | "error" | "warning" | "info";
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastContextValue = { show: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_STYLES: Record<ToastTone, string> = {
  ok: "bg-[var(--color-verde-bg)] text-[var(--color-verde)]",
  error: "bg-[var(--color-rojo-bg)] text-[var(--color-rojo)]",
  warning: "bg-[var(--color-amarillo-bg)] text-[var(--color-amarillo)]",
  info: "bg-[var(--color-info-bg)] text-[var(--color-info)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const cerrar = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((message: string, tone: ToastTone = "ok") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => cerrar(id), 4000);
  }, [cerrar]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="fixed bottom-4 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none safe-bottom"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto max-w-sm w-full sm:w-auto rounded-xl pl-4 pr-2 py-2 text-sm font-medium shadow-[var(--shadow-md)] flex items-center gap-2 ${TOAST_STYLES[t.tone]}`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => cerrar(t.id)}
              aria-label="Cerrar aviso"
              className="shrink-0 rounded-full p-1 hover:bg-black/10 transition-colors"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

// Rediseño "Color secundario + Top Bar" (puntos 9-10 del pedido): la nueva
// Top Bar necesita un botón "Buscar" visible que abra el buscador global que
// YA EXISTÍA (CommandPalette, Fase 11) — hasta ahora sólo se podía abrir con
// el atajo de teclado Ctrl+K, sin ningún control visible en la pantalla. En
// vez de reconstruir el buscador (tiene su propia lógica de debounce,
// teclado, resultados — ver CommandPalette.tsx), se saca únicamente el
// abierto/cerrado a este contexto chico: CommandPalette seguirá
// comportándose exactamente igual que antes (Ctrl+K, Escape, click afuera),
// y el nuevo botón de la Top Bar sólo necesita poder abrirlo.
type CommandPaletteContextValue = { abierto: boolean; abrir: () => void; cerrar: () => void; toggle: () => void };
const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => setAbierto(false), []);
  const toggle = useCallback(() => setAbierto((v) => !v), []);
  return <CommandPaletteContext.Provider value={{ abierto, abrir, cerrar, toggle }}>{children}</CommandPaletteContext.Provider>;
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette debe usarse dentro de <CommandPaletteProvider>");
  return ctx;
}

// Fase 3 (sistema global de errores y validaciones): piezas chicas y
// reutilizables para los formularios que se van convirtiendo a
// `useActionState` (ver src/lib/actionState.ts). Antes de esto, cada
// formulario que quisiera mostrar un error tenía que inventar su propio
// mensaje suelto en rojo (o directamente no mostraba nada y el error se
// perdía en la pantalla genérica de Next.js) — estos tres componentes le dan
// una sola forma consistente en toda la app.

/** Mensaje de error general de un formulario (regla de negocio, permiso,
 * error de servidor) — no ligado a un campo puntual. Se ubica arriba del
 * formulario o antes de los botones, según convenga a cada pantalla. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-[var(--color-rojo-bg)] px-3 py-2 text-sm font-medium text-[var(--color-rojo)]"
    >
      {message}
    </p>
  );
}

/** Error puntual de un campo (`fieldErrors` de ActionState) — va justo debajo
 * del input al que corresponde, no mezclado con el resto. */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-sm font-medium text-[var(--color-rojo)]">
      {message}
    </p>
  );
}

/** Botón de submit que se deshabilita solo y cambia de texto mientras la
 * Server Action está en curso (useFormStatus lee el <form> padre, así que
 * este componente tiene que vivir DENTRO del <form>, no al lado). Reemplaza
 * al viejo patrón de "Button type=submit" suelto, que dejaba hacer doble
 * click y mandar la acción dos veces mientras la primera todavía no volvía. */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "add";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className={className} disabled={pending}>
      {/* Rediseño de botones "Agregar" (15/09): con variant="add" siempre
          lleva el ícono "+" mientras no está mandando el formulario — mismo
          look que AddButton/AddButtonSummary (ui.tsx), para que un botón de
          "Crear X" que SÍ hace submit directo (Pattern B del audit, sin
          <details> de por medio) se vea idéntico al resto de la familia. */}
      {variant === "add" && !pending && <Plus size={16} aria-hidden />}
      {pending ? pendingLabel || "Guardando…" : children}
    </Button>
  );
}

/**
 * Endurecimiento de errores (pasada posterior a la Fase 4): las acciones
 * simples de un solo clic sin campos que validar (Archivar, Marcar
 * resuelto/pagado, Confirmar, Quitar, Cancelar, los toggles por fila) seguían
 * usando `<form action={accionCruda}>` directo — si el servidor rechazaba
 * algo (un permiso, una regla de negocio como "esta solicitud ya fue
 * decidida", incluso un error técnico ya traducido por `conEstadoDeAccion`),
 * el mensaje se perdía: `error.tsx` (boundary global) REDACTA el `.message`
 * real en producción y sólo muestra "Ocurrió un problema", tirando a la
 * persona a una pantalla de error de página completa por algo que a veces es
 * tan simple como "ese gasto ya está pagado".
 *
 * `ActionForm` es un reemplazo directo de `<form action={...}>`: se le pasa
 * la versión ya envuelta con `conEstadoDeAccion` (`xFormAction`, mismo
 * patrón que los formularios de la Fase 4) y muestra el resultado como toast
 * en vez de dejar que reviente la pantalla — sin agregar campos, sin cambiar
 * el resto del formulario (los hijos se pasan tal cual: inputs ocultos,
 * inputs visibles, el botón). No hace falta `FieldError`/`FormError` porque
 * estas acciones no tienen campos de usuario que validar.
 */
/**
 * Rediseño profundo de Compras, Fase 3 (pedido explícito, sección 16: el
 * detalle de una compra debe organizarse en pestañas — Información /
 * Presupuestos / Documentos / Historial — en vez de una página larga con
 * mucho scroll). Primer uso de pestañas en todo el sistema; se construye acá
 * (no en un archivo propio) porque es igual de chico y genérico que `Modal`/
 * `ConfirmDialog` de este mismo archivo. Todo el contenido de cada pestaña ya
 * viene renderizado por el Server Component padre (mismo criterio de toda la
 * app: nunca pasar una función a través del límite servidor→cliente) — acá
 * sólo se decide cuál mostrar, sin refetch ni navegación. Como las tres
 * pestañas comparten los datos que la página YA pidió una sola vez (no una
 * lista de filas, un único detalle), no hay ningún costo extra en tenerlas
 * todas ya armadas y sólo ocultar las que no están activas.
 */
export function Tabs({
  tabs,
  defaultTab,
}: {
  tabs: { id: string; label: string; content: ReactNode }[];
  defaultTab?: string;
}) {
  const [activo, setActivo] = useState(defaultTab || tabs[0]?.id);
  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-ink/10 mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activo === t.id}
            onClick={() => setActivo(t.id)}
            className={`px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activo === t.id
                ? "border-[var(--color-brand-800)] text-[var(--color-brand-800)]"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={activo !== t.id}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

export function ActionForm({
  action,
  children,
  className,
  successMessage,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
}) {
  const [estado, formAction] = useActionState(action, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    else if (estado.ok && successMessage) show(successMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className={className}>
      {children}
    </form>
  );
}
