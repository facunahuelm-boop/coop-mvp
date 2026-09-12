import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, ROLE_LABELS } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Badge } from "@/components/ui";
import { CambiarPasswordForm } from "@/components/CambiarPasswordForm";
import dayjs from "dayjs";

/**
 * Fase 6 del Plan Maestro ("Perfil individual de usuario"), hallazgo H-13:
 * hasta ahora no existía ninguna página de perfil genérica para una cuenta
 * de usuario — solo la ficha de socio (`socios/[id]`), que es para OTRO
 * concepto (una persona con vivienda/padrón, no necesariamente con cuenta de
 * acceso). Esta página cubre el caso que faltaba: cualquier `users.id`
 * (comisión, administración, admin, etc.), tomando `socios/[id]` como
 * referencia de estructura (header + tarjeta de datos + secciones) sin
 * copiar su contenido específico de socios.
 *
 * Visible a cualquier usuario autenticado, sin gate de módulo — mismo
 * criterio que ya usa /comisiones (donde estos mismos nombres ya aparecen
 * hoy sin restricción, MATRIX: "comisiones" es "read" para todos los
 * roles). La sección de Actividad reciente sí queda detrás del mismo
 * permiso que ya protege a /auditoria (o si es la propia persona mirando su
 * propia actividad). Cambiar la contraseña es siempre y únicamente sobre
 * uno mismo — no hay forma de hacerlo desde la ficha de otra persona.
 *
 * Deliberadamente FUERA de esta fase: no hay edición de nombre/rol/estado
 * de otra cuenta ni alta de usuarios nuevos — eso es "gestión de usuarios"
 * (una pantalla de administración con sus propios permisos y validaciones),
 * un alcance mayor que "ver el perfil" y que el Plan Maestro no pidió acá.
 */

const badgeActivo: Record<string, "verde" | "rojo"> = { activo: "verde", inactivo: "rojo" };

export default async function UsuarioDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) redirect("/login");

  const usuario = await get<any>(`SELECT id, nombre, email, rol, activo, creado_en FROM users WHERE id = ?`, [id]);
  if (!usuario) notFound();

  const esPropioPerfil = viewer.id === usuario.id;

  // Comisiones que integra — mismo dato que ya se ve en /comisiones, acá
  // reunido en un solo lugar por persona.
  const comisiones = await all<any>(
    `SELECT c.id as comision_id, c.nombre as comision_nombre, cm.rol_en_comision
     FROM comision_miembros cm
     JOIN comisiones c ON c.id = cm.comision_id
     WHERE cm.user_id = ? AND cm.activo = 1
     ORDER BY c.nombre ASC`,
    [id]
  ).catch(() => [] as any[]);

  const puedeVerActividad = canRead(viewer.rol, "auditoria") || esPropioPerfil;
  const actividad = puedeVerActividad
    ? await all<any>(`SELECT * FROM auditoria WHERE usuario_id = ? ORDER BY fecha DESC LIMIT 20`, [id]).catch(() => [] as any[])
    : [];

  return (
    <div>
      <PageHeader
        title={usuario.nombre}
        subtitle={ROLE_LABELS[usuario.rol as keyof typeof ROLE_LABELS] || usuario.rol}
        action={<Badge color={badgeActivo[usuario.activo ? "activo" : "inactivo"]}>{usuario.activo ? "Activo" : "Inactivo"}</Badge>}
      />

      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-ink/50">Email:</span> {usuario.email}</div>
          <div><span className="text-ink/50">Miembro desde:</span> {usuario.creado_en ? dayjs(usuario.creado_en).format("DD/MM/YYYY") : "—"}</div>
        </div>
      </Card>

      <SectionTitle>Comisiones que integra</SectionTitle>
      <Card className="mb-6">
        {comisiones.length === 0 ? (
          <EmptyState>No integra ninguna comisión activa.</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-2">
            {comisiones.map((c) => (
              <Link key={c.comision_id} href="/comisiones">
                <Badge color={c.rol_en_comision === "coordinador" ? "brand" : "gray"}>
                  {c.comision_nombre}
                  {c.rol_en_comision === "coordinador" ? " · Coordinador/a" : ""}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {esPropioPerfil && (
        <>
          <SectionTitle>Cambiar contraseña</SectionTitle>
          <Card className="mb-6">
            <CambiarPasswordForm />
          </Card>
        </>
      )}

      {puedeVerActividad && (
        <>
          <SectionTitle>Actividad reciente</SectionTitle>
          <Card>
            {actividad.length === 0 ? (
              <EmptyState>Sin actividad registrada todavía.</EmptyState>
            ) : (
              <div className="divide-y divide-ink/5">
                {actividad.map((a) => (
                  <div key={a.id} className="py-2.5 text-sm">
                    <p>
                      {a.accion.replace(/_/g, " ")} en{" "}
                      <span className="font-mono text-xs bg-ink/5 rounded px-1">{a.entidad}</span>
                      {a.entidad_id ? ` #${a.entidad_id}` : ""}
                    </p>
                    <p className="text-xs text-ink/40 mt-0.5">{dayjs(a.fecha).format("DD/MM/YYYY HH:mm")}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
