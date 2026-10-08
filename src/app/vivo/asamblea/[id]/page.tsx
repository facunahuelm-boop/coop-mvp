import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { obtenerReglamento } from "@/lib/reglamento";
import { calcularQuorum, MAYORIA_LABEL, RESULTADO_LABEL, resultadoVotacion, type FilaPadron } from "@/lib/asambleas";
import { RefrescoAutomatico, PantallaCompletaBoton } from "@/components/asambleas/RefrescoAutomatico";

export const dynamic = "force-dynamic";

/**
 * Fase 3F — modo asamblea en vivo: la pantalla para el proyector, con el
 * quórum, el punto que se está tratando y la votación (en curso o la última).
 * Se actualiza sola. Lo que vale es lo que decide la mesa.
 */
export default async function AsambleaEnVivoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login`);
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");
  const reunionId = Number(id);
  if (!Number.isInteger(reunionId) || reunionId <= 0) notFound();

  const r = await get<{ id: number; tipo: string; titulo: string; fecha: string; estado: string; tipo_asamblea: string | null; quorum_confirmado: string | null; punto_actual_id: number | null }>(
    `SELECT id, tipo, titulo, fecha, estado, tipo_asamblea, quorum_confirmado, punto_actual_id FROM reuniones WHERE id = ?`,
    [reunionId]
  ).catch(() =>
    get<{ id: number; tipo: string; titulo: string; fecha: string; estado: string; tipo_asamblea: string | null; quorum_confirmado: string | null; punto_actual_id: number | null }>(
      `SELECT id, tipo, titulo, fecha, estado, tipo_asamblea, quorum_confirmado, NULL AS punto_actual_id FROM reuniones WHERE id = ?`,
      [reunionId]
    )
  );
  if (!r || r.tipo !== "asamblea") notFound();
  const reglamento = await obtenerReglamento();
  const [padron, agenda, votaciones] = await Promise.all([
    all<FilaPadron>(`SELECT id, socio_id, integrante_id, nombre, habilitado, causa, presente, llegada_en, representado_por_id FROM asamblea_padron WHERE reunion_id = ?`, [r.id]).catch(() => []),
    all<{ id: number; orden: number; titulo: string; descripcion: string | null; resultado: string | null }>(`SELECT id, orden, titulo, descripcion, resultado FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden, id`, [r.id]).catch(() => []),
    all<{ id: number; titulo: string; mayoria: string; nominal: number; estado: string; a_favor: number; en_contra: number; abstenciones: number; resultado: string | null }>(
      `SELECT id, titulo, mayoria, nominal, estado, a_favor, en_contra, abstenciones, resultado FROM asamblea_votaciones WHERE reunion_id = ? AND estado <> 'anulada' ORDER BY id`,
      [r.id]
    ).catch(() => []),
  ]);
  const q = calcularQuorum(padron, r.fecha, reglamento.asambleas);
  const abierta = votaciones.find((v) => v.estado === "abierta");
  const ultima = [...votaciones].reverse().find((v) => v.estado === "cerrada");
  let enCurso: { aFavor: number; enContra: number; abst: number; total: number } | null = null;
  if (abierta?.nominal) {
    const votos = await all<{ voto: string; n: string }>(`SELECT voto, COUNT(*) AS n FROM asamblea_votos WHERE votacion_id = ? GROUP BY voto`, [abierta.id]).catch(() => []);
    const c = (v: string) => Number(votos.find((x) => x.voto === v)?.n ?? 0);
    enCurso = { aFavor: c("a_favor"), enContra: c("en_contra"), abst: c("abstencion"), total: votos.reduce((a, x) => a + Number(x.n), 0) };
  }
  const posicion = agenda.findIndex((a) => a.id === r.punto_actual_id);
  const punto = posicion >= 0 ? agenda[posicion] : null;
  const barra = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "0%");

  return (
    <main className="min-h-screen bg-[#0f1b2d] text-white p-6 lg:p-10 flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg text-white/60">{user.organizacion.nombre} · Asamblea {r.tipo_asamblea === "extraordinaria" ? "Extraordinaria" : "Ordinaria"}</p>
          <h1 className="text-3xl lg:text-5xl font-bold">{r.titulo}</h1>
        </div>
        <div className="flex items-center gap-4 text-3xl font-bold tabular-nums">
          <RefrescoAutomatico />
          <PantallaCompletaBoton />
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-3xl bg-white/5 p-6">
          <p className="text-xl text-white/60">Quórum</p>
          <p className="text-6xl lg:text-7xl font-bold tabular-nums" data-testid="vivo-presentes">
            {q.votosPosibles}
            <span className="text-3xl text-white/50"> / {q.habilitados}</span>
          </p>
          <p className="text-xl text-white/70">
            {q.presentes} presentes{q.porPoder ? ` + ${q.porPoder} con poder` : ""}
          </p>
          <p className={`mt-4 text-2xl font-semibold ${q.hayPrimera || q.haySegunda ? "text-emerald-300" : "text-amber-300"}`}>
            {r.quorum_confirmado
              ? `Sesión abierta en ${r.quorum_confirmado} convocatoria`
              : q.hayPrimera
                ? "Hay quórum para la 1ª convocatoria"
                : q.haySegunda
                  ? `Hay quórum para la 2ª (desde las ${q.horaSegunda})`
                  : `Faltan ${q.necesariosPrimera - q.votosPosibles} para la 1ª convocatoria`}
          </p>
        </div>

        <div className="rounded-3xl bg-white/5 p-6 lg:col-span-2">
          <p className="text-xl text-white/60">{punto ? `Punto ${posicion + 1} de ${agenda.length}` : "Orden del día"}</p>
          {punto ? (
            <>
              <p className="text-4xl lg:text-5xl font-bold" data-testid="vivo-punto">{punto.titulo}</p>
              {punto.descripcion && <p className="mt-3 text-2xl text-white/80 whitespace-pre-line">{punto.descripcion}</p>}
            </>
          ) : (
            <ol className="mt-2 space-y-1 text-2xl">
              {agenda.map((a, i) => (
                <li key={a.id}>
                  {i + 1}. {a.titulo}
                </li>
              ))}
              {agenda.length === 0 && <li className="text-white/60">Sin puntos cargados.</li>}
            </ol>
          )}
        </div>
      </section>

      <section className="rounded-3xl bg-white/5 p-6 flex-1">
        {abierta ? (
          <>
            <p className="text-xl text-amber-300 font-semibold">Votación en curso</p>
            <p className="text-4xl font-bold" data-testid="vivo-votacion">{abierta.titulo}</p>
            <p className="text-xl text-white/60">{MAYORIA_LABEL[abierta.mayoria]}</p>
            {enCurso ? (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { t: "A favor", n: enCurso.aFavor, c: "bg-emerald-400" },
                  { t: "En contra", n: enCurso.enContra, c: "bg-rose-400" },
                  { t: "Abstenciones", n: enCurso.abst, c: "bg-slate-300" },
                ].map((x) => (
                  <div key={x.t}>
                    <p className="text-2xl text-white/70">{x.t}</p>
                    <p className="text-6xl font-bold tabular-nums">{x.n}</p>
                    <div className="mt-2 h-3 rounded-full bg-white/10">
                      <div className={`h-3 rounded-full ${x.c}`} style={{ width: barra(x.n, q.votosPosibles) }} />
                    </div>
                  </div>
                ))}
                <p className="md:col-span-3 text-xl text-white/60">Votaron {enCurso.total} de {q.votosPosibles}.</p>
              </div>
            ) : (
              <p className="mt-6 text-3xl text-white/80">La mesa está contando los votos…</p>
            )}
          </>
        ) : ultima ? (
          <>
            <p className="text-xl text-white/60">Última votación</p>
            <p className="text-4xl font-bold">{ultima.titulo}</p>
            <p className="mt-4 text-3xl">
              A favor {ultima.a_favor} · En contra {ultima.en_contra} · Abstenciones {ultima.abstenciones}
            </p>
            <p
              data-testid="vivo-resultado"
              className={`mt-4 inline-block rounded-2xl px-6 py-3 text-5xl font-bold ${ultima.resultado === "aprobada" ? "bg-emerald-500/20 text-emerald-300" : ultima.resultado === "empate" ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"}`}
            >
              {RESULTADO_LABEL[ultima.resultado ?? resultadoVotacion(ultima.mayoria, ultima.a_favor, ultima.en_contra, ultima.abstenciones, q.votosPosibles)]}
            </p>
          </>
        ) : (
          <p className="text-3xl text-white/60">Todavía no hubo votaciones.</p>
        )}
      </section>

      <footer className="text-base text-white/40">COOVA ayuda a contar según el reglamento. Lo que vale es lo que decide la mesa de la asamblea.</footer>
    </main>
  );
}
