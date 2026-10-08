import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, Badge, EmptyState } from "@/components/ui";
import { ImprimirBoton, RevisarFichadaBoton } from "@/components/obra/FicharBotones";
import { codigoQrDelDia } from "@/lib/qrObra";
import { comisionTrabajoDe } from "@/lib/fichadasPermisos";
import { hoyEnUruguay, textoDia } from "@/lib/horasObra";

/**
 * Fase 3A — el QR del día para la obra (se muestra en el celular del
 * coordinador o se imprime cada mañana) y las fichadas de hoy.
 */
type Fila = { id: number; nucleo: string; persona: string; tipo: string; hora: string; asignacion_id: number | null; asistencia_id: number | null; revisada_en: string | null };

export default async function QrObraPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const comisionId = await comisionTrabajoDe(user);
  if (!comisionId) redirect("/dashboard");
  const hoy = hoyEnUruguay();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const link = `${proto}://${host}/fichar/${codigoQrDelDia(user.organization_id, hoy)}`;
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 480 });
  const filas = await all<Fila>(
    `SELECT f.id, n.nombre AS nucleo, u.nombre AS persona, f.tipo, f.hora, f.asignacion_id, f.asistencia_id, f.revisada_en
       FROM fichadas_obra f JOIN nucleos_familiares n ON n.id = f.nucleo_id JOIN users u ON u.id = f.user_id
      WHERE f.fecha = ? ORDER BY f.id`,
    [hoy]
  ).catch(() => [] as Fila[]);
  const sinTurno = filas.filter((f) => f.tipo === "salida" && !f.asignacion_id && !f.revisada_en);

  return (
    <div className="max-w-3xl">
      <div className="print:hidden">
        <PageHeader title="QR de la obra" subtitle="Los socios lo escanean con el celular al llegar y al irse. Cambia solo cada día." action={<ImprimirBoton />} />
      </div>
      <Card className="mb-6 text-center">
        <p className="text-lg font-bold text-ink first-letter:uppercase">Asistencia — {textoDia(hoy)}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- QR generado en el servidor como data URL */}
        <img src={qr} alt="QR de asistencia de hoy" className="mx-auto my-4 h-72 w-72" />
        <p className="text-[15px] text-ink">Escaneá con la cámara del celular y tocá «Llegué» o «Me voy».</p>
        <p className="mt-1 break-all text-xs text-ink-faint print:hidden">{link}</p>
      </Card>

      <div className="print:hidden">
        {sinTurno.length > 0 && (
          <>
            <SectionTitle>Vinieron sin turno (para confirmar)</SectionTitle>
            <Card className="mb-6">
              <ul className="divide-y divide-border">
                {sinTurno.map((f) => {
                  const llegada = filas.find((x) => x.tipo === "llegada" && x.nucleo === f.nucleo && x.id < f.id);
                  return (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
                      <span>
                        <b>{f.nucleo}</b> · {f.persona} · {llegada?.hora ?? "?"} a {f.hora}
                      </span>
                      <span className="flex items-center gap-3">
                        <Link href={`/comisiones/${comisionId}`} className="text-sm font-semibold underline">
                          Registrar las horas
                        </Link>
                        <RevisarFichadaBoton id={f.id} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </>
        )}
        <SectionTitle>Fichadas de hoy</SectionTitle>
        <Card>
          {filas.length === 0 ? (
            <EmptyState>Todavía nadie marcó con el QR hoy.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {filas.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                  <span>
                    <b>{f.hora}</b> · {f.tipo === "llegada" ? "Llegó" : "Se fue"} · {f.nucleo} <span className="text-ink-muted">({f.persona})</span>
                  </span>
                  {f.tipo === "salida" && (f.asistencia_id ? <Badge color="verde">Anotado en la libreta</Badge> : f.asignacion_id ? <Badge color="gray">Ya estaba marcado</Badge> : <Badge color="amarillo">Sin turno</Badge>)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
