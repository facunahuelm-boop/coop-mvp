import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import {
  registrarAsistenciaAction,
  cerrarReunionAction,
  cancelarReunionAction,
} from "@/lib/actions/reuniones";

const TIPO_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};

export default async function ReunionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");

  const [reunion, nucleos, asistencias] = await Promise.all([
    get<any>(`SELECT r.*, c.nombre as comision_nombre FROM reuniones r LEFT JOIN comisiones c ON c.id = r.comision_id WHERE r.id = ?`, [id]),
    all<any>(`SELECT * FROM nucleos_familiares ORDER BY nombre ASC`),
    all<any>(`SELECT * FROM reunion_asistencias WHERE reunion_id = ?`, [id]),
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
              <form action={cerrarReunionAction} className="space-y-2">
                <input type="hidden" name="id" value={reunion.id} />
                <Label>Resumen del acta</Label>
                <textarea name="resumen" required className={inputClass} rows={5} placeholder="Temas tratados, resoluciones, próximos pasos…" />
                <button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Cerrar reunión y generar acta</button>
              </form>
            </Card>
          ) : (
            <EmptyState>Todavía no se cerró esta reunión.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
