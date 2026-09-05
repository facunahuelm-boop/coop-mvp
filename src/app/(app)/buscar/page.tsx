import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import dayjs from "dayjs";

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const q = searchParams.q?.trim() || "";
  const resultados: any[] = [];

  if (q && q.length >= 2) {
    const [tareas, compras, docs, jornadas, incidentes] = await Promise.all([
      // Buscar en tareas de obra
      all<any>(
        `SELECT 'obra' as tipo, id, nombre as titulo, 'Obra' as modulo, estado FROM tareas_obra WHERE nombre LIKE ? OR descripcion LIKE ? LIMIT 10`,
        [`%${q}%`, `%${q}%`]
      ),
      // Buscar en compras
      all<any>(
        `SELECT 'compra' as tipo, id, material as titulo, 'Compras' as modulo, estado FROM solicitudes_compra WHERE material LIKE ? OR especificacion LIKE ? LIMIT 10`,
        [`%${q}%`, `%${q}%`]
      ),
      // Buscar en documentos
      all<any>(
        `SELECT 'documento' as tipo, id, nombre as titulo, 'Documentos' as modulo, categoria as estado FROM documentos WHERE nombre LIKE ? OR descripcion LIKE ? LIMIT 10`,
        [`%${q}%`, `%${q}%`]
      ),
      // Buscar en jornadas
      all<any>(
        `SELECT 'jornada' as tipo, id, descripcion as titulo, 'Trabajo' as modulo, estado FROM jornadas_trabajo WHERE descripcion LIKE ? LIMIT 10`,
        [`%${q}%`]
      ),
      // Buscar en incidentes de seguridad
      all<any>(
        `SELECT 'incidente' as tipo, id, descripcion as titulo, 'Seguridad' as modulo, estado FROM incidentes_seguridad WHERE descripcion LIKE ? LIMIT 10`,
        [`%${q}%`]
      ),
    ]);

    resultados.push(...tareas.map((t) => ({ ...t, href: `/obra/${t.id}` })));
    resultados.push(...compras.map((c) => ({ ...c, href: `/compras/${c.id}` })));
    resultados.push(...docs.map((d) => ({ ...d, href: `/documentos#${d.id}` })));
    resultados.push(...jornadas.map((j) => ({ ...j, href: `/trabajo/${j.id}` })));
    resultados.push(...incidentes.map((i) => ({ ...i, href: `/seguridad#${i.id}` })));
  }

  return (
    <div>
      <PageHeader
        title="Búsqueda global"
        subtitle="Encuentra tareas, compras, documentos y más"
      />

      <form method="get" className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            placeholder="Buscar tareas, compras, documentos..."
            defaultValue={q}
            className="flex-1 rounded-xl border border-black/10 px-4 py-2 text-sm"
            autoFocus
          />
          <button className="rounded-xl bg-[#1f4e5f] text-white px-6 py-2 text-sm font-semibold">
            Buscar
          </button>
        </div>
      </form>

      {q && q.length < 2 && (
        <EmptyState>Escribí al menos 2 caracteres para buscar.</EmptyState>
      )}

      {q && q.length >= 2 && resultados.length === 0 && (
        <EmptyState>No se encontraron resultados para "{q}".</EmptyState>
      )}

      {resultados.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-black/50 mb-3">
            {resultados.length} resultado{resultados.length !== 1 ? "s" : ""}
          </p>
          {resultados.map((r, i) => (
            <a key={`${r.tipo}-${r.id}-${i}`} href={r.href || "#"}>
              <Card className="cursor-pointer hover:bg-black/2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge
                        color={
                          r.tipo === "obra"
                            ? "azul"
                            : r.tipo === "compra"
                              ? "verde"
                              : r.tipo === "documento"
                                ? "amarillo"
                                : r.tipo === "jornada"
                                  ? "naranja"
                                  : "rojo"
                        }
                      >
                        {r.modulo}
                      </Badge>
                      <p className="text-sm font-semibold">{r.titulo}</p>
                    </div>
                    {r.fecha && (
                      <p className="text-xs text-black/40 mt-1">
                        {dayjs(r.fecha).format("DD/MM/YYYY")}
                      </p>
                    )}
                  </div>
                  <Badge color={r.estado === "completada" ? "verde" : r.estado === "resuelto" ? "verde" : "amarillo"}>
                    {r.estado}
                  </Badge>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
