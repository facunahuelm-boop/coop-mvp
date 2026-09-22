import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { resumenFinanciero } from "@/lib/logic";
import { InformeFiscalForm } from "@/components/fiscal/InformeFiscalForm";
import dayjs from "dayjs";
import Link from "next/link";

// Sub-fase 1.5 ("Panel de Comisión Fiscal", última de la Fase 1, 22/09):
// el rol `fiscal` ya era de solo lectura en TODOS los módulos (ver
// roles.ts) — lo que le faltaba era un lugar propio para ejercer ese
// control sin ir página por página. Este panel NO agrega ninguna consulta
// nueva de fondo: agrega, en un solo lugar, resúmenes de datos que ya
// existen (financiero, alertas, actas, documentos vencidos, auditoría),
// con links a las páginas completas para el detalle.
//
// Guardrail no-negociable: esto es un panel de solo lectura. Gateado por
// canRead(rol, "auditoria") — el mismo grupo de roles que ya podía leer
// auditoría (tesorería, consejo directivo, fiscal, admin) — no se amplía
// ni se restringe ningún permiso existente. Generar el Informe/Dictamen
// (más abajo) sí queda reservado específicamente a fiscal/admin, porque es
// un acto propio de ese rol — ver informeFiscal.ts.

const SEV_LABEL: Record<string, string> = { critica: "🔴 Crítica", importante: "🟠 Importante", informativa: "🟢 Informativa" };
const SEV_COLOR: Record<string, "rojo" | "amarillo" | "verde"> = { critica: "rojo", importante: "amarillo", informativa: "verde" };
const ORGANO_LABEL: Record<string, string> = { asamblea: "Asamblea", consejo_directivo: "Consejo Directivo" };

interface InformeGenerado {
  id: number;
  nombre_reporte: string;
  creado_en: string;
  archivo_url: string | null;
}

export default async function FiscalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "auditoria")) redirect("/dashboard");

  const puedeGenerarInforme = user.rol === "fiscal" || user.rol === "admin";

  const [fin, alertasAbiertas, actasRecientes, documentosVencidos, auditoriaReciente, informesGenerados] = await Promise.all([
    resumenFinanciero(),
    all<{ id: number; severidad: string; titulo: string; origen_modulo: string; fecha: string }>(
      `SELECT id, severidad, titulo, origen_modulo, fecha FROM alertas WHERE estado = 'abierta' ORDER BY CASE severidad WHEN 'critica' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, fecha DESC LIMIT 5`
    ),
    all<{ organo: string; titulo: string; fecha: string; numero_libro: number | null }>(
      `SELECT organo, titulo, fecha, numero_libro FROM actas WHERE organo IN ('asamblea','consejo_directivo') ORDER BY fecha DESC LIMIT 5`
    ).catch(() =>
      all<{ organo: string; titulo: string; fecha: string }>(
        `SELECT organo, titulo, fecha FROM actas WHERE organo IN ('asamblea','consejo_directivo') ORDER BY fecha DESC LIMIT 5`
      ).then((filas) => filas.map((f) => ({ ...f, numero_libro: null })))
    ),
    all<{ titulo: string; fecha_vencimiento: string }>(
      `SELECT titulo, fecha_vencimiento FROM documentos WHERE fecha_vencimiento IS NOT NULL AND estado != 'archivado' AND fecha_vencimiento < ? ORDER BY fecha_vencimiento ASC LIMIT 5`,
      [dayjs().format("YYYY-MM-DD")]
    ).catch(() => []),
    all<{ fecha: string; accion: string; entidad: string; usuario_nombre: string | null }>(
      `SELECT a.fecha, a.accion, a.entidad, u.nombre as usuario_nombre FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id ORDER BY a.fecha DESC LIMIT 5`
    ),
    all<InformeGenerado>(`SELECT * FROM reportes_generados WHERE tipo = 'informe_fiscal' ORDER BY creado_en DESC LIMIT 10`).catch(() => []),
  ]);

  const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

  return (
    <div>
      <PageHeader title="Panel de Comisión Fiscal" subtitle="Control de solo lectura — resumen de lo relevante para fiscalizar, en un solo lugar" />

      <Card className="mb-6 bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-xs text-ink/70">
          🔎 Este panel es de solo lectura: no permite editar, aprobar ni cerrar nada en el sistema. Cada sección agrega datos
          que ya existen en sus propias pantallas — usá los links para ver el detalle completo.
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <Card>
          <p className="text-xs text-ink/50">Saldo actual</p>
          <p className="text-lg font-bold text-[var(--color-brand-900)]">{money(fin.saldo)}</p>
          <p className="text-xs text-ink/40">Disponible prudencial: {money(fin.disponiblePrudencial)}</p>
          <Link href="/finanzas" className="text-xs text-[var(--color-brand-800)] underline mt-1 inline-block">Ver Finanzas completo</Link>
        </Card>
        <Card>
          <p className="text-xs text-ink/50">Alertas abiertas</p>
          <p className="text-lg font-bold text-[var(--color-brand-900)]">{alertasAbiertas.length}</p>
          <p className="text-xs text-ink/40">Ordenadas por severidad</p>
          <Link href="/alertas" className="text-xs text-[var(--color-brand-800)] underline mt-1 inline-block">Ver Alertas completo</Link>
        </Card>
        <Card>
          <p className="text-xs text-ink/50">Documentos vencidos</p>
          <p className="text-lg font-bold text-[var(--color-brand-900)]">{documentosVencidos.length}</p>
          <Link href="/documentos" className="text-xs text-[var(--color-brand-800)] underline mt-1 inline-block">Ver Documentos completo</Link>
        </Card>
        <Card>
          <p className="text-xs text-ink/50">Actas recientes (Asamblea + Consejo Directivo)</p>
          <p className="text-lg font-bold text-[var(--color-brand-900)]">{actasRecientes.length}</p>
          <Link href="/libros-sociales" className="text-xs text-[var(--color-brand-800)] underline mt-1 inline-block">Ver Libros Sociales completo</Link>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Alertas abiertas</h3>
          <div className="space-y-1.5">
            {alertasAbiertas.length === 0 && <EmptyState>Sin alertas abiertas.</EmptyState>}
            {alertasAbiertas.map((a) => (
              <Card key={a.id} className="!py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs">{a.titulo}</p>
                  <Badge color={SEV_COLOR[a.severidad] ?? "gray"}>{SEV_LABEL[a.severidad] ?? a.severidad}</Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Documentos vencidos</h3>
          <div className="space-y-1.5">
            {documentosVencidos.length === 0 && <EmptyState>Sin documentos vencidos.</EmptyState>}
            {documentosVencidos.map((d, i) => (
              <Card key={i} className="!py-2">
                <p className="text-xs">{d.titulo}</p>
                <p className="text-xs text-ink/40">Venció el {dayjs(d.fecha_vencimiento).format("DD/MM/YYYY")}</p>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Actas recientes</h3>
          <div className="space-y-1.5">
            {actasRecientes.length === 0 && <EmptyState>Sin actas registradas.</EmptyState>}
            {actasRecientes.map((a, i) => (
              <Card key={i} className="!py-2">
                <p className="text-xs">
                  {ORGANO_LABEL[a.organo] ?? a.organo}{a.numero_libro ? ` · Folio N°${a.numero_libro}` : ""} — {a.titulo}
                </p>
                <p className="text-xs text-ink/40">{dayjs(a.fecha).format("DD/MM/YYYY")}</p>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Últimos registros de auditoría</h3>
          <div className="space-y-1.5">
            {auditoriaReciente.length === 0 && <EmptyState>Sin registros de auditoría.</EmptyState>}
            {auditoriaReciente.map((a, i) => (
              <Card key={i} className="!py-2">
                <p className="text-xs">{a.accion} · {a.entidad}</p>
                <p className="text-xs text-ink/40">{dayjs(a.fecha).format("DD/MM/YYYY HH:mm")}{a.usuario_nombre ? ` · ${a.usuario_nombre}` : ""}</p>
              </Card>
            ))}
          </div>
          <Link href="/auditoria" className="text-xs text-[var(--color-brand-800)] underline mt-1.5 inline-block">Ver Auditoría completa</Link>
        </div>
      </div>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Informes de la Comisión Fiscal</h3>
      <div className="space-y-2 mb-3">
        {informesGenerados.length === 0 && <EmptyState>Todavía no se generó ningún informe.</EmptyState>}
        {informesGenerados.map((r) => (
          <Card key={r.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{r.nombre_reporte}</p>
              <p className="text-xs text-ink/50">{dayjs(r.creado_en).format("DD/MM/YYYY HH:mm")}</p>
            </div>
            {r.archivo_url ? (
              <a
                href={`/api/archivos/informe-fiscal/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-2 text-xs font-semibold"
              >
                Descargar
              </a>
            ) : (
              <span className="rounded-lg bg-ink/5 text-ink/30 px-3 py-2 text-xs font-semibold">No disponible</span>
            )}
          </Card>
        ))}
      </div>

      {puedeGenerarInforme && <InformeFiscalForm />}
    </div>
  );
}
