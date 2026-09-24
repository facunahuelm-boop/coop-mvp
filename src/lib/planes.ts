import type { Module } from "./roles";

/**
 * Fase 5, Sub-fase 5.3 ("Planes y módulos", sección 21).
 *
 * Auditoría previa confirmó dos cosas: `organizations.plan` existe desde la
 * Fase 0 (multi-tenant) pero nunca se leyó en ningún lado del código — solo
 * quedaba guardado; y el mecanismo real de "módulos" ya existía desde antes
 * (Fase D: `etapa` + `modulos_override`, ver Nav.tsx), con autoservicio en
 * Configuración → Módulos, pero limitado a los 4 módulos que dependen de la
 * etapa (obra/trabajo/seguridad/reclamos) — los otros 6 ignoraban el
 * override por completo.
 *
 * Esta sub-fase conecta ambas piezas sin construir un sistema nuevo: un
 * "plan" es simplemente un preset con nombre de `modulos_override` — el
 * mismo mapa que ya guarda `organizations.modulos_override` y que ya lee
 * `moduloVisible()` en Nav.tsx (extendido acá para que el override tenga
 * efecto sobre los 10 módulos, no solo los 4 de antes). Elegir un plan
 * (al dar de alta una cooperativa, o después desde /plataforma) ESCRIBE este
 * preset en `modulos_override` — no agrega una segunda fuente de verdad para
 * la visibilidad de módulos. Después de elegido, la propia cooperativa puede
 * seguir ajustando módulo por módulo desde Configuración, exactamente igual
 * que antes de que existieran los planes.
 *
 * Importante: cambiar el plan de una cooperativa PISA su `modulos_override`
 * actual con el preset del plan nuevo — es una decisión deliberada (un plan
 * que "sugiriera" módulos sin aplicarlos no sería un preset, sería solo una
 * etiqueta) pero significa que un ajuste manual previo se pierde. Por eso
 * nunca se aplica automáticamente a una cooperativa ya existente — solo al
 * crearla, o cuando un admin de plataforma cambia el plan a propósito desde
 * /plataforma (con aviso explícito en la propia pantalla).
 *
 * Criterio elegido para el contenido de cada preset (no viene de ninguna
 * spec — la sección 21 original está perdida, mismo problema que el resto de
 * esta fase — así que se documenta acá para poder ajustarse fácilmente si no
 * es lo que se buscaba): "comisiones" (el sistema completo de gestión
 * inter-comisión — solicitudes, reuniones, decisiones/votación,
 * comunicaciones, libros sociales — construido en 12 fases propias) es el
 * diferenciador entre "básico" y "completo"; "auditoria" (Auditoría, Panel
 * Fiscal y Cumplimiento) es el diferenciador entre "trial" y "básico". El
 * resto de los módulos (obra/trabajo/seguridad/reclamos/compras/finanzas/
 * documentos/socios) quedan en "auto" en los 3 planes — un plan nunca oculta
 * lo mínimo operativo que cualquier cooperativa necesita día a día, ni pisa
 * el criterio de etapa ya existente para los 4 módulos que dependen de ella.
 */
export const PLANES = ["trial", "basico", "completo"] as const;
export type Plan = (typeof PLANES)[number];

export const PLAN_LABELS: Record<Plan, string> = {
  trial: "Trial",
  basico: "Básico",
  completo: "Completo",
};

export const PLAN_DESCRIPCIONES: Record<Plan, string> = {
  trial: "Sin Auditoría/Panel Fiscal/Cumplimiento ni Comisiones y Reuniones.",
  basico: "Sin Comisiones y Reuniones (solicitudes, decisiones, comunicaciones, libros sociales).",
  completo: "Todos los módulos disponibles (sujeto igual a la etapa y al rol de cada usuario).",
};

export const PLAN_PRESET_MODULOS: Record<Plan, Partial<Record<Module, "mostrar" | "ocultar">>> = {
  trial: { auditoria: "ocultar", comisiones: "ocultar" },
  basico: { comisiones: "ocultar" },
  completo: {},
};

export function esPlanValido(v: string): v is Plan {
  return (PLANES as readonly string[]).includes(v);
}
