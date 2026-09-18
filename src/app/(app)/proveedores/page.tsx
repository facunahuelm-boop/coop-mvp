import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import dayjs from "dayjs";
import { cambiarEstadoProveedorFormAction } from "@/lib/actions/proveedores";
import { ESTADO_PROVEEDOR, ESTADO_PROVEEDOR_LABEL, TIPO_PROVEEDOR, TIPO_PROVEEDOR_LABEL } from "@/lib/constants";
import { CrearProveedorForm } from "@/components/proveedores/ProveedoresFormularios";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle, EstadoBadge } from "@/components/FilaConDetalle";

/**
 * Fase 08 del Plan Maestro ("ficha de Proveedores independiente"), ampliada
 * para diferenciar proveedores fijos/habituales de nuevos/a presupuestar.
 * Usa el mismo permiso que Compras (mod "compras").
 *
 * Rediseño (18/09, pedido explícito con referencia visual de ERP): la vieja
 * fila de pestañas por estado se reemplaza por la barra compacta de
 * búsqueda+filtros de TablaFiltrable — Estado pasa a ser un filtro más (con
 * Categoría/Rubro), en vez de una navegación de servidor aparte. Como
 * consecuencia, ya no se oculta "inactivo" por defecto (antes la pestaña
 * "Activos" lo hacía): ahora se ve todo y el badge de Estado alcanza para
 * distinguirlos — más transparente, nada de información se pierde, y evita
 * mantener dos mecanismos de filtro superpuestos (pestañas + filtros).
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

  const rubros = Array.from(new Set(proveedores.map((p) => p.rubro).filter(Boolean))).sort();

  const filtros: FiltroDef[] = [
    {
      id: "rubro",
      label: "Rubro",
      opciones: rubros.map((r) => ({ value: r, label: r })),
      valores: proveedores.map((p) => p.rubro || ""),
    },
    {
      id: "estado",
      label: "Estado",
      opciones: ESTADO_PROVEEDOR.map((e) => ({ value: e, label: ESTADO_PROVEEDOR_LABEL[e] })),
      valores: proveedores.map((p) => p.estado || "nuevo"),
    },
    {
      id: "tipo",
      label: "Tipo de proveedor",
      opciones: TIPO_PROVEEDOR.map((t) => ({ value: t, label: TIPO_PROVEEDOR_LABEL[t] })),
      valores: proveedores.map((p) => p.tipo || "empresa"),
      secundario: true,
    },
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

      <Card>
        {proveedores.length === 0 ? (
          <EmptyState>No hay proveedores registrados todavía.</EmptyState>
        ) : (
          <TablaFiltrable
            placeholder="Buscar por nombre, rubro, RUT, teléfono o email..."
            claves={proveedores.map((p) =>
              [p.nombre, p.rubro, p.telefono, p.email, p.contacto, p.rut, p.persona_contacto].filter(Boolean).join(" ")
            )}
            filtros={filtros}
            encabezado={
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Proveedor</th>
                <th className="py-2 pr-3">Rubro</th>
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3 text-right">Compras</th>
                <th className="py-2 pr-3 text-right">Total comprado</th>
                <th className="py-2 pr-3">Última compra</th>
                <th className="py-2 pr-3"></th>
              </tr>
            }
          >
            {proveedores.map((p) => (
              <FilaConDetalle
                key={p.id}
                titulo={p.nombre}
                subtitulo={p.rubro || TIPO_PROVEEDOR_LABEL[(p.tipo || "empresa") as (typeof TIPO_PROVEEDOR)[number]]}
                editarHref={`/proveedores/${p.id}`}
                secciones={[
                  {
                    titulo: "Contacto",
                    items: [
                      { label: "Persona de contacto", valor: p.persona_contacto || p.contacto || "—" },
                      { label: "Teléfono", valor: p.telefono || "—" },
                      { label: "Email", valor: p.email || "—" },
                      { label: "RUT", valor: p.rut || "—" },
                      { label: "Dirección", valor: p.direccion || "—" },
                    ],
                  },
                  {
                    titulo: "Compras",
                    items: [
                      { label: "Tipo", valor: TIPO_PROVEEDOR_LABEL[(p.tipo || "empresa") as (typeof TIPO_PROVEEDOR)[number]] },
                      { label: "Estado", valor: <EstadoBadge estado={p.estado || "nuevo"} label={ESTADO_PROVEEDOR_LABEL[(p.estado || "nuevo") as (typeof ESTADO_PROVEEDOR)[number]]} /> },
                      { label: "Compras realizadas", valor: p.compras_realizadas },
                      { label: "Total comprado", valor: Number(p.total_comprado) > 0 ? `$${Number(p.total_comprado).toLocaleString("es-UY")}` : "—" },
                      { label: "Última compra", valor: p.ultima_compra ? dayjs(p.ultima_compra).format("DD/MM/YYYY") : "—" },
                    ],
                  },
                ]}
              >
                <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">
                  <Link href={`/proveedores/${p.id}`} className="hover:underline underline-offset-2" data-no-row-click>
                    {p.nombre}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-ink/60">{p.rubro || "—"}</td>
                <td className="py-2 pr-3 text-ink/60">{p.telefono || p.email || p.contacto || "—"}</td>
                <td className="py-2 pr-3">
                  {puedeEditar ? (
                    <AutoSubmitSelect
                      action={cambiarEstadoProveedorFormAction}
                      hiddenFields={{ id: p.id }}
                      name="estado"
                      defaultValue={p.estado || "nuevo"}
                      options={ESTADO_PROVEEDOR.map((e) => ({ value: e, label: ESTADO_PROVEEDOR_LABEL[e] }))}
                      className="rounded-md border border-ink/10 bg-surface px-1.5 py-1 text-xs whitespace-nowrap"
                    />
                  ) : (
                    <EstadoBadge estado={p.estado || "nuevo"} label={ESTADO_PROVEEDOR_LABEL[(p.estado || "nuevo") as (typeof ESTADO_PROVEEDOR)[number]]} />
                  )}
                </td>
                <td className="py-2 pr-3 text-right">{p.compras_realizadas}</td>
                <td className="py-2 pr-3 text-right font-medium">{Number(p.total_comprado) > 0 ? `$${Number(p.total_comprado).toLocaleString("es-UY")}` : "—"}</td>
                <td className="py-2 pr-3 text-ink/60">{p.ultima_compra ? dayjs(p.ultima_compra).format("DD/MM/YYYY") : "—"}</td>
              </FilaConDetalle>
            ))}
          </TablaFiltrable>
        )}

        {puedeEditar && <CrearProveedorForm />}
      </Card>
    </div>
  );
}
