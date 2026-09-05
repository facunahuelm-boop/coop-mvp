import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { tareasObraConSemaforo } from "@/lib/logic";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import Link from "next/link";
import dayjs from "dayjs";
import { crearTareaAction } from "@/lib/actions/obra";

const semColor: Record<string, "verde" | "amarillo" | "rojo"> = { verde: "verde", amarillo: "amarillo", rojo: "rojo" };
const semLabel: Record<string, string> = { verde: "🟢 En hora", amarillo: "🟡 Atención", rojo: "🔴 Crítico" };
const estadoLabel: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };

export default async function ObraPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "obra")) redirect("/dashboard");

  const [tareas, problemasAbiertos] = await Promise.all([
    tareasObraConSemaforo(),
    all<any>(`SELECT p.*, t.nombre as tarea_nombre FROM problemas_obra p LEFT JOIN tareas_obra t ON t.id = p.tarea_id WHERE p.estado='abierto' ORDER BY p.severidad`),
  ]);
  const etapas = Array.from(new Set(tareas.map((t: any) => t.etapa)));
  const puedeEditar = canEdit(user.rol, "obra");

  return (
    <div>
      <PageHeader title="Obra" subtitle="Cronograma, avances y problemas de la obra" />

      {problemasAbiertos.length > 0 && (
        <Card className="mb-5 !border-[var(--color-rojo)]/20">
          <p className="text-sm font-semibold text-[var(--color-rojo)] mb-2">Problemas abiertos ({problemasAbiertos.length})</p>
          <ul className="space-y-1 text-sm">
            {problemasAbiertos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>{p.severidad === "critica" ? "🔴" : "🟠"} {p.titulo}{p.tarea_nombre ? ` — ${p.tarea_nombre}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="space-y-6">
        {etapas.map((etapa) => (
          <div key={etapa}>
            <h3 className="text-sm font-bold text-[#123240]/70 uppercase tracking-wide mb-2">{etapa}</h3>
            <div className="space-y-2">
              {tareas.filter((t: any) => t.etapa === etapa).map((t: any) => (
                <Link key={t.id} href={`/obra/${t.id}`}>
                  <Card className="flex items-center justify-between gap-3 hover:shadow-md transition-shadow">
                    <div>
                      <p className="text-sm font-semibold text-[#123240]">{t.nombre}</p>
                      <p className="text-xs text-black/50 mt-0.5">
                        {estadoLabel[t.estado]} · {t.responsable_nombre || "sin responsable"}
                        {t.fecha_fin_prevista && ` · vence ${dayjs(t.fecha_fin_prevista).format("DD/MM")}`}
                        {t.depende_de_nombre && ` · depende de "${t.depende_de_nombre}"`}
                      </p>
                    </div>
                    <Badge color={semColor[t.semaforo]}>{semLabel[t.semaforo]}</Badge>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
        {tareas.length === 0 && <EmptyState>Todavía no hay tareas cargadas.</EmptyState>}
      </div>

      {puedeEditar && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Agregar tarea</summary>
          <Card className="mt-3">
            <form action={crearTareaAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Etapa</Label><input name="etapa" required className={inputClass} placeholder="Ej: Estructura" /></div>
              <div><Label>Nombre de la tarea</Label><input name="nombre" required className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Descripción</Label><textarea name="descripcion" className={inputClass} rows={2} /></div>
              <div><Label>Fecha de inicio</Label><input type="date" name="fecha_inicio" className={inputClass} /></div>
              <div><Label>Fecha fin prevista</Label><input type="date" name="fecha_fin_prevista" className={inputClass} /></div>
              <div>
                <Label>Prioridad</Label>
                <select name="prioridad" className={inputClass} defaultValue="media">
                  <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Crear tarea</button>
              </div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
