import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, EmptyState, Badge, SectionTitle } from "@/components/ui";
import { ActionForm, Tabs } from "@/components/ui-client";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { UsuarioLink } from "@/components/EntidadLink";
import { HistorialAuditoria } from "@/components/HistorialAuditoria";
import { archivarComisionFormAction, quitarMiembroFormAction, cambiarRolMiembroFormAction } from "@/lib/actions/comisiones";
import { cambiarEstadoTareaFormAction } from "@/lib/actions/tareas";
import { AgregarMiembroForm, CrearTareaForm, EditarComisionForm } from "@/components/comisiones/ComisionesFormularios";
import { TareaDetalleModal } from "@/components/comisiones/TareaDetalleModal";
import { CalendarioHoras } from "@/components/comisiones/CalendarioHoras";
import { puedeGestionarComision, puedePlanificarHorasTrabajo, rolEnComision } from "@/lib/comisionAuth";
import { historialComision } from "@/lib/logic";
import { puntosDeAgenda, TIPO_REUNION_LABEL } from "@/lib/trazabilidad";
import { FUNCION_COMISION, funcionDe, comisionDisponibleEnEtapa, textoEtapas, ETAPA_LABEL, type EtapaCooperativa } from "@/lib/comisionesFunciones";
import { cargarSemanaHoras, obtenerHorarioObra } from "@/lib/horasTrabajo";
import { hoyEnUruguay, lunesDe, sumarDias, diasDeSemana, textoSemana, esFechaISO, textoHoras } from "@/lib/horasObra";
import type { ComisionRow } from "@/lib/comisionesResumen";

/**
 * Página propia de una comisión (05/10) — /comisiones/[id]. NO está en el
 * menú lateral: se entra desde Comisiones → la comisión → "Ver comisión
 * completa". Estructura reutilizable para todas las comisiones:
 *   Resumen · [herramientas propias de su función] · Integrantes · Tareas ·
 *   Actividades · Reuniones · Documentos · Historial
 * Hoy la única herramienta propia es la de Trabajo (calendario de horas);
 * cada función nueva suma la suya en lib/comisionesFunciones.ts sin tocar
 * el resto. Integrantes y Tareas reusan exactamente los mismos formularios
 * y permisos que antes vivían en el tablero.
 */

const ROL_MIEMBRO_LABEL: Record<string, string> = { coordinador: "Coordinador/a", integrante: "Integrante", suplente: "Suplente" };
const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "verde" | "amarillo" | "brand"> = { pendiente: "amarillo", en_curso: "brand", completada: "verde" };
const PRIORIDAD_LABEL: Record<string, string> = { alta: "🔴 Alta", media: "🟡 Media", baja: "⚪ Baja" };
const ESTADO_REUNION_COLOR: Record<string, "verde" | "gray" | "brand"> = { planificada: "brand", realizada: "verde", cancelada: "gray" };

type Miembro = { id: number; user_id: number; user_nombre: string; rol_en_comision: string; desde: string };
type Tarea = {
  id: number;
  comision_id: number;
  titulo: string;
  descripcion: string | null;
  prioridad: string;
  estado: string;
  fecha_vencimiento: string | null;
  etiquetas: string | null;
  responsable_id: number | null;
  responsable_nombre: string | null;
  depende_de_id?: number | null;
  checklist?: unknown;
  resultado?: string | null;
  agenda_item_id?: number | null;
};
type Colaborador = { id: number; tarea_id: number; user_id: number; nombre: string };

export default async function ComisionDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; semana?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const comisionId = Number(id);
  if (!Number.isInteger(comisionId) || comisionId <= 0) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const comision = await get<ComisionRow & { activa: number }>(`SELECT * FROM comisiones WHERE id = ?`, [comisionId]);
  if (!comision) notFound();

  const esOversight = canEdit(user.rol, "finanzas");
  const funcion = funcionDe(comision.funcion);
  const def = FUNCION_COMISION[funcion];
  const disponible = comisionDisponibleEnEtapa(comision, user.etapa);
  const etapaLabel = ETAPA_LABEL[user.etapa as EtapaCooperativa] ?? user.etapa;

  // Fuera de su etapa la comisión no está activa para la cooperativa. Sólo
  // conducción la puede abrir (para revisarla o cambiar sus etapas).
  if (!disponible && !esOversight) {
    return (
      <div>
        <PageHeader title={comision.nombre} subtitle="Comisión" />
        <Card>
          <EmptyState>
            Esta comisión no está disponible en la etapa actual de la cooperativa ({etapaLabel}).{" "}
            <Link href="/comisiones" className="underline">Volver a Comisiones</Link>
          </EmptyState>
        </Card>
      </div>
    );
  }

  const puedeGestionar = canEdit(user.rol, "comisiones") && (await puedeGestionarComision(user, comisionId));
  // Historial: quien ya lee la Auditoría general, y además el coordinador/a
  // de ESTA comisión (pedido: el responsable de la comisión "consulta el
  // historial"; un integrante común no). Sólo ve lo de su comisión.
  const puedeVerHistorial = canRead(user.rol, "auditoria") || (await rolEnComision(user, comisionId)) === "coordinador";
  const hoy = hoyEnUruguay();

  const [miembros, usuarios, tareas, colaboradores, reuniones, documentos, decisiones, actividades, todasLasComisiones, padre, historial] = await Promise.all([
    all<Miembro>(
      `SELECT m.id, m.user_id, u.nombre as user_nombre, m.rol_en_comision, m.desde FROM comision_miembros m JOIN users u ON u.id = m.user_id
        WHERE m.comision_id = ? AND m.activo = 1 ORDER BY CASE m.rol_en_comision WHEN 'coordinador' THEN 0 WHEN 'integrante' THEN 1 ELSE 2 END, u.nombre ASC`,
      [comisionId]
    ),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 ORDER BY nombre ASC`),
    all<Tarea>(
      `SELECT t.*, u.nombre as responsable_nombre FROM tareas t LEFT JOIN users u ON u.id = t.responsable_id
        WHERE t.comision_id = ?
        ORDER BY (t.estado = 'completada'), CASE t.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, t.creado_en DESC`,
      [comisionId]
    ),
    all<Colaborador>(
      `SELECT tc.id, tc.tarea_id, tc.user_id, u.nombre FROM tarea_colaboradores tc JOIN users u ON u.id = tc.user_id
        WHERE tc.tarea_id IN (SELECT id FROM tareas WHERE comision_id = ?)`,
      [comisionId]
    ).catch(() => [] as Colaborador[]),
    all<{ id: number; titulo: string; fecha: string; estado: string; lugar: string | null }>(
      `SELECT id, titulo, fecha, estado, lugar FROM reuniones WHERE comision_id = ? ORDER BY fecha DESC`,
      [comisionId]
    ).catch(() => []),
    all<{ id: number; nombre: string; categoria: string; fecha: string; archivo_url: string | null }>(
      `SELECT id, nombre, categoria, fecha, archivo_url FROM documentos WHERE comision_id = ? ORDER BY fecha DESC`,
      [comisionId]
    ).catch(() => []),
    all<{ id: number; tema: string; resultado: string; fecha: string; agenda_item_id?: number | null }>(
      `SELECT id, tema, resultado, fecha, agenda_item_id FROM decisiones_comision WHERE comision_id = ? ORDER BY creado_en DESC`,
      [comisionId]
    ).catch(() =>
      all<{ id: number; tema: string; resultado: string; fecha: string; agenda_item_id?: number | null }>(
        `SELECT id, tema, resultado, fecha FROM decisiones_comision WHERE comision_id = ? ORDER BY creado_en DESC`,
        [comisionId]
      ).catch(() => [])
    ),
    all<{ id: number; titulo: string; fecha: string; hora: string | null; ubicacion: string | null }>(
      `SELECT id, titulo, fecha, hora, ubicacion FROM notas_calendario WHERE comision_id = ? ORDER BY fecha DESC, hora DESC NULLS LAST LIMIT 100`,
      [comisionId]
    ).catch(() => []),
    esOversight ? all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`) : Promise.resolve([]),
    comision.comision_padre_id ? get<{ nombre: string }>(`SELECT nombre FROM comisiones WHERE id = ?`, [comision.comision_padre_id]) : Promise.resolve(undefined),
    puedeVerHistorial ? historialComision(comisionId) : Promise.resolve([]),
  ]);

  const coordinadores = miembros.filter((m) => m.rol_en_comision === "coordinador");
  const responsable = coordinadores.map((m) => m.user_nombre).join(", ");
  const pendientes = tareas.filter((t) => t.estado !== "completada");
  const vencidas = pendientes.filter((t) => t.fecha_vencimiento && t.fecha_vencimiento < hoy);
  const proximaReunion = reuniones.filter((r) => r.estado === "planificada" && r.fecha.slice(0, 10) >= hoy).sort((a, b) => (a.fecha < b.fecha ? -1 : 1))[0];
  const proximasActividades = actividades.filter((a) => a.fecha >= hoy).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const pasadasActividades = actividades.filter((a) => a.fecha < hoy);

  // ---------- Trabajo: calendario de horas ----------
  const esTrabajo = funcion === "trabajo";
  const lunes = lunesDe(esFechaISO(sp.semana) ? sp.semana : hoy);
  const [semanaHoras, horario, puedePlanificar] = esTrabajo
    ? await Promise.all([cargarSemanaHoras(lunes), obtenerHorarioObra(), disponible ? puedePlanificarHorasTrabajo(user, comisionId) : Promise.resolve(false)])
    : [null, null, false];
  const hrefSemana = (l: string) => `/comisiones/${comisionId}?tab=horas&semana=${l}`;

  // Tareas: mismo armado que antes tenía el tablero (origen, checklist,
  // dependencias). Recorrido de decisiones: Asambleas / Consejos de los que
  // salieron tareas, decisiones o puntos de reunión de esta comisión.
  const llevados = await all<{ origen_item_id: number }>(
    `SELECT ai.origen_item_id FROM reunion_agenda_items ai JOIN reuniones r ON r.id = ai.reunion_id
      WHERE r.comision_id = ? AND ai.origen_item_id IS NOT NULL`,
    [comisionId]
  ).catch(() => [] as { origen_item_id: number }[]);
  const puntosOrigen = await puntosDeAgenda([
    ...tareas.map((t) => Number(t.agenda_item_id) || 0),
    ...decisiones.map((d) => Number(d.agenda_item_id) || 0),
    ...llevados.map((l) => l.origen_item_id),
  ]);
  const relacionadas = new Map<number, { id: number; titulo: string; tipo: string; fecha: string; punto: string }>();
  for (const p of puntosOrigen.values()) {
    if (p.reunion_tipo !== "comision" && !relacionadas.has(p.reunion_id)) {
      relacionadas.set(p.reunion_id, { id: p.reunion_id, titulo: p.reunion_titulo, tipo: p.reunion_tipo, fecha: p.reunion_fecha, punto: p.titulo });
    }
  }
  const reunionesRelacionadas = [...relacionadas.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const origenDeTarea = (t: Tarea) => {
    const o = t.agenda_item_id ? puntosOrigen.get(t.agenda_item_id) : undefined;
    return o ? { texto: `${TIPO_REUNION_LABEL[o.reunion_tipo] ?? o.reunion_tipo} «${o.reunion_titulo}» — ${o.titulo}`, href: `/reuniones/${o.reunion_id}` } : null;
  };
  const checklistDe = (t: Tarea): { texto: string; hecho: boolean }[] => (Array.isArray(t.checklist) ? (t.checklist as { texto: string; hecho: boolean }[]) : []);
  const dependenciaDe = (t: Tarea) => {
    if (!t.depende_de_id) return null;
    const dep = tareas.find((x) => x.id === t.depende_de_id);
    return dep ? { titulo: dep.titulo, estado: dep.estado } : null;
  };

  const estado =
    !comision.activa
      ? { label: "Archivada", color: "gray" as const }
      : !disponible
        ? { label: `No disponible en ${etapaLabel}`, color: "gray" as const }
        : miembros.length === 0
          ? { label: "Sin integrantes", color: "amarillo" as const }
          : pendientes.length || proximaReunion || proximasActividades.length || (semanaHoras && semanaHoras.resumen.minutosProgramados > 0)
            ? { label: "En actividad", color: "verde" as const }
            : { label: "Sin actividad", color: "gray" as const };

  // ---------- Pestañas ----------
  const tabResumen = (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato label="Responsable" valor={responsable || "Sin asignar"} />
        <Dato label="Integrantes" valor={String(miembros.length)} />
        <Dato label="Tareas pendientes" valor={`${pendientes.length}${vencidas.length ? ` (${vencidas.length} vencidas)` : ""}`} />
        <Dato label="Próxima reunión" valor={proximaReunion ? dayjs(proximaReunion.fecha).format("DD/MM HH:mm") : "Sin agendar"} />
      </div>
      {esTrabajo && semanaHoras && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-[var(--color-brand-900)]">{textoSemana(lunes)}</p>
              <p className="text-sm text-ink-muted">
                Horas programadas: <span className="font-semibold text-ink">{textoHoras(semanaHoras.resumen.minutosProgramados).replace(" h", "")} / {textoHoras(semanaHoras.resumen.minutosObjetivo)}</span>
                {" · "}{semanaHoras.resumen.completos} de {semanaHoras.resumen.nucleos} núcleos completos
              </p>
            </div>
            <Link href={hrefSemana(lunes)} className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
              Ver horas de trabajo →
            </Link>
          </div>
        </Card>
      )}
      <Card>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><dt className="text-xs text-ink-faint">Función</dt><dd className="font-medium">{def.label}</dd></div>
          <div><dt className="text-xs text-ink-faint">Disponible en</dt><dd className="font-medium">{textoEtapas(comision)}</dd></div>
          {comision.objetivo && <div className="sm:col-span-2"><dt className="text-xs text-ink-faint">Objetivo</dt><dd>{comision.objetivo}</dd></div>}
          <div><dt className="text-xs text-ink-faint">Tipo</dt><dd>{comision.tipo === "temporal" ? "Temporal" : "Permanente"}</dd></div>
          {(comision.fecha_inicio || comision.fecha_fin) && (
            <div>
              <dt className="text-xs text-ink-faint">Vigencia</dt>
              <dd>{comision.fecha_inicio ? dayjs(comision.fecha_inicio).format("DD/MM/YYYY") : "—"} → {comision.fecha_fin ? dayjs(comision.fecha_fin).format("DD/MM/YYYY") : "sin fecha de fin"}</dd>
            </div>
          )}
          {padre && <div><dt className="text-xs text-ink-faint">Subcomisión de</dt><dd>{padre.nombre}</dd></div>}
          {def.modulo && (
            <div>
              <dt className="text-xs text-ink-faint">Trabaja con</dt>
              <dd><Link href={def.modulo.href} className="underline underline-offset-2">{def.modulo.label} →</Link></dd>
            </div>
          )}
        </dl>
      </Card>
      {proximasActividades.length > 0 && (
        <div>
          <SectionTitle>Próximas actividades</SectionTitle>
          <Card>
            <ListaActividades items={proximasActividades.slice(0, 5)} />
          </Card>
        </div>
      )}
    </div>
  );

  const tabIntegrantes = (
    <Card>
      <div className="divide-y divide-ink/5">
        {miembros.map((m) => (
          <div key={m.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <Link href={`/usuarios/${m.user_id}`} className="font-medium hover:underline underline-offset-2">{m.user_nombre}</Link>
              <p className="text-xs text-ink-faint">Desde {dayjs(m.desde).format("DD/MM/YYYY")}</p>
            </div>
            <div className="flex items-center gap-3">
              {puedeGestionar ? (
                <AutoSubmitSelect
                  action={cambiarRolMiembroFormAction}
                  hiddenFields={{ id: m.id }}
                  name="rol_en_comision"
                  defaultValue={m.rol_en_comision}
                  options={Object.entries(ROL_MIEMBRO_LABEL).map(([value, label]) => ({ value, label }))}
                  className="rounded-md border border-ink/10 bg-surface px-2 py-1 text-xs"
                />
              ) : (
                <Badge color={m.rol_en_comision === "coordinador" ? "brand" : "gray"}>{ROL_MIEMBRO_LABEL[m.rol_en_comision] ?? m.rol_en_comision}</Badge>
              )}
              <Badge color="verde">Activo</Badge>
              {puedeGestionar && (
                <ActionForm action={quitarMiembroFormAction} className="inline">
                  <input type="hidden" name="id" value={m.id} />
                  <button className="text-xs text-ink/40 hover:text-[var(--color-rojo)]" title="Quitar de la comisión">Quitar</button>
                </ActionForm>
              )}
            </div>
          </div>
        ))}
        {miembros.length === 0 && <EmptyState>Todavía no tiene integrantes.</EmptyState>}
      </div>
      {puedeGestionar && <AgregarMiembroForm comisionId={comisionId} usuarios={usuarios} />}
    </Card>
  );

  const tabTareas = (
    <Card>
      <div className="space-y-2">
        {tareas.map((t) => {
          const checklist = checklistDe(t);
          const hechos = checklist.filter((it) => it.hecho).length;
          return (
            <div key={t.id} className="flex items-center justify-between gap-2 text-sm border-b border-ink/5 last:border-0 pb-2">
              <div className="min-w-0">
                <TareaDetalleModal
                  tarea={{
                    id: t.id,
                    comision_id: t.comision_id,
                    titulo: t.titulo,
                    descripcion: t.descripcion ?? null,
                    prioridad: t.prioridad,
                    estado: t.estado,
                    fecha_vencimiento: t.fecha_vencimiento ?? null,
                    etiquetas: t.etiquetas ?? null,
                    responsable_id: t.responsable_id ?? null,
                    depende_de_id: t.depende_de_id ?? null,
                    checklist,
                    resultado: t.resultado ?? null,
                  }}
                  origen={origenDeTarea(t)}
                  usuarios={usuarios}
                  otrasTareas={tareas.filter((x) => x.id !== t.id).map((x) => ({ id: x.id, titulo: x.titulo, estado: x.estado }))}
                  colaboradores={colaboradores.filter((cl) => cl.tarea_id === t.id).map((cl) => ({ id: cl.id, user_id: cl.user_id, nombre: cl.nombre }))}
                  dependencia={dependenciaDe(t)}
                  puedeGestionar={puedeGestionar}
                />
                <p className="text-xs text-ink/40">
                  {PRIORIDAD_LABEL[t.prioridad] ?? t.prioridad} · <UsuarioLink id={t.responsable_id} nombre={t.responsable_nombre} fallback="sin asignar" />
                  {t.fecha_vencimiento ? ` · vence ${dayjs(t.fecha_vencimiento).format("DD/MM")}` : ""}
                  {checklist.length > 0 ? ` · ☑ ${hechos}/${checklist.length}` : ""}
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
          );
        })}
        {tareas.length === 0 && <EmptyState>Sin tareas cargadas.</EmptyState>}
      </div>
      {puedeGestionar && <CrearTareaForm comisionId={comisionId} usuarios={usuarios} />}
    </Card>
  );

  const tabActividades = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Actividades del calendario de la cooperativa asignadas a esta comisión.</p>
        <Link href="/calendario" className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">Ir al calendario →</Link>
      </div>
      <Card>
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Próximas</p>
        {proximasActividades.length ? <ListaActividades items={proximasActividades} /> : <p className="text-sm text-ink-faint">Nada agendado.</p>}
      </Card>
      {pasadasActividades.length > 0 && (
        <Card>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Anteriores</p>
          <ListaActividades items={pasadasActividades.slice(0, 20)} />
        </Card>
      )}
    </div>
  );

  const tabReuniones = (
    <div className="space-y-4">
      <Card>
        <div className="divide-y divide-ink/5">
          {reuniones.map((r) => (
            <div key={r.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link href={`/reuniones/${r.id}`} className="font-medium hover:underline underline-offset-2">{r.titulo}</Link>
              <span className="flex items-center gap-2 text-xs text-ink-faint">
                {dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}
                <Badge color={ESTADO_REUNION_COLOR[r.estado] ?? "gray"}>{r.estado}</Badge>
              </span>
            </div>
          ))}
          {reuniones.length === 0 && <EmptyState>Sin reuniones registradas. Se agendan desde Reuniones, eligiendo esta comisión.</EmptyState>}
        </div>
      </Card>
      <div>
        <SectionTitle>Asambleas y Consejo relacionados</SectionTitle>
        <Card>
          <div className="divide-y divide-ink/5">
            {reunionesRelacionadas.map((r) => (
              <div key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link href={`/reuniones/${r.id}`} className="hover:underline underline-offset-2">
                  {TIPO_REUNION_LABEL[r.tipo] ?? r.tipo}: {r.titulo}
                </Link>
                <span className="text-xs text-ink-faint">{dayjs(r.fecha).format("DD/MM/YYYY")} · «{r.punto}»</span>
              </div>
            ))}
            {reunionesRelacionadas.length === 0 && (
              <p className="py-2 text-sm text-ink-faint">Ninguna resolución de Asamblea o Consejo derivada a esta comisión todavía.</p>
            )}
          </div>
        </Card>
      </div>
      {decisiones.length > 0 && (
        <div>
          <SectionTitle>Decisiones</SectionTitle>
          <Card>
            <div className="divide-y divide-ink/5">
              {decisiones.map((d) => (
                <div key={d.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <Link href={`/decisiones/${d.id}`} className="hover:underline underline-offset-2 truncate">{d.tema}</Link>
                  <Badge color={d.resultado === "aprobada" ? "verde" : d.resultado === "rechazada" ? "rojo" : "amarillo"}>{d.resultado}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );

  const tabDocumentos = (
    <Card>
      <div className="divide-y divide-ink/5">
        {documentos.map((d) => (
          <div key={d.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium truncate">{d.nombre}</p>
              <p className="text-xs text-ink-faint">{d.categoria} · {dayjs(d.fecha).format("DD/MM/YYYY")}</p>
            </div>
            {d.archivo_url ? (
              <a href={`/api/archivos/documento/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2">Ver →</a>
            ) : (
              <span className="text-xs text-ink-faint">Sin archivo</span>
            )}
          </div>
        ))}
        {documentos.length === 0 && <EmptyState>Sin documentos. Se suben desde Documentos, vinculándolos a esta comisión.</EmptyState>}
      </div>
    </Card>
  );

  const tabs = [
    { id: "resumen", label: "Resumen", content: tabResumen },
    ...(esTrabajo && semanaHoras && horario
      ? [
          {
            id: "horas",
            label: "Horas de trabajo",
            content: disponible ? (
              <CalendarioHoras
                comisionId={comisionId}
                semana={semanaHoras}
                dias={diasDeSemana(lunes)}
                hoy={hoy}
                textoSemana={textoSemana(lunes)}
                hrefAnterior={hrefSemana(sumarDias(lunes, -7))}
                hrefSiguiente={hrefSemana(sumarDias(lunes, 7))}
                hrefActual={hrefSemana(lunesDe(hoy))}
                horario={horario}
                puedePlanificar={puedePlanificar}
              />
            ) : (
              <Card><EmptyState>El calendario de horas se habilita cuando la cooperativa está en una etapa en la que esta comisión está disponible.</EmptyState></Card>
            ),
          },
        ]
      : []),
    { id: "integrantes", label: `Integrantes (${miembros.length})`, content: tabIntegrantes },
    { id: "tareas", label: `Tareas${pendientes.length ? ` (${pendientes.length})` : ""}`, content: tabTareas },
    { id: "actividades", label: "Actividades", content: tabActividades },
    { id: "reuniones", label: "Reuniones", content: tabReuniones },
    { id: "documentos", label: "Documentos", content: tabDocumentos },
    ...(puedeVerHistorial ? [{ id: "historial", label: "Historial", content: <Card><HistorialAuditoria registros={historial} /></Card> }] : []),
  ];
  const tabInicial = tabs.some((t) => t.id === sp.tab) ? sp.tab : esTrabajo && sp.semana ? "horas" : "resumen";

  return (
    <div>
      <Link href="/comisiones" className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">← Comisiones</Link>
      <PageHeader
        title={comision.nombre}
        subtitle={[
          `Comisión de ${def.label.toLowerCase()}`,
          `${miembros.length} integrante${miembros.length === 1 ? "" : "s"}`,
          `Responsable: ${responsable || "sin asignar"}`,
        ].join(" · ")}
        action={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Badge color={estado.color}>{estado.label}</Badge>
            {esOversight && comision.activa ? (
              <ActionForm action={archivarComisionFormAction}>
                <input type="hidden" name="id" value={comision.id} />
                <button className="text-xs text-ink/40 hover:text-[var(--color-rojo)] underline underline-offset-2 whitespace-nowrap">Archivar</button>
              </ActionForm>
            ) : null}
          </div>
        }
      />
      {comision.descripcion && <p className="text-sm text-ink-muted -mt-2 mb-3">{comision.descripcion}</p>}
      {!disponible && (
        <p className="mb-4 rounded-lg bg-[var(--color-amarillo-bg)] px-3 py-2 text-sm text-[var(--color-amarillo)]">
          Esta comisión no corresponde a la etapa actual ({etapaLabel}) — disponible en: {textoEtapas(comision)}. Sólo conducción la ve; el resto de la cooperativa no.
        </p>
      )}
      {esOversight && (
        <div className="mb-4">
          <EditarComisionForm comision={comision} comisiones={todasLasComisiones} />
        </div>
      )}
      <Tabs tabs={tabs} defaultTab={tabInicial} />
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className="text-sm font-semibold text-ink truncate">{valor}</p>
    </div>
  );
}

function ListaActividades({ items }: { items: { id: number; titulo: string; fecha: string; hora: string | null; ubicacion: string | null }[] }) {
  return (
    <div className="divide-y divide-ink/5">
      {items.map((a) => (
        <div key={a.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">{a.titulo}</span>
          <span className="text-xs text-ink-faint">
            {dayjs(a.fecha).format("DD/MM/YYYY")}{a.hora ? ` ${a.hora.slice(0, 5)}` : ""}{a.ubicacion ? ` · ${a.ubicacion}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
