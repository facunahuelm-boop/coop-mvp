import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PortalSocio } from "@/components/portal/PortalSocio";

/** Fase 1D — "Mi vivienda": portal del socio (también es su Inicio). */
export default async function MiViviendaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <PortalSocio user={user} />;
}
