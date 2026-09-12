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
 * @param opciones Límite de tamaño y tipos de archivo permitidos (ver
 *   TIPOS_IMAGEN / TIPOS_DOCUMENTO abajo) — antes no había ninguno: cualquier
 *   usuario con permiso para subir una foto podía en realidad subir un
 *   archivo de cualquier tamaño y tipo, sin límite. El chequeo de tipo se
 *   basa en el content-type que manda el navegador, que en teoría se puede
 *   falsear — no reemplaza un antivirus, pero sí frena el caso normal (subir
 *   por error, o a propósito, algo que no es lo que el formulario pide) y,
 *   junto con el límite de tamaño, evita que el bucket se llene con archivos
 *   gigantes.
 */
const TIPOS_IMAGEN = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"];
const TIPOS_DOCUMENTO = [
  ...TIPOS_IMAGEN,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
export { TIPOS_IMAGEN, TIPOS_DOCUMENTO };

type OpcionesUpload = { tiposPermitidos?: string[]; maxBytes?: number };
const MAX_BYTES_DEFAULT = 10 * 1024 * 1024; // 10 MB

export async function saveUploadedFile(
  file: File | null,
  organizationId: number,
  carpeta: string = "general",
  opciones: OpcionesUpload = {}
): Promise<string | null> {
  if (!file || file.size === 0) return null;

  const maxBytes = opciones.maxBytes ?? MAX_BYTES_DEFAULT;
  if (file.size > maxBytes) {
    throw new Error(`El archivo es demasiado grande (máximo ${Math.round(maxBytes / (1024 * 1024))} MB).`);
  }
  if (opciones.tiposPermitidos && opciones.tiposPermitidos.length > 0) {
    const tipo = file.type || "";
    const permitido = opciones.tiposPermitidos.includes(tipo);
    if (!permitido) {
      throw new Error("Tipo de archivo no permitido. Revisá el formato del archivo elegido.");
    }
  }

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
 * AUDITORÍA INTEGRAL (hallazgo de seguridad, testing E2E real, 12/09):
 * probando "Generar PDF" en Reportes se confirmó que el bucket es público en
 * lectura (ver el comentario al principio de este archivo) — cualquiera con
 * la URL exacta puede descargar el archivo, sin sesión ni pertenecer a la
 * cooperativa. Acá, a diferencia de saveUploadedFile (que ya usa un sufijo
 * aleatorio de 4 bytes), el nombre del archivo era predecible: solo
 * `Date.now()` + el nombre del reporte. organization_id es un entero chico y
 * secuencial (1, 2, 3...), y el timestamp de un reporte recién generado es
 * "ahora" con un margen de pocos segundos — en la práctica, adivinable.
 * Combinado, alguien sin sesión podría intentar reconstruir la URL de
 * reportes financieros o actas de OTRA cooperativa con relativamente pocos
 * intentos. Se agrega el mismo sufijo aleatorio que ya usa saveUploadedFile
 * para cerrar esto ahora mismo, sin esperar el cambio más grande y de mayor
 * alcance (bucket privado + URLs firmadas con vencimiento, respetando el rol
 * de quien pide el archivo) que corresponde evaluar aparte — ese cambio toca
 * cómo se guardan y muestran los links en varias pantallas a la vez
 * (Documentos, Seguridad, Reportes, Proveedores) y no es prudente meterlo de
 * apuro en esta pasada.
 *
 * @param buffer Contenido del archivo ya generado (ej: el PDF completo).
 * @param organizationId Cooperativa dueña del archivo.
 * @param carpeta Subcarpeta dentro de la cooperativa (ej: "actas", "reportes").
 * @param nombreArchivo Nombre descriptivo para el archivo (sin necesidad de
 *   ser único: se le antepone un timestamp + un sufijo aleatorio para evitar
 *   colisiones Y para que la URL no se pueda adivinar).
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
  const sufijoAleatorio = crypto.randomBytes(4).toString("hex");
  const path = `${organizationId}/${carpetaSegura}/${Date.now()}-${sufijoAleatorio}-${nombreSeguro}`;

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
