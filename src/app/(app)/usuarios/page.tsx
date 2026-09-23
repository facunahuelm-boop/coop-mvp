import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import type { Role } from "@/lib/roles";
import { Card, PageHeader } from "@/components/ui";
import { Avatar } from "@/components/EntidadLink";
import {
  CrearUsuarioForm,
  CambiarRolForm,
  AlternarActivoButton,
  EstadoUsuarioBadge,
  RestablecerPasswordForm,
} from "@/components/usuarios/UsuariosAdminFormularios";
import dayjs from "dayjs";

/**
 * Fase 4 ("Seguridad y permisos granulares(16) + Seguridad de cuentas/2FA/
 * sesiones(17) + Eliminación segura/archivar en vez de borrar(18)") —
 * Sub-fase 4.1: Gestión de usuarios (sección 16, primera de la Fase 4).
 *
 * El texto original de las secciones 16/17/18 del plan de 44 está
 * irrecuperable (mismo problema que secciones anteriores). Alcance
 * confirmado con el usuario tras auditar a fondo: hoy no existe ninguna
 * pantalla para crear, desactivar o cambiarle el rol a una cuenta — solo
 * con SQL directo. `usuarios/[id]/page.tsx` (perfil individual, visible a
 * cualquiera) ya había anticipado esto en su propio comentario como fuera
 * de su alcance. Esta pantalla es exactamente eso, sin tocar el modelo de
 * permisos (roles.ts) ni el perfil individual existente — solo agrega la
 * gestión de la cuenta en sí.
 *
 * Gate: solo `admin` (ver requireAdmin en actions/usuariosAdmin.ts) — más
 * estricto que `/configuracion` (admin+consejo_directivo) porque gestionar
 * quién tiene acceso al sistema es al menos tan sensible como los
 * hard-deletes que ya son admin-only en el resto del código (documentos,
 * proveedores, solicitudes de compra). Igual que esas pantallas, si alguien
 * sin permiso entra por URL directa se lo manda a /dashboard, sin revelar
 * ni un mensaje de "no tenés permiso" con detalles.
 */
export default async function UsuariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.rol !== "admin") redirect("/dashboard");

  const usuarios = await all<{
    id: number;
    nombre: string;
    email: string;
    rol: Role;
    activo: number;
    avatar_url: string | null;
    creado_en: string;
  }>(`SELECT id, nombre, email, rol, activo, avatar_url, creado_en FROM users ORDER BY activo DESC, nombre ASC`);

  return (
    <div>
      <PageHeader
        title="Gestión de usuarios"
        subtitle="Crear cuentas, cambiar roles y desactivar el acceso de quien corresponda"
        action={<CrearUsuarioForm />}
      />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          🔒 Solo vos (administrador del sistema) podés ver y usar esta pantalla. Desactivar a alguien le corta el
          acceso de inmediato, sin borrar nada de lo que hizo antes. No podés desactivarte ni cambiarte el rol a vos
          mismo — pedile a otro administrador si hace falta.
        </p>
      </Card>

      <div className="space-y-2">
        {usuarios.map((u) => {
          const esUnoMismo = u.id === user.id;
          return (
            <Card key={u.id} className={!u.activo ? "opacity-60" : ""}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar url={u.avatar_url} nombre={u.nombre} size={36} />
                  <div className="min-w-0">
                    <Link href={`/usuarios/${u.id}`} className="text-sm font-semibold text-[var(--color-brand-900)] hover:underline truncate block">
                      {u.nombre} {esUnoMismo && <span className="text-ink/40 font-normal">(vos)</span>}
                    </Link>
                    <p className="text-xs text-ink/50 truncate">{u.email}</p>
                    <p className="text-xs text-ink/35">Desde {dayjs(u.creado_en).format("DD/MM/YYYY")}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <EstadoUsuarioBadge activo={!!u.activo} />
                  <CambiarRolForm id={u.id} rolActual={u.rol} disabled={esUnoMismo} />
                  <RestablecerPasswordForm id={u.id} nombre={u.nombre} />
                  <AlternarActivoButton id={u.id} activo={!!u.activo} disabled={esUnoMismo && !!u.activo} />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
