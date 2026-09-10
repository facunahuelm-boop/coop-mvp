"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, get, all, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enviarEmailPersonalizado } from "@/lib/email";
import { parseForm, zIdOpcional, zTexto } from "@/lib/validation";

// Sección de Mails (pedido explícito): cualquier persona logueada puede
// mandarle un mail a otro usuario puntual o a todos los integrantes activos
// de una comisión de una sola vez. Mismo criterio "uno u otro" que ya usa
// agregarPresupuestoAction (compras.ts) con proveedor_id/nuevo_proveedor: el
// formulario muestra los dos campos (elegir usuario / elegir comisión) y acá
// se valida que se haya completado exactamente uno de los dos, sin agregar
// un selector con JavaScript.

const enviarMailSchema = z.object({
  usuario_id: zIdOpcional,
  comision_id: zIdOpcional,
  asunto: zTexto(200),
  cuerpo: zTexto(5000),
});

export async function enviarMailAction(formData: FormData) {
  const user = await requireUser();
  const { usuario_id: usuarioId, comision_id: comisionId, asunto, cuerpo } = parseForm(enviarMailSchema, formData);

  if (!usuarioId && !comisionId) throw new Error("Elegí un usuario o una comisión para mandar el mail.");
  if (usuarioId && comisionId) throw new Error("Elegí un usuario o una comisión, no las dos cosas.");

  let destinatarioTipo: "usuario" | "comision";
  let destinatarioId: number;
  let destinatarioNombre: string;
  let emails: string[];

  if (usuarioId) {
    const destinatario = await get<{ nombre: string; email: string | null }>(
      `SELECT nombre, email FROM users WHERE id = ? AND activo = 1`,
      [usuarioId]
    );
    if (!destinatario) throw new Error("Ese usuario no existe o está inactivo.");
    if (!destinatario.email) throw new Error(`${destinatario.nombre} no tiene un email cargado — no se puede mandar.`);
    destinatarioTipo = "usuario";
    destinatarioId = usuarioId;
    destinatarioNombre = destinatario.nombre;
    emails = [destinatario.email];
  } else {
    const comision = await get<{ nombre: string }>(`SELECT nombre FROM comisiones WHERE id = ? AND activa = 1`, [comisionId]);
    if (!comision) throw new Error("Esa comisión no existe o está archivada.");
    const miembros = await all<{ email: string | null }>(
      `SELECT u.email FROM comision_miembros m JOIN users u ON u.id = m.user_id AND u.activo = 1 WHERE m.comision_id = ? AND m.activo = 1`,
      [comisionId]
    );
    emails = miembros.map((m) => m.email).filter((e): e is string => !!e);
    if (emails.length === 0) throw new Error(`La comisión "${comision.nombre}" no tiene integrantes con email cargado.`);
    destinatarioTipo = "comision";
    destinatarioId = comisionId!;
    destinatarioNombre = `Comisión ${comision.nombre}`;
  }

  await enviarEmailPersonalizado(emails, asunto, cuerpo, user.nombre);

  const id = await insert("mensajes_correo", {
    remitente_id: user.id,
    destinatario_tipo: destinatarioTipo,
    destinatario_id: destinatarioId,
    destinatario_nombre: destinatarioNombre,
    asunto,
    cuerpo,
    cantidad_destinatarios: emails.length,
  });
  await audit({
    usuario_id: user.id,
    accion: "enviar",
    entidad: "mensajes_correo",
    entidad_id: id,
    valor_nuevo: { destinatario: destinatarioNombre, asunto, cantidad_destinatarios: emails.length },
  });
  revalidatePath("/mails");
}
