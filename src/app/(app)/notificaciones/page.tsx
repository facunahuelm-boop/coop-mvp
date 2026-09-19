import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import { MarcarNotificacionLeidaForm, MarcarTodasLeidasForm } from "@/components/notificaciones/NotificacionesFormularios";

// Fase 7 del sistema de gestión de Comisiones (19/09, sección
// "comunicaciones/notificaciones"): bandeja real por usuario (tabla
// `notificaciones`, migración 0029) — no depende de ningún rol/módulo
// puntual, es la bandeja PERSONAL de cada usuario (cualquiera que haya
// iniciado sesión puede tener notificaciones propias, sin importar su rol),
// así que no hay gate de canRead/canEdit acá más que estar logueado.
//
// `.catch(() => [])` por si esta fase se despliega antes de que el usuario
// corra la migración 0029 en producción — mismo criterio defensivo del resto
// del sistema.
export default async function NotificacionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  type NotificacionRow = {
    id: number;
    tipo: string;
    titulo: string;
    cuerpo: string | null;
    ref_tabla: string | null;
    ref_id: number | null;
    leida: boolean;
    creado_en: string;
  };

  const notificaciones = await all<NotificacionRow>(
    `SELECT * FROM notificaciones WHERE user_id = ? ORDER BY creado_en DESC LIMIT 200`,
    [user.id]
  ).catch(() => []);

  function hrefDe(n: NotificacionRow): string | null {
    if (!n.ref_id) return n.ref_tabla === "comunicaciones" ? "/comunicaciones" : null;
    switch (n.ref_tabla) {
      case "solicitudes_comision":
        return `/solicitudes/${n.ref_id}`;
      case "decisiones_comision":
        return `/decisiones/${n.ref_id}`;
      case "reuniones":
        return `/reuniones/${n.ref_id}`;
      case "comunicaciones":
        return "/comunicaciones";
      default:
        return null;
    }
  }

  const noLeidas = notificaciones.filter((n) => !n.leida);

  return (
    <div>
      <PageHeader
        title="Notificaciones"
        subtitle="Eventos puntuales de Comisiones: solicitudes, tareas, reuniones, decisiones y comunicaciones"
        action={noLeidas.length > 0 ? <MarcarTodasLeidasForm /> : undefined}
      />

      <Card>
        {notificaciones.length === 0 ? (
          <EmptyState>No tenés notificaciones todavía.</EmptyState>
        ) : (
          <div className="divide-y divide-border">
            {notificaciones.map((n) => {
              const href = hrefDe(n);
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 py-3 first:pt-0 last:pb-0 ${!n.leida ? "bg-[var(--color-brand-50)] -mx-4 sm:-mx-5 px-4 sm:px-5" : ""}`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${!n.leida ? "bg-[var(--color-brand-800)]" : "bg-transparent"}`}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    {href ? (
                      <Link href={href} className="text-sm font-semibold text-ink hover:underline underline-offset-2">
                        {n.titulo}
                      </Link>
                    ) : (
                      <p className="text-sm font-semibold text-ink">{n.titulo}</p>
                    )}
                    {n.cuerpo && <p className="text-xs text-ink-muted mt-0.5">{n.cuerpo}</p>}
                    <p className="text-xs text-ink-faint mt-0.5">{dayjs(n.creado_en).format("DD/MM/YYYY HH:mm")}</p>
                  </div>
                  {!n.leida && <MarcarNotificacionLeidaForm id={n.id} />}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
