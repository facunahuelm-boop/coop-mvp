import { all } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { comisionDisponibleEnEtapa, funcionDe, FUNCION_COMISION } from "@/lib/comisionesFunciones";
import { MiComisionPopup } from "@/components/comisiones/MiComisionPopup";

/** Inicio: las comisiones de las que esta persona es integrante — tarjeta mínima y pop-up con las acciones. */
export async function MisComisiones({ user }: { user: SessionUser }) {
  const filas = await all<{
    id: number;
    nombre: string;
    funcion: string | null;
    etapas: string | null;
    rol_en_comision: string;
    pendientes: string;
    vencidas: string;
    proxima_titulo: string | null;
    proxima_fecha: string | null;
  }>(
    `SELECT c.id, c.nombre, c.funcion, c.etapas, m.rol_en_comision,
            (SELECT count(*) FROM tareas t WHERE t.comision_id = c.id AND t.estado <> 'completada')::text AS pendientes,
            (SELECT count(*) FROM tareas t WHERE t.comision_id = c.id AND t.estado <> 'completada'
                AND t.fecha_vencimiento IS NOT NULL AND t.fecha_vencimiento < CURRENT_DATE::text)::text AS vencidas,
            p.titulo AS proxima_titulo, p.fecha_vencimiento AS proxima_fecha
       FROM comision_miembros m JOIN comisiones c ON c.id = m.comision_id
       LEFT JOIN LATERAL (
         SELECT t.titulo, t.fecha_vencimiento FROM tareas t
          WHERE t.comision_id = c.id AND t.estado <> 'completada'
          ORDER BY t.fecha_vencimiento ASC NULLS LAST, t.id ASC LIMIT 1
       ) p ON true
      WHERE m.user_id = ? AND m.activo = 1 AND c.activa = 1 ORDER BY c.nombre`,
    [user.id]
  ).catch(() => []);
  const mias = filas.filter((c) => comisionDisponibleEnEtapa(c, user.etapa));
  if (mias.length === 0) return null;
  // Integrante activo + permiso de edición en comisiones = puede gestionar la
  // comisión (mismo criterio que puedeGestionarComision en la página).
  const puedeAgregar = canEdit(user.rol, "comisiones");
  return (
    <section className="mb-6" data-testid="mis-comisiones">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-muted">Mis comisiones</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {mias.map((c) => (
          <MiComisionPopup
            key={c.id}
            puedeAgregar={puedeAgregar}
            c={{
              id: c.id,
              nombre: c.nombre,
              funcionLabel: FUNCION_COMISION[funcionDe(c.funcion)].label,
              coordina: c.rol_en_comision === "coordinador",
              pendientes: Number(c.pendientes),
              vencidas: Number(c.vencidas),
              proxima: c.proxima_titulo ? { titulo: c.proxima_titulo, fecha: c.proxima_fecha ? String(c.proxima_fecha) : null } : null,
            }}
          />
        ))}
      </div>
    </section>
  );
}
