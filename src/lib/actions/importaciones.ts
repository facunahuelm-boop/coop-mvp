"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, run, audit } from "@/lib/db";
import { registrarCambioEstado } from "@/lib/sociosAlta";
import { hoyEnUruguay } from "@/lib/horasObra";
import { requireUser } from "@/lib/auth";
import { parseForm, zId, zTexto, zTextoOpcional, zEmailOpcional, zTelefonoOpcional, zFechaOpcional, zFecha, zMontoPositivo, zEnumSeguro } from "@/lib/validation";
import { leerArchivoTabular, normalizarFecha, normalizarMonto, ArchivoImportacionError, type FilaCruda } from "@/lib/importarArchivo";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/**
 * Fase 6 ("Migración de datos Excel/CSV(30) + Reportes(31) + IA contextual
 * por módulo(29) + Centro de ayuda/tickets") — Sub-fase 6.1: Migración de
 * datos Excel/CSV (sección 30, primera de esta fase).
 *
 * Gate: solo `admin` (mismo criterio que /usuarios, Sub-fase 4.1, y más
 * estricto que canEdit("socios")/canEdit("finanzas") que ya alcanzan
 * administración/tesorería/consejo directivo) — importar en lote crea
 * muchas filas de una sola vez, incluyendo movimientos financieros reales,
 * así que el riesgo de un archivo equivocado es mayor que cargar un
 * registro a mano.
 *
 * Diseño en 2 pasos (previsualizar → confirmar), igual para ambas
 * entidades: el archivo se lee y valida fila por fila SIN escribir nada en
 * la base; el resultado (filas válidas + inválidas con su error) se le
 * muestra a quien importa antes de confirmar nada. Al confirmar, solo se
 * insertan las filas que ya habían pasado la validación (revalidadas de
 * nuevo en el servidor, nunca se confía ciegamente en lo que el cliente
 * devuelve) — un archivo con algunas filas mal cargadas no bloquea las que
 * sí están bien, y cada fila fallida queda identificada con su número.
 *
 * `importaciones` (migración 0041) registra cada lote (no cada fila) para
 * poder deshacerlo entero si hace falta — reutilizando tal cual los
 * mecanismos de baja lógica que ya existen para cada tabla, sin inventar un
 * borrado nuevo: socios.estado='baja' (Fase 05 del Plan Maestro) y
 * movimientos_financieros.estado='anulado' (migración 0038, Sub-fase 4.4).
 */
async function requireAdmin() {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede importar datos.");
  return user;
}

export type FilaConError = { fila: number; error: string; valores: FilaCruda };
export type PreviewResultado<T> = {
  nombreArchivo: string;
  totalFilas: number;
  validas: { fila: number; datos: T }[];
  invalidas: FilaConError[];
};
export type ConfirmarResultado = { importacionId: number; insertadas: number; fallidas: number };

function numeroDeFila(indice: number) {
  // +1 porque el índice del array arranca en 0, +1 más porque la fila 1 del
  // archivo es el encabezado — así el número coincide con lo que la persona
  // ve si abre el archivo en Excel.
  return indice + 2;
}

// ---------------------------------------------------------------------
// Padrón de socios
// ---------------------------------------------------------------------

// Fase 2H: el padrón se importa con su núcleo. Una fila por persona: el
// titular (relación vacía o «titular») crea el socio y su núcleo; las demás
// (pareja, hijo/a…) se agregan como integrantes del núcleo con el mismo nombre.
const RELACIONES = ["titular", "pareja", "hijo", "hija", "padre", "madre", "hermano", "hermana", "otro"] as const;
const filaSocioSchema = z.object({
  nombre: zTexto(200),
  documento: zTextoOpcional(50),
  email: zEmailOpcional,
  telefono: zTelefonoOpcional,
  fecha_ingreso: zFechaOpcional,
  nucleo: zTextoOpcional(150),
  relacion: zEnumSeguro(RELACIONES, "titular"),
  notas: zTextoOpcional(1000),
});
export type FilaSocio = z.infer<typeof filaSocioSchema>;

function normalizarRelacion(v: string | undefined): string | undefined {
  if (!v) return v;
  const t = v.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["conyuge", "esposa", "esposo", "concubina", "concubino", "pareja"].includes(t)) return "pareja";
  if ((RELACIONES as readonly string[]).includes(t)) return t;
  return t ? "otro" : undefined;
}

function normalizarFilaSocio(cruda: FilaCruda): FilaCruda {
  return {
    ...cruda,
    fecha_ingreso: cruda.fecha_ingreso ? normalizarFecha(cruda.fecha_ingreso) : cruda.fecha_ingreso,
    relacion: normalizarRelacion(cruda.relacion ?? cruda.parentesco) ?? "",
    nucleo: cruda.nucleo ?? cruda.nucleo_familiar ?? "",
  };
}

const soloDigitos = (doc: string | null | undefined) => (doc ?? "").replace(/\D/g, "");
const claveNucleo = (n: string | null | undefined) => (n ?? "").trim().toLowerCase();

/** Personas que ya están en el padrón (por cédula) y titulares de núcleos existentes (por nombre del núcleo). */
async function padronExistente() {
  const personas = await all<{ nombre: string; documento: string | null }>(
    `SELECT nombre, documento FROM socios WHERE documento IS NOT NULL AND estado NOT IN ('baja', 'egresado', 'excluido')
     UNION ALL
     SELECT nombre || COALESCE(' ' || apellido, ''), documento FROM socio_integrantes WHERE documento IS NOT NULL AND estado = 'activo'`
  ).catch(() => [] as { nombre: string; documento: string | null }[]);
  const porDoc = new Map<string, string>();
  for (const p of personas) if (soloDigitos(p.documento).length >= 6) porDoc.set(soloDigitos(p.documento), p.nombre);
  const titulares = await all<{ socio_id: number; nucleo: string }>(
    `SELECT MIN(s.id) AS socio_id, n.nombre AS nucleo FROM socios s JOIN nucleos_familiares n ON n.id = s.nucleo_id
      WHERE s.estado NOT IN ('baja', 'egresado', 'excluido') GROUP BY n.nombre`
  ).catch(() => [] as { socio_id: number; nucleo: string }[]);
  return { porDoc, titularDeNucleo: new Map(titulares.map((t) => [claveNucleo(t.nucleo), t.socio_id])) };
}

/** Controles entre filas (repetidos, titulares) en lenguaje simple. */
function controlarPadron(
  validas: { fila: number; datos: FilaSocio }[],
  existente: Awaited<ReturnType<typeof padronExistente>>
): { ok: { fila: number; datos: FilaSocio }[]; errores: { fila: number; error: string }[] } {
  const errores: { fila: number; error: string }[] = [];
  const ok: { fila: number; datos: FilaSocio }[] = [];
  const docEnArchivo = new Map<string, number>();
  const titularEnArchivo = new Map<string, number>();
  for (const v of validas) {
    if (v.datos.relacion === "titular" && v.datos.nucleo) {
      const k = claveNucleo(v.datos.nucleo);
      if (titularEnArchivo.has(k)) {
        errores.push({ fila: v.fila, error: `El núcleo «${v.datos.nucleo}» ya tiene titular en la fila ${titularEnArchivo.get(k)}. Si es otra persona del núcleo, poné su relación (pareja, hijo…).` });
        continue;
      }
      titularEnArchivo.set(k, v.fila);
    }
  }
  for (const v of validas) {
    if (errores.some((e) => e.fila === v.fila)) continue;
    const doc = soloDigitos(v.datos.documento);
    if (doc.length >= 6) {
      if (docEnArchivo.has(doc)) {
        errores.push({ fila: v.fila, error: `La cédula ${v.datos.documento} está repetida (ya aparece en la fila ${docEnArchivo.get(doc)}).` });
        continue;
      }
      if (existente.porDoc.has(doc)) {
        errores.push({ fila: v.fila, error: `${existente.porDoc.get(doc)} ya está en el padrón con la cédula ${v.datos.documento}.` });
        continue;
      }
      docEnArchivo.set(doc, v.fila);
    }
    if (v.datos.relacion !== "titular") {
      if (!v.datos.nucleo) {
        errores.push({ fila: v.fila, error: `Para un integrante (relación «${v.datos.relacion}») escribí el núcleo: el mismo nombre de núcleo que tiene su titular.` });
        continue;
      }
      const k = claveNucleo(v.datos.nucleo);
      if (!titularEnArchivo.has(k) && !existente.titularDeNucleo.has(k)) {
        errores.push({ fila: v.fila, error: `No encontramos al titular del núcleo «${v.datos.nucleo}». Agregá una fila con su titular (relación vacía o «titular»).` });
        continue;
      }
    }
    ok.push(v);
  }
  return { ok, errores };
}

export async function previsualizarImportacionSocios(formData: FormData): Promise<PreviewResultado<FilaSocio>> {
  await requireAdmin();
  const file = formData.get("archivo") as File | null;
  if (!file || file.size === 0) throw new Error("Subí un archivo primero.");

  let filasCrudas: FilaCruda[];
  try {
    filasCrudas = await leerArchivoTabular(file);
  } catch (err) {
    throw new Error(err instanceof ArchivoImportacionError ? err.message : "No se pudo leer el archivo.");
  }

  const validas: { fila: number; datos: FilaSocio }[] = [];
  const invalidas: FilaConError[] = [];
  filasCrudas.forEach((cruda, i) => {
    const resultado = filaSocioSchema.safeParse(normalizarFilaSocio(cruda));
    if (resultado.success) validas.push({ fila: numeroDeFila(i), datos: resultado.data });
    else invalidas.push({ fila: numeroDeFila(i), error: resultado.error.issues[0]?.message ?? "Dato inválido.", valores: cruda });
  });
  const { ok, errores } = controlarPadron(validas, await padronExistente());
  for (const e of errores) invalidas.push({ ...e, valores: filasCrudas[e.fila - 2] ?? {} });
  invalidas.sort((a, b) => a.fila - b.fila);

  return { nombreArchivo: file.name, totalFilas: filasCrudas.length, validas: ok, invalidas };
}

export async function confirmarImportacionSocios(nombreArchivo: string, filas: { fila: number; datos: FilaSocio }[]): Promise<ConfirmarResultado> {
  const admin = await requireAdmin();
  if (filas.length === 0) throw new Error("No hay ninguna fila válida para importar.");
  // Se revalida todo en el servidor (nunca se confía en lo que manda el cliente),
  // incluidos los controles entre filas contra el padrón de este momento.
  const revalidadas: { fila: number; datos: FilaSocio }[] = [];
  let fallidas = 0;
  for (const f of filas) {
    const r = filaSocioSchema.safeParse(f.datos);
    if (r.success) revalidadas.push({ fila: Number(f.fila) || 0, datos: r.data });
    else fallidas++;
  }
  const existente = await padronExistente();
  const { ok, errores } = controlarPadron(revalidadas, existente);
  fallidas += errores.length;
  if (ok.length === 0) throw new Error("No hay ninguna fila para importar (puede que ya se hayan importado).");

  const importacionId = await insert("importaciones", {
    tipo: "socios",
    nombre_archivo: nombreArchivo,
    cantidad_filas: filas.length,
    importado_por_id: admin.id,
  });

  let insertadas = 0;
  const titularPorNucleo = new Map(existente.titularDeNucleo);
  // 1) Titulares (socio + núcleo).
  for (const { datos } of ok.filter((f) => f.datos.relacion === "titular")) {
    try {
      const nucleoId = await insert("nucleos_familiares", { nombre: (datos.nucleo || `Núcleo ${datos.nombre}`).slice(0, 200), importacion_id: importacionId });
      const socioId = await insert("socios", {
        nombre: datos.nombre,
        documento: datos.documento,
        email: datos.email,
        telefono: datos.telefono,
        fecha_ingreso: datos.fecha_ingreso,
        notas: datos.notas,
        nucleo_id: nucleoId,
        estado: "activo",
        importacion_id: importacionId,
      });
      await registrarCambioEstado(socioId, null, "activo", datos.fecha_ingreso || hoyEnUruguay(), "Importado desde planilla", admin.id).catch(() => {});
      if (datos.nucleo) titularPorNucleo.set(claveNucleo(datos.nucleo), socioId);
      insertadas++;
    } catch {
      fallidas++;
    }
  }
  // 2) Integrantes del núcleo.
  for (const { datos } of ok.filter((f) => f.datos.relacion !== "titular")) {
    const titular = titularPorNucleo.get(claveNucleo(datos.nucleo));
    if (!titular) {
      fallidas++;
      continue;
    }
    try {
      await insert("socio_integrantes", {
        socio_id: titular,
        nombre: datos.nombre,
        documento: datos.documento,
        email: datos.email,
        telefono: datos.telefono,
        relacion: datos.relacion,
        observaciones: datos.notas,
        estado: "activo",
        creado_por_id: admin.id,
        importacion_id: importacionId,
      });
      insertadas++;
    } catch {
      fallidas++;
    }
  }

  await update("importaciones", importacionId, { cantidad_importadas: insertadas, cantidad_errores: fallidas });
  await audit({
    usuario_id: admin.id,
    accion: "importar",
    entidad: "importaciones",
    entidad_id: importacionId,
    valor_nuevo: { tipo: "socios", nombre_archivo: nombreArchivo, insertadas, fallidas },
  });
  revalidatePath("/socios");
  revalidatePath("/importar");
  revalidatePath("/dashboard");
  revalidatePath("/alta");
  return { importacionId, insertadas, fallidas };
}

// ---------------------------------------------------------------------
// Movimientos financieros históricos
// ---------------------------------------------------------------------

const filaMovimientoSchema = z.object({
  tipo: zEnumSeguro(["ingreso", "egreso"] as const),
  monto: zMontoPositivo(),
  categoria: zTexto(120),
  fecha: zFecha,
  descripcion: zTextoOpcional(1000),
});
export type FilaMovimiento = z.infer<typeof filaMovimientoSchema>;

function normalizarFilaMovimiento(cruda: FilaCruda): FilaCruda {
  return {
    ...cruda,
    tipo: cruda.tipo ? cruda.tipo.trim().toLowerCase() : cruda.tipo,
    monto: cruda.monto ? normalizarMonto(cruda.monto) : cruda.monto,
    fecha: cruda.fecha ? normalizarFecha(cruda.fecha) : cruda.fecha,
  };
}

export async function previsualizarImportacionMovimientos(formData: FormData): Promise<PreviewResultado<FilaMovimiento>> {
  await requireAdmin();
  const file = formData.get("archivo") as File | null;
  if (!file || file.size === 0) throw new Error("Subí un archivo primero.");

  let filasCrudas: FilaCruda[];
  try {
    filasCrudas = await leerArchivoTabular(file);
  } catch (err) {
    throw new Error(err instanceof ArchivoImportacionError ? err.message : "No se pudo leer el archivo.");
  }

  const validas: { fila: number; datos: FilaMovimiento }[] = [];
  const invalidas: FilaConError[] = [];
  filasCrudas.forEach((cruda, i) => {
    const resultado = filaMovimientoSchema.safeParse(normalizarFilaMovimiento(cruda));
    if (resultado.success) validas.push({ fila: numeroDeFila(i), datos: resultado.data });
    else invalidas.push({ fila: numeroDeFila(i), error: resultado.error.issues[0]?.message ?? "Dato inválido.", valores: cruda });
  });

  return { nombreArchivo: file.name, totalFilas: filasCrudas.length, validas, invalidas };
}

export async function confirmarImportacionMovimientos(nombreArchivo: string, filas: { fila: number; datos: FilaMovimiento }[]): Promise<ConfirmarResultado> {
  const admin = await requireAdmin();
  if (filas.length === 0) throw new Error("No hay ninguna fila válida para importar.");

  const importacionId = await insert("importaciones", {
    tipo: "movimientos_financieros",
    nombre_archivo: nombreArchivo,
    cantidad_filas: filas.length,
    importado_por_id: admin.id,
  });

  let insertadas = 0;
  let fallidas = 0;
  for (const { datos } of filas) {
    const revalidado = filaMovimientoSchema.safeParse(datos);
    if (!revalidado.success) { fallidas++; continue; }
    try {
      await insert("movimientos_financieros", {
        tipo: revalidado.data.tipo,
        monto: revalidado.data.monto,
        categoria: revalidado.data.categoria,
        etapa_obra: revalidado.data.categoria,
        fecha: revalidado.data.fecha,
        descripcion: revalidado.data.descripcion,
        registrado_por_id: admin.id,
        estado: "activo",
        importacion_id: importacionId,
      });
      insertadas++;
    } catch {
      fallidas++;
    }
  }

  await update("importaciones", importacionId, { cantidad_importadas: insertadas, cantidad_errores: fallidas });
  await audit({
    usuario_id: admin.id,
    accion: "importar",
    entidad: "importaciones",
    entidad_id: importacionId,
    valor_nuevo: { tipo: "movimientos_financieros", nombre_archivo: nombreArchivo, insertadas, fallidas },
  });
  revalidatePath("/finanzas");
  revalidatePath("/importar");
  revalidatePath("/dashboard");
  revalidatePath("/transparencia");
  return { importacionId, insertadas, fallidas };
}

// ---------------------------------------------------------------------
// Deshacer una importación (en lote — reutiliza baja lógica ya existente)
// ---------------------------------------------------------------------

const deshacerImportacionSchema = z.object({ id: zId });

export async function deshacerImportacionAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id } = parseForm(deshacerImportacionSchema, formData);

  const importacion = await get<{ id: number; tipo: string; estado: string }>(
    `SELECT id, tipo, estado FROM importaciones WHERE id = ?`,
    [id]
  );
  if (!importacion) throw new Error("Esa importación ya no existe.");
  if (importacion.estado === "deshecho") throw new Error("Esta importación ya había sido deshecha.");

  if (importacion.tipo === "socios") {
    await run(`UPDATE socios SET estado = 'baja' WHERE importacion_id = ? AND estado != 'baja'`, [id]);
    // Fase 2H: los integrantes importados con el padrón también se dan de baja.
    await run(`UPDATE socio_integrantes SET estado = 'inactivo' WHERE importacion_id = ? AND estado = 'activo'`, [id]).catch(() => {});
  } else if (importacion.tipo === "movimientos_financieros") {
    await run(
      `UPDATE movimientos_financieros
       SET estado = 'anulado', anulado_en = NOW(), anulado_por_id = ?, motivo_anulacion = ?
       WHERE importacion_id = ? AND estado != 'anulado'`,
      [admin.id, `Deshecho junto con la importación #${id} (${importacion.tipo})`, id]
    );
  } else {
    throw new Error(`Tipo de importación desconocido: ${importacion.tipo}`);
  }

  await update("importaciones", id, { estado: "deshecho", deshecho_en: new Date().toISOString(), deshecho_por_id: admin.id });
  await audit({ usuario_id: admin.id, accion: "deshacer_importacion", entidad: "importaciones", entidad_id: id, valor_nuevo: { tipo: importacion.tipo } });

  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/importar");
  revalidatePath("/dashboard");
  revalidatePath("/transparencia");
}

export async function deshacerImportacionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => deshacerImportacionAction(formData));
}
