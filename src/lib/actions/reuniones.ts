"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { generarPdfBuffer } from "@/lib/pdf";
import { saveGeneratedFile } from "@/lib/upload";
import dayjs from "dayjs";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaHora, zEnumSeguro, zCheckbox } from "@/lib/validation";

const TIPO_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};
const TIPOS_REUNION = ["asamblea", "consejo_directivo", "comision"] as const;
const PRIORIDAD_TAREA = ["alta", "media", "baja"] as const;

const crearReunionSchema = z.object({
  tipo: zEnumSeguro(TIPOS_REUNION, "comision"),
  comision_id: zIdOpcional,
  titulo: zTexto(200),
  fecha: zFechaHora,
  lugar: zTextoOpcional(200),
  orden_del_dia: zTextoOpcional(3000),
});

export async function crearReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearReunionSchema, formData);

  const id = await insert("reuniones", {
    tipo: datos.tipo,
    comision_id: datos.tipo === "comision" ? datos.comision_id : null,
    titulo: datos.titulo,
    fecha: datos.fecha,
    lugar: datos.lugar,
    orden_del_dia: datos.orden_del_dia,
    estado: "planificada",
    creado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "reuniones", entidad_id: id, valor_nuevo: { titulo: datos.titulo, fecha: datos.fecha, tipo: datos.tipo } });
  revalidatePath("/reuniones");
}

export async function cancelarReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("reuniones", id, { estado: "cancelada" });
  await audit({ usuario_id: user.id, accion: "cancelar", entidad: "reuniones", entidad_id: id });
  revalidatePath("/reuniones");
  revalidatePath(`/reuniones/${id}`);
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

  const asistencias = await all<any>(
    `SELECT ra.presente, ra.justificacion, n.nombre as nucleo_nombre
     FROM reunion_asistencias ra JOIN nucleos_familiares n ON n.id = ra.nucleo_id
     WHERE ra.reunion_id = ?
     ORDER BY n.nombre ASC`,
    [reunion_id]
  );
  const presentes = asistencias.filter((a: any) => a.presente).length;

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
        { tipo: "texto" as const, encabezado: "Resumen y resoluciones", parrafos: resumen.split("\n").filter(Boolean) },
        {
          tipo: "tabla" as const,
          encabezado: `Asistencia (${presentes}/${asistencias.length})`,
          columnas: ["Núcleo familiar", "Presente", "Justificación"],
          filas: asistencias.map((a: any) => [a.nucleo_nombre, a.presente ? "Sí" : "No", a.justificacion || ""]),
        },
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
