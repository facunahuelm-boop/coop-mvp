"use server";

import { getCurrentUser } from "@/lib/auth";
import { all, insert, update } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const ETAPAS = ["pre_obra", "obra", "habitada"] as const;

/**
 * Cambia la etapa de la propia cooperativa (pre_obra | obra | habitada).
 * Usa siempre user.organization_id de la sesión, nunca un id que venga del
 * formulario: la tabla "organizations" no tiene Row-Level Security (es la
 * raíz de todas las cooperativas), así que update() sobre ella no filtra
 * sola — filtrar a mano acá es lo que evita que una cooperativa pudiera
 * tocar la fila de otra.
 */
export async function actualizarEtapaAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !["admin", "consejo_directivo"].includes(user.rol)) {
    redirect("/login");
  }
  const etapa = String(formData.get("etapa") || "");
  if (!ETAPAS.includes(etapa as (typeof ETAPAS)[number])) {
    throw new Error("Etapa inválida");
  }
  await update("organizations", user.organization_id, { etapa });
  revalidatePath("/configuracion");
  revalidatePath("/dashboard");
}

export async function guardarConfigEmailAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !["admin", "consejo_directivo"].includes(user.rol)) {
    redirect("/login");
  }

  const campos = [
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_password",
    "email_remitente",
    "email_alertas_criticas",
  ];

  for (const campo of campos) {
    const valor = formData.get(campo) as string;
    const existe = (
      await all<any>(`SELECT id FROM config_email WHERE clave = ?`, [campo])
    )[0];

    if (existe) {
      await update("config_email", existe.id, {
        valor,
        actualizado_en: new Date().toISOString(),
      });
    } else {
      await insert("config_email", {
        clave: campo,
        valor,
      });
    }
  }

  revalidatePath("/configuracion");
}

export async function actualizarAlertasEmailAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !["admin", "consejo_directivo"].includes(user.rol)) {
    redirect("/login");
  }

  const tiposAlerta = [
    "tarea_atrasada",
    "documento_vencido",
    "dinero_bajo",
    "problema_critico",
  ];

  for (const tipo of tiposAlerta) {
    const habilitada = formData.get(tipo) ? 1 : 0;
    const existe = (
      await all<any>(`SELECT id FROM alertas_email WHERE tipo_alerta = ?`, [tipo])
    )[0];

    if (existe) {
      await update("alertas_email", existe.id, {
        habilitada,
      });
    } else {
      await insert("alertas_email", {
        tipo_alerta: tipo,
        rol: "admin",
        habilitada,
      });
    }
  }

  revalidatePath("/configuracion");
}
