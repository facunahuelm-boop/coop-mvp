import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { DiarioObraForm } from "@/components/obra/ObraRecursos";
import { hoyEnUruguay, textoDia } from "@/lib/horasObra";
import { puedeEscribirDiario, CLIMAS } from "@/lib/obraRecursos";
import { anularDiarioFormAction } from "@/lib/actions/obraRecursos";

type Entrada = { id: number; fecha: string; clima: string | null; personas: number | null; trabajos: string; novedades: string | null; autor: string | null };

/** Fase 3C — diario de obra con fotos: qué se hizo cada día. */
export default async function DiarioObraPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "obra")) redirect("/dashboard");
  const puede = await puedeEscribirDiario(user);
  const hoy = hoyEnUruguay();
  const sp = await searchParams;
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : hoy.slice(0, 7);
  const [entradas, fotos, personasHoy] = await Promise.all([
    all<Entrada>(
      `SELECT d.id, d.fecha, d.clima, d.personas, d.trabajos, d.novedades, u.nombre AS autor
         FROM diario_obra d LEFT JOIN users u ON u.id = d.autor_id
        WHERE d.anulado_en IS NULL AND left(d.fecha, 7) = ? ORDER BY d.fecha DESC, d.id DESC`,
      [mes]
    ).catch(() => [] as Entrada[]),
    all<{ id: number; entrada_id: number }>(
      `SELECT f.id, f.entrada_id FROM diario_obra_fotos f JOIN diario_obra d ON d.id = f.entrada_id WHERE d.anulado_en IS NULL AND left(d.fecha, 7) = ? ORDER BY f.id`,
      [mes]
    ).catch(() => []),
    all<{ n: string }>(`SELECT COUNT(DISTINCT user_id) AS n FROM fichadas_obra WHERE fecha = ? AND tipo = 'llegada'`, [hoy]).catch(() => []),
  ]);
  const fotosDe = (id: number) => fotos.filter((f) => f.entrada_id === id);
  const nHoy = personasHoy[0] ? Number(personasHoy[0].n) : 0;
  const [y, m] = mes.split("-").map(Number);
  const mesAnterior = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const mesSiguiente = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Diario de obra"
        subtitle="Qué se hizo cada día, con fotos"
        action={<Link href="/obra" className="text-sm font-semibold underline underline-offset-2">Volver a Obra</Link>}
      />
      {puede && (
        <Card className="mb-6">
          <DiarioObraForm hoy={hoy} climas={CLIMAS} personasHoy={nHoy > 0 ? nHoy : null} />
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionTitle>{`${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} ${y}`}</SectionTitle>
        <div className="flex gap-3 text-sm font-semibold">
          <Link href={`/obra/diario?mes=${mesAnterior}`} className="underline underline-offset-2">← Mes anterior</Link>
          {mes < hoy.slice(0, 7) && <Link href={`/obra/diario?mes=${mesSiguiente}`} className="underline underline-offset-2">Mes siguiente →</Link>}
        </div>
      </div>
      <div className="space-y-3">
        {entradas.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-[17px] font-semibold text-ink first-letter:uppercase">
                {textoDia(e.fecha)}
                <span className="font-normal text-ink-muted">
                  {[e.clima, e.personas != null ? `${e.personas} personas` : null].filter(Boolean).map((x) => ` · ${x}`)}
                </span>
              </p>
              {puede && (
                <FormularioEnModal
                  textoBoton="Anular"
                  titulo="Anular la entrada del diario"
                  descripcion="Deja de verse en el diario, pero queda en el historial."
                  action={anularDiarioFormAction}
                  ocultos={{ id: e.id }}
                  textoConfirmar="Anular"
                  peligro
                  mensajeExito="Entrada anulada."
                  claseBoton="text-sm font-semibold text-ink-muted underline underline-offset-2"
                >
                  <label className="block">
                    <Label required>Motivo</Label>
                    <input name="motivo" required maxLength={300} className={inputClass} />
                  </label>
                </FormularioEnModal>
              )}
            </div>
            <p className="mt-1 whitespace-pre-line text-[15px] text-ink">{e.trabajos}</p>
            {e.novedades && <p className="mt-2 whitespace-pre-line text-[15px] text-ink"><span className="font-semibold">Novedades:</span> {e.novedades}</p>}
            {fotosDe(e.id).length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {fotosDe(e.id).map((f) => (
                  <a key={f.id} href={`/api/archivos/diario-obra/${f.id}`} target="_blank" rel="noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element -- foto servida por una ruta con permiso */}
                    <img src={`/api/archivos/diario-obra/${f.id}`} alt={`Foto del ${textoDia(e.fecha)}`} className="h-32 w-full rounded-lg object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            )}
            {e.autor && <p className="mt-2 text-sm text-ink-muted">Escribió {e.autor}</p>}
          </Card>
        ))}
        {entradas.length === 0 && <EmptyState>No hay nada anotado este mes.</EmptyState>}
      </div>
    </div>
  );
}
