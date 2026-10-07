import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, SectionTitle, StatTile } from "@/components/ui";
import { AnularAvisoForm, BotonWhatsApp, MarcarLeido } from "@/components/avisos/AvisosFormularios";
import { puedeEnviarAvisos } from "@/lib/actions/avisos";
import { linkWhatsApp, TIPO_DESTINATARIOS_LABEL, type TipoDestinatarios } from "@/lib/avisos";
import { urlBaseApp } from "@/lib/email";

/**
 * Fase 2F — un aviso oficial. Quien lo recibió lo lee (y queda la
 * constancia de lectura); quien lo mandó ve la constancia completa y la lista
 * de WhatsApp asistido (la app no manda WhatsApp sola: abre el chat con el
 * texto listo y registra que se abrió).
 */
type Aviso = {
  id: number;
  titulo: string;
  cuerpo: string;
  destinatarios_tipo: TipoDestinatarios;
  urgente: number;
  por_email: number;
  enviado_en: string;
  anulado_en: string | null;
  motivo_anulacion: string | null;
  enviado_por: string | null;
};
type Dest = {
  id: number;
  user_id: number | null;
  nombre: string;
  telefono: string | null;
  email: string | null;
  en_app: number;
  email_enviado_en: string | null;
  whatsapp_abierto_en: string | null;
  leido_en: string | null;
  quiere_whatsapp: number | null;
};

function fechaHora(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" });
}

export default async function AvisoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const aviso = await get<Aviso>(
    `SELECT a.*, u.nombre AS enviado_por FROM avisos a LEFT JOIN users u ON u.id = a.enviado_por_id WHERE a.id = ?`,
    [id]
  ).catch(() => undefined);
  if (!aviso) notFound();
  const emisor = await puedeEnviarAvisos(user.rol);
  const mio = await get<{ id: number }>(`SELECT id FROM aviso_destinatarios WHERE aviso_id = ? AND user_id = ?`, [id, user.id]);
  if (!emisor && !mio) notFound();

  const destinatarios = emisor
    ? await all<Dest>(
        `SELECT d.*, u.aviso_whatsapp AS quiere_whatsapp FROM aviso_destinatarios d LEFT JOIN users u ON u.id = d.user_id WHERE d.aviso_id = ? ORDER BY d.nombre`,
        [id]
      )
    : [];
  const leidos = destinatarios.filter((d) => d.leido_en).length;
  const emails = destinatarios.filter((d) => d.email_enviado_en).length;
  const textoWhatsApp = `*${aviso.urgente ? "URGENTE: " : ""}${aviso.titulo}*\n\n${aviso.cuerpo}\n\n${urlBaseApp()}/avisos/${aviso.id}`;
  // WhatsApp asistido: primero quien no lo leyó en COOVA o no tiene usuario.
  const paraWhatsApp = destinatarios
    .filter((d) => d.quiere_whatsapp !== 0)
    .map((d) => ({ ...d, link: linkWhatsApp(d.telefono, textoWhatsApp) }))
    .sort((a, b) => Number(!!a.leido_en) - Number(!!b.leido_en));
  const sinCelular = paraWhatsApp.filter((d) => !d.link && !d.leido_en);

  return (
    <div className="max-w-4xl">
      {mio && <MarcarLeido avisoId={id} />}
      <Link href="/avisos" className="mb-3 inline-block text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
        ← Avisos
      </Link>
      <PageHeader title={aviso.titulo} subtitle={`${fechaHora(aviso.enviado_en)}${aviso.enviado_por ? ` · De ${aviso.enviado_por}` : ""}`} action={emisor && !aviso.anulado_en ? <AnularAvisoForm id={id} /> : undefined} />
      {aviso.anulado_en && (
        <Card className="mb-4 border-[var(--color-rojo)]">
          <p className="text-[15px] text-ink">
            <b>Este aviso fue anulado</b> el {fechaHora(aviso.anulado_en)}. Motivo: {aviso.motivo_anulacion}
          </p>
        </Card>
      )}
      <Card className="mb-6">
        {aviso.urgente ? <Badge color="rojo">Urgente</Badge> : null}
        <div className="mt-2 whitespace-pre-line text-[16px] leading-relaxed text-ink">{aviso.cuerpo}</div>
      </Card>

      {emisor && (
        <>
          <SectionTitle>Constancia</SectionTitle>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="A quién" value={TIPO_DESTINATARIOS_LABEL[aviso.destinatarios_tipo] ?? aviso.destinatarios_tipo} />
            <StatTile label="Personas" value={String(destinatarios.length)} />
            <StatTile label="Lo leyeron" value={`${leidos} de ${destinatarios.length}`} color={leidos === destinatarios.length ? "verde" : "amarillo"} />
            <StatTile label="Por email" value={aviso.por_email ? String(emails) : "No se pidió"} />
          </div>
          <Card className="mb-6">
            <ul className="divide-y divide-border">
              {destinatarios.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
                  <span className="min-w-0">
                    <b className="text-ink">{d.nombre}</b>
                    <span className="block text-sm text-ink-muted">
                      {d.en_app ? "Le llegó en COOVA" : "No tiene usuario en COOVA"}
                      {d.email_enviado_en ? ` · Email enviado ${fechaHora(d.email_enviado_en)}` : ""}
                      {d.whatsapp_abierto_en ? ` · WhatsApp abierto ${fechaHora(d.whatsapp_abierto_en)}` : ""}
                    </span>
                  </span>
                  {d.leido_en ? <Badge color="verde">Leído {fechaHora(d.leido_en)}</Badge> : <Badge color="gray">Sin leer</Badge>}
                </li>
              ))}
            </ul>
          </Card>

          {!aviso.anulado_en && (
            <>
              <SectionTitle>Mandarlo por WhatsApp</SectionTitle>
              <Card>
                <p className="mb-3 text-sm text-ink-muted">
                  COOVA no manda WhatsApp sola: cada botón abre el chat de esa persona con el texto listo, y vos lo enviás. Queda anotado que lo abriste. Primero aparecen quienes todavía no lo leyeron.
                </p>
                <ul className="divide-y divide-border">
                  {paraWhatsApp
                    .filter((d) => d.link)
                    .map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
                        <span>
                          {d.nombre} <span className="text-sm text-ink-muted">{d.telefono}</span> {d.leido_en ? <Badge color="verde">Ya lo leyó</Badge> : null}
                        </span>
                        <BotonWhatsApp destinatarioId={d.id} link={d.link!} abierto={!!d.whatsapp_abierto_en} />
                      </li>
                    ))}
                </ul>
                {sinCelular.length > 0 && (
                  <p className="mt-3 text-sm text-ink-muted">
                    Sin celular cargado (avisarles de otra forma): {sinCelular.map((d) => d.nombre).join(", ")}.
                  </p>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
