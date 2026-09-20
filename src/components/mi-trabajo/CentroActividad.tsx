import Link from "next/link";
import dayjs from "dayjs";
import { EmptyState } from "@/components/ui";

// Fase 10 del sistema de gestión de Comisiones (20/09) — "Centro de
// actividad": qué pasó últimamente en las comisiones a las que pertenezco.
//
// Mismo lenguaje visual que HistorialSolicitud.tsx (punto + línea
// conectora + descripción + fecha·autor), pero con dos diferencias
// deliberadas:
//   1. HistorialSolicitud es la trazabilidad de UNA solicitud (lee
//      `solicitud_eventos` filtrado por solicitud_id); esto es un feed
//      CRUZADO entre módulos (solicitudes + decisiones + reuniones +
//      tareas), mezclado y ordenado por fecha en el servidor.
//   2. Cada ítem puede linkear a su ficha, porque viene de distintas
//      tablas y el usuario necesita poder saltar al origen.
//
// No reemplaza a `notificaciones` (Fase 7): esa es la bandeja PERSONAL de
// eventos que me llegaron a mí; esto es lo que pasó en mis comisiones,
// haya generado o no una notificación para mí.

export type ActividadItem = {
  id: string;
  fecha: string;
  texto: string;
  detalle?: string | null;
  autor?: string | null;
  contexto?: string | null;
  href?: string | null;
};

export function CentroActividad({ items }: { items: ActividadItem[] }) {
  if (items.length === 0) {
    return <EmptyState>Todavía no hay actividad registrada en tus comisiones.</EmptyState>;
  }

  return (
    <ol className="space-y-3">
      {items.map((it, i) => (
        <li key={it.id} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center pt-0.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand-800)]" />
            {i < items.length - 1 && <span className="w-px flex-1 bg-ink/10" />}
          </div>
          <div className="pb-1 min-w-0">
            {it.href ? (
              <Link href={it.href} className="text-ink font-medium hover:underline underline-offset-2">
                {it.texto}
              </Link>
            ) : (
              <p className="text-ink font-medium">{it.texto}</p>
            )}
            {it.detalle && <p className="text-xs text-ink/60 mt-0.5">{it.detalle}</p>}
            <p className="text-xs text-ink-faint mt-0.5">
              {dayjs(it.fecha).format("DD/MM/YYYY HH:mm")}
              {it.autor && ` · ${it.autor}`}
              {it.contexto && ` · ${it.contexto}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
