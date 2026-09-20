import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import { eliminarDocumentoFormAction } from "@/lib/actions/documentos";
import { ConfirmarEliminar } from "@/components/ConfirmarEliminar";
import { SubirDocumentoForm, CrearCategoriaDocumentoForm, SubirNuevaVersionForm } from "@/components/documentos/DocumentosFormularios";

const CATEGORIAS_BASE = ["actas", "asambleas", "presupuestos", "facturas", "contratos", "tecnicos", "obra", "socios", "seguridad", "compras", "reglamentos", "informes", "comunicaciones"];
const CAT_LABEL_BASE: Record<string, string> = {
  actas: "Actas", asambleas: "Asambleas", presupuestos: "Presupuestos", facturas: "Facturas", contratos: "Contratos",
  tecnicos: "Documentos técnicos", obra: "Documentación de obra", socios: "Documentación de socios", seguridad: "Seguridad",
  compras: "Compras", reglamentos: "Reglamentos", informes: "Informes", comunicaciones: "Comunicaciones",
};

// Fase 07 del Plan Maestro ("carpetas/etiquetas"): a la lista fija de
// categorías de arriba se le suman las que cada cooperativa haya creado por
// su cuenta (tabla documento_categorias, Fase 07) — el valor guardado en
// documentos.categoria es directamente el nombre elegido, así que una
// categoría propia no necesita traducirse a través de CAT_LABEL_BASE.
function etiquetasDe(d: { etiquetas?: string | null }): string[] {
  return (d.etiquetas || "").split(",").map((e) => e.trim()).filter(Boolean);
}

// Fase 8 del sistema de gestión de Comisiones (19/09, "documentos con
// contexto y versionado"): tipo de fila ampliado con las columnas que
// agregó la migración 0029 (comision_id/solicitud_comision_id/tarea_id/
// reunion_id/decision_id/comunicacion_id, version, reemplaza_a_id) más los
// nombres/títulos ya resueltos por LEFT JOIN para no repetir esa lógica en
// cada fila de la tabla.
type DocumentoRow = {
  id: number;
  categoria: string;
  nombre: string;
  descripcion: string | null;
  etiquetas: string | null;
  archivo_url: string | null;
  fecha: string;
  subido_por_id: number | null;
  subido_por?: string | null;
  comision_id?: number | null;
  solicitud_comision_id?: number | null;
  tarea_id?: number | null;
  reunion_id?: number | null;
  decision_id?: number | null;
  comunicacion_id?: number | null;
  version?: number | null;
  reemplaza_a_id?: number | null;
  comision_nombre?: string | null;
  solicitud_titulo?: string | null;
  tarea_titulo?: string | null;
  reunion_titulo?: string | null;
  decision_tema?: string | null;
  comunicacion_asunto?: string | null;
};

/** Dónde está enlazado un documento (si lo está) y a dónde llevarlo si se
 * hace click — comisiones/comunicaciones no tienen ficha propia por id
 * todavía (mismo criterio ya usado en notificaciones/page.tsx: llevan a la
 * lista general, no a un ancla puntual). */
function contextoDe(d: DocumentoRow): { texto: string; href: string } | null {
  if (d.comision_id) return { texto: `Comisión: ${d.comision_nombre || "—"}`, href: "/comisiones" };
  if (d.solicitud_comision_id) return { texto: `Solicitud: ${d.solicitud_titulo || "—"}`, href: `/solicitudes/${d.solicitud_comision_id}` };
  if (d.tarea_id) return { texto: `Tarea: ${d.tarea_titulo || "—"}`, href: `/trabajo/${d.tarea_id}` };
  if (d.reunion_id) return { texto: `Reunión: ${d.reunion_titulo || "—"}`, href: `/reuniones/${d.reunion_id}` };
  if (d.decision_id) return { texto: `Decisión: ${d.decision_tema || "—"}`, href: `/decisiones/${d.decision_id}` };
  if (d.comunicacion_id) return { texto: `Comunicación: ${d.comunicacion_asunto || "—"}`, href: "/comunicaciones" };
  return null;
}

export default async function DocumentosPage({
  searchParams,
}: {
  // Next.js 15+ (acá corremos 16): searchParams llega como Promise, no como
  // objeto plano — hay que hacer await antes de leer sus propiedades. Sin
  // esto, cualquier lectura de searchParams.algo da undefined en runtime sin
  // tirar error (el filtro por etiqueta quedaba siempre vacío pese a que la
  // URL sí tenía ?etiqueta=... — mismo bug que en /buscar, ver ese archivo).
  searchParams: Promise<{ etiqueta?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "documentos")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "documentos");
  const { etiqueta } = await searchParams;
  const etiquetaFiltro = etiqueta?.trim() || "";

  // Fase 8: la consulta ampliada trae, además de lo de siempre, las 6
  // columnas de contexto (con sus nombres ya resueltos por LEFT JOIN) y
  // version/reemplaza_a_id. Si el usuario todavía no corrió la migración
  // 0029, esas columnas no existen y Postgres tira 42703 — en ese caso se
  // cae a la consulta ORIGINAL (idéntica a la de antes de esta fase), para
  // no dejar la pantalla de Documentos rota mientras la migración no está.
  const docsSinFiltrar = await all<DocumentoRow>(
    `SELECT d.*, u.nombre as subido_por,
            c.nombre as comision_nombre,
            s.titulo as solicitud_titulo,
            t.titulo as tarea_titulo,
            r.titulo as reunion_titulo,
            dc.tema as decision_tema,
            co.asunto as comunicacion_asunto
       FROM documentos d
       LEFT JOIN users u ON u.id = d.subido_por_id
       LEFT JOIN comisiones c ON c.id = d.comision_id
       LEFT JOIN solicitudes_comision s ON s.id = d.solicitud_comision_id
       LEFT JOIN tareas t ON t.id = d.tarea_id
       LEFT JOIN reuniones r ON r.id = d.reunion_id
       LEFT JOIN decisiones_comision dc ON dc.id = d.decision_id
       LEFT JOIN comunicaciones co ON co.id = d.comunicacion_id
      ORDER BY d.fecha DESC`
  ).catch(() =>
    all<DocumentoRow>(`SELECT d.*, u.nombre as subido_por FROM documentos d LEFT JOIN users u ON u.id = d.subido_por_id ORDER BY fecha DESC`)
  );

  const [actas, categoriasPropias, comisionesOpc, solicitudesOpc, tareasOpc, reunionesOpc, decisionesOpc, comunicacionesOpc] = await Promise.all([
    all<any>(`SELECT * FROM actas ORDER BY fecha DESC`),
    all<any>(`SELECT * FROM documento_categorias ORDER BY nombre ASC`),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    // Las 3 tablas nuevas de la migración 0029 van con `.catch(() => [])`:
    // hasta que se corra, el select "Vincular a" simplemente no ofrece esa
    // opción todavía (ver contextoTipo !== "ninguno" en el formulario).
    // LIMIT 300 es un techo razonable para un <select> usable, no una
    // paginación real — mismo criterio que el LIMIT 200 de notificaciones.
    all<{ id: number; titulo: string }>(`SELECT id, titulo FROM solicitudes_comision ORDER BY creado_en DESC LIMIT 300`).catch(() => []),
    all<{ id: number; titulo: string }>(`SELECT id, titulo FROM tareas ORDER BY creado_en DESC LIMIT 300`).catch(() => []),
    all<{ id: number; titulo: string }>(`SELECT id, titulo FROM reuniones ORDER BY fecha DESC LIMIT 300`).catch(() => []),
    all<{ id: number; tema: string }>(`SELECT id, tema FROM decisiones_comision ORDER BY creado_en DESC LIMIT 300`).catch(() => []),
    all<{ id: number; asunto: string }>(`SELECT id, asunto FROM comunicaciones ORDER BY creado_en DESC LIMIT 300`).catch(() => []),
  ]);

  // Fase 8 ("versionado"): una fila con reemplaza_a_id apunta a la versión
  // que reemplaza — así que esa versión anterior queda "superada" y no debe
  // aparecer suelta en el listado por categoría (aparece colgada de la
  // versión vigente, ver historialDe más abajo).
  const porId = new Map(docsSinFiltrar.map((d) => [d.id, d]));
  const idsSuperados = new Set(docsSinFiltrar.map((d) => d.reemplaza_a_id).filter((id): id is number => Boolean(id)));
  function historialDe(d: DocumentoRow): DocumentoRow[] {
    const historial: DocumentoRow[] = [];
    let actual = d.reemplaza_a_id ? porId.get(d.reemplaza_a_id) : undefined;
    while (actual) {
      historial.push(actual);
      actual = actual.reemplaza_a_id ? porId.get(actual.reemplaza_a_id) : undefined;
    }
    return historial;
  }
  const vigentes = docsSinFiltrar.filter((d) => !idsSuperados.has(d.id));

  const todasLasEtiquetas = Array.from(new Set(vigentes.flatMap((d) => etiquetasDe(d)))).sort((a, b) => a.localeCompare(b, "es"));
  const docs = etiquetaFiltro ? vigentes.filter((d) => etiquetasDe(d).includes(etiquetaFiltro)) : vigentes;

  const CATEGORIAS = [...CATEGORIAS_BASE, ...categoriasPropias.map((c) => c.nombre)];
  const CAT_LABEL: Record<string, string> = { ...CAT_LABEL_BASE, ...Object.fromEntries(categoriasPropias.map((c) => [c.nombre, c.nombre])) };
  const porCategoria = CATEGORIAS.map((c) => ({ c, docs: docs.filter((d) => d.categoria === c) })).filter((g) => g.docs.length > 0);

  return (
    <div>
      <PageHeader title="Documentos" subtitle="Repositorio institucional de la cooperativa" />

      {todasLasEtiquetas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          <span className="text-xs text-ink/40 mr-1">Etiquetas:</span>
          {etiquetaFiltro && (
            <a href="/documentos" className="text-xs rounded-full px-2.5 py-1 bg-[var(--color-brand-800)] text-white font-medium">
              {etiquetaFiltro} ✕
            </a>
          )}
          {todasLasEtiquetas.filter((e) => e !== etiquetaFiltro).map((e) => (
            <a key={e} href={`/documentos?etiqueta=${encodeURIComponent(e)}`} className="text-xs rounded-full px-2.5 py-1 bg-ink/5 text-ink/60 hover:bg-ink/10 font-medium">
              {e}
            </a>
          ))}
        </div>
      )}

      {actas.length > 0 && !etiquetaFiltro && (
        <>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Actas y resoluciones</h3>
          <div className="space-y-2 mb-6">
            {actas.map((a) => (
              <Card key={a.id}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{a.titulo}</p>
                  <Badge color="brand">{a.organo === "asamblea" ? "Asamblea" : "Consejo Directivo"}</Badge>
                </div>
                <p className="text-xs text-ink/40 mt-0.5">{dayjs(a.fecha).format("DD/MM/YYYY")}</p>
                <p className="text-sm text-ink/70 mt-1.5">{a.resumen}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {porCategoria.map(({ c, docs: ds }) => (
        <div key={c} className="mb-6">
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">{CAT_LABEL[c]}</h3>
          <div className="space-y-2">
            {ds.map((d) => {
              const contexto = contextoDe(d);
              const historial = historialDe(d);
              return (
                <Card key={d.id} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {d.nombre}
                      {Boolean(d.version && d.version > 1) && (
                        <span className="ml-1.5 inline-block align-middle"><Badge color="brand">v{d.version}</Badge></span>
                      )}
                    </p>
                    <p className="text-xs text-ink/50">{d.descripcion} {d.subido_por && `· subido por ${d.subido_por}`} · {dayjs(d.fecha).format("DD/MM/YYYY")}</p>
                    {contexto && (
                      <a href={contexto.href} className="text-[11px] text-[var(--color-brand-800)] hover:underline">{contexto.texto}</a>
                    )}
                    {etiquetasDe(d).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {etiquetasDe(d).map((e) => (
                          <a key={e} href={`/documentos?etiqueta=${encodeURIComponent(e)}`} className="text-[11px] rounded-full px-2 py-0.5 bg-ink/5 text-ink/50 hover:bg-ink/10">{e}</a>
                        ))}
                      </div>
                    )}
                    {historial.length > 0 && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] text-ink/40 hover:text-ink/60">Versiones anteriores ({historial.length})</summary>
                        <div className="mt-1 space-y-1 pl-2 border-l-2 border-ink/10">
                          {historial.map((h) => (
                            <p key={h.id} className="text-[11px] text-ink/50">
                              v{h.version || 1} · {dayjs(h.fecha).format("DD/MM/YYYY")}
                              {h.archivo_url && (
                                <> · <a href={`/api/archivos/documento/${h.id}`} target="_blank" className="text-[var(--color-brand-800)] underline">Descargar</a></>
                              )}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 ml-3">
                    {d.archivo_url ? <a href={`/api/archivos/documento/${d.id}`} target="_blank" className="text-xs text-[var(--color-brand-800)] underline whitespace-nowrap">Descargar</a> : <span className="text-xs text-ink/30">sin archivo</span>}
                    {puedeEditar && <SubirNuevaVersionForm documentoId={d.id} nombre={d.nombre} />}
                    {user.rol === "admin" && (
                      <details>
                        <summary className="cursor-pointer text-[11px] text-[var(--color-rojo)]/70 hover:text-[var(--color-rojo)] whitespace-nowrap">Eliminar</summary>
                        <div className="mt-1">
                          <ConfirmarEliminar
                            action={eliminarDocumentoFormAction}
                            hiddenFields={{ id: d.id, confirmacion: "ELIMINAR" }}
                            titulo="¿Eliminar este documento?"
                            descripcion={`Se va a borrar "${d.nombre}" de forma permanente. Esta acción no se puede deshacer.`}
                            textoBoton="Confirmar"
                            className="rounded-md bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-2 py-1 text-[11px] font-semibold whitespace-nowrap"
                          />
                        </div>
                      </details>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
      {docs.length === 0 && <EmptyState>No hay documentos cargados todavía.</EmptyState>}

      {puedeEditar && (
        <>
          <SubirDocumentoForm
            categorias={CATEGORIAS}
            catLabel={CAT_LABEL}
            comisiones={comisionesOpc.map((c) => ({ id: c.id, label: c.nombre }))}
            solicitudes={solicitudesOpc.map((s) => ({ id: s.id, label: s.titulo }))}
            tareas={tareasOpc.map((t) => ({ id: t.id, label: t.titulo }))}
            reuniones={reunionesOpc.map((r) => ({ id: r.id, label: r.titulo }))}
            decisiones={decisionesOpc.map((dd) => ({ id: dd.id, label: dd.tema }))}
            comunicaciones={comunicacionesOpc.map((c) => ({ id: c.id, label: c.asunto }))}
          />
          <CrearCategoriaDocumentoForm />
        </>
      )}
    </div>
  );
}
