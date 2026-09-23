import { ROLES, ROLE_LABELS, type Role } from "./roles";

// Fase 3 ("Reglas de la cooperativa, Estatuto/Reglamentos como
// configuración, Motor de reglas evento-condición-acción") — Sub-fase 3.3:
// Motor de reglas evento-condición-acción (sección 14). Ver migración 0035
// para el porqué completo del alcance acotado (evento = condición, catálogo
// cerrado de 2 acciones seguras).
//
// Este archivo es deliberadamente SIN "server-only": guarda solo catálogos
// y tipos (nada de acceso a datos), así que lo puede importar tanto el
// formulario cliente (ReglasAutomaticasFormularios.tsx, para llenar los
// <select>) como el código de servidor (reglasAutomaticas.ts,
// actions/reglasAutomaticas.ts, la página). La lógica que sí toca la base
// (ejecutar reglas, leerlas) vive separada en reglasAutomaticas.ts — mezclar
// ambas cosas en un solo archivo hace que Next intente meter `pg` (que usa
// `db.ts`) en el bundle del navegador y el build se rompe.

// EVENTOS: exactamente los 12 tipos que ya disparan una notificación hoy
// (ver los `tipo:` pasados a crearNotificacion/crearNotificacionesParaUsuarios
// en src/lib/actions/*.ts). No se inventa ningún evento nuevo — la lista de
// abajo es un catálogo de lo que YA pasa en el sistema, con una etiqueta en
// español para la pantalla de configuración.
export const EVENTOS_DISPONIBLES: { value: string; label: string }[] = [
  { value: "solicitud_recibida", label: "Nueva solicitud entre comisiones" },
  { value: "solicitud_cambio_estado", label: "Cambio de estado de una solicitud" },
  { value: "tarea_asignada", label: "Tarea asignada a alguien" },
  { value: "reunion_creada", label: "Reunión creada" },
  { value: "votacion_abierta", label: "Votación abierta" },
  { value: "decision_publicada", label: "Decisión publicada" },
  { value: "comunicacion_nueva", label: "Nueva comunicación" },
  { value: "mencion", label: "Mención directa a una persona" },
  { value: "compra_aprobada", label: "Compra aprobada" },
  { value: "compra_entregada", label: "Compra marcada como entregada" },
  { value: "compra_rechazada", label: "Compra rechazada" },
  { value: "gasto_pagado", label: "Gasto marcado como pagado" },
];
export const EVENTOS_VALIDOS = new Set(EVENTOS_DISPONIBLES.map((e) => e.value));

// ACCIONES: catálogo cerrado — a propósito no hay (ni va a haber en esta
// sub-fase) una acción que apruebe, vote, publique, cierre o cambie estado
// por sí sola. Ambas reusan exactamente el mismo código que ya usa el resto
// del sistema para notificar o alertar — la regla automática no es un
// camino nuevo, es un disparador nuevo sobre el motor ya existente.
export const ACCIONES_DISPONIBLES = [
  { value: "notificar_rol", label: "Notificar también a un rol" },
  { value: "crear_alerta", label: "Crear una alerta" },
] as const;
export type AccionTipo = (typeof ACCIONES_DISPONIBLES)[number]["value"];

export const SEVERIDADES_ALERTA = [
  { value: "informativa", label: "🟢 Informativa" },
  { value: "importante", label: "🟠 Importante" },
  { value: "critica", label: "🔴 Crítica" },
] as const;

export const ROLES_PARA_REGLAS: { value: Role; label: string }[] = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export type AccionDatosNotificar = { rol: Role; mensaje?: string };
export type AccionDatosAlerta = { rol: Role; severidad: "informativa" | "importante" | "critica"; titulo?: string };

export type ReglaAutomatica = {
  id: number;
  nombre: string;
  evento: string;
  accion_tipo: AccionTipo;
  accion_datos: AccionDatosNotificar | AccionDatosAlerta;
  activa: boolean;
  creado_en: string;
};
