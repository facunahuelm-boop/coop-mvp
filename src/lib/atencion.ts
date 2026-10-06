import { all, get } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canEdit, canApprove, canRead } from "@/lib/roles";
import { obtenerReglamento } from "@/lib/reglamento";
import { semanasSinCerrar } from "@/lib/libretaHoras";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { puedePlanificarHorasTrabajo } from "@/lib/comisionAuth";
import { ROLES_CON_2FA } from "@/lib/totp";

/**
 * Fase 1D — "Lo que necesita tu atención": arriba de todo en el Inicio, las
 * cosas que esta persona tiene que HACER (no números para mirar), según su
 * rol. Cada ítem lleva directo a dónde se resuelve. Máximo 6.
 */

export type ItemAtencion = { texto: string; detalle?: string; href: string; boton: string; tono: "rojo" | "amarillo" | "azul" };

const plural = (n: number, s: string, p: string) => (n === 1 ? s : p);

export async function itemsDeAtencion(user: SessionUser, hoy: string): Promise<ItemAtencion[]> {
  const items: ItemAtencion[] = [];
  const seguro = async <T,>(f: () => Promise<T>, def: T): Promise<T> => {
    try {
      return await f();
    } catch {
      return def;
    }
  };

  // 1) Mis tareas vencidas.
  const vencidas = await seguro(
    async () =>
      Number(
        (await get<{ n: string }>(
          `SELECT COUNT(*) AS n FROM tareas WHERE responsable_id = ? AND estado <> 'completada' AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < ?`,
          [user.id, hoy]
        ))?.n ?? 0
      ),
    0
  );
  if (vencidas) items.push({ texto: `Tenés ${vencidas} ${plural(vencidas, "tarea vencida", "tareas vencidas")}`, href: "/mi-trabajo", boton: "Ver mis tareas", tono: "rojo" });

  // 2) Solicitudes de otras comisiones que esperan respuesta de las mías.
  if (canRead(user.rol, "comisiones")) {
    const solicitudes = await seguro(
      async () =>
        Number(
          (await get<{ n: string }>(
            `SELECT COUNT(*) AS n FROM solicitudes_comision s
              WHERE s.estado IN ('pendiente', 'en_revision', 'esperando_informacion')
                AND (s.responsable_id = ? OR s.comision_destino_id IN (SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1))`,
            [user.id, user.id]
          ))?.n ?? 0
        ),
      0
    );
    if (solicitudes) items.push({ texto: `${solicitudes} ${plural(solicitudes, "solicitud espera", "solicitudes esperan")} respuesta de tu comisión`, href: "/solicitudes", boton: "Responder", tono: "amarillo" });
  }

  // 3) Horas de obra: avisos de ausencia y semanas para cerrar (quien organiza las horas).
  if (user.etapa === "obra") {
    const trabajo = await seguro(() => get<{ id: number }>(`SELECT id FROM comisiones WHERE funcion = 'trabajo' AND activa = 1 ORDER BY id LIMIT 1`), undefined);
    if (trabajo && (await seguro(() => puedePlanificarHorasTrabajo(user, trabajo.id), false))) {
      const avisos = await seguro(async () => Number((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM avisos_ausencia WHERE estado = 'pendiente'`))?.n ?? 0), 0);
      if (avisos) items.push({ texto: `${avisos} ${plural(avisos, "aviso de ausencia para revisar", "avisos de ausencia para revisar")}`, href: `/comisiones/${trabajo.id}?tab=asistencia`, boton: "Revisar", tono: "amarillo" });
      const semanas = (await seguro(() => semanasSinCerrar(hoy), [] as string[])).length;
      if (semanas) items.push({ texto: `${semanas} ${plural(semanas, "semana de horas para cerrar", "semanas de horas para cerrar")}`, detalle: "Cerrarla guarda el saldo de cada núcleo en su libreta.", href: `/comisiones/${trabajo.id}?tab=libreta`, boton: "Cerrar semanas", tono: "azul" });
    }
  }

  // 4) Cuotas (quien maneja Finanzas).
  if (canEdit(user.rol, "finanzas")) {
    const reglamento = await obtenerReglamento();
    const mes = hoy.slice(0, 7);
    if (Number(hoy.slice(8, 10)) >= reglamento.cuotas.diaGeneracion) {
      const hay = await seguro(
        async () =>
          !!(await get<{ id: number }>(
            `SELECT id FROM movimientos_cuenta_socio WHERE tipo = 'cargo' AND convenio_id IS NULL AND substr(fecha_vencimiento, 1, 7) = ? AND COALESCE(estado, 'activo') <> 'anulado' LIMIT 1`,
            [mes]
          )),
        true
      );
      if (!hay) items.push({ texto: "Todavía no se generaron las cuotas de este mes", detalle: reglamento.cuotas.automaticas ? "Se generan solas: revisá el monto en el reglamento." : "Podés generarlas con un botón, o dejar que se generen solas.", href: "/reglamento", boton: "Ir a cuotas", tono: "amarillo" });
    }
    const atrasados = await seguro(async () => {
      const socios = await all<{ id: number }>(`SELECT id FROM socios WHERE estado = 'activo'`);
      let n = 0;
      for (const s of socios) {
        const { cuotas } = calcularCuotasSocio(await cargarMovimientosCuenta(s.id));
        if (cuotas.filter((c) => c.estado === "vencida" && c.montoPendiente > 0).length >= 2) n++;
      }
      return n;
    }, 0);
    if (atrasados) items.push({ texto: `${atrasados} ${plural(atrasados, "núcleo tiene", "núcleos tienen")} 2 o más cuotas atrasadas`, detalle: "Conviene hablar con ellos o proponer un convenio.", href: "/finanzas", boton: "Ver cuotas atrasadas", tono: "rojo" });
  }

  // 5) Compras que esperan una decisión.
  if (canApprove(user.rol, "compras")) {
    const compras = await seguro(async () => Number((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM solicitudes_compra WHERE estado = 'en_comparacion'`))?.n ?? 0), 0);
    if (compras) items.push({ texto: `${compras} ${plural(compras, "compra espera", "compras esperan")} una decisión`, href: "/compras", boton: "Decidir", tono: "amarillo" });
  }

  // 6) Documentos vencidos.
  if (canEdit(user.rol, "documentos")) {
    const docs = await seguro(
      async () => Number((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM documentos WHERE fecha_vencimiento IS NOT NULL AND fecha_vencimiento < ? AND COALESCE(estado, 'vigente') = 'vigente'`, [hoy]))?.n ?? 0),
      0
    );
    if (docs) items.push({ texto: `${docs} ${plural(docs, "documento vencido", "documentos vencidos")}`, detalle: "Seguros, certificados o habilitaciones para renovar.", href: "/documentos?estado=vencido", boton: "Ver documentos", tono: "rojo" });
  }

  // 7) Reglamento sin configurar (admin / Consejo).
  if (["admin", "consejo_directivo"].includes(user.rol)) {
    const r = await obtenerReglamento();
    if (!r.cuotas.automaticas && !(r.cuotas.monto > 0) && !r.ayuda.telefono) {
      items.push({ texto: "Completá el reglamento de la cooperativa", detalle: "Cuotas, atrasos, avisos y el teléfono de ayuda para los socios.", href: "/reglamento", boton: "Completar", tono: "azul" });
    }
  }

  // 8) Cuentas sensibles sin verificación en dos pasos.
  if ((ROLES_CON_2FA as readonly string[]).includes(user.rol) && !user.totp_activo) {
    items.push({ texto: "Protegé tu cuenta con la verificación en dos pasos", detalle: "Tu rol maneja dinero o datos de los socios. Lleva 2 minutos.", href: "/mi-seguridad", boton: "Activar", tono: "azul" });
  }

  const orden = { rojo: 0, amarillo: 1, azul: 2 } as const;
  return items.sort((a, b) => orden[a.tono] - orden[b.tono]).slice(0, 6);
}
