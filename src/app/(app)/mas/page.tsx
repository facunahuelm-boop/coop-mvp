import { getCurrentUser } from "@/lib/auth";
import { groupsFor, itemsFor, itemsAccesibles } from "@/components/Nav";
import { get } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { logoutAction } from "@/lib/actions/auth";
import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function MasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const esSocio = !!(await get<{ id: number }>(`SELECT id FROM socios WHERE user_id = ? LIMIT 1`, [user.id]).catch(() => undefined));
  const groups = groupsFor(user, esSocio);
  // Fase 1D: lo que la persona puede abrir pero no está en su menú corto
  // (por ejemplo, el socio puede consultar las comisiones o las asambleas).
  const enMenu = new Set(itemsFor(user, esSocio).map((i) => i.href));
  const otras = itemsAccesibles(user, esSocio).filter((i) => !enMenu.has(i.href) && i.href !== "/alertas");

  return (
    <div>
      <PageHeader title="Menú" subtitle={`${user.nombre} · ${ROLE_LABELS[user.rol]}`} />
      {/* Fase 6 (perfil individual de usuario): mismo criterio que la
          Sidebar de escritorio — "Ver mi perfil" es el punto de entrada,
          sin sumar un ítem más a los grupos de abajo. */}
      <Link
        href={`/usuarios/${user.id}`}
        className="mb-4 flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3.5 text-sm font-medium text-ink hover:bg-ink/[.02]"
      >
        Ver mi perfil
        <span className="text-ink-muted">→</span>
      </Link>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {g.label}
            </div>
            <div className="bg-surface rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="flex items-center gap-3 px-4 py-3.5 text-sm text-ink hover:bg-ink/[.02]">
                  <span className="shrink-0 text-ink-muted">{i.icon}</span>
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
        {otras.length > 0 && (
          <div>
            <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Otras secciones</div>
            <div className="bg-surface rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {otras.map((i) => (
                <Link key={i.href} href={i.href} className="flex items-center gap-3 px-4 py-3.5 text-sm text-ink hover:bg-ink/[.02]">
                  <span className="shrink-0 text-ink-muted">{i.icon}</span>
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <form action={logoutAction} className="mt-4">
        <button className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-[var(--color-rojo)]">Cerrar sesión</button>
      </form>
    </div>
  );
}
