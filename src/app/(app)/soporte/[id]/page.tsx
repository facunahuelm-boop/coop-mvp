import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { get, all } from "@/lib/db";
import { Card, PageHeader, Badge, Label } from "@/components/ui";
import { CATEGORIA_TICKET_LABEL, ESTADO_TICKET_LABEL } from "@/lib/constants";
import { ResponderTicketForm, CambiarEstadoTicketButton } from "@/components/soporte/SoporteFormularios";
import dayjs from "dayjs";

/**
 * Fase 5, Sub-fase 5.4 ("Soporte"): ficha de un ticket — mismo criterio de
 * "página propia con el hilo completo" que solicitudes/[id]/page.tsx.
 *
 * Mismo hallazgo de seguridad que ya corrigió la Fase 12 en
 * solicitudes/[id] y decisiones/[id] (fuga de datos entre comisiones por id
 * directo): acá el `WHERE t.id = ?` de `get()` ya está protegido por RLS
 * (organization_id se fija por la sesión de quien llama), así que nunca
 * puede traer un ticket de OTRA cooperativa — pero dentro de la MISMA
 * cooperativa, un socio cualquiera podría entrar por URL directa al ticket
 * de otro socio si no se chequea también quién lo creó. Por eso, igual que
 * `requierePropioOAdmin` en actions/soporte.ts, acá se aplica el mismo
 * criterio para decidir si se puede VER la ficha, no solo actuar sobre ella.
 */
type TicketDetalle = {
  id: number;
  creado_por_id: number;
  asunto: string;
  categoria: string;
  estado: string;
  creado_en: string;
  creador_nombre: string | null;
};

type MensajeDetalle = {
  id: number;
  texto: string;
  creado_en: string;
  autor_es_platform_admin: boolean;
  autor_nombre_plataforma: string | null;
  autor_nombre: string | null;
};

export default async function TicketDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const ticket = await get<TicketDetalle>(
    `SELECT t.*, u.nombre AS creador_nombre FROM tickets_soporte t LEFT JOIN users u ON u.id = t.creado_por_id WHERE t.id = ?`,
    [id]
  );
  if (!ticket) notFound();
  if (ticket.creado_por_id !== user.id && user.rol !== "admin") notFound();

  const mensajes = await all<MensajeDetalle>(
    `SELECT m.*, u.nombre AS autor_nombre
     FROM ticket_soporte_mensajes m
     LEFT JOIN users u ON u.id = m.autor_user_id
     WHERE m.ticket_id = ? ORDER BY m.creado_en ASC`,
    [id]
  );

  const badgeColor = (estado: string) => (estado === "resuelto" ? "verde" : estado === "en_proceso" ? "amarillo" : "rojo");
  const puedeResponder = ticket.creado_por_id === user.id || user.rol === "admin";

  return (
    <div>
      <PageHeader
        title={ticket.asunto}
        subtitle={`${CATEGORIA_TICKET_LABEL[ticket.categoria] ?? ticket.categoria} · creado por ${ticket.creador_nombre ?? "—"} el ${dayjs(ticket.creado_en).format("DD/MM/YYYY")}`}
        action={<Badge color={badgeColor(ticket.estado)}>{ESTADO_TICKET_LABEL[ticket.estado] ?? ticket.estado}</Badge>}
      />

      <Card>
        <p className="text-sm font-semibold text-ink mb-3">Conversación</p>
        <div className="space-y-3 mb-4">
          {mensajes.map((m) => (
            <div
              key={m.id}
              className={`text-sm rounded-xl p-3 ${
                m.autor_es_platform_admin ? "bg-[var(--color-brand-50)] border border-[var(--color-brand-100)]" : "bg-surface-sunken"
              }`}
            >
              <p className="text-ink/80 whitespace-pre-wrap">{m.texto}</p>
              <p className="text-xs text-ink-faint mt-1">
                {m.autor_es_platform_admin ? `Soporte (${m.autor_nombre_plataforma ?? "plataforma"})` : m.autor_nombre ?? "—"}
                {" · "}
                {dayjs(m.creado_en).format("DD/MM/YYYY HH:mm")}
              </p>
            </div>
          ))}
        </div>

        {puedeResponder && (
          <div className="pt-3 border-t border-ink/10">
            <Label>Responder</Label>
            <ResponderTicketForm id={ticket.id} />
            <div className="mt-3 pt-3 border-t border-ink/10">
              <CambiarEstadoTicketButton id={ticket.id} estado={ticket.estado} />
            </div>
          </div>
        )}
      </Card>

      <p className="text-xs text-ink-faint mt-4">
        <Link href="/soporte" className="underline underline-offset-2">← Volver a Soporte</Link>
      </p>
    </div>
  );
}
