"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, get, all, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { parseForm, zId, zIdOpcional, zTexto, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacion, crearNotificacionesParaUsuarios } from "@/lib/actions/notificaciones";
import { TIPO_COMUNICACION, TIPOS_COMUNICACION_OVERSIGHT } from "@/components/comunicaciones/ComunicacionStatus";

// Fase 7 del sistema de gestión de Comisiones (19/09, pedido explícito,
// sección "comunicaciones/notificaciones"): comunicación ESTRUCTURADA (no
// chat libre) — siempre tiene asunto, y puede quedar acotada a una comisión
// o a una persona. Ver ARQUITECTURA_COMISIONES.md — tablas comunicaciones/
// comunicacion_lecturas, migración 0029.
//
// Modelo de permisos: crear una comunicación exige el mismo permiso de
// módulo que el resto de esta fase (canEdit(rol, "comisiones") — no es una
// mensajería general para cualquier socio, es una herramienta de quienes
// integran una comisión). Dentro de eso, "entre_comision" exige además
// gestionar ESA comisión puntual (mismo criterio de doble capa que
// Solicitudes/Tareas/Decisiones, ver comisionAuth.ts); "general"/
// "consejo_directivo"/"administrativa"/"urgente" son comunicaciones de
// alcance amplio y quedan reservadas a roles de conducción (mismo conjunto
// que ya usa esOversightComisiones en el resto de esta fase) — evita que
// cualquier integrante de una comisión pueda "mandarle un urgente a toda la
// cooperativa". "privada" es un mensaje directo a otra persona, disponible
// para cualquiera que ya tenga acceso al módulo.
//
// Alcance deliberado de esta fase: a diferencia de Solicitudes/Decisiones,
// Comunicaciones NO tiene una ficha propia (/comunicaciones/[id]) — la única
// acción real sobre una comunicación ya enviada es marcarla como leída, así
// que el modal liviano de detalle (FilaConDetalle, en la página de listado)
// alcanza. Tampoco se ofrece todavía enlazar una comunicación a una
// solicitud/tarea/decisión puntual desde el formulario (las columnas ya
// existen en la tabla, nullable) — es una extensión aditiva simple si hiciera
// falta más adelante, no un cambio de diseño.

function esOversightComisiones(rol: Parameters<typeof canEdit>[0]): boolean {
  return canEdit(rol, "finanzas");
}

const crearComunicacionSchema = z.object({
  tipo: zEnumSeguro(TIPO_COMUNICACION, "entre_comision"),
  comision_id: zIdOpcional,
  destinatario_id: zIdOpcional,
  asunto: zTexto(300),
  cuerpo: zTexto(5000),
});

export async function crearComunicacionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearComunicacionSchema, formData);

  if (TIPOS_COMUNICACION_OVERSIGHT.includes(datos.tipo) && !esOversightComisiones(user.rol)) {
    throw new Error("Este tipo de comunicación requiere un rol de conducción (Admin, Consejo Directivo, Tesorería o Administración).");
  }
  if (datos.tipo === "entre_comision") {
    if (!datos.comision_id) throw new Error("Elegí la comisión.");
    if (!(await puedeGestionarComision(user, datos.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  }
  if (datos.tipo === "privada" && !datos.destinatario_id) {
    throw new Error("Elegí a quién va dirigido el mensaje.");
  }

  const id = await insert("comunicaciones", {
    tipo: datos.tipo,
    comision_id: datos.tipo === "entre_comision" ? datos.comision_id : null,
    destinatario_id: datos.tipo === "privada" ? datos.destinatario_id : null,
    autor_id: user.id,
    asunto: datos.asunto,
    cuerpo: datos.cuerpo,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "comunicaciones", entidad_id: id, valor_nuevo: { tipo: datos.tipo, asunto: datos.asunto } });

  // Notificar a quien corresponda según el tipo (bandeja de notificaciones,
  // ver lib/actions/notificaciones.ts) — nunca hace fallar el envío si algo
  // sale mal acá. "comunicacion_nueva" es un tipo agregado a propósito para
  // esta fase (la columna `tipo` de `notificaciones` es texto libre, sin
  // restricción — no está en la lista original del comentario de la
  // migración, que se armó antes de escribir esta fase).
  if (datos.tipo === "privada" && datos.destinatario_id) {
    await crearNotificacion({
      user_id: datos.destinatario_id,
      tipo: "mencion",
      titulo: `Mensaje de ${user.nombre}: ${datos.asunto}`,
      ref_tabla: "comunicaciones",
      ref_id: id,
    });
  } else if (datos.tipo === "entre_comision" && datos.comision_id) {
    const miembros = await all<{ user_id: number }>(
      `SELECT user_id FROM comision_miembros WHERE comision_id = ? AND activo = 1`,
      [datos.comision_id]
    ).catch(() => []);
    await crearNotificacionesParaUsuarios(
      miembros.map((m) => m.user_id).filter((uid) => uid !== user.id),
      { tipo: "comunicacion_nueva", titulo: `Nueva comunicación de tu comisión: ${datos.asunto}`, ref_tabla: "comunicaciones", ref_id: id }
    );
  } else {
    // general | urgente: a todos los usuarios activos de la cooperativa.
    // consejo_directivo | administrativa: sólo a los roles de conducción
    // (el mismo conjunto que ya la puede enviar y ver, ver la página).
    const usuarios = await all<{ id: number; rol: string }>(`SELECT id, rol FROM users WHERE activo = 1`).catch(() => []);
    const alcanceAmplio = datos.tipo === "general" || datos.tipo === "urgente";
    const destinatarios = usuarios
      .filter((u) => u.id !== user.id)
      .filter((u) => alcanceAmplio || esOversightComisiones(u.rol as Parameters<typeof canEdit>[0]))
      .map((u) => u.id);
    await crearNotificacionesParaUsuarios(destinatarios, {
      tipo: "comunicacion_nueva",
      titulo: `${datos.tipo === "urgente" ? "🔴 Urgente: " : "Nueva comunicación: "}${datos.asunto}`,
      ref_tabla: "comunicaciones",
      ref_id: id,
    });
  }

  revalidatePath("/comunicaciones");
}

export async function crearComunicacionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearComunicacionAction(formData));
}

const marcarLeidaSchema = z.object({ id: zId });

export async function marcarLeidaComunicacionAction(formData: FormData) {
  const user = await requireUser();
  const { id } = parseForm(marcarLeidaSchema, formData);
  const existente = await get<{ id: number }>(
    `SELECT id FROM comunicacion_lecturas WHERE comunicacion_id = ? AND user_id = ?`,
    [id, user.id]
  );
  if (!existente) {
    await insert("comunicacion_lecturas", { comunicacion_id: id, user_id: user.id });
  }
  revalidatePath("/comunicaciones");
}

export async function marcarLeidaComunicacionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => marcarLeidaComunicacionAction(formData));
}
