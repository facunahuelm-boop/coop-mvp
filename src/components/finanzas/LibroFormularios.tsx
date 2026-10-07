"use client";

import { useActionState, useEffect, useState } from "react";
import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import {
  crearCuentaFormAction,
  editarCuentaFormAction,
  crearFondoFormAction,
  editarFondoFormAction,
  transferirFormAction,
  contraMovimientoFormAction,
  cerrarMesFormAction,
  visarMesFormAction,
  observarMesFormAction,
  reabrirMesFormAction,
  guardarLineaPresupuestoFormAction,
  quitarLineaPresupuestoFormAction,
  copiarPresupuestoFormAction,
  crearCompromisoFormAction,
  cancelarCompromisoFormAction,
  cumplirCompromisoFormAction,
  registrarFacturaFormAction,
  pagarFacturaFormAction,
  anularFacturaFormAction,
  guardarMapeoContableFormAction,
} from "@/lib/actions/libroFinanzas";

/**
 * Fase 2A — formularios de "Finanzas como un libro". Todos siguen el mismo
 * criterio pensado para personas mayores: un botón con texto que abre un
 * pop-up corto, "Volver" siempre visible, error explicado arriba.
 */

export type OpcionesLibro = {
  cuentas: { id: number; nombre: string; predeterminada: boolean }[];
  fondos: { id: number; nombre: string; predeterminado: boolean }[];
  rubros: string[];
  hoy: string;
};

const botonPrincipal =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-800)] text-white hover:bg-[var(--color-brand-700)] px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap";
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

function Campo({ label, required, children, ayuda }: { label: string; required?: boolean; children: React.ReactNode; ayuda?: string }) {
  return (
    <label className="block">
      <Label required={required}>{label}</Label>
      {children}
      {ayuda && <span className="mt-1 block text-[13px] text-ink-muted">{ayuda}</span>}
    </label>
  );
}

export function SelectCuenta({ opciones, name = "cuenta_id", defaultValue, label = "Cuenta (dónde está la plata)" }: { opciones: OpcionesLibro; name?: string; defaultValue?: number | null; label?: string }) {
  const def = defaultValue ?? opciones.cuentas.find((c) => c.predeterminada)?.id ?? opciones.cuentas[0]?.id;
  return (
    <Campo label={label} required>
      <select name={name} defaultValue={def ?? ""} className={inputClass} required>
        {opciones.cuentas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
    </Campo>
  );
}

export function SelectFondo({ opciones, name = "fondo_id", defaultValue, label = "Fondo (para qué es la plata)" }: { opciones: OpcionesLibro; name?: string; defaultValue?: number | null; label?: string }) {
  const def = defaultValue ?? opciones.fondos.find((f) => f.predeterminado)?.id ?? opciones.fondos[0]?.id;
  return (
    <Campo label={label} required>
      <select name={name} defaultValue={def ?? ""} className={inputClass} required>
        {opciones.fondos.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nombre}
          </option>
        ))}
      </select>
    </Campo>
  );
}

export function CampoRubro({ opciones, defaultValue, name = "categoria", required = true }: { opciones: OpcionesLibro; defaultValue?: string | null; name?: string; required?: boolean }) {
  const id = `rubros-${name}`;
  return (
    <Campo label="Rubro" required={required} ayuda="Elegí uno de la lista o escribí uno nuevo.">
      <input name={name} list={id} defaultValue={defaultValue ?? ""} required={required} maxLength={120} className={inputClass} placeholder="Ej.: Materiales, Administración…" />
      <datalist id={id}>
        {opciones.rubros.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </Campo>
  );
}

/** Fecha, cuenta y fondo: lo nuevo que piden todos los movimientos desde la Fase 2A. */
export function CamposLibro({ opciones, fecha, cuentaId, fondoId }: { opciones: OpcionesLibro; fecha?: string | null; cuentaId?: number | null; fondoId?: number | null }) {
  if (!opciones.cuentas.length) return null; // migración 0055 pendiente: la base completa cuenta y fondo sola
  return (
    <>
      <Campo label="Fecha" required>
        <input type="date" name="fecha" defaultValue={(fecha ?? opciones.hoy).slice(0, 10)} max={opciones.hoy} required className={inputClass} />
      </Campo>
      <SelectCuenta opciones={opciones} defaultValue={cuentaId} />
      <SelectFondo opciones={opciones} defaultValue={fondoId} />
    </>
  );
}

// ---------------- Cuentas y fondos ----------------

type CuentaFila = { id: number; nombre: string; tipo: string; banco: string | null; referencia: string | null; saldo_inicial: number; predeterminada: number; para_efectivo: number; activa: number };

export function CuentaForm({ cuenta }: { cuenta?: CuentaFila }) {
  const [tipo, setTipo] = useState(cuenta?.tipo ?? "banco");
  return (
    <FormularioEnModal
      textoBoton={cuenta ? "Cambiar" : "+ Agregar cuenta"}
      claseBoton={cuenta ? botonLink : undefined}
      titulo={cuenta ? `Cuenta: ${cuenta.nombre}` : "Nueva cuenta"}
      descripcion="Una cuenta es dónde está la plata: una cuenta del banco o la caja en efectivo."
      action={cuenta ? editarCuentaFormAction : crearCuentaFormAction}
      ocultos={cuenta ? { id: cuenta.id } : {}}
      mensajeExito="Cuenta guardada."
    >
      <Campo label="Nombre" required>
        <input name="nombre" required maxLength={80} defaultValue={cuenta?.nombre} placeholder="Ej.: BROU caja de ahorro, Caja de la oficina" className={inputClass} />
      </Campo>
      <Campo label="Tipo" required>
        <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
          <option value="banco">Cuenta de banco</option>
          <option value="caja">Caja (efectivo)</option>
        </select>
      </Campo>
      {tipo === "banco" && (
        <Campo label="Banco">
          <input name="banco" maxLength={80} defaultValue={cuenta?.banco ?? ""} placeholder="Ej.: BROU" className={inputClass} />
        </Campo>
      )}
      <Campo label="Referencia" ayuda="Algo para reconocerla, por ejemplo «terminada en 1234». No pongas el número completo.">
        <input name="referencia" maxLength={80} defaultValue={cuenta?.referencia ?? ""} className={inputClass} />
      </Campo>
      <Campo label="Saldo antes de empezar a usar COOVA" ayuda="Lo que tenía esta cuenta antes del primer movimiento cargado. Después de cerrar un mes ya no se cambia.">
        <input name="saldo_inicial" type="number" step="0.01" min={0} defaultValue={cuenta?.saldo_inicial ?? 0} className={inputClass} />
      </Campo>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="predeterminada" defaultChecked={!!cuenta?.predeterminada} className="h-5 w-5" />
        <span>Es la cuenta principal (la que se usa si no se elige otra)</span>
      </label>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="para_efectivo" defaultChecked={!!cuenta?.para_efectivo} className="h-5 w-5" />
        <span>Acá entran los pagos de cuotas en efectivo</span>
      </label>
      {cuenta && (
        <label className="flex items-center gap-3">
          <input type="checkbox" name="activa" defaultChecked={!!cuenta.activa} className="h-5 w-5" />
          <span>Se sigue usando (si la desmarcás, queda en el historial pero no se puede elegir)</span>
        </label>
      )}
    </FormularioEnModal>
  );
}

type FondoFila = { id: number; nombre: string; tipo: string; descripcion: string | null; saldo_inicial: number; predeterminado: number; recibe_cuotas: number; comision_id: number | null; tope: number | null; activo: number };

export function FondoForm({ fondo, comisiones }: { fondo?: FondoFila; comisiones: { id: number; nombre: string }[] }) {
  const [tipo, setTipo] = useState(fondo?.tipo ?? "otro");
  return (
    <FormularioEnModal
      textoBoton={fondo ? "Cambiar" : "+ Agregar fondo"}
      claseBoton={fondo ? botonLink : undefined}
      titulo={fondo ? `Fondo: ${fondo.nombre}` : "Nuevo fondo"}
      descripcion="Un fondo es para qué está separada la plata: la obra, la reserva, el mantenimiento, la caja chica de una comisión…"
      action={fondo ? editarFondoFormAction : crearFondoFormAction}
      ocultos={fondo ? { id: fondo.id } : {}}
      mensajeExito="Fondo guardado."
    >
      <Campo label="Nombre" required>
        <input name="nombre" required maxLength={80} defaultValue={fondo?.nombre} placeholder="Ej.: Fondo de obra" className={inputClass} />
      </Campo>
      <Campo label="Tipo" required>
        <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
          <option value="general">General</option>
          <option value="obra">Obra / préstamo</option>
          <option value="social">Fondo social</option>
          <option value="reserva">Reserva</option>
          <option value="mantenimiento">Mantenimiento</option>
          <option value="caja_chica">Caja chica de una comisión</option>
          <option value="otro">Otro</option>
        </select>
      </Campo>
      {tipo === "caja_chica" && (
        <>
          <Campo label="Comisión">
            <select name="comision_id" defaultValue={fondo?.comision_id ?? ""} className={inputClass}>
              <option value="">—</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Monto máximo de la caja chica">
            <input name="tope" type="number" step="0.01" min={0} defaultValue={fondo?.tope ?? ""} className={inputClass} />
          </Campo>
        </>
      )}
      <Campo label="Para qué es">
        <input name="descripcion" maxLength={300} defaultValue={fondo?.descripcion ?? ""} className={inputClass} />
      </Campo>
      <Campo label="Saldo antes de empezar a usar COOVA">
        <input name="saldo_inicial" type="number" step="0.01" min={0} defaultValue={fondo?.saldo_inicial ?? 0} className={inputClass} />
      </Campo>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="predeterminado" defaultChecked={!!fondo?.predeterminado} className="h-5 w-5" />
        <span>Es el fondo principal (el que se usa si no se elige otro)</span>
      </label>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="recibe_cuotas" defaultChecked={!!fondo?.recibe_cuotas} className="h-5 w-5" />
        <span>Acá entran los pagos de cuotas</span>
      </label>
      {fondo && (
        <label className="flex items-center gap-3">
          <input type="checkbox" name="activo" defaultChecked={!!fondo.activo} className="h-5 w-5" />
          <span>Se sigue usando</span>
        </label>
      )}
    </FormularioEnModal>
  );
}

export function TransferirForm({ opciones }: { opciones: OpcionesLibro }) {
  return (
    <FormularioEnModal
      textoBoton="Pasar plata entre cuentas o fondos"
      titulo="Pasar plata entre cuentas o fondos"
      descripcion="Por ejemplo: depositar en el banco lo que juntó la caja, o separar plata para la reserva. No es un ingreso ni un gasto: sólo cambia de lugar."
      action={transferirFormAction}
      mensajeExito="Listo: la plata cambió de lugar."
      textoConfirmar="Pasar la plata"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Monto" required>
          <input name="monto" type="number" step="0.01" min="0.01" required className={inputClass} />
        </Campo>
        <Campo label="Fecha" required>
          <input type="date" name="fecha" defaultValue={opciones.hoy} max={opciones.hoy} required className={inputClass} />
        </Campo>
      </div>
      <fieldset className="rounded-xl border border-border p-3 space-y-3">
        <legend className="px-1 font-semibold text-ink">Sale de</legend>
        <SelectCuenta opciones={opciones} name="cuenta_origen_id" label="Cuenta" />
        <SelectFondo opciones={opciones} name="fondo_origen_id" label="Fondo" />
      </fieldset>
      <fieldset className="rounded-xl border border-border p-3 space-y-3">
        <legend className="px-1 font-semibold text-ink">Va a</legend>
        <SelectCuenta opciones={opciones} name="cuenta_destino_id" label="Cuenta" />
        <SelectFondo opciones={opciones} name="fondo_destino_id" label="Fondo" />
      </fieldset>
      <Campo label="Detalle">
        <input name="descripcion" maxLength={300} placeholder="Ej.: depósito de la caja de setiembre" className={inputClass} />
      </Campo>
    </FormularioEnModal>
  );
}

export function CorregirMovimientoForm({ id, texto, hoy }: { id: number; texto: string; hoy: string }) {
  return (
    <FormularioEnModal
      textoBoton="Corregir"
      claseBoton="text-xs text-[var(--color-brand-800)] underline underline-offset-2"
      titulo="Corregir con un contra-movimiento"
      descripcion={
        <>
          <p>
            Se va a registrar el movimiento contrario a <b>{texto}</b> en un mes abierto, para dejarlo en cero. El original no se toca: el libro muestra
            las dos cosas.
          </p>
          <p className="mt-2 text-ink-muted">Si además hay que cargar el dato correcto, cargalo después como un movimiento nuevo.</p>
        </>
      }
      action={contraMovimientoFormAction}
      ocultos={{ id }}
      textoConfirmar="Registrar la corrección"
    >
      <Campo label="Fecha de la corrección" required>
        <input type="date" name="fecha" defaultValue={hoy} max={hoy} required className={inputClass} />
      </Campo>
      <Campo label="Motivo" required>
        <input name="motivo" required maxLength={300} placeholder="Ej.: se cargó dos veces" className={inputClass} />
      </Campo>
    </FormularioEnModal>
  );
}

// ---------------- Cierre del mes ----------------

export function CerrarMesBoton({ periodo, texto }: { periodo: string; texto: string }) {
  return (
    <FormularioEnModal
      textoBoton={`Cerrar ${texto}`}
      claseBoton={botonPrincipal}
      titulo={`Cerrar ${texto}`}
      descripcion={
        <>
          <p>Al cerrar el mes:</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>Nadie puede agregar, cambiar ni anular movimientos de ese mes.</li>
            <li>Se guardan los saldos de cada cuenta y fondo.</li>
            <li>La Comisión Fiscal recibe el aviso para darle el visto.</li>
          </ul>
          <p className="mt-2">Si después aparece un error, se corrige con un contra-movimiento en un mes abierto.</p>
        </>
      }
      action={cerrarMesFormAction}
      ocultos={{ periodo }}
      textoConfirmar="Sí, cerrar el mes"
    />
  );
}

export function VisarMesBoton({ periodo, texto }: { periodo: string; texto: string }) {
  return (
    <FormularioEnModal
      textoBoton="Dar el visto"
      claseBoton={botonPrincipal}
      titulo={`Visar ${texto}`}
      descripcion="Con tu visto, el mes queda cerrado en forma definitiva. Revisá antes el PDF del cierre."
      action={visarMesFormAction}
      ocultos={{ periodo }}
      textoConfirmar="Sí, dar el visto"
    />
  );
}

export function ObservarMesForm({ periodo, texto }: { periodo: string; texto: string }) {
  return (
    <FormularioEnModal
      textoBoton="Devolver con una observación"
      titulo={`Devolver ${texto} a tesorería`}
      descripcion="El mes vuelve a quedar abierto para que tesorería corrija lo que señales."
      action={observarMesFormAction}
      ocultos={{ periodo }}
      textoConfirmar="Devolver"
    >
      <Campo label="Observación" required>
        <textarea name="observacion" required maxLength={1000} rows={4} className={inputClass} placeholder="Qué hay que revisar o corregir" />
      </Campo>
    </FormularioEnModal>
  );
}

export function ReabrirMesForm({ periodo, texto }: { periodo: string; texto: string }) {
  return (
    <FormularioEnModal
      textoBoton="Reabrir"
      titulo={`Reabrir ${texto}`}
      descripcion="Sólo si la Fiscal todavía no le dio el visto. La Fiscal recibe un aviso con el motivo."
      action={reabrirMesFormAction}
      ocultos={{ periodo }}
      textoConfirmar="Reabrir el mes"
      peligro
    >
      <Campo label="Motivo" required>
        <input name="motivo" required maxLength={500} className={inputClass} />
      </Campo>
    </FormularioEnModal>
  );
}

// ---------------- Presupuesto ----------------

export function LineaPresupuestoForm({ anio, linea, opciones }: { anio: string; linea?: { id: number; categoria: string; presupuestado: number }; opciones: OpcionesLibro }) {
  return (
    <FormularioEnModal
      textoBoton={linea ? "Cambiar" : "+ Agregar rubro"}
      claseBoton={linea ? botonLink : undefined}
      titulo={linea ? `Presupuesto ${anio}: ${linea.categoria}` : `Agregar un rubro al presupuesto ${anio}`}
      action={guardarLineaPresupuestoFormAction}
      ocultos={{ anio, ...(linea ? { id: linea.id } : {}) }}
      mensajeExito="Presupuesto guardado."
    >
      <CampoRubro opciones={opciones} defaultValue={linea?.categoria} />
      <Campo label={`Monto para todo ${anio}`} required>
        <input name="monto" type="number" step="0.01" min={0} required defaultValue={linea?.presupuestado ?? ""} className={inputClass} />
      </Campo>
    </FormularioEnModal>
  );
}

export function QuitarLineaPresupuestoBoton({ id }: { id: number }) {
  return (
    <BotonAccion action={quitarLineaPresupuestoFormAction} ocultos={{ id }} mensajeExito="Rubro quitado del presupuesto." className="!px-2 !py-1 text-xs">
      Quitar
    </BotonAccion>
  );
}

export function CopiarPresupuestoBoton({ desde, hasta }: { desde: string; hasta: string }) {
  return (
    <BotonAccion action={copiarPresupuestoFormAction} ocultos={{ desde, hasta }}>
      Copiar los rubros de {desde}
    </BotonAccion>
  );
}

// ---------------- Compromisos ----------------

export function NuevoCompromisoForm({ opciones }: { opciones: OpcionesLibro }) {
  return (
    <FormularioEnModal
      textoBoton="+ Algo que hay que pagar o cobrar"
      titulo="Algo que hay que pagar o cobrar más adelante"
      descripcion="Sirve para que el disponible y el flujo de caja tengan en cuenta lo que ya está decidido. Las compras aprobadas aparecen solas."
      action={crearCompromisoFormAction}
      mensajeExito="Guardado."
    >
      <Campo label="¿Es para pagar o para cobrar?" required>
        <select name="tipo" defaultValue="egreso" className={inputClass}>
          <option value="egreso">Hay que pagarlo</option>
          <option value="ingreso">Va a entrar (ej. desembolso del préstamo)</option>
        </select>
      </Campo>
      <Campo label="Qué es" required>
        <input name="descripcion" required maxLength={300} className={inputClass} />
      </Campo>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Monto" required>
          <input name="monto" type="number" step="0.01" min="0.01" required className={inputClass} />
        </Campo>
        <Campo label="Fecha estimada" required>
          <input type="date" name="fecha_estimada" required defaultValue={opciones.hoy} className={inputClass} />
        </Campo>
      </div>
      <CampoRubro opciones={opciones} required={false} />
    </FormularioEnModal>
  );
}

export function CancelarCompromisoForm({ id }: { id: number }) {
  return (
    <FormularioEnModal textoBoton="Cancelar" claseBoton={botonLink} titulo="Ya no va" action={cancelarCompromisoFormAction} ocultos={{ id }} textoConfirmar="Cancelarlo" peligro mensajeExito="Compromiso cancelado.">
      <Campo label="Motivo" required>
        <input name="motivo" required maxLength={300} className={inputClass} />
      </Campo>
    </FormularioEnModal>
  );
}

export function CumplirCompromisoForm({ compromiso, opciones }: { compromiso: { id: number; descripcion: string; monto: number; tipo: string }; opciones: OpcionesLibro }) {
  const cobrar = compromiso.tipo === "ingreso";
  return (
    <FormularioEnModal
      textoBoton={cobrar ? "Ya entró" : "Ya se pagó"}
      claseBoton={botonLink}
      titulo={cobrar ? `Registrar que entró: ${compromiso.descripcion}` : `Registrar el pago: ${compromiso.descripcion}`}
      action={cumplirCompromisoFormAction}
      ocultos={{ id: compromiso.id }}
      mensajeExito="Registrado en Finanzas."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Monto" required>
          <input name="monto" type="number" step="0.01" min="0.01" required defaultValue={compromiso.monto} className={inputClass} />
        </Campo>
        <Campo label="Fecha" required>
          <input type="date" name="fecha" defaultValue={opciones.hoy} max={opciones.hoy} required className={inputClass} />
        </Campo>
      </div>
      <SelectCuenta opciones={opciones} />
      <SelectFondo opciones={opciones} />
    </FormularioEnModal>
  );
}

// ---------------- Facturas ----------------

export function NuevaFacturaForm({
  opciones,
  proveedores,
  compras = [],
}: {
  opciones: OpcionesLibro;
  proveedores: { id: number; nombre: string }[];
  compras?: { id: number; material: string; proveedor: string | null }[];
}) {
  return (
    <FormularioEnModal
      textoBoton="+ Cargar factura a pagar"
      claseBoton={botonPrincipal}
      titulo="Cargar una factura a pagar"
      descripcion="Si es la factura de una compra aprobada, elegila en la lista: el proveedor y el compromiso se completan solos."
      action={registrarFacturaFormAction}
      mensajeExito="Factura cargada. Aparece en «Lo que hay que pagar»."
    >
      {compras.length > 0 && (
        <Campo label="¿Es de una compra aprobada?">
          <select name="solicitud_compra_id" defaultValue="" className={inputClass}>
            <option value="">No, es otra factura</option>
            {compras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.material}
                {c.proveedor ? ` — ${c.proveedor}` : ""}
              </option>
            ))}
          </select>
        </Campo>
      )}
      <Campo label="Proveedor">
        <select name="proveedor_id" defaultValue="" className={inputClass}>
          <option value="">— Elegí uno o escribí uno nuevo abajo —</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </Campo>
      <Campo label="Proveedor nuevo (si no está en la lista)">
        <input name="nuevo_proveedor" maxLength={200} className={inputClass} />
      </Campo>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Número de factura">
          <input name="numero" maxLength={60} className={inputClass} />
        </Campo>
        <Campo label="Monto" required>
          <input name="monto" type="number" step="0.01" min="0.01" required className={inputClass} />
        </Campo>
        <Campo label="Fecha de la factura">
          <input type="date" name="fecha_emision" defaultValue={opciones.hoy} className={inputClass} />
        </Campo>
        <Campo label="Vence el">
          <input type="date" name="fecha_vencimiento" className={inputClass} />
        </Campo>
      </div>
      <CampoRubro opciones={opciones} required={false} />
      <Campo label="Detalle">
        <input name="descripcion" maxLength={300} className={inputClass} />
      </Campo>
      <Campo label="Archivo de la factura (opcional)">
        <input type="file" name="archivo" accept=".pdf,.jpg,.jpeg,.png,.webp" className="block w-full text-sm" />
      </Campo>
    </FormularioEnModal>
  );
}

export function PagarFacturaForm({ factura, opciones }: { factura: { id: number; monto: number; texto: string }; opciones: OpcionesLibro }) {
  return (
    <FormularioEnModal
      textoBoton="Pagar"
      claseBoton="inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] text-white px-3 py-1.5 text-sm font-semibold"
      titulo={`Pagar ${factura.texto}`}
      descripcion="Se registra el egreso en Finanzas y la factura queda pagada."
      action={pagarFacturaFormAction}
      ocultos={{ id: factura.id }}
      textoConfirmar="Registrar el pago"
      mensajeExito="Pago registrado."
    >
      <Campo label="Fecha del pago" required>
        <input type="date" name="fecha" defaultValue={opciones.hoy} max={opciones.hoy} required className={inputClass} />
      </Campo>
      <SelectCuenta opciones={opciones} label="Se paga desde la cuenta" />
      <SelectFondo opciones={opciones} label="Con plata del fondo" />
    </FormularioEnModal>
  );
}

export function AnularFacturaForm({ id }: { id: number }) {
  return (
    <FormularioEnModal textoBoton="Anular" claseBoton={botonLink} titulo="Anular la factura" action={anularFacturaFormAction} ocultos={{ id }} textoConfirmar="Anularla" peligro mensajeExito="Factura anulada.">
      <Campo label="Motivo" required>
        <input name="motivo" required maxLength={300} className={inputClass} />
      </Campo>
    </FormularioEnModal>
  );
}

// ---------------- Para el contador ----------------

export function MapeoContableFila({ categoria, codigo, nombre }: { categoria: string; codigo: string | null; nombre: string | null }) {
  const [estado, formAction] = useActionState(guardarMapeoContableFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) show(`Guardado: ${categoria}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_1fr_auto] gap-2 items-end border-b border-border py-2 last:border-0">
      <input type="hidden" name="categoria" value={categoria} />
      <div className="font-medium text-ink">{categoria}</div>
      <input name="codigo" defaultValue={codigo ?? ""} maxLength={30} placeholder="Código" aria-label={`Código contable de ${categoria}`} className={inputClass} />
      <input name="nombre_contable" defaultValue={nombre ?? ""} maxLength={120} placeholder="Nombre en el plan de cuentas" aria-label={`Cuenta contable de ${categoria}`} className={inputClass} />
      <SubmitButton variant="secondary" pendingLabel="…">
        Guardar
      </SubmitButton>
      {estado.error && (
        <div className="sm:col-span-4">
          <FormError message={estado.error} />
        </div>
      )}
    </form>
  );
}
