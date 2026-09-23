import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, StatTile } from "@/components/ui";
import { CARGO_LABEL, type CargoConsejo } from "@/lib/consejoDirectivoCargos";
import { obtenerReglasCooperativa } from "@/lib/reglas";
import dayjs from "dayjs";

// Fase 2 ("Transparencia, Auditoría, Historial, Cumplimiento", sección 37) —
// Sub-fase 2.4: Centro de Cumplimiento (sección 15).
//
// El texto original de la sección 15 no se pudo recuperar (se perdió en la
// misma compactación que perdió el resto del prompt de 44 secciones, y el
// usuario confirmó que tampoco lo tiene) — a diferencia de las sub-fases
// 2.1/2.2/2.3, donde sí hubo texto o una interpretación clara para
// confirmar, acá se le propuso al usuario un alcance concreto (este mismo,
// los 5 puntos de abajo) y lo confirmó ANTES de escribir código, siguiendo
// el mismo criterio de esta fase de no inventar contenido legalmente
// significativo sin decírselo primero.
//
// Guardrail no negociable (mismo que ya rige Asambleas desde la Sub-fase
// 1.3): esta pantalla NUNCA declara si algo "cumple" o "no cumple" — solo
// muestra hechos ya calculables con datos existentes (fechas, conteos,
// vacantes), sin juicio legal de ningún tipo. La decisión de qué hacer con
// cada hecho queda en manos de las personas/órganos competentes.
//
// Ningún dato de acá es nuevo: todo se lee de tablas que ya existen
// (documentos, reuniones, reportes_generados, consejo_directivo_cargos).
// Sin tabla nueva, sin migración.
export default async function CumplimientoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Mismo "mod" que ya usan Panel Fiscal y Auditoría (canRead(rol,
  // "auditoria")) — el mismo grupo de control (tesorería, consejo
  // directivo, fiscal, admin). No se amplía ni se restringe ningún permiso
  // existente, se reutiliza el más estricto que ya protegía contenido
  // parecido (ver también Nav.tsx).
  if (!canRead(user.rol, "auditoria")) redirect("/dashboard");

  const hoy = dayjs();
  const hoyStr = hoy.format("YYYY-MM-DD");
  const inicioAno = hoy.startOf("year").format("YYYY-MM-DD");
  // Fase 3, Sub-fase 3.1 ("Reglas de la cooperativa"): mismo umbral
  // configurable que usa recalcularAlertas() para "documento_por_vencer" —
  // antes hardcodeado en 15 acá también. Ver src/lib/reglas.ts.
  const reglas = await obtenerReglasCooperativa();

  const [documentosConVencimiento, ultimaAsambleaOrdinaria, reunionesPendientesDeCerrar, informesFiscales, cargosVigentes] = await Promise.all([
    // Mismo criterio y mismos umbrales que ya usa recalcularAlertas() para
    // "documento_vencido"/"documento_por_vencer" sobre documentos en
    // general (lib/logic.ts): se excluyen archivados y versiones
    // reemplazadas por otra más nueva (reemplaza_a_id), para no generar
    // ruido sobre algo que ya salió de circulación.
    all<{ id: number; nombre: string; fecha_vencimiento: string }>(
      `SELECT d.id, d.nombre, d.fecha_vencimiento FROM documentos d
       WHERE d.fecha_vencimiento IS NOT NULL AND d.estado != 'archivado'
         AND NOT EXISTS (SELECT 1 FROM documentos d2 WHERE d2.reemplaza_a_id = d.id)
       ORDER BY d.fecha_vencimiento ASC`
    ).catch(() => [] as { id: number; nombre: string; fecha_vencimiento: string }[]),
    // Solo el HECHO de si hubo o no una Asamblea Ordinaria realizada este
    // año calendario, y cuándo — nunca un veredicto de si eso alcanza para
    // cumplir con el estatuto (eso depende de reglas propias de cada
    // cooperativa que este sistema no arbitra, mismo criterio que
    // Asambleas). `.catch()` por si la migración 0032 (tipo_asamblea)
    // todavía no corrió en esta base.
    get<{ fecha: string }>(
      `SELECT fecha FROM reuniones
       WHERE tipo = 'asamblea' AND tipo_asamblea = 'ordinaria' AND estado = 'realizada' AND fecha::date >= ?::date
       ORDER BY fecha DESC LIMIT 1`,
      [inicioAno]
    ).catch(() => null),
    // Hallazgo de esta sub-fase: "reuniones realizadas sin acta" (la idea
    // original propuesta) no puede pasar nunca — cerrarReunionAction
    // (actions/reuniones.ts) siempre pone estado='realizada' y acta_id en
    // la MISMA actualización, así que toda reunión "realizada" ya tiene
    // acta por construcción. La señal real y útil en su lugar es esta:
    // reuniones que se PLANIFICARON para una fecha que ya pasó y siguen sin
    // cerrarse (ni realizadas ni canceladas) — esas sí quedan pendientes de
    // una acción real de alguien.
    all<{ id: number; titulo: string; fecha: string; tipo: string }>(
      `SELECT id, titulo, fecha, tipo FROM reuniones
       WHERE estado = 'planificada' AND fecha::date < ?::date
       ORDER BY fecha ASC LIMIT 10`,
      [hoyStr]
    ).catch(() => [] as { id: number; titulo: string; fecha: string; tipo: string }[]),
    // Mismo dato que ya muestra /fiscal, acá solo el conteo y la fecha del
    // último — no se repite la lista completa ni la descarga (eso sigue
    // viviendo únicamente en el Panel Fiscal).
    all<{ creado_en: string }>(
      `SELECT creado_en FROM reportes_generados WHERE tipo = 'informe_fiscal' ORDER BY creado_en DESC`
    ).catch(() => [] as { creado_en: string }[]),
    all<{ cargo: string }>(
      `SELECT cargo FROM consejo_directivo_cargos WHERE fecha_fin IS NULL AND cargo IN ('presidente','secretario','tesorero')`
    ).catch(() => [] as { cargo: string }[]),
  ]);

  const documentosVencidos = documentosConVencimiento.filter((d) => dayjs(d.fecha_vencimiento).diff(hoy, "day") < 0);
  const documentosPorVencer = documentosConVencimiento.filter((d) => {
    const dias = dayjs(d.fecha_vencimiento).diff(hoy, "day");
    return dias >= 0 && dias <= reglas.diasAlertaVencimiento;
  });

  const CARGOS_UNIPERSONALES: CargoConsejo[] = ["presidente", "secretario", "tesorero"];
  const cargosOcupados = new Set(cargosVigentes.map((c) => c.cargo));
  const cargosVacantes = CARGOS_UNIPERSONALES.filter((c) => !cargosOcupados.has(c));

  return (
    <div>
      <PageHeader
        title="Centro de Cumplimiento"
        subtitle="Hechos de cumplimiento administrativo de toda la cooperativa, reunidos en un solo lugar"
      />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          🔎 Esta pantalla solo muestra hechos ya registrados en el sistema (fechas, conteos, vacantes) — nunca declara si
          la cooperativa &quot;cumple&quot; o no con una obligación legal o estatutaria. Esa evaluación es siempre de las
          personas y órganos competentes.
        </p>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile label="Documentos vencidos" value={String(documentosVencidos.length)} color={documentosVencidos.length > 0 ? "rojo" : "verde"} />
        <StatTile label={`Por vencer (${reglas.diasAlertaVencimiento} días)`} value={String(documentosPorVencer.length)} color={documentosPorVencer.length > 0 ? "amarillo" : "verde"} />
        <StatTile label="Reuniones vencidas sin cerrar" value={String(reunionesPendientesDeCerrar.length)} color={reunionesPendientesDeCerrar.length > 0 ? "amarillo" : "verde"} />
        <StatTile label="Cargos vacantes (Consejo)" value={String(cargosVacantes.length)} color={cargosVacantes.length > 0 ? "rojo" : "verde"} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Documentos vencidos</h3>
          <div className="space-y-1.5">
            {documentosVencidos.length === 0 && <EmptyState>Sin documentos vencidos.</EmptyState>}
            {documentosVencidos.map((d) => (
              <Card key={d.id} className="!py-2">
                <p className="text-xs">{d.nombre}</p>
                <p className="text-xs text-ink/40">Venció el {dayjs(d.fecha_vencimiento).format("DD/MM/YYYY")}</p>
              </Card>
            ))}
          </div>
          <Link href="/documentos" className="text-xs text-[var(--color-brand-800)] underline mt-1.5 inline-block">Ver Documentos completo</Link>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Próximos a vencer ({reglas.diasAlertaVencimiento} días)</h3>
          <div className="space-y-1.5">
            {documentosPorVencer.length === 0 && <EmptyState>Sin documentos próximos a vencer.</EmptyState>}
            {documentosPorVencer.map((d) => (
              <Card key={d.id} className="!py-2">
                <p className="text-xs">{d.nombre}</p>
                <p className="text-xs text-ink/40">Vence el {dayjs(d.fecha_vencimiento).format("DD/MM/YYYY")}</p>
              </Card>
            ))}
          </div>
          <Link href="/documentos" className="text-xs text-[var(--color-brand-800)] underline mt-1.5 inline-block">Ver Documentos completo</Link>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Asamblea Ordinaria este año</h3>
          <Card>
            {ultimaAsambleaOrdinaria ? (
              <p className="text-xs text-ink/70">
                Última registrada: <strong>{dayjs(ultimaAsambleaOrdinaria.fecha).format("DD/MM/YYYY")}</strong>
              </p>
            ) : (
              <EmptyState>No hay ninguna Asamblea Ordinaria registrada como realizada este año.</EmptyState>
            )}
          </Card>
          <Link href="/asambleas" className="text-xs text-[var(--color-brand-800)] underline mt-1.5 inline-block">Ver Asambleas completo</Link>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Reuniones vencidas sin cerrar</h3>
          <div className="space-y-1.5">
            {reunionesPendientesDeCerrar.length === 0 && <EmptyState>Sin reuniones pendientes.</EmptyState>}
            {reunionesPendientesDeCerrar.map((r) => (
              <Card key={r.id} className="!py-2">
                <Link href={`/reuniones/${r.id}`} className="text-xs hover:underline underline-offset-2">{r.titulo}</Link>
                <p className="text-xs text-ink/40">Planificada para el {dayjs(r.fecha).format("DD/MM/YYYY")}</p>
              </Card>
            ))}
          </div>
          <Link href="/reuniones" className="text-xs text-[var(--color-brand-800)] underline mt-1.5 inline-block">Ver Reuniones completo</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Cargos del Consejo Directivo</h3>
          <Card>
            {cargosVacantes.length === 0 ? (
              <p className="text-xs text-[var(--color-verde)]">Presidente, Secretario y Tesorero tienen titular vigente.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {cargosVacantes.map((c) => (
                  <Badge key={c} color="rojo">{CARGO_LABEL[c]} vacante</Badge>
                ))}
              </div>
            )}
          </Card>
          <Link href="/consejo-directivo" className="text-xs text-[var(--color-brand-800)] underline mt-1.5 inline-block">Ver Consejo Directivo completo</Link>
        </div>

        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Informes de la Comisión Fiscal</h3>
          <Card>
            {informesFiscales.length === 0 ? (
              <EmptyState>Todavía no se generó ningún informe.</EmptyState>
            ) : (
              <p className="text-xs text-ink/70">
                <strong>{informesFiscales.length}</strong> informe(s) generado(s) — el último el{" "}
                <strong>{dayjs(informesFiscales[0].creado_en).format("DD/MM/YYYY")}</strong>.
              </p>
            )}
          </Card>
          <Link href="/fiscal" className="text-xs text-[var(--color-brand-800)] underline mt-1.5 inline-block">Ver Panel Fiscal completo</Link>
        </div>
      </div>
    </div>
  );
}
