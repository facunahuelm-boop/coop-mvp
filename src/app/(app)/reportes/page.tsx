import { redirect } from "next/navigation";
import { ControlTabs } from "@/components/ControlTabs";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { REPORTES } from "@/lib/reportesCatalogo";
import { hoyEnUruguay } from "@/lib/horasObra";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import dayjs from "dayjs";
import { REPORTES_HUB } from "@/lib/constants";
import {
  generarReporteObraFormAction,
  generarReporteFinanzasFormAction,
  generarReporteTrabajoFormAction,
  generarReporteComprasFormAction,
  generarReporteSociosFormAction,
  generarReporteComisionesFormAction,
} from "@/lib/actions/reportes";

// Sub-fase 6.2 ("Reportes"): las acciones de generación no viven en
// REPORTES_HUB (lib/constants.ts) porque ese archivo es neutral (lo importa
// también la ruta de descarga, que no necesita ni puede importar Server
// Actions) — acá se les pega su acción correspondiente por `tipo`.
const ACCION_POR_TIPO: Record<string, (prev: any, formData: FormData) => Promise<any>> = {
  obra: generarReporteObraFormAction,
  finanzas: generarReporteFinanzasFormAction,
  trabajo: generarReporteTrabajoFormAction,
  compras: generarReporteComprasFormAction,
  socios: generarReporteSociosFormAction,
  comisiones: generarReporteComisionesFormAction,
};

export default async function ReportesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Sub-fase 6.2: antes esta pantalla completa se gateaba con
  // canRead(user.rol,"finanzas") aunque también contiene reportes de obra y
  // trabajo (y ahora compras/socios/comisiones) — un rol con lectura de
  // alguno de esos módulos pero no de finanzas se quedaba afuera de TODA la
  // pantalla, no solo de la tarjeta de Finanzas. Ahora se redirige solo si
  // no puede leer NINGUNO de los tipos de reporte que existen.
  const reportesDisponibles = REPORTES_HUB.filter((r) => canRead(user.rol, r.modulo));
  // Fase 2H: reportes de la sección 13 (PDF y Excel) según el rol.
  const catalogo = REPORTES.filter((r) => r.puede(user));
  if (reportesDisponibles.length === 0 && catalogo.length === 0) redirect("/dashboard");
  const grupos = [...new Set(catalogo.map((r) => r.grupo))];
  const hoy = hoyEnUruguay();
  const otros = [
    { href: "/finanzas/cierre", texto: "Cierre mensual por fondo (PDF)", ok: ROLES_FINANZAS_DETALLE.includes(user.rol) },
    { href: "/api/exportar/contador", texto: "Libro de movimientos para el contador (Excel)", ok: ROLES_FINANZAS_DETALLE.includes(user.rol) },
    { href: "/api/exportar/padron", texto: "Padrón de socios y lista de espera (Excel)", ok: canEdit(user.rol, "socios") || canRead(user.rol, "auditoria") },
    { href: "/api/exportar/auditoria", texto: "Auditoría de cambios (Excel)", ok: canRead(user.rol, "auditoria") },
    { href: "/asambleas", texto: "Convocatoria, padrón habilitado y acta de cada asamblea (PDF)", ok: canRead(user.rol, "comisiones") },
    { href: "/plantillas", texto: "Constancias y notas desde plantillas (PDF)", ok: canEdit(user.rol, "socios") || canEdit(user.rol, "finanzas") || user.rol === "consejo_directivo" || user.rol === "admin" },
  ].filter((o) => o.ok);

  // Sub-fase 6.2: antes este listado era `WHERE creado_por_id = ?` — un
  // Reporte Financiero generado por Tesorería no aparecía para Consejo
  // Directivo aunque ambos puedan leerlo (hallazgo de la auditoría previa).
  // Ahora es visible para toda la cooperativa (RLS ya limita a la propia
  // organización) y se filtra solo por los tipos que ESTA persona puede
  // leer, nunca por quién lo generó. El `tipo = ANY(?)` es necesario porque
  // reportes_generados también guarda tipos de OTRAS pantallas
  // (informe_fiscal, libro_actas_<organo>, registro_socios) que no deben
  // mezclarse acá.
  const tiposPermitidos = reportesDisponibles.map((r) => r.tipo);
  const ultimosReportes = await all<any>(
    `SELECT r.*, u.nombre as generado_por
     FROM reportes_generados r
     LEFT JOIN users u ON u.id = r.creado_por_id
     WHERE r.tipo = ANY(?::text[])
     ORDER BY r.creado_en DESC LIMIT 15`,
    [tiposPermitidos]
  );

  return (
    <div>
      <ControlTabs actual="/reportes" rol={user.rol} />
      <PageHeader title="Reportes" subtitle="PDF para lo oficial (se firma, se entrega, va a la asamblea) y Excel para analizar o mandar al contador." />

      {catalogo.length > 0 && (
        <div className="mb-8 space-y-6" id="descargas">
          {grupos.map((g) => (
            <div key={g}>
              <h3 className="mb-3 text-sm font-bold text-[var(--color-brand-900)]">{g}</h3>
              <Card>
                <ul className="divide-y divide-border">
                  {catalogo
                    .filter((r) => r.grupo === g)
                    .map((r) => (
                      <li key={r.clave} className="py-3">
                        <form method="get" action={`/api/reportes/r/${r.clave}`} target="_blank" className="flex flex-wrap items-end justify-between gap-3">
                          <div className="min-w-0 flex-1 basis-60">
                            <p className="text-[15px] font-semibold text-ink">{r.titulo}</p>
                            <p className="text-sm text-ink-muted">{r.descripcion}</p>
                          </div>
                          {r.periodo && (
                            <div className="flex flex-wrap gap-2">
                              <label className="block">
                                <Label>Desde</Label>
                                <input type="date" name="desde" defaultValue={`${hoy.slice(0, 7)}-01`} className={inputClass} />
                              </label>
                              <label className="block">
                                <Label>Hasta</Label>
                                <input type="date" name="hasta" defaultValue={hoy} className={inputClass} />
                              </label>
                            </div>
                          )}
                          <div className="flex gap-2">
                            {r.formatos.includes("pdf") && (
                              <button name="formato" value="pdf" className="rounded-lg bg-[var(--color-brand-100)] px-3 py-2 text-xs font-semibold whitespace-nowrap text-[var(--color-brand-800)]">
                                PDF
                              </button>
                            )}
                            {r.formatos.includes("xlsx") && (
                              <button name="formato" value="xlsx" className="rounded-lg bg-[var(--color-verde-bg)] px-3 py-2 text-xs font-semibold whitespace-nowrap text-[var(--color-verde)]">
                                Excel
                              </button>
                            )}
                          </div>
                        </form>
                      </li>
                    ))}
                </ul>
              </Card>
            </div>
          ))}
          {otros.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold text-[var(--color-brand-900)]">También</h3>
              <Card>
                <ul className="space-y-2 text-[15px]">
                  {otros.map((o) => (
                    <li key={o.href}>
                      <a href={o.href} className="font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
                        {o.texto}
                      </a>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </div>
      )}

      {reportesDisponibles.length > 0 && <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Informes por módulo (se guardan)</h3>}
      <div className="grid grid-cols-1 gap-3 mb-8">
        {reportesDisponibles.map((r) => (
            <Card key={r.tipo} className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{r.icon}</span>
                  <div>
                    <p className="text-sm font-semibold">{r.nombre}</p>
                    <p className="text-xs text-ink/60">{r.descripcion}</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 ml-4 flex-shrink-0 items-center">
                <ActionForm action={ACCION_POR_TIPO[r.tipo]}>
                  <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold whitespace-nowrap hover:bg-[var(--color-brand-100)]/70">
                    📄 Generar PDF
                  </button>
                </ActionForm>
              </div>
            </Card>
          ))}
      </div>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Reportes recientes</h3>
      <div className="space-y-2">
        {ultimosReportes.length === 0 && (
          <EmptyState>Aún no hay reportes generados.</EmptyState>
        )}
        {ultimosReportes.map((r) => (
          <Card key={r.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{r.nombre_reporte}</p>
              <p className="text-xs text-ink/50">
                {dayjs(r.creado_en).format("DD/MM/YYYY HH:mm")}{r.generado_por ? ` · ${r.generado_por}` : ""}
              </p>
            </div>
            {r.archivo_url ? (
              <a
                href={`/api/archivos/reporte/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-2 text-xs font-semibold"
              >
                Descargar
              </a>
            ) : (
              <span className="rounded-lg bg-ink/5 text-ink/30 px-3 py-2 text-xs font-semibold" title="Este reporte se generó con una versión anterior que no guardaba el archivo — generalo de nuevo">
                No disponible
              </span>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
