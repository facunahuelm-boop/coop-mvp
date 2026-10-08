import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Label, inputClass, Badge } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { RegistrarInduccionForm } from "@/components/seguridad/SeguridadObra";
import { hoyEnUruguay } from "@/lib/horasObra";
import { obtenerReglamento } from "@/lib/reglamento";
import { anularInduccionFormAction } from "@/lib/actions/seguridadObra";
import { puedeGestionarSeguridad, personasDeLaCooperativa, clavePersona } from "@/lib/seguridadObra";

type Induccion = { id: number; socio_id: number | null; integrante_id: number | null; persona_nombre: string; fecha: string; dictada_por: string | null; temas: string | null };

const dmy = (f: string) => f.slice(0, 10).split("-").reverse().join("/");

/** Fase 3E — inducción de seguridad: quién la hizo, y qué núcleos todavía no tienen a nadie con inducción. */
export default async function InduccionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "seguridad")) redirect("/dashboard");
  const puede = await puedeGestionarSeguridad(user);
  const hoy = hoyEnUruguay();
  const [personas, inducciones, reglamento] = await Promise.all([
    personasDeLaCooperativa(),
    all<Induccion>(
      `SELECT id, socio_id, integrante_id, persona_nombre, fecha, dictada_por, temas FROM inducciones_seguridad WHERE anulado_en IS NULL ORDER BY fecha DESC, id DESC`
    ).catch(() => [] as Induccion[]),
    obtenerReglamento(),
  ]);
  const con = new Set(inducciones.map(clavePersona).filter(Boolean));
  const sin = personas.filter((p) => !con.has(p.clave));
  // Núcleos donde nadie tiene la inducción (no se les deberían asignar horas de obra).
  const nucleos = new Map<number, { nombre: string; alguno: boolean }>();
  for (const p of personas) {
    if (!p.nucleo_id) continue;
    const n = nucleos.get(p.nucleo_id) ?? { nombre: p.nucleo ?? "", alguno: false };
    n.alguno ||= con.has(p.clave);
    nucleos.set(p.nucleo_id, n);
  }
  const nucleosSin = [...nucleos.values()].filter((n) => !n.alguno).map((n) => n.nombre).sort();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Inducción de seguridad"
        subtitle="Nadie debería ir a la obra sin haberla hecho"
        action={<Link href="/seguridad" className="text-sm font-semibold underline underline-offset-2">Volver a Seguridad</Link>}
      />
      <Card className="mb-6">
        <p className="text-[15px] text-ink">
          {inducciones.length === 0
            ? "Cuando se registre la primera inducción, COOVA empieza a controlar que los núcleos con horas de obra la tengan."
            : reglamento.obra.induccionModo === "bloquear"
              ? "Según el reglamento, no se le pueden asignar horas de obra a un núcleo donde nadie hizo la inducción."
              : "Según el reglamento, si se le asignan horas de obra a un núcleo donde nadie hizo la inducción, se avisa pero se deja."}{" "}
          <Link href="/reglamento" className="underline underline-offset-2">Ver el reglamento</Link>
        </p>
        {inducciones.length > 0 && nucleosSin.length > 0 && (
          <p className="mt-2 text-[15px] text-ink">
            <Badge color="amarillo">{nucleosSin.length}</Badge> {nucleosSin.length === 1 ? "núcleo sin" : "núcleos sin"} nadie con inducción: {nucleosSin.join(", ")}.
          </p>
        )}
      </Card>

      {puede && (
        <>
          <SectionTitle>Registrar una inducción</SectionTitle>
          <Card className="mb-6">
            <RegistrarInduccionForm personas={sin.map((p) => ({ clave: p.clave, nombre: p.nombre, nucleo: p.nucleo }))} hoy={hoy} />
          </Card>
        </>
      )}

      <SectionTitle>{`Hicieron la inducción (${inducciones.length})`}</SectionTitle>
      <Card className="mb-6">
        <ul className="divide-y divide-border">
          {inducciones.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
              <span>
                <span className="font-semibold">{i.persona_nombre}</span> · {dmy(i.fecha)}
                {i.dictada_por && <span className="text-ink-muted"> · la dio {i.dictada_por}</span>}
                {i.temas && <span className="block text-sm text-ink-muted">{i.temas}</span>}
              </span>
              {puede && (
                <FormularioEnModal
                  textoBoton="Anular"
                  titulo="Anular la inducción"
                  descripcion={`La de ${i.persona_nombre}. Queda en el historial como anulada.`}
                  action={anularInduccionFormAction}
                  ocultos={{ id: i.id }}
                  textoConfirmar="Anular"
                  peligro
                  mensajeExito="Inducción anulada."
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
          {inducciones.length === 0 && <EmptyState>Todavía no se registró ninguna inducción.</EmptyState>}
        </ul>
      </Card>
    </div>
  );
}
