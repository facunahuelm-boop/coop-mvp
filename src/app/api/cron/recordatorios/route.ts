import { NextRequest, NextResponse } from "next/server";
import dayjs from "dayjs";
import { all, rootAll, update } from "@/lib/db";
import { setOrgContext } from "@/lib/tenant";
import { enviarEmailRecordatorioActividad } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rediseño del Calendario, Etapa 5 (26/09) — la única etapa que quedaba del
// pedido original de 32 puntos. Dispara los recordatorios de actividades del
// calendario que hasta ahora sólo se guardaban como preferencia (campo
// `recordatorio`, ver migración 0042) sin ningún disparo real.
//
// Decisiones confirmadas con el usuario antes de escribir este código (ver
// migración 0045 para el detalle completo):
//   1) Cron 1 vez al día (plan Hobby de Vercel) en vez de cada pocos minutos
//      (Pro) — se pierde la precisión de las 6 opciones de "recordatorio"
//      (5min/15min/30min/1hora/1día antes): este cron avisa de TODAS las
//      actividades de "hoy" que tengan cualquier opción distinta de
//      "ninguno", sin distinguir cuál.
//   2) Destinatarios: autor + responsable + participantes (esMia, Etapa 4).
//   3) Canal: sólo email (`enviarEmailRecordatorioActividad`, src/lib/email.ts).
//
// Horario elegido para el cron (ver vercel.json): 11:00 UTC = 08:00 en
// Montevideo (UTC-3 todo el año, sin horario de verano desde 2015) — con ese
// horario, la fecha del servidor en UTC (`dayjs().format("YYYY-MM-DD")`)
// siempre coincide con la fecha real en Montevideo (el desfase sólo importa
// entre las 00:00 y las 03:00 UTC, mucho antes de que corra este cron).
//
// Autenticación: igual que Vercel documenta para Cron Jobs, si existe la
// variable de entorno CRON_SECRET, Vercel manda automáticamente
// "Authorization: Bearer <CRON_SECRET>" en cada invocación programada — acá
// se exige ese header. Se acepta también `?key=` por query string (mismo
// criterio que ya usa /api/setup) sólo para poder probarlo a mano desde el
// navegador durante la verificación en vivo.
function autorizado(req: NextRequest): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secreto}`) return true;
  const key = req.nextUrl.searchParams.get("key");
  return key === secreto;
}

type ActividadPendiente = {
  id: number;
  titulo: string;
  fecha: string;
  hora: string | null;
  ubicacion: string | null;
  autor_id: number;
  responsable_id: number | null;
};

type Participante = { nota_id: number; usuario_id: number };

type Destinatario = { id: number; nombre: string; email: string };

export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const hoy = dayjs().format("YYYY-MM-DD");
  const resumen: {
    organizacion_id: number;
    actividades: number;
    emails_enviados: number;
    emails_fallidos: number;
    errores?: string[];
  }[] = [];

  const organizaciones = await rootAll<{ id: number }>(`SELECT id FROM organizations WHERE activo = 1`);

  for (const org of organizaciones) {
    setOrgContext(org.id);
    let emailsEnviados = 0;
    let emailsFallidos = 0;
    const errores: string[] = [];

    let actividades: ActividadPendiente[] = [];
    try {
      actividades = await all<ActividadPendiente>(
        `SELECT id, titulo, fecha, hora, ubicacion, autor_id, responsable_id
         FROM notas_calendario
         WHERE fecha = ? AND recordatorio IS NOT NULL AND recordatorio != 'ninguno' AND recordatorio_enviado_en IS NULL`,
        [hoy]
      );
    } catch (err) {
      // No debe frenar el resto de las cooperativas por una tabla/columna
      // todavía sin migrar en alguna de ellas (mismo criterio defensivo que
      // el resto del proyecto, ver relanzarConMensajeSiFaltaTabla).
      console.error(`[cron/recordatorios] org ${org.id}: no se pudo leer notas_calendario:`, err);
      continue;
    }

    if (actividades.length === 0) {
      resumen.push({ organizacion_id: org.id, actividades: 0, emails_enviados: 0, emails_fallidos: 0 });
      continue;
    }

    const participantesRaw = await all<Participante>(
      `SELECT nota_id, usuario_id FROM actividad_participantes WHERE nota_id = ANY(?::int[])`,
      [actividades.map((a) => a.id)]
    ).catch(() => [] as Participante[]);
    const participantesPorNota = new Map<number, number[]>();
    for (const p of participantesRaw) {
      const arr = participantesPorNota.get(p.nota_id) || [];
      arr.push(p.usuario_id);
      participantesPorNota.set(p.nota_id, arr);
    }

    for (const actividad of actividades) {
      const idsDestinatarios = Array.from(
        new Set(
          [actividad.autor_id, actividad.responsable_id, ...(participantesPorNota.get(actividad.id) ?? [])].filter(
            (id): id is number => id != null
          )
        )
      );

      const destinatarios = await all<Destinatario>(
        `SELECT id, nombre, email FROM users WHERE id = ANY(?::int[]) AND activo = 1 AND TRIM(email) != ''`,
        [idsDestinatarios]
      ).catch(() => [] as Destinatario[]);

      for (const destinatario of destinatarios) {
        const resultado = await enviarEmailRecordatorioActividad(destinatario.email, destinatario.nombre, {
          titulo: actividad.titulo,
          fecha: actividad.fecha,
          hora: actividad.hora,
          ubicacion: actividad.ubicacion,
        });
        if (resultado.ok) emailsEnviados++;
        else {
          emailsFallidos++;
          if (resultado.error && errores.length < 5) errores.push(resultado.error);
        }
      }

      // Se marca como procesada aunque no hubiera ningún destinatario con
      // email, o el SMTP no esté configurado — evita que la cooperativa que
      // nunca cargó su configuración de email reintente esta misma
      // actividad todos los días sin ningún cambio posible.
      await update("notas_calendario", actividad.id, { recordatorio_enviado_en: new Date().toISOString() });
    }

    resumen.push({
      organizacion_id: org.id,
      actividades: actividades.length,
      emails_enviados: emailsEnviados,
      emails_fallidos: emailsFallidos,
      ...(errores.length > 0 ? { errores } : {}),
    });
  }

  return NextResponse.json({ ok: true, fecha: hoy, organizaciones: resumen });
}
