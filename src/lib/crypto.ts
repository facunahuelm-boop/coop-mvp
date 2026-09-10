import crypto from "node:crypto";

/**
 * Cifrado simétrico (AES-256-GCM) para datos sensibles que se guardan en la
 * base de datos — hoy: la contraseña SMTP que cada cooperativa carga en
 * Configuración → Notificaciones por email (ver actions/configuracion.ts,
 * guardarConfigEmailAction). Antes se guardaba tal cual, en texto plano, en
 * la tabla config_email — cualquiera con acceso de lectura a esa tabla (una
 * fuga de la base, un backup mal guardado, etc.) tenía la contraseña del
 * servidor de correo de la cooperativa directamente legible.
 *
 * No usamos una variable de entorno nueva para la clave de cifrado: se
 * deriva de AUTH_SECRET con scrypt (con una "sal" fija propia de este uso,
 * para que la misma clave raíz no genere el mismo material que otro uso
 * futuro le diera a AUTH_SECRET). AUTH_SECRET ya es obligatorio en
 * producción (ver lib/auth.ts), así que esto queda activo sin pedirle a
 * nadie un paso de configuración extra en Vercel.
 *
 * Si en algún momento se quisiera una clave de cifrado independiente de la
 * de sesión (recomendable a mediano plazo, ver auditoría de seguridad), se
 * puede agregar CONFIG_ENCRYPTION_KEY como variable de entorno separada y
 * usarla acá en vez de derivarla de AUTH_SECRET — el formato del valor
 * cifrado (con el prefijo de versión "v1:") ya está pensado para poder
 * migrar de clave sin romper lo ya guardado.
 */
const ALGORITMO = "aes-256-gcm";
const SAL = "coop-mvp-config-cifrado-v1";

function claveDerivada(): Buffer {
  const secreto = process.env.AUTH_SECRET || "dev-secret-cambiar-en-produccion-0000000000";
  return crypto.scryptSync(secreto, SAL, 32);
}

/**
 * Cifra un texto plano. El resultado es un string seguro para guardar en
 * cualquier columna TEXT existente (iv + tag de autenticación + contenido
 * cifrado, todo codificado en base64, con un prefijo de versión).
 */
export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, claveDerivada(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${cifrado.toString("base64")}`;
}

/**
 * Descifra un valor generado por cifrar(). Si el valor no tiene el formato
 * esperado (por ejemplo, una contraseña SMTP cargada antes de este cambio,
 * todavía en texto plano) lo devuelve tal cual en vez de fallar — así no se
 * rompe una configuración ya guardada en producción; la próxima vez que se
 * guarde desde el formulario, queda cifrada.
 */
export function descifrar(valor: string | null | undefined): string {
  if (!valor) return "";
  const partes = valor.split(":");
  if (partes.length !== 4 || partes[0] !== "v1") return valor;
  try {
    const [, ivB64, tagB64, dataB64] = partes;
    const decipher = crypto.createDecipheriv(ALGORITMO, claveDerivada(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const texto = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return texto.toString("utf8");
  } catch {
    // Clave distinta a la que cifró el valor, o dato corrupto: mejor
    // devolver vacío (el envío de email fallará de forma controlada) que
    // tirar abajo la página de Configuración o el envío de alertas.
    return "";
  }
}
