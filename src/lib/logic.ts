import dayjs from "dayjs";
import { all, get, upsertAlerta, insert } from "./db";
import { enviarEmailAlerta } from "./email";
import { canRead, type Role } from "./roles";

// Auditoría funcional Finanzas↔Socios (17/09): la app corre en un servidor
// cuya hora local puede no ser la de Uruguay (por ejemplo, Vercel corre en
// UTC). `dayjs()` sin huso horario usa la hora del PROCESO, no la de
// Montevideo — durante las últimas horas de cada día en Uruguay (cuando en
// UTC ya es "mañana"), una cuota que vence "hoy" quedaba marcada "vencida"
// unas horas antes de tiempo. `toLocaleDateString` con `timeZone` explícito
// no depende de ningún paquete adicional (a diferencia del plugin de husos
// horarios de dayjs) y da la fecha real del día en Uruguay sin importar
// dónde corra el servidor. Se usa para toda fecha "hoy" que decide el
// estado de una cuota o de un convenio (ver calcularCuotasSocio y
// actions/convenios.ts) — no se tocó ningún otro uso de `dayjs()` en el
// resto del sistema, que queda fuera del alcance de esta auditoría.
export function hoyEnUruguay(): string {
  // "en-CA" formatea como YYYY-MM-DD directamente, sin pasos intermedios.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date());
}

// Crea o actualiza una alerta y, si es realmente nueva (no existía ya abierta),
// dispara el email a la casilla configurada en Configuración (si hay una cargada).
async function crearAlerta(params: Parameters<typeof upsertAlerta>[0]) {
  const { esNueva } = await upsertAlerta(params);
  if (esNueva) {
    await enviarEmailAlerta({
      tipo: params.tipo,
      severidad: params.severidad,
      titulo: params.titulo,
      descripcion: params.descripcion,
      origen_modulo: params.origen_modulo,
    });
  }
}

// ============ SEMÁFORO DE OBRA ============
export type Semaforo = "verde" | "amarillo" | "rojo";

export async function semaforoTarea(tarea: {
  estado: string;
  fecha_fin_prevista: string | null;
  id: number;
}): Promise<Semaforo> {
  if (tarea.estado === "completada") return "verde";
  const problemasCriticos = await get<{ n: number }>(
    `SELECT COUNT(*) as n FROM problemas_obra WHERE tarea_id = ? AND estado = 'abierto' AND severidad = 'critica'`,
    [tarea.id]
  );
  if (problemasCriticos && problemasCriticos.n > 0) return "rojo";

  if (tarea.fecha_fin_prevista) {
    const dias = dayjs(tarea.fecha_fin_prevista).diff(dayjs(), "day");
    if (dias < 0) return "rojo";
    if (dias <= 5) return "amarillo";
  }
  const problemasAbiertos = await get<{ n: number }>(
    `SELECT COUNT(*) as n FROM problemas_obra WHERE tarea_id = ? AND estado = 'abierto'`,
    [tarea.id]
  );
  if (problemasAbiertos && problemasAbiertos.n > 0) return "amarillo";
  return "verde";
}

export async function tareasObraConSemaforo() {
  const tareas = await all<any>(
    `SELECT t.*, u.nombre as responsable_nombre, d.nombre as depende_de_nombre
     FROM tareas_obra t
     LEFT JOIN users u ON u.id = t.responsable_id
     LEFT JOIN tareas_obra d ON d.id = t.depende_de_id
     ORDER BY t.fecha_fin_prevista ASC`
  );
  return Promise.all(tareas.map(async (t) => ({ ...t, semaforo: await semaforoTarea(t) })));
}

// ============ FINANZAS ============
export async function resumenFinanciero() {
  const en30dias = dayjs().add(30, "day").format("YYYY-MM-DD");
  const inicioMes = dayjs().startOf("month").format("YYYY-MM-DD");

  const [ingresosRow, egresosRow, comprometidoRow, gastosProyectadosRow, ingresosMesRow, egresosMesRow, porCategoria, porCategoriaIngreso, presupuestoVsReal] =
    await Promise.all([
      get<{ s: number }>(`SELECT COALESCE(SUM(monto),0) as s FROM movimientos_financieros WHERE tipo = 'ingreso'`),
      get<{ s: number }>(`SELECT COALESCE(SUM(monto),0) as s FROM movimientos_financieros WHERE tipo = 'egreso'`),
      get<{ s: number }>(`SELECT COALESCE(SUM(monto),0) as s FROM compromisos_futuros`),
      get<{ s: number }>(
        `SELECT COALESCE(SUM(monto),0) as s FROM compromisos_futuros WHERE fecha_estimada <= ?`,
        [en30dias]
      ),
      // Ingresos del mes en curso — a diferencia de "ingresos" (histórico
      // acumulado desde siempre), esto es lo que entró desde el día 1 del mes
      // actual. "fecha" es TEXT (puede ser una fecha simple o un timestamp
      // completo según cómo se cargó el movimiento), por eso se compara
      // convertida a fecha en vez de como texto crudo.
      get<{ s: number }>(
        `SELECT COALESCE(SUM(monto),0) as s FROM movimientos_financieros WHERE tipo = 'ingreso' AND fecha::date >= ?::date`,
        [inicioMes]
      ),
      get<{ s: number }>(
        `SELECT COALESCE(SUM(monto),0) as s FROM movimientos_financieros WHERE tipo = 'egreso' AND fecha::date >= ?::date`,
        [inicioMes]
      ),
      all<{ categoria: string; total: number }>(
        `SELECT categoria, COALESCE(SUM(monto),0) as total FROM movimientos_financieros WHERE tipo='egreso' GROUP BY categoria ORDER BY total DESC`
      ),
      // Rediseño de Finanzas (18/09, pedido explícito: mismo patrón resumen
      // → click → pop-up ya usado en Compras): antes sólo existía el
      // desglose de EGRESOS por categoría (arriba) — el tile "Ingresos
      // totales" no tenía nada real que mostrar en su pop-up. Misma consulta,
      // sólo cambia el tipo.
      all<{ categoria: string; total: number }>(
        `SELECT categoria, COALESCE(SUM(monto),0) as total FROM movimientos_financieros WHERE tipo='ingreso' GROUP BY categoria ORDER BY total DESC`
      ),
      all<any>(
        `SELECT p.categoria, p.monto_presupuestado,
           COALESCE((SELECT SUM(monto) FROM movimientos_financieros m WHERE m.categoria = p.categoria AND m.tipo='egreso'), 0) as gastado
         FROM presupuesto_general p`
      ),
    ]);

  const ingresos = ingresosRow?.s ?? 0;
  const egresos = egresosRow?.s ?? 0;
  const saldo = ingresos - egresos;
  const comprometido = comprometidoRow?.s ?? 0;
  const gastosProyectados = gastosProyectadosRow?.s ?? 0;
  const disponiblePrudencial = saldo - comprometido;
  const ingresosMes = ingresosMesRow?.s ?? 0;
  const egresosMes = egresosMesRow?.s ?? 0;

  return {
    ingresos,
    egresos,
    saldo,
    comprometido,
    gastosProyectados,
    disponiblePrudencial,
    ingresosMes,
    egresosMes,
    porCategoria,
    porCategoriaIngreso,
    presupuestoVsReal,
  };
}

/**
 * Fase 10 del Plan Maestro — cuenta corriente por socio. La ficha de cada
 * socio (/socios/[id]) ya muestra su propio saldo ("¿cuánto debo?"), pero
 * eso no le sirve a Tesorería para saber, de un vistazo, quién debe y
 * cuánto en total — hoy tendría que abrir socio por socio. Esta función
 * arma esa vista consolidada: mismo cálculo de saldo que la ficha
 * individual (cargos menos pagos), pero para todos los socios a la vez,
 * ordenado por deuda de mayor a menor.
 */
export async function cuentasPorCobrar() {
  // Auditoría funcional Finanzas↔Socios (17/09): esta función calculaba el
  // saldo de cada socio con su propia fórmula SQL (cargos menos pagos),
  // separada de calcularCuotasSocio — la MISMA cuenta que ya arma la ficha
  // individual, "Cuotas y convenios" de Finanzas y "Mi cuenta". Hoy dan el
  // mismo número, pero son dos implementaciones que hay que mantener
  // sincronizadas a mano; si mañana calcularCuotasSocio cambia (un nuevo
  // caso de convenio, por ejemplo), esta tarjeta del dashboard quedaría
  // mostrando un total distinto al resto del sistema sin que nadie lo note.
  // Se unifica en una sola fuente de verdad, mismo patrón que ya usa
  // resumenCuotasSocios() acá abajo.
  const [socios, movimientos] = await Promise.all([
    all<{ id: number; nombre: string; vivienda_numero: string | null }>(
      `SELECT s.id, s.nombre, v.numero as vivienda_numero
       FROM socios s
       LEFT JOIN viviendas v ON v.id = s.vivienda_id
       WHERE s.estado != 'baja'`
    ),
    all<MovimientoCuentaSocio & { socio_id: number }>(
      `SELECT id, socio_id, tipo, concepto, monto, fecha, fecha_vencimiento, convenio_id
       FROM movimientos_cuenta_socio ORDER BY socio_id, fecha ASC, id ASC`
    ),
  ]);

  const movimientosPorSocio = new Map<number, (MovimientoCuentaSocio & { socio_id: number })[]>();
  for (const m of movimientos) {
    if (!movimientosPorSocio.has(m.socio_id)) movimientosPorSocio.set(m.socio_id, []);
    movimientosPorSocio.get(m.socio_id)!.push(m);
  }

  const filas = socios
    .map((s) => {
      const { saldo } = calcularCuotasSocio(movimientosPorSocio.get(s.id) || []);
      return { socio_id: s.id, nombre: s.nombre, vivienda_numero: s.vivienda_numero, saldo };
    })
    .filter((f) => f.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo);
  const totalACobrar = Math.round(filas.reduce((acc, f) => acc + f.saldo, 0) * 100) / 100;
  return { filas, totalACobrar };
}

/**
 * Rediseño profundo de Finanzas (pedido explícito, 16/09) — cuotas y
 * convenios de pago por socio, migración 0027.
 *
 * A propósito NO se guarda un estado "pendiente/vencida/pagada" en cada
 * cargo (mismo criterio que ya usa el saldo general: una sola fuente de
 * verdad). En cambio, esta función reparte los pagos contra los cargos más
 * antiguos primero (FIFO — el pago más viejo cubre la cuota más vieja),
 * exactamente como cualquier cuenta corriente real: un pago no dice "esto es
 * para la cuota de julio", simplemente entra y cubre lo más atrasado.
 */
export type EstadoCuota = "pendiente" | "vencida" | "pagada" | "parcial";

export type MovimientoCuentaSocio = {
  id: number;
  tipo: "cargo" | "pago";
  concepto: string;
  monto: number | string;
  fecha: string;
  fecha_vencimiento?: string | null;
  convenio_id?: number | null;
  comprobante_url?: string | null;
};

export type CuotaCalculada = {
  id: number;
  concepto: string;
  monto: number;
  fecha: string;
  fechaVencimiento: string | null;
  convenioId: number | null;
  comprobanteUrl: string | null;
  estado: EstadoCuota;
  montoPendiente: number;
};

export function calcularCuotasSocio(movimientos: MovimientoCuentaSocio[]): { cuotas: CuotaCalculada[]; saldo: number } {
  const hoy = hoyEnUruguay();
  const cargos = movimientos
    .filter((m) => m.tipo === "cargo")
    .slice()
    .sort((a, b) => (a.fecha_vencimiento || a.fecha).localeCompare(b.fecha_vencimiento || b.fecha) || a.id - b.id);
  const pagos = movimientos
    .filter((m) => m.tipo === "pago")
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);

  let disponible = pagos.reduce((acc, p) => acc + Number(p.monto), 0);
  const cuotas: CuotaCalculada[] = cargos.map((c) => {
    const monto = Number(c.monto);
    const aplicado = Math.min(disponible, monto);
    disponible -= aplicado;
    const montoPendiente = Math.round((monto - aplicado) * 100) / 100;
    let estado: EstadoCuota;
    if (montoPendiente <= 0) estado = "pagada";
    else if (aplicado > 0) estado = "parcial";
    else if (c.fecha_vencimiento && c.fecha_vencimiento < hoy) estado = "vencida";
    else estado = "pendiente";
    return {
      id: c.id,
      concepto: c.concepto,
      monto,
      fecha: c.fecha,
      fechaVencimiento: c.fecha_vencimiento || null,
      convenioId: c.convenio_id ?? null,
      comprobanteUrl: null, // los comprobantes van sobre el PAGO, no el cargo — ver movimientos originales para eso
      estado,
      montoPendiente,
    };
  });

  const saldo =
    cargos.reduce((a, c) => a + Number(c.monto), 0) - pagos.reduce((a, p) => a + Number(p.monto), 0);
  return { cuotas, saldo: Math.round(saldo * 100) / 100 };
}

export type MiCuentaData = {
  nombre: string;
  email: string;
  avatarUrl: string | null;
  rol: Role;
  activo: boolean;
  creadoEn: string;
  comisiones: { id: number; nombre: string; coordinador: boolean }[];
  socio: {
    id: number;
    estado: string;
    telefono: string | null;
    emailContacto: string | null;
    saldo: number;
    cuotasPendientes: number;
    cuotasVencidas: number;
    proximoVencimiento: string | null;
    convenio: { id: number; motivo: string; montoCuota: number } | null;
    movimientosRecientes: MovimientoCuentaSocio[];
  } | null;
};

/**
 * Rediseño "Mi cuenta" en la barra superior (pedido explícito, 17/09):
 * acceso único y compacto, visible para CUALQUIER rol (a diferencia de la
 * tarjeta "Mi cuenta" del Inicio, que solo existía para quien tuviera fila
 * en `socios`). Junta en una sola consulta lo que antes estaba repartido
 * entre usuarios/[id] (perfil + comisiones) y el dashboard (estado de
 * cuenta) — reutiliza calcularCuotasSocio como única fuente de verdad para
 * el cálculo de cuotas, no duplica esa lógica. `socio` viene null cuando la
 * cuenta no tiene un núcleo/socio asociado (ej. un usuario técnico o admin
 * de sistema sin vivienda propia) — el llamador decide cómo mostrarlo.
 *
 * SIEMPRE se llama con el id del usuario de la sesión actual (nunca con un
 * id recibido de un formulario o de la URL): esta función no vuelve a
 * verificar permisos porque no tiene sentido pedirle "mi cuenta" de otra
 * persona — el propio storage de la sesión ya es el control de acceso.
 */
export async function datosMiCuenta(userId: number): Promise<MiCuentaData | null> {
  const usuario = await get<{ nombre: string; email: string; avatar_url: string | null; rol: Role; activo: number; creado_en: string }>(
    `SELECT nombre, email, avatar_url, rol, activo, creado_en FROM users WHERE id = ?`,
    [userId]
  );
  if (!usuario) return null;

  const comisionesRows = await all<{ id: number; nombre: string; rol_en_comision: string }>(
    `SELECT c.id, c.nombre, cm.rol_en_comision
     FROM comision_miembros cm
     JOIN comisiones c ON c.id = cm.comision_id
     WHERE cm.user_id = ? AND cm.activo = 1
     ORDER BY c.nombre ASC`,
    [userId]
  ).catch(() => [] as { id: number; nombre: string; rol_en_comision: string }[]);

  const socioRow = await get<{ id: number; estado: string; telefono: string | null; email: string | null }>(
    `SELECT id, estado, telefono, email FROM socios WHERE user_id = ?`,
    [userId]
  );

  let socio: MiCuentaData["socio"] = null;
  if (socioRow) {
    const movimientos = await all<MovimientoCuentaSocio>(
      `SELECT id, tipo, concepto, monto, fecha, fecha_vencimiento, convenio_id, comprobante_url
       FROM movimientos_cuenta_socio WHERE socio_id = ? ORDER BY fecha DESC, id DESC`,
      [socioRow.id]
    );
    const { cuotas, saldo } = calcularCuotasSocio(movimientos);
    const convenio = (await get<{ id: number; motivo: string; monto_cuota: number }>(
      `SELECT id, motivo, monto_cuota FROM convenios_pago WHERE socio_id = ? AND estado = 'activo' ORDER BY creado_en DESC LIMIT 1`,
      [socioRow.id]
    ).catch(() => null)) ?? null;
    socio = {
      id: socioRow.id,
      estado: socioRow.estado,
      telefono: socioRow.telefono,
      emailContacto: socioRow.email,
      saldo,
      cuotasPendientes: cuotas.filter((c) => c.estado === "pendiente" || c.estado === "parcial").length,
      cuotasVencidas: cuotas.filter((c) => c.estado === "vencida").length,
      proximoVencimiento:
        cuotas
          .filter((c) => (c.estado === "pendiente" || c.estado === "parcial") && c.fechaVencimiento)
          .map((c) => c.fechaVencimiento as string)
          .sort()[0] || null,
      convenio: convenio ? { id: convenio.id, motivo: convenio.motivo, montoCuota: Number(convenio.monto_cuota) } : null,
      movimientosRecientes: movimientos.slice(0, 8),
    };
  }

  return {
    nombre: usuario.nombre,
    email: usuario.email,
    avatarUrl: usuario.avatar_url,
    rol: usuario.rol,
    activo: !!usuario.activo,
    creadoEn: usuario.creado_en,
    comisiones: comisionesRows.map((c) => ({ id: c.id, nombre: c.nombre, coordinador: c.rol_en_comision === "coordinador" })),
    socio,
  };
}

/**
 * Vista consolidada para la nueva pestaña "Cuotas y convenios" de Finanzas:
 * mismo cálculo que la ficha individual de cada socio (calcularCuotasSocio),
 * para todos los socios activos a la vez — así Tesorería/Administración no
 * tienen que entrar socio por socio para ver quién debe, quién tiene cuotas
 * vencidas y quién tiene un convenio en curso.
 */
export async function resumenCuotasSocios() {
  const [socios, movimientos, convenios] = await Promise.all([
    all<{ id: number; nombre: string; vivienda_numero: string | null; nucleo_nombre: string | null }>(
      `SELECT s.id, s.nombre, v.numero as vivienda_numero, n.nombre as nucleo_nombre
       FROM socios s
       LEFT JOIN viviendas v ON v.id = s.vivienda_id
       LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
       WHERE s.estado != 'baja'
       ORDER BY s.nombre ASC`
    ),
    all<MovimientoCuentaSocio & { socio_id: number }>(
      `SELECT id, socio_id, tipo, concepto, monto, fecha, fecha_vencimiento, convenio_id
       FROM movimientos_cuenta_socio ORDER BY socio_id, fecha ASC, id ASC`
    ),
    all<{ id: number; socio_id: number; motivo: string; monto_cuota: number }>(
      `SELECT id, socio_id, motivo, monto_cuota FROM convenios_pago WHERE estado = 'activo'`
    ),
  ]);

  const movimientosPorSocio = new Map<number, (MovimientoCuentaSocio & { socio_id: number })[]>();
  for (const m of movimientos) {
    if (!movimientosPorSocio.has(m.socio_id)) movimientosPorSocio.set(m.socio_id, []);
    movimientosPorSocio.get(m.socio_id)!.push(m);
  }
  const convenioPorSocio = new Map<number, { id: number; motivo: string; monto_cuota: number }>();
  for (const c of convenios) convenioPorSocio.set(c.socio_id, c);

  const filas = socios.map((s) => {
    const { cuotas, saldo } = calcularCuotasSocio(movimientosPorSocio.get(s.id) || []);
    const pendientes = cuotas.filter((c) => c.estado === "pendiente" || c.estado === "parcial");
    const vencidas = cuotas.filter((c) => c.estado === "vencida");
    const proximoVencimiento = pendientes
      .filter((c) => c.fechaVencimiento)
      .map((c) => c.fechaVencimiento as string)
      .sort()[0] || null;
    return {
      socioId: s.id,
      nombre: s.nombre,
      viviendaNumero: s.vivienda_numero,
      nucleoNombre: s.nucleo_nombre,
      totalAdeudado: Math.max(0, Math.round(saldo * 100) / 100),
      cuotasPendientes: pendientes.length,
      cuotasVencidas: vencidas.length,
      proximoVencimiento,
      convenio: convenioPorSocio.get(s.id) || null,
    };
  });

  const totalAdeudado = filas.reduce((a, f) => a + f.totalAdeudado, 0);
  const totalVencidas = filas.reduce((a, f) => a + f.cuotasVencidas, 0);
  const convenioActivos = convenios.length;
  return { filas, totalAdeudado: Math.round(totalAdeudado * 100) / 100, totalVencidas, convenioActivos };
}

/**
 * Rediseño "Color secundario + Top Bar" (puntos 11-12): datos para la
 * campanita de notificaciones de la Top Bar — se muestra en CUALQUIER
 * pantalla (vive en (app)/layout.tsx), a diferencia de recalcularAlertas()
 * de abajo, que hoy sólo corre una vez por visita a /dashboard y hace un
 * trabajo pesado (recorre documentos, incidentes, tareas, etc. y escribe en
 * la tabla `alertas`). Llamar recalcularAlertas() en cada navegación de toda
 * la app sería carísimo — esta función sólo LEE lo que ya quedó calculado
 * la última vez que alguien entró a Inicio, igual que ya hacía el propio
 * Dashboard con su bloque de alertas (mismo criterio, misma tabla, sin
 * escribir nada nuevo).
 */
export async function alertasParaTopBar(limite: number = 5) {
  const abiertas = await all<{ id: number; titulo: string; severidad: string; fecha: string }>(
    `SELECT id, titulo, severidad, fecha FROM alertas WHERE estado = 'abierta'
     ORDER BY CASE severidad WHEN 'critica' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, fecha DESC`
  );
  return {
    count: abiertas.length,
    hayCriticas: abiertas.some((a) => a.severidad === "critica"),
    items: abiertas.slice(0, limite),
  };
}

// ============ MOTOR DE ALERTAS ============
// Recalcula alertas automáticas a partir de los datos actuales.
// Los umbrales son un punto de partida configurable (ver sección 12 del análisis).
export async function recalcularAlertas() {
  // Documentos de seguridad vencidos / próximos a vencer
  const docs = await all<any>(`SELECT * FROM documentos_seguridad WHERE fecha_vencimiento IS NOT NULL`);
  const hoy = dayjs();
  for (const d of docs) {
    const dias = dayjs(d.fecha_vencimiento).diff(hoy, "day");
    if (dias < 0) {
      await crearAlerta({
        tipo: "documento_vencido",
        severidad: "critica",
        origen_modulo: "seguridad",
        titulo: `Documento vencido: ${d.tipo}`,
        descripcion: `${d.descripcion || d.tipo} venció el ${d.fecha_vencimiento}.`,
        asignado_a_rol: "comision_seguridad",
        ref_tabla: "documentos_seguridad",
        ref_id: d.id,
      });
    } else if (dias <= 15) {
      await crearAlerta({
        tipo: "documento_por_vencer",
        severidad: "importante",
        origen_modulo: "seguridad",
        titulo: `Documento próximo a vencer: ${d.tipo}`,
        descripcion: `${d.descripcion || d.tipo} vence el ${d.fecha_vencimiento} (${dias} días).`,
        asignado_a_rol: "comision_seguridad",
        ref_tabla: "documentos_seguridad",
        ref_id: d.id,
      });
    }
  }

  // Incidentes de seguridad críticos abiertos
  const incidentesCriticos = await all<any>(
    `SELECT * FROM incidentes_seguridad WHERE estado != 'resuelto' AND severidad = 'critica'`
  );
  for (const i of incidentesCriticos) {
    await crearAlerta({
      tipo: "riesgo_critico",
      severidad: "critica",
      origen_modulo: "seguridad",
      titulo: "Riesgo crítico de seguridad abierto",
      descripcion: i.descripcion,
      asignado_a_rol: "consejo_directivo",
      ref_tabla: "incidentes_seguridad",
      ref_id: i.id,
    });
  }

  // Tareas de obra atrasadas
  const tareas = await tareasObraConSemaforo();
  for (const t of tareas as any[]) {
    if (t.semaforo === "rojo" && t.estado !== "completada") {
      const dias = t.fecha_fin_prevista ? -dayjs(t.fecha_fin_prevista).diff(dayjs(), "day") : null;
      await crearAlerta({
        tipo: "tarea_atrasada",
        severidad: t.prioridad === "critica" ? "critica" : "importante",
        origen_modulo: "obra",
        titulo: `Tarea atrasada: ${t.nombre}`,
        descripcion: dias ? `Lleva ${dias} día(s) de atraso.` : "Tiene un problema crítico abierto.",
        asignado_a_rol: "comision_obra",
        ref_tabla: "tareas_obra",
        ref_id: t.id,
      });
    }
  }

  // Problemas de obra críticos abiertos
  const problemas = await all<any>(`SELECT * FROM problemas_obra WHERE estado='abierto' AND severidad='critica'`);
  for (const p of problemas) {
    await crearAlerta({
      tipo: "problema_critico",
      severidad: "critica",
      origen_modulo: "obra",
      titulo: `Problema crítico abierto: ${p.titulo}`,
      descripcion: p.descripcion,
      asignado_a_rol: "consejo_directivo",
      ref_tabla: "problemas_obra",
      ref_id: p.id,
    });
  }

  // Compras pendientes de aprobación vinculadas a tarea crítica/alta prioridad
  const solicitudes = await all<any>(
    `SELECT * FROM solicitudes_compra WHERE estado IN ('pendiente_cotizacion','en_comparacion')`
  );
  for (const s of solicitudes) {
    if (s.prioridad === "critica" || s.prioridad === "alta") {
      await crearAlerta({
        tipo: "compra_pendiente_critica",
        severidad: s.prioridad === "critica" ? "critica" : "importante",
        origen_modulo: "compras",
        titulo: `Compra prioritaria sin resolver: ${s.material}`,
        descripcion: `Solicitada por ${s.comision}, prioridad ${s.prioridad}.`,
        asignado_a_rol: "comision_compras",
        ref_tabla: "solicitudes_compra",
        ref_id: s.id,
      });
    }
  }

  // Reclamos de alta prioridad todavía sin tomar (Reclamos y Mantenimiento)
  const reclamosAltaPrioridad = await all<any>(
    `SELECT * FROM reclamos WHERE estado='abierto' AND prioridad='alta'`
  );
  for (const r of reclamosAltaPrioridad) {
    await crearAlerta({
      tipo: "reclamo_alta_prioridad",
      severidad: "importante",
      origen_modulo: "reclamos",
      titulo: `Reclamo de alta prioridad sin tomar: ${r.titulo}`,
      descripcion: r.descripcion || "Sin descripción adicional.",
      asignado_a_rol: "comision_seguridad",
      ref_tabla: "reclamos",
      ref_id: r.id,
    });
  }

  // Finanzas: disponible prudencial bajo o negativo
  const fin = await resumenFinanciero();
  if (fin.disponiblePrudencial < 0) {
    await crearAlerta({
      tipo: "disponible_negativo",
      severidad: "critica",
      origen_modulo: "finanzas",
      titulo: "El disponible prudencial es negativo",
      descripcion: `Saldo $${fin.saldo.toLocaleString("es-UY")} menos comprometido $${fin.comprometido.toLocaleString("es-UY")} da un disponible negativo.`,
      asignado_a_rol: "tesoreria",
      ref_tabla: "movimientos_financieros",
    });
  } else if (fin.disponiblePrudencial < fin.gastosProyectados) {
    await crearAlerta({
      tipo: "disponible_bajo",
      severidad: "importante",
      origen_modulo: "finanzas",
      titulo: "El disponible prudencial es menor a los gastos proyectados a 30 días",
      descripcion: `Disponible $${fin.disponiblePrudencial.toLocaleString("es-UY")} vs. proyectado $${fin.gastosProyectados.toLocaleString("es-UY")}.`,
      asignado_a_rol: "tesoreria",
      ref_tabla: "movimientos_financieros",
    });
  }

  // Presupuesto vs real: desviación > 15%
  for (const p of fin.presupuestoVsReal as any[]) {
    if (p.monto_presupuestado > 0) {
      const desv = (p.gastado - p.monto_presupuestado) / p.monto_presupuestado;
      if (desv > 0.15) {
        await crearAlerta({
          tipo: "desvio_presupuesto",
          severidad: desv > 0.3 ? "critica" : "importante",
          origen_modulo: "finanzas",
          titulo: `Desviación de presupuesto en ${p.categoria}`,
          descripcion: `Gastado $${p.gastado.toLocaleString("es-UY")} vs. presupuestado $${p.monto_presupuestado.toLocaleString("es-UY")} (${Math.round(desv * 100)}% de más).`,
          asignado_a_rol: "tesoreria",
          ref_tabla: "presupuesto_general",
        });
      }
    }
  }

  // Jornada próxima con tareas sin cubrir
  const proximaJornada = await get<any>(
    `SELECT * FROM jornadas_trabajo WHERE fecha >= CURRENT_DATE::text AND estado='planificada' ORDER BY fecha ASC LIMIT 1`
  );
  if (proximaJornada) {
    const tareasJ = await all<any>(`SELECT * FROM tareas_jornada WHERE jornada_id = ?`, [proximaJornada.id]);
    for (const tj of tareasJ) {
      const asignadosRow = await get<{ n: number }>(
        `SELECT COUNT(*) as n FROM asignaciones_jornada WHERE tarea_jornada_id = ?`,
        [tj.id]
      );
      const asignados = asignadosRow?.n ?? 0;
      if (asignados < tj.personas_necesarias) {
        await crearAlerta({
          tipo: "tarea_jornada_sin_cubrir",
          severidad: "importante",
          origen_modulo: "trabajo",
          titulo: `Tarea sin cubrir en la próxima jornada: ${tj.nombre}`,
          descripcion: `Necesita ${tj.personas_necesarias}, asignados ${asignados}.`,
          asignado_a_rol: "comision_trabajo",
          ref_tabla: "tareas_jornada",
          ref_id: tj.id,
        });
      }
    }
  }
}

// ============ COMPARACIÓN DE PRESUPUESTOS (motor local, sin LLM) ============
export async function compararPresupuestos(solicitudId: number) {
  // pv.estado (Rediseño profundo de Compras, Fase 6, sección 18: distinguir
  // 🟢 proveedor habitual de 🟡 nuevo/en evaluación directamente en el
  // comparador) — columna ya existente desde la migración 0018, sólo faltaba
  // traerla hasta acá para poder mostrarla.
  const presupuestos = await all<any>(
    `SELECT pp.*, pv.nombre as proveedor_nombre, pv.estado as proveedor_estado
     FROM presupuestos_proveedor pp JOIN proveedores pv ON pv.id = pp.proveedor_id
     WHERE pp.solicitud_id = ?`,
    [solicitudId]
  );
  if (presupuestos.length === 0) {
    return { texto: "Todavía no hay presupuestos cargados para esta solicitud.", presupuestos: [] };
  }

  const masBarato = [...presupuestos].sort((a, b) => (a.precio + (a.costo_envio || 0)) - (b.precio + (b.costo_envio || 0)))[0];
  const masRapido = [...presupuestos].filter((p) => p.plazo_entrega_dias != null).sort((a, b) => a.plazo_entrega_dias - b.plazo_entrega_dias)[0];
  const conGarantia = presupuestos.filter((p) => p.garantia && p.garantia.trim().length > 0 && !/^no/i.test(p.garantia.trim()));

  const lineas: string[] = [];
  lineas.push(`Comparación entre ${presupuestos.length} presupuesto(s) cargados:`);
  presupuestos.forEach((p) => {
    const total = p.precio + (p.costo_envio || 0);
    lineas.push(
      `• ${p.proveedor_nombre}: $${p.precio.toLocaleString("es-UY")}${p.costo_envio ? ` + $${p.costo_envio.toLocaleString("es-UY")} de envío (total $${total.toLocaleString("es-UY")})` : ""}${p.plazo_entrega_dias != null ? `, entrega en ${p.plazo_entrega_dias} días` : ""}${p.forma_pago ? `, pago: ${p.forma_pago}` : ""}${p.garantia ? `, garantía: ${p.garantia}` : ", sin garantía informada"}.`
    );
  });

  lineas.push("");
  lineas.push(`Proveedor ${masBarato.proveedor_nombre} es el más barato en total (precio + envío).`);
  if (masRapido) lineas.push(`Proveedor ${masRapido.proveedor_nombre} ofrece el plazo de entrega más corto (${masRapido.plazo_entrega_dias} días).`);
  if (conGarantia.length > 0 && masBarato.id !== conGarantia[0].id) {
    lineas.push(`${conGarantia.map((p) => p.proveedor_nombre).join(", ")} ofrece(n) garantía explícita, lo que puede compensar un precio algo mayor.`);
  }
  if (presupuestos.length < 3) {
    lineas.push("");
    lineas.push("Nota: hay menos de tres presupuestos cargados. La buena práctica recomendada para compras relevantes es comparar al menos tres antes de decidir.");
  }
  lineas.push("");
  lineas.push("Esta comparación es una vista objetiva de los datos cargados, no una recomendación de a quién comprarle: la decisión final le corresponde a la persona u órgano con esa atribución.");

  return { texto: lineas.join("\n"), presupuestos, masBarato, masRapido };
}

// ============ PROPUESTA DE DISTRIBUCIÓN DE JORNADA (IA local) ============
// Arma un borrador de asignación de núcleos a tareas según habilidades,
// prioridad y disponibilidad. Siempre queda como propuesta editable
// (confirmado = 0) hasta que la Comisión de Trabajo la confirme.
export async function proponerDistribucionJornada(jornadaId: number) {
  const [tareas, asignacionesJornada, nucleosTodos, habilidades] = await Promise.all([
    all<any>(`SELECT * FROM tareas_jornada WHERE jornada_id = ? ORDER BY CASE prioridad WHEN 'alta' THEN 0 WHEN 'critica' THEN -1 ELSE 1 END`, [jornadaId]),
    all<any>(`SELECT nucleo_id FROM asignaciones_jornada WHERE jornada_id = ?`, [jornadaId]),
    all<any>(`SELECT * FROM nucleos_familiares`),
    all<any>(`SELECT * FROM habilidades_nucleo`),
  ]);
  const yaAsignados = new Set(asignacionesJornada.map((a) => a.nucleo_id));
  const nucleos = nucleosTodos.filter((n) => !yaAsignados.has(n.id));

  const propuestas: { tarea: string; nucleo: string; motivo: string }[] = [];

  for (const t of tareas) {
    const yaEnEstaTareaRows = await all<any>(`SELECT * FROM asignaciones_jornada WHERE tarea_jornada_id = ?`, [t.id]);
    let faltan = t.personas_necesarias - yaEnEstaTareaRows.length;
    if (faltan <= 0) continue;

    // 1) priorizar núcleos con la habilidad requerida
    if (t.habilidad_requerida) {
      const conHabilidad = nucleos.filter((n) => habilidades.some((h) => h.nucleo_id === n.id && h.habilidad === t.habilidad_requerida) && !yaAsignados.has(n.id));
      for (const n of conHabilidad) {
        if (faltan <= 0) break;
        await insert("asignaciones_jornada", { jornada_id: jornadaId, tarea_jornada_id: t.id, nucleo_id: n.id, propuesta_por_ia: 1, confirmado: 0 });
        propuestas.push({ tarea: t.nombre, nucleo: n.nombre, motivo: `tiene la habilidad "${t.habilidad_requerida}" registrada` });
        yaAsignados.add(n.id);
        faltan--;
      }
    }
    // 2) completar con cualquier núcleo disponible
    const disponibles = nucleos.filter((n) => !yaAsignados.has(n.id));
    for (const n of disponibles) {
      if (faltan <= 0) break;
      await insert("asignaciones_jornada", { jornada_id: jornadaId, tarea_jornada_id: t.id, nucleo_id: n.id, propuesta_por_ia: 1, confirmado: 0 });
      propuestas.push({ tarea: t.nombre, nucleo: n.nombre, motivo: "disponible para la jornada, sin habilidad específica requerida" });
      yaAsignados.add(n.id);
      faltan--;
    }
  }

  return propuestas;
}

/**
 * Fase 11 del Plan Maestro — ampliar el buscador global (/buscar y el
 * atajo Ctrl+K). Antes cubría solo 5 fuentes (obra, compras, documentos,
 * jornadas, incidentes) y buscaba en TODAS sin fijarse en el rol de quien
 * pregunta — un socio sin acceso a Compras igual veía resultados de
 * Compras. Se suman Comisiones, Reuniones, Socios y Proveedores, y cada
 * fuente ahora se salta directamente si el rol no puede leer ese módulo
 * (mismo criterio que ya usa cada pantalla con canRead()).
 */
export type ResultadoBusqueda = {
  tipo: string;
  id: number;
  titulo: string;
  modulo: string;
  estado: string | null;
  fecha?: string | null;
  href: string;
};

export async function buscarGlobal(q: string, rol: Role): Promise<ResultadoBusqueda[]> {
  const like = `%${q}%`;
  const fuentes: Promise<ResultadoBusqueda[]>[] = [];

  if (canRead(rol, "obra")) {
    fuentes.push(
      all<any>(
        `SELECT id, nombre as titulo, estado FROM tareas_obra WHERE nombre LIKE ? OR descripcion LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "obra", id: r.id, titulo: r.titulo, modulo: "Obra", estado: r.estado, href: `/obra/${r.id}` })))
    );
  }
  if (canRead(rol, "compras")) {
    fuentes.push(
      all<any>(
        `SELECT id, material as titulo, estado FROM solicitudes_compra WHERE material LIKE ? OR especificacion LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "compra", id: r.id, titulo: r.titulo, modulo: "Compras", estado: r.estado, href: `/compras/${r.id}` }))),
      all<any>(
        `SELECT id, nombre as titulo, rubro FROM proveedores WHERE nombre LIKE ? OR rubro LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "proveedor", id: r.id, titulo: r.titulo, modulo: "Proveedores", estado: r.rubro, href: `/proveedores/${r.id}` })))
    );
  }
  if (canRead(rol, "documentos")) {
    fuentes.push(
      all<any>(
        `SELECT id, nombre as titulo, categoria FROM documentos WHERE nombre LIKE ? OR descripcion LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "documento", id: r.id, titulo: r.titulo, modulo: "Documentos", estado: r.categoria, href: `/documentos` })))
    );
  }
  if (canRead(rol, "trabajo")) {
    fuentes.push(
      all<any>(
        `SELECT id, descripcion as titulo, estado FROM jornadas_trabajo WHERE descripcion LIKE ? LIMIT 10`,
        [like]
      ).then((rows) => rows.map((r) => ({ tipo: "jornada", id: r.id, titulo: r.titulo, modulo: "Trabajo", estado: r.estado, href: `/trabajo/${r.id}` })))
    );
  }
  if (canRead(rol, "seguridad")) {
    fuentes.push(
      all<any>(
        `SELECT id, descripcion as titulo, estado FROM incidentes_seguridad WHERE descripcion LIKE ? LIMIT 10`,
        [like]
      ).then((rows) => rows.map((r) => ({ tipo: "incidente", id: r.id, titulo: r.titulo, modulo: "Seguridad", estado: r.estado, href: `/seguridad` })))
    );
  }
  if (canRead(rol, "comisiones")) {
    fuentes.push(
      all<any>(
        `SELECT id, nombre as titulo, activa FROM comisiones WHERE nombre LIKE ? OR descripcion LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "comision", id: r.id, titulo: r.titulo, modulo: "Comisiones", estado: r.activa ? "activa" : "archivada", href: `/comisiones` }))),
      all<any>(
        `SELECT id, titulo, tipo, estado FROM reuniones WHERE titulo LIKE ? OR orden_del_dia LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "reunion", id: r.id, titulo: r.titulo, modulo: "Reuniones", estado: r.estado, href: `/reuniones/${r.id}` })))
    );
  }
  if (canRead(rol, "reclamos")) {
    fuentes.push(
      all<any>(
        `SELECT id, titulo, estado FROM reclamos WHERE titulo LIKE ? OR descripcion LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "reclamo", id: r.id, titulo: r.titulo, modulo: "Reclamos", estado: r.estado, href: `/reclamos` })))
    );
  }
  if (canRead(rol, "socios")) {
    fuentes.push(
      all<any>(
        `SELECT id, nombre as titulo, estado FROM socios WHERE nombre LIKE ? OR documento LIKE ? LIMIT 10`,
        [like, like]
      ).then((rows) => rows.map((r) => ({ tipo: "socio", id: r.id, titulo: r.titulo, modulo: "Socios", estado: r.estado, href: `/socios/${r.id}` })))
    );
  }

  const resultados = (await Promise.all(fuentes)).flat();
  return resultados;
}

export async function historialProveedor(proveedorId: number) {
  const compras = await all<any>(
    `SELECT sc.material, dc.monto, dc.fecha, sc.id as solicitud_id
     FROM decisiones_compra dc
     JOIN presupuestos_proveedor pp ON pp.id = dc.presupuesto_id
     JOIN solicitudes_compra sc ON sc.id = dc.solicitud_id
     WHERE pp.proveedor_id = ?
     ORDER BY dc.fecha DESC`,
    [proveedorId]
  );
  return compras;
}

/**
 * Fase 1 del rediseño de Compras (pedido explícito, sección 15: "toda compra
 * importante debería poder mostrar su historial"). No se crea ninguna tabla
 * nueva — se arma leyendo `auditoria`, que ya registra cada paso del flujo
 * (crear solicitud, cargar presupuesto, aprobar, rechazar, eliminar) desde
 * hace varias fases. Dos condiciones porque un presupuesto se audita con su
 * propio id (`entidad_id` = id del presupuesto), no con el de la solicitud
 * — se lo vincula por el JOIN a presupuestos_proveedor en vez de tener que
 * parsear el JSON de `valor_nuevo` (que se guarda como texto, no jsonb).
 * Devuelve [] en vez de romper si la tabla auditoria no tuviera todavía
 * alguna fila esperable — nunca debería pasar, pero el criterio del
 * proyecto es que un historial vacío es mejor que tumbar el modal de detalle.
 */
export async function historialSolicitud(solicitudId: number) {
  return all<any>(
    `SELECT a.*, u.nombre as usuario_nombre
     FROM auditoria a
     LEFT JOIN users u ON u.id = a.usuario_id
     WHERE (a.entidad = 'solicitudes_compra' AND a.entidad_id = ?)
        OR (a.entidad = 'presupuestos_proveedor' AND a.entidad_id IN (
              SELECT id FROM presupuestos_proveedor WHERE solicitud_id = ?
            ))
     ORDER BY a.fecha ASC`,
    [solicitudId, solicitudId]
  ).catch(() => [] as any[]);
}
