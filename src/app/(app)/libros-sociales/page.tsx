import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canApprove } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import dayjs from "dayjs";
import { generarLibroActasFormAction, generarRegistroSociosFormAction } from "@/lib/actions/libros";

// Sub-fase 1.2 ("Libros Sociales digitales", 22/09): página nueva, mismo
// patrón visual y de componentes que /reportes (Card de "generar" + Card de
// "generados recientemente" con botón Descargar) — no se inventa ningún
// patrón de UI nuevo. La diferencia con /reportes es a propósito: acá la
// lista de generados es de TODA la cooperativa (institucional), no solo lo
// que generó el usuario logueado — ver /api/archivos/libro/[id].
export default async function LibrosSocialesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeGenerar = canApprove(user.rol, "comisiones");

  // .catch(): si la migración 0031 todavía no corrió en esta base, la
  // columna numero_libro no existe todavía — la página tiene que seguir
  // mostrando la cantidad de actas igual (solo sin folio) en vez de romperse.
  const [resumenActas, resumenSocios, generados] = await Promise.all([
    all<{ organo: string; cantidad: number; ultimo_folio: number | null; ultima_fecha: string | null }>(
      `SELECT organo, COUNT(*) as cantidad, MAX(numero_libro) as ultimo_folio, MAX(fecha) as ultima_fecha
       FROM actas WHERE organo IN ('asamblea', 'consejo_directivo') GROUP BY organo`
    ).catch(() =>
      all<{ organo: string; cantidad: number; ultima_fecha: string | null }>(
        `SELECT organo, COUNT(*) as cantidad, MAX(fecha) as ultima_fecha
         FROM actas WHERE organo IN ('asamblea', 'consejo_directivo') GROUP BY organo`
      ).then((filas) => filas.map((f) => ({ ...f, ultimo_folio: null })))
    ),
    all<{ estado: string; cantidad: number }>(`SELECT estado, COUNT(*) as cantidad FROM socios GROUP BY estado`),
    all<any>(
      `SELECT * FROM reportes_generados WHERE tipo LIKE 'libro_actas_%' OR tipo = 'registro_socios' ORDER BY creado_en DESC LIMIT 10`
    ),
  ]);

  const porOrgano: Record<string, { cantidad: number; ultimo_folio: number | null; ultima_fecha: string | null }> = {};
  for (const r of resumenActas) porOrgano[r.organo] = r;
  const totalSocios = resumenSocios.reduce((acc, r) => acc + Number(r.cantidad), 0);
  const activos = resumenSocios.find((r) => r.estado === "activo")?.cantidad ?? 0;

  const LIBROS = [
    {
      id: "asamblea",
      icon: "📗",
      nombre: "Libro de Actas — Asamblea",
      resumen: porOrgano.asamblea
        ? `${porOrgano.asamblea.cantidad} acta(s)${porOrgano.asamblea.ultimo_folio ? ` · último folio N°${porOrgano.asamblea.ultimo_folio}` : ""} (${dayjs(porOrgano.asamblea.ultima_fecha).format("DD/MM/YYYY")})`
        : "Todavía no hay actas de Asamblea registradas.",
      action: generarLibroActasFormAction,
      hidden: { organo: "asamblea" },
    },
    {
      id: "consejo_directivo",
      icon: "📘",
      nombre: "Libro de Actas — Consejo Directivo",
      resumen: porOrgano.consejo_directivo
        ? `${porOrgano.consejo_directivo.cantidad} acta(s)${porOrgano.consejo_directivo.ultimo_folio ? ` · último folio N°${porOrgano.consejo_directivo.ultimo_folio}` : ""} (${dayjs(porOrgano.consejo_directivo.ultima_fecha).format("DD/MM/YYYY")})`
        : "Todavía no hay actas de Consejo Directivo registradas.",
      action: generarLibroActasFormAction,
      hidden: { organo: "consejo_directivo" },
    },
  ];

  const LIBRO_LABEL: Record<string, string> = {
    libro_actas_asamblea: "📗 Libro de Actas — Asamblea",
    libro_actas_consejo_directivo: "📘 Libro de Actas — Consejo Directivo",
    registro_socios: "📕 Registro de Socios",
  };

  return (
    <div>
      <PageHeader title="Libros Sociales" subtitle="Compilación formal y numerada de las actas y el registro de socios" />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          ⚖️ Estos libros digitales compilan automáticamente lo que ya se carga en Reuniones, Decisiones y Socios. No
          reemplazan al libro rubricado que exige la normativa vigente, salvo que la cooperativa cuente con la
          habilitación correspondiente para llevarlo en formato digital.
        </p>
      </Card>

      {puedeGenerar && (
        <>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Generar libro actualizado</h3>
          <div className="grid grid-cols-1 gap-3 mb-8">
            {LIBROS.map((l) => (
              <Card key={l.id} className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{l.icon}</span>
                  <div>
                    <p className="text-sm font-semibold">{l.nombre}</p>
                    <p className="text-xs text-ink/60">{l.resumen}</p>
                  </div>
                </div>
                <ActionForm action={l.action} className="ml-4 flex-shrink-0">
                  {Object.entries(l.hidden).map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v} />
                  ))}
                  <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold whitespace-nowrap hover:bg-[var(--color-brand-100)]/70">
                    📄 Generar PDF
                  </button>
                </ActionForm>
              </Card>
            ))}
            <Card className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">📕</span>
                <div>
                  <p className="text-sm font-semibold">Registro de Socios</p>
                  <p className="text-xs text-ink/60">{totalSocios} socio(s) registrados · {activos} activo(s)</p>
                </div>
              </div>
              <ActionForm action={generarRegistroSociosFormAction} className="ml-4 flex-shrink-0">
                <button className="rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] px-3 py-2 text-xs font-semibold whitespace-nowrap hover:bg-[var(--color-brand-100)]/70">
                  📄 Generar PDF
                </button>
              </ActionForm>
            </Card>
          </div>
        </>
      )}

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Libros generados</h3>
      <div className="space-y-2">
        {generados.length === 0 && (
          <EmptyState>
            {puedeGenerar ? "Todavía no se generó ningún libro." : "Todavía no hay ningún libro generado por el Consejo Directivo."}
          </EmptyState>
        )}
        {generados.map((r) => (
          <Card key={r.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{LIBRO_LABEL[r.tipo] || r.nombre_reporte}</p>
              <p className="text-xs text-ink/50">{dayjs(r.creado_en).format("DD/MM/YYYY HH:mm")}</p>
            </div>
            {r.archivo_url ? (
              <a
                href={`/api/archivos/libro/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-2 text-xs font-semibold"
              >
                Descargar
              </a>
            ) : (
              <span className="rounded-lg bg-ink/5 text-ink/30 px-3 py-2 text-xs font-semibold">No disponible</span>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
