import dayjs from "dayjs";
import { EmptyState } from "@/components/ui";

// Fase 3 del sistema de gestión de Comisiones (19/09, sección 21:
// "debe ser imposible perder la trazabilidad de una operación"). A
// diferencia de HistorialCompra.tsx (que arma su timeline a partir de la
// tabla genérica `auditoria`), acá se lee directo de `solicitud_eventos` —
// una tabla dedicada (migración 0029) con los campos estructurados que la
// derivación necesita (de_comision_id/a_comision_id), en vez de tener que
// parsear JSON de un campo genérico. Server Component puro, sin estado.

type Evento = {
  id: number;
  evento: string;
  detalle: string | null;
  creado_en: string;
  usuario_nombre: string | null;
  de_comision_nombre: string | null;
  a_comision_nombre: string | null;
};

function descripcion(e: Evento): string {
  switch (e.evento) {
    case "creada":
      return `Solicitud creada, enviada a ${e.a_comision_nombre || "—"}`;
    case "en_revision":
      return "Puesta en revisión";
    case "esperando_informacion":
      return "Se pidió más información";
    case "en_proceso":
      return "Marcada en proceso";
    case "aprobada":
      return "Aprobada";
    case "rechazada":
      return "Rechazada";
    case "resuelta":
      return "Marcada como resuelta";
    case "cancelada":
      return "Cancelada";
    case "derivada":
      return `Derivada de ${e.de_comision_nombre || "—"} a ${e.a_comision_nombre || "—"}`;
    case "comentario":
      return "Agregó un comentario";
    default:
      return e.evento.replace(/_/g, " ");
  }
}

export function HistorialSolicitud({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) return <EmptyState>Sin movimientos registrados todavía.</EmptyState>;

  return (
    <ol className="space-y-3">
      {eventos.map((e, i) => (
        <li key={e.id} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center pt-0.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand-800)]" />
            {i < eventos.length - 1 && <span className="w-px flex-1 bg-ink/10" />}
          </div>
          <div className="pb-1 min-w-0">
            <p className="text-ink font-medium">{descripcion(e)}</p>
            {e.detalle && <p className="text-xs text-ink/60 mt-0.5">{e.detalle}</p>}
            <p className="text-xs text-ink-faint mt-0.5">
              {dayjs(e.creado_en).format("DD/MM/YYYY HH:mm")}
              {e.usuario_nombre && ` · ${e.usuario_nombre}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
