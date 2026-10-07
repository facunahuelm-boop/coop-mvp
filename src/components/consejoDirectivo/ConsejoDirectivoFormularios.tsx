"use client";

// Sub-fase 1.4 ("Consejo Directivo — vista propia"): mismo patrón de
// useActionState + <details> colapsable ya usado en Reuniones/Documentos.

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  asignarCargoConsejoFormAction,
  finalizarCargoConsejoFormAction,
  extenderMandatoFormAction,
  cerrarMandatoVencidoFormAction,
  armarOrdenDelDiaFormAction,
} from "@/lib/actions/consejoDirectivo";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { CARGOS_CONSEJO, CARGO_LABEL } from "@/lib/consejoDirectivoCargos";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, inputClass, AddButtonSummary } from "@/components/ui";

type Integrante = { id: number; nombre: string };

export function AsignarCargoForm({ integrantes }: { integrantes: Integrante[] }) {
  const [estado, formAction] = useActionState(asignarCargoConsejoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Cargo asignado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef}>
      <AddButtonSummary>Asignar cargo</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label required>Persona</Label>
            <select name="user_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {integrantes.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.user_id} />
          </div>
          <div>
            <Label>Cargo</Label>
            <select name="cargo" className={inputClass} defaultValue="vocal">
              {CARGOS_CONSEJO.map((c) => (
                <option key={c} value={c}>{CARGO_LABEL[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label required>Desde</Label>
            <input type="date" name="fecha_inicio" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_inicio} />
          </div>
          <div>
            <Label>Hasta (fin previsto del mandato)</Label>
            <input type="date" name="fecha_fin_prevista" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_fin_prevista} />
          </div>
          <label className="sm:col-span-2 flex items-center gap-3 text-[15px]">
            <input type="checkbox" name="dar_permisos" defaultChecked className="h-5 w-5" />
            <span>Darle los permisos del cargo (por ejemplo, Tesorería para el tesorero)</span>
          </label>
          <div className="sm:col-span-3">
            <p className="text-[13px] text-ink-muted">
              Si el cargo elegido (Presidente, Secretario o Tesorero) ya tiene un titular vigente, su mandato se cierra
              automáticamente en esta fecha. Con la fecha de fin, COOVA avisa 60 días antes para preparar las elecciones.
            </p>
          </div>
          <div className="sm:col-span-3">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton pendingLabel="Asignando…">Asignar cargo</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function FinalizarCargoForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(finalizarCargoConsejoFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Mandato finalizado.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="date" name="fecha_fin" required className={inputClass + " text-xs !py-1 !w-auto"} />
      <SubmitButton variant="ghost" className="text-xs px-2 py-1 whitespace-nowrap">Finalizar mandato</SubmitButton>
    </form>
  );
}


/** Fase 2D: extender un mandato. */
export function ExtenderMandatoForm({ id, nombre }: { id: number; nombre: string }) {
  return (
    <FormularioEnModal
      textoBoton="Extender"
      claseBoton="text-xs text-[var(--color-brand-800)] underline underline-offset-2"
      titulo={`Extender el mandato de ${nombre}`}
      action={extenderMandatoFormAction}
      ocultos={{ id }}
      mensajeExito="Mandato extendido."
    >
      <label className="block">
        <Label required>Nueva fecha de fin</Label>
        <input type="date" name="fecha_fin_prevista" required className={inputClass} />
      </label>
      <label className="block">
        <Label required>Motivo</Label>
        <input name="motivo" required maxLength={300} placeholder="Ej.: hasta la asamblea de elecciones" className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

/** Fase 2D: el admin confirma el fin de un mandato vencido y, si corresponde, quita los permisos. */
export function CerrarMandatoVencidoForm({ id, nombre, cargo }: { id: number; nombre: string; cargo: string }) {
  return (
    <FormularioEnModal
      textoBoton="Revisar permisos"
      titulo={`Terminó el mandato de ${nombre} (${cargo})`}
      descripcion="Se cierra el mandato. Si ya no tiene otro cargo, puede pasar a ser socio (sin permisos de Consejo, Tesorería o Fiscal). Queda registrado."
      action={cerrarMandatoVencidoFormAction}
      ocultos={{ id }}
      textoConfirmar="Confirmar"
      mensajeExito="Listo."
    >
      <label className="flex items-center gap-3 text-[15px]">
        <input type="checkbox" name="quitar_permisos" defaultChecked className="h-5 w-5" />
        <span>Quitarle los permisos del cargo</span>
      </label>
    </FormularioEnModal>
  );
}

/** Fase 2D: arma el orden del día de la próxima reunión del Consejo con lo pendiente. */
export function ArmarOrdenDelDiaForm({
  temas,
  reuniones,
}: {
  temas: { clave: string; texto: string; tipoLabel: string }[];
  reuniones: { id: number; titulo: string; fecha: string }[];
}) {
  const [estado, formAction] = useActionState(armarOrdenDelDiaFormAction, ESTADO_INICIAL);
  const router = useRouter();
  const [destino, setDestino] = useState<string>(reuniones[0] ? String(reuniones[0].id) : "");
  useEffect(() => {
    if (estado.ok && estado.aviso) router.push(estado.aviso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="space-y-3 text-[15px]">
      <fieldset className="space-y-1.5">
        <legend className="font-semibold text-ink mb-1">Temas para llevar</legend>
        {temas.map((t) => (
          <label key={t.clave} className="flex items-start gap-3">
            <input type="checkbox" name="tema" value={t.clave} defaultChecked className="h-5 w-5 mt-0.5" />
            <span>
              {t.texto} <span className="text-sm text-ink-muted">· {t.tipoLabel}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <Label>¿A qué reunión?</Label>
          <select name="reunion_id" value={destino} onChange={(e) => setDestino(e.target.value)} className={inputClass}>
            {reuniones.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo} — {r.fecha.slice(0, 10).split("-").reverse().join("/")}
              </option>
            ))}
            <option value="">Una reunión nueva</option>
          </select>
        </label>
        {!destino && (
          <>
            <label className="block">
              <Label required>Fecha y hora</Label>
              <input type="datetime-local" name="fecha" required className={inputClass} />
            </label>
            <label className="block">
              <Label>Lugar</Label>
              <input name="lugar" maxLength={200} className={inputClass} />
            </label>
          </>
        )}
      </div>
      <FormError message={estado.error} />
      <SubmitButton pendingLabel="Armando…">Armar el orden del día</SubmitButton>
    </form>
  );
}
