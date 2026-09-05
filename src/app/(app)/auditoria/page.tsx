import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import dayjs from "dayjs";

export default async function AuditoriaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "auditoria")) redirect("/dashboard");

  const registros = await all<any>(`SELECT a.*, u.nombre as usuario_nombre FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id ORDER BY a.fecha DESC LIMIT 200`);

  return (
    <div>
      <PageHeader title="Auditoría" subtitle="Registro de solo lectura: quién hizo qué, cuándo y qué cambió. No se puede editar ni borrar." />
      <Card>
        <div className="divide-y divide-black/5">
          {registros.map((r) => (
            <div key={r.id} className="py-2.5 text-sm">
              <p><strong>{r.usuario_nombre || "sistema"}</strong> — {r.accion.replace(/_/g, " ")} en <span className="font-mono text-xs bg-black/5 rounded px-1">{r.entidad}</span>{r.entidad_id ? ` #${r.entidad_id}` : ""}</p>
              <p className="text-xs text-black/40">{dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}</p>
              {r.valor_nuevo && <p className="text-xs text-black/50 mt-0.5 font-mono truncate">{r.valor_nuevo}</p>}
            </div>
          ))}
          {registros.length === 0 && <EmptyState>Sin registros de auditoría todavía.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
