import { redirect } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, SectionTitle, Badge, EmptyState, Label, inputClass, StatTile, Button } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import { marcarGastoPagadoFormAction, anularGastoFormAction } from "@/lib/actions/gastos";
import { UsuarioLink } from "@/components/EntidadLink";
import { puedeUsarGastos } from "@/lib/comisionAuth";
import { Pagination, paginaDe } from "@/components/Pagination";
import { RegistrarGastoForm } from "@/components/gastos/RegistrarGastoForm";

const POR_PAGINA = 30;

// Gastos por Comisión (pedido explícito, sección 1 y 9 del pedido): resumen
// agregado + detalle filtrable, en una sola pantalla — se evita una pantalla
// aparte por comisión (over-engineering que no pidieron) usando el mismo
// filtro por comisión para el "drill-down": tocar una comisión en el resumen
// arma el link /gastos?comision_id=X con el resto de los filtros ya aplicados.
//
// Decisión ya confirmada (AskUserQuestion): "todos ven el resumen, cada uno
// edita solo lo suyo" — por eso el gate de lectura de la página es más amplio
// (canRead compras O finanzas, igual que el Dashboard deja ver el resumen
// financiero a cualquier socio) que el gate de edición de cada acción
// (puedeUsarGastos + puedeGestionarComision, ambos ya validados en el
// servidor dentro de actions/gastos.ts — acá solo se ocultan botones que de
// todos modos el servidor volvería a rechazar).

const ESTADO_LABEL: Record<string, string> = { pendiente: "Pendiente", pagado: "Pagado", anulado: "Anulado" };
const ESTADO_COLOR: Record<string, "amarillo" | "verde" | "rojo"> = { pendiente: "amarillo", pagado: "verde", anulado: "rojo" };
const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-UY")}`;

type Filtros = {
  comision_id?: string;
  categoria?: string;
  proveedor_id?: string;
  estado?: string;
  forma_pago?: string;
  desde?: string;
  hasta?: string;
  page?: string;
};

export default async function GastosPage({ searchParams }: { searchParams: Promise<Filtros> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras") && !canRead(user.rol, "finanzas")) redirect("/dashboard");

  const f = await searchParams;
  const page = paginaDe(f);
  const puedeCargar = puedeUsarGastos(user.rol);
  const esOversight = canEdit(user.rol, "finanzas");

  const desdeMes = dayjs().startOf("month").format("YYYY-MM-DD");
  const hastaMes = dayjs().endOf("month").format("YYYY-MM-DD");

  const condiciones: string[] = [];
  const params: any[] = [];
  if (f.comision_id) { condiciones.push(`g.comision_id = ?`); params.push(Number(f.comision_id)); }
  if (f.categoria) { condiciones.push(`g.categoria = ?`); params.push(f.categoria); }
  if (f.proveedor_id) { condiciones.push(`g.proveedor_id = ?`); params.push(Number(f.proveedor_id)); }
  if (f.estado) { condiciones.push(`g.estado = ?`); params.push(f.estado); }
  if (f.forma_pago) { condiciones.push(`g.forma_pago ILIKE ?`); params.push(`%${f.forma_pago}%`); }
  if (f.desde) { condiciones.push(`g.fecha >= ?`); params.push(f.desde); }
  if (f.hasta) { condiciones.push(`g.fecha <= ?`); params.push(f.hasta); }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  // Los 4 SELECT de abajo se protegen con .catch(() => …): a diferencia del
  // resto de las tablas nuevas de esta etapa, correr la migración 0017 en
  // Supabase y desplegar el código son dos pasos manuales separados (no una
  // sola operación atómica) — si esta pantalla llega a estar online un rato
  // antes de que se corra la migración, tiene que degradarse mostrando "sin
  // datos todavía" en vez de romper toda la página (mismo criterio que ya se
  // usa en el Dashboard con notas_calendario).
  // Fase 8 (paginación/búsqueda/filtros), hallazgo H-10: tenía un LIMIT 200
  // fijo — con los filtros ya existentes puestos a un lado, si el resultado
  // filtrado pasaba de 200 filas los gastos más viejos quedaban invisibles
  // sin ninguna forma de verlos. Se agrega COUNT + LIMIT/OFFSET reales.
  const [comisionesTotales, resumen, totalGastosRow, gastos, proveedores, comisionesActivas, misComisiones] = await Promise.all([
    all<any>(
      `SELECT c.id, c.nombre,
         COALESCE(SUM(g.importe) FILTER (WHERE g.estado != 'anulado'), 0) as total,
         COALESCE(SUM(g.importe) FILTER (WHERE g.estado = 'pendiente'), 0) as pendiente,
         COUNT(g.id) FILTER (WHERE g.estado != 'anulado') as cantidad
       FROM comisiones c
       LEFT JOIN gastos_comision g ON g.comision_id = c.id
       WHERE c.activa = 1
       GROUP BY c.id, c.nombre
       ORDER BY total DESC, c.nombre ASC`
    ).catch(() => [] as any[]),
    get<any>(
      `SELECT
         COALESCE(SUM(importe) FILTER (WHERE estado != 'anulado'), 0) as total_acumulado,
         COALESCE(SUM(importe) FILTER (WHERE estado != 'anulado' AND fecha >= ? AND fecha <= ?), 0) as total_mes,
         COALESCE(SUM(importe) FILTER (WHERE estado = 'pendiente'), 0) as total_pendiente,
         COUNT(*) FILTER (WHERE estado = 'pendiente') as cantidad_pendiente,
         COUNT(*) FILTER (WHERE estado = 'pagado') as cantidad_pagado,
         COUNT(*) FILTER (WHERE estado != 'anulado') as cantidad_total
       FROM gastos_comision`,
      [desdeMes, hastaMes]
    ).catch(() => null),
    get<{ total: string }>(`SELECT COUNT(*) as total FROM gastos_comision g ${where}`, params).catch(() => null),
    all<any>(
      `SELECT g.*, c.nombre as comision_nombre, p.nombre as proveedor_nombre, u.nombre as creado_por_nombre
       FROM gastos_comision g
       JOIN comisiones c ON c.id = g.comision_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       LEFT JOIN users u ON u.id = g.creado_por_id
       ${where}
       ORDER BY g.fecha DESC, g.creado_en DESC
       LIMIT ? OFFSET ?`,
      [...params, POR_PAGINA, (page - 1) * POR_PAGINA]
    ).catch(() => [] as any[]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM proveedores ORDER BY nombre ASC`).catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`).catch(() => []),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]).catch(() => []),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));
  const comisionesQuePuedeCargar = esOversight ? comisionesActivas : comisionesActivas.filter((c) => misComisionIds.has(c.id));
  const puedeGestionarFila = (comisionId: number) => esOversight || misComisionIds.has(comisionId);

  const hayFiltros = Boolean(f.comision_id || f.categoria || f.proveedor_id || f.estado || f.forma_pago || f.desde || f.hasta);
  const totalGastos = Number(totalGastosRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalGastos / POR_PAGINA));

  // Preserva los filtros ya elegidos cuando se toca una comisión desde el
  // resumen (drill-down): sólo cambia comision_id, el resto de la búsqueda
  // que la persona ya armó se mantiene.
  const linkComision = (comisionId: number | null) => {
    const params2 = new URLSearchParams();
    if (f.categoria) params2.set("categoria", f.categoria);
    if (f.proveedor_id) params2.set("proveedor_id", f.proveedor_id);
    if (f.estado) params2.set("estado", f.estado);
    if (f.forma_pago) params2.set("forma_pago", f.forma_pago);
    if (f.desde) params2.set("desde", f.desde);
    if (f.hasta) params2.set("hasta", f.hasta);
    if (comisionId) params2.set("comision_id", String(comisionId));
    const qs = params2.toString();
    return `/gastos${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Gastos de la cooperativa"
        subtitle="Cuánto gasta cada comisión, y en qué"
        action={
          <a
            href={`/api/gastos/export?${new URLSearchParams(f as Record<string, string>).toString()}`}
            className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap"
          >
            Exportar CSV →
          </a>
        }
      />

      {resumen && (
        <Card className="mb-5">
          <SectionTitle>Resumen</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatTile label="Gastado este mes" value={money(resumen.total_mes)} />
            <StatTile label="Acumulado" value={money(resumen.total_acumulado)} />
            <StatTile label="Pendientes de pago" value={money(resumen.total_pendiente)} color={Number(resumen.cantidad_pendiente) > 0 ? "amarillo" : "verde"} hint={`${resumen.cantidad_pendiente} gasto(s)`} />
            <StatTile label="Cantidad de gastos" value={String(resumen.cantidad_total)} hint={`${resumen.cantidad_pagado} pagados`} />
          </div>
        </Card>
      )}

      {comisionesTotales.length > 0 && (
        <div className="mb-5">
          <SectionTitle>Por comisión</SectionTitle>
          {/* Auditoría de espacio (extendida al resto del sistema): antes
              cada comisión era una <Card> completa (borde + sombra + padding
              grande) para 2-3 líneas cortas — mismo contenido que un
              StatTile ya resuelve en el resto del sistema (Resumen, Gastos
              por comisión de arriba). El resaltado de filtro activo y el
              hover pasan a un anillo/opacidad sobre el StatTile en vez de
              depender del borde de la Card. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {comisionesTotales.map((c) => (
              <Link key={c.id} href={linkComision(c.id)} className="block hover:opacity-80 transition-opacity">
                <div className={f.comision_id === String(c.id) ? "ring-2 ring-[var(--color-brand-800)] rounded-xl" : ""}>
                  <StatTile
                    label={c.nombre}
                    value={money(c.total)}
                    hint={Number(c.pendiente) > 0 ? `${money(c.pendiente)} pendiente` : undefined}
                    color={Number(c.pendiente) > 0 ? "amarillo" : undefined}
                  />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Rediseño UX/UI general (17/09, secciones 3/9): mismo criterio que
          Compras — de una Card entera con 7 campos en grilla (2 filas en
          desktop, 4 en mobile) a una fila compacta con los 2 filtros más
          usados siempre visibles y los otros 5 adentro de "Más filtros"
          (mismos `name`, mismo `method="GET"`, ningún cambio de lógica). */}
      <form className="mb-5 flex flex-wrap items-center gap-2" method="GET">
        {/* `inputClass` trae `w-full` a propósito para formularios verticales
            — acá conviene explícitamente NO reutilizarlo (una clase propia,
            sin `w-full`) porque `w-auto` en el mismo string no le gana en
            especificidad y el select terminaba ocupando la fila entera. */}
        <select
          name="comision_id"
          defaultValue={f.comision_id || ""}
          aria-label="Comisión"
          className="rounded-lg border border-ink/10 bg-surface px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30 focus:border-[var(--color-brand-800)]"
        >
          <option value="">Comisión: todas</option>
          {comisionesActivas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select
          name="estado"
          defaultValue={f.estado || ""}
          aria-label="Estado"
          className="rounded-lg border border-ink/10 bg-surface px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30 focus:border-[var(--color-brand-800)]"
        >
          <option value="">Estado: todos</option>
          <option value="pendiente">Pendiente</option>
          <option value="pagado">Pagado</option>
          <option value="anulado">Anulado</option>
        </select>
        <details className="relative" open={Boolean(f.categoria || f.proveedor_id || f.forma_pago || f.desde || f.hasta)}>
          <summary className="cursor-pointer select-none list-none rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
            Más filtros {Boolean(f.categoria || f.proveedor_id || f.forma_pago || f.desde || f.hasta) && "●"}
          </summary>
          <div className="absolute z-10 mt-2 w-64 space-y-2.5 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-lg)]">
            <div>
              <Label>Categoría</Label>
              <select name="categoria" defaultValue={f.categoria || ""} className={inputClass}>
                <option value="">Todas</option>
                {Object.entries(CATEGORIA_COMPRA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label>Proveedor</Label>
              <select name="proveedor_id" defaultValue={f.proveedor_id || ""} className={inputClass}>
                <option value="">Todos</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div><Label>Forma de pago</Label><input name="forma_pago" defaultValue={f.forma_pago || ""} className={inputClass} placeholder="efectivo, transferencia…" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Desde</Label><input type="date" name="desde" defaultValue={f.desde || ""} className={inputClass} /></div>
              <div><Label>Hasta</Label><input type="date" name="hasta" defaultValue={f.hasta || ""} className={inputClass} /></div>
            </div>
          </div>
        </details>
        <button className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-1.5 text-xs font-semibold">Filtrar</button>
        {hayFiltros && (
          <a href="/gastos" className="text-xs text-ink-muted underline underline-offset-2">
            Limpiar filtros
          </a>
        )}
      </form>

      <SectionTitle>Gastos</SectionTitle>
      <div className="space-y-2 mb-6">
        {gastos.map((g) => {
          const puedeGestionar = puedeGestionarFila(g.comision_id);
          return (
            <Card key={g.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{g.descripcion}</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {dayjs(g.fecha).format("DD/MM/YYYY")} · {g.comision_nombre} · {g.proveedor_nombre || "sin proveedor"} · {CATEGORIA_COMPRA_LABEL[g.categoria] || g.categoria}
                    {g.forma_pago && ` · ${g.forma_pago}`}
                    {" · cargado por "}
                    <UsuarioLink id={g.creado_por_id} nombre={g.creado_por_nombre} fallback="—" />
                  </p>
                  {g.observaciones && <p className="text-xs text-ink-faint mt-1">{g.observaciones}</p>}
                  {g.comprobante_url && (
                    <a
                      href={`/api/archivos/gasto/${g.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 mt-1 inline-block"
                    >
                      Ver comprobante →
                    </a>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <p className="text-sm font-bold text-ink">{money(g.importe)}</p>
                  <Badge color={ESTADO_COLOR[g.estado] || "gray"}>{ESTADO_LABEL[g.estado] || g.estado}</Badge>
                </div>
              </div>
              {puedeGestionar && g.estado === "pendiente" && (
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
                  <ActionForm action={marcarGastoPagadoFormAction}>
                    <input type="hidden" name="id" value={g.id} />
                    <button className="rounded-lg bg-[var(--color-verde-bg)] text-[var(--color-verde)] px-3 py-1.5 text-xs font-semibold">Marcar como pagado</button>
                  </ActionForm>
                  <details className="inline-block">
                    <summary className="cursor-pointer text-xs text-[var(--color-rojo)] font-semibold px-1">Anular</summary>
                    <ActionForm action={anularGastoFormAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="id" value={g.id} />
                      <input name="motivo" placeholder="Motivo (opcional)" className={inputClass + " text-xs"} />
                      <button className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Confirmar anulación</button>
                    </ActionForm>
                  </details>
                </div>
              )}
            </Card>
          );
        })}
        {gastos.length === 0 && (
          <EmptyState>
            {hayFiltros ? "No hay gastos que coincidan con estos filtros." : "Todavía no hay gastos registrados."}
          </EmptyState>
        )}
      </div>
      {gastos.length > 0 && <Pagination page={page} totalPages={totalPages} basePath="/gastos" searchParams={f} />}

      {puedeCargar && (
        comisionesQuePuedeCargar.length > 0 ? (
          <RegistrarGastoForm comisiones={comisionesQuePuedeCargar} proveedores={proveedores} />
        ) : (
          <p className="text-xs text-ink-faint mt-2">Para registrar un gasto hace falta ser integrante activo de una comisión — pedile a Administración que te agregue en Comisiones.</p>
        )
      )}
    </div>
  );
}
