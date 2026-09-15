import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ui-client";
import dayjs from "dayjs";
import { cambiarEstadoIntegranteFormAction } from "@/lib/actions/socios";
import { RELACION_INTEGRANTE, RELACION_INTEGRANTE_LABEL } from "@/lib/constants";
import { NucleoLink } from "@/components/EntidadLink";
import {
  ActualizarSocioForm,
  AgregarIntegranteForm,
  EditarIntegranteForm,
  RegistrarMovimientoCuentaForm,
} from "@/components/socios/SocioDetalleFormularios";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

const badgeSocio: Record<string, "verde" | "amarillo" | "rojo"> = {
  activo: "verde",
  inactivo: "amarillo",
  baja: "rojo",
};

export default async function SocioDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "socios")) redirect("/dashboard");

  const socio = await get<any>(
    `SELECT s.*, v.numero as vivienda_numero, n.nombre as nucleo_nombre
     FROM socios s
     LEFT JOIN viviendas v ON v.id = s.vivienda_id
     LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
     WHERE s.id = ?`,
    [id]
  );
  if (!socio) notFound();

  // Integrantes del núcleo (pareja, hijos, etc.) colgando de este socio como
  // titular — ver migrations/0019_socio_integrantes.sql. .catch(() => []):
  // si esa migración todavía no se corrió en esta cooperativa, la sección se
  // muestra vacía en vez de romper toda la ficha del socio.
  const integrantes = await all<any>(
    `SELECT * FROM socio_integrantes WHERE socio_id = ? ORDER BY (estado != 'activo'), CASE relacion WHEN 'titular' THEN 0 ELSE 1 END, nombre ASC`,
    [id]
  ).catch(() => [] as any[]);

  // La ficha básica (nombre, vivienda, contacto) ya es visible para cualquiera
  // que pueda leer el módulo Socios — es el mismo padrón que se ve en /socios.
  // La cuenta corriente (montos) es más sensible: la ve el equipo de Finanzas
  // de siempre, y además el propio socio puede consultar la suya, sin tener
  // que pedírsela a nadie (así lo resuelven los sistemas de referencia).
  const esElPropioSocio = user.rol === "socio" && socio.user_id === user.id;
  const puedeVerCuenta = ROLES_FINANZAS_DETALLE.includes(user.rol) || esElPropioSocio;
  const puedeRegistrar = canEdit(user.rol, "finanzas");
  const puedeEditar = canEdit(user.rol, "socios");

  const movimientos = puedeVerCuenta
    ? await all<any>(
        `SELECT * FROM movimientos_cuenta_socio WHERE socio_id = ? ORDER BY fecha DESC, id DESC`,
        [id]
      )
    : [];
  const saldo = movimientos.reduce((acc, m) => acc + (m.tipo === "cargo" ? Number(m.monto) : -Number(m.monto)), 0);

  return (
    <div>
      <PageHeader
        title={socio.nombre}
        subtitle={`Socio${socio.vivienda_numero ? ` · Vivienda ${socio.vivienda_numero}` : ""}`}
        action={<Badge color={badgeSocio[socio.estado] || "gray"}>{socio.estado}</Badge>}
      />

      <Link href="/socios" className="text-xs text-[var(--color-brand-800)] underline underline-offset-2">
        ← Volver al padrón de socios
      </Link>

      <Card className="mt-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-ink/50">Documento:</span> {socio.documento || "—"}</div>
          <div><span className="text-ink/50">Fecha de ingreso:</span> {socio.fecha_ingreso ? dayjs(socio.fecha_ingreso).format("DD/MM/YYYY") : "—"}</div>
          <div><span className="text-ink/50">Email:</span> {socio.email || "—"}</div>
          <div><span className="text-ink/50">Teléfono:</span> {socio.telefono || "—"}</div>
          <div><span className="text-ink/50">Núcleo:</span> <NucleoLink id={socio.nucleo_id} nombre={socio.nucleo_nombre} /></div>
          {socio.notas && <div className="sm:col-span-2"><span className="text-ink/50">Notas:</span> {socio.notas}</div>}
        </div>

        {puedeEditar && <ActualizarSocioForm socio={socio} />}
      </Card>

      {/* ---------- Integrantes del núcleo (pareja, hijos, etc.) ---------- */}
      <SectionTitle>Integrantes del núcleo</SectionTitle>
      <Card className="mb-6">
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
                    {i.fecha_nacimiento && `Nac.: ${dayjs(i.fecha_nacimiento).format("DD/MM/YYYY")} · `}
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

        {puedeEditar && <AgregarIntegranteForm socioId={socio.id} />}
      </Card>

      <SectionTitle>Cuenta corriente</SectionTitle>
      {!puedeVerCuenta ? (
        <Card><EmptyState>El estado de cuenta lo administra Tesorería y Administración.</EmptyState></Card>
      ) : (
        <>
          <Card className="mb-4 flex items-center justify-between">
            <span className="text-sm text-ink/60">{saldo > 0 ? "Debe" : saldo < 0 ? "Saldo a favor" : "Al día"}</span>
            <span className={`text-2xl font-bold ${saldo > 0 ? "text-[var(--color-rojo)]" : "text-[var(--color-verde)]"}`}>
              {money(Math.abs(saldo))}
            </span>
          </Card>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Concepto</th>
                    <th className="py-2 pr-3 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => (
                    <tr key={m.id} className="border-b border-ink/5 last:border-0">
                      <td className="py-2 pr-3">{dayjs(m.fecha).format("DD/MM/YYYY")}</td>
                      <td className="py-2 pr-3">{m.tipo === "cargo" ? "🔴 cargo" : "🟢 pago"}</td>
                      <td className="py-2 pr-3 text-ink/60">{m.concepto}</td>
                      <td className="py-2 pr-3 text-right font-medium">{money(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {movimientos.length === 0 && <EmptyState>Sin movimientos registrados todavía.</EmptyState>}
            </div>

            {puedeRegistrar && <RegistrarMovimientoCuentaForm socioId={socio.id} />}
          </Card>
        </>
      )}
    </div>
  );
}
