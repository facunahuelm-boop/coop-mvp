"use server";

import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";

// ---------- Viviendas ----------

export async function crearViviendaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const numero = String(formData.get("numero") || "").trim();
  if (!numero) throw new Error("Falta el número de vivienda");
  const id = await insert("viviendas", {
    numero,
    estado: String(formData.get("estado") || "en_obra"),
    notas: String(formData.get("notas") || "") || null,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "viviendas", entidad_id: id, valor_nuevo: { numero } });
  revalidatePath("/socios");
}

export async function actualizarViviendaEstadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  const estado = String(formData.get("estado") || "");
  await update("viviendas", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "viviendas", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/socios");
}

// ---------- Socios ----------

export async function crearSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new Error("Falta el nombre del socio");

  const viviendaId = String(formData.get("vivienda_id") || "");
  const nucleoId = String(formData.get("nucleo_id") || "");

  const id = await insert("socios", {
    nombre,
    documento: String(formData.get("documento") || "") || null,
    email: String(formData.get("email") || "") || null,
    telefono: String(formData.get("telefono") || "") || null,
    estado: "activo",
    vivienda_id: viviendaId ? Number(viviendaId) : null,
    nucleo_id: nucleoId ? Number(nucleoId) : null,
    fecha_ingreso: String(formData.get("fecha_ingreso") || "") || null,
    notas: String(formData.get("notas") || "") || null,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "socios", entidad_id: id, valor_nuevo: { nombre } });
  revalidatePath("/socios");
}

export async function actualizarSocioEstadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  const estado = String(formData.get("estado") || "");
  await update("socios", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "socios", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/socios");
}

export async function asignarViviendaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  const viviendaId = String(formData.get("vivienda_id") || "");
  await update("socios", id, { vivienda_id: viviendaId ? Number(viviendaId) : null });
  await audit({ usuario_id: user.id, accion: "asignar_vivienda", entidad: "socios", entidad_id: id, valor_nuevo: { vivienda_id: viviendaId || null } });
  revalidatePath("/socios");
}

// ---------- Lista de espera ----------

export async function agregarListaEsperaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new Error("Falta el nombre del aspirante");

  const ultimo = await get<{ max_orden: number | null }>(
    `SELECT MAX(orden) as max_orden FROM lista_espera`
  );
  const orden = (ultimo?.max_orden || 0) + 1;

  const id = await insert("lista_espera", {
    nombre,
    documento: String(formData.get("documento") || "") || null,
    contacto: String(formData.get("contacto") || "") || null,
    orden,
    estado: "en_espera",
    notas: String(formData.get("notas") || "") || null,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "lista_espera", entidad_id: id, valor_nuevo: { nombre, orden } });
  revalidatePath("/socios");
}

export async function actualizarListaEsperaEstadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  const estado = String(formData.get("estado") || "");
  await update("lista_espera", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "lista_espera", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/socios");
}

/**
 * Incorpora a alguien de la lista de espera como socio pleno: crea la ficha
 * en "socios" con los datos del aspirante y marca su entrada en la lista de
 * espera como "incorporado" (no se borra, queda como historial).
 */
export async function incorporarDesdeListaEsperaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "socios")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));

  const aspirante = await get<any>(`SELECT * FROM lista_espera WHERE id = ?`, [id]);
  if (!aspirante) throw new Error("No se encontró el aspirante");

  const viviendaId = String(formData.get("vivienda_id") || "");

  const socioId = await insert("socios", {
    nombre: aspirante.nombre,
    documento: aspirante.documento,
    estado: "activo",
    vivienda_id: viviendaId ? Number(viviendaId) : null,
    fecha_ingreso: new Date().toISOString().slice(0, 10),
    notas: aspirante.notas,
  });
  await update("lista_espera", id, { estado: "incorporado" });

  await audit({ usuario_id: user.id, accion: "incorporar_desde_lista_espera", entidad: "socios", entidad_id: socioId, valor_nuevo: { desde_lista_espera_id: id } });
  revalidatePath("/socios");
}
