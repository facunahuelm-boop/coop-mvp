"use server";

// Sub-fase 1.5 ("Panel de Comisión Fiscal", última de la Fase 1, 22/09):
// el rol `fiscal` ya era de solo lectura en TODOS los módulos (ver
// roles.ts) — lo que le faltaba era un lugar propio para ejercer ese
// control, y un cierre formal de una revisión periódica. Este archivo es
// ese cierre: compila datos que YA existen (financieros, alertas, actas,
// documentos vencidos, auditoría) en un PDF, y deja un lugar para que la
// persona de la Comisión Fiscal escriba su propia conclusión — el sistema
// nunca redacta el dictamen en sí, solo junta los datos objetivos.
//
// Guardrail no-negociable: esto NO otorga ningún permiso nuevo. Generar el
// informe está restringido al rol `fiscal` (y `admin`, para soporte) — no a
// "quien puede aprobar en comisiones" ni ningún otro criterio — porque el
// dictamen fiscal es un acto propio de ese rol, distinto de todo lo demás
// que ya existe en el sistema.

import { z } from "zod";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, insert } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { saveGeneratedFile } from "@/lib/upload";
import { parseForm, zTexto } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { resumenFinanciero } from "@/lib/logic";
import dayjs from "dayjs";
import "dayjs/locale/es";

dayjs.locale("es");

const AVISO_LEGAL =
  "Este informe es una ayuda de compilación digital: junta en un solo documento datos que ya existen en el sistema (financieros, alertas, actas, documentos vencidos, auditoría) al momento de generarlo. No reemplaza el dictamen fiscal formal que exige la normativa vigente para cooperativas de vivienda, el cual debe ser redactado y firmado por quien ejerce ese rol conforme al estatuto de la cooperativa. Las observaciones y conclusiones de esta sección son las que escribió la persona que lo generó — el sistema no las redacta ni las sugiere.";

const informeSchema = z.object({ observaciones: zTexto(5000) });

function puedeGenerarInforme(rol: string) {
  return rol === "fiscal" || rol === "admin";
}

export async function generarInformeFiscalAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!puedeGenerarInforme(user.rol)) throw new Error("Generar el Informe de la Comisión Fiscal está reservado a ese rol.");

  const { observaciones } = parseForm(informeSchema, formData);
  const hoy = dayjs().format("DD/MM/YYYY");

  const [fin, alertasAbiertas, actas, documentosVencidos, auditoriaReciente] = await Promise.all([
    resumenFinanciero(),
    all<{ id: number; severidad: string; titulo: string; origen_modulo: string }>(
      `SELECT id, severidad, titulo, origen_modulo FROM alertas WHERE estado = 'abierta' ORDER BY severidad ASC, fecha DESC LIMIT 20`
    ),
    all<{ organo: string; titulo: string; fecha: string; numero_libro: number | null }>(
      `SELECT organo, titulo, fecha, numero_libro FROM actas WHERE organo IN ('asamblea','consejo_directivo') ORDER BY fecha DESC LIMIT 10`
    ).catch(() => all<{ organo: string; titulo: string; fecha: string; numero_libro: number | null }>(
      `SELECT organo, titulo, fecha, NULL as numero_libro FROM actas WHERE organo IN ('asamblea','consejo_directivo') ORDER BY fecha DESC LIMIT 10`
    )),
    all<{ titulo: string; fecha_vencimiento: string }>(
      `SELECT titulo, fecha_vencimiento FROM documentos WHERE fecha_vencimiento IS NOT NULL AND estado != 'archivado' AND fecha_vencimiento < ? ORDER BY fecha_vencimiento ASC LIMIT 20`,
      [dayjs().format("YYYY-MM-DD")]
    ).catch(() => []),
    all<{ fecha: string; accion: string; entidad: string; usuario_id: number }>(
      `SELECT fecha, accion, entidad, usuario_id FROM auditoria ORDER BY fecha DESC LIMIT 15`
    ),
  ]);

  const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

  const secciones: SeccionPdf[] = [
    { tipo: "texto", encabezado: "Aviso legal", parrafos: [AVISO_LEGAL] },
    {
      tipo: "texto",
      encabezado: "Resumen financiero",
      parrafos: [
        `Saldo actual: ${money(fin.saldo)}. Disponible prudencial (descontando compromisos asumidos): ${money(fin.disponiblePrudencial)}.`,
        `Ingresos del mes en curso: ${money(fin.ingresosMes)}. Egresos del mes en curso: ${money(fin.egresosMes)}.`,
      ],
    },
    {
      tipo: "tabla",
      encabezado: `Alertas abiertas (${alertasAbiertas.length})`,
      columnas: ["Severidad", "Módulo", "Título"],
      filas:
        alertasAbiertas.length > 0
          ? alertasAbiertas.map((a) => [a.severidad, a.origen_modulo, a.titulo])
          : [["—", "—", "Sin alertas abiertas al momento de generar este informe."]],
    },
    {
      tipo: "tabla",
      encabezado: `Actas recientes de Asamblea y Consejo Directivo (${actas.length})`,
      columnas: ["Organismo", "N° folio", "Título", "Fecha"],
      filas:
        actas.length > 0
          ? actas.map((a) => [a.organo === "asamblea" ? "Asamblea" : "Consejo Directivo", a.numero_libro ?? "s/n", a.titulo, dayjs(a.fecha).format("DD/MM/YYYY")])
          : [["—", "—", "Sin actas registradas.", "—"]],
    },
    {
      tipo: "tabla",
      encabezado: `Documentos vencidos (${documentosVencidos.length})`,
      columnas: ["Documento", "Venció el"],
      filas:
        documentosVencidos.length > 0
          ? documentosVencidos.map((d) => [d.titulo, dayjs(d.fecha_vencimiento).format("DD/MM/YYYY")])
          : [["—", "Sin documentos vencidos al momento de generar este informe."]],
    },
    {
      tipo: "tabla",
      encabezado: `Últimos registros de auditoría (${auditoriaReciente.length})`,
      columnas: ["Fecha", "Acción", "Entidad"],
      filas: auditoriaReciente.map((a) => [dayjs(a.fecha).format("DD/MM/YYYY HH:mm"), a.accion, a.entidad]),
    },
    { tipo: "texto", encabezado: "Observaciones y conclusiones de la Comisión Fiscal", parrafos: observaciones.split("\n").filter(Boolean) },
  ];

  const titulo = `Informe de la Comisión Fiscal — ${hoy}`;
  const pdfBuffer = await generarPdfBuffer({ titulo, organizacion: user.organizacion, secciones });
  const archivoUrl = await saveGeneratedFile(pdfBuffer, user.organization_id, "informes-fiscal", `informe-fiscal-${Date.now()}.pdf`);
  await insert("reportes_generados", {
    nombre_reporte: titulo,
    tipo: "informe_fiscal",
    formato: "pdf",
    archivo_url: archivoUrl,
    creado_por_id: user.id,
  });
  revalidatePath("/fiscal");
}

export async function generarInformeFiscalFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarInformeFiscalAction(formData));
}
