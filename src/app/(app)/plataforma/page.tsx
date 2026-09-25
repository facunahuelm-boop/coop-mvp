import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { obtenerEstadoPlataforma } from "@/lib/actions/plataforma";
import { Card, PageHeader, Badge } from "@/components/ui";
import {
  AlternarActivoCooperativaButton,
  EstadoCooperativaBadge,
  AplicarMigracionesBoton,
  CrearCooperativaForm,
  CambiarPlanCooperativaForm,
  ResponderTicketPlataformaForm,
} from "@/components/plataforma/PlataformaFormularios";
import { PLAN_LABELS, type Plan } from "@/lib/planes";
import { CATEGORIA_TICKET_LABEL, ESTADO_TICKET_LABEL } from "@/lib/constants";
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
 * usuario tras auditar a fondo: el multi-tenant (RLS) ya es real, pero no
 * existía ningún rol "admin de plataforma" separado del 'admin' de cada
 * cooperativa — el mismo admin de CUALQUIER cooperativa podía correr
 * migraciones de schema o ver el diagnóstico de RLS de TODA la base vía dos
 * endpoints temporales (`/api/admin/migraciones`, `/api/admin/diagnostico-
 * rls`), ambos marcados en su propio código como "se borra del repo una vez
 * usado". Esta pantalla los reemplaza (retirados del repo) y agrega lo
 * mínimo de gestión de cooperativas que hoy solo se podía hacer con SQL
 * directo (activar/desactivar).
 *
 * CORRECCIÓN (verificación en vivo, 24/09): la auditoría previa a esta
 * sub-fase había inferido "al menos 2 cooperativas" a partir de texto del
 * CHANGELOG — la consulta real de acá abajo mostró que producción tenía en
 * ese momento UNA sola ("coova", renombrada a "Ufama" por personalización de
 * marca). La Sub-fase 5.2 (alta de cooperativas, más abajo) es la primera
 * vez que este sistema tiene de verdad más de una cooperativa activa.
 *
 * Gate: `es_platform_admin` (ver auth.ts) — NO `rol === "admin"`. Es un
 * flag aparte, sin ninguna forma de auto-otorgárselo desde la app (se fija
 * a mano en la migración 0039). Si alguien sin el flag entra por URL
 * directa, se lo manda a /dashboard, mismo criterio que el resto de las
 * pantallas admin-only del sistema.
 *
 * Sub-fase 5.2 (sección 19, "Alta de cooperativas") agregó el botón "Nueva
 * cooperativa" de acá abajo — ver crearCooperativaAction en actions/
 * plataforma.ts para el detalle de por qué necesita su propia transacción
 * en vez de los helpers insert()/update() normales de db.ts.
 *
 * Sub-fase 5.3 (sección 21, "Planes y módulos") conectó `organizations.plan`
 * (existía desde la Fase 0 pero no se leía en ningún lado) con el mecanismo
 * de módulos ya existente (etapa + modulos_override, Fase D): un plan es un
 * preset con nombre de modulos_override (ver lib/planes.ts) — elegible acá
 * abajo al crear una cooperativa, y cambiable después con el select "Plan"
 * de cada fila (que PISA el modulos_override actual con el preset nuevo,
 * avisado en el propio control).
 *
 * Sub-fase 5.4 (sección 22, "Soporte", última de la Fase 5) agregó la
 * sección "Tickets de soporte" de acá abajo: cualquier usuario de cualquier
 * cooperativa puede escribir un ticket desde /soporte (ver actions/
 * soporte.ts) — acá se ven TODOS, de TODAS las cooperativas, se puede
 * responder y cambiar el estado. Mismo motivo que el conteo de usuarios y
 * las migraciones pendientes de más abajo: `tickets_soporte` tiene RLS
 * forzada, así que verlos todos a la vez necesita la conexión elevada (ver
 * obtenerEstadoPlataforma) — nunca el pool normal de la app.
 */
export default async function PlataformaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.es_platform_admin) redirect("/dashboard");

  const {
    cooperativas,
    errorConteoUsuarios,
    ticketsSoporte,
    errorTickets,
    migracionesPendientes,
    errorMigraciones,
    diagnosticoRls,
    errorDiagnostico,
  } = await obtenerEstadoPlataforma();

  const ticketsAbiertos = ticketsSoporte.filter((t) => t.estado !== "resuelto").length;
  const badgeColorTicket = (estado: string) => (estado === "resuelto" ? "verde" : estado === "en_proceso" ? "amarillo" : "rojo");

  const rlsSeguro = diagnosticoRls?.es_superusuario === false && diagnosticoRls?.puede_saltar_rls === false;

  return (
    <div>
      <PageHeader
        title="Panel de plataforma"
        subtitle="Operación entre cooperativas — visible solo para el administrador de la plataforma"
        action={<CrearCooperativaForm />}
      />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          🔒 Esta pantalla opera SOBRE TODAS las cooperativas, no solo la tuya. Nadie más la ve, incluidos los demás
          administradores de cada cooperativa.
        </p>
      </Card>

      <h2 className="text-sm font-semibold text-ink/70 mb-2">Cooperativas ({cooperativas.length})</h2>
      {errorConteoUsuarios && (
        <p className="text-xs text-[var(--color-rojo)] mb-2">
          No se pudo verificar cuántos usuarios activos tiene cada cooperativa: {errorConteoUsuarios}
        </p>
      )}
      <p className="text-xs text-ink/40 mb-2">
        Cambiar el plan de una cooperativa reemplaza los módulos que tiene visibles por el preset del plan nuevo — pisa
        cualquier ajuste manual que haya hecho desde Configuración → Módulos.
      </p>
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
                    /{c.slug} · {ETAPA_LABEL[c.etapa] ?? c.etapa} · {c.usuarios_activos} usuario
                    {c.usuarios_activos === 1 ? "" : "s"} activo{c.usuarios_activos === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-ink/35">Creada {dayjs(c.creado_en).format("DD/MM/YYYY")}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <EstadoCooperativaBadge activo={c.activo} />
                  <AlternarActivoCooperativaButton id={c.id} activo={c.activo} disabled={esLaMia && c.activo} />
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-ink/5 flex items-center gap-2">
                <span className="text-xs text-ink/50">
                  Plan actual: <span className="font-medium text-ink/70">{PLAN_LABELS[c.plan as Plan] ?? c.plan}</span>
                </span>
                <CambiarPlanCooperativaForm id={c.id} planActual={c.plan} />
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="text-sm font-semibold text-ink/70 mb-2">
        Tickets de soporte {ticketsAbiertos > 0 && <Badge color="rojo">{ticketsAbiertos} sin resolver</Badge>}
      </h2>
      {errorTickets && (
        <p className="text-xs text-[var(--color-rojo)] mb-2">No se pudo consultar los tickets de soporte: {errorTickets}</p>
      )}
      <div className="space-y-2 mb-6">
        {ticketsSoporte.length === 0 && !errorTickets ? (
          <Card>
            <p className="text-xs text-ink/60">Todavía no hay ningún ticket de soporte.</p>
          </Card>
        ) : (
          ticketsSoporte.map((t) => (
            <Card key={t.id}>
              <details>
                <summary className="cursor-pointer flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink truncate">
                    {t.asunto} <span className="text-ink/40 font-normal">· {t.cooperativa_nombre}</span>
                  </span>
                  <Badge color={badgeColorTicket(t.estado)}>{ESTADO_TICKET_LABEL[t.estado] ?? t.estado}</Badge>
                </summary>
                <p className="text-xs text-ink/50 mt-1">
                  {CATEGORIA_TICKET_LABEL[t.categoria] ?? t.categoria} · {t.creador_nombre ?? "—"} ·{" "}
                  {dayjs(t.creado_en).format("DD/MM/YYYY HH:mm")}
                </p>
                <div className="mt-3 space-y-2">
                  {t.mensajes.map((m, i) => (
                    <div
                      key={i}
                      className={`text-xs rounded-lg p-2 ${
                        m.autor_es_platform_admin ? "bg-[var(--color-brand-50)] border border-[var(--color-brand-100)]" : "bg-surface-sunken"
                      }`}
                    >
                      <p className="text-ink/80 whitespace-pre-wrap">{m.texto}</p>
                      <p className="text-ink-faint mt-0.5">
                        {m.autor_es_platform_admin ? `Vos (respuesta de soporte)` : m.autor_nombre ?? "—"} ·{" "}
                        {dayjs(m.creado_en).format("DD/MM/YYYY HH:mm")}
                      </p>
                    </div>
                  ))}
                </div>
                <ResponderTicketPlataformaForm id={t.id} estadoActual={t.estado} />
              </details>
            </Card>
          ))
        )}
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
