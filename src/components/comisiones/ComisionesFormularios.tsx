"use client";

// Fase 4 del rediseño (validaciones globales + feedback visual): los 3
// formularios de /comisiones (agregar integrante a una comisión, agregar
// tarea a una comisión, crear una comisión nueva) migrados a
// `useActionState` — mismo criterio que SociosFormularios.tsx /
// ProveedoresFormularios.tsx. "Agregar integrante" no vive dentro de un
// <details> en el diseño original (queda siempre visible junto a la lista de
// integrantes), así que ese formulario solo se resetea al guardar con éxito,
// sin colapsar nada.

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  FUNCIONES_COMISION,
  FUNCION_COMISION,
  ETAPAS_COOPERATIVA,
  ETAPA_LABEL,
  etapasPropias,
  funcionDe,
  type FuncionComision,
} from "@/lib/comisionesFunciones";
import {
  agregarMiembroFormAction,
  crearComisionFormAction,
  editarComisionFormAction,
} from "@/lib/actions/comisiones";
import { crearTareaFormAction } from "@/lib/actions/tareas";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { AddButton, Label, inputClass } from "@/components/ui";

// Mismo aspecto que el botón «agregar» del sistema; siempre abre un pop-up.
const CLASE_AGREGAR =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-[var(--color-verde)] text-[var(--color-verde)] bg-transparent hover:bg-[var(--color-verde-bg)] px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap";

type Usuario = { id: number; nombre: string };
type Comision = { id: number; nombre: string };

export function AgregarMiembroForm({ comisionId, usuarios }: { comisionId: number; usuarios: Usuario[] }) {
  return (
    <FormularioEnModal
      textoBoton={<><Plus size={16} aria-hidden /> Agregar integrante</>}
      claseBoton={CLASE_AGREGAR}
      titulo="Agregar integrante"
      action={agregarMiembroFormAction}
      ocultos={{ comision_id: comisionId }}
      textoConfirmar="Agregar"
      mensajeExito="Integrante agregado."
    >
      <div className="space-y-3">
        <div>
          <Label required>Persona</Label>
          <select name="user_id" required className={inputClass}>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Rol en la comisión</Label>
          <select name="rol_en_comision" className={inputClass} defaultValue="integrante">
            <option value="integrante">Integrante</option>
            <option value="coordinador">Coordinador/a</option>
            <option value="suplente">Suplente</option>
          </select>
        </div>
      </div>
    </FormularioEnModal>
  );
}

export function CrearTareaForm({ comisionId, usuarios }: { comisionId: number; usuarios: Usuario[] }) {
  return (
    <FormularioEnModal
      textoBoton={<><Plus size={16} aria-hidden /> Agregar tarea</>}
      claseBoton={CLASE_AGREGAR}
      titulo="Agregar tarea"
      action={crearTareaFormAction}
      ocultos={{ comision_id: comisionId }}
      textoConfirmar="Agregar tarea"
      mensajeExito="Tarea agregada."
    >
      <div className="space-y-3">
        <div>
          <Label required>Título</Label>
          <input name="titulo" required placeholder="Título de la tarea" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Responsable</Label>
            <select name="responsable_id" className={inputClass} defaultValue="">
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Prioridad</Label>
            <select name="prioridad" className={inputClass} defaultValue="media">
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
        </div>
        <div>
          <Label>Vence el</Label>
          <input name="fecha_vencimiento" type="date" className={inputClass} />
        </div>
        {/* La dependencia con otra tarea se elige después, desde el detalle de la tarea. */}
        <div>
          <Label>Etiquetas (opcional)</Label>
          <input name="etiquetas" placeholder="separadas por coma" className={inputClass} />
        </div>
      </div>
    </FormularioEnModal>
  );
}

// Campos compartidos por Crear/Editar: tipo (permanente/temporal),
// objetivo, vigencia y subcomisión — mismo criterio en ambos formularios
// para no tener dos lenguajes distintos de "qué es una comisión".
function CamposComision({
  estado,
  comisiones,
  excluirId,
  tipoInicial,
  objetivoInicial,
  fechaInicioInicial,
  fechaFinInicial,
  padreInicial,
  funcionInicial,
  etapasInicial,
}: {
  estado: { fieldErrors?: Record<string, string> };
  comisiones?: Comision[];
  excluirId?: number;
  tipoInicial?: string;
  objetivoInicial?: string;
  fechaInicioInicial?: string;
  fechaFinInicial?: string;
  padreInicial?: number | null;
  funcionInicial?: string | null;
  etapasInicial?: string | null;
}) {
  const [funcion, setFuncion] = useState<FuncionComision>(funcionDe(funcionInicial));
  const propiasIniciales = etapasPropias(etapasInicial);
  const [modoEtapas, setModoEtapas] = useState<"funcion" | "propias">(propiasIniciales ? "propias" : "funcion");
  const etapasFuncion = FUNCION_COMISION[funcion].etapasDefault;
  return (
    <>
      {/* Comisiones como áreas de trabajo (05/10): la función define las
          herramientas propias de la comisión y en qué etapas aparece. */}
      <div>
        <Label>Función</Label>
        <select name="funcion" className={inputClass} value={funcion} onChange={(e) => setFuncion(e.target.value as FuncionComision)}>
          {FUNCIONES_COMISION.map((f) => (
            <option key={f} value={f}>{FUNCION_COMISION[f].label}</option>
          ))}
        </select>
        <p className="text-[11px] text-ink-faint mt-1">
          {FUNCION_COMISION[funcion].herramientas.length
            ? `Suma: ${FUNCION_COMISION[funcion].herramientas.map((h) => h.label).join(", ")}.`
            : "Comisión de uso general (integrantes, tareas, reuniones y documentos)."}
        </p>
      </div>
      <div>
        <Label>Disponible en</Label>
        <select name="etapas_modo" className={inputClass} value={modoEtapas} onChange={(e) => setModoEtapas(e.target.value as "funcion" | "propias")}>
          <option value="funcion">
            Según la función ({etapasFuncion ? etapasFuncion.map((e) => ETAPA_LABEL[e]).join(", ") : "todas las etapas"})
          </option>
          <option value="propias">Elegir etapas…</option>
        </select>
        {modoEtapas === "propias" && (
          <div className="flex flex-wrap gap-3 mt-2">
            {ETAPAS_COOPERATIVA.map((e) => (
              <label key={e} className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                <input type="checkbox" name="etapas" value={e} defaultChecked={(propiasIniciales ?? etapasFuncion ?? []).includes(e)} className="h-4 w-4" />
                {ETAPA_LABEL[e]}
              </label>
            ))}
          </div>
        )}
        <p className="text-[11px] text-ink-faint mt-1">Fuera de esas etapas la comisión no se muestra como activa (no se borra nada).</p>
      </div>
      <div>
        <Label>Tipo</Label>
        <select name="tipo" className={inputClass} defaultValue={tipoInicial ?? "permanente"}>
          <option value="permanente">Permanente</option>
          <option value="temporal">Temporal</option>
        </select>
        <FieldError message={estado.fieldErrors?.tipo} />
      </div>
      {comisiones && comisiones.length > 0 && (
        <div>
          <Label>Subcomisión de (opcional)</Label>
          <select name="comision_padre_id" className={inputClass} defaultValue={padreInicial ?? ""}>
            <option value="">Ninguna — comisión de primer nivel</option>
            {comisiones.filter((c) => c.id !== excluirId).map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.comision_padre_id} />
        </div>
      )}
      <div className="sm:col-span-2">
        <Label>Objetivo (opcional)</Label>
        <input name="objetivo" defaultValue={objetivoInicial} placeholder="Para qué existe esta comisión" className={inputClass} />
        <FieldError message={estado.fieldErrors?.objetivo} />
      </div>
      <div>
        <Label>Inicio (opcional)</Label>
        <input name="fecha_inicio" type="date" defaultValue={fechaInicioInicial} className={inputClass} />
        <FieldError message={estado.fieldErrors?.fecha_inicio} />
      </div>
      <div>
        <Label>Finalización (obligatoria si es temporal)</Label>
        <input name="fecha_fin" type="date" defaultValue={fechaFinInicial} className={inputClass} />
        <FieldError message={estado.fieldErrors?.fecha_fin} />
      </div>
    </>
  );
}

export function CrearComisionForm({ comisiones }: { comisiones?: Comision[] }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, formAction] = useActionState(crearComisionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAbierto(false);
      show("Comisión creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setAbierto(true)}>Crear comisión</AddButton>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Crear comisión" size="lg">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div>
            <Label required>Nombre</Label>
            <input name="nombre" required data-validar="nombre" placeholder="Ej: Comisión de Educación" className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <CamposComision estado={estado} comisiones={comisiones} />
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAbierto(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken">Volver</button>
            <SubmitButton variant="add" pendingLabel="Creando…">Crear comisión</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function EditarComisionForm({
  comision,
  comisiones,
}: {
  comision: {
    id: number; nombre: string; descripcion?: string | null; tipo?: string | null;
    objetivo?: string | null; fecha_inicio?: string | null; fecha_fin?: string | null;
    comision_padre_id?: number | null; actualizado_en: string;
    funcion?: string | null; etapas?: string | null;
  };
  comisiones: Comision[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, formAction] = useActionState(editarComisionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAbierto(false);
      show("Comisión actualizada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className="text-xs text-ink/40 hover:text-[var(--color-brand-800)] underline underline-offset-2">Editar comisión</button>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Editar comisión" size="lg">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <input type="hidden" name="id" value={comision.id} />
          {/* H-3 (auditoría integral, 27/09): versión cargada al abrir este
             formulario — ver updateConBloqueoOptimista() en db.ts. */}
          <input type="hidden" name="version_esperada" value={comision.actualizado_en} />
          <div>
            <Label required>Nombre</Label>
            <input name="nombre" required data-validar="nombre" defaultValue={comision.nombre} className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" defaultValue={comision.descripcion ?? ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <CamposComision
            estado={estado}
            comisiones={comisiones}
            excluirId={comision.id}
            tipoInicial={comision.tipo ?? "permanente"}
            objetivoInicial={comision.objetivo ?? ""}
            fechaInicioInicial={comision.fecha_inicio ?? ""}
            fechaFinInicial={comision.fecha_fin ?? ""}
            padreInicial={comision.comision_padre_id ?? null}
            funcionInicial={comision.funcion ?? null}
            etapasInicial={comision.etapas ?? null}
          />
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAbierto(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken">Volver</button>
            <SubmitButton variant="secondary" pendingLabel="Guardando…">Guardar cambios</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
