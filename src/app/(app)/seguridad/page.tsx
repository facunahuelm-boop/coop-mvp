import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { crearDocumentoSeguridadAction, crearInspeccionAction, crearIncidenteAction, resolverIncidenteAction } from "@/lib/actions/seguridad";
import { CHECKLIST_BASE } from "@/lib/constants";

export default async function SeguridadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "seguridad")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "seguridad");
  const [docs, incidentes, inspecciones] = await Promise.all([
    all<any>(`SELECT * FROM documentos_seguridad ORDER BY fecha_vencimiento ASC`),
    all<any>(`SELECT i.*, u.nombre as autor_nombre FROM incidentes_seguridad i LEFT JOIN users u ON u.id = i.autor_id ORDER BY fecha DESC`),
    all<any>(`SELECT i.*, u.nombre as autor_nombre FROM inspecciones_seguridad i LEFT JOIN users u ON u.id = i.autor_id ORDER BY fecha DESC LIMIT 5`),
  ]);
  const hoy = dayjs();

  return (
    <div>
      <PageHeader title="Seguridad, Higiene y Prevención" subtitle="Documentación, inspecciones e incidentes" />

      <h3 className="text-sm font-bold text-[#123240] mb-2">Documentación y vencimientos</h3>
      <div className="space-y-2 mb-6">
        {docs.map((d) => {
          const dias = d.fecha_vencimiento ? dayjs(d.fecha_vencimiento).diff(hoy, "day") : null;
          const color = dias == null ? "gray" : dias < 0 ? "rojo" : dias <= 15 ? "amarillo" : "verde";
          return (
            <Card key={d.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{d.tipo}</p>
                <p className="text-xs text-black/50">{d.descripcion}</p>
              </div>
              <Badge color={color as any}>{dias == null ? "sin vencimiento" : dias < 0 ? `vencido hace ${-dias}d` : `vence en ${dias}d`}</Badge>
            </Card>
          );
        })}
        {docs.length === 0 && <EmptyState>Sin documentos cargados.</EmptyState>}
      </div>
      {puedeEditar && (
        <details className="mb-8"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Cargar documento</summary>
          <Card className="mt-3">
            <form action={crearDocumentoSeguridadAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label>Tipo de documento</Label><input name="tipo" required className={inputClass} /></div>
              <div><Label>Descripción</Label><input name="descripcion" className={inputClass} /></div>
              <div><Label>Fecha de vencimiento</Label><input type="date" name="fecha_vencimiento" className={inputClass} /></div>
              <div className="sm:col-span-3"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Guardar</button></div>
            </form>
          </Card>
        </details>
      )}

      <h3 className="text-sm font-bold text-[#123240] mb-2">Incidentes, accidentes y observaciones</h3>
      <div className="space-y-2 mb-4">
        {incidentes.map((i) => (
          <Card key={i.id} className={i.estado === "abierto" ? "!border-[var(--color-rojo)]/20" : ""}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold capitalize">{i.tipo} — {i.severidad}</p>
              <Badge color={i.estado === "resuelto" ? "verde" : i.severidad === "critica" ? "rojo" : "amarillo"}>{i.estado}</Badge>
            </div>
            <p className="text-sm text-black/70 mt-1">{i.descripcion}</p>
            {i.foto_url && <img src={i.foto_url} alt="" className="mt-2 rounded-lg max-h-48 object-cover" />}
            <p className="text-xs text-black/40 mt-1">{dayjs(i.fecha).format("DD/MM/YYYY")} · {i.autor_nombre}</p>
            {i.ia_observacion && (
              <p className="text-xs text-[#1f4e5f] bg-[#e7eff1] rounded-lg p-2 mt-2">✨ {i.ia_observacion}</p>
            )}
            {i.medidas && <p className="text-xs text-[var(--color-verde)] mt-1">Medidas: {i.medidas}</p>}
            {puedeEditar && i.estado === "abierto" && (
              <form action={resolverIncidenteAction} className="mt-2 flex gap-2">
                <input type="hidden" name="id" value={i.id} />
                <input name="medidas" placeholder="Medida correctiva aplicada" className={inputClass + " text-xs"} />
                <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-2 text-xs font-semibold whitespace-nowrap">Marcar resuelto</button>
              </form>
            )}
          </Card>
        ))}
        {incidentes.length === 0 && <EmptyState>Sin incidentes registrados.</EmptyState>}
      </div>
      {puedeEditar && (
        <details className="mb-8"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Registrar incidente / observación</summary>
          <Card className="mt-3">
            <form action={crearIncidenteAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <select name="tipo" className={inputClass} defaultValue="observacion">
                  <option value="observacion">Observación</option><option value="incidente">Incidente</option><option value="accidente">Accidente</option>
                </select>
              </div>
              <div>
                <Label>Severidad</Label>
                <select name="severidad" className={inputClass} defaultValue="media">
                  <option value="baja">Baja</option><option value="media">Media</option><option value="critica">Crítica</option>
                </select>
              </div>
              <div className="sm:col-span-2"><Label>Descripción</Label><textarea name="descripcion" required className={inputClass} rows={2} /></div>
              <div className="sm:col-span-2"><Label>Foto (opcional)</Label><input type="file" name="foto" accept="image/*" className="text-xs" /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Registrar</button></div>
            </form>
          </Card>
        </details>
      )}

      <h3 className="text-sm font-bold text-[#123240] mb-2">Inspecciones (checklist)</h3>
      <div className="space-y-2 mb-4">
        {inspecciones.map((i) => {
          const items = JSON.parse(i.checklist_json) as { item: string; ok: boolean }[];
          const fallas = items.filter((x) => !x.ok);
          return (
            <Card key={i.id}>
              <p className="text-xs text-black/40">{dayjs(i.fecha).format("DD/MM/YYYY")} · {i.autor_nombre}</p>
              <p className="text-sm mt-1">{fallas.length === 0 ? "🟢 Todos los puntos del checklist OK." : `🟠 ${fallas.length} punto(s) a corregir: ${fallas.map((f) => f.item).join(", ")}`}</p>
              {i.hallazgos && <p className="text-xs text-black/60 mt-1">{i.hallazgos}</p>}
            </Card>
          );
        })}
        {inspecciones.length === 0 && <EmptyState>Sin inspecciones registradas.</EmptyState>}
      </div>
      {puedeEditar && (
        <details><summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Nueva inspección</summary>
          <Card className="mt-3">
            <form action={crearInspeccionAction} className="space-y-2">
              {CHECKLIST_BASE.map((item, i) => (
                <label key={i} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={`item_${i}`} defaultChecked /> {item}
                </label>
              ))}
              <div><Label>Hallazgos</Label><textarea name="hallazgos" className={inputClass} rows={2} /></div>
              <button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Guardar inspección</button>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
