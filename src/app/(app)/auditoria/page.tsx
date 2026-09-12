import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, EmptyState, Label, inputClass } from "@/components/ui";
import { Pagination, paginaDe } from "@/components/Pagination";
import dayjs from "dayjs";

const POR_PAGINA = 30;

export default async function AuditoriaPage({
  searchParams,
}: {
  // Next.js 16: searchParams llega como Promise — ver la nota en
  // documentos/page.tsx sobre el bug que esto causa si no se hace await.
  searchParams: Promise<{ page?: string; usuario_id?: string; entidad?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "auditoria")) redirect("/dashboard");

  const sp = await searchParams;
  const page = paginaDe(sp);
  const usuarioIdFiltro = sp.usuario_id?.trim() || "";
  const entidadFiltro = sp.entidad?.trim() || "";

  // Fase 8 del Prompt Maestro ("paginación/búsqueda/filtros"), hallazgo H-10:
  // esta pantalla tenía un LIMIT 200 fijo — con más de 200 movimientos en el
  // sistema, los más viejos quedaban invisibles sin ninguna forma de verlos.
  // Se reemplaza por paginación real (COUNT + LIMIT/OFFSET) y se agregan dos
  // filtros (usuario, tipo de entidad) para que encontrar un registro puntual
  // no dependa de recorrer página por página.
  const condiciones: string[] = [];
  const valores: any[] = [];
  if (usuarioIdFiltro) {
    condiciones.push("a.usuario_id = ?");
    valores.push(usuarioIdFiltro);
  }
  if (entidadFiltro) {
    condiciones.push("a.entidad = ?");
    valores.push(entidadFiltro);
  }
  const whereSql = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

  const [totalRow, registros, usuarios, entidades] = await Promise.all([
    get<{ total: string }>(`SELECT COUNT(*) as total FROM auditoria a ${whereSql}`, valores),
    all<any>(
      `SELECT a.*, u.nombre as usuario_nombre FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id ${whereSql} ORDER BY a.fecha DESC LIMIT ? OFFSET ?`,
      [...valores, POR_PAGINA, (page - 1) * POR_PAGINA]
    ),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users ORDER BY nombre ASC`),
    all<{ entidad: string }>(`SELECT DISTINCT entidad FROM auditoria ORDER BY entidad ASC`),
  ]);
  const total = Number(totalRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div>
      <PageHeader title="Auditoría" subtitle="Registro de solo lectura: quién hizo qué, cuándo y qué cambió. No se puede editar ni borrar." />

      <Card className="mb-4">
        <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end" method="get">
          <div>
            <Label>Usuario</Label>
            <select name="usuario_id" defaultValue={usuarioIdFiltro} className={inputClass}>
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Tipo</Label>
            <select name="entidad" defaultValue={entidadFiltro} className={inputClass}>
              <option value="">Todos</option>
              {entidades.map((e) => (
                <option key={e.entidad} value={e.entidad}>{e.entidad}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 text-sm font-semibold">Filtrar</button>
            {(usuarioIdFiltro || entidadFiltro) && (
              <Link href="/auditoria" className="rounded-xl bg-ink/5 text-ink-muted px-4 py-2.5 text-sm font-semibold">Limpiar</Link>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <div className="divide-y divide-ink/5">
          {registros.map((r) => (
            <div key={r.id} className="py-2.5 text-sm">
              <p>
                <strong>
                  {/* Fase 6 (perfil individual de usuario): antes era texto
                      suelto, sin forma de ver quién es esa persona. */}
                  {r.usuario_id ? (
                    <Link href={`/usuarios/${r.usuario_id}`} className="hover:underline underline-offset-2">
                      {r.usuario_nombre || "usuario eliminado"}
                    </Link>
                  ) : (
                    r.usuario_nombre || "sistema"
                  )}
                </strong>{" "}
                — {r.accion.replace(/_/g, " ")} en <span className="font-mono text-xs bg-ink/5 rounded px-1">{r.entidad}</span>{r.entidad_id ? ` #${r.entidad_id}` : ""}
              </p>
              <p className="text-xs text-ink/40">{dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}</p>
              {r.valor_nuevo && <p className="text-xs text-ink/50 mt-0.5 font-mono truncate">{r.valor_nuevo}</p>}
            </div>
          ))}
          {registros.length === 0 && <EmptyState>Sin registros de auditoría {usuarioIdFiltro || entidadFiltro ? "con este filtro." : "todavía."}</EmptyState>}
        </div>
      </Card>

      <Pagination page={page} totalPages={totalPages} basePath="/auditoria" searchParams={sp} />
    </div>
  );
}
