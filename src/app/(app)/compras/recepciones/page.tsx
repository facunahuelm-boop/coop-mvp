import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { RecepcionForm } from "@/components/obra/ObraRecursos";
import { hoyEnUruguay } from "@/lib/horasObra";
import { puedeRecibirMateriales, numeroTexto } from "@/lib/obraRecursos";
import { anularRecepcionFormAction } from "@/lib/actions/obraRecursos";

type Recepcion = {
  id: number;
  solicitud_id: number | null;
  fecha: string;
  material: string;
  unidad: string | null;
  cantidad_pedida: number | null;
  cantidad_recibida: number;
  remito_numero: string | null;
  remito_foto_url: string | null;
  conforme: number;
  diferencias: string | null;
  proveedor: string | null;
  recibio: string | null;
  al_panol: boolean;
};

const dmy = (f: string) => f.slice(0, 10).split("-").reverse().join("/");

/** Fase 3C — lo que llegó a la obra, contra lo pedido, con el remito. */
export default async function RecepcionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras") && !canRead(user.rol, "obra")) redirect("/dashboard");
  const puede = await puedeRecibirMateriales(user);
  const hoy = hoyEnUruguay();
  const [recepciones, sinRecibir] = await Promise.all([
    all<Recepcion>(
      `SELECT r.id, r.solicitud_id, r.fecha, r.material, r.unidad, r.cantidad_pedida, r.cantidad_recibida, r.remito_numero, r.remito_foto_url,
              r.conforme, r.diferencias, p.nombre AS proveedor, u.nombre AS recibio, (r.panol_item_id IS NOT NULL) AS al_panol
         FROM recepciones_material r LEFT JOIN proveedores p ON p.id = r.proveedor_id LEFT JOIN users u ON u.id = r.recibido_por_id
        WHERE r.anulado_en IS NULL ORDER BY r.fecha DESC, r.id DESC LIMIT 100`
    ).catch(() => [] as Recepcion[]),
    all<{ id: number; material: string; estado: string }>(
      `SELECT id, material, estado FROM solicitudes_compra WHERE estado IN ('aprobada', 'pedida') AND eliminado_en IS NULL ORDER BY id`
    ).catch(() => []),
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Recepción de materiales"
        subtitle="Lo que llegó a la obra, contra lo pedido, con la foto del remito"
        action={<Link href="/compras" className="text-sm font-semibold underline underline-offset-2">Volver a Compras</Link>}
      />

      {sinRecibir.length > 0 && (
        <Card className="mb-5">
          <p className="text-[15px] font-semibold text-ink">Compras que esperan su recepción ({sinRecibir.length})</p>
          <ul className="mt-1 text-[15px]">
            {sinRecibir.map((s) => (
              <li key={s.id}>
                <Link href={`/compras/${s.id}`} className="underline underline-offset-2">{s.material}</Link>{" "}
                <span className="text-ink-muted">({s.estado === "pedida" ? "pedida al proveedor" : "aprobada"})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {puede && (
        <details className="mb-6">
          <summary className="cursor-pointer text-[15px] font-semibold text-[var(--color-brand-800)]">Registrar algo que llegó sin una compra (donación, préstamo…)</summary>
          <Card className="mt-2">
            <RecepcionForm hoy={hoy} />
          </Card>
        </details>
      )}

      <SectionTitle>Lo que llegó</SectionTitle>
      <div className="space-y-2">
        {recepciones.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-[15px]">
                <p className="font-semibold text-ink">
                  {r.material} — {numeroTexto(Number(r.cantidad_recibida))} {r.unidad ?? ""}
                  {r.cantidad_pedida != null && Number(r.cantidad_pedida) !== Number(r.cantidad_recibida) && (
                    <span className="font-normal text-ink-muted"> (se pidieron {numeroTexto(Number(r.cantidad_pedida))})</span>
                  )}
                </p>
                <p className="text-sm text-ink-muted">
                  {dmy(r.fecha)}
                  {r.proveedor && ` · ${r.proveedor}`}
                  {r.remito_numero && ` · remito ${r.remito_numero}`}
                  {r.recibio && ` · recibió ${r.recibio}`}
                  {r.al_panol && " · al pañol"}
                </p>
                {r.diferencias && <p className="mt-1 text-sm text-ink">Diferencias: {r.diferencias}</p>}
                <p className="mt-1 flex flex-wrap gap-3 text-sm">
                  {r.solicitud_id && <Link href={`/compras/${r.solicitud_id}`} className="underline underline-offset-2">Ver la compra</Link>}
                  {r.remito_foto_url && <a href={`/api/archivos/remito/${r.id}`} target="_blank" rel="noopener" className="underline underline-offset-2">Foto del remito</a>}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge color={r.conforme ? "verde" : "amarillo"}>{r.conforme ? "Conforme" : "Con diferencias"}</Badge>
                {puede && (
                  <FormularioEnModal
                    textoBoton="Anular"
                    titulo="Anular la recepción"
                    descripcion="Si entró al pañol, esa entrada también se anula. Queda en el historial."
                    action={anularRecepcionFormAction}
                    ocultos={{ id: r.id }}
                    textoConfirmar="Anular"
                    peligro
                    mensajeExito="Recepción anulada."
                    claseBoton="text-sm font-semibold text-ink-muted underline underline-offset-2"
                  >
                    <label className="block">
                      <Label required>Motivo</Label>
                      <input name="motivo" required maxLength={300} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                )}
              </div>
            </div>
          </Card>
        ))}
        {recepciones.length === 0 && <EmptyState>Todavía no se registró ninguna recepción.</EmptyState>}
      </div>
    </div>
  );
}
