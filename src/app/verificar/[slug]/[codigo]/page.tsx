import { rootGet, get } from "@/lib/db";
import { setOrgContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificar recibo | COOVA", robots: { index: false, follow: false } };

/**
 * Fase 1C — verificación pública de un recibo (el QR impreso apunta acá).
 * No pide sesión y no muestra datos personales: sólo si el recibo existe, si
 * está vigente o anulado, su número, fecha y monto. El código es aleatorio
 * (10 caracteres), así que no se puede adivinar uno ajeno.
 */
export default async function VerificarReciboPage({ params }: { params: Promise<{ slug: string; codigo: string }> }) {
  const { slug, codigo } = await params;
  const codigoLimpio = String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  const org = /^[a-z0-9-]{1,60}$/i.test(slug)
    ? await rootGet<{ id: number; nombre: string }>(`SELECT id, nombre FROM organizations WHERE slug = $1 AND activo = 1`, [slug]).catch(() => undefined)
    : undefined;
  let recibo: { numero: number; fecha: string; monto: number; anulado_en: string | null } | undefined;
  if (org && codigoLimpio.length >= 8) {
    setOrgContext(org.id);
    recibo = await get<{ numero: number; fecha: string; monto: number; anulado_en: string | null }>(
      `SELECT numero, fecha, monto, anulado_en FROM recibos WHERE codigo_verificacion = ?`,
      [codigoLimpio]
    ).catch(() => undefined);
  }
  const [y, m, d] = (recibo?.fecha ?? "").slice(0, 10).split("-");

  return (
    <main className="min-h-full flex items-center justify-center px-4 py-10 bg-[var(--color-page-bg)]">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
        <p className="text-sm text-ink-muted">Verificación de recibo</p>
        {org && <p className="text-lg font-bold text-ink mt-1">{org.nombre}</p>}
        {!recibo ? (
          <>
            <p className="mt-6 text-2xl font-bold text-[var(--color-rojo)]">No encontramos este recibo</p>
            <p className="mt-2 text-[15px] text-ink">Revisá que el código esté bien escrito. Si tenés dudas, consultá con la tesorería de la cooperativa.</p>
          </>
        ) : recibo.anulado_en ? (
          <>
            <p className="mt-6 text-2xl font-bold text-[var(--color-rojo)]">Recibo N° {recibo.numero} ANULADO</p>
            <p className="mt-2 text-[15px] text-ink">Este recibo fue anulado y ya no es válido.</p>
          </>
        ) : (
          <>
            <p className="mt-6 text-2xl font-bold text-[var(--color-verde)]">Recibo N° {recibo.numero} válido</p>
            <p className="mt-3 text-3xl font-bold text-ink">$ {Number(recibo.monto).toLocaleString("es-UY", { maximumFractionDigits: 2 })}</p>
            <p className="mt-1 text-[15px] text-ink">Fecha: {d}/{m}/{y}</p>
          </>
        )}
        <p className="mt-6 text-xs text-ink-muted">COOVA — sistema de gestión de cooperativas de vivienda</p>
      </div>
    </main>
  );
}
