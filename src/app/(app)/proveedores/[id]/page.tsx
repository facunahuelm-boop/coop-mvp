import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get } from "@/lib/db";
import { historialProveedor } from "@/lib/logic";
import { Card, PageHeader, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { actualizarProveedorAction } from "@/lib/actions/proveedores";

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

  return (
    <div>
      <PageHeader title={proveedor.nombre} subtitle={proveedor.rubro || "Proveedor"} />

      <Link href="/proveedores" className="text-xs text-[#1f4e5f] underline underline-offset-2">
        ← Volver a proveedores
      </Link>

      <Card className="mt-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-black/50">Contacto:</span> {proveedor.contacto || "—"}</div>
          <div><span className="text-black/50">Rubro:</span> {proveedor.rubro || "—"}</div>
          {proveedor.notas && <div className="sm:col-span-2"><span className="text-black/50">Notas:</span> {proveedor.notas}</div>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-[#1f4e5f]">Editar datos de contacto</summary>
            <form action={actualizarProveedorAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="id" value={proveedor.id} />
              <div><Label>Contacto</Label><input name="contacto" defaultValue={proveedor.contacto || ""} placeholder="Teléfono o email" className={inputClass} /></div>
              <div><Label>Rubro</Label><input name="rubro" defaultValue={proveedor.rubro || ""} className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" defaultValue={proveedor.notas || ""} className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Guardar</button>
              </div>
            </form>
          </details>
        )}
      </Card>

      <Card className="mb-4 flex items-center justify-between">
        <span className="text-sm text-black/60">Total comprado a este proveedor</span>
        <span className="text-2xl font-bold text-[#123240]">
          {totalComprado > 0 ? `$${totalComprado.toLocaleString("es-UY")}` : "—"}
        </span>
      </Card>

      <h3 className="text-sm font-bold text-[#123240] mb-2">Historial de compras</h3>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Material</th>
                <th className="py-2 pr-3 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h: any, i: number) => (
                <tr key={i} className="border-b border-black/5 last:border-0">
                  <td className="py-2 pr-3">{dayjs(h.fecha).format("DD/MM/YYYY")}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/compras/${h.solicitud_id}`} className="text-[#123240] hover:underline underline-offset-2">{h.material}</Link>
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
