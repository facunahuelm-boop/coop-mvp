import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, EmptyState, Label, inputClass } from "@/components/ui";

/**
 * Fase 2C — Directorio de oficios: qué sabe hacer cada núcleo (para que la
 * Comisión de Trabajo sepa a quién llamar). Se carga desde la ficha de cada
 * socio.
 */
export default async function OficiosPage({ searchParams }: { searchParams: Promise<{ oficio?: string; q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "socios") && !canRead(user.rol, "trabajo")) redirect("/dashboard");
  const sp = await searchParams;
  const verContacto = user.rol !== "socio";

  const filas = await all<{ id: number; habilidad: string; persona: string | null; nota: string | null; socio_id: number | null; socio: string | null; telefono: string | null; nucleo: string | null }>(
    `SELECT h.id, h.habilidad, h.persona, h.nota, s.id AS socio_id, s.nombre AS socio, s.telefono, n.nombre AS nucleo
       FROM habilidades_nucleo h
       JOIN nucleos_familiares n ON n.id = h.nucleo_id
       LEFT JOIN LATERAL (SELECT id, nombre, telefono FROM socios WHERE nucleo_id = h.nucleo_id AND estado NOT IN ('baja', 'egresado', 'excluido') ORDER BY id LIMIT 1) s ON true
      WHERE COALESCE(h.activo, 1) = 1
      ORDER BY lower(h.habilidad), h.persona`
  ).catch(() => []);
  const oficios = [...new Set(filas.map((f) => f.habilidad.trim()))].sort((a, b) => a.localeCompare(b, "es"));
  const filtro = (sp.oficio || "").trim();
  const q = (sp.q || "").trim().toLowerCase();
  const visibles = filas.filter(
    (f) => (!filtro || f.habilidad.trim() === filtro) && (!q || [f.habilidad, f.persona, f.socio, f.nucleo].some((x) => (x || "").toLowerCase().includes(q)))
  );
  const grupos = new Map<string, typeof visibles>();
  for (const f of visibles) {
    const k = f.habilidad.trim();
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Directorio de oficios"
        subtitle="Qué sabe hacer cada núcleo. Se carga desde la ficha de cada socio («+ Agregar oficio»)."
        action={
          <Link href="/socios" className="inline-flex items-center rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-sunken">
            ← Volver a Socios
          </Link>
        }
      />
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
        <label>
          <Label>Oficio</Label>
          <select name="oficio" defaultValue={filtro} className={inputClass}>
            <option value="">Todos</option>
            {oficios.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Label>Buscar</Label>
          <input name="q" defaultValue={sp.q || ""} placeholder="Nombre o núcleo" className={inputClass} />
        </label>
        <button className="rounded-xl bg-[var(--color-brand-800)] px-4 py-2.5 text-sm font-semibold text-white">Buscar</button>
      </form>
      {grupos.size === 0 ? (
        <Card>
          <EmptyState>{filas.length ? "No hay nadie con ese oficio." : "Todavía no hay oficios cargados."}</EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {[...grupos.entries()].map(([oficio, lista]) => (
            <Card key={oficio}>
              <h2 className="text-lg font-bold text-ink">
                {oficio} <span className="text-[15px] font-normal text-ink-muted">({lista.length})</span>
              </h2>
              <ul className="mt-2 divide-y divide-border text-[15px]">
                {lista.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <b>{f.persona || f.socio || f.nucleo}</b>
                      <span className="block text-sm text-ink-muted">
                        {f.nucleo}
                        {f.nota ? ` · ${f.nota}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {verContacto && f.telefono && (
                        <a href={`tel:${f.telefono.replace(/[^\d+]/g, "")}`} className="font-semibold text-[var(--color-brand-800)] underline">
                          📞 {f.telefono}
                        </a>
                      )}
                      {f.socio_id && user.rol !== "socio" && (
                        <Link href={`/socios/${f.socio_id}`} className="text-sm underline">
                          Ficha
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
