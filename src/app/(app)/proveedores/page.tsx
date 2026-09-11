import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Label, inputClass, Badge } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import dayjs from "dayjs";
import { crearProveedorAction, cambiarEstadoProveedorAction } from "@/lib/actions/proveedores";
import { ESTADO_PROVEEDOR, ESTADO_PROVEEDOR_LABEL, TIPO_PROVEEDOR_LABEL } from "@/lib/constants";

/**
 * Fase 08 del Plan Maestro ("ficha de Proveedores independiente"), ampliada
 * ahora para diferenciar proveedores fijos/habituales de nuevos/a
 * presupuestar (pedido explícito, sección 2). Usa el mismo permiso que
 * Compras (mod "compras"): quien puede gestionar compras gestiona también
 * proveedores, no es un módulo nuevo.
 *
 * Pestañas: en vez de una tabla única, se filtra por "estado" (columna ya
 * existente, ver migrations/0018_proveedores_extendido.sql) — "Activos" es
 * una pestaña sintética (cualquier estado que no sea "inactivo") para que la
 * vista por defecto no mezcle proveedores dados de baja con el resto.
 */
const ESTADO_COLOR: Record<string, "verde" | "amarillo" | "brand" | "gray"> = {
  nuevo: "amarillo",
  habitual: "verde",
  en_evaluacion: "brand",
  inactivo: "gray",
};

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "compras");
  const { tab } = await searchParams;
  const tabActiva = tab && (ESTADO_PROVEEDOR as readonly string[]).includes(tab) ? tab : "activos";

  const proveedoresTodos = await all<any>(`
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

  const proveedores = tabActiva === "activos"
    ? proveedoresTodos.filter((p) => (p.estado || "nuevo") !== "inactivo")
    : proveedoresTodos.filter((p) => (p.estado || "nuevo") === tabActiva);

  const TABS: { id: string; label: string }[] = [
    { id: "activos", label: "Activos" },
    ...ESTADO_PROVEEDOR.map((e) => ({ id: e, label: ESTADO_PROVEEDOR_LABEL[e] })),
  ];

  return (
    <div>
      <PageHeader
        title="Proveedores"
        subtitle="Contactos y a quién se le compró"
        action={
          <Link href="/compras" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap">
            ← Volver a Compras
          </Link>
        }
      />

      <div className="flex flex-wrap gap-1.5 mb-4">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "activos" ? "/proveedores" : `/proveedores?tab=${t.id}`}
            className={`text-xs rounded-full px-3 py-1.5 font-medium ${
              tabActiva === t.id ? "bg-[var(--color-brand-800)] text-white" : "bg-ink/5 text-ink/60 hover:bg-ink/10"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">Rubro</th>
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3 text-right">Compras</th>
                <th className="py-2 pr-3 text-right">Total comprado</th>
                <th className="py-2 pr-3">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.id} className="border-b border-ink/5 last:border-0">
                  <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">
                    <Link href={`/proveedores/${p.id}`} className="hover:underline underline-offset-2">{p.nombre}</Link>
                  </td>
                  <td className="py-2 pr-3 text-ink/60">{p.rubro || "—"}</td>
                  <td className="py-2 pr-3 text-ink/60">{p.telefono || p.email || p.contacto || "—"}</td>
                  <td className="py-2 pr-3">
                    {puedeEditar ? (
                      <AutoSubmitSelect
                        action={cambiarEstadoProveedorAction}
                        hiddenFields={{ id: p.id }}
                        name="estado"
                        defaultValue={p.estado || "nuevo"}
                        options={ESTADO_PROVEEDOR.map((e) => ({ value: e, label: ESTADO_PROVEEDOR_LABEL[e] }))}
                        className="rounded-md border border-ink/10 bg-surface px-1.5 py-1 text-xs whitespace-nowrap"
                      />
                    ) : (
                      <Badge color={ESTADO_COLOR[(p.estado || "nuevo") as (typeof ESTADO_PROVEEDOR)[number]]}>
                        {ESTADO_PROVEEDOR_LABEL[(p.estado || "nuevo") as (typeof ESTADO_PROVEEDOR)[number]]}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{p.compras_realizadas}</td>
                  <td className="py-2 pr-3 text-right font-medium">{Number(p.total_comprado) > 0 ? `$${Number(p.total_comprado).toLocaleString("es-UY")}` : "—"}</td>
                  <td className="py-2 pr-3 text-ink/60">{p.ultima_compra ? dayjs(p.ultima_compra).format("DD/MM/YYYY") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {proveedores.length === 0 && <EmptyState>No hay proveedores en esta pestaña.</EmptyState>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Agregar proveedor</summary>
            <form action={crearProveedorAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Nombre / razón social</Label><input name="nombre" required className={inputClass} /></div>
              <div><Label>RUT</Label><input name="rut" className={inputClass} /></div>
              <div><Label>Rubro</Label><input name="rubro" placeholder="Materiales, ferretería, electricidad…" className={inputClass} /></div>
              <div>
                <Label>Tipo</Label>
                <select name="tipo" className={inputClass} defaultValue="empresa">
                  {Object.entries(TIPO_PROVEEDOR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div><Label>Teléfono</Label><input name="telefono" className={inputClass} /></div>
              <div><Label>Email</Label><input type="email" name="email" className={inputClass} /></div>
              <div><Label>Dirección</Label><input name="direccion" className={inputClass} /></div>
              <div><Label>Persona de contacto</Label><input name="persona_contacto" className={inputClass} /></div>
              <div>
                <Label>Estado</Label>
                <select name="estado" className={inputClass} defaultValue="nuevo">
                  {ESTADO_PROVEEDOR.map((e) => <option key={e} value={e}>{ESTADO_PROVEEDOR_LABEL[e]}</option>)}
                </select>
              </div>
              <div><Label>Contacto (libre)</Label><input name="contacto" placeholder="Teléfono o email, si no encaja arriba" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Agregar proveedor</button>
              </div>
            </form>
          </details>
        )}
      </Card>
    </div>
  );
}
