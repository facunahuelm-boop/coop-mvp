import { all, get, insert, audit } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { obtenerReglamento, montoRecargo, textoMes, type Reglamento } from "@/lib/reglamento";
import { semanasSinCerrar, cerrarSemanaHoras } from "@/lib/libretaHoras";
import { enviarEmailAvisoSistema, urlBaseApp } from "@/lib/email";
import { crearNotificacion } from "@/lib/notificaciones";
import { sumarDias, textoSemana } from "@/lib/horasObra";

/**
 * Fase 1C — lo que el sistema hace solo, una vez por día y por cooperativa
 * (ver /api/cron/diario). Cada tarea:
 *  - respeta el reglamento de la cooperativa (todo apagado por defecto);
 *  - deja constancia en ejecuciones_automaticas (para no repetirse y para
 *    que se vea qué hizo y cuándo) y en la auditoría como "El sistema";
 *  - nunca borra nada y nunca frena a las demás tareas si una falla.
 */

const money = (n: number) => `$ ${n.toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;

async function yaEjecutada(tipo: string, periodo: string): Promise<boolean> {
  const f = await get<{ id: number }>(`SELECT id FROM ejecuciones_automaticas WHERE tipo = ? AND periodo = ?`, [tipo, periodo]);
  return !!f;
}

async function registrarEjecucion(tipo: string, periodo: string, resultado: unknown): Promise<boolean> {
  try {
    await insert("ejecuciones_automaticas", { tipo, periodo, resultado: JSON.stringify(resultado) });
    return true;
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") return false; // otra ejecución ya la registró
    throw err;
  }
}

/**
 * Genera la cuota del mes para cada socio activo. Monto: la cuota propia del
 * núcleo (nucleos_familiares.cuota_social) si tiene una, si no la del
 * reglamento. No duplica: si el socio ya tiene una cuota (que no sea de un
 * convenio) que vence ese mes, no se genera otra.
 */
export async function generarCuotasDelMes(mes: string, reglamento: Reglamento, usuarioId: number | null) {
  const r = reglamento.cuotas;
  const socios = await all<{ id: number; nombre: string; cuota_nucleo: number | null }>(
    `SELECT s.id, s.nombre, n.cuota_social AS cuota_nucleo FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id WHERE s.estado = 'activo'`
  );
  const vencimiento = `${mes}-${String(r.diaVencimiento).padStart(2, "0")}`;
  const concepto = `${r.concepto} ${textoMes(mes)}`;
  let generadas = 0;
  let sinMonto = 0;
  for (const s of socios) {
    const monto = Number(s.cuota_nucleo) > 0 ? Number(s.cuota_nucleo) : r.monto;
    if (!(monto > 0)) {
      sinMonto++;
      continue;
    }
    const ya = await get<{ id: number }>(
      `SELECT id FROM movimientos_cuenta_socio
        WHERE socio_id = ? AND tipo = 'cargo' AND convenio_id IS NULL AND recargo_de_id IS NULL
          AND COALESCE(estado, 'activo') <> 'anulado' AND substr(fecha_vencimiento, 1, 7) = ?`,
      [s.id, mes]
    );
    if (ya) continue;
    await insert("movimientos_cuenta_socio", {
      socio_id: s.id,
      tipo: "cargo",
      concepto,
      monto,
      fecha: `${mes}-01`,
      fecha_vencimiento: vencimiento,
      registrado_por_id: usuarioId,
      notas: usuarioId ? null : "Generada automáticamente según el reglamento.",
    });
    generadas++;
  }
  await audit({
    usuario_id: usuarioId,
    accion: "generar_cuota_mensual",
    entidad: "movimientos_cuenta_socio",
    entidad_id: 0,
    valor_nuevo: { concepto, mes, generadas, totalSocios: socios.length, sinMonto, automatica: usuarioId === null },
  });
  return { generadas, total: socios.length, sinMonto, concepto, vencimiento };
}

/** Avisa al socio (email + notificación en COOVA) que se generó su cuota. */
async function avisarCuotaGenerada(mes: string, concepto: string, vencimiento: string) {
  const filas = await all<{ socio_id: number; nombre: string; email: string | null; user_id: number | null; user_email: string | null; monto: number }>(
    `SELECT s.id AS socio_id, s.nombre, s.email, s.user_id, u.email AS user_email, m.monto
       FROM movimientos_cuenta_socio m JOIN socios s ON s.id = m.socio_id LEFT JOIN users u ON u.id = s.user_id
      WHERE m.tipo = 'cargo' AND m.concepto = ? AND substr(m.fecha_vencimiento, 1, 7) = ? AND COALESCE(m.estado, 'activo') <> 'anulado'`,
    [concepto, mes]
  );
  const [y, mm, d] = vencimiento.split("-");
  let emails = 0;
  for (const f of filas) {
    if (f.user_id) {
      await crearNotificacion({ user_id: f.user_id, tipo: "cuota_generada", titulo: `Tu ${concepto.toLowerCase()}: ${money(Number(f.monto))}, vence el ${d}/${mm}`, ref_tabla: "socios", ref_id: f.socio_id }).catch(() => {});
    }
    const destino = (f.email || f.user_email || "").trim();
    if (!destino) continue;
    const r = await enviarEmailAvisoSistema(destino, f.nombre.split(" ")[0] || f.nombre, {
      asunto: `Tu ${concepto.toLowerCase()}: ${money(Number(f.monto))}`,
      titulo: "Cuota del mes",
      parrafos: [`Ya está tu ${concepto.toLowerCase()}: ${money(Number(f.monto))}.`, `Vence el ${d}/${mm}/${y}.`],
      boton: { texto: "Ver lo que debo", link: `${urlBaseApp()}/socios/${f.socio_id}` },
    }).catch(() => ({ ok: false }));
    if (r.ok) emails++;
  }
  return emails;
}

/**
 * Recargo por atraso: una cuota vencida, con saldo, que superó los días de
 * gracia recibe UN recargo (según el reglamento). Nunca más de uno por cuota.
 */
export async function aplicarRecargos(hoy: string, reglamento: Reglamento) {
  const r = reglamento.cuotas;
  if (r.recargoTipo === "ninguno" || !(r.recargoValor > 0)) return { recargos: 0 };
  const socios = await all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado = 'activo'`);
  const conRecargo = new Set(
    (await all<{ recargo_de_id: number }>(
      `SELECT recargo_de_id FROM movimientos_cuenta_socio WHERE recargo_de_id IS NOT NULL AND COALESCE(estado, 'activo') <> 'anulado'`
    )).map((x) => x.recargo_de_id)
  );
  const sonRecargo = new Set(
    (await all<{ id: number }>(`SELECT id FROM movimientos_cuenta_socio WHERE recargo_de_id IS NOT NULL`)).map((x) => x.id)
  );
  let recargos = 0;
  for (const s of socios) {
    const { cuotas } = calcularCuotasSocio(await cargarMovimientosCuenta(s.id));
    for (const c of cuotas) {
      if (c.estado !== "vencida" || c.montoPendiente <= 0 || c.convenioId || conRecargo.has(c.id) || sonRecargo.has(c.id)) continue;
      if (!c.fechaVencimiento || sumarDias(c.fechaVencimiento, r.diasGracia) >= hoy) continue;
      const monto = montoRecargo(c.montoPendiente, r);
      if (!(monto > 0)) continue;
      try {
        await insert("movimientos_cuenta_socio", {
          socio_id: s.id,
          tipo: "cargo",
          concepto: `Recargo por atraso — ${c.concepto}`,
          monto,
          fecha: hoy,
          fecha_vencimiento: hoy,
          recargo_de_id: c.id,
          notas: `Recargo automático: la cuota venció el ${c.fechaVencimiento} y pasaron ${r.diasGracia} días de gracia.`,
        });
        recargos++;
        conRecargo.add(c.id);
        await audit({
          usuario_id: null,
          accion: "aplicar_recargo",
          entidad: "movimientos_cuenta_socio",
          entidad_id: c.id,
          valor_nuevo: { socio: s.nombre, concepto: `Recargo por atraso — ${c.concepto}`, monto },
        });
      } catch (err) {
        if ((err as { code?: string })?.code !== "23505") throw err; // ya tenía recargo (carrera): se ignora
      }
    }
  }
  return { recargos };
}

/** Recordatorio 3 días antes del vencimiento, una sola vez por cuota. */
export async function recordatoriosDeVencimiento(hoy: string) {
  const dentroDe3 = sumarDias(hoy, 3);
  const socios = await all<{ id: number; nombre: string; email: string | null; user_id: number | null; user_email: string | null }>(
    `SELECT s.id, s.nombre, s.email, s.user_id, u.email AS user_email FROM socios s LEFT JOIN users u ON u.id = s.user_id WHERE s.estado = 'activo'`
  );
  let enviados = 0;
  for (const s of socios) {
    const { cuotas } = calcularCuotasSocio(await cargarMovimientosCuenta(s.id));
    for (const c of cuotas) {
      if (c.fechaVencimiento !== dentroDe3 || c.montoPendiente <= 0 || c.estado === "convenio") continue;
      if (!(await registrarEjecucion("recordatorio_cuota", String(c.id), { socio: s.id }))) continue;
      const [y, m, d] = dentroDe3.split("-");
      if (s.user_id) {
        await crearNotificacion({ user_id: s.user_id, tipo: "recordatorio_cuota", titulo: `Tu cuota de ${money(c.montoPendiente)} vence el ${d}/${m}`, ref_tabla: "socios", ref_id: s.id }).catch(() => {});
      }
      const destino = (s.email || s.user_email || "").trim();
      if (destino) {
        const r = await enviarEmailAvisoSistema(destino, s.nombre.split(" ")[0] || s.nombre, {
          asunto: `Recordatorio: tu cuota vence el ${d}/${m}`,
          titulo: "Recordatorio de cuota",
          parrafos: [`Te recordamos que el ${d}/${m}/${y} vence ${c.concepto.toLowerCase()} por ${money(c.montoPendiente)}.`, "Si ya pagaste, no tenés que hacer nada."],
          boton: { texto: "Ver lo que debo", link: `${urlBaseApp()}/socios/${s.id}` },
        }).catch(() => ({ ok: false }));
        if (r.ok) enviados++;
      }
    }
  }
  return { enviados };
}

/** Todas las tareas automáticas del día para la cooperativa activa. */
export async function tareasDiariasCooperativa(hoy: string, etapa: string) {
  const resultado: Record<string, unknown> = {};
  const reglamento = await obtenerReglamento();

  // 1) Horas: cerrar semanas terminadas (sólo si la cooperativa organiza horas).
  try {
    const pendientes = etapa === "obra" ? await semanasSinCerrar(hoy) : [];
    const cerradas: string[] = [];
    for (const l of pendientes) {
      await cerrarSemanaHoras(l, hoy, null);
      await audit({ usuario_id: null, accion: "cerrar_semana_horas", entidad: "cierres_semana_horas", entidad_id: 0, valor_nuevo: { semana: textoSemana(l), automatico: true } });
      cerradas.push(l);
    }
    resultado.semanasCerradas = cerradas.length;
  } catch (err) {
    resultado.errorHoras = String((err as Error)?.message ?? err);
  }

  // 2) Cuotas del mes.
  try {
    const mes = hoy.slice(0, 7);
    if (reglamento.cuotas.automaticas && Number(hoy.slice(8, 10)) >= reglamento.cuotas.diaGeneracion && !(await yaEjecutada("generar_cuotas", mes))) {
      const r = await generarCuotasDelMes(mes, reglamento, null);
      if (await registrarEjecucion("generar_cuotas", mes, r)) {
        resultado.cuotas = r;
        if (reglamento.cuotas.avisos && r.generadas > 0) resultado.avisosCuota = await avisarCuotaGenerada(mes, r.concepto, r.vencimiento);
      }
    }
  } catch (err) {
    resultado.errorCuotas = String((err as Error)?.message ?? err);
  }

  // 3) Recargos por atraso.
  try {
    if (!(await yaEjecutada("recargos", hoy))) {
      const r = await aplicarRecargos(hoy, reglamento);
      await registrarEjecucion("recargos", hoy, r);
      resultado.recargos = r.recargos;
    }
  } catch (err) {
    resultado.errorRecargos = String((err as Error)?.message ?? err);
  }

  // 4) Recordatorios de vencimiento.
  try {
    if (reglamento.cuotas.avisos) resultado.recordatorios = (await recordatoriosDeVencimiento(hoy)).enviados;
  } catch (err) {
    resultado.errorRecordatorios = String((err as Error)?.message ?? err);
  }
  return resultado;
}

/** Última vez que el sistema generó cuotas solo (para mostrarlo en el Reglamento). */
export async function ultimasEjecuciones(limite = 8) {
  return all<{ tipo: string; periodo: string; ejecutado_en: string; resultado: string | null }>(
    `SELECT tipo, periodo, ejecutado_en, resultado FROM ejecuciones_automaticas WHERE tipo <> 'recordatorio_cuota' ORDER BY id DESC LIMIT ?`,
    [limite]
  ).catch(() => []);
}

