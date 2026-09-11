"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, get, all, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enviarEmailPersonalizado } from "@/lib/email";
import { parseForm, zIdOpcional, zTexto, zCheckbox } from "@/lib/validation";

// Sección de Mails (pedido explícito): mandarle un mail a un usuario
// puntual, a todos los integrantes activos de una comisión, o a todos los
// usuarios activos de la cooperativa de una sola vez. Mismo criterio "elegí
// uno de los tres" que ya usa Compras con proveedor_id/nuevo_proveedor: el
// formulario muestra las tres opciones (usuario / comisión / todos) y acá se
// valida que se haya elegido exactamente una, sin agregar un selector con
// JavaScript.
//
// Mandarle a "todos" queda reservado a Admin/Consejo Directivo — a
// diferencia de escribirle a una persona o a una comisión puntual (que
// cualquiera puede hacer), un mail a TODA la cooperativa es, en los hechos,
// una comunicación institucional.

const enviarMailSchema = z.object({
  usuario_id: zIdOpcional,
  comision_id: zIdOpcional,
  todos: zCheckbox,
  asunto: zTexto(200),
  cuerpo: zTexto(5000),
});

type DestinatarioInfo = { nombre: string; email: string };

export async function enviarMailAction(formData: FormData) {
  const user = await requireUser();
  const { usuario_id: usuarioId, comision_id: comisionId, todos, asunto, cuerpo } = parseForm(enviarMailSchema, formData);

  const opcionesElegidas = [usuarioId ? 1 : 0, comisionId ? 1 : 0, todos ? 1 : 0].reduce((a, b) => a + b, 0);
  if (opcionesElegidas === 0) throw new Error("Elegí a quién mandarle el mail: un usuario, una comisión, o todos.");
  if (opcionesElegidas > 1) throw new Error("Elegí un solo destino — un usuario, una comisión, o todos — no varios a la vez.");
  if (todos && !["admin", "consejo_directivo"].includes(user.rol)) {
    throw new Error("Mandarle un mail a todos los usuarios está reservado a Admin y Consejo Directivo.");
  }

  let destinatarioTipo: "usuario" | "comision" | "todos";
  let destinatarioId: number | null;
  let destinatarioNombre: string;
  let destinatarios: DestinatarioInfo[];

  if (todos) {
    const usuarios = await all<{ nombre: string; email: string | null }>(`SELECT nombre, email FROM users WHERE activo = 1`);
    destinatarios = usuarios.filter((u): u is { nombre: string; email: string } => !!u.email);
    if (destinatarios.length === 0) throw new Error("Ningún usuario activo tiene un email cargado.");
    destinatarioTipo = "todos";
    destinatarioId = null;
    destinatarioNombre = "Todos los usuarios";
  } else if (usuarioId) {
    const destinatario = await get<{ nombre: string; email: string | null }>(
      `SELECT nombre, email FROM users WHERE id = ? AND activo = 1`,
      [usuarioId]
    );
    if (!destinatario) throw new Error("Ese usuario no existe o está inactivo.");
    if (!destinatario.email) throw new Error(`${destinatario.nombre} no tiene un email cargado — no se puede mandar.`);
    destinatarioTipo = "usuario";
    destinatarioId = usuarioId;
    destinatarioNombre = destinatario.nombre;
    destinatarios = [{ nombre: destinatario.nombre, email: destinatario.email }];
  } else {
    const comision = await get<{ nombre: string }>(`SELECT nombre FROM comisiones WHERE id = ? AND activa = 1`, [comisionId]);
    if (!comision) throw new Error("Esa comisión no existe o está archivada.");
    const miembros = await all<{ nombre: string; email: string | null }>(
      `SELECT u.nombre, u.email FROM comision_miembros m JOIN users u ON u.id = m.user_id AND u.activo = 1 WHERE m.comision_id = ? AND m.activo = 1`,
      [comisionId]
    );
    destinatarios = miembros.filter((m): m is { nombre: string; email: string } => !!m.email);
    if (destinatarios.length === 0) throw new Error(`La comisión "${comision.nombre}" no tiene integrantes con email cargado.`);
    destinatarioTipo = "comision";
    destinatarioId = comisionId!;
    destinatarioNombre = `Comisión ${comision.nombre}`;
  }

  // Antes, si el envío fallaba (SMTP caído, credenciales vencidas, etc.),
  // enviarEmailPersonalizado tiraba una excepción y la función terminaba ahí:
  // no quedaba ningún registro de que se había intentado, y la persona solo
  // veía la pantalla de error genérica de Next.js, sin saber si el mail salió
  // o no. Ahora SIEMPRE queda un registro en el historial — "enviado" o
  // "fallido" con el motivo real — y recién después, si falló, se avisa con
  // un mensaje claro (ver migrations/0021_mensajes_correo_estado.sql).
  const resultado = await enviarEmailPersonalizado(
    destinatarios.map((d) => d.email),
    asunto,
    cuerpo,
    user.nombre
  );

  try {
    const id = await insert("mensajes_correo", {
      remitente_id: user.id,
      destinatario_tipo: destinatarioTipo,
      destinatario_id: destinatarioId,
      destinatario_nombre: destinatarioNombre,
      asunto,
      cuerpo,
      cantidad_destinatarios: destinatarios.length,
      destinatarios,
      estado: resultado.ok ? "enviado" : "fallido",
      error: resultado.error || null,
      origen: "manual",
    });
    await audit({
      usuario_id: user.id,
      accion: resultado.ok ? "enviar" : "enviar_fallido",
      entidad: "mensajes_correo",
      entidad_id: id,
      valor_nuevo: { destinatario: destinatarioNombre, asunto, cantidad_destinatarios: destinatarios.length, error: resultado.error },
    });
  } catch (err) {
    // Si esta tabla no existe todavía (migración sin correr), no debe tapar
    // el resultado real del envío — solo se pierde el registro en el
    // historial, no la información de si salió bien o mal.
    console.error("[mails] No se pudo guardar el intento de envío en el historial:", err);
  }

  if (!resultado.ok) {
    throw new Error(`No se pudo enviar el mail: ${resultado.error || "el servidor de correo rechazó el envío"}. Revisá la Configuración de Email, o intentá de nuevo más tarde — este intento ya quedó registrado como fallido en el historial.`);
  }

  revalidatePath("/mails");
}
