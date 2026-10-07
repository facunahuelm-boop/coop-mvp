import { all, get, insert, update } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { crearNotificacionesParaUsuarios } from "@/lib/notificaciones";
import { ITEMS_INGRESO, type EstadoSocio } from "@/lib/sociosEstados";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Fase 2C — alta de un socio (no es una Server Action: la llaman acciones que
 * ya validaron permisos). Núcleo como entidad central: cada socio titular
 * tiene su núcleo (para horas, cuotas y código de pago). A23: el alta abre
 * el checklist de ingreso y avisa a quien lo acompaña.
 */
export async function darDeAltaSocio(
  user: SessionUser,
  datos: {
    nombre: string;
    documento?: string | null;
    email?: string | null;
    telefono?: string | null;
    vivienda_id?: number | null;
    nucleo_id?: number | null;
    fecha_ingreso?: string | null;
    notas?: string | null;
    estado?: EstadoSocio;
  },
  motivo = "Alta en el padrón"
): Promise<number> {
  const estado = datos.estado ?? "activo";
  const fechaIngreso = datos.fecha_ingreso || (estado === "aspirante" ? null : hoyEnUruguay());
  let nucleoId = datos.nucleo_id ?? null;
  if (!nucleoId) nucleoId = await insert("nucleos_familiares", { nombre: `Núcleo ${datos.nombre}`.slice(0, 200) });
  const socioId = await insert("socios", {
    nombre: datos.nombre,
    documento: datos.documento ?? null,
    email: datos.email ?? null,
    telefono: datos.telefono ?? null,
    vivienda_id: datos.vivienda_id ?? null,
    nucleo_id: nucleoId,
    fecha_ingreso: fechaIngreso,
    notas: datos.notas ?? null,
    estado,
  });
  await registrarCambioEstado(socioId, null, estado, fechaIngreso ?? hoyEnUruguay(), motivo, user.id);
  await abrirChecklistIngreso(socioId);
  // A23: aviso a administración y al Consejo.
  const destinatarios = await all<{ id: number }>(
    `SELECT id FROM users WHERE rol IN ('administracion', 'consejo_directivo', 'admin') AND activo = 1 AND id <> ?`,
    [user.id]
  ).catch(() => []);
  await crearNotificacionesParaUsuarios(
    destinatarios.map((d) => d.id),
    { tipo: "socio_nuevo", titulo: `Nuevo socio: ${datos.nombre}. Falta completar su ingreso.`, ref_tabla: "socios", ref_id: socioId }
  ).catch(() => {});
  return socioId;
}

export async function registrarCambioEstado(
  socioId: number,
  anterior: string | null,
  nuevo: string,
  fecha: string,
  motivo: string | null,
  usuarioId: number | null
) {
  await insert("socio_estados", { socio_id: socioId, estado_anterior: anterior, estado_nuevo: nuevo, fecha, motivo, registrado_por_id: usuarioId }).catch((err) => {
    if (!["42P01", "42703"].includes((err as { code?: string })?.code ?? "")) throw err;
  });
}

export async function abrirChecklistIngreso(socioId: number) {
  for (const it of ITEMS_INGRESO) {
    const ya = await get<{ id: number }>(`SELECT id FROM checklist_ingreso WHERE socio_id = ? AND item = ?`, [socioId, it.clave]).catch(() => ({ id: -1 }));
    if (!ya) await insert("checklist_ingreso", { socio_id: socioId, item: it.clave }).catch(() => {});
  }
}

export type PasoIngreso = { clave: string; titulo: string; ayuda: string; hecho: boolean; automatico: boolean; hecho_en: string | null; quien: string | null };

/** Estado del checklist de ingreso de un socio (null si no tiene: socios de antes de la Fase 2C). */
export async function checklistDeIngreso(socioId: number): Promise<PasoIngreso[] | null> {
  const filas = await all<{ item: string; hecho: number; hecho_en: string | null; quien: string | null }>(
    `SELECT c.item, c.hecho, c.hecho_en, u.nombre AS quien FROM checklist_ingreso c LEFT JOIN users u ON u.id = c.hecho_por_id WHERE c.socio_id = ?`,
    [socioId]
  ).catch(() => []);
  if (!filas.length) return null;
  const socio = await get<{ nucleo_id: number | null; user_id: number | null }>(`SELECT nucleo_id, user_id FROM socios WHERE id = ?`, [socioId]);
  const [integrantes, documentos] = await Promise.all([
    get<{ n: string }>(`SELECT COUNT(*) AS n FROM socio_integrantes WHERE socio_id = ?`, [socioId]).catch(() => ({ n: "0" })),
    get<{ n: string }>(`SELECT COUNT(*) AS n FROM documentos WHERE socio_id = ?`, [socioId]).catch(() => ({ n: "0" })),
  ]);
  const auto: Record<string, boolean> = {
    nucleo: !!socio?.nucleo_id && Number(integrantes?.n || 0) > 0,
    usuario: !!socio?.user_id,
    documentos: Number(documentos?.n || 0) > 0,
  };
  const porItem = new Map(filas.map((f) => [f.item, f]));
  return ITEMS_INGRESO.map((it) => {
    const f = porItem.get(it.clave);
    const automatico = it.auto ? auto[it.auto] : false;
    return {
      clave: it.clave,
      titulo: it.titulo,
      ayuda: it.ayuda,
      hecho: automatico || !!f?.hecho,
      automatico,
      hecho_en: f?.hecho_en ?? null,
      quien: f?.quien ?? null,
    };
  });
}

/** Si todos los pasos están hechos, marca el ingreso como completo. */
export async function revisarIngresoCompleto(socioId: number): Promise<boolean> {
  const pasos = await checklistDeIngreso(socioId);
  if (!pasos) return false;
  const completo = pasos.every((p) => p.hecho);
  await update("socios", socioId, { ingreso_completo_en: completo ? new Date().toISOString() : null }).catch(() => {});
  return completo;
}
