import { cookies } from "next/headers";
import { rootGet } from "@/lib/db";
import { RecuperarPasswordForm } from "./RecuperarPasswordForm";

/**
 * Sub-fase 4.3 (recuperación de contraseña por email). Mismo patrón que
 * src/app/login/page.tsx: pantalla pública, sin sesión todavía, resuelve la
 * cooperativa por la cookie `coop_slug` (la deja src/proxy.ts según el
 * subdominio) solo para mostrar el nombre/logo/color correctos — la
 * resolución real de a qué cooperativa pertenece el pedido la vuelve a hacer
 * la propia Server Action (solicitarRecuperacionAction), no esta página.
 */
const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "coova";

export default async function RecuperarPasswordPage() {
  const store = await cookies();
  const slug = store.get("coop_slug")?.value || DEFAULT_SLUG;

  const organizacion = await rootGet<{ nombre: string; logo_url: string | null; color_primario: string }>(
    `SELECT nombre, logo_url, color_primario FROM organizations WHERE slug = ?`,
    [slug]
  );

  return (
    <RecuperarPasswordForm
      nombre={organizacion?.nombre || "COOVA"}
      colorPrimario={organizacion?.color_primario || "#16a34a"}
    />
  );
}
