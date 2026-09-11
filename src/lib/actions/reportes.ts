"use server";

import { getCurrentUser } from "@/lib/auth";
import { all, insert } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { canRead, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { saveGeneratedFile } from "@/lib/upload";
import dayjs from "dayjs";
import "dayjs/locale/es";

dayjs.locale("es");

// AUDITORÍA INTEGRAL (hallazgo crítico, sección "Facturación y PDF"): esta
// pantalla mostraba botones "📄 PDF" y "📊 Excel" y, al terminar, un botón
// "Descargar" — pero ninguno de los tres generaba nunca un archivo real: se
// guardaba únicamente el JSON de los datos con archivo_url = null, y
// "Descargar" apuntaba a /api/descargar-reporte/[id], una ruta que nunca
// llegó a crearse (404 garantizado). El sistema afirmaba haber "generado un
// reporte" sin que existiera ningún documento detrás — exactamente el tipo
// de falso positivo que esta auditoría pide erradicar.
//
// Se corrige reutilizando generarPdfBuffer (lib/pdf.ts), el mismo motor de
// PDF ya probado y en uso real para las actas de reuniones — no se inventa
// un mecanismo nuevo. El archivo se sube a Supabase Storage con
// saveGeneratedFile (mismo bucket público de solo-lectura que ya usan actas
// y documentos) y la URL real queda guardada en archivo_url; la pantalla
// enlaza directo a esa URL en vez de a una ruta inexistente.
//
// Excel (xlsx) se deja fuera de esta corrección: no hay ninguna librería de
// generación de Excel instalada ni probada en el proyecto, y armar una desde
// cero no es seguro hacerlo apurado dentro de esta pasada — se documenta
// como dependencia pendiente (ver diagnóstico final) y el botón queda
// deshabilitado con una leyenda clara en vez de seguir prometiendo algo que
// no existe.

export async function generarReporteObraAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "obra")) throw new Error("No tenés permiso para generar el reporte de obra.");

  const [tareas, avances, problemas] = await Promise.all([
    all<any>(
      `SELECT t.*, u.nombre as responsable_nombre FROM tareas_obra t
       LEFT JOIN users u ON u.id = t.responsable_id
       ORDER BY t.fecha_inicio ASC`
    ),
    all<any>(
      `SELECT a.*, u.nombre as autor_nombre FROM avances_obra a
       LEFT JOIN users u ON u.id = a.autor_id
       ORDER BY a.fecha DESC LIMIT 20`
    ),
    all<any>(
      `SELECT p.*, u.nombre as autor_nombre FROM problemas_obra p
       LEFT JOIN users u ON u.id = p.autor_id
       WHERE p.estado = 'abierto'`
    ),
  ]);

  const titulo = `Reporte de Obra — ${dayjs().format("MMMM YYYY")}`;
  const completadas = tareas.filter((t: any) => t.estado === "completada").length;
  const enCurso = tareas.filter((t: any) => t.estado === "en_curso").length;
  const pendientes = tareas.filter((t: any) => t.estado === "pendiente").length;

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [
        `Tareas totales: ${tareas.length} · completadas: ${completadas} · en curso: ${enCurso} · pendientes: ${pendientes}`,
        `Problemas abiertos: ${problemas.length}`,
      ],
    },
    {
      tipo: "tabla",
      encabezado: "Tareas",
      columnas: ["Título", "Estado", "Responsable", "Fecha inicio"],
      filas: tareas.slice(0, 50).map((t: any) => [t.titulo || "—", t.estado, t.responsable_nombre || "—", t.fecha_inicio ? dayjs(t.fecha_inicio).format("DD/MM/YYYY") : "—"]),
    },
    {
      tipo: "tabla",
      encabezado: "Avances recientes",
      columnas: ["Fecha", "Autor", "Descripción"],
      filas: avances.map((a: any) => [dayjs(a.fecha).format("DD/MM/YYYY"), a.autor_nombre || "—", a.descripcion || "—"]),
    },
    {
      tipo: "tabla",
      encabezado: "Problemas abiertos",
      columnas: ["Fecha", "Autor", "Descripción"],
      filas: problemas.map((p: any) => [p.fecha ? dayjs(p.fecha).format("DD/MM/YYYY") : "—", p.autor_nombre || "—", p.descripcion || "—"]),
    },
  ];

  await generarYGuardarReporte(user, "obra", titulo, secciones);
  revalidatePath("/reportes");
}

export async function generarReporteFinanzasAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) throw new Error("No tenés permiso para generar el reporte financiero.");

  const [ingresos, egresos, compromisos, movimientos] = await Promise.all([
    all<any>(`SELECT SUM(monto) as total FROM movimientos_financieros WHERE tipo = 'ingreso'`),
    all<any>(`SELECT SUM(monto) as total FROM movimientos_financieros WHERE tipo = 'egreso'`),
    all<any>(`SELECT SUM(monto) as total_comprometido FROM compromisos_futuros`),
    all<any>(`SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m LEFT JOIN users u ON u.id = m.registrado_por_id ORDER BY fecha DESC LIMIT 100`),
  ]);

  const money = (n: number) => `$${Math.round(n || 0).toLocaleString("es-UY")}`;
  const saldoBancario = (ingresos[0]?.total || 0) - (egresos[0]?.total || 0);
  const disponible = saldoBancario - (compromisos[0]?.total_comprometido || 0);
  const titulo = `Reporte Financiero — ${dayjs().format("MMMM YYYY")}`;

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [
        `Ingresos totales: ${money(ingresos[0]?.total)} · Egresos totales: ${money(egresos[0]?.total)}`,
        `Saldo: ${money(saldoBancario)} · Comprometido: ${money(compromisos[0]?.total_comprometido)} · Disponible prudencial: ${money(disponible)}`,
      ],
    },
    {
      tipo: "tabla",
      encabezado: `Movimientos (últimos ${movimientos.length})`,
      columnas: ["Fecha", "Tipo", "Categoría", "Descripción", "Monto"],
      filas: movimientos.slice(0, 50).map((m: any) => [dayjs(m.fecha).format("DD/MM/YYYY"), m.tipo === "ingreso" ? "Ingreso" : "Egreso", m.categoria || "—", m.descripcion || "—", money(m.monto)]),
    },
  ];

  await generarYGuardarReporte(user, "finanzas", titulo, secciones);
  revalidatePath("/reportes");
}

export async function generarReporteTrabajoAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "trabajo")) throw new Error("No tenés permiso para generar el reporte de trabajo.");

  const [jornadas, asistencias] = await Promise.all([
    all<any>(`SELECT * FROM jornadas_trabajo ORDER BY fecha DESC LIMIT 12`),
    all<any>(
      `SELECT n.nombre, SUM(a.horas) as horas_totales, COUNT(*) as jornadas_asistidas
       FROM asistencias a
       JOIN nucleos_familiares n ON n.id = a.nucleo_id
       GROUP BY a.nucleo_id, n.nombre
       ORDER BY horas_totales DESC`
    ),
  ]);

  const horasTotales = asistencias.reduce((sum: number, n: any) => sum + Number(n.horas_totales || 0), 0);
  const titulo = `Reporte de Jornadas de Trabajo — ${dayjs().format("MMMM YYYY")}`;

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [`Jornadas registradas: ${jornadas.length} · Núcleos activos: ${asistencias.length} · Horas totales trabajadas: ${horasTotales}`],
    },
    {
      tipo: "tabla",
      encabezado: "Jornadas",
      columnas: ["Fecha", "Título", "Estado"],
      filas: jornadas.map((j: any) => [dayjs(j.fecha).format("DD/MM/YYYY"), j.titulo || "—", j.estado || "—"]),
    },
    {
      tipo: "tabla",
      encabezado: "Participación por núcleo",
      columnas: ["Núcleo", "Jornadas asistidas", "Horas totales"],
      filas: asistencias.map((a: any) => [a.nombre, a.jornadas_asistidas, a.horas_totales]),
    },
  ];

  await generarYGuardarReporte(user, "trabajo", titulo, secciones);
  revalidatePath("/reportes");
}

/** Genera el PDF de verdad (mismo motor que ya usan las actas de reuniones),
 * lo sube a Supabase Storage y guarda la URL real en reportes_generados. Si
 * algo de esto falla, se propaga el error tal cual — mostrarle a la persona
 * "reporte generado" cuando en realidad no hay ningún archivo es exactamente
 * el problema que esta corrección busca eliminar. */
async function generarYGuardarReporte(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  tipo: "obra" | "finanzas" | "trabajo",
  titulo: string,
  secciones: SeccionPdf[]
) {
  const pdfBuffer = await generarPdfBuffer({ titulo, organizacion: user.organizacion, secciones });
  const archivoUrl = await saveGeneratedFile(pdfBuffer, user.organization_id, "reportes", `reporte-${tipo}-${Date.now()}.pdf`);
  await insert("reportes_generados", {
    nombre_reporte: titulo,
    tipo,
    formato: "pdf",
    archivo_url: archivoUrl,
    creado_por_id: user.id,
  });
}
