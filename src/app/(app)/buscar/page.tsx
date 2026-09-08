import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { buscarGlobal } from "@/lib/logic";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import dayjs from "dayjs";

const BADGE_POR_TIPO: Record<string, "brand" | "verde" | "amarillo" | "rojo" | "gray"> = {
  obra: "brand",
  compra: "verde",
  proveedor: "verde",
  documento: "amarillo",
  jornada: "amarillo",
  incidente: "rojo",
  comision: "brand",
  reunion: "brand",
  socio: "gray",
};

export default async function BuscarPage({
  searchParams,
}: {
  // Next.js 15+ (acá corremos 16): searchParams llega como Promise, no como
  // objeto plano — hay que hacer await antes de leer sus propiedades. Este
  // archivo era la referencia que se copió para /documentos (Fase 07), pero
  // el patrón en sí ya estaba mal acá: sin el await, searchParams.q daba
  // undefined en runtime (sin tirar error), así que la búsqueda global nunca
  // filtraba nada — quedaba pegada en el estado "sin resultados" pasara lo
  // que pasara en el input.
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { q: qParam } = await searchParams;
  const q = qParam?.trim() || "";
  // Fase 11 del Plan Maestro: la búsqueda ahora vive en buscarGlobal()
  // (lib/logic.ts) — se comparte con el atajo Ctrl+K (ver CommandPalette y
  // /api/buscar) para no mantener la misma lógica de fuentes y permisos en
  // dos lugares distintos.
  const resultados = q && q.length >= 2 ? await buscarGlobal(q, user.rol) : [];

  return (
    <div>
      <PageHeader
        title="Búsqueda global"
        subtitle="Obra, compras, proveedores, documentos, comisiones, reuniones y socios"
        action={
          <span className="hidden sm:inline text-xs text-ink/40">
            Atajo: <kbd className="border border-ink/10 rounded px-1.5 py-0.5">Ctrl</kbd> + <kbd className="border border-ink/10 rounded px-1.5 py-0.5">K</kbd>
          </span>
        }
      />

      <form method="get" className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            placeholder="Buscar tareas, compras, socios, documentos..."
            defaultValue={q}
            className="flex-1 rounded-xl border border-ink/10 px-4 py-2 text-sm"
            autoFocus
          />
          <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-6 py-2 text-sm font-semibold">
            Buscar
          </button>
        </div>
      </form>

      {q && q.length < 2 && (
        <EmptyState>Escribí al menos 2 caracteres para buscar.</EmptyState>
      )}

      {q && q.length >= 2 && resultados.length === 0 && (
        <EmptyState>No se encontraron resultados para "{q}".</EmptyState>
      )}

      {resultados.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-ink/50 mb-3">
            {resultados.length} resultado{resultados.length !== 1 ? "s" : ""}
          </p>
          {resultados.map((r, i) => (
            <a key={`${r.tipo}-${r.id}-${i}`} href={r.href || "#"}>
              <Card className="cursor-pointer hover:bg-ink/2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge color={BADGE_POR_TIPO[r.tipo] || "gray"}>{r.modulo}</Badge>
                      <p className="text-sm font-semibold">{r.titulo}</p>
                    </div>
                    {r.fecha && (
                      <p className="text-xs text-ink/40 mt-1">
                        {dayjs(r.fecha).format("DD/MM/YYYY")}
                      </p>
                    )}
                  </div>
                  {r.estado && (
                    <Badge color={r.estado === "completada" || r.estado === "resuelto" ? "verde" : "amarillo"}>
                      {r.estado}
                    </Badge>
                  )}
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
