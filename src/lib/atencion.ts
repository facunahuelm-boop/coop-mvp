import { all, get } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canEdit, canApprove, canRead } from "@/lib/roles";
import { obtenerReglamento } from "@/lib/reglamento";
import { semanasSinCerrar } from "@/lib/libretaHoras";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { puedePlanificarHorasTrabajo } from "@/lib/comisionAuth";
import { ROLES_CON_2FA } from "@/lib/totp";
import { temasParaElConsejo, mandatosVencidosSinRevisar } from "@/lib/consejo";
import { cuentasSensiblesInactivas, DIAS_INACTIVIDAD } from "@/lib/inactividad";
import { conveniosConCuotaImpaga } from "@/lib/conveniosAtraso";
import { estadoAlta } from "@/lib/alta";
import { proveedoresConDocVencida } from "@/lib/proveedoresDocs";

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
            `SELECT id FROM movimientos_cuenta_socio WHERE tipo = 'cargo' AND convenio_id IS NULL AND substr(fecha_vencimiento::text, 1, 7) = ? AND COALESCE(estado, 'activo') <> 'anulado' LIMIT 1`,
            [mes]
          )),
        true
      );
      if (!hay) items.push({ texto: "Todavía no se generaron las cuotas de este mes", detalle: reglamento.cuotas.automaticas ? "Se generan solas: revisá el monto en el reglamento." : "Podés generarlas con un botón, o dejar que se generen solas.", href: "/reglamento", boton: "Ir a cuotas", tono: "amarillo" });
    }
    const atrasados = await seguro(async () => {
      const socios = await all<{ id: number }>(`SELECT id FROM socios WHERE estado IN ('activo', 'suspendido', 'renunciante')`);
      let n = 0;
      for (const s of socios) {
        const { cuotas } = calcularCuotasSocio(await cargarMovimientosCuenta(s.id));
        if (cuotas.filter((c) => c.estado === "vencida" && c.montoPendiente > 0).length >= 2) n++;
      }
      return n;
    }, 0);
    if (atrasados) items.push({ texto: `${atrasados} ${plural(atrasados, "núcleo tiene", "núcleos tienen")} 2 o más cuotas atrasadas`, detalle: "Conviene hablar con ellos o proponer un convenio.", href: "/finanzas", boton: "Ver cuotas atrasadas", tono: "rojo" });
  }

  // Fase 2C: socios nuevos con el ingreso sin terminar (A23).
  if (canEdit(user.rol, "socios")) {
    const ingresos = await seguro(
      async () =>
        Number(
          (await get<{ n: string }>(
            `SELECT COUNT(DISTINCT s.id) AS n FROM socios s JOIN checklist_ingreso c ON c.socio_id = s.id
              WHERE s.ingreso_completo_en IS NULL AND s.estado IN ('aspirante', 'activo') AND c.hecho = 0
                AND c.item NOT IN ('documentos', 'nucleo', 'usuario')`
          ))?.n ?? 0
        ),
      0
    );
    if (ingresos) items.push({ texto: `${ingresos} ${plural(ingresos, "socio nuevo tiene", "socios nuevos tienen")} el ingreso sin terminar`, detalle: "Documentos, bienvenida, inducción…", href: "/socios#ingreso-pendiente", boton: "Ver socios", tono: "azul" });
  }

  // Fase 2D: temas para el Consejo y mandatos vencidos (decide el admin).
  if (user.rol === "consejo_directivo") {
    const temas = await seguro(async () => (await temasParaElConsejo()).length, 0);
    if (temas) items.push({ texto: `${temas} ${plural(temas, "tema espera", "temas esperan")} una decisión del Consejo`, detalle: "Con un botón se arma el orden del día.", href: "/consejo-directivo", boton: "Ver temas", tono: "amarillo" });
  }
  if (user.rol === "admin") {
    const vencidos = await seguro(async () => (await mandatosVencidosSinRevisar()).length, 0);
    if (vencidos) items.push({ texto: `${vencidos} ${plural(vencidos, "mandato venció", "mandatos vencieron")}: revisar permisos`, href: "/consejo-directivo", boton: "Revisar", tono: "rojo" });
    // Fase 2H: asistente de alta sin terminar.
    const alta = await seguro(() => estadoAlta(user.organization_id), null);
    if (alta && !alta.completada)
      items.push({ texto: `Terminá de preparar tu cooperativa (${alta.hechos} de 5 pasos)`, detalle: "Datos, reglamento, socios, comisiones e invitaciones.", href: "/alta", boton: "Seguir", tono: "azul" });
    // Fase 2F — A26: cuentas con permisos sensibles sin uso.
    const inactivas = await seguro(() => cuentasSensiblesInactivas(hoy), []);
    if (inactivas.length)
      items.push({
        texto: `${inactivas.length} ${plural(inactivas.length, "cuenta con permisos sensibles no se usa", "cuentas con permisos sensibles no se usan")} hace más de ${DIAS_INACTIVIDAD} días`,
        detalle: inactivas.slice(0, 3).map((u) => u.nombre).join(", ") + ". Conviene desactivarlas o cambiarles el rol.",
        href: "/usuarios",
        boton: "Revisar",
        tono: "amarillo",
      });
  }

  // Fase 2G: proveedores con documentación vencida (para Compras).
  if (user.rol === "comision_compras" || user.rol === "tesoreria") {
    const vencidos = await seguro(async () => (await proveedoresConDocVencida(hoy)).size, 0);
    if (vencidos) items.push({ texto: `${vencidos} ${plural(vencidos, "proveedor tiene", "proveedores tienen")} documentación vencida`, detalle: "Pediles los certificados nuevos.", href: "/proveedores", boton: "Ver", tono: "amarillo" });
  }

  // Fase 2F: avisos oficiales sin leer.
  {
    const sinLeer = await seguro(
      async () => Number((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM aviso_destinatarios d JOIN avisos a ON a.id = d.aviso_id WHERE d.user_id = ? AND d.leido_en IS NULL AND a.anulado_en IS NULL`, [user.id]))?.n ?? 0),
      0
    );
    if (sinLeer) items.push({ texto: `Tenés ${sinLeer} ${plural(sinLeer, "aviso oficial sin leer", "avisos oficiales sin leer")}`, href: "/avisos", boton: "Leer", tono: "azul" });
  }

  // Fase 2E: pasos de trámites que pasaron su fecha.
  if (user.rol === "consejo_directivo" || user.rol === "admin" || user.rol === "tecnico") {
    const hitos = await seguro(
      async () =>
        Number(
          (await get<{ n: string }>(
            `SELECT COUNT(*) AS n FROM tramites_hitos WHERE activo = 1 AND estado IN ('pendiente', 'en_curso', 'trabado') AND fecha_estimada IS NOT NULL AND fecha_estimada < ?`,
            [hoy]
          ))?.n ?? 0
        ),
      0
    );
    if (hitos) items.push({ texto: `${hitos} ${plural(hitos, "paso de los trámites pasó", "pasos de los trámites pasaron")} su fecha`, detalle: "Actualizá cómo vienen.", href: "/tramites", boton: "Ver trámites", tono: "amarillo" });
  }

  // 5) Compras que esperan una decisión.
  // Fase 2A: facturas a pagar, cierre del mes y visto de la Fiscal.
  if (canEdit(user.rol, "finanzas")) {
    const en3 = new Date(new Date(hoy + "T12:00:00Z").getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const fact = await seguro(
      async () =>
        await get<{ vencidas: string; proximas: string }>(
          `SELECT COUNT(*) FILTER (WHERE fecha_vencimiento < ?) AS vencidas, COUNT(*) FILTER (WHERE fecha_vencimiento >= ? AND fecha_vencimiento <= ?) AS proximas
             FROM facturas_proveedor WHERE estado = 'a_pagar' AND fecha_vencimiento IS NOT NULL`,
          [hoy, hoy, en3]
        ),
      undefined
    );
    const fv = Number(fact?.vencidas ?? 0);
    const fp = Number(fact?.proximas ?? 0);
    // Fase 2B: líneas del banco para conciliar.
    const banco = await seguro(async () => Number((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM extracto_lineas WHERE estado = 'pendiente'`))?.n ?? 0), 0);
    if (banco) items.push({ texto: `${banco} ${plural(banco, "línea del banco espera", "líneas del banco esperan")} que la concilies`, href: "/finanzas/conciliacion", boton: "Conciliar", tono: "azul" });
    if (fv) items.push({ texto: `${fv} ${plural(fv, "factura vencida", "facturas vencidas")} sin pagar`, href: "/finanzas?tab=pagar", boton: "Ver facturas", tono: "rojo" });
    else if (fp) items.push({ texto: `${fp} ${plural(fp, "factura vence", "facturas vencen")} en los próximos 3 días`, href: "/finanzas?tab=pagar", boton: "Ver facturas", tono: "amarillo" });
  }
  if (user.rol === "tesoreria" || user.rol === "admin") {
    const reglamento = await obtenerReglamento();
    // Fase 2G — A17: convenios con cuota impaga.
    const atrasados = await seguro(() => conveniosConCuotaImpaga(reglamento.cuotas.diasGracia), []);
    if (atrasados.length)
      items.push({
        texto: `${atrasados.length} ${plural(atrasados.length, "convenio tiene", "convenios tienen")} cuotas sin pagar`,
        detalle: atrasados.slice(0, 3).map((c) => c.nombre).join(", "),
        href: `/socios/${atrasados[0].socioId}`,
        boton: "Ver",
        tono: "rojo",
      });
    const [y, m] = hoy.slice(0, 7).split("-").map(Number);
    const anterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    if (Number(hoy.slice(8, 10)) >= reglamento.finanzas.avisoCierreDia) {
      const sinCerrar = await seguro(
        async () =>
          await get<{ movs: string; estado: string | null; observacion: string | null }>(
            `SELECT (SELECT COUNT(*) FROM movimientos_financieros WHERE left(fecha::text, 7) = ?) AS movs,
                    (SELECT estado FROM periodos_financieros WHERE periodo = ?) AS estado,
                    (SELECT observacion_fiscal FROM periodos_financieros WHERE periodo = ?) AS observacion`,
            [anterior, anterior, anterior]
          ),
        undefined
      );
      if (sinCerrar && Number(sinCerrar.movs) > 0 && (sinCerrar.estado ?? "abierto") === "abierto") {
        items.push({
          texto: sinCerrar.observacion ? "La Fiscal devolvió el cierre del mes pasado con una observación" : "Falta cerrar el mes pasado",
          detalle: sinCerrar.observacion ?? "Al cerrarlo, los números de ese mes quedan firmes y la Fiscal puede darle el visto.",
          href: "/finanzas/cierre",
          boton: "Ir al cierre",
          tono: sinCerrar.observacion ? "rojo" : "amarillo",
        });
      }
    }
  }
  if (user.rol === "fiscal") {
    const paraVisar = await seguro(async () => Number((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM periodos_financieros WHERE estado = 'cerrado'`))?.n ?? 0), 0);
    if (paraVisar) items.push({ texto: `${paraVisar} ${plural(paraVisar, "mes cerrado espera", "meses cerrados esperan")} tu visto`, href: "/finanzas/cierre", boton: "Revisar", tono: "amarillo" });
  }

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
