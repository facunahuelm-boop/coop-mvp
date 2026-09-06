import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { get } from "./db";
import { setOrgContext } from "./tenant";
import type { Role } from "./roles";

const COOKIE_NAME = "coop_session";
if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET) {
  // Detectado en la auditoría (sección 3, "Problemas encontrados"): el
  // fallback de desarrollo nunca debe usarse en producción — firmar sesiones
  // con un secreto público y compartido anularía el aislamiento entre
  // cooperativas por completo.
  throw new Error(
    "Falta la variable de entorno AUTH_SECRET en producción. No se puede arrancar sin ella."
  );
}
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-cambiar-en-produccion-0000000000"
);
const SESSION_DAYS = 14;

export type SessionUser = {
  id: number;
  nombre: string;
  email: string;
  rol: Role;
  nucleo_id: number | null;
  /** Cooperativa a la que pertenece este usuario (multi-tenant). */
  organization_id: number;
  /**
   * Etapa de la cooperativa (pre_obra | obra | habitada). Se usa para
   * personalizar la navegación (ver components/Nav.tsx): una cooperativa
   * ya habitada no necesita ver el grupo "Obra" del menú.
   */
  etapa: string;
  /**
   * Datos de personalización de marca de la cooperativa (Fase de
   * personalización): nombre, logo y colores que reemplazan los valores
   * fijos "COOVA" / "/logo-coova.png" en Nav.tsx y el login.
   */
  organizacion: {
    nombre: string;
    logo_url: string | null;
    color_primario: string;
    color_secundario: string | null;
  };
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

// Solo id/rol/organization_id viajan en el JWT (ver SignJWT abajo) — el resto
// de los datos de marca de la cooperativa (organizacion.*) se resuelven
// después, en cada pedido, vía getCurrentUser() con el JOIN a organizations.
// Por eso esta función no exige un SessionUser completo: loginAction todavía
// no tiene esos datos de marca a mano en el momento de crear la cookie.
export async function createSessionCookie(user: Pick<SessionUser, "id" | "rol" | "organization_id">) {
  const token = await new SignJWT({ uid: user.id, rol: user.rol, org: user.organization_id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(SECRET);

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const uid = payload.uid as number;
    const orgId = payload.org as number | undefined;
    if (!orgId) return null;

    // Fijamos la cooperativa activa ANTES de consultar la base de datos:
    // a partir de acá, toda consulta de esta misma ejecución (esta Server
    // Action, esta página) queda automáticamente aislada a esta cooperativa
    // (ver src/lib/db.ts y src/lib/tenant.ts).
    setOrgContext(orgId);

    // organizations no tiene organization_id (es la tabla raíz, sin RLS) —
    // se puede traer con un JOIN normal en la misma consulta.
    const row = await get<any>(
      `SELECT u.id, u.nombre, u.email, u.rol, u.nucleo_id, u.activo, u.organization_id, o.etapa,
              o.nombre as org_nombre, o.logo_url as org_logo_url,
              o.color_primario as org_color_primario, o.color_secundario as org_color_secundario
       FROM users u JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = ?`,
      [uid]
    );
    // Chequeo extra a nivel de aplicación (además de Row-Level Security):
    // si por lo que sea el usuario ya no pertenece a la cooperativa del
    // token, la sesión se trata como inválida en vez de confiar en el token.
    if (!row || !row.activo || row.organization_id !== orgId) return null;
    return {
      id: row.id,
      nombre: row.nombre,
      email: row.email,
      rol: row.rol,
      nucleo_id: row.nucleo_id,
      organization_id: row.organization_id,
      etapa: row.etapa,
      organizacion: {
        nombre: row.org_nombre,
        logo_url: row.org_logo_url,
        color_primario: row.org_color_primario,
        color_secundario: row.org_color_secundario,
      },
    };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error("UNAUTHENTICATED");
  return u;
}
