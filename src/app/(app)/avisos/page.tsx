import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { Card, PageHeader, Badge, SectionTitle, EmptyState, AddButtonSummary } from "@/components/ui";
import { NuevoAvisoForm } from "@/components/avisos/AvisosFormularios";
import { puedeEnviarAvisos } from "@/lib/actions/avisos";
import { TIPO_DESTINATARIOS_LABEL, type TipoDestinatarios } from "@/lib/avisos";

/**
 * Fase 2F — Avisos oficiales: un solo lugar para avisar a todos, a una
 * comisión, a un núcleo, a un rol o a quienes deben cuotas, con constancia
 * de quién lo recibió y quién lo leyó.
 */
type AvisoFila = {
  id: number;
  titulo: string;
  destinatarios_tipo: TipoDestinatarios;
  urgente: number;
  enviado_en: string;
  anulado_en: string | null;
  enviado_por: string | null;
  personas: string;
  leidos: string;
  leido_en?: string | null;
};

function fecha(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Montevideo" });
}

export default async function AvisosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const emisor = await puedeEnviarAvisos(user.rol);

  const recibidos = await all<AvisoFila>(
    `SELECT a.id, a.titulo, a.destinatarios_tipo, a.urgente, a.enviado_en, a.anulado_en, u.nombre AS enviado_por, '0' AS personas, '0' AS leidos, d.leido_en
       FROM aviso_destinatarios d JOIN avisos a ON a.id = d.aviso_id LEFT JOIN users u ON u.id = a.enviado_por_id
      WHERE d.user_id = ? ORDER BY a.id DESC LIMIT 100`,
    [user.id]
  ).catch(() => []);

  const enviados = emisor
    ? await all<AvisoFila>(
        `SELECT a.id, a.titulo, a.destinatarios_tipo, a.urgente, a.enviado_en, a.anulado_en, u.nombre AS enviado_por,
                (SELECT COUNT(*) FROM aviso_destinatarios d WHERE d.aviso_id = a.id) AS personas,
                (SELECT COUNT(*) FROM aviso_destinatarios d WHERE d.aviso_id = a.id AND d.leido_en IS NOT NULL) AS leidos
           FROM avisos a LEFT JOIN users u ON u.id = a.enviado_por_id ORDER BY a.id DESC LIMIT 200`
      ).catch(() => [])
    : [];

  const [comisiones, nucleos] = emisor
    ? await Promise.all([
        all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre`).catch(() => []),
        all<{ id: number; nombre: string }>(
          `SELECT n.id, n.nombre FROM nucleos_familiares n WHERE EXISTS (SELECT 1 FROM socios s WHERE s.nucleo_id = n.id AND s.estado NOT IN ('baja', 'egresado', 'excluido')) ORDER BY n.nombre`
        ).catch(() => []),
      ])
    : [[], []];
  const roles = ROLES.map((r) => ({ id: r, nombre: ROLE_LABELS[r] }));

  return (
    <div className="max-w-4xl">
      <PageHeader title="Avisos" subtitle={emisor ? "Avisos oficiales de la cooperativa, con constancia de quién los recibió y quién los leyó." : "Los avisos oficiales que te mandó la cooperativa."} />

      {emisor && (
        <details className="mb-5" open={enviados.length === 0}>
          <AddButtonSummary>Nuevo aviso</AddButtonSummary>
          <Card className="mt-3">
            <NuevoAvisoForm comisiones={comisiones} nucleos={nucleos} roles={roles} />
          </Card>
        </details>
      )}

      {emisor && (
        <>
          <SectionTitle>Avisos enviados</SectionTitle>
          <Card className="mb-6">
            {enviados.length === 0 ? (
              <EmptyState>Todavía no se mandó ningún aviso oficial.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {enviados.map((a) => (
                  <li key={a.id} className="py-3">
                    <Link href={`/avisos/${a.id}`} className="flex flex-wrap items-start justify-between gap-2 text-[15px] hover:underline">
                      <span className="min-w-0">
                        <b className="text-ink">{a.titulo}</b> {a.urgente ? <Badge color="rojo">Urgente</Badge> : null} {a.anulado_en ? <Badge color="gray">Anulado</Badge> : null}
                        <span className="block text-sm text-ink-muted">
                          {fecha(a.enviado_en)} · {TIPO_DESTINATARIOS_LABEL[a.destinatarios_tipo] ?? a.destinatarios_tipo}
                          {a.enviado_por ? ` · Lo mandó ${a.enviado_por}` : ""}
                        </span>
                      </span>
                      <span className="text-sm text-ink-muted">
                        Leído por {Number(a.leidos)} de {Number(a.personas)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <SectionTitle>Avisos que te llegaron</SectionTitle>
      <Card>
        {recibidos.length === 0 ? (
          <EmptyState>No tenés avisos.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {recibidos.map((a) => (
              <li key={a.id} className="py-3">
                <Link href={`/avisos/${a.id}`} className="flex flex-wrap items-start justify-between gap-2 text-[15px] hover:underline">
                  <span className="min-w-0">
                    <b className="text-ink">{a.titulo}</b> {a.urgente ? <Badge color="rojo">Urgente</Badge> : null} {a.anulado_en ? <Badge color="gray">Anulado</Badge> : null}
                    <span className="block text-sm text-ink-muted">{fecha(a.enviado_en)}{a.enviado_por ? ` · De ${a.enviado_por}` : ""}</span>
                  </span>
                  {!a.leido_en && <Badge color="azul">Nuevo</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
