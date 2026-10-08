"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { all, get, insert, update, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import { parseForm, zId, zIdOpcional, zTexto, zEnumSeguro, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { obtenerReglamento } from "@/lib/reglamento";
import { calcularPadron, calcularQuorum, resultadoVotacion, borradorDeActa, revisarAnticipacion, RESULTADO_LABEL, type FilaPadron } from "@/lib/asambleas";
import { crearNotificacionesParaUsuarios } from "@/lib/notificaciones";
import { enviarEmailAvisoSistema, urlBaseApp } from "@/lib/email";
import { generarPdfActa } from "@/lib/asambleasPdf";
import { saveGeneratedFile } from "@/lib/upload";

/**
 * Fase 2D — asamblea formal: convocatoria (A10), padrón habilitado,
 * asistencia y poderes, quórum confirmado por la mesa, votación por punto,
 * acta en borrador → aprobada. Nada se borra.
 */

/** Quién conduce la asamblea: el mismo criterio de "conducción" que ya usa /asambleas. */
async function requireConduccion(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas") && user.rol !== "consejo_directivo") throw new Error("Esto lo hace quien conduce la asamblea (Consejo, secretaría o administración).");
  return user;
}

async function asamblea(id: number) {
  const r = await get<{ id: number; tipo: string; titulo: string; fecha: string; lugar: string | null; estado: string; tipo_asamblea: string | null; fecha_convocatoria: string | null; orden_del_dia: string | null; acta_id: number | null; quorum_confirmado: string | null; convocatoria_enviada_en: string | null }>(
    `SELECT id, tipo, titulo, fecha, lugar, estado, tipo_asamblea, fecha_convocatoria, orden_del_dia, acta_id, quorum_confirmado, convocatoria_enviada_en FROM reuniones WHERE id = ?`,
    [id]
  );
  if (!r || r.tipo !== "asamblea") throw new Error("Esa asamblea no existe.");
  return r;
}

function revalidar(id: number) {
  revalidatePath(`/asambleas/${id}`);
  revalidatePath("/asambleas");
  revalidatePath(`/reuniones/${id}`);
}

async function padronDe(reunionId: number) {
  return all<FilaPadron>(`SELECT id, socio_id, integrante_id, nombre, habilitado, causa, presente, llegada_en, representado_por_id FROM asamblea_padron WHERE reunion_id = ? ORDER BY nombre`, [reunionId]);
}

// ---------- Padrón y convocatoria ----------

export async function calcularPadronAction(formData: FormData) {
  const user = await requireConduccion();
  const { reunion_id } = parseForm(z.object({ reunion_id: zId }), formData);
  const r = await asamblea(reunion_id);
  if (r.estado !== "planificada") throw new Error("La asamblea ya se hizo: el padrón queda como estaba.");
  if (r.quorum_confirmado) throw new Error("La asamblea ya empezó: el padrón no se recalcula.");
  const reglamento = await obtenerReglamento();
  const res = await calcularPadron(reunion_id, reglamento.asambleas, user.id);
  await audit({ usuario_id: user.id, accion: "calcular_padron_asamblea", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: res });
  revalidar(reunion_id);
  return res;
}

/** A10: manda la convocatoria a todos (aviso en COOVA y email a quien tenga). */
export async function enviarConvocatoriaAction(formData: FormData) {
  const user = await requireConduccion();
  const { reunion_id } = parseForm(z.object({ reunion_id: zId }), formData);
  const r = await asamblea(reunion_id);
  if (r.estado !== "planificada") throw new Error("La asamblea ya se hizo.");
  const reglamento = await obtenerReglamento();
  const plazo = revisarAnticipacion(r.tipo_asamblea, r.fecha, r.fecha_convocatoria, reglamento.asambleas);
  if (!plazo.ok && reglamento.asambleas.plazoModo === "bloquear") throw new Error(plazo.mensaje);
  const usuarios = await all<{ id: number; nombre: string; email: string | null }>(`SELECT id, nombre, email FROM users WHERE activo = 1`);
  const dia = r.fecha.slice(0, 10).split("-").reverse().join("/");
  const hora = r.fecha.length > 10 ? r.fecha.slice(11, 16) : "";
  const titulo = `Convocatoria: Asamblea ${r.tipo_asamblea === "extraordinaria" ? "Extraordinaria" : "Ordinaria"} el ${dia}${hora ? ` a las ${hora}` : ""}`;
  const agenda = await all<{ titulo: string }>(`SELECT titulo FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden`, [reunion_id]).catch(() => []);
  const orden = agenda.length ? agenda.map((a, i) => `${i + 1}. ${a.titulo}`).join("\n") : r.orden_del_dia || "";
  await crearNotificacionesParaUsuarios(
    usuarios.map((u) => u.id),
    { tipo: "convocatoria_asamblea", titulo, cuerpo: `${r.lugar ? `Lugar: ${r.lugar}. ` : ""}${orden}`.slice(0, 1000), ref_tabla: "reuniones", ref_id: reunion_id }
  );
  let emails = 0;
  for (const u of usuarios) {
    if (!u.email) continue;
    const res = await enviarEmailAvisoSistema(u.email, u.nombre.split(" ")[0] || u.nombre, {
      asunto: titulo,
      titulo,
      parrafos: [r.lugar ? `Lugar: ${r.lugar}.` : "", "Orden del día:", ...orden.split("\n")].filter(Boolean),
      boton: { texto: "Ver la convocatoria", link: `${urlBaseApp()}/asambleas/${reunion_id}` },
    }).catch(() => ({ ok: false }));
    if (res.ok) emails++;
  }
  await update("reuniones", reunion_id, { convocatoria_enviada_en: new Date().toISOString(), fecha_convocatoria: r.fecha_convocatoria || new Date().toISOString().slice(0, 10) });
  await audit({ usuario_id: user.id, accion: "enviar_convocatoria", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: { avisos: usuarios.length, emails, plazo: plazo.mensaje } });
  revalidar(reunion_id);
  return { avisos: usuarios.length, emails, plazo };
}

// ---------- Asistencia, poderes y quórum ----------

export async function marcarPresenteAction(formData: FormData) {
  const user = await requireConduccion();
  const { padron_id, presente } = parseForm(z.object({ padron_id: zId, presente: zEnumSeguro(["si", "no"]) }), formData);
  const p = await get<{ id: number; reunion_id: number; nombre: string }>(`SELECT id, reunion_id, nombre FROM asamblea_padron WHERE id = ?`, [padron_id]);
  if (!p) throw new Error("No está en el padrón.");
  const r = await asamblea(p.reunion_id);
  if (r.estado !== "planificada") throw new Error("La asamblea ya se cerró.");
  await update("asamblea_padron", padron_id, presente === "si" ? { presente: 1, llegada_en: new Date().toISOString(), representado_por_id: null } : { presente: 0, llegada_en: null });
  if (presente === "no") {
    // Si se va, los poderes que traía dejan de contar (quedan registrados para cuando vuelva).
  }
  await audit({ usuario_id: user.id, accion: presente === "si" ? "registrar_llegada_asamblea" : "registrar_salida_asamblea", entidad: "reuniones", entidad_id: p.reunion_id, valor_nuevo: { nombre: p.nombre } });
  revalidar(p.reunion_id);
}

export async function asignarPoderAction(formData: FormData) {
  const user = await requireConduccion();
  const { padron_id, representante_id } = parseForm(z.object({ padron_id: zId, representante_id: zIdOpcional }), formData);
  const p = await get<{ id: number; reunion_id: number; nombre: string; presente: number; habilitado: number }>(`SELECT id, reunion_id, nombre, presente, habilitado FROM asamblea_padron WHERE id = ?`, [padron_id]);
  if (!p) throw new Error("No está en el padrón.");
  const reglamento = await obtenerReglamento();
  if (!reglamento.asambleas.poderes) throw new Error("El reglamento no permite votar con poder.");
  if (representante_id) {
    if (p.presente) throw new Error(`${p.nombre} está presente: vota por sí.`);
    if (!p.habilitado) throw new Error(`${p.nombre} no está habilitado para votar, así que no puede dar un poder.`);
    const rep = await get<{ id: number; reunion_id: number; nombre: string; presente: number; habilitado: number }>(`SELECT id, reunion_id, nombre, presente, habilitado FROM asamblea_padron WHERE id = ?`, [representante_id]);
    if (!rep || rep.reunion_id !== p.reunion_id) throw new Error("Esa persona no está en el padrón de esta asamblea.");
    if (!rep.presente || !rep.habilitado) throw new Error("Quien representa tiene que estar presente y habilitado.");
    const ya = await get<{ n: string }>(`SELECT COUNT(*) AS n FROM asamblea_padron WHERE representado_por_id = ? AND id <> ?`, [representante_id, padron_id]);
    if (Number(ya?.n || 0) >= reglamento.asambleas.poderesMax) throw new Error(`${rep.nombre} ya tiene el máximo de poderes (${reglamento.asambleas.poderesMax}).`);
  }
  await update("asamblea_padron", padron_id, { representado_por_id: representante_id });
  await audit({ usuario_id: user.id, accion: "poder_asamblea", entidad: "reuniones", entidad_id: p.reunion_id, valor_nuevo: { nombre: p.nombre, representante_id } });
  revalidar(p.reunion_id);
}

/** La mesa confirma con qué convocatoria empieza (el sistema sólo muestra la cuenta). */
export async function confirmarQuorumAction(formData: FormData) {
  const user = await requireConduccion();
  const { reunion_id, convocatoria } = parseForm(z.object({ reunion_id: zId, convocatoria: zEnumSeguro(["primera", "segunda"]) }), formData);
  const r = await asamblea(reunion_id);
  if (r.estado !== "planificada") throw new Error("La asamblea ya se cerró.");
  const reglamento = await obtenerReglamento();
  const q = calcularQuorum(await padronDe(reunion_id), r.fecha, reglamento.asambleas);
  const hay = convocatoria === "primera" ? q.hayPrimera : q.haySegunda;
  if (!hay) throw new Error(`Para empezar en ${convocatoria} convocatoria hacen falta ${convocatoria === "primera" ? q.necesariosPrimera : q.necesariosSegunda} y hay ${q.votosPosibles}.`);
  const detalle = `Presentes ${q.presentes}${q.porPoder ? ` y ${q.porPoder} representados con poder` : ""}, de ${q.habilitados} socios habilitados.`;
  await update("reuniones", reunion_id, { quorum_confirmado: convocatoria, quorum_confirmado_en: new Date().toISOString(), quorum_confirmado_por_id: user.id, quorum_detalle: detalle });
  await audit({ usuario_id: user.id, accion: "confirmar_quorum", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: { convocatoria, detalle } });
  revalidar(reunion_id);
}

// ---------- Votaciones ----------

const votacionSchema = z.object({
  reunion_id: zId,
  agenda_item_id: zIdOpcional,
  titulo: zTexto(300),
  mayoria: zEnumSeguro(["simple", "absoluta", "dos_tercios"], "simple"),
  nominal: zEnumSeguro(["si", "no"], "no"),
});

export async function crearVotacionAction(formData: FormData) {
  const user = await requireConduccion();
  const d = parseForm(votacionSchema, formData);
  const r = await asamblea(d.reunion_id);
  if (r.estado !== "planificada") throw new Error("La asamblea ya se cerró.");
  if (!r.quorum_confirmado) throw new Error("Primero la mesa tiene que confirmar el quórum para empezar.");
  const abierta = await get<{ id: number }>(`SELECT id FROM asamblea_votaciones WHERE reunion_id = ? AND estado = 'abierta'`, [d.reunion_id]);
  if (abierta) throw new Error("Hay otra votación abierta: cerrala antes de empezar una nueva.");
  const id = await insert("asamblea_votaciones", { reunion_id: d.reunion_id, agenda_item_id: d.agenda_item_id, titulo: d.titulo, mayoria: d.mayoria, nominal: d.nominal === "si" ? 1 : 0, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "abrir_votacion", entidad: "reuniones", entidad_id: d.reunion_id, valor_nuevo: { votacion: id, titulo: d.titulo } });
  revalidar(d.reunion_id);
}

export async function votoNominalAction(formData: FormData) {
  const user = await requireConduccion();
  const { votacion_id, padron_id, voto } = parseForm(z.object({ votacion_id: zId, padron_id: zId, voto: zEnumSeguro(["a_favor", "en_contra", "abstencion"]) }), formData);
  const v = await get<{ reunion_id: number; estado: string; nominal: number }>(`SELECT reunion_id, estado, nominal FROM asamblea_votaciones WHERE id = ?`, [votacion_id]);
  if (!v || v.estado !== "abierta") throw new Error("Esa votación no está abierta.");
  const p = await get<{ reunion_id: number; habilitado: number; presente: number; representado_por_id: number | null }>(`SELECT reunion_id, habilitado, presente, representado_por_id FROM asamblea_padron WHERE id = ?`, [padron_id]);
  if (!p || p.reunion_id !== v.reunion_id || !p.habilitado) throw new Error("Esa persona no puede votar.");
  if (!p.presente && !p.representado_por_id) throw new Error("Esa persona no está presente ni representada.");
  const ya = await get<{ id: number }>(`SELECT id FROM asamblea_votos WHERE votacion_id = ? AND padron_id = ?`, [votacion_id, padron_id]);
  if (ya) await update("asamblea_votos", ya.id, { voto, registrado_en: new Date().toISOString() });
  else await insert("asamblea_votos", { votacion_id, padron_id, voto });
  await audit({ usuario_id: user.id, accion: "registrar_voto", entidad: "reuniones", entidad_id: v.reunion_id, valor_nuevo: { votacion: votacion_id, padron_id, voto } });
  revalidar(v.reunion_id);
}

const conteoSchema = z.object({
  votacion_id: zId,
  a_favor: z.coerce.number().int("Número entero.").min(0, "No puede ser negativo."),
  en_contra: z.coerce.number().int("Número entero.").min(0, "No puede ser negativo."),
  abstenciones: z.coerce.number().int("Número entero.").min(0, "No puede ser negativo."),
});

/** Cierra la votación: con el conteo escrito (o sumando los votos nominales) y calcula el resultado. */
export async function cerrarVotacionAction(formData: FormData) {
  const user = await requireConduccion();
  const votacionId = Number(formData.get("votacion_id") || 0);
  const v = await get<{ id: number; reunion_id: number; estado: string; nominal: number; mayoria: string; titulo: string; agenda_item_id: number | null }>(
    `SELECT id, reunion_id, estado, nominal, mayoria, titulo, agenda_item_id FROM asamblea_votaciones WHERE id = ?`,
    [votacionId]
  );
  if (!v || v.estado !== "abierta") throw new Error("Esa votación no está abierta.");
  const r = await asamblea(v.reunion_id);
  const reglamento = await obtenerReglamento();
  const q = calcularQuorum(await padronDe(v.reunion_id), r.fecha, reglamento.asambleas);
  let aFavor: number, enContra: number, abst: number;
  if (v.nominal) {
    const votos = await all<{ voto: string; n: string }>(`SELECT voto, COUNT(*) AS n FROM asamblea_votos WHERE votacion_id = ? GROUP BY voto`, [v.id]);
    const n = (k: string) => Number(votos.find((x) => x.voto === k)?.n || 0);
    [aFavor, enContra, abst] = [n("a_favor"), n("en_contra"), n("abstencion")];
  } else {
    const c = parseForm(conteoSchema, formData);
    [aFavor, enContra, abst] = [c.a_favor, c.en_contra, c.abstenciones];
  }
  if (aFavor + enContra + abst > q.votosPosibles) {
    throw new ValidationError("a_favor", `Se contaron ${aFavor + enContra + abst} votos y pueden votar ${q.votosPosibles} (presentes y con poder). Revisá el conteo.`);
  }
  if (aFavor + enContra + abst === 0) throw new ValidationError("a_favor", "No hay votos registrados.");
  const resultado = resultadoVotacion(v.mayoria, aFavor, enContra, abst, q.votosPosibles);
  await update("asamblea_votaciones", v.id, { estado: "cerrada", a_favor: aFavor, en_contra: enContra, abstenciones: abst, votantes: q.votosPosibles, resultado, cerrada_en: new Date().toISOString() });
  // La resolución queda en el punto del orden del día (para el acta y el seguimiento → tareas).
  if (v.agenda_item_id) {
    const item = await get<{ resultado: string | null }>(`SELECT resultado FROM reunion_agenda_items WHERE id = ?`, [v.agenda_item_id]);
    const texto = `${v.titulo}: ${RESULTADO_LABEL[resultado]} (${aFavor} a favor, ${enContra} en contra, ${abst} abstenciones).`;
    await update("reunion_agenda_items", v.agenda_item_id, { resultado: item?.resultado ? `${item.resultado}\n${texto}` : texto });
  }
  await audit({ usuario_id: user.id, accion: "cerrar_votacion", entidad: "reuniones", entidad_id: v.reunion_id, valor_nuevo: { titulo: v.titulo, aFavor, enContra, abst, resultado } });
  revalidar(v.reunion_id);
}

export async function anularVotacionAction(formData: FormData) {
  const user = await requireConduccion();
  const { votacion_id, motivo } = parseForm(z.object({ votacion_id: zId, motivo: zTexto(300) }), formData);
  const v = await get<{ reunion_id: number; estado: string }>(`SELECT reunion_id, estado FROM asamblea_votaciones WHERE id = ?`, [votacion_id]);
  if (!v || v.estado !== "abierta") throw new Error("Sólo se puede anular una votación abierta.");
  await update("asamblea_votaciones", votacion_id, { estado: "anulada", motivo_anulacion: motivo });
  await audit({ usuario_id: user.id, accion: "anular_votacion", entidad: "reuniones", entidad_id: v.reunion_id, valor_nuevo: { votacion_id, motivo } });
  revalidar(v.reunion_id);
}

// ---------- Cierre y acta ----------

export async function cerrarAsambleaAction(formData: FormData) {
  const user = await requireConduccion();
  const { reunion_id } = parseForm(z.object({ reunion_id: zId }), formData);
  const r = await asamblea(reunion_id);
  if (r.estado !== "planificada") throw new Error("La asamblea ya está cerrada.");
  const abierta = await get<{ id: number }>(`SELECT id FROM asamblea_votaciones WHERE reunion_id = ? AND estado = 'abierta'`, [reunion_id]);
  if (abierta) throw new Error("Hay una votación abierta: cerrala o anulala antes de terminar.");
  const texto = await borradorDeActa(reunion_id, user.organizacion.nombre);
  const actaId = r.acta_id
    ? (await update("actas", r.acta_id, { texto, estado: "borrador" }), r.acta_id)
    : await insert("actas", { organo: "asamblea", fecha: r.fecha, titulo: r.titulo, resumen: texto.slice(0, 2000), texto, estado: "borrador", reunion_id });
  await update("reuniones", reunion_id, { estado: "realizada", acta_id: actaId });
  await audit({ usuario_id: user.id, accion: "cerrar", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: { acta_id: actaId, acta: "borrador" } });
  revalidar(reunion_id);
}

export async function guardarActaAction(formData: FormData) {
  const user = await requireConduccion();
  const { acta_id, texto } = parseForm(z.object({ acta_id: zId, texto: zTexto(20000) }), formData);
  const a = await get<{ estado: string; reunion_id: number }>(`SELECT estado, reunion_id FROM actas WHERE id = ?`, [acta_id]);
  if (!a) throw new Error("Esa acta no existe.");
  if (a.estado === "aprobada") throw new Error("El acta ya está aprobada: no se modifica.");
  await update("actas", acta_id, { texto, resumen: texto.slice(0, 2000) });
  await audit({ usuario_id: user.id, accion: "editar_acta", entidad: "actas", entidad_id: acta_id, valor_nuevo: { largo: texto.length } });
  revalidar(a.reunion_id);
}

/** Aprobar el acta: queda firme, toma su número en el libro y se genera el PDF. */
export async function aprobarActaAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "comisiones")) throw new Error("El acta la aprueba el Consejo Directivo (o un administrador).");
  const { acta_id } = parseForm(z.object({ acta_id: zId }), formData);
  const a = await get<{ id: number; estado: string; reunion_id: number; texto: string | null; titulo: string; numero_libro: number | null }>(
    `SELECT id, estado, reunion_id, texto, titulo, numero_libro FROM actas WHERE id = ?`,
    [acta_id]
  );
  if (!a) throw new Error("Esa acta no existe.");
  if (a.estado === "aprobada") throw new Error("El acta ya está aprobada.");
  const ultimo = await get<{ max: number | null }>(`SELECT MAX(numero_libro) AS max FROM actas WHERE organo = 'asamblea'`);
  const numero = a.numero_libro ?? (ultimo?.max || 0) + 1;
  await update("actas", acta_id, { estado: "aprobada", aprobada_en: new Date().toISOString(), aprobada_por_id: user.id, numero_libro: numero });
  // Copia en Documentos (si el almacenamiento está disponible; si no, el PDF se arma cuando se descarga).
  try {
    const pdf = await generarPdfActa(a.reunion_id, user.organizacion);
    const url = await saveGeneratedFile(pdf, user.organization_id, "actas", `acta-asamblea-${a.reunion_id}.pdf`);
    const docId = await insert("documentos", { categoria: "actas", nombre: `Acta N° ${numero} — ${a.titulo}`, archivo_url: url, subido_por_id: user.id, reunion_id: a.reunion_id });
    await update("actas", acta_id, { documento_id: docId });
  } catch (err) {
    console.error("[actas] no se pudo guardar el PDF:", (err as Error)?.message);
  }
  await audit({ usuario_id: user.id, accion: "aprobar_acta", entidad: "actas", entidad_id: acta_id, valor_nuevo: { numero_libro: numero } });
  revalidar(a.reunion_id);
  revalidatePath("/libros-sociales");
}

// ---------- Envolturas ----------

export async function calcularPadronFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let msg = "";
  const r = await conEstadoDeAccion(async () => {
    const res = await calcularPadronAction(fd);
    msg = `Padrón listo: ${res.habilitados} habilitado(s) de ${res.total}.`;
  });
  return r.ok ? { ...r, aviso: msg } : r;
}
export async function enviarConvocatoriaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let msg = "";
  const r = await conEstadoDeAccion(async () => {
    const res = await enviarConvocatoriaAction(fd);
    msg = `Convocatoria enviada: ${res.avisos} aviso(s) en COOVA y ${res.emails} email(s).${res.plazo.ok ? "" : " Atención: " + res.plazo.mensaje}`;
  });
  return r.ok ? { ...r, aviso: msg } : r;
}
export async function marcarPresenteFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => marcarPresenteAction(fd));
}
export async function asignarPoderFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => asignarPoderAction(fd));
}
export async function confirmarQuorumFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => confirmarQuorumAction(fd));
}
export async function crearVotacionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearVotacionAction(fd));
}
export async function votoNominalFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => votoNominalAction(fd));
}
export async function cerrarVotacionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cerrarVotacionAction(fd));
}
export async function anularVotacionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularVotacionAction(fd));
}
export async function cerrarAsambleaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => cerrarAsambleaAction(fd));
  return r.ok ? { ...r, aviso: "Asamblea cerrada. Revisá el borrador del acta." } : r;
}
export async function guardarActaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarActaAction(fd));
}
export async function aprobarActaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => aprobarActaAction(fd));
}

// ---------- Fase 3F: modo asamblea en vivo ----------

/** La mesa marca qué punto del orden del día se está tratando (se ve en el proyector). */
export async function pasarAlPuntoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    const user = await requireConduccion();
    const { reunion_id, punto_id } = parseForm(z.object({ reunion_id: zId, punto_id: z.coerce.number().int().min(0) }), fd);
    const a = await asamblea(reunion_id);
    if (a.estado !== "planificada") throw new Error("La asamblea ya se cerró.");
    let titulo: string | null = null;
    if (punto_id) {
      const p = await get<{ titulo: string }>(`SELECT titulo FROM reunion_agenda_items WHERE id = ? AND reunion_id = ?`, [punto_id, reunion_id]);
      if (!p) throw new Error("Ese punto no es de esta asamblea.");
      titulo = p.titulo;
    }
    await update("reuniones", reunion_id, { punto_actual_id: punto_id || null });
    await audit({ usuario_id: user.id, accion: "pasar_punto", entidad: "reuniones", entidad_id: reunion_id, valor_nuevo: { punto: titulo } });
    revalidatePath(`/asambleas/${reunion_id}`);
    aviso = titulo ? `En pantalla: ${titulo}` : "Sin punto en pantalla.";
  });
  return r.ok ? { ...r, aviso } : r;
}
