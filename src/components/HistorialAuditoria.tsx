import dayjs from "dayjs";
import { EmptyState } from "@/components/ui";

// Fase 2 ("Transparencia, Auditoría, Historial, Cumplimiento", sección 37),
// Sub-fase 2.3: componente genérico para mostrar el historial de auditoría
// de UN registro puntual (socio, usuario, decisión, reunión, tarea de obra,
// jornada de trabajo) dentro de su propia ficha — no una vista global nueva,
// sino el mismo `/auditoria` de siempre (Sub-fase 2.2 ya le agregó "valor
// anterior → valor nuevo") reducido a un componente embebible, para no
// repetir esa lógica de render en cada ficha que lo necesite. `HistorialCompra`
// (components/compras/) sigue existiendo tal cual — arma descripciones en
// lenguaje llano específicas de Compras y no se toca acá.
type RegistroAuditoria = {
  id: number;
  accion: string;
  fecha: string;
  usuario_nombre: string | null;
  valor_anterior?: string | null;
  valor_nuevo?: string | null;
};

export function HistorialAuditoria({ registros }: { registros: RegistroAuditoria[] }) {
  if (registros.length === 0) {
    return <EmptyState>Sin movimientos registrados todavía.</EmptyState>;
  }

  return (
    <div className="divide-y divide-ink/5">
      {registros.map((r) => (
        <div key={r.id} className="py-2.5 text-sm">
          <p>
            <strong>{r.usuario_nombre || "sistema"}</strong> — {r.accion.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-ink/40">{dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}</p>
          {r.valor_anterior && r.valor_nuevo ? (
            <p className="text-xs text-ink/50 mt-0.5 font-mono truncate">
              {r.valor_anterior} → {r.valor_nuevo}
            </p>
          ) : (
            r.valor_nuevo && <p className="text-xs text-ink/50 mt-0.5 font-mono truncate">{r.valor_nuevo}</p>
          )}
        </div>
      ))}
    </div>
  );
}
