import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { moduloVisible } from "@/components/Nav";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { MonthCalendar, type EventoCalendario, type NotaCalendario } from "@/components/MonthCalendar";
import { crearNotaCalendarioAction, editarNotaCalendarioAction, eliminarNotaCalendarioAction } from "@/lib/actions/calendarioNotas";
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

  const [reuniones, jornadas, hitosObra, pagos, docsSeguridad] = await Promise.all([
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
  ]);

  // Notas de calendario personalizadas (texto libre, cualquiera puede
  // escribir una) — se guardan aparte de los eventos de cada módulo, ver
  // migrations/0015_notas_calendario.sql.
  const notasRaw = await all<any>(
    `SELECT n.*, u.nombre as autor_nombre FROM notas_calendario n LEFT JOIN users u ON u.id = n.autor_id WHERE n.fecha >= ? ORDER BY n.fecha ASC LIMIT 100`,
    [desde]
  );
  const notas: NotaCalendario[] = notasRaw.map((n: any) => ({
    id: n.id,
    fecha: n.fecha,
    hora: n.hora,
    titulo: n.titulo,
    color: n.color,
    autorNombre: n.autor_nombre || "—",
    esPropia: n.autor_id === user.id || user.rol === "admin" || user.rol === "consejo_directivo",
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
          crearNota={crearNotaCalendarioAction}
          editarNota={editarNotaCalendarioAction}
          eliminarNota={eliminarNotaCalendarioAction}
        />
      </Card>

      {grupos.length === 0 ? (
        <EmptyState>No hay nada agendado por ahora.</EmptyState>
      ) : (
        <div className="space-y-6">
          {grupos.map((g) => (
            <div key={g.titulo}>
              <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">{g.titulo}</h3>
              <div className="space-y-2">
                {g.items.map((e) => (
                  <Card key={e.id}>
                    <Link href={e.href} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{e.titulo}</p>
                        <p className="text-xs text-ink/50 mt-0.5">
                          {TIPO_LABEL[e.tipo]}
                          {e.sub ? ` · ${e.sub}` : ""}
                        </p>
                      </div>
                      <Badge color={TIPO_COLOR[e.tipo]}>{dayjs(e.fecha).format("dddd DD/MM")}</Badge>
                    </Link>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
