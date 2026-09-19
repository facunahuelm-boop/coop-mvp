import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import { CrearDecisionForm } from "@/components/decisiones/DecisionesFormularios";
import { ResultadoDecisionBadge, RESULTADO_DECISION, resultadoDecisionLabel } from "@/components/decisiones/DecisionStatus";
import { ResumenDecisiones, type ResumenTileDef, type ResumenTileItem } from "@/components/decisiones/ResumenDecisiones";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";

// Fase 6 del sistema de gestión de Comisiones (19/09, pedido explícito,
// sección "decisiones/votaciones"). Mismo patrón visual que Solicitudes:
// resumen con pop-up + filtros arriba + tabla compacta con modal de detalle
// liviano que linkea a la ficha completa /decisiones/[id] (donde viven las
// acciones reales: editar/decidir/reabrir/votación — ver esa página).
//
// Consultas contra decisiones_comision con `.catch(() => [])` por si esta
// fase se despliega antes de que el usuario corra la migración 0029 en
// producción — mismo criterio defensivo que Solicitudes y Reuniones.
export default async function DecisionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");
  const esOversight = canEdit(user.rol, "finanzas");

  type DecisionRow = {
    id: number;
    numero: string | null;
    comision_id: number;
    comision_nombre: string;
    tema: string;
    propuesta: string | null;
    resultado: string;
    fecha: string;
    decidido_por_nombre: string | null;
  };

  const [decisionesRaw, comisionesActivas, misComisiones] = await Promise.all([
    all<DecisionRow>(
      `SELECT d.*, c.nombre as comision_nombre, u.nombre as decidido_por_nombre
       FROM decisiones_comision d
       JOIN comisiones c ON c.id = d.comision_id
       LEFT JOIN users u ON u.id = d.decidido_por_id
       ORDER BY (d.resultado = 'pendiente') DESC, d.fecha DESC`
    ).catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));
  const decisiones = esOversight ? decisionesRaw : decisionesRaw.filter((d) => misComisionIds.has(d.comision_id));
  const comisionesDisponibles = esOversight ? comisionesActivas : comisionesActivas.filter((c) => misComisionIds.has(c.id));

  const pendientes = decisiones.filter((d) => d.resultado === "pendiente");
  const aprobadas = decisiones.filter((d) => d.resultado === "aprobada");
  const rechazadas = decisiones.filter((d) => d.resultado === "rechazada");
  const esteMes = decisiones.filter((d) => d.resultado !== "pendiente" && dayjs(d.fecha).isAfter(dayjs().startOf("month")));

  const itemDe = (d: DecisionRow): ResumenTileItem => ({
    label: `${d.numero || "#" + d.id} · ${d.tema}`,
    sublabel: d.comision_nombre,
    href: `/decisiones/${d.id}`,
  });

  const tiles: ResumenTileDef[] = [
    {
      id: "pendientes",
      label: "Pendientes",
      value: String(pendientes.length),
      color: pendientes.length > 0 ? "amarillo" : "verde",
      items: pendientes.map(itemDe),
      vacioTexto: "No hay decisiones pendientes.",
    },
    {
      id: "aprobadas",
      label: "Aprobadas",
      value: String(aprobadas.length),
      color: "verde",
      items: aprobadas.map(itemDe),
      vacioTexto: "Todavía no se aprobó ninguna decisión.",
    },
    {
      id: "rechazadas",
      label: "Rechazadas",
      value: String(rechazadas.length),
      items: rechazadas.map(itemDe),
      vacioTexto: "No hay decisiones rechazadas.",
    },
    {
      id: "mes",
      label: "Resueltas este mes",
      value: String(esteMes.length),
      color: "verde",
      items: esteMes.map(itemDe),
      vacioTexto: "Todavía no se resolvió ninguna este mes.",
    },
  ];

  const filtros: FiltroDef[] = [
    {
      id: "resultado",
      label: "Resultado",
      opciones: RESULTADO_DECISION.map((r) => ({ value: r, label: resultadoDecisionLabel(r) })),
      valores: decisiones.map((d) => d.resultado),
    },
    {
      id: "comision",
      label: "Comisión",
      opciones: comisionesDisponibles.map((c) => ({ value: c.nombre, label: c.nombre })),
      valores: decisiones.map((d) => d.comision_nombre),
      secundario: true,
    },
  ];

  const claves = decisiones.map((d) => `${d.numero || ""} ${d.tema} ${d.comision_nombre}`);

  return (
    <div>
      <PageHeader
        title="Decisiones"
        subtitle="Registro formal de decisiones de cada comisión, con votación cuando hace falta"
        action={puedeEditar && comisionesDisponibles.length > 0 ? <CrearDecisionForm comisiones={comisionesDisponibles} /> : undefined}
      />

      <ResumenDecisiones tiles={tiles} />

      <Card>
        {decisiones.length === 0 ? (
          <EmptyState>No hay decisiones registradas todavía.</EmptyState>
        ) : (
          <TablaFiltrable
            placeholder="Buscar por número, tema, comisión…"
            claves={claves}
            filtros={filtros}
            encabezado={
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Número</th>
                <th className="py-2 pr-3">Tema</th>
                <th className="py-2 pr-3">Comisión</th>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Resultado</th>
                <th className="py-2 pr-3"></th>
              </tr>
            }
          >
            {decisiones.map((d) => (
              <FilaConDetalle
                key={d.id}
                titulo={`${d.numero || "#" + d.id} · ${d.tema}`}
                subtitulo={d.comision_nombre}
                editarHref={`/decisiones/${d.id}`}
                secciones={[
                  {
                    titulo: "Detalle",
                    items: [
                      { label: "Propuesta", valor: d.propuesta || "—" },
                      { label: "Comisión", valor: d.comision_nombre },
                      { label: "Fecha", valor: dayjs(d.fecha).format("DD/MM/YYYY") },
                      { label: "Decidido por", valor: d.decidido_por_nombre || "—" },
                    ],
                  },
                  {
                    titulo: "Estado",
                    items: [{ label: "Resultado", valor: <ResultadoDecisionBadge resultado={d.resultado} /> }],
                  },
                ]}
              >
                <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)] whitespace-nowrap">{d.numero || `#${d.id}`}</td>
                <td className="py-2 pr-3 text-ink/70 truncate max-w-[260px]">{d.tema}</td>
                <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{d.comision_nombre}</td>
                <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{dayjs(d.fecha).format("DD/MM/YYYY")}</td>
                <td className="py-2 pr-3">
                  <ResultadoDecisionBadge resultado={d.resultado} />
                </td>
              </FilaConDetalle>
            ))}
          </TablaFiltrable>
        )}
      </Card>
    </div>
  );
}
