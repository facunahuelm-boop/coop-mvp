"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION, puedeUsarGastos } from "@/lib/comisionAuth";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import {
  parseForm,
  zId,
  zIdOpcional,
  zTexto,
  zTextoOpcional,
  zMontoPositivo,
  zFecha,
  zEnumSeguro,
  clavesDe,
} from "@/lib/validation";

// Gastos por Comisión (pedido explícito): cada comisión (Compras, Seguridad,
// Administrativa, Trabajo, Obra, o cualquiera creada a futuro) puede cargar
// sus propios gastos acá. Cadena que pide el usuario, "Cooperativa → Comisión
// → Gasto → Proveedor → Movimiento financiero": esta tabla es el gasto en
// detalle; en el momento en que se marca "pagado" (acá mismo, o de entrada al
// cargarlo si ya se pagó) se genera automáticamente la fila correspondiente
// en movimientos_financieros — Finanzas sigue siendo la única fuente de
// verdad del saldo, nunca hay dos lugares sumando plata por separado. Ver
// migrations/0017_gastos_comision.sql para el detalle de esta decisión.
//
// Permisos (sección 7 del pedido): además del permiso de módulo, hace falta
// ser integrante activo de ESA comisión (o tener rol de conducción/finanzas)
// — ver src/lib/comisionAuth.ts. Esto se valida siempre acá, en el servidor,
// nunca solo ocultando el botón en la pantalla.

// AUDITORÍA INTEGRAL (hallazgo, 12/09): en este entorno la tabla gastos_comision
// todavía no existe (Postgres 42P01 — la migración 0017_gastos_comision.sql
// nunca se ejecutó contra la base de producción). A diferencia de un borrado
// (que puede simplemente no borrar nada si la tabla no existe), acá no hay
// forma de "degradar con gracia" un alta/edición/pago/anulación sobre una
// tabla inexistente — no se puede fabricar una funcionalidad que no puede
// funcionar. Lo que sí podemos hacer sin inventar nada es convertir el error
// genérico del boundary (mensaje "Ocurrió un problema" + un código) en un
// mensaje honesto y específico, para que quien lo use sepa que es un tema de
// actualización pendiente y no un error suyo. Se aplica a las 4 acciones de
// este archivo que tocan gastos_comision.
function comoErrorClaro(err: any): never {
  if (err?.code === "42P01") {
    throw new Error(
      "Los gastos por comisión todavía no están habilitados en este entorno: falta aplicar una actualización pendiente de la base de datos. Avisale a quien administra el sistema para que la ejecute."
    );
  }
  throw err;
}

const ESTADO_CREACION = ["pendiente", "pagado"] as const;

const gastoSchema = z.object({
  comision_id: zId,
  descripcion: zTexto(300),
  categoria: zEnumSeguro(clavesDe(CATEGORIA_COMPRA_LABEL), "otros"),
  fecha: zFecha,
  importe: zMontoPositivo(),
  forma_pago: zTextoOpcional(100),
  estado: zEnumSeguro(ESTADO_CREACION, "pendiente"),
  observaciones: zTextoOpcional(1000),
});

/** Crea el movimiento financiero correspondiente a un gasto ya pagado, y
 * devuelve su id — usado tanto al crear un gasto que ya nace "pagado" como
 * al marcar como pagado uno que estaba pendiente. */
async function crearMovimientoDesdeGasto(params: {
  userId: number;
  comisionNombre: string;
  descripcion: string;
  categoria: string;
  importe: number;
  fecha: string;
  comprobanteUrl: string | null;
}): Promise<number> {
  return insert("movimientos_financieros", {
    tipo: "egreso",
    monto: params.importe,
    categoria: params.categoria,
    fecha: params.fecha,
    descripcion: `${params.comisionNombre} — ${params.descripcion}`,
    comprobante_url: params.comprobanteUrl,
    registrado_por_id: params.userId,
  });
}

export async function crearGastoAction(formData: FormData) {
  const user = await requireUser();
  if (!puedeUsarGastos(user.rol)) throw new Error("No autorizado.");
  const datos = parseForm(gastoSchema, formData);
  if (!(await puedeGestionarComision(user, datos.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const comision = await get<{ nombre: string }>(`SELECT nombre FROM comisiones WHERE id = ?`, [datos.comision_id]);
  if (!comision) throw new Error("Esa comisión no existe.");

  // proveedor_id / nuevo_proveedor: mismo criterio "elegí uno u otro" que ya
  // usa Compras (agregarPresupuestoAction) — se puede elegir un proveedor ya
  // cargado, o escribir el nombre de uno nuevo y se crea acá mismo.
  let proveedorId: number | null = Number(formData.get("proveedor_id") || 0) || null;
  const nuevoProveedor = String(formData.get("nuevo_proveedor") || "").trim().slice(0, 200);
  if (!proveedorId && nuevoProveedor) {
    proveedorId = await insert("proveedores", { nombre: nuevoProveedor, estado: "nuevo", creado_por_id: user.id });
  }

  const comprobanteUrl = await saveUploadedFile(
    formData.get("comprobante") as File | null,
    user.organization_id,
    "gastos_comision",
    { tiposPermitidos: TIPOS_DOCUMENTO }
  );

  let movimientoId: number | null = null;
  if (datos.estado === "pagado") {
    movimientoId = await crearMovimientoDesdeGasto({
      userId: user.id,
      comisionNombre: comision.nombre,
      descripcion: datos.descripcion,
      categoria: datos.categoria,
      importe: datos.importe,
      fecha: datos.fecha,
      comprobanteUrl,
    });
  }

  let id: number;
  try {
    id = await insert("gastos_comision", {
      ...datos,
      proveedor_id: proveedorId,
      comprobante_url: comprobanteUrl,
      creado_por_id: user.id,
      movimiento_financiero_id: movimientoId,
    });
  } catch (err: any) {
    comoErrorClaro(err);
  }
  await audit({ usuario_id: user.id, accion: "crear", entidad: "gastos_comision", entidad_id: id, valor_nuevo: { ...datos, comision: comision.nombre } });
  revalidatePath("/gastos");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

const editarGastoSchema = z.object({
  id: zId,
  descripcion: zTexto(300),
  categoria: zEnumSeguro(clavesDe(CATEGORIA_COMPRA_LABEL), "otros"),
  forma_pago: zTextoOpcional(100),
  observaciones: zTextoOpcional(1000),
  proveedor_id: zIdOpcional,
});

/** Edita un gasto. Mientras está "pendiente" se puede editar todo lo
 * descriptivo; una vez "pagado" el importe/fecha/comisión quedan fijos
 * porque ya generaron un movimiento financiero real — cambiarlos ahí
 * rompería la trazabilidad entre el gasto y ese movimiento. Para corregir
 * un gasto ya pagado hace falta anular el movimiento desde Finanzas. */
export async function editarGastoAction(formData: FormData) {
  const user = await requireUser();
  if (!puedeUsarGastos(user.rol)) throw new Error("No autorizado.");
  const { id, ...datos } = parseForm(editarGastoSchema, formData);

  let gasto: { comision_id: number; estado: string } | undefined;
  try {
    gasto = await get<{ comision_id: number; estado: string }>(`SELECT comision_id, estado FROM gastos_comision WHERE id = ?`, [id]);
  } catch (err: any) {
    comoErrorClaro(err);
  }
  if (!gasto) throw new Error("Ese gasto ya no existe.");
  if (!(await puedeGestionarComision(user, gasto.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  if (gasto.estado === "anulado") throw new Error("Este gasto está anulado — no se puede editar.");

  try {
    await update("gastos_comision", id, datos);
  } catch (err: any) {
    comoErrorClaro(err);
  }
  await audit({ usuario_id: user.id, accion: "editar", entidad: "gastos_comision", entidad_id: id, valor_nuevo: datos });
  revalidatePath("/gastos");
}

export async function marcarGastoPagadoAction(formData: FormData) {
  const user = await requireUser();
  if (!puedeUsarGastos(user.rol)) throw new Error("No autorizado.");
  const { id } = parseForm(z.object({ id: zId }), formData);

  let gasto: any;
  try {
    gasto = await get<any>(
      `SELECT g.*, c.nombre as comision_nombre FROM gastos_comision g JOIN comisiones c ON c.id = g.comision_id WHERE g.id = ?`,
      [id]
    );
  } catch (err: any) {
    comoErrorClaro(err);
  }
  if (!gasto) throw new Error("Ese gasto ya no existe.");
  if (!(await puedeGestionarComision(user, gasto.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  if (gasto.estado !== "pendiente") throw new Error("Solo se puede marcar como pagado un gasto pendiente.");

  const movimientoId = await crearMovimientoDesdeGasto({
    userId: user.id,
    comisionNombre: gasto.comision_nombre,
    descripcion: gasto.descripcion,
    categoria: gasto.categoria,
    importe: Number(gasto.importe),
    fecha: gasto.fecha,
    comprobanteUrl: gasto.comprobante_url,
  });
  try {
    await update("gastos_comision", id, { estado: "pagado", movimiento_financiero_id: movimientoId });
  } catch (err: any) {
    comoErrorClaro(err);
  }
  await audit({ usuario_id: user.id, accion: "marcar_pagado", entidad: "gastos_comision", entidad_id: id, valor_nuevo: { movimientoId } });
  revalidatePath("/gastos");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

/** Anular solo está permitido mientras el gasto sigue "pendiente" — uno ya
 * pagado ya generó un movimiento financiero real, y no se borra ni se
 * revierte información histórica sin pasar por Finanzas (mismo criterio de
 * trazabilidad que el resto del sistema: estados, nunca borrado). */
export async function anularGastoAction(formData: FormData) {
  const user = await requireUser();
  if (!puedeUsarGastos(user.rol)) throw new Error("No autorizado.");
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTextoOpcional(500) }), formData);

  let gasto: { comision_id: number; estado: string; observaciones: string | null } | undefined;
  try {
    gasto = await get<{ comision_id: number; estado: string; observaciones: string | null }>(
      `SELECT comision_id, estado, observaciones FROM gastos_comision WHERE id = ?`,
      [id]
    );
  } catch (err: any) {
    comoErrorClaro(err);
  }
  if (!gasto) throw new Error("Ese gasto ya no existe.");
  if (!(await puedeGestionarComision(user, gasto.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  if (gasto.estado === "pagado") {
    throw new Error("Este gasto ya está pagado y generó un movimiento financiero — para corregirlo, hacé el ajuste desde Finanzas en vez de anularlo acá.");
  }
  if (gasto.estado === "anulado") return; // ya está anulado, no hay nada que hacer

  const observacionesFinal = motivo
    ? `${gasto.observaciones ? gasto.observaciones + " | " : ""}Anulado: ${motivo}`
    : gasto.observaciones;
  try {
    await update("gastos_comision", id, { estado: "anulado", observaciones: observacionesFinal });
  } catch (err: any) {
    comoErrorClaro(err);
  }
  await audit({ usuario_id: user.id, accion: "anular", entidad: "gastos_comision", entidad_id: id, valor_nuevo: { motivo } });
  revalidatePath("/gastos");
}
