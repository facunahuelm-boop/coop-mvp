import { all } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { hoyEnUruguay, sumarDias } from "@/lib/horasObra";
import { CARGO_LABEL, type CargoConsejo } from "@/lib/consejoDirectivoCargos";
import { conveniosConCuotaImpaga } from "@/lib/conveniosAtraso";
import { obtenerReglamento } from "@/lib/reglamento";

/**
 * Fase 2D — bandeja «Necesita decisión del Consejo» (plan, 8.7) y mandatos.
 * Junta en un solo lugar lo que espera al Consejo; con un botón se arma el
 * orden del día de la próxima reunión.
 */

export type TemaConsejo = { clave: string; tipo: string; texto: string; detalle?: string; href: string };

export const TIPO_TEMA_LABEL: Record<string, string> = {
  compra: "Compra para aprobar",
  decision: "Decisión pendiente",
  renuncia: "Renuncia para aceptar",
  morosidad: "Atraso en cuotas (A5)",
  mandato: "Mandato por vencer",
  convenio: "Convenio incumplido",
  convenio_atraso: "Cuota de convenio impaga (A17)",
};

export async function temasParaElConsejo(): Promise<TemaConsejo[]> {
  const hoy = hoyEnUruguay();
  const en60 = sumarDias(hoy, 60);
  const [compras, decisiones, renuncias, mandatos, convenios, movs, socios] = await Promise.all([
    all<{ id: number; material: string; n: string }>(
      `SELECT s.id, s.material, (SELECT COUNT(*) FROM presupuestos_proveedor p WHERE p.solicitud_id = s.id) AS n
         FROM solicitudes_compra s WHERE s.estado = 'en_comparacion' ORDER BY s.id`
    ).catch(() => []),
    all<{ id: number; tema: string; comision: string | null }>(
      `SELECT d.id, d.tema, c.nombre AS comision FROM decisiones_comision d LEFT JOIN comisiones c ON c.id = d.comision_id WHERE d.resultado = 'pendiente' ORDER BY d.fecha`
    ).catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado = 'renunciante' ORDER BY nombre`).catch(() => []),
    all<{ id: number; cargo: CargoConsejo; nombre: string; fecha_fin_prevista: string }>(
      `SELECT c.id, c.cargo, u.nombre, c.fecha_fin_prevista FROM consejo_directivo_cargos c JOIN users u ON u.id = c.user_id
        WHERE c.fecha_fin IS NULL AND c.fecha_fin_prevista IS NOT NULL AND c.fecha_fin_prevista <= ? ORDER BY c.fecha_fin_prevista`,
      [en60]
    ).catch(() => []),
    all<{ id: number; socio_id: number; nombre: string; motivo: string }>(
      `SELECT cv.id, cv.socio_id, s.nombre, cv.motivo FROM convenios_pago cv JOIN socios s ON s.id = cv.socio_id WHERE cv.estado = 'incumplido' AND cv.anulado_en IS NULL`
    ).catch(() => []),
    cargarMovimientosCuenta().catch(() => []),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado IN ('activo', 'suspendido', 'renunciante')`).catch(() => []),
  ]);
  const temas: TemaConsejo[] = [];
  for (const c of compras) temas.push({ clave: `compra:${c.id}`, tipo: "compra", texto: `Aprobar la compra: ${c.material}`, detalle: `${c.n} presupuesto(s) cargado(s)`, href: `/compras/${c.id}` });
  for (const d of decisiones) temas.push({ clave: `decision:${d.id}`, tipo: "decision", texto: d.tema, detalle: d.comision ? `Viene de ${d.comision}` : undefined, href: `/decisiones/${d.id}` });
  for (const s of renuncias) temas.push({ clave: `renuncia:${s.id}`, tipo: "renuncia", texto: `Aceptar la renuncia de ${s.nombre}`, detalle: "Y definir su liquidación de egreso", href: `/socios/${s.id}` });
  // A5: núcleos con 2 o más cuotas vencidas sin convenio.
  const porSocio = new Map<number, typeof movs>();
  for (const m of movs) porSocio.set(m.socio_id, [...(porSocio.get(m.socio_id) ?? []), m]);
  for (const s of socios) {
    // Las cuotas de un convenio van por su lado (A17).
    const vencidas = calcularCuotasSocio(porSocio.get(s.id) ?? []).cuotas.filter((c) => c.estado === "vencida" && !c.convenioId);
    if (vencidas.length >= 2) {
      const monto = vencidas.reduce((a, c) => a + c.montoPendiente, 0);
      temas.push({ clave: `morosidad:${s.id}`, tipo: "morosidad", texto: `${s.nombre} debe ${vencidas.length} cuotas`, detalle: `$ ${Math.round(monto).toLocaleString("es-UY")} — proponer un convenio`, href: `/socios/${s.id}` });
    }
  }
  for (const c of convenios) temas.push({ clave: `convenio:${c.id}`, tipo: "convenio", texto: `Convenio incumplido: ${c.nombre}`, detalle: c.motivo, href: `/socios/${c.socio_id}` });
  // Fase 2G — A17: convenio vigente con cuota impaga: decidir si se da por incumplido.
  const reglamento = await obtenerReglamento();
  for (const c of await conveniosConCuotaImpaga(reglamento.cuotas.diasGracia).catch(() => [])) {
    temas.push({
      clave: `convenio_atraso:${c.convenioId}`,
      tipo: "convenio_atraso",
      texto: `${c.nombre} no pagó ${c.cuotas === 1 ? "una cuota" : `${c.cuotas} cuotas`} de su convenio`,
      detalle: `$ ${Math.round(c.monto).toLocaleString("es-UY")} desde el ${c.desde.split("-").reverse().join("/")} — hablar con el núcleo o dar el convenio por incumplido`,
      href: `/socios/${c.socioId}`,
    });
  }
  for (const m of mandatos) {
    const vencido = m.fecha_fin_prevista < hoy;
    temas.push({
      clave: `mandato:${m.id}`,
      tipo: "mandato",
      texto: `${vencido ? "Venció" : "Vence"} el mandato de ${m.nombre} (${CARGO_LABEL[m.cargo] ?? m.cargo})`,
      detalle: `${m.fecha_fin_prevista.split("-").reverse().join("/")} — preparar la elección`,
      href: "/consejo-directivo",
    });
  }
  return temas;
}

export type MandatoVencido = { id: number; nombre: string; cargo: CargoConsejo; fecha_fin_prevista: string };

/** Mandatos vencidos cuyos permisos el admin todavía no revisó. */
export async function mandatosVencidosSinRevisar(): Promise<MandatoVencido[]> {
  return all<MandatoVencido>(
    `SELECT c.id, u.nombre, c.cargo, c.fecha_fin_prevista FROM consejo_directivo_cargos c JOIN users u ON u.id = c.user_id
      WHERE c.fecha_fin_prevista IS NOT NULL AND c.fecha_fin_prevista < ? AND c.permisos_revisados_en IS NULL ORDER BY c.fecha_fin_prevista`,
    [hoyEnUruguay()]
  ).catch(() => []);
}
