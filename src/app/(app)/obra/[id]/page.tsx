import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { semaforoTarea } from "@/lib/logic";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import dayjs from "dayjs";
import { resolverProblemaFormAction, cambiarEstadoTareaFormAction } from "@/lib/actions/obra";
import { UsuarioLink } from "@/components/EntidadLink";
import { AgregarAvanceForm, AgregarProblemaForm } from "@/components/obra/ObraFormularios";

const semColor: Record<string, "verde" | "amarillo" | "rojo"> = { verde: "verde", amarillo: "amarillo", rojo: "rojo" };

export default async function TareaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "obra")) redirect("/dashboard");

  const [tarea, avances, problemas] = await Promise.all([
    get<any>(`SELECT t.*, u.nombre as responsable_nombre FROM tareas_obra t LEFT JOIN users u ON u.id = t.responsable_id WHERE t.id = ?`, [id]),
    all<any>(`SELECT a.*, u.nombre as autor_nombre FROM avances_obra a LEFT JOIN users u ON u.id = a.autor_id WHERE tarea_id = ? ORDER BY fecha DESC`, [id]),
    all<any>(`SELECT p.*, u.nombre as autor_nombre FROM problemas_obra p LEFT JOIN users u ON u.id = p.autor_id WHERE tarea_id = ? ORDER BY fecha DESC`, [id]),
  ]);
  if (!tarea) notFound();
  const semaforo = await semaforoTarea(tarea);
  const puedeEditar = canEdit(user.rol, "obra");

  return (
    <div>
      <PageHeader title={tarea.nombre} subtitle={`Etapa: ${tarea.etapa}`}
        action={<Badge color={semColor[semaforo]}>{semaforo === "verde" ? "🟢 En hora" : semaforo === "amarillo" ? "🟡 Atención" : "🔴 Crítico"}</Badge>} />

      <Card className="mb-5">
        <p className="text-sm text-ink/70">{tarea.descripcion}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
          <div><Label>Estado</Label>{tarea.estado}</div>
          <div><Label>Prioridad</Label>{tarea.prioridad}</div>
          <div><Label>Inicio</Label>{tarea.fecha_inicio ? dayjs(tarea.fecha_inicio).format("DD/MM/YYYY") : "—"}</div>
          <div><Label>Fin previsto</Label>{tarea.fecha_fin_prevista ? dayjs(tarea.fecha_fin_prevista).format("DD/MM/YYYY") : "—"}</div>
          <div><Label>Responsable</Label><UsuarioLink id={tarea.responsable_id} nombre={tarea.responsable_nombre} /></div>
        </div>
        {puedeEditar && (
          <ActionForm action={cambiarEstadoTareaFormAction} className="mt-4 flex items-center gap-2">
            <input type="hidden" name="id" value={tarea.id} />
            <select name="estado" defaultValue={tarea.estado} className={inputClass + " max-w-[180px]"}>
              <option value="pendiente">Pendiente</option><option value="en_curso">En curso</option><option value="completada">Completada</option>
            </select>
            <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold">Actualizar estado</button>
          </ActionForm>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Avances</h3>
          <div className="space-y-2 mb-3">
            {avances.length === 0 && <EmptyState>Sin avances registrados.</EmptyState>}
            {avances.map((a) => (
              <Card key={a.id}>
                <p className="text-xs text-ink/40">{dayjs(a.fecha).format("DD/MM/YYYY")} · <UsuarioLink id={a.autor_id} nombre={a.autor_nombre} /></p>
                <p className="text-sm mt-1">{a.descripcion}</p>
                {a.foto_url && <img src={`/api/archivos/avance-obra/${a.id}`} alt="" className="mt-2 rounded-lg max-h-48 object-cover" />}
              </Card>
            ))}
          </div>
          {puedeEditar && <AgregarAvanceForm tareaId={tarea.id} />}
        </div>

        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Problemas / observaciones</h3>
          <div className="space-y-2 mb-3">
            {problemas.length === 0 && <EmptyState>Sin problemas registrados.</EmptyState>}
            {problemas.map((p) => (
              <Card key={p.id} className={p.estado === "abierto" ? "!border-[var(--color-rojo)]/20" : ""}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{p.titulo}</p>
                  <Badge color={p.estado === "abierto" ? (p.severidad === "critica" ? "rojo" : "amarillo") : "verde"}>{p.estado === "abierto" ? p.severidad : "resuelto"}</Badge>
                </div>
                <p className="text-xs text-ink/60 mt-1">{p.descripcion}</p>
                <p className="text-xs text-ink/40 mt-1">{dayjs(p.fecha).format("DD/MM/YYYY")} · <UsuarioLink id={p.autor_id} nombre={p.autor_nombre} fallback="sin autor" /></p>
                {p.resolucion && <p className="text-xs text-[var(--color-verde)] mt-1">Resolución: {p.resolucion}</p>}
                {puedeEditar && p.estado === "abierto" && (
                  <ActionForm action={resolverProblemaFormAction} className="mt-2 flex gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="tarea_id" value={tarea.id} />
                    <input name="resolucion" placeholder="¿Cómo se resolvió?" className={inputClass + " text-xs"} />
                    <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Marcar resuelto</button>
                  </ActionForm>
                )}
              </Card>
            ))}
          </div>
          {puedeEditar && <AgregarProblemaForm tareaId={tarea.id} />}
        </div>
      </div>
    </div>
  );
}
