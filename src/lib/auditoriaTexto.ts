/**
 * Auditoría legible (04/10) — convierte un registro crudo de `auditoria`
 * (usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo) en
 * un mensaje en lenguaje llano, ej. "María modificó los datos del núcleo
 * «Pérez» (#24)", y en una tabla "antes → después" campo por campo.
 *
 * Un solo catálogo para todas las pantallas que muestran historial (la
 * pantalla Auditoría, la pestaña Historial de la ficha del núcleo, las
 * reuniones, etc.). Es sólo presentación: no cambia qué se guarda.
 */

export const MODULOS_AUDITORIA = [
  "Socios y núcleos",
  "Cuotas y pagos",
  "Finanzas",
  "Compras y proveedores",
  "Asambleas y reuniones",
  "Consejo Directivo",
  "Comisiones y tareas",
  "Documentos",
  "Calendario",
  "Obra y trabajo",
  "Usuarios y accesos",
  "Configuración",
  "Otros",
] as const;
export type ModuloAuditoria = (typeof MODULOS_AUDITORIA)[number];

type DefEntidad = { nombre: string; femenino?: boolean; modulo: ModuloAuditoria; href?: (id: number) => string };

const ENTIDADES: Record<string, DefEntidad> = {
  socios: { nombre: "núcleo", modulo: "Socios y núcleos", href: (id) => `/socios/${id}` },
  socio_integrantes: { nombre: "integrante", modulo: "Socios y núcleos" },
  viviendas: { nombre: "vivienda", femenino: true, modulo: "Socios y núcleos" },
  lista_espera: { nombre: "persona en lista de espera", femenino: true, modulo: "Socios y núcleos" },
  movimientos_cuenta_socio: { nombre: "movimiento de cuenta", modulo: "Cuotas y pagos" },
  convenios_pago: { nombre: "convenio de pago", modulo: "Cuotas y pagos" },
  movimientos_financieros: { nombre: "movimiento financiero", modulo: "Finanzas" },
  compromisos_futuros: { nombre: "compromiso de pago", modulo: "Finanzas" },
  gastos_comision: { nombre: "gasto de comisión", modulo: "Finanzas" },
  solicitudes_compra: { nombre: "solicitud de compra", femenino: true, modulo: "Compras y proveedores", href: (id) => `/compras/${id}` },
  presupuestos_proveedor: { nombre: "presupuesto", modulo: "Compras y proveedores" },
  proveedores: { nombre: "proveedor", modulo: "Compras y proveedores" },
  reuniones: { nombre: "reunión", femenino: true, modulo: "Asambleas y reuniones", href: (id) => `/reuniones/${id}` },
  asistencias: { nombre: "asistencia", femenino: true, modulo: "Asambleas y reuniones" },
  consejo_directivo_cargos: { nombre: "cargo del Consejo", modulo: "Consejo Directivo" },
  comisiones: { nombre: "comisión", femenino: true, modulo: "Comisiones y tareas" },
  comision_miembros: { nombre: "integrante de comisión", modulo: "Comisiones y tareas" },
  tareas: { nombre: "tarea", femenino: true, modulo: "Comisiones y tareas" },
  decisiones_comision: { nombre: "decisión", femenino: true, modulo: "Comisiones y tareas", href: (id) => `/decisiones/${id}` },
  votaciones: { nombre: "votación", femenino: true, modulo: "Comisiones y tareas" },
  solicitudes_comision: { nombre: "solicitud entre comisiones", femenino: true, modulo: "Comisiones y tareas", href: (id) => `/solicitudes/${id}` },
  comunicaciones: { nombre: "comunicación", femenino: true, modulo: "Comisiones y tareas" },
  asignaciones_horas: { nombre: "jornada de trabajo", femenino: true, modulo: "Comisiones y tareas" },
  documentos: { nombre: "documento", modulo: "Documentos" },
  documento_categorias: { nombre: "categoría de documentos", femenino: true, modulo: "Documentos" },
  documentos_seguridad: { nombre: "documento de seguridad", modulo: "Obra y trabajo" },
  notas_calendario: { nombre: "actividad del calendario", femenino: true, modulo: "Calendario" },
  tareas_obra: { nombre: "tarea de obra", femenino: true, modulo: "Obra y trabajo", href: (id) => `/obra/${id}` },
  problemas_obra: { nombre: "problema de obra", modulo: "Obra y trabajo" },
  jornadas_trabajo: { nombre: "jornada de trabajo", femenino: true, modulo: "Obra y trabajo", href: (id) => `/trabajo/${id}` },
  incidentes_seguridad: { nombre: "incidente de seguridad", modulo: "Obra y trabajo" },
  inspecciones_seguridad: { nombre: "inspección de seguridad", femenino: true, modulo: "Obra y trabajo" },
  reclamos: { nombre: "reclamo", modulo: "Otros" },
  users: { nombre: "usuario", modulo: "Usuarios y accesos", href: (id) => `/usuarios/${id}` },
  organizations: { nombre: "cooperativa", femenino: true, modulo: "Configuración" },
  configuracion_reglas: { nombre: "reglas de la cooperativa", femenino: true, modulo: "Configuración" },
  reglas_automaticas: { nombre: "regla automática", femenino: true, modulo: "Configuración" },
  config_email: { nombre: "configuración de correo", femenino: true, modulo: "Configuración" },
  alertas_email: { nombre: "aviso por correo", modulo: "Configuración" },
  alertas: { nombre: "alerta", femenino: true, modulo: "Otros" },
  mensajes_correo: { nombre: "correo", modulo: "Otros" },
  importaciones: { nombre: "importación", femenino: true, modulo: "Configuración" },
  schema_migrations: { nombre: "actualización de la base", femenino: true, modulo: "Configuración" },
  tickets_soporte: { nombre: "consulta de soporte", femenino: true, modulo: "Otros" },
};

export function moduloDeEntidad(entidad: string): ModuloAuditoria {
  return ENTIDADES[entidad]?.modulo ?? "Otros";
}

/** Entidades (tablas) que pertenecen a un módulo — para filtrar por módulo. */
export function entidadesDeModulo(modulo: string): string[] {
  return Object.entries(ENTIDADES)
    .filter(([, d]) => d.modulo === modulo)
    .map(([e]) => e);
}

export function nombreDeEntidad(entidad: string): string {
  return ENTIDADES[entidad]?.nombre ?? entidad.replace(/_/g, " ");
}

// Verbos en pasado. `{obj}` es "el núcleo «Pérez»" / "la tarea «…»".
const ACCIONES: Record<string, string> = {
  crear: "creó {obj}",
  crear_serie: "creó una serie de actividades: {obj}",
  editar: "modificó los datos de {obj}",
  editar_serie: "modificó una serie de actividades: {obj}",
  eliminar: "eliminó {obj}",
  eliminar_serie: "eliminó una serie de actividades: {obj}",
  anular: "anuló {obj}",
  anular_movimiento: "anuló {obj}",
  anular_movimiento_cuenta_socio: "anuló un movimiento de {obj}",
  restaurar: "restauró {obj}",
  reactivar: "reactivó {obj}",
  archivar: "archivó {obj}",
  cambiar_estado: "cambió el estado de {obj}",
  actualizar_estado: "cambió el estado de {obj}",
  actualizar_etapa: "cambió la etapa de {obj}",
  subir: "subió {obj}",
  nueva_version: "subió una nueva versión de {obj}",
  alternar_destacado: "cambió el destacado de {obj}",
  mover: "cambió de fecha {obj}",
  cancelar: "canceló {obj}",
  cerrar: "cerró {obj} y cargó el acta",
  decidir: "resolvió {obj}",
  reabrir: "reabrió {obj}",
  comentar: "comentó en {obj}",
  responder: "respondió {obj}",
  derivar: "derivó {obj}",
  tomar: "tomó {obj}",
  resolver: "resolvió {obj}",
  asignar_vivienda: "cambió la vivienda de {obj}",
  incorporar_desde_lista_espera: "incorporó {obj} desde la lista de espera",
  reordenar: "cambió el orden de {obj}",
  // Cuotas, pagos, convenios
  registrar_pago_cuota: "registró un pago de cuota en {obj}",
  registrar_cargo_cuota: "registró un cargo (cuota) en {obj}",
  editar_pago_cuota: "corrigió un pago de cuota en {obj}",
  editar_cargo_cuota: "corrigió un cargo (cuota) en {obj}",
  registrar_movimiento: "registró {obj}",
  registrar_movimiento_cuenta_socio: "registró un movimiento en {obj}",
  editar_movimiento: "modificó {obj}",
  generar_cuota_mensual: "generó la cuota mensual para todos los núcleos",
  crear_convenio: "creó un convenio de pago en {obj}",
  cambiar_estado_convenio: "cambió el estado de un convenio de pago en {obj}",
  eliminar_convenio: "eliminó un convenio de pago de {obj}",
  marcar_pagado: "marcó como pagado {obj}",
  // Compras
  aprobar_compra: "aprobó {obj}",
  rechazar_compra: "rechazó {obj}",
  // Reuniones / resoluciones
  registrar_asistencia: "registró asistencia en {obj}",
  registrar_asistencia_invitado: "registró asistencia de un invitado en {obj}",
  agregar_punto_agenda: "agregó un punto al orden del día de {obj}",
  quitar_punto_agenda: "quitó un punto del orden del día de {obj}",
  registrar_resolucion: "registró una resolución en {obj}",
  llevar_resolucion: "llevó una resolución de otra reunión a {obj}",
  agregar_invitado: "invitó a una persona a {obj}",
  quitar_invitado: "quitó un invitado de {obj}",
  cambiar_confirmacion_invitado: "cambió la confirmación de un invitado en {obj}",
  vincular_resolucion: "vinculó {obj} con una resolución",
  desvincular_resolucion: "desvinculó {obj} de su resolución",
  votar: "votó en {obj}",
  cambiar_voto: "cambió su voto en {obj}",
  // Comisiones / tareas
  agregar_miembro: "agregó un integrante a {obj}",
  quitar_miembro: "quitó un integrante de {obj}",
  cambiar_rol_miembro: "cambió el rol de un integrante en {obj}",
  agregar_colaborador: "sumó un colaborador a {obj}",
  quitar_colaborador: "quitó un colaborador de {obj}",
  agregar_item_checklist: "agregó un ítem al checklist de {obj}",
  completar_item_checklist: "completó un ítem del checklist de {obj}",
  reabrir_item_checklist: "desmarcó un ítem del checklist de {obj}",
  quitar_item_checklist: "quitó un ítem del checklist de {obj}",
  registrar_resultado: "registró el resultado de {obj}",
  // Calendario / obra / trabajo
  agregar_participante: "sumó un participante a {obj}",
  quitar_participante: "quitó un participante de {obj}",
  registrar_avance: "registró un avance en {obj}",
  anotarse: "se anotó en {obj}",
  confirmar_asignacion: "confirmó una asignación en {obj}",
  // Usuarios / acceso (nunca se guardan contraseñas: sólo que ocurrió)
  crear_usuario: "creó {obj}",
  cambiar_rol: "cambió el rol de {obj}",
  activar_usuario: "reactivó {obj}",
  desactivar_usuario: "desactivó {obj}",
  cambiar_password: "cambió la contraseña de {obj}",
  restablecer_password: "restableció la contraseña de {obj}",
  recuperar_password: "recuperó el acceso de {obj}",
  solicitar_recuperacion_password: "pidió recuperar la contraseña de {obj}",
  cambiar_foto_perfil: "cambió la foto de perfil de {obj}",
  login_exitoso: "inició sesión",
  login_fallido: "intentó iniciar sesión sin éxito",
  // Configuración / plataforma
  actualizar_branding: "cambió la imagen de {obj}",
  actualizar_modulos: "cambió los módulos activos de {obj}",
  guardar_reglas_cooperativa: "modificó {obj}",
  guardar_config_email: "modificó {obj}",
  actualizar_alertas_email: "modificó {obj}",
  aplicar_migraciones: "aplicó actualizaciones de la base",
  importar: "importó datos: {obj}",
  deshacer_importacion: "deshizo {obj}",
  resolver_alerta: "resolvió {obj}",
  responder_ticket_plataforma: "respondió {obj}",
  crear_cooperativa: "creó {obj}",
  activar_cooperativa: "activó {obj}",
  desactivar_cooperativa: "desactivó {obj}",
  cambiar_plan_cooperativa: "cambió el plan de {obj}",
  crear_regla_automatica: "creó {obj}",
  activar_regla_automatica: "activó {obj}",
  desactivar_regla_automatica: "desactivó {obj}",
  error_crear: "tuvo un error al crear {obj}",
  error_eliminar: "tuvo un error al eliminar {obj}",
  asignar_horas: "asignó horas de trabajo a {obj}",
  editar_asignacion_horas: "modificó la jornada de {obj}",
  reprogramar_asignacion_horas: "reprogramó la jornada de {obj}",
  cancelar_asignacion_horas: "canceló una jornada de {obj}",
  enviar: "envió {obj}",
  enviar_fallido: "intentó enviar {obj} (falló)",
};

const CAMPOS_NOMBRE = ["nombre", "titulo", "tema", "material", "concepto", "descripcion", "asunto", "punto", "numero", "item"];

export function parsearValor(v: string | null | undefined): Record<string, unknown> | string | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : String(v);
  } catch {
    return v;
  }
}

function nombreDelRegistro(anterior: unknown, nuevo: unknown): string | null {
  for (const fuente of [nuevo, anterior]) {
    if (fuente && typeof fuente === "object") {
      for (const campo of CAMPOS_NOMBRE) {
        const v = (fuente as Record<string, unknown>)[campo];
        if (typeof v === "string" && v.trim()) return v.trim().length > 60 ? `${v.trim().slice(0, 57)}…` : v.trim();
      }
    }
  }
  return null;
}

export type RegistroAuditoriaCrudo = {
  id: number;
  accion: string;
  entidad?: string | null;
  entidad_id?: number | null;
  fecha: string;
  usuario_id?: number | null;
  usuario_nombre: string | null;
  valor_anterior?: string | null;
  valor_nuevo?: string | null;
};

/** "el núcleo «Pérez» (#24)" — o "la tarea #12" si no hay nombre. */
export function objetoDelRegistro(r: RegistroAuditoriaCrudo): string {
  const entidad = r.entidad || "";
  // Cuenta del núcleo: el registro relevante para leer es el NÚCLEO, no el
  // número interno del movimiento ("…registró un pago de cuota en la cuenta
  // del núcleo «Pérez»").
  // Horas de trabajo: "…modificó la jornada del núcleo «Núcleo 8»".
  if (entidad === "asignaciones_horas") {
    const a = parsearValor(r.valor_anterior);
    const n = parsearValor(r.valor_nuevo);
    const nucleo = [n, a].map((v) => (v && typeof v === "object" ? v.nucleo : null)).find((v) => typeof v === "string" && v);
    if (nucleo) return `el núcleo «${nucleo}»`;
  }
  if (entidad === "movimientos_cuenta_socio" || entidad === "convenios_pago") {
    const a = parsearValor(r.valor_anterior);
    const n = parsearValor(r.valor_nuevo);
    const socio = [n, a].map((v) => (v && typeof v === "object" ? v.socio : null)).find((v) => typeof v === "string" && v);
    if (socio) {
      const detalle = [n, a].map((v) => (v && typeof v === "object" ? v.concepto ?? v.motivo : null)).find((v) => typeof v === "string" && v);
      return `la cuenta del núcleo «${socio}»${detalle ? ` (${detalle})` : ""}`;
    }
  }
  const def = ENTIDADES[entidad];
  const articulo = def?.femenino ? "la" : "el";
  const nombre = nombreDelRegistro(parsearValor(r.valor_anterior), parsearValor(r.valor_nuevo));
  const sustantivo = def?.nombre ?? (entidad ? `registro de ${entidad.replace(/_/g, " ")}` : "registro");
  if (nombre) return `${articulo} ${sustantivo} «${nombre}»${r.entidad_id ? ` (#${r.entidad_id})` : ""}`;
  return `${articulo} ${sustantivo}${r.entidad_id ? ` #${r.entidad_id}` : ""}`;
}

/** Mensaje completo: "María modificó los datos del núcleo «Pérez» (#24)". */
export function textoAuditoria(r: RegistroAuditoriaCrudo): string {
  const quien = r.usuario_nombre || (r.usuario_id ? "Un usuario dado de baja" : "El sistema");
  const plantilla = ACCIONES[r.accion] ?? `${r.accion.replace(/_/g, " ")} {obj}`;
  const obj = objetoDelRegistro(r);
  return `${quien} ${plantilla.replace("{obj}", obj)}`.replace(/\bde el\b/g, "del").replace(/\ba el\b/g, "al");
}

export function etiquetaDeAccion(accion: string): string {
  const plantilla = ACCIONES[accion];
  if (!plantilla) return accion.replace(/_/g, " ");
  const t = plantilla.replace(/\s*\{obj\}.*$/, "").replace(/[:\s]+$/, "").replace(/\s+(de|en|a|al|del)$/, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function hrefDelRegistro(r: RegistroAuditoriaCrudo): string | null {
  const def = r.entidad ? ENTIDADES[r.entidad] : undefined;
  return def?.href && r.entidad_id ? def.href(r.entidad_id) : null;
}

const CAMPO_LABEL: Record<string, string> = {
  socio_id: "Núcleo",
  nucleo_id: "Núcleo",
  vivienda_id: "Vivienda",
  comision_id: "Comisión",
  reunion_id: "Reunión",
  responsable_id: "Responsable",
  fecha_vencimiento: "Vencimiento",
  metodo_pago: "Medio de pago",
  monto_cuota: "Monto de cuota",
  resolucion_id: "Resolución",
  punto_id: "Punto del orden del día",
  viene_de_reunion_id: "Viene de la reunión",
  viene_de_punto_id: "Viene del punto",
  invitado_id: "Invitado",
  invitado_user_id: "Persona invitada",
  participante_id: "Participante",
  colaborador_id: "Colaborador",
  deuda_refinanciada: "Deuda refinanciada",
};

export function etiquetaDeCampo(campo: string): string {
  if (CAMPO_LABEL[campo]) return CAMPO_LABEL[campo];
  const t = campo.replace(/_id$/, "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function valorLegible(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export type CambioAuditoria = { campo: string; antes: string; despues: string; cambio: boolean };

/** Tabla "antes → después" campo por campo (o el texto crudo si no es JSON). */
export function cambiosDelRegistro(r: RegistroAuditoriaCrudo): CambioAuditoria[] {
  const antes = parsearValor(r.valor_anterior);
  const despues = parsearValor(r.valor_nuevo);
  if ((antes !== null && typeof antes !== "object") || (despues !== null && typeof despues !== "object")) {
    return [{ campo: "Valor", antes: valorLegible(antes), despues: valorLegible(despues), cambio: true }];
  }
  const a = (antes as Record<string, unknown>) || {};
  const d = (despues as Record<string, unknown>) || {};
  const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])];
  return campos.map((c) => {
    const va = valorLegible(a[c]);
    const vd = valorLegible(d[c]);
    return {
      campo: etiquetaDeCampo(c),
      antes: antes === null ? "" : va,
      despues: despues === null ? "" : vd,
      cambio: antes !== null && despues !== null ? va !== vd : true,
    };
  });
}

/** Todo lo que necesita la UI, ya serializable (cruza al cliente). */
export type RegistroAuditoriaLegible = {
  id: number;
  texto: string;
  fecha: string;
  usuarioId: number | null;
  usuarioNombre: string;
  modulo: ModuloAuditoria;
  accion: string;
  accionLabel: string;
  entidad: string;
  entidadLabel: string;
  entidadId: number | null;
  href: string | null;
  tieneAnterior: boolean;
  tieneNuevo: boolean;
  cambios: CambioAuditoria[];
};

export function registroLegible(r: RegistroAuditoriaCrudo): RegistroAuditoriaLegible {
  const entidad = r.entidad || "";
  return {
    id: r.id,
    texto: textoAuditoria(r),
    fecha: r.fecha,
    usuarioId: r.usuario_id ?? null,
    usuarioNombre: r.usuario_nombre || (r.usuario_id ? "usuario dado de baja" : "sistema"),
    modulo: moduloDeEntidad(entidad),
    accion: r.accion,
    accionLabel: etiquetaDeAccion(r.accion),
    entidad,
    entidadLabel: nombreDeEntidad(entidad),
    entidadId: r.entidad_id ?? null,
    href: hrefDelRegistro(r),
    tieneAnterior: Boolean(r.valor_anterior),
    tieneNuevo: Boolean(r.valor_nuevo),
    cambios: cambiosDelRegistro(r),
  };
}
