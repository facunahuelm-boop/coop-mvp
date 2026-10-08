"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { get, all, insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseForm, zId } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { codigoQrValido, horaEnUruguay, TOLERANCIA_MIN } from "@/lib/qrObra";
import { hoyEnUruguay, lunesDe, calcularTramo, aMinutos, aHora, textoHoras } from "@/lib/horasObra";
import { obtenerHorarioObra } from "@/lib/horasTrabajo";
import { nucleoDelUsuario, semanaCerrada } from "@/lib/libretaHoras";
import { turno, guardarAsistencia } from "@/lib/asistenciaRegistro";

/**
 * Fase 3A — el socio escanea el QR del día en la obra y marca "Llegué" y
 * "Me voy". Con la salida se completa la asistencia de su turno (si el
 * coordinador ya la había marcado, no se pisa). Sin turno, la fichada queda
 * para que el coordinador la confirme.
 */

const schema = z.object({ codigo: z.string().min(8).max(40), tipo: z.enum(["llegada", "salida"]) });

export type Fichada = { id: number; tipo: string; hora: string };

export async function ficharAction(formData: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(schema, formData);
  if (!codigoQrValido(user.organization_id, d.codigo)) {
    throw new Error("Este QR no es el de hoy. Pedile al coordinador que te muestre el QR del día.");
  }
  const nucleoId = await nucleoDelUsuario(user.id, user.nucleo_id);
  if (!nucleoId) throw new Error("Tu usuario no está vinculado a un núcleo. Pedile a la administración que lo vincule.");
  const fecha = hoyEnUruguay();
  // Sólo en el entorno de pruebas aislado (nunca en producción) se puede simular la hora.
  const horaPrueba = String(formData.get("hora_prueba") || "");
  const hora = process.env.CRON_PERMITIR_FECHA === "1" && /^([01]\d|2[0-3]):[0-5]\d$/.test(horaPrueba) ? horaPrueba : horaEnUruguay();
  const hoy = await all<Fichada>(`SELECT id, tipo, hora FROM fichadas_obra WHERE nucleo_id = ? AND fecha = ? ORDER BY id`, [nucleoId, fecha]);
  const ultima = hoy[hoy.length - 1];
  if (d.tipo === "llegada" && ultima?.tipo === "llegada") throw new Error(`Ya marcaste tu llegada a las ${ultima.hora}.`);
  if (d.tipo === "salida" && ultima?.tipo !== "llegada") throw new Error("Primero marcá tu llegada.");

  // Turno de hoy del núcleo (el que corresponde a esta hora, o el primero del día).
  const turnos = await all<{ id: number; hora_inicio: string; hora_fin: string }>(
    `SELECT id, hora_inicio, hora_fin FROM asignaciones_horas WHERE nucleo_id = ? AND fecha = ? AND estado = 'activa' ORDER BY hora_inicio`,
    [nucleoId, fecha]
  ).catch(() => []);
  const ahora = aMinutos(hora);
  const elegido =
    turnos.find((t) => ahora >= aMinutos(t.hora_inicio) - 60 && ahora <= aMinutos(t.hora_fin) + 60) ?? turnos[0] ?? null;

  const id = await insert("fichadas_obra", { user_id: user.id, nucleo_id: nucleoId, fecha, tipo: d.tipo, hora, asignacion_id: elegido?.id ?? null });
  let mensaje = d.tipo === "llegada" ? `Listo: llegaste a las ${hora}.` : `Listo: te fuiste a las ${hora}.`;

  if (d.tipo === "salida" && ultima) {
    const horario = await obtenerHorarioObra();
    // Lo que se cuenta es lo trabajado dentro del turno (o del horario de obra si no tenía turno).
    const recortar = (h: string, desde: string, hasta: string) => aHora(Math.min(Math.max(aMinutos(h), aMinutos(desde)), aMinutos(hasta)));
    const tramo = elegido
      ? calcularTramo(recortar(ultima.hora, elegido.hora_inicio, elegido.hora_fin), recortar(hora, elegido.hora_inicio, elegido.hora_fin), horario)
      : calcularTramo(recortar(ultima.hora, horario.inicio, horario.fin), recortar(hora, horario.inicio, horario.fin), horario);
    if (elegido && !(await semanaCerrada(lunesDe(fecha)))) {
      const yaMarcada = await get<{ origen: string }>(`SELECT origen FROM asistencias_horas WHERE asignacion_id = ? AND anulado_en IS NULL`, [elegido.id]);
      if (yaMarcada && yaMarcada.origen !== "qr") {
        mensaje += " El coordinador ya había registrado tu asistencia.";
      } else if (!tramo.error) {
        const t = await turno(elegido.id);
        const tarde = aMinutos(ultima.hora) > aMinutos(t.hora_inicio) + TOLERANCIA_MIN;
        const antes = aMinutos(hora) < aMinutos(t.hora_fin) - TOLERANCIA_MIN;
        const estado = tarde ? "tarde" : antes ? "retiro_anticipado" : "presente";
        const minutos = estado === "presente" ? t.minutos : Math.min(tramo.minutos, t.minutos);
        await guardarAsistencia({
          t,
          comisionId: t.comision_id ?? null,
          estado,
          minutosReales: minutos,
          horaInicio: ultima.hora,
          horaFin: hora,
          observaciones: "Marcado por QR",
          origen: "qr",
          usuarioId: user.id,
        });
        const asis = await get<{ id: number }>(`SELECT id FROM asistencias_horas WHERE asignacion_id = ? AND anulado_en IS NULL`, [t.id]);
        if (asis) await update("fichadas_obra", id, { asistencia_id: asis.id });
        mensaje += ` Se anotaron ${textoHoras(minutos)} en tu libreta.`;
      }
    } else if (!elegido) {
      mensaje += ` No tenías turno hoy: el coordinador va a confirmar tus ${tramo.error ? "horas" : textoHoras(tramo.minutos)}.`;
    }
  }
  await audit({ usuario_id: user.id, accion: d.tipo === "llegada" ? "fichar_llegada" : "fichar_salida", entidad: "fichadas_obra", entidad_id: id, valor_nuevo: { hora, turno: elegido?.id ?? null } });
  revalidatePath("/mis-horas");
  revalidatePath("/qr-obra");
  return mensaje;
}

export async function ficharFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await ficharAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

/** El coordinador da por revisada una fichada sin turno (después de registrar las horas o si no corresponde). */
export async function revisarFichadaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(async () => {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const { puedeOrganizarHoras } = await import("@/lib/fichadasPermisos");
    if (!(await puedeOrganizarHoras(user))) throw new Error("No tenés permiso para revisar las fichadas.");
    await update("fichadas_obra", id, { revisada_en: new Date().toISOString(), revisada_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "revisar_fichada", entidad: "fichadas_obra", entidad_id: id });
    revalidatePath("/qr-obra");
  });
}
