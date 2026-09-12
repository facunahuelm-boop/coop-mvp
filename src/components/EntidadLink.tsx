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
