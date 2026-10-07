import { redirect, notFound } from "next/navigation";
import { puedeUsarPlantillas } from "@/lib/actions/plantillasTexto";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, canApprove, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { ESTADO_SOCIO_INFO, antiguedad, etiquetaEstadoSocio, type EstadoSocio } from "@/lib/sociosEstados";
import { checklistDeIngreso } from "@/lib/sociosAlta";
import { hoyEnUruguay } from "@/lib/horasObra";
import { CambiarEstadoSocioForm, CrearNucleoBoton, PasoIngresoBoton, AgregarOficioForm, QuitarOficioBoton } from "@/components/socios/CicloVidaFormularios";
import { get, all } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta, resumenDeCuotas, historialSocio } from "@/lib/logic";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, StatTile } from "@/components/ui";
import { HistorialAuditoria } from "@/components/HistorialAuditoria";
import { ActionForm, Tabs } from "@/components/ui-client";
import { FilaConDetalle } from "@/components/FilaConDetalle";
import { EstadoCuotaBadge } from "@/components/cuotas/EstadoCuota";
import dayjs from "dayjs";
import { cambiarEstadoIntegranteFormAction } from "@/lib/actions/socios";
import { RELACION_INTEGRANTE, RELACION_INTEGRANTE_LABEL, METODO_PAGO_LABEL, CATEGORIAS_DOCUMENTO_BASE, CATEGORIA_DOCUMENTO_LABEL } from "@/lib/constants";
import { SubirDocumentoNucleoForm } from "@/components/documentos/DocumentosFormularios";
import { CARGO_LABEL, type CargoConsejo } from "@/lib/consejoDirectivoCargos";
import { NucleoLink } from "@/components/EntidadLink";
import { recibosDeSocio } from "@/lib/recibos";
import { codigoDePago } from "@/lib/reglamento";
import { BotonAccion } from "@/components/FormularioEnModal";
import { emitirReciboFormAction } from "@/lib/actions/recibos";
import {
  ActualizarSocioForm,
  AgregarIntegranteForm,
  EditarIntegranteForm,
  RegistrarMovimientoCuentaForm,
  EditarMovimientoCuentaForm,
  AnularMovimientoCuentaBoton,
  NuevoConvenioForm,
  GestionConvenioAcciones,
} from "@/components/socios/SocioDetalleFormularios";

/**
 * Ficha 360° del núcleo (actualización "Gestión cooperativa integrada",
 * 04/10). En COOVA el núcleo es el socio titular con sus integrantes — esta
 * ficha ya existía con datos, integrantes, estado de cuenta e historial; se
 * reorganiza en pestañas (para no ser una pantalla interminable) y se suma lo
 * que estaba repartido por el sistema: cuotas con detalle, pagos, convenios,
 * participación (comisiones, Consejo, asambleas), documentos,
 * comunicaciones, tareas e historial. NADA de lo que mostraba antes se quitó.
 *
 * Todo se LEE de las tablas que ya existen (no se duplica ningún dato), y
 * cada pestaña respeta el mismo permiso que ya protegía esa información:
 *  - cuenta corriente: equipo de Finanzas o el propio socio (como siempre);
 *  - comunicaciones e historial: quien puede ver la Auditoría, o el propio socio
 *    (comunicaciones);
 *  - documentos: quien puede leer Documentos;
 *  - tareas: quien puede leer Comisiones.
 * Al tocar una cuota, pago, asamblea o tarea se abre su detalle en una
 * ventana, sin salir de la ficha.
 */

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
const money2 = (n: number) => `$${n.toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fecha = (f: string | null | undefined) => (f ? dayjs(f).format("DD/MM/YYYY") : "—");
const periodoTexto = (p: string) => (p && /^\d{4}-\d{2}$/.test(p) ? dayjs(`${p}-01`).format("MMMM YYYY") : p || "—");

const badgeSocio: Record<string, "verde" | "amarillo" | "rojo"> = {
  activo: "verde",
  inactivo: "amarillo",
  baja: "rojo",
};

const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "amarillo" | "brand" | "verde"> = { pendiente: "amarillo", en_curso: "brand", completada: "verde" };
type ConvenioRow = {
  id: number;
  socio_id: number;
  motivo: string;
  monto_total: number;
  cantidad_cuotas: number;
  monto_cuota: number;
  fecha_inicio: string;
  dia_vencimiento?: number | null;
  estado: string;
  refinancia?: boolean | null;
  notas?: string | null;
  creado_en: string;
};
type AsambleaRow = { id: number; titulo: string; fecha: string; lugar: string | null; estado: string; tipo_asamblea: string | null; asistio: number | null; invitado: number | null };
type DocumentoNucleoRow = { id: number; nombre: string; categoria: string; fecha: string; estado: string | null; fecha_vencimiento: string | null; subido_por: string | null };
type CorreoRow = { id: number; asunto: string; creado_en: string; estado: string; remitente: string | null };
type NotificacionRow = { id: number; titulo: string; creado_en: string; leida: boolean | number };
type TareaNucleoRow = {
  id: number;
  titulo: string;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  fecha_vencimiento: string | null;
  creado_en: string;
  comision_nombre: string | null;
  responsable_nombre: string | null;
  es_responsable: boolean;
};

export default async function SocioDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const socioId = Number(id);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "socios")) redirect("/dashboard");

  const socio = await get<any>(
    `SELECT s.*, v.numero as vivienda_numero, n.nombre as nucleo_nombre,
            n.horas_acumuladas, n.horas_semanales_objetivo
     FROM socios s
     LEFT JOIN viviendas v ON v.id = s.vivienda_id
     LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
     WHERE s.id = ?`,
    [socioId]
  ).catch(() => null);
  if (!socio) notFound();

  const esElPropioSocio = !!socio.user_id && socio.user_id === user.id;
  const puedeVerCuenta = ROLES_FINANZAS_DETALLE.includes(user.rol) || (user.rol === "socio" && esElPropioSocio);
  const puedeUsarPlantillasAqui = await puedeUsarPlantillas(user.rol);
  const puedeRegistrar = canEdit(user.rol, "finanzas");
  const puedeAnular = user.rol === "admin";
  const puedeEditar = canEdit(user.rol, "socios");
  const puedeVerHistorial = canRead(user.rol, "auditoria");
  const puedeVerComunicaciones = puedeVerHistorial || esElPropioSocio;
  const puedeVerDocumentos = canRead(user.rol, "documentos");
  const puedeSubirDocumentos = canEdit(user.rol, "documentos");
  const puedeVerTareas = canRead(user.rol, "comisiones");

  const vacio = <T,>() => [] as T[];
  const [integrantes, habilidades, movimientos, convenios, ingresosVinculados, comisiones, cargosConsejo, asambleas, documentos, correos, notificaciones, tareas, historial] =
    await Promise.all([
      // Integrantes del núcleo (pareja, hijos, etc.) — migración 0019.
      all<any>(
        `SELECT * FROM socio_integrantes WHERE socio_id = ? ORDER BY (estado != 'activo'), CASE relacion WHEN 'titular' THEN 0 ELSE 1 END, nombre ASC`,
        [socioId]
      ).catch(vacio<any>),
      socio.nucleo_id
        ? all<{ id: number; habilidad: string; persona: string | null; nota: string | null }>(
            `SELECT id, habilidad, persona, nota FROM habilidades_nucleo WHERE nucleo_id = ? AND COALESCE(activo, 1) = 1 ORDER BY habilidad`,
            [socio.nucleo_id]
          ).catch(async () => (await all<{ habilidad: string }>(`SELECT habilidad FROM habilidades_nucleo WHERE nucleo_id = ?`, [socio.nucleo_id]).catch(() => [])).map((h, i) => ({ id: -i - 1, habilidad: h.habilidad, persona: null, nota: null })))
        : Promise.resolve([] as { id: number; habilidad: string; persona: string | null; nota: string | null }[]),
      puedeVerCuenta ? cargarMovimientosCuenta(socioId) : Promise.resolve([]),
      puedeVerCuenta
        ? all<ConvenioRow>(`SELECT * FROM convenios_pago WHERE socio_id = ? ORDER BY creado_en DESC`, [socioId]).catch(vacio<ConvenioRow>)
        : Promise.resolve([] as ConvenioRow[]),
      // Pagos que ya figuran como ingreso en Finanzas (migración 0048).
      puedeVerCuenta
        ? all<{ id: number; movimiento_cuenta_socio_id: number; estado: string }>(
            `SELECT mf.id, mf.movimiento_cuenta_socio_id, mf.estado FROM movimientos_financieros mf
             JOIN movimientos_cuenta_socio m ON m.id = mf.movimiento_cuenta_socio_id
             WHERE m.socio_id = ?`,
            [socioId]
          ).catch(vacio<{ id: number; movimiento_cuenta_socio_id: number; estado: string }>)
        : Promise.resolve([] as { id: number; movimiento_cuenta_socio_id: number; estado: string }[]),
      // ----- Participación (por la cuenta de usuario del titular) -----
      socio.user_id
        ? all<{ id: number; nombre: string; rol_en_comision: string; desde: string }>(
            `SELECT c.id, c.nombre, cm.rol_en_comision, cm.desde
             FROM comision_miembros cm JOIN comisiones c ON c.id = cm.comision_id
             WHERE cm.user_id = ? AND cm.activo = 1 ORDER BY c.nombre`,
            [socio.user_id]
          ).catch(vacio<{ id: number; nombre: string; rol_en_comision: string; desde: string }>)
        : Promise.resolve([] as { id: number; nombre: string; rol_en_comision: string; desde: string }[]),
      socio.user_id
        ? all<{ cargo: CargoConsejo; fecha_inicio: string; fecha_fin: string | null }>(
            `SELECT cargo, fecha_inicio, fecha_fin FROM consejo_directivo_cargos WHERE user_id = ? ORDER BY fecha_inicio DESC`,
            [socio.user_id]
          ).catch(vacio<{ cargo: CargoConsejo; fecha_inicio: string; fecha_fin: string | null }>)
        : Promise.resolve([] as { cargo: CargoConsejo; fecha_inicio: string; fecha_fin: string | null }[]),
      // Asambleas: asistencia registrada del núcleo y/o invitación del titular.
      all<AsambleaRow>(
        `SELECT r.id, r.titulo, r.fecha, r.lugar, r.estado, r.tipo_asamblea,
                ra.presente AS asistio, ri.id AS invitado
         FROM reuniones r
         LEFT JOIN reunion_asistencias ra ON ra.reunion_id = r.id AND ra.nucleo_id = ?
         LEFT JOIN reunion_invitados ri ON ri.reunion_id = r.id AND ri.user_id = ?
         WHERE r.tipo = 'asamblea' AND (ra.id IS NOT NULL OR ri.id IS NOT NULL)
         ORDER BY r.fecha DESC`,
        [socio.nucleo_id ?? 0, socio.user_id ?? 0]
      ).catch(vacio<AsambleaRow>),
      puedeVerDocumentos
        ? all<DocumentoNucleoRow>(
            `SELECT d.id, d.nombre, d.categoria, d.fecha, d.estado, d.fecha_vencimiento, u.nombre AS subido_por
             FROM documentos d LEFT JOIN users u ON u.id = d.subido_por_id
             WHERE d.socio_id = ? ORDER BY d.fecha DESC`,
            [socioId]
          ).catch(vacio<DocumentoNucleoRow>)
        : Promise.resolve([] as DocumentoNucleoRow[]),
      puedeVerComunicaciones
        ? all<CorreoRow>(
            `SELECT mc.id, mc.asunto, mc.creado_en, mc.estado, u.nombre AS remitente
             FROM mensajes_correo mc LEFT JOIN users u ON u.id = mc.remitente_id
             WHERE (mc.destinatario_tipo = 'usuario' AND mc.destinatario_id = ?)
                OR (? <> '' AND mc.destinatarios::text ILIKE ?)
             ORDER BY mc.creado_en DESC LIMIT 30`,
            [socio.user_id ?? 0, socio.email || "", `%${socio.email || "@@sin-email@@"}%`]
          ).catch(vacio<CorreoRow>)
        : Promise.resolve([] as CorreoRow[]),
      puedeVerComunicaciones && socio.user_id
        ? all<NotificacionRow>(`SELECT id, titulo, creado_en, leida FROM notificaciones WHERE user_id = ? ORDER BY creado_en DESC LIMIT 20`, [socio.user_id]).catch(vacio<NotificacionRow>)
        : Promise.resolve([] as NotificacionRow[]),
      puedeVerTareas && socio.user_id
        ? all<TareaNucleoRow>(
            `SELECT t.id, t.titulo, t.descripcion, t.estado, t.prioridad, t.fecha_vencimiento, t.creado_en,
                    c.nombre AS comision_nombre, u.nombre AS responsable_nombre,
                    (t.responsable_id = ?) AS es_responsable
             FROM tareas t
             LEFT JOIN comisiones c ON c.id = t.comision_id
             LEFT JOIN users u ON u.id = t.responsable_id
             WHERE t.responsable_id = ? OR t.id IN (SELECT tarea_id FROM tarea_colaboradores WHERE user_id = ?)
             ORDER BY (t.estado = 'completada'), t.fecha_vencimiento NULLS LAST, t.id DESC`,
            [socio.user_id, socio.user_id, socio.user_id]
          ).catch(vacio<TareaNucleoRow>)
        : Promise.resolve([] as TareaNucleoRow[]),
      puedeVerHistorial ? historialSocio(socioId) : Promise.resolve([]),
    ]);

  // ----- Cuenta corriente: una sola fuente de verdad (calcularCuotasSocio) -----
  const { cuotas, saldo } = calcularCuotasSocio(movimientos);
  const conteo = resumenDeCuotas(cuotas);
  const cuotaPorId = new Map(cuotas.map((c) => [c.id, c]));
  const pagos = movimientos.filter((m) => m.tipo === "pago").slice().reverse();
  const ingresoPorPago = new Map(ingresosVinculados.map((i) => [i.movimiento_cuenta_socio_id, i]));
  const convenio = convenios.find((c) => c.estado === "activo") || null;
  const cuotasConvenio = convenio ? cuotas.filter((c) => c.convenioId === convenio.id) : [];
  const cuotasAbiertas = cuotas
    .filter((c) => c.montoPendiente > 0)
    .map((c) => ({
      id: c.id,
      pendiente: c.montoPendiente,
      label: `${c.concepto} — vence ${fecha(c.fechaVencimiento)} — debe ${money2(c.montoPendiente)}${c.estado === "vencida" ? " (vencida)" : ""}`,
    }));
  const comprobantes = movimientos.filter((m) => m.comprobante_url && m.estado !== "anulado");

  // ================= Pestaña: General =================
  // Fase 2C: estado con historial, antigüedad, ingreso y oficios.
  const hoyUy = hoyEnUruguay();
  const [historialEstados, pasosIngreso] = await Promise.all([
    all<{ id: number; estado_anterior: string | null; estado_nuevo: string; fecha: string; motivo: string | null; quien: string | null }>(
      `SELECT e.id, e.estado_anterior, e.estado_nuevo, e.fecha, e.motivo, u.nombre AS quien FROM socio_estados e LEFT JOIN users u ON u.id = e.registrado_por_id WHERE e.socio_id = ? ORDER BY e.fecha DESC, e.id DESC`,
      [socioId]
    ).catch(() => []),
    checklistDeIngreso(socioId),
  ]);
  const infoEstado = ESTADO_SOCIO_INFO[(socio.estado ?? "activo") as EstadoSocio] ?? ESTADO_SOCIO_INFO.activo;
  const antig = antiguedad(socio.fecha_ingreso, hoyUy);
  const ingresoPendiente = pasosIngreso && pasosIngreso.some((p) => !p.hecho);

  const tabGeneral = (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] text-ink-muted">Estado:</span>
              <Badge color={infoEstado.color}>{infoEstado.label}</Badge>
              {antig && <span className="text-[15px] text-ink">· socio hace {antig.texto}</span>}
            </div>
            <p className="mt-1 text-[15px] text-ink-muted">{infoEstado.explicacion}</p>
          </div>
          {puedeEditar && <CambiarEstadoSocioForm socioId={socio.id} estadoActual={socio.estado} puedeSancionar={canApprove(user.rol, "socios")} hoy={hoyUy} />}
        </div>
        {historialEstados.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">Historial de estados ({historialEstados.length})</summary>
            <ul className="mt-2 divide-y divide-border text-[15px]">
              {historialEstados.map((h) => (
                <li key={h.id} className="py-2">
                  <b>{fecha(h.fecha)}</b> · {h.estado_anterior ? `${etiquetaEstadoSocio(h.estado_anterior)} → ` : ""}
                  {etiquetaEstadoSocio(h.estado_nuevo)}
                  {h.motivo && <span className="block text-sm text-ink-muted">{h.motivo}{h.quien ? ` · ${h.quien}` : ""}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {pasosIngreso && (ingresoPendiente || socio.estado === "aspirante") && (
        <Card className="mb-4">
          <h2 className="text-lg font-bold text-ink">Ingreso a la cooperativa</h2>
          <p className="text-[15px] text-ink-muted">Los pasos para recibir bien a un socio nuevo. Algunos se marcan solos.</p>
          <ul className="mt-2 divide-y divide-border">
            {pasosIngreso.map((p) => (
              <li key={p.clave} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                <span className="flex items-start gap-2">
                  <span aria-hidden className={p.hecho ? "text-[var(--color-verde)]" : "text-ink-faint"}>{p.hecho ? "✔" : "○"}</span>
                  <span>
                    <span className="font-medium text-ink">{p.titulo}</span>
                    <span className="block text-sm text-ink-muted">{p.automatico ? "Hecho (se marcó solo)" : p.hecho && p.quien ? `Hecho por ${p.quien}` : p.ayuda}</span>
                  </span>
                </span>
                {puedeEditar && !p.automatico && <PasoIngresoBoton socioId={socio.id} item={p.clave} hecho={p.hecho} />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-ink/50">Documento:</span> {socio.documento || "—"}</div>
          <div><span className="text-ink/50">Fecha de ingreso:</span> {fecha(socio.fecha_ingreso)}</div>
          <div><span className="text-ink/50">Email:</span> {socio.email || "—"}</div>
          <div><span className="text-ink/50">Teléfono:</span> {socio.telefono || "—"}</div>
          <div><span className="text-ink/50">Vivienda:</span> {socio.vivienda_numero || "Sin asignar"}</div>
          <div>
            <span className="text-ink/50">Núcleo de trabajo:</span>{" "}
            {socio.nucleo_id ? <NucleoLink id={socio.nucleo_id} nombre={socio.nucleo_nombre} /> : puedeEditar ? <CrearNucleoBoton socioId={socio.id} /> : "—"}
          </div>
          {socio.nucleo_id && (
            <div>
              <span className="text-ink/50">Horas de ayuda mutua:</span>{" "}
              {Math.round(Number(socio.horas_acumuladas || 0))} h acumuladas
              {socio.horas_semanales_objetivo ? ` · objetivo ${Number(socio.horas_semanales_objetivo)} h/semana` : ""}
            </div>
          )}
          {(habilidades.length > 0 || (puedeEditar && socio.nucleo_id)) && (
            <div className="sm:col-span-2">
              <span className="text-ink/50">Oficios del núcleo:</span>{" "}
              {habilidades.length === 0 && <span className="text-ink-muted">ninguno cargado</span>}
              <ul className="mt-1 flex flex-wrap gap-2">
                {habilidades.map((h) => (
                  <li key={h.id} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1">
                    <span>
                      <b>{h.habilidad}</b>
                      {h.persona ? ` — ${h.persona}` : ""}
                    </span>
                    {puedeEditar && h.id > 0 && <QuitarOficioBoton id={h.id} socioId={socio.id} />}
                  </li>
                ))}
              </ul>
              {puedeEditar && socio.nucleo_id && <div className="mt-1"><AgregarOficioForm socioId={socio.id} nombreSocio={socio.nombre} /></div>}
            </div>
          )}
          {socio.notas && <div className="sm:col-span-2"><span className="text-ink/50">Notas:</span> {socio.notas}</div>}
        </div>
        {puedeEditar && <ActualizarSocioForm socio={socio} />}
      </Card>

      <SectionTitle action={puedeEditar ? <AgregarIntegranteForm socioId={socio.id} /> : undefined}>Integrantes del núcleo</SectionTitle>
      <Card>
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2">
            <div>
              <span className="text-sm font-semibold text-ink">{socio.nombre}</span>
              <span className="text-xs text-ink-muted ml-2">Titular</span>
            </div>
          </div>
          {integrantes.map((i) => (
            <div key={i.id} className={`rounded-lg px-3 py-2 ${i.estado === "inactivo" ? "bg-surface-sunken/50 opacity-60" : "bg-surface border border-border"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-ink">{i.nombre} {i.apellido || ""}</span>
                  <span className="text-xs text-ink-muted ml-2">
                    {RELACION_INTEGRANTE_LABEL[i.relacion as (typeof RELACION_INTEGRANTE)[number]] || i.relacion}
                    {i.tipo_integrante === "menor" && " · menor de edad"}
                    {i.estado === "inactivo" && " · dado de baja"}
                  </span>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {i.documento && `Doc: ${i.documento} · `}
                    {i.fecha_nacimiento && `Nac.: ${fecha(i.fecha_nacimiento)} · `}
                    {i.telefono && `${i.telefono} · `}
                    {i.email || ""}
                  </p>
                  {i.observaciones && <p className="text-xs text-ink-faint mt-0.5">{i.observaciones}</p>}
                </div>
                {puedeEditar && (
                  <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                    <EditarIntegranteForm integrante={i} />
                    <ActionForm action={cambiarEstadoIntegranteFormAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="estado" value={i.estado === "activo" ? "inactivo" : "activo"} />
                      <button className="text-xs text-ink-faint hover:text-[var(--color-rojo)] underline underline-offset-2">
                        {i.estado === "activo" ? "Dar de baja" : "Reactivar"}
                      </button>
                    </ActionForm>
                  </div>
                )}
              </div>
            </div>
          ))}
          {integrantes.length === 0 && <p className="text-xs text-ink-faint">Sin otros integrantes cargados todavía.</p>}
        </div>
      </Card>
    </>
  );

  // Fase 1C: recibos de cada pago y código para identificar transferencias.
  const recibos = puedeVerCuenta ? await recibosDeSocio(socio.id) : new Map<number, { id: number; numero: number }>();
  const orgSlug = (await get<{ slug: string }>(`SELECT slug FROM organizations WHERE id = ?`, [user.organization_id]))?.slug ?? "coova";
  const codigoPago = codigoDePago(orgSlug, socio.nucleo_id ?? null, socio.id);

  // ================= Pestaña: Finanzas =================
  const tabFinanzas = !puedeVerCuenta ? (
    <Card><EmptyState>El estado de cuenta lo administra Tesorería y Administración.</EmptyState></Card>
  ) : (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
        {puedeRegistrar && <RegistrarMovimientoCuentaForm socioId={socio.id} tipo="pago" cuotasAbiertas={cuotasAbiertas} />}
        {puedeRegistrar && <RegistrarMovimientoCuentaForm socioId={socio.id} tipo="cargo" />}
      </div>
      <p className="mb-3 rounded-xl bg-surface-sunken px-4 py-3 text-[15px] text-ink">
        Código para transferencias: <strong className="font-mono text-lg tracking-wide">{codigoPago}</strong>
        <span className="block text-ink-muted">Al pagar por transferencia o depósito, poné este código en el concepto: así el pago se identifica solo.</span>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatTile label={saldo > 0 ? "Debe" : saldo < 0 ? "Saldo a favor" : "Al día"} value={money(Math.abs(saldo))} color={saldo > 0 ? "rojo" : "verde"} />
        <StatTile label="Cuotas pendientes" value={String(conteo.cuotasPendientes)} />
        <StatTile
          label="Cuotas vencidas"
          value={String(conteo.cuotasVencidas)}
          color={conteo.cuotasVencidas > 0 ? "rojo" : "verde"}
          hint={conteo.cuotasVencidas > 0 ? `${money(conteo.montoVencido)} · ${conteo.diasDeAtraso} días de atraso` : undefined}
        />
        <StatTile label="Próximo vencimiento" value={conteo.proximoVencimiento ? fecha(conteo.proximoVencimiento) : "—"} />
      </div>

      {/* ---- Convenio ---- */}
      {convenio ? (
        <Card className="mb-4">
          <p className="text-sm font-semibold text-ink">📋 Convenio de pago activo{convenio.refinancia ? " — refinancia deuda vencida" : ""}</p>
          <p className="text-xs text-ink-muted mt-0.5">{convenio.motivo}</p>
          <p className="text-xs text-ink-faint mt-1">
            {cuotasConvenio.filter((c) => c.estado === "pagada").length}/{convenio.cantidad_cuotas} cuotas pagadas · {money(convenio.monto_cuota)} c/u · vence el día {convenio.dia_vencimiento} de cada mes
          </p>
          {puedeRegistrar && <GestionConvenioAcciones convenioId={convenio.id} refinancia={!!convenio.refinancia} />}
        </Card>
      ) : (
        puedeRegistrar && (
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-faint">Este núcleo no tiene ningún convenio de pago activo.</p>
              <NuevoConvenioForm socioId={socio.id} deudaVencida={{ monto: conteo.montoVencido, cuotas: conteo.cuotasVencidas }} />
            </div>
          </Card>
        )
      )}

      {/* ---- Cuotas ---- */}
      <SectionTitle>Cuotas</SectionTitle>
      <Card className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Período</th>
                <th className="py-2 pr-3">Concepto</th>
                <th className="py-2 pr-3">Vence</th>
                <th className="py-2 pr-3 text-right">Importe</th>
                <th className="py-2 pr-3 text-right">Saldo</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3"><span className="sr-only">Ver</span></th>
              </tr>
            </thead>
            <tbody>
              {cuotas
                .slice()
                .reverse()
                .map((c) => {
                  const conv = c.convenioId ? convenios.find((x) => x.id === c.convenioId) : null;
                  const refin = c.refinanciadaPorConvenioId ? convenios.find((x) => x.id === c.refinanciadaPorConvenioId) : null;
                  return (
                    <FilaConDetalle
                      key={c.id}
                      titulo={c.concepto}
                      subtitulo={`Cuota de ${socio.nombre}`}
                      secciones={[
                        {
                          items: [
                            { label: "Núcleo", valor: socio.nombre },
                            { label: "Período", valor: <span className="capitalize">{periodoTexto(c.periodo)}</span> },
                            { label: "Fecha de emisión", valor: fecha(c.fecha) },
                            { label: "Vencimiento", valor: fecha(c.fechaVencimiento) },
                            { label: "Importe total", valor: money2(c.monto) },
                            { label: "Importe pagado", valor: money2(c.montoPagado) },
                            { label: "Saldo pendiente", valor: money2(c.montoPendiente) },
                            { label: "Estado", valor: <EstadoCuotaBadge estado={c.estado} conPagoParcial={c.montoPagado > 0} /> },
                            ...(c.fechaPago ? [{ label: "Fecha de pago", valor: fecha(c.fechaPago) }] : []),
                            ...(c.diasVencida > 0 ? [{ label: "Días de atraso", valor: String(c.diasVencida) }] : []),
                            ...(conv ? [{ label: "Convenio asociado", valor: conv.motivo }] : []),
                            ...(refin ? [{ label: "Refinanciada por el convenio", valor: refin.motivo }] : []),
                            ...(c.notas ? [{ label: "Observaciones", valor: c.notas }] : []),
                          ],
                        },
                        {
                          titulo: "Pagos aplicados",
                          items: c.pagos.length
                            ? c.pagos.map((p) => ({
                                label: fecha(p.fecha),
                                valor: `${money2(p.monto)}${p.metodo ? ` · ${METODO_PAGO_LABEL[p.metodo as keyof typeof METODO_PAGO_LABEL] || p.metodo}` : ""}`,
                              }))
                            : [{ label: "—", valor: "Todavía sin pagos." }],
                        },
                      ]}
                    >
                      <td className="py-2 pr-3 capitalize whitespace-nowrap">{periodoTexto(c.periodo)}</td>
                      <td className="py-2 pr-3 text-ink/70">{c.concepto}</td>
                      <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{fecha(c.fechaVencimiento)}</td>
                      <td className="py-2 pr-3 text-right">{money(c.monto)}</td>
                      <td className="py-2 pr-3 text-right font-medium">{c.montoPendiente > 0 ? money(c.montoPendiente) : "—"}</td>
                      <td className="py-2 pr-3"><EstadoCuotaBadge estado={c.estado} conPagoParcial={c.montoPagado > 0} /></td>
                    </FilaConDetalle>
                  );
                })}
            </tbody>
          </table>
          {cuotas.length === 0 && <EmptyState>Sin cuotas emitidas todavía.</EmptyState>}
        </div>
      </Card>

      {/* ---- Pagos ---- */}
      <SectionTitle>Pagos registrados</SectionTitle>
      <Card className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Concepto</th>
                <th className="py-2 pr-3">Medio</th>
                <th className="py-2 pr-3">Finanzas</th>
                <th className="py-2 pr-3 text-right">Monto</th>
                <th className="py-2 pr-3"><span className="sr-only">Ver</span></th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => {
                const anulado = p.estado === "anulado";
                const ingreso = ingresoPorPago.get(p.id);
                const cuotaDirigida = p.cuota_id ? cuotaPorId.get(p.cuota_id) : null;
                const cubre = cuotas.filter((c) => c.pagos.some((x) => x.pagoId === p.id));
                return (
                  <FilaConDetalle
                    key={p.id}
                    titulo={`Pago ${fecha(p.fecha)} — ${money2(Number(p.monto))}`}
                    subtitulo={socio.nombre}
                    secciones={[
                      {
                        items: [
                          { label: "Fecha de pago", valor: fecha(p.fecha) },
                          { label: "Monto", valor: money2(Number(p.monto)) },
                          { label: "Medio de pago", valor: p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago as keyof typeof METODO_PAGO_LABEL] || p.metodo_pago : "—" },
                          { label: "Concepto", valor: p.concepto },
                          { label: "Aplicado a", valor: cuotaDirigida ? cuotaDirigida.concepto : "Lo más antiguo primero" },
                          { label: "Cubrió", valor: cubre.length ? cubre.map((c) => c.concepto).join(" · ") : "—" },
                          { label: "En Finanzas", valor: ingreso ? (ingreso.estado === "anulado" ? "Ingreso anulado" : `Ingreso #${ingreso.id}`) : "Cargado antes de la integración" },
                          ...(p.notas ? [{ label: "Observaciones", valor: p.notas }] : []),
                          ...(anulado ? [{ label: "Estado", valor: <Badge color="gray">Anulado</Badge> }] : []),
                          ...(!anulado
                            ? [
                                {
                                  label: "Recibo",
                                  valor: recibos.get(p.id) ? (
                                    <a href={`/api/archivos/recibo/${recibos.get(p.id)!.id}`} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                                      Recibo N° {recibos.get(p.id)!.numero} (ver e imprimir)
                                    </a>
                                  ) : puedeRegistrar ? (
                                    <BotonAccion action={emitirReciboFormAction} ocultos={{ pago_id: p.id }} mensajeExito="Recibo emitido.">
                                      Emitir recibo
                                    </BotonAccion>
                                  ) : (
                                    "—"
                                  ),
                                },
                              ]
                            : []),
                          ...(p.comprobante_url
                            ? [{ label: "Comprobante", valor: <a href={`/api/archivos/cuota/${p.id}`} target="_blank" rel="noopener noreferrer" className="underline">Ver comprobante</a> }]
                            : []),
                        ],
                      },
                    ]}
                  >
                    <td className={`py-2 pr-3 whitespace-nowrap${anulado ? " line-through opacity-50" : ""}`}>{fecha(p.fecha)}</td>
                    <td className="py-2 pr-3 text-ink/70">{p.concepto}{anulado && <span className="ml-1"><Badge color="gray">Anulado</Badge></span>}</td>
                    <td className="py-2 pr-3 text-ink/60">{p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago as keyof typeof METODO_PAGO_LABEL] || p.metodo_pago : "—"}</td>
                    <td className="py-2 pr-3">{ingreso && ingreso.estado !== "anulado" ? <Badge color="verde">Registrado</Badge> : <span className="text-ink/30">—</span>}</td>
                    <td className="py-2 pr-3 text-right font-medium">
                      {money2(Number(p.monto))}
                      {!anulado && recibos.get(p.id) && <span className="block text-xs text-ink-muted font-normal">Recibo N° {recibos.get(p.id)!.numero}</span>}
                    </td>
                  </FilaConDetalle>
                );
              })}
            </tbody>
          </table>
          {pagos.length === 0 && <EmptyState>Sin pagos registrados todavía.</EmptyState>}
        </div>
      </Card>

      {/* ---- Convenios (historial) ---- */}
      {convenios.length > 0 && (
        <>
          <SectionTitle>Convenios</SectionTitle>
          <Card className="mb-4">
            <div className="divide-y divide-ink/5">
              {convenios.map((c) => (
                <div key={c.id} className="py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-ink">{c.motivo}{c.refinancia ? " · refinancia deuda" : ""}</p>
                    <p className="text-xs text-ink-faint">
                      {c.cantidad_cuotas} cuotas de {money(c.monto_cuota)} · desde {fecha(c.fecha_inicio)}
                    </p>
                    {c.estado === "anulado" && (c as any).motivo_anulacion && (
                      <p className="text-xs text-ink-muted">Anulado: {(c as any).motivo_anulacion}</p>
                    )}
                  </div>
                  <Badge color={c.estado === "activo" ? "brand" : c.estado === "cumplido" ? "verde" : c.estado === "incumplido" ? "rojo" : "gray"}>
                    {{ activo: "En curso", cumplido: "Cumplido", incumplido: "Incumplido", cancelado: "Cancelado", anulado: "Anulado" }[c.estado as string] ?? c.estado}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* ---- Historial completo de movimientos (lo que ya mostraba la ficha) ---- */}
      <details className="mb-2">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">Historial completo de movimientos de la cuenta ({movimientos.length})</summary>
        <Card className="mt-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Concepto</th>
                  <th className="py-2 pr-3">Vencimiento</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Comprobante</th>
                  <th className="py-2 pr-3 text-right">Monto</th>
                  {(puedeRegistrar || puedeAnular) && <th className="py-2 pr-3 text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {movimientos
                  .slice()
                  .reverse()
                  .map((m) => {
                    const anulado = m.estado === "anulado";
                    const cuota = !anulado && m.tipo === "cargo" ? cuotaPorId.get(m.id) : null;
                    return (
                      <tr key={m.id} className={`border-b border-ink/5 last:border-0${anulado ? " opacity-50" : ""}`}>
                        <td className="py-2 pr-3">{fecha(m.fecha)}</td>
                        <td className="py-2 pr-3">{m.tipo === "cargo" ? "🔴 cargo" : "🟢 pago"}</td>
                        <td className="py-2 pr-3 text-ink/60">{m.concepto}</td>
                        <td className="py-2 pr-3 text-ink/50">{fecha(m.fecha_vencimiento)}</td>
                        <td className="py-2 pr-3">
                          {anulado ? <Badge color="gray">Anulado</Badge> : cuota ? <EstadoCuotaBadge estado={cuota.estado} conPagoParcial={cuota.montoPagado > 0} /> : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {m.comprobante_url ? (
                            <a href={`/api/archivos/cuota/${m.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
                              Ver →
                            </a>
                          ) : (
                            <span className="text-ink/30">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right font-medium">{money2(Number(m.monto))}</td>
                        {(puedeRegistrar || puedeAnular) && (
                          <td className="py-2 pr-3">
                            {!anulado && (
                              <div className="flex items-center justify-end gap-3">
                                {puedeRegistrar && <EditarMovimientoCuentaForm movimiento={m} />}
                                {puedeAnular && <AnularMovimientoCuentaBoton id={m.id} concepto={m.concepto} />}
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {movimientos.length === 0 && <EmptyState>Sin movimientos registrados todavía.</EmptyState>}
          </div>
        </Card>
      </details>
    </>
  );

  // ================= Pestaña: Participación =================
  const tabParticipacion = (
    <>
      {!socio.user_id && (
        <Card className="mb-4">
          <p className="text-xs text-ink-faint">
            El titular no tiene una cuenta de usuario vinculada, así que no figura en comisiones, en el Consejo ni como responsable de tareas.
            La asistencia a asambleas se toma por el núcleo de trabajo.
          </p>
        </Card>
      )}
      <SectionTitle>Comisiones</SectionTitle>
      <Card className="mb-4">
        {comisiones.length ? (
          <div className="divide-y divide-ink/5">
            {comisiones.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                <Link href={`/comisiones#comision-${c.id}`} className="text-ink hover:underline underline-offset-2">{c.nombre}</Link>
                <span className="text-xs text-ink-muted">{c.rol_en_comision === "coordinador" ? "Coordinador/a" : "Integrante"} · desde {fecha(c.desde)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No integra ninguna comisión.</EmptyState>
        )}
      </Card>

      {cargosConsejo.length > 0 && (
        <>
          <SectionTitle>Consejo Directivo</SectionTitle>
          <Card className="mb-4">
            <div className="divide-y divide-ink/5">
              {cargosConsejo.map((c, i) => (
                <div key={i} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink">{CARGO_LABEL[c.cargo] || c.cargo}</span>
                  <span className="text-xs text-ink-muted">
                    {fecha(c.fecha_inicio)} → {c.fecha_fin ? fecha(c.fecha_fin) : <Badge color="verde">vigente</Badge>}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <SectionTitle>Asambleas</SectionTitle>
      <Card>
        {asambleas.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Asamblea</th>
                  <th className="py-2 pr-3">Participación</th>
                  <th className="py-2 pr-3"><span className="sr-only">Ver</span></th>
                </tr>
              </thead>
              <tbody>
                {asambleas.map((a) => {
                  const participacion = a.asistio === 1 ? "Asistió" : a.asistio === 0 ? "No asistió" : "Invitado";
                  return (
                    <FilaConDetalle
                      key={a.id}
                      titulo={a.titulo}
                      subtitulo={`Asamblea${a.tipo_asamblea ? ` ${a.tipo_asamblea}` : ""}`}
                      editarHref={`/reuniones/${a.id}`}
                      secciones={[
                        {
                          items: [
                            { label: "Fecha", valor: a.fecha ? dayjs(a.fecha).format("DD/MM/YYYY HH:mm") : "—" },
                            { label: "Lugar", valor: a.lugar || "—" },
                            { label: "Estado", valor: a.estado },
                            { label: "Participación del núcleo", valor: participacion },
                          ],
                        },
                      ]}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">{a.fecha ? dayjs(a.fecha).format("DD/MM/YYYY") : "—"}</td>
                      <td className="py-2 pr-3 text-ink/70">{a.titulo}</td>
                      <td className="py-2 pr-3">
                        <Badge color={participacion === "Asistió" ? "verde" : participacion === "No asistió" ? "rojo" : "gray"}>{participacion}</Badge>
                      </td>
                    </FilaConDetalle>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Sin asambleas registradas para este núcleo.</EmptyState>
        )}
      </Card>
    </>
  );

  // ================= Pestaña: Documentos =================
  const categoriasDocumento = puedeSubirDocumentos
    ? [
        ...CATEGORIAS_DOCUMENTO_BASE,
        ...(await all<{ nombre: string }>(`SELECT nombre FROM documento_categorias ORDER BY nombre ASC`).catch(() => [])).map((c) => c.nombre),
      ]
    : [];
  const tabDocumentos = (
    <>
      {puedeVerDocumentos && (
        <>
          <SectionTitle
            action={
              puedeSubirDocumentos ? (
                <SubirDocumentoNucleoForm socioId={socio.id} categorias={categoriasDocumento} catLabel={CATEGORIA_DOCUMENTO_LABEL} />
              ) : undefined
            }
          >
            Documentos del núcleo
          </SectionTitle>
          <Card className="mb-4">
            {documentos.length ? (
              <div className="divide-y divide-ink/5">
                {documentos.map((d) => (
                  <div key={d.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-ink">{d.nombre}</p>
                      <p className="text-xs text-ink-faint">{d.categoria} · {fecha(d.fecha)}{d.subido_por ? ` · ${d.subido_por}` : ""}</p>
                    </div>
                    <a href={`/api/archivos/documento/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2">Ver →</a>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>
                Sin documentos de este núcleo. Se pueden subir desde acá o desde <Link href="/documentos" className="underline">Documentos</Link>, eligiendo este núcleo.
              </EmptyState>
            )}
          </Card>
        </>
      )}
      {puedeVerCuenta && (
        <>
          <SectionTitle>Comprobantes de la cuenta</SectionTitle>
          <Card>
            {comprobantes.length ? (
              <div className="divide-y divide-ink/5">
                {comprobantes.map((m) => (
                  <div key={m.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink/70">{fecha(m.fecha)} · {m.tipo === "pago" ? "Pago" : "Cargo"} · {m.concepto}</span>
                    <a href={`/api/archivos/cuota/${m.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2">Ver →</a>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>Sin comprobantes cargados.</EmptyState>
            )}
          </Card>
        </>
      )}
    </>
  );

  // ================= Pestaña: Comunicaciones =================
  const tabComunicaciones = (
    <>
      <SectionTitle>Correos enviados</SectionTitle>
      <Card className="mb-4">
        {correos.length ? (
          <div className="divide-y divide-ink/5">
            {correos.map((m) => (
              <div key={m.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink">{m.asunto}</span>
                <span className="text-xs text-ink-faint">
                  {dayjs(m.creado_en).format("DD/MM/YYYY HH:mm")}{m.remitente ? ` · ${m.remitente}` : ""}{m.estado === "error" ? " · no se pudo enviar" : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>Sin correos enviados a este núcleo.</EmptyState>
        )}
      </Card>
      {socio.user_id && (
        <>
          <SectionTitle>Notificaciones</SectionTitle>
          <Card>
            {notificaciones.length ? (
              <div className="divide-y divide-ink/5">
                {notificaciones.map((n) => (
                  <div key={n.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-ink">{n.titulo}</span>
                    <span className="text-xs text-ink-faint">{dayjs(n.creado_en).format("DD/MM/YYYY")}{n.leida ? " · leída" : " · sin leer"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>Sin notificaciones.</EmptyState>
            )}
          </Card>
        </>
      )}
    </>
  );

  // ================= Pestaña: Tareas =================
  const tareasPendientes = tareas.filter((t) => t.estado !== "completada");
  const tareasFinalizadas = tareas.filter((t) => t.estado === "completada");
  const tablaTareas = (lista: TareaNucleoRow[], vacioTexto: string) =>
    lista.length ? (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
              <th className="py-2 pr-3">Tarea</th>
              <th className="py-2 pr-3">Comisión</th>
              <th className="py-2 pr-3">Vence</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2 pr-3"><span className="sr-only">Ver</span></th>
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => (
              <FilaConDetalle
                key={t.id}
                titulo={t.titulo}
                subtitulo={t.comision_nombre || undefined}
                secciones={[
                  {
                    items: [
                      { label: "Estado", valor: <Badge color={ESTADO_TAREA_COLOR[t.estado] || "gray"}>{ESTADO_TAREA_LABEL[t.estado] || t.estado}</Badge> },
                      { label: "Responsable", valor: t.responsable_nombre || "Sin asignar" },
                      { label: "Rol de este núcleo", valor: t.es_responsable ? "Responsable" : "Colaborador/a" },
                      { label: "Prioridad", valor: t.prioridad || "—" },
                      { label: "Vencimiento", valor: fecha(t.fecha_vencimiento) },
                      { label: "Creada", valor: fecha(t.creado_en) },
                      ...(t.descripcion ? [{ label: "Descripción", valor: t.descripcion }] : []),
                    ],
                  },
                ]}
              >
                <td className="py-2 pr-3 text-ink">{t.titulo}</td>
                <td className="py-2 pr-3 text-ink/60">{t.comision_nombre || "—"}</td>
                <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{fecha(t.fecha_vencimiento)}</td>
                <td className="py-2 pr-3"><Badge color={ESTADO_TAREA_COLOR[t.estado] || "gray"}>{ESTADO_TAREA_LABEL[t.estado] || t.estado}</Badge></td>
              </FilaConDetalle>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <EmptyState>{vacioTexto}</EmptyState>
    );
  const tabTareas = !socio.user_id ? (
    <Card><EmptyState>El titular no tiene una cuenta de usuario vinculada, así que no tiene tareas asignadas.</EmptyState></Card>
  ) : (
    <>
      <SectionTitle>Pendientes</SectionTitle>
      <Card className="mb-4">{tablaTareas(tareasPendientes, "Sin tareas pendientes.")}</Card>
      <SectionTitle>Finalizadas</SectionTitle>
      <Card>{tablaTareas(tareasFinalizadas, "Sin tareas finalizadas.")}</Card>
    </>
  );

  const tabs = [
    { id: "general", label: "General", content: tabGeneral },
    ...(puedeVerCuenta ? [{ id: "finanzas", label: `Finanzas${conteo.cuotasVencidas > 0 ? ` (${conteo.cuotasVencidas} vencida${conteo.cuotasVencidas === 1 ? "" : "s"})` : ""}`, content: tabFinanzas }] : []),
    { id: "participacion", label: "Participación", content: tabParticipacion },
    ...(puedeVerDocumentos || puedeVerCuenta ? [{ id: "documentos", label: "Documentos", content: tabDocumentos }] : []),
    ...(puedeVerComunicaciones ? [{ id: "comunicaciones", label: "Comunicaciones", content: tabComunicaciones }] : []),
    ...(puedeVerTareas ? [{ id: "tareas", label: `Tareas${tareasPendientes.length ? ` (${tareasPendientes.length})` : ""}`, content: tabTareas }] : []),
    ...(puedeVerHistorial
      ? [{ id: "historial", label: "Historial", content: <Card><HistorialAuditoria registros={historial} /></Card> }]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={socio.nombre}
        subtitle={`Núcleo${socio.vivienda_numero ? ` · Vivienda ${socio.vivienda_numero}` : ""}${socio.documento ? ` · Doc. ${socio.documento}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {/* Fase 2H: estado de cuenta en PDF y constancias desde plantillas. */}
            {puedeVerCuenta && (
              <a href={`/api/reportes/estado-cuenta/${socio.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
                Estado de cuenta (PDF)
              </a>
            )}
            {puedeUsarPlantillasAqui && (
              <Link href={`/plantillas?socio=${socio.id}`} className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
                Constancias
              </Link>
            )}
            <Badge color={infoEstado.color}>{infoEstado.label}</Badge>
          </div>
        }
      />
      <Link href="/socios" className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">
        ← Volver al padrón de socios
      </Link>
      <div className="mt-4">
        <Tabs tabs={tabs} defaultTab="general" />
      </div>
    </div>
  );
}
