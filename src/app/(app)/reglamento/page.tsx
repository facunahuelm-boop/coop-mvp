import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Card, PageHeader, Badge, Label, inputClass } from "@/components/ui";
import { SeccionReglamentoForm, GenerarCuotasAhoraBoton } from "@/components/reglamento/ReglamentoFormularios";
import { obtenerReglamento, textoMes } from "@/lib/reglamento";
import { ultimasEjecuciones } from "@/lib/automatizaciones";
import { obtenerHorarioObra } from "@/lib/horasTrabajo";
import { canEdit } from "@/lib/roles";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Fase 1C — "Reglamento de la cooperativa": un solo lugar, en lenguaje
 * simple, para las reglas que el sistema aplica solo (cuotas, atrasos,
 * avisos, horas y a quién llamar si alguien necesita ayuda). Lo cambian
 * admin y Consejo Directivo; tesorería y fiscal lo pueden consultar.
 */

const ROLES_LECTURA = ["admin", "consejo_directivo", "tesoreria", "administracion", "fiscal"];
const TIPO_EJECUCION: Record<string, string> = {
  generar_cuotas: "Generó las cuotas del mes",
  recargos: "Revisó atrasos y recargos",
  cerrar_semanas_horas: "Cerró semanas de horas",
};

function Explicacion({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] text-ink-muted mt-1">{children}</p>;
}

function Opcion({ name, value, actual, titulo, detalle }: { name: string; value: string; actual: string; titulo: string; detalle?: string }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-3 cursor-pointer has-[:checked]:border-[var(--color-brand-800)] has-[:checked]:bg-[var(--color-brand-100)]/40">
      <input type="radio" name={name} value={value} defaultChecked={actual === value} className="h-5 w-5 mt-0.5" />
      <span>
        <span className="block font-semibold text-ink">{titulo}</span>
        {detalle && <span className="block text-[15px] text-ink-muted">{detalle}</span>}
      </span>
    </label>
  );
}

export default async function ReglamentoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!ROLES_LECTURA.includes(user.rol)) redirect("/dashboard");
  const editable = ["admin", "consejo_directivo"].includes(user.rol);
  const [r, ejecuciones, horario] = await Promise.all([obtenerReglamento(), ultimasEjecuciones(), obtenerHorarioObra()]);
  const c = r.cuotas;
  const mesActual = textoMes(hoyEnUruguay().slice(0, 7));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reglas y avisos de la cooperativa"
        subtitle="El reglamento y lo que COOVA hace sola. Cada sección se guarda por separado."
      />
      <Card>
        <h2 className="text-lg font-bold text-ink">Lo que COOVA hace sola</h2>
        <Explicacion>Un resumen de todas las tareas automáticas. Las que hacen algo con la plata o mandan emails están apagadas hasta que la cooperativa las prenda abajo.</Explicacion>
        <ul className="mt-3 divide-y divide-border text-[15px]">
          {[
            { t: "Generar las cuotas del mes", on: c.automaticas },
            { t: "Recargos por atraso", on: c.recargoTipo !== "ninguno" },
            { t: "Avisar al socio de su cuota (y 3 días antes del vencimiento)", on: c.avisos },
            { t: "Mandar el recibo por email", on: r.recibos.porEmail },
            { t: "Resumen de los lunes", on: r.difusion.resumenSemanal },
            { t: "Confirmar sola la conciliación del banco cuando todo coincide", on: r.finanzas.conciliacionAutomatica },
            { t: "Exigir verificación en dos pasos a roles sensibles", on: r.seguridad.exigir2fa },
            { t: `Regla de compras grandes${r.compras.montoFormal > 0 ? ` (desde $ ${r.compras.montoFormal.toLocaleString("es-UY")})` : ""}`, on: r.compras.montoFormal > 0 },
          ].map((a) => (
            <li key={a.t} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{a.t}</span>
              <Badge color={a.on ? "verde" : "gray"}>{a.on ? "Prendido" : "Apagado"}</Badge>
            </li>
          ))}
          <li className="py-2 text-ink-muted">
            Siempre activos (sólo avisan, no cambian nada): presupuesto que se pasa, facturas por vencer, recordatorio de cierre del mes, mandatos por vencer, recordatorio de asamblea, pasos de trámites atrasados, cuentas sensibles sin uso, documentación de proveedores por vencer y cuotas de convenio impagas.
          </li>
        </ul>
        {editable && (
          <p className="mt-2 text-sm">
            <Link href="/reglas-automaticas" className="underline">
              Reglas automáticas a medida (avanzado)
            </Link>
          </p>
        )}
      </Card>

      {!editable && (
        <p className="rounded-xl bg-surface-sunken px-4 py-3 text-[15px] text-ink">Podés consultar el reglamento. Sólo la administración y el Consejo Directivo lo pueden cambiar.</p>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h2 className="text-lg font-bold text-ink">Cuotas del mes</h2>
          <Badge color={c.automaticas ? "verde" : "gray"}>{c.automaticas ? "Se generan solas" : "Se generan a mano"}</Badge>
        </div>
        <Explicacion>Si lo activás, cada mes COOVA crea la cuota de cada socio activo el día que elijas. Nunca la crea dos veces.</Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="cuotas" editable={editable}>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Generar las cuotas automáticamente?</legend>
              <Opcion name="cuotas_automaticas" value="si" actual={c.automaticas ? "si" : "no"} titulo="Sí, que COOVA las genere sola cada mes" />
              <Opcion name="cuotas_automaticas" value="no" actual={c.automaticas ? "si" : "no"} titulo="No, las generamos a mano" />
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <Label required>Monto de la cuota ($)</Label>
                <input name="cuotas_monto" type="number" min={0} step="0.01" defaultValue={c.monto || ""} className={inputClass} />
                <Explicacion>Si un núcleo tiene su propia cuota cargada, se usa la del núcleo.</Explicacion>
              </label>
              <label className="block">
                <Label required>Nombre de la cuota</Label>
                <input name="cuotas_concepto" defaultValue={c.concepto} maxLength={60} className={inputClass} />
                <Explicacion>Aparece así: «{c.concepto} {mesActual}».</Explicacion>
              </label>
              <label className="block">
                <Label required>Día del mes en que se genera</Label>
                <input name="cuotas_dia_generacion" type="number" min={1} max={28} defaultValue={c.diaGeneracion} className={inputClass} />
              </label>
              <label className="block">
                <Label required>Día del mes en que vence</Label>
                <input name="cuotas_dia_vencimiento" type="number" min={1} max={28} defaultValue={c.diaVencimiento} className={inputClass} />
              </label>
            </div>
          </SeccionReglamentoForm>
        </div>
        {canEdit(user.rol, "finanzas") && (
          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-[15px] text-ink mb-2">¿Necesitás las cuotas de {mesActual} ahora, sin esperar al día de generación?</p>
            <GenerarCuotasAhoraBoton />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Atrasos</h2>
        <Explicacion>Qué pasa cuando una cuota vence y no se pagó. El recargo se aplica una sola vez por cuota, después de los días de gracia.</Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="atrasos" editable={editable}>
            <label className="block max-w-xs">
              <Label required>Días de gracia después del vencimiento</Label>
              <input name="cuotas_dias_gracia" type="number" min={0} max={60} defaultValue={c.diasGracia} className={inputClass} />
            </label>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">Recargo por atraso</legend>
              <Opcion name="recargo_tipo" value="ninguno" actual={c.recargoTipo} titulo="Sin recargo" />
              <Opcion name="recargo_tipo" value="porcentaje" actual={c.recargoTipo} titulo="Un porcentaje de lo que se debe" detalle="Ej.: 5 = 5% de la cuota atrasada." />
              <Opcion name="recargo_tipo" value="fijo" actual={c.recargoTipo} titulo="Un monto fijo" detalle="Ej.: 200 = $ 200 por cuota atrasada." />
            </fieldset>
            <label className="block max-w-xs">
              <Label>Valor del recargo</Label>
              <input name="recargo_valor" type="number" min={0} step="0.01" defaultValue={c.recargoValor || ""} className={inputClass} />
            </label>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Avisos y recibos</h2>
        <Explicacion>Los avisos se mandan por email (a la dirección del socio) y aparecen en sus notificaciones de COOVA.</Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="avisos" editable={editable}>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Avisar al socio cuando se genera su cuota y 3 días antes de que venza?</legend>
              <Opcion name="avisos_cuotas" value="si" actual={c.avisos ? "si" : "no"} titulo="Sí, avisar" />
              <Opcion name="avisos_cuotas" value="no" actual={c.avisos ? "si" : "no"} titulo="No" />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Mandar el recibo por email cada vez que se registra un pago?</legend>
              <Opcion name="recibos_por_email" value="si" actual={r.recibos.porEmail ? "si" : "no"} titulo="Sí, mandar el recibo" />
              <Opcion name="recibos_por_email" value="no" actual={r.recibos.porEmail ? "si" : "no"} titulo="No" detalle="El recibo igual queda en COOVA para descargar e imprimir." />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Mandar los lunes un resumen de la semana (lo que viene, cuotas y avisos sin leer)?</legend>
              <Opcion name="avisos_resumen_semanal" value="si" actual={r.difusion.resumenSemanal ? "si" : "no"} titulo="Sí, mandar el resumen" detalle="Llega en COOVA y por email. Cada persona lo puede apagar en «Mis avisos»." />
              <Opcion name="avisos_resumen_semanal" value="no" actual={r.difusion.resumenSemanal ? "si" : "no"} titulo="No" />
            </fieldset>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Finanzas</h2>
        <Explicacion>Avisos para tesorería y el Consejo. El cierre de cada mes se hace en Finanzas → «Cierre del mes».</Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="finanzas" editable={editable}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <Label required>Avisar cuando un rubro llegue a este % de su presupuesto</Label>
                <input name="presupuesto_alerta_porcentaje" type="number" min={50} max={150} defaultValue={r.finanzas.alertaPresupuesto} className={inputClass} />
              </label>
              <label className="block">
                <Label required>Día del mes para recordar que hay que cerrar el mes anterior</Label>
                <input name="cierre_aviso_dia" type="number" min={1} max={28} defaultValue={r.finanzas.avisoCierreDia} className={inputClass} />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">Al importar el extracto del banco, ¿confirmar solas las transferencias que traen el código de pago del socio?</legend>
              <Opcion name="conciliacion_autoconfirmar" value="no" actual={r.finanzas.conciliacionAutomatica ? "si" : "no"} titulo="No, que las confirme una persona" />
              <Opcion name="conciliacion_autoconfirmar" value="si" actual={r.finanzas.conciliacionAutomatica ? "si" : "no"} titulo="Sí, si coinciden el código, el monto y la fecha" detalle="Sólo cuando el pago ya está registrado en COOVA. Igual queda a la vista para revisar." />
            </fieldset>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Asambleas</h2>
        <Explicacion>Lo que dice el estatuto. COOVA lo usa para avisar los plazos, armar el padrón habilitado y contar el quórum. La validez la decide siempre la mesa de la asamblea.</Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="asambleas" editable={editable}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <Label required>Días de anticipación para convocar (ordinaria)</Label>
                <input name="asamblea_anticipacion_ordinaria" type="number" min={0} max={120} defaultValue={r.asambleas.anticipacionOrdinaria} className={inputClass} />
              </label>
              <label className="block">
                <Label required>Días de anticipación (extraordinaria)</Label>
                <input name="asamblea_anticipacion_extraordinaria" type="number" min={0} max={120} defaultValue={r.asambleas.anticipacionExtraordinaria} className={inputClass} />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">Si se convoca con menos anticipación…</legend>
              <Opcion name="asamblea_plazo_modo" value="avisar" actual={r.asambleas.plazoModo} titulo="Avisar, pero dejar crearla" />
              <Opcion name="asamblea_plazo_modo" value="bloquear" actual={r.asambleas.plazoModo} titulo="No dejar crearla" />
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="block">
                <Label required>Quórum en primera convocatoria (% del padrón)</Label>
                <input name="asamblea_quorum_primera" type="number" min={0} max={100} defaultValue={r.asambleas.quorumPrimera} className={inputClass} />
                <span className="text-[13px] text-ink-muted">50 = más de la mitad</span>
              </label>
              <label className="block">
                <Label required>Quórum en segunda convocatoria (%)</Label>
                <input name="asamblea_quorum_segunda" type="number" min={0} max={100} defaultValue={r.asambleas.quorumSegunda} className={inputClass} />
                <span className="text-[13px] text-ink-muted">0 = con los presentes</span>
              </label>
              <label className="block">
                <Label required>Minutos hasta la segunda convocatoria</Label>
                <input name="asamblea_minutos_segunda" type="number" min={0} max={240} defaultValue={r.asambleas.minutosSegunda} className={inputClass} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <Label>Para votar: máximo de cuotas vencidas</Label>
                <input name="asamblea_max_cuotas_vencidas" inputMode="numeric" defaultValue={r.asambleas.maxCuotasVencidas ?? ""} placeholder="Vacío = no se exige" className={inputClass} />
              </label>
              <label className="block">
                <Label required>Para votar: antigüedad mínima (meses)</Label>
                <input name="asamblea_antiguedad_minima_meses" type="number" min={0} max={240} defaultValue={r.asambleas.antiguedadMinimaMeses} className={inputClass} />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Quién vota?</legend>
              <Opcion name="asamblea_voto" value="titular" actual={r.asambleas.voto} titulo="Un voto por socio titular" detalle="Cada núcleo vota a través de su titular." />
              <Opcion name="asamblea_voto" value="persona" actual={r.asambleas.voto} titulo="Un voto por persona adulta" detalle="El titular y cada integrante mayor de edad del núcleo." />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Se puede votar con un poder (representando a otro)?</legend>
              <Opcion name="asamblea_poderes" value="no" actual={r.asambleas.poderes ? "si" : "no"} titulo="No" />
              <Opcion name="asamblea_poderes" value="si" actual={r.asambleas.poderes ? "si" : "no"} titulo="Sí" />
            </fieldset>
            <label className="block max-w-xs">
              <Label required>Máximo de poderes por persona</Label>
              <input name="asamblea_poderes_max" type="number" min={1} max={10} defaultValue={r.asambleas.poderesMax} className={inputClass} />
            </label>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Compras grandes</h2>
        <Explicacion>Para las compras que superan un monto: cuántos presupuestos hacen falta y quién las aprueba. Si se aprueba con menos presupuestos, hay que escribir por qué y le llega el aviso a la Comisión Fiscal.</Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="compras" editable={editable}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <Label required>Monto a partir del cual aplica ($)</Label>
                <input name="compras_monto_formal" type="number" min={0} step="1" defaultValue={r.compras.montoFormal} className={inputClass} />
                <span className="text-[13px] text-ink-muted">0 = no hay regla</span>
              </label>
              <label className="block">
                <Label required>Presupuestos necesarios</Label>
                <input name="compras_presupuestos_minimos" type="number" min={1} max={5} defaultValue={r.compras.presupuestosMinimos} className={inputClass} />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Quién aprueba esas compras?</legend>
              <Opcion name="compras_aprobacion" value="tesoreria_o_consejo" actual={r.compras.aprobacion} titulo="Tesorería o el Consejo Directivo" />
              <Opcion name="compras_aprobacion" value="consejo" actual={r.compras.aprobacion} titulo="Sólo el Consejo Directivo" />
            </fieldset>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Horas de ayuda mutua</h2>
        <Explicacion>
          Cada núcleo tiene su objetivo semanal (se cambia en su ficha). Horario de obra: {horario.inicio} a {horario.fin} hs, descanso {horario.descansoInicio} a {horario.descansoFin} hs
          {editable && (
            <>
              {" "}(<Link href="/configuracion" className="underline">cambiar</Link>)
            </>
          )}
          .
        </Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="horas" editable={editable}>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">Cuando un núcleo falta con justificación…</legend>
              <Opcion name="horas_justificadas" value="no_generan_deuda" actual={r.horas.justificadas} titulo="No le genera deuda" detalle="Esas horas se descuentan del objetivo de esa semana." />
              <Opcion name="horas_justificadas" value="generan_deuda" actual={r.horas.justificadas} titulo="Las tiene que recuperar" detalle="Queda registrada como justificada, pero se deben." />
              <Opcion name="horas_justificadas" value="cuentan_como_hechas" actual={r.horas.justificadas} titulo="Cuentan como hechas" />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">Si un núcleo hace más horas de las que debe…</legend>
              <Opcion name="horas_a_favor" value="acumulan" actual={r.horas.aFavor} titulo="Le quedan a favor para otras semanas" />
              <Opcion name="horas_a_favor" value="no_acumulan" actual={r.horas.aFavor} titulo="No se acumulan" />
            </fieldset>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Ayuda para los socios</h2>
        <Explicacion>Aparece en la pantalla del socio: «¿Necesitás ayuda? Llamá a…».</Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="ayuda" editable={editable}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <Label>Teléfono</Label>
                <input name="ayuda_telefono" defaultValue={r.ayuda.telefono} maxLength={40} placeholder="Ej.: 099 123 456" className={inputClass} />
              </label>
              <label className="block">
                <Label>Horario</Label>
                <input name="ayuda_horario" defaultValue={r.ayuda.horario} maxLength={80} placeholder="Ej.: lunes a viernes de 18 a 20 hs" className={inputClass} />
              </label>
            </div>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Seguridad de las cuentas</h2>
        <Explicacion>
          La verificación en dos pasos pide, además de la contraseña, un código del celular. Se recomienda para administración, tesorería, Consejo Directivo y Comisión Fiscal.
        </Explicacion>
        <div className="mt-4">
          <SeccionReglamentoForm seccion="seguridad" editable={editable}>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink mb-1">¿Exigir la verificación en dos pasos a esos roles?</legend>
              <Opcion name="seguridad_exigir_2fa" value="si" actual={r.seguridad.exigir2fa ? "si" : "no"} titulo="Sí, exigirla" detalle="Quien no la tenga activada sólo va a poder entrar a «Mi seguridad» hasta activarla." />
              <Opcion name="seguridad_exigir_2fa" value="no" actual={r.seguridad.exigir2fa ? "si" : "no"} titulo="No, sólo recomendarla" />
            </fieldset>
          </SeccionReglamentoForm>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Lo que hizo el sistema solo</h2>
        {ejecuciones.length === 0 ? (
          <p className="text-[15px] text-ink-muted mt-1">Todavía nada.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-[15px]">
            {ejecuciones.map((e, i) => {
              let detalle = "";
              try {
                const j = JSON.parse(e.resultado || "{}");
                if (e.tipo === "generar_cuotas") detalle = `${j.generadas ?? 0} cuota(s)`;
                if (e.tipo === "recargos") detalle = `${j.recargos ?? 0} recargo(s)`;
              } catch {}
              return (
                <li key={i} className="py-2 flex flex-wrap justify-between gap-2">
                  <span>{TIPO_EJECUCION[e.tipo] ?? e.tipo} · {e.periodo}</span>
                  <span className="text-ink-muted">{detalle} · {e.ejecutado_en.slice(0, 16).replace("T", " ")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
