import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass, Button } from "@/components/ui";
import dayjs from "dayjs";
import Link from "next/link";
import { crearJornadaAction, proponerDistribucionAction, confirmarAsignacionAction, anotarmeAction } from "@/lib/actions/trabajo";

export default async function TrabajoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "trabajo")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "trabajo");
  const [proximaJornada, pasadas, nucleos] = await Promise.all([
    get<any>(`SELECT * FROM jornadas_trabajo WHERE fecha >= CURRENT_DATE::text ORDER BY fecha ASC LIMIT 1`),
    all<any>(`SELECT * FROM jornadas_trabajo WHERE fecha < CURRENT_DATE::text ORDER BY fecha DESC LIMIT 8`),
    all<any>(`SELECT * FROM nucleos_familiares ORDER BY horas_acumuladas DESC`),
  ]);

  let tareasJornada: any[] = [];
  if (proximaJornada) {
    const tareasJornadaBase = await all<any>(`SELECT * FROM tareas_jornada WHERE jornada_id = ?`, [proximaJornada.id]);
    tareasJornada = await Promise.all(
      tareasJornadaBase.map(async (t) => {
        const asignaciones = await all<any>(`SELECT a.*, n.nombre as nucleo_nombre FROM asignaciones_jornada a JOIN nucleos_familiares n ON n.id = a.nucleo_id WHERE tarea_jornada_id = ?`, [t.id]);
        return { ...t, asignaciones };
      })
    );
  }

  return (
    <div>
      <PageHeader title="Trabajo" subtitle="Jornadas de ayuda mutua, asignaciones y horas" />

      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[#123240]">Próxima jornada</h3>
          {proximaJornada && puedeEditar && (
            <form action={proponerDistribucionAction}>
              <input type="hidden" name="jornada_id" value={proximaJornada.id} />
              <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-1.5 text-xs font-semibold">✨ Proponer distribución con IA</button>
            </form>
          )}
        </div>

        {!proximaJornada && <EmptyState>No hay jornadas planificadas todavía.</EmptyState>}

        {proximaJornada && (
          <>
            <p className="text-sm text-black/70 mb-3">{dayjs(proximaJornada.fecha).format("dddd DD [de] MMMM")} — {proximaJornada.descripcion}</p>
            {proximaJornada.herramientas_necesarias && <p className="text-xs text-black/50 mb-3">Herramientas: {proximaJornada.herramientas_necesarias}</p>}
            <div className="space-y-3">
              {tareasJornada.map((t) => {
                const cubiertos = t.asignaciones.length;
                const falta = t.personas_necesarias - cubiertos;
                return (
                  <div key={t.id} className="rounded-xl bg-[#f8fafa] p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-[#123240]">{t.nombre}{t.habilidad_requerida ? ` (${t.habilidad_requerida})` : ""}</p>
                      <Badge color={falta > 0 ? "amarillo" : "verde"}>{cubiertos}/{t.personas_necesarias}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {t.asignaciones.map((a: any) => (
                        <span key={a.id} className={`text-xs rounded-full px-2 py-1 ${a.confirmado ? "bg-[var(--color-verde-bg)] text-[var(--color-verde)]" : "bg-black/5 text-black/60"}`}>
                          {a.nucleo_nombre}{a.propuesta_por_ia && !a.confirmado ? " (propuesto por IA)" : ""}
                          {!a.confirmado && puedeEditar && (
                            <form action={confirmarAsignacionAction} className="inline">
                              <input type="hidden" name="id" value={a.id} />
                              <button className="ml-1.5 underline">confirmar</button>
                            </form>
                          )}
                        </span>
                      ))}
                    </div>
                    {falta > 0 && user.nucleo_id && (
                      <form action={anotarmeAction} className="mt-2">
                        <input type="hidden" name="jornada_id" value={proximaJornada.id} />
                        <input type="hidden" name="tarea_jornada_id" value={t.id} />
                        <button className="text-xs text-[#1f4e5f] underline">Anotarme para esta tarea</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h3 className="text-sm font-bold text-[#123240] mb-2">Jornadas anteriores</h3>
          <div className="space-y-2">
            {pasadas.map((j) => <Link key={j.id} href={`/trabajo/${j.id}`}><Card className="hover:shadow-md text-sm">{dayjs(j.fecha).format("DD/MM/YYYY")} — {j.descripcion}</Card></Link>)}
            {pasadas.length === 0 && <EmptyState>Sin jornadas anteriores.</EmptyState>}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#123240] mb-2">Horas acumuladas por núcleo</h3>
          <Card>
            <table className="w-full text-sm">
              <tbody>
                {nucleos.map((n) => (
                  <tr key={n.id} className={`border-b border-black/5 last:border-0 ${n.id === user.nucleo_id ? "font-semibold text-[#1f4e5f]" : ""}`}>
                    <td className="py-1.5">{n.nombre}</td>
                    <td className="py-1.5 text-right">{n.horas_acumuladas} hs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      {puedeEditar && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Planificar nueva jornada</summary>
          <Card className="mt-3">
            <form action={crearJornadaAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Fecha</Label><input type="date" name="fecha" required className={inputClass} /></div>
              <div><Label>Herramientas necesarias</Label><input name="herramientas_necesarias" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Descripción</Label><input name="descripcion" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Tareas de la jornada (una por línea)</Label><textarea name="tareas" className={inputClass} rows={3} placeholder={"Encofrado de columnas\nOrden y limpieza"} /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Crear jornada</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
