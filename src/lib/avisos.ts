import { all } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";

/**
 * Fase 2F — Avisos oficiales (plan, 8.12): a quién le llega cada aviso y
 * cómo (COOVA, email, WhatsApp asistido).
 */

export type TipoDestinatarios = "todos" | "socios" | "comision" | "morosos" | "nucleo" | "rol";
export type Destinatario = { user_id: number | null; socio_id: number | null; nombre: string; telefono: string | null; email: string | null; quiere_email: boolean; quiere_whatsapp: boolean };

const FUERA = "('baja', 'egresado', 'excluido')";

type FilaSocio = { socio_id: number; nombre: string; s_tel: string | null; s_email: string | null; user_id: number | null; u_tel: string | null; u_email: string | null; aviso_email: number | null; aviso_whatsapp: number | null; activo: number | null };

async function sociosCon(where: string, params: unknown[] = []): Promise<Destinatario[]> {
  const filas = await all<FilaSocio>(
    `SELECT s.id AS socio_id, s.nombre, s.telefono AS s_tel, s.email AS s_email, u.id AS user_id, u.telefono AS u_tel, u.email AS u_email,
            u.aviso_email, u.aviso_whatsapp, u.activo
       FROM socios s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.estado NOT IN ${FUERA} ${where ? `AND ${where}` : ""}
      ORDER BY s.nombre`,
    params
  );
  return filas.map((f) => ({
    user_id: f.user_id && f.activo ? f.user_id : null,
    socio_id: f.socio_id,
    nombre: f.nombre,
    telefono: f.s_tel || f.u_tel || null,
    email: f.s_email || f.u_email || null,
    quiere_email: f.aviso_email !== 0,
    quiere_whatsapp: f.aviso_whatsapp !== 0,
  }));
}

async function usuariosCon(where: string, params: unknown[] = []): Promise<Destinatario[]> {
  const filas = await all<{ id: number; nombre: string; email: string | null; telefono: string | null; aviso_email: number; aviso_whatsapp: number; socio_id: number | null; s_tel: string | null }>(
    `SELECT u.id, u.nombre, u.email, u.telefono, u.aviso_email, u.aviso_whatsapp, s.id AS socio_id, s.telefono AS s_tel
       FROM users u
       LEFT JOIN LATERAL (SELECT id, telefono FROM socios WHERE user_id = u.id AND estado NOT IN ('baja', 'egresado', 'excluido') ORDER BY id LIMIT 1) s ON true
      WHERE u.activo = 1 ${where ? `AND ${where}` : ""} ORDER BY u.nombre`,
    params
  );
  return filas.map((f) => ({
    user_id: f.id,
    socio_id: f.socio_id,
    nombre: f.nombre,
    telefono: f.telefono || f.s_tel || null,
    email: f.email,
    quiere_email: f.aviso_email !== 0,
    quiere_whatsapp: f.aviso_whatsapp !== 0,
  }));
}

/** Resuelve la lista de personas de un aviso (sin repetir). */
export async function resolverDestinatarios(tipo: TipoDestinatarios, ref: string | null): Promise<Destinatario[]> {
  let lista: Destinatario[] = [];
  if (tipo === "todos") lista = [...(await usuariosCon("")), ...(await sociosCon("s.user_id IS NULL"))];
  else if (tipo === "socios") lista = await sociosCon("");
  else if (tipo === "nucleo") lista = await sociosCon("s.nucleo_id = ?", [Number(ref)]);
  else if (tipo === "rol") lista = await usuariosCon("u.rol = ?", [ref]);
  else if (tipo === "comision") lista = await usuariosCon("u.id IN (SELECT user_id FROM comision_miembros WHERE comision_id = ? AND activo = 1)", [Number(ref)]);
  else if (tipo === "morosos") {
    const movs = await cargarMovimientosCuenta();
    const porSocio = new Map<number, typeof movs>();
    for (const m of movs) porSocio.set(m.socio_id, [...(porSocio.get(m.socio_id) ?? []), m]);
    const ids = [...porSocio.entries()].filter(([, l]) => calcularCuotasSocio(l).cuotas.some((c) => c.estado === "vencida")).map(([id]) => id);
    lista = ids.length ? await sociosCon(`s.id = ANY(?::int[])`, [ids]) : [];
  }
  const vistos = new Set<string>();
  return lista.filter((d) => {
    const k = d.user_id ? `u${d.user_id}` : `s${d.socio_id}`;
    const k2 = d.socio_id ? `s${d.socio_id}` : k;
    if (vistos.has(k) || vistos.has(k2)) return false;
    vistos.add(k);
    vistos.add(k2);
    return true;
  });
}

/** Teléfono uruguayo → formato internacional para WhatsApp ("099 123 456" → "59899123456"). */
export function telefonoWhatsApp(tel: string | null | undefined): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("598")) return d.length >= 11 ? d : null;
  if (d.startsWith("09") && d.length === 9) return `598${d.slice(1)}`;
  if (d.startsWith("9") && d.length === 8) return `598${d}`;
  return null; // fijo o desconocido: no se puede por WhatsApp
}

export function linkWhatsApp(tel: string | null | undefined, texto: string): string | null {
  const n = telefonoWhatsApp(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : null;
}

export const TIPO_DESTINATARIOS_LABEL: Record<TipoDestinatarios, string> = {
  todos: "Todos (socios y usuarios)",
  socios: "Todos los socios",
  comision: "Una comisión",
  morosos: "Socios con cuotas atrasadas",
  nucleo: "Un núcleo",
  rol: "Un rol (ej. tesorería)",
};
