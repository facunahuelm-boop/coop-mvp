"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { all, insert, update, audit } from "@/lib/db";
import { saveUploadedFile, TIPOS_IMAGEN } from "@/lib/upload";
import { cifrar } from "@/lib/crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseForm, zTexto, zTextoOpcional, zEmailOpcional } from "@/lib/validation";

// AUDITORÍA INTEGRAL (cobertura de auditoría, sección "trazabilidad"): las
// cinco acciones de este archivo cambian configuración sensible de toda la
// cooperativa (etapa, módulos visibles, marca, SMTP, alertas por email) pero
// ninguna dejaba registro en la tabla "auditoria" — quedaban afuera del
// historial que el resto del sistema sí lleva para cambios de este calibre.
// Se agrega audit() en cada una; la contraseña SMTP nunca se guarda en texto
// plano en el registro (ni cifrada), solo si el campo fue tocado o no.

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
  await audit({ usuario_id: user.id, accion: "actualizar_etapa", entidad: "organizations", entidad_id: user.organization_id, valor_nuevo: { etapa } });
  revalidatePath("/configuracion");
  revalidatePath("/dashboard");
}

/**
 * Fase D (etapas + módulos): guarda el override manual de visibilidad para
 * los módulos que por defecto dependen de la etapa (obra, trabajo,
 * seguridad, reclamos) — ver moduloVisible() en components/Nav.tsx. "auto"
 * borra el override de ese módulo (vuelve a depender de la etapa); "mostrar"/
 * "ocultar" lo fuerzan. Nunca toca los datos de esos módulos: sólo cambia
 * qué aparece en el menú.
 */
const MODULOS_CON_OVERRIDE = ["obra", "trabajo", "seguridad", "reclamos"] as const;
const VALORES_OVERRIDE = ["auto", "mostrar", "ocultar"] as const;

export async function actualizarModulosAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !["admin", "consejo_directivo"].includes(user.rol)) {
    redirect("/login");
  }

  const overrides: Record<string, "mostrar" | "ocultar"> = {};
  for (const mod of MODULOS_CON_OVERRIDE) {
    const valor = String(formData.get(mod) || "auto");
    if (!VALORES_OVERRIDE.includes(valor as (typeof VALORES_OVERRIDE)[number])) {
      throw new Error("Valor de módulo inválido");
    }
    if (valor === "mostrar" || valor === "ocultar") overrides[mod] = valor;
  }

  await update("organizations", user.organization_id, { modulos_override: overrides });
  await audit({ usuario_id: user.id, accion: "actualizar_modulos", entidad: "organizations", entidad_id: user.organization_id, valor_nuevo: overrides });
  revalidatePath("/configuracion");
  revalidatePath("/", "layout");
}

/**
 * Personalización de marca de la cooperativa: nombre, logo y colores que se
 * muestran en el menú (Nav.tsx) y en la pantalla de login. El logo se guarda
 * hoy en disco local (ver src/lib/upload.ts, igual que las fotos de Obra o
 * Seguridad) — la migración a Supabase Storage queda para la fase siguiente
 * del plan (aislamiento de archivos por cooperativa).
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const brandingSchema = z.object({
  nombre: zTexto(200),
  color_primario: z.string().trim().regex(HEX_COLOR, "Tiene que ser un color válido.").default("#123240"),
  color_secundario: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || HEX_COLOR.test(v), "Tiene que ser un color válido."),
});

export async function actualizarBrandingAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !["admin", "consejo_directivo"].includes(user.rol)) {
    redirect("/login");
  }

  const { nombre, color_primario: colorPrimario, color_secundario: colorSecundario } = parseForm(brandingSchema, formData);

  const datos: Record<string, any> = {
    nombre,
    color_primario: colorPrimario,
    color_secundario: colorSecundario,
  };

  const logoUrl = await saveUploadedFile(formData.get("logo") as File | null, user.organization_id, "marca", {
    tiposPermitidos: TIPOS_IMAGEN,
    maxBytes: 4 * 1024 * 1024,
  });
  if (logoUrl) datos.logo_url = logoUrl;

  await update("organizations", user.organization_id, datos);
  await audit({
    usuario_id: user.id,
    accion: "actualizar_branding",
    entidad: "organizations",
    entidad_id: user.organization_id,
    valor_nuevo: { nombre, color_primario: colorPrimario, color_secundario: colorSecundario, logo_cambiado: !!logoUrl },
  });
  revalidatePath("/configuracion");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

const configEmailSchema = z.object({
  smtp_host: zTextoOpcional(200).transform((v) => v || ""),
  smtp_port: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || "587")
    .refine((v) => /^\d{1,5}$/.test(v) && Number(v) > 0 && Number(v) <= 65535, "Puerto inválido."),
  smtp_user: zTextoOpcional(200).transform((v) => v || ""),
  smtp_password: z.string().max(500).optional().transform((v) => v || ""),
  email_remitente: zTextoOpcional(200).transform((v) => v || ""),
  email_alertas_criticas: zEmailOpcional.transform((v) => v || ""),
});

export async function guardarConfigEmailAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !["admin", "consejo_directivo"].includes(user.rol)) {
    redirect("/login");
  }

  const datos = parseForm(configEmailSchema, formData);
  const camposActualizados: string[] = [];

  for (const [campo, valorPlano] of Object.entries(datos)) {
    // La contraseña SMTP nunca se vuelve a mostrar en el formulario (por
    // seguridad — ver configuracion/page.tsx), así que si el campo llega
    // vacío significa "no la cambié", no "borrala": de lo contrario, cada
    // vez que alguien guardara cualquier otro dato de esta pantalla (el
    // remitente, por ejemplo) se perdería la contraseña ya cargada.
    if (campo === "smtp_password" && !valorPlano) continue;

    const valor = campo === "smtp_password" ? cifrar(valorPlano) : valorPlano;
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
    camposActualizados.push(campo);
  }

  // Nunca se guarda el valor de smtp_password en el registro de auditoría
  // (ni en texto plano ni cifrado) — solo si ese campo fue tocado o no, igual
  // que ya hace el resto del sistema con cualquier dato sensible.
  await audit({
    usuario_id: user.id,
    accion: "guardar_config_email",
    entidad: "config_email",
    entidad_id: user.organization_id,
    valor_nuevo: { campos_actualizados: camposActualizados },
  });
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
  const estadoFinal: Record<string, number> = {};

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
    estadoFinal[tipo] = habilitada;
  }

  await audit({
    usuario_id: user.id,
    accion: "actualizar_alertas_email",
    entidad: "alertas_email",
    entidad_id: user.organization_id,
    valor_nuevo: estadoFinal,
  });
  revalidatePath("/configuracion");
}
