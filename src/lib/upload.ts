import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Archivos subidos por los usuarios (fotos de Obra/Seguridad, documentos,
// logo de la cooperativa) — Fase de aislamiento de archivos (siguiente a la
// personalización de marca): antes se guardaban en disco local
// (public/uploads), lo que tiene dos problemas serios en este hosting:
//
//  1. Vercel corre el código en funciones serverless con filesystem efímero
//     — un archivo grabado en un pedido puede no estar presente en el
//     próximo (cada invocación puede caer en una instancia distinta, y el
//     disco se descarta al reciclarse), así que los archivos "subidos" en
//     producción podían desaparecer sin aviso.
//  2. No había ningún aislamiento por cooperativa: todo quedaba en la misma
//     carpeta pública, sin relación con multi-tenant.
//
// Supabase Storage (el mismo proyecto que ya usa la base de datos) resuelve
// los dos: el archivo persiste fuera de la instancia serverless, y cada
// cooperativa tiene su propia carpeta dentro del bucket (organization_id/).
//
// La subida se hace siempre con la Service Role Key (variable de entorno
// SUPABASE_SERVICE_ROLE_KEY, ya cargada por la integración Vercel↔Supabase)
// desde una Server Action — nunca desde el navegador — así que no depende de
// políticas de Row-Level Security sobre storage.objects para poder escribir.
// El bucket es público en lectura (igual que "public/uploads" antes: hoy la
// UI simplemente hace <img src="...">/<a href="..."> con la URL guardada en
// la base, sin pasar por una sesión autenticada de Supabase), así que la URL
// pública sigue funcionando en cualquier página sin cambios adicionales.

const BUCKET = "uploads";

declare global {
  // eslint-disable-next-line no-var
  var __coopSupabaseAdmin: ReturnType<typeof createClient> | undefined;
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Faltan las variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY para subir archivos a Supabase Storage."
    );
  }
  if (!global.__coopSupabaseAdmin) {
    global.__coopSupabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return global.__coopSupabaseAdmin;
}

/**
 * Guarda un archivo subido por el usuario en Supabase Storage y devuelve su
 * URL pública, o null si no se adjuntó ningún archivo.
 *
 * @param file Archivo del FormData (puede ser null si el campo quedó vacío).
 * @param organizationId Cooperativa dueña del archivo — separa los archivos
 *   de cada cooperativa en su propia carpeta dentro del bucket.
 * @param carpeta Subcarpeta dentro de la cooperativa (ej: "obra", "seguridad",
 *   "documentos", "marca") — solo para mantener el bucket ordenado.
 */
export async function saveUploadedFile(
  file: File | null,
  organizationId: number,
  carpeta: string = "general"
): Promise<string | null> {
  if (!file || file.size === 0) return null;

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const nombre = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext ? `.${ext}` : ""}`;
  const carpetaSegura = carpeta.replace(/[^a-z0-9_-]/gi, "") || "general";
  const path = `${organizationId}/${carpetaSegura}/${nombre}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const supabase = getAdminClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) {
    throw new Error(`No se pudo subir el archivo a Supabase Storage: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Guarda un archivo generado por el propio sistema (hoy: PDFs de actas y
 * reportes armados con pdfkit, ver src/lib/pdf.ts) en Supabase Storage y
 * devuelve su URL pública. A diferencia de saveUploadedFile, acá el archivo
 * no viene de un <input type="file"> — ya es un Buffer en memoria.
 *
 * @param buffer Contenido del archivo ya generado (ej: el PDF completo).
 * @param organizationId Cooperativa dueña del archivo.
 * @param carpeta Subcarpeta dentro de la cooperativa (ej: "actas", "reportes").
 * @param nombreArchivo Nombre descriptivo para el archivo (sin necesidad de
 *   ser único: se le antepone un timestamp para evitar colisiones).
 * @param contentType Tipo MIME del archivo (por defecto, PDF).
 */
export async function saveGeneratedFile(
  buffer: Buffer,
  organizationId: number,
  carpeta: string,
  nombreArchivo: string,
  contentType: string = "application/pdf"
): Promise<string> {
  const carpetaSegura = carpeta.replace(/[^a-z0-9_-]/gi, "") || "general";
  const nombreSeguro = nombreArchivo.replace(/[^a-z0-9_.-]/gi, "_") || "documento";
  const path = `${organizationId}/${carpetaSegura}/${Date.now()}-${nombreSeguro}`;

  const supabase = getAdminClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) {
    throw new Error(`No se pudo subir el archivo generado a Supabase Storage: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
