import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Contexto de cooperativa activa (multi-tenant).
//
// Cada pedido a la aplicación (una Server Action, la carga de una página, una
// API route) atiende a UNA cooperativa a la vez. auth.ts::getCurrentUser fija
// la cooperativa acá apenas decodifica la sesión, para que el resto del
// pedido no tenga que volver a pasarla a mano por cada función y consulta SQL.
//
// Esto se guarda de dos formas, no de una sola:
//
//  1. AsyncLocalStorage (rápido, sin I/O): funciona para la enorme mayoría
//     de los casos, incluida la propia consulta que hace getCurrentUser().
//  2. Respaldo por cookie de sesión: en pruebas se detectó que, entre
//     distintas funciones llamadas dentro de una misma página (por ejemplo,
//     getCurrentUser() y luego recalcularAlertas() en dashboard/page.tsx),
//     el contexto de AsyncLocalStorage no siempre llega a propagarse de
//     forma confiable con Next.js/Turbopack en este proyecto. Como
//     cookies() de Next.js sí es confiable en cualquier punto del pedido
//     (es la misma API que ya usa getCurrentUser() con éxito), db.ts usa
//     esa cookie como red de seguridad cuando el contexto no está fijado:
//     vuelve a decodificar la sesión y recién ahí, si tampoco hay sesión,
//     falla de forma clara.
//
// src/lib/db.ts usa el resultado para fijar la variable de sesión de
// Postgres que activa las políticas de Row-Level Security de cada tabla —
// esa es la garantía real de que nunca se mezclan datos entre cooperativas,
// incluso si una consulta puntual se olvidara de filtrar por cooperativa.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __coopOrgContext: AsyncLocalStorage<number> | undefined;
}

// Igual que "global.__coopPool" en db.ts: en desarrollo, Next.js/Turbopack
// puede volver a ejecutar este módulo (hot reload) mientras otros módulos ya
// cargados (como db.ts) siguen referenciando la instancia anterior. Cachearlo
// en globalThis asegura que todo el código comparta siempre la misma
// instancia de AsyncLocalStorage.
const store: AsyncLocalStorage<number> = global.__coopOrgContext ?? new AsyncLocalStorage<number>();
if (process.env.NODE_ENV !== "production") global.__coopOrgContext = store;

const COOKIE_NAME = "coop_session";
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-cambiar-en-produccion-0000000000"
);

/** Fija la cooperativa activa para el resto de la ejecución asíncrona actual. */
export function setOrgContext(organizationId: number) {
  store.enterWith(organizationId);
}

/** Devuelve el id de la cooperativa activa ya fijado, o null si no hay ninguno. */
export function getOrgContext(): number | null {
  return store.getStore() ?? null;
}

// Respaldo: vuelve a leer y decodificar la cookie de sesión directamente,
// sin pasar por AsyncLocalStorage. Es la misma lógica que auth.ts::getCurrentUser
// usa para obtener la cooperativa del token — se duplica acá (en vez de
// importar auth.ts) para evitar una dependencia circular entre los dos
// módulos.
async function resolverOrgIdDesdeCookie(): Promise<number | null> {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, SECRET);
    const orgId = payload.org as number | undefined;
    return orgId ?? null;
  } catch {
    return null;
  }
}

/**
 * Devuelve el id de la cooperativa activa. Usar en cualquier punto que vaya
 * a leer o escribir datos de una cooperativa: es preferible que el sistema
 * falle de forma ruidosa y clara a que corra una consulta sin saber a qué
 * cooperativa pertenece.
 */
export async function requireOrgContext(): Promise<number> {
  const fromContext = getOrgContext();
  if (fromContext != null) return fromContext;

  const fromCookie = await resolverOrgIdDesdeCookie();
  if (fromCookie != null) {
    setOrgContext(fromCookie); // cachea para el resto de este pedido
    return fromCookie;
  }

  throw new Error(
    "Se intentó acceder a datos de una cooperativa sin tener una sesión activa. " +
      "Esto es un error de programación: verificar que se llamó a getCurrentUser()/requireUser() " +
      "(o setOrgContext() en un flujo de plataforma) antes de consultar datos."
  );
}
