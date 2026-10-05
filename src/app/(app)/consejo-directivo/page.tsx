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
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";
import { ResumenSeguimiento } from "@/components/reuniones/ResumenSeguimiento";
import { vinculosDeAgendaItem, puntosDeAgenda, TIPO_REUNION_LABEL } from "@/lib/trazabilidad";

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
//
// Mejora integral, Fase 3 (27/09, pedido explícito): "mejora visual +
// reuniones con pop-up de detalle + edición restringida solo a Consejo
// Directivo". La edición ya estaba restringida (puedeGestionarCargos vía
// canApprove("comisiones"), confirmado explícitamente con el usuario que
// NO se toca consejo_directivo_cargos en el sistema de permisos) — lo que
// faltaba era lo visual: el listado de reuniones (antes tarjetas largas)
// pasa a `TablaFiltrable` + `FilaConDetalle`, mismo patrón que Asambleas
// (Fase 2) y con las mismas fuentes de datos (agenda/invitados/actas/
// documentos por reunion_id) — sin agregar ningún campo nuevo. A diferencia
// de Asambleas, una reunión de Consejo Directivo no tiene convocatoria
// formal (tipo_asamblea/convocatoria/fecha_convocatoria son columnas
// exclusivas de tipo='asamblea', migración 0032) — por eso el pop-up acá
// no incluye esa sección. "+ Convocar reunión" se reubica a `PageHeader
// action` (convención global de Fase 1) y "+ Asignar cargo" pasa a
// `AddButtonSummary` (restyle, sin reubicar — es contextual a la sección
// de Composición actual, mismo criterio que los formularios contextuales
// de Compras/Decisiones en Fase 1).

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

  // Datos del pop-up de detalle — mismo criterio que Asambleas (Fase 2):
  // todo ya existía en el sistema (agenda estructurada, invitados, actas,
  // documentos vinculados), sólo no se mostraba desde acá.
  const detalles = await Promise.all(
    reuniones.map(async (r) => {
      const [agendaItems, invitadosRow, acta, documentos] = await Promise.all([
        all<{ id: number; titulo: string; resultado: string | null; origen_item_id?: number | null }>(
          `SELECT id, titulo, resultado, origen_item_id FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden ASC`,
          [r.id]
        ).catch(() =>
          all<{ id: number; titulo: string; resultado: string | null; origen_item_id?: number | null }>(
            `SELECT id, titulo, resultado FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden ASC`,
            [r.id]
          ).catch(() => [])
        ),
        get<{ total: string; presentes: string }>(
          `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE presente = 1) as presentes FROM reunion_invitados WHERE reunion_id = ?`,
          [r.id]
        ).catch(() => null),
        r.acta_id
          ? get<{ resumen: string; documento_id: number | null; archivo_url: string | null }>(
              `SELECT ac.resumen, ac.documento_id, d.archivo_url FROM actas ac LEFT JOIN documentos d ON d.id = ac.documento_id WHERE ac.id = ?`,
              [r.acta_id]
            ).catch(() => null)
          : null,
        all<{ id: number; nombre: string; archivo_url: string | null }>(
          `SELECT id, nombre, archivo_url FROM documentos WHERE reunion_id = ? ORDER BY fecha DESC`,
          [r.id]
        ).catch(() => []),
      ]);
      return { agendaItems, invitados: invitadosRow, acta, documentos };
    })
  );
  // Recorrido de decisiones (04/10): qué salió de cada resolución y de dónde
  // vino — resumen de una línea; el detalle y las acciones están en la ficha
  // de la reunión ("Ver ficha completa").
  const todosLosPuntos = detalles.flatMap((x) => x.agendaItems);
  const [vinculosPuntos, origenesPuntos] = await Promise.all([
    vinculosDeAgendaItem(todosLosPuntos.map((x) => x.id)),
    puntosDeAgenda(todosLosPuntos.map((x) => x.origen_item_id ?? 0)),
  ]);

  const filtros: FiltroDef[] = [
    {
      id: "estado",
      label: "Estado",
      opciones: [
        { value: "planificada", label: "Planificada" },
        { value: "realizada", label: "Realizada" },
        { value: "cancelada", label: "Cancelada" },
      ],
      valores: reuniones.map((r) => r.estado),
    },
  ];
  const claves = reuniones.map((r) => `${r.titulo} ${r.lugar || ""}`);

  return (
    <div>
      <PageHeader
        title="Consejo Directivo"
        subtitle="Composición de cargos, reuniones y actas del Consejo Directivo"
        action={
          puedeConvocar ? (
            <CrearReunionForm comisiones={comisionesActivas} esOversightReuniones={puedeConvocar} tipoInicial="consejo_directivo" />
          ) : undefined
        }
      />

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

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Reuniones</h3>
      {reuniones.length === 0 ? (
        <Card><EmptyState>No hay reuniones de Consejo Directivo registradas.</EmptyState></Card>
      ) : (
        <Card>
          <TablaFiltrable
            placeholder="Buscar por título o lugar…"
            claves={claves}
            filtros={filtros}
            sinResultadosTexto="No se encontraron reuniones para esa búsqueda."
            encabezado={
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Reunión</th>
                <th className="py-2 pr-3">Modalidad</th>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Participación</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3"></th>
              </tr>
            }
          >
            {reuniones.map((r, i) => {
              const d = detalles[i];
              const totalInvitados = Number(d.invitados?.total || 0);
              const presentesInvitados = Number(d.invitados?.presentes || 0);
              const otrosDocumentos = d.documentos.filter((doc) => doc.id !== d.acta?.documento_id);
              const modalidadLabel = r.modalidad === "virtual" ? "Virtual" : r.modalidad === "hibrida" ? "Híbrida" : "Presencial";

              return (
                <FilaConDetalle
                  key={r.id}
                  titulo={r.titulo}
                  subtitulo={`${dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}${r.lugar ? ` · ${r.lugar}` : ""} · ${modalidadLabel}`}
                  editarHref={`/reuniones/${r.id}`}
                  secciones={[
                    {
                      titulo: "Orden del día",
                      items:
                        d.agendaItems.length > 0
                          ? d.agendaItems.map((item) => {
                              const origen = item.origen_item_id ? origenesPuntos.get(item.origen_item_id) : undefined;
                              return {
                                label: item.titulo,
                                valor: (
                                  <>
                                    {item.resultado || "Sin resultado registrado"}
                                    {origen && (
                                      <span className="block text-xs font-normal text-ink/50">
                                        Viene de {TIPO_REUNION_LABEL[origen.reunion_tipo] ?? origen.reunion_tipo}{" "}
                                        <Link href={`/reuniones/${origen.reunion_id}`} className="underline">{origen.reunion_titulo}</Link>
                                      </span>
                                    )}
                                    <ResumenSeguimiento vinculos={vinculosPuntos.get(item.id)} />
                                  </>
                                ),
                              };
                            })
                          : [{ label: "Orden del día", valor: r.orden_del_dia || "No se cargó orden del día." }],
                    },
                    {
                      titulo: "Participación",
                      items: [
                        { label: "Núcleos presentes", valor: `${r.presentes}/${totalNucleos}` },
                        ...(totalInvitados > 0 ? [{ label: "Personas confirmadas presentes", valor: `${presentesInvitados}/${totalInvitados}` }] : []),
                      ],
                    },
                    {
                      titulo: "Resoluciones",
                      items: [
                        {
                          label: "Decisiones registradas",
                          valor: r.decisiones > 0 ? <Link href="/decisiones" className="underline">{r.decisiones} decisión(es) →</Link> : "Ninguna",
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
                  <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">{r.titulo}</td>
                  <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{modalidadLabel}</td>
                  <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}</td>
                  <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{r.presentes}/{totalNucleos} núcleos</td>
                  <td className="py-2 pr-3">
                    <Badge color={ESTADO_COLOR[r.estado] ?? "gray"}>{r.estado}</Badge>
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
