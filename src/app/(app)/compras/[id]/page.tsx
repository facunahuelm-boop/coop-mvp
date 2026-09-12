import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, canApprove } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { compararPresupuestos, historialProveedor } from "@/lib/logic";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { agregarPresupuestoAction, decidirCompraAction, marcarPedidaAction, marcarEntregadaAction, rechazarSolicitudAction } from "@/lib/actions/compras";
import { puedeGestionarComision } from "@/lib/comisionAuth";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";

const ESTADO_LABEL: Record<string, string> = {
  pendiente_cotizacion: "pendiente de cotización", en_comparacion: "en comparación", aprobada: "aprobada",
  pedida: "pedida a proveedor", entregada: "entregada", rechazada: "rechazada",
};

export default async function SolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const [solicitud, proveedores, comparacion, decision] = await Promise.all([
    get<any>(`SELECT * FROM solicitudes_compra WHERE id = ?`, [id]),
    all<any>(`SELECT * FROM proveedores ORDER BY nombre`),
    compararPresupuestos(Number(id)),
    get<any>(`SELECT dc.*, pp.proveedor_id, pv.nombre as proveedor_nombre, u.nombre as decidido_por FROM decisiones_compra dc JOIN presupuestos_proveedor pp ON pp.id = dc.presupuesto_id JOIN proveedores pv ON pv.id = pp.proveedor_id LEFT JOIN users u ON u.id = dc.decidido_por_id WHERE dc.solicitud_id = ? ORDER BY dc.fecha DESC LIMIT 1`, [id]),
  ]);
  if (!solicitud) notFound();
  const puedeAprobar = canApprove(user.rol, "compras");
  // AUDITORÍA INTEGRAL: mismo hallazgo que en compras.ts (agregarPresupuestoAction,
  // marcarPedidaAction, marcarEntregadaAction) — si la solicitud está vinculada a
  // una comisión real (comision_id), estos botones ahora se ofrecen solo a quien
  // puede gestionar ESA comisión puntual, no a cualquiera con permiso de módulo,
  // para no prometer una acción que el servidor va a rechazar.
  const puedeEditar =
    canEdit(user.rol, "compras") &&
    (solicitud.comision_id ? await puedeGestionarComision(user, solicitud.comision_id) : true);

  return (
    <div>
      <PageHeader title={solicitud.material} subtitle={`${solicitud.cantidad} ${solicitud.unidad} · ${solicitud.comision}`}
        action={<Badge color={solicitud.prioridad === "critica" ? "rojo" : "brand"}>{solicitud.prioridad}</Badge>} />

      <Card className="mb-5 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><Label>Categoría</Label>{CATEGORIA_COMPRA_LABEL[solicitud.categoria] || CATEGORIA_COMPRA_LABEL.obra}</div>
          <div><Label>Estado</Label>{ESTADO_LABEL[solicitud.estado] || solicitud.estado.replace(/_/g, " ")}</div>
          <div><Label>Etapa de obra</Label>{solicitud.etapa_obra || "—"}</div>
          <div><Label>Necesario para</Label>{solicitud.fecha_necesaria ? dayjs(solicitud.fecha_necesaria).format("DD/MM/YYYY") : "—"}</div>
          <div><Label>Estimado</Label>{solicitud.presupuesto_estimado ? `$${solicitud.presupuesto_estimado.toLocaleString("es-UY")}` : "—"}</div>
        </div>
        {solicitud.especificacion && <p className="text-ink/60 mt-3">{solicitud.especificacion}</p>}
        {puedeEditar && solicitud.estado === "aprobada" && (
          <form action={marcarPedidaAction} className="mt-3 inline-block mr-2"><input type="hidden" name="id" value={solicitud.id} />
            <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-1.5 text-xs font-semibold">Marcar como pedida al proveedor</button>
          </form>
        )}
        {puedeEditar && (solicitud.estado === "aprobada" || solicitud.estado === "pedida") && (
          <form action={marcarEntregadaAction} className="mt-3 inline-block"><input type="hidden" name="id" value={solicitud.id} />
            <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-1.5 text-xs font-semibold">Marcar como entregada</button>
          </form>
        )}
        {puedeAprobar && (solicitud.estado === "pendiente_cotizacion" || solicitud.estado === "en_comparacion") && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-rojo)]">Rechazar esta solicitud</summary>
            <form action={rechazarSolicitudAction} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="id" value={solicitud.id} />
              <input name="motivo" placeholder="Motivo del rechazo" className={inputClass + " text-xs"} />
              <button className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Confirmar rechazo</button>
            </form>
          </details>
        )}
      </Card>

      {decision && (
        <Card className="mb-5 !border-[var(--color-verde)]/30 bg-[var(--color-verde-bg)]/40">
          <p className="text-sm font-semibold text-[var(--color-verde)]">Decisión registrada</p>
          <p className="text-sm mt-1">Se eligió a <Link href={`/proveedores/${decision.proveedor_id}`} className="font-semibold underline underline-offset-2">{decision.proveedor_nombre}</Link> por <strong>${decision.monto?.toLocaleString("es-UY")}</strong>, decidido por {decision.decidido_por} el {dayjs(decision.fecha).format("DD/MM/YYYY")}.</p>
          {decision.motivo && <p className="text-xs text-ink/60 mt-1">Motivo: {decision.motivo}</p>}
        </Card>
      )}

      <Card className="mb-5">
        <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">✨ Comparación asistida por IA</h3>
        <pre className="text-sm text-ink/70 whitespace-pre-wrap font-sans">{comparacion.texto}</pre>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Presupuestos cargados</h3>
      <div className="space-y-2 mb-4">
        {comparacion.presupuestos.length === 0 && <EmptyState>Todavía no hay presupuestos.</EmptyState>}
        {comparacion.presupuestos.map((p: any) => (
          <Card key={p.id} className="text-sm">
            <div className="flex items-center justify-between">
              <Link href={`/proveedores/${p.proveedor_id}`} className="font-semibold hover:underline underline-offset-2">{p.proveedor_nombre}</Link>
              <p className="font-bold">${p.precio.toLocaleString("es-UY")}{p.costo_envio ? ` + $${p.costo_envio.toLocaleString("es-UY")} envío` : ""}</p>
            </div>
            <p className="text-xs text-ink/50 mt-1">
              {p.plazo_entrega_dias != null && `Entrega en ${p.plazo_entrega_dias} días · `}
              {p.forma_pago && `Pago: ${p.forma_pago} · `}
              {p.garantia ? `Garantía: ${p.garantia}` : "Sin garantía informada"}
            </p>
            {p.condiciones && <p className="text-xs text-ink/50 mt-0.5">Condiciones: {p.condiciones}</p>}
            {puedeAprobar && (solicitud.estado === "pendiente_cotizacion" || solicitud.estado === "en_comparacion") && (
              <form action={decidirCompraAction} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="solicitud_id" value={solicitud.id} />
                <input type="hidden" name="presupuesto_id" value={p.id} />
                <input name="motivo" placeholder="Motivo de la decisión" className={inputClass + " text-xs"} />
                <button className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-2 text-xs font-semibold whitespace-nowrap">Elegir este proveedor</button>
              </form>
            )}
          </Card>
        ))}
      </div>

      {puedeEditar && (solicitud.estado === "pendiente_cotizacion" || solicitud.estado === "en_comparacion") && (
        <details open={comparacion.presupuestos.length < 3}>
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Cargar presupuesto</summary>
          <Card className="mt-3">
            <form action={agregarPresupuestoAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="solicitud_id" value={solicitud.id} />
              <div>
                <Label>Proveedor existente</Label>
                <select name="proveedor_id" className={inputClass} defaultValue="">
                  <option value="">— elegir —</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div><Label>...o proveedor nuevo</Label><input name="nuevo_proveedor" className={inputClass} placeholder="Nombre del proveedor" /></div>
              <div><Label>Precio</Label><input name="precio" type="number" step="0.01" required className={inputClass} /></div>
              <div><Label>Precio unitario</Label><input name="precio_unitario" type="number" step="0.01" className={inputClass} /></div>
              <div><Label>Costo de envío</Label><input name="costo_envio" type="number" step="0.01" className={inputClass} /></div>
              <div><Label>Plazo de entrega (días)</Label><input name="plazo_entrega_dias" type="number" className={inputClass} /></div>
              <div><Label>Forma de pago</Label><input name="forma_pago" className={inputClass} placeholder="contado, 30 días…" /></div>
              <div><Label>Garantía</Label><input name="garantia" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Condiciones (calidad, entrega, etc.)</Label><input name="condiciones" className={inputClass} placeholder="Ej: material de primera calidad, entrega en obra incluida" /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" className={inputClass} /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Guardar presupuesto</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
