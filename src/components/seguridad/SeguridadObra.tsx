"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { checklistDiarioFormAction, registrarEppFormAction, registrarInduccionFormAction } from "@/lib/actions/seguridadObra";

/** Fase 3E — checklist diario en el celular: cada punto se responde Bien / Falta / No aplica. */
export function ChecklistDiarioForm({ items }: { items: readonly string[] }) {
  const [estado, formAction] = useActionState(checklistDiarioFormAction, ESTADO_INICIAL);
  const [resp, setResp] = useState<Record<number, string>>({});
  const router = useRouter();
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) {
      if (estado.aviso) show(estado.aviso);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const opciones = [
    { v: "ok", t: "Bien", on: "bg-[var(--color-verde)] text-white border-[var(--color-verde)]" },
    { v: "falta", t: "Falta", on: "bg-[var(--color-rojo)] text-white border-[var(--color-rojo)]" },
    { v: "na", t: "No aplica", on: "bg-ink text-white border-ink" },
  ];
  return (
    <form action={formAction} className="space-y-3">
      {items.map((item, i) => (
        <Card key={i} className="!p-4">
          <fieldset>
            <legend className="text-[17px] font-semibold text-ink mb-3">{item}</legend>
            <div className="grid grid-cols-3 gap-2">
              {opciones.map((o) => (
                <label
                  key={o.v}
                  className={`flex items-center justify-center rounded-xl border px-2 py-3 text-[15px] font-semibold cursor-pointer select-none ${resp[i] === o.v ? o.on : "border-border bg-surface text-ink"}`}
                >
                  <input type="radio" name={`item_${i}`} value={o.v} required className="sr-only" onChange={() => setResp((r) => ({ ...r, [i]: o.v }))} />
                  {o.t}
                </label>
              ))}
            </div>
            {resp[i] === "falta" && (
              <input name={`obs_${i}`} placeholder="¿Qué falta? (opcional)" maxLength={300} className={inputClass + " mt-3"} />
            )}
          </fieldset>
        </Card>
      ))}
      <div>
        <Label>Notas del día (opcional)</Label>
        <textarea name="notas" rows={2} maxLength={2000} className={inputClass} />
      </div>
      <FormError message={estado.error ?? estado.fieldErrors?.item_0} />
      <SubmitButton className="w-full py-4 text-lg" pendingLabel="Guardando…">Guardar el checklist de hoy</SubmitButton>
    </form>
  );
}

type PersonaOpcion = { clave: string; nombre: string; nucleo: string | null };

export function EntregarEppForm({ personas, elementos, hoy }: { personas: PersonaOpcion[]; elementos: readonly string[]; hoy: string }) {
  const [estado, formAction] = useActionState(registrarEppFormAction, ESTADO_INICIAL);
  // La persona queda elegida después de guardar, para anotarle otro elemento enseguida.
  const [persona, setPersona] = useState("");
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok && estado.aviso) show(estado.aviso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <Label required>Persona</Label>
        <select name="persona" required value={persona} onChange={(e) => setPersona(e.target.value)} className={inputClass}>
          <option value="" disabled>Elegí…</option>
          {personas.map((p) => (
            <option key={p.clave} value={p.clave}>
              {p.nombre}
              {p.nucleo ? ` — ${p.nucleo}` : ""}
            </option>
          ))}
        </select>
        <FieldError message={estado.fieldErrors?.persona} />
      </div>
      <div>
        <Label required>Elemento</Label>
        <input name="elemento" list="epp-elementos" required maxLength={100} className={inputClass} placeholder="Casco, botas…" />
        <datalist id="epp-elementos">
          {elementos.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
        <FieldError message={estado.fieldErrors?.elemento} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Talle</Label>
          <input name="talle" maxLength={20} className={inputClass} />
        </div>
        <div>
          <Label required>Cantidad</Label>
          <input name="cantidad" type="number" min={1} max={50} defaultValue={1} required className={inputClass} />
          <FieldError message={estado.fieldErrors?.cantidad} />
        </div>
      </div>
      <div>
        <Label required>Fecha de entrega</Label>
        <input name="fecha" type="date" max={hoy} defaultValue={hoy} required className={inputClass} />
        <FieldError message={estado.fieldErrors?.fecha} />
      </div>
      <div>
        <Label>Observaciones</Label>
        <input name="observaciones" maxLength={500} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <FormError message={estado.error} />
        <SubmitButton variant="add" pendingLabel="Guardando…">Anotar la entrega</SubmitButton>
      </div>
    </form>
  );
}

export function RegistrarInduccionForm({ personas, hoy }: { personas: PersonaOpcion[]; hoy: string }) {
  const [estado, formAction] = useActionState(registrarInduccionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const [filtro, setFiltro] = useState("");
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) {
      if (estado.aviso) show(estado.aviso);
      formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  const f = filtro.trim().toLowerCase();
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div>
        <Label required>¿Quiénes hicieron la inducción?</Label>
        {personas.length > 8 && (
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por nombre o núcleo" className={inputClass + " mb-2"} aria-label="Buscar persona" />
        )}
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {personas.map((p) => {
            const visible = !f || p.nombre.toLowerCase().includes(f) || (p.nucleo ?? "").toLowerCase().includes(f);
            return (
              <label key={p.clave} className={`flex items-center gap-3 px-3 py-2.5 text-[15px] ${visible ? "" : "hidden"}`}>
                <input type="checkbox" name="persona" value={p.clave} className="h-5 w-5" />
                <span>
                  {p.nombre}
                  {p.nucleo && <span className="text-ink-muted"> — {p.nucleo}</span>}
                </span>
              </label>
            );
          })}
          {personas.length === 0 && <p className="px-3 py-3 text-ink-muted">Todas las personas ya tienen la inducción.</p>}
        </div>
        <FieldError message={estado.fieldErrors?.persona} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label required>Fecha</Label>
          <input name="fecha" type="date" max={hoy} defaultValue={hoy} required className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha} />
        </div>
        <div>
          <Label>¿Quién la dio?</Label>
          <input name="dictada_por" maxLength={150} className={inputClass} placeholder="Técnico prevencionista, IAT…" />
        </div>
      </div>
      <div>
        <Label>Temas</Label>
        <textarea name="temas" rows={2} maxLength={1000} className={inputClass} placeholder="Uso de EPP, riesgos de la obra, qué hacer ante un accidente…" />
      </div>
      <FormError message={estado.error} />
      <SubmitButton variant="add" pendingLabel="Guardando…">Registrar la inducción</SubmitButton>
    </form>
  );
}
