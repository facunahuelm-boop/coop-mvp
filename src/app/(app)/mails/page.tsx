import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Card, PageHeader, Label, inputClass, EmptyState, Badge } from "@/components/ui";
import { enviarMailAction } from "@/lib/actions/mails";
import dayjs from "dayjs";
import { Mail, Send, Users, User } from "lucide-react";

// Sección de Mails (pedido explícito): mandarle un mail por email a un
// usuario puntual, a toda una comisión, o (Admin/Consejo Directivo) a todos
// los usuarios de la cooperativa, sin tener que escribirle a cada uno por
// separado ni salir del sistema. Usa la configuración SMTP que ya existe en
// Configuración → Configuración de Email — si todavía no está cargada,
// enviarMailAction avisa con un mensaje claro en vez de fallar en silencio.
//
// El diseño se pensó parecido a un mail "de verdad" (una bandeja con lo
// enviado, asunto en negrita, quién y cuándo, y el mensaje completo al
// abrirlo) pero corriendo enteramente adentro del sistema — no hace falta
// salir a Gmail/Outlook para ver qué se mandó.

export default async function MailsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const puedeATodos = user.rol === "admin" || user.rol === "consejo_directivo";

  const [usuarios, comisiones] = await Promise.all([
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 AND id != ? ORDER BY nombre ASC`, [user.id]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
  ]);

  // El historial vive en una tabla nueva (migrations/0014 y 0016) — si
  // todavía no se corrió esa migración en esta cooperativa, la pantalla no
  // se rompe: el formulario de arriba sigue funcionando (los mails salen
  // igual), solo no hay historial para mostrar todavía.
  let historial: any[] = [];
  let historialDisponible = true;
  try {
    historial = await all<any>(
      `SELECT m.*, u.nombre as remitente_nombre FROM mensajes_correo m LEFT JOIN users u ON u.id = m.remitente_id ORDER BY m.creado_en DESC LIMIT 50`
    );
  } catch {
    historialDisponible = false;
  }

  return (
    <div>
      <PageHeader title="Mails" subtitle="Mandale un mensaje a una persona, a una comisión, o a toda la cooperativa" />

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Send size={16} className="text-[var(--color-brand-800)]" />
          <h2 className="text-sm font-bold text-ink">Redactar</h2>
        </div>
        <form action={enviarMailAction} className="space-y-3">
          <div className={`grid grid-cols-1 ${puedeATodos ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}>
            <div>
              <Label>
                <span className="inline-flex items-center gap-1"><User size={12} /> A un usuario</span>
              </Label>
              <select name="usuario_id" defaultValue="" className={inputClass}>
                <option value="">— Elegir —</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>
                <span className="inline-flex items-center gap-1"><Users size={12} /> ...o a una comisión</span>
              </Label>
              <select name="comision_id" defaultValue="" className={inputClass}>
                <option value="">— Elegir —</option>
                {comisiones.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            {puedeATodos && (
              <div>
                <Label>...o a todos</Label>
                <label className="flex items-center gap-2 rounded-lg border border-ink/10 bg-surface px-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" name="todos" className="h-4 w-4" />
                  Todos los usuarios de la cooperativa
                </label>
              </div>
            )}
          </div>
          <p className="text-xs text-ink-faint">Elegí una sola opción — a quien elijas le llega el mail directo a su casilla.</p>

          <div>
            <Label>Asunto</Label>
            <input name="asunto" required maxLength={200} placeholder="Ej: Reunión del sábado" className={inputClass} />
          </div>
          <div>
            <Label>Mensaje</Label>
            <textarea name="cuerpo" required maxLength={5000} rows={6} placeholder="Escribí el mensaje acá..." className={inputClass} />
          </div>

          <button className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 text-sm font-semibold">
            <Send size={15} /> Enviar mail
          </button>
        </form>
      </Card>

      <div className="mt-6">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={16} className="text-[var(--color-brand-800)]" />
          <h2 className="text-sm sm:text-base font-bold text-ink">Enviados</h2>
        </div>
        <p className="text-[11px] text-ink-faint mb-3">
          &quot;Enviado&quot; significa que el servidor de correo aceptó el mensaje — no hay forma de confirmar,
          con este tipo de configuración, que llegó a la casilla del destinatario. Los envíos automáticos de
          alertas críticas también aparecen acá.
        </p>

        {!historialDisponible ? (
          <EmptyState>El historial todavía no está activado en esta cooperativa — los mails que mandes igual salen bien.</EmptyState>
        ) : historial.length === 0 ? (
          <EmptyState>Todavía no se mandó ningún mail.</EmptyState>
        ) : (
          <div className="divide-y divide-border rounded-2xl border border-border bg-surface overflow-hidden">
            {historial.map((m: any) => {
              const destinatarios: { nombre: string; email: string }[] = Array.isArray(m.destinatarios) ? m.destinatarios : [];
              return (
                <details key={m.id} className="group">
                  <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-3 hover:bg-surface-sunken">
                    <span className="h-8 w-8 rounded-full bg-brand-100 text-[var(--color-brand-800)] text-xs font-bold flex items-center justify-center shrink-0">
                      {(m.remitente_nombre || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink truncate">{m.asunto}</span>
                        <span className="text-xs text-ink-faint shrink-0">
                          → {m.destinatario_nombre}
                          {m.cantidad_destinatarios > 1 ? ` (${m.cantidad_destinatarios})` : ""}
                        </span>
                        {m.estado === "fallido" ? (
                          <Badge color="rojo">Fallido</Badge>
                        ) : (
                          <Badge color="verde">Enviado</Badge>
                        )}
                        {m.origen === "alerta" && <Badge color="gray">Alerta automática</Badge>}
                      </span>
                      <span className="block text-xs text-ink-faint truncate">{m.remitente_nombre || "Sistema (alerta automática)"} · {m.cuerpo}</span>
                    </span>
                    <span className="text-xs text-ink-faint shrink-0">{dayjs(m.creado_en).format("DD/MM/YYYY HH:mm")}</span>
                  </summary>
                  <div className="px-4 pb-4 pt-1 pl-[3.25rem] space-y-2">
                    <p className="text-sm text-ink whitespace-pre-wrap">{m.cuerpo}</p>
                    {m.estado === "fallido" && m.error && (
                      <p className="text-xs text-[var(--color-rojo)] bg-[var(--color-rojo-bg)] rounded-lg px-2.5 py-1.5">Motivo del fallo: {m.error}</p>
                    )}
                    {destinatarios.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {destinatarios.map((d, i) => (
                          <span key={i} className="inline-flex items-center rounded-full bg-ink/5 px-2.5 py-1 text-[11px] text-ink-muted" title={d.email}>
                            {d.nombre}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
