"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import { FormError, Modal, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import {
  extractoFormAction,
  confirmarLineaFormAction,
  pagoCuotaDesdeLineaFormAction,
  nuevoMovimientoDesdeLineaFormAction,
  ignorarLineaFormAction,
  deshacerConciliacionFormAction,
  candidatosParaLinea,
  type EstadoExtracto,
} from "@/lib/actions/conciliacion";
import { CampoRubro, SelectFondo, type OpcionesLibro } from "@/components/finanzas/LibroFormularios";

/**
 * Fase 2B — conciliación bancaria. Importar el extracto en dos pasos (ver
 * cómo se lee → importar) y resolver cada línea con un botón.
 */

const pesos = (n: number) => `${n < 0 ? "− " : ""}$ ${Math.abs(n).toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");
const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60";
const botonSecundario = "inline-flex items-center justify-center rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken disabled:opacity-60";

const CAMPOS: { clave: keyof NonNullable<EstadoExtracto["vista"]>["columnas"]; nombre: string; titulo: string; obligatorio?: boolean }[] = [
  { clave: "fecha", nombre: "col_fecha", titulo: "Fecha", obligatorio: true },
  { clave: "descripcion", nombre: "col_descripcion", titulo: "Concepto / descripción" },
  { clave: "referencia", nombre: "col_referencia", titulo: "Referencia o N° de documento" },
  { clave: "monto", nombre: "col_monto", titulo: "Importe (una sola columna con + y −)" },
  { clave: "debito", nombre: "col_debito", titulo: "Débito (lo que salió)" },
  { clave: "credito", nombre: "col_credito", titulo: "Crédito (lo que entró)" },
  { clave: "saldo", nombre: "col_saldo", titulo: "Saldo" },
];

export function ImportarExtracto({ cuentas, cuentaId }: { cuentas: { id: number; nombre: string }[]; cuentaId: number }) {
  const [estado, setEstado] = useState<EstadoExtracto>(ESTADO_INICIAL);
  const [pendiente, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const pasoRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();

  const enviar = (paso: "ver" | "importar") => {
    if (!formRef.current) return;
    if (pasoRef.current) pasoRef.current.value = paso;
    const fd = new FormData(formRef.current);
    startTransition(async () => {
      const r = await extractoFormAction(estado, fd);
      setEstado(r);
      if (r.ok && r.resultado) {
        show(`Listo: ${r.resultado.nuevas} línea(s) nuevas del banco.`);
        formRef.current?.reset();
      }
    });
  };

  const v = estado.vista;
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        enviar("ver");
      }}
      className="space-y-4 text-[15px]"
    >
      <input ref={pasoRef} type="hidden" name="paso" value="ver" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <Label required>Cuenta del banco</Label>
          <select name="cuenta_id" defaultValue={cuentaId} className={inputClass} onChange={() => setEstado(ESTADO_INICIAL)}>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label required>Archivo del extracto (.csv o .xlsx)</Label>
          <input type="file" name="archivo" accept=".csv,.xlsx,.txt" required className="block w-full text-sm py-2" onChange={() => setEstado(ESTADO_INICIAL)} />
        </label>
      </div>

      <FormError message={estado.error} />

      {estado.resultado && (
        <p className="rounded-xl bg-[var(--color-verde-bg)] px-4 py-3 text-ink">
          Se importaron <b>{estado.resultado.nuevas}</b> línea(s) nuevas
          {estado.resultado.repetidas ? ` (${estado.resultado.repetidas} ya estaban de antes y no se repitieron)` : ""}.{" "}
          {estado.resultado.propuestas ? (
            <>
              COOVA encontró con qué coinciden <b>{estado.resultado.propuestas}</b> de las líneas para revisar
              {estado.resultado.automaticas ? ` (y confirmó solas ${estado.resultado.automaticas} por código de pago)` : ""}.
            </>
          ) : (
            "Ninguna coincide sola con lo cargado en COOVA."
          )}{" "}
          Revisalas abajo.
        </p>
      )}

      {v && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="font-semibold text-ink">
            {v.formatoGuardado ? "Se usó el formato guardado para esta cuenta." : "COOVA adivinó qué es cada columna."} Revisá que esté bien:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CAMPOS.map((c) => (
              <label key={c.nombre} className="block">
                <Label required={c.obligatorio}>{c.titulo}</Label>
                <select name={c.nombre} defaultValue={v.columnas[c.clave] ?? ""} className={inputClass}>
                  <option value="">— No está en el archivo —</option>
                  {v.encabezados.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-ink-muted">
            Con estas columnas se leen <b className="text-ink">{v.leidas}</b> línea(s){v.descartadas ? ` (se saltean ${v.descartadas} que no tienen fecha o importe, como totales o títulos)` : ""}. Así quedan las primeras:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {v.ejemplo.map((e, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fechaCorta(e.fecha)}</td>
                    <td className="py-1.5 pr-3">{e.descripcion}</td>
                    <td className={`py-1.5 text-right whitespace-nowrap font-semibold ${e.monto < 0 ? "text-[var(--color-rojo)]" : "text-[var(--color-verde)]"}`}>{pesos(e.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pendiente} onClick={() => enviar("ver")} className={botonSecundario}>
              Volver a leer con estas columnas
            </button>
            <button type="button" disabled={pendiente || v.leidas === 0} onClick={() => enviar("importar")} className={botonPrincipal}>
              {pendiente ? "Importando…" : `Importar ${v.leidas} línea(s)`}
            </button>
          </div>
        </div>
      )}

      {!v && (
        <button type="submit" disabled={pendiente} className={botonPrincipal}>
          {pendiente ? "Leyendo…" : "Ver cómo se lee"}
        </button>
      )}
    </form>
  );
}

export type LineaUi = {
  id: number;
  fecha: string;
  descripcion: string | null;
  referencia: string | null;
  monto: number;
  propuesta_tipo: string | null;
  propuesta_movimiento_id: number | null;
  propuesta_socio_id: number | null;
  propuesta_texto: string | null;
};

const botonChico = "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm font-semibold text-ink hover:bg-surface-sunken";

export function AccionesLinea({ linea, opciones, socios }: { linea: LineaUi; opciones: OpcionesLibro; socios: { id: number; nombre: string; codigo: string }[] }) {
  const entra = linea.monto > 0;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {linea.propuesta_movimiento_id && (
        <BotonAccion action={confirmarLineaFormAction} ocultos={{ linea_id: linea.id, movimiento_id: linea.propuesta_movimiento_id }} mensajeExito="Conciliado." className="!px-3 !py-1.5 text-sm">
          ✔ Confirmar
        </BotonAccion>
      )}
      {entra && !linea.propuesta_movimiento_id && (
        <FormularioEnModal
          textoBoton="Es un pago de cuota"
          claseBoton={botonChico}
          titulo={`Pago de cuota de ${pesos(linea.monto)}`}
          descripcion="Se registra el pago en la cuenta del socio (con su recibo) y queda conciliado con el banco."
          action={pagoCuotaDesdeLineaFormAction}
          ocultos={{ linea_id: linea.id }}
          textoConfirmar="Registrar el pago"
        >
          <label className="block">
            <Label required>¿De qué socio?</Label>
            <select name="socio_id" required defaultValue={linea.propuesta_socio_id ?? ""} className={inputClass}>
              <option value="">— Elegí —</option>
              {socios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} ({s.codigo})
                </option>
              ))}
            </select>
          </label>
        </FormularioEnModal>
      )}
      <OtroMovimiento linea={linea} />
      <FormularioEnModal
        textoBoton="Registrar en Finanzas"
        claseBoton={botonChico}
        titulo={entra ? `Ingreso de ${pesos(linea.monto)}` : `Gasto de ${pesos(linea.monto)}`}
        descripcion="Para lo que todavía no está en COOVA, como comisiones o intereses del banco."
        action={nuevoMovimientoDesdeLineaFormAction}
        ocultos={{ linea_id: linea.id }}
        textoConfirmar="Registrar y conciliar"
      >
        <CampoRubro opciones={opciones} defaultValue={entra ? "" : "Gastos bancarios"} />
        <SelectFondo opciones={opciones} />
        <label className="block">
          <Label>Detalle</Label>
          <input name="descripcion" maxLength={300} defaultValue={[linea.descripcion, linea.referencia].filter(Boolean).join(" · ")} className={inputClass} />
        </label>
        <label className="block">
          <Label>Fecha</Label>
          <input type="date" name="fecha" defaultValue={linea.fecha} max={opciones.hoy} className={inputClass} />
        </label>
      </FormularioEnModal>
      <FormularioEnModal
        textoBoton="Ignorar"
        claseBoton="text-sm font-semibold text-ink-muted underline underline-offset-2"
        titulo="Ignorar esta línea del banco"
        descripcion="Por ejemplo, si es un movimiento que se anuló en el mismo día. Queda registrada con el motivo."
        action={ignorarLineaFormAction}
        ocultos={{ linea_id: linea.id }}
        textoConfirmar="Ignorarla"
      >
        <label className="block">
          <Label required>Motivo</Label>
          <input name="motivo" required maxLength={300} className={inputClass} />
        </label>
      </FormularioEnModal>
    </div>
  );
}

function OtroMovimiento({ linea }: { linea: LineaUi }) {
  const [abierto, setAbierto] = useState(false);
  const [candidatos, setCandidatos] = useState<{ id: number; fecha: string; monto: string; categoria: string; descripcion: string | null; cuenta: string | null }[] | null>(null);
  const [estado, formAction] = useActionState(confirmarLineaFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (abierto && candidatos === null) candidatosParaLinea(linea.id).then(setCandidatos).catch(() => setCandidatos([]));
  }, [abierto, candidatos, linea.id]);
  useEffect(() => {
    if (estado.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- cerrar el pop-up cuando el servidor confirma (mismo patrón que FormularioEnModal)
      setAbierto(false);
      show("Conciliado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={botonChico}>
        {linea.propuesta_movimiento_id ? "Es otro" : "Buscar en COOVA"}
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} title={`¿Con qué movimiento coincide? (${pesos(linea.monto)} del ${fechaCorta(linea.fecha)})`}>
        <div className="space-y-3 text-[15px]">
          <FormError message={estado.error} />
          {candidatos === null ? (
            <p>Buscando…</p>
          ) : candidatos.length === 0 ? (
            <p>No hay movimientos sin conciliar parecidos. Usá «Registrar en Finanzas».</p>
          ) : (
            <ul className="divide-y divide-border">
              {candidatos.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>{pesos(Number(c.monto) * (linea.monto < 0 ? -1 : 1))}</b> · {fechaCorta(c.fecha)} · {c.categoria}
                    <span className="block text-sm text-ink-muted">
                      {c.descripcion}
                      {c.cuenta ? ` · ${c.cuenta}` : ""}
                    </span>
                  </span>
                  <form action={formAction}>
                    <input type="hidden" name="linea_id" value={linea.id} />
                    <input type="hidden" name="movimiento_id" value={c.id} />
                    <button className={botonChico}>Es este</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={() => setAbierto(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken">
              Volver
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function DeshacerConciliacion({ lineaId }: { lineaId: number }) {
  return (
    <BotonAccion action={deshacerConciliacionFormAction} ocultos={{ linea_id: lineaId }} mensajeExito="Volvió a quedar pendiente." className="!px-2.5 !py-1 text-sm">
      Deshacer
    </BotonAccion>
  );
}
