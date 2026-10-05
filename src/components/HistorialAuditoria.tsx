import { AuditoriaLista } from "@/components/AuditoriaLista";
import { registroLegible, type RegistroAuditoriaCrudo } from "@/lib/auditoriaTexto";

// Fase 2 ("Transparencia, Auditoría, Historial, Cumplimiento"), Sub-fase 2.3:
// historial de auditoría de UN registro puntual (socio, usuario, decisión,
// reunión, tarea de obra, jornada) dentro de su propia ficha.
//
// Auditoría legible (04/10): en vez de mostrar el JSON crudo, cada evento se
// muestra como un mensaje en lenguaje llano y se abre en un pop-up con el
// detalle "antes → después" (ver lib/auditoriaTexto.ts y AuditoriaLista).
// `HistorialCompra` (components/compras/) sigue existiendo tal cual.
export function HistorialAuditoria({ registros }: { registros: RegistroAuditoriaCrudo[] }) {
  return <AuditoriaLista registros={registros.map(registroLegible)} />;
}
