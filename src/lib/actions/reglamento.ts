"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { all, insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseForm, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { requireAdminOConsejo } from "@/lib/actions/configuracion";
import { canEdit } from "@/lib/roles";
import { obtenerReglamento } from "@/lib/reglamento";
import { generarCuotasDelMes } from "@/lib/automatizaciones";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Fase 1C — "Reglamento de la cooperativa". Cada sección se guarda por
 * separado (formularios cortos), en configuracion_reglas, con auditoría.
 * Sólo admin y Consejo Directivo cambian el reglamento.
 */

const siNo = z.enum(["si", "no"], { message: "Elegí sí o no." });
const dia = (campo: string) =>
  z.coerce.number({ message: `Indicá el día de ${campo}.` }).int("Tiene que ser un número entero.").min(1, "Entre 1 y 28.").max(28, "Entre 1 y 28.");

const ESQUEMAS = {
  cuotas: z.object({
    cuotas_automaticas: siNo,
    cuotas_monto: z.coerce.number({ message: "Indicá el monto." }).min(0, "No puede ser negativo.").max(10_000_000, "Revisá el monto."),
    cuotas_concepto: z.string().trim().min(2, "Escribí cómo se llama la cuota.").max(60, "Máximo 60 caracteres."),
    cuotas_dia_generacion: dia("generación"),
    cuotas_dia_vencimiento: dia("vencimiento"),
  }),
  atrasos: z.object({
    cuotas_dias_gracia: z.coerce.number().int("Tiene que ser un número entero.").min(0, "Mínimo 0.").max(60, "Máximo 60 días."),
    recargo_tipo: z.enum(["ninguno", "porcentaje", "fijo"], { message: "Elegí el tipo de recargo." }),
    recargo_valor: z.coerce.number().min(0, "No puede ser negativo.").max(1_000_000, "Revisá el valor."),
  }),
  avisos: z.object({
    avisos_cuotas: siNo,
    recibos_por_email: siNo,
  }),
  horas: z.object({
    horas_justificadas: z.enum(["no_generan_deuda", "generan_deuda", "cuentan_como_hechas"], { message: "Elegí una opción." }),
    horas_a_favor: z.enum(["acumulan", "no_acumulan"], { message: "Elegí una opción." }),
  }),
  seguridad: z.object({
    seguridad_exigir_2fa: siNo,
  }),
  ayuda: z.object({
    ayuda_telefono: z.string().trim().max(40, "Máximo 40 caracteres."),
    ayuda_horario: z.string().trim().max(80, "Máximo 80 caracteres."),
  }),
} as const;

type Seccion = keyof typeof ESQUEMAS;

export async function guardarReglamentoAction(formData: FormData) {
  const user = await requireAdminOConsejo();
  const seccion = String(formData.get("seccion") || "") as Seccion;
  const esquema = ESQUEMAS[seccion];
  if (!esquema) throw new Error("Sección del reglamento desconocida.");
  const datos = parseForm(esquema as z.ZodTypeAny, formData) as Record<string, string | number>;

  if (seccion === "cuotas") {
    if (Number(datos.cuotas_dia_vencimiento) < Number(datos.cuotas_dia_generacion)) {
      throw new ValidationError("cuotas_dia_vencimiento", "El vencimiento tiene que ser el mismo día de la generación o después.");
    }
    if (datos.cuotas_automaticas === "si" && !(Number(datos.cuotas_monto) > 0)) {
      const conCuotaPropia = await all<{ n: string }>(`SELECT COUNT(*) AS n FROM nucleos_familiares WHERE cuota_social > 0`).catch(() => [{ n: "0" }]);
      if (Number(conCuotaPropia[0]?.n || 0) === 0) {
        throw new ValidationError("cuotas_monto", "Para generar cuotas solas hace falta un monto (o que cada núcleo tenga su cuota cargada).");
      }
    }
  }
  if (seccion === "atrasos" && datos.recargo_tipo === "porcentaje" && Number(datos.recargo_valor) > 100) {
    throw new ValidationError("recargo_valor", "Un porcentaje no puede pasar de 100.");
  }

  const anterior = await obtenerReglamento();
  for (const [clave, v] of Object.entries(datos)) {
    const valor = String(v);
    const existe = (await all<{ id: number }>(`SELECT id FROM configuracion_reglas WHERE clave = ?`, [clave]))[0];
    if (existe) await update("configuracion_reglas", existe.id, { valor, actualizado_por_id: user.id, actualizado_en: new Date().toISOString() });
    else await insert("configuracion_reglas", { organization_id: user.organization_id, clave, valor, actualizado_por_id: user.id });
  }
  await audit({
    usuario_id: user.id,
    accion: "guardar_reglamento",
    entidad: "configuracion_reglas",
    entidad_id: user.organization_id,
    valor_anterior: { seccion, ...(seccion === "cuotas" || seccion === "atrasos" ? anterior.cuotas : seccion === "horas" ? anterior.horas : seccion === "ayuda" ? anterior.ayuda : seccion === "seguridad" ? anterior.seguridad : { ...anterior.recibos, avisos: anterior.cuotas.avisos }) },
    valor_nuevo: { seccion, ...datos },
  });
  revalidatePath("/reglamento");
  revalidatePath("/", "layout");
}

export async function guardarReglamentoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarReglamentoAction(formData));
}

/** Botón "Generar ahora las cuotas de este mes" (usa el reglamento; no duplica). */
export async function generarCuotasAhoraAction(): Promise<string> {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No tenés permiso para generar cuotas.");
  const reglamento = await obtenerReglamento();
  const mes = hoyEnUruguay().slice(0, 7);
  const r = await generarCuotasDelMes(mes, reglamento, user.id);
  revalidatePath("/finanzas");
  revalidatePath("/socios");
  revalidatePath("/reglamento");
  if (r.generadas === 0) {
    return r.sinMonto === r.total
      ? "No se generó ninguna cuota: falta cargar el monto de la cuota en el reglamento (o en cada núcleo)."
      : "Ya estaban generadas las cuotas de este mes para todos los socios activos.";
  }
  return `Listo: se generaron ${r.generadas} cuota${r.generadas === 1 ? "" : "s"} (${r.concepto}).`;
}

export async function generarCuotasAhoraFormAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await generarCuotasAhoraAction();
  });
  return r.ok ? { ...r, aviso } : r;
}
