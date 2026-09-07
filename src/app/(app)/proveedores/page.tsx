import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { crearProveedorAction } from "@/lib/actions/proveedores";

/**
 * Fase 08 del Plan Maestro ("ficha de Proveedores independiente"): antes de
 * esto, un proveedor solo existía como una fila más al costado de una
 * solicitud de compra (dentro de /compras/[id], al cargar un presupuesto) —
 * no había ninguna pantalla que mostrara, por proveedor, cuánto se le compró
 * en total ni su historial. Usa el mismo permiso que Compras (mod
 * "compras"): quien puede gestionar compras gestiona también proveedores,
 * no es un módulo nuevo — es la ficha que faltaba para uno que ya existía.
 */
export default async function ProveedoresPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "compras");

  const proveedores = await all<any>(`
    SELECT pv.*,
      COUNT(DISTINCT dc.id) as compras_realizadas,
      COALESCE(SUM(dc.monto), 0) as total_comprado,
      MAX(dc.fecha) as ultima_compra
    FROM proveedores pv
    LEFT JOIN presupuestos_proveedor pp ON pp.proveedor_id = pv.id
    LEFT JOIN decisiones_compra dc ON dc.presupuesto_id = pp.id
    GROUP BY pv.id
    ORDER BY pv.nombre ASC
  `);

  return (
    <div>
      <PageHeader
        title="Proveedores"
        subtitle="Contactos y a quién se le compró"
        action={
          <Link href="/compras" className="text-xs font-semibold text-[#1f4e5f] underline underline-offset-2 whitespace-nowrap">
            ← Volver a Compras
          </Link>
        }
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">Rubro</th>
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3 text-right">Compras</th>
                <th className="py-2 pr-3 text-right">Total comprado</th>
                <th className="py-2 pr-3">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.id} className="border-b border-black/5 last:border-0">
                  <td className="py-2 pr-3 font-medium text-[#123240]">
                    <Link href={`/proveedores/${p.id}`} className="hover:underline underline-offset-2">{p.nombre}</Link>
                  </td>
                  <td className="py-2 pr-3 text-black/60">{p.rubro || "—"}</td>
                  <td className="py-2 pr-3 text-black/60">{p.contacto || "—"}</td>
                  <td className="py-2 pr-3 text-right">{p.compras_realizadas}</td>
                  <td className="py-2 pr-3 text-right font-medium">{Number(p.total_comprado) > 0 ? `$${Number(p.total_comprado).toLocaleString("es-UY")}` : "—"}</td>
                  <td className="py-2 pr-3 text-black/60">{p.ultima_compra ? dayjs(p.ultima_compra).format("DD/MM/YYYY") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {proveedores.length === 0 && <EmptyState>Todavía no hay proveedores cargados.</EmptyState>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Agregar proveedor</summary>
            <form action={crearProveedorAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Nombre</Label><input name="nombre" required className={inputClass} /></div>
              <div><Label>Rubro</Label><input name="rubro" placeholder="Materiales, ferretería, electricidad…" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Contacto</Label><input name="contacto" placeholder="Teléfono o email" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Agregar proveedor</button>
              </div>
            </form>
          </details>
        )}
      </Card>
    </div>
  );
}
