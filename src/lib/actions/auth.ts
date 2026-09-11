"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { rootGet, get, insert } from "@/lib/db";
import { verifyPassword, createSessionCookie, clearSessionCookie } from "@/lib/auth";
import { setOrgContext } from "@/lib/tenant";

const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "coova";

// Endurecimiento de seguridad (ver migrations/0013_login_intentos.sql): sin
// esto, nada frenaba a alguien que probara contraseñas sin parar contra un
// email real (fuerza bruta). Después de MAX_INTENTOS fallos seguidos para el
// mismo email + cooperativa dentro de la ventana de abajo, se frena el login
// aunque la contraseña que mande después sea la correcta.
const MAX_INTENTOS = 5;
const VENTANA_MINUTOS = 15;

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  // Límite de longitud: no cambia el resultado para un login normal, pero
  // evita que alguien mande strings gigantes a bcrypt.compare (que igual los
  // trunca en 72 bytes, pero sin esto el string completo viaja y se compara
  // en JS antes de llegar ahí).
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") || "").slice(0, 200);
  if (!email || !password) {
    return { error: "Completá el email y la contraseña." };
  }

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

  // .catch: si migrations/0013_login_intentos.sql todavía no corrió en esta
  // cooperativa, la tabla no existe — dejamos entrar sin límite de intentos
  // en vez de que ESTO tire abajo el login de todo el mundo (sería mucho
  // peor que no tener el límite: nadie podría entrar). En cuanto se corra la
  // migración, la protección arranca sola, sin otro deploy.
  const intentosRecientes = await get<{ cantidad: string }>(
    `SELECT count(*)::text as cantidad FROM login_intentos
     WHERE organization_id = ? AND email = ? AND exitoso = 0
       AND creado_en > NOW() - (?::text || ' minutes')::interval`,
    [org.id, email, VENTANA_MINUTOS]
  ).catch(() => undefined);
  if (Number(intentosRecientes?.cantidad || 0) >= MAX_INTENTOS) {
    return { error: `Demasiados intentos fallidos. Esperá ${VENTANA_MINUTOS} minutos e intentá de nuevo.` };
  }

  const user = await get<any>(
    `SELECT * FROM users WHERE email = ? AND organization_id = ? AND activo = 1`,
    [email, org.id]
  );
  const ok = user ? await verifyPassword(password, user.password_hash) : false;

  // Mismo mensaje genérico exista o no el usuario, y se registre el intento
  // en los dos casos: si dijéramos "no encontramos ese usuario" solo cuando
  // el email no existe, cualquiera podría usar el login para averiguar qué
  // emails están registrados en el sistema (enumeración de usuarios).
  // El registro del intento es secundario: si falla (misma razón que arriba,
  // tabla inexistente), no puede impedir que alguien con la contraseña
  // correcta entre — por eso va en su propio try/catch, nunca en el camino
  // que decide si el login sigue.
  try {
    await insert("login_intentos", { organization_id: org.id, email, exitoso: ok ? 1 : 0 });
  } catch (err) {
    console.error("[login] No se pudo registrar el intento de login:", err);
  }
  if (!user || !ok) return { error: "Email o contraseña incorrectos." };

  await createSessionCookie({
    id: user.id,
    rol: user.rol,
    organization_id: org.id,
  });
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
