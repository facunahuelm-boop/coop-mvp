import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all, get } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import { generarReporteObraAction, generarReporteFinanzasAction, generarReporteTrabajoAction } from "@/lib/actions/reportes";

export default async function ReportesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "finanzas")) redirect("/dashboard");

  const ultimosReportes = await all<any>(
    `SELECT * FROM reportes_generados WHERE creado_por_id = ? ORDER BY creado_en DESC LIMIT 5`,
    [user.id]
  );

  const reportesDisponibles = [
    {
      id: "obra",
      nombre: "Reporte de Obra",
      descripcion: "Resumen mensual del avance de la obra, tareas completadas, problemas y cronograma",
      icon: "🏗️",
      action: generarReporteObraAction,
      modulo: "obra",
    },
    {
      id: "finanzas",
      nombre: "Reporte Financiero",
      descripcion: "Estado de ingresos, egresos, presupuesto vs real y proyecciones",
      icon: "💰",
      action: generarReporteFinanzasAction,
      modulo: "finanzas",
    },
    {
      id: "trabajo",
      nombre: "Reporte de Jornadas",
      descripcion: "Asistencias, horas acumuladas por núcleo, distribución de tareas",
      icon: "🤝",
      action: generarReporteTrabajoAction,
      modulo: "trabajo",
    },
  ];

  return (
    <div>
      <PageHeader title="Reportes" subtitle="Genera reportes en PDF o Excel" />

      <h3 className="text-sm font-bold text-[#123240] mb-3">Generar nuevo reporte</h3>
      <div className="grid grid-cols-1 gap-3 mb-8">
        {reportesDisponibles
          .filter((r) => canRead(user.rol, r.modulo as any))
          .map((r) => (
            <Card key={r.id} className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{r.icon}</span>
                  <div>
                    <p className="text-sm font-semibold">{r.nombre}</p>
                    <p className="text-xs text-black/60">{r.descripcion}</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 ml-4 flex-shrink-0">
                <form action={r.action}>
                  <input type="hidden" name="formato" value="pdf" />
                  <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-2 text-xs font-semibold whitespace-nowrap hover:bg-[#d0e3e7]">
                    📄 PDF
                  </button>
                </form>
                <form action={r.action}>
                  <input type="hidden" name="formato" value="xlsx" />
                  <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-2 text-xs font-semibold whitespace-nowrap hover:bg-[#d0e3e7]">
                    📊 Excel
                  </button>
                </form>
              </div>
            </Card>
          ))}
      </div>

      <h3 className="text-sm font-bold text-[#123240] mb-3">Reportes recientes</h3>
      <div className="space-y-2">
        {ultimosReportes.length === 0 && (
          <EmptyState>Aún no hay reportes generados.</EmptyState>
        )}
        {ultimosReportes.map((r) => (
          <Card key={r.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{r.nombre_reporte}</p>
              <p className="text-xs text-black/50">
                {dayjs(r.creado_en).format("DD/MM/YYYY HH:mm")}
              </p>
            </div>
            <a
              href={`/api/descargar-reporte/${r.id}`}
              className="rounded-lg bg-[#1f4e5f] text-white px-3 py-2 text-xs font-semibold"
            >
              Descargar
            </a>
          </Card>
        ))}
      </div>
    </div>
  );
}
