import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import { ImportarPadronSociosPanel, ImportarMovimientosPanel, DeshacerImportacionBoton } from "@/components/importar/ImportarFormularios";
import dayjs from "dayjs";

/**
 * Fase 6 ("Migración de datos Excel/CSV(30) + Reportes(31) + IA contextual
 * por módulo(29) + Centro de ayuda/tickets") — Sub-fase 6.1: Migración de
 * datos Excel/CSV (sección 30, primera de esta fase).
 *
 * El texto original de la sección 30 está irrecuperable, mismo problema que
 * fases anteriores. Auditoría previa confirmó que no existía NINGÚN
 * mecanismo de importación (ni librería, ni pantalla) en todo el sistema.
 * Alcance confirmado con el usuario: dos entidades primero — Padrón de
 * socios y Movimientos financieros históricos (ver actions/importaciones.ts
 * para el detalle del flujo previsualizar→confirmar y por qué).
 *
 * Gate: solo `admin` (igual que /usuarios, más estricto que
 * canEdit("socios")/canEdit("finanzas")) — ver el comentario de
 * actions/importaciones.ts para el razonamiento completo. Sin `mod` en el
 * ítem de Nav (mismo criterio que /usuarios/reglas-automaticas): la
 * restricción real la hace esta misma página.
 */
type FilaImportacion = {
  id: number;
  tipo: string;
  nombre_archivo: string;
  cantidad_filas: number;
  cantidad_importadas: number;
  cantidad_errores: number;
  estado: string;
  creado_en: string;
  importado_por: string | null;
};

const TIPO_LABEL: Record<string, string> = {
  socios: "Padrón de socios",
  movimientos_financieros: "Movimientos financieros",
};

export default async function ImportarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.rol !== "admin") redirect("/dashboard");

  let importaciones: FilaImportacion[] = [];
  try {
    importaciones = await all<FilaImportacion>(
      `SELECT i.*, u.nombre AS importado_por
       FROM importaciones i
       LEFT JOIN users u ON u.id = i.importado_por_id
       ORDER BY i.creado_en DESC
       LIMIT 20`
    );
  } catch {
    // Migración 0041 todavía no corrida en este entorno — se muestra la
    // pantalla igual, solo sin historial (mismo criterio que el resto del
    // sistema ante una tabla/columna que todavía no existe).
    importaciones = [];
  }

  return (
    <div>
      <PageHeader
        title="Importar datos"
        subtitle="Cargar en lote desde una planilla Excel o CSV — pensado para migrar datos de una cooperativa que recién empieza a usar el sistema"
      />

      <Tabs
        tabs={[
          { id: "socios", label: "Padrón de socios", content: <ImportarPadronSociosPanel /> },
          { id: "movimientos", label: "Movimientos financieros", content: <ImportarMovimientosPanel /> },
        ]}
      />

      <h2 className="text-sm font-semibold text-ink/70 mt-6 mb-2">Historial de importaciones</h2>
      {importaciones.length === 0 ? (
        <EmptyState>Todavía no se importó ningún archivo.</EmptyState>
      ) : (
        <div className="space-y-2">
          {importaciones.map((imp) => (
            <Card key={imp.id}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {TIPO_LABEL[imp.tipo] ?? imp.tipo} — {imp.nombre_archivo}
                  </p>
                  <p className="text-xs text-ink/50 mt-0.5">
                    {imp.cantidad_importadas} importada{imp.cantidad_importadas === 1 ? "" : "s"} de {imp.cantidad_filas}
                    {imp.cantidad_errores > 0 && ` · ${imp.cantidad_errores} con error`}
                    {" · "}
                    {imp.importado_por ?? "—"} · {dayjs(imp.creado_en).format("DD/MM/YYYY HH:mm")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {imp.estado === "deshecho" ? (
                    <Badge color="gray">Deshecha</Badge>
                  ) : (
                    <>
                      <Badge color="verde">Activa</Badge>
                      {imp.cantidad_importadas > 0 && <DeshacerImportacionBoton id={imp.id} />}
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
