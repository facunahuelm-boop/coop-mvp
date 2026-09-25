"use server";

import { getCurrentUser } from "@/lib/auth";
import { all, insert } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { canRead, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { resumenFinanciero } from "@/lib/logic";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { saveGeneratedFile } from "@/lib/upload";
import dayjs from "dayjs";
import "dayjs/locale/es";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { CATEGORIA_COMPRA_LABEL, ESTADO_PROVEEDOR_LABEL, type TipoReporteHub } from "@/lib/constants";
import { estadoSolicitudLabel as estadoSolicitudCompraLabel } from "@/components/compras/PurchaseStatus";
import { estadoSolicitudLabel as estadoSolicitudComisionLabel, estadoEfectivo } from "@/components/solicitudes/SolicitudStatus";
import { resultadoDecisionLabel } from "@/components/decisiones/DecisionStatus";

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

export async function generarReporteObraFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarReporteObraAction(formData));
}

export async function generarReporteFinanzasAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) throw new Error("No tenés permiso para generar el reporte financiero.");

  // Se reutiliza resumenFinanciero() (lib/logic.ts) en vez de recalcular
  // ingresos/egresos/saldo con SQL propio acá — es la misma función que ya
  // usan el Dashboard, /finanzas y /api/reportes/finanzas. Tener el cálculo
  // en un solo lugar es justamente lo que evita que este PDF alguna vez
  // muestre un número distinto al resto del sistema (sección 14 del pedido:
  // "no permitir que un dashboard muestre un saldo diferente al módulo
  // financiero").
  const [fin, movimientos] = await Promise.all([
    resumenFinanciero(),
    all<any>(`SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m LEFT JOIN users u ON u.id = m.registrado_por_id ORDER BY fecha DESC LIMIT 100`),
  ]);

  const money = (n: number) => `$${Math.round(n || 0).toLocaleString("es-UY")}`;
  const titulo = `Reporte Financiero — ${dayjs().format("MMMM YYYY")}`;

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [
        `Ingresos totales: ${money(fin.ingresos)} · Egresos totales: ${money(fin.egresos)}`,
        `Saldo: ${money(fin.saldo)} · Comprometido: ${money(fin.comprometido)} · Disponible prudencial: ${money(fin.disponiblePrudencial)}`,
      ],
    },
    {
      tipo: "tabla",
      encabezado: `Movimientos (últimos ${movimientos.length})`,
      columnas: ["Fecha", "Tipo", "Categoría", "Descripción", "Monto"],
      // Sub-fase 4.4: un movimiento anulado (ver anularMovimientoAction) ya
      // no cuenta en fin.ingresos/egresos/saldo de arriba, pero sigue
      // listado acá para trazabilidad — marcado, para que el PDF no lo
      // muestre como si fuera un movimiento real vigente.
      filas: movimientos.slice(0, 50).map((m: any) => [dayjs(m.fecha).format("DD/MM/YYYY"), (m.tipo === "ingreso" ? "Ingreso" : "Egreso") + (m.estado === "anulado" ? " (anulado)" : ""), m.categoria || "—", m.descripcion || "—", money(m.monto)]),
    },
  ];

  await generarYGuardarReporte(user, "finanzas", titulo, secciones);
  revalidatePath("/reportes");
}

export async function generarReporteFinanzasFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarReporteFinanzasAction(formData));
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

export async function generarReporteTrabajoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarReporteTrabajoAction(formData));
}

// ---------------------------------------------------------------------
// Fase 6, Sub-fase 6.2 ("Reportes", sección 31): 3 tipos nuevos, mismo
// patrón exacto que obra/finanzas/trabajo de arriba — reutilizan las mismas
// queries que ya usan las pantallas de Compras/Socios/Solicitudes/Decisiones
// (ver auditoría previa), no inventan ninguna consulta nueva salvo los
// agregados de resumen. Los 3 nuevos módulos (compras/socios/comisiones)
// eran, junto con auditoría/documentos/seguridad/reclamos, los 7 de los 10
// módulos del sistema que el hub no cubría todavía (ver CHANGELOG).
// ---------------------------------------------------------------------

export async function generarReporteComprasAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) throw new Error("No tenés permiso para generar el reporte de compras.");

  const [gastos, solicitudes, proveedores] = await Promise.all([
    all<any>(
      `SELECT g.fecha, g.descripcion, g.categoria, g.importe, g.estado, c.nombre as comision, p.nombre as proveedor
       FROM gastos_comision g
       JOIN comisiones c ON c.id = g.comision_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       ORDER BY g.fecha DESC, g.creado_en DESC LIMIT 50`
    ),
    all<any>(
      `SELECT sc.material, sc.categoria, sc.prioridad, sc.estado, sc.creado_en, u.nombre as solicitante_nombre
       FROM solicitudes_compra sc
       LEFT JOIN users u ON u.id = sc.solicitante_id
       ORDER BY CASE sc.prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC
       LIMIT 50`
    ),
    all<any>(
      `SELECT pv.nombre, pv.rubro, pv.estado,
        COUNT(DISTINCT dc.id) as compras_realizadas,
        COALESCE(SUM(dc.monto), 0) as total_comprado
       FROM proveedores pv
       LEFT JOIN presupuestos_proveedor pp ON pp.proveedor_id = pv.id
       LEFT JOIN decisiones_compra dc ON dc.presupuesto_id = pp.id
       GROUP BY pv.id
       ORDER BY pv.nombre ASC`
    ),
  ]);

  const money = (n: number) => `$${Math.round(n || 0).toLocaleString("es-UY")}`;
  const totalGastado = gastos.reduce((sum: number, g: any) => sum + (g.estado !== "anulado" ? Number(g.importe || 0) : 0), 0);
  const solicitudesAbiertas = solicitudes.filter((s: any) => !["entregada", "rechazada"].includes(s.estado)).length;
  const titulo = `Reporte de Compras — ${dayjs().format("MMMM YYYY")}`;

  const ESTADO_GASTO_LABEL: Record<string, string> = { pendiente: "Pendiente", pagado: "Pagado", anulado: "Anulado" };

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [
        `Gastado (últimos ${gastos.length} registros, sin contar anulados): ${money(totalGastado)} · Solicitudes de compra abiertas: ${solicitudesAbiertas} de ${solicitudes.length} · Proveedores registrados: ${proveedores.length}`,
      ],
    },
    {
      tipo: "tabla",
      encabezado: "Gastos por comisión",
      columnas: ["Fecha", "Comisión", "Proveedor", "Categoría", "Importe", "Estado"],
      filas: gastos.map((g: any) => [
        dayjs(g.fecha).format("DD/MM/YYYY"),
        g.comision || "—",
        g.proveedor || "—",
        CATEGORIA_COMPRA_LABEL[g.categoria] ?? g.categoria,
        money(g.importe),
        ESTADO_GASTO_LABEL[g.estado] ?? g.estado,
      ]),
    },
    {
      tipo: "tabla",
      encabezado: "Solicitudes de compra",
      columnas: ["Material", "Categoría", "Prioridad", "Estado", "Solicitante", "Fecha"],
      filas: solicitudes.map((s: any) => [
        s.material || "—",
        CATEGORIA_COMPRA_LABEL[s.categoria] ?? s.categoria,
        s.prioridad,
        estadoSolicitudCompraLabel(s.estado),
        s.solicitante_nombre || "—",
        dayjs(s.creado_en).format("DD/MM/YYYY"),
      ]),
    },
    {
      tipo: "tabla",
      encabezado: "Proveedores",
      columnas: ["Nombre", "Rubro", "Estado", "Compras realizadas", "Total comprado"],
      filas: proveedores.map((p: any) => [
        p.nombre,
        p.rubro || "—",
        ESTADO_PROVEEDOR_LABEL[p.estado as keyof typeof ESTADO_PROVEEDOR_LABEL] ?? p.estado,
        p.compras_realizadas,
        money(p.total_comprado),
      ]),
    },
  ];

  await generarYGuardarReporte(user, "compras", titulo, secciones);
  revalidatePath("/reportes");
}

export async function generarReporteComprasFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarReporteComprasAction(formData));
}

export async function generarReporteSociosAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "socios")) throw new Error("No tenés permiso para generar el reporte de padrón de socios.");

  // Mismo fallback que /socios (migración 0019, socio_integrantes) para no
  // romper en un ambiente donde esa migración todavía no corrió.
  const socios = await all<any>(
    `SELECT s.nombre, s.email, s.telefono, s.estado, v.numero as vivienda_numero,
      (SELECT COUNT(*) FROM socio_integrantes si WHERE si.socio_id = s.id AND si.estado = 'activo') as cantidad_integrantes
     FROM socios s
     LEFT JOIN viviendas v ON v.id = s.vivienda_id
     ORDER BY s.nombre ASC`
  ).catch(async () =>
    (
      await all<any>(
        `SELECT s.nombre, s.email, s.telefono, s.estado, v.numero as vivienda_numero
         FROM socios s
         LEFT JOIN viviendas v ON v.id = s.vivienda_id
         ORDER BY s.nombre ASC`
      )
    ).map((s) => ({ ...s, cantidad_integrantes: 0 }))
  );
  const [viviendas, listaEspera] = await Promise.all([
    all<any>(`SELECT numero, estado FROM viviendas ORDER BY numero ASC`),
    all<any>(`SELECT orden, nombre, estado FROM lista_espera ORDER BY orden ASC`),
  ]);

  const activos = socios.filter((s: any) => s.estado === "activo").length;
  const enEspera = listaEspera.filter((a: any) => a.estado === "en_espera" || a.estado === "convocado").length;
  const titulo = `Reporte de Padrón de Socios — ${dayjs().format("MMMM YYYY")}`;

  const ESTADO_SOCIO_LABEL: Record<string, string> = { activo: "Activo", inactivo: "Inactivo", baja: "Baja" };
  const ESTADO_VIVIENDA_LABEL: Record<string, string> = { en_obra: "En obra", terminada: "Terminada", ocupada: "Ocupada" };
  const ESTADO_ASPIRANTE_LABEL: Record<string, string> = { en_espera: "En espera", convocado: "Convocado/a", incorporado: "Incorporado/a", retirado: "Retirado/a" };

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [`Socios: ${socios.length} totales · ${activos} activos · Viviendas: ${viviendas.length} · Aspirantes en lista de espera activa: ${enEspera}`],
    },
    {
      tipo: "tabla",
      encabezado: "Padrón de socios",
      columnas: ["Nombre", "Vivienda", "Integrantes", "Contacto", "Estado"],
      filas: socios.map((s: any) => [s.nombre, s.vivienda_numero || "Sin asignar", s.cantidad_integrantes, s.email || s.telefono || "—", ESTADO_SOCIO_LABEL[s.estado] ?? s.estado]),
    },
    {
      tipo: "tabla",
      encabezado: "Viviendas",
      columnas: ["Número", "Estado"],
      filas: viviendas.map((v: any) => [v.numero, ESTADO_VIVIENDA_LABEL[v.estado] ?? v.estado]),
    },
    {
      tipo: "tabla",
      encabezado: "Lista de espera de aspirantes",
      columnas: ["Orden", "Nombre", "Estado"],
      filas: listaEspera.map((a: any) => [a.orden, a.nombre, ESTADO_ASPIRANTE_LABEL[a.estado] ?? a.estado]),
    },
  ];

  await generarYGuardarReporte(user, "socios", titulo, secciones);
  revalidatePath("/reportes");
}

export async function generarReporteSociosFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarReporteSociosAction(formData));
}

export async function generarReporteComisionesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) throw new Error("No tenés permiso para generar el reporte de solicitudes y decisiones.");

  // Envueltas en catch (mismo criterio que sus pantallas de origen): ambas
  // tablas vienen de la migración 0029 (Fase de Comisiones) y podrían no
  // existir en un ambiente muy viejo.
  const [solicitudes, decisiones] = await Promise.all([
    all<any>(
      `SELECT s.numero, s.titulo, s.prioridad, s.estado, s.fecha_limite, s.creado_en, co.nombre as origen_nombre, cd.nombre as destino_nombre
       FROM solicitudes_comision s
       JOIN comisiones co ON co.id = s.comision_origen_id
       JOIN comisiones cd ON cd.id = s.comision_destino_id
       ORDER BY s.creado_en DESC LIMIT 50`
    ).catch(() => []),
    all<any>(
      `SELECT d.numero, d.tema, d.resultado, d.fecha, c.nombre as comision_nombre
       FROM decisiones_comision d
       JOIN comisiones c ON c.id = d.comision_id
       ORDER BY d.fecha DESC LIMIT 50`
    ).catch(() => []),
  ]);

  const porEstadoSolicitud: Record<string, number> = {};
  for (const s of solicitudes) {
    const e = estadoEfectivo(s.estado, s.fecha_limite);
    porEstadoSolicitud[e] = (porEstadoSolicitud[e] || 0) + 1;
  }
  const aprobadas = decisiones.filter((d: any) => d.resultado === "aprobada").length;
  const rechazadas = decisiones.filter((d: any) => d.resultado === "rechazada").length;
  const pendientes = decisiones.filter((d: any) => d.resultado === "pendiente").length;
  const titulo = `Reporte de Solicitudes y Decisiones — ${dayjs().format("MMMM YYYY")}`;

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      encabezado: "Resumen",
      parrafos: [
        `Solicitudes (últimas ${solicitudes.length}): ${
          Object.entries(porEstadoSolicitud)
            .map(([e, n]) => `${estadoSolicitudComisionLabel(e)}: ${n}`)
            .join(" · ") || "sin datos"
        }`,
        `Decisiones (últimas ${decisiones.length}): ${aprobadas} aprobadas · ${rechazadas} rechazadas · ${pendientes} pendientes`,
      ],
    },
    {
      tipo: "tabla",
      encabezado: "Solicitudes entre comisiones",
      columnas: ["N°", "Título", "Origen -> Destino", "Prioridad", "Estado", "Fecha límite"],
      filas: solicitudes.map((s: any) => [
        s.numero || "—",
        s.titulo || "—",
        `${s.origen_nombre} -> ${s.destino_nombre}`,
        s.prioridad,
        estadoSolicitudComisionLabel(estadoEfectivo(s.estado, s.fecha_limite)),
        s.fecha_limite ? dayjs(s.fecha_limite).format("DD/MM/YYYY") : "—",
      ]),
    },
    {
      tipo: "tabla",
      encabezado: "Decisiones",
      columnas: ["N°", "Tema", "Comisión", "Resultado", "Fecha"],
      filas: decisiones.map((d: any) => [d.numero || "—", d.tema || "—", d.comision_nombre, resultadoDecisionLabel(d.resultado), dayjs(d.fecha).format("DD/MM/YYYY")]),
    },
  ];

  await generarYGuardarReporte(user, "comisiones", titulo, secciones);
  revalidatePath("/reportes");
}

export async function generarReporteComisionesFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarReporteComisionesAction(formData));
}

/** Genera el PDF de verdad (mismo motor que ya usan las actas de reuniones),
 * lo sube a Supabase Storage y guarda la URL real en reportes_generados. Si
 * algo de esto falla, se propaga el error tal cual — mostrarle a la persona
 * "reporte generado" cuando en realidad no hay ningún archivo es exactamente
 * el problema que esta corrección busca eliminar. */
async function generarYGuardarReporte(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  tipo: TipoReporteHub,
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
