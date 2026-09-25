import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { CATEGORIA_TICKET_LABEL, ESTADO_TICKET_LABEL } from "@/lib/constants";
import { CrearTicketForm } from "@/components/soporte/SoporteFormularios";
import dayjs from "dayjs";

/**
 * Fase 5 (Multicooperativa/arquitectura SaaS(19) + Administrador de
 * plataforma(20) + Planes y módulos(21) + Soporte(22)) — Sub-fase 5.4:
 * Soporte (sección 22, última de esta fase).
 *
 * El texto original de la sección 22 está irrecuperable, mismo problema que
 * el resto de esta fase. Auditoría previa (con subagente) confirmó que no
 * existía ningún mecanismo de soporte/tickets — lo más cercano era
 * "Reclamos", que es exclusivamente para problemas físicos/edilicios de la
 * propia cooperativa. Alcance confirmado con el usuario: sistema de tickets
 * tenant→plataforma (ver migración 0040, actions/soporte.ts).
 *
 * Sin gate de módulo a propósito (no aparece en Nav.tsx con `mod:` — ver
 * lib/planes.ts): el acceso a soporte nunca debería depender del plan de la
 * cooperativa ni de la etapa. Cualquier usuario autenticado ve esta pantalla.
 *
 * Quién ve qué: cualquiera ve "Mis tickets" (los que creó). El `admin` de la
 * cooperativa ve además TODOS los tickets de su propia cooperativa (mismo
 * nivel que /usuarios) — el resto de los roles no ve los de otras personas,
 * mismo criterio de privacidad que el resto del sistema.
 */
type FilaTicket = {
  id: number;
  asunto: string;
  categoria: string;
  estado: string;
  creado_en: string;
  actualizado_en: string;
  mensajes: string;
  creador_nombre?: string | null;
};

export default async function SoportePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const esAdmin = user.rol === "admin";

  const [misTickets, todosLosTickets] = await Promise.all([
    all<FilaTicket>(
      `SELECT t.*, (SELECT COUNT(*) FROM ticket_soporte_mensajes m WHERE m.ticket_id = t.id) AS mensajes
       FROM tickets_soporte t WHERE t.creado_por_id = ? ORDER BY t.actualizado_en DESC`,
      [user.id]
    ),
    esAdmin
      ? all<FilaTicket>(
          `SELECT t.*, u.nombre AS creador_nombre,
                  (SELECT COUNT(*) FROM ticket_soporte_mensajes m WHERE m.ticket_id = t.id) AS mensajes
           FROM tickets_soporte t
           LEFT JOIN users u ON u.id = t.creado_por_id
           WHERE t.creado_por_id != ?
           ORDER BY t.actualizado_en DESC`,
          [user.id]
        )
      : Promise.resolve([] as FilaTicket[]),
  ]);

  const badgeColor = (estado: string) => (estado === "resuelto" ? "verde" : estado === "en_proceso" ? "amarillo" : "rojo");

  const filaTicket = (t: FilaTicket, mostrarCreador = false) => (
    <Link key={t.id} href={`/soporte/${t.id}`}>
      <Card className="hover:border-[var(--color-brand-200)] transition-colors">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink truncate">{t.asunto}</p>
          <Badge color={badgeColor(t.estado)}>{ESTADO_TICKET_LABEL[t.estado] ?? t.estado}</Badge>
        </div>
        <p className="text-xs text-ink/50 mt-0.5">
          {CATEGORIA_TICKET_LABEL[t.categoria] ?? t.categoria}
          {mostrarCreador && t.creador_nombre ? ` · ${t.creador_nombre}` : ""}
          {" · "}
          {t.mensajes} mensaje{Number(t.mensajes) === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-ink/35 mt-0.5">Actualizado {dayjs(t.actualizado_en).format("DD/MM/YYYY HH:mm")}</p>
      </Card>
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Soporte"
        subtitle="Consultas o problemas con el sistema — no confundir con Reclamos, que es para problemas de tu vivienda o de espacios comunes"
        action={<CrearTicketForm />}
      />

      <h2 className="text-sm font-semibold text-ink/70 mb-2">Mis tickets</h2>
      <div className="space-y-2 mb-6">
        {misTickets.length === 0 ? (
          <EmptyState>Todavía no creaste ningún ticket.</EmptyState>
        ) : (
          misTickets.map((t) => filaTicket(t))
        )}
      </div>

      {esAdmin && (
        <>
          <h2 className="text-sm font-semibold text-ink/70 mb-2">Todos los tickets de tu cooperativa</h2>
          <div className="space-y-2">
            {todosLosTickets.length === 0 ? (
              <EmptyState>No hay tickets de otras personas de tu cooperativa.</EmptyState>
            ) : (
              todosLosTickets.map((t) => filaTicket(t, true))
            )}
          </div>
        </>
      )}
    </div>
  );
}
