import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import Link from "next/link";
import dayjs from "dayjs";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import { CrearSolicitudForm } from "@/components/compras/ComprasFormularios";
import { SolicitudStatusBadge, PrioridadBadge, ESTADO_SOLICITUD_COMPRA, estadoSolicitudLabel } from "@/components/compras/PurchaseStatus";
import { ResumenCompras, type ResumenTileDef, type ResumenTileItem } from "@/components/compras/ResumenCompras";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";

const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-UY")}`;

/**
 * Rediseño de Compras (18/09, pedido explícito: "que hagas lo mismo que
 * hicimos con los proveedores... el resumen que sea un cuadrado chiquito
 * con un pop-up... la parte de solicitudes que no sea todo un renglón
 * largo"). Mismo patrón visual que Contactos/Proveedores/Núcleos:
 *
 * - Resumen: los mismos 5 StatTiles de siempre, pero ahora son botones que
 *   abren un modal con el detalle real detrás del número (ResumenCompras.tsx
 *   — patrón RESUMEN → CLICK → POP-UP, igual que el Dashboard).
 * - Filtros: se reemplaza el <form method="GET"> (recargaba la página en
 *   cada filtro) por la barra compacta de TablaFiltrable — Estado principal,
 *   Categoría y Comisión en "Más filtros" — 100% cliente, mismo criterio que
 *   Proveedores. Como consecuencia, ya no hay URL bookmarkeable por filtro
 *   (?estado=...), igual que se aceptó para Proveedores: se prioriza una
 *   sola forma de filtrar en todo el sistema en vez de dos superpuestas.
 * - Solicitudes: la vieja tarjeta ancha por solicitud (un "renglón largo")
 *   se reemplaza por una fila de tabla compacta + modal de detalle
 *   (FilaConDetalle) que linkea a la ficha completa /compras/[id] YA
 *   EXISTENTE (con sus pestañas Información/Presupuestos/Documentos/
 *   Historial) — el modal es un resumen, no reemplaza esa pantalla.
 *
 * Como ya no hay WHERE por estado/categoría/comisión en el servidor, el
 * "resumen sobre el total" (antes una consulta GROUP BY aparte) se calcula
 * directo sobre el array ya traído completo — misma cifra de siempre, una
 * consulta menos. Cero cambios de permisos, de lógica de negocio (crear/
 * editar/decidir una solicitud) ni de los datos que se muestran.
 */
export default async function ComprasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "compras");
  const esOversightFinanzas = canEdit(user.rol, "finanzas");

  const desdeMes = dayjs().startOf("month").format("YYYY-MM-DD");
  const hastaMes = dayjs().endOf("month").format("YYYY-MM-DD");

  const [solicitudes, comisionesActivas, misComisiones, gastoPorCategoriaMes] = await Promise.all([
    all<any>(
      `SELECT sc.*, u.nombre as solicitante_nombre, c.nombre as comision_vinculada
       FROM solicitudes_compra sc
       LEFT JOIN users u ON u.id = sc.solicitante_id
       LEFT JOIN comisiones c ON c.id = sc.comision_id
       ORDER BY CASE prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC`
    ).catch(() =>
      all<any>(
        `SELECT sc.*, u.nombre as solicitante_nombre, NULL as comision_vinculada
         FROM solicitudes_compra sc
         LEFT JOIN users u ON u.id = sc.solicitante_id
         ORDER BY CASE prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC`
      )
    ),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`).catch(() => []),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]).catch(() => []),
    all<{ categoria: string; total: string }>(
      `SELECT sc.categoria, COALESCE(SUM(dc.monto), 0) as total
       FROM decisiones_compra dc
       JOIN solicitudes_compra sc ON sc.id = dc.solicitud_id
       WHERE dc.fecha >= ? AND dc.fecha <= ?
       GROUP BY sc.categoria
       ORDER BY total DESC`,
      [desdeMes, hastaMes]
    ).catch(() => []),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));
  const comisiones = esOversightFinanzas ? comisionesActivas : comisionesActivas.filter((c) => misComisionIds.has(c.id));

  const pendientesArr = solicitudes.filter((s) => s.estado === "pendiente_cotizacion");
  const cotizandoArr = solicitudes.filter((s) => s.estado === "en_comparacion");
  const aprobadasArr = solicitudes.filter((s) => s.estado === "aprobada" || s.estado === "pedida");
  const entregadasArr = solicitudes.filter((s) => s.estado === "entregada");
  const gastoMesTotal = gastoPorCategoriaMes.reduce((acc, r) => acc + Number(r.total || 0), 0);

  const itemDeSolicitud = (s: any): ResumenTileItem => ({
    label: s.material,
    sublabel: `${s.comision_vinculada || s.comision || "Sin comisión"} · ${dayjs(s.creado_en).format("DD/MM")}`,
    href: `/compras/${s.id}`,
  });

  const tiles: ResumenTileDef[] = [
    {
      id: "pendientes",
      label: "Pendientes",
      value: String(pendientesArr.length),
      color: pendientesArr.length > 0 ? "amarillo" : "verde",
      items: pendientesArr.map(itemDeSolicitud),
      vacioTexto: "No hay solicitudes pendientes de cotización.",
    },
    {
      id: "cotizando",
      label: "Cotizando",
      value: String(cotizandoArr.length),
      items: cotizandoArr.map(itemDeSolicitud),
      vacioTexto: "No hay solicitudes en comparación de presupuestos.",
    },
    {
      id: "aprobadas",
      label: "Aprobadas",
      value: String(aprobadasArr.length),
      color: "verde",
      items: aprobadasArr.map(itemDeSolicitud),
      vacioTexto: "No hay solicitudes aprobadas o pedidas todavía.",
    },
    {
      id: "entregadas",
      label: "Entregadas",
      value: String(entregadasArr.length),
      items: entregadasArr.map(itemDeSolicitud),
      vacioTexto: "No hay solicitudes entregadas todavía.",
    },
    {
      id: "gasto_mes",
      label: "Gastado este mes",
      value: money(gastoMesTotal),
      items: gastoPorCategoriaMes
        .filter((r) => Number(r.total) > 0)
        .map((r) => ({ label: CATEGORIA_COMPRA_LABEL[r.categoria] || r.categoria, sublabel: money(Number(r.total)) })),
      vacioTexto: "Todavía no hay compras aprobadas este mes.",
    },
  ];

  const filtros: FiltroDef[] = [
    {
      id: "estado",
      label: "Estado",
      opciones: ESTADO_SOLICITUD_COMPRA.map((e) => ({ value: e, label: estadoSolicitudLabel(e) })),
      valores: solicitudes.map((s) => s.estado),
    },
    {
      id: "categoria",
      label: "Categoría",
      opciones: Object.entries(CATEGORIA_COMPRA_LABEL).map(([v, l]) => ({ value: v, label: l })),
      valores: solicitudes.map((s) => s.categoria || "obra"),
      secundario: true,
    },
    {
      id: "comision",
      label: "Comisión",
      opciones: comisiones.map((c) => ({ value: String(c.id), label: c.nombre })),
      valores: solicitudes.map((s) => (s.comision_id ? String(s.comision_id) : "")),
      secundario: true,
    },
  ];

  const claves = solicitudes.map(
    (s) =>
      `${s.material} ${s.especificacion || ""} ${CATEGORIA_COMPRA_LABEL[s.categoria] || ""} ${s.subcategoria || ""} ${s.comision_vinculada || s.comision || ""} ${s.solicitante_nombre || ""}`
  );

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Solicitudes y presupuestos"
        action={
          <div className="flex items-center gap-3">
            {puedeEditar && <CrearSolicitudForm comisiones={comisiones} />}
            <Link href="/proveedores" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap">
              Ver proveedores →
            </Link>
          </div>
        }
      />

      <ResumenCompras tiles={tiles} />

      <Card>
        {solicitudes.length === 0 ? (
          <EmptyState>No hay solicitudes de compra todavía.</EmptyState>
        ) : (
          <TablaFiltrable
            placeholder="Buscar por material, categoría, comisión…"
            claves={claves}
            filtros={filtros}
            encabezado={
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Material</th>
                <th className="py-2 pr-3">Categoría</th>
                <th className="py-2 pr-3">Comisión</th>
                <th className="py-2 pr-3">Solicitante</th>
                <th className="py-2 pr-3">Prioridad</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3"></th>
              </tr>
            }
          >
            {solicitudes.map((s) => (
              <FilaConDetalle
                key={s.id}
                titulo={s.material}
                subtitulo={`${s.cantidad} ${s.unidad}${s.subcategoria ? ` · ${s.subcategoria}` : ""}`}
                editarHref={`/compras/${s.id}`}
                secciones={[
                  {
                    titulo: "Detalle de la solicitud",
                    items: [
                      { label: "Cantidad", valor: `${s.cantidad} ${s.unidad}` },
                      { label: "Especificación", valor: s.especificacion || "—" },
                      {
                        label: "Categoría",
                        valor: `${CATEGORIA_COMPRA_LABEL[s.categoria] || CATEGORIA_COMPRA_LABEL.obra}${s.subcategoria ? ` (${s.subcategoria})` : ""}`,
                      },
                      { label: "Etapa de obra", valor: s.etapa_obra || "—" },
                      { label: "Fecha necesaria", valor: s.fecha_necesaria ? dayjs(s.fecha_necesaria).format("DD/MM/YYYY") : "—" },
                      { label: "Presupuesto estimado", valor: s.presupuesto_estimado ? money(Number(s.presupuesto_estimado)) : "—" },
                      { label: "Recurrente", valor: s.recurrente ? "🔁 Sí" : "No" },
                    ],
                  },
                  {
                    titulo: "Gestión",
                    items: [
                      { label: "Comisión", valor: s.comision_vinculada || s.comision || "—" },
                      { label: "Solicitante", valor: s.solicitante_nombre || "—" },
                      { label: "Prioridad", valor: <PrioridadBadge prioridad={s.prioridad} /> },
                      { label: "Estado", valor: <SolicitudStatusBadge estado={s.estado} /> },
                    ],
                  },
                ]}
              >
                <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">
                  {s.material} <span className="font-normal text-ink/50">({s.cantidad} {s.unidad})</span>
                </td>
                <td className="py-2 pr-3 text-ink/60">{CATEGORIA_COMPRA_LABEL[s.categoria] || CATEGORIA_COMPRA_LABEL.obra}</td>
                <td className="py-2 pr-3 text-ink/60">{s.comision_vinculada || s.comision || "—"}</td>
                <td className="py-2 pr-3 text-ink/60">{s.solicitante_nombre || "—"}</td>
                <td className="py-2 pr-3">
                  <PrioridadBadge prioridad={s.prioridad} />
                </td>
                <td className="py-2 pr-3">
                  <SolicitudStatusBadge estado={s.estado} />
                </td>
              </FilaConDetalle>
            ))}
          </TablaFiltrable>
        )}
      </Card>
    </div>
  );
}
