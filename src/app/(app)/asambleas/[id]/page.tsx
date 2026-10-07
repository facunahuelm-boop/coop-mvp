import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { canRead, canEdit, canApprove } from "@/lib/roles";
import { Card, PageHeader, Badge, SectionTitle, EmptyState } from "@/components/ui";
import { obtenerReglamento } from "@/lib/reglamento";
import { calcularQuorum, revisarAnticipacion, MAYORIA_LABEL, RESULTADO_LABEL, type FilaPadron } from "@/lib/asambleas";
import {
  CalcularPadronBoton,
  EnviarConvocatoriaBoton,
  ConfirmarQuorumBoton,
  ListaPadron,
  NuevaVotacionForm,
  VotacionAbierta,
  CerrarAsambleaBoton,
  ActaEditor,
  AprobarActaBoton,
} from "@/components/asambleas/AsambleaFormularios";

/**
 * Fase 2D — la asamblea formal (plan, 8.6): convocatoria con plazos, padrón
 * habilitado con causas, asistencia y poderes, quórum a la vista (lo
 * confirma la mesa), votación por punto y acta borrador → aprobada.
 */

const fechaLarga = (iso: string) => {
  const d = iso.slice(0, 10).split("-").reverse().join("/");
  return iso.length > 10 ? `${d} a las ${iso.slice(11, 16)}` : d;
};

export default async function AsambleaFormalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const r = await get<{
    id: number;
    tipo: string;
    titulo: string;
    fecha: string;
    lugar: string | null;
    estado: string;
    tipo_asamblea: string | null;
    fecha_convocatoria: string | null;
    convocatoria_enviada_en: string | null;
    quorum_confirmado: string | null;
    quorum_detalle: string | null;
    padron_calculado_en: string | null;
    acta_id: number | null;
  }>(
    `SELECT id, tipo, titulo, fecha, lugar, estado, tipo_asamblea, fecha_convocatoria, convocatoria_enviada_en, quorum_confirmado, quorum_detalle, padron_calculado_en, acta_id FROM reuniones WHERE id = ?`,
    [Number(id)]
  ).catch(() => undefined);
  if (!r || r.tipo !== "asamblea") notFound();

  const conduce = canEdit(user.rol, "finanzas") || user.rol === "consejo_directivo";
  const verCausas = conduce || user.rol === "fiscal";
  const reglamento = await obtenerReglamento();
  const [padron, agenda, votaciones, acta] = await Promise.all([
    all<FilaPadron>(`SELECT id, socio_id, integrante_id, nombre, habilitado, causa, presente, llegada_en, representado_por_id FROM asamblea_padron WHERE reunion_id = ? ORDER BY nombre`, [r.id]).catch(() => []),
    all<{ id: number; titulo: string; resultado: string | null }>(`SELECT id, titulo, resultado FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden`, [r.id]).catch(() => []),
    all<{ id: number; titulo: string; mayoria: string; nominal: number; estado: string; a_favor: number; en_contra: number; abstenciones: number; resultado: string | null; agenda_item_id: number | null }>(
      `SELECT id, titulo, mayoria, nominal, estado, a_favor, en_contra, abstenciones, resultado, agenda_item_id FROM asamblea_votaciones WHERE reunion_id = ? AND estado <> 'anulada' ORDER BY id`,
      [r.id]
    ).catch(() => []),
    r.acta_id ? get<{ id: number; estado: string; texto: string | null; resumen: string | null; numero_libro: number | null }>(`SELECT id, estado, texto, resumen, numero_libro FROM actas WHERE id = ?`, [r.acta_id]).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const q = calcularQuorum(padron, r.fecha, reglamento.asambleas);
  const plazo = revisarAnticipacion(r.tipo_asamblea, r.fecha, r.fecha_convocatoria ?? (r.convocatoria_enviada_en?.slice(0, 10) ?? null), reglamento.asambleas);
  const abierta = votaciones.find((v) => v.estado === "abierta");
  const votosAbierta = abierta?.nominal
    ? Object.fromEntries((await all<{ padron_id: number; voto: string }>(`SELECT padron_id, voto FROM asamblea_votos WHERE votacion_id = ?`, [abierta.id])).map((x) => [x.padron_id, x.voto]))
    : {};
  const votantes = padron.filter((p) => p.habilitado && (p.presente || (reglamento.asambleas.poderes && p.representado_por_id))).map((p) => ({ id: p.id, nombre: p.presente ? p.nombre : `${p.nombre} (con poder)` }));
  const enCurso = r.estado === "planificada";

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={r.titulo}
        subtitle={`Asamblea ${r.tipo_asamblea === "extraordinaria" ? "Extraordinaria" : "Ordinaria"} · ${fechaLarga(r.fecha)}${r.lugar ? ` · ${r.lugar}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={r.estado === "realizada" ? "verde" : r.estado === "cancelada" ? "gray" : "brand"}>{r.estado === "realizada" ? "Realizada" : r.estado === "cancelada" ? "Cancelada" : "Convocada"}</Badge>
            <Link href={`/reuniones/${r.id}`} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">
              Orden del día y seguimiento
            </Link>
          </div>
        }
      />
      <p className="mb-4 rounded-xl bg-surface-sunken px-4 py-3 text-[15px] text-ink-muted">
        COOVA ayuda a contar según el reglamento de la cooperativa. Lo que vale es lo que decide la mesa de la asamblea según el estatuto.
      </p>

      {/* 1. Convocatoria */}
      <SectionTitle>1. Convocatoria</SectionTitle>
      <Card className="mb-5">
        <p className={`text-[15px] ${plazo.ok ? "text-ink" : "text-[var(--color-rojo)] font-semibold"}`}>{plazo.ok ? "✔ " : "⚠ "}{plazo.mensaje}</p>
        <p className="mt-1 text-[15px] text-ink-muted">
          {r.convocatoria_enviada_en ? `Convocatoria enviada el ${fechaLarga(r.convocatoria_enviada_en.slice(0, 10))}.` : "Todavía no se envió la convocatoria."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {conduce && enCurso && !r.convocatoria_enviada_en && <EnviarConvocatoriaBoton reunionId={r.id} aviso={plazo.ok ? null : plazo.mensaje} />}
          <a href={`/api/reportes/asamblea/${r.id}?doc=convocatoria`} target="_blank" rel="noreferrer" className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">
            📄 Convocatoria (PDF)
          </a>
          {verCausas && (
            <a href={`/api/reportes/asamblea/${r.id}?doc=padron`} target="_blank" rel="noreferrer" className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">
              📄 Padrón para firmar (PDF)
            </a>
          )}
        </div>
      </Card>

      {/* 2. Padrón, asistencia y quórum */}
      <SectionTitle action={conduce && enCurso && !r.quorum_confirmado ? <CalcularPadronBoton reunionId={r.id} /> : undefined}>2. Padrón, asistencia y quórum</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 text-[15px]">
        <Card>
          <div className="text-ink-muted">Habilitados para votar</div>
          <div className="text-2xl font-bold">{q.habilitados}</div>
          <div className="text-sm text-ink-muted">de {padron.length} en el padrón · {reglamento.asambleas.voto === "persona" ? "un voto por persona adulta" : "un voto por socio titular"}</div>
        </Card>
        <Card>
          <div className="text-ink-muted">Pueden votar ahora</div>
          <div className="text-2xl font-bold">{q.votosPosibles}</div>
          <div className="text-sm text-ink-muted">{q.presentes} presentes{q.porPoder ? ` + ${q.porPoder} con poder` : ""}</div>
        </Card>
        <Card>
          <div className="text-ink-muted">Quórum</div>
          <div className={`font-bold ${q.hayPrimera ? "text-[var(--color-verde)]" : "text-ink"}`}>1ª convocatoria: hacen falta {q.necesariosPrimera} {q.hayPrimera ? "✔" : ""}</div>
          <div className={`font-bold ${q.haySegunda ? "text-[var(--color-verde)]" : "text-ink"}`}>
            2ª (desde las {q.horaSegunda}): {reglamento.asambleas.quorumSegunda === 0 ? "con los presentes" : `hacen falta ${q.necesariosSegunda}`} {q.haySegunda ? "✔" : ""}
          </div>
        </Card>
      </div>
      {r.quorum_confirmado ? (
        <p className="mb-3 rounded-xl bg-[var(--color-verde-bg)] px-4 py-3 text-[15px] text-ink">
          ✔ La mesa dio comienzo en {r.quorum_confirmado} convocatoria. {r.quorum_detalle}
        </p>
      ) : (
        conduce &&
        enCurso && (
          <div className="mb-3 flex flex-wrap gap-2">
            <ConfirmarQuorumBoton reunionId={r.id} convocatoria="primera" habilitado={q.hayPrimera} />
            <ConfirmarQuorumBoton reunionId={r.id} convocatoria="segunda" habilitado={q.haySegunda} />
          </div>
        )
      )}
      <Card className="mb-5">
        {padron.length === 0 ? (
          <EmptyState>El padrón todavía no se armó.</EmptyState>
        ) : (
          <ListaPadron
            filas={padron.map((p) => ({ id: p.id, nombre: p.nombre, habilitado: p.habilitado, causa: verCausas ? p.causa : null, presente: p.presente, representado_por_id: p.representado_por_id }))}
            editable={conduce && enCurso}
            poderes={reglamento.asambleas.poderes}
          />
        )}
      </Card>

      {/* 3. Votaciones */}
      <SectionTitle action={conduce && enCurso && r.quorum_confirmado && !abierta ? <NuevaVotacionForm reunionId={r.id} agenda={agenda.map((a) => ({ id: a.id, titulo: a.titulo }))} /> : undefined}>
        3. Votaciones
      </SectionTitle>
      <Card className="mb-5">
        {!r.quorum_confirmado && enCurso && <p className="text-[15px] text-ink-muted">Se puede votar cuando la mesa confirma el quórum.</p>}
        {abierta && conduce && enCurso && (
          <div className="mb-4 rounded-xl border-2 border-[var(--color-brand-800)] p-4">
            <h3 className="text-lg font-bold text-ink">Votando: {abierta.titulo}</h3>
            <p className="text-sm text-ink-muted mb-2">{MAYORIA_LABEL[abierta.mayoria]}</p>
            <VotacionAbierta v={abierta} votantes={votantes} votos={votosAbierta} votosPosibles={q.votosPosibles} />
          </div>
        )}
        {votaciones.filter((v) => v.estado === "cerrada").length === 0 && !abierta ? (
          r.quorum_confirmado || !enCurso ? <EmptyState>Todavía no hubo votaciones.</EmptyState> : null
        ) : (
          <ul className="divide-y divide-border text-[15px]">
            {votaciones
              .filter((v) => v.estado === "cerrada")
              .map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>{v.titulo}</b>
                    <span className="block text-sm text-ink-muted">
                      A favor {v.a_favor} · En contra {v.en_contra} · Abstenciones {v.abstenciones} · {MAYORIA_LABEL[v.mayoria]?.split(" (")[0]}
                    </span>
                  </span>
                  <Badge color={v.resultado === "aprobada" ? "verde" : v.resultado === "empate" ? "amarillo" : "rojo"}>{RESULTADO_LABEL[v.resultado ?? ""] ?? "—"}</Badge>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {/* 4. Cierre y acta */}
      <SectionTitle>4. Acta</SectionTitle>
      <Card>
        {enCurso ? (
          conduce ? (
            <div className="flex flex-wrap items-center gap-3">
              <CerrarAsambleaBoton reunionId={r.id} />
              <span className="text-[15px] text-ink-muted">Al terminar se arma el borrador del acta.</span>
            </div>
          ) : (
            <p className="text-[15px] text-ink-muted">El acta se arma cuando termina la asamblea.</p>
          )
        ) : acta ? (
          <>
            <p className="mb-2 text-[15px]">
              <Badge color={acta.estado === "aprobada" ? "verde" : "amarillo"}>{acta.estado === "aprobada" ? `Aprobada${acta.numero_libro ? ` · N° ${acta.numero_libro} del libro` : ""}` : "Borrador"}</Badge>
            </p>
            <ActaEditor actaId={acta.id} texto={acta.texto || acta.resumen || ""} editable={conduce && acta.estado !== "aprobada"} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href={`/api/reportes/asamblea/${r.id}?doc=acta`} target="_blank" rel="noreferrer" className="rounded-xl border border-border px-3 py-2 text-sm font-semibold">
                📄 Acta (PDF)
              </a>
              {acta.estado !== "aprobada" && canApprove(user.rol, "comisiones") && <AprobarActaBoton actaId={acta.id} />}
            </div>
            {agenda.some((a) => a.resultado) && (
              <p className="mt-3 text-[15px]">
                Las resoluciones se convierten en tareas desde{" "}
                <Link href={`/reuniones/${r.id}`} className="font-semibold underline">
                  Orden del día y seguimiento
                </Link>
                .
              </p>
            )}
          </>
        ) : (
          <EmptyState>Sin acta.</EmptyState>
        )}
      </Card>
    </div>
  );
}
