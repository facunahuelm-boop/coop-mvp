import Link from "next/link";
import { get, all } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { obtenerReglamento, codigoDePago } from "@/lib/reglamento";
import { cargarLibretas, nucleoDelUsuario } from "@/lib/libretaHoras";
import { hoyEnUruguay, textoHoras, textoSaldo } from "@/lib/horasObra";
import { ETAPA_LABEL, type EtapaCooperativa } from "@/lib/comisionesFunciones";
import { listarHitos } from "@/lib/tramites";
import { LineaDeTiempo } from "@/components/tramites/LineaDeTiempo";

/**
 * Fase 1D — "Mi vivienda": la pantalla de inicio del socio. Responde, con
 * letra grande y sin jerga, las preguntas que hoy se hacen por teléfono:
 * ¿cuánto debo y cuándo vence?, ¿dónde está mi recibo?, ¿cuántas horas me
 * faltan?, ¿cuándo es la próxima asamblea? Una acción principal por bloque.
 */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export function fechaLarga(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS[dia]} ${d} de ${MESES[m - 1]}`;
}
const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-UY")}`;

function Bloque({ titulo, children, tono = "normal" }: { titulo: string; children: React.ReactNode; tono?: "normal" | "alerta" | "ok" }) {
  const borde = tono === "alerta" ? "border-[var(--color-rojo)]/40" : tono === "ok" ? "border-[var(--color-verde)]/40" : "border-border";
  return (
    <section className={`rounded-2xl border ${borde} bg-surface p-5 shadow-[var(--shadow-sm)]`}>
      <h2 className="text-[15px] font-bold uppercase tracking-wide text-ink-muted">{titulo}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const boton =
  "inline-flex items-center justify-center rounded-xl px-5 py-3 text-[16px] font-semibold min-h-[48px] transition-colors";
const botonPrincipal = `${boton} bg-[var(--color-brand-800)] text-white hover:bg-[var(--color-brand-700)]`;
const botonSecundario = `${boton} border border-border bg-surface text-ink hover:bg-surface-sunken`;

export async function PortalSocio({ user }: { user: SessionUser }) {
  const hoy = hoyEnUruguay();
  const socio = await get<{ id: number; nombre: string; nucleo_id: number | null; estado: string }>(
    `SELECT id, nombre, nucleo_id, estado FROM socios WHERE user_id = ? ORDER BY (estado = 'activo') DESC, id LIMIT 1`,
    [user.id]
  ).catch(() => undefined);
  const nucleoId = await nucleoDelUsuario(user.id, user.nucleo_id);
  const [reglamento, org] = await Promise.all([
    obtenerReglamento(),
    get<{ slug: string }>(`SELECT slug FROM organizations WHERE id = ?`, [user.organization_id]),
  ]);

  // ---- Cuenta ----
  const cuenta = socio ? calcularCuotasSocio(await cargarMovimientosCuenta(socio.id)) : null;
  const debe = cuenta ? Math.max(0, cuenta.saldo) : 0;
  // Incluye las cuotas de un convenio (también se deben); una cuota vieja
  // refinanciada ya no tiene saldo propio, así que no aparece.
  const pendientes = (cuenta?.cuotas ?? []).filter((c) => c.montoPendiente > 0.004);
  const atrasada = (c: (typeof pendientes)[number]) => c.estado === "vencida" || (!!c.fechaVencimiento && c.fechaVencimiento < hoy);
  const vencidas = pendientes.filter(atrasada);
  const proxima = pendientes
    .filter((c) => !atrasada(c) && c.fechaVencimiento)
    .sort((a, b) => (a.fechaVencimiento! < b.fechaVencimiento! ? -1 : 1))[0];
  const recibos = socio
    ? await all<{ id: number; numero: number; fecha: string; monto: number }>(
        `SELECT id, numero, fecha, monto FROM recibos WHERE socio_id = ? AND anulado_en IS NULL ORDER BY numero DESC LIMIT 3`,
        [socio.id]
      ).catch(() => [])
    : [];
  const codigo = socio && org ? codigoDePago(org.slug, socio.nucleo_id, socio.id) : null;

  // ---- Horas (sólo en obra) ----
  const libreta = user.etapa === "obra" && nucleoId ? (await cargarLibretas(hoy, nucleoId))[0] ?? null : null;
  const proximoTurno =
    user.etapa === "obra" && nucleoId
      ? await get<{ fecha: string; hora_inicio: string; hora_fin: string }>(
          `SELECT fecha, hora_inicio, hora_fin FROM asignaciones_horas WHERE nucleo_id = ? AND estado = 'activa' AND fecha >= ? ORDER BY fecha, hora_inicio LIMIT 1`,
          [nucleoId, hoy]
        ).catch(() => undefined)
      : undefined;

  // ---- Fase 2E: ¿En qué estamos? (trámites, sobre todo en Pre-obra) ----
  const hitos = user.etapa !== "habitada" ? await listarHitos(true) : [];

  // ---- Próxima asamblea ----
  const asamblea = await get<{ id: number; titulo: string; fecha: string; lugar: string | null }>(
    `SELECT id, titulo, fecha, lugar FROM reuniones WHERE tipo = 'asamblea' AND estado = 'planificada' AND substr(fecha::text, 1, 10) >= ? ORDER BY fecha LIMIT 1`,
    [hoy]
  ).catch(() => undefined);
  const temas = asamblea
    ? await all<{ titulo: string }>(`SELECT titulo FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden, id LIMIT 4`, [asamblea.id]).catch(() => [])
    : [];

  // ---- Avisos ----
  const avisos = await all<{ id: number; titulo: string; creado_en: string; leida: number | boolean }>(
    `SELECT id, titulo, creado_en, leida FROM notificaciones WHERE user_id = ? ORDER BY creado_en DESC LIMIT 3`,
    [user.id]
  ).catch(() => []);
  const sinLeer = avisos.filter((a) => !a.leida).length;
  // Fase 2F: avisos oficiales sin leer (arriba de todo).
  const oficiales = await all<{ id: number; titulo: string; urgente: number }>(
    `SELECT a.id, a.titulo, a.urgente FROM aviso_destinatarios d JOIN avisos a ON a.id = d.aviso_id
      WHERE d.user_id = ? AND d.leido_en IS NULL AND a.anulado_en IS NULL ORDER BY a.urgente DESC, a.id DESC LIMIT 3`,
    [user.id]
  ).catch(() => []);

  const primerNombre = user.nombre.split(" ")[0];
  return (
    <div className="space-y-5 text-[17px]">
      <div>
        <h1 className="text-2xl font-bold text-ink">Hola, {primerNombre}</h1>
        <p className="text-[16px] text-ink-muted first-letter:uppercase">{fechaLarga(hoy)}</p>
      </div>

      {oficiales.length > 0 && (
        <Bloque titulo={oficiales.length === 1 ? "Tenés un aviso sin leer" : `Tenés ${oficiales.length} avisos sin leer`} tono="alerta">
          <ul className="space-y-2">
            {oficiales.map((a) => (
              <li key={a.id}>
                <Link href={`/avisos/${a.id}`} className="font-semibold text-ink underline underline-offset-2">
                  {a.urgente ? "URGENTE: " : ""}
                  {a.titulo}
                </Link>
              </li>
            ))}
          </ul>
        </Bloque>
      )}

      {!socio && (
        <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[16px] text-ink">
          Tu usuario todavía no está vinculado a tu ficha de socio. Pedile a la administración que lo vincule para ver lo que debés y tus recibos.
        </p>
      )}

      {socio && (
        <Bloque titulo="Lo que debés hoy" tono={vencidas.length ? "alerta" : debe === 0 ? "ok" : "normal"}>
          <p className={`text-4xl font-bold ${vencidas.length ? "text-[var(--color-rojo)]" : "text-ink"}`}>{debe > 0 ? pesos(debe) : "No debés nada"}</p>
          {vencidas.length > 0 && (
            <p className="mt-1 text-[17px] text-[var(--color-rojo)]">
              Tenés {vencidas.length} cuota{vencidas.length === 1 ? "" : "s"} atrasada{vencidas.length === 1 ? "" : "s"}.
            </p>
          )}
          {proxima && (
            <p className="mt-1 text-[17px] text-ink">
              Próxima cuota: {pesos(proxima.montoPendiente)}, vence el {fechaLarga(proxima.fechaVencimiento!)}.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <details className="w-full sm:w-auto">
              <summary className={`${botonPrincipal} list-none cursor-pointer`}>Cómo pagar</summary>
              <div className="mt-3 rounded-xl bg-surface-sunken p-4 text-[16px] text-ink space-y-2">
                <p>Podés pagar en la tesorería de la cooperativa o por transferencia o depósito.</p>
                {codigo && (
                  <p>
                    Si transferís, escribí este código en el concepto: <strong className="font-mono text-xl tracking-wide">{codigo}</strong>. Así tu pago se identifica solo.
                  </p>
                )}
              </div>
            </details>
            {pendientes.length > 0 && (
              <details className="w-full sm:w-auto">
                <summary className={`${botonSecundario} list-none cursor-pointer`}>¿Por qué debo esto?</summary>
                <ul className="mt-3 rounded-xl bg-surface-sunken p-4 text-[16px] text-ink space-y-2">
                  {pendientes.map((c) => (
                    <li key={c.id}>
                      <strong>{c.concepto}</strong>: {pesos(c.montoPendiente)}
                      {c.montoPagado > 0 ? ` (ya pagaste ${pesos(c.montoPagado)})` : ""}
                      {c.fechaVencimiento ? (atrasada(c) ? ` — venció el ${fechaLarga(c.fechaVencimiento)}, está atrasada.` : ` — vence el ${fechaLarga(c.fechaVencimiento)}.`) : "."}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <p className="mt-3">
            <a href={`/api/reportes/estado-cuenta/${socio.id}`} target="_blank" rel="noopener noreferrer" className="text-[16px] underline underline-offset-2 text-[var(--color-brand-800)]">
              Bajar mi estado de cuenta (PDF)
            </a>
          </p>
          {recibos.length > 0 && (
            <div className="mt-4">
              <p className="text-[16px] font-semibold text-ink">Tus últimos recibos</p>
              <ul className="mt-1 space-y-1">
                {recibos.map((r) => (
                  <li key={r.id}>
                    <a href={`/api/archivos/recibo/${r.id}`} target="_blank" rel="noopener noreferrer" className="text-[16px] underline underline-offset-2 text-[var(--color-brand-800)]">
                      Recibo N° {r.numero} — {pesos(Number(r.monto))} ({r.fecha.slice(8, 10)}/{r.fecha.slice(5, 7)})
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Bloque>
      )}

      {libreta && (
        <Bloque titulo="Tus horas esta semana" tono={libreta.saldoAcumuladoMin < 0 ? "alerta" : "normal"}>
          {libreta.semanaActual ? (
            <p className="text-3xl font-bold text-ink">
              {textoHoras(libreta.semanaActual.realMin)} <span className="text-xl font-semibold text-ink-muted">de {textoHoras(libreta.semanaActual.exigibleMin)}</span>
            </p>
          ) : null}
          <p className="mt-1 text-[17px] text-ink">
            {libreta.semanaActual && libreta.semanaActual.faltanMin > 0 ? `Te faltan ${textoHoras(libreta.semanaActual.faltanMin)}.` : "Completaste la semana."}{" "}
            Saldo: {textoSaldo(libreta.saldoAcumuladoMin).texto}.
          </p>
          {proximoTurno && (
            <p className="mt-1 text-[17px] text-ink">
              Próximo turno: {proximoTurno.fecha === hoy ? "hoy" : fechaLarga(proximoTurno.fecha)}, de {proximoTurno.hora_inicio} a {proximoTurno.hora_fin} hs.
            </p>
          )}
          <div className="mt-4">
            <Link href="/mis-horas" className={botonPrincipal}>Ver mis horas o avisar que no puedo ir</Link>
          </div>
        </Bloque>
      )}

      {hitos.length > 0 && (
        <Bloque titulo="¿En qué estamos?">
          <LineaDeTiempo hitos={hitos} hoy={hoy} compacta />
          <Link href="/tramites" className={`${botonSecundario} mt-2 inline-flex`}>
            Ver todos los pasos
          </Link>
        </Bloque>
      )}

      <Bloque titulo="Próxima asamblea">
        {asamblea ? (
          <>
            <p className="text-xl font-bold text-ink first-letter:uppercase">
              {fechaLarga(asamblea.fecha)}
              {asamblea.fecha.length > 10 ? `, ${asamblea.fecha.slice(11, 16)} hs` : ""}
            </p>
            <p className="text-[17px] text-ink">{asamblea.titulo}{asamblea.lugar ? ` — ${asamblea.lugar}` : ""}</p>
            {temas.length > 0 && <p className="mt-1 text-[16px] text-ink-muted">Temas: {temas.map((t) => t.titulo).join(", ")}</p>}
            <div className="mt-3">
              <Link href={`/reuniones/${asamblea.id}`} className={botonSecundario}>Ver la asamblea</Link>
            </div>
          </>
        ) : (
          <p className="text-[17px] text-ink">No hay ninguna asamblea convocada por ahora.</p>
        )}
      </Bloque>

      <Bloque titulo={sinLeer ? `Avisos (${sinLeer} nuevo${sinLeer === 1 ? "" : "s"})` : "Avisos"}>
        {avisos.length === 0 ? (
          <p className="text-[17px] text-ink">No tenés avisos.</p>
        ) : (
          <ul className="space-y-2">
            {avisos.map((a) => (
              <li key={a.id} className="text-[16px] text-ink">
                {!a.leida && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-brand-800)]" aria-label="Nuevo" />}
                {a.titulo}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Link href="/notificaciones" className={botonSecundario}>Ver todos los avisos</Link>
        </div>
      </Bloque>

      <p className="text-[16px] text-ink-muted">
        La cooperativa está en etapa: <strong className="text-ink">{ETAPA_LABEL[user.etapa as EtapaCooperativa] ?? user.etapa}</strong>.
      </p>

      <div className="rounded-2xl bg-[var(--color-brand-100)]/50 px-5 py-4 text-[17px] text-ink">
        <p className="font-semibold">¿Necesitás ayuda?</p>
        {reglamento.ayuda.telefono ? (
          <p>
            Llamá al <a href={`tel:${reglamento.ayuda.telefono.replace(/\s/g, "")}`} className="font-bold underline">{reglamento.ayuda.telefono}</a>
            {reglamento.ayuda.horario ? ` (${reglamento.ayuda.horario})` : ""}.
          </p>
        ) : (
          <p>Consultá con la administración de la cooperativa.</p>
        )}
      </div>
    </div>
  );
}

