import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Resolución de cooperativa por subdominio (multi-tenant).
//
// Cada cooperativa entra por su propio subdominio: micoop.plataforma.uy.
// Este middleware lee el subdominio del pedido y lo deja disponible como
// cookie `coop_slug` para que loginAction (que todavía no tiene una sesión
// con la que buscar la cooperativa) sepa a qué cooperativa pertenece el
// usuario que está iniciando sesión.
//
// Mientras el dominio propio con subdominios no esté configurado en el
// hosting (o en desarrollo local), se usa NEXT_PUBLIC_DEFAULT_ORG_SLUG (o
// "coova" si no está definida) como cooperativa por defecto. Cada instalación
// nueva debería fijar esa variable con el slug de su propia cooperativa de
// referencia — "coova" es solo un valor de arranque, no una cooperativa real.
// ---------------------------------------------------------------------------

const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "coova";

// Dominios raíz conocidos donde NO hay subdominio de cooperativa (localhost,
// el dominio de Vercel, IPs). Todo lo demás se interpreta como
// "<slug>.dominio-de-la-plataforma".
const HOSTS_SIN_SUBDOMINIO = ["localhost", "127.0.0.1"];

function resolverSlug(host: string): string {
  const hostname = host.split(":")[0];
  if (HOSTS_SIN_SUBDOMINIO.includes(hostname)) return DEFAULT_SLUG;
  if (hostname.endsWith(".vercel.app")) return DEFAULT_SLUG; // preview deploys
  const partes = hostname.split(".");
  // "micoop.plataforma.uy" -> ["micoop", "plataforma", "uy"] -> "micoop"
  if (partes.length >= 3) return partes[0];
  return DEFAULT_SLUG;
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const slugActual = request.cookies.get("coop_slug")?.value;
  const slugResuelto = resolverSlug(host);

  // Fase 1E: la ruta pedida viaja a los layouts del servidor (que no la
  // conocen) — la usa (app)/layout.tsx para no bloquear la propia pantalla
  // de "Mi seguridad" cuando la cooperativa exige la verificación en dos pasos.
  const cabeceras = new Headers(request.headers);
  cabeceras.set("x-coova-path", request.nextUrl.pathname);

  if (slugActual === slugResuelto) {
    return NextResponse.next({ request: { headers: cabeceras } });
  }

  const response = NextResponse.next({ request: { headers: cabeceras } });
  response.cookies.set("coop_slug", slugResuelto, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });
  return response;
}

export const config = {
  // No corre sobre archivos estáticos ni la propia API de Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
