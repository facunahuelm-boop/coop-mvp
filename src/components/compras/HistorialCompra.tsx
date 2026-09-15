import dayjs from "dayjs";
import { EmptyState } from "@/components/ui";

// Fase 1 del rediseño de Compras (pedido explícito, sección 15): timeline
// compacto de una solicitud, armado a partir de lo que ya devuelve
// `historialSolicitud()` (lib/logic.ts) sobre la tabla `auditoria` ya
// existente. Server Component puro (sin estado, sin "use client") — recibe
// los registros ya resueltos por la página que lo llama, mismo criterio que
// el resto de los componentes de sólo-lectura de este proyecto.

type RegistroAuditoria = {
  id: number;
  accion: string;
  entidad: string;
  fecha: string;
  usuario_nombre: string | null;
  valor_nuevo: string | null;
};

// Sólo se muestran acciones pensadas para que las vea la persona usuaria —
// las entradas "error_*" son diagnóstico interno (ver compras.ts) y no
// tienen que aparecer acá, igual que ya se filtran del resto de la UI.
const ACCION_VISIBLE = new Set(["crear", "editar", "aprobar_compra", "rechazar_compra", "cambiar_estado", "eliminar"]);

function parseValorNuevo(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function descripcion(r: RegistroAuditoria): string | null {
  const datos = parseValorNuevo(r.valor_nuevo);
  if (r.entidad === "presupuestos_proveedor" && r.accion === "crear") {
    return "Se agregó un presupuesto";
  }
  if (r.entidad === "solicitudes_compra") {
    if (r.accion === "crear") return "Solicitud creada";
    if (r.accion === "editar") return "Datos de la solicitud editados";
    if (r.accion === "aprobar_compra") {
      return datos.monto ? `Compra aprobada — $${Number(datos.monto).toLocaleString("es-UY")}` : "Compra aprobada";
    }
    if (r.accion === "rechazar_compra") return datos.motivo ? `Solicitud rechazada — ${datos.motivo}` : "Solicitud rechazada";
    if (r.accion === "cambiar_estado" && datos.estado === "pedida") return "Marcada como pedida al proveedor";
    if (r.accion === "cambiar_estado" && datos.estado === "entregada") return "Marcada como entregada";
    if (r.accion === "eliminar") return "Solicitud eliminada";
  }
  return null;
}

export function HistorialCompra({ registros }: { registros: RegistroAuditoria[] }) {
  const visibles = registros.filter((r) => ACCION_VISIBLE.has(r.accion) && descripcion(r) !== null);
  if (visibles.length === 0) return <EmptyState>Sin movimientos registrados todavía.</EmptyState>;

  return (
    <ol className="space-y-3">
      {visibles.map((r, i) => (
        <li key={r.id} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center pt-0.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand-800)]" />
            {i < visibles.length - 1 && <span className="w-px flex-1 bg-ink/10" />}
          </div>
          <div className="pb-1 min-w-0">
            <p className="text-ink font-medium">{descripcion(r)}</p>
            <p className="text-xs text-ink-faint mt-0.5">
              {dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}
              {r.usuario_nombre && ` · ${r.usuario_nombre}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
