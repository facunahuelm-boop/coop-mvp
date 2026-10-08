import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { Card, PageHeader, EmptyState, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { obtenerReglamento } from "@/lib/reglamento";
import { conceptosCuota } from "@/lib/habitada";
import { guardarConceptoFormAction, desactivarConceptoFormAction } from "@/lib/actions/habitada";

const pesos = (n: number) => `$ ${n.toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;
const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-4 py-2.5 text-sm font-semibold text-white";
const botonLink = "text-sm font-semibold text-ink-muted underline underline-offset-2";

/** Fase 3H — lo que se cobra cada mes además de la cuota social. */
export default async function ConceptosCuotaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "finanzas")) redirect("/dashboard");
  const puede = canEdit(user.rol, "finanzas");
  const [conceptos, reglamento] = await Promise.all([conceptosCuota(), obtenerReglamento()]);
  const total = conceptos.reduce((a, c) => a + c.monto, 0);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Conceptos de la cuota" subtitle="Lo que se cobra cada mes además de la cuota social" action={<Link href="/finanzas" className="text-sm font-semibold underline underline-offset-2">Volver a Finanzas</Link>} />
      <Card>
        <p className="text-[15px] text-ink">
          Cuando se generan las cuotas del mes ({reglamento.cuotas.automaticas ? "solas, según el reglamento" : "con el botón «Generar ahora» de Reglas y avisos"}), a cada socio se le suma un cargo por cada concepto: por ejemplo el fondo de mantenimiento o los gastos comunes. Cada uno se ve por separado en su estado de cuenta.
        </p>
      </Card>
      <Card>
        <ul className="divide-y divide-border">
          <li className="flex items-center justify-between py-2.5 text-[15px] text-ink-muted">
            <span>{reglamento.cuotas.concepto} (del reglamento o del núcleo)</span>
            <span>{reglamento.cuotas.monto ? pesos(reglamento.cuotas.monto) : "según cada núcleo"}</span>
          </li>
          {conceptos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
              <span className="font-semibold">{c.nombre}</span>
              <span className="flex items-center gap-3">
                {pesos(c.monto)}
                {puede && (
                  <>
                    <FormularioEnModal textoBoton="Cambiar" claseBoton={botonLink} titulo={`Cambiar ${c.nombre}`} action={guardarConceptoFormAction} ocultos={{ id: c.id }}>
                      <Campos nombre={c.nombre} monto={c.monto} orden={c.orden} />
                    </FormularioEnModal>
                    <FormularioEnModal textoBoton="Dar de baja" claseBoton={botonLink} titulo={`Dar de baja ${c.nombre}`} descripcion="Deja de generarse desde el próximo mes. Lo ya cobrado queda." action={desactivarConceptoFormAction} ocultos={{ id: c.id }} textoConfirmar="Dar de baja" peligro />
                  </>
                )}
              </span>
            </li>
          ))}
          {conceptos.length === 0 && <EmptyState>No hay otros conceptos: sólo se cobra la cuota social.</EmptyState>}
        </ul>
        {conceptos.length > 0 && <p className="mt-2 text-sm text-ink-muted">Otros conceptos por mes: {pesos(total)} por socio.</p>}
      </Card>
      {puede && (
        <FormularioEnModal textoBoton="+ Agregar concepto" claseBoton={botonPrincipal} titulo="Nuevo concepto de la cuota" action={guardarConceptoFormAction}>
          <Campos />
        </FormularioEnModal>
      )}
    </div>
  );
}

function Campos({ nombre, monto, orden }: { nombre?: string; monto?: number; orden?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block sm:col-span-2">
        <Label required>Nombre</Label>
        <input name="nombre" required maxLength={100} defaultValue={nombre} className={inputClass} placeholder="Fondo de mantenimiento" />
      </label>
      <label className="block">
        <Label required>Monto por mes ($)</Label>
        <input name="monto" type="number" step="0.01" min={0} required defaultValue={monto} className={inputClass} />
      </label>
      <label className="block">
        <Label>Orden</Label>
        <input name="orden" type="number" min={0} max={99} defaultValue={orden ?? ""} className={inputClass} />
      </label>
    </div>
  );
}
