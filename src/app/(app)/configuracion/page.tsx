import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get, rootGet } from "@/lib/db";
import { Card, PageHeader, Badge, Label, inputClass } from "@/components/ui";
import {
  guardarConfigEmailAction,
  actualizarAlertasEmailAction,
  actualizarEtapaAction,
  actualizarBrandingAction,
  actualizarModulosAction,
} from "@/lib/actions/configuracion";

const ETAPA_LABEL: Record<string, string> = {
  pre_obra: "Pre-obra (todavía no arrancó la construcción)",
  obra: "En obra (construcción en curso)",
  habitada: "Habitada (ya se mudaron, obra terminada)",
};

// Fase D: módulos cuyo default de visibilidad depende de la etapa (ver
// moduloVisible() en components/Nav.tsx) — acá un admin puede forzarlos más
// allá de lo que diría la etapa sola, sin tocar ningún dato existente.
const MODULOS_LABEL: Record<string, string> = {
  obra: "Obra (cronograma y avance de la construcción)",
  trabajo: "Trabajo (jornadas de ayuda mutua)",
  seguridad: "Seguridad e higiene",
};

export default async function ConfiguracionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Solo admin y consejo directivo pueden acceder
  if (!["admin", "consejo_directivo"].includes(user.rol)) {
    redirect("/dashboard");
  }

  const [config, alertasEmail, usuariosActivosRow, organizacion] = await Promise.all([
    all<any>(`SELECT * FROM config_email`),
    all<any>(
      `SELECT ae.*, u.nombre as usuario_nombre FROM alertas_email ae
       LEFT JOIN users u ON u.id = ae.usuario_id
       ORDER BY ae.rol ASC`
    ),
    all<any>(`SELECT COUNT(*) as c FROM users WHERE activo = 1`),
    rootGet<any>(`SELECT * FROM organizations WHERE id = ?`, [user.organization_id]),
  ]);
  const configObj = Object.fromEntries(config.map((c: any) => [c.clave, c.valor]));
  const usuariosActivos = usuariosActivosRow[0]?.c ?? 0;

  return (
    <div>
      <PageHeader title="Configuración" subtitle="Email, alertas y preferencias del sistema" />

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Marca de la cooperativa</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          Estos datos reemplazan "COOVA" en el menú y la pantalla de inicio de sesión: nombre, logo
          y color principal se aplican en todo el sistema.
        </p>
        <form action={actualizarBrandingAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Nombre de la cooperativa</Label>
            <input
              type="text"
              name="nombre"
              required
              defaultValue={organizacion?.nombre || ""}
              className={inputClass}
            />
          </div>
          <div>
            <Label>Color principal</Label>
            <input
              type="color"
              name="color_primario"
              defaultValue={organizacion?.color_primario || "var(--color-brand-900)"}
              className="h-10 w-full rounded-lg border border-ink/10 cursor-pointer"
            />
          </div>
          <div>
            <Label>Color secundario (opcional)</Label>
            <input
              type="color"
              name="color_secundario"
              defaultValue={organizacion?.color_secundario || organizacion?.color_primario || "var(--color-brand-800)"}
              className="h-10 w-full rounded-lg border border-ink/10 cursor-pointer"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Logo (opcional)</Label>
            {organizacion?.logo_url && (
              <img src={organizacion.logo_url} alt={organizacion.nombre} className="h-12 w-12 rounded-full object-cover mb-2" />
            )}
            <input type="file" name="logo" accept="image/*" className="text-xs" />
          </div>
          <button type="submit" className="sm:col-span-2 rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">
            Guardar marca
          </button>
        </form>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Etapa</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          La etapa de la cooperativa personaliza el menú: en "Habitada" se oculta automáticamente
          el grupo Obra (Obra, Trabajo y Seguridad), porque deja de ser relevante una vez terminada
          la construcción.
        </p>
        <form action={actualizarEtapaAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <Label>Etapa actual: {organizacion?.nombre}</Label>
            <select name="etapa" defaultValue={organizacion?.etapa || "obra"} className={inputClass}>
              {Object.entries(ETAPA_LABEL).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">
            Guardar etapa
          </button>
        </form>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Módulos</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          Estos módulos se muestran u ocultan solos según la etapa de arriba. Si tu cooperativa es un
          caso particular, podés forzarlos acá — nunca se borra nada: un módulo oculto sigue teniendo
          toda su información guardada, sólo desaparece del menú.
        </p>
        <form action={actualizarModulosAction} className="space-y-4">
          {Object.entries(MODULOS_LABEL).map(([mod, label]) => (
            <div key={mod} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-ink">{label}</span>
              <select
                name={mod}
                defaultValue={organizacion?.modulos_override?.[mod] || "auto"}
                className={inputClass + " sm:w-56"}
              >
                <option value="auto">Automático (según la etapa)</option>
                <option value="mostrar">Mostrar siempre</option>
                <option value="ocultar">Ocultar siempre</option>
              </select>
            </div>
          ))}
          <button type="submit" className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">
            Guardar módulos
          </button>
        </form>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Configuración de Email</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          Configura el servidor SMTP para enviar alertas automáticas. Dejalos en blanco para desactivar email.
        </p>
        <form action={guardarConfigEmailAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Host SMTP</Label>
            <input
              type="text"
              name="smtp_host"
              defaultValue={configObj.smtp_host || ""}
              placeholder="ej: smtp.gmail.com"
              className={inputClass}
            />
          </div>
          <div>
            <Label>Puerto</Label>
            <input
              type="number"
              name="smtp_port"
              defaultValue={configObj.smtp_port || "587"}
              className={inputClass}
            />
          </div>
          <div>
            <Label>Usuario (email)</Label>
            <input
              type="email"
              name="smtp_user"
              defaultValue={configObj.smtp_user || ""}
              placeholder="tu@ejemplo.com"
              className={inputClass}
            />
          </div>
          <div>
            <Label>Contraseña</Label>
            <input
              type="password"
              name="smtp_password"
              placeholder="Contraseña o token de app"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Remitente (nombre)</Label>
            <input
              type="text"
              name="email_remitente"
              defaultValue={configObj.email_remitente || "COOVA Sistema"}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Email de destino para alertas críticas</Label>
            <input
              type="email"
              name="email_alertas_criticas"
              defaultValue={configObj.email_alertas_criticas || ""}
              placeholder="admin@tucooperativa.uy"
              className={inputClass}
            />
          </div>
          <button type="submit" className="sm:col-span-2 rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">
            Guardar configuración
          </button>
        </form>
        <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <p className="text-xs text-yellow-800">
            <strong>Para Gmail:</strong> Usa contraseña de aplicación (no la contraseña normal). Activa "Acceso de aplicaciones menos seguras" o genera una contraseña de app en tu cuenta Google.
          </p>
        </div>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Alertas por Email</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          Configura qué alertas se envían por email automáticamente.
        </p>
        <form action={actualizarAlertasEmailAction} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="tarea_atrasada" defaultChecked={true} />
              Tareas atrasadas
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="documento_vencido" defaultChecked={true} />
              Documentos vencidos
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="dinero_bajo" defaultChecked={true} />
              Saldo bajo
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="problema_critico" defaultChecked={true} />
              Problemas críticos
            </label>
          </div>
          <button type="submit" className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">
            Actualizar preferencias
          </button>
        </form>
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Info del sistema</h3>
      <Card>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink/60">Versión:</span>
            <span className="font-semibold">MVP 1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink/60">Base de datos:</span>
            <span className="font-semibold">PostgreSQL (Supabase)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink/60">Usuarios activos:</span>
            <span className="font-semibold">{usuariosActivos}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink/60">Email configurado:</span>
            <Badge color={configObj.smtp_host ? "verde" : "amarillo"}>
              {configObj.smtp_host ? "Sí" : "No"}
            </Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}
