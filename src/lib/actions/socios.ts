"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import {
  parseForm,
  zId,
  zIdOpcional,
  zTexto,
  zTextoOpcional,
  zEmailOpcional,
  zFechaOpcional,
  zEnumSeguro,
} from "@/lib/validation";
import { RELACION_INTEGRANTE, TIPO_INTEGRANTE, ESTADO_INTEGRANTE } from "@/lib/constants";

// ---------- Núcleos / Integrantes ----------
// Padrón de Socios y Núcleos (pedido explícito): un núcleo (grupo familiar)
// puede tener varios integrantes (pareja, hijos, etc.) sin que cada uno sea
// un socio independiente. Se reutiliza "socios" como el TITULAR del núcleo
// (decisión ya tomada vía AskUserQuestion: "Reutilizar Socio como titular")
// en vez de inventar una entidad Núcleo nueva — la ficha de socio de siempre
// sigue siendo la unidad de vivienda/estado/lista de espera, y esta tabla
// nueva (socio_integrantes) cuelga de ella. Ver
// migrations/0019_socio_integrantes.sql para el detalle de la tabla.
// Las constantes (RELACION_INTEGRANTE, TIPO_INTEGRANTE, ESTADO_INTEGRANTE)
// viven en constants.ts: un archivo "use server" solo puede exportar
// funciones async, no un array/objeto.

// Mismos valores que ofrecen los <select> de socios/page.tsx (ESTADOS_VIVIENDA,
// ESTADOS_SOCIO, ESTADOS_LISTA_ESPERA) — se repiten acá porque son server
// actions y no pueden importar desde un archivo de página; si alguna vez se
// agrega un estado nuevo hay que sumarlo en los dos lugares.
const ESTADOS_VIVIENDA = ["en_obra", "terminada", "ocupada"] as const;
const ESTADOS_SOCIO = ["activo", "inactivo", "baja"] as const;
const ESTADOS_LISTA_ESPERA = ["en_espera", "convocado", "incorporado", "retirado"] as const;

// ---------- Viviendas ----------

const crearViviendaSchema = z.object({
  numero: zTexto(60),
  estado: zEnumSeguro(ESTADOS_VIVIENDA, "en_obra"),
  notas: zTextoOpcional(1000),
});

export async function crearViviendaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const datos = parseForm(crearViviendaSchema, formData);
  const id = await insert("viviendas", datos);
  await audit({ usuario_id: user.id, accion: "crear", entidad: "viviendas", entidad_id: id, valor_nuevo: { numero: datos.numero } });
  revalidatePath("/socios");
}

export async function actualizarViviendaEstadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, estado } = parseForm(z.object({ id: zId, estado: zEnumSeguro(ESTADOS_VIVIENDA) }), formData);
  await update("viviendas", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "viviendas", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/socios");
}

// ---------- Socios ----------

const crearSocioSchema = z.object({
  nombre: zTexto(200),
  documento: zTextoOpcional(50),
  email: zEmailOpcional,
  telefono: zTextoOpcional(50),
  vivienda_id: zIdOpcional,
  nucleo_id: zIdOpcional,
  fecha_ingreso: zFechaOpcional,
  notas: zTextoOpcional(1000),
});

export async function crearSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const datos = parseForm(crearSocioSchema, formData);

  const id = await insert("socios", { ...datos, estado: "activo" });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "socios", entidad_id: id, valor_nuevo: { nombre: datos.nombre } });
  revalidatePath("/socios");
}

export async function actualizarSocioEstadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, estado } = parseForm(z.object({ id: zId, estado: zEnumSeguro(ESTADOS_SOCIO) }), formData);
  await update("socios", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "socios", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/socios");
}

export async function asignarViviendaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, vivienda_id } = parseForm(z.object({ id: zId, vivienda_id: zIdOpcional }), formData);
  await update("socios", id, { vivienda_id });
  await audit({ usuario_id: user.id, accion: "asignar_vivienda", entidad: "socios", entidad_id: id, valor_nuevo: { vivienda_id } });
  revalidatePath("/socios");
}

/**
 * Cierre de la Fase 05 del Plan Maestro: hasta ahora, después de crear un
 * socio (crearSocioAction) no había forma de corregir un email mal cargado,
 * agregar un teléfono más adelante o anotar algo nuevo — solo el estado y la
 * vivienda tenían acción propia. Esta acción cubre el resto de la ficha
 * (documento, email, teléfono, notas), igual que actualizarProveedorAction
 * en proveedores.ts.
 */
const actualizarSocioSchema = z.object({
  id: zId,
  documento: zTextoOpcional(50),
  email: zEmailOpcional,
  telefono: zTextoOpcional(50),
  notas: zTextoOpcional(1000),
});

export async function actualizarSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, ...datos } = parseForm(actualizarSocioSchema, formData);
  await update("socios", id, datos);
  await audit({ usuario_id: user.id, accion: "editar", entidad: "socios", entidad_id: id, valor_nuevo: datos });
  revalidatePath(`/socios/${id}`);
  revalidatePath("/socios");
}

// ---------- Lista de espera ----------

const agregarListaEsperaSchema = z.object({
  nombre: zTexto(200),
  documento: zTextoOpcional(50),
  contacto: zTextoOpcional(200),
  notas: zTextoOpcional(1000),
});

export async function agregarListaEsperaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const datos = parseForm(agregarListaEsperaSchema, formData);

  const ultimo = await get<{ max_orden: number | null }>(
    `SELECT MAX(orden) as max_orden FROM lista_espera`
  );
  const orden = (ultimo?.max_orden || 0) + 1;

  const id = await insert("lista_espera", { ...datos, orden, estado: "en_espera" });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "lista_espera", entidad_id: id, valor_nuevo: { nombre: datos.nombre, orden } });
  revalidatePath("/socios");
}

export async function actualizarListaEsperaEstadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, estado } = parseForm(z.object({ id: zId, estado: zEnumSeguro(ESTADOS_LISTA_ESPERA) }), formData);
  await update("lista_espera", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "lista_espera", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/socios");
}

/**
 * El "orden" de la lista de espera se asignaba solo una vez, al agregar al
 * aspirante (siempre al final) — no había forma de subirlo o bajarlo si, por
 * ejemplo, el consejo directivo decide una prioridad distinta. Se resuelve
 * con un intercambio simple: mueve al aspirante un lugar hacia arriba o
 * abajo, intercambiando su "orden" con el del vecino inmediato (solo entre
 * los que siguen "en_espera" — un aspirante ya convocado/incorporado/retirado
 * no compite por posición).
 */
export async function moverListaEsperaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, direccion } = parseForm(z.object({ id: zId, direccion: zEnumSeguro(["arriba", "abajo"]) }), formData);

  const activos = await all<{ id: number; orden: number }>(
    `SELECT id, orden FROM lista_espera WHERE estado = 'en_espera' ORDER BY orden ASC`
  );
  const idx = activos.findIndex((a) => a.id === id);
  const vecinoIdx = direccion === "arriba" ? idx - 1 : idx + 1;
  if (idx === -1 || vecinoIdx < 0 || vecinoIdx >= activos.length) return;

  const actual = activos[idx];
  const vecino = activos[vecinoIdx];
  await update("lista_espera", actual.id, { orden: vecino.orden });
  await update("lista_espera", vecino.id, { orden: actual.orden });
  await audit({ usuario_id: user.id, accion: "reordenar", entidad: "lista_espera", entidad_id: id, valor_nuevo: { direccion } });
  revalidatePath("/socios");
}

/**
 * Incorpora a alguien de la lista de espera como socio pleno: crea la ficha
 * en "socios" con los datos del aspirante y marca su entrada en la lista de
 * espera como "incorporado" (no se borra, queda como historial).
 */
export async function incorporarDesdeListaEsperaAction(formData: FormData) {
  const user = await requireUser();
  // AUDITORÍA INTEGRAL (hallazgo de seguridad, 12/09): la propia MATRIX de
  // roles.ts documenta esto como una acción de "aprueba" (consejo directivo),
  // distinta de que administración gestione la lista de espera día a día
  // (canEdit) — la UI (socios/page.tsx) ya lo mostraba solo con puedeAprobar,
  // pero el backend todavía aceptaba canEdit, así que administración podía
  // incorporar a alguien como socio pleno llamando a esta acción directamente,
  // saltándose la aprobación del consejo directivo.
  if (!canApprove(user.rol, "socios")) throw new Error("No autorizado");
  const { id, vivienda_id } = parseForm(z.object({ id: zId, vivienda_id: zIdOpcional }), formData);

  const aspirante = await get<any>(`SELECT * FROM lista_espera WHERE id = ?`, [id]);
  if (!aspirante) throw new Error("No se encontró el aspirante");

  const socioId = await insert("socios", {
    nombre: aspirante.nombre,
    documento: aspirante.documento,
    estado: "activo",
    vivienda_id,
    fecha_ingreso: new Date().toISOString().slice(0, 10),
    notas: aspirante.notas,
  });
  await update("lista_espera", id, { estado: "incorporado" });

  await audit({ usuario_id: user.id, accion: "incorporar_desde_lista_espera", entidad: "socios", entidad_id: socioId, valor_nuevo: { desde_lista_espera_id: id } });
  revalidatePath("/socios");
}

/**
 * Agrega un integrante al núcleo de un socio (pareja, hijo/a, etc.). El
 * socio_id identifica al TITULAR — mismo criterio de permiso que el resto de
 * la ficha de socios (canEdit "socios"): esto lo gestiona quien administra
 * el padrón, no cada socio por sí mismo.
 */
const agregarIntegranteSchema = z.object({
  socio_id: zId,
  nombre: zTexto(200),
  apellido: zTextoOpcional(200),
  documento: zTextoOpcional(50),
  fecha_nacimiento: zFechaOpcional,
  telefono: zTextoOpcional(50),
  email: zEmailOpcional,
  relacion: zEnumSeguro(RELACION_INTEGRANTE, "otro"),
  tipo_integrante: zEnumSeguro(TIPO_INTEGRANTE, "adulto"),
  observaciones: zTextoOpcional(1000),
});

export async function agregarIntegranteAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { socio_id: socioId, ...datos } = parseForm(agregarIntegranteSchema, formData);

  const socio = await get<{ id: number }>(`SELECT id FROM socios WHERE id = ?`, [socioId]);
  if (!socio) throw new Error("Ese socio ya no existe.");

  const id = await insert("socio_integrantes", {
    socio_id: socioId,
    ...datos,
    estado: "activo",
    creado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "socio_integrantes", entidad_id: id, valor_nuevo: { socio_id: socioId, nombre: datos.nombre, relacion: datos.relacion } });
  revalidatePath(`/socios/${socioId}`);
  revalidatePath("/socios");
}

/** Edita los datos de un integrante ya cargado. */
const editarIntegranteSchema = z.object({
  id: zId,
  nombre: zTexto(200),
  apellido: zTextoOpcional(200),
  documento: zTextoOpcional(50),
  fecha_nacimiento: zFechaOpcional,
  telefono: zTextoOpcional(50),
  email: zEmailOpcional,
  relacion: zEnumSeguro(RELACION_INTEGRANTE, "otro"),
  tipo_integrante: zEnumSeguro(TIPO_INTEGRANTE, "adulto"),
  observaciones: zTextoOpcional(1000),
});

export async function editarIntegranteAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, ...datos } = parseForm(editarIntegranteSchema, formData);

  const integrante = await get<{ socio_id: number }>(`SELECT socio_id FROM socio_integrantes WHERE id = ?`, [id]);
  if (!integrante) throw new Error("Ese integrante ya no existe.");

  await update("socio_integrantes", id, datos);
  await audit({ usuario_id: user.id, accion: "editar", entidad: "socio_integrantes", entidad_id: id, valor_nuevo: datos });
  revalidatePath(`/socios/${integrante.socio_id}`);
}

/**
 * Da de baja (o reactiva) a un integrante sin borrarlo — "la estructura debe
 * permitir agregar y quitar integrantes sin perder el historial" (pedido
 * explícito). Mismo criterio que viviendas/socios/proveedores: estados,
 * nunca DELETE.
 */
const cambiarEstadoIntegranteSchema = z.object({ id: zId, estado: zEnumSeguro(ESTADO_INTEGRANTE) });

export async function cambiarEstadoIntegranteAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const { id, estado } = parseForm(cambiarEstadoIntegranteSchema, formData);

  const integrante = await get<{ socio_id: number }>(`SELECT socio_id FROM socio_integrantes WHERE id = ?`, [id]);
  if (!integrante) throw new Error("Ese integrante ya no existe.");

  await update("socio_integrantes", id, { estado });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "socio_integrantes", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath(`/socios/${integrante.socio_id}`);
}
