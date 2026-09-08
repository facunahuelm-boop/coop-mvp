import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Label, inputClass, Badge } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import dayjs from "dayjs";
import {
  crearComisionAction,
  archivarComisionAction,
  agregarMiembroAction,
  quitarMiembroAction,
} from "@/lib/actions/comisiones";
import { crearTareaAction, cambiarEstadoTareaAction } from "@/lib/actions/tareas";

// Fase 06 del Plan Maestro — cualquier comisión puede llevar sus propias
// tareas ahora, no solo Obra (tareas_obra) o Trabajo (tareas_jornada).
const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "verde" | "amarillo" | "brand"> = { pendiente: "amarillo", en_curso: "brand", completada: "verde" };
const PRIORIDAD_LABEL: Record<string, string> = { alta: "🔴 Alta", media: "🟡 Media", baja: "⚪ Baja" };

export default async function ComisionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");

  const [comisiones, miembros, usuarios, tareas] = await Promise.all([
    all<any>(`SELECT * FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    all<any>(
      `SELECT m.*, u.nombre as user_nombre FROM comision_miembros m JOIN users u ON u.id = m.user_id WHERE m.activo = 1 ORDER BY m.rol_en_comision DESC, u.nombre ASC`
    ),
    all<any>(`SELECT id, nombre, rol FROM users WHERE activo = 1 ORDER BY nombre ASC`),
    all<any>(
      `SELECT t.*, u.nombre as responsable_nombre FROM tareas t LEFT JOIN users u ON u.id = t.responsable_id
       ORDER BY (t.estado = 'completada'), CASE t.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, t.creado_en DESC`
    ),
  ]);

  const miembrosPorComision = (comisionId: number) => miembros.filter((m) => m.comision_id === comisionId);
  const tareasPorComision = (comisionId: number) => tareas.filter((t) => t.comision_id === comisionId);

  return (
    <div>
      <PageHeader title="Comisiones" subtitle="Quién integra cada comisión de la cooperativa" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {comisiones.map((c) => {
          const integrantes = miembrosPorComision(c.id);
          return (
            <Card key={c.id}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--color-brand-900)]">{c.nombre}</h3>
                {puedeEditar && (
                  <form action={archivarComisionAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs text-ink/40 hover:text-[var(--color-rojo)] underline underline-offset-2">Archivar</button>
                  </form>
                )}
              </div>
              {c.descripcion && <p className="text-xs text-ink/50 mt-0.5">{c.descripcion}</p>}

              <div className="flex flex-wrap gap-1.5 mt-3">
                {integrantes.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 text-xs rounded-full bg-ink/5 px-2.5 py-1">
                    {m.rol_en_comision === "coordinador" ? "⭐ " : ""}
                    {m.user_nombre}
                    {puedeEditar && (
                      <form action={quitarMiembroAction} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="text-ink/40 hover:text-[var(--color-rojo)]" title="Quitar de la comisión">✕</button>
                      </form>
                    )}
                  </span>
                ))}
                {integrantes.length === 0 && <p className="text-xs text-ink/40 italic">Sin integrantes todavía.</p>}
              </div>

              {puedeEditar && (
                <form action={agregarMiembroAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="comision_id" value={c.id} />
                  <div className="flex-1 min-w-[140px]">
                    <Label>Agregar integrante</Label>
                    <select name="user_id" required className={inputClass}>
                      {usuarios.map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Rol</Label>
                    <select name="rol_en_comision" className={inputClass} defaultValue="integrante">
                      <option value="integrante">Integrante</option>
                      <option value="coordinador">Coordinador/a</option>
                    </select>
                  </div>
                  <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Agregar</button>
                </form>
              )}

              <div className="mt-4 pt-4 border-t border-ink/5">
                <p className="text-xs font-semibold text-ink/60 mb-2">Tareas</p>
                <div className="space-y-1.5">
                  {tareasPorComision(c.id).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className={`truncate font-medium ${t.estado === "completada" ? "text-ink/40 line-through" : "text-[var(--color-brand-900)]"}`}>
                          {t.titulo}
                        </p>
                        <p className="text-ink/40">
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
                          className="rounded-md border border-ink/10 bg-surface px-1.5 py-1 text-xs whitespace-nowrap"
                        />
                      ) : (
                        <Badge color={ESTADO_TAREA_COLOR[t.estado] ?? "gray"}>{ESTADO_TAREA_LABEL[t.estado] ?? t.estado}</Badge>
                      )}
                    </div>
                  ))}
                  {tareasPorComision(c.id).length === 0 && (
                    <p className="text-xs text-ink/40 italic">Sin tareas cargadas.</p>
                  )}
                </div>

                {puedeEditar && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--color-brand-800)]">+ Agregar tarea</summary>
                    <form action={crearTareaAction} className="mt-2 grid grid-cols-1 gap-2">
                      <input type="hidden" name="comision_id" value={c.id} />
                      <input name="titulo" required placeholder="Título de la tarea" className={inputClass} />
                      <div className="grid grid-cols-2 gap-2">
                        <select name="responsable_id" className={inputClass} defaultValue="">
                          <option value="">Sin asignar</option>
                          {usuarios.map((u) => (
                            <option key={u.id} value={u.id}>{u.nombre}</option>
                          ))}
                        </select>
                        <select name="prioridad" className={inputClass} defaultValue="media">
                          <option value="alta">Alta</option>
                          <option value="media">Media</option>
                          <option value="baja">Baja</option>
                        </select>
                      </div>
                      <input name="fecha_vencimiento" type="date" className={inputClass} />
                      <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold">Agregar tarea</button>
                    </form>
                  </details>
                )}
              </div>
            </Card>
          );
        })}
        {comisiones.length === 0 && <EmptyState>Todavía no hay comisiones creadas.</EmptyState>}
      </div>

      {puedeEditar && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Crear comisión</summary>
          <Card className="mt-3">
            <form action={crearComisionAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Nombre</Label><input name="nombre" required placeholder="Ej: Comisión de Educación" className={inputClass} /></div>
              <div><Label>Descripción</Label><input name="descripcion" className={inputClass} /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Crear comisión</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
