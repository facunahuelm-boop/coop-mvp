import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, Label, inputClass, EmptyState } from "@/components/ui";
import { enviarMailAction } from "@/lib/actions/mails";
import dayjs from "dayjs";

// Sección de Mails (pedido explícito): mandarle un mail por email a un
// usuario puntual o a todos los integrantes de una comisión, sin tener que
// escribirle a cada uno por separado ni salir del sistema. Usa la
// configuración SMTP que ya existe en Configuración → Configuración de
// Email — si todavía no está cargada, enviarMailAction avisa con un mensaje
// claro en vez de fallar en silencio.
//
// El formulario muestra los dos selectores (usuario / comisión) uno debajo
// del otro, sin ningún selector con JavaScript — mismo criterio "elegí uno
// de los dos" que ya usa Compras con proveedor_id/nuevo_proveedor.

export default async function MailsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [usuarios, comisiones, historial] = await Promise.all([
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 AND id != ? ORDER BY nombre ASC`, [user.id]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    all<any>(
      `SELECT m.*, u.nombre as remitente_nombre FROM mensajes_correo m LEFT JOIN users u ON u.id = m.remitente_id ORDER BY m.creado_en DESC LIMIT 30`
    ),
  ]);

  return (
    <div>
      <PageHeader title="Mails" subtitle="Mandale un mensaje a una persona o a toda una comisión de una sola vez" />

      <Card>
        <form action={enviarMailAction} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>A un usuario</Label>
              <select name="usuario_id" defaultValue="" className={inputClass}>
                <option value="">— No enviar a un usuario —</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>...o a una comisión completa</Label>
              <select name="comision_id" defaultValue="" className={inputClass}>
                <option value="">— No enviar a una comisión —</option>
                {comisiones.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-faint">Elegí uno de los dos: un usuario puntual, o una comisión (le llega a todos sus integrantes juntos).</p>

          <div>
            <Label>Asunto</Label>
            <input name="asunto" required maxLength={200} placeholder="Ej: Reunión del sábado" className={inputClass} />
          </div>
          <div>
            <Label>Mensaje</Label>
            <textarea name="cuerpo" required maxLength={5000} rows={5} placeholder="Escribí el mensaje acá..." className={inputClass} />
          </div>

          <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 text-sm font-semibold">Enviar mail</button>
        </form>
      </Card>

      <div className="mt-6">
        <h2 className="text-base sm:text-lg font-semibold text-ink mb-3">Mails enviados</h2>
        {historial.length === 0 ? (
          <EmptyState>Todavía no se mandó ningún mail.</EmptyState>
        ) : (
          <div className="space-y-2">
            {historial.map((m: any) => (
              <Card key={m.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{m.asunto}</p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Para: {m.destinatario_nombre}
                      {m.cantidad_destinatarios > 1 ? ` (${m.cantidad_destinatarios} personas)` : ""}
                    </p>
                    <p className="text-xs text-ink-faint mt-1 whitespace-pre-wrap line-clamp-3">{m.cuerpo}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-ink-faint">{dayjs(m.creado_en).format("DD/MM/YYYY HH:mm")}</p>
                    <p className="text-xs text-ink-faint">{m.remitente_nombre || "—"}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
