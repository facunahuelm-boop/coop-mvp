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
  /**
   * URL pública de la foto de perfil (rediseño "Color secundario + Top
   * Bar"), o null si el usuario no cargó ninguna — en ese caso el front
   * muestra un ícono/inicial genérica (ver Nav.tsx / EntidadLink.tsx).
   * Se resuelve acá para que la Top Bar la tenga disponible en cada
   * página sin una consulta extra.
   */
  avatar_url: string | null;
  /** Cooperativa a la que pertenece este usuario (multi-tenant). */
  organization_id: number;
  /**
   * Etapa de la cooperativa (pre_obra | obra | habitada). Se usa para
   * personalizar la navegación (ver components/Nav.tsx): una cooperativa
   * ya habitada no necesita ver el grupo "Obra" del menú.
   */
  etapa: string;
  /**
   * Overrides manuales de visibilidad de módulos, por cooperativa (Fase D:
   * etapas + módulos). Sólo tiene sentido para los módulos cuyo default sale
   * de la etapa (hoy: obra, trabajo, seguridad) — "mostrar" u "ocultar"
   * fuerzan el módulo más allá de lo que diría la etapa sola; si un módulo
   * no aparece acá, manda el default automático (ver Nav.tsx).
   */
  modulos_override: Record<string, "mostrar" | "ocultar">;
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
    let row: any;
    try {
      row = await get<any>(
        `SELECT u.id, u.nombre, u.email, u.rol, u.nucleo_id, u.activo, u.organization_id, u.avatar_url,
                u.password_changed_en, o.etapa,
                o.modulos_override,
                o.nombre as org_nombre, o.logo_url as org_logo_url,
                o.color_primario as org_color_primario, o.color_secundario as org_color_secundario
         FROM users u JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = ?`,
        [uid]
      );
    } catch (err: any) {
      // INCIDENTE REAL (23/09, corregido en el mismo despliegue): el orden
      // "deploy código → aplicar migración" que usa todo este proyecto (ver
      // conFallbackColumnaFaltante en db.ts, mismo criterio) tiene un hueco
      // acá — entre el deploy de este código y la migración 0036, esta
      // consulta fallaba con "column does not exist" (42703), el catch
      // general de abajo lo trataba como sesión inválida, y ESO deslogueaba
      // a TODO el mundo, incluido el admin — que es justo quien tiene que
      // entrar a /api/admin/migraciones para correr la migración. Se
      // reintenta sin esa columna solo para este código de error puntual;
      // cualquier otro error sigue subiendo sin ocultarse.
      if (err?.code !== "42703") throw err;
      console.error(
        "[auth] password_changed_en todavía no existe (migración 0036 pendiente) — sesión validada sin ese chequeo."
      );
      row = await get<any>(
        `SELECT u.id, u.nombre, u.email, u.rol, u.nucleo_id, u.activo, u.organization_id, u.avatar_url,
                o.etapa, o.modulos_override,
                o.nombre as org_nombre, o.logo_url as org_logo_url,
                o.color_primario as org_color_primario, o.color_secundario as org_color_secundario
         FROM users u JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = ?`,
        [uid]
      );
    }
    // Chequeo extra a nivel de aplicación (además de Row-Level Security):
    // si por lo que sea el usuario ya no pertenece a la cooperativa del
    // token, la sesión se trata como inválida en vez de confiar en el token.
    if (!row || !row.activo || row.organization_id !== orgId) return null;

    // Sub-fase 4.2 (sesiones y auditoría de accesos): si la contraseña
    // cambió DESPUÉS de que se firmó este token (`iat`, en segundos —
    // ver jose), la sesión se trata como inválida, igual que con
    // `activo = 0` arriba. Sin esto, cambiar una contraseña (propia,
    // Sub-fase 4.1, o por un admin) no cerraba ninguna otra sesión ya
    // abierta con la contraseña vieja — el JWT (14 días de vigencia)
    // seguía sirviendo igual. `password_changed_en` es nullable
    // (migrations/0036): una cuenta que nunca cambió la contraseña desde
    // que existe esta columna no invalida nada acá.
    if (row.password_changed_en && typeof payload.iat === "number") {
      // HALLAZGO EN VERIFICACIÓN EN VIVO (23/09, corregido antes de cerrar
      // la sub-fase): comparar milisegundo a milisegundo rompía el propio
      // caso que cambiarPasswordAction está pensado para no romper — la
      // reemisión de la MISMA sesión. `iat` (jose/JWT) tiene precisión de
      // SEGUNDOS (trunca los milisegundos), pero `password_changed_en` se
      // guarda con milisegundos completos (`toISOString()`). Si el cambio de
      // contraseña y la reemisión de la cookie caen en el mismo segundo de
      // reloj (el caso normal — son dos pasos seguidos de la misma acción),
      // el `iat` truncado quedaba comparado contra un `password_changed_en`
      // con milisegundos de sobra dentro de ESE MISMO segundo, así que el
      // token recién emitido parecía anterior al cambio y la propia persona
      // quedaba deslogueada de su propia sesión actual — se detectó
      // probando esto mismo en producción. Truncar `password_changed_en` al
      // segundo (mismo grano que `iat`) resuelve el empate a favor de la
      // sesión recién emitida sin debilitar el chequeo para sesiones
      // genuinamente viejas (emitidas en un segundo anterior real).
      const cambiadaEnSegundos = Math.floor(new Date(row.password_changed_en).getTime() / 1000);
      if (payload.iat < cambiadaEnSegundos) return null;
    }
    return {
      id: row.id,
      nombre: row.nombre,
      email: row.email,
      rol: row.rol,
      nucleo_id: row.nucleo_id,
      avatar_url: row.avatar_url ?? null,
      organization_id: row.organization_id,
      etapa: row.etapa,
      modulos_override: row.modulos_override || {},
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
