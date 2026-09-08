import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { subirDocumentoAction, crearCategoriaDocumentoAction } from "@/lib/actions/documentos";

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
  const [docsSinFiltrar, actas, categoriasPropias] = await Promise.all([
    all<any>(`SELECT d.*, u.nombre as subido_por FROM documentos d LEFT JOIN users u ON u.id = d.subido_por_id ORDER BY fecha DESC`),
    all<any>(`SELECT * FROM actas ORDER BY fecha DESC`),
    all<any>(`SELECT * FROM documento_categorias ORDER BY nombre ASC`),
  ]);

  const todasLasEtiquetas = Array.from(new Set(docsSinFiltrar.flatMap((d) => etiquetasDe(d)))).sort((a, b) => a.localeCompare(b, "es"));
  const docs = etiquetaFiltro ? docsSinFiltrar.filter((d) => etiquetasDe(d).includes(etiquetaFiltro)) : docsSinFiltrar;

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
            {ds.map((d) => (
              <Card key={d.id} className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{d.nombre}</p>
                  <p className="text-xs text-ink/50">{d.descripcion} {d.subido_por && `· subido por ${d.subido_por}`} · {dayjs(d.fecha).format("DD/MM/YYYY")}</p>
                  {etiquetasDe(d).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {etiquetasDe(d).map((e) => (
                        <a key={e} href={`/documentos?etiqueta=${encodeURIComponent(e)}`} className="text-[11px] rounded-full px-2 py-0.5 bg-ink/5 text-ink/50 hover:bg-ink/10">{e}</a>
                      ))}
                    </div>
                  )}
                </div>
                {d.archivo_url ? <a href={d.archivo_url} target="_blank" className="text-xs text-[var(--color-brand-800)] underline whitespace-nowrap ml-3">Descargar</a> : <span className="text-xs text-ink/30 ml-3">sin archivo</span>}
              </Card>
            ))}
          </div>
        </div>
      ))}
      {docs.length === 0 && <EmptyState>No hay documentos cargados todavía.</EmptyState>}

      {puedeEditar && (
        <>
          <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Subir documento</summary>
            <Card className="mt-3">
              <form action={subirDocumentoAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>Nombre</Label><input name="nombre" required className={inputClass} /></div>
                <div>
                  <Label>Categoría</Label>
                  <select name="categoria" className={inputClass} defaultValue="informes">
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2"><Label>Descripción</Label><input name="descripcion" className={inputClass} /></div>
                <div className="sm:col-span-2">
                  <Label>Etiquetas (opcional)</Label>
                  <input name="etiquetas" placeholder="separadas por coma, ej: obra-etapa-2, urgente" className={inputClass} />
                </div>
                <div className="sm:col-span-2"><Label>Archivo</Label><input type="file" name="archivo" className="text-xs" /></div>
                <div className="sm:col-span-2"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Subir</button></div>
              </form>
            </Card>
          </details>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-ink/40 hover:text-[var(--color-brand-800)]">+ Crear una categoría nueva</summary>
            <Card className="mt-3">
              <form action={crearCategoriaDocumentoAction} className="flex items-end gap-2">
                <div className="flex-1"><Label>Nombre de la categoría</Label><input name="nombre" required placeholder="ej: Estatuto, RRHH" className={inputClass} /></div>
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Crear</button>
              </form>
            </Card>
          </details>
        </>
      )}
    </div>
  );
}
