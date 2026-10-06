"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Modal, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";

/**
 * Fase 1B: botón que abre un pop-up con un formulario corto. Pensado para
 * personas mayores: un solo pop-up (nunca uno encima de otro), botones con
 * texto, "Volver" siempre visible, el error explicado arriba del formulario
 * y un aviso al terminar. Se cierra solo cuando el servidor confirma.
 */
export function FormularioEnModal({
  textoBoton,
  titulo,
  descripcion,
  action,
  ocultos = {},
  children,
  textoConfirmar = "Guardar",
  claseBoton,
  mensajeExito,
  peligro = false,
  enLinea = false,
}: {
  textoBoton: ReactNode;
  titulo: string;
  descripcion?: ReactNode;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  ocultos?: Record<string, string | number>;
  children?: ReactNode;
  textoConfirmar?: string;
  claseBoton?: string;
  mensajeExito?: string;
  peligro?: boolean;
  /** Dentro de otro pop-up: el formulario se despliega ahí mismo (nunca un pop-up sobre otro). */
  enLinea?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, formAction] = useActionState(action, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      setAbierto(false);
      if (estado.aviso) show(estado.aviso);
      else if (mensajeExito) show(mensajeExito);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const formulario = (
    <form action={formAction} className="space-y-4 text-[15px]">
      {Object.entries(ocultos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {enLinea && <p className="font-semibold text-ink">{titulo}</p>}
      {descripcion && <div className="text-ink">{descripcion}</div>}
      <FormError message={estado.error} />
      {children}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken transition-colors"
        >
          Volver
        </button>
        <SubmitButton variant={peligro ? "danger" : "primary"}>{textoConfirmar}</SubmitButton>
      </div>
    </form>
  );

  const boton = (
    <button
      type="button"
      onClick={() => setAbierto(true)}
      className={
        claseBoton ??
        "inline-flex items-center justify-center rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken transition-colors"
      }
    >
      {textoBoton}
    </button>
  );

  if (enLinea) {
    return abierto ? <div className="w-full rounded-xl border border-border bg-surface-sunken/50 p-4">{formulario}</div> : boton;
  }

  return (
    <>
      {boton}
      <Modal open={abierto} onClose={() => setAbierto(false)} title={titulo}>
        {formulario}
      </Modal>
    </>
  );
}

/** Botón de un solo toque que ejecuta una acción y avisa el resultado. */
export function BotonAccion({
  action,
  ocultos,
  children,
  className,
  mensajeExito,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  ocultos: Record<string, string | number>;
  children: ReactNode;
  className?: string;
  mensajeExito?: string;
}) {
  const [estado, formAction] = useActionState(action, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    else if (estado.ok) {
      if (estado.aviso) show(estado.aviso);
      else if (mensajeExito) show(mensajeExito);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="inline">
      {Object.entries(ocultos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant="secondary" className={className}>
        {children}
      </SubmitButton>
    </form>
  );
}
