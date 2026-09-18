import { Card } from "./ui";
import { TablaFiltrable, type FiltroDef } from "./TablaFiltrable";
import { FilaConDetalle, EstadoBadge } from "./FilaConDetalle";
import type { Contacto, TipoContacto } from "@/lib/contactos";

/**
 * Rediseño de Contactos (18/09, pedido explícito con referencia visual de
 * ERP): reemplaza las tarjetas compactas (divide-y, Fase de auditoría de
 * espacio) por el mismo patrón de tabla+filtros+modal que Proveedores y el
 * padrón de Socios/Núcleos — las tres pantallas deben "sentirse como tres
 * módulos del mismo sistema" (pedido explícito, sección 17). El filtrado
 * (texto + tipo/rol/núcleo/estado) sigue siendo 100% del lado del cliente,
 * mismo criterio y misma razón que antes (padrón chico de una cooperativa).
 */

const TIPO_LABEL: Record<TipoContacto, string> = {
  socio: "Socio/a",
  integrante: "Integrante",
  proveedor: "Proveedor",
};

export function ContactosLista({ contactos }: { contactos: Contacto[] }) {
  const tipos = Array.from(new Set(contactos.map((c) => c.tipo)));
  const roles = Array.from(new Set(contactos.map((c) => c.rol))).sort();
  const nucleos = Array.from(new Set(contactos.map((c) => c.nucleo).filter(Boolean))) as string[];
  const estados = Array.from(new Set(contactos.map((c) => c.estado))).sort();

  const filtros: FiltroDef[] = [
    {
      id: "tipo",
      label: "Tipo",
      opciones: tipos.map((t) => ({ value: t, label: TIPO_LABEL[t] })),
      valores: contactos.map((c) => c.tipo),
    },
    {
      id: "rol",
      label: "Rol",
      opciones: roles.map((r) => ({ value: r, label: r })),
      valores: contactos.map((c) => c.rol),
      secundario: true,
    },
    {
      id: "nucleo",
      label: "Núcleo",
      opciones: nucleos.sort().map((n) => ({ value: n, label: `Núcleo ${n}` })),
      valores: contactos.map((c) => c.nucleo || ""),
      secundario: true,
    },
    {
      id: "estado",
      label: "Estado",
      opciones: estados.map((e) => ({ value: e, label: e })),
      valores: contactos.map((c) => c.estado),
    },
  ];

  if (contactos.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-muted text-center py-8">No hay contactos para mostrar.</p>
      </Card>
    );
  }

  return (
    <Card>
      <TablaFiltrable
        placeholder="Buscar por nombre, teléfono, email, documento o núcleo..."
        claves={contactos.map((c) =>
          [c.nombre, c.subtitulo, c.email, c.telefono, c.documento, c.nucleo, c.rol].filter(Boolean).join(" ")
        )}
        filtros={filtros}
        sinResultadosTexto="No se encontraron contactos para esa búsqueda."
        encabezado={
          <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
            <th className="py-2 pr-3">Contacto</th>
            <th className="py-2 pr-3">Tipo</th>
            <th className="py-2 pr-3">Teléfono</th>
            <th className="py-2 pr-3">Email</th>
            <th className="py-2 pr-3">Núcleo</th>
            <th className="py-2 pr-3">Rol</th>
            <th className="py-2 pr-3">Estado</th>
            <th className="py-2 pr-3"></th>
          </tr>
        }
      >
        {contactos.map((c) => (
          <FilaConDetalle
            key={`${c.tipo}-${c.id}`}
            titulo={c.nombre}
            subtitulo={c.subtitulo}
            editarHref={c.href}
            secciones={[
              {
                titulo: "Información personal",
                items: [
                  { label: "Teléfono", valor: c.telefono || "—" },
                  { label: "Email", valor: c.email || "—" },
                  { label: "Documento", valor: c.documento || "—" },
                ],
              },
              {
                titulo: "Información de cooperativa",
                items: [
                  { label: "Tipo", valor: TIPO_LABEL[c.tipo] },
                  { label: "Rol", valor: c.rol },
                  { label: "Núcleo", valor: c.nucleo ? `Núcleo ${c.nucleo}` : "—" },
                  { label: "Estado", valor: <EstadoBadge estado={c.estado} /> },
                ],
              },
            ]}
          >
            <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">{c.nombre}</td>
            <td className="py-2 pr-3 text-ink/60">{TIPO_LABEL[c.tipo]}</td>
            <td className="py-2 pr-3 text-ink/60">{c.telefono || "—"}</td>
            <td className="py-2 pr-3 text-ink/60 truncate max-w-[180px]">{c.email || "—"}</td>
            <td className="py-2 pr-3 text-ink/60">{c.nucleo || "—"}</td>
            <td className="py-2 pr-3 text-ink/60">{c.rol}</td>
            <td className="py-2 pr-3">
              <EstadoBadge estado={c.estado} />
            </td>
          </FilaConDetalle>
        ))}
      </TablaFiltrable>
    </Card>
  );
}
