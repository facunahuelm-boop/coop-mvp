import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, SectionTitle, EmptyState } from "@/components/ui";
import { listarHitos, hitoVencido, pasoActual } from "@/lib/tramites";
import { ESTADO_HITO_LABEL, ESTADO_HITO_COLOR, CATEGORIA_HITO_LABEL } from "@/lib/tramitesTexto";
import { puedeEditarTramites } from "@/lib/actions/tramites";
import { hoyEnUruguay } from "@/lib/horasObra";
import { LineaDeTiempo } from "@/components/tramites/LineaDeTiempo";
import { HitoForm, CambiarEstadoHitoForm, MoverHito, QuitarHitoForm, CargarPlantillaBoton } from "@/components/tramites/TramitesFormularios";

/**
 * Fase 2E — Trámites e hitos (Pre-obra): los pasos para llegar a la obra,
 * con responsable, fecha y estado. El socio ve «¿En qué estamos?».
 */
export default async function TramitesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const edita = await puedeEditarTramites(user.rol);
  const hoy = hoyEnUruguay();
  const hitos = await listarHitos(!edita);
  const usuarios = edita ? await all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 ORDER BY nombre`) : [];
  const actual = pasoActual(hitos);
  const hechos = hitos.filter((h) => h.estado === "hecho").length;
  const cuentan = hitos.filter((h) => h.estado !== "no_aplica").length;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="¿En qué estamos?"
        subtitle="Los pasos que la cooperativa tiene que cumplir para llegar a la obra."
        action={edita ? <div className="flex flex-wrap gap-2">{hitos.length === 0 && <CargarPlantillaBoton />}<HitoForm usuarios={usuarios} /></div> : undefined}
      />
      {hitos.length === 0 ? (
        <Card>
          <EmptyState>{edita ? "Todavía no hay pasos cargados. Podés empezar con los pasos típicos y ajustarlos." : "La cooperativa todavía no cargó los pasos."}</EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-5">
            <p className="mb-3 text-[15px] text-ink">
              Van <b>{hechos}</b> de <b>{cuentan}</b> pasos.{actual ? <> Ahora: <b>{actual.titulo}</b>.</> : " ¡Todos los pasos están cumplidos!"}
            </p>
            <div className="mb-4 h-3 overflow-hidden rounded-full bg-ink/5">
              <div className="h-full rounded-full bg-[var(--color-verde)]" style={{ width: `${cuentan ? Math.round((hechos / cuentan) * 100) : 0}%` }} />
            </div>
            <LineaDeTiempo hitos={hitos.filter((h) => h.visible_socios)} hoy={hoy} />
          </Card>

          {edita && (
            <>
              <SectionTitle>Detalle para quien gestiona</SectionTitle>
              <Card>
                <ul className="divide-y divide-border">
                  {hitos.map((h, i) => {
                    const vencido = hitoVencido(h, hoy);
                    return (
                      <li key={h.id} className="py-3 text-[15px]">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <b className="text-ink">{h.titulo}</b> <Badge color={ESTADO_HITO_COLOR[h.estado]}>{ESTADO_HITO_LABEL[h.estado]}</Badge>{" "}
                            {vencido && <Badge color="rojo">Pasó la fecha</Badge>} {!h.visible_socios && <Badge color="gray">Interno</Badge>}
                            <span className="block text-sm text-ink-muted">
                              {CATEGORIA_HITO_LABEL[h.categoria] ?? h.categoria}
                              {h.responsable_nombre || h.responsable_texto ? ` · Responsable: ${h.responsable_nombre ?? h.responsable_texto}` : ""}
                              {h.fecha_estimada ? ` · Previsto: ${h.fecha_estimada.split("-").reverse().join("/")}` : ""}
                              {h.documentos ? ` · ${h.documentos} documento(s)` : ""}
                            </span>
                            {h.descripcion && <span className="block text-sm text-ink-muted">{h.descripcion}</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <CambiarEstadoHitoForm id={h.id} actual={h.estado} hoy={hoy} />
                            <HitoForm hito={h} usuarios={usuarios} />
                            <MoverHito id={h.id} primero={i === 0} ultimo={i === hitos.length - 1} />
                            <QuitarHitoForm id={h.id} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
