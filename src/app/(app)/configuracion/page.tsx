import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, rootGet } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import {
  BrandingForm,
  EtapaForm,
  ModulosForm,
  ConfigEmailForm,
  AlertasEmailForm,
} from "@/components/configuracion/ConfiguracionFormularios";

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
        <BrandingForm organizacion={organizacion} />
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Etapa</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          La etapa de la cooperativa personaliza el menú: en "Habitada" se oculta automáticamente
          el grupo Obra (Obra, Trabajo y Seguridad), porque deja de ser relevante una vez terminada
          la construcción.
        </p>
        <EtapaForm etapaActual={organizacion?.etapa || "obra"} />
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Módulos</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          Estos módulos se muestran u ocultan solos según la etapa de arriba. Si tu cooperativa es un
          caso particular, podés forzarlos acá — nunca se borra nada: un módulo oculto sigue teniendo
          toda su información guardada, sólo desaparece del menú.
        </p>
        <ModulosForm overrides={organizacion?.modulos_override} />
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Configuración de Email</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          Configura el servidor SMTP para enviar alertas automáticas. Dejalos en blanco para desactivar email.
        </p>
        <ConfigEmailForm configObj={configObj} />
      </Card>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-3">Alertas por Email</h3>
      <Card className="mb-6">
        <p className="text-xs text-ink/60 mb-4">
          Configura qué alertas se envían por email automáticamente.
        </p>
        <AlertasEmailForm />
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
