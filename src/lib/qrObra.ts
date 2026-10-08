import crypto from "node:crypto";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Fase 3A — el QR de la obra cambia solo cada día. No se guarda: el código
 * se calcula con una clave secreta, la cooperativa y la fecha, así que un QR
 * de ayer (o una foto que circule) no sirve para marcar hoy.
 */
const SECRETO = process.env.AUTH_SECRET || "dev-secret-cambiar-en-produccion-0000000000";

export function codigoQrDelDia(orgId: number, fecha: string = hoyEnUruguay()): string {
  return crypto.createHmac("sha256", SECRETO).update(`qr-obra:${orgId}:${fecha}`).digest("base64url").slice(0, 16);
}

/** ¿El código escaneado es el de hoy para esta cooperativa? */
export function codigoQrValido(orgId: number, codigo: string): boolean {
  const esperado = codigoQrDelDia(orgId);
  if (typeof codigo !== "string" || codigo.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(codigo), Buffer.from(esperado));
}

/** Hora actual en Montevideo, "HH:MM". */
export function horaEnUruguay(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "America/Montevideo", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Minutos de tolerancia para considerar "llegó tarde" o "se fue antes". */
export const TOLERANCIA_MIN = 10;
