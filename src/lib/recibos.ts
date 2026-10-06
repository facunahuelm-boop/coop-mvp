import { randomBytes } from "node:crypto";
import { get, all, run, insert, audit } from "@/lib/db";
import { enviarEmailAvisoSistema, urlBaseApp } from "@/lib/email";
import { obtenerReglamento } from "@/lib/reglamento";

/**
 * Fase 1C — recibos de pago (migración 0053). Cada pago de la cuenta
 * corriente tiene un recibo numerado (correlativo por cooperativa) con un
 * código de verificación que va impreso como QR. Nunca se borra: si el pago
 * se corrige o se anula, el recibo se anula con motivo y, si corresponde, se
 * emite uno nuevo que lo reemplaza.
 */

export type Recibo = {
  id: number;
  numero: number;
  movimiento_id: number;
  socio_id: number;
  monto: number;
  fecha: string;
  concepto: string | null;
  metodo_pago: string | null;
  codigo_verificacion: string;
  emitido_en: string;
  enviado_en: string | null;
  anulado_en: string | null;
  motivo_anulacion: string | null;
};

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I para que se lea bien

function codigoNuevo(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
}

export async function reciboVigenteDePago(movimientoId: number): Promise<Recibo | null> {
  const r = await get<Recibo>(`SELECT * FROM recibos WHERE movimiento_id = ? AND anulado_en IS NULL`, [movimientoId]).catch(() => undefined);
  return r ? { ...r, monto: Number(r.monto) } : null;
}

/** Recibos vigentes de un socio, por id de pago (para mostrar "Recibo N° 12" al lado de cada pago). */
export async function recibosDeSocio(socioId: number): Promise<Map<number, { id: number; numero: number }>> {
  const filas = await all<{ id: number; numero: number; movimiento_id: number }>(
    `SELECT id, numero, movimiento_id FROM recibos WHERE socio_id = ? AND anulado_en IS NULL`,
    [socioId]
  ).catch(() => []);
  return new Map(filas.map((f) => [f.movimiento_id, { id: f.id, numero: Number(f.numero) }]));
}

/**
 * Emite (o devuelve el ya emitido) recibo de un pago. Tolera que la
 * migración 0053 todavía no esté aplicada (devuelve null sin romper el pago).
 */
export async function emitirReciboDePago(movimientoId: number, usuarioId: number | null, reemplazaA?: number): Promise<Recibo | null> {
  const existente = await reciboVigenteDePago(movimientoId);
  if (existente) return existente;
  const pago = await get<{ id: number; socio_id: number; tipo: string; monto: number; fecha: string; concepto: string; metodo_pago: string | null; estado: string | null }>(
    `SELECT id, socio_id, tipo, monto, fecha, concepto, metodo_pago, estado FROM movimientos_cuenta_socio WHERE id = ?`,
    [movimientoId]
  );
  if (!pago || pago.tipo !== "pago" || pago.estado === "anulado") return null;

  for (let intento = 0; intento < 6; intento++) {
    try {
      const sig = await get<{ n: number }>(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM recibos`);
      const id = await insert("recibos", {
        numero: Number(sig?.n ?? 1),
        movimiento_id: pago.id,
        socio_id: pago.socio_id,
        monto: Number(pago.monto),
        fecha: pago.fecha,
        concepto: pago.concepto,
        metodo_pago: pago.metodo_pago,
        codigo_verificacion: codigoNuevo(),
        emitido_por_id: usuarioId,
      });
      if (reemplazaA) await run(`UPDATE recibos SET reemplazado_por_id = ? WHERE id = ?`, [id, reemplazaA]);
      const r = await get<Recibo>(`SELECT * FROM recibos WHERE id = ?`, [id]);
      await audit({
        usuario_id: usuarioId,
        accion: "emitir_recibo",
        entidad: "recibos",
        entidad_id: id,
        valor_nuevo: { numero: `Recibo N° ${r?.numero}`, monto: Number(pago.monto), concepto: pago.concepto },
      });
      return r ? { ...r, monto: Number(r.monto) } : null;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "42P01") return null; // migración 0053 pendiente
      if (code !== "23505") throw err; // otro pago tomó el mismo número: reintentar
    }
  }
  throw new Error("No se pudo numerar el recibo. Intentá de nuevo.");
}

export async function anularReciboDePago(movimientoId: number, motivo: string, usuarioId: number): Promise<Recibo | null> {
  const r = await reciboVigenteDePago(movimientoId);
  if (!r) return null;
  await run(`UPDATE recibos SET anulado_en = now()::text, anulado_por_id = ?, motivo_anulacion = ? WHERE id = ?`, [usuarioId, motivo, r.id]);
  await audit({
    usuario_id: usuarioId,
    accion: "anular_recibo",
    entidad: "recibos",
    entidad_id: r.id,
    valor_nuevo: { numero: `Recibo N° ${r.numero}`, motivo },
  });
  return r;
}

/** Envía el recibo por email al socio si el reglamento lo pide y hay dirección. No falla si no puede. */
export async function enviarReciboPorEmail(recibo: Recibo): Promise<boolean> {
  const reglamento = await obtenerReglamento();
  if (!reglamento.recibos.porEmail) return false;
  const socio = await get<{ nombre: string; email: string | null; user_email: string | null }>(
    `SELECT s.nombre, s.email, u.email AS user_email FROM socios s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [recibo.socio_id]
  );
  const destino = (socio?.email || socio?.user_email || "").trim();
  if (!socio || !destino) return false;
  const org = await get<{ slug: string; nombre: string }>(`SELECT o.slug, o.nombre FROM organizations o WHERE o.id = NULLIF(current_setting('app.current_org_id', true), '')::int`).catch(() => undefined);
  const monto = `$ ${Number(recibo.monto).toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;
  const res = await enviarEmailAvisoSistema(destino, socio.nombre.split(" ")[0] || socio.nombre, {
    asunto: `Recibimos tu pago de ${monto} — Recibo N° ${recibo.numero}`,
    titulo: org?.nombre ? `${org.nombre} — Recibo de pago` : "Recibo de pago",
    parrafos: [
      `Recibimos tu pago de ${monto} (${recibo.concepto || "pago de cuota"}).`,
      `Tu recibo es el N° ${recibo.numero}. Podés verlo e imprimirlo desde COOVA, en "Mi cuenta".`,
    ],
    boton: { texto: "Ver mi recibo", link: `${urlBaseApp()}/api/archivos/recibo/${recibo.id}` },
    pie: org?.slug ? `Código de verificación: ${recibo.codigo_verificacion}` : undefined,
  }).catch(() => ({ ok: false }));
  if (res.ok) await run(`UPDATE recibos SET enviado_en = now()::text, enviado_a = ? WHERE id = ?`, [destino, recibo.id]).catch(() => {});
  return res.ok;
}
