import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { darAccesoFormAction, revocarAccesoFormAction } from "@/lib/actions/accesoDelegado";
import { delegadosDeSocio, sociosQueAyudo } from "@/lib/accesoDelegado";

const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-5 py-3 text-[16px] font-semibold text-white min-h-[48px]";
const botonLink = "text-[15px] font-semibold text-ink-muted underline underline-offset-2";
const dmy = (f: string) => f.slice(0, 10).split("-").reverse().join("/");

/** Fase 3G — el socio le da acceso a un familiar para que lo ayude; y la persona ve a quiénes ayuda. */
export default async function AccesoFamiliarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const socio = await get<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE user_id = ? ORDER BY (estado = 'activo') DESC, id LIMIT 1`, [user.id]).catch(() => undefined);
  const [delegados, ayudo] = await Promise.all([socio ? delegadosDeSocio(socio.id) : Promise.resolve([]), sociosQueAyudo(user.id)]);

  return (
    <div className="max-w-3xl space-y-5 text-[16px]">
      <PageHeader title="Acceso para un familiar" subtitle="Alguien de confianza puede ayudarte a ver tus cuotas, tus horas y los avisos" />

      {ayudo.length > 0 && (
        <section>
          <SectionTitle>Personas que ayudás</SectionTitle>
          <Card>
            <ul className="divide-y divide-border">
              {ayudo.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-semibold">{a.socio_nombre}</span>
                    <span className="block text-sm text-ink-muted">{a.puede_actuar ? "Podés ver y avisar ausencias en su nombre" : "Podés ver su información"}</span>
                  </span>
                  <Link href={`/ayudo/${a.socio_id}`} className={botonPrincipal}>
                    Ayudar a {a.socio_nombre.split(" ")[0]}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {socio ? (
        <section>
          <SectionTitle>Quiénes pueden ayudarte</SectionTitle>
          <Card>
            <p className="text-ink-muted mb-3">
              La persona entra con su propia cuenta (nunca con la tuya). Todo lo que mira o hace en tu nombre queda registrado. Le podés sacar el acceso cuando quieras.
            </p>
            <ul className="divide-y divide-border mb-4">
              {delegados.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-semibold">{d.delegado_nombre}</span>
                    {d.relacion && <span className="text-ink-muted"> ({d.relacion})</span>}
                    <span className="block text-sm text-ink-muted">
                      {d.delegado_email} · desde el {dmy(d.creado_en)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge color={d.puede_actuar ? "brand" : "gray"}>{d.puede_actuar ? "Ve y avisa" : "Sólo ve"}</Badge>
                    <FormularioEnModal
                      textoBoton="Sacar el acceso"
                      claseBoton={botonLink}
                      titulo={`Sacarle el acceso a ${d.delegado_nombre}`}
                      descripcion="Deja de poder ver tu información. Queda registrado."
                      action={revocarAccesoFormAction}
                      ocultos={{ id: d.id }}
                      textoConfirmar="Sacar el acceso"
                      peligro
                      mensajeExito="Acceso quitado."
                    />
                  </span>
                </li>
              ))}
              {delegados.length === 0 && <EmptyState>Nadie tiene acceso para ayudarte.</EmptyState>}
            </ul>
            <FormularioEnModal textoBoton="+ Darle acceso a un familiar" claseBoton={botonPrincipal} titulo="Darle acceso a un familiar" action={darAccesoFormAction} textoConfirmar="Dar acceso">
              <p className="text-ink-muted">Tu familiar tiene que tener su propia cuenta en COOVA. Si no tiene, pedile a la administración que le cree una.</p>
              <label className="block">
                <Label required>Email de su cuenta</Label>
                <input name="email" type="email" required maxLength={200} className={inputClass} />
              </label>
              <label className="block">
                <Label>¿Qué es tuyo?</Label>
                <input name="relacion" maxLength={60} className={inputClass} placeholder="Hija, sobrino, vecina…" />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="puede_actuar" value="1" className="mt-1 h-5 w-5" />
                <span>También puede avisar en mi nombre que no puedo ir a un turno de la obra</span>
              </label>
            </FormularioEnModal>
          </Card>
        </section>
      ) : (
        ayudo.length === 0 && (
          <Card>
            <EmptyState>Tu usuario no está vinculado a una ficha de socio, y todavía nadie te dio acceso para ayudarlo.</EmptyState>
          </Card>
        )
      )}
    </div>
  );
}
