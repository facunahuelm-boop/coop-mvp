import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, inputClass } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { UsuarioLink, NucleoLink } from "@/components/EntidadLink";
import dayjs from "dayjs";
import {
  registrarAsistenciaFormAction,
  cancelarReunionFormAction,
  eliminarAgendaItemFormAction,
  alternarConfirmadoInvitadoFormAction,
  alternarPresenteInvitadoFormAction,
  quitarInvitadoFormAction,
} from "@/lib/actions/reuniones";
import { cambiarEstadoTareaFormAction } from "@/lib/actions/tareas";
import { puedeGestionarComision } from "@/lib/comisionAuth";
import { historialReunion } from "@/lib/logic";
import { CerrarReunionForm, AgregarAgendaItemForm, ResultadoAgendaForm, AgregarInvitadoForm } from "@/components/reuniones/ReunionesFormularios";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { HistorialAuditoria } from "@/components/HistorialAuditoria";
import Link from "next/link";
import { vinculosDeAgendaItem, puntosDeAgenda, recorridoDeResolucion, TIPO_REUNION_LABEL, type NodoRecorrido } from "@/lib/trazabilidad";
import { AccionesResolucion, RecorridoResolucion, type ReunionDestino, type DecisionDisponible } from "@/components/reuniones/SeguimientoResolucion";

const TIPO_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};

const MODALIDAD_LABEL: Record<string, string> = { presencial: "Presencial", virtual: "Virtual", hibrida: "Híbrida" };

// Fase 09 del Plan Maestro — el acta puede dejar tareas resultantes cargadas
// directamente (ver cerrarReunionAction), en vez de que haya que copiarlas a
// mano del resumen a Comisiones después. Mismas etiquetas que ya se usan en
// app/(app)/comisiones/page.tsx (Fase 06).
const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "verde" | "amarillo" | "brand"> = { pendiente: "amarillo", en_curso: "brand", completada: "verde" };
const PRIORIDAD_LABEL: Record<string, string> = { alta: "🔴 Alta", media: "🟡 Media", baja: "⚪ Baja" };

// Comisiones como sistema de gestión, Fase 5: filas de las dos tablas nuevas
// de la migración 0029 (reunion_agenda_items, reunion_invitados).
type AgendaItemRow = { id: number; titulo: string; resultado: string | null; responsable_id: number | null; responsable_nombre: string | null; origen_item_id?: number | null };
type InvitadoRow = { id: number; user_id: number; user_nombre: string; confirmado: boolean; presente: boolean };

export default async function ReunionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const [reunion, nucleos, asistencias, usuarios, tareas, agendaItems, invitados] = await Promise.all([
    get<any>(`SELECT r.*, c.nombre as comision_nombre FROM reuniones r LEFT JOIN comisiones c ON c.id = r.comision_id WHERE r.id = ?`, [id]),
    all<any>(`SELECT * FROM nucleos_familiares ORDER BY nombre ASC`),
    all<any>(`SELECT * FROM reunion_asistencias WHERE reunion_id = ?`, [id]),
    all<any>(`SELECT id, nombre FROM users WHERE activo = 1 ORDER BY nombre ASC`),
    all<any>(
      `SELECT t.*, u.nombre as responsable_nombre FROM tareas t LEFT JOIN users u ON u.id = t.responsable_id
       WHERE t.reunion_id = ?
       ORDER BY (t.estado = 'completada'), CASE t.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, t.creado_en DESC`,
      [id]
    ),
    // Comisiones como sistema de gestión, Fase 5: agenda estructurada e
    // invitados por persona (tablas de la migración 0029) — `.catch(() =>
    // [])` porque esta ficha ya existía y funcionaba antes de esa migración.
    all<AgendaItemRow>(
      `SELECT ai.*, u.nombre as responsable_nombre FROM reunion_agenda_items ai LEFT JOIN users u ON u.id = ai.responsable_id
       WHERE ai.reunion_id = ? ORDER BY ai.orden ASC`,
      [id]
    ).catch(() => [] as AgendaItemRow[]),
    all<InvitadoRow>(
      `SELECT ri.*, u.nombre as user_nombre FROM reunion_invitados ri JOIN users u ON u.id = ri.user_id
       WHERE ri.reunion_id = ? ORDER BY u.nombre ASC`,
      [id]
    ).catch(() => [] as InvitadoRow[]),
  ]);
  if (!reunion) notFound();

  // AUDITORÍA INTEGRAL: mismo criterio que verificarPermisoReunion en
  // actions/reuniones.ts — Asamblea/Consejo Directivo quedan reservadas a
  // conducción; una reunión de comisión vinculada (comision_id) exige ser
  // integrante de ESA comisión puntual, no solo tener el permiso de módulo.
  const esOversightReuniones = canEdit(user.rol, "finanzas");
  const puedeGestionar =
    canEdit(user.rol, "comisiones") &&
    (reunion.tipo !== "comision" ? esOversightReuniones : reunion.comision_id ? await puedeGestionarComision(user, reunion.comision_id) : true);

  const actaExistente = reunion.acta_id
    ? await get<any>(
        `SELECT a.*, d.archivo_url FROM actas a LEFT JOIN documentos d ON d.id = a.documento_id WHERE a.id = ?`,
        [reunion.acta_id]
      )
    : null;
  const asistenciaPorNucleo = new Map(asistencias.map((a: any) => [a.nucleo_id, a]));
  const presentes = asistencias.filter((a: any) => a.presente).length;

  // Fase 2, Sub-fase 2.3 ("Historial"): a diferencia de Decisiones, esta
  // ficha NO filtra por pertenencia a la comisión (canRead(rol,"comisiones")
  // ya es prácticamente universal), así que — mismo criterio que Socios y
  // Usuarios — el historial de auditoría cruda se gatea con el mismo
  // permiso que ya protege a /auditoria, sin ampliar ni restringir nada.
  // ---------- Recorrido de decisiones (04/10) ----------
  // Cada punto con resultado es una "resolución": se muestra de dónde viene
  // (si lo trajeron de otra reunión) y todo lo que salió de él, y quien
  // tenga permiso puede darle seguimiento (tarea, compra, llevarlo a otra
  // reunión, vincular una decisión). Todo tolera la migración 0049 ausente.
  const idsAgenda = agendaItems.map((a) => a.id);
  const [vinculos, origenes] = await Promise.all([
    vinculosDeAgendaItem(idsAgenda),
    puntosDeAgenda(agendaItems.map((a) => a.origen_item_id ?? 0)),
  ]);
  const recorridos = new Map<number, NodoRecorrido>();
  for (const a of agendaItems) {
    if (a.origen_item_id || vinculos.get(a.id)?.total) {
      const arbol = await recorridoDeResolucion(a.id);
      if (arbol) recorridos.set(a.id, arbol);
    }
  }
  const puedeSeguimiento = canEdit(user.rol, "comisiones");
  const [comisionesGestionables, reunionesDestino, decisionesDisponibles] = puedeSeguimiento && agendaItems.some((a) => a.resultado)
    ? await Promise.all([
        esOversightReuniones
          ? all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`)
          : all<{ id: number; nombre: string }>(
              `SELECT c.id, c.nombre FROM comisiones c JOIN comision_miembros m ON m.comision_id = c.id
                WHERE c.activa = 1 AND m.user_id = ? AND m.activo = 1 ORDER BY c.nombre ASC`,
              [user.id]
            ),
        all<ReunionDestino & { comision_id: number | null }>(
          `SELECT r.id, r.titulo, r.tipo, r.fecha, r.comision_id, c.nombre AS comision_nombre
             FROM reuniones r LEFT JOIN comisiones c ON c.id = r.comision_id
            WHERE r.estado = 'planificada' AND r.id <> ? ORDER BY r.fecha ASC LIMIT 100`,
          [reunion.id]
        ),
        all<DecisionDisponible & { comision_id: number }>(
          `SELECT d.id, d.tema, d.comision_id, c.nombre AS comision_nombre
             FROM decisiones_comision d LEFT JOIN comisiones c ON c.id = d.comision_id
            WHERE d.agenda_item_id IS NULL ORDER BY d.creado_en DESC LIMIT 200`
        ).catch(() => [] as (DecisionDisponible & { comision_id: number })[]),
      ])
    : [[], [], []];
  const misComisionesIds = new Set(comisionesGestionables.map((c) => c.id));
  // Mismo criterio que el servidor (verificarPermisoReunion /
  // puedeGestionarComision): sólo se ofrece lo que después se va a aceptar.
  const destinosPermitidos = reunionesDestino.filter((r) =>
    r.tipo === "comision" ? esOversightReuniones || (r.comision_id ? misComisionesIds.has(r.comision_id) : true) : esOversightReuniones
  );
  const decisionesPermitidas = decisionesDisponibles.filter((d) => esOversightReuniones || misComisionesIds.has(d.comision_id));
  const comisionesCompra = canEdit(user.rol, "compras")
    ? await all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`)
    : null;

  const puedeVerHistorial = canRead(user.rol, "auditoria");
  const historial = puedeVerHistorial ? await historialReunion(Number(id)) : [];

  return (
    <div>
      <PageHeader
        title={reunion.titulo}
        subtitle={`${TIPO_LABEL[reunion.tipo] ?? reunion.tipo}${reunion.comision_nombre ? ` — ${reunion.comision_nombre}` : ""} · ${dayjs(reunion.fecha).format("DD/MM/YYYY HH:mm")} · ${MODALIDAD_LABEL[reunion.modalidad] ?? "Presencial"}${reunion.lugar ? ` · ${reunion.lugar}` : ""}`}
        action={<Badge color={reunion.estado === "realizada" ? "verde" : reunion.estado === "cancelada" ? "gray" : "brand"}>{reunion.estado}</Badge>}
      />

      {reunion.tipo === "asamblea" && (
        <Card className="mb-5">
          <p className="text-[15px]">
            Para convocar, tomar asistencia, contar el quórum y votar:{" "}
            <Link href={`/asambleas/${reunion.id}`} className="font-semibold underline">abrir la vista de la asamblea</Link>.
          </p>
        </Card>
      )}

      {reunion.orden_del_dia && (
        <Card className="mb-5">
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Orden del día</h3>
          <p className="text-sm text-ink/70 whitespace-pre-line">{reunion.orden_del_dia}</p>
        </Card>
      )}

      {reunion.estado === "planificada" && puedeGestionar && (
        <Card className="mb-5 flex flex-wrap items-center gap-2">
          <ActionForm action={cancelarReunionFormAction}>
            <input type="hidden" name="id" value={reunion.id} />
            <button className="text-xs text-ink/50 hover:text-[var(--color-rojo)] underline underline-offset-2">Cancelar reunión</button>
          </ActionForm>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Asistencia por núcleo ({presentes}/{nucleos.length})</h3>
          <Card>
            <div className="space-y-1.5">
              {nucleos.map((n) => {
                const a = asistenciaPorNucleo.get(n.id);
                return (
                  <ActionForm key={n.id} action={registrarAsistenciaFormAction} className="flex items-center gap-2 py-1 border-b border-ink/5 last:border-0">
                    <input type="hidden" name="reunion_id" value={reunion.id} />
                    <input type="hidden" name="nucleo_id" value={n.id} />
                    <div className="flex items-center gap-2 text-sm flex-1">
                      <input type="checkbox" name="presente" defaultChecked={!!a?.presente} disabled={!puedeGestionar} />
                      <NucleoLink id={n.id} nombre={n.nombre} />
                    </div>
                    {puedeGestionar ? (
                      <>
                        <input name="justificacion" defaultValue={a?.justificacion ?? ""} placeholder="Justificación (opcional)" className={inputClass + " text-xs !py-1 max-w-[160px]"} />
                        <button className="text-xs text-[var(--color-brand-800)] underline whitespace-nowrap">Guardar</button>
                      </>
                    ) : (
                      a?.justificacion && <span className="text-xs text-ink/40">{a.justificacion}</span>
                    )}
                  </ActionForm>
                );
              })}
              {nucleos.length === 0 && <EmptyState>No hay núcleos familiares cargados.</EmptyState>}
            </div>
          </Card>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Acta</h3>
          {actaExistente ? (
            <Card>
              <p className="text-sm text-ink/70 whitespace-pre-line">{actaExistente.resumen}</p>
              {actaExistente.archivo_url ? (
                <a
                  href={`/api/archivos/documento/${actaExistente.documento_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 mt-3"
                >
                  📄 Descargar acta en PDF
                </a>
              ) : (
                // H-6 (auditoría integral, 27/09, corregido): antes decía
                // "Guardada en Documentos → Actas y resoluciones" siempre que
                // no había archivo_url — pero eso pasa exactamente cuando NO
                // hay ningún documento ahí (ver el comentario en
                // cerrarReunionAction, actions/reuniones.ts: si falla la
                // generación del PDF —ej. Storage caído— el cierre de la
                // reunión sigue igual, a propósito, para no perder el acta en
                // texto ni bloquear el resto del cierre; sólo falta el
                // archivo). El mensaje ahora dice la verdad, mismo criterio
                // que ya usan reportes/page.tsx y libros-sociales/page.tsx
                // ("No disponible") en vez de dar a entender que el archivo
                // sí existe en algún lado.
                <p className="text-xs text-ink/40 mt-2">
                  No se pudo generar el archivo PDF de esta acta — el resumen en texto de arriba sí quedó guardado.
                </p>
              )}
            </Card>
          ) : reunion.estado === "cancelada" ? (
            <EmptyState>Reunión cancelada, sin acta.</EmptyState>
          ) : reunion.tipo === "asamblea" ? (
            <Card>
              <p className="text-[15px]">
                El cierre y el acta de la asamblea se hacen en la{" "}
                <Link href={`/asambleas/${reunion.id}`} className="font-semibold underline">vista de la asamblea</Link> (padrón, quórum y votaciones).
              </p>
            </Card>
          ) : puedeGestionar ? (
            <CerrarReunionForm reunionId={reunion.id} usuarios={usuarios} />
          ) : (
            <EmptyState>Todavía no se cerró esta reunión.</EmptyState>
          )}

          {tareas.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Tareas de esta reunión</h3>
              <Card>
                <div className="space-y-1.5">
                  {tareas.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className={`truncate font-medium ${t.estado === "completada" ? "text-ink/40 line-through" : "text-[var(--color-brand-900)]"}`}>
                          {t.titulo}
                        </p>
                        <p className="text-ink/40">
                          {PRIORIDAD_LABEL[t.prioridad] ?? t.prioridad} ·{" "}
                          <UsuarioLink id={t.responsable_id} nombre={t.responsable_nombre} fallback="sin asignar" />
                          {t.fecha_vencimiento ? ` · vence ${dayjs(t.fecha_vencimiento).format("DD/MM")}` : ""}
                        </p>
                      </div>
                      {puedeGestionar ? (
                        <AutoSubmitSelect
                          action={cambiarEstadoTareaFormAction}
                          hiddenFields={{ id: t.id }}
                          name="estado"
                          defaultValue={t.estado}
                          options={Object.entries(ESTADO_TAREA_LABEL).map(([value, label]) => ({ value, label }))}
                          className="rounded-md border border-ink/10 bg-surface px-1.5 py-1 text-xs whitespace-nowrap"
                        />
                      ) : (
                        <Badge color={ESTADO_TAREA_COLOR[t.estado] ?? "gray"}>{ESTADO_TAREA_LABEL[t.estado] ?? t.estado}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Comisiones como sistema de gestión, Fase 5: agenda estructurada,
          adicional al "Orden del día" en texto libre de más arriba. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Agenda y resoluciones</h3>
          <Card>
            <div className="space-y-2">
              {agendaItems.map((a) => (
                <div key={a.id} className="pb-2 border-b border-ink/5 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-brand-900)]">{a.titulo}</p>
                      <p className="text-xs text-ink/40">
                        <UsuarioLink id={a.responsable_id} nombre={a.responsable_nombre} fallback="sin responsable" />
                      </p>
                    </div>
                    {puedeGestionar && reunion.estado === "planificada" && !vinculos.get(a.id)?.total && (
                      <ActionForm action={eliminarAgendaItemFormAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="text-xs text-ink/30 hover:text-[var(--color-rojo)]" title="Quitar punto">✕</button>
                      </ActionForm>
                    )}
                  </div>
                  {a.origen_item_id && origenes.get(a.origen_item_id) && (() => {
                    const o = origenes.get(a.origen_item_id!)!;
                    return (
                      <p className="text-xs mt-1 rounded-md bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] px-2 py-1">
                        Viene de {TIPO_REUNION_LABEL[o.reunion_tipo] ?? o.reunion_tipo}:{" "}
                        <Link href={`/reuniones/${o.reunion_id}`} className="underline underline-offset-2">{o.reunion_titulo}</Link>
                        {" "}({dayjs(o.reunion_fecha).format("DD/MM/YYYY")}){o.resultado ? ` — «${o.resultado}»` : ""}
                      </p>
                    );
                  })()}
                  {puedeGestionar ? (
                    <ResultadoAgendaForm id={a.id} resultadoActual={a.resultado} />
                  ) : (
                    a.resultado && <p className="text-xs text-ink/60 mt-1">→ {a.resultado}</p>
                  )}
                  {(() => {
                    const v = vinculos.get(a.id);
                    if (!v || v.total === 0) return null;
                    return (
                      <ul className="mt-1.5 space-y-0.5 text-xs text-ink/70">
                        {v.seguimientos.map((sg) => (
                          <li key={`s${sg.id}`}>
                            ↪ Llevado a {TIPO_REUNION_LABEL[sg.reunion_tipo] ?? sg.reunion_tipo}:{" "}
                            <Link href={`/reuniones/${sg.reunion_id}`} className="underline underline-offset-2">{sg.reunion_titulo}</Link>
                            {" "}({dayjs(sg.reunion_fecha).format("DD/MM")}){sg.resultado ? ` → ${sg.resultado}` : ""}
                          </li>
                        ))}
                        {v.decisiones.map((d) => (
                          <li key={`d${d.id}`}>
                            ⚖️ Decisión: <Link href={`/decisiones/${d.id}`} className="underline underline-offset-2">{d.tema}</Link>{d.comision_nombre ? ` (${d.comision_nombre})` : ""} · {d.resultado}
                          </li>
                        ))}
                        {v.tareas.map((t) => (
                          <li key={`t${t.id}`}>
                            ✅ Tarea: {t.titulo}{t.comision_nombre ? ` (${t.comision_nombre})` : ""}{t.responsable_nombre ? ` · ${t.responsable_nombre}` : ""} ·{" "}
                            <Badge color={ESTADO_TAREA_COLOR[t.estado] ?? "gray"}>{ESTADO_TAREA_LABEL[t.estado] ?? t.estado}</Badge>
                            {t.resultado ? <span className="block text-ink/50">Resultado: {t.resultado}</span> : null}
                          </li>
                        ))}
                        {v.compras.map((c) => (
                          <li key={`c${c.id}`}>
                            🛒 Compra: <Link href={`/compras/${c.id}`} className="underline underline-offset-2">{c.material}</Link> · {c.estado.replace(/_/g, " ")}
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                  {a.resultado && puedeSeguimiento && (
                    <AccionesResolucion
                      resolucion={{ agendaItemId: a.id, titulo: a.titulo, resultado: a.resultado }}
                      comisionesTarea={comisionesGestionables}
                      usuarios={usuarios}
                      comisionesCompra={comisionesCompra}
                      reunionesDestino={destinosPermitidos}
                      decisiones={decisionesPermitidas}
                    />
                  )}
                  {recorridos.has(a.id) && (
                    <div className="mt-1">
                      <RecorridoResolucion arbol={recorridos.get(a.id)!} actualId={a.id} />
                    </div>
                  )}
                </div>
              ))}
              {agendaItems.length === 0 && <EmptyState>No hay puntos de agenda cargados.</EmptyState>}
              {puedeGestionar && reunion.estado === "planificada" && <AgregarAgendaItemForm reunionId={reunion.id} usuarios={usuarios} />}
            </div>
          </Card>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Asistencia por persona ({invitados.filter((i) => i.presente).length}/{invitados.length})</h3>
          <Card>
            <div className="space-y-1.5">
              {invitados.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 py-1 border-b border-ink/5 last:border-0 text-sm">
                  <div className="min-w-0 flex-1">
                    <UsuarioLink id={i.user_id} nombre={i.user_nombre} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink/60 whitespace-nowrap">
                    {puedeGestionar ? (
                      <>
                        <AutoSubmitCheckbox action={alternarConfirmadoInvitadoFormAction} hiddenFields={{ id: i.id }} defaultChecked={!!i.confirmado} label="Confirmó" />
                        <AutoSubmitCheckbox action={alternarPresenteInvitadoFormAction} hiddenFields={{ id: i.id }} defaultChecked={!!i.presente} label="Presente" />
                        <ActionForm action={quitarInvitadoFormAction}>
                          <input type="hidden" name="id" value={i.id} />
                          <button className="text-ink/30 hover:text-[var(--color-rojo)]" title="Quitar invitado">✕</button>
                        </ActionForm>
                      </>
                    ) : (
                      <>
                        <span>{i.confirmado ? "✔ Confirmó" : "— Sin confirmar"}</span>
                        <span>{i.presente ? "✔ Presente" : "— Ausente"}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {invitados.length === 0 && <EmptyState>No hay invitados cargados.</EmptyState>}
              {puedeGestionar && <AgregarInvitadoForm reunionId={reunion.id} usuarios={usuarios} />}
            </div>
          </Card>
        </div>
      </div>

      {puedeVerHistorial && (
        <div className="mt-5">
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Historial</h3>
          <Card>
            <HistorialAuditoria registros={historial} />
          </Card>
        </div>
      )}
    </div>
  );
}
