import crypto from "node:crypto";

/**
 * Fase 1E — códigos de verificación en dos pasos (TOTP, RFC 6238): los
 * mismos 6 números que muestran Google Authenticator, Microsoft
 * Authenticator, Authy, etc. Cambian cada 30 segundos. Sin dependencias.
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let out = "";
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}

export function deBase32(s: string): Buffer {
  const limpio = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let valor = 0;
  const out: number[] = [];
  for (const c of limpio) {
    valor = (valor << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generarSecretoTotp(): string {
  return base32(crypto.randomBytes(20));
}

export function codigoTotp(secreto: string, momento = Date.now(), paso = 30): string {
  const contador = Math.floor(momento / 1000 / paso);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const hmac = crypto.createHmac("sha1", deBase32(secreto)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const n = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Acepta el código actual y el de 30 s antes/después (relojes desfasados). */
export function verificarTotp(secreto: string, codigo: string, momento = Date.now()): boolean {
  const c = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((v) => {
    const esperado = codigoTotp(secreto, momento + v * 30_000);
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c));
  });
}

export function uriTotp(secreto: string, cuenta: string, emisor: string): string {
  const e = encodeURIComponent(emisor);
  return `otpauth://totp/${e}:${encodeURIComponent(cuenta)}?secret=${secreto}&issuer=${e}&algorithm=SHA1&digits=6&period=30`;
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** 8 códigos de respaldo de un solo uso ("ABCD-1234"), y sus hashes para guardar. */
export function generarCodigosRespaldo(): { codigos: string[]; hashes: string[] } {
  const codigos = Array.from({ length: 8 }, () => {
    const b = base32(crypto.randomBytes(5)).slice(0, 8);
    return `${b.slice(0, 4)}-${b.slice(4, 8)}`;
  });
  return { codigos, hashes: codigos.map((c) => hash(c.replace("-", ""))) };
}

/** Si el código es uno de respaldo válido, devuelve la lista sin ese código (se consume). */
export function usarCodigoRespaldo(codigo: string, hashesGuardados: string[]): string[] | null {
  const h = hash(codigo.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  if (!hashesGuardados.includes(h)) return null;
  return hashesGuardados.filter((x) => x !== h);
}

/** Roles que manejan dinero o datos sensibles: se les pide la verificación en dos pasos. */
export const ROLES_CON_2FA = ["admin", "tesoreria", "consejo_directivo", "fiscal"] as const;
