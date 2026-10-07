"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Badge, Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import {
  calcularPadronFormAction,
  enviarConvocatoriaFormAction,
  marcarPresenteFormAction,
  asignarPoderFormAction,
  confirmarQuorumFormAction,
  crearVotacionFormAction,
  votoNominalFormAction,
  cerrarVotacionFormAction,
  anularVotacionFormAction,
  cerrarAsambleaFormAction,
  guardarActaFormAction,
  aprobarActaFormAction,
} from "@/lib/actions/asambleas";

/** Fase 2D — asamblea formal: botones grandes, una acción por toque. */

const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 text-sm font-semibold";

export function CalcularPadronBoton({ reunionId }: { reunionId: number }) {
  return (
    <BotonAccion action={calcularPadronFormAction} ocultos={{ reunion_id: reunionId }}>
      Volver a calcular el padrón
    </BotonAccion>
  );
}

export function EnviarConvocatoriaBoton({ reunionId, aviso }: { reunionId: number; aviso: string | null }) {
  return (
    <FormularioEnModal
      textoBoton="Enviar la convocatoria"
      claseBoton={botonPrincipal}
      titulo="Enviar la convocatoria a todos"
      descripcion={
        <>
          <p>Le llega a todas las personas con usuario en COOVA (aviso) y por email a quien tenga dirección cargada.</p>
          {aviso && <p className="mt-2 rounded-xl bg-[var(--color-amarillo-bg)] px-3 py-2">{aviso}</p>}
        </>
      }
      action={enviarConvocatoriaFormAction}
      ocultos={{ reunion_id: reunionId }}
      textoConfirmar="Sí, enviarla"
    />
  );
}

export function ConfirmarQuorumBoton({ reunionId, convocatoria, habilitado }: { reunionId: number; convocatoria: "primera" | "segunda"; habilitado: boolean }) {
  return (
    <FormularioEnModal
      textoBoton={`Empezar en ${convocatoria} convocatoria`}
      claseBoton={habilitado ? botonPrincipal : "inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-ink-muted"}
      titulo={`Empezar la asamblea en ${convocatoria} convocatoria`}
      descripcion="Lo confirma la mesa. Queda registrado con la cantidad de presentes en este momento."
      action={confirmarQuorumFormAction}
      ocultos={{ reunion_id: reunionId, convocatoria }}
      textoConfirmar="Confirmar"
    />
  );
}

export type FilaPadronUi = { id: number; nombre: string; habilitado: number; causa: string | null; presente: number; representado_por_id: number | null };

export function ListaPadron({ filas, editable, poderes }: { filas: FilaPadronUi[]; editable: boolean; poderes: boolean }) {
  const [q, setQ] = useState("");
  const [soloAusentes, setSoloAusentes] = useState(false);
  const visibles = useMemo(
    () => filas.filter((f) => (!q || f.nombre.toLowerCase().includes(q.toLowerCase())) && (!soloAusentes || !f.presente)),
    [filas, q, soloAusentes]
  );
  const presentesHabil = filas.filter((f) => f.presente && f.habilitado);
  const nombreDe = new Map(filas.map((f) => [f.id, f.nombre]));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…" aria-label="Buscar en el padrón" className={inputClass + " max-w-xs"} />
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={soloAusentes} onChange={(e) => setSoloAusentes(e.target.checked)} className="h-5 w-5" />
          Mostrar sólo los que no llegaron
        </label>
      </div>
      <ul className="divide-y divide-border">
        {visibles.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
            <span className="min-w-0">
              <b className={f.habilitado ? "text-ink" : "text-ink-muted"}>{f.nombre}</b>{" "}
              {f.presente ? <Badge color="verde">Presente</Badge> : f.representado_por_id ? <Badge color="azul">Con poder a {nombreDe.get(f.representado_por_id)}</Badge> : null}{" "}
              {!f.habilitado && <Badge color="gray">No vota</Badge>}
              {!f.habilitado && f.causa && <span className="block text-sm text-ink-muted">{f.causa}</span>}
            </span>
            {editable && (
              <span className="flex flex-wrap items-center gap-2">
                {poderes && !f.presente && f.habilitado ? (
                  <PoderSelect padronId={f.id} actual={f.representado_por_id} opciones={presentesHabil.filter((p) => p.id !== f.id)} />
                ) : null}
                <BotonAccion action={marcarPresenteFormAction} ocultos={{ padron_id: f.id, presente: f.presente ? "no" : "si" }} className="!px-3 !py-1.5 text-sm">
                  {f.presente ? "Se fue" : "✔ Llegó"}
                </BotonAccion>
              </span>
            )}
          </li>
        ))}
        {visibles.length === 0 && <li className="py-3 text-ink-muted">Nadie con ese nombre.</li>}
      </ul>
    </div>
  );
}

function PoderSelect({ padronId, actual, opciones }: { padronId: number; actual: number | null; opciones: FilaPadronUi[] }) {
  const [estado, formAction] = useActionState(asignarPoderFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    else if (estado.ok) show("Poder registrado.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="padron_id" value={padronId} />
      <select name="representante_id" defaultValue={actual ?? ""} aria-label="Representado por" className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
        <option value="">Sin poder</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            Lo representa {o.nombre}
          </option>
        ))}
      </select>
      <button className="rounded-lg border border-border px-2 py-1.5 text-sm font-semibold">Guardar</button>
    </form>
  );
}

export function NuevaVotacionForm({ reunionId, agenda }: { reunionId: number; agenda: { id: number; titulo: string }[] }) {
  const [punto, setPunto] = useState<string>(agenda[0] ? String(agenda[0].id) : "");
  const titulo = agenda.find((a) => String(a.id) === punto)?.titulo ?? "";
  return (
    <FormularioEnModal textoBoton="+ Votar un punto" claseBoton={botonPrincipal} titulo="Nueva votación" action={crearVotacionFormAction} ocultos={{ reunion_id: reunionId }} textoConfirmar="Abrir la votación">
      {agenda.length > 0 && (
        <label className="block">
          <Label>Punto del orden del día</Label>
          <select name="agenda_item_id" value={punto} onChange={(e) => setPunto(e.target.value)} className={inputClass}>
            {agenda.map((a) => (
              <option key={a.id} value={a.id}>
                {a.titulo}
              </option>
            ))}
            <option value="">Otro tema</option>
          </select>
        </label>
      )}
      <label className="block">
        <Label required>¿Qué se vota?</Label>
        <input key={punto} name="titulo" required maxLength={300} defaultValue={titulo ? `Aprobar: ${titulo}` : ""} className={inputClass} />
      </label>
      <fieldset className="space-y-2">
        <legend className="font-semibold text-ink mb-1">¿Con qué mayoría se aprueba?</legend>
        {[
          ["simple", "Mayoría simple", "Más votos a favor que en contra."],
          ["absoluta", "Mayoría absoluta", "Más de la mitad de los que pueden votar."],
          ["dos_tercios", "Dos tercios", "Al menos 2 de cada 3 votos emitidos (ej. reformas del estatuto)."],
        ].map(([v, t, d], i) => (
          <label key={v} className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 cursor-pointer has-[:checked]:border-[var(--color-brand-800)]">
            <input type="radio" name="mayoria" value={v} defaultChecked={i === 0} className="h-5 w-5 mt-0.5" />
            <span>
              <span className="block font-semibold text-ink">{t}</span>
              <span className="block text-[14px] text-ink-muted">{d}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold text-ink mb-1">¿Cómo se registra?</legend>
        <label className="flex items-center gap-3">
          <input type="radio" name="nominal" value="no" defaultChecked className="h-5 w-5" /> Contando las manos (se anota el total)
        </label>
        <label className="flex items-center gap-3">
          <input type="radio" name="nominal" value="si" className="h-5 w-5" /> Nominal (se anota el voto de cada uno)
        </label>
      </fieldset>
    </FormularioEnModal>
  );
}

export type VotacionUi = { id: number; titulo: string; mayoria: string; nominal: number };

export function VotacionAbierta({ v, votantes, votos, votosPosibles }: { v: VotacionUi; votantes: { id: number; nombre: string }[]; votos: Record<number, string>; votosPosibles: number }) {
  const [estado, formAction] = useActionState(cerrarVotacionFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) show("Votación cerrada.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  const cuenta = (k: string) => Object.values(votos).filter((x) => x === k).length;
  return (
    <div className="space-y-3 text-[15px]">
      <p>
        Pueden votar <b>{votosPosibles}</b> (presentes y con poder).
      </p>
      {v.nominal ? (
        <>
          <p className="text-ink-muted">
            A favor {cuenta("a_favor")} · En contra {cuenta("en_contra")} · Abstenciones {cuenta("abstencion")} · Faltan {Math.max(0, votantes.length - Object.keys(votos).length)}
          </p>
          <ul className="divide-y divide-border">
            {votantes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{p.nombre}</span>
                <span className="flex gap-1">
                  {(
                    [
                      ["a_favor", "A favor"],
                      ["en_contra", "En contra"],
                      ["abstencion", "Abstención"],
                    ] as const
                  ).map(([k, t]) => (
                    <BotonAccion key={k} action={votoNominalFormAction} ocultos={{ votacion_id: v.id, padron_id: p.id, voto: k }} className={`!px-2.5 !py-1 text-sm ${votos[p.id] === k ? "!bg-[var(--color-brand-800)] !text-white" : ""}`}>
                      {t}
                    </BotonAccion>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <form action={formAction}>
            <input type="hidden" name="votacion_id" value={v.id} />
            <FormError message={estado.error} />
            <SubmitButton>Cerrar la votación y contar</SubmitButton>
          </form>
        </>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="votacion_id" value={v.id} />
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <Label required>A favor</Label>
              <input name="a_favor" type="number" min={0} required className={inputClass} />
            </label>
            <label className="block">
              <Label required>En contra</Label>
              <input name="en_contra" type="number" min={0} required className={inputClass} />
            </label>
            <label className="block">
              <Label required>Abstenciones</Label>
              <input name="abstenciones" type="number" min={0} required defaultValue={0} className={inputClass} />
            </label>
          </div>
          <FormError message={estado.error} />
          <SubmitButton>Cerrar la votación</SubmitButton>
        </form>
      )}
      <FormularioEnModal textoBoton="Anular esta votación" claseBoton="text-sm text-ink-muted underline" titulo="Anular la votación" action={anularVotacionFormAction} ocultos={{ votacion_id: v.id }} textoConfirmar="Anular" peligro>
        <label className="block">
          <Label required>Motivo</Label>
          <input name="motivo" required maxLength={300} className={inputClass} />
        </label>
      </FormularioEnModal>
    </div>
  );
}

export function CerrarAsambleaBoton({ reunionId }: { reunionId: number }) {
  return (
    <FormularioEnModal
      textoBoton="Terminar la asamblea"
      claseBoton={botonPrincipal}
      titulo="Terminar la asamblea"
      descripcion="Se arma el borrador del acta con todo lo registrado (asistencia, quórum, votaciones y resoluciones). Después se puede corregir y aprobar."
      action={cerrarAsambleaFormAction}
      ocultos={{ reunion_id: reunionId }}
      textoConfirmar="Sí, terminar"
    />
  );
}

export function ActaEditor({ actaId, texto, editable }: { actaId: number; texto: string; editable: boolean }) {
  const [estado, formAction] = useActionState(guardarActaFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) show("Borrador guardado.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="acta_id" value={actaId} />
      <textarea name="texto" defaultValue={texto} rows={16} readOnly={!editable} aria-label="Texto del acta" className={inputClass + " font-serif text-[15px] leading-relaxed"} />
      <FormError message={estado.error} />
      {editable && <SubmitButton variant="secondary">Guardar el borrador</SubmitButton>}
    </form>
  );
}

export function AprobarActaBoton({ actaId }: { actaId: number }) {
  return (
    <FormularioEnModal
      textoBoton="Aprobar el acta"
      claseBoton={botonPrincipal}
      titulo="Aprobar el acta"
      descripcion="Queda firme (ya no se puede cambiar), toma su número en el Libro de Actas y se genera el PDF para firmar."
      action={aprobarActaFormAction}
      ocultos={{ acta_id: actaId }}
      textoConfirmar="Sí, aprobarla"
    />
  );
}
