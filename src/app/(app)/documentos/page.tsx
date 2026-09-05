import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { subirDocumentoAction } from "@/lib/actions/documentos";

const CATEGORIAS = ["actas", "asambleas", "presupuestos", "facturas", "contratos", "tecnicos", "obra", "socios", "seguridad", "compras", "reglamentos", "informes", "comunicaciones"];
const CAT_LABEL: Record<string, string> = {
  actas: "Actas", asambleas: "Asambleas", presupuestos: "Presupuestos", facturas: "Facturas", contratos: "Contratos",
  tecnicos: "Documentos técnicos", obra: "Documentación de obra", socios: "Documentación de socios", seguridad: "Seguridad",
  compras: "Compras", reglamentos: "Reglamentos", informes: "Informes", comunicaciones: "Comunicaciones",
};

export default async function DocumentosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "documentos")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "documentos");
  const [docs, actas] = await Promise.all([
    all<any>(`SELECT d.*, u.nombre as subido_por FROM documentos d LEFT JOIN users u ON u.id = d.subido_por_id ORDER BY fecha DESC`),
    all<any>(`SELECT * FROM actas ORDER BY fecha DESC`),
  ]);
  const porCategoria = CATEGORIAS.map((c) => ({ c, docs: docs.filter((d) => d.categoria === c) })).filter((g) => g.docs.length > 0);

  return (
    <div>
      <PageHeader title="Documentos" subtitle="Repositorio institucional de la cooperativa" />

      {actas.length > 0 && (
        <>
          <h3 className="text-sm font-bold text-[#123240] mb-2">Actas y resoluciones</h3>
          <div className="space-y-2 mb-6">
            {actas.map((a) => (
              <Card key={a.id}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{a.titulo}</p>
                  <Badge color="brand">{a.organo === "asamblea" ? "Asamblea" : "Consejo Directivo"}</Badge>
                </div>
                <p className="text-xs text-black/40 mt-0.5">{dayjs(a.fecha).format("DD/MM/YYYY")}</p>
                <p className="text-sm text-black/70 mt-1.5">{a.resumen}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {porCategoria.map(({ c, docs: ds }) => (
        <div key={c} className="mb-6">
          <h3 className="text-sm font-bold text-[#123240] mb-2">{CAT_LABEL[c]}</h3>
          <div className="space-y-2">
            {ds.map((d) => (
              <Card key={d.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{d.nombre}</p>
                  <p className="text-xs text-black/50">{d.descripcion} {d.subido_por && `· subido por ${d.subido_por}`} · {dayjs(d.fecha).format("DD/MM/YYYY")}</p>
                </div>
                {d.archivo_url ? <a href={d.archivo_url} target="_blank" className="text-xs text-[#1f4e5f] underline whitespace-nowrap ml-3">Descargar</a> : <span className="text-xs text-black/30">sin archivo</span>}
              </Card>
            ))}
          </div>
        </div>
      ))}
      {docs.length === 0 && <EmptyState>No hay documentos cargados todavía.</EmptyState>}

      {puedeEditar && (
        <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Subir documento</summary>
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
              <div className="sm:col-span-2"><Label>Archivo</Label><input type="file" name="archivo" className="text-xs" /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Subir</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
