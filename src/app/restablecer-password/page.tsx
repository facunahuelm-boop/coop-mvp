import { cookies } from "next/headers";
import { rootGet } from "@/lib/db";
import { RestablecerPasswordForm } from "./RestablecerPasswordForm";

/**
 * Sub-fase 4.3 (recuperación de contraseña por email). Página pública a la
 * que llega el enlace del email (`/restablecer-password?token=...`) — el
 * token viaja en la URL, no se valida acá (eso lo hace la propia Server
 * Action, restablecerPasswordAction, contra la base) para no tener que
 * duplicar esa lógica en dos lugares.
 */
const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "coova";

export default async function RestablecerPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const store = await cookies();
  const slug = store.get("coop_slug")?.value || DEFAULT_SLUG;

  const organizacion = await rootGet<{ nombre: string; color_primario: string }>(
    `SELECT nombre, color_primario FROM organizations WHERE slug = ?`,
    [slug]
  );

  return (
    <RestablecerPasswordForm
      nombre={organizacion?.nombre || "COOVA"}
      colorPrimario={organizacion?.color_primario || "#16a34a"}
      token={token || ""}
    />
  );
}
