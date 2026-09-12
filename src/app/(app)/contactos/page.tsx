import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { obtenerContactos } from "@/lib/contactos";
import { PageHeader } from "@/components/ui";
import { ContactosLista } from "@/components/ContactosLista";

/**
 * Fase 5 del Plan Maestro ("Sección Contactos"), REQUIREMENTS.md sección 5.5.
 * Ver el comentario en lib/contactos.ts para el detalle de qué fuentes se
 * incluyen, cuáles no y por qué.
 *
 * Sin gate de "mod" único a nivel de página (como /gastos): cada fuente que
 * agrega obtenerContactos() ya se filtra sola por su propio permiso
 * (socios / compras), así que acá solo hace falta estar autenticado. Si un
 * rol no puede ver ninguna de las dos fuentes hoy no existe ese caso: todos
 * los roles tienen al menos "read" en "socios" (ver MATRIX en roles.ts).
 */
export default async function ContactosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const contactos = await obtenerContactos(user.rol);
  const incluyeProveedores = canRead(user.rol, "compras");

  return (
    <div>
      <PageHeader
        title="Contactos"
        subtitle={
          incluyeProveedores
            ? "Socios, integrantes de su núcleo y proveedores en un solo lugar"
            : "Socios e integrantes de su núcleo"
        }
      />
      <ContactosLista contactos={contactos} />
    </div>
  );
}
