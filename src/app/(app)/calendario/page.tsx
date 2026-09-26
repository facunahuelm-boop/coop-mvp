import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { moduloVisible } from "@/components/Nav";
import { Card, PageHeader, Badge, EmptyState, SectionTitle } from "@/components/ui";
import { MonthCalendar, type EventoCalendario, type NotaCalendario } from "@/components/MonthCalendar";
import {
  crearNotaCalendarioFormAction,
  editarNotaCalendarioFormAction,
  eliminarNotaCalendarioFormAction,
  moverNotaCalendarioFormAction,
  agregarParticipanteActividadFormAction,
  quitarParticipanteActividadFormAction,
} from "@/lib/actions/calendarioNotas";
import dayjs from "dayjs";
import Link from "next/link";

// Calendario unificado (punto 4 del rediseño del Dashboard): antes cada
// fecha importante vivía suelta en su propio módulo (reuniones, jornadas de
// trabajo, hitos de obra, vencimientos financieros y de seguridad) y no
// había un solo lugar para ver "qué se viene". Esta pantalla no agrega datos
// nuevos — junta lo que cada módulo ya tenía, respetando exactamente los
// mismos permisos que ya usa cada uno (si el rol no puede leer Obra, acá
// tampoco ve sus hitos).
//
// Pensado para gente sin mucha práctica con sistemas: una sola lista
// cronológica, agrupada en "Esta semana / Este mes / Más adelante" en vez de
// una grilla de calendario tradicional (que exige más lectura visual y no
// se adapta bien a celulares chicos).

type Tipo = "reunion" | "asamblea" | "jornada" | "obra" | "finanzas" | "seguridad";

type Evento = {
  id: string;
  fecha: string;
  titulo: string;
  sub?: string;
  tipo: Tipo;
  href: string;
  hora?: string;
};

const TIPO_LABEL: Record<Tipo, string> = {
  reunion: "Reunión",
  asamblea: "Asamblea",
  jornada: "Jornada de trabajo",
  obra: "Obra",
  finanzas: "Vencimiento",
  seguridad: "Seguridad",
};

const TIPO_COLOR: Record<Tipo, "brand" | "amarillo" | "rojo" | "gray"> = {
  reunion: "brand",
  asamblea: "brand",
  jornada: "brand",
  obra: "amarillo",
  finanzas: "rojo",
  seguridad: "amarillo",
};

export default async function CalendarioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const verObra = canRead(user.rol, "obra") && moduloVisible("obra", user.etapa, user.modulos_override);
  const verTrabajo = canRead(user.rol, "trabajo") && moduloVisible("trabajo", user.etapa, user.modulos_override);
  const verSeguridad = canRead(user.rol, "seguridad") && moduloVisible("seguridad", user.etapa, user.modulos_override);
  const verComisiones = canRead(user.rol, "comisiones");
  const verFinanzasDetalle = ROLES_FINANZAS_DETALLE.includes(user.rol);

  // Arranca desde el inicio del mes en curso (no desde "hoy") para que la
  // grilla visual del mes actual no le falten los días que ya pasaron.
  const desde = dayjs().startOf("month").format("YYYY-MM-DD");

  const [reuniones, jornadas, hitosObra, pagos, docsSeguridad, comisionesLista, usuariosLista] = await Promise.all([
    verComisiones
      ? all<any>(`SELECT * FROM reuniones WHERE estado='planificada' AND fecha >= ? ORDER BY fecha ASC LIMIT 40`, [desde])
      : Promise.resolve([] as any[]),
    verTrabajo
      ? all<any>(`SELECT * FROM jornadas_trabajo WHERE estado='planificada' AND fecha >= ? ORDER BY fecha ASC LIMIT 40`, [desde])
      : Promise.resolve([] as any[]),
    verObra
      ? all<any>(`SELECT * FROM tareas_obra WHERE estado != 'completada' AND fecha_fin_prevista IS NOT NULL AND fecha_fin_prevista >= ? ORDER BY fecha_fin_prevista ASC LIMIT 40`, [desde])
      : Promise.resolve([] as any[]),
    verFinanzasDetalle
      ? all<any>(`SELECT * FROM compromisos_futuros WHERE fecha_estimada >= ? ORDER BY fecha_estimada ASC LIMIT 40`, [desde])
      : Promise.resolve([] as any[]),
    verSeguridad
      ? all<any>(`SELECT * FROM documentos_seguridad WHERE fecha_vencimiento IS NOT NULL AND fecha_vencimiento >= ? ORDER BY fecha_vencimiento ASC LIMIT 40`, [desde])
      : Promise.resolve([] as any[]),
    // Rediseño del Calendario, Etapa 1 (25/09): listas para los selects de
    // "Responsable"/"Comisión" del formulario de actividad — mismo patrón ya
    // usado en /solicitudes, /reuniones, /comunicaciones, etc.
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`).catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 ORDER BY nombre ASC`).catch(() => []),
  ]);

  // Actividades de calendario (antes "notas de calendario", texto libre
  // nada más — ver el comentario grande en lib/actions/calendarioNotas.ts
  // sobre el rediseño de Etapa 1) — se guardan aparte de los eventos de cada
  // módulo, ver migrations/0015_notas_calendario.sql + 0042 (Etapa 1). Si esa
  // migración todavía no se corrió, la tabla no existe todavía — el catch
  // evita que la pantalla entera se rompa por eso; el resto del calendario
  // sigue andando.
  const notasRaw = await all<any>(
    `SELECT n.*, u.nombre as autor_nombre, r.nombre as responsable_nombre, c.nombre as comision_nombre,
            s.frecuencia as serie_frecuencia, s.fecha_fin as serie_fecha_fin
     FROM notas_calendario n
     LEFT JOIN users u ON u.id = n.autor_id
     LEFT JOIN users r ON r.id = n.responsable_id
     LEFT JOIN comisiones c ON c.id = n.comision_id
     LEFT JOIN series_calendario s ON s.id = n.serie_id
     WHERE n.fecha >= ? ORDER BY n.fecha ASC LIMIT 100`,
    [desde]
  ).catch(() => [] as any[]);

  // Rediseño del Calendario, Etapa 4 (26/09, punto 20): participantes de
  // cada actividad — tabla de unión nueva (migración 0044, ver
  // actions/calendarioNotas.ts sobre por qué no es un ARRAY). Mismo criterio
  // que notasRaw: si la migración todavía no corrió, el `.catch` evita que
  // se caiga toda la pantalla — el calendario sigue andando sin
  // participantes hasta que se aplique.
  const participantesRaw = await all<{ id: number; nota_id: number; usuario_id: number; nombre: string }>(
    `SELECT p.id, p.nota_id, p.usuario_id, u.nombre
     FROM actividad_participantes p
     JOIN users u ON u.id = p.usuario_id
     JOIN notas_calendario n ON n.id = p.nota_id
     WHERE n.fecha >= ? ORDER BY u.nombre ASC`,
    [desde]
  ).catch(() => [] as { id: number; nota_id: number; usuario_id: number; nombre: string }[]);
  const participantesPorNota = new Map<number, { id: number; usuarioId: number; nombre: string }[]>();
  for (const p of participantesRaw) {
    const arr = participantesPorNota.get(p.nota_id) || [];
    arr.push({ id: p.id, usuarioId: p.usuario_id, nombre: p.nombre });
    participantesPorNota.set(p.nota_id, arr);
  }

  const notas: NotaCalendario[] = notasRaw.map((n: any) => ({
    id: n.id,
    fecha: n.fecha,
    hora: n.hora,
    todoElDia: !!n.todo_el_dia,
    titulo: n.titulo,
    color: n.color,
    colorPersonalizado: n.color_personalizado ?? null,
    descripcion: n.descripcion ?? null,
    responsableId: n.responsable_id ?? null,
    responsableNombre: n.responsable_nombre ?? null,
    comisionId: n.comision_id ?? null,
    comisionNombre: n.comision_nombre ?? null,
    ubicacion: n.ubicacion ?? null,
    recordatorio: n.recordatorio ?? null,
    autorNombre: n.autor_nombre || "—",
    esPropia: n.autor_id === user.id || user.rol === "admin" || user.rol === "consejo_directivo",
    // Rediseño del Calendario, Etapa 2 (25/09): serie_id puede no existir
    // todavía si la migración 0043 no corrió — el `.catch(() => [])` de arriba
    // ya cubre esa columna faltando de la consulta entera (rompería el SELECT
    // n.* con serie_id ausente sólo si se la nombrara explícita, no es el
    // caso), así que acá alcanza con el `?? null` de siempre.
    serieId: n.serie_id ?? null,
    serieFrecuencia: n.serie_frecuencia ?? null,
    serieFechaFin: n.serie_fecha_fin ?? null,
    // Rediseño del Calendario, Etapa 4 (26/09): `esMia` (relevancia personal
    // para "Mi agenda"/filtro "Sólo lo mío") es DISTINTO de `esPropia`
    // (permiso de editar/borrar, arriba) — admin/consejo no ven todo como
    // "suyo" acá sólo porque puedan editarlo, ver el comentario del tipo en
    // MonthCalendar.tsx.
    participantes: participantesPorNota.get(n.id) ?? [],
    esMia: n.autor_id === user.id || n.responsable_id === user.id || (participantesPorNota.get(n.id) ?? []).some((p) => p.usuarioId === user.id),
  }));

  const eventos: Evento[] = [
    ...reuniones.map((r: any) => ({
      id: `r${r.id}`,
      fecha: r.fecha,
      titulo: r.titulo,
      sub: dayjs(r.fecha).format("HH:mm"),
      hora: dayjs(r.fecha).format("HH:mm"),
      tipo: (r.tipo === "asamblea" ? "asamblea" : "reunion") as Tipo,
      href: `/reuniones/${r.id}`,
    })),
    ...jornadas.map((j: any) => ({
      id: `j${j.id}`,
      fecha: j.fecha,
      titulo: "Jornada de trabajo",
      sub: j.descripcion || undefined,
      tipo: "jornada" as Tipo,
      href: `/trabajo/${j.id}`,
    })),
    ...hitosObra.map((h: any) => ({
      id: `o${h.id}`,
      fecha: h.fecha_fin_prevista,
      titulo: h.nombre,
      sub: "Hito de obra",
      tipo: "obra" as Tipo,
      href: `/obra/${h.id}`,
    })),
    ...pagos.map((p: any) => ({
      id: `f${p.id}`,
      fecha: p.fecha_estimada,
      titulo: p.descripcion,
      sub: `$${Math.round(p.monto).toLocaleString("es-UY")}`,
      tipo: "finanzas" as Tipo,
      href: "/finanzas",
    })),
    ...docsSeguridad.map((d: any) => ({
      id: `s${d.id}`,
      fecha: d.fecha_vencimiento,
      titulo: `Vence: ${d.tipo}`,
      sub: d.descripcion || undefined,
      tipo: "seguridad" as Tipo,
      href: "/seguridad",
    })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Agrupado en lenguaje cotidiano en vez de fechas técnicas — más fácil de
  // leer de un vistazo que una lista de fechas técnicas. Solo lo de hoy en
  // adelante: lo que ya pasó este mes se ve en la grilla visual de arriba,
  // no hace falta repetirlo acá abajo.
  const hoy = dayjs().format("YYYY-MM-DD");
  const en7dias = dayjs().add(7, "day").format("YYYY-MM-DD");
  const en30dias = dayjs().add(30, "day").format("YYYY-MM-DD");
  const eventosFuturos = eventos.filter((e) => e.fecha >= hoy);
  const grupos: { titulo: string; items: Evento[] }[] = [
    { titulo: "Esta semana", items: eventosFuturos.filter((e) => e.fecha <= en7dias) },
    { titulo: "Este mes", items: eventosFuturos.filter((e) => e.fecha > en7dias && e.fecha <= en30dias) },
    { titulo: "Más adelante", items: eventosFuturos.filter((e) => e.fecha > en30dias) },
  ].filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader title="Calendario" subtitle="Reuniones, jornadas, obra y vencimientos, todo junto" />

      <Card className="mb-6">
        <MonthCalendar
          eventos={eventos}
          notas={notas}
          comisiones={comisionesLista}
          usuarios={usuariosLista}
          crearNota={crearNotaCalendarioFormAction}
          editarNota={editarNotaCalendarioFormAction}
          eliminarNota={eliminarNotaCalendarioFormAction}
          moverNota={moverNotaCalendarioFormAction}
          agregarParticipante={agregarParticipanteActividadFormAction}
          quitarParticipante={quitarParticipanteActividadFormAction}
        />
      </Card>

      {grupos.length === 0 ? (
        <EmptyState>No hay nada agendado por ahora.</EmptyState>
      ) : (
        // Auditoría de espacio (sección 27-28, extendida del rediseño de
        // Compras al resto del sistema): antes, cada evento era una <Card>
        // completa (borde, sombra, padding grande) para una sola línea de
        // título+subtítulo+fecha — con varias reuniones/jornadas/vencimientos
        // en una misma semana esto se volvía una columna larga de cajas
        // repetidas. Se reemplaza por una sola Card por grupo con filas
        // compactas separadas por línea divisoria (mismo patrón ya usado en
        // nucleos/[id] para las asistencias).
        <div className="space-y-6">
          {grupos.map((g) => (
            <div key={g.titulo}>
              <SectionTitle>{g.titulo}</SectionTitle>
              <Card>
                <div className="divide-y divide-ink/5">
                  {g.items.map((e) => (
                    <Link key={e.id} href={e.href} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-70 transition-opacity">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{e.titulo}</p>
                        <p className="text-xs text-ink/50 mt-0.5">
                          {TIPO_LABEL[e.tipo]}
                          {e.sub ? ` · ${e.sub}` : ""}
                        </p>
                      </div>
                      <Badge color={TIPO_COLOR[e.tipo]}>{dayjs(e.fecha).format("dddd DD/MM")}</Badge>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
