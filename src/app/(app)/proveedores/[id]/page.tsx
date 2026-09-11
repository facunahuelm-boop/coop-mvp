import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get } from "@/lib/db";
import { historialProveedor } from "@/lib/logic";
import { Card, PageHeader, EmptyState, Label, inputClass, Badge } from "@/components/ui";
import dayjs from "dayjs";
import { actualizarProveedorAction } from "@/lib/actions/proveedores";
import { ESTADO_PROVEEDOR, ESTADO_PROVEEDOR_LABEL, TIPO_PROVEEDOR, TIPO_PROVEEDOR_LABEL } from "@/lib/constants";

const ESTADO_COLOR: Record<string, "verde" | "amarillo" | "brand" | "gray"> = {
  nuevo: "amarillo", habitual: "verde", en_evaluacion: "brand", inactivo: "gray",
};

/**
 * Ficha de proveedor (Fase 08 del Plan Maestro). historialProveedor() ya
 * existía en lib/logic.ts —incluso el asistente de IA ya la usa para
 * responder "¿a quién le compramos X?" y cita como fuente "Ficha de
 * proveedor"— pero hasta esta pantalla esa fuente no tenía adónde apuntar.
 */
export default async function ProveedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const proveedor = await get<any>(`SELECT * FROM proveedores WHERE id = ?`, [id]);
  if (!proveedor) notFound();
  const puedeEditar = canEdit(user.rol, "compras");

  const historial = await historialProveedor(Number(id));
  const totalComprado = historial.reduce((acc: number, h: any) => acc + Number(h.monto || 0), 0);
  const estadoProveedor = (proveedor.estado || "nuevo") as (typeof ESTADO_PROVEEDOR)[number];

  return (
    <div>
      <PageHeader
        title={proveedor.nombre}
        subtitle={proveedor.rubro || "Proveedor"}
        action={<Badge color={ESTADO_COLOR[estadoProveedor]}>{ESTADO_PROVEEDOR_LABEL[estadoProveedor]}</Badge>}
      />

      <Link href="/proveedores" className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">
        ← Volver a proveedores
      </Link>

      <Card className="mt-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-ink/50">RUT:</span> {proveedor.rut || "—"}</div>
          <div><span className="text-ink/50">Tipo:</span> {TIPO_PROVEEDOR_LABEL[proveedor.tipo as typeof TIPO_PROVEEDOR[number]] || "—"}</div>
          <div><span className="text-ink/50">Teléfono:</span> {proveedor.telefono || "—"}</div>
          <div><span className="text-ink/50">Email:</span> {proveedor.email || "—"}</div>
          <div><span className="text-ink/50">Dirección:</span> {proveedor.direccion || "—"}</div>
          <div><span className="text-ink/50">Persona de contacto:</span> {proveedor.persona_contacto || "—"}</div>
          <div><span className="text-ink/50">Contacto:</span> {proveedor.contacto || "—"}</div>
          <div><span className="text-ink/50">Rubro:</span> {proveedor.rubro || "—"}</div>
          <div><span className="text-ink/50">Alta:</span> {proveedor.creado_en ? dayjs(proveedor.creado_en).format("DD/MM/YYYY") : "—"}</div>
          {proveedor.notas && <div className="sm:col-span-2"><span className="text-ink/50">Notas:</span> {proveedor.notas}</div>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-brand-800)]">Editar ficha</summary>
            <form action={actualizarProveedorAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="id" value={proveedor.id} />
              <div><Label>RUT</Label><input name="rut" defaultValue={proveedor.rut || ""} className={inputClass} /></div>
              <div><Label>Rubro</Label><input name="rubro" defaultValue={proveedor.rubro || ""} className={inputClass} /></div>
              <div>
                <Label>Tipo</Label>
                <select name="tipo" defaultValue={proveedor.tipo || "empresa"} className={inputClass}>
                  {TIPO_PROVEEDOR.map((t) => <option key={t} value={t}>{TIPO_PROVEEDOR_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <Label>Estado</Label>
                <select name="estado" defaultValue={proveedor.estado || "nuevo"} className={inputClass}>
                  {ESTADO_PROVEEDOR.map((e) => <option key={e} value={e}>{ESTADO_PROVEEDOR_LABEL[e]}</option>)}
                </select>
              </div>
              <div><Label>Teléfono</Label><input name="telefono" defaultValue={proveedor.telefono || ""} className={inputClass} /></div>
              <div><Label>Email</Label><input type="email" name="email" defaultValue={proveedor.email || ""} className={inputClass} /></div>
              <div><Label>Dirección</Label><input name="direccion" defaultValue={proveedor.direccion || ""} className={inputClass} /></div>
              <div><Label>Persona de contacto</Label><input name="persona_contacto" defaultValue={proveedor.persona_contacto || ""} className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Contacto (libre)</Label><input name="contacto" defaultValue={proveedor.contacto || ""} placeholder="Teléfono o email" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" defaultValue={proveedor.notas || ""} className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Guardar</button>
              </div>
            </form>
          </details>
        )}
      </Card>

      <Card className="mb-4 flex items-center justify-between">
        <span className="text-sm text-ink/60">Total comprado a este proveedor</span>
        <span className="text-2xl font-bold text-[var(--color-brand-900)]">
          {totalComprado > 0 ? `$${totalComprado.toLocaleString("es-UY")}` : "—"}
        </span>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Historial de compras</h3>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Material</th>
                <th className="py-2 pr-3 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h: any, i: number) => (
                <tr key={i} className="border-b border-ink/5 last:border-0">
                  <td className="py-2 pr-3">{dayjs(h.fecha).format("DD/MM/YYYY")}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/compras/${h.solicitud_id}`} className="text-[var(--color-brand-900)] hover:underline underline-offset-2">{h.material}</Link>
                  </td>
                  <td className="py-2 pr-3 text-right font-medium">${Number(h.monto || 0).toLocaleString("es-UY")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {historial.length === 0 && <EmptyState>Todavía no se le compró nada a este proveedor.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
