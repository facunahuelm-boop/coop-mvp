import Link from "next/link";
import { Badge, inputClass } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import { decidirCompraFormAction } from "@/lib/actions/compras";

// Rediseño profundo de Compras, Fase 3 (pedido explícito, sección 10:
// "comparador visual de presupuestos, lado a lado, simple — no complicado").
// Reemplaza el bloque de texto plano ("Comparación asistida por IA") como
// forma PRINCIPAL de comparar — ese texto no se borró, `compararPresupuestos()`
// sigue existiendo y su resumen se muestra debajo, más chico, como apoyo. Este
// componente no agrega ninguna acción nueva: "Seleccionar proveedor" es el
// mismo `decidirCompraFormAction` que ya usaba la lista vertical anterior,
// sólo que ahora vive en una tarjeta por proveedor en vez de una fila de
// lista. Con 1 o 2 presupuestos se ve igual de bien que con varios — el
// scroll horizontal (mismo criterio ya usado en tablas anchas del resto del
// sistema) evita que se rompa el layout en mobile con 4+ proveedores.
export function PurchaseComparison({
  presupuestos,
  puedeElegir,
}: {
  presupuestos: any[];
  puedeElegir: boolean;
}) {
  if (presupuestos.length === 0) return null;

  const conTotal = presupuestos.map((p) => ({ ...p, total: p.precio + (p.costo_envio || 0) }));
  const masBaratoId = [...conTotal].sort((a, b) => a.total - b.total)[0]?.id;
  const conPlazo = conTotal.filter((p) => p.plazo_entrega_dias != null);
  const masRapidoId = conPlazo.length ? [...conPlazo].sort((a, b) => a.plazo_entrega_dias - b.plazo_entrega_dias)[0].id : null;

  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1">
      <div className="flex gap-3 min-w-min">
        {conTotal.map((p) => (
          <div key={p.id} className="w-60 shrink-0 rounded-xl border border-ink/10 bg-surface p-3.5">
            <div className="flex flex-wrap gap-1 mb-1.5 min-h-[22px]">
              {p.id === masBaratoId && <Badge color="verde">🏆 Más barato</Badge>}
              {p.id === masRapidoId && p.id !== masBaratoId && <Badge color="brand">⚡ Entrega más rápida</Badge>}
            </div>
            <Link href={`/proveedores/${p.proveedor_id}`} className="font-semibold text-sm text-ink hover:underline underline-offset-2">
              {p.proveedor_nombre}
            </Link>
            <p className="text-lg font-bold text-ink mt-1">${p.total.toLocaleString("es-UY")}</p>
            {p.costo_envio > 0 && (
              <p className="text-[11px] text-ink-faint">
                (${p.precio.toLocaleString("es-UY")} + ${p.costo_envio.toLocaleString("es-UY")} envío)
              </p>
            )}
            <dl className="text-xs text-ink-muted mt-2.5 space-y-1">
              <div><dt className="inline font-medium text-ink/70">Entrega: </dt><dd className="inline">{p.plazo_entrega_dias != null ? `${p.plazo_entrega_dias} días` : "—"}</dd></div>
              <div><dt className="inline font-medium text-ink/70">Pago: </dt><dd className="inline">{p.forma_pago || "—"}</dd></div>
              <div><dt className="inline font-medium text-ink/70">Garantía: </dt><dd className="inline">{p.garantia || "sin informar"}</dd></div>
              {p.condiciones && <div><dt className="inline font-medium text-ink/70">Condiciones: </dt><dd className="inline">{p.condiciones}</dd></div>}
            </dl>
            {puedeElegir && (
              <ActionForm action={decidirCompraFormAction} className="mt-3">
                <input type="hidden" name="solicitud_id" value={p.solicitud_id} />
                <input type="hidden" name="presupuesto_id" value={p.id} />
                <input name="motivo" placeholder="Motivo (opcional)" className={inputClass + " text-xs mb-2"} />
                <button className="w-full rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-2 text-xs font-semibold">Seleccionar proveedor</button>
              </ActionForm>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
