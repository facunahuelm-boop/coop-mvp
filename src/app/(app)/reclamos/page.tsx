import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canApprove, puedeGestionarReclamos } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { crearReclamoAction, tomarReclamoAction, resolverReclamoAction, reabrirReclamoAction } from "@/lib/actions/reclamos";
import { CATEGORIA_RECLAMO_LABEL, PRIORIDAD_RECLAMO_LABEL } from "@/lib/constants";
import { UsuarioLink } from "@/components/EntidadLink";
import { Pagination, paginaDe } from "@/components/Pagination";

const POR_PAGINA = 10;

export default async function ReclamosPage({
  searchParams,
}: {
  // Next.js 16: searchParams llega como Promise — ver la nota en
  // documentos/page.tsx sobre el bug que esto causa si no se hace await.
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "reclamos")) redirect("/dashboard");

  // AUDITORÍA INTEGRAL (hallazgo de seguridad, 12/09): "Tomar reclamo" y
  // "Marcar resuelto" no son para quien reporta (un socio) — ver
  // puedeGestionarReclamos en roles.ts.
  const puedeGestionar = puedeGestionarReclamos(user.rol);
  const puedeAprobar = canApprove(user.rol, "reclamos");
  const sp = await searchParams;
  const page = paginaDe(sp);

  // Fase 8 (paginación/búsqueda/filtros), hallazgo H-10: "Resueltos" se
  // armaba trayendo TODOS los reclamos (abiertos y resueltos juntos, sin
  // límite en la consulta) y recién ahí se recortaba a 10 en memoria — el
  // resto de los resueltos quedaba invisible y además se traía de la base
  // cada vez sin necesidad. Se separa en dos consultas: "abiertos" (siempre
  // completa — un reclamo sin resolver nunca se puede volver invisible) y
  // "resueltos" con paginación real (COUNT + LIMIT/OFFSET).
  const [abiertos, totalResueltosRow, resueltos, viviendas] = await Promise.all([
    all<any>(
      `SELECT r.*, v.numero as vivienda_numero, ur.nombre as reportado_por_nombre, ua.nombre as responsable_nombre
       FROM reclamos r
       LEFT JOIN viviendas v ON v.id = r.vivienda_id
       LEFT JOIN users ur ON ur.id = r.reportado_por_id
       LEFT JOIN users ua ON ua.id = r.responsable_id
       WHERE r.estado != 'resuelto'
       ORDER BY CASE r.estado WHEN 'abierto' THEN 0 ELSE 1 END, r.fecha DESC`
    ),
    get<{ total: string }>(`SELECT COUNT(*) as total FROM reclamos WHERE estado = 'resuelto'`),
    all<any>(
      `SELECT r.* FROM reclamos r WHERE r.estado = 'resuelto' ORDER BY r.resuelto_en DESC NULLS LAST, r.fecha DESC LIMIT ? OFFSET ?`,
      [POR_PAGINA, (page - 1) * POR_PAGINA]
    ),
    all<any>(`SELECT id, numero FROM viviendas ORDER BY numero ASC`),
  ]);
  const totalResueltos = Number(totalResueltosRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalResueltos / POR_PAGINA));

  const badgeColorEstado = (estado: string) => (estado === "resuelto" ? "verde" : estado === "en_proceso" ? "amarillo" : "rojo");
  const badgeColorPrioridad = (p: string) => (p === "alta" ? "rojo" : p === "media" ? "amarillo" : "gray");

  return (
    <div>
      <PageHeader title="Reclamos y Mantenimiento" subtitle="Problemas de viviendas y espacios comunes" />

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Reclamos abiertos</h3>
      <div className="space-y-2 mb-4">
        {abiertos.map((r) => (
          <Card key={r.id} className={r.estado === "abierto" ? "!border-[var(--color-rojo)]/20" : ""}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{r.titulo}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge color={badgeColorPrioridad(r.prioridad) as any}>{PRIORIDAD_RECLAMO_LABEL[r.prioridad] || r.prioridad}</Badge>
                <Badge color={badgeColorEstado(r.estado) as any}>{r.estado === "en_proceso" ? "en proceso" : r.estado}</Badge>
              </div>
            </div>
            <p className="text-xs text-ink/50 mt-0.5">
              {CATEGORIA_RECLAMO_LABEL[r.categoria] || r.categoria}
              {r.vivienda_numero ? ` · Vivienda ${r.vivienda_numero}` : " · Espacio común"}
            </p>
            {r.descripcion && <p className="text-sm text-ink/70 mt-1">{r.descripcion}</p>}
            {r.foto_url && <img src={r.foto_url} alt="" className="mt-2 rounded-lg max-h-48 object-cover" />}
            <p className="text-xs text-ink/40 mt-1">
              {dayjs(r.fecha).format("DD/MM/YYYY")} · <UsuarioLink id={r.reportado_por_id} nombre={r.reportado_por_nombre} fallback="Sistema" />
              {r.responsable_id && (
                <>
                  {" · a cargo de "}
                  <UsuarioLink id={r.responsable_id} nombre={r.responsable_nombre} />
                </>
              )}
            </p>
            {puedeGestionar && r.estado === "abierto" && (
              <form action={tomarReclamoAction} className="mt-2">
                <input type="hidden" name="id" value={r.id} />
                <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold">Tomar reclamo</button>
              </form>
            )}
            {puedeGestionar && r.estado === "en_proceso" && (
              <form action={resolverReclamoAction} className="mt-2 flex gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input name="resolucion" placeholder="¿Cómo se resolvió?" className={inputClass + " text-xs"} />
                <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold whitespace-nowrap">Marcar resuelto</button>
              </form>
            )}
          </Card>
        ))}
        {abiertos.length === 0 && <EmptyState>No hay reclamos abiertos — todo está al día.</EmptyState>}
      </div>

      <details className="mb-8">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Reportar un problema</summary>
        <Card className="mt-3">
          <form action={crearReclamoAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><Label>¿Cuál es el problema?</Label><input name="titulo" required className={inputClass} placeholder="ej: Filtración en el techo del pasillo" /></div>
            <div>
              <Label>Categoría</Label>
              <select name="categoria" className={inputClass} defaultValue="otros">
                {Object.entries(CATEGORIA_RECLAMO_LABEL).map(([valor, label]) => (
                  <option key={valor} value={valor}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Vivienda (opcional — dejalo vacío si es un espacio común)</Label>
              <select name="vivienda_id" className={inputClass} defaultValue="">
                <option value="">Espacio común</option>
                {viviendas.map((v) => (
                  <option key={v.id} value={v.id}>{v.numero}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Prioridad</Label>
              <select name="prioridad" className={inputClass} defaultValue="media">
                {Object.entries(PRIORIDAD_RECLAMO_LABEL).map(([valor, label]) => (
                  <option key={valor} value={valor}>{label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2"><Label>Descripción</Label><textarea name="descripcion" className={inputClass} rows={2} /></div>
            <div className="sm:col-span-2"><Label>Foto (opcional)</Label><input type="file" name="foto" accept="image/*" className="text-xs" /></div>
            <div className="sm:col-span-2"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Reportar</button></div>
          </form>
        </Card>
      </details>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Resueltos</h3>
      <div className="space-y-2">
        {resueltos.map((r) => (
          <Card key={r.id}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{r.titulo}</p>
              <Badge color="verde">resuelto</Badge>
            </div>
            {r.resolucion && <p className="text-xs text-ink/60 mt-1">{r.resolucion}</p>}
            <p className="text-xs text-ink/40 mt-1">{r.resuelto_en ? dayjs(r.resuelto_en).format("DD/MM/YYYY") : ""}</p>
            {puedeAprobar && (
              <form action={reabrirReclamoAction} className="mt-1">
                <input type="hidden" name="id" value={r.id} />
                <button className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">Reabrir</button>
              </form>
            )}
          </Card>
        ))}
        {resueltos.length === 0 && <EmptyState>Todavía no hay reclamos resueltos.</EmptyState>}
      </div>
      {resueltos.length > 0 && <Pagination page={page} totalPages={totalPages} basePath="/reclamos" searchParams={sp} />}
    </div>
  );
}
