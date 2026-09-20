"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, get, run, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/**
 * Normaliza una lista de etiquetas escritas a mano ("obra, etapa 2 ,,urgente")
 * en un string prolijo separado por coma ("obra, etapa 2, urgente") o null
 * si no se cargó ninguna — mismo criterio simple que el resto del código
 * (texto plano, sin arrays ni JSON) para no introducir un tipo de dato nuevo
 * en la capa de datos.
 */
function normalizarEtiquetas(raw: FormDataEntryValue | null): string | null {
  const etiquetas = String(raw || "")
    .split(",")
    .map((e) => e.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 30); // techo razonable de etiquetas por documento
  return etiquetas.length > 0 ? etiquetas.join(", ") : null;
}

// La categoría de un documento no es un enum fijo a propósito: cada
// cooperativa puede crear las suyas (crearCategoriaDocumentoAction, abajo),
// así que acá solo se valida que sea texto razonable, no una lista cerrada.
//
// Fase 8 del sistema de gestión de Comisiones (19/09, sección "documentos
// con contexto y versionado"): un documento puede quedar enlazado a UNA
// entidad puntual de Comisiones (comisión, solicitud, tarea, reunión,
// decisión o comunicación — las 6 columnas nullable que agregó la
// migración 0029). Se modela como "tipo de vínculo" + "id del vínculo" en
// el formulario (mismo criterio que ya usa Comunicaciones para su `tipo`)
// en lugar de 6 selects sueltos siempre visibles — la REGLA DE ORO del
// pedido original (sección 59): un único select condicional reutiliza el
// mismo patrón visual que ya existe, en vez de inventar un bloque nuevo de
// 6 campos.
const CONTEXTO_DOCUMENTO_TIPOS = ["ninguno", "comision", "solicitud", "tarea", "reunion", "decision", "comunicacion"] as const;
type ContextoDocumentoTipo = (typeof CONTEXTO_DOCUMENTO_TIPOS)[number];
const CONTEXTO_DOCUMENTO_COLUMNA: Record<Exclude<ContextoDocumentoTipo, "ninguno">, string> = {
  comision: "comision_id",
  solicitud: "solicitud_comision_id",
  tarea: "tarea_id",
  reunion: "reunion_id",
  decision: "decision_id",
  comunicacion: "comunicacion_id",
};

/** Arma las 6 columnas de contexto para un insert en `documentos`: como
 * mucho una queda con un id, el resto null — evita repetir este armado en
 * subirDocumentoAction y subirNuevaVersionDocumentoAction. */
function columnasDeContexto(tipo: ContextoDocumentoTipo, id: number | null): Record<string, number | null> {
  const columnas: Record<string, number | null> = {
    comision_id: null,
    solicitud_comision_id: null,
    tarea_id: null,
    reunion_id: null,
    decision_id: null,
    comunicacion_id: null,
  };
  if (tipo !== "ninguno" && id) columnas[CONTEXTO_DOCUMENTO_COLUMNA[tipo]] = id;
  return columnas;
}

const subirDocumentoSchema = z.object({
  categoria: zTextoOpcional(100).transform((v) => v || "informes"),
  nombre: zTexto(200),
  descripcion: zTextoOpcional(1000),
  contexto_tipo: zEnumSeguro(CONTEXTO_DOCUMENTO_TIPOS, "ninguno"),
  contexto_id: zIdOpcional,
});

export async function subirDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "documentos")) throw new Error("No autorizado");
  const datos = parseForm(subirDocumentoSchema, formData);
  const archivoUrl = await saveUploadedFile(formData.get("archivo") as File | null, user.organization_id, "documentos", {
    tiposPermitidos: TIPOS_DOCUMENTO,
    maxBytes: 20 * 1024 * 1024,
  });
  // `insert()` ya descarta sola cualquier columna que la base todavía no
  // tenga (conFallbackColumnaFaltante, ver db.ts) — así que si el usuario
  // todavía no corrió la migración 0029, las 6 columnas de contexto (y
  // version/reemplaza_a_id más abajo) se ignoran solas y el documento se
  // guarda igual que antes de esta fase, sin romper nada.
  const id = await insert("documentos", {
    categoria: datos.categoria,
    nombre: datos.nombre,
    descripcion: datos.descripcion,
    etiquetas: normalizarEtiquetas(formData.get("etiquetas")),
    archivo_url: archivoUrl,
    subido_por_id: user.id,
    ...columnasDeContexto(datos.contexto_tipo, datos.contexto_id),
  });
  await audit({ usuario_id: user.id, accion: "subir", entidad: "documentos", entidad_id: id });
  revalidatePath("/documentos");
}

export async function subirDocumentoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => subirDocumentoAction(formData));
}

/**
 * Fase 07 del Plan Maestro ("carpetas/etiquetas"): antes de esto, la lista de
 * categorías era fija en código (CATEGORIAS en documentos/page.tsx) y ninguna
 * cooperativa podía agregar la suya. Mismo patrón que crearComisionAction:
 * un nombre libre, sin aprobación ni configuración adicional.
 */
export async function crearCategoriaDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "documentos")) throw new Error("No autorizado");
  const { nombre } = parseForm(z.object({ nombre: zTexto(100) }), formData);
  const id = await insert("documento_categorias", { nombre, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "documento_categorias", entidad_id: id, valor_nuevo: { nombre } });
  revalidatePath("/documentos");
}

export async function crearCategoriaDocumentoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearCategoriaDocumentoAction(formData));
}

/**
 * Fase 8 del sistema de gestión de Comisiones (19/09, "versionado"): sube un
 * archivo nuevo que reemplaza a uno ya cargado, sin perder el anterior — se
 * inserta una fila NUEVA (versión = anterior + 1, reemplaza_a_id = anterior),
 * nunca se sobreescribe el archivo/fila vieja. Mismo criterio que el resto
 * del proyecto con historial (solicitud_eventos, decisiones): memoria
 * institucional real es poder ver quién subió qué versión y cuándo, no solo
 * quedarse con el archivo más nuevo.
 *
 * Categoría/nombre/etiquetas/contexto se heredan de la versión anterior tal
 * cual (no se vuelven a pedir en el formulario, que sólo pide el archivo
 * nuevo y, opcionalmente, una descripción de qué cambió) — evita que una
 * nueva versión "se desenlace" sin querer de la comisión/solicitud/tarea a
 * la que ya estaba vinculada.
 */
const subirNuevaVersionSchema = z.object({
  documento_anterior_id: zId,
  descripcion: zTextoOpcional(1000),
});

export async function subirNuevaVersionDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "documentos")) throw new Error("No autorizado");
  const { documento_anterior_id, descripcion } = parseForm(subirNuevaVersionSchema, formData);

  const anterior = await get<any>(`SELECT * FROM documentos WHERE id = ?`, [documento_anterior_id]);
  if (!anterior) throw new Error("El documento original ya no existe.");

  const archivoUrl = await saveUploadedFile(formData.get("archivo") as File | null, user.organization_id, "documentos", {
    tiposPermitidos: TIPOS_DOCUMENTO,
    maxBytes: 20 * 1024 * 1024,
  });
  if (!archivoUrl) throw new Error("Adjuntá el archivo de la nueva versión.");

  const id = await insert("documentos", {
    categoria: anterior.categoria,
    nombre: anterior.nombre,
    descripcion: descripcion || anterior.descripcion,
    etiquetas: anterior.etiquetas,
    archivo_url: archivoUrl,
    subido_por_id: user.id,
    comision_id: anterior.comision_id ?? null,
    solicitud_comision_id: anterior.solicitud_comision_id ?? null,
    tarea_id: anterior.tarea_id ?? null,
    reunion_id: anterior.reunion_id ?? null,
    decision_id: anterior.decision_id ?? null,
    comunicacion_id: anterior.comunicacion_id ?? null,
    version: Number(anterior.version ?? 1) + 1,
    reemplaza_a_id: anterior.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "nueva_version",
    entidad: "documentos",
    entidad_id: id,
    valor_anterior: { reemplaza_a_id: anterior.id, version_anterior: anterior.version ?? 1 },
    valor_nuevo: { version: Number(anterior.version ?? 1) + 1 },
  });
  revalidatePath("/documentos");
}

export async function subirNuevaVersionDocumentoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => subirNuevaVersionDocumentoAction(formData));
}

/**
 * AUDITORÍA INTEGRAL (testing E2E real, 12/09): no había ninguna forma de
 * borrar un documento cargado por error o de prueba (mismo hallazgo que en
 * Proveedores y, antes, en Compras) — mismo patrón: solo admin, escribir
 * "ELIMINAR" para confirmar. actas.documento_id referencia documentos(id)
 * (nullable, pero la base igual rechaza el borrado si algo la referencia):
 * si el documento es el PDF de un acta ya registrada, no se borra — se avisa
 * para no dejar un acta con un link roto.
 */
const eliminarDocumentoSchema = z.object({ id: zId, confirmacion: zTexto(50) });

export async function eliminarDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede eliminar un documento.");
  const { id, confirmacion } = parseForm(eliminarDocumentoSchema, formData);
  if (confirmacion.trim().toUpperCase() !== "ELIMINAR") {
    throw new Error('Para eliminar, escribí exactamente "ELIMINAR" en el campo de confirmación.');
  }
  const documento = await get<any>(`SELECT * FROM documentos WHERE id = ?`, [id]);
  if (!documento) {
    revalidatePath("/documentos");
    return; // ya no existe: nada que borrar
  }
  const enUso = await get<any>(`SELECT id FROM actas WHERE documento_id = ? LIMIT 1`, [id]);
  if (enUso) {
    throw new Error("Este documento es el archivo de un acta ya registrada: no se puede eliminar sin dejar esa acta sin archivo. Subí un documento nuevo para reemplazarlo en su lugar.");
  }
  // Fase 8 ("versionado"): si otro documento lo reemplaza (reemplaza_a_id lo
  // apunta), borrarlo dejaría el historial de versiones con un eslabón
  // roto — se avisa en vez de borrar, mismo criterio que el chequeo de
  // arriba con `actas`. `.catch(() => null)` por si la columna todavía no
  // existe (migración 0029 pendiente): sin la columna no puede haber
  // versiones, así que no hay nada que proteger.
  const tieneVersionPosterior = await get<any>(`SELECT id FROM documentos WHERE reemplaza_a_id = ? LIMIT 1`, [id]).catch(() => null);
  if (tieneVersionPosterior) {
    throw new Error("Este documento tiene una versión más nueva que lo reemplaza: no se puede eliminar sin romper el historial de versiones.");
  }
  try {
    await run(`DELETE FROM documentos WHERE id = ?`, [id]);
  } catch (err: any) {
    await audit({
      usuario_id: user.id,
      accion: "error_eliminar",
      entidad: "documentos",
      entidad_id: Number(id),
      valor_nuevo: { code: err?.code ?? null, message: String(err?.message ?? err) },
    }).catch(() => {});
    throw err;
  }
  await audit({ usuario_id: user.id, accion: "eliminar", entidad: "documentos", entidad_id: Number(id), valor_anterior: documento });
  revalidatePath("/documentos");
}

export async function eliminarDocumentoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarDocumentoAction(formData));
}
