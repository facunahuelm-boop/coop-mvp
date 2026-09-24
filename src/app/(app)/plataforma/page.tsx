import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { obtenerEstadoPlataforma } from "@/lib/actions/plataforma";
import { Card, PageHeader, Badge } from "@/components/ui";
import {
  AlternarActivoCooperativaButton,
  EstadoCooperativaBadge,
  AplicarMigracionesBoton,
} from "@/components/plataforma/PlataformaFormularios";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ETAPA_LABEL: Record<string, string> = {
  pre_obra: "Pre-obra",
  obra: "En obra",
  habitada: "Habitada",
};

/**
 * Fase 5 (Multicooperativa/arquitectura SaaS(19) + Administrador de
 * plataforma(20) + Planes y módulos(21) + Soporte(22)) — Sub-fase 5.1:
 * Administrador de plataforma (sección 20, primera de esta fase).
 *
 * El texto original de las secciones 19-22 del plan de 44 está
 * irrecuperable (mismo problema de siempre). Alcance confirmado con el
 * usuario tras auditar a fondo: el multi-tenant (RLS) ya es real y está
 * probado en producción con 2 cooperativas, pero no existía ningún rol
 * "admin de plataforma" separado del 'admin' de cada cooperativa — el mismo
 * admin de CUALQUIER cooperativa podía correr migraciones de schema o ver
 * el diagnóstico de RLS de TODA la base vía dos endpoints temporales
 * (`/api/admin/migraciones`, `/api/admin/diagnostico-rls`), ambos marcados
 * en su propio código como "se borra del repo una vez usado". Esta pantalla
 * los reemplaza (retirados del repo) y agrega lo mínimo de gestión de
 * cooperativas que hoy solo se podía hacer con SQL directo (activar/
 * desactivar).
 *
 * Gate: `es_platform_admin` (ver auth.ts) — NO `rol === "admin"`. Es un
 * flag aparte, sin ninguna forma de auto-otorgárselo desde la app (se fija
 * a mano en la migración 0039). Si alguien sin el flag entra por URL
 * directa, se lo manda a /dashboard, mismo criterio que el resto de las
 * pantallas admin-only del sistema.
 *
 * A propósito NO incluye en esta sub-fase: alta de una cooperativa nueva
 * (Sub-fase 5.2, "Alta de cooperativas"), planes/módulos comerciales
 * (Sub-fase 5.3) ni soporte (Sub-fase 5.4).
 */
export default async function PlataformaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.es_platform_admin) redirect("/dashboard");

  const { cooperativas, migracionesPendientes, errorMigraciones, diagnosticoRls, errorDiagnostico } =
    await obtenerEstadoPlataforma();

  const rlsSeguro = diagnosticoRls?.es_superusuario === false && diagnosticoRls?.puede_saltar_rls === false;

  return (
    <div>
      <PageHeader
        title="Panel de plataforma"
        subtitle="Operación entre cooperativas — visible solo para el administrador de la plataforma"
      />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          🔒 Esta pantalla opera SOBRE TODAS las cooperativas, no solo la tuya. Nadie más la ve, incluidos los demás
          administradores de cada cooperativa.
        </p>
      </Card>

      <h2 className="text-sm font-semibold text-ink/70 mb-2">Cooperativas ({cooperativas.length})</h2>
      <div className="space-y-2 mb-6">
        {cooperativas.map((c) => {
          const esLaMia = c.id === user.organization_id;
          return (
            <Card key={c.id} className={!c.activo ? "opacity-60" : ""}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-brand-900)] truncate">
                    {c.nombre} {esLaMia && <span className="text-ink/40 font-normal">(la tuya)</span>}
                  </p>
                  <p className="text-xs text-ink/50">
                    /{c.slug} · {ETAPA_LABEL[c.etapa] ?? c.etapa} · plan &quot;{c.plan}&quot; · {c.usuarios_activos} usuario
                    {c.usuarios_activos === 1 ? "" : "s"} activo{c.usuarios_activos === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-ink/35">Creada {dayjs(c.creado_en).format("DD/MM/YYYY")}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <EstadoCooperativaBadge activo={c.activo} />
                  <AlternarActivoCooperativaButton id={c.id} activo={c.activo} disabled={esLaMia && c.activo} />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="text-sm font-semibold text-ink/70 mb-2">Migraciones de base de datos</h2>
      <Card className="mb-6">
        {errorMigraciones ? (
          <p className="text-xs text-[var(--color-rojo)]">No se pudo consultar el estado de las migraciones: {errorMigraciones}</p>
        ) : migracionesPendientes.length === 0 ? (
          <div className="flex items-center gap-2">
            <Badge color="verde">Al día</Badge>
            <p className="text-xs text-ink/60">No hay migraciones pendientes.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge color="amarillo">{migracionesPendientes.length} pendiente{migracionesPendientes.length === 1 ? "" : "s"}</Badge>
            </div>
            <ul className="text-xs text-ink/60 list-disc list-inside">
              {migracionesPendientes.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <AplicarMigracionesBoton cantidad={migracionesPendientes.length} />
          </div>
        )}
      </Card>

      <h2 className="text-sm font-semibold text-ink/70 mb-2">Diagnóstico de aislamiento (Row-Level Security)</h2>
      <Card>
        {errorDiagnostico || !diagnosticoRls ? (
          <p className="text-xs text-[var(--color-rojo)]">No se pudo consultar el diagnóstico: {errorDiagnostico ?? "sin datos"}</p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge color={rlsSeguro ? "verde" : "rojo"}>{rlsSeguro ? "OK" : "ALERTA"}</Badge>
              <p className="text-xs text-ink/70">
                Rol conectado: <span className="font-mono">{diagnosticoRls.rol_conectado}</span>
              </p>
            </div>
            <p className="text-xs text-ink/50">
              {rlsSeguro
                ? "La app corre con un rol sin privilegios de superusuario y sin BYPASSRLS — el aislamiento por Row-Level Security entre cooperativas es real."
                : "La app está corriendo con un rol que puede saltarse Row-Level Security. El único aislamiento real entre cooperativas hoy es el filtro manual de cada consulta, sin red de contención en la base."}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
