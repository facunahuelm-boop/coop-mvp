import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import dayjs from "dayjs";
import { CrearComunicacionForm, MarcarLeidaComunicacionForm } from "@/components/comunicaciones/ComunicacionesFormularios";
import {
  TIPO_COMUNICACION,
  TIPOS_COMUNICACION_OVERSIGHT,
  TipoComunicacionBadge,
  tipoComunicacionLabel,
  type TipoComunicacion,
} from "@/components/comunicaciones/ComunicacionStatus";
import { ResumenComunicaciones, type ResumenTileDef, type ResumenTileItem } from "@/components/comunicaciones/ResumenComunicaciones";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";
import { UsuarioLink } from "@/components/EntidadLink";

// Fase 7 del sistema de gestión de Comisiones (19/09, pedido explícito,
// sección "comunicaciones/notificaciones"). Mismo patrón visual que
// Decisiones: resumen con pop-up + filtros arriba + tabla compacta con modal
// de detalle liviano (acá el detalle alcanza para todo: la única acción es
// marcar como leída, ver la nota de alcance en actions/comunicaciones.ts).
//
// A diferencia de Solicitudes/Decisiones, acá la visibilidad de cada fila
// depende del TIPO de comunicación (privada/entre_comision/general/
// consejo_directivo/administrativa/urgente) además del rol — se filtra en
// JS después de traer todo (mismo criterio que ya usa esta fase en otras
// pantallas: volumen chico, no amerita una consulta SQL distinta por tipo).
//
// Consultas contra `comunicaciones`/`comunicacion_lecturas` con
// `.catch(() => [])` por si esta fase se despliega antes de que el usuario
// corra la migración 0029 en producción — mismo criterio defensivo que el
// resto de las fases.
export default async function ComunicacionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");
  const esOversight = canEdit(user.rol, "finanzas");

  type ComunicacionRow = {
    id: number;
    tipo: string;
    comision_id: number | null;
    comision_nombre: string | null;
    autor_id: number;
    autor_nombre: string;
    destinatario_id: number | null;
    destinatario_nombre: string | null;
    asunto: string;
    cuerpo: string;
    creado_en: string;
    leida_por_mi: boolean;
  };

  const [comunicacionesRaw, comisionesActivas, misComisiones, usuarios] = await Promise.all([
    all<ComunicacionRow>(
      `SELECT c.*, au.nombre as autor_nombre, co.nombre as comision_nombre, du.nombre as destinatario_nombre,
              CASE WHEN cl.id IS NOT NULL THEN true ELSE false END as leida_por_mi
       FROM comunicaciones c
       LEFT JOIN users au ON au.id = c.autor_id
       LEFT JOIN comisiones co ON co.id = c.comision_id
       LEFT JOIN users du ON du.id = c.destinatario_id
       LEFT JOIN comunicacion_lecturas cl ON cl.comunicacion_id = c.id AND cl.user_id = ?
       ORDER BY c.creado_en DESC`,
      [user.id]
    ).catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 AND id != ? ORDER BY nombre ASC`, [user.id]),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));

  const puedeVer = (c: ComunicacionRow): boolean => {
    if (esOversight) return true;
    switch (c.tipo) {
      case "privada":
        return c.autor_id === user.id || c.destinatario_id === user.id;
      case "entre_comision":
        return c.comision_id != null && misComisionIds.has(c.comision_id);
      case "general":
      case "urgente":
        return true;
      default: // consejo_directivo | administrativa: sólo conducción (ya cubierto arriba)
        return false;
    }
  };

  const comunicaciones = comunicacionesRaw.filter(puedeVer);

  const tiposDisponibles: TipoComunicacion[] = esOversight
    ? [...TIPO_COMUNICACION]
    : (TIPO_COMUNICACION.filter((t) => !TIPOS_COMUNICACION_OVERSIGHT.includes(t)) as TipoComunicacion[]);

  const noLeidas = comunicaciones.filter((c) => !c.leida_por_mi && c.autor_id !== user.id);
  const urgentes = comunicaciones.filter((c) => c.tipo === "urgente");
  const generales = comunicaciones.filter((c) => c.tipo === "general" || c.tipo === "consejo_directivo" || c.tipo === "administrativa");
  const estaSemana = comunicaciones.filter((c) => dayjs(c.creado_en).isAfter(dayjs().subtract(7, "day")));

  const itemDe = (c: ComunicacionRow): ResumenTileItem => ({
    label: c.asunto,
    sublabel: c.comision_nombre || (c.destinatario_nombre ? `Privado: ${c.destinatario_nombre}` : "Toda la cooperativa"),
  });

  const tiles: ResumenTileDef[] = [
    {
      id: "no_leidas",
      label: "No leídas",
      value: String(noLeidas.length),
      color: noLeidas.length > 0 ? "amarillo" : "verde",
      items: noLeidas.map(itemDe),
      vacioTexto: "No tenés comunicaciones sin leer.",
    },
    {
      id: "urgentes",
      label: "Urgentes",
      value: String(urgentes.length),
      color: urgentes.length > 0 ? "rojo" : "verde",
      items: urgentes.map(itemDe),
      vacioTexto: "No hay comunicaciones urgentes.",
    },
    {
      id: "generales",
      label: "General / Consejo / Adm.",
      value: String(generales.length),
      items: generales.map(itemDe),
      vacioTexto: "No hay comunicaciones de alcance general.",
    },
    {
      id: "semana",
      label: "Esta semana",
      value: String(estaSemana.length),
      color: "verde",
      items: estaSemana.map(itemDe),
      vacioTexto: "No hay comunicaciones esta semana.",
    },
  ];

  const filtros: FiltroDef[] = [
    {
      id: "tipo",
      label: "Tipo",
      opciones: TIPO_COMUNICACION.map((t) => ({ value: t, label: tipoComunicacionLabel(t) })),
      valores: comunicaciones.map((c) => c.tipo),
    },
    {
      id: "comision",
      label: "Comisión",
      opciones: comisionesActivas.map((c) => ({ value: c.nombre, label: c.nombre })),
      valores: comunicaciones.map((c) => c.comision_nombre),
      secundario: true,
    },
  ];

  const claves = comunicaciones.map((c) => `${c.asunto} ${c.autor_nombre} ${c.comision_nombre || ""} ${c.destinatario_nombre || ""}`);

  return (
    <div>
      <PageHeader
        title="Comunicaciones"
        subtitle="Mensajes estructurados entre comisiones, con confirmación de lectura"
        action={puedeEditar ? <CrearComunicacionForm comisiones={comisionesActivas} usuarios={usuarios} tiposDisponibles={tiposDisponibles} /> : undefined}
      />

      <ResumenComunicaciones tiles={tiles} />

      <Card>
        {comunicaciones.length === 0 ? (
          <EmptyState>No hay comunicaciones para vos todavía.</EmptyState>
        ) : (
          <TablaFiltrable
            placeholder="Buscar por asunto, comisión, persona…"
            claves={claves}
            filtros={filtros}
            encabezado={
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Asunto</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Comisión / Para</th>
                <th className="py-2 pr-3">De</th>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3"></th>
              </tr>
            }
          >
            {comunicaciones.map((c) => (
              <FilaConDetalle
                key={c.id}
                titulo={c.asunto}
                subtitulo={tipoComunicacionLabel(c.tipo)}
                secciones={[
                  {
                    titulo: "Mensaje",
                    items: [
                      { label: "De", valor: <UsuarioLink id={c.autor_id} nombre={c.autor_nombre} /> },
                      {
                        label: "Para",
                        valor: c.comision_nombre || (c.destinatario_nombre ? <UsuarioLink id={c.destinatario_id} nombre={c.destinatario_nombre} /> : "Toda la cooperativa"),
                      },
                      { label: "Enviado", valor: dayjs(c.creado_en).format("DD/MM/YYYY HH:mm") },
                      { label: "Mensaje", valor: <div className="whitespace-pre-wrap text-left font-normal text-sm">{c.cuerpo}</div> },
                    ],
                  },
                  {
                    titulo: "Estado",
                    items: [
                      {
                        label: "Lectura",
                        valor:
                          c.autor_id === user.id ? (
                            <Badge color="gray">Enviado por vos</Badge>
                          ) : c.leida_por_mi ? (
                            <Badge color="verde">Leída</Badge>
                          ) : (
                            <MarcarLeidaComunicacionForm id={c.id} />
                          ),
                      },
                    ],
                  },
                ]}
              >
                <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)] truncate max-w-[220px]">{c.asunto}</td>
                <td className="py-2 pr-3">
                  <TipoComunicacionBadge tipo={c.tipo} />
                </td>
                <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">
                  {c.comision_nombre || (c.destinatario_nombre ? `Privado: ${c.destinatario_nombre}` : "Toda la cooperativa")}
                </td>
                <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{c.autor_nombre}</td>
                <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{dayjs(c.creado_en).format("DD/MM HH:mm")}</td>
                <td className="py-2 pr-3">
                  {c.autor_id === user.id ? (
                    <Badge color="gray">—</Badge>
                  ) : c.leida_por_mi ? (
                    <Badge color="verde">Leída</Badge>
                  ) : (
                    <Badge color="amarillo">Nueva</Badge>
                  )}
                </td>
              </FilaConDetalle>
            ))}
          </TablaFiltrable>
        )}
      </Card>
    </div>
  );
}
