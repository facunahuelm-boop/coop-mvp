import { NextRequest, NextResponse } from "next/server";
import { pool, insert, run, rootGet } from "@/lib/db";
import { setOrgContext } from "@/lib/tenant";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCHEMA_SQL = `-- Esquema del Sistema Operativo Digital de la Cooperativa (MVP)
-- Convertido a PostgreSQL (Supabase) para producción.

CREATE TABLE IF NOT EXISTS nucleos_familiares (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  cuota_social REAL NOT NULL DEFAULT 0,
  horas_acumuladas REAL NOT NULL DEFAULT 0,
  horas_semanales_objetivo REAL NOT NULL DEFAULT 21
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL, -- socio | comision_obra | comision_trabajo | comision_compras | comision_seguridad | administracion | tesoreria | consejo_directivo | fiscal | tecnico | admin
  nucleo_id INTEGER REFERENCES nucleos_familiares(id),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (NOW()::text),
  expira_en TEXT NOT NULL
);

-- ===================== OBRA =====================
CREATE TABLE IF NOT EXISTS tareas_obra (
  id SERIAL PRIMARY KEY,
  etapa TEXT NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  responsable_id INTEGER REFERENCES users(id),
  fecha_inicio TEXT,
  fecha_fin_prevista TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | completada
  depende_de_id INTEGER REFERENCES tareas_obra(id),
  prioridad TEXT NOT NULL DEFAULT 'media', -- baja | media | alta | critica
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS avances_obra (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas_obra(id),
  autor_id INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL DEFAULT (NOW()::text),
  descripcion TEXT NOT NULL,
  foto_url TEXT
);

CREATE TABLE IF NOT EXISTS problemas_obra (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER REFERENCES tareas_obra(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  severidad TEXT NOT NULL DEFAULT 'media', -- baja | media | critica
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | resuelto
  autor_id INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL DEFAULT (NOW()::text),
  resolucion TEXT,
  foto_url TEXT
);

-- ===================== TRABAJO =====================
CREATE TABLE IF NOT EXISTS jornadas_trabajo (
  id SERIAL PRIMARY KEY,
  fecha TEXT NOT NULL,
  descripcion TEXT,
  herramientas_necesarias TEXT,
  estado TEXT NOT NULL DEFAULT 'planificada' -- planificada | realizada | cancelada
);

CREATE TABLE IF NOT EXISTS tareas_jornada (
  id SERIAL PRIMARY KEY,
  jornada_id INTEGER NOT NULL REFERENCES jornadas_trabajo(id),
  nombre TEXT NOT NULL,
  habilidad_requerida TEXT,
  prioridad TEXT NOT NULL DEFAULT 'media',
  personas_necesarias INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS asignaciones_jornada (
  id SERIAL PRIMARY KEY,
  jornada_id INTEGER NOT NULL REFERENCES jornadas_trabajo(id),
  tarea_jornada_id INTEGER REFERENCES tareas_jornada(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  propuesta_por_ia INTEGER NOT NULL DEFAULT 0,
  confirmado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asistencias (
  id SERIAL PRIMARY KEY,
  jornada_id INTEGER NOT NULL REFERENCES jornadas_trabajo(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  presente INTEGER NOT NULL DEFAULT 0,
  horas REAL NOT NULL DEFAULT 0,
  justificacion TEXT
);

CREATE TABLE IF NOT EXISTS habilidades_nucleo (
  id SERIAL PRIMARY KEY,
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  habilidad TEXT NOT NULL
);

-- ===================== COMPRAS =====================
CREATE TABLE IF NOT EXISTS proveedores (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  contacto TEXT,
  rubro TEXT,
  notas TEXT
);

CREATE TABLE IF NOT EXISTS solicitudes_compra (
  id SERIAL PRIMARY KEY,
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
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS presupuestos_proveedor (
  id SERIAL PRIMARY KEY,
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  precio REAL NOT NULL,
  precio_unitario REAL,
  plazo_entrega_dias INTEGER,
  forma_pago TEXT,
  garantia TEXT,
  costo_envio REAL DEFAULT 0,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS decisiones_compra (
  id SERIAL PRIMARY KEY,
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id),
  presupuesto_id INTEGER REFERENCES presupuestos_proveedor(id),
  decidido_por_id INTEGER REFERENCES users(id),
  motivo TEXT,
  monto REAL,
  fecha TEXT NOT NULL DEFAULT (NOW()::text)
);

-- ===================== SEGURIDAD =====================
CREATE TABLE IF NOT EXISTS documentos_seguridad (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  descripcion TEXT,
  fecha_vencimiento TEXT,
  archivo_url TEXT,
  responsable_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS inspecciones_seguridad (
  id SERIAL PRIMARY KEY,
  fecha TEXT NOT NULL DEFAULT (NOW()::text),
  checklist_json TEXT NOT NULL,
  hallazgos TEXT,
  autor_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS incidentes_seguridad (
  id SERIAL PRIMARY KEY,
  fecha TEXT NOT NULL DEFAULT (NOW()::text),
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
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL, -- ingreso | egreso
  monto REAL NOT NULL,
  categoria TEXT NOT NULL,
  etapa_obra TEXT,
  fecha TEXT NOT NULL DEFAULT (NOW()::text),
  descripcion TEXT,
  comprobante_url TEXT,
  registrado_por_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS presupuesto_general (
  id SERIAL PRIMARY KEY,
  categoria TEXT NOT NULL,
  monto_presupuestado REAL NOT NULL,
  periodo TEXT NOT NULL -- ej: '2026'
);

CREATE TABLE IF NOT EXISTS compromisos_futuros (
  id SERIAL PRIMARY KEY,
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  fecha_estimada TEXT NOT NULL,
  origen TEXT -- ej: 'compra #12'
);

-- ===================== DOCUMENTOS =====================
CREATE TABLE IF NOT EXISTS documentos (
  id SERIAL PRIMARY KEY,
  categoria TEXT NOT NULL, -- actas | asambleas | presupuestos | facturas | contratos | tecnicos | obra | socios | seguridad | compras | reglamentos | informes | comunicaciones
  nombre TEXT NOT NULL,
  archivo_url TEXT,
  descripcion TEXT,
  subido_por_id INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS actas (
  id SERIAL PRIMARY KEY,
  organo TEXT NOT NULL, -- asamblea | consejo_directivo
  fecha TEXT NOT NULL,
  titulo TEXT NOT NULL,
  resumen TEXT NOT NULL,
  documento_id INTEGER REFERENCES documentos(id)
);

-- ===================== ALERTAS Y AUDITORÍA =====================
CREATE TABLE IF NOT EXISTS alertas (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  severidad TEXT NOT NULL, -- critica | importante | informativa
  origen_modulo TEXT NOT NULL, -- obra | trabajo | compras | seguridad | finanzas
  titulo TEXT NOT NULL,
  descripcion TEXT,
  asignado_a_rol TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta', -- abierta | resuelta
  ref_tabla TEXT,
  ref_id INTEGER,
  fecha TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES users(id),
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id INTEGER,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  fecha TEXT NOT NULL DEFAULT (NOW()::text)
);

-- ===================== REPORTES =====================
CREATE TABLE IF NOT EXISTS reportes_generados (
  id SERIAL PRIMARY KEY,
  nombre_reporte TEXT NOT NULL,
  tipo TEXT NOT NULL, -- obra | finanzas | trabajo | compras | seguridad
  formato TEXT NOT NULL, -- pdf | xlsx | json
  contenido_json TEXT,
  archivo_url TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

-- ===================== CONFIGURACIÓN DE EMAIL =====================
CREATE TABLE IF NOT EXISTS config_email (
  id SERIAL PRIMARY KEY,
  clave TEXT NOT NULL UNIQUE,
  valor TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS alertas_email (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES users(id),
  rol TEXT NOT NULL,
  tipo_alerta TEXT NOT NULL, -- tarea_atrasada | documento_vencido | dinero_bajo | problema_critico
  habilitada INTEGER NOT NULL DEFAULT 1,
  creada_en TEXT NOT NULL DEFAULT (NOW()::text)
);
`;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

async function seedData() {
  const today = new Date();

  // ================= NÚCLEOS FAMILIARES =================
  const nucleosData: [string, number][] = [
    ["Núcleo Pérez", 20], ["Núcleo Silva", 18], ["Núcleo Gómez", 22],
    ["Núcleo Rodríguez", 20], ["Núcleo Fernández", 19], ["Núcleo Castro", 21],
    ["Núcleo Núñez", 20], ["Núcleo Ramírez", 18], ["Núcleo Sosa", 20],
    ["Núcleo López", 20], ["Núcleo Martínez", 15], ["Núcleo Acosta", 20],
  ];
  const nucleos: number[] = [];
  for (const [nombre, horas] of nucleosData) {
    nucleos.push(await insert("nucleos_familiares", { nombre, cuota_social: 0, horas_acumuladas: horas }));
  }

  const habilidadesPorNucleo: Record<number, string[]> = {
    0: ["pintura"], 1: ["electricidad"], 2: ["albañilería"], 3: ["plomería"],
    4: ["electricidad"], 5: ["pintura"], 6: ["carpintería"], 7: ["albañilería"],
    8: ["plomería"], 9: ["pintura"], 10: ["electricidad"], 11: ["albañilería"],
  };
  for (const [idx, habs] of Object.entries(habilidadesPorNucleo)) {
    for (const h of habs) {
      await insert("habilidades_nucleo", { nucleo_id: nucleos[Number(idx)], habilidad: h });
    }
  }

  // ================= USUARIOS =================
  const PASSWORD = "cooperativa2026";
  const hash = bcrypt.hashSync(PASSWORD, 10);

  const usersData: [string, string, string, number | null][] = [
    ["Ana Pérez", "ana@coop.uy", "socio", 0],
    ["Beatriz Silva", "beatriz@coop.uy", "comision_obra", 1],
    ["Carlos Gómez", "carlos@coop.uy", "comision_trabajo", 2],
    ["Diana Rodríguez", "diana@coop.uy", "comision_compras", 3],
    ["Eduardo Fernández", "eduardo@coop.uy", "comision_seguridad", 4],
    ["Florencia Castro", "florencia@coop.uy", "administracion", 5],
    ["Gonzalo Núñez", "gonzalo@coop.uy", "tesoreria", 6],
    ["Helena Ramírez", "helena@coop.uy", "consejo_directivo", 7],
    ["Ignacio Sosa", "ignacio@coop.uy", "fiscal", 8],
    ["Arq. Julia Méndez (IAT)", "julia@coop.uy", "tecnico", null],
    ["Administrador del sistema", "admin@coop.uy", "admin", null],
  ];
  const users: Record<string, number> = {};
  for (const [nombre, email, rol, nucleoIdx] of usersData) {
    const id = await insert("users", {
      nombre, email, password_hash: hash, rol,
      nucleo_id: nucleoIdx === null ? null : nucleos[nucleoIdx],
      activo: 1,
    });
    users[email] = id;
  }

  // ================= OBRA =================
  const tareasData: [string, string, number, number, string, string][] = [
    ["Cimientos", "Excavación y armado de zapatas", -60, -50, "completada", "media"],
    ["Cimientos", "Hormigonado de cimientos", -50, -42, "completada", "media"],
    ["Estructura", "Columnas planta baja", -42, -28, "completada", "alta"],
    ["Estructura", "Losa entrepiso", -28, -14, "completada", "alta"],
    ["Estructura", "Columnas planta alta", -14, -2, "en_curso", "alta"],
    ["Estructura", "Losa de techo", -2, 10, "en_curso", "critica"],
    ["Mampostería", "Muros exteriores bloque 1", 5, 20, "pendiente", "media"],
    ["Mampostería", "Muros exteriores bloque 2", 15, 30, "pendiente", "media"],
    ["Mampostería", "Muros interiores", 25, 40, "pendiente", "baja"],
    ["Instalaciones", "Instalación sanitaria bloque 1", 30, 45, "pendiente", "alta"],
    ["Instalaciones", "Instalación eléctrica bloque 1", 35, 50, "pendiente", "alta"],
    ["Instalaciones", "Instalación de agua potable", 40, 55, "pendiente", "media"],
    ["Terminaciones", "Revoques exteriores", 50, 70, "pendiente", "media"],
    ["Terminaciones", "Contrapisos y pisos", 60, 80, "pendiente", "media"],
    ["Terminaciones", "Pintura general", 75, 95, "pendiente", "baja"],
  ];
  const tareas: number[] = [];
  for (const [etapa, nombre, ini, fin, estado, prioridad] of tareasData) {
    const id = await insert("tareas_obra", {
      etapa, nombre,
      descripcion: `${nombre} — etapa ${etapa}.`,
      responsable_id: users["beatriz@coop.uy"],
      fecha_inicio: iso(addDays(today, ini)),
      fecha_fin_prevista: iso(addDays(today, fin)),
      estado, prioridad,
      depende_de_id: null,
    });
    tareas.push(id);
  }
  await run(`UPDATE tareas_obra SET depende_de_id = ? WHERE id = ?`, [tareas[4], tareas[5]]);
  await run(`UPDATE tareas_obra SET depende_de_id = ? WHERE id = ?`, [tareas[5], tareas[6]]);
  await run(`UPDATE tareas_obra SET depende_de_id = ? WHERE id = ?`, [tareas[5], tareas[7]]);
  await run(`UPDATE tareas_obra SET fecha_fin_prevista = ? WHERE id = ?`, [iso(addDays(today, -3)), tareas[5]]);

  await insert("avances_obra", { tarea_id: tareas[3], autor_id: users["beatriz@coop.uy"], fecha: iso(addDays(today, -13)), descripcion: "Losa de entrepiso hormigonada sin observaciones." });
  await insert("avances_obra", { tarea_id: tareas[4], autor_id: users["beatriz@coop.uy"], fecha: iso(addDays(today, -5)), descripcion: "Avance 70% de columnas de planta alta. Falta encofrado de 4 columnas." });

  await insert("problemas_obra", {
    tarea_id: tareas[5], titulo: "Demora en entrega de hierro para losa de techo",
    descripcion: "El proveedor de hierro avisó un atraso de 10 días en la entrega, lo que retrasa el inicio del armado de la losa de techo.",
    severidad: "critica", estado: "abierto", autor_id: users["beatriz@coop.uy"], fecha: iso(addDays(today, -4)),
  });
  await insert("problemas_obra", {
    tarea_id: tareas[6], titulo: "Falta definir detalle de mampostería en encuentro con caja de escalera",
    descripcion: "El IAT tiene que confirmar el detalle constructivo antes de avanzar con los muros exteriores del bloque 1.",
    severidad: "media", estado: "abierto", autor_id: users["beatriz@coop.uy"], fecha: iso(addDays(today, -1)),
  });

  // ================= TRABAJO =================
  const jornadaIds: number[] = [];
  for (let semanasAtras = 8; semanasAtras >= 1; semanasAtras--) {
    const fecha = iso(addDays(today, -semanasAtras * 7));
    const jid = await insert("jornadas_trabajo", { fecha, descripcion: "Jornada de ayuda mutua", herramientas_necesarias: "Palas, baldes, nivel, andamios", estado: "realizada" });
    jornadaIds.push(jid);
    for (const nid of nucleos) {
      const presente = Math.random() > 0.15 ? 1 : 0;
      await insert("asistencias", { jornada_id: jid, nucleo_id: nid, presente, horas: presente ? 3 : 0, justificacion: presente ? null : "Falta justificada por trabajo" });
    }
  }
  const proximaFecha = iso(addDays(today, (6 - today.getDay() + 7) % 7 || 7));
  const proximaJornada = await insert("jornadas_trabajo", { fecha: proximaFecha, descripcion: "Avance de estructura y orden de obra", herramientas_necesarias: "Andamios, taladro, nivel láser", estado: "planificada" });
  const tj1 = await insert("tareas_jornada", { jornada_id: proximaJornada, nombre: "Encofrado de columnas restantes", habilidad_requerida: "albañilería", prioridad: "alta", personas_necesarias: 6 });
  const tj2 = await insert("tareas_jornada", { jornada_id: proximaJornada, nombre: "Orden y limpieza general de obra", habilidad_requerida: null, prioridad: "media", personas_necesarias: 5 });
  await insert("tareas_jornada", { jornada_id: proximaJornada, nombre: "Revisión de instalación eléctrica provisoria", habilidad_requerida: "electricidad", prioridad: "alta", personas_necesarias: 2 });
  for (const idx of [2, 7, 11, 0, 5]) {
    await insert("asignaciones_jornada", { jornada_id: proximaJornada, tarea_jornada_id: tj1, nucleo_id: nucleos[idx], propuesta_por_ia: 1, confirmado: 1 });
  }
  for (const idx of [3, 6, 9]) {
    await insert("asignaciones_jornada", { jornada_id: proximaJornada, tarea_jornada_id: tj2, nucleo_id: nucleos[idx], propuesta_por_ia: 1, confirmado: 0 });
  }

  // ================= PROVEEDORES =================
  const proveedoresData: [string, string, string][] = [
    ["Corralón San José", "2900-1111", "materiales de construcción"],
    ["Ferretería El Tornillo", "2900-2222", "ferretería"],
    ["Materiales Uruguay SA", "2900-3333", "materiales de construcción"],
    ["ElectroObra", "2900-4444", "instalaciones eléctricas"],
    ["Sanitarios del Este", "2900-5555", "instalaciones sanitarias"],
    ["Hierros del Cerro", "2900-6666", "hierro y acero"],
  ];
  const proveedores: Record<string, number> = {};
  for (const [nombre, contacto, rubro] of proveedoresData) {
    proveedores[nombre] = await insert("proveedores", { nombre, contacto, rubro });
  }

  async function crearSolicitud(data: any) {
    return insert("solicitudes_compra", {
      solicitante_id: users[data.solicitante], comision: data.comision, material: data.material,
      cantidad: data.cantidad, unidad: data.unidad, especificacion: data.especificacion,
      prioridad: data.prioridad, etapa_obra: data.etapa_obra, fecha_necesaria: data.fecha_necesaria,
      presupuesto_estimado: data.presupuesto_estimado, estado: data.estado,
    });
  }
  async function cargarPresupuesto(solicitudId: number, proveedorNombre: string, datos: any) {
    return insert("presupuestos_proveedor", { solicitud_id: solicitudId, proveedor_id: proveedores[proveedorNombre], ...datos });
  }

  const sc1 = await crearSolicitud({
    solicitante: "beatriz@coop.uy", comision: "Comisión de Obra", material: "Hierro de construcción 8mm",
    cantidad: 800, unidad: "kg", especificacion: "Hierro conformado ADN 420, barras de 12m",
    prioridad: "critica", etapa_obra: "Estructura", fecha_necesaria: iso(addDays(today, 5)),
    presupuesto_estimado: 95000, estado: "en_comparacion",
  });
  await cargarPresupuesto(sc1, "Hierros del Cerro", { precio: 92000, precio_unitario: 115, plazo_entrega_dias: 12, forma_pago: "30 días", garantia: "No informa", costo_envio: 3000 });
  await cargarPresupuesto(sc1, "Materiales Uruguay SA", { precio: 97000, precio_unitario: 121, plazo_entrega_dias: 5, forma_pago: "contado", garantia: "Certificado de calidad INN", costo_envio: 0 });
  await cargarPresupuesto(sc1, "Corralón San José", { precio: 99500, precio_unitario: 124, plazo_entrega_dias: 7, forma_pago: "15 días", garantia: "Certificado de calidad INN", costo_envio: 0 });

  const sc2 = await crearSolicitud({
    solicitante: "beatriz@coop.uy", comision: "Comisión de Obra", material: "Cemento Portland",
    cantidad: 100, unidad: "bolsas de 25kg", especificacion: "Cemento portland normal",
    prioridad: "alta", etapa_obra: "Mampostería", fecha_necesaria: iso(addDays(today, 20)),
    presupuesto_estimado: 45000, estado: "aprobada",
  });
  const p2a = await cargarPresupuesto(sc2, "Corralón San José", { precio: 43000, precio_unitario: 430, plazo_entrega_dias: 3, forma_pago: "contado", garantia: "No informa", costo_envio: 0 });
  await cargarPresupuesto(sc2, "Materiales Uruguay SA", { precio: 46500, precio_unitario: 465, plazo_entrega_dias: 2, forma_pago: "contado", garantia: "No informa", costo_envio: 0 });
  await cargarPresupuesto(sc2, "Ferretería El Tornillo", { precio: 44800, precio_unitario: 448, plazo_entrega_dias: 5, forma_pago: "15 días", garantia: "No informa", costo_envio: 1500 });
  await insert("decisiones_compra", { solicitud_id: sc2, presupuesto_id: p2a, decidido_por_id: users["gonzalo@coop.uy"], motivo: "Precio más bajo y entrega rápida.", monto: 43000, fecha: iso(addDays(today, -10)) });

  await crearSolicitud({
    solicitante: "eduardo@coop.uy", comision: "Comisión de Seguridad", material: "Tablero eléctrico provisorio de obra",
    cantidad: 1, unidad: "unidad", especificacion: "Tablero con térmica y diferencial, IP65",
    prioridad: "alta", etapa_obra: "Instalaciones", fecha_necesaria: iso(addDays(today, 15)),
    presupuesto_estimado: 18000, estado: "pendiente_cotizacion",
  });

  const sc4 = await crearSolicitud({
    solicitante: "carlos@coop.uy", comision: "Comisión de Trabajo", material: "Pintura látex exterior",
    cantidad: 40, unidad: "litros", especificacion: "Látex exterior blanco",
    prioridad: "baja", etapa_obra: "Terminaciones", fecha_necesaria: iso(addDays(today, 90)),
    presupuesto_estimado: 20000, estado: "entregada",
  });
  const p4a = await cargarPresupuesto(sc4, "Ferretería El Tornillo", { precio: 19500, precio_unitario: 487, plazo_entrega_dias: 4, forma_pago: "contado", garantia: "No informa", costo_envio: 0 });
  await insert("decisiones_compra", { solicitud_id: sc4, presupuesto_id: p4a, decidido_por_id: users["diana@coop.uy"], motivo: "Único presupuesto recibido en plazo, precio razonable.", monto: 19500, fecha: iso(addDays(today, -30)) });

  // ================= SEGURIDAD =================
  await insert("documentos_seguridad", { tipo: "Comunicación de apertura de obra (MTSS)", descripcion: "Trámite ante Inspección de Trabajo", fecha_vencimiento: iso(addDays(today, 200)), responsable_id: users["eduardo@coop.uy"] });
  await insert("documentos_seguridad", { tipo: "Seguro de accidentes de trabajo (BSE)", descripcion: "Póliza colectiva de la obra", fecha_vencimiento: iso(addDays(today, -3)), responsable_id: users["eduardo@coop.uy"] });
  await insert("documentos_seguridad", { tipo: "Capacitación en seguridad — inducción general", descripcion: "Vencimiento de la certificación grupal", fecha_vencimiento: iso(addDays(today, 10)), responsable_id: users["eduardo@coop.uy"] });
  await insert("documentos_seguridad", { tipo: "Certificado de andamios", descripcion: "Habilitación de andamios tubulares", fecha_vencimiento: iso(addDays(today, 120)), responsable_id: users["eduardo@coop.uy"] });

  await insert("inspecciones_seguridad", {
    fecha: iso(addDays(today, -6)),
    checklist_json: JSON.stringify([
      { item: "Uso de casco en obra", ok: true }, { item: "Vallado de zona de excavación", ok: true },
      { item: "Extintor accesible", ok: true }, { item: "Botiquín completo", ok: false },
      { item: "Señalización de riesgo eléctrico", ok: true },
    ]),
    hallazgos: "Botiquín incompleto: falta reponer gasas y suero fisiológico.",
    autor_id: users["eduardo@coop.uy"],
  });

  await insert("incidentes_seguridad", {
    fecha: iso(addDays(today, -20)), tipo: "incidente", descripcion: "Caída de material desde andamio, sin personas afectadas.",
    severidad: "media", estado: "resuelto", medidas: "Se reforzó el amarre de plataformas y se recordó protocolo de izaje.",
    autor_id: users["eduardo@coop.uy"],
  });
  await insert("incidentes_seguridad", {
    fecha: iso(addDays(today, -2)), tipo: "observacion", descripcion: "Acopio de bloques cerca del paso peatonal interno de obra.",
    severidad: "media", estado: "abierto", medidas: null,
    ia_observacion: "Asistencia preliminar de IA: en la foto se observa material apilado sobre una zona de circulación. Esto es una observación preliminar automática, no un diagnóstico definitivo — debe confirmarlo el responsable de seguridad.",
    autor_id: users["eduardo@coop.uy"],
  });

  // ================= FINANZAS =================
  await insert("presupuesto_general", { categoria: "Estructura", monto_presupuestado: 900000, periodo: "2026" });
  await insert("presupuesto_general", { categoria: "Mampostería", monto_presupuestado: 400000, periodo: "2026" });
  await insert("presupuesto_general", { categoria: "Instalaciones", monto_presupuestado: 500000, periodo: "2026" });
  await insert("presupuesto_general", { categoria: "Terminaciones", monto_presupuestado: 350000, periodo: "2026" });
  await insert("presupuesto_general", { categoria: "Administración", monto_presupuestado: 80000, periodo: "2026" });

  const movimientos: [string, number, string, string, number][] = [
    ["ingreso", 1200000, "Préstamo ANV — desembolso etapa 1", "Estructura", -70],
    ["ingreso", 45000, "Cuotas sociales del mes", "Administración", -30],
    ["ingreso", 45000, "Cuotas sociales del mes", "Administración", -60],
    ["egreso", 320000, "Estructura", "Estructura", -55],
    ["egreso", 610000, "Estructura", "Estructura", -35],
    ["egreso", 43000, "Mampostería", "Mampostería", -10],
    ["egreso", 19500, "Terminaciones", "Terminaciones", -30],
    ["egreso", 15000, "Administración", "Administración", -20],
    ["egreso", 8000, "Administración", "Administración", -5],
  ];
  for (const [tipo, monto, descripcion, categoria, diasAtras] of movimientos) {
    await insert("movimientos_financieros", { tipo, monto, categoria, etapa_obra: categoria, fecha: iso(addDays(today, diasAtras)), descripcion, registrado_por_id: users["florencia@coop.uy"] });
  }

  await insert("compromisos_futuros", { descripcion: "Compra de hierro (solicitud pendiente de decisión)", monto: 97000, fecha_estimada: iso(addDays(today, 8)), origen: `solicitud #${sc1}` });
  await insert("compromisos_futuros", { descripcion: "Cuota de honorarios IAT del mes", monto: 60000, fecha_estimada: iso(addDays(today, 5)), origen: "contrato IAT" });
  await insert("compromisos_futuros", { descripcion: "Alquiler de andamios (mes en curso)", monto: 25000, fecha_estimada: iso(addDays(today, 3)), origen: "contrato de alquiler" });
  await insert("compromisos_futuros", { descripcion: "Materiales de instalación sanitaria (próxima etapa)", monto: 180000, fecha_estimada: iso(addDays(today, 25)), origen: "planificación de compras" });

  // ================= DOCUMENTOS Y ACTAS =================
  await insert("documentos", { categoria: "reglamentos", nombre: "Reglamento de Obra y Ayuda Mutua", descripcion: "Versión vigente aprobada por Asamblea", subido_por_id: users["florencia@coop.uy"], fecha: iso(addDays(today, -200)) });
  const docActaAsamblea = await insert("documentos", { categoria: "actas", nombre: "Acta Asamblea Ordinaria — aprobación de presupuesto 2026", subido_por_id: users["florencia@coop.uy"], fecha: iso(addDays(today, -70)) });
  const docActaConsejo = await insert("documentos", { categoria: "actas", nombre: "Acta Consejo Directivo — compra de hierro", subido_por_id: users["florencia@coop.uy"], fecha: iso(addDays(today, -9)) });

  await insert("actas", {
    organo: "asamblea", fecha: iso(addDays(today, -70)), titulo: "Aprobación de presupuesto general 2026",
    resumen: "La Asamblea aprobó por mayoría el presupuesto general de obra para 2026, con las categorías Estructura, Mampostería, Instalaciones, Terminaciones y Administración, y facultó a Tesorería a autorizar pagos de hasta $50.000 sin necesidad de aprobación previa del Consejo Directivo.",
    documento_id: docActaAsamblea,
  });
  await insert("actas", {
    organo: "consejo_directivo", fecha: iso(addDays(today, -9)), titulo: "Seguimiento de compra de hierro para losa de techo",
    resumen: "El Consejo Directivo tomó conocimiento del atraso del proveedor habitual de hierro y solicitó a la Comisión de Compras avanzar con al menos tres presupuestos alternativos antes de fin de semana, dado el impacto en el cronograma de la etapa Estructura.",
    documento_id: docActaConsejo,
  });

  return { usuarios: usersData.map(([nombre, email, rol]) => ({ email, rol, nombre })), password: PASSWORD };
}

// IMPORTANTE (Fase 0 — multi-tenant): este endpoint YA NO BORRA nada.
// Antes, cada llamada hacía TRUNCATE ... CASCADE sobre las 28 tablas y las
// recargaba con datos de ejemplo — eso funcionaba con una sola cooperativa,
// pero ahora borraría los datos de TODAS las cooperativas de una sola vez.
// Ver auditoría, sección 3 ("Problemas encontrados") y sección 6.
//
// Lo único que hace ahora:
//   1. Crea las tablas base si no existen (idempotente, sin riesgo).
//   2. Opcionalmente (?seed=demo), carga los datos de ejemplo — pero solo
//      dentro de la cooperativa "ufama" y solo si esa cooperativa todavía no
//      tiene usuarios cargados, para que no se pueda duplicar por accidente.
// La creación de una cooperativa NUEVA se hace con las migraciones
// (`npm run migrate`) más el asistente de alta (Fase 16), nunca con esta ruta.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const statements = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await pool.query(stmt);
    }

    const querSeed = req.nextUrl.searchParams.get("seed") === "demo";
    if (!querSeed) {
      return NextResponse.json({
        ok: true,
        mensaje: "Tablas base verificadas/creadas. No se cargaron datos (agregá &seed=demo para cargar datos de ejemplo en la cooperativa UFAMA, solo si está vacía).",
      });
    }

    const ufama = await rootGet<{ id: number }>(`SELECT id FROM organizations WHERE slug = 'ufama'`);
    if (!ufama) {
      return NextResponse.json(
        { ok: false, error: "No existe la cooperativa 'ufama'. Corré antes `npm run migrate`." },
        { status: 409 }
      );
    }
    setOrgContext(ufama.id);

    const yaTieneDatos = await rootGet<{ count: string }>(
      `SELECT count(*)::text FROM users WHERE organization_id = $1`,
      [ufama.id]
    );
    if (Number(yaTieneDatos?.count || 0) > 0) {
      return NextResponse.json(
        { ok: false, error: "La cooperativa UFAMA ya tiene usuarios cargados — no se vuelve a sembrar para no duplicar datos." },
        { status: 409 }
      );
    }

    const resultado = await seedData();
    return NextResponse.json({ ok: true, mensaje: "Esquema verificado y datos de ejemplo cargados en UFAMA.", ...resultado });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
