import { all } from "./db";
import { canRead, type Role } from "./roles";
import { RELACION_INTEGRANTE_LABEL, TIPO_PROVEEDOR_LABEL } from "./constants";

/**
 * Fase 5 del Plan Maestro ("Sección Contactos"), REQUIREMENTS.md sección 5.5.
 *
 * Nota de diseño (arrastrada de la Fase 2, ver REQUIREMENTS.md sección 3):
 * `nucleos_familiares` (motor de Trabajo/ayuda mutua — cuota social y horas
 * acumuladas, sin datos personales) y `socios`+`socio_integrantes` (padrón
 * de personas, con nombre/teléfono/email) son dos modelos de datos
 * DISTINTOS que conviven, cruzados solo opcionalmente vía `socios.nucleo_id`.
 * Esta pantalla no los fusiona ni crea una tercera tabla: agrega, solo en
 * memoria y de solo lectura, tres fuentes que YA tienen datos de contacto
 * reales (socios, socio_integrantes, proveedores) en una vista unificada.
 * `nucleos_familiares` no aparece como fuente propia porque no tiene ningún
 * dato de contacto (ver migración 0019) — cuando un socio pertenece a un
 * núcleo, el nombre del núcleo se muestra como referencia en el subtítulo.
 *
 * Deliberadamente FUERA de esta fase (incluir esto es trabajo de otra fase,
 * no un olvido): integrantes de comisiones / cuentas de `users` — esa tabla
 * no tiene teléfono/email propio y ya se puede navegar por rol en
 * /comisiones; agregarlos acá duplicaría esa pantalla sin sumar un dato de
 * contacto nuevo.
 *
 * Es una función de solo lectura (SELECT puro contra tablas ya protegidas
 * por RLS vía withTenantClient/all()) — no hay Server Actions ni mutaciones
 * nuevas en esta fase.
 */

export type TipoContacto = "socio" | "integrante" | "proveedor";

export type Contacto = {
  tipo: TipoContacto;
  id: number;
  nombre: string;
  subtitulo: string;
  email: string | null;
  telefono: string | null;
  estado: string;
  href: string;
};

export async function obtenerContactos(rol: Role): Promise<Contacto[]> {
  const fuentes: Promise<Contacto[]>[] = [];

  // Socios (padrón) + integrantes de su núcleo — mismo criterio de permiso
  // que /socios: cualquier rol puede ver el padrón (transparencia básica,
  // ver el comentario de la MATRIX en roles.ts).
  if (canRead(rol, "socios")) {
    fuentes.push(
      all<any>(
        `SELECT s.id, s.nombre, s.email, s.telefono, s.estado,
                v.numero as vivienda_numero, n.nombre as nucleo_nombre
         FROM socios s
         LEFT JOIN viviendas v ON v.id = s.vivienda_id
         LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
         WHERE s.estado != 'baja'
         ORDER BY s.nombre ASC`
      ).then((rows) =>
        rows.map((r) => ({
          tipo: "socio" as const,
          id: r.id,
          nombre: r.nombre as string,
          subtitulo:
            [r.vivienda_numero ? `Vivienda ${r.vivienda_numero}` : null, r.nucleo_nombre ? `Núcleo ${r.nucleo_nombre}` : null]
              .filter(Boolean)
              .join(" · ") || "Socio/a",
          email: r.email ?? null,
          telefono: r.telefono ?? null,
          estado: r.estado as string,
          href: `/socios/${r.id}`,
        }))
      ),
      // Defensivo (mismo criterio que /socios y /gastos): si por algún
      // motivo la migración 0019 todavía no corrió en algún entorno, esta
      // fuente se omite en vez de romper el resto de la pantalla.
      all<any>(
        `SELECT si.id, si.nombre, si.apellido, si.email, si.telefono, si.relacion, si.estado,
                si.socio_id, s.nombre as socio_nombre
         FROM socio_integrantes si
         JOIN socios s ON s.id = si.socio_id
         WHERE si.estado = 'activo'
         ORDER BY si.nombre ASC`
      )
        .catch(() => [] as any[])
        .then((rows) =>
          rows.map((r) => ({
            tipo: "integrante" as const,
            id: r.id,
            nombre: [r.nombre, r.apellido].filter(Boolean).join(" "),
            subtitulo: `${RELACION_INTEGRANTE_LABEL[r.relacion as keyof typeof RELACION_INTEGRANTE_LABEL] || "Integrante"} de ${r.socio_nombre}`,
            email: r.email ?? null,
            telefono: r.telefono ?? null,
            estado: r.estado as string,
            href: `/socios/${r.socio_id}`,
          }))
        )
    );
  }

  // Proveedores — mismo permiso que /proveedores ("compras"): a propósito
  // false para el rol "socio" (ver MATRIX en roles.ts), así un socio no ve
  // datos de contacto de proveedores desde esta pantalla tampoco.
  if (canRead(rol, "compras")) {
    fuentes.push(
      all<any>(
        `SELECT id, nombre, email, telefono, tipo, rubro, estado
         FROM proveedores
         WHERE COALESCE(estado, 'nuevo') != 'inactivo'
         ORDER BY nombre ASC`
      ).then((rows) =>
        rows.map((r) => ({
          tipo: "proveedor" as const,
          id: r.id,
          nombre: r.nombre as string,
          subtitulo:
            (r.tipo && TIPO_PROVEEDOR_LABEL[r.tipo as keyof typeof TIPO_PROVEEDOR_LABEL]) || r.rubro || "Proveedor",
          email: r.email ?? null,
          telefono: r.telefono ?? null,
          estado: (r.estado as string) || "nuevo",
          href: `/proveedores/${r.id}`,
        }))
      )
    );
  }

  const resultados = (await Promise.all(fuentes)).flat();
  return resultados;
}
