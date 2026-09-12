import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Badge } from "@/components/ui";
import dayjs from "dayjs";

/**
 * Fase 7 del Plan Maestro ("Navegación transversal"), hallazgo H-9: hasta
 * ahora `nucleos_familiares` (el motor de Trabajo/ayuda mutua — cuota
 * social, horas acumuladas, habilidades) no tenía ninguna página de
 * detalle propia, así que su nombre aparecía como texto suelto en todos
 * lados (/trabajo, asistencia a reuniones, padrón de socios).
 *
 * Ver la "Nota de diseño importante" de REQUIREMENTS.md sección 3 y su
 * resolución para Contactos en la sección 5.5: `nucleos_familiares` y
 * `socios`+`socio_integrantes` siguen siendo dos modelos de datos
 * DISTINTOS, cruzados solo opcionalmente vía `socios.nucleo_id` — esta
 * página no los fusiona, solo reúne en un solo lugar lo que ya existe
 * sobre un núcleo puntual: sus datos propios (cuota, horas, habilidades),
 * los socios que le corresponden (cruce de solo lectura vía `nucleo_id`,
 * cada uno enlazado a su propia ficha) y su historial en Trabajo y
 * Reuniones (cada fila enlazada a la jornada o reunión real).
 *
 * Gateada con `canRead(rol, "trabajo")` — igual que `/trabajo`, que es de
 * donde sale la inmensa mayoría de los enlaces hacia acá — y "trabajo" es,
 * como "socios" y "comisiones", un módulo de lectura universal (ningún rol
 * tiene "none"), así que cualquier lugar que ya enlace a un núcleo (padrón
 * de socios, asistencia a reuniones) puede hacerlo sin romper permisos.
 */
export default async function NucleoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "trabajo")) redirect("/dashboard");

  const nucleo = await get<any>(`SELECT * FROM nucleos_familiares WHERE id = ?`, [id]);
  if (!nucleo) notFound();

  const [habilidades, socios, asistenciasJornada, asistenciasReunion] = await Promise.all([
    all<{ habilidad: string }>(`SELECT habilidad FROM habilidades_nucleo WHERE nucleo_id = ?`, [id]).catch(() => []),
    all<any>(`SELECT id, nombre, estado FROM socios WHERE nucleo_id = ? ORDER BY nombre ASC`, [id]).catch(() => []),
    all<any>(
      `SELECT a.*, j.fecha as jornada_fecha, j.descripcion as jornada_descripcion, j.id as jornada_id
       FROM asistencias a JOIN jornadas_trabajo j ON j.id = a.jornada_id
       WHERE a.nucleo_id = ? ORDER BY j.fecha DESC LIMIT 20`,
      [id]
    ).catch(() => []),
    all<any>(
      `SELECT ra.*, r.titulo, r.fecha, r.id as reunion_id
       FROM reunion_asistencias ra JOIN reuniones r ON r.id = ra.reunion_id
       WHERE ra.nucleo_id = ? ORDER BY r.fecha DESC LIMIT 20`,
      [id]
    ).catch(() => []),
  ]);

  return (
    <div>
      <PageHeader title={nucleo.nombre} subtitle="Núcleo familiar — motor de Trabajo y ayuda mutua" />

      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div><span className="text-ink/50">Cuota social:</span> ${Math.round(nucleo.cuota_social || 0).toLocaleString("es-UY")}</div>
          <div><span className="text-ink/50">Horas acumuladas:</span> {nucleo.horas_acumuladas || 0}</div>
          <div><span className="text-ink/50">Objetivo semanal:</span> {nucleo.horas_semanales_objetivo || 0} hs</div>
        </div>
        {habilidades.length > 0 && (
          <div className="mt-3 pt-3 border-t border-ink/5 flex flex-wrap gap-1.5">
            {habilidades.map((h, i) => (
              <Badge key={i} color="gray">{h.habilidad}</Badge>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle>Socios de este núcleo</SectionTitle>
      <Card className="mb-6">
        {socios.length === 0 ? (
          <EmptyState>Ningún socio del padrón está vinculado a este núcleo todavía.</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-2">
            {socios.map((s) => (
              <Link key={s.id} href={`/socios/${s.id}`}>
                <Badge color={s.estado === "baja" ? "gray" : "brand"}>{s.nombre}</Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle>Asistencia a jornadas de trabajo</SectionTitle>
      <Card className="mb-6">
        {asistenciasJornada.length === 0 ? (
          <EmptyState>Sin jornadas registradas todavía.</EmptyState>
        ) : (
          <div className="divide-y divide-ink/5">
            {asistenciasJornada.map((a) => (
              <div key={a.id} className="py-2 text-sm flex items-center justify-between gap-2">
                <Link href={`/trabajo/${a.jornada_id}`} className="hover:underline underline-offset-2 min-w-0 truncate">
                  {dayjs(a.jornada_fecha).format("DD/MM/YYYY")} — {a.jornada_descripcion || "Jornada de trabajo"}
                </Link>
                <span className="text-xs text-ink/50 shrink-0">
                  {a.presente ? `✅ ${a.horas || 0} hs` : "— sin asistencia"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle>Asistencia a reuniones</SectionTitle>
      <Card>
        {asistenciasReunion.length === 0 ? (
          <EmptyState>Sin reuniones registradas todavía.</EmptyState>
        ) : (
          <div className="divide-y divide-ink/5">
            {asistenciasReunion.map((r) => (
              <div key={r.id} className="py-2 text-sm flex items-center justify-between gap-2">
                <Link href={`/reuniones/${r.reunion_id}`} className="hover:underline underline-offset-2 min-w-0 truncate">
                  {dayjs(r.fecha).format("DD/MM/YYYY")} — {r.titulo}
                </Link>
                <span className="text-xs text-ink/50 shrink-0">{r.presente ? "✅ Presente" : "— Ausente"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
