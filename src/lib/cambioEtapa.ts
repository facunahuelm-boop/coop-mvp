import { all, get } from "@/lib/db";
import { comisionesSugeridas, type Modalidad } from "@/lib/plantillasAlta";
import { comisionDisponibleEnEtapa, ETAPA_LABEL, type EtapaCooperativa } from "@/lib/comisionesFunciones";
import { semanasSinCerrar } from "@/lib/libretaHoras";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Fase 3H — asistente «Cambiar de etapa»: antes de pasar de una etapa a otra,
 * muestra lo que queda pendiente de la etapa que termina, qué cambia en el
 * menú y en las comisiones, y qué conviene preparar para la nueva. Nada se
 * borra: lo de la etapa anterior queda como historial.
 */

export type Pendiente = { texto: string; href?: string };
export type Preparativo = { texto: string; href: string; hecho: boolean };
export type Revision = {
  desde: EtapaCooperativa;
  hacia: EtapaCooperativa;
  pendientes: Pendiente[];
  menu: string[];
  comisionesQueSeOcultan: string[];
  comisionesSugeridas: string[];
  preparativos: Preparativo[];
  ofrecerFondoMantenimiento: boolean;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const cuenta = async (sql: string, params: unknown[] = []) => n((await get<{ n: string }>(sql, params).catch(() => undefined))?.n);

const MENU: Record<EtapaCooperativa, string[]> = {
  pre_obra: ["«¿En qué estamos?» (trámites) queda a la vista de todos"],
  obra: ["Aparecen Avance de obra, Seguridad, QR de asistencia y Mis horas", "«¿En qué estamos?» sigue a la vista"],
  habitada: [
    "Aparecen Reclamos y mantenimiento y Reservas de espacios",
    "Se ocultan Avance de obra, Seguridad, QR de asistencia y Mis horas (los datos quedan; se pueden volver a mostrar desde Configuración → Módulos)",
    "Deja de mostrarse «¿En qué estamos?»",
  ],
};

export async function revisarCambioEtapa(desde: EtapaCooperativa, hacia: EtapaCooperativa, modalidad: Modalidad): Promise<Revision> {
  const hoy = hoyEnUruguay();
  const pendientes: Pendiente[] = [];
  if (desde === "pre_obra") {
    const hitos = await cuenta(`SELECT COUNT(*) AS n FROM tramites_hitos WHERE activo = 1 AND estado NOT IN ('hecho', 'no_aplica')`);
    if (hitos) pendientes.push({ texto: `${hitos} paso(s) de los trámites sin cumplir`, href: "/tramites" });
  }
  if (desde === "obra") {
    const compras = await cuenta(`SELECT COUNT(*) AS n FROM solicitudes_compra WHERE eliminado_en IS NULL AND estado IN ('pendiente_cotizacion', 'en_comparacion', 'aprobada', 'pedida')`);
    if (compras) pendientes.push({ texto: `${compras} compra(s) sin terminar`, href: "/compras" });
    const semanas = await semanasSinCerrar(hoy).catch(() => []);
    if (semanas.length) pendientes.push({ texto: `${semanas.length} semana(s) de horas sin cerrar en la libreta`, href: "/comisiones" });
    const desembolsos = await cuenta(`SELECT COUNT(*) AS n FROM prestamo_desembolsos WHERE estado IN ('previsto', 'solicitado')`);
    if (desembolsos) pendientes.push({ texto: `${desembolsos} desembolso(s) del préstamo sin cobrar`, href: "/obra/avance" });
    const incidentes = await cuenta(`SELECT COUNT(*) AS n FROM incidentes_seguridad WHERE estado = 'abierto'`);
    if (incidentes) pendientes.push({ texto: `${incidentes} incidente(s) de seguridad abiertos`, href: "/seguridad" });
    const prestado = await cuenta(`SELECT COUNT(*) AS n FROM panol_movimientos WHERE tipo = 'prestamo' AND devuelto_en IS NULL AND anulado_en IS NULL`);
    if (prestado) pendientes.push({ texto: `${prestado} herramienta(s) del pañol sin devolver`, href: "/obra/panol" });
  }
  const facturas = await cuenta(`SELECT COUNT(*) AS n FROM facturas_proveedor WHERE estado IN ('pendiente', 'a_pagar')`);
  if (facturas) pendientes.push({ texto: `${facturas} factura(s) a pagar`, href: "/finanzas" });

  const comisiones = await all<{ nombre: string; funcion: string | null; etapas: string | null }>(`SELECT nombre, funcion, etapas FROM comisiones WHERE activa = 1`).catch(() => []);
  const comisionesQueSeOcultan = comisiones.filter((c) => comisionDisponibleEnEtapa(c, desde) && !comisionDisponibleEnEtapa(c, hacia)).map((c) => c.nombre);
  const existentes = new Set(comisiones.map((c) => c.nombre.trim().toLowerCase()));
  const sugeridas = comisionesSugeridas(modalidad, hacia).filter((c) => !existentes.has(c.nombre.toLowerCase())).map((c) => c.nombre);

  const preparativos: Preparativo[] = [];
  if (hacia === "obra") {
    preparativos.push({ texto: "Cargar los rubros de la obra y el plan de avance", href: "/obra/avance", hecho: (await cuenta(`SELECT COUNT(*) AS n FROM obra_rubros WHERE activo = 1`)) > 0 });
    preparativos.push({ texto: "Revisar el horario de obra", href: "/configuracion", hecho: false });
  }
  if (hacia === "habitada") {
    preparativos.push({ texto: "Definir los conceptos de la cuota (fondo de mantenimiento, gastos comunes…)", href: "/conceptos-cuota", hecho: (await cuenta(`SELECT COUNT(*) AS n FROM conceptos_cuota WHERE activo = 1`)) > 0 });
    preparativos.push({ texto: "Cargar los espacios comunes que se pueden reservar", href: "/reservas", hecho: (await cuenta(`SELECT COUNT(*) AS n FROM espacios_comunes WHERE activo = 1`)) > 0 });
    preparativos.push({ texto: "Armar el plan de mantenimiento preventivo", href: "/mantenimiento", hecho: (await cuenta(`SELECT COUNT(*) AS n FROM mantenimiento_preventivo WHERE activo = 1`)) > 0 });
  }
  const hayFondoMant = (await cuenta(`SELECT COUNT(*) AS n FROM fondos WHERE tipo = 'mantenimiento' AND activo = 1`)) > 0;

  return {
    desde,
    hacia,
    pendientes,
    menu: MENU[hacia],
    comisionesQueSeOcultan,
    comisionesSugeridas: sugeridas,
    preparativos,
    ofrecerFondoMantenimiento: hacia === "habitada" && !hayFondoMant,
  };
}

export const textoEtapa = (e: string) => ETAPA_LABEL[e as EtapaCooperativa] ?? e;
