import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, canApprove } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import Link from "next/link";
import { CrearReunionForm } from "@/components/reuniones/ReunionesFormularios";
import { AsignarCargoForm, FinalizarCargoForm } from "@/components/consejoDirectivo/ConsejoDirectivoFormularios";
import { CARGO_LABEL, type CargoConsejo } from "@/lib/consejoDirectivoCargos";

// Sub-fase 1.4 ("Consejo Directivo como módulo propio", 22/09): mismo
// criterio que Asambleas (Sub-fase 1.3) — NO se duplica nada de /reuniones,
// una reunión de Consejo Directivo sigue siendo una fila de "reuniones" con
// tipo='consejo_directivo', con su agenda/asistencia/acta manejados ahí
// mismo. Lo nuevo acá es la vista propia más el registro de composición
// por cargo (migración 0033) que faltaba — ver ese archivo para el porqué.
//
// Guardrail no-negociable: la composición de cargos es solo un registro
// documental para actas y representación institucional. No otorga ni
// quita ningún permiso — canRead/canEdit/canApprove siguen dependiendo
// exclusivamente de users.rol, sin excepción.

const ESTADO_COLOR: Record<string, "verde" | "amarillo" | "rojo" | "brand" | "gray"> = {
  planificada: "brand",
  realizada: "verde",
  cancelada: "gray",
};

const ORDEN_CARGO: Record<CargoConsejo, number> = { presidente: 1, secretario: 2, tesorero: 3, vocal: 4 };

export default async function ConsejoDirectivoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeConvocar = canEdit(user.rol, "finanzas"); // mismo criterio de "conducción" que ya usa /reuniones y /asambleas
  const puedeGestionarCargos = canApprove(user.rol, "comisiones"); // formalizar quién ocupa un cargo es un acto de gobierno

  // .catch(() => []): la tabla consejo_directivo_cargos es nueva en esta
  // sub-fase (migración 0033) — si todavía no corrió, la página no debe
  // romperse, solo mostrar la composición como "sin cargos asignados
  // todavía" (lección aplicada desde el diseño, no como parche después).
  const [reuniones, vigentes, historial, integrantes, comisionesActivas] = await Promise.all([
    all<any>(
      `SELECT r.*,
        (SELECT COUNT(*) FROM reunion_asistencias ra WHERE ra.reunion_id = r.id AND ra.presente = 1) as presentes,
        (SELECT COUNT(*) FROM decisiones_comision d WHERE d.reunion_id = r.id) as decisiones,
        (SELECT id FROM actas a WHERE a.reunion_id = r.id) as acta_id
       FROM reuniones r WHERE r.tipo = 'consejo_directivo' ORDER BY r.fecha DESC`
    ),
    all<any>(
      `SELECT c.*, u.nombre as nombre_usuario FROM consejo_directivo_cargos c
       JOIN users u ON u.id = c.user_id WHERE c.fecha_fin IS NULL ORDER BY c.fecha_inicio ASC`
    ).catch(() => []),
    all<any>(
      `SELECT c.*, u.nombre as nombre_usuario FROM consejo_directivo_cargos c
       JOIN users u ON u.id = c.user_id WHERE c.fecha_fin IS NOT NULL ORDER BY c.fecha_fin DESC`
    ).catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE rol = 'consejo_directivo' AND activo = 1 ORDER BY nombre ASC`),
    all<any>(`SELECT * FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
  ]);
  const totalNucleosRow = await get<{ total: string }>(`SELECT COUNT(*) as total FROM nucleos_familiares`);
  const totalNucleos = Number(totalNucleosRow?.total || 0);

  const vigentesOrdenados = [...vigentes].sort((a, b) => ORDEN_CARGO[a.cargo as CargoConsejo] - ORDEN_CARGO[b.cargo as CargoConsejo]);
  const proximas = reuniones.filter((r) => r.estado === "planificada");
  const pasadas = reuniones.filter((r) => r.estado !== "planificada");

  const FilaReunion = ({ r }: { r: any }) => (
    <Card>
      <div className="flex items-center justify-between flex-wrap gap-1">
        <p className="text-sm font-semibold text-[var(--color-brand-900)]">{r.titulo}</p>
        <Badge color={ESTADO_COLOR[r.estado] ?? "gray"}>{r.estado}</Badge>
      </div>
      <p className="text-xs text-ink/50 mt-0.5">
        {dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}
        {r.lugar ? ` · ${r.lugar}` : ""}
      </p>
      <p className="text-xs text-ink/60 mt-1.5">
        Asistencia registrada: {r.presentes}/{totalNucleos} núcleos
        {r.decisiones > 0 ? ` · ${r.decisiones} decisión(es) registrada(s)` : ""}
        {r.acta_id ? " · acta generada" : ""}
      </p>
      <div className="flex gap-3 mt-2">
        <Link href={`/reuniones/${r.id}`} className="text-xs text-[var(--color-brand-800)] underline">
          Ver reunión completa (agenda, asistencia, acta)
        </Link>
        {r.decisiones > 0 && (
          <Link href="/decisiones" className="text-xs text-[var(--color-brand-800)] underline">
            Ver decisiones
          </Link>
        )}
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Consejo Directivo" subtitle="Composición de cargos, reuniones y actas del Consejo Directivo" />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          📋 Este registro de composición es documental — para actas y representación institucional. No modifica ningún
          permiso del sistema: el acceso de cada persona sigue dependiendo únicamente de su rol.
        </p>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Composición actual</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        {vigentesOrdenados.length === 0 && (
          <div className="sm:col-span-2">
            <EmptyState>Todavía no hay cargos asignados.</EmptyState>
          </div>
        )}
        {vigentesOrdenados.map((c) => (
          <Card key={c.id}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <Badge color="brand">{CARGO_LABEL[c.cargo as CargoConsejo] ?? c.cargo}</Badge>
                <p className="text-sm font-semibold text-[var(--color-brand-900)] mt-1">{c.nombre_usuario}</p>
                <p className="text-xs text-ink/40">Desde {dayjs(c.fecha_inicio).format("DD/MM/YYYY")}</p>
              </div>
              {puedeGestionarCargos && <FinalizarCargoForm id={c.id} />}
            </div>
          </Card>
        ))}
      </div>
      {puedeGestionarCargos && <div className="mb-6"><AsignarCargoForm integrantes={integrantes} /></div>}

      {historial.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Historial de mandatos</h3>
          <div className="space-y-1.5">
            {historial.map((c: any) => (
              <p key={c.id} className="text-xs text-ink/50">
                {CARGO_LABEL[c.cargo as CargoConsejo] ?? c.cargo} — {c.nombre_usuario} ({dayjs(c.fecha_inicio).format("DD/MM/YYYY")} a{" "}
                {dayjs(c.fecha_fin).format("DD/MM/YYYY")})
              </p>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Próximas reuniones</h3>
      <div className="space-y-2 mb-6">
        {proximas.map((r) => <FilaReunion key={r.id} r={r} />)}
        {proximas.length === 0 && <EmptyState>No hay reuniones de Consejo Directivo planificadas.</EmptyState>}
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Historial de reuniones</h3>
        <div className="space-y-2">
          {pasadas.map((r) => <FilaReunion key={r.id} r={r} />)}
          {pasadas.length === 0 && <EmptyState>Sin reuniones anteriores.</EmptyState>}
        </div>
      </div>

      {puedeConvocar && (
        <CrearReunionForm comisiones={comisionesActivas} esOversightReuniones={puedeConvocar} tipoInicial="consejo_directivo" />
      )}
    </div>
  );
}
