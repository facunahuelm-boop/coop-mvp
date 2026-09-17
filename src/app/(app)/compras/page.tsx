import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, SectionTitle, Badge, EmptyState, Label, inputClass, StatTile } from "@/components/ui";
import Link from "next/link";
import dayjs from "dayjs";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import { CrearSolicitudForm } from "@/components/compras/ComprasFormularios";
import { SolicitudStatusBadge } from "@/components/compras/PurchaseStatus";
import { BuscadorLista } from "@/components/BuscadorFilas";

const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-UY")}`;

type Filtros = { estado?: string; categoria?: string; comision_id?: string };

// Rediseño profundo de Compras, Fase 2 (pedido explícito, secciones 4, 23-26:
// "pantalla principal compacta, resumen + acciones rápidas + búsqueda +
// filtros, patrón RESUMEN → DETALLE → MODAL, nunca página larga con scroll
// interminable"). Se agrega acá, sin tocar la lógica de negocio de Compras
// (Fase 1 ya cerrada): un resumen de 5 StatTiles (mismo componente que ya usa
// /gastos), filtros compactos por estado/categoría/comisión vía GET (mismo
// patrón de /gastos: querystring + "Limpiar filtros"), y BuscadorLista (Fase
// 2, recién creado en BuscadorFilas.tsx) para búsqueda instantánea del lado
// del cliente sobre la lista ya filtrada por el servidor. "Nueva solicitud"
// pasa de estar al pie de la lista a la cabecera (ya es un botón que abre un
// Modal, no navega — ComprasFormularios.tsx, misma Fase 2), junto al link a
// proveedores, para que las acciones más usadas queden arriba de todo.
export default async function ComprasPage({ searchParams }: { searchParams: Promise<Filtros> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "compras");
  const esOversightFinanzas = canEdit(user.rol, "finanzas");
  const f = await searchParams;

  // Igual que en el listado original: dos variantes de condiciones/params,
  // una con el filtro por comisión vinculada (columna de la migración 0020) y
  // otra sin él — si esa columna todavía no existe en esta base, el filtro
  // por comisión simplemente no se aplica en vez de romper toda la pantalla
  // (mismo criterio defensivo que ya usaba este archivo para el SELECT).
  const condicionesBase: string[] = [];
  const paramsBase: any[] = [];
  if (f.estado) { condicionesBase.push("sc.estado = ?"); paramsBase.push(f.estado); }
  if (f.categoria) { condicionesBase.push("sc.categoria = ?"); paramsBase.push(f.categoria); }
  const condicionesConComision = [...condicionesBase];
  const paramsConComision = [...paramsBase];
  if (f.comision_id) { condicionesConComision.push("sc.comision_id = ?"); paramsConComision.push(Number(f.comision_id)); }
  const whereConComision = condicionesConComision.length ? `WHERE ${condicionesConComision.join(" AND ")}` : "";
  const whereSinComision = condicionesBase.length ? `WHERE ${condicionesBase.join(" AND ")}` : "";

  const solicitudesConComisionId = `SELECT sc.*, u.nombre as solicitante_nombre, c.nombre as comision_vinculada FROM solicitudes_compra sc LEFT JOIN users u ON u.id = sc.solicitante_id LEFT JOIN comisiones c ON c.id = sc.comision_id ${whereConComision} ORDER BY CASE prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC`;
  const solicitudesSinComisionId = `SELECT sc.*, u.nombre as solicitante_nombre, NULL as comision_vinculada FROM solicitudes_compra sc LEFT JOIN users u ON u.id = sc.solicitante_id ${whereSinComision} ORDER BY CASE prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC`;

  const desdeMes = dayjs().startOf("month").format("YYYY-MM-DD");
  const hastaMes = dayjs().endOf("month").format("YYYY-MM-DD");

  const [solicitudes, comisionesActivas, misComisiones, resumenPorEstado, gastoMes] = await Promise.all([
    all<any>(solicitudesConComisionId, paramsConComision).catch(() => all<any>(solicitudesSinComisionId, paramsBase)),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`).catch(() => []),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]).catch(() => []),
    // Resumen SIEMPRE sobre el total (no sobre lo filtrado): mismo criterio
    // que "Por comisión" en /gastos, que tampoco cambia según los filtros del
    // detalle de abajo — el resumen responde "cómo viene el mes", el detalle
    // "qué quiero ver ahora".
    all<{ estado: string; cantidad: string }>(`SELECT estado, COUNT(*) as cantidad FROM solicitudes_compra GROUP BY estado`).catch(() => []),
    get<{ total: string }>(`SELECT COALESCE(SUM(monto), 0) as total FROM decisiones_compra WHERE fecha >= ? AND fecha <= ?`, [desdeMes, hastaMes]).catch(() => null),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));
  const comisiones = esOversightFinanzas ? comisionesActivas : comisionesActivas.filter((c) => misComisionIds.has(c.id));

  const cuentaPorEstado: Record<string, number> = {};
  resumenPorEstado.forEach((r) => { cuentaPorEstado[r.estado] = Number(r.cantidad); });
  const pendientes = cuentaPorEstado["pendiente_cotizacion"] || 0;
  const cotizando = cuentaPorEstado["en_comparacion"] || 0;
  const aprobadas = (cuentaPorEstado["aprobada"] || 0) + (cuentaPorEstado["pedida"] || 0);
  const entregadas = cuentaPorEstado["entregada"] || 0;

  const hayFiltros = Boolean(f.estado || f.categoria || f.comision_id);

  const claves = solicitudes.map(
    (s) =>
      `${s.material} ${s.especificacion || ""} ${CATEGORIA_COMPRA_LABEL[s.categoria] || ""} ${s.subcategoria || ""} ${s.comision_vinculada || s.comision} ${s.solicitante_nombre || ""}`
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

      <Card className="mb-5">
        <SectionTitle>Resumen</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <StatTile label="Pendientes" value={String(pendientes)} color={pendientes > 0 ? "amarillo" : "verde"} />
          <StatTile label="Cotizando" value={String(cotizando)} />
          <StatTile label="Aprobadas" value={String(aprobadas)} color="verde" />
          <StatTile label="Entregadas" value={String(entregadas)} />
          <StatTile label="Gastado este mes" value={money(Number(gastoMes?.total || 0))} />
        </div>
      </Card>

      {/* Rediseño UX/UI general (17/09, secciones 3/6): la fila de filtros
          pasa de ser una Card entera (título + grid de 3 selects, cada uno
          con su propia etiqueta arriba, más un botón de ancho completo) a
          una única fila compacta — el filtro más usado (Estado) siempre
          visible, y los secundarios (Categoría, Comisión) adentro de "Más
          filtros" (un <details> nativo: sin JS propio, accesible con
          teclado, se abre solo si ya hay uno de esos dos filtros activo por
          URL para que nunca quede un filtro aplicado escondido). Los mismos
          3 `name` de siempre, mismo `method="GET"` — ningún cambio en cómo
          se leen los filtros en el servidor. */}
      <form className="mb-5 flex flex-wrap items-center gap-2" method="GET">
        <select name="estado" defaultValue={f.estado || ""} aria-label="Estado" className={`${inputClass} w-auto text-xs py-1.5`}>
          <option value="">Estado: todos</option>
          <option value="pendiente_cotizacion">Pendiente de cotización</option>
          <option value="en_comparacion">En comparación</option>
          <option value="aprobada">Aprobada</option>
          <option value="pedida">Pedida a proveedor</option>
          <option value="entregada">Entregada</option>
          <option value="rechazada">Rechazada</option>
        </select>
        <details className="relative" open={Boolean(f.categoria || f.comision_id)}>
          <summary className="cursor-pointer select-none list-none rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
            Más filtros {Boolean(f.categoria || f.comision_id) && "●"}
          </summary>
          <div className="absolute z-10 mt-2 w-60 space-y-2.5 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-lg)]">
            <div>
              <Label>Categoría</Label>
              <select name="categoria" defaultValue={f.categoria || ""} className={inputClass}>
                <option value="">Todas</option>
                {Object.entries(CATEGORIA_COMPRA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label>Comisión</Label>
              <select name="comision_id" defaultValue={f.comision_id || ""} className={inputClass}>
                <option value="">Todas</option>
                {comisionesActivas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>
        </details>
        <button className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-1.5 text-xs font-semibold">Filtrar</button>
        {hayFiltros && (
          <Link href="/compras" className="text-xs text-ink-muted underline underline-offset-2">
            Limpiar filtros
          </Link>
        )}
      </form>

      <SectionTitle>Solicitudes</SectionTitle>
      {solicitudes.length === 0 ? (
        <EmptyState>{hayFiltros ? "No hay solicitudes que coincidan con estos filtros." : "No hay solicitudes de compra todavía."}</EmptyState>
      ) : (
        <BuscadorLista claves={claves} placeholder="Buscar por material, categoría, comisión…">
          {solicitudes.map((s) => (
            <Link key={s.id} href={`/compras/${s.id}`}>
              <Card className="hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-brand-900)]">{s.material} <span className="font-normal text-ink/50">({s.cantidad} {s.unidad})</span></p>
                    <p className="text-xs text-ink/50 mt-0.5">
                      {CATEGORIA_COMPRA_LABEL[s.categoria] || CATEGORIA_COMPRA_LABEL.obra}{s.subcategoria ? ` (${s.subcategoria})` : ""} · {s.comision_vinculada || s.comision} · {s.solicitante_nombre}
                      {s.fecha_necesaria && ` · necesario para el ${dayjs(s.fecha_necesaria).format("DD/MM")}`}
                      {s.recurrente && " · 🔁 recurrente"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <SolicitudStatusBadge estado={s.estado} />
                    {s.prioridad === "critica" && <Badge color="rojo">🔴 crítica</Badge>}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </BuscadorLista>
      )}
    </div>
  );
}
