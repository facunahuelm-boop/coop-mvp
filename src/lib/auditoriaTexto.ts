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
  cuentas_financieras: { nombre: "cuenta", femenino: true, modulo: "Finanzas", href: () => "/finanzas/cuentas" },
  fondos: { nombre: "fondo", modulo: "Finanzas", href: () => "/finanzas/cuentas" },
  periodos_financieros: { nombre: "cierre del mes", modulo: "Finanzas", href: () => "/finanzas/cierre" },
  facturas_proveedor: { nombre: "factura a pagar", femenino: true, modulo: "Finanzas", href: () => "/finanzas?tab=pagar" },
  presupuesto_general: { nombre: "línea del presupuesto", femenino: true, modulo: "Finanzas", href: () => "/finanzas?tab=presupuesto" },
  mapeo_contable: { nombre: "plan de cuentas", modulo: "Finanzas" },
  extractos_bancarios: { nombre: "extracto del banco", modulo: "Finanzas", href: () => "/finanzas/conciliacion" },
  actas: { nombre: "acta", femenino: true, modulo: "Asambleas y reuniones" },
  tramites_hitos: { nombre: "paso de los trámites", modulo: "Asambleas y reuniones", href: () => "/tramites" },
  avisos: { nombre: "aviso oficial", modulo: "Asambleas y reuniones", href: (id) => `/avisos/${id}` },
  fichadas_obra: { nombre: "fichada de la obra", femenino: true, modulo: "Obra y trabajo", href: () => "/qr-obra" },
  plantillas_texto: { nombre: "plantilla de texto", femenino: true, modulo: "Documentos", href: () => "/plantillas" },
  proveedor_documentos: { nombre: "documento de proveedor", modulo: "Compras y proveedores" },
  contactos_externos: { nombre: "contacto del directorio", modulo: "Socios y núcleos", href: () => "/contactos#externos" },
  extracto_lineas: { nombre: "línea del banco", femenino: true, modulo: "Finanzas", href: () => "/finanzas/conciliacion" },
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
  asistencias_horas: { nombre: "asistencia", femenino: true, modulo: "Obra y trabajo" },
  avisos_ausencia: { nombre: "aviso de ausencia", modulo: "Obra y trabajo" },
  licencias_horas: { nombre: "licencia de horas", femenino: true, modulo: "Obra y trabajo" },
  cierres_semana_horas: { nombre: "semana de horas", femenino: true, modulo: "Obra y trabajo" },
  recibos: { nombre: "recibo", modulo: "Cuotas y pagos" },
  documentos: { nombre: "documento", modulo: "Documentos" },
  documento_categorias: { nombre: "categoría de documentos", femenino: true, modulo: "Documentos" },
  documentos_seguridad: { nombre: "documento de seguridad", modulo: "Obra y trabajo" },
  notas_calendario: { nombre: "actividad del calendario", femenino: true, modulo: "Calendario" },
  tareas_obra: { nombre: "tarea de obra", femenino: true, modulo: "Obra y trabajo", href: (id) => `/obra/${id}` },
  problemas_obra: { nombre: "problema de obra", modulo: "Obra y trabajo" },
  jornadas_trabajo: { nombre: "jornada de trabajo", femenino: true, modulo: "Obra y trabajo", href: (id) => `/trabajo/${id}` },
  incidentes_seguridad: { nombre: "incidente de seguridad", modulo: "Obra y trabajo" },
  inspecciones_seguridad: { nombre: "inspección de seguridad", femenino: true, modulo: "Obra y trabajo", href: () => "/seguridad" },
  epp_entregas: { nombre: "entrega de elementos de protección", femenino: true, modulo: "Obra y trabajo", href: () => "/seguridad/epp" },
  recepciones_material: { nombre: "recepción de materiales", femenino: true, modulo: "Compras y proveedores", href: () => "/compras/recepciones" },
  panol_items: { nombre: "ítem del pañol", modulo: "Obra y trabajo", href: () => "/obra/panol" },
  panol_movimientos: { nombre: "movimiento del pañol", modulo: "Obra y trabajo", href: () => "/obra/panol" },
  diario_obra: { nombre: "entrada del diario de obra", femenino: true, modulo: "Obra y trabajo", href: () => "/obra/diario" },
  obra_rubros: { nombre: "rubro de la obra", modulo: "Obra y trabajo", href: () => "/obra/avance" },
  obra_avances_rubro: { nombre: "medición de avance", femenino: true, modulo: "Obra y trabajo", href: () => "/obra/avance" },
  obra_plan_mensual: { nombre: "plan de avance", modulo: "Obra y trabajo", href: () => "/obra/avance" },
  prestamo_desembolsos: { nombre: "desembolso del préstamo", modulo: "Finanzas", href: () => "/obra/avance" },
  correspondencia: { nombre: "nota de correspondencia", femenino: true, modulo: "Documentos" },
  elecciones: { nombre: "elección", femenino: true, modulo: "Asambleas y reuniones" },
  listas_electorales: { nombre: "lista electoral", femenino: true, modulo: "Asambleas y reuniones" },
  accesos_delegados: { nombre: "acceso de un familiar", modulo: "Usuarios y accesos", href: () => "/acceso-familiar" },
  conceptos_cuota: { nombre: "concepto de la cuota", modulo: "Cuotas y pagos", href: () => "/conceptos-cuota" },
  mantenimiento_preventivo: { nombre: "tarea de mantenimiento preventivo", femenino: true, modulo: "Socios y núcleos", href: () => "/mantenimiento" },
  espacios_comunes: { nombre: "espacio común", modulo: "Socios y núcleos", href: () => "/reservas" },
  reservas_espacios: { nombre: "reserva de espacio", femenino: true, modulo: "Socios y núcleos", href: () => "/reservas" },
  liquidaciones_egreso: { nombre: "liquidación de egreso", femenino: true, modulo: "Cuotas y pagos", href: () => "/liquidaciones" },
  encuestas: { nombre: "encuesta", femenino: true, modulo: "Asambleas y reuniones", href: () => "/encuestas" },
  medidas_propuestas: { nombre: "medida propuesta", femenino: true, modulo: "Consejo Directivo", href: () => "/medidas" },
  inducciones_seguridad: { nombre: "inducción de seguridad", femenino: true, modulo: "Obra y trabajo", href: () => "/seguridad/induccion" },
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
  registrar_asistencia_obra: "registró la asistencia en obra de {obj}",
  deshacer_asistencia: "deshizo una marca de asistencia de {obj}",
  registrar_horas_sin_turno: "registró horas sin turno de {obj}",
  avisar_ausencia: "avisó que no puede ir: {obj}",
  aprobar_aviso_ausencia: "justificó la falta de {obj}",
  rechazar_aviso_ausencia: "rechazó el aviso de ausencia de {obj}",
  registrar_licencia_horas: "registró una licencia para {obj}",
  anular_licencia_horas: "anuló {obj}",
  cerrar_semana_horas: "cerró {obj}",
  reabrir_semana_horas: "reabrió {obj}",
  anular_convenio: "anuló el convenio de {obj}",
  cambiar_preferencia: "cambió sus preferencias de pantalla",
  guardar_reglamento: "cambió el reglamento de la cooperativa",
  emitir_recibo: "emitió {obj}",
  anular_recibo: "anuló {obj}",
  aplicar_recargo: "aplicó un recargo por atraso en {obj}",
  pedir_link_acceso: "pidió un link para entrar por email",
  login_link_email: "entró con el link enviado a su email",
  login_segundo_paso: "completó la verificación en dos pasos al entrar",
  login_segundo_paso_fallido: "escribió un código de verificación incorrecto",
  activar_dos_pasos: "activó la verificación en dos pasos",
  desactivar_dos_pasos: "desactivó la verificación en dos pasos",
  quitar_dos_pasos: "quitó la verificación en dos pasos de {obj}",
  cerrar_otras_sesiones: "cerró sus sesiones en otros dispositivos",
  crear_cuenta_financiera: "agregó {obj}",
  editar_cuenta_financiera: "cambió {obj}",
  crear_fondo: "agregó {obj}",
  editar_fondo: "cambió {obj}",
  transferencia_interna: "pasó plata entre cuentas o fondos",
  contra_movimiento: "corrigió un movimiento con un contra-movimiento",
  cerrar_mes: "cerró el mes en Finanzas",
  visar_mes: "dio el visto al cierre del mes",
  observar_mes: "devolvió el cierre del mes con una observación",
  reabrir_mes: "reabrió un mes cerrado",
  crear_presupuesto: "agregó {obj}",
  editar_presupuesto: "cambió {obj}",
  quitar_presupuesto: "quitó {obj}",
  copiar_presupuesto: "copió el presupuesto de un año al siguiente",
  cancelar_compromiso: "canceló {obj}",
  cumplir_compromiso: "registró como cumplido {obj}",
  registrar_factura: "cargó {obj}",
  pagar_factura: "pagó {obj}",
  anular_factura: "anuló {obj}",
  mapeo_contable: "cambió el plan de cuentas para el contador",
  exportar_libro_contador: "descargó la planilla para el contador",
  importar_extracto: "importó un extracto del banco",
  crear_nucleo: "creó el núcleo de {obj}",
  paso_ingreso_hecho: "marcó un paso del ingreso de {obj}",
  paso_ingreso_pendiente: "desmarcó un paso del ingreso de {obj}",
  agregar_oficio: "agregó un oficio en {obj}",
  quitar_oficio: "quitó un oficio de {obj}",
  exportar_padron: "descargó el padrón de socios",
  calcular_padron_asamblea: "armó el padrón de {obj}",
  enviar_convocatoria: "envió la convocatoria de {obj}",
  registrar_llegada_asamblea: "registró una llegada en {obj}",
  registrar_salida_asamblea: "registró una salida en {obj}",
  poder_asamblea: "registró un poder en {obj}",
  confirmar_quorum: "confirmó el quórum de {obj}",
  abrir_votacion: "abrió una votación en {obj}",
  registrar_voto: "registró un voto en {obj}",
  cerrar_votacion: "cerró una votación en {obj}",
  anular_votacion: "anuló una votación en {obj}",
  editar_acta: "corrigió el borrador de {obj}",
  aprobar_acta: "aprobó {obj}",
  extender_mandato: "extendió un mandato",
  cerrar_mandato: "cerró un mandato vencido",
  cambiar_rol_por_cargo: "cambió los permisos de {obj} por su cargo",
  armar_orden_del_dia: "armó el orden del día de {obj}",
  crear_hito: "agregó {obj}",
  editar_hito: "cambió {obj}",
  cambiar_estado_hito: "actualizó {obj}",
  mover_hito: "reordenó los trámites",
  quitar_hito: "quitó {obj}",
  plantilla_hitos: "cargó los pasos típicos de los trámites",
  enviar_aviso: "mandó {obj}",
  anular_aviso: "anuló {obj}",
  preferencias_avisos: "cambió cómo recibe los avisos",
  link_calendario: "creó su link del calendario",
  crear_contacto_externo: "agregó {obj}",
  editar_contacto_externo: "cambió {obj}",
  baja_contacto_externo: "quitó {obj}",
  exportar_auditoria: "descargó la auditoría en Excel",
  agregar_doc_proveedor: "cargó {obj}",
  baja_doc_proveedor: "quitó {obj}",
  fichar_llegada: "marcó su llegada a la obra con el QR",
  fichar_salida: "marcó su salida de la obra con el QR",
  revisar_fichada: "revisó una fichada sin turno",
  recibir_material: "registró la recepción de materiales",
  panol_entrada: "anotó una entrada al pañol",
  panol_salida: "anotó una salida del pañol",
  panol_prestamo: "prestó algo del pañol",
  panol_ajuste: "ajustó el inventario del pañol",
  panol_devolucion: "anotó una devolución al pañol",
  escribir_diario: "escribió en el diario de obra",
  medir_avance: "midió el avance de un rubro de la obra",
  planificar_avance: "cargó el avance planificado de un mes",
  configurar_prestamo: "cambió los datos del préstamo",
  pedir_desembolso: "marcó un desembolso del préstamo como pedido",
  registrar_correspondencia: "registró correspondencia",
  responder_correspondencia: "marcó una nota como respondida",
  presentar_lista: "registró una lista electoral",
  pasar_punto: "pasó a otro punto del orden del día en la asamblea",
  dar_acceso_delegado: "le dio acceso a un familiar para que lo ayude",
  revocar_acceso_delegado: "sacó el acceso de un familiar",
  ver_como_delegado: "miró la información de un socio al que ayuda",
  mantenimiento_hecho: "anotó que se hizo un mantenimiento preventivo",
  reservar_espacio: "reservó un espacio común",
  cancelar_reserva: "canceló una reserva",
  confirmar_reserva: "confirmó una reserva",
  rechazar_reserva: "rechazó una reserva",
  liquidacion_aprobada: "aprobó una liquidación de egreso",
  liquidacion_pagada: "marcó pagada una liquidación de egreso",
  liquidacion_anulada: "anuló una liquidación de egreso",
  descargar_liquidacion: "descargó una liquidación de egreso",
  cambiar_etapa: "cambió la etapa de la cooperativa",
  responder_encuesta: "respondió una encuesta",
  cerrar_encuesta: "cerró una encuesta",
  proponer_medida: "propuso una medida según el reglamento",
  aprobar_medida: "aprobó una medida propuesta",
  descartar_medida: "descartó una medida propuesta",
  escalar_reclamo: "escaló un reclamo sin respuesta",
  checklist_diario: "hizo el checklist de seguridad del día",
  entregar_epp: "anotó la entrega de un elemento de protección",
  registrar_induccion: "registró una inducción de seguridad",
  descargar_constancia_epp: "descargó una constancia de entrega de EPP",
  alta_datos: "completó los datos de la cooperativa en el asistente de alta",
  alta_completada: "dio por terminada el alta de la cooperativa",
  invitar_usuario: "invitó a {obj}",
  crear_plantilla_texto: "creó {obj}",
  editar_plantilla_texto: "cambió {obj}",
  baja_plantilla_texto: "quitó {obj}",
  generar_desde_plantilla: "generó un PDF desde {obj}",
  descargar_reporte: "descargó un reporte",
  descargar_estado_cuenta: "descargó el estado de cuenta de {obj}",
  excepcion_regla_compra: "aprobó {obj} con menos presupuestos que los que pide el reglamento",
  conciliar_linea: "concilió {obj}",
  ignorar_linea_banco: "ignoró {obj}",
  deshacer_conciliacion: "deshizo la conciliación de {obj}",
  enviar: "envió {obj}",
  enviar_fallido: "intentó enviar {obj} (falló)",
};

const CAMPOS_NOMBRE = ["nombre", "titulo", "tema", "material", "concepto", "descripcion", "asunto", "punto", "numero", "item"];
// (Fase 1C: un recibo se nombra por su "numero": «Recibo N° 12».)

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
  if (entidad === "asignaciones_horas" || entidad === "asistencias_horas" || entidad === "avisos_ausencia" || entidad === "licencias_horas") {
    const a = parsearValor(r.valor_anterior);
    const n = parsearValor(r.valor_nuevo);
    const nucleo = [n, a].map((v) => (v && typeof v === "object" ? v.nucleo : null)).find((v) => typeof v === "string" && v);
    if (nucleo) return `el núcleo «${nucleo}»`;
  }
  if (entidad === "cierres_semana_horas") {
    const n = parsearValor(r.valor_nuevo);
    const semana = n && typeof n === "object" && typeof n.semana === "string" ? n.semana : null;
    if (semana) return `la ${semana.charAt(0).toLowerCase()}${semana.slice(1)} en la libreta de horas`;
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
