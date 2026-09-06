"use server";

import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { generarPdfBuffer } from "@/lib/pdf";
import { saveGeneratedFile } from "@/lib/upload";
import dayjs from "dayjs";

const TIPO_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};

export async function crearReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const tipo = String(formData.get("tipo") || "comision"); // asamblea | consejo_directivo | comision
  const comisionIdRaw = String(formData.get("comision_id") || "");
  const titulo = String(formData.get("titulo") || "").trim();
  const fecha = String(formData.get("fecha") || "");
  if (!titulo || !fecha) throw new Error("Faltan datos obligatorios (título y fecha)");

  const id = await insert("reuniones", {
    tipo,
    comision_id: tipo === "comision" && comisionIdRaw ? Number(comisionIdRaw) : null,
    titulo,
    fecha,
    lugar: String(formData.get("lugar") || "") || null,
    orden_del_dia: String(formData.get("orden_del_dia") || "") || null,
    estado: "planificada",
    creado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "reuniones", entidad_id: id, valor_nuevo: { titulo, fecha, tipo } });
  revalidatePath("/reuniones");
}

export async function cancelarReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
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
export async function registrarAsistenciaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const reunion_id = Number(formData.get("reunion_id"));
  const nucleo_id = Number(formData.get("nucleo_id"));
  const presente = formData.get("presente") === "on" ? 1 : 0;
  const justificacion = String(formData.get("justificacion") || "") || null;

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
 */
export async function cerrarReunionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const reunion_id = Number(formData.get("id"));
  const resumen = String(formData.get("resumen") || "").trim();
  if (!resumen) throw new Error("Falta el resumen del acta");

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

  await update("reuniones", reunion_id, { estado: "realizada", acta_id: actaId });
  await audit({ usuario_id: user.id, accion: "cerrar", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: { acta_id: actaId, documento_id: documentoId } });
  revalidatePath("/reuniones");
  revalidatePath(`/reuniones/${reunion_id}`);
  revalidatePath("/documentos");
}
