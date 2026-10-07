import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import { PlantillaForm, BajaPlantillaForm } from "@/components/plantillas/PlantillasFormularios";
import { puedeUsarPlantillas } from "@/lib/actions/plantillasTexto";
import { VARIABLES_PLANTILLA } from "@/lib/plantillasAlta";

/**
 * Fase 2H — plantillas de texto (plan, 8.13): constancias, notas y
 * convocatorias con variables que se completan solas y salen en PDF.
 */
const CATEGORIA_LABEL: Record<string, string> = { constancia: "Constancia", nota: "Nota", convocatoria: "Convocatoria", acta: "Acta", otro: "Otro" };

export default async function PlantillasPage({ searchParams }: { searchParams: Promise<{ socio?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await puedeUsarPlantillas(user.rol))) redirect("/dashboard");
  const socioElegido = Number((await searchParams).socio) || null;
  const [plantillas, socios] = await Promise.all([
    all<{ id: number; nombre: string; categoria: string; cuerpo: string }>(`SELECT id, nombre, categoria, cuerpo FROM plantillas_texto WHERE activo = 1 ORDER BY categoria, nombre`).catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado NOT IN ('baja', 'egresado', 'excluido') ORDER BY nombre`).catch(() => []),
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Plantillas de texto" subtitle="Constancias, notas y convocatorias que se completan solas y salen en PDF." action={<PlantillaForm variables={VARIABLES_PLANTILLA} />} />
      {plantillas.length === 0 ? (
        <Card>
          <EmptyState>No hay plantillas. Creá una, o cargá las de base desde «Alta de la cooperativa».</EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {plantillas.map((p) => (
            <Card key={p.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-ink">
                  {p.nombre} <Badge color="brand">{CATEGORIA_LABEL[p.categoria] ?? p.categoria}</Badge>
                </h2>
                <div className="flex items-center gap-3">
                  <PlantillaForm plantilla={p} variables={VARIABLES_PLANTILLA} />
                  <BajaPlantillaForm id={p.id} />
                </div>
              </div>
              <p className="mb-3 line-clamp-3 whitespace-pre-line text-sm text-ink-muted">{p.cuerpo}</p>
              <form method="get" action={`/api/reportes/plantilla/${p.id}`} target="_blank" className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
                <label className="block sm:col-span-2">
                  <Label>Socio</Label>
                  <select name="socio" defaultValue={socioElegido ?? ""} className={inputClass}>
                    <option value="">(ninguno)</option>
                    {socios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                {p.cuerpo.includes("{monto}") && (
                  <label className="block">
                    <Label>Monto</Label>
                    <input name="monto" inputMode="decimal" className={inputClass} />
                  </label>
                )}
                {p.cuerpo.includes("{lugar}") && (
                  <label className="block">
                    <Label>Lugar</Label>
                    <input name="lugar" maxLength={80} className={inputClass} />
                  </label>
                )}
                <button className="inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-4 py-2.5 text-sm font-semibold text-white">Generar PDF</button>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
