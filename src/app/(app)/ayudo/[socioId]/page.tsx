import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get, audit } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { avisarAusenciaFormAction } from "@/lib/actions/asistenciaHoras";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { cargarLibretas } from "@/lib/libretaHoras";
import { hoyEnUruguay, sumarDias, textoDia, textoHoras, textoSaldo } from "@/lib/horasObra";
import { accesoSobre } from "@/lib/accesoDelegado";

const pesos = (n: number) => `$ ${n.toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;
const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");

/** Fase 3G — lo que ve un familiar con acceso delegado: la información del socio que ayuda. */
export default async function AyudoPage({ params }: { params: Promise<{ socioId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const socioId = Number((await params).socioId);
  if (!Number.isInteger(socioId) || socioId <= 0) notFound();
  const acceso = await accesoSobre(user.id, socioId);
  if (!acceso) redirect("/acceso-familiar");
  await audit({ usuario_id: user.id, accion: "ver_como_delegado", entidad: "socios", entidad_id: socioId, valor_nuevo: { en_nombre_de: acceso.socio_nombre } }).catch(() => {});

  const hoy = hoyEnUruguay();
  const cuenta = calcularCuotasSocio(await cargarMovimientosCuenta(socioId));
  const debe = Math.max(0, cuenta.saldo);
  const vencidas = cuenta.cuotas.filter((c) => c.montoPendiente > 0.004 && (c.estado === "vencida" || (!!c.fechaVencimiento && c.fechaVencimiento < hoy)));
  const nucleoId = acceso.nucleo_id;
  const [libreta, turnos, asamblea] = await Promise.all([
    user.etapa === "obra" && nucleoId ? cargarLibretas(hoy, nucleoId).then((l) => l[0] ?? null).catch(() => null) : Promise.resolve(null),
    user.etapa === "obra" && nucleoId
      ? all<{ id: number; fecha: string; hora_inicio: string; hora_fin: string; minutos: number; aviso_estado: string | null }>(
          `SELECT a.id, a.fecha, a.hora_inicio, a.hora_fin, a.minutos,
                  (SELECT v.estado FROM avisos_ausencia v WHERE v.asignacion_id = a.id AND v.estado <> 'retirado' ORDER BY v.id DESC LIMIT 1) AS aviso_estado
             FROM asignaciones_horas a WHERE a.nucleo_id = ? AND a.estado = 'activa' AND a.fecha >= ? AND a.fecha <= ? ORDER BY a.fecha, a.hora_inicio`,
          [nucleoId, hoy, sumarDias(hoy, 21)]
        ).catch(() => [])
      : Promise.resolve([]),
    get<{ titulo: string; fecha: string; lugar: string | null }>(
      `SELECT titulo, fecha, lugar FROM reuniones WHERE tipo = 'asamblea' AND estado = 'planificada' AND substr(fecha::text, 1, 10) >= ? ORDER BY fecha LIMIT 1`,
      [hoy]
    ).catch(() => undefined),
  ]);
  const saldo = libreta ? textoSaldo(libreta.saldoAcumuladoMin) : null;
  const nombre = acceso.socio_nombre.split(" ")[0];

  return (
    <div className="max-w-3xl space-y-5 text-[16px]">
      <PageHeader title={`Estás ayudando a ${acceso.socio_nombre}`} subtitle="Lo que ves y hacés acá queda registrado en su nombre" />

      <Card>
        <p className="text-[15px] text-ink-muted">Lo que debe hoy</p>
        <p className={`text-3xl font-bold ${vencidas.length ? "text-[var(--color-rojo)]" : "text-ink"}`}>{debe > 0 ? pesos(debe) : "No debe nada"}</p>
        {vencidas.length > 0 && <p className="mt-1 text-ink">{vencidas.length === 1 ? "Tiene 1 cuota vencida." : `Tiene ${vencidas.length} cuotas vencidas.`}</p>}
        <a href={`/api/reportes/estado-cuenta/${socioId}`} target="_blank" rel="noopener" className="mt-3 inline-block font-semibold underline underline-offset-2">
          Ver el estado de cuenta (PDF)
        </a>
      </Card>

      {libreta && saldo && (
        <Card>
          <p className="text-[15px] text-ink-muted">Saldo de horas del núcleo</p>
          <p className={`text-3xl font-bold ${saldo.color === "rojo" ? "text-[var(--color-rojo)]" : saldo.color === "verde" ? "text-[var(--color-verde)]" : "text-ink"}`}>{saldo.texto}</p>
          {libreta.semanaActual && (
            <p className="mt-1 text-ink">
              Esta semana: {textoHoras(libreta.semanaActual.realMin)} de {textoHoras(libreta.semanaActual.exigibleMin)}.
            </p>
          )}
        </Card>
      )}

      {user.etapa === "obra" && nucleoId && (
        <section>
          <SectionTitle>Próximos turnos en la obra</SectionTitle>
          {turnos.length === 0 ? (
            <Card>
              <EmptyState>No tiene turnos en las próximas tres semanas.</EmptyState>
            </Card>
          ) : (
            <ul className="space-y-3">
              {turnos.map((t) => (
                <li key={t.id} className="rounded-2xl border border-border bg-surface p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-ink">{t.fecha === hoy ? "Hoy" : textoDia(t.fecha)}</p>
                    <p className="text-[15px] text-ink">
                      De {t.hora_inicio} a {t.hora_fin} hs · {textoHoras(Number(t.minutos))}
                    </p>
                    {t.aviso_estado === "pendiente" && <p className="text-[15px] text-[var(--color-amarillo)] mt-1">Ya se avisó que no puede ir.</p>}
                    {t.aviso_estado === "aprobado" && <p className="text-[15px] text-[var(--color-verde)] mt-1">La falta quedó justificada.</p>}
                  </div>
                  {acceso.puede_actuar && (!t.aviso_estado || t.aviso_estado === "rechazado") ? (
                    <FormularioEnModal
                      textoBoton={`Avisar que ${nombre} no puede ir`}
                      titulo={`${nombre} no puede ir el ${textoDia(t.fecha).toLowerCase()}`}
                      descripcion="La Comisión de Trabajo recibe el aviso. Queda registrado que lo mandaste vos, en su nombre."
                      action={avisarAusenciaFormAction}
                      ocultos={{ asignacion_id: t.id }}
                      textoConfirmar="Enviar aviso"
                      mensajeExito="Aviso enviado a la Comisión de Trabajo."
                      claseBoton="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-4 py-3 text-[15px] font-semibold text-ink hover:bg-surface-sunken min-h-[48px]"
                    >
                      <label className="block">
                        <Label required>¿Por qué no puede ir?</Label>
                        <textarea name="motivo" required rows={3} maxLength={500} className={inputClass} />
                      </label>
                    </FormularioEnModal>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {asamblea && (
        <Card>
          <p className="text-[15px] text-ink-muted">Próxima asamblea</p>
          <p className="text-lg font-bold text-ink">{asamblea.titulo}</p>
          <p className="text-ink">
            {dmy(asamblea.fecha)}
            {asamblea.fecha.length > 10 ? ` a las ${asamblea.fecha.slice(11, 16)}` : ""}
            {asamblea.lugar ? ` · ${asamblea.lugar}` : ""}
          </p>
        </Card>
      )}

      <Link href="/acceso-familiar" className="inline-block font-semibold underline underline-offset-2">
        Volver
      </Link>
    </div>
  );
}
