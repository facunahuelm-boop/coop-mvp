import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { recalcularAlertas } from "@/lib/logic";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/roles";
import dayjs from "dayjs";
import { resolverAlertaAction } from "@/lib/actions/alertas";

const SEV_LABEL: Record<string, string> = { critica: "🔴 Crítica", importante: "🟠 Importante", informativa: "🟢 Informativa" };
const SEV_COLOR: Record<string, "rojo" | "amarillo" | "verde"> = { critica: "rojo", importante: "amarillo", informativa: "verde" };
const MOD_LABEL: Record<string, string> = { obra: "🏗️ Obra", trabajo: "🤝 Trabajo", compras: "🛒 Compras", seguridad: "🦺 Seguridad", finanzas: "💰 Finanzas" };

export default async function AlertasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await recalcularAlertas();

  const [abiertas, resueltas] = await Promise.all([
    all<any>(`SELECT * FROM alertas WHERE estado='abierta' ORDER BY CASE severidad WHEN 'critica' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, fecha DESC`),
    all<any>(`SELECT * FROM alertas WHERE estado='resuelta' ORDER BY fecha DESC LIMIT 10`),
  ]);

  return (
    <div>
      <PageHeader title="Alertas" subtitle="Generadas automáticamente a partir de los datos cargados en cada módulo" />

      <div className="space-y-2 mb-8">
        {abiertas.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge color={SEV_COLOR[a.severidad]}>{SEV_LABEL[a.severidad]}</Badge>
                  <span className="text-xs text-black/40">{MOD_LABEL[a.origen_modulo] || a.origen_modulo}</span>
                </div>
                <p className="text-sm font-semibold text-[#123240]">{a.titulo}</p>
                {a.descripcion && <p className="text-xs text-black/60 mt-0.5">{a.descripcion}</p>}
                <p className="text-xs text-black/35 mt-1">
                  {dayjs(a.fecha).format("DD/MM/YYYY")} {a.asignado_a_rol && `· asignada a ${ROLE_LABELS[a.asignado_a_rol as keyof typeof ROLE_LABELS] || a.asignado_a_rol}`}
                </p>
              </div>
              {(user.rol === a.asignado_a_rol || ["consejo_directivo", "admin"].includes(user.rol)) && (
                <form action={resolverAlertaAction}><input type="hidden" name="id" value={a.id} />
                  <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-1.5 text-xs font-semibold whitespace-nowrap">Marcar resuelta</button>
                </form>
              )}
            </div>
          </Card>
        ))}
        {abiertas.length === 0 && <Card><p className="text-sm text-[var(--color-verde)]">🟢 No hay alertas abiertas en este momento.</p></Card>}
      </div>

      {resueltas.length > 0 && (
        <>
          <h3 className="text-sm font-bold text-[#123240]/60 mb-2">Resueltas recientemente</h3>
          <div className="space-y-1.5 opacity-60">
            {resueltas.map((a) => <Card key={a.id} className="text-xs">{a.titulo} — {dayjs(a.fecha).format("DD/MM")}</Card>)}
          </div>
        </>
      )}
    </div>
  );
}
