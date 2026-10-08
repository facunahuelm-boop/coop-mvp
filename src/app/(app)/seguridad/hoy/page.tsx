import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, Badge } from "@/components/ui";
import { ChecklistDiarioForm } from "@/components/seguridad/SeguridadObra";
import { CHECKLIST_BASE } from "@/lib/constants";
import { hoyEnUruguay, textoDia } from "@/lib/horasObra";
import { puedeGestionarSeguridad, leerChecklist, fallasDe } from "@/lib/seguridadObra";

/** Fase 3E — checklist de seguridad del día, pensado para el celular en la obra. */
export default async function ChecklistHoyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "seguridad")) redirect("/dashboard");
  const puede = await puedeGestionarSeguridad(user);
  const hoy = hoyEnUruguay();
  const hecho = await get<{ id: number; checklist_json: string; hallazgos: string | null; autor: string | null }>(
    `SELECT i.id, i.checklist_json, i.hallazgos, u.nombre AS autor
       FROM inspecciones_seguridad i LEFT JOIN users u ON u.id = i.autor_id WHERE i.tipo = 'diaria' AND i.dia = ? ORDER BY i.id LIMIT 1`,
    [hoy]
  ).catch(() => undefined);
  const tareas = hecho
    ? await all<{ id: number; titulo: string; estado: string; comision_id: number | null }>(`SELECT id, titulo, estado, comision_id FROM tareas WHERE inspeccion_id = ? ORDER BY id`, [hecho.id]).catch(() => [])
    : [];

  return (
    <div className="max-w-xl">
      <PageHeader title="Checklist de seguridad" subtitle={`Hoy, ${textoDia(hoy)}`} action={<Link href="/seguridad" className="text-sm font-semibold underline underline-offset-2">Volver a Seguridad</Link>} />
      {hecho ? (
        <Card>
          <p className="text-[17px] font-semibold text-ink">
            {fallasDe(leerChecklist(hecho.checklist_json)).length === 0 ? "🟢 Hoy está todo en orden." : "🟠 Hoy hay cosas para corregir."}
          </p>
          <p className="text-sm text-ink-muted mt-1">
            Lo hizo {hecho.autor ?? "—"}.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {leerChecklist(hecho.checklist_json).map((x, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2 text-[15px]">
                <span>
                  {x.item}
                  {x.obs && <span className="block text-sm text-ink-muted">{x.obs}</span>}
                </span>
                <Badge color={x.na ? "gray" : x.ok ? "verde" : "rojo"}>{x.na ? "No aplica" : x.ok ? "Bien" : "Falta"}</Badge>
              </li>
            ))}
          </ul>
          {hecho.hallazgos && <p className="mt-3 text-sm text-ink">{hecho.hallazgos}</p>}
          {tareas.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-ink">Tareas para corregir</p>
              <ul className="mt-1 space-y-1">
                {tareas.map((t) => (
                  <li key={t.id} className="text-sm">
                    {t.comision_id ? <Link href={`/comisiones/${t.comision_id}?tab=tareas`} className="underline underline-offset-2">{t.titulo}</Link> : t.titulo}{" "}
                    <Badge color={t.estado === "completada" ? "verde" : "amarillo"}>{t.estado === "completada" ? "Hecha" : t.estado === "en_curso" ? "En curso" : "Pendiente"}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ) : puede ? (
        <>
          <p className="mb-4 text-[15px] text-ink">Recorré la obra y marcá cada punto. Lo que falte se convierte en una tarea para la Comisión de Seguridad.</p>
          <ChecklistDiarioForm items={CHECKLIST_BASE} />
        </>
      ) : (
        <Card>
          <p className="text-[15px] text-ink">Todavía no se hizo el checklist de hoy. Lo hace la Comisión de Seguridad.</p>
        </Card>
      )}
    </div>
  );
}
