import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { saludCooperativa, colorGeneral, veSalud, type Color } from "@/lib/saludCooperativa";

const FONDO: Record<Color, string> = {
  verde: "border-l-[var(--color-verde)]",
  amarillo: "border-l-[var(--color-amarillo)]",
  rojo: "border-l-[var(--color-rojo)]",
  gris: "border-l-border",
};
const PUNTO: Record<Color, string> = { verde: "bg-[var(--color-verde)]", amarillo: "bg-[var(--color-amarillo)]", rojo: "bg-[var(--color-rojo)]", gris: "bg-ink-faint" };
const TEXTO: Record<Color, string> = { verde: "Bien", amarillo: "Atención", rojo: "Hay que actuar", gris: "Sin datos" };

/** Fase 3I — semáforo de salud de la cooperativa. */
export default async function SaludPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!veSalud(user)) redirect("/dashboard");
  const ind = await saludCooperativa(user.etapa);
  const general = colorGeneral(ind);

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Salud de la cooperativa" subtitle="Unos pocos indicadores para ver de un vistazo cómo estamos" />
      <Card className={`border-l-4 ${FONDO[general]}`}>
        <p className="text-lg font-bold text-ink">
          <span className={`mr-2 inline-block h-3 w-3 rounded-full ${PUNTO[general]}`} aria-hidden />
          {general === "verde" ? "En general, la cooperativa está bien." : general === "amarillo" ? "Hay cosas para atender." : "Hay varios temas que necesitan atención ya."}
        </p>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ind.map((i) => (
          <Link key={i.clave} href={i.href} className={`block rounded-2xl border border-border border-l-4 ${FONDO[i.color]} bg-surface p-4 hover:bg-surface-sunken`} data-testid={`salud-${i.clave}`}>
            <p className="flex items-center justify-between text-sm text-ink-muted">
              {i.titulo}
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${PUNTO[i.color]}`} aria-hidden /> {TEXTO[i.color]}
              </span>
            </p>
            <p className="text-2xl font-bold text-ink">{i.valor}</p>
            {i.detalle && <p className="text-sm text-ink-muted">{i.detalle}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
