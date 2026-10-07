import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { all, get, audit } from "@/lib/db";
import { canEdit, canRead } from "@/lib/roles";
import { crearLibroExcel, respuestaExcel } from "@/lib/excel";
import { etiquetaEstadoSocio, antiguedad } from "@/lib/sociosEstados";
import { codigoDePago } from "@/lib/reglamento";
import { hoyEnUruguay } from "@/lib/horasObra";

export const dynamic = "force-dynamic";

/** Fase 2C — padrón de socios en Excel (con antigüedad y estado) y lista de espera. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  // Tiene datos personales: sólo quien administra el padrón o controla.
  if (!canEdit(user.rol, "socios") && !canRead(user.rol, "auditoria")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const hoy = hoyEnUruguay();
  const [socios, espera, org] = await Promise.all([
    all<{ id: number; nombre: string; documento: string | null; estado: string; fecha_ingreso: string | null; telefono: string | null; email: string | null; nucleo_id: number | null; nucleo: string | null; vivienda: string | null; integrantes: string }>(
      `SELECT s.id, s.nombre, s.documento, s.estado, s.fecha_ingreso, s.telefono, s.email, s.nucleo_id, n.nombre AS nucleo, v.numero AS vivienda,
              (SELECT COUNT(*) FROM socio_integrantes i WHERE i.socio_id = s.id AND i.estado = 'activo') AS integrantes
         FROM socios s LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id LEFT JOIN viviendas v ON v.id = s.vivienda_id
        ORDER BY s.fecha_ingreso NULLS LAST, s.id`
    ),
    all<{ orden: number; nombre: string; documento: string | null; contacto: string | null; estado: string; creado_en: string }>(
      `SELECT orden, nombre, documento, contacto, estado, creado_en FROM lista_espera WHERE estado IN ('en_espera', 'convocado') ORDER BY orden`
    ).catch(() => []),
    get<{ slug: string }>(`SELECT slug FROM organizations WHERE id = ?`, [user.organization_id]),
  ]);
  const buffer = await crearLibroExcel(
    [
      {
        nombre: "Padrón",
        encabezado: [user.organizacion.nombre, `Padrón de socios al ${hoy.split("-").reverse().join("/")}`],
        columnas: [
          { titulo: "N°", clave: "n", tipo: "numero", ancho: 6 },
          { titulo: "Nombre", clave: "nombre", ancho: 28 },
          { titulo: "Documento", clave: "documento", ancho: 14 },
          { titulo: "Estado", clave: "estado", ancho: 14 },
          { titulo: "Fecha de ingreso", clave: "fecha_ingreso", tipo: "fecha" },
          { titulo: "Antigüedad", clave: "antiguedad", ancho: 18 },
          { titulo: "Núcleo", clave: "nucleo", ancho: 24 },
          { titulo: "Código de pago", clave: "codigo", ancho: 12 },
          { titulo: "Vivienda", clave: "vivienda", ancho: 10 },
          { titulo: "Integrantes", clave: "integrantes", tipo: "numero", ancho: 10 },
          { titulo: "Teléfono", clave: "telefono", ancho: 14 },
          { titulo: "Email", clave: "email", ancho: 26 },
        ],
        filas: socios.map((s, i) => ({
          n: i + 1,
          nombre: s.nombre,
          documento: s.documento ?? "",
          estado: etiquetaEstadoSocio(s.estado),
          fecha_ingreso: s.fecha_ingreso,
          antiguedad: antiguedad(s.fecha_ingreso, hoy)?.texto ?? "",
          nucleo: s.nucleo ?? "",
          codigo: codigoDePago(org?.slug ?? "", s.nucleo_id, s.id),
          vivienda: s.vivienda ?? "",
          integrantes: Number(s.integrantes || 0),
          telefono: s.telefono ?? "",
          email: s.email ?? "",
        })),
      },
      {
        nombre: "Lista de espera",
        columnas: [
          { titulo: "Orden", clave: "orden", tipo: "numero", ancho: 8 },
          { titulo: "Nombre", clave: "nombre", ancho: 28 },
          { titulo: "Documento", clave: "documento", ancho: 14 },
          { titulo: "Contacto", clave: "contacto", ancho: 24 },
          { titulo: "Estado", clave: "estado", ancho: 12 },
          { titulo: "Anotado el", clave: "creado", tipo: "fecha" },
          { titulo: "Tiempo esperando", clave: "espera", ancho: 18 },
        ],
        filas: espera.map((e) => ({
          orden: e.orden,
          nombre: e.nombre,
          documento: e.documento ?? "",
          contacto: e.contacto ?? "",
          estado: e.estado === "convocado" ? "Convocado" : "En espera",
          creado: e.creado_en?.slice(0, 10),
          espera: antiguedad(e.creado_en?.slice(0, 10), hoy)?.texto ?? "",
        })),
      },
    ],
    user.organizacion.nombre
  );
  await audit({ usuario_id: user.id, accion: "exportar_padron", entidad: "socios", entidad_id: null, valor_nuevo: { socios: socios.length } }).catch(() => {});
  return respuestaExcel(buffer, `padron-socios-${hoy}.xlsx`);
}
