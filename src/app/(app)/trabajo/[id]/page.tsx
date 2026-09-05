import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, Badge, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { registrarAsistenciaAction, marcarJornadaRealizadaAction } from "@/lib/actions/trabajo";

export default async function JornadaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "trabajo")) redirect("/dashboard");

  const [jornada, nucleos, asistencias] = await Promise.all([
    get<any>(`SELECT * FROM jornadas_trabajo WHERE id = ?`, [id]),
    all<any>(`SELECT * FROM nucleos_familiares ORDER BY nombre`),
    all<any>(`SELECT * FROM asistencias WHERE jornada_id = ?`, [id]),
  ]);
  if (!jornada) notFound();
  const puedeEditar = canEdit(user.rol, "trabajo");
  const asistenciaPorNucleo = Object.fromEntries(asistencias.map((a) => [a.nucleo_id, a]));
  const presentes = asistencias.filter((a) => a.presente).length;
  const totalHoras = asistencias.reduce((s, a) => s + (a.horas || 0), 0);

  return (
    <div>
      <PageHeader title={`Jornada del ${dayjs(jornada.fecha).format("DD/MM/YYYY")}`} subtitle={jornada.descripcion}
        action={jornada.estado === "planificada" && puedeEditar ? (
          <form action={marcarJornadaRealizadaAction}><input type="hidden" name="id" value={jornada.id} />
            <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-1.5 text-xs font-semibold">Marcar como realizada</button>
          </form>
        ) : <Badge color={jornada.estado === "realizada" ? "verde" : "gray"}>{jornada.estado}</Badge>} />

      <Card className="mb-5 flex gap-6 text-sm">
        <div><span className="text-black/50">Presentes:</span> <strong>{presentes}/{nucleos.length}</strong></div>
        <div><span className="text-black/50">Horas totales:</span> <strong>{totalHoras}</strong></div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-black/50 border-b border-black/10">
            <th className="py-2">Núcleo</th><th>Presente</th><th>Horas</th><th>Justificación</th>{puedeEditar && <th></th>}
          </tr></thead>
          <tbody>
            {nucleos.map((n) => {
              const a = asistenciaPorNucleo[n.id];
              return (
                <tr key={n.id} className="border-b border-black/5 last:border-0">
                  <td className="py-2">{n.nombre}</td>
                  <td>{a?.presente ? "✅" : "—"}</td>
                  <td>{a?.horas || 0}</td>
                  <td className="text-black/50">{a?.justificacion || ""}</td>
                  {puedeEditar && (
                    <td>
                      <form action={registrarAsistenciaAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="jornada_id" value={jornada.id} />
                        <input type="hidden" name="nucleo_id" value={n.id} />
                        <input type="checkbox" name="presente" defaultChecked={!!a?.presente} />
                        <input type="number" name="horas" defaultValue={a?.horas || 3} step="0.5" className="w-14 rounded border border-black/10 px-1 py-0.5 text-xs" />
                        <button className="text-xs text-[#1f4e5f] underline">Guardar</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
