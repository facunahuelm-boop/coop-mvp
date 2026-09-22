"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, run, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { generarPdfBuffer } from "@/lib/pdf";
import { saveGeneratedFile } from "@/lib/upload";
import dayjs from "dayjs";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaHora, zEnumSeguro, zCheckbox } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacion } from "@/lib/notificaciones";

const TIPO_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};
const TIPOS_REUNION = ["asamblea", "consejo_directivo", "comision"] as const;
const PRIORIDAD_TAREA = ["alta", "media", "baja"] as const;
// Comisiones como sistema de gestión, Fase 5 (19/09, secciones 15-17: "cada
// reunión con modalidad, agenda estructurada, asistencia real y actas").
const MODALIDADES_REUNION = ["presencial", "virtual", "hibrida"] as const;

// AUDITORÍA INTEGRAL (mismo hallazgo que comisiones.ts, tareas.ts y
// compras.ts): las cuatro acciones de este archivo solo comprobaban el
// permiso de módulo canEdit(rol, "comisiones") — que en roles.ts es "edit"
// para CUALQUIER rol de comisión. Una reunión de tipo "comision" puede estar
// vinculada a una comisión puntual (comision_id): sin una segunda capa de
// permiso, un integrante de la Comisión de Compras podía crear, cancelar,
// tomar asistencia o incluso CERRAR (generando el acta en PDF y creando
// tareas reales) una reunión de la Comisión de Obra. Además, "asamblea" y
// "consejo_directivo" son reuniones de toda la cooperativa, no de una
// comisión puntual — crearlas o tocarlas se reserva a roles de conducción,
// igual que crear/archivar una comisión entera en comisiones.ts.
function esOversightReuniones(rol: Parameters<typeof canEdit>[0]): boolean {
  return canEdit(rol, "finanzas");
}

async function verificarPermisoReunion(user: SessionUser, tipo: string, comisionId: number | null) {
  if (tipo !== "comision") {
    if (!esOversightReuniones(user.rol)) {
      throw new Error("Las reuniones de Asamblea o Consejo Directivo requieren un rol de conducción (Admin, Consejo Directivo, Tesorería o Administración).");
    }
    return;
  }
  if (comisionId && !(await puedeGestionarComision(user, comisionId))) {
    throw new Error(ERROR_SIN_PERMISO_COMISION);
  }
}

const crearReunionSchema = z.object({
  tipo: zEnumSeguro(TIPOS_REUNION, "comision"),
  comision_id: zIdOpcional,
  titulo: zTexto(200),
  fecha: zFechaHora,
  lugar: zTextoOpcional(200),
  orden_del_dia: zTextoOpcional(3000),
  modalidad: zEnumSeguro(MODALIDADES_REUNION, "presencial"),
});

export async function crearReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearReunionSchema, formData);
  await verificarPermisoReunion(user, datos.tipo, datos.tipo === "comision" ? datos.comision_id ?? null : null);

  const id = await insert("reuniones", {
    tipo: datos.tipo,
    comision_id: datos.tipo === "comision" ? datos.comision_id : null,
    titulo: datos.titulo,
    fecha: datos.fecha,
    lugar: datos.lugar,
    orden_del_dia: datos.orden_del_dia,
    modalidad: datos.modalidad,
    estado: "planificada",
    creado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "reuniones", entidad_id: id, valor_nuevo: { titulo: datos.titulo, fecha: datos.fecha, tipo: datos.tipo } });
  revalidatePath("/reuniones");
}

export async function crearReunionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearReunionAction(formData));
}

export async function cancelarReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const reunion = await get<{ tipo: string; comision_id: number | null }>(`SELECT tipo, comision_id FROM reuniones WHERE id = ?`, [id]);
  if (!reunion) throw new Error("Esa reunión ya no existe.");
  await verificarPermisoReunion(user, reunion.tipo, reunion.comision_id);
  await update("reuniones", id, { estado: "cancelada" });
  await audit({ usuario_id: user.id, accion: "cancelar", entidad: "reuniones", entidad_id: id });
  revalidatePath("/reuniones");
  revalidatePath(`/reuniones/${id}`);
}

export async function cancelarReunionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cancelarReunionAction(formData));
}

/**
 * Registra o actualiza la asistencia de un núcleo familiar a una reunión.
 * Mismo criterio que las asistencias de jornadas de trabajo: se guarda por
 * núcleo, no por persona individual.
 */
const registrarAsistenciaSchema = z.object({
  reunion_id: zId,
  nucleo_id: zId,
  presente: zCheckbox,
  justificacion: zTextoOpcional(500),
});

export async function registrarAsistenciaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { reunion_id, nucleo_id, presente: presenteBool, justificacion } = parseForm(registrarAsistenciaSchema, formData);
  const reunion = await get<{ tipo: string; comision_id: number | null }>(`SELECT tipo, comision_id FROM reuniones WHERE id = ?`, [reunion_id]);
  if (!reunion) throw new Error("Esa reunión ya no existe.");
  await verificarPermisoReunion(user, reunion.tipo, reunion.comision_id);
  const presente = presenteBool ? 1 : 0;

  const existente = await get<{ id: number }>(
    `SELECT id FROM reunion_asistencias WHERE reunion_id = ? AND nucleo_id = ?`,
    [reunion_id, nucleo_id]
  );
  if (existente) {
    await update("reunion_asistencias", existente.id, { presente, justificacion });
  } else {
    await insert("reunion_asistencias", { reunion_id, nucleo_id, presente, justificacion });
  }
  revalidatePath(`/reuniones/${reunion_id}`);
}

export async function registrarAsistenciaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarAsistenciaAction(formData));
}

// ---------- Agenda estructurada (sección 15: "agenda estructurada", tabla
// reunion_agenda_items de la migración 0029) ----------
//
// A diferencia de "orden_del_dia" (texto libre, ya existía y sigue
// funcionando igual — no se reemplaza nada de lo que ya andaba), esto agrega
// una lista real de puntos con responsable y resultado, para reuniones que
// quieran ese nivel de detalle. Se puede agregar/editar/borrar puntos
// mientras la reunión sigue "planificada" — una vez cerrada (con su acta ya
// generada a partir del estado de la agenda en ese momento), la agenda queda
// fija, mismo criterio de "cerrado no se puede tocar" que ya usan
// Solicitudes y Tareas.

async function reunionParaAgenda(reunionId: number) {
  const reunion = await get<{ tipo: string; comision_id: number | null; estado: string; titulo: string }>(
    `SELECT tipo, comision_id, estado, titulo FROM reuniones WHERE id = ?`,
    [reunionId]
  );
  if (!reunion) throw new Error("Esa reunión ya no existe.");
  return reunion;
}

const agregarAgendaItemSchema = z.object({
  reunion_id: zId,
  titulo: zTexto(200),
  descripcion: zTextoOpcional(1000),
  responsable_id: zIdOpcional,
});

export async function agregarAgendaItemAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(agregarAgendaItemSchema, formData);
  const reunion = await reunionParaAgenda(datos.reunion_id);
  if (reunion.estado !== "planificada") throw new Error("Esta reunión ya está cerrada o cancelada — no se puede modificar su agenda.");
  await verificarPermisoReunion(user, reunion.tipo, reunion.comision_id);

  const { total } = (await get<{ total: string }>(`SELECT COUNT(*) as total FROM reunion_agenda_items WHERE reunion_id = ?`, [datos.reunion_id])) ?? { total: "0" };
  await insert("reunion_agenda_items", { ...datos, orden: Number(total) });
  revalidatePath(`/reuniones/${datos.reunion_id}`);
}

export async function agregarAgendaItemFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarAgendaItemAction(formData));
}

const editarResultadoAgendaSchema = z.object({ id: zId, resultado: zTextoOpcional(2000) });

export async function editarResultadoAgendaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, resultado } = parseForm(editarResultadoAgendaSchema, formData);
  const item = await get<{ reunion_id: number }>(`SELECT reunion_id FROM reunion_agenda_items WHERE id = ?`, [id]);
  if (!item) throw new Error("Ese punto de agenda ya no existe.");
  const reunion = await reunionParaAgenda(item.reunion_id);
  await verificarPermisoReunion(user, reunion.tipo, reunion.comision_id);

  await update("reunion_agenda_items", id, { resultado });
  revalidatePath(`/reuniones/${item.reunion_id}`);
}

export async function editarResultadoAgendaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarResultadoAgendaAction(formData));
}

export async function eliminarAgendaItemAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const item = await get<{ reunion_id: number }>(`SELECT reunion_id FROM reunion_agenda_items WHERE id = ?`, [id]);
  if (!item) return; // ya no existe
  const reunion = await reunionParaAgenda(item.reunion_id);
  if (reunion.estado !== "planificada") throw new Error("Esta reunión ya está cerrada o cancelada — no se puede modificar su agenda.");
  await verificarPermisoReunion(user, reunion.tipo, reunion.comision_id);

  await run(`DELETE FROM reunion_agenda_items WHERE id = ?`, [id]);
  revalidatePath(`/reuniones/${item.reunion_id}`);
}

export async function eliminarAgendaItemFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarAgendaItemAction(formData));
}

// ---------- Asistencia por persona (sección 15-16: tabla reunion_invitados
// de la migración 0029) ----------
//
// La asistencia por núcleo (arriba, registrarAsistenciaAction) ya existía y
// sigue exactamente igual — tiene sentido para una Asamblea, donde el que
// vota es el núcleo/hogar. Para una reunión de Comisión o de Consejo
// Directivo, en cambio, lo que importa es qué PERSONA vino, no qué núcleo —
// por eso esto se agrega como una sección aparte, no reemplaza la anterior.

async function invitadoConReunion(id: number) {
  const invitado = await get<{ reunion_id: number; confirmado: boolean; presente: boolean }>(
    `SELECT reunion_id, confirmado, presente FROM reunion_invitados WHERE id = ?`,
    [id]
  );
  if (!invitado) return null;
  const reunion = await reunionParaAgenda(invitado.reunion_id);
  return { ...invitado, reunion };
}

const agregarInvitadoSchema = z.object({ reunion_id: zId, user_id: zId });

export async function agregarInvitadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { reunion_id, user_id } = parseForm(agregarInvitadoSchema, formData);
  const reunion = await reunionParaAgenda(reunion_id);
  await verificarPermisoReunion(user, reunion.tipo, reunion.comision_id);

  const yaExiste = await get<{ id: number }>(`SELECT id FROM reunion_invitados WHERE reunion_id = ? AND user_id = ?`, [reunion_id, user_id]);
  if (yaExiste) return;
  await insert("reunion_invitados", { reunion_id, user_id });

  // Fase 7 (notificaciones): avisa a la persona invitada.
  if (user_id !== user.id) {
    await crearNotificacion({
      user_id,
      tipo: "reunion_creada",
      titulo: `Te invitaron a la reunión "${reunion.titulo}"`,
      ref_tabla: "reuniones",
      ref_id: reunion_id,
    });
  }

  revalidatePath(`/reuniones/${reunion_id}`);
}

export async function agregarInvitadoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarInvitadoAction(formData));
}

export async function alternarConfirmadoInvitadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const invitado = await invitadoConReunion(id);
  if (!invitado) throw new Error("Ese invitado ya no existe.");
  await verificarPermisoReunion(user, invitado.reunion.tipo, invitado.reunion.comision_id);
  await update("reunion_invitados", id, { confirmado: !invitado.confirmado });
  revalidatePath(`/reuniones/${invitado.reunion_id}`);
}

export async function alternarConfirmadoInvitadoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => alternarConfirmadoInvitadoAction(formData));
}

export async function alternarPresenteInvitadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const invitado = await invitadoConReunion(id);
  if (!invitado) throw new Error("Ese invitado ya no existe.");
  await verificarPermisoReunion(user, invitado.reunion.tipo, invitado.reunion.comision_id);
  await update("reunion_invitados", id, { presente: !invitado.presente });
  revalidatePath(`/reuniones/${invitado.reunion_id}`);
}

export async function alternarPresenteInvitadoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => alternarPresenteInvitadoAction(formData));
}

export async function quitarInvitadoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const invitado = await invitadoConReunion(id);
  if (!invitado) return;
  await verificarPermisoReunion(user, invitado.reunion.tipo, invitado.reunion.comision_id);
  await run(`DELETE FROM reunion_invitados WHERE id = ?`, [id]);
  revalidatePath(`/reuniones/${invitado.reunion_id}`);
}

export async function quitarInvitadoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => quitarInvitadoAction(formData));
}

/**
 * Cierra una reunión: la marca como realizada y genera (o reutiliza) el acta
 * correspondiente, enlazada a la reunión. La tabla "actas" ya existía en el
 * sistema (documentos > Actas y resoluciones); acá se completa el circuito
 * para que no haya que cargarla suelta a mano.
 *
 * Fase 07/09 del Plan Maestro ("generador de PDF real" + "botón Generar
 * acta"): además de guardar el resumen como texto, ahora arma un PDF de
 * verdad (orden del día + resumen + asistencia) con generarPdfBuffer, lo
 * sube a Supabase Storage y lo deja disponible como un documento más en
 * Documentos → Actas, en vez de quedar solo como texto dentro del sistema.
 *
 * Fase 09 (cierre): además del PDF, esta misma acción puede dejar cargadas
 * las tareas resultantes de la reunión directamente en la tabla genérica
 * "tareas" (Fase 06) — ya no hace falta anotarlas en el resumen y después
 * volver a cargarlas a mano en Comisiones. Se reciben como listas paralelas
 * (mismo índice = misma tarea) vía formData.getAll, una fila por tarea
 * cargada en el formulario de cierre.
 */
export async function cerrarReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id: reunion_id, resumen } = parseForm(z.object({ id: zId, resumen: zTexto(5000) }), formData);

  const reunion = await get<any>(`SELECT * FROM reuniones WHERE id = ?`, [reunion_id]);
  if (!reunion) throw new Error("Reunión no encontrada");
  await verificarPermisoReunion(user, reunion.tipo, reunion.comision_id);

  const asistencias = await all<any>(
    `SELECT ra.presente, ra.justificacion, n.nombre as nucleo_nombre
     FROM reunion_asistencias ra JOIN nucleos_familiares n ON n.id = ra.nucleo_id
     WHERE ra.reunion_id = ?
     ORDER BY n.nombre ASC`,
    [reunion_id]
  );
  const presentes = asistencias.filter((a: any) => a.presente).length;

  // Fase 5 (secciones 15-17): agenda estructurada e invitados por persona,
  // de la migración 0029 — `.catch(() => [])` porque el cierre de una
  // reunión (esta acción) ya existía y funcionaba antes de esa migración, y
  // tiene que seguir cerrando y generando el acta igual aunque esas dos
  // tablas todavía no existan en esta base (el acta simplemente sale sin
  // esas dos secciones extra hasta que la migración corra).
  const agendaItems = await all<{ titulo: string; descripcion: string | null; resultado: string | null; responsable_nombre: string | null }>(
    `SELECT ai.titulo, ai.descripcion, ai.resultado, u.nombre as responsable_nombre
     FROM reunion_agenda_items ai LEFT JOIN users u ON u.id = ai.responsable_id
     WHERE ai.reunion_id = ? ORDER BY ai.orden ASC`,
    [reunion_id]
  ).catch(() => []);
  const invitados = await all<{ confirmado: boolean; presente: boolean; user_nombre: string }>(
    `SELECT ri.confirmado, ri.presente, u.nombre as user_nombre
     FROM reunion_invitados ri JOIN users u ON u.id = ri.user_id
     WHERE ri.reunion_id = ? ORDER BY u.nombre ASC`,
    [reunion_id]
  ).catch(() => []);
  const invitadosPresentes = invitados.filter((i) => i.presente).length;

  // Tareas resultantes cargadas en el formulario de cierre (filas paralelas,
  // se descartan las filas sin título). Cada valor se sanitiza acá porque
  // llegan como listas sueltas (formData.getAll), no como un objeto que
  // pueda validarse con un solo esquema de Zod.
  const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const titulos = formData.getAll("tarea_titulo").map((v) => String(v).trim().slice(0, 200));
  const responsables = formData.getAll("tarea_responsable_id").map((v) => String(v));
  const prioridades = formData.getAll("tarea_prioridad").map((v) => String(v || "media"));
  const vencimientos = formData.getAll("tarea_fecha_vencimiento").map((v) => String(v));
  const tareasResultantes = titulos
    .map((titulo, i) => {
      const respId = Number(responsables[i]);
      const prio = PRIORIDAD_TAREA.includes(prioridades[i] as (typeof PRIORIDAD_TAREA)[number]) ? prioridades[i] : "media";
      const venc = vencimientos[i] && FECHA_RE.test(vencimientos[i]) ? vencimientos[i] : null;
      return {
        titulo,
        responsable_id: Number.isInteger(respId) && respId > 0 ? respId : null,
        prioridad: prio,
        fecha_vencimiento: venc,
      };
    })
    .filter((t) => t.titulo)
    .slice(0, 50); // techo razonable de tareas por acta

  let documentoId: number | null = null;
  try {
    const pdfBuffer = await generarPdfBuffer({
      titulo: `Acta — ${reunion.titulo}`,
      subtitulo: `${TIPO_LABEL[reunion.tipo] ?? reunion.tipo} · ${dayjs(reunion.fecha).format("DD/MM/YYYY HH:mm")}${reunion.lugar ? ` · ${reunion.lugar}` : ""}`,
      organizacion: user.organizacion,
      secciones: [
        ...(reunion.orden_del_dia
          ? [{ tipo: "texto" as const, encabezado: "Orden del día", parrafos: [reunion.orden_del_dia] }]
          : []),
        ...(agendaItems.length > 0
          ? [
              {
                tipo: "tabla" as const,
                encabezado: "Agenda detallada",
                columnas: ["Punto", "Responsable", "Resultado"],
                filas: agendaItems.map((it) => [it.titulo, it.responsable_nombre || "—", it.resultado || "—"]),
              },
            ]
          : []),
        { tipo: "texto" as const, encabezado: "Resumen y resoluciones", parrafos: resumen.split("\n").filter(Boolean) },
        {
          tipo: "tabla" as const,
          encabezado: `Asistencia por núcleo (${presentes}/${asistencias.length})`,
          columnas: ["Núcleo familiar", "Presente", "Justificación"],
          filas: asistencias.map((a: any) => [a.nucleo_nombre, a.presente ? "Sí" : "No", a.justificacion || ""]),
        },
        ...(invitados.length > 0
          ? [
              {
                tipo: "tabla" as const,
                encabezado: `Asistencia por persona (${invitadosPresentes}/${invitados.length})`,
                columnas: ["Persona", "Confirmó", "Presente"],
                filas: invitados.map((i) => [i.user_nombre, i.confirmado ? "Sí" : "No", i.presente ? "Sí" : "No"]),
              },
            ]
          : []),
        ...(tareasResultantes.length > 0
          ? [
              {
                tipo: "tabla" as const,
                encabezado: "Tareas resultantes",
                columnas: ["Título", "Prioridad", "Vencimiento"],
                filas: tareasResultantes.map((t) => [
                  t.titulo,
                  t.prioridad,
                  t.fecha_vencimiento ? dayjs(t.fecha_vencimiento).format("DD/MM/YYYY") : "",
                ]),
              },
            ]
          : []),
      ],
    });

    const archivoUrl = await saveGeneratedFile(pdfBuffer, user.organization_id, "actas", `acta-${reunion_id}.pdf`);
    documentoId = await insert("documentos", {
      categoria: "actas",
      nombre: `Acta — ${reunion.titulo}`,
      archivo_url: archivoUrl,
      descripcion: resumen.slice(0, 300),
      subido_por_id: user.id,
    });
  } catch (err) {
    // Si por lo que sea falla la generación del PDF (ej: Storage caído), no
    // queremos que se pierda el acta en texto ni bloquear el cierre de la
    // reunión — el resumen igual queda guardado, solo falta el archivo.
    console.error("No se pudo generar el PDF del acta:", err);
  }

  let actaId = reunion.acta_id;
  if (!actaId) {
    actaId = await insert("actas", {
      organo: reunion.tipo, // asamblea | consejo_directivo | comision
      fecha: reunion.fecha,
      titulo: reunion.titulo,
      resumen,
      reunion_id,
      documento_id: documentoId,
    });
  } else {
    await update("actas", actaId, documentoId ? { resumen, documento_id: documentoId } : { resumen });
  }

  for (const t of tareasResultantes) {
    const tareaId = await insert("tareas", {
      comision_id: reunion.comision_id || null,
      reunion_id,
      titulo: t.titulo,
      responsable_id: t.responsable_id,
      prioridad: t.prioridad,
      fecha_vencimiento: t.fecha_vencimiento,
      creado_por_id: user.id,
    });
    await audit({
      usuario_id: user.id,
      accion: "crear",
      entidad: "tareas",
      entidad_id: tareaId,
      valor_nuevo: { titulo: t.titulo, reunion_id, origen: "acta" },
    });
  }

  await update("reuniones", reunion_id, { estado: "realizada", acta_id: actaId });
  await audit({ usuario_id: user.id, accion: "cerrar", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: { acta_id: actaId, documento_id: documentoId, tareas_creadas: tareasResultantes.length } });
  revalidatePath("/reuniones");
  revalidatePath(`/reuniones/${reunion_id}`);
  revalidatePath("/documentos");
  revalidatePath("/comisiones");
}

export async function cerrarReunionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cerrarReunionAction(formData));
}
