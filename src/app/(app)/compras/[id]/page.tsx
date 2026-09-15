import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, canApprove } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { compararPresupuestos, historialSolicitud } from "@/lib/logic";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import { ActionForm, Tabs } from "@/components/ui-client";
import dayjs from "dayjs";
import { marcarPedidaFormAction, marcarEntregadaFormAction, rechazarSolicitudFormAction, eliminarSolicitudFormAction } from "@/lib/actions/compras";
import { ConfirmarEliminar } from "@/components/ConfirmarEliminar";
import { puedeGestionarComision } from "@/lib/comisionAuth";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import { CargarPresupuestoForm, AdjuntarFacturaForm, EditarSolicitudForm } from "@/components/compras/ComprasFormularios";
import { SolicitudStatusBadge } from "@/components/compras/PurchaseStatus";
import { HistorialCompra } from "@/components/compras/HistorialCompra";
import { PurchaseComparison } from "@/components/compras/PurchaseComparison";

export default async function SolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const [solicitud, proveedores, comparacion, decision, historial, documentos] = await Promise.all([
    get<any>(`SELECT * FROM solicitudes_compra WHERE id = ?`, [id]),
    all<any>(`SELECT * FROM proveedores ORDER BY nombre`),
    compararPresupuestos(Number(id)),
    get<any>(`SELECT dc.*, pp.proveedor_id, pv.nombre as proveedor_nombre, u.nombre as decidido_por FROM decisiones_compra dc JOIN presupuestos_proveedor pp ON pp.id = dc.presupuesto_id JOIN proveedores pv ON pv.id = pp.proveedor_id LEFT JOIN users u ON u.id = dc.decidido_por_id WHERE dc.solicitud_id = ? ORDER BY dc.fecha DESC LIMIT 1`, [id]),
    historialSolicitud(Number(id)),
    // solicitud_compra_id (migración 0026) recién adjunta un documento a una
    // compra puntual — si esa migración todavía no corrió en esta base, la
    // columna no existe y este SELECT se degrada a "sin documentos" en vez
    // de romper toda la página (mismo criterio defensivo de siempre).
    all<any>(`SELECT d.*, u.nombre as subido_por FROM documentos d LEFT JOIN users u ON u.id = d.subido_por_id WHERE d.solicitud_compra_id = ? ORDER BY d.fecha DESC`, [id]).catch(() => [] as any[]),
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

  const puedeElegirProveedor = puedeAprobar && (solicitud.estado === "pendiente_cotizacion" || solicitud.estado === "en_comparacion");
  // Rediseño profundo de Compras, Fase 5 (sección 6): editar sólo tiene
  // sentido mientras la compra sigue "viva" — una vez entregada o rechazada
  // el ciclo terminó (mismo criterio, con el mismo mensaje, que
  // `editarSolicitudAction` ya valida en el servidor; acá sólo se evita
  // ofrecer un botón que el servidor rechazaría igual).
  const puedeEditarDatos = puedeEditar && solicitud.estado !== "entregada" && solicitud.estado !== "rechazada";

  // Rediseño profundo de Compras, Fase 3 (pedido explícito, sección 16): el
  // detalle deja de ser una página larga de scroll continuo y pasa a
  // organizarse en las 4 pestañas pedidas — Información / Presupuestos /
  // Documentos / Historial. Se mantiene como página propia (no como modal
  // abierto desde la lista): convertir cada fila del listado en un modal
  // pre-armado hubiera significado repetir esta misma batería de consultas
  // (comparación, decisión, historial) para CADA solicitud de la lista, se
  // haya abierto o no — un costo real que crece con la cantidad de compras
  // de la cooperativa. Acá, en cambio, las pestañas comparten los datos que
  // esta página ya pidió una sola vez para la solicitud puntual que se está
  // mirando, así que no hay ningún costo extra en tenerlas ya armadas.
  const tabInformacion = (
    <>
      <Card className="mb-5 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><Label>Categoría</Label>{CATEGORIA_COMPRA_LABEL[solicitud.categoria] || CATEGORIA_COMPRA_LABEL.obra}{solicitud.subcategoria ? ` · ${solicitud.subcategoria}` : ""}</div>
          <div><Label>Estado</Label><SolicitudStatusBadge estado={solicitud.estado} /></div>
          <div><Label>Etapa de obra</Label>{solicitud.etapa_obra || "—"}</div>
          <div><Label>Necesario para</Label>{solicitud.fecha_necesaria ? dayjs(solicitud.fecha_necesaria).format("DD/MM/YYYY") : "—"}</div>
          <div><Label>Estimado</Label>{solicitud.presupuesto_estimado ? `$${solicitud.presupuesto_estimado.toLocaleString("es-UY")}` : "—"}</div>
        </div>
        {solicitud.especificacion && <p className="text-ink/60 mt-3">{solicitud.especificacion}</p>}
        {puedeEditar && solicitud.estado === "aprobada" && (
          <ActionForm action={marcarPedidaFormAction} className="mt-3 inline-block mr-2"><input type="hidden" name="id" value={solicitud.id} />
            <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-1.5 text-xs font-semibold">Marcar como pedida al proveedor</button>
          </ActionForm>
        )}
        {puedeEditar && (solicitud.estado === "aprobada" || solicitud.estado === "pedida") && (
          <ActionForm action={marcarEntregadaFormAction} className="mt-3 inline-block"><input type="hidden" name="id" value={solicitud.id} />
            <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-1.5 text-xs font-semibold">Marcar como entregada</button>
          </ActionForm>
        )}
        {puedeAprobar && (solicitud.estado === "pendiente_cotizacion" || solicitud.estado === "en_comparacion") && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-rojo)]">Rechazar esta solicitud</summary>
            <ActionForm action={rechazarSolicitudFormAction} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="id" value={solicitud.id} />
              <input name="motivo" placeholder="Motivo del rechazo" className={inputClass + " text-xs"} />
              <button className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Confirmar rechazo</button>
            </ActionForm>
          </details>
        )}
        {user.rol === "admin" && (
          <details className="mt-4 pt-3 border-t border-ink/10">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-rojo)]">Zona de administrador: eliminar esta solicitud</summary>
            <p className="text-xs text-ink/50 mt-2">Esto borra la solicitud y sus presupuestos/decisión asociados de forma permanente. Usalo solo para corregir un error de carga o limpiar datos de prueba — para una compra real que ya no corresponde, usá &quot;Rechazar&quot; en su lugar.</p>
            <div className="mt-2">
              <ConfirmarEliminar
                action={eliminarSolicitudFormAction}
                hiddenFields={{ id: solicitud.id, confirmacion: "ELIMINAR" }}
                titulo="¿Eliminar esta solicitud de compra?"
                descripcion={`Se va a borrar "${solicitud.material}" y sus presupuestos/decisión asociados de forma permanente. Esta acción no se puede deshacer.`}
                className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap"
              />
            </div>
          </details>
        )}
      </Card>

      {decision && (
        <Card className="!border-[var(--color-verde)]/30 bg-[var(--color-verde-bg)]/40">
          <p className="text-sm font-semibold text-[var(--color-verde)]">Decisión registrada</p>
          <p className="text-sm mt-1">Se eligió a <Link href={`/proveedores/${decision.proveedor_id}`} className="font-semibold underline underline-offset-2">{decision.proveedor_nombre}</Link> por <strong>${decision.monto?.toLocaleString("es-UY")}</strong>, decidido por {decision.decidido_por} el {dayjs(decision.fecha).format("DD/MM/YYYY")}.</p>
          {decision.motivo && <p className="text-xs text-ink/60 mt-1">Motivo: {decision.motivo}</p>}
        </Card>
      )}
    </>
  );

  // Rediseño profundo de Compras, Fase 3 (sección 10: comparador visual lado
  // a lado). `PurchaseComparison` es ahora la forma principal de comparar;
  // el resumen de texto de `compararPresupuestos()` (`comparacion.texto`) NO
  // se eliminó — sigue siendo una función útil (detecta más barato/más
  // rápido/con garantía en una frase) y se muestra más chico, como apoyo.
  const tabPresupuestos = (
    <>
      {comparacion.presupuestos.length === 0 ? (
        <EmptyState>Todavía no hay presupuestos cargados para esta solicitud.</EmptyState>
      ) : (
        <>
          <PurchaseComparison presupuestos={comparacion.presupuestos} puedeElegir={puedeElegirProveedor} />
          {/* Las marcas 🏆/⚡ de arriba ya muestran lo mismo que las primeras
              líneas de `comparacion.texto` — acá sólo se agregan, como apoyo,
              las dos líneas de ese texto que NO se repiten visualmente: el
              aviso de "menos de tres presupuestos" y el disclaimer de que
              esto no reemplaza la decisión de la persona/órgano competente. */}
          {comparacion.presupuestos.length < 3 && (
            <p className="text-xs text-ink-faint mt-3">Hay menos de tres presupuestos cargados — la buena práctica recomendada es comparar al menos tres antes de decidir.</p>
          )}
          <p className="text-xs text-ink-faint mt-1">Esta comparación es una vista objetiva de los datos cargados, no una recomendación de a quién comprarle.</p>
        </>
      )}
      {puedeEditar && (solicitud.estado === "pendiente_cotizacion" || solicitud.estado === "en_comparacion") && (
        <div className="mt-4">
          <CargarPresupuestoForm solicitudId={solicitud.id} proveedores={proveedores} abiertoPorDefecto={comparacion.presupuestos.length < 3} />
        </div>
      )}
    </>
  );

  // Rediseño profundo de Compras, Fase 4 (pedido explícito, sección 21):
  // hallazgo de la Fase 3 (no existía ningún vínculo real entre una compra
  // puntual y la tabla `documentos`) ya resuelto — migración 0026 agrega
  // `documentos.solicitud_compra_id`, y `adjuntarFacturaCompraAction`
  // (compras.ts) permite subir directo desde acá. La descarga reutiliza sin
  // cambios la misma ruta mediada que ya usa /documentos
  // (`/api/archivos/documento/[id]`, sesión + permiso + cooperativa
  // verificados de nuevo en cada descarga).
  const tabDocumentos = (
    <>
      {documentos.length === 0 ? (
        <EmptyState>Todavía no hay facturas ni comprobantes adjuntos a esta solicitud.</EmptyState>
      ) : (
        <div className="space-y-2 mb-4">
          {documentos.map((d: any) => (
            <Card key={d.id} className="flex items-center justify-between text-sm">
              <div className="min-w-0">
                <p className="font-semibold truncate">{d.nombre}</p>
                <p className="text-xs text-ink/50">
                  {d.descripcion && `${d.descripcion} · `}
                  {d.subido_por && `subido por ${d.subido_por} · `}
                  {dayjs(d.fecha).format("DD/MM/YYYY")}
                </p>
              </div>
              <a href={`/api/archivos/documento/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap ml-3">
                Ver / Descargar
              </a>
            </Card>
          ))}
        </div>
      )}
      {puedeEditar && <AdjuntarFacturaForm solicitudId={solicitud.id} />}
      <p className="text-xs text-ink-faint mt-3">
        Esto adjunta el comprobante directamente a esta compra. La biblioteca general de la cooperativa sigue disponible en{" "}
        <Link href="/documentos" className="underline underline-offset-2">Documentos</Link>.
      </p>
    </>
  );

  return (
    <div>
      <PageHeader title={solicitud.material} subtitle={`${solicitud.cantidad} ${solicitud.unidad} · ${solicitud.comision}`}
        action={
          <div className="flex items-center gap-2">
            {puedeEditarDatos && (
              <EditarSolicitudForm
                solicitud={{
                  id: solicitud.id,
                  categoria: solicitud.categoria,
                  subcategoria: solicitud.subcategoria ?? null,
                  recurrente: Boolean(solicitud.recurrente),
                  material: solicitud.material,
                  cantidad: solicitud.cantidad,
                  unidad: solicitud.unidad,
                  especificacion: solicitud.especificacion ?? null,
                  prioridad: solicitud.prioridad,
                  etapa_obra: solicitud.etapa_obra ?? null,
                  fecha_necesaria: solicitud.fecha_necesaria ?? null,
                  presupuesto_estimado: solicitud.presupuesto_estimado ?? null,
                }}
              />
            )}
            <Badge color={solicitud.prioridad === "critica" ? "rojo" : "brand"}>{solicitud.prioridad}</Badge>
          </div>
        } />

      <Tabs
        tabs={[
          { id: "info", label: "Información", content: tabInformacion },
          { id: "presupuestos", label: `Presupuestos${comparacion.presupuestos.length ? ` (${comparacion.presupuestos.length})` : ""}`, content: tabPresupuestos },
          { id: "documentos", label: `Documentos${documentos.length ? ` (${documentos.length})` : ""}`, content: tabDocumentos },
          { id: "historial", label: "Historial", content: <Card><HistorialCompra registros={historial} /></Card> },
        ]}
      />
    </div>
  );
}
