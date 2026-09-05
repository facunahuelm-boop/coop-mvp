import { getCurrentUser } from "@/lib/auth";
import { groupsFor } from "@/components/Nav";
import { PageHeader } from "@/components/ui";
import { logoutAction } from "@/lib/actions/auth";
import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function MasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const groups = groupsFor(user);

  return (
    <div>
      <PageHeader title="Menú" subtitle={`${user.nombre} · ${ROLE_LABELS[user.rol]}`} />
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/40">
              {g.label}
            </div>
            <div className="bg-white rounded-2xl border border-black/5 divide-y divide-black/5 overflow-hidden">
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="flex items-center gap-3 px-4 py-3.5 text-sm text-[#123240] hover:bg-black/[.02]">
                  <span className="text-lg">{i.icon}</span>
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <form action={logoutAction} className="mt-4">
        <button className="w-full rounded-xl border border-black/10 bg-white py-2.5 text-sm font-medium text-[#b3261e]">Cerrar sesión</button>
      </form>
    </div>
  );
}
