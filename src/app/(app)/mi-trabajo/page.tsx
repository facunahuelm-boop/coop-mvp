import { redirect } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { Card, PageHeader, EmptyState, SectionTitle, Badge } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import { ResumenMiTrabajo, type ResumenTileDef, type ResumenTileItem } from "@/components/mi-trabajo/ResumenMiTrabajo";
import { CentroActividad, type ActividadItem } from "@/components/mi-trabajo/CentroActividad";

// Fase 10 del sistema de gestión de Comisiones (20/09): "Mi trabajo /
// Requiere mi atención / Centro de actividad".
//
// Hasta acá el sistema estaba organizado POR MÓDULO (solicitudes,
// reuniones, decisiones, tareas, comunicaciones…): para saber qué tenía
// pendiente, un integrante tenía que entrar a cada pantalla y filtrar
// mentalmente lo suyo. Esta página invierte el eje: una sola vista
// organizada POR PERSONA, que junta lo que ya existe en el resto del
// sistema. No agrega ninguna tabla ni columna nueva — es 100% lectura
// sobre lo que las fases 1 a 9 ya construyeron.
//
// Sin gate de canRead/canEdit más que estar logueado: es una página
// PERSONAL (igual que /notificaciones, Fase 7). Cada consulta ya viene
// filtrada por el usuario o por sus comisiones, así que no puede mostrar
// nada que la persona no pudiera ver entrando al módulo correspondiente.
//
// Las consultas contra tablas de la migración 0029 van con
// `.catch(() => [])` porque esa migración sigue sin correrse en
// producción — mismo criterio defensivo del resto del sistema: la página
// se degrada a "no tenés nada pendiente" en vez de romper.

type TareaRow = {
  id: number;
  titulo: string;
  estado: string;
  prioridad: string | null;
  fecha_vencimiento: string | null;
  comision_nombre: string | null;
};

type TareaObraRow = {
  id: number;
  nombre: string;
  estado: string;
  fecha_fin_prevista: string | null;
};

type SolicitudRow = {
  id: number;
  numero: string | null;
  titulo: string;
  estado: string;
  prioridad: string | null;
  fecha_limite: string | null;
  comision_origen_id: number;
  comision_destino_id: number;
  creado_por_id: number | null;
  responsable_id: number | null;
  origen_nombre: string;
  destino_nombre: string;
};

const ESTADOS_SOLICITUD_ABIERTA = ["pendiente", "en_revision", "esperando_informacion", "en_proceso"];

function estaVencida(fecha: string | null | undefined): boolean {
  if (!fecha) return false;
  return dayjs(fecha).isBefore(dayjs().startOf("day"));
}

export default async function MiTrabajoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [
    misComisiones,
    misTareas,
    misTareasObra,
    misColaboraciones,
    solicitudesAbiertas,
    misReuniones,
    misVotaciones,
    misComunicaciones,
    misCompras,
    noLeidas,
    eventosSolicitudes,
    decisionesRecientes,
    reunionesRecientes,
    tareasRecientes,
  ] = await Promise.all([
    all<{ comision_id: number; nombre: string }>(
      `SELECT m.comision_id, c.nombre
         FROM comision_miembros m JOIN comisiones c ON c.id = m.comision_id
        WHERE m.user_id = ? AND m.activo = 1
        ORDER BY c.nombre ASC`,
      [user.id]
    ).catch(() => [] as { comision_id: number; nombre: string }[]),

    all<TareaRow>(
      `SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_vencimiento, c.nombre as comision_nombre
         FROM tareas t LEFT JOIN comisiones c ON c.id = t.comision_id
        WHERE t.responsable_id = ? AND t.estado != 'completada'
        ORDER BY t.fecha_vencimiento ASC`,
      [user.id]
    ).catch(() => [] as TareaRow[]),

    all<TareaObraRow>(
      `SELECT id, nombre, estado, fecha_fin_prevista
         FROM tareas_obra
        WHERE responsable_id = ? AND estado != 'completada'
        ORDER BY fecha_fin_prevista ASC`,
      [user.id]
    ).catch(() => [] as TareaObraRow[]),

    all<TareaRow>(
      `SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_vencimiento, c.nombre as comision_nombre
         FROM tarea_colaboradores tc
         JOIN tareas t ON t.id = tc.tarea_id
         LEFT JOIN comisiones c ON c.id = t.comision_id
        WHERE tc.user_id = ? AND t.estado != 'completada'
        ORDER BY t.fecha_vencimiento ASC`,
      [user.id]
    ).catch(() => [] as TareaRow[]),

    all<SolicitudRow>(
      `SELECT s.id, s.numero, s.titulo, s.estado, s.prioridad, s.fecha_limite,
              s.comision_origen_id, s.comision_destino_id, s.creado_por_id, s.responsable_id,
              co.nombre as origen_nombre, cd.nombre as destino_nombre
         FROM solicitudes_comision s
         JOIN comisiones co ON co.id = s.comision_origen_id
         JOIN comisiones cd ON cd.id = s.comision_destino_id
        ORDER BY s.creado_en DESC
        LIMIT 300`
    ).catch(() => [] as SolicitudRow[]),

    all<{ reunion_id: number; confirmado: boolean; titulo: string; fecha: string; lugar: string | null; comision_nombre: string | null }>(
      `SELECT ri.reunion_id, ri.confirmado, r.titulo, r.fecha, r.lugar, c.nombre as comision_nombre
         FROM reunion_invitados ri
         JOIN reuniones r ON r.id = ri.reunion_id
         LEFT JOIN comisiones c ON c.id = r.comision_id
        WHERE ri.user_id = ? AND r.estado = 'planificada'
        ORDER BY r.fecha ASC`,
      [user.id]
    ).catch(() => [] as { reunion_id: number; confirmado: boolean; titulo: string; fecha: string; lugar: string | null; comision_nombre: string | null }[]),

    all<{ id: number; pregunta: string; fecha_cierre: string | null; decision_id: number | null; decision_tema: string | null }>(
      `SELECT v.id, v.pregunta, v.fecha_cierre, v.decision_id, d.tema as decision_tema
         FROM votaciones v
         LEFT JOIN decisiones_comision d ON d.id = v.decision_id
         LEFT JOIN voto_respuestas vr ON vr.votacion_id = v.id AND vr.user_id = ?
        WHERE v.estado = 'abierta' AND vr.id IS NULL
        ORDER BY v.fecha_cierre ASC`,
      [user.id]
    ).catch(() => [] as { id: number; pregunta: string; fecha_cierre: string | null; decision_id: number | null; decision_tema: string | null }[]),

    all<{ id: number; asunto: string; tipo: string; creado_en: string; autor_nombre: string | null }>(
      `SELECT c.id, c.asunto, c.tipo, c.creado_en, u.nombre as autor_nombre
         FROM comunicaciones c
         LEFT JOIN users u ON u.id = c.autor_id
         LEFT JOIN comunicacion_lecturas cl ON cl.comunicacion_id = c.id AND cl.user_id = ?
        WHERE c.destinatario_id = ? AND cl.id IS NULL
        ORDER BY c.creado_en DESC
        LIMIT 50`,
      [user.id, user.id]
    ).catch(() => [] as { id: number; asunto: string; tipo: string; creado_en: string; autor_nombre: string | null }[]),

    all<{ id: number; material: string; estado: string; creado_en: string }>(
      `SELECT id, material, estado, creado_en
         FROM solicitudes_compra
        WHERE solicitante_id = ?
        ORDER BY creado_en DESC
        LIMIT 50`,
      [user.id]
    ).catch(() => [] as { id: number; material: string; estado: string; creado_en: string }[]),

    get<{ n: number }>(`SELECT COUNT(*)::int as n FROM notificaciones WHERE user_id = ? AND leida = false`, [
      user.id,
    ]).catch(() => null),

    all<{ id: number; evento: string; detalle: string | null; creado_en: string; solicitud_id: number; usuario_nombre: string | null; solicitud_titulo: string; solicitud_numero: string | null; comision_origen_id: number; comision_destino_id: number }>(
      `SELECT e.id, e.evento, e.detalle, e.creado_en, e.solicitud_id,
              u.nombre as usuario_nombre, s.titulo as solicitud_titulo, s.numero as solicitud_numero,
              s.comision_origen_id, s.comision_destino_id
         FROM solicitud_eventos e
         JOIN solicitudes_comision s ON s.id = e.solicitud_id
         LEFT JOIN users u ON u.id = e.usuario_id
        ORDER BY e.creado_en DESC
        LIMIT 60`
    ).catch(() => [] as { id: number; evento: string; detalle: string | null; creado_en: string; solicitud_id: number; usuario_nombre: string | null; solicitud_titulo: string; solicitud_numero: string | null; comision_origen_id: number; comision_destino_id: number }[]),

    all<{ id: number; numero: string | null; tema: string; resultado: string; creado_en: string; comision_id: number; comision_nombre: string | null; autor_nombre: string | null }>(
      `SELECT d.id, d.numero, d.tema, d.resultado, d.creado_en, d.comision_id,
              c.nombre as comision_nombre, u.nombre as autor_nombre
         FROM decisiones_comision d
         LEFT JOIN comisiones c ON c.id = d.comision_id
         LEFT JOIN users u ON u.id = d.decidido_por_id
        ORDER BY d.creado_en DESC
        LIMIT 40`
    ).catch(() => [] as { id: number; numero: string | null; tema: string; resultado: string; creado_en: string; comision_id: number; comision_nombre: string | null; autor_nombre: string | null }[]),

    all<{ id: number; titulo: string; fecha: string; estado: string; creado_en: string; comision_id: number | null; comision_nombre: string | null }>(
      `SELECT r.id, r.titulo, r.fecha, r.estado, r.creado_en, r.comision_id, c.nombre as comision_nombre
         FROM reuniones r LEFT JOIN comisiones c ON c.id = r.comision_id
        ORDER BY r.creado_en DESC
        LIMIT 40`
    ).catch(() => [] as { id: number; titulo: string; fecha: string; estado: string; creado_en: string; comision_id: number | null; comision_nombre: string | null }[]),

    all<{ id: number; titulo: string; estado: string; creado_en: string; comision_id: number | null; comision_nombre: string | null; responsable_nombre: string | null }>(
      `SELECT t.id, t.titulo, t.estado, t.creado_en, t.comision_id,
              c.nombre as comision_nombre, u.nombre as responsable_nombre
         FROM tareas t
         LEFT JOIN comisiones c ON c.id = t.comision_id
         LEFT JOIN users u ON u.id = t.responsable_id
        ORDER BY t.creado_en DESC
        LIMIT 40`
    ).catch(() => [] as { id: number; titulo: string; estado: string; creado_en: string; comision_id: number | null; comision_nombre: string | null; responsable_nombre: string | null }[]),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));

  // --- Requiere mi atención -------------------------------------------------
  const tareasVencidas = misTareas.filter((t) => estaVencida(t.fecha_vencimiento));
  const tareasObraVencidas = misTareasObra.filter((t) => estaVencida(t.fecha_fin_prevista));

  // Una solicitud "me toca a mí" si soy el responsable asignado, o si está
  // abierta y llegó a una comisión de la que formo parte (es el mismo
  // criterio de `recibidasPendientes` en /solicitudes, pero acotado a mí).
  const solicitudesAResponder = solicitudesAbiertas.filter(
    (s) =>
      ESTADOS_SOLICITUD_ABIERTA.includes(s.estado) &&
      (s.responsable_id === user.id || misComisionIds.has(s.comision_destino_id))
  );
  const reunionesSinConfirmar = misReuniones.filter((r) => !r.confirmado);

  const tareasPendientesTotal = misTareas.length + misTareasObra.length;
  const vencidasTotal = tareasVencidas.length + tareasObraVencidas.length;

  const itemTarea = (t: TareaRow): ResumenTileItem => ({
    label: t.titulo,
    sublabel: t.fecha_vencimiento ? dayjs(t.fecha_vencimiento).format("DD/MM/YYYY") : t.comision_nombre || "—",
    href: "/comisiones",
  });
  const itemTareaObra = (t: TareaObraRow): ResumenTileItem => ({
    label: t.nombre,
    sublabel: t.fecha_fin_prevista ? dayjs(t.fecha_fin_prevista).format("DD/MM/YYYY") : "Obra",
    href: "/obra",
  });

  const tiles: ResumenTileDef[] = [
    {
      id: "tareas",
      label: "Tareas pendientes",
      value: String(tareasPendientesTotal),
      color: vencidasTotal > 0 ? "rojo" : tareasPendientesTotal > 0 ? "amarillo" : "verde",
      items: [...misTareas.map(itemTarea), ...misTareasObra.map(itemTareaObra)],
      vacioTexto: "No tenés tareas pendientes asignadas.",
    },
    {
      id: "solicitudes",
      label: "Solicitudes a responder",
      value: String(solicitudesAResponder.length),
      color: solicitudesAResponder.length > 0 ? "amarillo" : "verde",
      items: solicitudesAResponder.map((s) => ({
        label: `${s.numero || "#" + s.id} · ${s.titulo}`,
        sublabel: `${s.origen_nombre} → ${s.destino_nombre}`,
        href: `/solicitudes/${s.id}`,
      })),
      vacioTexto: "No tenés solicitudes esperando tu respuesta.",
    },
    {
      id: "reuniones",
      label: "Reuniones a confirmar",
      value: String(reunionesSinConfirmar.length),
      color: reunionesSinConfirmar.length > 0 ? "amarillo" : "verde",
      items: reunionesSinConfirmar.map((r) => ({
        label: r.titulo,
        sublabel: dayjs(r.fecha).format("DD/MM/YYYY"),
        href: `/reuniones/${r.reunion_id}`,
      })),
      vacioTexto: "No tenés invitaciones a reuniones sin confirmar.",
    },
    {
      id: "votaciones",
      label: "Votaciones sin votar",
      value: String(misVotaciones.length),
      color: misVotaciones.length > 0 ? "amarillo" : "verde",
      items: misVotaciones.map((v) => ({
        label: v.pregunta,
        sublabel: v.fecha_cierre ? `Cierra ${dayjs(v.fecha_cierre).format("DD/MM/YYYY")}` : v.decision_tema || "—",
        href: v.decision_id ? `/decisiones/${v.decision_id}` : "/decisiones",
      })),
      vacioTexto: "No hay votaciones abiertas esperando tu voto.",
    },
    {
      id: "mensajes",
      label: "Mensajes sin leer",
      value: String(misComunicaciones.length),
      color: misComunicaciones.length > 0 ? "amarillo" : "verde",
      items: misComunicaciones.map((c) => ({
        label: c.asunto,
        sublabel: c.autor_nombre || "—",
        href: "/comunicaciones",
      })),
      vacioTexto: "No tenés mensajes dirigidos a vos sin leer.",
    },
  ];

  const totalAtencion =
    solicitudesAResponder.length +
    reunionesSinConfirmar.length +
    misVotaciones.length +
    misComunicaciones.length +
    vencidasTotal;

  // --- Centro de actividad --------------------------------------------------
  // Se mezcla en el servidor y se ordena por fecha. Cada fuente se acota a
  // las comisiones del usuario (mismo criterio que /solicitudes: quien
  // pertenece a la comisión ve su actividad).
  const actividad: ActividadItem[] = [
    ...eventosSolicitudes
      .filter((e) => misComisionIds.has(e.comision_origen_id) || misComisionIds.has(e.comision_destino_id))
      .map((e) => ({
        id: `sol-${e.id}`,
        fecha: e.creado_en,
        texto: `${e.solicitud_numero || "Solicitud #" + e.solicitud_id} · ${e.solicitud_titulo}`,
        detalle: e.evento === "comentario" ? "Nuevo comentario" : `Estado: ${e.evento.replace(/_/g, " ")}`,
        autor: e.usuario_nombre,
        href: `/solicitudes/${e.solicitud_id}`,
      })),
    ...decisionesRecientes
      .filter((d) => misComisionIds.has(d.comision_id))
      .map((d) => ({
        id: `dec-${d.id}`,
        fecha: d.creado_en,
        texto: `${d.numero || "Decisión #" + d.id} · ${d.tema}`,
        detalle: `Decisión ${d.resultado}`,
        autor: d.autor_nombre,
        contexto: d.comision_nombre,
        href: `/decisiones/${d.id}`,
      })),
    ...reunionesRecientes
      .filter((r) => r.comision_id !== null && misComisionIds.has(r.comision_id))
      .map((r) => ({
        id: `reu-${r.id}`,
        fecha: r.creado_en,
        texto: r.titulo,
        detalle: `Reunión ${r.estado} para el ${dayjs(r.fecha).format("DD/MM/YYYY")}`,
        contexto: r.comision_nombre,
        href: `/reuniones/${r.id}`,
      })),
    ...tareasRecientes
      .filter((t) => t.comision_id !== null && misComisionIds.has(t.comision_id))
      .map((t) => ({
        id: `tar-${t.id}`,
        fecha: t.creado_en,
        texto: t.titulo,
        detalle: `Tarea ${t.estado.replace(/_/g, " ")}${t.responsable_nombre ? ` · ${t.responsable_nombre}` : ""}`,
        contexto: t.comision_nombre,
        href: "/comisiones",
      })),
  ]
    .filter((a) => Boolean(a.fecha))
    .sort((a, b) => (dayjs(b.fecha).valueOf() || 0) - (dayjs(a.fecha).valueOf() || 0))
    .slice(0, 30);

  // --- Render ---------------------------------------------------------------
  const filaClass = "flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0";

  const tabAtencion = (
    <div className="space-y-5">
      {totalAtencion === 0 ? (
        <Card>
          <EmptyState>Estás al día: no hay nada esperando por vos en este momento.</EmptyState>
        </Card>
      ) : (
        <>
          {vencidasTotal > 0 && (
            <div>
              <SectionTitle>Tareas vencidas</SectionTitle>
              <Card>
                <div className="divide-y divide-border">
                  {tareasVencidas.map((t) => (
                    <div key={`t${t.id}`} className={filaClass}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{t.titulo}</p>
                        <p className="text-xs text-ink-muted mt-0.5">{t.comision_nombre || "—"}</p>
                      </div>
                      <Badge color="rojo">Venció {dayjs(t.fecha_vencimiento).format("DD/MM")}</Badge>
                    </div>
                  ))}
                  {tareasObraVencidas.map((t) => (
                    <div key={`o${t.id}`} className={filaClass}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{t.nombre}</p>
                        <p className="text-xs text-ink-muted mt-0.5">Obra</p>
                      </div>
                      <Badge color="rojo">Venció {dayjs(t.fecha_fin_prevista).format("DD/MM")}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {solicitudesAResponder.length > 0 && (
            <div>
              <SectionTitle>Solicitudes esperando tu respuesta</SectionTitle>
              <Card>
                <div className="divide-y divide-border">
                  {solicitudesAResponder.map((s) => (
                    <div key={s.id} className={filaClass}>
                      <div className="min-w-0">
                        <Link
                          href={`/solicitudes/${s.id}`}
                          className="text-sm font-medium text-ink hover:underline underline-offset-2"
                        >
                          {s.numero || `#${s.id}`} · {s.titulo}
                        </Link>
                        <p className="text-xs text-ink-muted mt-0.5">
                          {s.origen_nombre} → {s.destino_nombre}
                        </p>
                      </div>
                      {estaVencida(s.fecha_limite) ? (
                        <Badge color="rojo">Vencida</Badge>
                      ) : s.fecha_limite ? (
                        <Badge color="amarillo">{dayjs(s.fecha_limite).format("DD/MM")}</Badge>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {reunionesSinConfirmar.length > 0 && (
            <div>
              <SectionTitle>Reuniones a confirmar</SectionTitle>
              <Card>
                <div className="divide-y divide-border">
                  {reunionesSinConfirmar.map((r) => (
                    <div key={r.reunion_id} className={filaClass}>
                      <div className="min-w-0">
                        <Link
                          href={`/reuniones/${r.reunion_id}`}
                          className="text-sm font-medium text-ink hover:underline underline-offset-2"
                        >
                          {r.titulo}
                        </Link>
                        <p className="text-xs text-ink-muted mt-0.5">
                          {r.comision_nombre || "—"}
                          {r.lugar ? ` · ${r.lugar}` : ""}
                        </p>
                      </div>
                      <Badge color="brand">{dayjs(r.fecha).format("DD/MM/YYYY")}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {misVotaciones.length > 0 && (
            <div>
              <SectionTitle>Votaciones abiertas sin tu voto</SectionTitle>
              <Card>
                <div className="divide-y divide-border">
                  {misVotaciones.map((v) => (
                    <div key={v.id} className={filaClass}>
                      <div className="min-w-0">
                        <Link
                          href={v.decision_id ? `/decisiones/${v.decision_id}` : "/decisiones"}
                          className="text-sm font-medium text-ink hover:underline underline-offset-2"
                        >
                          {v.pregunta}
                        </Link>
                        {v.decision_tema && <p className="text-xs text-ink-muted mt-0.5">{v.decision_tema}</p>}
                      </div>
                      {v.fecha_cierre && <Badge color="amarillo">Cierra {dayjs(v.fecha_cierre).format("DD/MM")}</Badge>}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {misComunicaciones.length > 0 && (
            <div>
              <SectionTitle>Mensajes dirigidos a vos sin leer</SectionTitle>
              <Card>
                <div className="divide-y divide-border">
                  {misComunicaciones.map((c) => (
                    <div key={c.id} className={filaClass}>
                      <div className="min-w-0">
                        <Link
                          href="/comunicaciones"
                          className="text-sm font-medium text-ink hover:underline underline-offset-2"
                        >
                          {c.asunto}
                        </Link>
                        <p className="text-xs text-ink-muted mt-0.5">{c.autor_nombre || "—"}</p>
                      </div>
                      <span className="text-xs text-ink-faint shrink-0">
                        {dayjs(c.creado_en).format("DD/MM/YYYY")}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );

  const tabMiTrabajo = (
    <div className="space-y-5">
      <div>
        <SectionTitle>Mis tareas</SectionTitle>
        <Card>
          {misTareas.length === 0 && misTareasObra.length === 0 ? (
            <EmptyState>No tenés tareas asignadas en este momento.</EmptyState>
          ) : (
            <div className="divide-y divide-border">
              {misTareas.map((t) => (
                <div key={`t${t.id}`} className={filaClass}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t.titulo}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{t.comision_nombre || "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.fecha_vencimiento && (
                      <Badge color={estaVencida(t.fecha_vencimiento) ? "rojo" : "gray"}>
                        {dayjs(t.fecha_vencimiento).format("DD/MM")}
                      </Badge>
                    )}
                    <Badge color={t.estado === "en_curso" ? "brand" : "gray"}>
                      {t.estado.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
              ))}
              {misTareasObra.map((t) => (
                <div key={`o${t.id}`} className={filaClass}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t.nombre}</p>
                    <p className="text-xs text-ink-muted mt-0.5">Obra</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.fecha_fin_prevista && (
                      <Badge color={estaVencida(t.fecha_fin_prevista) ? "rojo" : "gray"}>
                        {dayjs(t.fecha_fin_prevista).format("DD/MM")}
                      </Badge>
                    )}
                    <Badge color="gray">{t.estado.replace(/_/g, " ")}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {misColaboraciones.length > 0 && (
        <div>
          <SectionTitle>Tareas donde colaborás</SectionTitle>
          <Card>
            <div className="divide-y divide-border">
              {misColaboraciones.map((t) => (
                <div key={t.id} className={filaClass}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t.titulo}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{t.comision_nombre || "—"}</p>
                  </div>
                  <Badge color="gray">{t.estado.replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div>
        <SectionTitle>Mis solicitudes</SectionTitle>
        <Card>
          {solicitudesAbiertas.filter((s) => s.creado_por_id === user.id || s.responsable_id === user.id).length === 0 ? (
            <EmptyState>No creaste solicitudes ni sos responsable de ninguna.</EmptyState>
          ) : (
            <div className="divide-y divide-border">
              {solicitudesAbiertas
                .filter((s) => s.creado_por_id === user.id || s.responsable_id === user.id)
                .slice(0, 30)
                .map((s) => (
                  <div key={s.id} className={filaClass}>
                    <div className="min-w-0">
                      <Link
                        href={`/solicitudes/${s.id}`}
                        className="text-sm font-medium text-ink hover:underline underline-offset-2"
                      >
                        {s.numero || `#${s.id}`} · {s.titulo}
                      </Link>
                      <p className="text-xs text-ink-muted mt-0.5">
                        {s.origen_nombre} → {s.destino_nombre}
                        {s.responsable_id === user.id ? " · sos responsable" : " · la creaste vos"}
                      </p>
                    </div>
                    <Badge color={ESTADOS_SOLICITUD_ABIERTA.includes(s.estado) ? "amarillo" : "gray"}>
                      {s.estado.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle>Mis pedidos de compra</SectionTitle>
        <Card>
          {misCompras.length === 0 ? (
            <EmptyState>No hiciste pedidos de compra todavía.</EmptyState>
          ) : (
            <div className="divide-y divide-border">
              {misCompras.map((c) => (
                <div key={c.id} className={filaClass}>
                  <div className="min-w-0">
                    <Link
                      href={`/compras/${c.id}`}
                      className="text-sm font-medium text-ink hover:underline underline-offset-2"
                    >
                      {c.material}
                    </Link>
                    <p className="text-xs text-ink-muted mt-0.5">{dayjs(c.creado_en).format("DD/MM/YYYY")}</p>
                  </div>
                  <Badge color={c.estado === "entregada" ? "verde" : c.estado === "rechazada" ? "rojo" : "gray"}>
                    {c.estado.replace(/_/g, " ")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle>Mis comisiones</SectionTitle>
        <Card>
          {misComisiones.length === 0 ? (
            <EmptyState>No integrás ninguna comisión por ahora.</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-2">
              {misComisiones.map((c) => (
                <Link
                  key={c.comision_id}
                  href="/comisiones"
                  className="rounded-lg bg-surface-sunken px-3 py-1.5 text-sm text-ink hover:bg-[var(--color-brand-50)] transition-colors"
                >
                  {c.nombre}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );

  const tabActividad = (
    <Card>
      <CentroActividad items={actividad} />
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Mi trabajo"
        subtitle="Todo lo tuyo en un solo lugar: lo que requiere tu atención, lo que tenés asignado y qué pasó en tus comisiones"
        action={
          noLeidas && noLeidas.n > 0 ? (
            <Link
              href="/notificaciones"
              className="text-xs text-[var(--color-brand-800)] underline underline-offset-2"
            >
              {noLeidas.n} notificación{noLeidas.n === 1 ? "" : "es"} sin leer →
            </Link>
          ) : undefined
        }
      />

      <ResumenMiTrabajo tiles={tiles} columnas={5} />

      <Tabs
        tabs={[
          { id: "atencion", label: `Requiere mi atención${totalAtencion > 0 ? ` (${totalAtencion})` : ""}`, content: tabAtencion },
          { id: "trabajo", label: "Mi trabajo", content: tabMiTrabajo },
          { id: "actividad", label: "Centro de actividad", content: tabActividad },
        ]}
      />
    </div>
  );
}
