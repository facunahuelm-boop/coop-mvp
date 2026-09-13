import Link from "next/link";

/**
 * Fase 7 del Plan Maestro ("Navegación transversal"), hallazgo H-9: hasta
 * ahora cada pantalla que mostraba el nombre de una persona o de un núcleo
 * familiar lo hacía como texto plano, sin poder hacer clic para ver su
 * ficha — la Fase 6 ya había resuelto esto puntualmente en /comisiones y
 * /auditoria escribiendo el `<Link>` a mano en cada lugar; estos dos
 * componentes centralizan ese mismo patrón (mismo estilo, mismo criterio de
 * "si no hay id, mostrar solo el texto") para el resto de las pantallas
 * (reuniones, obra, gastos, reclamos, seguridad, dashboard, trabajo,
 * socios), en vez de repetir el `<Link className="hover:underline...">` a
 * mano una decena de veces más.
 */

export function UsuarioLink({
  id,
  nombre,
  fallback = "—",
  className = "",
}: {
  id: number | null | undefined;
  nombre: string | null | undefined;
  fallback?: string;
  className?: string;
}) {
  if (!id) return <>{nombre || fallback}</>;
  return (
    <Link href={`/usuarios/${id}`} className={`hover:underline underline-offset-2 ${className}`}>
      {nombre || fallback}
    </Link>
  );
}

/**
 * Rediseño "Color secundario + Top Bar" (punto 16 del pedido: "no duplicar
 * imágenes, utilizar el avatar almacenado como referencia"). Componente
 * único de foto de perfil — círculo con la imagen si `url` viene cargada,
 * o un círculo con la inicial del nombre si no (nunca un ícono roto). No es
 * "use client": es puramente presentacional, así se puede usar tanto desde
 * Server Components (Top Bar, listados, comentarios) como desde el único
 * lugar que hoy necesita estado (CambiarFotoForm, para la previsualización
 * antes de confirmar).
 */
export function Avatar({
  url,
  nombre,
  size = 32,
  className = "",
}: {
  url: string | null | undefined;
  nombre: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const inicial = (nombre || "?").trim().charAt(0).toUpperCase() || "?";
  if (url) {
    return (
      <img
        src={url}
        alt={nombre || "Foto de perfil"}
        width={size}
        height={size}
        className={`rounded-full object-cover border border-border shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`rounded-full bg-[var(--color-brand-100)] text-[var(--color-brand-800)] flex items-center justify-center font-bold border border-border shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {inicial}
    </div>
  );
}

export function NucleoLink({
  id,
  nombre,
  fallback = "—",
  className = "",
}: {
  id: number | null | undefined;
  nombre: string | null | undefined;
  fallback?: string;
  className?: string;
}) {
  if (!id) return <>{nombre || fallback}</>;
  return (
    <Link href={`/nucleos/${id}`} className={`hover:underline underline-offset-2 ${className}`}>
      {nombre || fallback}
    </Link>
  );
}
