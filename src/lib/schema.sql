-- Esquema del Sistema Operativo Digital de la Cooperativa (MVP)
-- SQLite local para desarrollo. Migrar a PostgreSQL (Supabase) en producción: ver README.

CREATE TABLE IF NOT EXISTS nucleos_familiares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cuota_social REAL NOT NULL DEFAULT 0,
  horas_acumuladas REAL NOT NULL DEFAULT 0,
  horas_semanales_objetivo REAL NOT NULL DEFAULT 21
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL, -- socio | comision_obra | comision_trabajo | comision_compras | comision_seguridad | administracion | tesoreria | consejo_directivo | fiscal | tecnico | admin
  nucleo_id INTEGER REFERENCES nucleos_familiares(id),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  expira_en TEXT NOT NULL
);

-- ===================== OBRA =====================
CREATE TABLE IF NOT EXISTS tareas_obra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  etapa TEXT NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  responsable_id INTEGER REFERENCES users(id),
  fecha_inicio TEXT,
  fecha_fin_prevista TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | completada
  depende_de_id INTEGER REFERENCES tareas_obra(id),
  prioridad TEXT NOT NULL DEFAULT 'media', -- baja | media | alta | critica
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS avances_obra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER NOT NULL REFERENCES tareas_obra(id),
  autor_id INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  descripcion TEXT NOT NULL,
  foto_url TEXT
);

CREATE TABLE IF NOT EXISTS problemas_obra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER REFERENCES tareas_obra(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  severidad TEXT NOT NULL DEFAULT 'media', -- baja | media | critica
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | resuelto
  autor_id INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  resolucion TEXT,
  foto_url TEXT
);

-- ===================== TRABAJO =====================
CREATE TABLE IF NOT EXISTS jornadas_trabajo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  descripcion TEXT,
  herramientas_necesarias TEXT,
  estado TEXT NOT NULL DEFAULT 'planificada' -- planificada | realizada | cancelada
);

CREATE TABLE IF NOT EXISTS tareas_jornada (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jornada_id INTEGER NOT NULL REFERENCES jornadas_trabajo(id),
  nombre TEXT NOT NULL,
  habilidad_requerida TEXT,
  prioridad TEXT NOT NULL DEFAULT 'media',
  personas_necesarias INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS asignaciones_jornada (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jornada_id INTEGER NOT NULL REFERENCES jornadas_trabajo(id),
  tarea_jornada_id INTEGER REFERENCES tareas_jornada(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  propuesta_por_ia INTEGER NOT NULL DEFAULT 0,
  confirmado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asistencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jornada_id INTEGER NOT NULL REFERENCES jornadas_trabajo(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  presente INTEGER NOT NULL DEFAULT 0,
  horas REAL NOT NULL DEFAULT 0,
  justificacion TEXT
);

CREATE TABLE IF NOT EXISTS habilidades_nucleo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  habilidad TEXT NOT NULL
);

-- ===================== COMPRAS =====================
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  contacto TEXT,
  rubro TEXT,
  notas TEXT
);

CREATE TABLE IF NOT EXISTS solicitudes_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitante_id INTEGER REFERENCES users(id),
  comision TEXT NOT NULL,
  material TEXT NOT NULL,
  cantidad REAL NOT NULL,
  unidad TEXT NOT NULL,
  especificacion TEXT,
  prioridad TEXT NOT NULL DEFAULT 'media',
  etapa_obra TEXT,
  fecha_necesaria TEXT,
  presupuesto_estimado REAL,
  estado TEXT NOT NULL DEFAULT 'pendiente_cotizacion', -- pendiente_cotizacion | en_comparacion | aprobada | rechazada | entregada
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS presupuestos_proveedor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  precio REAL NOT NULL,
  precio_unitario REAL,
  plazo_entrega_dias INTEGER,
  forma_pago TEXT,
  garantia TEXT,
  costo_envio REAL DEFAULT 0,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decisiones_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id),
  presupuesto_id INTEGER REFERENCES presupuestos_proveedor(id),
  decidido_por_id INTEGER REFERENCES users(id),
  motivo TEXT,
  monto REAL,
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== SEGURIDAD =====================
CREATE TABLE IF NOT EXISTS documentos_seguridad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  descripcion TEXT,
  fecha_vencimiento TEXT,
  archivo_url TEXT,
  responsable_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS inspecciones_seguridad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  checklist_json TEXT NOT NULL,
  hallazgos TEXT,
  autor_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS incidentes_seguridad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  tipo TEXT NOT NULL DEFAULT 'observacion', -- observacion | incidente | accidente
  descripcion TEXT NOT NULL,
  severidad TEXT NOT NULL DEFAULT 'media', -- baja | media | critica
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | en_seguimiento | resuelto
  medidas TEXT,
  foto_url TEXT,
  ia_observacion TEXT,
  autor_id INTEGER REFERENCES users(id)
);

-- ===================== FINANZAS =====================
CREATE TABLE IF NOT EXISTS movimientos_financieros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL, -- ingreso | egreso
  monto REAL NOT NULL,
  categoria TEXT NOT NULL,
  etapa_obra TEXT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  descripcion TEXT,
  comprobante_url TEXT,
  registrado_por_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS presupuesto_general (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria TEXT NOT NULL,
  monto_presupuestado REAL NOT NULL,
  periodo TEXT NOT NULL -- ej: '2026'
);

CREATE TABLE IF NOT EXISTS compromisos_futuros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  fecha_estimada TEXT NOT NULL,
  origen TEXT -- ej: 'compra #12'
);

-- ===================== DOCUMENTOS =====================
CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria TEXT NOT NULL, -- actas | asambleas | presupuestos | facturas | contratos | tecnicos | obra | socios | seguridad | compras | reglamentos | informes | comunicaciones
  nombre TEXT NOT NULL,
  archivo_url TEXT,
  descripcion TEXT,
  subido_por_id INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organo TEXT NOT NULL, -- asamblea | consejo_directivo
  fecha TEXT NOT NULL,
  titulo TEXT NOT NULL,
  resumen TEXT NOT NULL,
  documento_id INTEGER REFERENCES documentos(id)
);

-- ===================== ALERTAS Y AUDITORÍA =====================
CREATE TABLE IF NOT EXISTS alertas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  severidad TEXT NOT NULL, -- critica | importante | informativa
  origen_modulo TEXT NOT NULL, -- obra | trabajo | compras | seguridad | finanzas
  titulo TEXT NOT NULL,
  descripcion TEXT,
  asignado_a_rol TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta', -- abierta | resuelta
  ref_tabla TEXT,
  ref_id INTEGER,
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES users(id),
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id INTEGER,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== REPORTES =====================
CREATE TABLE IF NOT EXISTS reportes_generados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_reporte TEXT NOT NULL,
  tipo TEXT NOT NULL, -- obra | finanzas | trabajo | compras | seguridad
  formato TEXT NOT NULL, -- pdf | xlsx | json
  contenido_json TEXT,
  archivo_url TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== CONFIGURACIÓN DE EMAIL =====================
CREATE TABLE IF NOT EXISTS config_email (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  valor TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alertas_email (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES users(id),
  rol TEXT NOT NULL,
  tipo_alerta TEXT NOT NULL, -- tarea_atrasada | documento_vencido | dinero_bajo | problema_critico
  habilitada INTEGER NOT NULL DEFAULT 1,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);
