"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
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
  clavesDe,
} from "@/lib/validation";

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
    proveedorId = await insert("proveedores", { nombre: nuevoProveedor });
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

  revalidatePath(`/compras/${solicitudId}`);
  revalidatePath("/compras");
  revalidatePath("/gastos");
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
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

export async function marcarEntregadaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await verificarPermisoSobreSolicitud(user, id);
  await update("solicitudes_compra", id, { estado: "entregada" });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
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
  await update("solicitudes_compra", id, { estado: "rechazada" });
  await audit({ usuario_id: user.id, accion: "rechazar_compra", entidad: "solicitudes_compra", entidad_id: id, valor_nuevo: { motivo } });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
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
      if (err?.code !== "42703") throw err;
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
