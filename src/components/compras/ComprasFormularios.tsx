"use client";

// Fase 4 del rediseño: los 2 formularios de alta de Compras (nueva solicitud,
// cargar presupuesto) migrados a `useActionState` — mismo criterio que los
// demás módulos. Las acciones de decisión (marcar pedida/entregada, rechazar,
// decidir compra) quedan sin tocar, mismo criterio que en Obra/Seguridad.
//
// Rediseño profundo de Compras, Fase 2 (pedido explícito, sección 7: "Al
// hacer clic en + Nueva solicitud, abrir un MODAL. NO navegar a otra
// página"): `CrearSolicitudForm` deja de ser un `<details>` que despliega el
// formulario inline (patrón que sigue usando el resto del sistema, sin
// tocar) y pasa a abrirse en el `Modal` ya existente (`ui-client.tsx`,
// construido para el rediseño del Dashboard) — es el primer formulario de
// alta del sistema que usa este patrón; se eligió `size="lg"` porque tiene
// bastantes campos y un `md` los hubiera apretado. `agregarPresupuestoFormAction`
// (más abajo) NO se tocó: vive siempre dentro de la ficha de una solicitud
// puntual, no en un listado — ahí el `<details>` inline sigue siendo el
// patrón correcto (no hay "lista" de la que abrir un pop-up).

import { useActionState, useEffect, useRef, useState } from "react";
import { crearSolicitudFormAction, editarSolicitudFormAction, agregarPresupuestoFormAction, adjuntarFacturaCompraFormAction, registrarPagoCompraFormAction } from "@/lib/actions/compras";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButton, AddButtonSummary, Button, Card, Label, inputClass } from "@/components/ui";
import { CATEGORIA_COMPRA_LABEL, MEDIOS_PAGO, PLAZOS_PAGO, CONDICIONES_PAGO } from "@/lib/constants";
import { FormularioEnModal } from "@/components/FormularioEnModal";

type Opcion = { id: number; nombre: string };
// Rediseño profundo de Compras, Fase 6 (sección 18): el selector de proveedor
// al cargar un presupuesto es justo donde más importa ver de un vistazo si
// es un proveedor ya probado o uno nuevo/en evaluación — de ahí que necesite
// más que `Opcion` (que sólo tiene id/nombre, y sigue sirviendo para
// comisiones, sin `estado`).
type ProveedorOpcion = { id: number; nombre: string; estado?: string | null };
const PROVEEDOR_ESTADO_EMOJI: Record<string, string> = {
  habitual: "🟢",
  nuevo: "🟡",
  en_evaluacion: "🟡",
  inactivo: "⚪",
};

export function CrearSolicitudForm({
  comisiones,
  desdeResolucion,
  comisionPorDefecto,
}: {
  comisiones: Opcion[];
  /** Desde la ficha de una comisión: la solicitud ya sale a su nombre. */
  comisionPorDefecto?: Opcion;
  /** Recorrido de decisiones (04/10): la solicitud sale de una resolución
   * (punto de asamblea/consejo/comisión) — misma acción y mismos campos que
   * "Nueva solicitud" de Compras; sólo guarda de qué resolución salió. */
  desdeResolucion?: { agendaItemId: number; titulo: string; resultado: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(crearSolicitudFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // La respuesta de la Server Action (useActionState) sólo se conoce acá
      // — no hay ningún evento síncrono al que engancharse para cerrar el
      // Modal, mismo criterio ya documentado en CambiarFotoForm.tsx.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Solicitud creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      {desdeResolucion ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap">
          + Solicitud de compra
        </button>
      ) : (
        <AddButton onClick={() => setOpen(true)}>Nueva solicitud</AddButton>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={desdeResolucion ? "Solicitud de compra desde una resolución" : "Nueva solicitud de compra"} size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          {desdeResolucion && (
            <>
              <input type="hidden" name="agenda_item_id" value={desdeResolucion.agendaItemId} />
              <p className="sm:col-span-2 rounded-lg bg-[var(--accent-blue-bg)] px-3 py-2 text-xs text-[var(--accent-blue)]">
                Sale de la resolución «{desdeResolucion.titulo}»{desdeResolucion.resultado ? `: ${desdeResolucion.resultado}` : ""}. La solicitud sigue el circuito normal de Compras.
              </p>
            </>
          )}
          <div>
            <Label>Categoría de la compra</Label>
            <select name="categoria" className={inputClass} defaultValue="obra">
              {Object.entries(CATEGORIA_COMPRA_LABEL).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Subcategoría (opcional)</Label>
            <input name="subcategoria" className={inputClass} placeholder="Ej: cemento, guantes, extintores…" />
            <FieldError message={estado.fieldErrors?.subcategoria} />
          </div>
          <div>
            <Label required>Comisión solicitante</Label>
            <input name="comision" required className={inputClass} placeholder="Comisión de Obra" defaultValue={comisionPorDefecto?.nombre} />
            <FieldError message={estado.fieldErrors?.comision} />
          </div>
          <div>
            <Label>Vincular a una comisión real (opcional)</Label>
            <select name="comision_id" className={inputClass} defaultValue={comisionPorDefecto?.id ?? ""}>
              <option value="">— sin vincular —</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <p className="text-[11px] text-ink-faint mt-1">Vinculada, la compra suma al gasto de esa comisión en /gastos cuando se apruebe.</p>
          </div>
          <div>
            <Label required>Material</Label>
            <input name="material" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.material} />
          </div>
          <div>
            <Label required>Cantidad</Label>
            <input name="cantidad" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.cantidad} />
          </div>
          <div>
            <Label required>Unidad</Label>
            <input name="unidad" required className={inputClass} placeholder="kg, unidad, m2…" />
            <FieldError message={estado.fieldErrors?.unidad} />
          </div>
          <div className="sm:col-span-2">
            <Label>Especificación</Label>
            <input name="especificacion" className={inputClass} defaultValue={desdeResolucion?.resultado ?? undefined} />
            <FieldError message={estado.fieldErrors?.especificacion} />
          </div>
          <div>
            <Label>Etapa de obra (si corresponde)</Label>
            <input name="etapa_obra" className={inputClass} />
            <FieldError message={estado.fieldErrors?.etapa_obra} />
          </div>
          <div>
            <Label>Fecha necesaria</Label>
            <input type="date" name="fecha_necesaria" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_necesaria} />
          </div>
          <div>
            <Label>Prioridad</Label>
            <select name="prioridad" className={inputClass} defaultValue="media">
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
          </div>
          <div>
            <Label>Presupuesto estimado</Label>
            <input name="presupuesto_estimado" type="number" step="0.01" className={inputClass} />
            <FieldError message={estado.fieldErrors?.presupuesto_estimado} />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="recurrente" type="checkbox" name="recurrente" className="h-4 w-4" />
            <label htmlFor="recurrente" className="text-sm text-ink-muted">Esta compra se repite habitualmente (limpieza, papelería, mantenimiento…)</label>
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton variant="add" pendingLabel="Creando…">Crear solicitud</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

type SolicitudEditable = {
  id: number;
  categoria: string;
  subcategoria: string | null;
  recurrente: boolean;
  material: string;
  cantidad: number;
  unidad: string;
  especificacion: string | null;
  prioridad: string;
  etapa_obra: string | null;
  fecha_necesaria: string | null;
  presupuesto_estimado: number | null;
  actualizado_en: string;
};

/**
 * Rediseño profundo de Compras, Fase 5 (pedido explícito, sección 6:
 * "permitir editar... según permisos"). Mismos campos y mismo patrón Modal
 * que `CrearSolicitudForm` de arriba — a propósito sin comisión/comisión
 * vinculada (ver el comentario de `editarSolicitudAction` en compras.ts:
 * ese vínculo no se deja tocar después de creada la solicitud). Vive en
 * `/compras/[id]` (una solicitud puntual), así que no necesita la lista de
 * comisiones que sí usa `CrearSolicitudForm`.
 */
export function EditarSolicitudForm({ solicitud }: { solicitud: SolicitudEditable }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(editarSolicitudFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      // La respuesta de la Server Action (useActionState) sólo se conoce acá
      // — no hay ningún evento síncrono al que engancharse para cerrar el
      // Modal, mismo criterio ya documentado en CrearSolicitudForm de arriba
      // y en CambiarFotoForm.tsx.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Solicitud actualizada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="text-xs px-3 py-1.5">Editar</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Editar solicitud de compra" size="lg">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <input type="hidden" name="id" value={solicitud.id} />
          {/* H-3 (auditoría integral, 27/09): versión cargada al abrir este
             formulario — ver updateConBloqueoOptimista() en db.ts. */}
          <input type="hidden" name="version_esperada" value={solicitud.actualizado_en} />
          <div>
            <Label>Categoría de la compra</Label>
            <select name="categoria" className={inputClass} defaultValue={solicitud.categoria}>
              {Object.entries(CATEGORIA_COMPRA_LABEL).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Subcategoría (opcional)</Label>
            <input name="subcategoria" defaultValue={solicitud.subcategoria || ""} className={inputClass} placeholder="Ej: cemento, guantes, extintores…" />
            <FieldError message={estado.fieldErrors?.subcategoria} />
          </div>
          <div>
            <Label required>Material</Label>
            <input name="material" required defaultValue={solicitud.material} className={inputClass} />
            <FieldError message={estado.fieldErrors?.material} />
          </div>
          <div>
            <Label required>Cantidad</Label>
            <input name="cantidad" type="number" step="0.01" required defaultValue={solicitud.cantidad} className={inputClass} />
            <FieldError message={estado.fieldErrors?.cantidad} />
          </div>
          <div>
            <Label required>Unidad</Label>
            <input name="unidad" required defaultValue={solicitud.unidad} className={inputClass} placeholder="kg, unidad, m2…" />
            <FieldError message={estado.fieldErrors?.unidad} />
          </div>
          <div className="sm:col-span-2">
            <Label>Especificación</Label>
            <input name="especificacion" defaultValue={solicitud.especificacion || ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.especificacion} />
          </div>
          <div>
            <Label>Etapa de obra (si corresponde)</Label>
            <input name="etapa_obra" defaultValue={solicitud.etapa_obra || ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.etapa_obra} />
          </div>
          <div>
            <Label>Fecha necesaria</Label>
            <input type="date" name="fecha_necesaria" defaultValue={solicitud.fecha_necesaria || ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_necesaria} />
          </div>
          <div>
            <Label>Prioridad</Label>
            <select name="prioridad" className={inputClass} defaultValue={solicitud.prioridad}>
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
          </div>
          <div>
            <Label>Presupuesto estimado</Label>
            <input name="presupuesto_estimado" type="number" step="0.01" defaultValue={solicitud.presupuesto_estimado ?? ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.presupuesto_estimado} />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="recurrente-editar" type="checkbox" name="recurrente" defaultChecked={solicitud.recurrente} className="h-4 w-4" />
            <label htmlFor="recurrente-editar" className="text-sm text-ink-muted">Esta compra se repite habitualmente (limpieza, papelería, mantenimiento…)</label>
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
 * Rediseño profundo de Compras, Fase 4 (pedido explícito, sección 21).
 * Formulario chico, mismo criterio `<details>` inline que `CargarPresupuestoForm`
 * de acá abajo (vive dentro de la ficha de una solicitud puntual, no en un
 * listado — no aplica el patrón Modal de `CrearSolicitudForm`).
 */
export function AdjuntarFacturaForm({ solicitudId }: { solicitudId: number }) {
  const [estado, formAction] = useActionState(adjuntarFacturaCompraFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Factura adjuntada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef}>
      <AddButtonSummary>Adjuntar factura o comprobante</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input type="hidden" name="solicitud_id" value={solicitudId} />
          <div>
            <Label required>Nombre</Label>
            <input name="nombre" required className={inputClass} placeholder="Ej: Factura A-1234" />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>
          <div>
            <Label required>Archivo</Label>
            <input type="file" name="archivo" required className="text-xs" />
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción (opcional)</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          {/* Fase 2A: si es la factura a pagar, con el monto queda en Finanzas → «Lo que hay que pagar». */}
          <fieldset className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-ink">¿Es la factura que hay que pagar? Completá esto (opcional)</legend>
            <div>
              <Label>Monto a pagar</Label>
              <input name="monto" type="number" step="0.01" min="0" className={inputClass} />
              <FieldError message={estado.fieldErrors?.monto} />
            </div>
            <div>
              <Label>N° de factura</Label>
              <input name="numero" maxLength={60} className={inputClass} />
            </div>
            <div>
              <Label>Vence el</Label>
              <input name="fecha_vencimiento" type="date" className={inputClass} />
              <FieldError message={estado.fieldErrors?.fecha_vencimiento} />
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Adjuntando…">Adjuntar</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

/**
 * «Agregar presupuesto» en un pop-up (nunca se despliega hacia abajo). Dos usos:
 * - desde la ficha de una solicitud (`solicitudId` fijo);
 * - desde la comisión de Compras (arriba a la derecha): `solicitudes` abiertas
 *   para elegir a cuál se le carga la oferta.
 * El Reglamento (art. 5b) pide un mínimo de 3 presupuestos por compra; el
 * pop-up avisa cuántos lleva la solicitud elegida.
 */
export type SolicitudOpcion = { id: number; material: string; presupuestos: number };

export function CargarPresupuestoForm({
  solicitudId,
  solicitudes,
  proveedores,
  minimo = 3,
}: {
  solicitudId?: number;
  solicitudes?: SolicitudOpcion[];
  proveedores: ProveedorOpcion[];
  minimo?: number;
}) {
  const [open, setOpen] = useState(false);
  const [elegida, setElegida] = useState<number | "">(solicitudId ?? solicitudes?.[0]?.id ?? "");
  const [estado, formAction] = useActionState(agregarPresupuestoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Presupuesto cargado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const sinSolicitudes = !solicitudId && (!solicitudes || solicitudes.length === 0);
  const actual = solicitudes?.find((s) => s.id === elegida);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Agregar presupuesto</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Agregar presupuesto" size="lg">
        {sinSolicitudes ? (
          <p className="text-sm text-ink">
            Para cargar un presupuesto primero hace falta una solicitud de compra abierta. Creala con «Nueva solicitud» y después cargale las ofertas de los proveedores.
          </p>
        ) : (
          <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
            {solicitudId ? (
              <input type="hidden" name="solicitud_id" value={solicitudId} />
            ) : (
              <div className="sm:col-span-2">
                <Label required>¿Para qué compra es?</Label>
                <select name="solicitud_id" required className={inputClass} value={elegida} onChange={(e) => setElegida(Number(e.target.value))}>
                  {solicitudes!.map((s) => (
                    <option key={s.id} value={s.id}>{s.material} — {s.presupuestos} de {minimo} presupuestos</option>
                  ))}
                </select>
                {actual && actual.presupuestos < minimo && (
                  <p className="text-[11px] text-ink-faint mt-1">El Reglamento pide al menos {minimo} presupuestos: falta{minimo - actual.presupuestos === 1 ? "" : "n"} {minimo - actual.presupuestos}.</p>
                )}
              </div>
            )}
            <div>
              <Label>Proveedor existente</Label>
              <select name="proveedor_id" className={inputClass} defaultValue="">
                <option value="">— elegir —</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{PROVEEDOR_ESTADO_EMOJI[p.estado || "nuevo"]} {p.nombre}</option>
                ))}
              </select>
              <p className="text-[11px] text-ink-faint mt-1">🟢 habitual · 🟡 nuevo o en evaluación · ⚪ inactivo</p>
            </div>
            <div>
              <Label>...o proveedor nuevo</Label>
              <input name="nuevo_proveedor" className={inputClass} placeholder="Nombre del proveedor" />
            </div>
            <div>
              <Label required>Precio total</Label>
              <input name="precio" type="number" step="0.01" required className={inputClass} />
              <FieldError message={estado.fieldErrors?.precio} />
            </div>
            <div>
              <Label>Precio unitario</Label>
              <input name="precio_unitario" type="number" step="0.01" className={inputClass} />
              <FieldError message={estado.fieldErrors?.precio_unitario} />
            </div>
            <div>
              <Label>Costo de envío</Label>
              <input name="costo_envio" type="number" step="0.01" className={inputClass} />
              <FieldError message={estado.fieldErrors?.costo_envio} />
            </div>
            <div>
              <Label>Plazo de entrega (días)</Label>
              <input name="plazo_entrega_dias" type="number" className={inputClass} />
              <FieldError message={estado.fieldErrors?.plazo_entrega_dias} />
            </div>
            <div>
              <Label>Medio de pago — ¿cómo se paga?</Label>
              <select name="medio_pago" className={inputClass} defaultValue="">
                <option value="">— sin definir —</option>
                {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <FieldError message={estado.fieldErrors?.medio_pago} />
            </div>
            <div>
              <Label>Plazo de pago — ¿cuándo se paga?</Label>
              <select name="plazo_pago" className={inputClass} defaultValue="">
                <option value="">— sin definir —</option>
                {PLAZOS_PAGO.map((p) => <option key={p.valor} value={p.valor}>{p.valor}</option>)}
              </select>
              <FieldError message={estado.fieldErrors?.plazo_pago} />
            </div>
            <div>
              <Label>Condición negociada</Label>
              <select name="condicion_pago" className={inputClass} defaultValue="">
                <option value="">— sin definir —</option>
                {CONDICIONES_PAGO.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <FieldError message={estado.fieldErrors?.condicion_pago} />
              <p className="text-[11px] text-ink-faint mt-1">Confirmá con el proveedor que ofrezca ese plazo.</p>
            </div>
            <div>
              <Label>Garantía</Label>
              <input name="garantia" className={inputClass} />
              <FieldError message={estado.fieldErrors?.garantia} />
            </div>
            <div className="sm:col-span-2">
              <Label>Condiciones (calidad, entrega, etc.)</Label>
              <input name="condiciones" className={inputClass} placeholder="Ej: material de primera calidad, entrega en obra incluida" />
              <FieldError message={estado.fieldErrors?.condiciones} />
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
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken">Volver</button>
              <SubmitButton pendingLabel="Guardando…">Guardar presupuesto</SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}


/**
 * Pago al proveedor de una compra aprobada: condición negociada, vencimiento,
 * estado (pendiente / parcial / pagado), importe que queda por pagar y
 * comprobante. Es un registro de seguimiento: no mueve plata en Finanzas.
 */
export function RegistrarPagoCompraForm({ solicitudId, pago, total }: {
  solicitudId: number;
  total: number;
  pago: { medio: string | null; plazo: string | null; condicion: string | null; vencimiento: string | null; estado: string; pendiente: number | null; comprobante: string | null };
}) {
  const [estadoPago, setEstadoPago] = useState(pago.estado);
  return (
    <FormularioEnModal
      textoBoton="Actualizar pago"
      claseBoton="rounded-xl border border-border px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-sunken"
      titulo="Pago al proveedor"
      action={registrarPagoCompraFormAction}
      ocultos={{ solicitud_id: solicitudId }}
      mensajeExito="Pago actualizado."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Medio de pago</Label>
          <select name="medio_pago" className={inputClass} defaultValue={pago.medio ?? ""}>
            <option value="">— sin definir —</option>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <Label>Plazo de pago</Label>
          <select name="plazo_pago" className={inputClass} defaultValue={pago.plazo ?? ""}>
            <option value="">— sin definir —</option>
            {PLAZOS_PAGO.map((p) => <option key={p.valor} value={p.valor}>{p.valor}</option>)}
          </select>
        </div>
        <div>
          <Label>Condición negociada</Label>
          <select name="condicion_pago" className={inputClass} defaultValue={pago.condicion ?? ""}>
            <option value="">— sin definir —</option>
            {CONDICIONES_PAGO.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label>Fecha de vencimiento</Label>
          <input name="pago_vencimiento" type="date" defaultValue={pago.vencimiento ?? ""} className={inputClass} />
        </div>
        <div>
          <Label required>Estado</Label>
          <select name="pago_estado" className={inputClass} value={estadoPago} onChange={(e) => setEstadoPago(e.target.value)}>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Pago parcial</option>
            <option value="pagado">Pagado</option>
          </select>
        </div>
        {estadoPago !== "pagado" && (
          <div>
            <Label>{estadoPago === "parcial" ? "Importe pendiente" : "Importe a pagar"}</Label>
            <input name="pago_pendiente" type="number" step="0.01" min="0" defaultValue={pago.pendiente ?? (total || "")} className={inputClass} />
          </div>
        )}
        <div className="sm:col-span-2">
          <Label>Comprobante (N° de factura o recibo)</Label>
          <input name="pago_comprobante" maxLength={120} defaultValue={pago.comprobante ?? ""} className={inputClass} />
          <p className="text-[11px] text-ink-faint mt-1">Para adjuntar el archivo, usá la pestaña Documentos.</p>
        </div>
      </div>
    </FormularioEnModal>
  );
}
