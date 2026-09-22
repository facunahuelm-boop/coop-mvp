import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { puedeGestionarComision } from "@/lib/comisionAuth";
import { Card, PageHeader, Label, EmptyState, Badge } from "@/components/ui";
import { UsuarioLink } from "@/components/EntidadLink";
import dayjs from "dayjs";
import {
  EditarDecisionForm,
  DecidirDecisionForm,
  ReabrirDecisionForm,
  CrearVotacionForm,
  VotarForm,
  CerrarVotacionForm,
} from "@/components/decisiones/DecisionesFormularios";
import { ResultadoDecisionBadge, EstadoVotacionBadge, tipoVotacionLabel } from "@/components/decisiones/DecisionStatus";

// Fase 6 del sistema de gestión de Comisiones (19/09) — ficha completa de
// una decisión de comisión, mismo criterio que solicitudes/[id]/page.tsx
// (página propia, no modal: acá viven las acciones reales de servidor —
// editar/decidir/reabrir/abrir votación/votar/cerrar votación). Las
// consultas a tablas de la migración 0029 van con `.catch()` por si esta
// fase se despliega antes de que esa migración corra en producción.
export default async function DecisionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  type DecisionRow = {
    id: number;
    numero: string | null;
    comision_id: number;
    comision_nombre: string;
    tema: string;
    propuesta: string | null;
    resultado: string;
    fecha: string;
    decidido_por_nombre: string | null;
  };

  const decision = await get<DecisionRow>(
    `SELECT d.*, c.nombre as comision_nombre, u.nombre as decidido_por_nombre
     FROM decisiones_comision d
     JOIN comisiones c ON c.id = d.comision_id
     LEFT JOIN users u ON u.id = d.decidido_por_id
     WHERE d.id = ?`,
    [id]
  ).catch(() => undefined);
  if (!decision) notFound();

  const votaciones = await all<{ id: number; pregunta: string; tipo: string; opciones: string[]; fecha_cierre: string | null; estado: string; creado_en: string }>(
    `SELECT id, pregunta, tipo, opciones, fecha_cierre, estado, creado_en FROM votaciones WHERE decision_id = ? ORDER BY creado_en DESC`,
    [id]
  ).catch(() => []);

  const votacionesConRespuestas = await Promise.all(
    votaciones.map(async (v) => ({
      ...v,
      respuestas: await all<{ opcion: string; user_id: number; user_nombre: string }>(
        `SELECT vr.opcion, vr.user_id, u.nombre as user_nombre FROM voto_respuestas vr JOIN users u ON u.id = vr.user_id WHERE vr.votacion_id = ? ORDER BY u.nombre ASC`,
        [v.id]
      ).catch(() => []),
    }))
  );

  const esOversight = canEdit(user.rol, "finanzas");
  const puedeEditarModulo = canEdit(user.rol, "comisiones");
  const esParteDeLaComision = await puedeGestionarComision(user, decision.comision_id);
  const puedeGestionar = puedeEditarModulo && esParteDeLaComision;

  // Fase 12 (pruebas end-to-end) — mismo hallazgo y mismo criterio que
  // solicitudes/[id]/page.tsx: /decisiones sí filtra por comisión en el
  // listado para roles que no son de conducción (ver decisiones/page.tsx,
  // misComisionIds), así que la ficha no puede ser menos estricta — acá
  // además se filtran los resultados detallados de la votación (nombre y
  // voto de cada persona), que es información todavía más sensible que el
  // listado.
  if (!esParteDeLaComision) notFound();

  const hayVotacionAbierta = votacionesConRespuestas.some((v) => v.estado === "abierta");

  return (
    <div>
      <PageHeader
        title={`${decision.numero || "#" + decision.id} · ${decision.tema}`}
        subtitle={`${decision.comision_nombre} · ${dayjs(decision.fecha).format("DD/MM/YYYY")}`}
        action={<ResultadoDecisionBadge resultado={decision.resultado} />}
      />

      <Card className="mb-5 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><Label>Comisión</Label>{decision.comision_nombre}</div>
          <div><Label>Fecha</Label>{dayjs(decision.fecha).format("DD/MM/YYYY")}</div>
          <div><Label>Resultado</Label><ResultadoDecisionBadge resultado={decision.resultado} /></div>
          <div><Label>Decidido por</Label>{decision.decidido_por_nombre || "—"}</div>
        </div>
        {decision.propuesta && <p className="text-ink/70 mt-3 whitespace-pre-wrap">{decision.propuesta}</p>}

        {puedeGestionar && decision.resultado === "pendiente" && (
          <div className="mt-4 pt-4 border-t border-ink/10 space-y-3">
            <EditarDecisionForm id={decision.id} tema={decision.tema} propuesta={decision.propuesta} fecha={decision.fecha} />
            <DecidirDecisionForm id={decision.id} />
          </div>
        )}

        {esOversight && decision.resultado !== "pendiente" && (
          <div className="mt-4 pt-3 border-t border-ink/10">
            <ReabrirDecisionForm id={decision.id} />
          </div>
        )}

        {decision.resultado !== "pendiente" && !esOversight && (
          <p className="text-xs text-ink-faint mt-4 pt-3 border-t border-ink/10">
            Esta decisión ya fue resuelta ({decision.resultado === "aprobada" ? "aprobada" : "rechazada"}) — no admite más cambios.
          </p>
        )}
      </Card>

      <div>
        <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Votación</h3>
        <Card>
          {votacionesConRespuestas.length === 0 ? (
            <EmptyState>Todavía no se abrió ninguna votación para esta decisión.</EmptyState>
          ) : (
            <div className="space-y-5">
              {votacionesConRespuestas.map((v) => {
                const votoActual = v.respuestas.find((r) => r.user_id === user.id)?.opcion ?? null;
                const total = v.respuestas.length;
                const conteo = new Map<string, number>();
                for (const op of v.opciones) conteo.set(op, 0);
                for (const r of v.respuestas) conteo.set(r.opcion, (conteo.get(r.opcion) ?? 0) + 1);

                return (
                  <div key={v.id} className="pb-4 border-b border-ink/5 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="text-sm font-medium text-[var(--color-brand-900)]">{v.pregunta}</p>
                        <p className="text-xs text-ink/40">
                          {tipoVotacionLabel(v.tipo)}
                          {v.fecha_cierre ? ` · cierra ${dayjs(v.fecha_cierre).format("DD/MM/YYYY")}` : ""}
                        </p>
                      </div>
                      <EstadoVotacionBadge estado={v.estado} />
                    </div>

                    <div className="space-y-1.5 mb-3">
                      {v.opciones.map((op) => {
                        const cant = conteo.get(op) ?? 0;
                        const pct = total > 0 ? Math.round((cant / total) * 100) : 0;
                        return (
                          <div key={op} className="text-xs">
                            <div className="flex items-center justify-between text-ink/70">
                              <span>{op}</span>
                              <span className="text-ink/40">{cant} ({pct}%)</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-ink/5 mt-0.5 overflow-hidden">
                              <div className="h-full rounded-full bg-[var(--color-brand-800)]" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {v.respuestas.length > 0 && (
                      <details className="mb-3">
                        <summary className="cursor-pointer text-xs text-ink/40">Ver quién votó qué ({v.respuestas.length})</summary>
                        <div className="mt-1.5 space-y-1">
                          {v.respuestas.map((r) => (
                            <div key={r.user_id} className="flex items-center justify-between text-xs text-ink/60">
                              <UsuarioLink id={r.user_id} nombre={r.user_nombre} />
                              <Badge color="gray">{r.opcion}</Badge>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {v.estado === "abierta" && puedeGestionar && (
                      <div className="space-y-2">
                        <VotarForm votacionId={v.id} opciones={v.opciones} votoActual={votoActual} />
                        <CerrarVotacionForm votacionId={v.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {puedeGestionar && decision.resultado === "pendiente" && !hayVotacionAbierta && (
            <div className="mt-4 pt-4 border-t border-ink/10">
              <CrearVotacionForm decisionId={decision.id} />
            </div>
          )}
        </Card>
      </div>

      <p className="text-xs text-ink-faint mt-4">
        <Link href="/decisiones" className="underline underline-offset-2">← Volver a Decisiones</Link>
      </p>
    </div>
  );
}
