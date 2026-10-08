import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { Card, PageHeader, SectionTitle, Badge } from "@/components/ui";
import { CambiarEtapaForm } from "@/components/configuracion/CambiarEtapaForm";
import { revisarCambioEtapa, textoEtapa } from "@/lib/cambioEtapa";
import { ETAPAS_COOPERATIVA, type EtapaCooperativa } from "@/lib/comisionesFunciones";
import type { Modalidad } from "@/lib/plantillasAlta";

const DESCRIPCION: Record<EtapaCooperativa, string> = {
  pre_obra: "Trámites, terreno y proyecto, antes de empezar a construir.",
  obra: "Se está construyendo: horas de ayuda mutua, compras, seguridad y avance de obra.",
  habitada: "Las viviendas están terminadas y habitadas: cuotas, mantenimiento, reservas y la vida en la cooperativa.",
};

/** Fase 3H — asistente para cambiar la etapa de la cooperativa. */
export default async function CambiarEtapaPage({ searchParams }: { searchParams: Promise<{ hacia?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "consejo_directivo"].includes(user.rol)) redirect("/configuracion");
  const org = await get<{ etapa: EtapaCooperativa; modalidad: Modalidad | null }>(`SELECT etapa, modalidad FROM organizations WHERE id = ?`, [user.organization_id]).catch(() =>
    get<{ etapa: EtapaCooperativa; modalidad: Modalidad | null }>(`SELECT etapa, NULL AS modalidad FROM organizations WHERE id = ?`, [user.organization_id])
  );
  const actual = org?.etapa ?? "obra";
  const sp = await searchParams;
  const hacia = (ETAPAS_COOPERATIVA as readonly string[]).includes(sp.hacia ?? "") && sp.hacia !== actual ? (sp.hacia as EtapaCooperativa) : null;
  const revision = hacia ? await revisarCambioEtapa(actual, hacia, org?.modalidad ?? "ayuda_mutua") : null;

  return (
    <div className="max-w-3xl space-y-5 text-[16px]">
      <PageHeader title="Cambiar de etapa" subtitle={`Hoy la cooperativa está en ${textoEtapa(actual)}`} action={<Link href="/configuracion" className="text-sm font-semibold underline underline-offset-2">Volver a Configuración</Link>} />

      <SectionTitle>1. ¿A qué etapa pasa la cooperativa?</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ETAPAS_COOPERATIVA.map((e) => (
          <Link
            key={e}
            href={e === actual ? "#" : `/cambiar-etapa?hacia=${e}`}
            aria-disabled={e === actual}
            className={`block rounded-2xl border p-4 ${e === hacia ? "border-[var(--color-brand-800)] border-2" : "border-border"} ${e === actual ? "opacity-60 pointer-events-none" : "hover:bg-surface-sunken"}`}
          >
            <p className="font-bold text-ink">
              {textoEtapa(e)} {e === actual && <Badge color="gray">Actual</Badge>}
            </p>
            <p className="text-sm text-ink-muted">{DESCRIPCION[e]}</p>
          </Link>
        ))}
      </div>

      {revision && hacia && (
        <>
          <SectionTitle>{`2. Antes de pasar a ${textoEtapa(hacia)}`}</SectionTitle>
          <Card>
            <p className="font-semibold text-ink mb-1">Pendiente de {textoEtapa(actual)}</p>
            {revision.pendientes.length ? (
              <ul className="list-disc pl-5 space-y-1">
                {revision.pendientes.map((p) => (
                  <li key={p.texto}>{p.href ? <Link href={p.href} className="underline underline-offset-2">{p.texto}</Link> : p.texto}</li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">No queda nada pendiente.</p>
            )}
            <p className="mt-2 text-sm text-ink-muted">Se puede cambiar igual: nada se borra y todo queda como historial.</p>
          </Card>
          <Card>
            <p className="font-semibold text-ink mb-1">Qué cambia</p>
            <ul className="list-disc pl-5 space-y-1">
              {revision.menu.map((m) => (
                <li key={m}>{m}</li>
              ))}
              {revision.comisionesQueSeOcultan.length > 0 && <li>Dejan de estar activas (no corresponden a la etapa): {revision.comisionesQueSeOcultan.join(", ")}</li>}
            </ul>
          </Card>
          {revision.preparativos.length > 0 && (
            <Card>
              <p className="font-semibold text-ink mb-1">Para preparar</p>
              <ul className="space-y-1">
                {revision.preparativos.map((p) => (
                  <li key={p.texto}>
                    {p.hecho ? "✔ " : "○ "}
                    <Link href={p.href} className="underline underline-offset-2">{p.texto}</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <SectionTitle>3. Confirmar</SectionTitle>
          <Card>
            <CambiarEtapaForm hacia={hacia} textoHacia={textoEtapa(hacia)} sugeridas={revision.comisionesSugeridas} ofrecerFondo={revision.ofrecerFondoMantenimiento} />
          </Card>
        </>
      )}
    </div>
  );
}
