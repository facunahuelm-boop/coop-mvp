import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { Card, PageHeader, Badge, SectionTitle, EmptyState } from "@/components/ui";
import { resumenConciliacion } from "@/lib/conciliacion";
import { opcionesLibro } from "@/lib/finanzasLibro";
import { codigoDePago } from "@/lib/reglamento";
import { ImportarExtracto, AccionesLinea, DeshacerConciliacion, type LineaUi } from "@/components/finanzas/ConciliacionFormularios";

/**
 * Fase 2B — Conciliación bancaria: lo que dice el banco contra lo que dice
 * COOVA. Se importa el extracto, COOVA propone con qué coincide cada línea y
 * una persona confirma.
 */

const pesos = (n: number) => `${n < 0 ? "− " : ""}$ ${Math.abs(Math.round(n)).toLocaleString("es-UY")}`;
const fechaCorta = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const PROPUESTA: Record<string, { texto: string; color: "verde" | "azul" | "amarillo" }> = {
  codigo: { texto: "Coincide el código de pago", color: "verde" },
  monto_fecha: { texto: "Mismo monto y fecha", color: "azul" },
  sugerencia: { texto: "Posible: mismo monto", color: "amarillo" },
};
const COMO: Record<string, string> = {
  codigo: "por código de pago",
  monto_fecha: "por monto y fecha",
  sugerencia: "por sugerencia",
  manual: "elegido a mano",
  pago_cuota: "se registró el pago",
  nuevo: "se registró en Finanzas",
  automatica: "confirmada sola (código de pago)",
};

export default async function ConciliacionPage({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) redirect("/finanzas");
  const puede = canEdit(user.rol, "finanzas");
  const sp = await searchParams;

  const bancos = await all<{ id: number; nombre: string }>(`SELECT id, nombre FROM cuentas_financieras WHERE activa = 1 AND tipo = 'banco' ORDER BY predeterminada DESC, nombre`).catch(() => []);
  const cuentaId = bancos.find((b) => String(b.id) === sp.cuenta)?.id ?? bancos[0]?.id ?? 0;

  if (!bancos.length) {
    return (
      <div className="max-w-5xl">
        <PageHeader title="Conciliación con el banco" />
        <Card>
          <EmptyState>
            Primero agregá la cuenta del banco en <Link href="/finanzas/cuentas" className="underline">Cuentas y fondos</Link>.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const [resumen, pendientesCrudas, conciliadas, ignoradas, sinConciliar, sociosCrudos, opciones, org] = await Promise.all([
    resumenConciliacion(cuentaId),
    all<LineaUi & { monto: string; mov_desc: string | null; mov_fecha: string | null; mov_cat: string | null; socio_nombre: string | null }>(
      `SELECT l.id, l.fecha, l.descripcion, l.referencia, l.monto, l.propuesta_tipo, l.propuesta_movimiento_id, l.propuesta_socio_id,
              m.descripcion AS mov_desc, left(m.fecha::text, 10) AS mov_fecha, m.categoria AS mov_cat, s.nombre AS socio_nombre
         FROM extracto_lineas l
         LEFT JOIN movimientos_financieros m ON m.id = l.propuesta_movimiento_id
         LEFT JOIN socios s ON s.id = l.propuesta_socio_id
        WHERE l.cuenta_id = ? AND l.estado = 'pendiente'
        ORDER BY l.fecha, l.id LIMIT 300`,
      [cuentaId]
    ),
    all<{ id: number; fecha: string; descripcion: string | null; monto: string; conciliada_como: string | null; mov_desc: string | null; mov_cat: string | null; quien: string | null }>(
      `SELECT l.id, l.fecha, l.descripcion, l.monto, l.conciliada_como, m.descripcion AS mov_desc, m.categoria AS mov_cat, u.nombre AS quien
         FROM extracto_lineas l LEFT JOIN movimientos_financieros m ON m.id = l.movimiento_financiero_id LEFT JOIN users u ON u.id = l.conciliado_por_id
        WHERE l.cuenta_id = ? AND l.estado = 'conciliada' ORDER BY l.conciliado_en DESC LIMIT 30`,
      [cuentaId]
    ),
    all<{ id: number; fecha: string; descripcion: string | null; monto: string; motivo_ignorada: string | null }>(
      `SELECT id, fecha, descripcion, monto, motivo_ignorada FROM extracto_lineas WHERE cuenta_id = ? AND estado = 'ignorada' ORDER BY conciliado_en DESC LIMIT 10`,
      [cuentaId]
    ),
    resumenConciliacion(cuentaId).then((r) =>
      r.desde
        ? all<{ id: number; fecha: string; tipo: string; monto: string; categoria: string; descripcion: string | null }>(
            `SELECT id, left(fecha::text, 10) AS fecha, tipo, monto, categoria, descripcion FROM movimientos_financieros
              WHERE cuenta_id = ? AND COALESCE(estado, 'activo') <> 'anulado' AND conciliado_linea_id IS NULL AND left(fecha::text, 10) BETWEEN ? AND ?
              ORDER BY fecha LIMIT 50`,
            [cuentaId, r.desde, r.hasta]
          )
        : []
    ),
    all<{ id: number; nombre: string; nucleo_id: number | null }>(`SELECT id, nombre, nucleo_id FROM socios WHERE estado NOT IN ('baja', 'egresado', 'excluido') ORDER BY nombre`).catch(() => []),
    opcionesLibro(),
    get<{ slug: string }>(`SELECT slug FROM organizations WHERE id = ?`, [user.organization_id]),
  ]);
  const socios = sociosCrudos.map((s) => ({ id: s.id, nombre: s.nombre, codigo: codigoDePago(org?.slug ?? "", s.nucleo_id, s.id) }));
  const pendientes = pendientesCrudas.map((l) => ({
    ...l,
    monto: Number(l.monto),
    propuesta_texto: l.propuesta_movimiento_id
      ? `${l.mov_cat ?? ""}${l.mov_desc ? ` — ${l.mov_desc}` : ""} (${fechaCorta(l.mov_fecha)})`
      : l.socio_nombre
        ? `Pago de ${l.socio_nombre} (todavía no registrado)`
        : null,
  }));
  const diferencia = resumen.saldoBanco ? resumen.saldoBanco.saldo - resumen.saldoCoova : null;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Conciliación con el banco"
        subtitle="Lo que dice el banco contra lo que dice COOVA. Se importa el extracto, COOVA propone con qué coincide cada línea y vos confirmás."
        action={
          <Link href="/finanzas" className="inline-flex items-center rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken">
            ← Volver a Finanzas
          </Link>
        }
      />

      {bancos.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist">
          {bancos.map((b) => (
            <Link
              key={b.id}
              href={`/finanzas/conciliacion?cuenta=${b.id}`}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${b.id === cuentaId ? "bg-[var(--color-brand-800)] text-white" : "border border-border bg-surface text-ink"}`}
            >
              {b.nombre}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 text-[15px]">
        <Card>
          <div className="text-ink-muted">Líneas del banco sin conciliar</div>
          <div className={`text-2xl font-bold ${resumen.pendientes ? "text-[var(--color-amarillo)]" : "text-[var(--color-verde)]"}`}>{resumen.pendientes}</div>
          {resumen.desde && <div className="text-sm text-ink-muted">Extractos del {fechaCorta(resumen.desde)} al {fechaCorta(resumen.hasta)}</div>}
        </Card>
        <Card>
          <div className="text-ink-muted">Movimientos de COOVA sin conciliar</div>
          <div className={`text-2xl font-bold ${resumen.movimientosSinConciliar ? "text-[var(--color-amarillo)]" : "text-[var(--color-verde)]"}`}>{resumen.movimientosSinConciliar}</div>
          <div className="text-sm text-ink-muted">en las fechas de los extractos</div>
        </Card>
        <Card>
          {resumen.saldoBanco ? (
            <>
              <div className="text-ink-muted">Saldo al {fechaCorta(resumen.saldoBanco.fecha)}</div>
              <div className="text-sm">Banco: <b>{pesos(resumen.saldoBanco.saldo)}</b> · COOVA: <b>{pesos(resumen.saldoCoova)}</b></div>
              <div className={`font-bold ${diferencia && Math.abs(diferencia) >= 1 ? "text-[var(--color-rojo)]" : "text-[var(--color-verde)]"}`}>
                {diferencia && Math.abs(diferencia) >= 1 ? `Diferencia: ${pesos(diferencia)}` : "✔ Coinciden"}
              </div>
            </>
          ) : (
            <>
              <div className="text-ink-muted">Saldo en COOVA</div>
              <div className="text-2xl font-bold">{pesos(resumen.saldoCoova)}</div>
              <div className="text-sm text-ink-muted">Si el extracto trae la columna «saldo», se compara solo.</div>
            </>
          )}
        </Card>
      </div>

      {puede && (
        <div className="mb-6">
          <SectionTitle>Importar el extracto del banco</SectionTitle>
          <Card>
            <ImportarExtracto cuentas={bancos} cuentaId={cuentaId} />
          </Card>
        </div>
      )}

      <SectionTitle>Para revisar ({pendientes.length})</SectionTitle>
      <Card className="mb-6">
        {pendientes.length === 0 ? (
          <EmptyState>No hay líneas del banco pendientes.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {pendientes.map((l) => (
              <li key={l.id} className="py-3 text-[15px]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div>
                      <span className="text-ink-muted">{fechaCorta(l.fecha)}</span> ·{" "}
                      <b className={l.monto < 0 ? "text-[var(--color-rojo)]" : "text-[var(--color-verde)]"}>{pesos(l.monto)}</b>{" "}
                      {l.propuesta_tipo && <Badge color={PROPUESTA[l.propuesta_tipo]?.color ?? "gray"}>{PROPUESTA[l.propuesta_tipo]?.texto}</Badge>}
                    </div>
                    <div className="text-ink break-words">{[l.descripcion, l.referencia].filter(Boolean).join(" · ") || "Sin descripción"}</div>
                    {l.propuesta_texto && <div className="text-sm text-ink-muted">En COOVA: {l.propuesta_texto}</div>}
                  </div>
                  {puede && <AccionesLinea linea={l} opciones={opciones} socios={socios} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sinConciliar.length > 0 && (
        <>
          <SectionTitle>En COOVA pero todavía no en el banco ({sinConciliar.length})</SectionTitle>
          <Card className="mb-6">
            <p className="text-[15px] text-ink-muted mb-2">Pueden ser cheques sin cobrar, depósitos en tránsito, o algo cargado en la cuenta equivocada.</p>
            <ul className="divide-y divide-border text-[15px]">
              {sinConciliar.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {fechaCorta(m.fecha)} · {m.categoria}
                    {m.descripcion ? ` — ${m.descripcion}` : ""}
                  </span>
                  <b className={m.tipo === "egreso" ? "text-[var(--color-rojo)]" : "text-[var(--color-verde)]"}>{pesos(m.tipo === "egreso" ? -Number(m.monto) : Number(m.monto))}</b>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <SectionTitle>Ya conciliadas (últimas)</SectionTitle>
      <Card className="mb-6">
        {conciliadas.length === 0 ? (
          <EmptyState>Todavía no se concilió nada.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-[15px]">
            {conciliadas.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  {fechaCorta(l.fecha)} · <b>{pesos(Number(l.monto))}</b> · {l.descripcion ?? ""}
                  <span className="block text-sm text-ink-muted">
                    {l.mov_cat}
                    {l.mov_desc ? ` — ${l.mov_desc}` : ""} · {COMO[l.conciliada_como ?? ""] ?? ""}
                    {l.quien ? ` · ${l.quien}` : ""}
                  </span>
                </span>
                {puede && <DeshacerConciliacion lineaId={l.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {ignoradas.length > 0 && (
        <>
          <SectionTitle>Ignoradas</SectionTitle>
          <Card>
            <ul className="divide-y divide-border text-[15px]">
              {ignoradas.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {fechaCorta(l.fecha)} · <b>{pesos(Number(l.monto))}</b> · {l.descripcion ?? ""}
                    <span className="block text-sm text-ink-muted">Motivo: {l.motivo_ignorada}</span>
                  </span>
                  {puede && <DeshacerConciliacion lineaId={l.id} />}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
