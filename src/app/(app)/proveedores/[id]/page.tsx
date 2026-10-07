import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get } from "@/lib/db";
import { historialProveedor } from "@/lib/logic";
import { Card, PageHeader, EmptyState, Badge, StatTile, SectionTitle } from "@/components/ui";
import dayjs from "dayjs";
import { eliminarProveedorFormAction } from "@/lib/actions/proveedores";
import { ConfirmarEliminar } from "@/components/ConfirmarEliminar";
import { ESTADO_PROVEEDOR, ESTADO_PROVEEDOR_LABEL, TIPO_PROVEEDOR, TIPO_PROVEEDOR_LABEL } from "@/lib/constants";
import { ActualizarProveedorForm } from "@/components/proveedores/ProveedoresFormularios";
import { AgregarDocProveedorForm, BajaDocProveedorForm } from "@/components/proveedores/DocumentacionProveedor";
import { documentosDeProveedor, estadoDoc, ESTADO_DOC_LABEL, ESTADO_DOC_COLOR, TIPO_DOC_PROVEEDOR_LABEL } from "@/lib/proveedoresDocs";
import { hoyEnUruguay } from "@/lib/horasObra";

const ESTADO_COLOR: Record<string, "verde" | "amarillo" | "brand" | "gray"> = {
  nuevo: "amarillo", habitual: "verde", en_evaluacion: "brand", inactivo: "gray",
};

/**
 * Ficha de proveedor (Fase 08 del Plan Maestro). historialProveedor() ya
 * existía en lib/logic.ts —incluso el asistente de IA ya la usa para
 * responder "¿a quién le compramos X?" y cita como fuente "Ficha de
 * proveedor"— pero hasta esta pantalla esa fuente no tenía adónde apuntar.
 */
export default async function ProveedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const proveedor = await get<any>(`SELECT * FROM proveedores WHERE id = ?`, [id]);
  if (!proveedor) notFound();
  const puedeEditar = canEdit(user.rol, "compras");

  const historial = await historialProveedor(Number(id));
  const hoy = hoyEnUruguay();
  const docs = await documentosDeProveedor(Number(id));
  const hayVencidos = docs.some((d) => estadoDoc(d, hoy) === "vencido");
  const totalComprado = historial.reduce((acc: number, h: any) => acc + Number(h.monto || 0), 0);
  const estadoProveedor = (proveedor.estado || "nuevo") as (typeof ESTADO_PROVEEDOR)[number];

  return (
    <div>
      <PageHeader
        title={proveedor.nombre}
        subtitle={proveedor.rubro || "Proveedor"}
        action={<Badge color={ESTADO_COLOR[estadoProveedor]}>{ESTADO_PROVEEDOR_LABEL[estadoProveedor]}</Badge>}
      />

      <Link href="/proveedores" className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">
        ← Volver a proveedores
      </Link>

      <Card className="mt-4 mb-6">
        {/* Auditoría de espacio (extendida al resto del sistema): antes
            "Total comprado" vivía en su propia Card completa para un solo
            dato — se integra como StatTile dentro de la misma ficha, en vez
            de una caja aparte. */}
        <div className="mb-4">
          <StatTile label="Total comprado a este proveedor" value={totalComprado > 0 ? `$${totalComprado.toLocaleString("es-UY")}` : "—"} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-ink/50">RUT:</span> {proveedor.rut || "—"}</div>
          <div><span className="text-ink/50">Tipo:</span> {TIPO_PROVEEDOR_LABEL[proveedor.tipo as typeof TIPO_PROVEEDOR[number]] || "—"}</div>
          <div><span className="text-ink/50">Teléfono:</span> {proveedor.telefono || "—"}</div>
          <div><span className="text-ink/50">Email:</span> {proveedor.email || "—"}</div>
          <div><span className="text-ink/50">Dirección:</span> {proveedor.direccion || "—"}</div>
          <div><span className="text-ink/50">Persona de contacto:</span> {proveedor.persona_contacto || "—"}</div>
          <div><span className="text-ink/50">Contacto:</span> {proveedor.contacto || "—"}</div>
          <div><span className="text-ink/50">Rubro:</span> {proveedor.rubro || "—"}</div>
          <div><span className="text-ink/50">Alta:</span> {proveedor.creado_en ? dayjs(proveedor.creado_en).format("DD/MM/YYYY") : "—"}</div>
          {proveedor.notas && <div className="sm:col-span-2"><span className="text-ink/50">Notas:</span> {proveedor.notas}</div>}
        </div>

        {puedeEditar && <ActualizarProveedorForm proveedor={proveedor} />}
        {user.rol === "admin" && (
          <details className="mt-4 pt-3 border-t border-ink/10">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-rojo)]">Zona de administrador: eliminar este proveedor</summary>
            <p className="text-xs text-ink/50 mt-2">
              Esto manda el proveedor a la papelera (deja de verse, pero no se borra y queda registrado el motivo). Solo funciona si nunca presupuestó ninguna compra — si ya tiene historial, cambiá su estado a &quot;Inactivo&quot; más arriba en su lugar. Usalo solo para corregir un alta por error o limpiar datos de prueba.
            </p>
            <div className="mt-2">
              <ConfirmarEliminar
                action={eliminarProveedorFormAction}
                hiddenFields={{ id: proveedor.id, confirmacion: "ELIMINAR" }}
                titulo="¿Eliminar este proveedor?"
                descripcion={`"${proveedor.nombre}" va a pasar a la papelera: deja de verse en la app, pero no se borra.`}
                pedirMotivo
                confirmarLabel="Sí, mandar a la papelera"
                className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap"
              />
            </div>
          </details>
        )}
      </Card>

      <SectionTitle action={puedeEditar ? <AgregarDocProveedorForm proveedorId={proveedor.id} /> : undefined}>Documentación</SectionTitle>
      <Card className="mb-6">
        {hayVencidos && (
          <p className="mb-3 rounded-xl bg-[var(--color-rojo-bg)] px-3 py-2 text-[15px] text-[var(--color-rojo)]">
            Tiene documentación vencida: al elegirlo en una compra se va a pedir confirmarlo.
          </p>
        )}
        {docs.length === 0 ? (
          <EmptyState>No hay documentación cargada (certificados de BPS y DGI, seguro del BSE, habilitaciones).</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => {
              const e = estadoDoc(d, hoy);
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
                  <span className="min-w-0">
                    <b className="text-ink">{TIPO_DOC_PROVEEDOR_LABEL[d.tipo] ?? d.tipo}</b>
                    {d.descripcion ? <span className="text-ink-muted"> · {d.descripcion}</span> : null}
                    <span className="block text-sm text-ink-muted">
                      {d.fecha_vencimiento ? `Vence el ${d.fecha_vencimiento.split("-").reverse().join("/")}` : "Sin fecha de vencimiento"}
                      {d.archivo_url ? (
                        <>
                          {" · "}
                          <a href={`/api/archivos/documento/${d.documento_id}`} className="underline">
                            Ver archivo
                          </a>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge color={ESTADO_DOC_COLOR[e]}>{ESTADO_DOC_LABEL[e]}</Badge>
                    {puedeEditar && <BajaDocProveedorForm id={d.id} />}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <SectionTitle>Historial de compras</SectionTitle>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Material</th>
                <th className="py-2 pr-3">Comisión</th>
                <th className="py-2 pr-3 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h: any, i: number) => (
                <tr key={i} className="border-b border-ink/5 last:border-0">
                  <td className="py-2 pr-3">{dayjs(h.fecha).format("DD/MM/YYYY")}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/compras/${h.solicitud_id}`} className="text-[var(--color-brand-900)] hover:underline underline-offset-2">{h.material}</Link>
                  </td>
                  <td className="py-2 pr-3 text-ink/60">{h.comision_nombre || "—"}</td>
                  <td className="py-2 pr-3 text-right font-medium">${Number(h.monto || 0).toLocaleString("es-UY")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {historial.length === 0 && <EmptyState>Todavía no se le compró nada a este proveedor.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
