import { all, get } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { cargarLibretas } from "@/lib/libretaHoras";
import { saldosPor } from "@/lib/finanzasLibro";
import { hoyEnUruguay, sumarDias } from "@/lib/horasObra";

/**
 * Fase 3I — semáforo de salud de la cooperativa: unos pocos indicadores, cada
 * uno en verde, amarillo o rojo, con el número y a dónde ir para mejorarlo.
 * Todo sale de lo que ya está cargado; si falta información, el indicador
 * queda en gris («sin datos») en vez de inventar.
 */

export type Color = "verde" | "amarillo" | "rojo" | "gris";
export type Indicador = { clave: string; titulo: string; valor: string; detalle: string; color: Color; href: string };

const n = (v: unknown) => Number(v ?? 0) || 0;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const seguro = async <T,>(f: () => Promise<T>, def: T): Promise<T> => {
  try {
    return await f();
  } catch {
    return def;
  }
};
const semaforo = (v: number | null, verde: number, amarillo: number, mayorEsMejor = true): Color => {
  if (v == null) return "gris";
  return mayorEsMejor ? (v >= verde ? "verde" : v >= amarillo ? "amarillo" : "rojo") : v <= verde ? "verde" : v <= amarillo ? "amarillo" : "rojo";
};

export function veSalud(user: SessionUser): boolean {
  return canEdit(user.rol, "finanzas") || ["consejo_directivo", "fiscal", "admin"].includes(user.rol);
}

export async function saludCooperativa(etapa: string): Promise<Indicador[]> {
  const hoy = hoyEnUruguay();
  const out: Indicador[] = [];

  // 1) Cuotas al día
  const cuotas = await seguro(async () => {
    const socios = await all<{ id: number }>(`SELECT id FROM socios WHERE estado IN ('activo', 'suspendido')`);
    let alDia = 0;
    for (const s of socios) {
      const { cuotas } = calcularCuotasSocio(await cargarMovimientosCuenta(s.id));
      if (!cuotas.some((c) => c.estado === "vencida" && c.montoPendiente > 0.004)) alDia++;
    }
    return { alDia, total: socios.length };
  }, { alDia: 0, total: 0 });
  const pCuotas = pct(cuotas.alDia, cuotas.total);
  out.push({ clave: "cuotas", titulo: "Cuotas al día", valor: pCuotas == null ? "—" : `${pCuotas} %`, detalle: `${cuotas.alDia} de ${cuotas.total} socios sin cuotas vencidas`, color: semaforo(pCuotas, 85, 70), href: "/finanzas" });

  // 2) Plata disponible: cuántos meses de gastos cubre el saldo de las cuentas
  const liquidez = await seguro(async () => {
    const saldo = (await saldosPor("cuenta")).reduce((a, c) => a + c.saldo, 0);
    const g = await get<{ total: string | null }>(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM movimientos_financieros WHERE tipo = 'egreso' AND transferencia_id IS NULL AND COALESCE(estado, 'activo') <> 'anulado' AND left(fecha::text, 10) > ?`,
      [sumarDias(hoy, -90)]
    );
    const mensual = n(g?.total) / 3;
    return { saldo, meses: mensual > 0 ? Math.round((saldo / mensual) * 10) / 10 : null };
  }, { saldo: 0, meses: null as number | null });
  out.push({
    clave: "liquidez",
    titulo: "Plata disponible",
    valor: liquidez.meses == null ? "—" : `${liquidez.meses.toLocaleString("es-UY")} meses`,
    detalle: liquidez.meses == null ? "Sin gastos en los últimos 3 meses para comparar" : "de gastos cubiertos con el saldo de las cuentas",
    color: semaforo(liquidez.meses, 3, 1),
    href: "/finanzas",
  });

  // 3) Cierres del mes
  const cierre = await seguro(async () => {
    const [y, m] = hoy.split("-").map(Number);
    const anterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const p = await get<{ estado: string }>(`SELECT estado FROM periodos_financieros WHERE periodo = ?`, [anterior]);
    return p?.estado ?? "abierto";
  }, "sin datos");
  out.push({
    clave: "cierre",
    titulo: "Cierre del mes pasado",
    valor: cierre === "visado" ? "Cerrado y visado" : cierre === "cerrado" ? "Cerrado" : cierre === "sin datos" ? "—" : "Sin cerrar",
    detalle: cierre === "cerrado" ? "falta el visto de la Fiscal" : cierre === "visado" ? "la Fiscal ya lo revisó" : "",
    color: cierre === "visado" ? "verde" : cierre === "cerrado" ? "amarillo" : cierre === "sin datos" ? "gris" : Number(hoy.slice(8, 10)) > 15 ? "rojo" : "amarillo",
    href: "/finanzas/cierre",
  });

  // 4) Horas de ayuda mutua (obra)
  if (etapa === "obra") {
    const libretas = await seguro(() => cargarLibretas(hoy), []);
    const alDia = libretas.filter((l) => l.saldoAcumuladoMin >= 0).length;
    const p = pct(alDia, libretas.length);
    out.push({ clave: "horas", titulo: "Horas al día", valor: p == null ? "—" : `${p} %`, detalle: `${alDia} de ${libretas.length} núcleos sin deuda de horas`, color: semaforo(p, 85, 70), href: "/comisiones" });
    const ultimo = await seguro(() => get<{ f: string | null }>(`SELECT MAX(left(fecha::text, 10)) AS f FROM incidentes_seguridad WHERE tipo IN ('incidente', 'accidente')`), undefined);
    const dias = ultimo?.f ? Math.max(0, Math.round((Date.parse(hoy) - Date.parse(ultimo.f)) / 86400000)) : null;
    out.push({ clave: "seguridad", titulo: "Días sin incidentes", valor: dias == null ? "Ninguno" : String(dias), detalle: "en la obra", color: dias == null ? "verde" : semaforo(dias, 30, 7), href: "/seguridad" });
  }

  // 5) Mantenimiento (habitada)
  if (etapa === "habitada") {
    const viejos = await seguro(async () => n((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM reclamos WHERE estado NOT IN ('resuelto', 'cerrado') AND left(fecha, 10) < ?`, [sumarDias(hoy, -30)]))?.n), 0);
    const atrasado = await seguro(async () => n((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM mantenimiento_preventivo WHERE activo = 1 AND proxima_fecha < ?`, [hoy]))?.n), 0);
    out.push({ clave: "mantenimiento", titulo: "Mantenimiento", valor: viejos + atrasado === 0 ? "Al día" : `${viejos + atrasado} atrasados`, detalle: `${viejos} reclamos de más de 30 días · ${atrasado} preventivos atrasados`, color: semaforo(viejos + atrasado, 0, 3, false), href: "/reclamos" });
  }

  // 6) Participación en la última asamblea
  const asamblea = await seguro(
    () =>
      get<{ titulo: string; habilitados: string; presentes: string }>(
        `SELECT r.titulo, COUNT(p.id) FILTER (WHERE p.habilitado = 1) AS habilitados, COUNT(p.id) FILTER (WHERE p.habilitado = 1 AND p.presente = 1) AS presentes
           FROM reuniones r JOIN asamblea_padron p ON p.reunion_id = r.id WHERE r.tipo = 'asamblea' AND r.estado = 'realizada'
          GROUP BY r.id, r.titulo, r.fecha ORDER BY r.fecha DESC LIMIT 1`
      ),
    undefined
  );
  const pAsis = asamblea ? pct(n(asamblea.presentes), n(asamblea.habilitados)) : null;
  out.push({ clave: "participacion", titulo: "Participación", valor: pAsis == null ? "—" : `${pAsis} %`, detalle: asamblea ? `vino a «${asamblea.titulo}»` : "Todavía no hay asambleas con padrón", color: semaforo(pAsis, 50, 30), href: "/asambleas" });

  // 7) Tareas vencidas (todas las comisiones)
  const tareas = await seguro(
    () => get<{ pendientes: string; vencidas: string }>(`SELECT COUNT(*) FILTER (WHERE estado <> 'completada') AS pendientes, COUNT(*) FILTER (WHERE estado <> 'completada' AND fecha_vencimiento < ?) AS vencidas FROM tareas`, [hoy]),
    undefined
  );
  const pVenc = tareas ? pct(n(tareas.vencidas), n(tareas.pendientes)) : null;
  out.push({ clave: "tareas", titulo: "Tareas vencidas", valor: pVenc == null ? "—" : `${pVenc} %`, detalle: tareas ? `${n(tareas.vencidas)} de ${n(tareas.pendientes)} pendientes` : "", color: pVenc == null ? "verde" : semaforo(pVenc, 10, 25, false), href: "/comisiones" });

  // 8) Documentos vencidos
  const docs = await seguro(async () => n((await get<{ n: string }>(`SELECT COUNT(*) AS n FROM documentos WHERE eliminado_en IS NULL AND COALESCE(estado, 'vigente') <> 'reemplazado' AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < ?`, [hoy]))?.n), 0);
  out.push({ clave: "documentos", titulo: "Documentos vencidos", valor: String(docs), detalle: docs ? "seguros, habilitaciones, certificados…" : "todo vigente", color: semaforo(docs, 0, 2, false), href: "/documentos?estado=vencido" });

  return out;
}

export function colorGeneral(ind: Indicador[]): Color {
  const c = ind.map((i) => i.color);
  if (c.filter((x) => x === "rojo").length >= 2) return "rojo";
  if (c.includes("rojo") || c.filter((x) => x === "amarillo").length >= 2) return "amarillo";
  return "verde";
}
