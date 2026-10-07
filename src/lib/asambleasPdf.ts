import { all, get } from "@/lib/db";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { RESULTADO_LABEL, MAYORIA_LABEL } from "@/lib/asambleas";

/** Fase 2D — PDFs de la asamblea (sección 13): convocatoria, padrón habilitado y acta. */

type Org = { nombre: string; color_primario?: string | null };

async function datos(reunionId: number) {
  const r = await get<{ titulo: string; fecha: string; lugar: string | null; tipo_asamblea: string | null; orden_del_dia: string | null; fecha_convocatoria: string | null }>(
    `SELECT titulo, fecha, lugar, tipo_asamblea, orden_del_dia, fecha_convocatoria FROM reuniones WHERE id = ? AND tipo = 'asamblea'`,
    [reunionId]
  );
  if (!r) throw new Error("Esa asamblea no existe.");
  const agenda = await all<{ titulo: string }>(`SELECT titulo FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden`, [reunionId]).catch(() => []);
  const dia = r.fecha.slice(0, 10).split("-").reverse().join("/");
  const hora = r.fecha.length > 10 ? r.fecha.slice(11, 16) : "";
  return { r, agenda, dia, hora };
}

export async function generarPdfConvocatoria(reunionId: number, org: Org): Promise<Buffer> {
  const { r, agenda, dia, hora } = await datos(reunionId);
  const tipo = r.tipo_asamblea === "extraordinaria" ? "Extraordinaria" : "Ordinaria";
  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      parrafos: [
        `Se convoca a todos los socios de ${org.nombre} a la Asamblea General ${tipo} que se realizará el ${dia}${hora ? ` a las ${hora}` : ""}${r.lugar ? `, en ${r.lugar}` : ""}.`,
        "De no haber quórum a la hora indicada, la asamblea sesionará en segunda convocatoria según lo que establece el estatuto.",
      ],
    },
    { tipo: "texto", encabezado: "Orden del día", parrafos: agenda.length ? agenda.map((a, i) => `${i + 1}. ${a.titulo}`) : [r.orden_del_dia || "—"] },
    { tipo: "texto", parrafos: [`Fecha de la convocatoria: ${(r.fecha_convocatoria || new Date().toISOString()).slice(0, 10).split("-").reverse().join("/")}.`, "", "Por el Consejo Directivo: ______________________________"] },
  ];
  return generarPdfBuffer({ titulo: `Convocatoria — Asamblea ${tipo}`, subtitulo: r.titulo, organizacion: org, secciones });
}

export async function generarPdfPadron(reunionId: number, org: Org): Promise<Buffer> {
  const { r, dia } = await datos(reunionId);
  const padron = await all<{ nombre: string; habilitado: number; causa: string | null; presente: number }>(
    `SELECT nombre, habilitado, causa, presente FROM asamblea_padron WHERE reunion_id = ? ORDER BY nombre`,
    [reunionId]
  );
  const habil = padron.filter((p) => p.habilitado);
  return generarPdfBuffer({
    titulo: "Padrón de la asamblea",
    subtitulo: `${r.titulo} · ${dia}`,
    organizacion: org,
    secciones: [
      { tipo: "texto", parrafos: [`Habilitados para votar: ${habil.length} de ${padron.length}.`] },
      { tipo: "tabla", encabezado: "Habilitados", columnas: ["N°", "Nombre", "Asistió", "Firma"], filas: habil.map((p, i) => [i + 1, p.nombre, p.presente ? "Sí" : "", ""]) },
      ...(padron.length > habil.length
        ? [{ tipo: "tabla" as const, encabezado: "No habilitados (y por qué)", columnas: ["Nombre", "Causa"], filas: padron.filter((p) => !p.habilitado).map((p) => [p.nombre, p.causa ?? ""]) }]
        : []),
    ],
  });
}

export async function generarPdfActa(reunionId: number, org: Org): Promise<Buffer> {
  const { r, dia } = await datos(reunionId);
  const acta = await get<{ texto: string | null; resumen: string | null; estado: string; numero_libro: number | null }>(
    `SELECT texto, resumen, estado, numero_libro FROM actas WHERE reunion_id = ? ORDER BY id DESC LIMIT 1`,
    [reunionId]
  );
  if (!acta) throw new Error("La asamblea todavía no tiene acta.");
  const [presentes, votaciones] = await Promise.all([
    all<{ nombre: string; representado: string | null }>(
      `SELECT p.nombre, rep.nombre AS representado FROM asamblea_padron p LEFT JOIN asamblea_padron rep ON rep.id = p.representado_por_id
        WHERE p.reunion_id = ? AND (p.presente = 1 OR p.representado_por_id IS NOT NULL) ORDER BY p.nombre`,
      [reunionId]
    ),
    all<{ titulo: string; mayoria: string; a_favor: number; en_contra: number; abstenciones: number; resultado: string | null }>(
      `SELECT titulo, mayoria, a_favor, en_contra, abstenciones, resultado FROM asamblea_votaciones WHERE reunion_id = ? AND estado = 'cerrada' ORDER BY id`,
      [reunionId]
    ),
  ]);
  const secciones: SeccionPdf[] = [
    ...(acta.estado !== "aprobada" ? [{ tipo: "texto" as const, parrafos: ["BORRADOR — todavía no fue aprobada."] }] : []),
    { tipo: "texto", parrafos: (acta.texto || acta.resumen || "").split("\n") },
    ...(votaciones.length
      ? [{ tipo: "tabla" as const, encabezado: "Votaciones", columnas: ["Punto", "Mayoría", "A favor", "En contra", "Abst.", "Resultado"], filas: votaciones.map((v) => [v.titulo, MAYORIA_LABEL[v.mayoria]?.split(" (")[0] ?? v.mayoria, v.a_favor, v.en_contra, v.abstenciones, RESULTADO_LABEL[v.resultado ?? ""] ?? ""]) }]
      : []),
    ...(presentes.length ? [{ tipo: "tabla" as const, encabezado: `Asistencia (${presentes.length})`, columnas: ["Socio", "Representado por"], filas: presentes.map((p) => [p.nombre, p.representado ?? ""]) }] : []),
    { tipo: "texto", encabezado: "Firmas", parrafos: ["Presidente: ______________________________", "Secretario: ______________________________"] },
  ];
  return generarPdfBuffer({
    titulo: `Acta${acta.numero_libro ? ` N° ${acta.numero_libro}` : ""} — Asamblea`,
    subtitulo: `${r.titulo} · ${dia}`,
    organizacion: org,
    secciones,
  });
}
