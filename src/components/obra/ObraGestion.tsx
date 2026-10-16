"use client";

import { Card, Label, Badge, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import {
  guardarRepresentaFormAction,
  crearPlanFormAction,
  cambiarEstadoPlanFormAction,
  crearTurnoExtendidoFormAction,
  cambiarEstadoTurnoFormAction,
  crearControlCalidadFormAction,
  proponerContratadoFormAction,
  resolverContratacionFormAction,
  crearLicitacionFormAction,
  agregarOfertaFormAction,
  adjudicarLicitacionFormAction,
  declararDesiertaFormAction,
  crearGuardiaFormAction,
  cambiarEstadoGuardiaFormAction,
} from "@/lib/actions/obraGestion";
import type { Integracion, PlanTarea, TurnoExtendido, ControlCalidad, Contratado, Licitacion, Guardia } from "@/lib/obraGestion";

/** Comisión de Obra (y guardias de Trabajo) según el Reglamento de UFAMA. */

const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");
const link = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";
const plata = (n: number) => `$ ${Number(n).toLocaleString("es-UY")}`;
type Opt = { id: number; nombre: string };
type Color = "gray" | "verde" | "amarillo" | "rojo";

function Campo({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <Label required={required}>{label}</Label>
      {children}
    </label>
  );
}
function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[15px] text-ink-muted">{children}</p>;
}
function Cabecera({ titulo, nota, accion }: { titulo: string; nota?: string; accion?: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-[15px] font-bold text-ink">{titulo}</h3>
        {nota && <p className="text-sm text-ink-muted">{nota}</p>}
      </div>
      {accion}
    </div>
  );
}
function CambiarEstado({ titulo, action, ocultos, opciones, actual }: { titulo: string; action: typeof cambiarEstadoPlanFormAction; ocultos: Record<string, string | number>; opciones: [string, string][]; actual: string }) {
  return (
    <FormularioEnModal textoBoton="Cambiar estado" claseBoton={link} titulo={titulo} action={action} ocultos={ocultos}>
      <Campo label="Estado" required>
        <select name="estado" defaultValue={actual} className={inputClass}>
          {opciones.map(([v, t]) => (
            <option key={v} value={v}>{t}</option>
          ))}
        </select>
      </Campo>
    </FormularioEnModal>
  );
}

// ---------- Botones de alta reutilizables (también van arriba a la derecha de la comisión) ----------

export function BotonNuevaTareaPlan({ comisionId, personas, hoy, clase = link, texto = "+ Agregar tarea al plan" }: { comisionId: number; personas: Opt[]; hoy: string; clase?: string; texto?: React.ReactNode }) {
  return (
    <FormularioEnModal textoBoton={texto} claseBoton={clase} titulo="Nueva tarea del plan" action={crearPlanFormAction} ocultos={{ comision_id: comisionId }}>
      <Campo label="Plan" required>
        <select name="tipo" defaultValue="semanal" className={inputClass}>
          <option value="semanal">Semanal</option>
          <option value="mensual">Mensual</option>
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Desde" required><input name="desde" type="date" required defaultValue={hoy} className={inputClass} /></Campo>
        <Campo label="Hasta" required><input name="hasta" type="date" required defaultValue={hoy} className={inputClass} /></Campo>
      </div>
      <Campo label="Tarea" required><input name="tarea" required maxLength={300} className={inputClass} /></Campo>
      <Campo label="Responsable">
        <select name="responsable_id" defaultValue="" className={inputClass}>
          <option value="">Sin asignar</option>
          {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </Campo>
    </FormularioEnModal>
  );
}

export function BotonAsignarGuardia({ comisionId, nucleos, hoy, horario, clase = link, texto = "+ Asignar guardia" }: { comisionId: number; nucleos: Opt[]; hoy: string; horario: { guardia: string; serenata: string }; clase?: string; texto?: React.ReactNode }) {
  return (
    <FormularioEnModal textoBoton={texto} claseBoton={clase} titulo="Asignar guardia o serenata" action={crearGuardiaFormAction} ocultos={{ comision_id: comisionId }}>
      <Campo label="Tipo" required>
        <select name="tipo" defaultValue="guardia" className={inputClass}>
          <option value="guardia">Guardia ({horario.guardia})</option>
          <option value="serenata">Serenata ({horario.serenata})</option>
        </select>
      </Campo>
      <Campo label="Fecha" required><input name="fecha" type="date" required defaultValue={hoy} className={inputClass} /></Campo>
      <Campo label="Núcleo" required>
        <select name="nucleo_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>Elegí un núcleo</option>
          {nucleos.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
        </select>
      </Campo>
      <Campo label="Observaciones"><input name="observaciones" maxLength={300} className={inputClass} /></Campo>
    </FormularioEnModal>
  );
}

// ---------- Integración ----------

export function IntegracionPanel({ comisionId, integracion, puede, representaciones }: { comisionId: number; integracion: Integracion; puede: boolean; representaciones: Record<string, string> }) {
  return (
    <Card>
      <Cabecera titulo="Integración de la Comisión de Obra" nota="Art. 10a: Compras, Administración, Tesorería, Dirección de Obra (IAT), Capataz y al menos 3 socios/as votados/as." />
      {integracion.completa ? (
        <p className="mb-3 rounded-xl bg-[var(--color-verde-bg)] px-3 py-2 text-[15px]">La comisión está integrada como pide el reglamento.</p>
      ) : (
        <div className="mb-3 rounded-xl bg-[var(--color-amarillo-bg)] px-3 py-2 text-[15px]" data-testid="integracion-faltan">
          <p className="font-semibold">Falta cubrir:</p>
          <ul className="list-disc pl-5">
            {integracion.faltan.map((f) => (
              <li key={f.clave}>
                {f.etiqueta}
                {f.falta > 1 ? ` (faltan ${f.falta})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="divide-y divide-border">
        {integracion.integrantes.map((i) => (
          <li key={i.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
            <span>
              <span className="font-semibold">{i.nombre}</span>{" "}
              {i.representa ? <Badge color="verde">{representaciones[i.representa] ?? i.representa}</Badge> : <Badge color="gray">Sin representación asignada</Badge>}
            </span>
            {puede && (
              <FormularioEnModal textoBoton="Asignar" claseBoton={link} titulo={`¿A quién representa ${i.nombre}?`} action={guardarRepresentaFormAction} ocultos={{ comision_id: comisionId, user_id: i.user_id }}>
                <Campo label="Representa">
                  <select name="representa" defaultValue={i.representa ?? ""} className={inputClass}>
                    <option value="">Ninguna</option>
                    {Object.entries(representaciones).map(([k, t]) => (
                      <option key={k} value={k}>{t}</option>
                    ))}
                  </select>
                </Campo>
              </FormularioEnModal>
            )}
          </li>
        ))}
        {integracion.integrantes.length === 0 && <Vacio>Todavía no hay integrantes. Se agregan desde la pestaña Integrantes.</Vacio>}
      </ul>
    </Card>
  );
}

// ---------- Plan de trabajo ----------

const ESTADO_PLAN: Record<string, [string, Color]> = { pendiente: ["Pendiente", "gray"], en_curso: ["En curso", "amarillo"], hecha: ["Hecha", "verde"] };

export function PlanTrabajoPanel({ comisionId, planes, personas, puede, hoy }: { comisionId: number; planes: PlanTarea[]; personas: Opt[]; puede: boolean; hoy: string }) {
  const bloque = (tipo: "mensual" | "semanal") => planes.filter((p) => p.tipo === tipo);
  return (
    <Card>
      <Cabecera
        titulo="Plan de trabajo mensual y semanal"
        nota="Art. 11b: la comisión planifica el trabajo del mes y de la semana."
        accion={
          puede && <BotonNuevaTareaPlan comisionId={comisionId} personas={personas} hoy={hoy} />
        }
      />
      {(["mensual", "semanal"] as const).map((tipo) => (
        <div key={tipo} className="mb-3">
          <p className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Plan {tipo}</p>
          <ul className="divide-y divide-border">
            {bloque(tipo).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                <span>
                  <Badge color={ESTADO_PLAN[p.estado]?.[1] ?? "gray"}>{ESTADO_PLAN[p.estado]?.[0] ?? p.estado}</Badge> {p.tarea}
                  <span className="block text-sm text-ink-muted">{dmy(p.desde)} al {dmy(p.hasta)}{p.responsable ? ` · ${p.responsable}` : ""}</span>
                </span>
                {puede && (
                  <CambiarEstado titulo="Tarea del plan" action={cambiarEstadoPlanFormAction} ocultos={{ id: p.id, comision_id: comisionId }} actual={p.estado}
                    opciones={[["pendiente", "Pendiente"], ["en_curso", "En curso"], ["hecha", "Hecha"], ["anulada", "Quitar del plan"]]} />
                )}
              </li>
            ))}
            {bloque(tipo).length === 0 && <li><Vacio>Sin tareas en el plan {tipo}.</Vacio></li>}
          </ul>
        </div>
      ))}
    </Card>
  );
}

// ---------- Horario extendido ----------

const ESTADO_TURNO: Record<string, [string, Color]> = { planificado: ["Planificado", "gray"], realizado: ["Realizado", "verde"], cancelado: ["Cancelado", "rojo"] };

export function TurnosExtendidosPanel({ comisionId, turnos, personas, puede, hoy }: { comisionId: number; turnos: TurnoExtendido[]; personas: Opt[]; puede: boolean; hoy: string }) {
  return (
    <Card>
      <Cabecera
        titulo="Horario extendido y sábados"
        nota="Art. 18: lunes a viernes de 17:00 a 22:00 y sábados de 07:00 a 12:00, con tarea planificada y un/a encargado/a de turno."
        accion={
          puede && (
            <FormularioEnModal textoBoton="+ Planificar turno" claseBoton={link} titulo="Nuevo turno" action={crearTurnoExtendidoFormAction} ocultos={{ comision_id: comisionId }}>
              <Campo label="Tipo" required>
                <select name="tipo" defaultValue="extendido" className={inputClass}>
                  <option value="extendido">Extendido (lun a vie, 17:00 a 22:00)</option>
                  <option value="sabado">Sábado (07:00 a 12:00)</option>
                </select>
              </Campo>
              <Campo label="Fecha" required><input name="fecha" type="date" required defaultValue={hoy} className={inputClass} /></Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Desde" required><input name="hora_inicio" type="time" required defaultValue="17:00" className={inputClass} /></Campo>
                <Campo label="Hasta" required><input name="hora_fin" type="time" required defaultValue="22:00" className={inputClass} /></Campo>
              </div>
              <Campo label="Tarea planificada" required><input name="tarea" required maxLength={300} className={inputClass} /></Campo>
              <Campo label="Encargado/a de turno" required>
                <select name="encargado_id" required defaultValue="" className={inputClass}>
                  <option value="" disabled>Elegí una persona</option>
                  {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Supervisión"><input name="supervision" maxLength={500} className={inputClass} placeholder="Quién supervisa el trabajo" /></Campo>
            </FormularioEnModal>
          )
        }
      />
      <ul className="divide-y divide-border">
        {turnos.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
            <span>
              <Badge color={ESTADO_TURNO[t.estado]?.[1] ?? "gray"}>{ESTADO_TURNO[t.estado]?.[0] ?? t.estado}</Badge> {dmy(t.fecha)} · {t.hora_inicio}–{t.hora_fin} · {t.tarea}
              <span className="block text-sm text-ink-muted">{t.tipo === "sabado" ? "Sábado" : "Extendido"} · encargado/a: {t.encargado}{t.supervision ? ` · supervisa: ${t.supervision}` : ""}</span>
            </span>
            {puede && (
              <CambiarEstado titulo="Turno" action={cambiarEstadoTurnoFormAction} ocultos={{ id: t.id, comision_id: comisionId }} actual={t.estado}
                opciones={[["planificado", "Planificado"], ["realizado", "Realizado"], ["cancelado", "Cancelado"]]} />
            )}
          </li>
        ))}
        {turnos.length === 0 && <li><Vacio>No hay turnos planificados.</Vacio></li>}
      </ul>
    </Card>
  );
}

// ---------- Calidad ----------

const RESULTADO: Record<string, [string, Color]> = { conforme: ["Conforme", "verde"], observado: ["Observado", "amarillo"], rechazado: ["Rechazado", "rojo"] };

export function CalidadPanel({ comisionId, controles, rubros, puede, hoy }: { comisionId: number; controles: ControlCalidad[]; rubros: Opt[]; puede: boolean; hoy: string }) {
  return (
    <Card>
      <Cabecera
        titulo="Control de calidad y uso de materiales"
        nota="Art. 11d: evaluación de las actividades realizadas y de los materiales usados."
        accion={
          puede && (
            <FormularioEnModal textoBoton="+ Registrar control" claseBoton={link} titulo="Nuevo control de calidad" action={crearControlCalidadFormAction} ocultos={{ comision_id: comisionId }}>
              <Campo label="Fecha" required><input name="fecha" type="date" required max={hoy} defaultValue={hoy} className={inputClass} /></Campo>
              <Campo label="Actividad evaluada" required><input name="actividad" required maxLength={300} className={inputClass} /></Campo>
              <Campo label="Rubro">
                <select name="rubro_id" defaultValue="" className={inputClass}>
                  <option value="">Sin rubro</option>
                  {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Resultado" required>
                <select name="resultado" defaultValue="conforme" className={inputClass}>
                  <option value="conforme">Conforme</option>
                  <option value="observado">Observado</option>
                  <option value="rechazado">Rechazado</option>
                </select>
              </Campo>
              <Campo label="Uso de materiales">
                <select name="materiales_ok" defaultValue="1" className={inputClass}>
                  <option value="1">Correcto</option>
                  <option value="0">Con desperdicio o uso indebido</option>
                </select>
              </Campo>
              <Campo label="Observaciones (obligatorias si no es conforme)"><textarea name="observaciones" rows={3} maxLength={1000} className={inputClass} /></Campo>
            </FormularioEnModal>
          )
        }
      />
      <ul className="divide-y divide-border">
        {controles.map((c) => (
          <li key={c.id} className="py-2 text-[15px]">
            <Badge color={RESULTADO[c.resultado]?.[1] ?? "gray"}>{RESULTADO[c.resultado]?.[0] ?? c.resultado}</Badge> {dmy(c.fecha)} · {c.actividad}
            <span className="block text-sm text-ink-muted">
              {c.rubro ? `${c.rubro} · ` : ""}materiales: {c.materiales_ok ? "correcto" : "con desperdicio o uso indebido"}{c.evaluador ? ` · evaluó ${c.evaluador}` : ""}
            </span>
            {c.observaciones && <span className="block text-sm text-ink">{c.observaciones}</span>}
          </li>
        ))}
        {controles.length === 0 && <li><Vacio>Todavía no se registraron controles.</Vacio></li>}
      </ul>
    </Card>
  );
}

// ---------- Contratación ----------

const ESTADO_CONTRATO: Record<string, [string, Color]> = { propuesto: ["Propuesto", "amarillo"], aprobado: ["Aprobado", "verde"], rechazado: ["Rechazado", "rojo"], finalizado: ["Finalizado", "gray"] };

export function ContratacionPanel({ comisionId, contratados, licitaciones, proveedores, puede, puedeAprobar }: { comisionId: number; contratados: Contratado[]; licitaciones: Licitacion[]; proveedores: Opt[]; puede: boolean; puedeAprobar: boolean }) {
  return (
    <div className="space-y-4">
      <Card>
        <Cabecera
          titulo="Personal contratado"
          nota="Art. 5c: no pueden ser socios/as ni integrantes de núcleos. Lo aprueba el Consejo Directivo."
          accion={
            puede && (
              <FormularioEnModal textoBoton="+ Proponer contratación" claseBoton={link} titulo="Proponer personal contratado" action={proponerContratadoFormAction} ocultos={{ comision_id: comisionId }}>
                <Campo label="Nombre completo" required><input name="nombre" required maxLength={200} className={inputClass} /></Campo>
                <Campo label="Documento"><input name="documento" maxLength={40} className={inputClass} /></Campo>
                <Campo label="Oficio o tarea" required><input name="oficio" required maxLength={120} className={inputClass} /></Campo>
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Desde"><input name="desde" type="date" className={inputClass} /></Campo>
                  <Campo label="Hasta"><input name="hasta" type="date" className={inputClass} /></Campo>
                </div>
                <Campo label="Observaciones"><textarea name="observaciones" rows={2} maxLength={500} className={inputClass} /></Campo>
              </FormularioEnModal>
            )
          }
        />
        <ul className="divide-y divide-border">
          {contratados.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
              <span>
                <Badge color={ESTADO_CONTRATO[c.estado]?.[1] ?? "gray"}>{ESTADO_CONTRATO[c.estado]?.[0] ?? c.estado}</Badge> <span className="font-semibold">{c.nombre}</span> · {c.oficio}
                <span className="block text-sm text-ink-muted">{c.documento ? `Doc. ${c.documento} · ` : ""}{c.desde ? `desde ${dmy(c.desde)}` : ""}{c.hasta ? ` hasta ${dmy(c.hasta)}` : ""}{c.observaciones ? ` · ${c.observaciones}` : ""}</span>
              </span>
              {puedeAprobar && (c.estado === "propuesto" || c.estado === "aprobado") && (
                <CambiarEstado titulo={c.nombre} action={resolverContratacionFormAction} ocultos={{ id: c.id, comision_id: comisionId }} actual={c.estado === "propuesto" ? "aprobado" : "finalizado"}
                  opciones={c.estado === "propuesto" ? [["aprobado", "Aprobar"], ["rechazado", "Rechazar"]] : [["finalizado", "Finalizar contrato"]]} />
              )}
            </li>
          ))}
          {contratados.length === 0 && <li><Vacio>No hay personal contratado cargado.</Vacio></li>}
        </ul>
      </Card>

      <Card>
        <Cabecera
          titulo="Pedidos de precios (licitaciones)"
          nota="Art. 5b y 11c: como mínimo tres ofertas por compra o contratación."
          accion={
            puede && (
              <FormularioEnModal textoBoton="+ Nuevo pedido de precios" claseBoton={link} titulo="Nuevo pedido de precios" action={crearLicitacionFormAction} ocultos={{ comision_id: comisionId }}>
                <Campo label="Qué se necesita" required><input name="titulo" required maxLength={200} className={inputClass} /></Campo>
                <Campo label="Detalle"><textarea name="descripcion" rows={3} maxLength={1000} className={inputClass} /></Campo>
              </FormularioEnModal>
            )
          }
        />
        <div className="space-y-3">
          {licitaciones.map((l) => {
            const color: Color = l.estado === "abierta" ? "amarillo" : l.estado === "adjudicada" ? "verde" : "gray";
            return (
              <div key={l.id} className="rounded-xl border border-border p-3">
                <p className="font-semibold text-ink">
                  {l.titulo} <Badge color={color}>{l.estado === "abierta" ? "Abierta" : l.estado === "adjudicada" ? "Adjudicada" : "Desierta"}</Badge>
                </p>
                {l.descripcion && <p className="text-sm text-ink-muted">{l.descripcion}</p>}
                <p className="mt-1 text-sm text-ink-muted">{l.ofertas.length} de 3 ofertas mínimas{l.ofertas.length >= 3 ? " ✓" : ""}</p>
                <ul className="divide-y divide-border">
                  {l.ofertas.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[15px]">
                      <span>
                        {o.proveedor_nombre} · <span className="font-semibold">{plata(o.monto)}</span>{o.plazo ? ` · ${o.plazo}` : ""}
                        {l.oferta_elegida_id === o.id && <> <Badge color="verde">Elegida</Badge></>}
                        {o.observaciones && <span className="block text-sm text-ink-muted">{o.observaciones}</span>}
                      </span>
                      {puede && l.estado === "abierta" && (
                        <FormularioEnModal textoBoton="Adjudicar" claseBoton={link} titulo={`Adjudicar a ${o.proveedor_nombre}`} action={adjudicarLicitacionFormAction} ocultos={{ comision_id: comisionId, licitacion_id: l.id, oferta_id: o.id }} textoConfirmar="Adjudicar">
                          <Campo label={l.ofertas.length < 3 ? "Justificación (obligatoria: hay menos de tres ofertas)" : "Justificación"}>
                            <textarea name="justificacion" rows={3} maxLength={500} className={inputClass} />
                          </Campo>
                        </FormularioEnModal>
                      )}
                    </li>
                  ))}
                </ul>
                {l.justificacion && <p className="text-sm text-ink">Justificación: {l.justificacion}</p>}
                {puede && l.estado === "abierta" && (
                  <div className="mt-2 flex flex-wrap gap-4">
                    <FormularioEnModal textoBoton="+ Cargar oferta" claseBoton={link} titulo={`Oferta para «${l.titulo}»`} action={agregarOfertaFormAction} ocultos={{ comision_id: comisionId, licitacion_id: l.id }}>
                      <Campo label="Proveedor registrado">
                        <select name="proveedor_id" defaultValue="" className={inputClass}>
                          <option value="">Otro (escribir el nombre)</option>
                          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </Campo>
                      <Campo label="Nombre del proveedor"><input name="proveedor_nombre" maxLength={200} className={inputClass} /></Campo>
                      <Campo label="Monto" required><input name="monto" type="number" min={0} step="0.01" required className={inputClass} /></Campo>
                      <Campo label="Plazo de entrega"><input name="plazo" maxLength={120} className={inputClass} /></Campo>
                      <Campo label="Observaciones"><input name="observaciones" maxLength={500} className={inputClass} /></Campo>
                    </FormularioEnModal>
                    <FormularioEnModal textoBoton="Declarar desierta" claseBoton={link} titulo="Declarar desierto" action={declararDesiertaFormAction} ocultos={{ comision_id: comisionId, licitacion_id: l.id }} textoConfirmar="Declarar desierta">
                      <Campo label="Motivo" required><textarea name="justificacion" required rows={3} maxLength={500} className={inputClass} /></Campo>
                    </FormularioEnModal>
                  </div>
                )}
              </div>
            );
          })}
          {licitaciones.length === 0 && <Vacio>No hay pedidos de precios.</Vacio>}
        </div>
      </Card>
    </div>
  );
}

// ---------- Guardias (Trabajo) ----------

const ESTADO_GUARDIA: Record<string, [string, Color]> = { asignada: ["Asignada", "gray"], cumplida: ["Cumplida", "verde"], falta_justificada: ["Falta justificada", "amarillo"], falta_injustificada: ["Falta injustificada", "rojo"] };

export function GuardiasPanel({ comisionId, guardias, nucleos, puede, hoy, horario }: { comisionId: number; guardias: Guardia[]; nucleos: Opt[]; puede: boolean; hoy: string; horario: { guardia: string; serenata: string } }) {
  return (
    <Card>
      <Cabecera
        titulo="Guardias y serenatas"
        nota={`Art. 8o, 18h y 34: guardia ${horario.guardia}, serenata ${horario.serenata}. Cada núcleo cumple las que le tocan; no suman horas de ayuda mutua.`}
        accion={
          puede && <BotonAsignarGuardia comisionId={comisionId} nucleos={nucleos} hoy={hoy} horario={horario} />
        }
      />
      <ul className="divide-y divide-border">
        {guardias.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
            <span>
              <Badge color={ESTADO_GUARDIA[g.estado]?.[1] ?? "gray"}>{ESTADO_GUARDIA[g.estado]?.[0] ?? g.estado}</Badge> {dmy(g.fecha)} · {g.tipo === "guardia" ? "Guardia" : "Serenata"} · {g.nucleo}
              {g.observaciones && <span className="block text-sm text-ink-muted">{g.observaciones}</span>}
            </span>
            {puede && (
              <CambiarEstado titulo={`${g.tipo === "guardia" ? "Guardia" : "Serenata"} del ${dmy(g.fecha)}`} action={cambiarEstadoGuardiaFormAction} ocultos={{ id: g.id, comision_id: comisionId }} actual={g.estado}
                opciones={[["asignada", "Asignada"], ["cumplida", "Cumplida"], ["falta_justificada", "Falta justificada"], ["falta_injustificada", "Falta injustificada"]]} />
            )}
          </li>
        ))}
        {guardias.length === 0 && <li><Vacio>No hay guardias asignadas.</Vacio></li>}
      </ul>
    </Card>
  );
}
