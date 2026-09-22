import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import Link from "next/link";
import { CrearReunionForm } from "@/components/reuniones/ReunionesFormularios";

// Sub-fase 1.3 ("Asambleas como módulo propio", 22/09): NO se duplica nada
// de /reuniones — una Asamblea sigue siendo una fila de "reuniones" con
// tipo='asamblea', con su agenda/invitados/asistencia/acta manejados ahí
// mismo. Esta página es la vista propia que le faltaba: convocatoria formal
// (tipo_asamblea/convocatoria/fecha_convocatoria, migración 0032) y el
// quórum informativo, en un solo lugar en vez de mezclado entre todas las
// reuniones de comisiones.
//
// Guardrail no-negociable de esta fase: el "quórum" que se muestra abajo es
// SOLO informativo (presentes/total núcleos, el mismo dato que ya calcula
// /reuniones/[id]) — el sistema nunca decide ni muestra si una asamblea
// "cumple" o "no cumple" quórum. Esa evaluación depende del estatuto de cada
// cooperativa y de la ley, y queda deliberadamente fuera de este sistema.

const TIPO_ASAMBLEA_LABEL: Record<string, string> = { ordinaria: "Ordinaria", extraordinaria: "Extraordinaria" };
const CONVOCATORIA_LABEL: Record<string, string> = { primera: "1ª convocatoria", segunda: "2ª convocatoria" };
const ESTADO_COLOR: Record<string, "verde" | "amarillo" | "rojo" | "brand" | "gray"> = {
  planificada: "brand",
  realizada: "verde",
  cancelada: "gray",
};

export default async function AsambleasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeConvocar = canEdit(user.rol, "finanzas"); // mismo criterio de "conducción" que ya usa /reuniones

  const [asambleas, totalNucleosRow, comisionesActivas] = await Promise.all([
    all<any>(
      `SELECT r.*,
        (SELECT COUNT(*) FROM reunion_asistencias ra WHERE ra.reunion_id = r.id AND ra.presente = 1) as presentes,
        (SELECT COUNT(*) FROM decisiones_comision d WHERE d.reunion_id = r.id) as decisiones,
        (SELECT id FROM actas a WHERE a.reunion_id = r.id) as acta_id
       FROM reuniones r WHERE r.tipo = 'asamblea' ORDER BY r.fecha DESC`
    ),
    get<{ total: string }>(`SELECT COUNT(*) as total FROM nucleos_familiares`),
    all<any>(`SELECT * FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
  ]);
  const totalNucleos = Number(totalNucleosRow?.total || 0);

  const proximas = asambleas.filter((a) => a.estado === "planificada");
  const pasadas = asambleas.filter((a) => a.estado !== "planificada");

  const Fila = ({ a }: { a: any }) => {
    const antelacionDias = a.fecha_convocatoria ? dayjs(a.fecha).diff(dayjs(a.fecha_convocatoria), "day") : null;
    return (
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-1">
          <p className="text-sm font-semibold text-[var(--color-brand-900)]">{a.titulo}</p>
          <div className="flex gap-1.5 flex-wrap">
            <Badge color={ESTADO_COLOR[a.estado] ?? "gray"}>{a.estado}</Badge>
            {a.tipo_asamblea && <Badge color="brand">{TIPO_ASAMBLEA_LABEL[a.tipo_asamblea] ?? a.tipo_asamblea}</Badge>}
            {a.convocatoria && <Badge color="gray">{CONVOCATORIA_LABEL[a.convocatoria] ?? a.convocatoria}</Badge>}
          </div>
        </div>
        <p className="text-xs text-ink/50 mt-0.5">
          {dayjs(a.fecha).format("DD/MM/YYYY HH:mm")}
          {a.lugar ? ` · ${a.lugar}` : ""}
        </p>
        {a.fecha_convocatoria && (
          <p className="text-xs text-ink/40 mt-0.5">
            Convocada el {dayjs(a.fecha_convocatoria).format("DD/MM/YYYY")}
            {antelacionDias !== null && antelacionDias >= 0 ? ` (${antelacionDias} día(s) de anticipación)` : ""}
          </p>
        )}
        <p className="text-xs text-ink/60 mt-1.5">
          Asistencia registrada: {a.presentes}/{totalNucleos} núcleos
          {a.decisiones > 0 ? ` · ${a.decisiones} decisión(es) registrada(s)` : ""}
          {a.acta_id ? " · acta generada" : ""}
        </p>
        <div className="flex gap-3 mt-2">
          <Link href={`/reuniones/${a.id}`} className="text-xs text-[var(--color-brand-800)] underline">
            Ver reunión completa (agenda, asistencia, acta)
          </Link>
          {a.decisiones > 0 && (
            <Link href="/decisiones" className="text-xs text-[var(--color-brand-800)] underline">
              Ver decisiones
            </Link>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div>
      <PageHeader title="Asambleas" subtitle="Convocatoria, asistencia y actas de las asambleas de la cooperativa" />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          ⚖️ La asistencia que se muestra abajo es informativa (presentes sobre el total de núcleos de la cooperativa).
          El sistema no evalúa ni declara si una asamblea cumple el quórum exigido por el estatuto — esa decisión
          queda en manos del Consejo Directivo y de quien preside la asamblea.
        </p>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Próximas</h3>
      <div className="space-y-2 mb-6">
        {proximas.map((a) => <Fila key={a.id} a={a} />)}
        {proximas.length === 0 && <EmptyState>No hay asambleas planificadas.</EmptyState>}
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Historial</h3>
        <div className="space-y-2">
          {pasadas.map((a) => <Fila key={a.id} a={a} />)}
          {pasadas.length === 0 && <EmptyState>Sin asambleas anteriores.</EmptyState>}
        </div>
      </div>

      {puedeConvocar && (
        <CrearReunionForm comisiones={comisionesActivas} esOversightReuniones={puedeConvocar} tipoInicial="asamblea" />
      )}
    </div>
  );
}
