import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, inputClass } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import dayjs from "dayjs";
import { resolverIncidenteFormAction } from "@/lib/actions/seguridad";
import { CHECKLIST_BASE } from "@/lib/constants";
import { obtenerReglasCooperativa } from "@/lib/reglas";
import { UsuarioLink } from "@/components/EntidadLink";
import { CargarDocumentoSeguridadForm, RegistrarIncidenteForm, NuevaInspeccionForm } from "@/components/seguridad/SeguridadFormularios";

export default async function SeguridadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "seguridad")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "seguridad");
  const [docs, incidentes, inspecciones, reglas] = await Promise.all([
    all<any>(`SELECT * FROM documentos_seguridad ORDER BY fecha_vencimiento ASC`),
    all<any>(`SELECT i.*, u.nombre as autor_nombre FROM incidentes_seguridad i LEFT JOIN users u ON u.id = i.autor_id ORDER BY fecha DESC`),
    all<any>(`SELECT i.*, u.nombre as autor_nombre FROM inspecciones_seguridad i LEFT JOIN users u ON u.id = i.autor_id ORDER BY fecha DESC LIMIT 5`),
    // Fase 3, Sub-fase 3.1 ("Reglas de la cooperativa"): mismo umbral
    // configurable que usa recalcularAlertas() — antes hardcodeado en 15.
    obtenerReglasCooperativa(),
  ]);
  const hoy = dayjs();

  return (
    <div>
      <PageHeader title="Seguridad, Higiene y Prevención" subtitle="Documentación, inspecciones e incidentes" />

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Documentación y vencimientos</h3>
      <div className="space-y-2 mb-6">
        {docs.map((d) => {
          const dias = d.fecha_vencimiento ? dayjs(d.fecha_vencimiento).diff(hoy, "day") : null;
          const color = dias == null ? "gray" : dias < 0 ? "rojo" : dias <= reglas.diasAlertaVencimiento ? "amarillo" : "verde";
          return (
            <Card key={d.id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{d.tipo}</p>
                <p className="text-xs text-ink/50">{d.descripcion}</p>
              </div>
              <Badge color={color as any}>{dias == null ? "sin vencimiento" : dias < 0 ? `vencido hace ${-dias}d` : `vence en ${dias}d`}</Badge>
            </Card>
          );
        })}
        {docs.length === 0 && <EmptyState>Sin documentos cargados.</EmptyState>}
      </div>
      {puedeEditar && <CargarDocumentoSeguridadForm />}

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Incidentes, accidentes y observaciones</h3>
      <div className="space-y-2 mb-4">
        {incidentes.map((i) => (
          <Card key={i.id} className={i.estado === "abierto" ? "!border-[var(--color-rojo)]/20" : ""}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold capitalize">{i.tipo} — {i.severidad}</p>
              <Badge color={i.estado === "resuelto" ? "verde" : i.severidad === "critica" ? "rojo" : "amarillo"}>{i.estado}</Badge>
            </div>
            <p className="text-sm text-ink/70 mt-1">{i.descripcion}</p>
            {i.foto_url && <img src={`/api/archivos/incidente-seguridad/${i.id}`} alt="" className="mt-2 rounded-lg max-h-48 object-cover" />}
            <p className="text-xs text-ink/40 mt-1">{dayjs(i.fecha).format("DD/MM/YYYY")} · <UsuarioLink id={i.autor_id} nombre={i.autor_nombre} /></p>
            {i.ia_observacion && (
              <p className="text-xs text-[var(--color-brand-800)] bg-[var(--color-brand-100)] rounded-lg p-2 mt-2">✨ {i.ia_observacion}</p>
            )}
            {i.medidas && <p className="text-xs text-[var(--color-verde)] mt-1">Medidas: {i.medidas}</p>}
            {puedeEditar && i.estado === "abierto" && (
              <ActionForm action={resolverIncidenteFormAction} className="mt-2 flex gap-2">
                <input type="hidden" name="id" value={i.id} />
                <input name="medidas" placeholder="Medida correctiva aplicada" className={inputClass + " text-xs"} />
                <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Marcar resuelto</button>
              </ActionForm>
            )}
          </Card>
        ))}
        {incidentes.length === 0 && <EmptyState>Sin incidentes registrados.</EmptyState>}
      </div>
      {puedeEditar && <RegistrarIncidenteForm />}

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Inspecciones (checklist)</h3>
      <div className="space-y-2 mb-4">
        {inspecciones.map((i) => {
          const items = JSON.parse(i.checklist_json) as { item: string; ok: boolean }[];
          const fallas = items.filter((x) => !x.ok);
          return (
            <Card key={i.id}>
              <p className="text-xs text-ink/40">{dayjs(i.fecha).format("DD/MM/YYYY")} · <UsuarioLink id={i.autor_id} nombre={i.autor_nombre} /></p>
              <p className="text-sm mt-1">{fallas.length === 0 ? "🟢 Todos los puntos del checklist OK." : `🟠 ${fallas.length} punto(s) a corregir: ${fallas.map((f) => f.item).join(", ")}`}</p>
              {i.hallazgos && <p className="text-xs text-ink/60 mt-1">{i.hallazgos}</p>}
            </Card>
          );
        })}
        {inspecciones.length === 0 && <EmptyState>Sin inspecciones registradas.</EmptyState>}
      </div>
      {puedeEditar && <NuevaInspeccionForm checklistBase={CHECKLIST_BASE} />}
    </div>
  );
}
