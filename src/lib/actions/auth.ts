"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { rootGet, get } from "@/lib/db";
import { verifyPassword, createSessionCookie, clearSessionCookie } from "@/lib/auth";
import { setOrgContext } from "@/lib/tenant";

const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "ufama";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  // El middleware (src/middleware.ts) ya resolvió, por subdominio, a qué
  // cooperativa pertenece este pedido de login y lo dejó en esta cookie.
  const slug = (await cookies()).get("coop_slug")?.value || DEFAULT_SLUG;
  const org = await rootGet<{ id: number; activo: number; etapa: string }>(
    `SELECT id, activo, etapa FROM organizations WHERE slug = ?`,
    [slug]
  );
  if (!org || !org.activo) {
    return { error: "No encontramos esa cooperativa. Verificá el enlace de acceso." };
  }
  setOrgContext(org.id);

  const user = await get<any>(
    `SELECT * FROM users WHERE email = ? AND organization_id = ? AND activo = 1`,
    [email, org.id]
  );
  if (!user) return { error: "No encontramos ese usuario." };

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return { error: "Contraseña incorrecta." };

  await createSessionCookie({
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    nucleo_id: user.nucleo_id,
    organization_id: org.id,
    etapa: org.etapa,
  });
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
