"use server";

// Sub-fase 1.2 ("Libros Sociales digitales", 22/09): NO se crea ningún dato
// nuevo acá — Asamblea y Consejo Directivo ya generan sus actas al cerrar
// una reunión (cerrarReunionAction, reuniones.ts) y el Registro de Socios ya
// existe entero en la tabla `socios`. Lo único que hace este archivo es
// compilar lo que ya existe en el formato de "libro" que exige la
// normativa: numerado correlativamente (ver migrations/0031) y generado
// como PDF de solo lectura, reusando el mismo motor (generarPdfBuffer) y el
// mismo circuito de guardado/descarga que ya prueba /reportes.
//
// Guardrail no-negociable de esta fase (pedido original del usuario): esto
// es una AYUDA de formalización digital, no un reemplazo legal. Cada libro
// generado lleva un aviso explícito de que no sustituye al libro rubricado
// que exige la normativa vigente, salvo que la cooperativa cuente con la
// habilitación correspondiente para llevarlo en formato digital — nunca se
// omite ni se dejó "implícito" en el pie de página.

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { all, insert } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { canApprove } from "@/lib/roles";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { saveGeneratedFile } from "@/lib/upload";
import { parseForm, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import dayjs from "dayjs";
import "dayjs/locale/es";

dayjs.locale("es");

const AVISO_LEGAL =
  "Este documento es una compilación digital generada automáticamente por el sistema a partir de las actas y registros ya cargados. No sustituye al libro rubricado que exige la normativa vigente para cooperativas de vivienda, salvo que la cooperativa cuente con la habilitación correspondiente ante el organismo competente para llevarlo en formato digital. Verificá con tu asesoría legal/contable antes de darle valor probatorio formal.";

const ORGANO_LIBRO = ["asamblea", "consejo_directivo"] as const;
const ORGANO_LABEL: Record<(typeof ORGANO_LIBRO)[number], string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
};

/**
 * Genera el Libro de Actas de un organismo (Asamblea o Consejo Directivo):
 * todas sus actas, en orden de folio, en un solo PDF. Restringido a quien
 * puede "approve" en comisiones (consejo_directivo/admin) — formalizar el
 * libro oficial es un acto de gobierno, no una lectura cualquiera; ver el
 * mismo criterio ya usado para aprobar/cerrar en comisiones.
 */
export async function generarLibroActasAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canApprove(user.rol, "comisiones")) throw new Error("No tenés permiso para generar el libro oficial.");

  const { organo } = parseForm(z.object({ organo: zEnumSeguro(ORGANO_LIBRO) }), formData);

  const actas = await all<any>(
    `SELECT * FROM actas WHERE organo = ? ORDER BY numero_libro ASC NULLS LAST, fecha ASC, id ASC`,
    [organo]
  );

  const titulo = `Libro de Actas — ${ORGANO_LABEL[organo]}`;
  const secciones: SeccionPdf[] = [
    { tipo: "texto", encabezado: "Aviso legal", parrafos: [AVISO_LEGAL] },
    {
      tipo: "texto",
      encabezado: "Índice",
      parrafos: [
        actas.length === 0
          ? "Todavía no hay actas registradas para este organismo."
          : `${actas.length} acta(s) registrada(s), folios 1 a ${actas.length}.`,
      ],
    },
    ...actas.map((a: any) => ({
      tipo: "texto" as const,
      encabezado: `Acta N° ${a.numero_libro ?? "s/n"} — ${a.titulo} (${dayjs(a.fecha).format("DD/MM/YYYY")})`,
      parrafos: (a.resumen || "Sin resumen cargado.").split("\n").filter(Boolean),
    })),
  ];

  const pdfBuffer = await generarPdfBuffer({ titulo, organizacion: user.organizacion, secciones });
  const archivoUrl = await saveGeneratedFile(pdfBuffer, user.organization_id, "libros-sociales", `libro-actas-${organo}-${Date.now()}.pdf`);
  await insert("reportes_generados", {
    nombre_reporte: titulo,
    tipo: `libro_actas_${organo}`,
    formato: "pdf",
    archivo_url: archivoUrl,
    creado_por_id: user.id,
  });
  revalidatePath("/libros-sociales");
}

export async function generarLibroActasFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarLibroActasAction(formData));
}

/**
 * Genera el Registro de Socios: la ficha de cada socio (tabla `socios`, ya
 * existente) en formato de libro, numerado por orden de ingreso. A
 * diferencia de las actas, este número NO se persiste — se recalcula cada
 * vez a partir de fecha_ingreso, porque el registro de socios no se cierra
 * "reunión a reunión" como un acta: es una foto del padrón completo al
 * momento de generarlo, y no hay conflicto legal en que ese orden se
 * recalcule si se carga o corrige un ingreso antiguo.
 */
export async function generarRegistroSociosAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canApprove(user.rol, "comisiones")) throw new Error("No tenés permiso para generar el registro oficial.");

  const socios = await all<any>(
    `SELECT s.*, v.numero as vivienda_numero
     FROM socios s LEFT JOIN viviendas v ON v.id = s.vivienda_id
     ORDER BY s.fecha_ingreso ASC NULLS LAST, s.id ASC`
  );

  const titulo = "Registro de Socios";
  const secciones: SeccionPdf[] = [
    { tipo: "texto", encabezado: "Aviso legal", parrafos: [AVISO_LEGAL] },
    {
      tipo: "tabla",
      encabezado: `${socios.length} socio(s) registrado(s)`,
      columnas: ["N°", "Nombre", "Documento", "Vivienda", "Fecha de ingreso", "Estado"],
      filas: socios.map((s: any, i: number) => [
        i + 1,
        s.nombre,
        s.documento || "—",
        s.vivienda_numero || "—",
        s.fecha_ingreso ? dayjs(s.fecha_ingreso).format("DD/MM/YYYY") : "—",
        ESTADO_SOCIO_LABEL[s.estado as string] || s.estado,
      ]),
    },
  ];

  const pdfBuffer = await generarPdfBuffer({ titulo, organizacion: user.organizacion, secciones });
  const archivoUrl = await saveGeneratedFile(pdfBuffer, user.organization_id, "libros-sociales", `registro-socios-${Date.now()}.pdf`);
  await insert("reportes_generados", {
    nombre_reporte: titulo,
    tipo: "registro_socios",
    formato: "pdf",
    archivo_url: archivoUrl,
    creado_por_id: user.id,
  });
  revalidatePath("/libros-sociales");
}

export async function generarRegistroSociosFormAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarRegistroSociosAction());
}

const ESTADO_SOCIO_LABEL: Record<string, string> = { activo: "Activo", inactivo: "Inactivo", baja: "Baja" };
