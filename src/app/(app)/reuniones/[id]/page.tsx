import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import dayjs from "dayjs";
import {
  registrarAsistenciaAction,
  cerrarReunionAction,
  cancelarReunionAction,
} from "@/lib/actions/reuniones";
import { cambiarEstadoTareaAction } from "@/lib/actions/tareas";

const TIPO_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};

// Fase 09 del Plan Maestro — el acta puede dejar tareas resultantes cargadas
// directamente (ver cerrarReunionAction), en vez de que haya que copiarlas a
// mano del resumen a Comisiones después. Mismas etiquetas que ya se usan en
// app/(app)/comisiones/page.tsx (Fase 06).
const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "verde" | "amarillo" | "brand"> = { pendiente: "amarillo", en_curso: "brand", completada: "verde" };
const PRIORIDAD_LABEL: Record<string, string> = { alta: "🔴 Alta", media: "🟡 Media", baja: "⚪ Baja" };

export default async function ReunionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");

  const [reunion, nucleos, asistencias, usuarios, tareas] = await Promise.all([
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
  ]);
  if (!reunion) notFound();

  const actaExistente = reunion.acta_id
    ? await get<any>(
        `SELECT a.*, d.archivo_url FROM actas a LEFT JOIN documentos d ON d.id = a.documento_id WHERE a.id = ?`,
        [reunion.acta_id]
      )
    : null;
  const asistenciaPorNucleo = new Map(asistencias.map((a: any) => [a.nucleo_id, a]));
  const presentes = asistencias.filter((a: any) => a.presente).length;

  return (
    <div>
      <PageHeader
        title={reunion.titulo}
        subtitle={`${TIPO_LABEL[reunion.tipo] ?? reunion.tipo}${reunion.comision_nombre ? ` — ${reunion.comision_nombre}` : ""} · ${dayjs(reunion.fecha).format("DD/MM/YYYY HH:mm")}${reunion.lugar ? ` · ${reunion.lugar}` : ""}`}
        action={<Badge color={reunion.estado === "realizada" ? "verde" : reunion.estado === "cancelada" ? "gray" : "brand"}>{reunion.estado}</Badge>}
      />

      {reunion.orden_del_dia && (
        <Card className="mb-5">
          <h3 className="text-sm font-bold text-[#123240] mb-2">Orden del día</h3>
          <p className="text-sm text-black/70 whitespace-pre-line">{reunion.orden_del_dia}</p>
        </Card>
      )}

      {reunion.estado === "planificada" && puedeEditar && (
        <Card className="mb-5 flex flex-wrap items-center gap-2">
          <form action={cancelarReunionAction}>
            <input type="hidden" name="id" value={reunion.id} />
            <button className="text-xs text-black/50 hover:text-[var(--color-rojo)] underline underline-offset-2">Cancelar reunión</button>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h3 className="text-sm font-bold text-[#123240] mb-2">Asistencia por núcleo ({presentes}/{nucleos.length})</h3>
          <Card>
            <div className="space-y-1.5">
              {nucleos.map((n) => {
                const a = asistenciaPorNucleo.get(n.id);
                return (
                  <form key={n.id} action={registrarAsistenciaAction} className="flex items-center gap-2 py-1 border-b border-black/5 last:border-0">
                    <input type="hidden" name="reunion_id" value={reunion.id} />
                    <input type="hidden" name="nucleo_id" value={n.id} />
                    <label className="flex items-center gap-2 text-sm flex-1">
                      <input type="checkbox" name="presente" defaultChecked={!!a?.presente} disabled={!puedeEditar} />
                      {n.nombre}
                    </label>
                    {puedeEditar ? (
                      <>
                        <input name="justificacion" defaultValue={a?.justificacion ?? ""} placeholder="Justificación (opcional)" className={inputClass + " text-xs !py-1 max-w-[160px]"} />
                        <button className="text-xs text-[#1f4e5f] underline whitespace-nowrap">Guardar</button>
                      </>
                    ) : (
                      a?.justificacion && <span className="text-xs text-black/40">{a.justificacion}</span>
                    )}
                  </form>
                );
              })}
              {nucleos.length === 0 && <EmptyState>No hay núcleos familiares cargados.</EmptyState>}
            </div>
          </Card>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[#123240] mb-2">Acta</h3>
          {actaExistente ? (
            <Card>
              <p className="text-sm text-black/70 whitespace-pre-line">{actaExistente.resumen}</p>
              {actaExistente.archivo_url ? (
                <a
                  href={actaExistente.archivo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1f4e5f] underline underline-offset-2 mt-3"
                >
                  📄 Descargar acta en PDF
                </a>
              ) : (
                <p className="text-xs text-black/40 mt-2">Guardada en Documentos → Actas y resoluciones.</p>
              )}
            </Card>
          ) : reunion.estado === "cancelada" ? (
            <EmptyState>Reunión cancelada, sin acta.</EmptyState>
          ) : puedeEditar ? (
            <Card>
              <form action={cerrarReunionAction} className="space-y-3">
                <input type="hidden" name="id" value={reunion.id} />
                <div>
                  <Label>Resumen del acta</Label>
                  <textarea name="resumen" required className={inputClass} rows={5} placeholder="Temas tratados, resoluciones, próximos pasos…" />
                </div>

                <div className="pt-2 border-t border-black/5">
                  <Label>Tareas resultantes (opcional)</Label>
                  <p className="text-xs text-black/40 mb-2">Se cargan directo en Comisiones — no hace falta anotarlas también en el resumen.</p>
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-1.5">
                        <input name="tarea_titulo" placeholder="Título de la tarea" className={inputClass + " text-xs !py-1.5"} />
                        <select name="tarea_responsable_id" defaultValue="" className={inputClass + " text-xs !py-1.5"}>
                          <option value="">Sin asignar</option>
                          {usuarios.map((u) => (
                            <option key={u.id} value={u.id}>{u.nombre}</option>
                          ))}
                        </select>
                        <select name="tarea_prioridad" defaultValue="media" className={inputClass + " text-xs !py-1.5"}>
                          <option value="alta">Alta</option>
                          <option value="media">Media</option>
                          <option value="baja">Baja</option>
                        </select>
                        <input name="tarea_fecha_vencimiento" type="date" className={inputClass + " text-xs !py-1.5"} />
                      </div>
                    ))}
                  </div>
                </div>

                <button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Cerrar reunión y generar acta</button>
              </form>
            </Card>
          ) : (
            <EmptyState>Todavía no se cerró esta reunión.</EmptyState>
          )}

          {tareas.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-[#123240] mb-2">Tareas de esta reunión</h3>
              <Card>
                <div className="space-y-1.5">
                  {tareas.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className={`truncate font-medium ${t.estado === "completada" ? "text-black/40 line-through" : "text-[#123240]"}`}>
                          {t.titulo}
                        </p>
                        <p className="text-black/40">
                          {PRIORIDAD_LABEL[t.prioridad] ?? t.prioridad} · {t.responsable_nombre || "sin asignar"}
                          {t.fecha_vencimiento ? ` · vence ${dayjs(t.fecha_vencimiento).format("DD/MM")}` : ""}
                        </p>
                      </div>
                      {puedeEditar ? (
                        <AutoSubmitSelect
                          action={cambiarEstadoTareaAction}
                          hiddenFields={{ id: t.id }}
                          name="estado"
                          defaultValue={t.estado}
                          options={Object.entries(ESTADO_TAREA_LABEL).map(([value, label]) => ({ value, label }))}
                          className="rounded-md border border-black/10 bg-white px-1.5 py-1 text-xs whitespace-nowrap"
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
    </div>
  );
}
