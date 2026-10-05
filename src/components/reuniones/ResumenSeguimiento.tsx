import Link from "next/link";
import dayjs from "dayjs";
import { TIPO_REUNION_LABEL, type VinculosResolucion, type PuntoEnReunion } from "@/lib/trazabilidad";

/**
 * Recorrido de decisiones (04/10): resumen de una línea de lo que salió de
 * una resolución, para los pop-ups de Asambleas y Consejo Directivo (el
 * detalle completo y las acciones viven en la ficha de la reunión).
 */
export function ResumenSeguimiento({ vinculos }: { vinculos: VinculosResolucion | undefined }) {
  if (!vinculos || vinculos.total === 0) return null;
  const completadas = vinculos.tareas.filter((t) => t.estado === "completada").length;
  return (
    <span className="block text-xs font-normal text-[var(--accent-blue)] mt-0.5">
      {vinculos.seguimientos.map((s) => (
        <span key={s.id} className="mr-2">
          ↪{" "}
          <Link href={`/reuniones/${s.reunion_id}`} className="underline underline-offset-2">
            {TIPO_REUNION_LABEL[s.reunion_tipo] ?? s.reunion_tipo} {dayjs(s.reunion_fecha).format("DD/MM")}
          </Link>
        </span>
      ))}
      {vinculos.decisiones.length > 0 && <span className="mr-2">⚖️ {vinculos.decisiones.length} decisión(es)</span>}
      {vinculos.tareas.length > 0 && (
        <span className="mr-2">
          ✅ {vinculos.tareas.length} tarea(s){completadas ? ` (${completadas} completada${completadas === 1 ? "" : "s"})` : ""}
        </span>
      )}
      {vinculos.compras.length > 0 && <span>🛒 {vinculos.compras.length} compra(s)</span>}
    </span>
  );
}

/** "Sale de: Asamblea «…» — punto «…»" (compras, decisiones, tareas). */
export function OrigenResolucion({ punto }: { punto: PuntoEnReunion | undefined }) {
  if (!punto) return null;
  return (
    <p className="text-xs rounded-lg px-2.5 py-1.5 bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] mb-4">
      Sale de la resolución de {TIPO_REUNION_LABEL[punto.reunion_tipo] ?? punto.reunion_tipo}{" "}
      <Link href={`/reuniones/${punto.reunion_id}`} className="underline underline-offset-2">{punto.reunion_titulo}</Link>{" "}
      ({dayjs(punto.reunion_fecha).format("DD/MM/YYYY")}) — «{punto.titulo}»{punto.resultado ? `: ${punto.resultado}` : ""}
    </p>
  );
}
