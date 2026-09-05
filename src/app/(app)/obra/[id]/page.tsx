import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { semaforoTarea } from "@/lib/logic";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { agregarAvanceAction, agregarProblemaAction, resolverProblemaAction, cambiarEstadoTareaAction } from "@/lib/actions/obra";

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
      <PageHeader title={tarea.nombre} subtitle={`Etapa: ${tarea.etapa} · Responsable: ${tarea.responsable_nombre || "—"}`}
        action={<Badge color={semColor[semaforo]}>{semaforo === "verde" ? "🟢 En hora" : semaforo === "amarillo" ? "🟡 Atención" : "🔴 Crítico"}</Badge>} />

      <Card className="mb-5">
        <p className="text-sm text-black/70">{tarea.descripcion}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
          <div><Label>Estado</Label>{tarea.estado}</div>
          <div><Label>Prioridad</Label>{tarea.prioridad}</div>
          <div><Label>Inicio</Label>{tarea.fecha_inicio ? dayjs(tarea.fecha_inicio).format("DD/MM/YYYY") : "—"}</div>
          <div><Label>Fin previsto</Label>{tarea.fecha_fin_prevista ? dayjs(tarea.fecha_fin_prevista).format("DD/MM/YYYY") : "—"}</div>
        </div>
        {puedeEditar && (
          <form action={cambiarEstadoTareaAction} className="mt-4 flex items-center gap-2">
            <input type="hidden" name="id" value={tarea.id} />
            <select name="estado" defaultValue={tarea.estado} className={inputClass + " max-w-[180px]"}>
              <option value="pendiente">Pendiente</option><option value="en_curso">En curso</option><option value="completada">Completada</option>
            </select>
            <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-2 text-xs font-semibold">Actualizar estado</button>
          </form>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h3 className="text-sm font-bold text-[#123240] mb-2">Avances</h3>
          <div className="space-y-2 mb-3">
            {avances.length === 0 && <EmptyState>Sin avances registrados.</EmptyState>}
            {avances.map((a) => (
              <Card key={a.id}>
                <p className="text-xs text-black/40">{dayjs(a.fecha).format("DD/MM/YYYY")} · {a.autor_nombre}</p>
                <p className="text-sm mt-1">{a.descripcion}</p>
                {a.foto_url && <img src={a.foto_url} alt="" className="mt-2 rounded-lg max-h-48 object-cover" />}
              </Card>
            ))}
          </div>
          {puedeEditar && (
            <form action={agregarAvanceAction} className="space-y-2">
              <input type="hidden" name="tarea_id" value={tarea.id} />
              <textarea name="descripcion" required placeholder="Describí el avance…" className={inputClass} rows={2} />
              <input type="file" name="foto" accept="image/*" className="text-xs" />
              <button className="rounded-lg bg-[#1f4e5f] text-white px-3 py-2 text-xs font-semibold">Agregar avance</button>
            </form>
          )}
        </div>

        <div>
          <h3 className="text-sm font-bold text-[#123240] mb-2">Problemas / observaciones</h3>
          <div className="space-y-2 mb-3">
            {problemas.length === 0 && <EmptyState>Sin problemas registrados.</EmptyState>}
            {problemas.map((p) => (
              <Card key={p.id} className={p.estado === "abierto" ? "!border-[var(--color-rojo)]/20" : ""}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{p.titulo}</p>
                  <Badge color={p.estado === "abierto" ? (p.severidad === "critica" ? "rojo" : "amarillo") : "verde"}>{p.estado === "abierto" ? p.severidad : "resuelto"}</Badge>
                </div>
                <p className="text-xs text-black/60 mt-1">{p.descripcion}</p>
                {p.resolucion && <p className="text-xs text-[var(--color-verde)] mt-1">Resolución: {p.resolucion}</p>}
                {puedeEditar && p.estado === "abierto" && (
                  <form action={resolverProblemaAction} className="mt-2 flex gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="tarea_id" value={tarea.id} />
                    <input name="resolucion" placeholder="¿Cómo se resolvió?" className={inputClass + " text-xs"} />
                    <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-2 text-xs font-semibold whitespace-nowrap">Marcar resuelto</button>
                  </form>
                )}
              </Card>
            ))}
          </div>
          {puedeEditar && (
            <form action={agregarProblemaAction} className="space-y-2">
              <input type="hidden" name="tarea_id" value={tarea.id} />
              <input name="titulo" required placeholder="Título del problema" className={inputClass} />
              <textarea name="descripcion" placeholder="Descripción" className={inputClass} rows={2} />
              <select name="severidad" className={inputClass} defaultValue="media">
                <option value="baja">Baja</option><option value="media">Media</option><option value="critica">Crítica</option>
              </select>
              <button className="rounded-lg bg-[#1f4e5f] text-white px-3 py-2 text-xs font-semibold">Registrar problema</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
