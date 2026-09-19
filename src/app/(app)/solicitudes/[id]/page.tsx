import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { puedeGestionarComision } from "@/lib/comisionAuth";
import { Card, PageHeader, Label, EmptyState } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import dayjs from "dayjs";
import {
  ResponderSolicitudForm,
  DerivarSolicitudForm,
  ComentarSolicitudForm,
  CancelarSolicitudForm,
} from "@/components/solicitudes/SolicitudesFormularios";
import {
  SolicitudStatusBadge,
  PrioridadSolicitudBadge,
  estadoEfectivo,
  tipoSolicitudLabel,
} from "@/components/solicitudes/SolicitudStatus";
import { HistorialSolicitud } from "@/components/solicitudes/HistorialSolicitud";

// Fase 3 del sistema de gestión de Comisiones (19/09) — ficha completa de
// una solicitud entre comisiones, mismo criterio que compras/[id]/page.tsx
// (página propia, no modal: acá viven las acciones reales de servidor —
// responder/derivar/comentar/cancelar — y el historial completo). Las
// consultas a tablas de la migración 0029 van con `.catch(() => [])` por si
// esta fase se despliega antes de que esa migración corra en producción.
export default async function SolicitudDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const [solicitud, comentarios, eventos, comisionesActivas, usuarios] = await Promise.all([
    get<any>(
      `SELECT s.*, co.nombre as origen_nombre, cd.nombre as destino_nombre,
              r.nombre as responsable_nombre, cr.nombre as creador_nombre
       FROM solicitudes_comision s
       JOIN comisiones co ON co.id = s.comision_origen_id
       JOIN comisiones cd ON cd.id = s.comision_destino_id
       LEFT JOIN users r ON r.id = s.responsable_id
       LEFT JOIN users cr ON cr.id = s.creado_por_id
       WHERE s.id = ?`,
      [id]
    ).catch(() => null),
    all<any>(
      `SELECT c.*, u.nombre as autor_nombre
       FROM solicitud_comentarios c
       LEFT JOIN users u ON u.id = c.autor_id
       WHERE c.solicitud_id = ? ORDER BY c.creado_en ASC`,
      [id]
    ).catch(() => [] as any[]),
    all<any>(
      `SELECT e.*, u.nombre as usuario_nombre, dc.nombre as de_comision_nombre, ac.nombre as a_comision_nombre
       FROM solicitud_eventos e
       LEFT JOIN users u ON u.id = e.usuario_id
       LEFT JOIN comisiones dc ON dc.id = e.de_comision_id
       LEFT JOIN comisiones ac ON ac.id = e.a_comision_id
       WHERE e.solicitud_id = ? ORDER BY e.creado_en ASC`,
      [id]
    ).catch(() => [] as any[]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 ORDER BY nombre ASC`),
  ]);

  if (!solicitud) notFound();

  const esOversight = canEdit(user.rol, "finanzas");
  const puedeEditarModulo = canEdit(user.rol, "comisiones");
  const [puedeGestionarOrigen, puedeGestionarDestino] = await Promise.all([
    puedeGestionarComision(user, solicitud.comision_origen_id),
    puedeGestionarComision(user, solicitud.comision_destino_id),
  ]);

  const estadoActual = estadoEfectivo(solicitud.estado, solicitud.fecha_limite);
  const estaCerrada = ["resuelta", "rechazada", "cancelada"].includes(solicitud.estado);

  const puedeResponder = puedeEditarModulo && puedeGestionarDestino && !estaCerrada;
  const puedeDerivar = puedeResponder;
  const puedeComentar = puedeEditarModulo && (puedeGestionarOrigen || puedeGestionarDestino || esOversight);
  const puedeCancelar =
    puedeEditarModulo && !estaCerrada && (user.id === solicitud.creado_por_id || esOversight || puedeGestionarOrigen);

  const comisionesParaDerivar = comisionesActivas.filter((c: any) => c.id !== solicitud.comision_destino_id);

  const tabInformacion = (
    <>
      <Card className="mb-5 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><Label>Tipo</Label>{tipoSolicitudLabel(solicitud.tipo)}</div>
          <div><Label>Prioridad</Label><PrioridadSolicitudBadge prioridad={solicitud.prioridad} /></div>
          <div><Label>Estado</Label><SolicitudStatusBadge estado={estadoActual} /></div>
          <div><Label>Fecha límite</Label>{solicitud.fecha_limite ? dayjs(solicitud.fecha_limite).format("DD/MM/YYYY") : "—"}</div>
          <div><Label>Origen</Label>{solicitud.origen_nombre}</div>
          <div><Label>Destino actual</Label>{solicitud.destino_nombre}</div>
          <div><Label>Responsable</Label>{solicitud.responsable_nombre || "—"}</div>
          <div><Label>Creada por</Label>{solicitud.creador_nombre || "—"} · {dayjs(solicitud.creado_en).format("DD/MM/YYYY")}</div>
        </div>
        {solicitud.descripcion && <p className="text-ink/70 mt-3 whitespace-pre-wrap">{solicitud.descripcion}</p>}

        {(puedeResponder || puedeDerivar) && (
          <div className="mt-4 pt-4 border-t border-ink/10 space-y-3">
            {puedeResponder && (
              <div>
                <ResponderSolicitudForm id={solicitud.id} usuarios={usuarios} />
              </div>
            )}
            {puedeDerivar && comisionesParaDerivar.length > 0 && (
              <div>
                <DerivarSolicitudForm id={solicitud.id} comisiones={comisionesParaDerivar} />
              </div>
            )}
          </div>
        )}

        {puedeCancelar && (
          <div className="mt-4 pt-3 border-t border-ink/10">
            <CancelarSolicitudForm id={solicitud.id} />
          </div>
        )}

        {estaCerrada && (
          <p className="text-xs text-ink-faint mt-4 pt-3 border-t border-ink/10">
            Esta solicitud está cerrada ({estadoEfectivo(solicitud.estado, solicitud.fecha_limite) === "cancelada" ? "cancelada" : solicitud.estado}) — no admite más cambios de estado.
          </p>
        )}
      </Card>

      <Card>
        <p className="text-sm font-semibold text-ink mb-3">Comentarios</p>
        {comentarios.length === 0 ? (
          <EmptyState>Todavía no hay comentarios.</EmptyState>
        ) : (
          <div className="space-y-3 mb-4">
            {comentarios.map((c: any) => (
              <div key={c.id} className="text-sm border-b border-ink/5 pb-3 last:border-0 last:pb-0">
                <p className="text-ink/80 whitespace-pre-wrap">{c.cuerpo}</p>
                <p className="text-xs text-ink-faint mt-1">
                  {c.autor_nombre || "—"} · {dayjs(c.creado_en).format("DD/MM/YYYY HH:mm")}
                </p>
              </div>
            ))}
          </div>
        )}
        {puedeComentar && <ComentarSolicitudForm id={solicitud.id} />}
      </Card>
    </>
  );

  return (
    <div>
      <PageHeader
        title={`${solicitud.numero || "#" + solicitud.id} · ${solicitud.titulo}`}
        subtitle={`${solicitud.origen_nombre} → ${solicitud.destino_nombre}`}
        action={
          <div className="flex items-center gap-2">
            <SolicitudStatusBadge estado={estadoActual} />
          </div>
        }
      />

      <Tabs
        tabs={[
          { id: "info", label: "Información", content: tabInformacion },
          { id: "historial", label: `Historial${eventos.length ? ` (${eventos.length})` : ""}`, content: <Card><HistorialSolicitud eventos={eventos} /></Card> },
        ]}
      />

      <p className="text-xs text-ink-faint mt-4">
        <Link href="/solicitudes" className="underline underline-offset-2">← Volver a Solicitudes</Link>
      </p>
    </div>
  );
}
