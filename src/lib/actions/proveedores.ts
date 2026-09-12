"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zEmailOpcional, zEnumSeguro } from "@/lib/validation";
import { ESTADO_PROVEEDOR, TIPO_PROVEEDOR } from "@/lib/constants";

// Proveedores fijos vs. nuevos/a presupuestar (pedido explícito): ver
// migrations/0018_proveedores_extendido.sql para el detalle de las columnas
// nuevas. "contacto" (texto libre) se mantiene tal cual estaba para no
// romper proveedores ya cargados; los campos nuevos (telefono, email,
// direccion, persona_contacto) son más específicos y conviven con él.
// ESTADO_PROVEEDOR/TIPO_PROVEEDOR (y sus labels) viven en constants.ts: un
// archivo "use server" solo puede exportar funciones async, no un
// array/objeto.

const datosProveedorSchema = {
  rut: zTextoOpcional(30),
  telefono: zTextoOpcional(50),
  email: zEmailOpcional,
  direccion: zTextoOpcional(300),
  persona_contacto: zTextoOpcional(150),
  rubro: zTextoOpcional(150),
  tipo: zEnumSeguro(TIPO_PROVEEDOR, "empresa"),
  estado: zEnumSeguro(ESTADO_PROVEEDOR, "nuevo"),
  contacto: zTextoOpcional(200),
  notas: zTextoOpcional(1000),
};

/**
 * Fase 08 del Plan Maestro ("ficha de Proveedores independiente"): hasta acá
 * un proveedor solo podía crearse "al vuelo" con solo un nombre, dentro del
 * formulario de cargar presupuesto en una solicitud de compra
 * (agregarPresupuestoAction, en actions/compras.ts) — contacto, rubro y
 * notas quedaban siempre vacíos porque no había ninguna pantalla para
 * cargarlos. Esta acción permite dar de alta un proveedor completo desde su
 * propia pantalla (/proveedores), sin necesidad de pasar por una solicitud
 * de compra primero.
 */
const crearProveedorSchema = z.object({ nombre: zTexto(200), ...datosProveedorSchema });

export async function crearProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const datos = parseForm(crearProveedorSchema, formData);
  // AUDITORÍA INTEGRAL (testing E2E real, 12/09): probando esta acción como
  // Carlos (Comisión de Trabajo) con los campos nuevos de la Fase 08
  // (RUT, tipo, etc.) rompió con el error genérico de siempre. insert() ya
  // tiene el fallback centralizado para columnas faltantes (ver db.ts), así
  // que si esto falla es por otra razón — se registra el error real acá
  // (mismo criterio que ya se usa en compras.ts y gastos.ts) para poder
  // diagnosticarlo desde /auditoria en vez de adivinar.
  let id: number | undefined;
  try {
    id = await insert("proveedores", { ...datos, creado_por_id: user.id });
  } catch (err: any) {
    await audit({
      usuario_id: user.id,
      accion: "error_crear",
      entidad: "proveedores",
      entidad_id: 0,
      valor_nuevo: { code: err?.code ?? null, message: String(err?.message ?? err) },
    }).catch(() => {});
    throw err;
  }
  await audit({ usuario_id: user.id, accion: "crear", entidad: "proveedores", entidad_id: id, valor_nuevo: { nombre: datos.nombre, estado: datos.estado } });
  revalidatePath("/proveedores");
}

/** Edita los datos de un proveedor ya existente (ficha, Fase 08 + extensión). */
const actualizarProveedorSchema = z.object({ id: zId, ...datosProveedorSchema });

export async function actualizarProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id, ...datos } = parseForm(actualizarProveedorSchema, formData);
  await update("proveedores", id, datos);
  await audit({ usuario_id: user.id, accion: "editar", entidad: "proveedores", entidad_id: id, valor_nuevo: datos });
  revalidatePath(`/proveedores/${id}`);
  revalidatePath("/proveedores");
}

/** Cambiar solo el estado (ej: marcar como "habitual" después de varias
 * compras sin abrir el formulario completo de edición). */
const cambiarEstadoSchema = z.object({ id: zId, estado: zEnumSeguro(ESTADO_PROVEEDOR) });

export async function cambiarEstadoProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id, estado } = parseForm(cambiarEstadoSchema, formData);
  await update("proveedores", id, { estado });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "proveedores", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath(`/proveedores/${id}`);
  revalidatePath("/proveedores");
}

/**
 * AUDITORÍA INTEGRAL (testing E2E real, 12/09): hasta acá no había ninguna
 * forma de borrar un proveedor cargado por error o de prueba — quedaba para
 * siempre en la lista (así quedó, por ejemplo, un proveedor de prueba de esta
 * misma auditoría). Mismo patrón que eliminarSolicitudAction en compras.ts
 * (solo admin, escribir "ELIMINAR" para confirmar, error real a /auditoria
 * antes de relanzarlo).
 *
 * A diferencia de una solicitud de compra individual, un proveedor puede
 * tener historial real de compras (presupuestos_proveedor.proveedor_id es
 * NOT NULL y referencia proveedores.id): borrarlo de golpe rompería ese
 * historial y la ficha del proveedor que el asistente de IA ya cita como
 * fuente. Por eso, si tiene aunque sea un presupuesto cargado, no se borra:
 * se avisa y se sugiere pasarlo a estado "Inactivo" (ya existe como opción)
 * en lugar de eliminarlo. Solo se permite el borrado físico cuando el
 * proveedor nunca llegó a presupuestar nada — es decir, cuando es
 * efectivamente un dato de prueba o un alta por error.
 */
const eliminarProveedorSchema = z.object({ id: zId, confirmacion: zTexto(50) });

export async function eliminarProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede eliminar un proveedor.");
  const { id, confirmacion } = parseForm(eliminarProveedorSchema, formData);
  if (confirmacion.trim().toUpperCase() !== "ELIMINAR") {
    throw new Error('Para eliminar, escribí exactamente "ELIMINAR" en el campo de confirmación.');
  }
  const proveedor = await get<any>(`SELECT * FROM proveedores WHERE id = ?`, [id]);
  if (!proveedor) {
    revalidatePath("/proveedores");
    return; // ya no existe: nada que borrar
  }
  const enUso = await get<any>(`SELECT id FROM presupuestos_proveedor WHERE proveedor_id = ? LIMIT 1`, [id]);
  if (enUso) {
    throw new Error(
      'Este proveedor ya tiene presupuestos o compras registradas: no se puede eliminar sin perder ese historial. Cambiá su estado a "Inactivo" desde su ficha en su lugar.'
    );
  }
  try {
    await run(`DELETE FROM proveedores WHERE id = ?`, [id]);
  } catch (err: any) {
    await audit({
      usuario_id: user.id,
      accion: "error_eliminar",
      entidad: "proveedores",
      entidad_id: Number(id),
      valor_nuevo: { code: err?.code ?? null, message: String(err?.message ?? err) },
    }).catch(() => {});
    throw err;
  }
  await audit({ usuario_id: user.id, accion: "eliminar", entidad: "proveedores", entidad_id: Number(id), valor_anterior: proveedor });
  revalidatePath("/proveedores");
}
