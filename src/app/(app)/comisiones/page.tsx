import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { UsuarioLink } from "@/components/EntidadLink";
import dayjs from "dayjs";
import {
  archivarComisionFormAction,
  reactivarComisionFormAction,
  quitarMiembroFormAction,
  cambiarRolMiembroFormAction,
} from "@/lib/actions/comisiones";
import { cambiarEstadoTareaFormAction } from "@/lib/actions/tareas";
import { AgregarMiembroForm, CrearTareaForm, CrearComisionForm, EditarComisionForm } from "@/components/comisiones/ComisionesFormularios";

const ROL_MIEMBRO_LABEL: Record<string, string> = { coordinador: "Coordinador/a", integrante: "Integrante", suplente: "Suplente" };

// Fase 06 del Plan Maestro — cualquier comisión puede llevar sus propias
// tareas ahora, no solo Obra (tareas_obra) o Trabajo (tareas_jornada).
const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "verde" | "amarillo" | "brand"> = { pendiente: "amarillo", en_curso: "brand", completada: "verde" };
const PRIORIDAD_LABEL: Record<string, string> = { alta: "🔴 Alta", media: "🟡 Media", baja: "⚪ Baja" };

export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ archivadas?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const { archivadas: verArchivadas } = await searchParams;
  const puedeEditar = canEdit(user.rol, "comisiones");
  // Crear/archivar una comisión es una decisión estructural (agrega o quita
  // un órgano entero) — se reserva a roles de conducción/finanzas, igual que
  // ya exige el backend (ver actions/comisiones.ts). Gestionar los
  // integrantes o tareas de una comisión puntual, en cambio, se ofrece según
  // CUÁL comisión: cualquiera de conducción, o quien ya integra esa comisión
  // específica — así el botón no aparece prometiendo algo que el servidor
  // después va a rechazar por ser de otra comisión.
  const esOversightComisiones = canEdit(user.rol, "finanzas");

  const [comisiones, comisionesArchivadas, miembros, usuarios, tareas, misComisiones] = await Promise.all([
    all<any>(`SELECT * FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    // Fase 2 (comisiones dinámicas): archivar nunca borró información, pero
    // hasta ahora no había forma de volver a verlas — memoria institucional
    // real significa poder consultarlas, no solo no borrarlas.
    verArchivadas === "1"
      ? all<any>(`SELECT * FROM comisiones WHERE activa = 0 ORDER BY nombre ASC`)
      : Promise.resolve([]),
    all<any>(
      `SELECT m.*, u.nombre as user_nombre FROM comision_miembros m JOIN users u ON u.id = m.user_id WHERE m.activo = 1 ORDER BY m.rol_en_comision DESC, u.nombre ASC`
    ),
    all<any>(`SELECT id, nombre, rol FROM users WHERE activo = 1 ORDER BY nombre ASC`),
    all<any>(
      `SELECT t.*, u.nombre as responsable_nombre FROM tareas t LEFT JOIN users u ON u.id = t.responsable_id
       ORDER BY (t.estado = 'completada'), CASE t.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, t.creado_en DESC`
    ),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));
  const puedeGestionarEstaComision = (comisionId: number) => puedeEditar && (esOversightComisiones || misComisionIds.has(comisionId));

  const miembrosPorComision = (comisionId: number) => miembros.filter((m) => m.comision_id === comisionId);
  const tareasPorComision = (comisionId: number) => tareas.filter((t) => t.comision_id === comisionId);
  const nombreComision = (id: number | null) => (id ? comisiones.find((c) => c.id === id)?.nombre : null);

  return (
    <div>
      <PageHeader title="Comisiones" subtitle="Quién integra cada comisión de la cooperativa" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {comisiones.map((c) => {
          const integrantes = miembrosPorComision(c.id);
          const puedeGestionar = puedeGestionarEstaComision(c.id);
          const padreNombre = nombreComision(c.comision_padre_id);
          return (
            <Card key={c.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-sm font-bold text-[var(--color-brand-900)] truncate">{c.nombre}</h3>
                  {c.tipo === "temporal" && <Badge color="amarillo">Temporal</Badge>}
                </div>
                {esOversightComisiones && (
                  <ActionForm action={archivarComisionFormAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs text-ink/40 hover:text-[var(--color-rojo)] underline underline-offset-2 whitespace-nowrap">Archivar</button>
                  </ActionForm>
                )}
              </div>
              {c.descripcion && <p className="text-xs text-ink/50 mt-0.5">{c.descripcion}</p>}
              {c.objetivo && <p className="text-xs text-ink/50 mt-0.5">🎯 {c.objetivo}</p>}
              {(c.fecha_inicio || c.fecha_fin) && (
                <p className="text-xs text-ink/40 mt-0.5">
                  {c.fecha_inicio ? dayjs(c.fecha_inicio).format("DD/MM/YYYY") : "—"} → {c.fecha_fin ? dayjs(c.fecha_fin).format("DD/MM/YYYY") : "sin fecha de fin"}
                </p>
              )}
              {padreNombre && <p className="text-xs text-ink/40 mt-0.5">Subcomisión de <span className="font-medium">{padreNombre}</span></p>}
              {esOversightComisiones && <EditarComisionForm comision={c} comisiones={comisiones} />}

              <div className="flex flex-wrap gap-1.5 mt-3">
                {integrantes.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 text-xs rounded-full bg-ink/5 px-2.5 py-1">
                    {m.rol_en_comision === "coordinador" ? "⭐ " : ""}
                    {/* Fase 6 (perfil individual de usuario): el nombre ya se
                        mostraba acá sin ningún link — ahora lleva a su ficha. */}
                    <Link href={`/usuarios/${m.user_id}`} className="hover:underline underline-offset-2">
                      {m.user_nombre}
                    </Link>
                    {puedeGestionar ? (
                      <AutoSubmitSelect
                        action={cambiarRolMiembroFormAction}
                        hiddenFields={{ id: m.id }}
                        name="rol_en_comision"
                        defaultValue={m.rol_en_comision}
                        options={Object.entries(ROL_MIEMBRO_LABEL).map(([value, label]) => ({ value, label }))}
                        className="rounded-full border-none bg-transparent text-xs text-ink/50 py-0 pl-0 pr-4"
                      />
                    ) : (
                      m.rol_en_comision === "suplente" && <span className="text-ink/40">(suplente)</span>
                    )}
                    {puedeGestionar && (
                      <ActionForm action={quitarMiembroFormAction} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="text-ink/40 hover:text-[var(--color-rojo)]" title="Quitar de la comisión">✕</button>
                      </ActionForm>
                    )}
                  </span>
                ))}
                {integrantes.length === 0 && <p className="text-xs text-ink/40 italic">Sin integrantes todavía.</p>}
              </div>

              {puedeGestionar && <AgregarMiembroForm comisionId={c.id} usuarios={usuarios} />}

              <div className="mt-4 pt-4 border-t border-ink/5">
                <p className="text-xs font-semibold text-ink/60 mb-2">Tareas</p>
                <div className="space-y-1.5">
                  {tareasPorComision(c.id).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className={`truncate font-medium ${t.estado === "completada" ? "text-ink/40 line-through" : "text-[var(--color-brand-900)]"}`}>
                          {t.titulo}
                        </p>
                        <p className="text-ink/40">
                          {PRIORIDAD_LABEL[t.prioridad] ?? t.prioridad} ·{" "}
                          <UsuarioLink id={t.responsable_id} nombre={t.responsable_nombre} fallback="sin asignar" />
                          {t.fecha_vencimiento ? ` · vence ${dayjs(t.fecha_vencimiento).format("DD/MM")}` : ""}
                        </p>
                      </div>
                      {puedeGestionar ? (
                        <AutoSubmitSelect
                          action={cambiarEstadoTareaFormAction}
                          hiddenFields={{ id: t.id }}
                          name="estado"
                          defaultValue={t.estado}
                          options={Object.entries(ESTADO_TAREA_LABEL).map(([value, label]) => ({ value, label }))}
                          className="rounded-md border border-ink/10 bg-surface px-1.5 py-1 text-xs whitespace-nowrap"
                        />
                      ) : (
                        <Badge color={ESTADO_TAREA_COLOR[t.estado] ?? "gray"}>{ESTADO_TAREA_LABEL[t.estado] ?? t.estado}</Badge>
                      )}
                    </div>
                  ))}
                  {tareasPorComision(c.id).length === 0 && (
                    <p className="text-xs text-ink/40 italic">Sin tareas cargadas.</p>
                  )}
                </div>

                {puedeGestionar && <CrearTareaForm comisionId={c.id} usuarios={usuarios} />}
              </div>
            </Card>
          );
        })}
        {comisiones.length === 0 && <EmptyState>Todavía no hay comisiones creadas.</EmptyState>}
      </div>

      {esOversightComisiones && <CrearComisionForm comisiones={comisiones} />}

      {/* Archivar nunca borra información (memoria institucional, punto 32
          del pedido) — esto es lo que faltaba para poder consultarla de
          nuevo en vez de que quede invisible para siempre. */}
      <div className="mt-6">
        <Link
          href={verArchivadas === "1" ? "/comisiones" : "/comisiones?archivadas=1"}
          className="text-xs text-ink/40 hover:text-[var(--color-brand-800)] underline underline-offset-2"
        >
          {verArchivadas === "1" ? "Ocultar archivadas" : "Ver comisiones archivadas"}
        </Link>
        {verArchivadas === "1" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {comisionesArchivadas.map((c) => (
              <Card key={c.id} className="opacity-70">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-ink/60 truncate">{c.nombre}</h4>
                  {esOversightComisiones && (
                    <ActionForm action={reactivarComisionFormAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="text-xs text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap">Reactivar</button>
                    </ActionForm>
                  )}
                </div>
                {c.objetivo && <p className="text-xs text-ink/40 mt-0.5">🎯 {c.objetivo}</p>}
              </Card>
            ))}
            {comisionesArchivadas.length === 0 && <p className="text-xs text-ink/40 italic">No hay comisiones archivadas.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
