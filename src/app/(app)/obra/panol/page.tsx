import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { NuevoItemPanolForm, MovimientoPanolForm } from "@/components/obra/ObraRecursos";
import { hoyEnUruguay } from "@/lib/horasObra";
import { itemsPanol, bajoMinimo, puedeUsarPanol, numeroTexto } from "@/lib/obraRecursos";
import { devolverPrestamoFormAction, anularMovimientoPanolFormAction } from "@/lib/actions/obraRecursos";

type Mov = { id: number; item: string; unidad: string; tipo: string; cantidad: number; fecha: string; persona: string | null; notas: string | null; devuelto_en: string | null; recepcion_id: number | null; registrado_por: string | null };

const dmy = (f: string) => f.slice(0, 10).split("-").reverse().join("/");
const TIPO: Record<string, string> = { entrada: "Entrada", salida: "Salida", prestamo: "Préstamo", ajuste: "Ajuste" };

/** Fase 3C — el pañol: qué hay, qué está prestado y a quién, y los movimientos. */
export default async function PanolPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "obra")) redirect("/dashboard");
  const puede = await puedeUsarPanol(user);
  const hoy = hoyEnUruguay();
  const [items, prestamos, movimientos, nucleos] = await Promise.all([
    itemsPanol(),
    all<Mov>(
      `SELECT m.id, i.nombre AS item, i.unidad, m.tipo, m.cantidad, m.fecha, m.persona, m.notas, m.devuelto_en, m.recepcion_id, NULL AS registrado_por
         FROM panol_movimientos m JOIN panol_items i ON i.id = m.item_id
        WHERE m.tipo = 'prestamo' AND m.devuelto_en IS NULL AND m.anulado_en IS NULL ORDER BY m.fecha, m.id`
    ).catch(() => [] as Mov[]),
    all<Mov>(
      `SELECT m.id, i.nombre AS item, i.unidad, m.tipo, m.cantidad, m.fecha, m.persona, m.notas, m.devuelto_en, m.recepcion_id, u.nombre AS registrado_por
         FROM panol_movimientos m JOIN panol_items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.registrado_por_id
        WHERE m.anulado_en IS NULL ORDER BY m.id DESC LIMIT 40`
    ).catch(() => [] as Mov[]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM nucleos_familiares ORDER BY nombre`).catch(() => []),
  ]);
  const bajos = items.filter(bajoMinimo);
  const diasPrestado = (f: string) => Math.max(0, Math.round((Date.parse(hoy) - Date.parse(f.slice(0, 10))) / 86400000));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Pañol"
        subtitle="Herramientas y materiales guardados: qué hay y quién tiene qué"
        action={<Link href="/obra" className="text-sm font-semibold underline underline-offset-2">Volver a Obra</Link>}
      />

      {bajos.length > 0 && (
        <Card className="mb-5 !border-[var(--color-amarillo)]/40">
          <p className="text-[15px] font-semibold text-ink">Hay que reponer: {bajos.map((b) => `${b.nombre} (quedan ${numeroTexto(b.stock)} ${b.unidad})`).join(", ")}.</p>
          <Link href="/compras" className="text-sm font-semibold underline underline-offset-2">Pedir una compra</Link>
        </Card>
      )}

      {puede && items.length > 0 && (
        <>
          <SectionTitle>Prestar, sacar o ingresar</SectionTitle>
          <Card className="mb-6">
            <MovimientoPanolForm items={items.map((i) => ({ id: i.id, nombre: i.nombre, unidad: i.unidad, stock: i.stock, tipo: i.tipo }))} nucleos={nucleos} hoy={hoy} />
          </Card>
        </>
      )}

      <SectionTitle>{`Prestado ahora (${prestamos.length})`}</SectionTitle>
      <Card className="mb-6">
        <ul className="divide-y divide-border">
          {prestamos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
              <span>
                <span className="font-semibold">{p.item}</span> {Number(p.cantidad) !== 1 ? `× ${numeroTexto(Number(p.cantidad))} ` : ""}— {p.persona ?? "—"}
                <span className="block text-sm text-ink-muted">
                  Desde el {dmy(p.fecha)}
                  {diasPrestado(p.fecha) >= 3 && <> · <Badge color="amarillo">{`hace ${diasPrestado(p.fecha)} días`}</Badge></>}
                </span>
              </span>
              {puede && (
                <ActionForm action={devolverPrestamoFormAction} successMessage="Devuelto al pañol.">
                  <input type="hidden" name="id" value={p.id} />
                  <button className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-sunken">Lo devolvió</button>
                </ActionForm>
              )}
            </li>
          ))}
          {prestamos.length === 0 && <EmptyState>No hay nada prestado.</EmptyState>}
        </ul>
      </Card>

      <SectionTitle>{`En el pañol (${items.length})`}</SectionTitle>
      <Card className="mb-6 overflow-x-auto">
        {items.length ? (
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-ink-muted">
                <th className="py-1.5 pr-3">Qué</th>
                <th className="py-1.5 pr-3">Hay</th>
                <th className="py-1.5 pr-3">Prestado</th>
                <th className="py-1.5">Dónde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-3">
                    {i.nombre} <span className="text-sm text-ink-muted">({i.tipo === "herramienta" ? "herramienta" : "material"})</span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {numeroTexto(i.stock)} {i.unidad} {bajoMinimo(i) && <Badge color="amarillo">reponer</Badge>}
                  </td>
                  <td className="py-2 pr-3">{i.prestado ? numeroTexto(i.prestado) : "—"}</td>
                  <td className="py-2">{i.ubicacion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState>Todavía no hay nada cargado en el pañol.</EmptyState>
        )}
      </Card>

      {puede && (
        <details className="mb-6">
          <summary className="cursor-pointer text-[15px] font-semibold text-[var(--color-brand-800)]">Agregar una herramienta o material al pañol</summary>
          <Card className="mt-2">
            <NuevoItemPanolForm />
          </Card>
        </details>
      )}

      <SectionTitle>Últimos movimientos</SectionTitle>
      <Card>
        <ul className="divide-y divide-border">
          {movimientos.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
              <span>
                {dmy(m.fecha)} · {TIPO[m.tipo]} · {m.item} {numeroTexto(Number(m.cantidad))} {m.unidad}
                {m.persona && ` · ${m.persona}`}
                {m.tipo === "prestamo" && m.devuelto_en && " · devuelto"}
                <span className="block text-sm text-ink-muted">
                  {[m.notas, m.registrado_por ? `anotó ${m.registrado_por}` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              {puede && !m.recepcion_id && (
                <FormularioEnModal
                  textoBoton="Anular"
                  titulo="Anular el movimiento"
                  descripcion="Deja de contar en el stock, pero queda en el historial como anulado."
                  action={anularMovimientoPanolFormAction}
                  ocultos={{ id: m.id }}
                  textoConfirmar="Anular"
                  peligro
                  mensajeExito="Movimiento anulado."
                  claseBoton="text-sm font-semibold text-ink-muted underline underline-offset-2"
                >
                  <label className="block">
                    <Label required>Motivo</Label>
                    <input name="motivo" required maxLength={300} className={inputClass} />
                  </label>
                </FormularioEnModal>
              )}
            </li>
          ))}
          {movimientos.length === 0 && <EmptyState>Sin movimientos todavía.</EmptyState>}
        </ul>
      </Card>
    </div>
  );
}
