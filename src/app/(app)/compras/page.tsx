import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import Link from "next/link";
import dayjs from "dayjs";
import { crearSolicitudAction } from "@/lib/actions/compras";

const estadoColor: Record<string, "gray" | "amarillo" | "verde" | "brand"> = {
  pendiente_cotizacion: "gray", en_comparacion: "amarillo", aprobada: "verde", rechazada: "gray", entregada: "brand",
};
const estadoLabel: Record<string, string> = {
  pendiente_cotizacion: "Pendiente de cotización", en_comparacion: "En comparación", aprobada: "Aprobada", rechazada: "Rechazada", entregada: "Entregada",
};

export default async function ComprasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "compras");
  const solicitudes = await all<any>(`SELECT sc.*, u.nombre as solicitante_nombre FROM solicitudes_compra sc LEFT JOIN users u ON u.id = sc.solicitante_id ORDER BY CASE prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC`);

  return (
    <div>
      <PageHeader title="Compras" subtitle="Solicitudes, presupuestos y proveedores" />

      <div className="space-y-2">
        {solicitudes.map((s) => (
          <Link key={s.id} href={`/compras/${s.id}`}>
            <Card className="hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#123240]">{s.material} <span className="font-normal text-black/50">({s.cantidad} {s.unidad})</span></p>
                  <p className="text-xs text-black/50 mt-0.5">{s.comision} · {s.solicitante_nombre} {s.fecha_necesaria && `· necesario para el ${dayjs(s.fecha_necesaria).format("DD/MM")}`}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge color={estadoColor[s.estado]}>{estadoLabel[s.estado]}</Badge>
                  {s.prioridad === "critica" && <Badge color="rojo">🔴 crítica</Badge>}
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {solicitudes.length === 0 && <EmptyState>No hay solicitudes de compra todavía.</EmptyState>}
      </div>

      {puedeEditar && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Nueva solicitud de compra</summary>
          <Card className="mt-3">
            <form action={crearSolicitudAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Comisión solicitante</Label><input name="comision" required className={inputClass} placeholder="Comisión de Obra" /></div>
              <div><Label>Material</Label><input name="material" required className={inputClass} /></div>
              <div><Label>Cantidad</Label><input name="cantidad" type="number" step="0.01" required className={inputClass} /></div>
              <div><Label>Unidad</Label><input name="unidad" required className={inputClass} placeholder="kg, unidad, m2…" /></div>
              <div className="sm:col-span-2"><Label>Especificación</Label><input name="especificacion" className={inputClass} /></div>
              <div><Label>Etapa de obra</Label><input name="etapa_obra" className={inputClass} /></div>
              <div><Label>Fecha necesaria</Label><input type="date" name="fecha_necesaria" className={inputClass} /></div>
              <div>
                <Label>Prioridad</Label>
                <select name="prioridad" className={inputClass} defaultValue="media">
                  <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option>
                </select>
              </div>
              <div><Label>Presupuesto estimado</Label><input name="presupuesto_estimado" type="number" className={inputClass} /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Crear solicitud</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
