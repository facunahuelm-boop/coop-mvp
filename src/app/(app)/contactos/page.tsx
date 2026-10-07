import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all } from "@/lib/db";
import { obtenerContactos, TIPO_EXTERNO_LABEL } from "@/lib/contactos";
import { Card, PageHeader, SectionTitle, EmptyState } from "@/components/ui";
import { ContactosLista } from "@/components/ContactosLista";
import { ContactoExternoForm, BajaContactoExternoForm } from "@/components/directorio/DirectorioFormularios";
import { puedeEditarDirectorio } from "@/lib/actions/directorio";
import { linkWhatsApp } from "@/lib/avisos";

/**
 * Directorio (antes «Contactos», Fase 5 del Plan Maestro, REQUIREMENTS.md
 * 5.5; Fase 2F suma IAT, organismos y profesionales). Ver lib/contactos.ts
 * para qué fuentes se incluyen y con qué permiso (cada fuente se filtra
 * sola por su permiso; acá sólo hace falta estar autenticado).
 */
type Externo = { id: number; nombre: string; tipo: string; persona_contacto: string | null; telefono: string | null; email: string | null; notas: string | null };

export default async function ContactosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [contactos, externos, edita] = await Promise.all([
    obtenerContactos(user.rol),
    all<Externo>(`SELECT id, nombre, tipo, persona_contacto, telefono, email, notas FROM contactos_externos WHERE activo = 1 ORDER BY tipo, nombre`).catch(() => [] as Externo[]),
    puedeEditarDirectorio(user.rol),
  ]);
  const incluyeProveedores = canRead(user.rol, "compras");

  return (
    <div>
      <PageHeader
        title="Directorio"
        subtitle={
          incluyeProveedores
            ? "Socios, integrantes de su núcleo, proveedores, organismos y profesionales en un solo lugar"
            : "Socios, integrantes de su núcleo, organismos y profesionales"
        }
      />
      <ContactosLista contactos={contactos} />

      <div id="externos" className="mt-8">
        <SectionTitle action={edita ? <ContactoExternoForm /> : undefined}>Organismos, IAT y profesionales</SectionTitle>
        <Card>
          {externos.length === 0 ? (
            <EmptyState>{edita ? "Agregá el IAT, la Intendencia, el MVOT, el escribano o el contador, para tener sus datos a mano." : "Todavía no hay contactos cargados."}</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {externos.map((c) => {
                const wa = linkWhatsApp(c.telefono, "");
                return (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-[15px]">
                    <div className="min-w-0">
                      <b className="text-ink">{c.nombre}</b> <span className="text-sm text-ink-muted">· {TIPO_EXTERNO_LABEL[c.tipo] ?? c.tipo}</span>
                      <span className="block text-sm text-ink-muted">
                        {[c.persona_contacto, c.telefono, c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                      </span>
                      {c.notas && <span className="block text-sm text-ink-muted">{c.notas}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {c.telefono && (
                        <a href={`tel:${c.telefono.replace(/\s/g, "")}`} className="text-sm font-semibold underline">
                          Llamar
                        </a>
                      )}
                      {wa && (
                        <a href={wa.replace(/\?text=$/, "")} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline">
                          WhatsApp
                        </a>
                      )}
                      {edita && <ContactoExternoForm contacto={c} />}
                      {edita && <BajaContactoExternoForm id={c.id} nombre={c.nombre} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
