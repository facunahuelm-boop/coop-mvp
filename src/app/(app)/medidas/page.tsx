import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { decidirMedidaFormAction } from "@/lib/actions/seguimiento";

type Medida = { id: number; titulo: string; detalle: string | null; medida: string; estado: string; creado_en: string; decidido_en: string | null; motivo: string | null; decidio: string | null };
const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

/** Fase 3I — medidas que COOVA propone según el reglamento (A25) y que decide el Consejo. */
export default async function MedidasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["consejo_directivo", "admin", "fiscal"].includes(user.rol)) redirect("/dashboard");
  const decide = ["consejo_directivo", "admin"].includes(user.rol);
  const medidas = await all<Medida>(
    `SELECT m.id, m.titulo, m.detalle, m.medida, m.estado, m.creado_en, m.decidido_en, m.motivo, u.nombre AS decidio
       FROM medidas_propuestas m LEFT JOIN users u ON u.id = m.decidido_por_id ORDER BY (m.estado = 'propuesta') DESC, m.id DESC LIMIT 60`
  ).catch(() => [] as Medida[]);
  const propuestas = medidas.filter((m) => m.estado === "propuesta");

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Medidas propuestas" subtitle="Lo que el reglamento indica y COOVA propone. Nunca se aplica solo: lo decide el Consejo." />
      <SectionTitle>{`Para decidir (${propuestas.length})`}</SectionTitle>
      {propuestas.length === 0 && (
        <Card>
          <EmptyState>No hay medidas para decidir.</EmptyState>
        </Card>
      )}
      {propuestas.map((m) => (
        <Card key={m.id}>
          <p className="text-lg font-bold text-ink">{m.titulo}</p>
          {m.detalle && <p className="text-sm text-ink-muted">{m.detalle}</p>}
          <p className="mt-2 text-[15px]">
            Medida propuesta: <strong>{m.medida}</strong>
          </p>
          <p className="text-sm text-ink-muted">Propuesta el {dmy(m.creado_en)}</p>
          {decide && (
            <div className="mt-3 flex gap-4">
              <FormularioEnModal textoBoton="Aprobar" claseBoton={botonLink} titulo="Aprobar la medida" descripcion="Se le avisa al núcleo." action={decidirMedidaFormAction} ocultos={{ id: m.id, decision: "aprobada" }} textoConfirmar="Aprobar">
                <label className="block">
                  <Label>Comentario</Label>
                  <input name="motivo" maxLength={500} className={inputClass} />
                </label>
              </FormularioEnModal>
              <FormularioEnModal textoBoton="Descartar" claseBoton="text-sm font-semibold text-ink-muted underline underline-offset-2" titulo="Descartar la medida" action={decidirMedidaFormAction} ocultos={{ id: m.id, decision: "descartada" }} textoConfirmar="Descartar" peligro>
                <label className="block">
                  <Label required>¿Por qué?</Label>
                  <input name="motivo" required maxLength={500} className={inputClass} />
                </label>
              </FormularioEnModal>
            </div>
          )}
        </Card>
      ))}
      {medidas.length > propuestas.length && (
        <>
          <SectionTitle>Ya decididas</SectionTitle>
          <Card>
            <ul className="divide-y divide-border">
              {medidas
                .filter((m) => m.estado !== "propuesta")
                .map((m) => (
                  <li key={m.id} className="py-2 text-[15px]">
                    <Badge color={m.estado === "aprobada" ? "verde" : "gray"}>{m.estado === "aprobada" ? "Aprobada" : "Descartada"}</Badge> {m.titulo}
                    <span className="block text-sm text-ink-muted">
                      {m.medida} · {m.decidio ?? ""} el {dmy(m.decidido_en)}
                      {m.motivo ? ` · ${m.motivo}` : ""}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
