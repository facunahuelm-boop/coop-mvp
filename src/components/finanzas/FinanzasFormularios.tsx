"use client";

// Fase 4 del rediseño: los 2 formularios de /finanzas (agregar compromiso
// futuro, registrar movimiento) migrados a `useActionState` — mismo criterio
// que los demás módulos. Ya usaban `AddButtonSummary`/`SubmitButton
// variant="add"` desde la Fase 3; acá se suma la validación por campo.

import { useActionState, useEffect, useRef, useState } from "react";
import {
  agregarCompromisoFormAction,
  registrarMovimientoFormAction,
  editarMovimientoFormAction,
  anularMovimientoFormAction,
} from "@/lib/actions/finanzas";
import { generarCuotaMensualFormAction } from "@/lib/actions/cuentaSocios";
import { crearConvenioFormAction } from "@/lib/actions/convenios";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { ActionForm, FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButton, AddButtonSummary, Button, Card, Label, inputClass } from "@/components/ui";

export function AgregarCompromisoForm() {
  const [estado, formAction] = useActionState(agregarCompromisoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Compromiso agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mb-8">
      <AddButtonSummary>Agregar compromiso futuro</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <input name="descripcion" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label>Monto</Label>
            <input name="monto" type="number" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label>Fecha estimada</Label>
            <input type="date" name="fecha_estimada" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_estimada} />
          </div>
          <div>
            <Label>Origen</Label>
            <input name="origen" className={inputClass} />
            <FieldError message={estado.fieldErrors?.origen} />
          </div>
          <div className="sm:col-span-3">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton variant="add" pendingLabel="Guardando…">Guardar</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function RegistrarMovimientoForm() {
  const [estado, formAction] = useActionState(registrarMovimientoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Movimiento registrado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Registrar movimiento</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} defaultValue="egreso">
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </div>
          <div>
            <Label>Monto</Label>
            <input name="monto" type="number" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label>Categoría</Label>
            <input name="categoria" required className={inputClass} placeholder="Estructura, Administración…" />
            <FieldError message={estado.fieldErrors?.categoria} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Registrando…">Registrar</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

type Movimiento = { id: number; tipo: string; monto: number | string; categoria: string; descripcion?: string | null };

/**
 * Editar/eliminar un movimiento del libro general (pedido explícito: "que
 * todos los ingresos tengan pop-ups... que se puedan editar y eliminar").
 */
export function EditarMovimientoForm({ movimiento: m }: { movimiento: Movimiento }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(editarMovimientoFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Movimiento actualizado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">
        Editar
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Editar movimiento">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <input type="hidden" name="id" value={m.id} />
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} defaultValue={m.tipo}>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </div>
          <div>
            <Label>Monto</Label>
            <input name="monto" type="number" step="0.01" required defaultValue={m.monto} className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label>Categoría</Label>
            <input name="categoria" required defaultValue={m.categoria} className={inputClass} />
            <FieldError message={estado.fieldErrors?.categoria} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" defaultValue={m.descripcion || ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * Sub-fase 4.4 (Eliminación segura de movimientos financieros): reemplaza el
 * botón "Eliminar" (ConfirmarEliminar, borrado físico) por el mismo patrón
 * "Anular" ya usado en /gastos (ActionForm + <details> plegado + motivo
 * opcional) — un movimiento anulado queda visible en el historial (ver
 * Badge en finanzas/page.tsx), no desaparece.
 */
export function AnularMovimientoBoton({ id, categoria }: { id: number; categoria: string }) {
  return (
    <details className="inline-block">
      <summary className="cursor-pointer text-xs text-[var(--color-rojo)] underline underline-offset-2">Anular</summary>
      <ActionForm action={anularMovimientoFormAction} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <input name="motivo" placeholder={`Motivo (opcional) — se va a anular "${categoria}"`} className={inputClass + " text-xs w-64"} />
        <button className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Confirmar anulación</button>
      </ActionForm>
    </details>
  );
}

/**
 * Generar la cuota mensual para todos los socios activos de una sola vez —
 * ver generarCuotaMensualAction (idempotente: si ya se generó para ese mes,
 * no duplica).
 */
export function GenerarCuotaMensualForm() {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(generarCuotaMensualFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Cuotas generadas.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const mesActual = new Date().toISOString().slice(0, 7);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Generar cuota del mes</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Generar cuota mensual">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div className="sm:col-span-2">
            <p className="text-xs text-ink-muted mb-1">
              Crea un cargo con este concepto y monto para cada socio activo que todavía no lo tenga — si ya se generó para este mes, no se duplica.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>Concepto</Label>
            <input name="concepto" required placeholder="Cuota setiembre 2026" className={inputClass} />
            <FieldError message={estado.fieldErrors?.concepto} />
          </div>
          <div>
            <Label>Monto por socio</Label>
            <input name="monto" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label>Mes</Label>
            <input name="mes" type="month" required defaultValue={mesActual} className={inputClass} />
            <FieldError message={estado.fieldErrors?.mes} />
          </div>
          <div>
            <Label>Día de vencimiento (1-28)</Label>
            <input name="dia_vencimiento" type="number" min={1} max={28} required defaultValue={10} className={inputClass} />
            <FieldError message={estado.fieldErrors?.dia_vencimiento} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton pendingLabel="Generando…">Generar</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

type SocioOpcion = { id: number; nombre: string };

/**
 * Nuevo convenio de pago desde Finanzas (con selector de socio) — la misma
 * acción que NuevoConvenioForm en SocioDetalleFormularios.tsx (esa versión
 * ya trae el socio fijo porque vive dentro de su ficha), para poder crear un
 * convenio sin tener que navegar primero a la ficha del socio.
 */
export function NuevoConvenioFormConSelector({ socios }: { socios: SocioOpcion[] }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(crearConvenioFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Convenio creado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nuevo convenio</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo convenio de pago">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div className="sm:col-span-2">
            <Label>Socio</Label>
            <select name="socio_id" required className={inputClass} defaultValue="">
              <option value="" disabled>— elegir —</option>
              {socios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <FieldError message={estado.fieldErrors?.socio_id} />
          </div>
          <div className="sm:col-span-2">
            <Label>Motivo</Label>
            <input name="motivo" required placeholder="Deuda atrasada de 2025..." className={inputClass} />
            <FieldError message={estado.fieldErrors?.motivo} />
          </div>
          <div>
            <Label>Monto de cada cuota</Label>
            <input name="monto_cuota" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto_cuota} />
          </div>
          <div>
            <Label>Cantidad de cuotas</Label>
            <input name="cantidad_cuotas" type="number" min={1} max={60} required defaultValue={6} className={inputClass} />
            <FieldError message={estado.fieldErrors?.cantidad_cuotas} />
          </div>
          <div>
            <Label>Día de vencimiento (1-28)</Label>
            <input name="dia_vencimiento" type="number" min={1} max={28} required defaultValue={10} className={inputClass} />
            <FieldError message={estado.fieldErrors?.dia_vencimiento} />
          </div>
          <div>
            <Label>Primera cuota (mes)</Label>
            <input name="fecha_inicio" type="date" required defaultValue={hoy} className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_inicio} />
          </div>
          <div className="sm:col-span-2">
            <Label>Notas</Label>
            <input name="notas" className={inputClass} />
            <FieldError message={estado.fieldErrors?.notas} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton pendingLabel="Creando…">Crear convenio</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
