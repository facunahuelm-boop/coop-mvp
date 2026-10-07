"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, all, get, audit, esColumnaInexistente, withTenantTransaction } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { METODOS_PAGO, CATEGORIA_INGRESO_CUOTAS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import {
  parseForm,
  zId,
  zTexto,
  zTextoOpcional,
  zMontoPositivo,
  zFecha,
  zFechaOpcional,
  zEnumSeguro,
  zIdOpcional,
  ValidationError,
} from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { emitirReciboDePago, anularReciboDePago, enviarReciboPorEmail } from "@/lib/recibos";

// Fase 10 del Plan Maestro — cuenta corriente por socio ("¿cuánto debo?").
// Se gatea por el permiso de Finanzas (no el de Socios): registrar un cargo
// o un pago es una operación financiera, con el mismo criterio que ya usa
// registrarMovimientoAction en finanzas.ts (administración lo hace de forma
// habitual, tesorería lo aprueba).

const registrarMovimientoCuentaSocioSchema = z.object({
  socio_id: zId,
  tipo: zEnumSeguro(["cargo", "pago"], "cargo"),
  concepto: zTexto(300),
  monto: zMontoPositivo(),
  fecha: zFecha,
  fecha_vencimiento: zFechaOpcional,
  notas: zTextoOpcional(1000),
  // Gestión cooperativa integrada (04/10): sólo para pagos.
  metodo_pago: zEnumSeguro(METODOS_PAGO, "efectivo").optional(),
  cuota_id: zIdOpcional,
  // Fase 2B: el pago se registra desde una línea del extracto del banco → entra en esa cuenta.
  cuenta_id: zIdOpcional,
});

/** Saldo pendiente de una cuota puntual de un socio, con el mismo cálculo que
 * usa toda la app. `excluirPagoId`: al editar un pago, se calcula como si ese
 * pago no existiera (para validar su monto nuevo). */
async function pendienteDeCuota(socioId: number, cuotaId: number, excluirPagoId?: number) {
  const movimientos = (await cargarMovimientosCuenta(socioId)).filter((m) => m.id !== excluirPagoId);
  const { cuotas } = calcularCuotasSocio(movimientos);
  return cuotas.find((c) => c.id === cuotaId) || null;
}

const money = (n: number) => `$${n.toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;

/**
 * Registra un cargo (cuota) o un pago en la cuenta corriente de un socio.
 *
 * Gestión cooperativa integrada (04/10) — para los PAGOS:
 *  - se puede indicar a qué cuota puntual va (si no, cubre lo más antiguo
 *    primero, como siempre) y con qué medio se pagó;
 *  - un pago dirigido a una cuota no puede superar lo que esa cuota debe (no
 *    quedan saldos inconsistentes ni cuotas "pagadas de más");
 *  - si se aprieta "Registrar" dos veces seguidas, el segundo envío idéntico
 *    se rechaza (no quedan pagos duplicados);
 *  - el pago genera, EN LA MISMA OPERACIÓN, su ingreso en Finanzas (categoría
 *    "Cuotas sociales"), vinculado al pago: una sola carga, un solo registro
 *    contable, y la base garantiza que un pago nunca aparezca dos veces como
 *    ingreso (índice único de la migración 0048). Si la migración todavía no
 *    se aplicó, el pago se registra igual que antes, sin el ingreso.
 */
export async function registrarMovimientoCuentaSocioAction(formData: FormData): Promise<{ id: number; ingresoId: number | null }> {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { socio_id, tipo, concepto, monto, fecha, fecha_vencimiento, notas, metodo_pago, cuota_id, cuenta_id } = parseForm(
    registrarMovimientoCuentaSocioSchema,
    formData
  );

  const socio = await get<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE id = ?`, [socio_id]);
  if (!socio) throw new Error("Socio no encontrado");

  if (tipo === "pago" && cuota_id) {
    const cuota = await pendienteDeCuota(socio_id, cuota_id);
    if (!cuota) throw new ValidationError("cuota_id", "Esa cuota no pertenece a este socio o ya no existe.");
    if (cuota.estado === "convenio" && cuota.refinanciadaPorConvenioId) {
      throw new ValidationError("cuota_id", "Esa cuota está incluida en un convenio: registrá el pago contra las cuotas del convenio.");
    }
    if (cuota.montoPendiente <= 0) throw new ValidationError("cuota_id", "Esa cuota ya está paga.");
    if (monto > cuota.montoPendiente + 0.004) {
      throw new ValidationError("monto", `Esa cuota debe ${money(cuota.montoPendiente)} — el pago no puede ser mayor.`);
    }
  }

  // Doble envío: mismo pago (socio, monto, fecha, cuota) cargado hace menos de 2 minutos.
  if (tipo === "pago") {
    const reciente = await get<{ id: number }>(
      `SELECT id FROM movimientos_cuenta_socio
       WHERE socio_id = ? AND tipo = 'pago' AND monto = ? AND fecha = ? AND COALESCE(estado, 'activo') != 'anulado'
         AND creado_en::timestamptz > now() - interval '2 minutes'
       ORDER BY id DESC LIMIT 1`,
      [socio_id, Math.abs(monto), fecha]
    ).catch(() => null);
    if (reciente) {
      throw new Error("Este mismo pago ya se registró hace un momento — revisá el estado de cuenta antes de volver a cargarlo.");
    }
  }

  const comprobanteUrl = await saveUploadedFile(
    formData.get("comprobante") as File | null,
    user.organization_id,
    "cuotas",
    { tiposPermitidos: TIPOS_DOCUMENTO }
  );

  const datos = {
    socio_id,
    tipo,
    concepto,
    monto: Math.abs(monto),
    fecha,
    fecha_vencimiento: tipo === "cargo" ? fecha_vencimiento || null : null,
    comprobante_url: comprobanteUrl,
    notas,
    registrado_por_id: user.id,
    ...(tipo === "pago" ? { metodo_pago: metodo_pago || "efectivo", cuota_id: cuota_id || null } : {}),
  };

  let id: number;
  let ingresoId: number | null = null;
  if (tipo === "pago") {
    try {
      ({ id, ingresoId } = await withTenantTransaction(async (tx) => {
        const fila = await tx.get(
          `INSERT INTO movimientos_cuenta_socio
             (organization_id, socio_id, tipo, concepto, monto, fecha, comprobante_url, notas, registrado_por_id, metodo_pago, cuota_id)
           VALUES (NULLIF(current_setting('app.current_org_id', true), '')::int, ?, 'pago', ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
          [socio_id, concepto, Math.abs(monto), fecha, comprobanteUrl, notas, user.id, datos.metodo_pago, datos.cuota_id]
        );
        const ingreso = cuenta_id
          ? await tx.get(
              `INSERT INTO movimientos_financieros
                 (organization_id, tipo, monto, categoria, etapa_obra, fecha, descripcion, comprobante_url, registrado_por_id, movimiento_cuenta_socio_id, cuenta_id)
               VALUES (NULLIF(current_setting('app.current_org_id', true), '')::int, 'ingreso', ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id`,
              [Math.abs(monto), CATEGORIA_INGRESO_CUOTAS, CATEGORIA_INGRESO_CUOTAS, fecha, `Pago de cuota — ${socio.nombre}: ${concepto}`, comprobanteUrl, user.id, fila.id, cuenta_id]
            )
          : await tx.get(
              `INSERT INTO movimientos_financieros
                 (organization_id, tipo, monto, categoria, etapa_obra, fecha, descripcion, comprobante_url, registrado_por_id, movimiento_cuenta_socio_id)
               VALUES (NULLIF(current_setting('app.current_org_id', true), '')::int, 'ingreso', ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id`,
              [Math.abs(monto), CATEGORIA_INGRESO_CUOTAS, CATEGORIA_INGRESO_CUOTAS, fecha, `Pago de cuota — ${socio.nombre}: ${concepto}`, comprobanteUrl, user.id, fila.id]
            );
        return { id: fila.id as number, ingresoId: ingreso.id as number };
      }));
    } catch (err) {
      // Base sin la migración 0048: se registra el pago como siempre.
      if (!esColumnaInexistente(err)) throw err;
      id = await insert("movimientos_cuenta_socio", datos);
    }
  } else {
    id = await insert("movimientos_cuenta_socio", datos);
  }

  // Fase 1C: cada pago tiene su recibo numerado (y, si el reglamento lo
  // pide, se le manda por email al socio). Si falla el recibo, el pago ya
  // quedó registrado igual: el recibo se puede emitir después.
  if (tipo === "pago") {
    try {
      const recibo = await emitirReciboDePago(id, user.id);
      if (recibo) await enviarReciboPorEmail(recibo);
    } catch (err) {
      console.error("[recibos] No se pudo emitir el recibo del pago", id, err);
    }
  }

  await audit({
    usuario_id: user.id,
    accion: tipo === "pago" ? "registrar_pago_cuota" : "registrar_cargo_cuota",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_nuevo: {
      socio: socio.nombre,
      socio_id,
      tipo,
      concepto,
      monto,
      fecha,
      ...(tipo === "pago" ? { metodo_pago: datos.metodo_pago, cuota_id: cuota_id || null, ingreso_finanzas_id: ingresoId } : { fecha_vencimiento }),
    },
  });
  revalidatePath(`/socios/${socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
  return { id, ingresoId };
}

export async function registrarMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(async () => {
    await registrarMovimientoCuentaSocioAction(formData);
  });
}

const editarMovimientoCuentaSocioSchema = z.object({
  id: zId,
  tipo: zEnumSeguro(["cargo", "pago"], "cargo"),
  concepto: zTexto(300),
  monto: zMontoPositivo(),
  fecha: zFecha,
  fecha_vencimiento: zFechaOpcional,
  notas: zTextoOpcional(1000),
  metodo_pago: zEnumSeguro(METODOS_PAGO, "efectivo").optional(),
});

/**
 * Editar un movimiento ya cargado (pedido explícito: "que todos los
 * ingresos/cuotas se puedan editar y eliminar"). No se puede reasignar a
 * otro socio ni tocar el convenio de origen desde acá — mismo criterio ya
 * usado en editarSolicitudAction (Compras): editar corrige datos, no
 * reestructura vínculos ya creados por otra operación.
 */
export async function editarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { id, tipo, concepto, monto, fecha, fecha_vencimiento, notas, metodo_pago } = parseForm(
    editarMovimientoCuentaSocioSchema,
    formData
  );

  type Fila = { id: number; socio_id: number; tipo: string; concepto: string; monto: number; fecha: string; comprobante_url: string | null; estado?: string; cuota_id?: number | null; metodo_pago?: string | null };
  const movimiento = await get<Fila>(
    `SELECT id, socio_id, tipo, concepto, monto, fecha, comprobante_url, estado, cuota_id, metodo_pago FROM movimientos_cuenta_socio WHERE id = ?`,
    [id]
  ).catch(async (err) => {
    if (!esColumnaInexistente(err)) throw err;
    return get<Fila>(`SELECT id, socio_id, tipo, concepto, monto, fecha, comprobante_url FROM movimientos_cuenta_socio WHERE id = ?`, [id]);
  });
  if (!movimiento) throw new Error("Ese movimiento ya no existe.");
  if (movimiento.estado === "anulado") {
    throw new Error("Este movimiento está anulado — no se puede editar. Registrá un movimiento nuevo si hace falta corregir el saldo.");
  }
  // Un pago dirigido a una cuota no puede pasar a valer más de lo que esa
  // cuota debe (calculado como si este pago no existiera).
  if (tipo === "pago" && movimiento.cuota_id) {
    const cuota = await pendienteDeCuota(movimiento.socio_id, movimiento.cuota_id, id);
    if (cuota && monto > cuota.montoPendiente + 0.004) {
      throw new ValidationError("monto", `La cuota de este pago debe ${money(cuota.montoPendiente)} — el pago no puede ser mayor.`);
    }
  }

  const nuevoComprobante = await saveUploadedFile(
    formData.get("comprobante") as File | null,
    user.organization_id,
    "cuotas",
    { tiposPermitidos: TIPOS_DOCUMENTO }
  );

  await update("movimientos_cuenta_socio", id, {
    tipo,
    concepto,
    monto: Math.abs(monto),
    fecha,
    fecha_vencimiento: tipo === "cargo" ? fecha_vencimiento || null : null,
    comprobante_url: nuevoComprobante || movimiento.comprobante_url,
    notas,
    ...(tipo === "pago" && metodo_pago ? { metodo_pago } : {}),
  });

  // Gestión cooperativa integrada (04/10): el ingreso de Finanzas generado
  // por este pago se corrige junto con él (es el mismo dato, una sola
  // fuente). Si el movimiento deja de ser un pago, su ingreso se anula.
  const ingreso = await get<{ id: number; estado: string }>(
    `SELECT id, estado FROM movimientos_financieros WHERE movimiento_cuenta_socio_id = ?`,
    [id]
  ).catch(() => null);
  if (ingreso && ingreso.estado !== "anulado") {
    if (tipo === "pago") {
      await update("movimientos_financieros", ingreso.id, {
        monto: Math.abs(monto),
        fecha,
        comprobante_url: nuevoComprobante || movimiento.comprobante_url,
      });
    } else {
      await update("movimientos_financieros", ingreso.id, {
        estado: "anulado",
        anulado_en: new Date().toISOString(),
        anulado_por_id: user.id,
        motivo_anulacion: "El pago de cuota que lo generó se cambió a cargo.",
      });
    }
  }

  // Fase 1C: si cambió el monto, la fecha o dejó de ser un pago, el recibo
  // anterior se anula (nunca se borra) y se emite uno nuevo que lo reemplaza.
  if (movimiento.tipo === "pago") {
    const cambioRelevante = tipo !== "pago" || Number(movimiento.monto) !== Math.abs(monto) || movimiento.fecha !== fecha;
    if (cambioRelevante) {
      try {
        const anterior = await anularReciboDePago(id, "Se corrigió el pago", user.id);
        if (tipo === "pago") await emitirReciboDePago(id, user.id, anterior?.id);
      } catch (err) {
        console.error("[recibos] No se pudo reemitir el recibo del pago", id, err);
      }
    }
  }

  const nombreSocio = (await get<{ nombre: string }>(`SELECT nombre FROM socios WHERE id = ?`, [movimiento.socio_id]))?.nombre ?? null;
  await audit({
    usuario_id: user.id,
    accion: movimiento.tipo === "pago" ? "editar_pago_cuota" : "editar_cargo_cuota",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_anterior: { socio: nombreSocio, tipo: movimiento.tipo, concepto: movimiento.concepto, monto: Number(movimiento.monto), fecha: movimiento.fecha, metodo_pago: movimiento.metodo_pago ?? null },
    valor_nuevo: { socio: nombreSocio, tipo, concepto, monto, fecha, ...(tipo === "pago" ? { metodo_pago: metodo_pago ?? movimiento.metodo_pago ?? null } : {}) },
  });
  revalidatePath(`/socios/${movimiento.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function editarMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarMovimientoCuentaSocioAction(formData));
}

const anularMovimientoCuentaSocioSchema = z.object({ id: zId, motivo: zTextoOpcional(500) });

/**
 * Sub-fase 4.4 (Eliminación segura de movimientos financieros): mismo
 * reemplazo de DELETE físico → baja lógica que anularMovimientoAction en
 * finanzas.ts (ver ese comentario para el detalle completo), aplicado acá al
 * libro de cuenta corriente por socio. Un cargo o pago anulado sigue
 * apareciendo en el historial de la ficha del socio (marcado) pero
 * calcularCuotasSocio (logic.ts) lo excluye del saldo — a diferencia de
 * movimientos_financieros, acá no hay ningún otro registro que dependa de
 * este (nada tiene una FK hacia movimientos_cuenta_socio), así que no hace
 * falta un chequeo de dependientes.
 */
export async function anularMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede anular un movimiento de la cuenta de un socio.");
  const { id, motivo } = parseForm(anularMovimientoCuentaSocioSchema, formData);

  // Ver el comentario equivalente en anularMovimientoAction (finanzas.ts):
  // toda esta operación depende de que `estado` exista, así que se chequea
  // ANTES de llamar a update() en vez de confiar en su fallback silencioso.
  let fila: { id: number; socio_id: number; estado: string } | undefined;
  try {
    fila = await get<{ id: number; socio_id: number; estado: string }>(
      `SELECT id, socio_id, estado FROM movimientos_cuenta_socio WHERE id = ?`,
      [id]
    );
  } catch (err) {
    if (!esColumnaInexistente(err)) throw err;
    throw new Error("Esta función todavía no está habilitada en este entorno: falta aplicar una actualización pendiente de la base de datos.");
  }
  if (!fila) {
    revalidatePath("/socios");
    return;
  }
  if (fila.estado === "anulado") return; // ya está anulado, no hay nada que hacer

  await update("movimientos_cuenta_socio", id, {
    estado: "anulado",
    anulado_en: new Date().toISOString(),
    anulado_por_id: user.id,
    motivo_anulacion: motivo || null,
  });
  // Gestión cooperativa integrada (04/10): si era un pago con su ingreso en
  // Finanzas, ese ingreso se anula también — si no, Finanzas seguiría
  // contando plata que ya no entró.
  const ingreso = await get<{ id: number; estado: string }>(
    `SELECT id, estado FROM movimientos_financieros WHERE movimiento_cuenta_socio_id = ?`,
    [id]
  ).catch(() => null);
  if (ingreso && ingreso.estado !== "anulado") {
    await update("movimientos_financieros", ingreso.id, {
      estado: "anulado",
      anulado_en: new Date().toISOString(),
      anulado_por_id: user.id,
      motivo_anulacion: `Se anuló el pago de cuota que lo generó${motivo ? `: ${motivo}` : ""}.`,
    });
  }
  await anularReciboDePago(id, `Se anuló el pago${motivo ? `: ${motivo}` : ""}`, user.id).catch(() => null);
  await audit({
    usuario_id: user.id,
    accion: "anular_movimiento_cuenta_socio",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_anterior: {
      socio: (await get<{ nombre: string }>(`SELECT nombre FROM socios WHERE id = ?`, [fila.socio_id]))?.nombre ?? null,
      estado: "activo",
    },
    valor_nuevo: { estado: "anulado", motivo },
  });
  revalidatePath(`/socios/${fila.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function anularMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularMovimientoCuentaSocioAction(formData));
}

const generarCuotaMensualSchema = z.object({
  concepto: zTexto(200),
  monto: zMontoPositivo(),
  mes: z.string().regex(/^\d{4}-\d{2}$/, "Elegí un mes válido."),
  dia_vencimiento: z.coerce.number().int().min(1, "Entre 1 y 28.").max(28, "Entre 1 y 28."),
});

/**
 * Generar la cuota del mes para todos los socios activos de una sola vez
 * (pedido explícito: "una tabla con todas las cuotas de todos los núcleos").
 *
 * Auditoría funcional Finanzas↔Socios (17/09) — la idempotencia original
 * comparaba el `concepto` como texto exacto, un campo que la persona
 * escribe a mano cada vez (el placeholder del formulario ni siquiera
 * sugiere un formato fijo: "Cuota setiembre 2026"). Eso tenía dos fallas
 * reales: (a) tipear el concepto un poco distinto al reintentar (may/mayo,
 * mayúscula/minúscula) generaba la cuota DOS VECES para todos los socios, y
 * (b) reusar el mismo texto en un mes distinto hacía que no se generara
 * NINGUNA cuota nueva, sin ningún aviso — el botón decía "Cuotas
 * generadas." igual, aunque `generadas` fuera 0. Se cambia la idempotencia
 * a lo que realmente identifica "la cuota de este mes" sin depender de lo
 * que la persona haya tipeado: un cargo mensual (no de convenio) cuyo
 * vencimiento cae en el mes elegido. Y si no se generó ninguna cuota nueva,
 * se avisa con un mensaje claro en vez de un "éxito" silencioso.
 */
export async function generarCuotaMensualAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { concepto, monto, mes, dia_vencimiento } = parseForm(generarCuotaMensualSchema, formData);

  const socios = await all<{ id: number }>(`SELECT id FROM socios WHERE estado IN ('activo', 'suspendido', 'renunciante')`);
  const fecha = `${mes}-01`;
  const diaTexto = String(dia_vencimiento).padStart(2, "0");
  const fechaVencimiento = `${mes}-${diaTexto}`;
  let generadas = 0;

  for (const s of socios) {
    const yaExiste = await get<{ id: number }>(
      `SELECT id FROM movimientos_cuenta_socio
       WHERE socio_id = ? AND tipo = 'cargo' AND convenio_id IS NULL
         AND substr(fecha_vencimiento::text, 1, 7) = ?`,
      // Testing 04/10: antes era to_char(fecha_vencimiento, 'YYYY-MM'), pero
      // fecha_vencimiento es TEXT (migración 0027) y Postgres no tiene
      // to_char(text) — la consulta fallaba SIEMPRE y "Generar cuota mensual"
      // nunca llegaba a generar nada (la persona veía un error genérico).
      [s.id, mes]
    );
    if (yaExiste) continue;
    await insert("movimientos_cuenta_socio", {
      socio_id: s.id,
      tipo: "cargo",
      concepto,
      monto: Math.abs(monto),
      fecha,
      fecha_vencimiento: fechaVencimiento,
      registrado_por_id: user.id,
    });
    generadas++;
  }

  await audit({
    usuario_id: user.id,
    accion: "generar_cuota_mensual",
    entidad: "movimientos_cuenta_socio",
    entidad_id: 0,
    valor_nuevo: { concepto, monto, mes, generadas, totalSocios: socios.length },
  });

  if (generadas === 0) {
    throw new Error(
      `Ya existía una cuota de este mes (${mes}) para todos los socios activos — no se generó ninguna nueva.`
    );
  }

  revalidatePath("/finanzas");
  revalidatePath("/socios");
  revalidatePath("/dashboard");
}

export async function generarCuotaMensualFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarCuotaMensualAction(formData));
}
