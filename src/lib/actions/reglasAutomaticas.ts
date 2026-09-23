"use server";

import { z } from "zod";
import { insert, update, audit } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { parseForm, zTexto, zTextoOpcional, zEnumSeguro, zId } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { ROLES } from "@/lib/roles";
import { EVENTOS_DISPONIBLES, ACCIONES_DISPONIBLES, SEVERIDADES_ALERTA } from "@/lib/reglasAutomaticasCatalogo";
import { requireAdminOConsejo } from "./configuracion";

// Fase 3 ("Reglas de la cooperativa, Estatuto/Reglamentos como
// configuración, Motor de reglas evento-condición-acción") — Sub-fase 3.3:
// Motor de reglas evento-condición-acción (sección 14). Mismo guard
// admin/consejo_directivo que ya usa el resto de /configuracion — ver
// requireAdminOConsejo, reutilizado tal cual, sin agregar ningún módulo
// nuevo a roles.ts.

const EVENTOS_VALORES = EVENTOS_DISPONIBLES.map((e) => e.value) as [string, ...string[]];
const ACCIONES_VALORES = ACCIONES_DISPONIBLES.map((a) => a.value) as [string, ...string[]];
const SEVERIDADES_VALORES = SEVERIDADES_ALERTA.map((s) => s.value) as [string, ...string[]];

const crearReglaSchema = z.object({
  nombre: zTexto(200),
  evento: zEnumSeguro(EVENTOS_VALORES),
  accion_tipo: zEnumSeguro(ACCIONES_VALORES),
  rol: zEnumSeguro(ROLES),
  mensaje: zTextoOpcional(300),
  severidad: zTextoOpcional(50),
  titulo_alerta: zTextoOpcional(200),
});

export async function crearReglaAutomaticaAction(formData: FormData) {
  const user = await requireAdminOConsejo();
  const datos = parseForm(crearReglaSchema, formData);

  let accionDatos: Record<string, unknown>;
  if (datos.accion_tipo === "notificar_rol") {
    accionDatos = { rol: datos.rol, mensaje: datos.mensaje || undefined };
  } else {
    if (!datos.severidad || !SEVERIDADES_VALORES.includes(datos.severidad)) {
      throw new Error("Elegí una severidad válida para la alerta.");
    }
    accionDatos = { rol: datos.rol, severidad: datos.severidad, titulo: datos.titulo_alerta || undefined };
  }

  const id = await insert("reglas_automaticas", {
    nombre: datos.nombre,
    evento: datos.evento,
    accion_tipo: datos.accion_tipo,
    accion_datos: accionDatos,
    activa: true,
    creado_por_id: user.id,
  });

  await audit({
    usuario_id: user.id,
    accion: "crear_regla_automatica",
    entidad: "reglas_automaticas",
    entidad_id: id,
    valor_nuevo: { nombre: datos.nombre, evento: datos.evento, accion_tipo: datos.accion_tipo, accion_datos: accionDatos },
  });
  revalidatePath("/reglas-automaticas");
}

export async function crearReglaAutomaticaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearReglaAutomaticaAction(formData));
}

const alternarReglaSchema = z.object({
  id: zId,
  activa: zEnumSeguro(["true", "false"] as const),
});

// A propósito NO hay una acción de "eliminar" acá — mismo criterio de "no
// hard-delete de registros importantes" que rige todo el sistema (ver
// cambiarEstadoDocumentoAction en documentos.ts, entre otros). Desactivar
// (activa=false) dejar de ejecutar la regla sin perder el historial de qué
// reglas existieron ni la auditoría de cuándo se crearon.
export async function alternarReglaAutomaticaAction(formData: FormData) {
  const user = await requireAdminOConsejo();
  const { id, activa } = parseForm(alternarReglaSchema, formData);
  const nuevaActiva = activa === "true";

  await update("reglas_automaticas", id, { activa: nuevaActiva });
  await audit({
    usuario_id: user.id,
    accion: nuevaActiva ? "activar_regla_automatica" : "desactivar_regla_automatica",
    entidad: "reglas_automaticas",
    entidad_id: id,
  });
  revalidatePath("/reglas-automaticas");
}

export async function alternarReglaAutomaticaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => alternarReglaAutomaticaAction(formData));
}
