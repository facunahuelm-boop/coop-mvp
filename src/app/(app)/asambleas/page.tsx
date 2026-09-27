import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import Link from "next/link";
import { CrearReunionForm } from "@/components/reuniones/ReunionesFormularios";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";

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
//
// Mejora integral, Fase 2 (27/09, pedido explícito): listado escaneable
// (antes, tarjetas largas apiladas con TODO el texto siempre visible) pasa a
// `TablaFiltrable` + `FilaConDetalle` — el mismo patrón "resumen -> click ->
// pop-up" que ya usan Comunicaciones/Decisiones/Solicitudes/Finanzas, en vez
// de inventar un componente nuevo. El pop-up muestra orden del día,
// participación, resoluciones y documentos con datos que YA existían (agenda
// estructurada, invitados, actas, documentos vinculados por `reunion_id`) —
// no agrega ningún campo nuevo. La edición real (tomar asistencia, cerrar la
// reunión, gestionar agenda/invitados) sigue viviendo exclusivamente en
// `/reuniones/[id]`, ya con sus propios permisos (`puedeGestionar`) — el
// pop-up de acá es sólo de lectura y linkea ahí con "Ver reunión completa →"
// (footer estándar de `FilaConDetalle`), nunca duplica esos formularios.
// Permisos sin cambios: `canRead(rol,"comisiones")` ya es "read" para
// "socio" y "approve"/"config" para consejo_directivo/admin en la matriz de
// roles.ts — un socio ya sólo podía consultar, así que no hace falta ninguna
// verificación nueva para cumplir "socios sólo consulta".

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

  // Datos del pop-up de detalle (orden del día estructurado, participación
  // por persona, acta y documentos vinculados) — todo ya existía en el
  // sistema (mismas tablas que ya consulta /reuniones/[id]), sólo no se
  // mostraba desde acá. La cantidad de asambleas es chica (unas pocas por
  // año), así que una consulta chica por asamblea es más simple de leer que
  // armar 4 consultas agregadas con JOINs — mismo criterio que ya usan
  // /trabajo y otras pantallas con listas cortas.
  const detalles = await Promise.all(
    asambleas.map(async (a) => {
      const [agendaItems, invitadosRow, acta, documentos] = await Promise.all([
        all<{ id: number; titulo: string; resultado: string | null }>(
          `SELECT id, titulo, resultado FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden ASC`,
          [a.id]
        ).catch(() => []),
        get<{ total: string; presentes: string }>(
          `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE presente = 1) as presentes FROM reunion_invitados WHERE reunion_id = ?`,
          [a.id]
        ).catch(() => null),
        a.acta_id
          ? get<{ resumen: string; documento_id: number | null; archivo_url: string | null }>(
              `SELECT ac.resumen, ac.documento_id, d.archivo_url FROM actas ac LEFT JOIN documentos d ON d.id = ac.documento_id WHERE ac.id = ?`,
              [a.acta_id]
            ).catch(() => null)
          : null,
        all<{ id: number; nombre: string; archivo_url: string | null }>(
          `SELECT id, nombre, archivo_url FROM documentos WHERE reunion_id = ? ORDER BY fecha DESC`,
          [a.id]
        ).catch(() => []),
      ]);
      return { agendaItems, invitados: invitadosRow, acta, documentos };
    })
  );

  const filtros: FiltroDef[] = [
    {
      id: "estado",
      label: "Estado",
      opciones: [
        { value: "planificada", label: "Planificada" },
        { value: "realizada", label: "Realizada" },
        { value: "cancelada", label: "Cancelada" },
      ],
      valores: asambleas.map((a) => a.estado),
    },
    {
      id: "tipo_asamblea",
      label: "Tipo",
      opciones: [
        { value: "ordinaria", label: "Ordinaria" },
        { value: "extraordinaria", label: "Extraordinaria" },
      ],
      valores: asambleas.map((a) => a.tipo_asamblea),
      secundario: true,
    },
  ];
  const claves = asambleas.map((a) => `${a.titulo} ${a.lugar || ""}`);

  return (
    <div>
      <PageHeader
        title="Asambleas"
        subtitle="Convocatoria, asistencia y actas de las asambleas de la cooperativa"
        action={
          puedeConvocar ? (
            <CrearReunionForm comisiones={comisionesActivas} esOversightReuniones={puedeConvocar} tipoInicial="asamblea" />
          ) : undefined
        }
      />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          ⚖️ La asistencia que se muestra abajo es informativa (presentes sobre el total de núcleos de la cooperativa).
          El sistema no evalúa ni declara si una asamblea cumple el quórum exigido por el estatuto — esa decisión
          queda en manos del Consejo Directivo y de quien preside la asamblea.
        </p>
      </Card>

      {asambleas.length === 0 ? (
        <Card><EmptyState>No hay asambleas registradas todavía.</EmptyState></Card>
      ) : (
        <Card>
          <TablaFiltrable
            placeholder="Buscar por título o lugar…"
            claves={claves}
            filtros={filtros}
            sinResultadosTexto="No se encontraron asambleas para esa búsqueda."
            encabezado={
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Asamblea</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Convocatoria</th>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Participación</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3"></th>
              </tr>
            }
          >
            {asambleas.map((a, i) => {
              const d = detalles[i];
              const antelacionDias = a.fecha_convocatoria ? dayjs(a.fecha).diff(dayjs(a.fecha_convocatoria), "day") : null;
              const totalInvitados = Number(d.invitados?.total || 0);
              const presentesInvitados = Number(d.invitados?.presentes || 0);
              const otrosDocumentos = d.documentos.filter((doc) => doc.id !== d.acta?.documento_id);

              return (
                <FilaConDetalle
                  key={a.id}
                  titulo={a.titulo}
                  subtitulo={`${dayjs(a.fecha).format("DD/MM/YYYY HH:mm")}${a.lugar ? ` · ${a.lugar}` : ""}`}
                  editarHref={`/reuniones/${a.id}`}
                  secciones={[
                    {
                      titulo: "Convocatoria",
                      items: [
                        { label: "Tipo", valor: a.tipo_asamblea ? TIPO_ASAMBLEA_LABEL[a.tipo_asamblea] ?? a.tipo_asamblea : "—" },
                        { label: "Convocatoria", valor: a.convocatoria ? CONVOCATORIA_LABEL[a.convocatoria] ?? a.convocatoria : "—" },
                        {
                          label: "Convocada el",
                          valor: a.fecha_convocatoria
                            ? `${dayjs(a.fecha_convocatoria).format("DD/MM/YYYY")}${antelacionDias !== null && antelacionDias >= 0 ? ` (${antelacionDias} día(s) de anticipación)` : ""}`
                            : "—",
                        },
                        { label: "Modalidad", valor: a.modalidad === "virtual" ? "Virtual" : a.modalidad === "hibrida" ? "Híbrida" : "Presencial" },
                      ],
                    },
                    {
                      titulo: "Orden del día",
                      items:
                        d.agendaItems.length > 0
                          ? d.agendaItems.map((item) => ({
                              label: item.titulo,
                              valor: item.resultado || "Sin resultado registrado",
                            }))
                          : [{ label: "Orden del día", valor: a.orden_del_dia || "No se cargó orden del día." }],
                    },
                    {
                      titulo: "Participación",
                      items: [
                        { label: "Núcleos presentes", valor: `${a.presentes}/${totalNucleos}` },
                        ...(totalInvitados > 0 ? [{ label: "Personas confirmadas presentes", valor: `${presentesInvitados}/${totalInvitados}` }] : []),
                      ],
                    },
                    {
                      titulo: "Resoluciones",
                      items: [
                        {
                          label: "Decisiones registradas",
                          valor: a.decisiones > 0 ? <Link href="/decisiones" className="underline">{a.decisiones} decisión(es) →</Link> : "Ninguna",
                        },
                        ...(d.acta?.resumen ? [{ label: "Resumen del acta", valor: <span className="whitespace-pre-wrap text-left font-normal">{d.acta.resumen}</span> }] : []),
                      ],
                    },
                    {
                      titulo: "Documentos",
                      items:
                        d.acta?.archivo_url || otrosDocumentos.length > 0
                          ? [
                              ...(d.acta?.archivo_url ? [{ label: "Acta", valor: <a href={`/api/archivos/documento/${d.acta.documento_id}`} target="_blank" className="underline">Descargar PDF</a> }] : []),
                              ...otrosDocumentos.map((doc) => ({
                                label: doc.nombre,
                                valor: doc.archivo_url ? <a href={`/api/archivos/documento/${doc.id}`} target="_blank" className="underline">Descargar</a> : "Sin archivo",
                              })),
                            ]
                          : [{ label: "Documentos", valor: "Sin documentos vinculados." }],
                    },
                  ]}
                >
                  <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">{a.titulo}</td>
                  <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{a.tipo_asamblea ? TIPO_ASAMBLEA_LABEL[a.tipo_asamblea] ?? a.tipo_asamblea : "—"}</td>
                  <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{a.convocatoria ? CONVOCATORIA_LABEL[a.convocatoria] ?? a.convocatoria : "—"}</td>
                  <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{dayjs(a.fecha).format("DD/MM/YYYY HH:mm")}</td>
                  <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{a.presentes}/{totalNucleos} núcleos</td>
                  <td className="py-2 pr-3">
                    <Badge color={ESTADO_COLOR[a.estado] ?? "gray"}>{a.estado}</Badge>
                  </td>
                </FilaConDetalle>
              );
            })}
          </TablaFiltrable>
        </Card>
      )}
    </div>
  );
}
