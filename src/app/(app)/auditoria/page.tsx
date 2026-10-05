import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Label, inputClass } from "@/components/ui";
import { Pagination, paginaDe } from "@/components/Pagination";
import { AuditoriaLista } from "@/components/AuditoriaLista";
import { MODULOS_AUDITORIA, entidadesDeModulo, etiquetaDeAccion, nombreDeEntidad, moduloDeEntidad, registroLegible } from "@/lib/auditoriaTexto";

const POR_PAGINA = 30;

export default async function AuditoriaPage({
  searchParams,
}: {
  // Next.js 16: searchParams llega como Promise — ver la nota en
  // documentos/page.tsx sobre el bug que esto causa si no se hace await.
  searchParams: Promise<{ page?: string; usuario_id?: string; entidad?: string; accion?: string; desde?: string; hasta?: string; modulo?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "auditoria")) redirect("/dashboard");

  const sp = await searchParams;
  const page = paginaDe(sp);
  const usuarioIdFiltro = sp.usuario_id?.trim() || "";
  const entidadFiltro = sp.entidad?.trim() || "";
  // Fase 2 ("Auditoría", sección 11, sub-fase 2.2): la pantalla ya tenía
  // filtro por usuario y por tipo de entidad (módulo) — la sección 11 pide
  // además poder filtrar por acción y por fecha, así que se suman acá sobre
  // la misma pantalla ya existente (no se crea una segunda vista de
  // auditoría en paralelo).
  const accionFiltro = sp.accion?.trim() || "";
  const desdeFiltro = sp.desde?.trim() || "";
  const hastaFiltro = sp.hasta?.trim() || "";
  // Auditoría legible (04/10): filtro por MÓDULO (grupo de tablas, ej.
  // "Cuotas y pagos") y búsqueda libre por nombre de usuario o contenido.
  const moduloFiltro = sp.modulo?.trim() || "";
  const qFiltro = sp.q?.trim() || "";
  const hayFiltros = !!(usuarioIdFiltro || entidadFiltro || accionFiltro || desdeFiltro || hastaFiltro || moduloFiltro || qFiltro);

  // Fase 8 del Prompt Maestro ("paginación/búsqueda/filtros"), hallazgo H-10:
  // esta pantalla tenía un LIMIT 200 fijo — con más de 200 movimientos en el
  // sistema, los más viejos quedaban invisibles sin ninguna forma de verlos.
  // Se reemplaza por paginación real (COUNT + LIMIT/OFFSET) y se agregan
  // filtros (usuario, tipo de entidad, acción, rango de fechas) para que
  // encontrar un registro puntual no dependa de recorrer página por página.
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
  if (moduloFiltro) {
    const entidades = entidadesDeModulo(moduloFiltro);
    if (moduloFiltro === "Otros") {
      // "Otros" = todo lo que no pertenece a ningún módulo conocido.
      const conocidas = MODULOS_AUDITORIA.filter((m) => m !== "Otros").flatMap((m) => entidadesDeModulo(m));
      condiciones.push(`a.entidad NOT IN (${conocidas.map(() => "?").join(",")})`);
      valores.push(...conocidas);
    } else if (entidades.length) {
      condiciones.push(`a.entidad IN (${entidades.map(() => "?").join(",")})`);
      valores.push(...entidades);
    }
  }
  if (qFiltro) {
    condiciones.push("(u.nombre ILIKE ? OR a.valor_nuevo ILIKE ? OR a.valor_anterior ILIKE ?)");
    const patron = `%${qFiltro.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    valores.push(patron, patron, patron);
  }
  if (accionFiltro) {
    condiciones.push("a.accion = ?");
    valores.push(accionFiltro);
  }
  if (desdeFiltro) {
    condiciones.push("a.fecha::date >= ?::date");
    valores.push(desdeFiltro);
  }
  if (hastaFiltro) {
    condiciones.push("a.fecha::date <= ?::date");
    valores.push(hastaFiltro);
  }
  const whereSql = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

  const [totalRow, registros, usuarios, entidades, acciones] = await Promise.all([
    get<{ total: string }>(`SELECT COUNT(*) as total FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id ${whereSql}`, valores),
    all<any>(
      `SELECT a.*, u.nombre as usuario_nombre FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id ${whereSql} ORDER BY a.fecha DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...valores, POR_PAGINA, (page - 1) * POR_PAGINA]
    ),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users ORDER BY nombre ASC`),
    all<{ entidad: string }>(`SELECT DISTINCT entidad FROM auditoria ORDER BY entidad ASC`),
    all<{ accion: string }>(`SELECT DISTINCT accion FROM auditoria ORDER BY accion ASC`),
  ]);
  const total = Number(totalRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div>
      <PageHeader title="Auditoría" subtitle="Registro de solo lectura: quién hizo qué, cuándo y qué cambió. No se puede editar ni borrar." />

      <Card className="mb-4">
        <form className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 items-end" method="get">
          <div className="col-span-2">
            <Label>Buscar</Label>
            <input name="q" defaultValue={qFiltro} placeholder="Nombre de usuario, núcleo, monto, texto…" className={inputClass} />
          </div>
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
            <Label>Módulo</Label>
            <select name="modulo" defaultValue={moduloFiltro} className={inputClass}>
              <option value="">Todos</option>
              {MODULOS_AUDITORIA.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Tipo de registro</Label>
            <select name="entidad" defaultValue={entidadFiltro} className={inputClass}>
              <option value="">Todos</option>
              {entidades
                .map((e) => ({ valor: e.entidad, label: nombreDeEntidad(e.entidad), modulo: moduloDeEntidad(e.entidad) }))
                .sort((a, b) => a.label.localeCompare(b.label, "es"))
                .map((e) => (
                  <option key={e.valor} value={e.valor}>{e.label.charAt(0).toUpperCase() + e.label.slice(1)} ({e.modulo})</option>
                ))}
            </select>
          </div>
          <div>
            <Label>Acción</Label>
            <select name="accion" defaultValue={accionFiltro} className={inputClass}>
              <option value="">Todas</option>
              {acciones
                .map((a) => ({ valor: a.accion, label: etiquetaDeAccion(a.accion) }))
                // Dos acciones distintas pueden leerse igual ("Creó" una
                // reunión / "Creó" una serie): se aclara cuál es cuál.
                .map((a, _i, todas) =>
                  todas.filter((x) => x.label === a.label).length > 1 ? { ...a, label: `${a.label} (${a.valor.replace(/_/g, " ")})` } : a
                )
                .sort((a, b) => a.label.localeCompare(b.label, "es"))
                .map((a) => (
                  <option key={a.valor} value={a.valor}>{a.label}</option>
                ))}
            </select>
          </div>
          <div>
            <Label>Desde</Label>
            <input type="date" name="desde" defaultValue={desdeFiltro} className={inputClass} />
          </div>
          <div>
            <Label>Hasta</Label>
            <input type="date" name="hasta" defaultValue={hastaFiltro} className={inputClass} />
          </div>
          <div className="flex gap-2 col-span-2 sm:col-span-1">
            <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 text-sm font-semibold">Filtrar</button>
            {hayFiltros && (
              <Link href="/auditoria" className="rounded-xl bg-ink/5 text-ink-muted px-4 py-2.5 text-sm font-semibold">Limpiar</Link>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <p className="text-xs text-ink-faint mb-2">{total} evento(s){hayFiltros ? " con estos filtros" : ""}. Tocá uno para ver el detalle.</p>
        <AuditoriaLista
          registros={registros.map(registroLegible)}
          mostrarModulo
          vacioTexto={`Sin registros de auditoría ${hayFiltros ? "con este filtro." : "todavía."}`}
        />
      </Card>

      <Pagination page={page} totalPages={totalPages} basePath="/auditoria" searchParams={sp} />
    </div>
  );
}
