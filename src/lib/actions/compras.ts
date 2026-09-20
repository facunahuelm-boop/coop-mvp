"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import {
  parseForm,
  zId,
  zIdOpcional,
  zTexto,
  zTextoOpcional,
  zMonto,
  zMontoOpcional,
  zEnteroOpcional,
  zNumeroOpcionalConDefault,
  zFechaOpcional,
  zEnumSeguro,
  zCheckbox,
  clavesDe,
} from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacion } from "@/lib/actions/notificaciones";

const PRIORIDAD_COMPRA = ["baja", "media", "alta", "critica"] as const;

// AUDITORÍA INTEGRAL (hallazgo de seguridad, mismo patrón que comisiones.ts y
// tareas.ts): crearSolicitudAction ya comprobaba puedeGestionarComision al
// vincular una comisión real (comision_id), pero agregarPresupuestoAction,
// marcarPedidaAction y marcarEntregadaAction solo comprobaban el permiso de
// módulo canEdit(rol, "compras") — y en roles.ts, TODOS los roles de
// comisión (Obra, Trabajo, Compras, Seguridad) tienen "compras: edit". En los
// hechos, un integrante de la Comisión de Compras podía cargarle un
// presupuesto, o marcarla como pedida/entregada, a una solicitud que
// pertenece a la Comisión de Obra. decidirCompraAction y
// rechazarSolicitudAction no necesitan este chequeo: ya exigen canApprove
// (Tesorería/Consejo Directivo), roles de conducción que gestionan cualquier
// comisión por diseño.
async function verificarPermisoSobreSolicitud(user: SessionUser, solicitudId: number) {
  // AUDITORÍA INTEGRAL (hallazgo, testing E2E real): a diferencia de
  // insert()/update() (que ya tienen el fallback centralizado en db.ts),
  // este SELECT nombra la columna a mano — si la migración 0020 no corrió,
  // "column comision_id does not exist" (Postgres 42703) rompía este
  // chequeo antes de llegar a agregarPresupuestoAction/marcarPedidaAction/
  // marcarEntregadaAction, aunque la solicitud existiera. Mismo criterio
  // defensivo que /compras (page.tsx) al leer la lista: si falla
  // puntualmente por esa columna, se confirma que la solicitud existe con
  // un SELECT * (que nunca rompe por una columna faltante) y se la trata
  // como sin comisión vinculada — no hay nada extra que comprobar sin ese
  // vínculo.
  const solicitud = await get<{ comision_id: number | null }>(
    `SELECT comision_id FROM solicitudes_compra WHERE id = ?`,
    [solicitudId]
  ).catch(async (err: any) => {
    if (err?.code !== "42703") throw err;
    const existe = await get<{ id: number }>(`SELECT id FROM solicitudes_compra WHERE id = ?`, [solicitudId]);
    return existe ? { comision_id: null } : undefined;
  });
  if (!solicitud) throw new Error("Esa solicitud ya no existe.");
  if (solicitud.comision_id && !(await puedeGestionarComision(user, solicitud.comision_id))) {
    throw new Error(ERROR_SIN_PERMISO_COMISION);
  }
}

// comision_id (nuevo, opcional): vínculo real con la tabla comisiones para
// poder sumar "cuánto compró cada comisión" de manera confiable — ver
// migrations/0020_compras_comision_id.sql. "comision" (texto) se sigue
// completando igual, así ninguna pantalla vieja que la lea se rompe.
const crearSolicitudSchema = z.object({
  comision: zTexto(200),
  comision_id: zIdOpcional,
  categoria: zEnumSeguro(clavesDe(CATEGORIA_COMPRA_LABEL), "obra"),
  // subcategoria/recurrente: Fase 1 del rediseño de Compras (migración 0025)
  // — texto libre opcional para precisar la categoría (ej. "cemento" dentro
  // de "Compra de obra") sin necesitar una lista rígida nueva, y una bandera
  // simple para marcar compras que se repiten (limpieza, papelería, etc.).
  subcategoria: zTextoOpcional(150),
  recurrente: zCheckbox,
  material: zTexto(300),
  cantidad: zNumeroOpcionalConDefault(0),
  unidad: zTexto(50),
  especificacion: zTextoOpcional(1000),
  prioridad: zEnumSeguro(PRIORIDAD_COMPRA, "media"),
  etapa_obra: zTextoOpcional(200),
  fecha_necesaria: zFechaOpcional,
  presupuesto_estimado: zMontoOpcional(),
});

export async function crearSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const datos = parseForm(crearSolicitudSchema, formData);
  if (datos.comision_id && !(await puedeGestionarComision(user, datos.comision_id))) {
    throw new Error(ERROR_SIN_PERMISO_COMISION);
  }
  // Si la migración 0020 (agrega esta columna) todavía no corrió en esta
  // base, insert() en sí mismo reintenta sin comision_id en vez de romper
  // toda la pantalla con un error 500 — ver el criterio centralizado en
  // db.ts (hallazgo de testing E2E real: se rompía probando el flujo real
  // de Diana, Comisión de Compras, con y sin vincular una comisión).
  const id = await insert("solicitudes_compra", {
    solicitante_id: user.id,
    ...datos,
    estado: "pendiente_cotizacion",
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "solicitudes_compra", entidad_id: id });
  revalidatePath("/compras");
}

export async function crearSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearSolicitudAction(formData));
}

/**
 * Rediseño profundo de Compras, Fase 5 (pedido explícito, sección 6:
 * "permitir editar y eliminar correctamente según permisos"). Los mismos
 * campos descriptivos que `crearSolicitudAction`, a propósito SIN
 * `comision`/`comision_id`: ese vínculo se fija al crear la solicitud y no
 * se deja tocar después — cambiarlo una vez que ya existe un presupuesto,
 * una decisión o un gasto (`gastos_comision`, generado automáticamente por
 * `decidirCompraAction` con la comisión de ESE momento) dejaría esos
 * registros apuntando a una comisión distinta de la que aparece en la
 * solicitud, un problema de integridad real que no vale la pena resolver acá
 * (sección 39: "no romper relaciones existentes"). Si la comisión estuvo
 * mal desde el principio, la corrección correcta es eliminar la solicitud
 * (si nada la usa todavía) y cargarla de nuevo.
 */
const editarSolicitudSchema = z.object({
  id: zId,
  categoria: zEnumSeguro(clavesDe(CATEGORIA_COMPRA_LABEL), "obra"),
  subcategoria: zTextoOpcional(150),
  recurrente: zCheckbox,
  material: zTexto(300),
  cantidad: zNumeroOpcionalConDefault(0),
  unidad: zTexto(50),
  especificacion: zTextoOpcional(1000),
  prioridad: zEnumSeguro(PRIORIDAD_COMPRA, "media"),
  etapa_obra: zTextoOpcional(200),
  fecha_necesaria: zFechaOpcional,
  presupuesto_estimado: zMontoOpcional(),
});

export async function editarSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id, ...datos } = parseForm(editarSolicitudSchema, formData);
  await verificarPermisoSobreSolicitud(user, id);

  const anterior = await get<any>(`SELECT * FROM solicitudes_compra WHERE id = ?`, [id]);
  if (!anterior) throw new Error("Esa solicitud ya no existe.");
  // Una solicitud "entregada" o "rechazada" ya está cerrada — el ciclo de
  // esa compra terminó (llegó lo pedido, o se decidió no seguir adelante).
  // Editar sus datos a esta altura no cambiaría nada real y podría confundir
  // el historial de lo que efectivamente se compró; para corregir un error
  // de carga después de cerrada, la vía es la Zona de administrador
  // (eliminar) si nada la usa todavía, no editarla.
  if (anterior.estado === "entregada" || anterior.estado === "rechazada") {
    throw new Error("Esta solicitud ya está cerrada (entregada o rechazada) — no se puede editar. Si fue un error de carga, un administrador puede eliminarla desde la pestaña Información.");
  }

  await update("solicitudes_compra", id, datos);
  await audit({
    usuario_id: user.id,
    accion: "editar",
    entidad: "solicitudes_compra",
    entidad_id: id,
    valor_anterior: { material: anterior.material, cantidad: anterior.cantidad, unidad: anterior.unidad, categoria: anterior.categoria },
    valor_nuevo: datos,
  });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

export async function editarSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarSolicitudAction(formData));
}

const agregarPresupuestoSchema = z.object({
  solicitud_id: zId,
  precio: zMonto(),
  precio_unitario: zMontoOpcional(),
  plazo_entrega_dias: zEnteroOpcional(3650),
  forma_pago: zTextoOpcional(200),
  garantia: zTextoOpcional(300),
  costo_envio: zNumeroOpcionalConDefault(0),
  condiciones: zTextoOpcional(500),
  notas: zTextoOpcional(1000),
});

export async function agregarPresupuestoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { solicitud_id: solicitudId, ...datos } = parseForm(agregarPresupuestoSchema, formData);
  await verificarPermisoSobreSolicitud(user, solicitudId);

  // proveedor_id / nuevo_proveedor tienen una lógica de "uno u otro" que no
  // encaja en un campo Zod simple: se elige un proveedor ya cargado, o se
  // escribe el nombre de uno nuevo y se crea acá mismo.
  let proveedorId = Number(formData.get("proveedor_id") || 0);
  const nuevoProveedor = String(formData.get("nuevo_proveedor") || "").trim().slice(0, 200);
  if (!proveedorId && nuevoProveedor) {
    // Rediseño profundo de Compras, Fase 6 (pedido explícito, sección 18:
    // "no duplicar proveedores"). Antes, escribir el nombre acá SIEMPRE creaba
    // un proveedor nuevo, aunque ya existiera uno con ese mismo nombre — fácil
    // de hacer sin querer si la persona no se acuerda de buscarlo en el
    // desplegable de arriba. Se busca primero por nombre exacto (sin
    // mayúsculas/espacios de más) dentro de la cooperativa activa (get() ya
    // filtra por organization_id vía RLS) y se reutiliza ese proveedor en vez
    // de crear un duplicado; recién si de verdad no existe se crea uno nuevo,
    // que arranca en estado "nuevo" (default de la tabla, migración 0018).
    const existente = await get<{ id: number }>(`SELECT id FROM proveedores WHERE lower(trim(nombre)) = lower(trim(?))`, [nuevoProveedor]);
    proveedorId = existente ? existente.id : await insert("proveedores", { nombre: nuevoProveedor });
  }
  if (!proveedorId) throw new Error("Falta elegir o crear un proveedor.");

  const presupuestoId = await insert("presupuestos_proveedor", { solicitud_id: solicitudId, proveedor_id: proveedorId, ...datos });
  await update("solicitudes_compra", solicitudId, { estado: "en_comparacion" });
  // Auditoría de presupuestos (pedido explícito, sección 8): esta acción no
  // dejaba rastro de quién cargó cada presupuesto ni con qué condiciones —
  // se agrega acá, sin tocar el resto del flujo.
  await audit({ usuario_id: user.id, accion: "crear", entidad: "presupuestos_proveedor", entidad_id: presupuestoId, valor_nuevo: { solicitudId, proveedorId, ...datos } });
  revalidatePath(`/compras/${solicitudId}`);
}

export async function agregarPresupuestoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarPresupuestoAction(formData));
}

export async function decidirCompraAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "compras")) throw new Error("No autorizado: esta decisión requiere un rol con permiso de aprobación (Tesorería o Consejo Directivo).");
  const { solicitud_id: solicitudId, presupuesto_id: presupuestoId, motivo } = parseForm(
    z.object({ solicitud_id: zId, presupuesto_id: zId, motivo: zTextoOpcional(1000) }),
    formData
  );
  const presupuesto = await get<any>(`SELECT * FROM presupuestos_proveedor WHERE id = ?`, [presupuestoId]);
  const solicitud = await get<any>(`SELECT * FROM solicitudes_compra WHERE id = ?`, [solicitudId]);

  await insert("decisiones_compra", {
    solicitud_id: solicitudId, presupuesto_id: presupuestoId, decidido_por_id: user.id,
    motivo, monto: presupuesto?.precio ?? null,
  });
  await update("solicitudes_compra", solicitudId, { estado: "aprobada" });
  await audit({ usuario_id: user.id, accion: "aprobar_compra", entidad: "solicitudes_compra", entidad_id: solicitudId, valor_nuevo: { presupuestoId, motivo, monto: presupuesto?.precio } });

  // Cadena "Comisión → Gasto → Proveedor → Financiero" (pedido explícito):
  // si la solicitud tiene una comisión real vinculada (comision_id, no solo
  // el texto libre), aprobar la compra genera automáticamente el gasto
  // correspondiente, ya asociado al proveedor elegido — queda "pendiente"
  // (todavía no salió la plata) hasta que alguien lo marque como pagado
  // desde /gastos, que es cuando recién se crea el movimiento financiero.
  if (solicitud?.comision_id && presupuesto) {
    await insert("gastos_comision", {
      comision_id: solicitud.comision_id,
      proveedor_id: presupuesto.proveedor_id,
      solicitud_compra_id: solicitudId,
      descripcion: solicitud.material,
      categoria: solicitud.categoria || "otros",
      fecha: new Date().toISOString().slice(0, 10),
      importe: presupuesto.precio,
      forma_pago: presupuesto.forma_pago || null,
      estado: "pendiente",
      observaciones: motivo || null,
      creado_por_id: user.id,
    });
  }

  // Fase 9 del sistema de gestión de Comisiones (20/09, sección "integración
  // Compras/Proveedores/Finanzas"): quien pidió la compra hoy se entera de
  // que se aprobó (y con qué proveedor) solo si vuelve a mirar /compras a
  // mano — se avisa por la bandeja de notificaciones (Fase 7), mismo
  // criterio que decidirDecisionAction en decisiones.ts. Nunca se notifica a
  // quien hizo la aprobación a sí mismo (Tesorería/Consejo Directivo suele
  // ser distinto de quien pidió, pero por las dudas).
  if (solicitud?.solicitante_id && solicitud.solicitante_id !== user.id) {
    await crearNotificacion({
      user_id: solicitud.solicitante_id,
      tipo: "compra_aprobada",
      titulo: `Se aprobó tu solicitud de compra: ${solicitud.material}`,
      ref_tabla: "solicitudes_compra",
      ref_id: solicitudId,
    });
  }

  revalidatePath(`/compras/${solicitudId}`);
  revalidatePath("/compras");
  revalidatePath("/gastos");
}

export async function decidirCompraFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => decidirCompraAction(formData));
}

/**
 * Fase 08 del Plan Maestro ("estados más granulares"): antes de esto, una
 * solicitud aprobada pasaba directo a "entregada" con un solo botón, sin
 * forma de reflejar que ya se hizo el pedido/pago al proveedor pero todavía
 * no llegó — un estado intermedio real en cualquier compra de obra, donde
 * puede pasar más de una semana entre pedir y recibir. "pedida" cubre ese
 * tramo; se puede marcar como entregada igual directamente si llegó al
 * toque, para no trabar el caso simple.
 */
export async function marcarPedidaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await verificarPermisoSobreSolicitud(user, id);
  await update("solicitudes_compra", id, { estado: "pedida" });
  // Fase 1 del rediseño de Compras (pedido explícito, sección 15: historial
  // de estados): esta acción nunca había dejado rastro en auditoría — el
  // cambio de estado quedaba invisible para cualquier historial. Se agrega
  // acá, sin tocar el resto del flujo (mismo patrón ya usado en
  // decidirCompraAction/rechazarSolicitudAction de este mismo archivo).
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "solicitudes_compra", entidad_id: id, valor_nuevo: { estado: "pedida" } });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

export async function marcarPedidaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => marcarPedidaAction(formData));
}

export async function marcarEntregadaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await verificarPermisoSobreSolicitud(user, id);
  const solicitud = await get<{ solicitante_id: number | null; material: string }>(
    `SELECT solicitante_id, material FROM solicitudes_compra WHERE id = ?`,
    [id]
  );
  await update("solicitudes_compra", id, { estado: "entregada" });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "solicitudes_compra", entidad_id: id, valor_nuevo: { estado: "entregada" } });
  // Fase 9 ("integración Compras/Proveedores/Finanzas"): cierra el circuito
  // avisándole a quien pidió la compra que ya llegó — mismo criterio que la
  // notificación de aprobación en decidirCompraAction, arriba.
  if (solicitud?.solicitante_id && solicitud.solicitante_id !== user.id) {
    await crearNotificacion({
      user_id: solicitud.solicitante_id,
      tipo: "compra_entregada",
      titulo: `Llegó tu compra: ${solicitud.material}`,
      ref_tabla: "solicitudes_compra",
      ref_id: id,
    });
  }
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

export async function marcarEntregadaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => marcarEntregadaAction(formData));
}

/**
 * El estado "rechazada" ya estaba previsto en el esquema (columna estado,
 * comentario original en schema.postgres.sql) pero ninguna acción lo dejaba
 * elegir — una solicitud que ya no correspondía (cambió el plan de obra, se
 * consiguió donada, etc.) se quedaba pendiente para siempre o había que
 * "aprobarla" igual solo para sacarla de la lista. Mismo nivel de permiso
 * que aprobar (Tesorería / Consejo Directivo): rechazar una compra es la
 * otra cara de la misma decisión.
 */
export async function rechazarSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "compras")) throw new Error("No autorizado: esta decisión requiere un rol con permiso de aprobación (Tesorería o Consejo Directivo).");
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTextoOpcional(1000) }), formData);
  const solicitud = await get<{ solicitante_id: number | null; material: string }>(
    `SELECT solicitante_id, material FROM solicitudes_compra WHERE id = ?`,
    [id]
  );
  await update("solicitudes_compra", id, { estado: "rechazada" });
  await audit({ usuario_id: user.id, accion: "rechazar_compra", entidad: "solicitudes_compra", entidad_id: id, valor_nuevo: { motivo } });
  // Fase 9: la otra cara de la notificación de decidirCompraAction — que no
  // se apruebe también es una respuesta que quien pidió necesita conocer.
  if (solicitud?.solicitante_id && solicitud.solicitante_id !== user.id) {
    await crearNotificacion({
      user_id: solicitud.solicitante_id,
      tipo: "compra_rechazada",
      titulo: `Se rechazó tu solicitud de compra: ${solicitud.material}`,
      cuerpo: motivo || null,
      ref_tabla: "solicitudes_compra",
      ref_id: id,
    });
  }
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

export async function rechazarSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => rechazarSolicitudAction(formData));
}

/**
 * AUDITORÍA INTEGRAL (pedido explícito): eliminar una solicitud de compra es
 * irreversible y solo tiene sentido para corregir un error de carga o limpiar
 * datos de prueba — nunca como forma normal de "cancelar" una compra real
 * (para eso ya existe rechazarSolicitudAction, que deja rastro). Por eso:
 * - Solo el rol "admin" (administrador del sistema) puede usarla; ningún rol
 *   de comisión ni de conducción la tiene, ni siquiera Consejo Directivo.
 * - Exige escribir la palabra "ELIMINAR" en el formulario, para que no pueda
 *   dispararse por accidente con un solo click.
 * - Este esquema nunca usa ON DELETE CASCADE (criterio del proyecto: nada se
 *   borra en cascada sin que quede explícito en el código), así que se borran
 *   a mano, en el orden que respeta las referencias, los presupuestos y la
 *   decisión asociados antes de borrar la solicitud; gastos_comision se
 *   intenta también por si la migración 0020 ya corrió en esta base (si no
 *   corrió, la columna no existe y no hay nada que borrar ahí — ver el mismo
 *   criterio de columna-faltante que en db.ts).
 * - Igual que cualquier otra escritura, corre dentro del contexto de la
 *   cooperativa activa (withTenantClient + Row-Level Security): un admin
 *   nunca puede borrar una solicitud de otra cooperativa aunque adivinara su id.
 * - Queda un registro completo en auditoría (valor_anterior con la fila
 *   entera) antes de borrar, para que el borrado en sí sea rastreable.
 */
export async function eliminarSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede eliminar una solicitud de compra.");
  const { id, confirmacion } = parseForm(z.object({ id: zId, confirmacion: zTexto(50) }), formData);
  if (confirmacion.trim().toUpperCase() !== "ELIMINAR") {
    throw new Error('Para eliminar, escribí exactamente "ELIMINAR" en el campo de confirmación.');
  }
  const solicitud = await get<any>(`SELECT * FROM solicitudes_compra WHERE id = ?`, [id]);
  if (!solicitud) {
    revalidatePath("/compras");
    return; // ya no existe: nada que borrar
  }

  // Fase 1 del rediseño de Compras (decisión confirmada explícitamente con
  // el usuario): si esta solicitud ya generó un gasto que Finanzas marcó
  // como "pagado" (movimiento financiero real, plata que ya salió), NO se
  // permite borrar la solicitud — perderla dejaría ese pago sin ningún
  // origen rastreable. Hay que anular el gasto desde /gastos primero (acción
  // ya existente, deja su propio registro en auditoría) y recién ahí se
  // puede eliminar la solicitud. Un gasto "pendiente" o "anulado" no bloquea
  // — mismo criterio de columna/tabla-faltante que el resto de este archivo
  // (si gastos_comision no existe todavía en esta base, no hay nada que
  // pueda estar pagado).
  const gastoPagado = await get<{ id: number }>(
    `SELECT id FROM gastos_comision WHERE solicitud_compra_id = ? AND estado = 'pagado' LIMIT 1`,
    [id]
  ).catch((err: any) => {
    if (err?.code === "42703" || err?.code === "42P01") return undefined;
    throw err;
  });
  if (gastoPagado) {
    throw new Error(
      "Esta solicitud ya generó un gasto marcado como pagado en Finanzas — no se puede eliminar sin perder ese registro. Anulá primero el gasto desde /gastos y volvé a intentarlo."
    );
  }

  // AUDITORÍA INTEGRAL (testing E2E real, 12/09): el primer intento en vivo de
  // esta acción falló a mitad de camino — decisiones_compra y
  // presupuestos_proveedor se borraron, pero solicitudes_compra quedó, y el
  // boundary de errores (error.tsx, por diseño) solo muestra un mensaje
  // genérico al usuario y manda el detalle real a la consola del servidor, a
  // la que no tenemos acceso directo. Para poder diagnosticar sin adivinar,
  // se registra el error real (code + message de Postgres) en auditoría
  // antes de relanzarlo — visible en /auditoria para quien tiene ese permiso
  // (admin, tesorería, consejo directivo, fiscal). No cambia el
  // comportamiento para el usuario: sigue viendo el mismo mensaje genérico.
  try {
    await run(`DELETE FROM decisiones_compra WHERE solicitud_id = ?`, [id]);
    await run(`DELETE FROM presupuestos_proveedor WHERE solicitud_id = ?`, [id]);
    try {
      await run(`DELETE FROM gastos_comision WHERE solicitud_compra_id = ?`, [id]);
    } catch (err: any) {
      // AUDITORÍA INTEGRAL (hallazgo, 12/09): el primer intento real reveló
      // que en esta base gastos_comision no solo le falta una columna —
      // la tabla entera todavía no existe (Postgres 42P01, "relation ...
      // does not exist": la migración 0017 nunca corrió). Mismo criterio que
      // con una columna faltante: si no existe, no hay nada que borrar ahí.
      if (err?.code !== "42703" && err?.code !== "42P01") throw err;
    }
    await run(`DELETE FROM solicitudes_compra WHERE id = ?`, [id]);
  } catch (err: any) {
    await audit({
      usuario_id: user.id,
      accion: "error_eliminar",
      entidad: "solicitudes_compra",
      entidad_id: Number(id),
      valor_nuevo: { code: err?.code ?? null, message: String(err?.message ?? err) },
    }).catch(() => {}); // si ni siquiera esto se puede guardar, no tapar el error original
    throw err;
  }

  await audit({ usuario_id: user.id, accion: "eliminar", entidad: "solicitudes_compra", entidad_id: Number(id), valor_anterior: solicitud });
  revalidatePath("/compras");
}

export async function eliminarSolicitudFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarSolicitudAction(formData));
}

/**
 * Rediseño profundo de Compras, Fase 4 (pedido explícito, sección 21:
 * "facturas/documentos adjuntables desde el detalle de la compra"). Hallazgo
 * de la Fase 3: no existía ningún vínculo real entre una solicitud de compra
 * y la biblioteca general de `documentos` — esta acción cierra ese hueco sin
 * tocar `subirDocumentoAction` (documentos.ts), que sigue sirviendo para la
 * biblioteca general sin vínculo a ninguna compra puntual.
 *
 * Permiso deliberadamente distinto al de `documentos.ts`: subir un documento
 * a la biblioteca general exige `canEdit(rol, "documentos")` (solo
 * Administración/Consejo Directivo/admin — ver roles.ts), pero quien de
 * verdad recibe una factura es la Comisión de Compras, que tiene
 * `compras: "edit"` pero `documentos: "read"` (no "edit"). Gatear esto por
 * el permiso de "documentos" le hubiera impedido a la propia Comisión de
 * Compras adjuntar el comprobante de lo que ella misma compró — por eso acá
 * se exige el mismo permiso que el resto de las acciones de este archivo
 * (`canEdit(rol,"compras")` + `verificarPermisoSobreSolicitud`, igual que
 * agregarPresupuestoAction/marcarPedidaAction), no el de documentos. La
 * categoría se fuerza a "facturas" (una de las ya existentes en
 * `documentos.categoria`) para que también aparezca ordenado en /documentos.
 */
const adjuntarFacturaCompraSchema = z.object({
  solicitud_id: zId,
  nombre: zTexto(200),
  descripcion: zTextoOpcional(500),
});

export async function adjuntarFacturaCompraAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { solicitud_id: solicitudId, ...datos } = parseForm(adjuntarFacturaCompraSchema, formData);
  await verificarPermisoSobreSolicitud(user, solicitudId);

  const archivoUrl = await saveUploadedFile(formData.get("archivo") as File | null, user.organization_id, "documentos", {
    tiposPermitidos: TIPOS_DOCUMENTO,
    maxBytes: 20 * 1024 * 1024,
  });
  if (!archivoUrl) throw new Error("Elegí un archivo para adjuntar.");

  // Si la migración 0026 (agrega esta columna) todavía no corrió en esta
  // base, insert() reintenta sin solicitud_compra_id en vez de romper —
  // mismo criterio defensivo que el resto de este archivo (ver comision_id
  // en crearSolicitudAction). El documento igual se guarda, sólo que sin el
  // vínculo directo hasta que la migración corra.
  const documentoId = await insert("documentos", {
    categoria: "facturas",
    ...datos,
    archivo_url: archivoUrl,
    subido_por_id: user.id,
    solicitud_compra_id: solicitudId,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "documentos", entidad_id: documentoId, valor_nuevo: { solicitudId, ...datos } });
  revalidatePath(`/compras/${solicitudId}`);
}

export async function adjuntarFacturaCompraFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => adjuntarFacturaCompraAction(formData));
}
