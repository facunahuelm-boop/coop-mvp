import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { PreferenciasForm, LinkCalendarioForm } from "@/components/avisos/AvisosFormularios";
import { CopiarTexto } from "@/components/CopiarTexto";

/**
 * Fase 2F — cómo quiere cada persona que le lleguen los avisos (email,
 * WhatsApp, resumen de los lunes) y su link personal del calendario.
 */
export default async function PreferenciasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const pref = await get<{ telefono: string | null; aviso_email: number; aviso_whatsapp: number; resumen_semanal: number; ics_token: string | null }>(
    `SELECT telefono, aviso_email, aviso_whatsapp, resumen_semanal, ics_token FROM users WHERE id = ?`,
    [user.id]
  ).catch(() => undefined);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const linkIcs = pref?.ics_token ? `${proto}://${host}/api/calendario/${pref.ics_token}.ics` : null;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Mis avisos y calendario" subtitle="Cómo querés enterarte de lo que pasa en la cooperativa." />
      {!pref ? (
        <Card>
          <p className="text-[15px] text-ink-muted">Esta parte todavía no está lista en tu cooperativa. Volvé a intentar más tarde.</p>
        </Card>
      ) : (
        <>
          <SectionTitle>Avisos</SectionTitle>
          <Card className="mb-6">
            <p className="mb-4 text-sm text-ink-muted">Los avisos oficiales siempre te llegan acá, en COOVA. Además podés elegir:</p>
            <PreferenciasForm telefono={pref.telefono} avisoEmail={pref.aviso_email !== 0} avisoWhatsapp={pref.aviso_whatsapp !== 0} resumenSemanal={pref.resumen_semanal !== 0} />
          </Card>

          <div id="calendario">
            <SectionTitle>El calendario en tu celular</SectionTitle>
          </div>
          <Card>
            {linkIcs ? (
              <>
                <p className="mb-2 text-[15px] text-ink">Copiá este link y agregalo en tu calendario:</p>
                <CopiarTexto texto={linkIcs} />
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                  <li>Google Calendar (en la computadora): «Otros calendarios» → «+» → «Desde URL» → pegar el link.</li>
                  <li>iPhone: Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → «Añadir calendario suscrito».</li>
                  <li>El calendario se actualiza solo cada algunas horas.</li>
                </ul>
                <div className="mt-4">
                  <LinkCalendarioForm tiene />
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-[15px] text-ink">Podés ver las reuniones, asambleas, jornadas y trámites en el calendario de tu celular.</p>
                <LinkCalendarioForm tiene={false} />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
