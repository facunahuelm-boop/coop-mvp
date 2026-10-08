"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import {
  registrarRecepcionFormAction,
  crearItemPanolFormAction,
  movimientoPanolFormAction,
  escribirDiarioFormAction,
} from "@/lib/actions/obraRecursos";

/** Fase 3C — formularios de recepción de materiales, pañol y diario de obra. */

function useResultado(estado: ActionState, alTerminar?: () => void) {
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) {
      if (estado.aviso) show(estado.aviso);
      alTerminar?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
}

export function RecepcionForm({
  solicitud,
  hoy,
}: {
  solicitud?: { id: number; material: string; cantidad: number; unidad: string };
  hoy: string;
}) {
  const [estado, formAction] = useActionState(registrarRecepcionFormAction, ESTADO_INICIAL);
  const [conforme, setConforme] = useState("si");
  useResultado(estado, () => setConforme("si"));
  const e = estado.fieldErrors ?? {};
  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[15px]">
      {solicitud && <input type="hidden" name="solicitud_id" value={solicitud.id} />}
      <div className="sm:col-span-2">
        <Label required>Material</Label>
        <input name="material" required maxLength={200} defaultValue={solicitud?.material} className={inputClass} />
        <FieldError message={e.material} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Se pidió</Label>
          <input name="cantidad_pedida" type="number" step="any" min={0} defaultValue={solicitud?.cantidad} className={inputClass} />
        </div>
        <div>
          <Label required>Llegó</Label>
          <input name="cantidad_recibida" type="number" step="any" min={0} required defaultValue={solicitud?.cantidad} className={inputClass} />
          <FieldError message={e.cantidad_recibida} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Unidad</Label>
          <input name="unidad" maxLength={30} defaultValue={solicitud?.unidad} className={inputClass} placeholder="bolsas, m³…" />
        </div>
        <div>
          <Label required>Fecha</Label>
          <input name="fecha" type="date" max={hoy} defaultValue={hoy} required className={inputClass} />
          <FieldError message={e.fecha} />
        </div>
      </div>
      <div>
        <Label>N° de remito</Label>
        <input name="remito_numero" maxLength={60} className={inputClass} />
      </div>
      <div>
        <Label>Foto del remito</Label>
        <input name="remito_foto" type="file" accept="image/*" capture="environment" className="text-sm" />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="font-semibold text-ink mb-1">¿Llegó todo bien?</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" name="conforme" value="si" checked={conforme === "si"} onChange={() => setConforme("si")} /> Sí, conforme
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="conforme" value="no" checked={conforme === "no"} onChange={() => setConforme("no")} /> No, hubo diferencias
          </label>
        </div>
      </fieldset>
      {conforme === "no" && (
        <div className="sm:col-span-2">
          <Label required>¿Qué faltó o qué llegó mal?</Label>
          <textarea name="diferencias" rows={2} maxLength={1000} className={inputClass} />
          <FieldError message={e.diferencias} />
        </div>
      )}
      <label className="sm:col-span-2 flex items-center gap-2">
        <input type="checkbox" name="al_panol" value="1" defaultChecked /> Guardarlo en el pañol (suma al stock)
      </label>
      <div className="sm:col-span-2">
        <FormError message={estado.error} />
        <SubmitButton variant="primary" pendingLabel="Guardando…">Registrar la recepción</SubmitButton>
      </div>
    </form>
  );
}

export function NuevoItemPanolForm() {
  const [estado, formAction] = useActionState(crearItemPanolFormAction, ESTADO_INICIAL);
  const ref = useRef<HTMLFormElement>(null);
  useResultado(estado, () => ref.current?.reset());
  const e = estado.fieldErrors ?? {};
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[15px]">
      <div className="sm:col-span-2">
        <Label required>Nombre</Label>
        <input name="nombre" required maxLength={120} className={inputClass} placeholder="Amoladora, carretilla, cemento…" />
        <FieldError message={e.nombre} />
      </div>
      <div>
        <Label required>Es…</Label>
        <select name="tipo" defaultValue="herramienta" className={inputClass}>
          <option value="herramienta">Herramienta</option>
          <option value="material">Material</option>
        </select>
      </div>
      <div>
        <Label>Unidad</Label>
        <input name="unidad" maxLength={30} className={inputClass} placeholder="unidad" />
      </div>
      <div>
        <Label>Cantidad que hay hoy</Label>
        <input name="cantidad_inicial" type="number" step="any" min={0} className={inputClass} />
        <FieldError message={e.cantidad_inicial} />
      </div>
      <div>
        <Label>Avisar cuando quede</Label>
        <input name="stock_minimo" type="number" step="any" min={0} className={inputClass} placeholder="0 = no avisar" />
      </div>
      <div className="sm:col-span-3">
        <Label>Dónde se guarda</Label>
        <input name="ubicacion" maxLength={120} className={inputClass} placeholder="Contenedor 1, estante B…" />
      </div>
      <div className="sm:col-span-3">
        <FormError message={estado.error} />
        <SubmitButton variant="add" pendingLabel="Guardando…">Agregar al pañol</SubmitButton>
      </div>
    </form>
  );
}

export function MovimientoPanolForm({
  items,
  nucleos,
  hoy,
}: {
  items: { id: number; nombre: string; unidad: string; stock: number; tipo: string }[];
  nucleos: { id: number; nombre: string }[];
  hoy: string;
}) {
  const [estado, formAction] = useActionState(movimientoPanolFormAction, ESTADO_INICIAL);
  const [tipo, setTipo] = useState("prestamo");
  const [item, setItem] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  useResultado(estado);
  const e = estado.fieldErrors ?? {};
  const elegido = items.find((i) => String(i.id) === item);
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[15px]">
      <div>
        <Label required>¿Qué?</Label>
        <select name="item_id" required value={item} onChange={(ev) => setItem(ev.target.value)} className={inputClass}>
          <option value="" disabled>Elegí…</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nombre} (hay {i.stock} {i.unidad})
            </option>
          ))}
        </select>
        <FieldError message={e.item_id} />
      </div>
      <div>
        <Label required>Movimiento</Label>
        <select name="tipo" value={tipo} onChange={(ev) => setTipo(ev.target.value)} className={inputClass}>
          <option value="prestamo">Préstamo (se devuelve)</option>
          <option value="salida">Salida (se usa en la obra)</option>
          <option value="entrada">Entrada</option>
          <option value="ajuste">Ajuste de inventario</option>
        </select>
      </div>
      <div>
        <Label required>Cantidad{elegido ? ` (${elegido.unidad})` : ""}</Label>
        <input name="cantidad" type="number" step="any" required defaultValue={1} className={inputClass} />
        {tipo === "ajuste" && <span className="text-[13px] text-ink-muted">Positivo suma, negativo resta.</span>}
        <FieldError message={e.cantidad} />
      </div>
      <div>
        <Label required>Fecha</Label>
        <input name="fecha" type="date" max={hoy} defaultValue={hoy} required className={inputClass} />
        <FieldError message={e.fecha} />
      </div>
      {(tipo === "prestamo" || tipo === "salida") && (
        <>
          <div>
            <Label>{tipo === "prestamo" ? "Se le presta a" : "Se lo llevó"}</Label>
            <input name="persona" maxLength={150} className={inputClass} placeholder="Nombre" />
            <FieldError message={e.persona} />
          </div>
          <div>
            <Label>Núcleo</Label>
            <select name="nucleo_id" defaultValue="" className={inputClass}>
              <option value="">—</option>
              {nucleos.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nombre}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <Label required={tipo === "ajuste"}>Notas</Label>
        <input name="notas" maxLength={500} className={inputClass} placeholder={tipo === "ajuste" ? "Ej.: conteo del viernes" : ""} />
        <FieldError message={e.notas} />
      </div>
      <div className="sm:col-span-2">
        <FormError message={estado.error} />
        <SubmitButton variant="primary" pendingLabel="Guardando…">Anotar</SubmitButton>
      </div>
    </form>
  );
}

export function DiarioObraForm({ hoy, climas, personasHoy }: { hoy: string; climas: readonly string[]; personasHoy: number | null }) {
  const [estado, formAction] = useActionState(escribirDiarioFormAction, ESTADO_INICIAL);
  const ref = useRef<HTMLFormElement>(null);
  useResultado(estado, () => ref.current?.reset());
  const e = estado.fieldErrors ?? {};
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[15px]">
      <div>
        <Label required>Fecha</Label>
        <input name="fecha" type="date" max={hoy} defaultValue={hoy} required className={inputClass} />
        <FieldError message={e.fecha} />
      </div>
      <div>
        <Label>Clima</Label>
        <input name="clima" list="diario-climas" maxLength={60} className={inputClass} />
        <datalist id="diario-climas">
          {climas.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div>
        <Label>Personas en la obra</Label>
        <input name="personas" type="number" min={0} defaultValue={personasHoy ?? undefined} className={inputClass} />
        {personasHoy != null && <span className="text-[13px] text-ink-muted">Según el QR de hoy.</span>}
      </div>
      <div className="sm:col-span-3">
        <Label required>Qué se hizo hoy</Label>
        <textarea name="trabajos" required rows={3} maxLength={4000} className={inputClass} />
        <FieldError message={e.trabajos} />
      </div>
      <div className="sm:col-span-3">
        <Label>Novedades, problemas o visitas</Label>
        <textarea name="novedades" rows={2} maxLength={4000} className={inputClass} />
      </div>
      <div className="sm:col-span-3">
        <Label>Fotos (hasta 6)</Label>
        <input name="fotos" type="file" accept="image/*" multiple className="text-sm" />
        <FieldError message={e.fotos} />
      </div>
      <div className="sm:col-span-3">
        <FormError message={estado.error} />
        <SubmitButton variant="primary" pendingLabel="Guardando…">Guardar en el diario</SubmitButton>
      </div>
    </form>
  );
}
