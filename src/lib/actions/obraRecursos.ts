"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_IMAGEN } from "@/lib/upload";
import { hoyEnUruguay } from "@/lib/horasObra";
import { puedeGestionarComision } from "@/lib/comisionAuth";
import { crearNotificacion } from "@/lib/notificaciones";
import { parseForm, zId, zTexto, zTextoOpcional, zFecha, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import {
  puedeEscribirDiario,
  puedeUsarPanol,
  puedeRecibirMateriales,
  itemsPanol,
  numeroTexto,
  ERROR_SIN_PERMISO_DIARIO,
  ERROR_SIN_PERMISO_PANOL,
  ERROR_SIN_PERMISO_RECEPCION,
} from "@/lib/obraRecursos";

/** Fase 3C — recepción de materiales, pañol y diario de obra. */

const conAviso =
  (fn: (fd: FormData) => Promise<string>) =>
  async (fd: FormData): Promise<ActionState> => {
    let aviso = "";
    const r = await conEstadoDeAccion(async () => {
      aviso = await fn(fd);
    });
    return r.ok ? { ...r, aviso } : r;
  };

const noFutura = (fecha: string) => {
  if (fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
};


/** Busca un ítem del pañol por nombre (sin distinguir mayúsculas) o lo crea. */
async function itemPorNombre(nombre: string, unidad: string, userId: number): Promise<number> {
  const ya = await get<{ id: number }>(`SELECT id FROM panol_items WHERE lower(nombre) = lower(?) AND activo = 1 LIMIT 1`, [nombre.trim()]);
  if (ya) return ya.id;
  const id = await insert("panol_items", { nombre: nombre.trim(), tipo: "material", unidad: unidad || "unidad", creado_por_id: userId });
  await audit({ usuario_id: userId, accion: "crear", entidad: "panol_items", entidad_id: id, valor_nuevo: { nombre, origen: "recepción de materiales" } });
  return id;
}

// ---------- Recepción de materiales ----------

const recepcionSchema = z.object({
  solicitud_id: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  fecha: zFecha,
  material: zTexto(200),
  unidad: zTextoOpcional(30),
  cantidad_pedida: z.coerce.number().min(0).max(1_000_000).optional().or(z.literal("").transform(() => undefined)),
  cantidad_recibida: z.coerce.number({ message: "Indicá cuánto llegó." }).min(0, "No puede ser negativo.").max(1_000_000, "Revisá la cantidad."),
  remito_numero: zTextoOpcional(60),
  conforme: z.enum(["si", "no"], { message: "Indicá si llegó todo bien." }),
  diferencias: zTextoOpcional(1000),
  al_panol: z.string().optional(),
});

export async function registrarRecepcionAction(formData: FormData): Promise<string> {
  const user = await requireUser();
  if (!(await puedeRecibirMateriales(user))) throw new Error(ERROR_SIN_PERMISO_RECEPCION);
  const d = parseForm(recepcionSchema, formData);
  noFutura(d.fecha);
  if (d.conforme === "no" && !d.diferencias) throw new ValidationError("diferencias", "Contá qué faltó o qué llegó mal.");

  let solicitud: { id: number; material: string; estado: string; solicitante_id: number | null; comision_id: number | null } | undefined;
  let proveedorId: number | null = null;
  if (d.solicitud_id) {
    solicitud = await get(`SELECT id, material, estado, solicitante_id, comision_id FROM solicitudes_compra WHERE id = ? AND eliminado_en IS NULL`, [d.solicitud_id]);
    if (!solicitud) throw new Error("Esa compra ya no existe.");
    if (!["aprobada", "pedida"].includes(solicitud.estado)) throw new Error("Sólo se puede recibir una compra aprobada o pedida al proveedor.");
    if (solicitud.comision_id && !canEdit(user.rol, "obra") && !(await puedeGestionarComision(user, solicitud.comision_id))) {
      throw new Error(ERROR_SIN_PERMISO_RECEPCION);
    }
    const dec = await get<{ proveedor_id: number | null }>(
      `SELECT p.proveedor_id FROM decisiones_compra dc LEFT JOIN presupuestos_proveedor p ON p.id = dc.presupuesto_id WHERE dc.solicitud_id = ? ORDER BY dc.id DESC LIMIT 1`,
      [solicitud.id]
    ).catch(() => undefined);
    proveedorId = dec?.proveedor_id ?? null;
  }

  const foto = await saveUploadedFile(formData.get("remito_foto") as File | null, user.organization_id, "remitos", {
    tiposPermitidos: TIPOS_IMAGEN,
    maxBytes: 8 * 1024 * 1024,
  });
  const alPanol = d.al_panol === "1" && d.cantidad_recibida > 0;
  const itemId = alPanol ? await itemPorNombre(d.material, d.unidad ?? "unidad", user.id) : null;
  const id = await insert("recepciones_material", {
    solicitud_id: solicitud?.id ?? null,
    proveedor_id: proveedorId,
    fecha: d.fecha,
    material: d.material,
    unidad: d.unidad,
    cantidad_pedida: d.cantidad_pedida ?? null,
    cantidad_recibida: d.cantidad_recibida,
    remito_numero: d.remito_numero,
    remito_foto_url: foto,
    conforme: d.conforme === "si" ? 1 : 0,
    diferencias: d.conforme === "no" ? d.diferencias : null,
    panol_item_id: itemId,
    recibido_por_id: user.id,
  });
  if (itemId) {
    await insert("panol_movimientos", {
      item_id: itemId,
      tipo: "entrada",
      cantidad: d.cantidad_recibida,
      fecha: d.fecha,
      recepcion_id: id,
      notas: d.remito_numero ? `Remito ${d.remito_numero}` : "Recepción de materiales",
      registrado_por_id: user.id,
    });
  }
  await audit({
    usuario_id: user.id,
    accion: "recibir_material",
    entidad: "recepciones_material",
    entidad_id: id,
    valor_nuevo: { material: d.material, recibido: d.cantidad_recibida, pedido: d.cantidad_pedida, conforme: d.conforme, diferencias: d.diferencias, remito: d.remito_numero, compra: solicitud?.id, al_panol: !!itemId },
  });

  let mensaje = `Recepción registrada${itemId ? " y anotada en el pañol" : ""}.`;
  if (solicitud) {
    if (d.conforme === "si") {
      await update("solicitudes_compra", solicitud.id, { estado: "entregada" });
      await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "solicitudes_compra", entidad_id: solicitud.id, valor_nuevo: { estado: "entregada", recepcion_id: id } });
      mensaje += " La compra queda como entregada.";
    } else {
      if (solicitud.estado === "aprobada") await update("solicitudes_compra", solicitud.id, { estado: "pedida" });
      mensaje += " Como hubo diferencias, la compra sigue abierta hasta que llegue lo que falta.";
    }
    if (solicitud.solicitante_id && solicitud.solicitante_id !== user.id) {
      await crearNotificacion({
        user_id: solicitud.solicitante_id,
        tipo: "compra_entregada",
        titulo: d.conforme === "si" ? `Llegó tu compra: ${solicitud.material}` : `Llegó parte de tu compra (con diferencias): ${solicitud.material}`,
        ref_tabla: "solicitudes_compra",
        ref_id: solicitud.id,
      });
    }
    revalidatePath(`/compras/${solicitud.id}`);
  }
  revalidatePath("/compras", "layout");
  revalidatePath("/obra", "layout");
  return mensaje;
}
export async function registrarRecepcionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(registrarRecepcionAction)(fd);
}

const anularSchema = z.object({ id: zId, motivo: zTexto(300) });

export async function anularRecepcionAction(formData: FormData) {
  const user = await requireUser();
  if (!(await puedeRecibirMateriales(user))) throw new Error(ERROR_SIN_PERMISO_RECEPCION);
  const { id, motivo } = parseForm(anularSchema, formData);
  const r = await get<{ anulado_en: string | null; material: string }>(`SELECT anulado_en, material FROM recepciones_material WHERE id = ?`, [id]);
  if (!r || r.anulado_en) throw new Error("Esa recepción no existe o ya estaba anulada.");
  const ahora = new Date().toISOString();
  await update("recepciones_material", id, { anulado_en: ahora, anulado_por_id: user.id, motivo_anulacion: motivo });
  // La entrada al pañol que generó también se anula.
  const mov = await get<{ id: number }>(`SELECT id FROM panol_movimientos WHERE recepcion_id = ? AND anulado_en IS NULL`, [id]);
  if (mov) await update("panol_movimientos", mov.id, { anulado_en: ahora, anulado_por_id: user.id, motivo_anulacion: `Se anuló la recepción: ${motivo}` });
  await audit({ usuario_id: user.id, accion: "anular", entidad: "recepciones_material", entidad_id: id, valor_anterior: { material: r.material }, valor_nuevo: { motivo } });
  revalidatePath("/compras", "layout");
  revalidatePath("/obra", "layout");
}
export async function anularRecepcionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularRecepcionAction(fd));
}

// ---------- Pañol ----------

async function requirePanol() {
  const user = await requireUser();
  if (!(await puedeUsarPanol(user))) throw new Error(ERROR_SIN_PERMISO_PANOL);
  return user;
}

const itemSchema = z.object({
  nombre: zTexto(120),
  tipo: z.enum(["herramienta", "material"], { message: "Elegí si es herramienta o material." }),
  unidad: zTextoOpcional(30),
  stock_minimo: z.coerce.number().min(0, "No puede ser negativo.").max(1_000_000).optional().or(z.literal("").transform(() => undefined)),
  ubicacion: zTextoOpcional(120),
  cantidad_inicial: z.coerce.number().min(0, "No puede ser negativo.").max(1_000_000).optional().or(z.literal("").transform(() => undefined)),
});

export async function crearItemPanolAction(formData: FormData): Promise<string> {
  const user = await requirePanol();
  const d = parseForm(itemSchema, formData);
  const ya = await get<{ id: number }>(`SELECT id FROM panol_items WHERE lower(nombre) = lower(?) AND activo = 1`, [d.nombre]);
  if (ya) throw new ValidationError("nombre", "Ya hay algo con ese nombre en el pañol.");
  const id = await insert("panol_items", {
    nombre: d.nombre,
    tipo: d.tipo,
    unidad: d.unidad || "unidad",
    stock_minimo: d.stock_minimo ?? 0,
    ubicacion: d.ubicacion,
    creado_por_id: user.id,
  });
  if (d.cantidad_inicial) {
    await insert("panol_movimientos", { item_id: id, tipo: "ajuste", cantidad: d.cantidad_inicial, fecha: hoyEnUruguay(), notas: "Inventario inicial", registrado_por_id: user.id });
  }
  await audit({ usuario_id: user.id, accion: "crear", entidad: "panol_items", entidad_id: id, valor_nuevo: { ...d } });
  revalidatePath("/obra/panol");
  return `«${d.nombre}» quedó en el pañol.`;
}
export async function crearItemPanolFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(crearItemPanolAction)(fd);
}

const movSchema = z.object({
  item_id: zId,
  tipo: z.enum(["entrada", "salida", "prestamo", "ajuste"], { message: "Elegí qué movimiento es." }),
  cantidad: z.coerce.number({ message: "Indicá la cantidad." }).refine((n) => n !== 0, "No puede ser 0.").refine((n) => Math.abs(n) <= 1_000_000, "Revisá la cantidad."),
  fecha: zFecha,
  persona: zTextoOpcional(150),
  nucleo_id: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  notas: zTextoOpcional(500),
});

const TIPO_MOV_TEXTO: Record<string, string> = { entrada: "Entraron", salida: "Salieron", prestamo: "Se prestaron", ajuste: "Ajuste de" };

export async function movimientoPanolAction(formData: FormData): Promise<string> {
  const user = await requirePanol();
  const d = parseForm(movSchema, formData);
  noFutura(d.fecha);
  if (d.tipo !== "ajuste" && d.cantidad < 0) throw new ValidationError("cantidad", "Tiene que ser mayor que 0.");
  const item = (await itemsPanol()).find((i) => i.id === d.item_id);
  if (!item) throw new ValidationError("item_id", "Elegí algo del pañol.");
  if (d.tipo === "prestamo" && !d.persona && !d.nucleo_id) throw new ValidationError("persona", "¿A quién se le presta?");
  if ((d.tipo === "salida" || d.tipo === "prestamo") && d.cantidad > item.stock) {
    throw new ValidationError("cantidad", `En el pañol hay ${numeroTexto(item.stock)} ${item.unidad}.`);
  }
  if (d.tipo === "ajuste" && item.stock + d.cantidad < 0) throw new ValidationError("cantidad", `El stock no puede quedar negativo (hay ${numeroTexto(item.stock)}).`);
  if (d.tipo === "ajuste" && !d.notas) throw new ValidationError("notas", "Contá por qué se ajusta (ej.: «conteo del viernes»).");
  let persona = d.persona ?? null;
  if (d.nucleo_id) {
    const n = await get<{ nombre: string }>(`SELECT nombre FROM nucleos_familiares WHERE id = ?`, [d.nucleo_id]);
    if (!n) throw new ValidationError("nucleo_id", "Ese núcleo no existe.");
    persona = persona ? `${persona} (${n.nombre})` : n.nombre;
  }
  const id = await insert("panol_movimientos", {
    item_id: d.item_id,
    tipo: d.tipo,
    cantidad: d.cantidad,
    fecha: d.fecha,
    persona,
    nucleo_id: d.nucleo_id ?? null,
    notas: d.notas,
    registrado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: `panol_${d.tipo}`, entidad: "panol_movimientos", entidad_id: id, valor_nuevo: { item: item.nombre, cantidad: d.cantidad, persona, notas: d.notas } });
  revalidatePath("/obra/panol");
  return `${TIPO_MOV_TEXTO[d.tipo]} ${numeroTexto(Math.abs(d.cantidad))} ${item.unidad} de ${item.nombre}${persona && d.tipo !== "entrada" ? ` (${persona})` : ""}.`;
}
export async function movimientoPanolFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(movimientoPanolAction)(fd);
}

export async function devolverPrestamoAction(formData: FormData) {
  const user = await requirePanol();
  const { id } = parseForm(z.object({ id: zId }), formData);
  const m = await get<{ tipo: string; devuelto_en: string | null; anulado_en: string | null; persona: string | null }>(
    `SELECT tipo, devuelto_en, anulado_en, persona FROM panol_movimientos WHERE id = ?`,
    [id]
  );
  if (!m || m.tipo !== "prestamo" || m.anulado_en) throw new Error("Ese préstamo no existe.");
  if (m.devuelto_en) throw new Error("Ese préstamo ya estaba devuelto.");
  await update("panol_movimientos", id, { devuelto_en: new Date().toISOString(), devuelto_recibido_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "panol_devolucion", entidad: "panol_movimientos", entidad_id: id, valor_nuevo: { persona: m.persona } });
  revalidatePath("/obra/panol");
}
export async function devolverPrestamoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => devolverPrestamoAction(fd));
}

export async function anularMovimientoPanolAction(formData: FormData) {
  const user = await requirePanol();
  const { id, motivo } = parseForm(anularSchema, formData);
  const m = await get<{ anulado_en: string | null; recepcion_id: number | null }>(`SELECT anulado_en, recepcion_id FROM panol_movimientos WHERE id = ?`, [id]);
  if (!m || m.anulado_en) throw new Error("Ese movimiento no existe o ya estaba anulado.");
  if (m.recepcion_id) throw new Error("Esta entrada viene de una recepción de materiales: se anula desde la recepción.");
  await update("panol_movimientos", id, { anulado_en: new Date().toISOString(), anulado_por_id: user.id, motivo_anulacion: motivo });
  await audit({ usuario_id: user.id, accion: "anular", entidad: "panol_movimientos", entidad_id: id, valor_nuevo: { motivo } });
  revalidatePath("/obra/panol");
}
export async function anularMovimientoPanolFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularMovimientoPanolAction(fd));
}

// ---------- Diario de obra ----------

const diarioSchema = z.object({
  fecha: zFecha,
  clima: zTextoOpcional(60),
  personas: z.coerce.number().int("Número entero.").min(0, "No puede ser negativo.").max(2000).optional().or(z.literal("").transform(() => undefined)),
  trabajos: zTexto(4000),
  novedades: zTextoOpcional(4000),
});

const MAX_FOTOS = 6;

export async function escribirDiarioAction(formData: FormData): Promise<string> {
  const user = await requireUser();
  if (!(await puedeEscribirDiario(user))) throw new Error(ERROR_SIN_PERMISO_DIARIO);
  const d = parseForm(diarioSchema, formData);
  noFutura(d.fecha);
  const archivos = formData.getAll("fotos").filter((f): f is File => f instanceof File && f.size > 0);
  if (archivos.length > MAX_FOTOS) throw new ValidationError("fotos", `Hasta ${MAX_FOTOS} fotos por día.`);
  // Primero se suben las fotos (si alguna falla, no queda la entrada a medias).
  const urls: string[] = [];
  for (const f of archivos) {
    const url = await saveUploadedFile(f, user.organization_id, "diario-obra", { tiposPermitidos: TIPOS_IMAGEN, maxBytes: 8 * 1024 * 1024 });
    if (url) urls.push(url);
  }
  const id = await insert("diario_obra", { fecha: d.fecha, clima: d.clima, personas: d.personas ?? null, trabajos: d.trabajos, novedades: d.novedades, autor_id: user.id });
  for (const url of urls) await insert("diario_obra_fotos", { entrada_id: id, foto_url: url });
  await audit({ usuario_id: user.id, accion: "escribir_diario", entidad: "diario_obra", entidad_id: id, valor_nuevo: { fecha: d.fecha, fotos: urls.length } });
  revalidatePath("/obra/diario");
  return `Quedó anotado en el diario${urls.length ? ` con ${urls.length} foto${urls.length === 1 ? "" : "s"}` : ""}.`;
}
export async function escribirDiarioFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(escribirDiarioAction)(fd);
}

export async function anularDiarioAction(formData: FormData) {
  const user = await requireUser();
  if (!(await puedeEscribirDiario(user))) throw new Error(ERROR_SIN_PERMISO_DIARIO);
  const { id, motivo } = parseForm(anularSchema, formData);
  const e = await get<{ anulado_en: string | null; fecha: string }>(`SELECT anulado_en, fecha FROM diario_obra WHERE id = ?`, [id]);
  if (!e || e.anulado_en) throw new Error("Esa entrada no existe o ya estaba anulada.");
  await update("diario_obra", id, { anulado_en: new Date().toISOString(), anulado_por_id: user.id, motivo_anulacion: motivo });
  await audit({ usuario_id: user.id, accion: "anular", entidad: "diario_obra", entidad_id: id, valor_anterior: { fecha: e.fecha }, valor_nuevo: { motivo } });
  revalidatePath("/obra/diario");
}
export async function anularDiarioFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularDiarioAction(fd));
}
