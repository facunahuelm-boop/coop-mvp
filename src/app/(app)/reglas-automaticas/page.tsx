import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { obtenerReglasAutomaticas } from "@/lib/reglasAutomaticas";
import { EVENTOS_DISPONIBLES, ACCIONES_DISPONIBLES } from "@/lib/reglasAutomaticasCatalogo";
import { ROLE_LABELS } from "@/lib/roles";
import { CrearReglaAutomaticaForm, AlternarReglaButton, EstadoReglaBadge } from "@/components/reglasAutomaticas/ReglasAutomaticasFormularios";
import dayjs from "dayjs";

// Fase 3 ("Reglas de la cooperativa, Estatuto/Reglamentos como
// configuración, Motor de reglas evento-condición-acción") — Sub-fase 3.3:
// Motor de reglas evento-condición-acción (sección 14, última de la Fase 3).
//
// El texto original de la sección 14 está irrecuperable (mismo problema que
// las secciones 13/15). Alcance confirmado con el usuario, deliberadamente
// acotado — ver el comentario largo en migrations/0035_reglas_automaticas.sql
// y en src/lib/reglasAutomaticas.ts: el propio tipo de evento ES la
// condición (no hay datos estructurados para una condición más rica hoy),
// y las acciones son un catálogo CERRADO de 2 opciones seguras que reusan
// el motor de notificaciones/alertas ya existente.
//
// Mismo guard admin/consejo_directivo que usa el resto de /configuracion
// (ver requireAdminOConsejo en actions/configuracion.ts) — a propósito NO
// se usa canRead(rol, "auditoria") como Panel Fiscal/Auditoría/Cumplimiento,
// porque esta pantalla no es de consulta: es de configuración, y tesorería/
// fiscal no podrían crear ni desactivar reglas aunque la vieran. Mismo
// criterio de visibilidad en el menú que ya tiene /configuracion (sin
// "mod" — el ítem se muestra a todos, la restricción real la hace esta
// página al entrar), para no inventar un criterio de menú distinto al que
// ya tiene la pantalla hermana.
export default async function ReglasAutomaticasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "consejo_directivo"].includes(user.rol)) redirect("/dashboard");

  const reglas = await obtenerReglasAutomaticas();
  const EVENTO_LABEL = Object.fromEntries(EVENTOS_DISPONIBLES.map((e) => [e.value, e.label]));
  const ACCION_LABEL = Object.fromEntries(ACCIONES_DISPONIBLES.map((a) => [a.value, a.label]));

  return (
    <div>
      <PageHeader
        title="Reglas automáticas"
        subtitle="Configurá qué hace el sistema automáticamente cuando pasa algo"
        action={<CrearReglaAutomaticaForm />}
      />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          ⚙️ Cada regla dice &quot;cuando pase este evento, hacé esto automáticamente&quot;. Las acciones disponibles son
          siempre las mismas dos, y ninguna aprueba, vota, publica ni cierra nada por sí sola — solo notifican o crean
          una alerta, exactamente igual que ya hace el sistema cuando una persona lo hace a mano.
        </p>
      </Card>

      <div className="space-y-2">
        {reglas.length === 0 && <EmptyState>Todavía no configuraste ninguna regla automática.</EmptyState>}
        {reglas.map((r) => {
          const datos = r.accion_datos as { rol: string; mensaje?: string; severidad?: string; titulo?: string };
          return (
            <Card key={r.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{r.nombre}</p>
                <p className="text-xs text-ink/50">
                  Evento: <strong>{EVENTO_LABEL[r.evento] || r.evento}</strong> → {ACCION_LABEL[r.accion_tipo] || r.accion_tipo} (
                  {ROLE_LABELS[datos.rol as keyof typeof ROLE_LABELS] || datos.rol})
                </p>
                <p className="text-xs text-ink/40">Creada el {dayjs(r.creado_en).format("DD/MM/YYYY")}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <EstadoReglaBadge activa={r.activa} />
                <AlternarReglaButton id={r.id} activa={r.activa} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
