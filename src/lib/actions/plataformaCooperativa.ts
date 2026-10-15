"use server";

import crypto from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { conCooperativa, auditarTx, normalizarNombre, type Tx } from "@/lib/plataformaCoop";
import { parsearNucleosEnLote, parsearComisionesEnLote } from "@/lib/plataformaParseo";
import { hashPassword } from "@/lib/auth";
import { enviarEmailAvisoSistema } from "@/lib/email";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { hoyEnUruguay } from "@/lib/horasObra";
import {
  parseForm,
  zId,
  zIdOpcional,
  zNombre,
  zEnumSeguro,
  zEmailOpcional,
  zTelefonoOpcional,
  zDocumentoOpcional,
  zCheckbox,
  ValidationError,
} from "@/lib/validation";

/**
 * Panel de administración por cooperativa (/plataforma/[id]).
 *
 * TODAS las acciones exigen administrador de plataforma (`conCooperativa` lo
 * verifica) y corren en una transacción sobre la cooperativa elegida, con
 * auditoría en la misma transacción. Nada se borra: las bajas son lógicas
 * (socios.estado = 'baja', users.activo = 0, comision_miembros.activo = 0),
 * salvo la limpieza explícita de datos de prueba, que guarda un respaldo
 * completo antes de tocar nada (ver ejecutarLimpiezaPruebaAction).
 *
 * No se otorgan privilegios: los usuarios nuevos se crean con rol "socio".
 * Los cargos (directiva, tesorería, etc.) se configuran después.
 */

const ETAPAS = ["pre_obra", "obra", "habitada"] as const;
const RELACIONES = ["pareja", "hijo", "hija", "padre", "madre", "hermano", "hermana", "otro"] as const;
const DIAS_INVITACION = 7;

const orgIdSchema = z.object({ org_id: zId });

function revalidar(orgId: number) {
  revalidatePath(`/plataforma/${orgId}`);
  revalidatePath("/plataforma");
}

async function insertarTx(tx: Tx, tabla: string, datos: Record<string, unknown>): Promise<number> {
  const claves = Object.keys(datos);
  const sql = `INSERT INTO ${tabla} (${claves.join(", ")}) VALUES (${claves.map(() => "?").join(", ")}) RETURNING id`;
  const fila = await tx.get<{ id: number }>(sql, claves.map((k) => datos[k]));
  if (!fila) throw new Error("No se pudo guardar.");
  return fila.id;
}

// ---------------------------------------------------------------------------
// Cooperativa
// ---------------------------------------------------------------------------

const editarCooperativaSchema = z.object({
  org_id: zId,
  nombre: zNombre(200),
  etapa: zEnumSeguro(ETAPAS),
});

export async function editarCooperativaAction(formData: FormData) {
  const d = parseForm(editarCooperativaSchema, formData);
  await conCooperativa(d.org_id, async (tx, admin) => {
    const antes = await tx.get<{ nombre: string; etapa: string }>(`SELECT nombre, etapa FROM organizations WHERE id = ?`, [d.org_id]);
    if (!antes) throw new Error("Esa cooperativa no existe.");
    await tx.run(`UPDATE organizations SET nombre = ?, etapa = ? WHERE id = ?`, [d.nombre, d.etapa, d.org_id]);
    await auditarTx(tx, admin, "editar_cooperativa", "organizations", d.org_id, { nombre: d.nombre, etapa: d.etapa }, antes);
  });
  revalidar(d.org_id);
}
export async function editarCooperativaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarCooperativaAction(fd));
}

// ---------------------------------------------------------------------------
// Núcleos
// ---------------------------------------------------------------------------

const numeroNucleo = z.coerce
  .number({ message: "Ingresá un valor numérico válido." })
  .int("Tiene que ser un número entero.")
  .min(1, "Tiene que ser mayor que 0.")
  .max(99999, "Número demasiado grande.");

const guardarNucleoSchema = z.object({
  org_id: zId,
  socio_id: zIdOpcional,
  numero_nucleo: numeroNucleo,
  nombre: zNombre(200),
  documento: zDocumentoOpcional(50),
  telefono: zTelefonoOpcional,
  email: zEmailOpcional,
});

type DatosNucleo = { numero: number; nombre: string; documento?: string | null; telefono?: string | null; email?: string | null };

/** Valida que el número y el nombre no estén repetidos en la cooperativa (ignorando `excluirSocioId`). */
async function validarNucleoUnico(tx: Tx, numero: number, nombre: string, excluirSocioId: number | null) {
  const porNumero = await tx.get<{ id: number; nombre: string }>(
    `SELECT id, nombre FROM socios WHERE numero_nucleo = ? AND estado <> 'baja' AND id <> ?`,
    [numero, excluirSocioId ?? 0]
  );
  if (porNumero) throw new ValidationError("numero_nucleo", `Ya existe el núcleo N.º ${numero} (${porNumero.nombre}).`);
  const norm = normalizarNombre(nombre);
  const existentes = await tx.all<{ id: number; nombre: string; numero_nucleo: number | null }>(
    `SELECT id, nombre, numero_nucleo FROM socios WHERE estado <> 'baja' AND id <> ?`,
    [excluirSocioId ?? 0]
  );
  const repetido = existentes.find((s) => normalizarNombre(s.nombre) === norm);
  if (repetido) {
    throw new ValidationError(
      "nombre",
      `Ya existe ${repetido.nombre}${repetido.numero_nucleo ? ` (núcleo N.º ${repetido.numero_nucleo})` : ""} en esta cooperativa.`
    );
  }
}

async function crearNucleoTx(tx: Tx, admin: { id: number }, d: DatosNucleo): Promise<number> {
  await validarNucleoUnico(tx, d.numero, d.nombre, null);
  const nucleoId = await insertarTx(tx, "nucleos_familiares", {
    organization_id: tx.orgId,
    nombre: `Núcleo ${d.numero} · ${d.nombre}`.slice(0, 200),
  });
  const fecha = hoyEnUruguay();
  const socioId = await insertarTx(tx, "socios", {
    organization_id: tx.orgId,
    nombre: d.nombre,
    documento: d.documento ?? null,
    email: d.email ?? null,
    telefono: d.telefono ?? null,
    estado: "activo",
    nucleo_id: nucleoId,
    numero_nucleo: d.numero,
    fecha_ingreso: fecha,
  });
  await insertarTx(tx, "socio_estados", {
    organization_id: tx.orgId,
    socio_id: socioId,
    estado_anterior: null,
    estado_nuevo: "activo",
    fecha,
    motivo: "Alta desde el panel de plataforma",
    registrado_por_id: admin.id,
  });
  return socioId;
}

export async function guardarNucleoAction(formData: FormData) {
  const d = parseForm(guardarNucleoSchema, formData);
  await conCooperativa(d.org_id, async (tx, admin) => {
    if (d.socio_id) {
      const antes = await tx.get<{ nombre: string; numero_nucleo: number | null; nucleo_id: number | null }>(
        `SELECT nombre, numero_nucleo, nucleo_id FROM socios WHERE id = ? AND estado <> 'baja'`,
        [d.socio_id]
      );
      if (!antes) throw new Error("Ese núcleo no existe.");
      await validarNucleoUnico(tx, d.numero_nucleo, d.nombre, d.socio_id);
      await tx.run(`UPDATE socios SET nombre = ?, numero_nucleo = ?, documento = ?, telefono = ?, email = ? WHERE id = ?`, [
        d.nombre,
        d.numero_nucleo,
        d.documento,
        d.telefono,
        d.email,
        d.socio_id,
      ]);
      if (antes.nucleo_id) {
        await tx.run(`UPDATE nucleos_familiares SET nombre = ? WHERE id = ?`, [`Núcleo ${d.numero_nucleo} · ${d.nombre}`.slice(0, 200), antes.nucleo_id]);
      }
      await auditarTx(tx, admin, "editar_nucleo", "socios", d.socio_id, { numero_nucleo: d.numero_nucleo, nombre: d.nombre }, antes);
    } else {
      const id = await crearNucleoTx(tx, admin, {
        numero: d.numero_nucleo,
        nombre: d.nombre,
        documento: d.documento,
        telefono: d.telefono,
        email: d.email,
      });
      await auditarTx(tx, admin, "crear_nucleo", "socios", id, { numero_nucleo: d.numero_nucleo, nombre: d.nombre });
    }
  });
  revalidar(d.org_id);
}
export async function guardarNucleoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarNucleoAction(fd));
}

/** Baja lógica de un núcleo: sale del padrón activo, no se borra nada. */
export async function darDeBajaNucleoAction(formData: FormData) {
  const d = parseForm(z.object({ org_id: zId, socio_id: zId }), formData);
  await conCooperativa(d.org_id, async (tx, admin) => {
    const antes = await tx.get<{ nombre: string; estado: string; numero_nucleo: number | null }>(
      `SELECT nombre, estado, numero_nucleo FROM socios WHERE id = ? AND estado <> 'baja'`,
      [d.socio_id]
    );
    if (!antes) throw new Error("Ese núcleo no existe o ya está dado de baja.");
    await tx.run(`UPDATE socios SET estado = 'baja' WHERE id = ?`, [d.socio_id]);
    await insertarTx(tx, "socio_estados", {
      organization_id: tx.orgId,
      socio_id: d.socio_id,
      estado_anterior: antes.estado,
      estado_nuevo: "baja",
      fecha: hoyEnUruguay(),
      motivo: "Baja desde el panel de plataforma",
      registrado_por_id: admin.id,
    });
    await auditarTx(tx, admin, "baja_nucleo", "socios", d.socio_id, { estado: "baja" }, antes);
  });
  revalidar(d.org_id);
}
export async function darDeBajaNucleoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => darDeBajaNucleoAction(fd));
}


export async function cargarNucleosEnLoteAction(formData: FormData): Promise<string> {
  const d = parseForm(z.object({ org_id: zId, texto: z.string().min(1, "Pegá la lista de núcleos.").max(20000, "La lista es demasiado larga.") }), formData);
  const { filas, errores } = parsearNucleosEnLote(d.texto);
  if (errores.length) throw new ValidationError("texto", errores.slice(0, 8).join(" ") + (errores.length > 8 ? ` (y ${errores.length - 8} más)` : ""));
  if (!filas.length) throw new ValidationError("texto", "No hay ninguna línea para cargar.");

  const resumen = await conCooperativa(d.org_id, async (tx, admin) => {
    const yaEstan: string[] = [];
    let creados = 0;
    for (const f of filas) {
      const existente = await tx.get<{ id: number; nombre: string }>(
        `SELECT id, nombre FROM socios WHERE numero_nucleo = ? AND estado <> 'baja'`,
        [f.numero]
      );
      if (existente) {
        // Mismo número y mismo nombre: ya cargado, se omite (permite repetir la carga sin duplicar).
        if (normalizarNombre(existente.nombre) === normalizarNombre(f.nombre)) {
          yaEstan.push(`${f.numero} ${f.nombre}`);
          continue;
        }
        throw new ValidationError("texto", `Línea ${f.linea}: el núcleo N.º ${f.numero} ya existe con otro nombre (${existente.nombre}).`);
      }
      const id = await crearNucleoTx(tx, admin, { numero: f.numero, nombre: f.nombre });
      creados++;
      await auditarTx(tx, admin, "crear_nucleo", "socios", id, { numero_nucleo: f.numero, nombre: f.nombre, origen: "carga_en_lote" });
    }
    return { creados, yaEstan };
  });
  revalidar(d.org_id);
  return resumen.yaEstan.length
    ? `Se crearon ${resumen.creados} núcleos. ${resumen.yaEstan.length} ya estaban cargados y se omitieron.`
    : `Se crearon ${resumen.creados} núcleos.`;
}
export async function cargarNucleosEnLoteFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await cargarNucleosEnLoteAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

// ---------------------------------------------------------------------------
// Integrantes de un núcleo
// ---------------------------------------------------------------------------

const guardarIntegranteSchema = z.object({
  org_id: zId,
  socio_id: zId,
  id: zIdOpcional,
  nombre: zNombre(200),
  apellido: zNombreOpcional(),
  documento: zDocumentoOpcional(50),
  telefono: zTelefonoOpcional,
  email: zEmailOpcional,
  relacion: zEnumSeguro(RELACIONES, "otro"),
});

function zNombreOpcional() {
  return z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null));
}

export async function guardarIntegranteAction(formData: FormData) {
  const d = parseForm(guardarIntegranteSchema, formData);
  await conCooperativa(d.org_id, async (tx, admin) => {
    const socio = await tx.get<{ id: number }>(`SELECT id FROM socios WHERE id = ? AND estado <> 'baja'`, [d.socio_id]);
    if (!socio) throw new Error("Ese núcleo no existe.");
    const norm = normalizarNombre(`${d.nombre} ${d.apellido ?? ""}`);
    const hermanos = await tx.all<{ id: number; nombre: string; apellido: string | null }>(
      `SELECT id, nombre, apellido FROM socio_integrantes WHERE socio_id = ? AND estado = 'activo' AND id <> ?`,
      [d.socio_id, d.id ?? 0]
    );
    if (hermanos.some((h) => normalizarNombre(`${h.nombre} ${h.apellido ?? ""}`) === norm)) {
      throw new ValidationError("nombre", "Esa persona ya figura como integrante de este núcleo.");
    }
    if (d.id) {
      const antes = await tx.get<Record<string, unknown>>(`SELECT nombre, apellido, relacion FROM socio_integrantes WHERE id = ? AND socio_id = ?`, [d.id, d.socio_id]);
      if (!antes) throw new Error("Ese integrante no existe.");
      await tx.run(
        `UPDATE socio_integrantes SET nombre = ?, apellido = ?, documento = ?, telefono = ?, email = ?, relacion = ? WHERE id = ?`,
        [d.nombre, d.apellido, d.documento, d.telefono, d.email, d.relacion, d.id]
      );
      await auditarTx(tx, admin, "editar_integrante", "socio_integrantes", d.id, { nombre: d.nombre, apellido: d.apellido, relacion: d.relacion }, antes);
    } else {
      const id = await insertarTx(tx, "socio_integrantes", {
        organization_id: tx.orgId,
        socio_id: d.socio_id,
        nombre: d.nombre,
        apellido: d.apellido,
        documento: d.documento,
        telefono: d.telefono,
        email: d.email,
        relacion: d.relacion,
        creado_por_id: admin.id,
      });
      await auditarTx(tx, admin, "agregar_integrante", "socio_integrantes", id, { socio_id: d.socio_id, nombre: d.nombre, relacion: d.relacion });
    }
  });
  revalidar(d.org_id);
}
export async function guardarIntegranteFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarIntegranteAction(fd));
}

export async function cambiarEstadoIntegranteAction(formData: FormData) {
  const d = parseForm(z.object({ org_id: zId, id: zId, estado: zEnumSeguro(["activo", "inactivo"]) }), formData);
  await conCooperativa(d.org_id, async (tx, admin) => {
    const n = await tx.run(`UPDATE socio_integrantes SET estado = ? WHERE id = ?`, [d.estado, d.id]);
    if (!n) throw new Error("Ese integrante no existe.");
    await auditarTx(tx, admin, d.estado === "activo" ? "reactivar_integrante" : "baja_integrante", "socio_integrantes", d.id, { estado: d.estado });
  });
  revalidar(d.org_id);
}
export async function cambiarEstadoIntegranteFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarEstadoIntegranteAction(fd));
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

const guardarUsuarioSchema = z.object({
  org_id: zId,
  id: zIdOpcional,
  nombre: zNombre(200),
  email: zEmailOpcional,
  socio_id: zIdOpcional,
});

/** Deja la membresía activa de `userId` en exactamente `comisionIds` (nunca borra: cierra con fecha). */
async function sincronizarComisiones(tx: Tx, userId: number, comisionIds: number[]) {
  const validas = comisionIds.length
    ? await tx.all<{ id: number }>(`SELECT id FROM comisiones WHERE id = ANY(?::int[]) AND activa = 1`, [comisionIds])
    : [];
  const deseadas = new Set(validas.map((c) => c.id));
  if (deseadas.size !== new Set(comisionIds).size) throw new Error("Alguna de las comisiones elegidas no existe o está archivada.");
  const actuales = await tx.all<{ id: number; comision_id: number }>(
    `SELECT id, comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`,
    [userId]
  );
  const yaActivas = new Set(actuales.map((m) => m.comision_id));
  for (const m of actuales) {
    if (!deseadas.has(m.comision_id)) {
      await tx.run(`UPDATE comision_miembros SET activo = 0, hasta = now()::text WHERE id = ?`, [m.id]);
    }
  }
  for (const cid of deseadas) {
    if (!yaActivas.has(cid)) {
      await insertarTx(tx, "comision_miembros", {
        organization_id: tx.orgId,
        comision_id: cid,
        user_id: userId,
        rol_en_comision: "integrante",
        activo: 1,
      });
    }
  }
}

/** Vincula usuario y núcleo (ficha de socio): un núcleo tiene una sola persona usuaria referente. */
async function vincularUsuarioConNucleo(tx: Tx, userId: number, socioId: number | null) {
  // Suelta cualquier vínculo anterior de este usuario.
  await tx.run(`UPDATE socios SET user_id = NULL WHERE user_id = ? AND (?::int IS NULL OR id <> ?::int)`, [userId, socioId, socioId]);
  if (!socioId) {
    await tx.run(`UPDATE users SET nucleo_id = NULL WHERE id = ?`, [userId]);
    return;
  }
  const socio = await tx.get<{ id: number; nombre: string; user_id: number | null; nucleo_id: number | null }>(
    `SELECT id, nombre, user_id, nucleo_id FROM socios WHERE id = ? AND estado <> 'baja'`,
    [socioId]
  );
  if (!socio) throw new ValidationError("socio_id", "Ese núcleo no existe.");
  if (socio.user_id && socio.user_id !== userId) {
    throw new ValidationError("socio_id", `Ese núcleo ya tiene usuario (${socio.nombre}). Editá ese usuario o desvinculalo antes.`);
  }
  await tx.run(`UPDATE socios SET user_id = ? WHERE id = ?`, [userId, socioId]);
  await tx.run(`UPDATE users SET nucleo_id = ? WHERE id = ?`, [socio.nucleo_id, userId]);
}

async function crearUsuarioPendienteTx(tx: Tx, d: { nombre: string; email: string | null; socio_id: number | null }): Promise<number> {
  const norm = normalizarNombre(d.nombre);
  const existentes = await tx.all<{ id: number; nombre: string; email: string | null }>(
    `SELECT id, nombre, email FROM users WHERE estado_cuenta <> 'baja'`
  );
  const mismoNombre = existentes.find((u) => normalizarNombre(u.nombre) === norm);
  if (mismoNombre) {
    throw new ValidationError("nombre", `Ya existe un usuario llamado ${mismoNombre.nombre}. Editalo en vez de crear otro (podés cambiarle el núcleo o las comisiones).`);
  }
  if (d.email) {
    const mismoEmail = existentes.find((u) => u.email?.toLowerCase() === d.email);
    if (mismoEmail) throw new ValidationError("email", `Ese email ya lo usa ${mismoEmail.nombre}. Editá ese usuario en vez de crear otro.`);
  }
  const id = await insertarTx(tx, "users", {
    organization_id: tx.orgId,
    nombre: d.nombre,
    email: d.email,
    // Contraseña aleatoria que nadie conoce: la persona elige la suya al activar la cuenta.
    password_hash: await hashPassword(crypto.randomBytes(24).toString("base64url")),
    rol: "socio",
    activo: 1,
    estado_cuenta: "pendiente",
  });
  await vincularUsuarioConNucleo(tx, id, d.socio_id);
  return id;
}

export async function guardarUsuarioAction(formData: FormData) {
  const d = parseForm(guardarUsuarioSchema, formData);
  const comisionIds = formData
    .getAll("comision_ids")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  await conCooperativa(d.org_id, async (tx, admin) => {
    let userId: number;
    if (d.id) {
      const antes = await tx.get<{ nombre: string; email: string | null; rol: string; es_platform_admin: boolean }>(
        `SELECT nombre, email, rol, es_platform_admin FROM users WHERE id = ?`,
        [d.id]
      );
      if (!antes) throw new Error("Ese usuario no existe.");
      userId = d.id;
      const norm = normalizarNombre(d.nombre);
      const otros = await tx.all<{ id: number; nombre: string; email: string | null }>(
        `SELECT id, nombre, email FROM users WHERE estado_cuenta <> 'baja' AND id <> ?`,
        [d.id]
      );
      const repNombre = otros.find((u) => normalizarNombre(u.nombre) === norm);
      if (repNombre) throw new ValidationError("nombre", `Ya existe otro usuario llamado ${repNombre.nombre}.`);
      if (d.email) {
        const repEmail = otros.find((u) => u.email?.toLowerCase() === d.email);
        if (repEmail) throw new ValidationError("email", `Ese email ya lo usa ${repEmail.nombre}.`);
      }
      // El email de una cuenta que ya inició sesión alguna vez no se cambia a la ligera: se permite, pero
      // vuelve a pedir activación si pasa de vacío a cargado (ver invitación).
      await tx.run(`UPDATE users SET nombre = ?, email = ? WHERE id = ?`, [d.nombre, d.email, d.id]);
      await vincularUsuarioConNucleo(tx, d.id, d.socio_id);
      await auditarTx(tx, admin, "editar_usuario", "users", d.id, { nombre: d.nombre, email: d.email, socio_id: d.socio_id, comisiones: comisionIds }, { nombre: antes.nombre, email: antes.email });
    } else {
      userId = await crearUsuarioPendienteTx(tx, { nombre: d.nombre, email: d.email, socio_id: d.socio_id });
      await auditarTx(tx, admin, "crear_usuario", "users", userId, { nombre: d.nombre, email: d.email, rol: "socio", estado_cuenta: "pendiente", socio_id: d.socio_id, comisiones: comisionIds });
    }
    await sincronizarComisiones(tx, userId, comisionIds);
  });
  revalidar(d.org_id);
}
export async function guardarUsuarioFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarUsuarioAction(fd));
}

/** Desactiva o reactiva una cuenta. Nunca borra: el historial queda intacto. */
export async function cambiarActivoUsuarioAction(formData: FormData) {
  const d = parseForm(z.object({ org_id: zId, id: zId, activo: zCheckbox }), formData);
  await conCooperativa(d.org_id, async (tx, admin) => {
    if (d.id === admin.id) throw new Error("No podés desactivar tu propia cuenta.");
    const u = await tx.get<{ rol: string; es_platform_admin: boolean; estado_cuenta: string }>(
      `SELECT rol, es_platform_admin, estado_cuenta FROM users WHERE id = ?`,
      [d.id]
    );
    if (!u) throw new Error("Ese usuario no existe.");
    if (u.es_platform_admin) throw new Error("No se puede desactivar a un administrador de la plataforma.");
    await tx.run(`UPDATE users SET activo = ? WHERE id = ?`, [d.activo ? 1 : 0, d.id]);
    await auditarTx(tx, admin, d.activo ? "reactivar_usuario" : "desactivar_usuario", "users", d.id, { activo: d.activo });
  });
  revalidar(d.org_id);
}
export async function cambiarActivoUsuarioFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarActivoUsuarioAction(fd));
}

/** Crea un usuario pendiente (sin email) para cada núcleo que todavía no tiene usuario vinculado. */
export async function crearUsuariosParaNucleosAction(formData: FormData): Promise<string> {
  const d = parseForm(orgIdSchema, formData);
  const r = await conCooperativa(d.org_id, async (tx, admin) => {
    const sinUsuario = await tx.all<{ id: number; nombre: string; email: string | null }>(
      `SELECT id, nombre, email FROM socios WHERE estado <> 'baja' AND user_id IS NULL ORDER BY numero_nucleo ASC NULLS LAST, nombre ASC`
    );
    const usuarios = await tx.all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE estado_cuenta <> 'baja'`);
    const porNombre = new Map(usuarios.map((u) => [normalizarNombre(u.nombre), u.id]));
    let creados = 0;
    let vinculados = 0;
    for (const s of sinUsuario) {
      const existente = porNombre.get(normalizarNombre(s.nombre));
      if (existente) {
        // Ya hay un usuario con ese nombre: se vincula, no se duplica.
        const ocupado = await tx.get<{ id: number }>(`SELECT id FROM socios WHERE user_id = ? AND estado <> 'baja'`, [existente]);
        if (!ocupado) {
          await vincularUsuarioConNucleo(tx, existente, s.id);
          vinculados++;
        }
        continue;
      }
      const id = await crearUsuarioPendienteTx(tx, { nombre: s.nombre, email: null, socio_id: s.id });
      porNombre.set(normalizarNombre(s.nombre), id);
      creados++;
    }
    await auditarTx(tx, admin, "crear_usuarios_para_nucleos", "users", null, { creados, vinculados });
    return { creados, vinculados };
  });
  revalidar(d.org_id);
  if (!r.creados && !r.vinculados) return "Todos los núcleos ya tienen usuario.";
  return `Usuarios creados (pendientes de activación): ${r.creados}. Vinculados a un usuario que ya existía: ${r.vinculados}.`;
}
export async function crearUsuariosParaNucleosFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await crearUsuariosParaNucleosAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

/** Invitación: genera el link para elegir contraseña (válido 7 días) y lo manda por email si se puede. */
export async function invitarUsuarioPlataformaAction(formData: FormData): Promise<string> {
  const d = parseForm(z.object({ org_id: zId, id: zId }), formData);
  const token = crypto.randomBytes(32).toString("hex");
  const usuario = await conCooperativa(d.org_id, async (tx, admin) => {
    const u = await tx.get<{ id: number; nombre: string; email: string | null; activo: number }>(
      `SELECT id, nombre, email, activo FROM users WHERE id = ?`,
      [d.id]
    );
    if (!u) throw new Error("Ese usuario no existe.");
    if (!u.email) throw new ValidationError("email", "Primero cargale un email a este usuario (botón Editar).");
    if (u.activo !== 1) throw new Error("Esa cuenta está desactivada. Reactivala antes de invitar.");
    await tx.run(`UPDATE users SET reset_token_hash = ?, reset_token_expira_en = ?, reset_solicitado_en = ? WHERE id = ?`, [
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + DIAS_INVITACION * 86400000).toISOString(),
      new Date().toISOString(),
      d.id,
    ]);
    await auditarTx(tx, admin, "invitar_usuario", "users", d.id, { email: u.email });
    return { ...u, adminOrgId: admin.organization_id, orgNombre: (await tx.get<{ nombre: string }>(`SELECT nombre FROM organizations WHERE id = ?`, [d.org_id]))?.nombre ?? "" };
  });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.includes(".localhost") ? "http" : "https";
  const link = `${proto}://${host}/restablecer-password?token=${token}`;
  revalidar(d.org_id);

  // El envío usa la configuración de email de la cooperativa de la sesión: solo es la correcta si es la misma.
  if (usuario.adminOrgId === d.org_id) {
    const r = await enviarEmailAvisoSistema(usuario.email as string, usuario.nombre.split(" ")[0] || usuario.nombre, {
      asunto: `Te invitaron a ${usuario.orgNombre} en COOVA`,
      titulo: "Te damos la bienvenida",
      parrafos: [`Te crearon un usuario en COOVA, el sistema de ${usuario.orgNombre}.`, `Tocá el botón para elegir tu contraseña. El link vale ${DIAS_INVITACION} días.`],
      boton: { texto: "Elegir mi contraseña", link },
    }).catch(() => ({ ok: false }));
    if (r.ok) return `Listo: le mandamos la invitación a ${usuario.email}.`;
  }
  return `No se pudo mandar el email desde acá. Pasale este link por otro medio; vale ${DIAS_INVITACION} días: ${link}`;
}
export async function invitarUsuarioPlataformaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await invitarUsuarioPlataformaAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

// ---------------------------------------------------------------------------
// Comisiones: carga en lote
// ---------------------------------------------------------------------------


const cargarComisionesSchema = z.object({
  org_id: zId,
  texto: z.string().min(1, "Pegá la lista de comisiones.").max(20000, "La lista es demasiado larga."),
  crear_comisiones: zCheckbox,
  crear_personas: zCheckbox,
});

/**
 * Asigna personas a comisiones sin duplicar: las personas se buscan por nombre (sin importar
 * mayúsculas ni tildes) entre los usuarios existentes; las comisiones, entre las existentes.
 * Todo o nada: si algo no se encuentra y no se tildó crearlo, no se aplica nada.
 */
export async function cargarComisionesEnLoteAction(formData: FormData): Promise<string> {
  const d = parseForm(cargarComisionesSchema, formData);
  const { grupos, errores } = parsearComisionesEnLote(d.texto);
  if (errores.length) throw new ValidationError("texto", errores.slice(0, 6).join(" "));
  if (!grupos.length) throw new ValidationError("texto", "No hay ninguna línea para cargar.");

  const r = await conCooperativa(d.org_id, async (tx, admin) => {
    const comisiones = await tx.all<{ id: number; nombre: string; activa: number }>(`SELECT id, nombre, activa FROM comisiones`);
    const usuarios = await tx.all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE estado_cuenta <> 'baja'`);
    const comPorNombre = new Map(comisiones.map((c) => [normalizarNombre(c.nombre), c]));
    const usrPorNombre = new Map(usuarios.map((u) => [normalizarNombre(u.nombre), u.id]));

    const faltanComisiones = [...new Set(grupos.filter((g) => !comPorNombre.has(normalizarNombre(g.comision))).map((g) => g.comision))];
    const faltanPersonas = [...new Set(grupos.flatMap((g) => g.personas).filter((p) => !usrPorNombre.has(normalizarNombre(p))))];
    if (faltanComisiones.length && !d.crear_comisiones) {
      throw new ValidationError(
        "texto",
        `No existe la comisión: ${faltanComisiones.join(", ")}. Comisiones que hay: ${comisiones.map((c) => c.nombre).join(", ") || "ninguna"}. Corregí el nombre o tildá «Crear las comisiones que falten».`
      );
    }
    if (faltanPersonas.length && !d.crear_personas) {
      throw new ValidationError(
        "texto",
        `No hay ningún usuario llamado: ${faltanPersonas.join(", ")}. Revisá cómo está escrito o tildá «Crear las personas que falten» (se crean sin núcleo).`
      );
    }

    let comisionesCreadas = 0;
    let personasCreadas = 0;
    let asignaciones = 0;
    for (const nombre of faltanComisiones) {
      const id = await insertarTx(tx, "comisiones", { organization_id: tx.orgId, nombre, activa: 1 });
      comPorNombre.set(normalizarNombre(nombre), { id, nombre, activa: 1 });
      comisionesCreadas++;
      await auditarTx(tx, admin, "crear_comision", "comisiones", id, { nombre, origen: "carga_en_lote" });
    }
    for (const nombre of faltanPersonas) {
      const id = await crearUsuarioPendienteTx(tx, { nombre, email: null, socio_id: null });
      usrPorNombre.set(normalizarNombre(nombre), id);
      personasCreadas++;
      await auditarTx(tx, admin, "crear_usuario", "users", id, { nombre, rol: "socio", estado_cuenta: "pendiente", origen: "carga_en_lote" });
    }
    for (const g of grupos) {
      const com = comPorNombre.get(normalizarNombre(g.comision))!;
      if (com.activa !== 1) throw new ValidationError("texto", `La comisión «${com.nombre}» está archivada.`);
      for (const p of g.personas) {
        const userId = usrPorNombre.get(normalizarNombre(p))!;
        const ya = await tx.get<{ id: number }>(`SELECT id FROM comision_miembros WHERE comision_id = ? AND user_id = ? AND activo = 1`, [com.id, userId]);
        if (ya) continue;
        await insertarTx(tx, "comision_miembros", { organization_id: tx.orgId, comision_id: com.id, user_id: userId, rol_en_comision: "integrante", activo: 1 });
        asignaciones++;
      }
    }
    await auditarTx(tx, admin, "cargar_comisiones_en_lote", "comision_miembros", null, { comisionesCreadas, personasCreadas, asignaciones });
    return { comisionesCreadas, personasCreadas, asignaciones };
  });
  revalidar(d.org_id);
  return `Listo: ${r.asignaciones} asignaciones nuevas${r.comisionesCreadas ? `, ${r.comisionesCreadas} comisiones creadas` : ""}${r.personasCreadas ? `, ${r.personasCreadas} personas creadas (pendientes de activación)` : ""}.`;
}
export async function cargarComisionesEnLoteFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await cargarComisionesEnLoteAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

// ---------------------------------------------------------------------------
// Limpieza de datos de prueba (con respaldo previo) y restauración
// ---------------------------------------------------------------------------

const limpiezaSchema = z.object({
  org_id: zId,
  confirmacion: z.string().trim(),
});

/** Activa, solo dentro de la transacción, la visibilidad de filas en papelera (ver migración 0051/0072). */
async function verPapelera(tx: Tx) {
  await tx.run(`SELECT set_config('app.incluir_eliminados', '1', true)`);
}

/**
 * Da de baja los registros elegidos. En COOVA nada se borra (la app no tiene permiso DELETE sobre
 * socios ni núcleos, ver migración 0051), así que la limpieza es siempre BAJA LÓGICA y reversible:
 *   1. guarda un respaldo COMPLETO (JSON, tabla respaldos_limpieza) de todo lo que va a tocar,
 *      incluido el estado original de cada fila, para poder restaurarlo;
 *   2. usuarios: pasan a baja (activo = 0, estado_cuenta = 'baja'), se sueltan de su núcleo y se
 *      cierran sus membresías en comisiones;
 *   3. socios/núcleos: el socio pasa a estado 'baja' (con su historial) y su núcleo familiar va a la
 *      papelera, así deja de aparecer en Trabajo, horas, asambleas, etc.
 * Todo en una transacción: si algo falla, no se toca nada. Requiere escribir LIMPIAR.
 */
export async function ejecutarLimpiezaPruebaAction(formData: FormData): Promise<string> {
  const d = parseForm(limpiezaSchema, formData);
  if (d.confirmacion !== "LIMPIAR") throw new ValidationError("confirmacion", "Escribí LIMPIAR en mayúsculas para confirmar.");
  const socioIds = [...new Set(formData.getAll("socio_ids").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const userIds = [...new Set(formData.getAll("user_ids").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!socioIds.length && !userIds.length) throw new ValidationError("confirmacion", "No elegiste ningún registro para limpiar.");

  const r = await conCooperativa(d.org_id, async (tx, admin) => {
    // El UPDATE que manda un núcleo a la papelera necesita ver la fila ya marcada (ver db.ts).
    await verPapelera(tx);
    const socios = socioIds.length
      ? await tx.all<Record<string, unknown> & { id: number; estado: string; nucleo_id: number | null; user_id: number | null }>(
          `SELECT * FROM socios WHERE id = ANY(?::int[]) AND estado <> 'baja'`,
          [socioIds]
        )
      : [];
    // Usuarios protegidos: administradores del sistema, de plataforma y quien ejecuta.
    const usuarios = userIds.length
      ? await tx.all<Record<string, unknown> & { id: number }>(
          `SELECT id, nombre, email, rol, activo, estado_cuenta, nucleo_id, telefono, creado_en
             FROM users WHERE id = ANY(?::int[]) AND rol <> 'admin' AND es_platform_admin = false AND id <> ? AND estado_cuenta <> 'baja'`,
          [userIds, admin.id]
        )
      : [];
    if (!socios.length && !usuarios.length) throw new Error("Ninguno de los registros elegidos se puede limpiar (ya no existen o están protegidos).");
    const idsUsuarios = usuarios.map((u) => u.id);
    const idsSocios = socios.map((s) => s.id);
    const nucleosIds = socios.map((s) => s.nucleo_id).filter((n): n is number => !!n);

    const respaldo = {
      generado_en: new Date().toISOString(),
      organization_id: d.org_id,
      socios,
      socio_integrantes: idsSocios.length ? await tx.all(`SELECT * FROM socio_integrantes WHERE socio_id = ANY(?::int[])`, [idsSocios]) : [],
      nucleos_familiares: nucleosIds.length ? await tx.all(`SELECT * FROM nucleos_familiares WHERE id = ANY(?::int[])`, [nucleosIds]) : [],
      users: usuarios,
      comision_miembros: idsUsuarios.length ? await tx.all(`SELECT * FROM comision_miembros WHERE user_id = ANY(?::int[])`, [idsUsuarios]) : [],
    };
    const respaldoId = await insertarTx(tx, "respaldos_limpieza", {
      organization_id: tx.orgId,
      motivo: "Limpieza de datos de prueba",
      creado_por_id: admin.id,
      contenido: JSON.stringify(respaldo),
    });

    for (const uid of idsUsuarios) {
      await tx.run(`UPDATE comision_miembros SET activo = 0, hasta = now()::text WHERE user_id = ? AND activo = 1`, [uid]);
      await tx.run(`UPDATE socios SET user_id = NULL WHERE user_id = ?`, [uid]);
      await tx.run(`UPDATE users SET activo = 0, estado_cuenta = 'baja', nucleo_id = NULL WHERE id = ?`, [uid]);
    }
    const fecha = hoyEnUruguay();
    for (const s of socios) {
      if (s.user_id && !idsUsuarios.includes(s.user_id)) {
        // El usuario no se limpia: solo se lo suelta del núcleo que sale del padrón.
        await tx.run(`UPDATE users SET nucleo_id = NULL WHERE id = ?`, [s.user_id]);
      }
      await tx.run(`UPDATE socios SET estado = 'baja' WHERE id = ?`, [s.id]);
      await insertarTx(tx, "socio_estados", {
        organization_id: tx.orgId,
        socio_id: s.id,
        estado_anterior: s.estado,
        estado_nuevo: "baja",
        fecha,
        motivo: "Limpieza de datos de prueba",
        registrado_por_id: admin.id,
      });
    }
    if (nucleosIds.length) {
      await tx.run(
        `UPDATE nucleos_familiares SET eliminado_en = now()::text, eliminado_por_id = ?, motivo_eliminacion = 'Limpieza de datos de prueba' WHERE id = ANY(?::int[])`,
        [admin.id, nucleosIds]
      );
    }

    await auditarTx(tx, admin, "limpiar_datos_prueba", "respaldos_limpieza", respaldoId, {
      socios_baja: socios.length,
      usuarios_baja: usuarios.length,
      nucleos_ocultos: nucleosIds.length,
      respaldo_id: respaldoId,
    });
    return { respaldoId, socios: socios.length, usuarios: usuarios.length };
  });
  revalidar(d.org_id);
  return `Limpieza hecha. Núcleos dados de baja: ${r.socios}. Usuarios dados de baja: ${r.usuarios}. Respaldo n.º ${r.respaldoId} guardado (se puede restaurar).`;
}
export async function ejecutarLimpiezaPruebaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await ejecutarLimpiezaPruebaAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

/**
 * Deshace una limpieza: devuelve cada socio, núcleo, usuario y membresía al estado que tenía en el
 * respaldo. Si mientras tanto otro núcleo activo tomó el mismo N.º, frena y lo explica (no pisa nada).
 */
export async function restaurarRespaldoLimpiezaAction(formData: FormData): Promise<string> {
  const d = parseForm(z.object({ org_id: zId, id: zId }), formData);
  const r = await conCooperativa(d.org_id, async (tx, admin) => {
    await verPapelera(tx);
    const fila = await tx.get<{ contenido: Record<string, unknown[]>; restaurado_en: string | null }>(
      `SELECT contenido, restaurado_en FROM respaldos_limpieza WHERE id = ?`,
      [d.id]
    );
    if (!fila) throw new Error("Ese respaldo no existe.");
    if (fila.restaurado_en) throw new Error("Ese respaldo ya se restauró.");
    const c = fila.contenido as {
      socios: { id: number; estado: string; user_id: number | null; numero_nucleo: number | null; nombre: string }[];
      nucleos_familiares: { id: number }[];
      users: { id: number; activo: number; estado_cuenta: string; nucleo_id: number | null }[];
      comision_miembros: { id: number; activo: number }[];
    };

    for (const s of c.socios) {
      if (s.numero_nucleo) {
        const choque = await tx.get<{ nombre: string }>(
          `SELECT nombre FROM socios WHERE numero_nucleo = ? AND estado <> 'baja' AND id <> ?`,
          [s.numero_nucleo, s.id]
        );
        if (choque) throw new Error(`No se puede restaurar: el núcleo N.º ${s.numero_nucleo} ahora lo usa ${choque.nombre}.`);
      }
    }
    for (const u of c.users) {
      await tx.run(`UPDATE users SET activo = ?, estado_cuenta = ?, nucleo_id = ? WHERE id = ?`, [u.activo, u.estado_cuenta, u.nucleo_id, u.id]);
    }
    for (const n of c.nucleos_familiares) {
      await tx.run(`UPDATE nucleos_familiares SET eliminado_en = NULL, eliminado_por_id = NULL, motivo_eliminacion = NULL WHERE id = ?`, [n.id]);
    }
    const fecha = hoyEnUruguay();
    for (const s of c.socios) {
      const libre = s.user_id ? !(await tx.get(`SELECT id FROM socios WHERE user_id = ? AND id <> ? AND estado <> 'baja'`, [s.user_id, s.id])) : false;
      await tx.run(`UPDATE socios SET estado = ?, user_id = ? WHERE id = ?`, [s.estado, libre ? s.user_id : null, s.id]);
      await insertarTx(tx, "socio_estados", {
        organization_id: tx.orgId,
        socio_id: s.id,
        estado_anterior: "baja",
        estado_nuevo: s.estado,
        fecha,
        motivo: `Restauración del respaldo n.º ${d.id}`,
        registrado_por_id: admin.id,
      });
    }
    for (const m of c.comision_miembros) {
      if (m.activo !== 1) continue;
      const yaActiva = await tx.get(
        `SELECT 1 AS x FROM comision_miembros a JOIN comision_miembros b ON b.comision_id = a.comision_id AND b.user_id = a.user_id AND b.activo = 1 AND b.id <> a.id WHERE a.id = ?`,
        [m.id]
      );
      if (!yaActiva) await tx.run(`UPDATE comision_miembros SET activo = 1, hasta = NULL WHERE id = ?`, [m.id]);
    }
    await tx.run(`UPDATE respaldos_limpieza SET restaurado_en = now() WHERE id = ?`, [d.id]);
    await auditarTx(tx, admin, "restaurar_respaldo_limpieza", "respaldos_limpieza", d.id, { socios: c.socios.length, usuarios: c.users.length });
    return { socios: c.socios.length, usuarios: c.users.length };
  });
  revalidar(d.org_id);
  return `Respaldo restaurado: ${r.socios} núcleos y ${r.usuarios} usuarios volvieron a como estaban.`;
}
export async function restaurarRespaldoLimpiezaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await restaurarRespaldoLimpiezaAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}
