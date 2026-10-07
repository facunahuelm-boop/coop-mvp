import { all, get, insert, audit, run } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta, cuotasPorCobrar, cuotasMensualesEstimadas } from "@/lib/logic";
import { alertasFinancieras } from "@/lib/finanzasLibro";
import { obtenerReglamento, montoRecargo, textoMes, type Reglamento } from "@/lib/reglamento";
import { semanasSinCerrar, cerrarSemanaHoras } from "@/lib/libretaHoras";
import { enviarEmailAvisoSistema, urlBaseApp } from "@/lib/email";
import { crearNotificacion } from "@/lib/notificaciones";
import { sumarDias, textoSemana } from "@/lib/horasObra";
import { cuentasSensiblesInactivas, DIAS_INACTIVIDAD } from "@/lib/inactividad";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { conveniosConCuotaImpaga } from "@/lib/conveniosAtraso";
import { TIPO_DOC_PROVEEDOR_LABEL } from "@/lib/proveedoresDocs";

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
    `SELECT s.id, s.nombre, n.cuota_social AS cuota_nucleo FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id WHERE s.estado IN ('activo', 'suspendido', 'renunciante')`
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
          AND COALESCE(estado, 'activo') <> 'anulado' AND substr(fecha_vencimiento::text, 1, 7) = ?`,
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
      WHERE m.tipo = 'cargo' AND m.concepto = ? AND substr(m.fecha_vencimiento::text, 1, 7) = ? AND COALESCE(m.estado, 'activo') <> 'anulado'`,
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
  const socios = await all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado IN ('activo', 'suspendido', 'renunciante')`);
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
    `SELECT s.id, s.nombre, s.email, s.user_id, u.email AS user_email FROM socios s LEFT JOIN users u ON u.id = s.user_id WHERE s.estado IN ('activo', 'suspendido', 'renunciante')`
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

  // 5) Fase 2A: alertas de Finanzas (presupuesto, liquidez, facturas vencidas)
  //    y recordatorio a tesorería de las facturas que vencen en 3 días.
  try {
    const [cuotas, mensual] = await Promise.all([cuotasPorCobrar(), cuotasMensualesEstimadas()]);
    await alertasFinancieras(reglamento.finanzas.alertaPresupuesto, cuotas, mensual);
    const en3 = sumarDias(hoy, 3);
    const facturas = await all<{ id: number; monto: string; proveedor: string | null; numero: string | null }>(
      `SELECT f.id, f.monto, p.nombre AS proveedor, f.numero FROM facturas_proveedor f LEFT JOIN proveedores p ON p.id = f.proveedor_id
        WHERE f.estado = 'a_pagar' AND f.fecha_vencimiento = ?`,
      [en3]
    ).catch(() => []);
    if (facturas.length) {
      const tesoreria = await all<{ id: number }>(`SELECT id FROM users WHERE rol IN ('tesoreria', 'admin') AND activo = 1`);
      let avisos = 0;
      for (const f of facturas) {
        if (await yaEjecutada("recordatorio_factura", `F${f.id}`)) continue;
        for (const u of tesoreria) {
          await crearNotificacion({
            user_id: u.id,
            tipo: "recordatorio_factura",
            titulo: `En 3 días vence ${f.proveedor ? `la factura de ${f.proveedor}` : "una factura"}${f.numero ? ` N° ${f.numero}` : ""}: ${money(Number(f.monto))}`,
            ref_tabla: "facturas_proveedor",
            ref_id: f.id,
          }).catch(() => {});
        }
        await registrarEjecucion("recordatorio_factura", `F${f.id}`, { usuarios: tesoreria.length });
        avisos++;
      }
      resultado.recordatoriosFacturas = avisos;
    }
  } catch (err) {
    resultado.errorFinanzas = String((err as Error)?.message ?? err);
  }

  // 6) Fase 2D: A24 (mandato que vence en 60 días) y recordatorio de asamblea (el día antes).
  try {
    const en60 = sumarDias(hoy, 60);
    const mandatos = await all<{ id: number; nombre: string; cargo: string; fecha_fin_prevista: string }>(
      `SELECT c.id, u.nombre, c.cargo, c.fecha_fin_prevista FROM consejo_directivo_cargos c JOIN users u ON u.id = c.user_id
        WHERE c.fecha_fin IS NULL AND c.fecha_fin_prevista IS NOT NULL AND c.fecha_fin_prevista <= ? AND c.aviso_vencimiento_en IS NULL`,
      [en60]
    ).catch(() => []);
    if (mandatos.length) {
      const destino = await all<{ id: number }>(`SELECT id FROM users WHERE rol IN ('admin', 'consejo_directivo') AND activo = 1`);
      for (const m of mandatos) {
        for (const u of destino) {
          await crearNotificacion({
            user_id: u.id,
            tipo: "mandato_por_vencer",
            titulo: `El mandato de ${m.nombre} vence el ${m.fecha_fin_prevista.split("-").reverse().join("/")}: preparar la elección`,
            ref_tabla: "consejo_directivo_cargos",
            ref_id: m.id,
          }).catch(() => {});
        }
        await run(`UPDATE consejo_directivo_cargos SET aviso_vencimiento_en = ? WHERE id = ?`, [new Date().toISOString(), m.id]);
      }
      resultado.mandatosAvisados = mandatos.length;
    }
    const manana = sumarDias(hoy, 1);
    const asambleas = await all<{ id: number; titulo: string; fecha: string; lugar: string | null }>(
      `SELECT id, titulo, fecha, lugar FROM reuniones WHERE tipo = 'asamblea' AND estado = 'planificada' AND left(fecha::text, 10) = ? AND convocatoria_enviada_en IS NOT NULL`,
      [manana]
    ).catch(() => []);
    for (const a of asambleas) {
      if (await yaEjecutada("recordatorio_asamblea", `R${a.id}`)) continue;
      const usuarios = await all<{ id: number }>(`SELECT id FROM users WHERE activo = 1`);
      for (const u of usuarios) {
        await crearNotificacion({
          user_id: u.id,
          tipo: "recordatorio_asamblea",
          titulo: `Mañana es la asamblea${a.fecha.length > 10 ? ` (${a.fecha.slice(11, 16)})` : ""}${a.lugar ? ` en ${a.lugar}` : ""}`,
          ref_tabla: "reuniones",
          ref_id: a.id,
        }).catch(() => {});
      }
      await registrarEjecucion("recordatorio_asamblea", `R${a.id}`, { usuarios: usuarios.length });
    }
  } catch (err) {
    resultado.errorGobierno = String((err as Error)?.message ?? err);
  }

  // 7) Fase 2E — A27: paso de un trámite que pasó su fecha sin cumplirse.
  try {
    const vencidos = await all<{ id: number; titulo: string; fecha_estimada: string; responsable_id: number | null }>(
      `SELECT id, titulo, fecha_estimada, responsable_id FROM tramites_hitos
        WHERE activo = 1 AND estado IN ('pendiente', 'en_curso', 'trabado') AND fecha_estimada IS NOT NULL AND fecha_estimada < ?`,
      [hoy]
    ).catch(() => []);
    let avisados = 0;
    for (const h of vencidos) {
      const clave = `H${h.id}-${h.fecha_estimada}`;
      if (await yaEjecutada("hito_vencido", clave)) continue;
      const consejo = await all<{ id: number }>(`SELECT id FROM users WHERE rol IN ('consejo_directivo', 'admin') AND activo = 1`);
      const ids = [...new Set([...(h.responsable_id ? [h.responsable_id] : []), ...consejo.map((c) => c.id)])];
      for (const uid of ids) {
        await crearNotificacion({
          user_id: uid,
          tipo: "hito_vencido",
          titulo: `Pasó la fecha prevista de «${h.titulo}» (${h.fecha_estimada.split("-").reverse().join("/")})`,
          cuerpo: "Actualizá su estado o la nueva fecha estimada.",
          ref_tabla: "tramites_hitos",
          ref_id: h.id,
        }).catch(() => {});
      }
      await registrarEjecucion("hito_vencido", clave, { avisados: ids.length });
      avisados++;
    }
    if (avisados) resultado.hitosVencidos = avisados;
  } catch (err) {
    resultado.errorTramites = String((err as Error)?.message ?? err);
  }

  // 8) Fase 2F — A26: cuentas con permisos sensibles sin uso hace más de 60 días (aviso al admin, una vez por cuenta y mes).
  try {
    const inactivas = await cuentasSensiblesInactivas(hoy);
    if (inactivas.length) {
      const admins = await all<{ id: number }>(`SELECT id FROM users WHERE rol = 'admin' AND activo = 1`);
      let nuevas = 0;
      for (const u of inactivas) {
        if (!(await registrarEjecucion("inactividad_rol_sensible", `U${u.id}-${hoy.slice(0, 7)}`, { rol: u.rol, ultima: u.ultima }))) continue;
        nuevas++;
        for (const a of admins) {
          if (a.id === u.id) continue;
          await crearNotificacion({
            user_id: a.id,
            tipo: "inactividad_rol_sensible",
            titulo: `${u.nombre} (${ROLE_LABELS[u.rol as Role] ?? u.rol}) no usa COOVA hace más de ${DIAS_INACTIVIDAD} días`,
            cuerpo: "Si ya no cumple esa función, conviene desactivar la cuenta o cambiarle el rol.",
            ref_tabla: "users",
            ref_id: u.id,
          }).catch(() => {});
        }
      }
      if (nuevas) resultado.cuentasInactivas = nuevas;
    }
  } catch (err) {
    resultado.errorInactividad = String((err as Error)?.message ?? err);
  }

  // 10) Fase 2G: documentación de proveedores que vence en 30 días (aviso a Compras y Tesorería, una vez por documento y fecha).
  try {
    const en30 = sumarDias(hoy, 30);
    const docs = await all<{ id: number; proveedor_id: number; nombre: string; tipo: string; descripcion: string | null; fecha_vencimiento: string }>(
      `SELECT pd.id, pd.proveedor_id, p.nombre, pd.tipo, pd.descripcion, pd.fecha_vencimiento FROM proveedor_documentos pd JOIN proveedores p ON p.id = pd.proveedor_id
        WHERE pd.activo = 1 AND pd.fecha_vencimiento IS NOT NULL AND pd.fecha_vencimiento <= ? AND pd.fecha_vencimiento >= ?`,
      [en30, sumarDias(hoy, -1)]
    ).catch(() => []);
    let avisados = 0;
    for (const d of docs) {
      if (!(await registrarEjecucion("doc_proveedor_vence", `PD${d.id}-${d.fecha_vencimiento}`, { proveedor: d.proveedor_id }))) continue;
      const destino = await all<{ id: number }>(`SELECT id FROM users WHERE rol IN ('comision_compras', 'tesoreria') AND activo = 1`);
      for (const u of destino) {
        await crearNotificacion({
          user_id: u.id,
          tipo: "doc_proveedor_vence",
          titulo: `${d.nombre}: ${d.descripcion || TIPO_DOC_PROVEEDOR_LABEL[d.tipo] || d.tipo} vence el ${d.fecha_vencimiento.split("-").reverse().join("/")}`,
          cuerpo: "Pedile al proveedor el documento nuevo.",
          ref_tabla: "proveedores",
          ref_id: d.proveedor_id,
        }).catch(() => {});
      }
      await run(`UPDATE proveedor_documentos SET aviso_vencimiento_en = ? WHERE id = ?`, [new Date().toISOString(), d.id]).catch(() => {});
      avisados++;
    }
    if (avisados) resultado.docsProveedorAvisados = avisados;
  } catch (err) {
    resultado.errorProveedores = String((err as Error)?.message ?? err);
  }

  // 11) Fase 2G — A17: cuota de convenio impaga (aviso a tesorería y al socio; el Consejo lo ve como tema).
  try {
    const atrasados = await conveniosConCuotaImpaga(reglamento.cuotas.diasGracia);
    let avisados = 0;
    for (const c of atrasados) {
      const clave = `CV${c.convenioId}-${c.cuotaIds.join(".")}`;
      if (!(await registrarEjecucion("convenio_impago", clave, { socio: c.socioId, cuotas: c.cuotas, monto: c.monto }))) continue;
      const tesoreria = await all<{ id: number }>(`SELECT id FROM users WHERE rol IN ('tesoreria', 'administracion') AND activo = 1`);
      for (const u of tesoreria) {
        await crearNotificacion({
          user_id: u.id,
          tipo: "convenio_impago",
          titulo: `${c.nombre} no pagó ${c.cuotas === 1 ? "una cuota" : `${c.cuotas} cuotas`} de su convenio (${money(c.monto)})`,
          cuerpo: "Quedó como tema para el Consejo. Si corresponde, se puede dar el convenio por incumplido desde la ficha del socio.",
          ref_tabla: "socios",
          ref_id: c.socioId,
        }).catch(() => {});
      }
      const socioUser = await get<{ user_id: number | null }>(`SELECT user_id FROM socios WHERE id = ?`, [c.socioId]);
      if (socioUser?.user_id) {
        await crearNotificacion({
          user_id: socioUser.user_id,
          tipo: "convenio_impago",
          titulo: `Tenés ${c.cuotas === 1 ? "una cuota" : `${c.cuotas} cuotas`} del convenio sin pagar (${money(c.monto)})`,
          cuerpo: "Si tenés algún problema para pagar, hablá con Tesorería.",
          ref_tabla: "socios",
          ref_id: c.socioId,
        }).catch(() => {});
      }
      avisados++;
    }
    if (avisados) resultado.conveniosImpagos = avisados;
  } catch (err) {
    resultado.errorConvenios = String((err as Error)?.message ?? err);
  }

  // 9) Fase 2F — A20: resumen de los lunes (sólo si el reglamento lo prende; cada persona lo puede apagar).
  try {
    const esLunes = new Date(`${hoy}T12:00:00Z`).getUTCDay() === 1;
    if (esLunes && reglamento.difusion.resumenSemanal && !(await yaEjecutada("resumen_semanal", hoy))) {
      const r = await enviarResumenSemanal(hoy);
      await registrarEjecucion("resumen_semanal", hoy, r);
      resultado.resumenSemanal = r;
    }
  } catch (err) {
    resultado.errorResumen = String((err as Error)?.message ?? err);
  }
  return resultado;
}

/** A20: a cada persona, lo que viene en la semana, sus cuotas pendientes y sus avisos sin leer. */
export async function enviarResumenSemanal(hoy: string): Promise<{ personas: number; emails: number }> {
  const en7 = sumarDias(hoy, 7);
  const fecha = (f: string) => f.slice(0, 10).split("-").reverse().slice(0, 2).join("/");
  const [asambleas, reuniones, jornadas, hitos, usuarios, movs] = await Promise.all([
    all<{ titulo: string; fecha: string }>(`SELECT titulo, fecha FROM reuniones WHERE estado = 'planificada' AND tipo = 'asamblea' AND left(fecha::text, 10) BETWEEN ? AND ? ORDER BY fecha`, [hoy, en7]).catch(() => []),
    all<{ titulo: string; fecha: string }>(`SELECT titulo, fecha FROM reuniones WHERE estado = 'planificada' AND tipo <> 'asamblea' AND left(fecha::text, 10) BETWEEN ? AND ? ORDER BY fecha`, [hoy, en7]).catch(() => []),
    all<{ fecha: string }>(`SELECT fecha FROM jornadas_trabajo WHERE estado = 'planificada' AND left(fecha::text, 10) BETWEEN ? AND ? ORDER BY fecha`, [hoy, en7]).catch(() => []),
    all<{ titulo: string; fecha_estimada: string }>(
      `SELECT titulo, fecha_estimada FROM tramites_hitos WHERE activo = 1 AND visible_socios = 1 AND estado IN ('pendiente', 'en_curso', 'trabado') AND fecha_estimada BETWEEN ? AND ?`,
      [hoy, en7]
    ).catch(() => []),
    all<{ id: number; nombre: string; email: string | null; rol: string; aviso_email: number; socio_id: number | null }>(
      `SELECT u.id, u.nombre, u.email, u.rol, u.aviso_email,
              (SELECT MIN(s.id) FROM socios s WHERE s.user_id = u.id AND s.estado NOT IN ('baja', 'egresado', 'excluido')) AS socio_id
         FROM users u WHERE u.activo = 1 AND u.resumen_semanal = 1`
    ),
    cargarMovimientosCuenta().catch(() => []),
  ]);
  const porSocio = new Map<number, typeof movs>();
  for (const m of movs) porSocio.set(m.socio_id, [...(porSocio.get(m.socio_id) ?? []), m]);
  const sinLeer = new Map(
    (
      await all<{ user_id: number; n: string }>(
        `SELECT d.user_id, COUNT(*) AS n FROM aviso_destinatarios d JOIN avisos a ON a.id = d.aviso_id WHERE d.user_id IS NOT NULL AND d.leido_en IS NULL AND a.anulado_en IS NULL GROUP BY d.user_id`
      ).catch(() => [])
    ).map((f) => [f.user_id, Number(f.n)])
  );
  let personas = 0;
  let emails = 0;
  for (const u of usuarios) {
    const lineas: string[] = [];
    for (const a of asambleas) lineas.push(`${fecha(a.fecha)}: ${a.titulo}`);
    if (u.rol !== "socio") for (const r of reuniones) lineas.push(`${fecha(r.fecha)}: ${r.titulo}`);
    for (const j of jornadas) lineas.push(`${fecha(j.fecha)}: Jornada de trabajo`);
    for (const h of hitos) lineas.push(`${fecha(h.fecha_estimada)}: trámite «${h.titulo}» (fecha prevista)`);
    const parrafos = [lineas.length ? `Esta semana: ${lineas.join(" · ")}.` : "Esta semana no hay nada agendado."];
    if (u.socio_id) {
      const pend = calcularCuotasSocio(porSocio.get(u.socio_id) ?? []).cuotas.filter((c) => c.estado === "vencida" || c.estado === "pendiente" || c.estado === "parcial");
      if (pend.length) parrafos.push(`Cuotas por pagar: ${pend.length} (${money(Math.round(pend.reduce((a, c) => a + c.montoPendiente, 0)))}).`);
    }
    const n = sinLeer.get(u.id) ?? 0;
    if (n) parrafos.push(`Tenés ${n} aviso${n === 1 ? "" : "s"} oficial${n === 1 ? "" : "es"} sin leer.`);
    await crearNotificacion({ user_id: u.id, tipo: "resumen_semanal", titulo: "Tu resumen de la semana", cuerpo: parrafos.join("\n") }).catch(() => {});
    personas++;
    if (u.email && u.aviso_email !== 0) {
      const r = await enviarEmailAvisoSistema(u.email, u.nombre.split(" ")[0] || u.nombre, {
        asunto: "Tu resumen de la semana en la cooperativa",
        titulo: "Tu resumen de la semana",
        parrafos,
        boton: { texto: "Abrir COOVA", link: `${urlBaseApp()}/calendario` },
        pie: "Lo podés apagar en COOVA, en «Mis avisos».",
      }).catch(() => ({ ok: false }));
      if (r.ok) emails++;
    }
  }
  return { personas, emails };
}

/** Última vez que el sistema generó cuotas solo (para mostrarlo en el Reglamento). */
export async function ultimasEjecuciones(limite = 8) {
  return all<{ tipo: string; periodo: string; ejecutado_en: string; resultado: string | null }>(
    `SELECT tipo, periodo, ejecutado_en, resultado FROM ejecuciones_automaticas WHERE tipo NOT IN ('recordatorio_cuota', 'recordatorio_factura', 'recordatorio_asamblea', 'hito_vencido', 'inactividad_rol_sensible', 'doc_proveedor_vence', 'convenio_impago') ORDER BY id DESC LIMIT ?`,
    [limite]
  ).catch(() => []);
}

