"use client";

import { RefinanciaCheckbox } from "@/components/socios/SocioDetalleFormularios";

// Fase 4 del rediseño: los 2 formularios de /finanzas (agregar compromiso
// futuro, registrar movimiento) migrados a `useActionState` — mismo criterio
// que los demás módulos. Ya usaban `AddButtonSummary`/`SubmitButton
// variant="add"` desde la Fase 3; acá se suma la validación por campo.
//
// AUDITORÍA INTEGRAL (hallazgo funcional, 27/09, reproducido en vivo): los 3
// campos "monto" de ALTA (compromiso futuro, RegistrarMovimientoForm y el
// atajo AgregarFinanzaModal del header) tenían <input type="number"> SIN
// step="0.01" — un <input type="number"> sin `step` sólo acepta enteros, así
// que cargar un monto con centavos (ej: 1234.56) quedaba bloqueado por la
// validación nativa del navegador (mensaje en inglés, nunca llega a
// mostrarse ningún error de la app) sin que la Server Action ni su schema de
// Zod (zMontoPositivo, que sí admite decimales) tuvieran nada que ver. Los 3
// formularios de EDICIÓN (EditarMovimientoForm, GenerarCuotaMensualForm,
// CrearConvenioForm más abajo) ya tenían step="0.01" — se iguala acá el
// criterio de alta al de edición, sin tocar ninguna Server Action ni validación.

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
            <Label required>Descripción</Label>
            <input name="descripcion" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label required>Monto</Label>
            <input name="monto" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label required>Fecha estimada</Label>
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

/** Gestión cooperativa integrada (04/10): los pagos de cuotas se registran
 * UNA sola vez, desde la ficha del núcleo, y generan su ingreso acá solos.
 * Cargarlos también a mano los contaría dos veces. */
function AvisoPagosDeCuotas() {
  return (
    <p className="sm:col-span-2 rounded-lg bg-[var(--accent-blue-bg)] px-3 py-2 text-xs text-[var(--accent-blue)]">
      Los pagos de cuotas sociales no se cargan acá: se registran desde la ficha del núcleo
      (Socios → el núcleo → pestaña Finanzas → Registrar pago) y aparecen en Finanzas solos, sin duplicarse.
    </p>
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
            <Label required>Monto</Label>
            <input name="monto" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label required>Categoría</Label>
            <input name="categoria" required className={inputClass} placeholder="Estructura, Administración…" />
            <FieldError message={estado.fieldErrors?.categoria} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <AvisoPagosDeCuotas />
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

/**
 * "+ Agregar finanza" (Mejora integral, Fase 1, pedido explícito): acceso
 * rápido en la cabecera de /finanzas, visible sin importar qué pestaña esté
 * abierta (Resumen/Cuotas/Movimientos) — antes, para registrar un ingreso o
 * egreso había que estar parado justo en la pestaña "Movimientos" y bajar
 * hasta el final. Reutiliza EXACTAMENTE los mismos campos y la misma Server
 * Action que `RegistrarMovimientoForm` (tipo/monto/categoría/descripción →
 * registrarMovimientoFormAction): no inventa un campo ni una acción nueva,
 * sólo agrega una segunda puerta de entrada al mismo formulario, en `Modal`
 * (mismo componente que ya usan EditarMovimientoForm/GenerarCuotaMensualForm)
 * en vez de `<details>`, porque acá no hay una lista debajo a la que
 * "pegarse" — vive suelto en la cabecera. `RegistrarMovimientoForm` (más
 * abajo) sigue existiendo tal cual, sin tocar (ADD, DON'T BREAK).
 */
export function AgregarFinanzaModal() {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(registrarMovimientoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Movimiento registrado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Agregar finanza</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Agregar finanza">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} defaultValue="egreso">
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </div>
          <div>
            <Label required>Monto</Label>
            <input name="monto" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label required>Categoría</Label>
            <input name="categoria" required className={inputClass} placeholder="Estructura, Administración…" />
            <FieldError message={estado.fieldErrors?.categoria} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <AvisoPagosDeCuotas />
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton pendingLabel="Registrando…">Registrar</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

type Movimiento = { id: number; tipo: string; monto: number | string; categoria: string; descripcion?: string | null; actualizado_en: string };

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
          {/* H-3 (auditoría integral, 27/09): versión cargada al abrir este
             formulario — ver updateConBloqueoOptimista() en db.ts. */}
          <input type="hidden" name="version_esperada" value={m.actualizado_en} />
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} defaultValue={m.tipo}>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </div>
          <div>
            <Label required>Monto</Label>
            <input name="monto" type="number" step="0.01" required defaultValue={m.monto} className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label required>Categoría</Label>
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
            <Label required>Concepto</Label>
            <input name="concepto" required placeholder="Cuota setiembre 2026" className={inputClass} />
            <FieldError message={estado.fieldErrors?.concepto} />
          </div>
          <div>
            <Label required>Monto por socio</Label>
            <input name="monto" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label required>Mes</Label>
            <input name="mes" type="month" required defaultValue={mesActual} className={inputClass} />
            <FieldError message={estado.fieldErrors?.mes} />
          </div>
          <div>
            <Label required>Día de vencimiento (1-28)</Label>
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
            <Label required>Socio</Label>
            <select name="socio_id" required className={inputClass} defaultValue="">
              <option value="" disabled>— elegir —</option>
              {socios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <FieldError message={estado.fieldErrors?.socio_id} />
          </div>
          <div className="sm:col-span-2">
            <Label required>Motivo</Label>
            <input name="motivo" required placeholder="Deuda atrasada de 2025..." className={inputClass} />
            <FieldError message={estado.fieldErrors?.motivo} />
          </div>
          <div>
            <Label required>Monto de cada cuota</Label>
            <input name="monto_cuota" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto_cuota} />
          </div>
          <div>
            <Label required>Cantidad de cuotas</Label>
            <input name="cantidad_cuotas" type="number" min={1} max={60} required defaultValue={6} className={inputClass} />
            <FieldError message={estado.fieldErrors?.cantidad_cuotas} />
          </div>
          <div>
            <Label required>Día de vencimiento (1-28)</Label>
            <input name="dia_vencimiento" type="number" min={1} max={28} required defaultValue={10} className={inputClass} />
            <FieldError message={estado.fieldErrors?.dia_vencimiento} />
          </div>
          <div>
            <Label required>Primera cuota (mes)</Label>
            <input name="fecha_inicio" type="date" required defaultValue={hoy} className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_inicio} />
          </div>
          <div className="sm:col-span-2">
            <Label>Notas</Label>
            <input name="notas" className={inputClass} />
            <FieldError message={estado.fieldErrors?.notas} />
          </div>
          <RefinanciaCheckbox />
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
