import nodemailer from "nodemailer";
import { all } from "./db";

type ConfigEmail = Record<string, string>;

async function getConfigEmail(): Promise<ConfigEmail> {
  const rows = await all<{ clave: string; valor: string }>(`SELECT clave, valor FROM config_email`);
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
}

// La pantalla de Configuración solo deja elegir 4 categorías amplias de alertas;
// acá se mapean los tipos específicos del motor de alertas a esas 4 categorías.
const CATEGORIA_POR_TIPO: Record<string, string> = {
  documento_vencido: "documento_vencido",
  documento_por_vencer: "documento_vencido",
  tarea_atrasada: "tarea_atrasada",
  tarea_jornada_sin_cubrir: "tarea_atrasada",
  disponible_negativo: "dinero_bajo",
  disponible_bajo: "dinero_bajo",
  desvio_presupuesto: "dinero_bajo",
  problema_critico: "problema_critico",
  riesgo_critico: "problema_critico",
  compra_pendiente_critica: "problema_critico",
};

async function categoriaHabilitada(tipo: string): Promise<boolean> {
  const categoria = CATEGORIA_POR_TIPO[tipo];
  if (!categoria) return true;
  const rows = await all<{ habilitada: number }>(
    `SELECT habilitada FROM alertas_email WHERE tipo_alerta = ? LIMIT 1`,
    [categoria]
  );
  if (rows.length === 0) return true; // sin preferencia guardada todavía: se envía por defecto
  return !!rows[0].habilitada;
}

let transporterCache: { key: string; transporter: nodemailer.Transporter } | null = null;

function getTransporter(cfg: ConfigEmail) {
  const key = `${cfg.smtp_host}:${cfg.smtp_port}:${cfg.smtp_user}`;
  if (transporterCache && transporterCache.key === key) return transporterCache.transporter;
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port) || 587,
    secure: Number(cfg.smtp_port) === 465,
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_password } : undefined,
  });
  transporterCache = { key, transporter };
  return transporter;
}

type AlertaParaEmail = {
  tipo: string;
  severidad: string;
  titulo: string;
  descripcion?: string | null;
  origen_modulo: string;
};

/**
 * Envía por email las alertas críticas nuevas, usando la configuración SMTP
 * cargada en Configuración > Configuración de Email. Si no hay SMTP configurado,
 * o la categoría de alerta está desactivada, no hace nada (no rompe el flujo
 * principal de la app bajo ningún escenario: cualquier error queda en el log).
 */
export async function enviarEmailAlerta(alerta: AlertaParaEmail): Promise<void> {
  try {
    if (alerta.severidad !== "critica") return;

    const cfg = await getConfigEmail();
    if (!cfg.smtp_host || !cfg.smtp_user || !cfg.email_alertas_criticas) return;

    const habilitada = await categoriaHabilitada(alerta.tipo);
    if (!habilitada) return;

    const transporter = getTransporter(cfg);
    const remitenteNombre = cfg.email_remitente || "UFAMA Sistema";

    await transporter.sendMail({
      from: `"${remitenteNombre}" <${cfg.smtp_user}>`,
      to: cfg.email_alertas_criticas,
      subject: `🔴 UFAMA — ${alerta.titulo}`,
      text: `${alerta.titulo}\n\n${alerta.descripcion || ""}\n\nMódulo: ${alerta.origen_modulo}`,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background:#123240;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:13px;letter-spacing:.03em;text-transform:uppercase;">
            UFAMA — Alerta crítica
          </div>
          <div style="border:1px solid #e5e5e5;border-top:none;padding:18px;border-radius:0 0 10px 10px;">
            <p style="margin:0 0 8px;font-size:15px;font-weight:bold;color:#123240;">${escapeHtml(alerta.titulo)}</p>
            ${alerta.descripcion ? `<p style="margin:0 0 14px;font-size:13px;color:#555;line-height:1.5;">${escapeHtml(alerta.descripcion)}</p>` : ""}
            <p style="margin:0;font-size:11px;color:#999;">Módulo: ${escapeHtml(alerta.origen_modulo)}</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("[email] No se pudo enviar el email de alerta:", err);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
