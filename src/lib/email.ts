import nodemailer from "nodemailer";
import { all, insert } from "./db";
import { descifrar } from "./crypto";

// Resultado real de un intento de envío — nunca "entregado": con SMTP común
// solo se puede confirmar que el servidor aceptó el mensaje para enviarlo,
// no que llegó a la casilla del destinatario (ver migrations/0021).
export type ResultadoEnvio = { ok: boolean; error?: string; aceptados?: string[]; rechazados?: string[] };

type ConfigEmail = Record<string, string>;

async function getConfigEmail(): Promise<ConfigEmail> {
  const rows = await all<{ clave: string; valor: string }>(`SELECT clave, valor FROM config_email`);
  const cfg = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  // La contraseña SMTP se guarda cifrada (ver actions/configuracion.ts,
  // guardarConfigEmailAction, y lib/crypto.ts) — acá es el único lugar que
  // necesita el valor real, para autenticarse contra el servidor de correo.
  if (cfg.smtp_password) cfg.smtp_password = descifrar(cfg.smtp_password);
  return cfg;
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

/**
 * Fase 9 del Prompt Maestro (H-12): antes, `enviarEmailAlerta` y
 * `enviarEmailPersonalizado` armaban y mandaban el mail cada una por su
 * cuenta — mismo `<div>` con la tarjeta de color, mismo try/catch alrededor
 * de `sendMail` para convertir el resultado en `ResultadoEnvio`, todo
 * duplicado dos veces. Ahora ese armado y envío vive en un solo lugar
 * (`plantillaHtml` + `enviarEmailBase`), y cada función pública de más abajo
 * solo arma el contenido específico de su caso (asunto, destinatarios,
 * texto) y se lo pasa. Nuevos usos de email desde otros módulos del sistema
 * pueden sumarse acá mismo, con su propia función pública que llame a
 * `enviarEmailBase` — sin volver a duplicar la tarjeta HTML ni el manejo de
 * errores.
 */
function plantillaHtml({
  tituloTarjeta,
  colorTarjeta = "#123240",
  cuerpoHtml,
  piePagina,
}: {
  tituloTarjeta: string;
  colorTarjeta?: string;
  cuerpoHtml: string;
  piePagina?: string;
}): string {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto;">
      <div style="background:${colorTarjeta};color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:13px;letter-spacing:.03em;text-transform:uppercase;">
        ${escapeHtml(tituloTarjeta)}
      </div>
      <div style="border:1px solid #e5e5e5;border-top:none;padding:18px;border-radius:0 0 10px 10px;">
        ${cuerpoHtml}
        ${piePagina ? `<p style="margin:0;font-size:11px;color:#999;">${escapeHtml(piePagina)}</p>` : ""}
      </div>
    </div>
  `;
}

async function enviarEmailBase(
  cfg: ConfigEmail,
  args: {
    to: string;
    bcc?: string;
    subject: string;
    textoPlano: string;
    tituloTarjeta: string;
    colorTarjeta?: string;
    cuerpoHtml: string;
    piePagina?: string;
  }
): Promise<ResultadoEnvio> {
  const transporter = getTransporter(cfg);
  const remitenteNombre = cfg.email_remitente || "COOVA Sistema";
  try {
    const info = await transporter.sendMail({
      from: `"${remitenteNombre}" <${cfg.smtp_user}>`,
      to: args.to,
      bcc: args.bcc,
      subject: args.subject,
      text: args.textoPlano,
      html: plantillaHtml(args),
    });
    return { ok: true, aceptados: (info.accepted || []).map(String), rechazados: (info.rejected || []).map(String) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
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

    const resultado = await enviarEmailBase(cfg, {
      to: cfg.email_alertas_criticas,
      subject: `🔴 COOVA — ${alerta.titulo}`,
      textoPlano: `${alerta.titulo}\n\n${alerta.descripcion || ""}\n\nMódulo: ${alerta.origen_modulo}`,
      tituloTarjeta: "COOVA — Alerta crítica",
      cuerpoHtml: `
        <p style="margin:0 0 8px;font-size:15px;font-weight:bold;color:#123240;">${escapeHtml(alerta.titulo)}</p>
        ${alerta.descripcion ? `<p style="margin:0 0 14px;font-size:13px;color:#555;line-height:1.5;">${escapeHtml(alerta.descripcion)}</p>` : ""}
      `,
      piePagina: `Módulo: ${alerta.origen_modulo}`,
    });

    // Registrar SIEMPRE el intento (antes no quedaba ningún rastro de los
    // emails de alertas automáticas, ni siquiera cuando salían bien) — ver
    // migrations/0021_mensajes_correo_estado.sql.
    await insert("mensajes_correo", {
      remitente_id: null,
      destinatario_tipo: "alerta",
      destinatario_id: null,
      destinatario_nombre: cfg.email_alertas_criticas,
      asunto: `🔴 ${alerta.titulo}`,
      cuerpo: alerta.descripcion || "",
      cantidad_destinatarios: 1,
      destinatarios: [{ nombre: "Alertas críticas", email: cfg.email_alertas_criticas }],
      estado: resultado.ok ? "enviado" : "fallido",
      error: resultado.error || null,
      origen: "alerta",
    }).catch((errLog) => {
      // Si esta tabla no existe todavía (migración 0014/0021 sin correr), no
      // debe romper el envío de alertas — mismo criterio defensivo del resto
      // del sistema.
      console.error("[email] No se pudo registrar el email de alerta en el historial:", errLog);
    });

    if (!resultado.ok) console.error("[email] No se pudo enviar el email de alerta:", resultado.error);
  } catch (err) {
    console.error("[email] No se pudo enviar el email de alerta:", err);
  }
}

/**
 * Envía un mail "a mano" — la persona que lo escribe elige el destinatario
 * (un usuario puntual o todos los integrantes de una comisión, ver
 * actions/mails.ts) — a diferencia de enviarEmailAlerta, que dispara solo el
 * motor de alertas. Usa la misma configuración SMTP de Configuración →
 * Configuración de Email; si todavía no está cargada, tira un error claro
 * en vez de fallar en silencio, porque acá sí hay alguien esperando una
 * confirmación de que el mail salió.
 *
 * Los destinatarios reales van en CCO (bcc): así cada persona recibe el
 * mensaje sin ver los emails de las demás. El campo "Para" queda con la
 * casilla configurada de la cooperativa, para que el mail siempre tenga un
 * destinatario visible aunque todo lo demás vaya en copia oculta.
 */
export async function enviarEmailPersonalizado(
  destinatarios: string[],
  asunto: string,
  cuerpo: string,
  deParte: string
): Promise<ResultadoEnvio> {
  const cfg = await getConfigEmail();
  if (!cfg.smtp_host || !cfg.smtp_user) {
    throw new Error('Todavía no se configuró el envío de emails — cargalo en Configuración → Configuración de Email.');
  }

  // A diferencia de antes, ya no se deja que una falla de SMTP tire una
  // excepción sin más: se devuelve un resultado real (ok/aceptados/error)
  // para que quien llama pueda registrar el intento en el historial aunque
  // haya fallado (ver migrations/0021 y actions/mails.ts).
  return enviarEmailBase(cfg, {
    to: cfg.smtp_user,
    bcc: destinatarios.join(","),
    subject: asunto,
    textoPlano: `${cuerpo}\n\n— Enviado por ${deParte} desde COOVA`,
    tituloTarjeta: "COOVA — Mensaje interno",
    cuerpoHtml: `<p style="margin:0 0 14px;font-size:13px;color:#333;line-height:1.6;white-space:pre-wrap;">${escapeHtml(cuerpo)}</p>`,
    piePagina: `Enviado por ${deParte}`,
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
