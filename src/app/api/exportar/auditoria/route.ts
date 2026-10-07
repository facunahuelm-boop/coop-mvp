import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { all, audit } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { crearLibroExcel, respuestaExcel } from "@/lib/excel";
import { construirFiltrosAuditoria } from "@/lib/auditoriaFiltros";
import { registroLegible, type RegistroAuditoriaCrudo } from "@/lib/auditoriaTexto";
import { hoyEnUruguay } from "@/lib/horasObra";

export const dynamic = "force-dynamic";

const MAXIMO = 20000;

/** Fase 2F — la auditoría (con los mismos filtros de la pantalla) en Excel, para la Comisión Fiscal. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canRead(user.rol, "auditoria")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { whereSql, valores } = construirFiltrosAuditoria(sp);
  const registros = await all<RegistroAuditoriaCrudo>(
    `SELECT a.*, u.nombre AS usuario_nombre FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id ${whereSql} ORDER BY a.fecha DESC, a.id DESC LIMIT ${MAXIMO}`,
    valores
  );
  const hoy = hoyEnUruguay();
  const buffer = await crearLibroExcel([
    {
      nombre: "Auditoría",
      encabezado: [user.organizacion.nombre, `Registro de auditoría — descargado el ${hoy.split("-").reverse().join("/")}${registros.length >= MAXIMO ? ` (primeros ${MAXIMO})` : ""}`],
      columnas: [
        { titulo: "Fecha y hora", clave: "fecha", ancho: 18 },
        { titulo: "Quién", clave: "quien", ancho: 24 },
        { titulo: "Módulo", clave: "modulo", ancho: 18 },
        { titulo: "Qué hizo", clave: "texto", ancho: 60 },
        { titulo: "Acción (código)", clave: "accion", ancho: 22 },
        { titulo: "Registro", clave: "entidad", ancho: 22 },
        { titulo: "N° de registro", clave: "entidad_id", tipo: "numero", ancho: 10 },
      ],
      filas: registros.map((r) => {
        const l = registroLegible(r);
        return {
          fecha: String(r.fecha).slice(0, 16).replace("T", " "),
          quien: l.usuarioNombre,
          modulo: l.modulo,
          texto: l.texto,
          accion: r.accion,
          entidad: l.entidadLabel,
          entidad_id: r.entidad_id ?? null,
        };
      }),
    },
  ]);
  await audit({ usuario_id: user.id, accion: "exportar_auditoria", entidad: "auditoria", entidad_id: user.organization_id, valor_nuevo: { filas: registros.length, filtros: sp } });
  return respuestaExcel(buffer, `auditoria-${hoy}.xlsx`);
}
