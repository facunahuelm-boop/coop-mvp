import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import { reactivarComisionFormAction } from "@/lib/actions/comisiones";
import { CrearComisionForm } from "@/components/comisiones/ComisionesFormularios";
import { ComisionResumenCard } from "@/components/comisiones/ComisionResumenCard";
import { cargarResumenComisiones, type ComisionRow } from "@/lib/comisionesResumen";
import { ETAPA_LABEL, textoEtapas, type EtapaCooperativa } from "@/lib/comisionesFunciones";

/**
 * Comisiones — tablero resumen (05/10, pedido explícito: "el dashboard
 * principal debe ser un mini resumen"). Cada comisión es una tarjeta chica;
 * al tocarla se abre un pop-up con su resumen y "Ver comisión completa"
 * lleva a /comisiones/[id], donde vive todo lo que antes se gestionaba acá
 * mismo (integrantes, tareas, edición) — no se perdió ninguna función, sólo
 * cambió de lugar.
 *
 * Las comisiones cuya función no corresponde a la etapa de la cooperativa
 * (ej. Trabajo antes de la obra) no aparecen como activas. Conducción las ve
 * aparte, plegadas, para poder revisarlas o cambiar sus etapas.
 */
export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ archivadas?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const { archivadas: verArchivadas } = await searchParams;
  // Crear/archivar una comisión es una decisión estructural: conducción
  // (mismo criterio que el backend, ver actions/comisiones.ts).
  const esOversightComisiones = canEdit(user.rol, "finanzas");

  const [comisiones, comisionesArchivadas] = await Promise.all([
    all<ComisionRow>(`SELECT * FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    verArchivadas === "1"
      ? all<ComisionRow>(`SELECT * FROM comisiones WHERE activa = 0 ORDER BY nombre ASC`)
      : Promise.resolve([] as ComisionRow[]),
  ]);
  const { tarjetas, fueraDeEtapa } = await cargarResumenComisiones(comisiones, user.etapa);
  const etapaLabel = ETAPA_LABEL[user.etapa as EtapaCooperativa] ?? user.etapa;

  return (
    <div>
      <PageHeader
        title="Comisiones"
        subtitle="Las áreas de trabajo de la cooperativa — tocá una para ver su resumen"
        action={esOversightComisiones ? <CrearComisionForm comisiones={comisiones} /> : undefined}
      />

      {tarjetas.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tarjetas.map((c) => (
            <ComisionResumenCard key={c.id} c={c} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState>
            {comisiones.length ? `No hay comisiones activas para la etapa actual (${etapaLabel}).` : "Todavía no hay comisiones creadas."}
          </EmptyState>
        </Card>
      )}

      {esOversightComisiones && fueraDeEtapa.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer select-none text-xs text-ink/50 hover:text-[var(--color-brand-800)] underline underline-offset-2">
            Comisiones que no corresponden a la etapa actual ({etapaLabel}) — {fueraDeEtapa.length}
          </summary>
          <p className="text-xs text-ink-faint mt-2 mb-2">
            No se muestran como activas para la cooperativa. Aparecen solas cuando la cooperativa pasa a la etapa que les corresponde; las etapas se cambian desde la comisión.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {fueraDeEtapa.map((c) => (
              <Card key={c.id} className="opacity-80">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/comisiones/${c.id}`} className="text-sm font-semibold text-ink/70 hover:underline underline-offset-2 truncate">
                    {c.nombre}
                  </Link>
                  <Badge color="gray">Disponible en: {textoEtapas(c)}</Badge>
                </div>
              </Card>
            ))}
          </div>
        </details>
      )}

      {/* Archivar nunca borra información (memoria institucional) — acá se
          pueden volver a consultar y reactivar. */}
      <div className="mt-6">
        <Link
          href={verArchivadas === "1" ? "/comisiones" : "/comisiones?archivadas=1"}
          className="text-xs text-ink/40 hover:text-[var(--color-brand-800)] underline underline-offset-2"
        >
          {verArchivadas === "1" ? "Ocultar archivadas" : "Ver comisiones archivadas"}
        </Link>
        {verArchivadas === "1" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {comisionesArchivadas.map((c) => (
              <Card key={c.id} className="opacity-70">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-ink/60 truncate">{c.nombre}</h4>
                  {esOversightComisiones && (
                    <ActionForm action={reactivarComisionFormAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="text-xs text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap">Reactivar</button>
                    </ActionForm>
                  )}
                </div>
                {c.objetivo && <p className="text-xs text-ink/40 mt-0.5">🎯 {c.objetivo}</p>}
              </Card>
            ))}
            {comisionesArchivadas.length === 0 && <p className="text-xs text-ink/40 italic">No hay comisiones archivadas.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
