"use client";

// Fase 4 del rediseño: mismos 4 formularios de la ficha de un socio
// (/socios/[id]) migrados a `useActionState` — ver SociosFormularios.tsx
// para el criterio general. `EditarIntegranteForm` recibe el integrante
// como prop porque hay una instancia por fila de la lista (uno por
// integrante del núcleo), cada una con su propio estado independiente.

import { useActionState, useEffect, useRef, useState } from "react";
import {
  actualizarSocioFormAction,
  agregarIntegranteFormAction,
  editarIntegranteFormAction,
} from "@/lib/actions/socios";
import {
  registrarMovimientoCuentaSocioFormAction,
  editarMovimientoCuentaSocioFormAction,
  anularMovimientoCuentaSocioFormAction,
} from "@/lib/actions/cuentaSocios";
import {
  crearConvenioFormAction,
  cambiarEstadoConvenioFormAction,
  eliminarConvenioFormAction,
} from "@/lib/actions/convenios";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { ActionForm, FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { ConfirmarEliminar } from "@/components/ConfirmarEliminar";
import { AddButton, AddButtonSummary, Button, Label, inputClass } from "@/components/ui";
import { RELACION_INTEGRANTE, RELACION_INTEGRANTE_LABEL, TIPO_INTEGRANTE, METODOS_PAGO, METODO_PAGO_LABEL } from "@/lib/constants";

const TIPO_INTEGRANTE_LABEL: Record<(typeof TIPO_INTEGRANTE)[number], string> = { adulto: "Adulto", menor: "Menor de edad" };

type Socio = { id: number; documento?: string | null; email?: string | null; telefono?: string | null; notas?: string | null };

export function ActualizarSocioForm({ socio }: { socio: Socio }) {
  const [estado, formAction] = useActionState(actualizarSocioFormAction, ESTADO_INICIAL);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      if (detailsRef.current) detailsRef.current.open = false;
      show("Datos de contacto actualizados.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--color-brand-800)]">Editar datos de contacto</summary>
      <form action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="hidden" name="id" value={socio.id} />
        <div>
          <Label>Documento</Label>
          <input name="documento" defaultValue={socio.documento || ""} inputMode="numeric" data-validar="documento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Email</Label>
          <input name="email" type="email" defaultValue={socio.email || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" type="tel" defaultValue={socio.telefono || ""} data-validar="telefono" className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div className="sm:col-span-2">
          <Label>Notas</Label>
          <input name="notas" defaultValue={socio.notas || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.notas} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function AgregarIntegranteForm({ socioId }: { socioId: number }) {
  const [estado, formAction] = useActionState(agregarIntegranteFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Integrante agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Agregar integrante</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="hidden" name="socio_id" value={socioId} />
        <div>
          <Label>Nombre</Label>
          <input name="nombre" required className={inputClass} />
          <FieldError message={estado.fieldErrors?.nombre} />
        </div>
        <div>
          <Label>Apellido</Label>
          <input name="apellido" className={inputClass} />
          <FieldError message={estado.fieldErrors?.apellido} />
        </div>
        <div>
          <Label>Documento</Label>
          <input name="documento" inputMode="numeric" data-validar="documento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Fecha de nacimiento</Label>
          <input type="date" name="fecha_nacimiento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha_nacimiento} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" type="tel" data-validar="telefono" className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div>
          <Label>Email</Label>
          <input type="email" name="email" className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Relación con el titular</Label>
          <select name="relacion" className={inputClass} defaultValue="pareja">
            {RELACION_INTEGRANTE.filter((r) => r !== "titular").map((r) => (
              <option key={r} value={r}>{RELACION_INTEGRANTE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Tipo de integrante</Label>
          <select name="tipo_integrante" className={inputClass} defaultValue="adulto">
            {TIPO_INTEGRANTE.map((t) => (
              <option key={t} value={t}>{TIPO_INTEGRANTE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label>Observaciones</Label>
          <input name="observaciones" className={inputClass} />
          <FieldError message={estado.fieldErrors?.observaciones} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton variant="add" pendingLabel="Agregando…">Agregar integrante</SubmitButton>
        </div>
      </form>
    </details>
  );
}

type Integrante = {
  id: number;
  nombre: string;
  apellido?: string | null;
  documento?: string | null;
  fecha_nacimiento?: string | null;
  telefono?: string | null;
  email?: string | null;
  relacion: string;
  tipo_integrante: string;
  observaciones?: string | null;
};

export function EditarIntegranteForm({ integrante: i }: { integrante: Integrante }) {
  const [estado, formAction] = useActionState(editarIntegranteFormAction, ESTADO_INICIAL);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      if (detailsRef.current) detailsRef.current.open = false;
      show("Integrante actualizado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef}>
      <summary className="cursor-pointer text-xs text-[var(--color-brand-800)] font-semibold">Editar</summary>
      <form action={formAction} className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 w-64 sm:w-80">
        <input type="hidden" name="id" value={i.id} />
        <div>
          <Label>Nombre</Label>
          <input name="nombre" defaultValue={i.nombre} required className={inputClass} />
          <FieldError message={estado.fieldErrors?.nombre} />
        </div>
        <div>
          <Label>Apellido</Label>
          <input name="apellido" defaultValue={i.apellido || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.apellido} />
        </div>
        <div>
          <Label>Documento</Label>
          <input name="documento" defaultValue={i.documento || ""} inputMode="numeric" data-validar="documento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Fecha de nacimiento</Label>
          <input type="date" name="fecha_nacimiento" defaultValue={i.fecha_nacimiento || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha_nacimiento} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" type="tel" defaultValue={i.telefono || ""} data-validar="telefono" className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div>
          <Label>Email</Label>
          <input type="email" name="email" defaultValue={i.email || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Relación</Label>
          <select name="relacion" defaultValue={i.relacion} className={inputClass}>
            {RELACION_INTEGRANTE.map((r) => (
              <option key={r} value={r}>{RELACION_INTEGRANTE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Tipo</Label>
          <select name="tipo_integrante" defaultValue={i.tipo_integrante} className={inputClass}>
            {TIPO_INTEGRANTE.map((t) => (
              <option key={t} value={t}>{TIPO_INTEGRANTE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label>Observaciones</Label>
          <input name="observaciones" defaultValue={i.observaciones || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.observaciones} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton className="text-xs px-3 py-1.5" pendingLabel="Guardando…">Guardar</SubmitButton>
        </div>
      </form>
    </details>
  );
}

/** Cuota con saldo que se puede elegir al registrar un pago. */
export type CuotaAbierta = { id: number; label: string; pendiente: number };

/**
 * Gestión cooperativa integrada (04/10): registrar un PAGO o un CARGO en la
 * cuenta del socio. Antes era un único desplegable al pie de la tabla con un
 * selector de tipo; ahora son dos botones arriba a la derecha de la sección
 * (criterio del sistema: el botón de crear, arriba a la derecha) que abren
 * una ventana. El pago pide el medio de pago y, opcionalmente, a qué cuota
 * va — al elegirla se precarga lo que esa cuota debe. Al guardarlo, el
 * ingreso aparece solo en Finanzas (ver registrarMovimientoCuentaSocioAction).
 */
export function RegistrarMovimientoCuentaForm({
  socioId,
  tipo,
  cuotasAbiertas = [],
}: {
  socioId: number;
  tipo: "cargo" | "pago";
  cuotasAbiertas?: CuotaAbierta[];
}) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(registrarMovimientoCuentaSocioFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const montoRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();
  const esPago = tipo === "pago";

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show(esPago ? "Pago registrado. Ya figura como ingreso en Finanzas." : "Cargo registrado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>{esPago ? "Registrar pago" : "Registrar cargo"}</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title={esPago ? "Registrar pago" : "Registrar cargo (cuota u otro)"} size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink" encType="multipart/form-data">
          <input type="hidden" name="socio_id" value={socioId} />
          <input type="hidden" name="tipo" value={tipo} />
          {esPago && (
            <div className="sm:col-span-2">
              <Label>¿Qué cuota paga?</Label>
              <select
                name="cuota_id"
                className={inputClass}
                defaultValue=""
                onChange={(e) => {
                  const c = cuotasAbiertas.find((x) => String(x.id) === e.target.value);
                  if (c && montoRef.current) montoRef.current.value = String(c.pendiente);
                }}
              >
                <option value="">La más antigua primero (automático)</option>
                {cuotasAbiertas.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <p className="text-xs text-ink-faint mt-1">
                Si no elegís una, el pago cubre las cuotas más antiguas primero, como siempre.
              </p>
              <FieldError message={estado.fieldErrors?.cuota_id} />
            </div>
          )}
          <div>
            <Label required>Monto</Label>
            <input ref={montoRef} name="monto" type="number" step="0.01" min="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label required>{esPago ? "Fecha de pago" : "Fecha de emisión"}</Label>
            <input name="fecha" type="date" required className={inputClass} defaultValue={hoy} />
            <FieldError message={estado.fieldErrors?.fecha} />
          </div>
          {esPago ? (
            <div>
              <Label required>Medio de pago</Label>
              <select name="metodo_pago" required className={inputClass} defaultValue="efectivo">
                {METODOS_PAGO.map((m) => (
                  <option key={m} value={m}>{METODO_PAGO_LABEL[m]}</option>
                ))}
              </select>
              <FieldError message={estado.fieldErrors?.metodo_pago} />
            </div>
          ) : (
            <div>
              <Label>Vencimiento</Label>
              <input name="fecha_vencimiento" type="date" className={inputClass} />
              <FieldError message={estado.fieldErrors?.fecha_vencimiento} />
            </div>
          )}
          <div>
            <Label required>Concepto</Label>
            <input
              name="concepto"
              required
              defaultValue={esPago ? "Pago de cuota" : ""}
              placeholder={esPago ? "Pago de cuota" : "Cuota octubre, aporte extraordinario…"}
              className={inputClass}
            />
            <FieldError message={estado.fieldErrors?.concepto} />
          </div>
          <div className="sm:col-span-2">
            <Label>Comprobante</Label>
            <input type="file" name="comprobante" className="text-xs" />
          </div>
          <div className="sm:col-span-2">
            <Label>Observaciones</Label>
            <input name="notas" className={inputClass} />
            <FieldError message={estado.fieldErrors?.notas} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton variant="add" pendingLabel="Registrando…">{esPago ? "Registrar pago" : "Registrar cargo"}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

type MovimientoCuenta = {
  id: number;
  tipo: string;
  concepto: string;
  monto: number | string;
  fecha: string;
  fecha_vencimiento?: string | null;
  notas?: string | null;
  metodo_pago?: string | null;
};

/**
 * Editar/eliminar un movimiento ya cargado, en un pop-up (pedido explícito:
 * "que todo lo que veamos tenga pop-ups... que se puedan editar y
 * eliminar"), en vez de un formulario largo desplegado en la fila.
 */
export function EditarMovimientoCuentaForm({ movimiento: m }: { movimiento: MovimientoCuenta }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(editarMovimientoCuentaSocioFormAction, ESTADO_INICIAL);
  const [tipo, setTipo] = useState<"cargo" | "pago">(m.tipo === "pago" ? "pago" : "cargo");
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
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink" encType="multipart/form-data">
          <input type="hidden" name="id" value={m.id} />
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value as "cargo" | "pago")}>
              <option value="cargo">Cargo</option>
              <option value="pago">Pago</option>
            </select>
          </div>
          <div>
            <Label>Monto</Label>
            <input name="monto" type="number" step="0.01" required defaultValue={m.monto} className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div className="sm:col-span-2">
            <Label>Concepto</Label>
            <input name="concepto" required defaultValue={m.concepto} className={inputClass} />
            <FieldError message={estado.fieldErrors?.concepto} />
          </div>
          <div>
            <Label>Fecha</Label>
            <input name="fecha" type="date" required defaultValue={m.fecha} className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha} />
          </div>
          {tipo === "cargo" && (
            <div>
              <Label>Vencimiento (opcional)</Label>
              <input name="fecha_vencimiento" type="date" defaultValue={m.fecha_vencimiento || ""} className={inputClass} />
              <FieldError message={estado.fieldErrors?.fecha_vencimiento} />
            </div>
          )}
          {tipo === "pago" && (
            <div>
              <Label>Medio de pago</Label>
              <select name="metodo_pago" className={inputClass} defaultValue={m.metodo_pago || "efectivo"}>
                {METODOS_PAGO.map((x) => (
                  <option key={x} value={x}>{METODO_PAGO_LABEL[x]}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label>Reemplazar comprobante (opcional)</Label>
            <input type="file" name="comprobante" className="text-xs" />
          </div>
          <div className="sm:col-span-2">
            <Label>Notas</Label>
            <input name="notas" defaultValue={m.notas || ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.notas} />
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
 * Sub-fase 4.4 (Eliminación segura de movimientos financieros): mismo
 * reemplazo de "Eliminar" (borrado físico) por "Anular" (baja lógica) que
 * AnularMovimientoBoton en finanzas/FinanzasFormularios.tsx — ver ese
 * comentario y anularMovimientoCuentaSocioAction (actions/cuentaSocios.ts)
 * para el detalle completo.
 */
export function AnularMovimientoCuentaBoton({ id, concepto }: { id: number; concepto: string }) {
  return (
    <details className="inline-block">
      <summary className="cursor-pointer text-xs text-[var(--color-rojo)] underline underline-offset-2">Anular</summary>
      <ActionForm action={anularMovimientoCuentaSocioFormAction} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <input name="motivo" placeholder={`Motivo (opcional) — se va a anular "${concepto}"`} className={inputClass + " text-xs w-64"} />
        <button className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Confirmar anulación</button>
      </ActionForm>
    </details>
  );
}

/**
 * Nuevo convenio de pago (pedido explícito: cuotas de convenio, "cómo va la
 * cuota"). Al crearlo se generan automáticamente todas sus cuotas — ver
 * crearConvenioAction en lib/actions/convenios.ts.
 */
export function NuevoConvenioForm({ socioId, deudaVencida }: { socioId: number; deudaVencida?: { monto: number; cuotas: number } }) {
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
      <AddButton onClick={() => setOpen(true)}>Nuevo convenio de pago</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo convenio de pago">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <input type="hidden" name="socio_id" value={socioId} />
          <div className="sm:col-span-2">
            <Label>Motivo</Label>
            <input name="motivo" required placeholder="Deuda atrasada de 2025, arreglo de..." className={inputClass} />
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
          <RefinanciaCheckbox deudaVencida={deudaVencida} />
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

/** Gestión cooperativa integrada (04/10): el convenio refinancia la deuda
 * vencida actual. Sin tildar, el convenio se comporta como siempre (una
 * deuda nueva aparte). Tildado, las cuotas vencidas pasan a "En convenio" y
 * dejan de sumarse a la deuda (ya están representadas por el convenio). */
export function RefinanciaCheckbox({ deudaVencida }: { deudaVencida?: { monto: number; cuotas: number } }) {
  return (
    <label className="sm:col-span-2 flex items-start gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink cursor-pointer">
      <input type="checkbox" name="refinancia" defaultChecked={!!deudaVencida && deudaVencida.cuotas > 0} className="mt-1 h-4 w-4" />
      <span>
        <span className="font-medium">Refinancia la deuda vencida actual</span>
        <span className="block text-xs text-ink-muted">
          {deudaVencida && deudaVencida.cuotas > 0
            ? `Hoy debe $${Math.round(deudaVencida.monto).toLocaleString("es-UY")} en ${deudaVencida.cuotas} cuota(s) vencida(s). `
            : ""}
          Esas cuotas pasan a &quot;En convenio&quot; y dejan de sumarse a la deuda: la deuda pasa a ser la del convenio. Si el convenio se cancela, vuelven a contar.
        </span>
      </span>
    </label>
  );
}

export function GestionConvenioAcciones({ convenioId, refinancia = false }: { convenioId: number; refinancia?: boolean }) {
  const [estadoAccion, formAction] = useActionState(cambiarEstadoConvenioFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estadoAccion.ok) show("Convenio actualizado.");
    if (estadoAccion.error) show(estadoAccion.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoAccion]);

  return (
    <div className="flex flex-wrap items-center gap-3 mt-2">
      <form action={formAction} className="inline">
        <input type="hidden" name="id" value={convenioId} />
        <input type="hidden" name="estado" value="cumplido" />
        <button className="text-xs text-[var(--color-verde)] underline underline-offset-2">Marcar cumplido</button>
      </form>
      <form action={formAction} className="inline">
        <input type="hidden" name="id" value={convenioId} />
        <input type="hidden" name="estado" value="incumplido" />
        <button className="text-xs text-[var(--color-amarillo)] underline underline-offset-2">Marcar incumplido</button>
      </form>
      <ConfirmarEliminar
        action={cambiarEstadoConvenioFormAction}
        hiddenFields={{ id: convenioId, estado: "cancelado" }}
        titulo="¿Cancelar este convenio?"
        descripcion={
          refinancia
            ? "Las cuotas originales que este convenio refinanciaba vuelven a contar como deuda, y las cuotas del convenio quedan anuladas (los pagos hechos se mantienen y cubren esa deuda)."
            : "Las cuotas del convenio que todavía no vencieron se van a borrar. Las que ya vencieron quedan como están."
        }
        textoBoton="Cancelar convenio"
        confirmarLabel="Sí, cancelar convenio"
        className="text-xs text-ink-faint underline underline-offset-2"
      />
      <ConfirmarEliminar
        action={eliminarConvenioFormAction}
        hiddenFields={{ id: convenioId }}
        titulo="¿Eliminar este convenio?"
        descripcion="Solo funciona si todavía no venció ninguna cuota. Esta acción no se puede deshacer."
        textoBoton="Eliminar"
        className="text-xs text-[var(--color-rojo)] underline underline-offset-2"
      />
    </div>
  );
}
