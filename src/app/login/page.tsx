import { cookies } from "next/headers";
import { rootGet } from "@/lib/db";
import { LoginForm } from "./LoginForm";

// Antes de iniciar sesión todavía no hay usuario ni cooperativa activa en el
// contexto multi-tenant (ver src/lib/tenant.ts) — la única pista de a qué
// cooperativa pertenece esta pantalla de login es la cookie `coop_slug` que
// deja src/proxy.ts según el subdominio del pedido. Se resuelve acá, a nivel
// de plataforma (rootGet, sin Row-Level Security), para mostrar el nombre,
// logo y color de la cooperativa correcta antes de que el usuario ingrese.
const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "coova";

export default async function LoginPage() {
  const store = await cookies();
  const slug = store.get("coop_slug")?.value || DEFAULT_SLUG;

  const organizacion = await rootGet<{ nombre: string; logo_url: string | null; color_primario: string }>(
    `SELECT nombre, logo_url, color_primario FROM organizations WHERE slug = ?`,
    [slug]
  );

  return (
    <LoginForm
      nombre={organizacion?.nombre || "COOVA"}
      logoUrl={organizacion?.logo_url || "/logo-coova.png"}
      colorPrimario={organizacion?.color_primario || "#123240"}
    />
  );
}
