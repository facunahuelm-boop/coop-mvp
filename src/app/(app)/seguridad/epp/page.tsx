import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { EntregarEppForm } from "@/components/seguridad/SeguridadObra";
import { hoyEnUruguay } from "@/lib/horasObra";
import { anularEppFormAction } from "@/lib/actions/seguridadObra";
import { puedeGestionarSeguridad, personasDeLaCooperativa, clavePersona, ELEMENTOS_EPP } from "@/lib/seguridadObra";

type Entrega = {
  id: number;
  socio_id: number | null;
  integrante_id: number | null;
  persona_nombre: string;
  elemento: string;
  talle: string | null;
  cantidad: number;
  fecha: string;
  observaciones: string | null;
  entregado_por: string | null;
};

const dmy = (f: string) => f.slice(0, 10).split("-").reverse().join("/");

/** Fase 3E — elementos de protección personal entregados a cada persona, con constancia. */
export default async function EppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "seguridad")) redirect("/dashboard");
  const puede = await puedeGestionarSeguridad(user);
  if (!puede) redirect("/seguridad");
  const hoy = hoyEnUruguay();
  const [personas, entregas] = await Promise.all([
    personasDeLaCooperativa(),
    all<Entrega>(
      `SELECT e.id, e.socio_id, e.integrante_id, e.persona_nombre, e.elemento, e.talle, e.cantidad, e.fecha, e.observaciones, u.nombre AS entregado_por
         FROM epp_entregas e LEFT JOIN users u ON u.id = e.entregado_por_id
        WHERE e.anulado_en IS NULL ORDER BY e.fecha DESC, e.id DESC`
    ).catch(() => [] as Entrega[]),
  ]);
  const porPersona = new Map<string, Entrega[]>();
  for (const e of entregas) {
    const k = clavePersona(e) ?? `x-${e.id}`;
    porPersona.set(k, [...(porPersona.get(k) ?? []), e]);
  }
  const nucleoDe = new Map(personas.map((p) => [p.clave, p.nucleo]));
  const sinEpp = personas.filter((p) => !porPersona.has(p.clave));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Elementos de protección (EPP)"
        subtitle="Qué se le entregó a cada persona, con su constancia para firmar"
        action={<Link href="/seguridad" className="text-sm font-semibold underline underline-offset-2">Volver a Seguridad</Link>}
      />
      <Card className="mb-6">
        <EntregarEppForm personas={personas.map((p) => ({ clave: p.clave, nombre: p.nombre, nucleo: p.nucleo }))} elementos={ELEMENTOS_EPP} hoy={hoy} />
      </Card>

      <SectionTitle>Entregas por persona</SectionTitle>
      <div className="space-y-3 mb-6">
        {[...porPersona.entries()].map(([clave, lista]) => (
          <Card key={clave}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[17px] font-semibold text-ink">
                {lista[0].persona_nombre}
                {nucleoDe.get(clave) && <span className="font-normal text-ink-muted"> — {nucleoDe.get(clave)}</span>}
              </p>
              {!clave.startsWith("x-") && (
                <a href={`/api/seguridad/constancia-epp/${clave}`} target="_blank" rel="noopener" className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
                  Constancia (PDF)
                </a>
              )}
            </div>
            <ul className="mt-2 divide-y divide-border">
              {lista.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                  <span>
                    {e.cantidad > 1 ? `${e.cantidad} × ` : ""}
                    {e.elemento}
                    {e.talle ? ` (talle ${e.talle})` : ""} · {dmy(e.fecha)}
                    {e.observaciones && <span className="block text-sm text-ink-muted">{e.observaciones}</span>}
                  </span>
                  <FormularioEnModal
                    textoBoton="Anular"
                    titulo="Anular la entrega"
                    descripcion={`${e.elemento} de ${e.persona_nombre}. Queda en el historial como anulada.`}
                    action={anularEppFormAction}
                    ocultos={{ id: e.id }}
                    textoConfirmar="Anular"
                    peligro
                    mensajeExito="Entrega anulada."
                    claseBoton="text-sm font-semibold text-ink-muted underline underline-offset-2"
                  >
                    <label className="block">
                      <Label required>Motivo</Label>
                      <input name="motivo" required maxLength={300} className={inputClass} />
                    </label>
                  </FormularioEnModal>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        {porPersona.size === 0 && <EmptyState>Todavía no se anotó ninguna entrega.</EmptyState>}
      </div>

      {sinEpp.length > 0 && (
        <details className="mb-6">
          <summary className="cursor-pointer text-[15px] font-semibold text-ink">
            {sinEpp.length} {sinEpp.length === 1 ? "persona sin" : "personas sin"} ningún elemento entregado
          </summary>
          <Card className="mt-2">
            <ul className="columns-1 sm:columns-2 text-[15px]">
              {sinEpp.map((p) => (
                <li key={p.clave} className="py-0.5">
                  {p.nombre}
                  {p.nucleo && <span className="text-ink-muted"> — {p.nucleo}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </details>
      )}
    </div>
  );
}
