import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { registrarMovimientoCuentaSocioAction } from "@/lib/actions/cuentaSocios";

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

  // La ficha básica (nombre, vivienda, contacto) ya es visible para cualquiera
  // que pueda leer el módulo Socios — es el mismo padrón que se ve en /socios.
  // La cuenta corriente (montos) es más sensible: la ve el equipo de Finanzas
  // de siempre, y además el propio socio puede consultar la suya, sin tener
  // que pedírsela a nadie (así lo resuelven los sistemas de referencia).
  const esElPropioSocio = user.rol === "socio" && socio.user_id === user.id;
  const puedeVerCuenta = ROLES_FINANZAS_DETALLE.includes(user.rol) || esElPropioSocio;
  const puedeRegistrar = canEdit(user.rol, "finanzas");

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
        subtitle={`Socio${socio.vivienda_numero ? ` · Vivienda ${socio.vivienda_numero}` : ""}${socio.nucleo_nombre ? ` · Núcleo ${socio.nucleo_nombre}` : ""}`}
        action={<Badge color={badgeSocio[socio.estado] || "gray"}>{socio.estado}</Badge>}
      />

      <Link href="/socios" className="text-xs text-[#1f4e5f] underline underline-offset-2">
        ← Volver al padrón de socios
      </Link>

      <Card className="mt-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-black/50">Documento:</span> {socio.documento || "—"}</div>
          <div><span className="text-black/50">Fecha de ingreso:</span> {socio.fecha_ingreso ? dayjs(socio.fecha_ingreso).format("DD/MM/YYYY") : "—"}</div>
          <div><span className="text-black/50">Email:</span> {socio.email || "—"}</div>
          <div><span className="text-black/50">Teléfono:</span> {socio.telefono || "—"}</div>
          {socio.notas && <div className="sm:col-span-2"><span className="text-black/50">Notas:</span> {socio.notas}</div>}
        </div>
      </Card>

      <SectionTitle>Cuenta corriente</SectionTitle>
      {!puedeVerCuenta ? (
        <Card><EmptyState>El estado de cuenta lo administra Tesorería y Administración.</EmptyState></Card>
      ) : (
        <>
          <Card className="mb-4 flex items-center justify-between">
            <span className="text-sm text-black/60">{saldo > 0 ? "Debe" : saldo < 0 ? "Saldo a favor" : "Al día"}</span>
            <span className={`text-2xl font-bold ${saldo > 0 ? "text-[var(--color-rojo)]" : "text-[#2f7a4f]"}`}>
              {money(Math.abs(saldo))}
            </span>
          </Card>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-black/50 border-b border-black/5">
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Concepto</th>
                    <th className="py-2 pr-3 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => (
                    <tr key={m.id} className="border-b border-black/5 last:border-0">
                      <td className="py-2 pr-3">{dayjs(m.fecha).format("DD/MM/YYYY")}</td>
                      <td className="py-2 pr-3">{m.tipo === "cargo" ? "🔴 cargo" : "🟢 pago"}</td>
                      <td className="py-2 pr-3 text-black/60">{m.concepto}</td>
                      <td className="py-2 pr-3 text-right font-medium">{money(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {movimientos.length === 0 && <EmptyState>Sin movimientos registrados todavía.</EmptyState>}
            </div>

            {puedeRegistrar && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Registrar cargo o pago</summary>
                <form action={registrarMovimientoCuentaSocioAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="hidden" name="socio_id" value={socio.id} />
                  <div>
                    <Label>Tipo</Label>
                    <select name="tipo" className={inputClass} defaultValue="cargo">
                      <option value="cargo">Cargo (aumenta la deuda, ej: cuota)</option>
                      <option value="pago">Pago (la reduce)</option>
                    </select>
                  </div>
                  <div><Label>Monto</Label><input name="monto" type="number" step="0.01" required className={inputClass} /></div>
                  <div><Label>Concepto</Label><input name="concepto" required placeholder="Cuota setiembre, pago parcial…" className={inputClass} /></div>
                  <div><Label>Fecha</Label><input name="fecha" type="date" required className={inputClass} defaultValue={dayjs().format("YYYY-MM-DD")} /></div>
                  <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" className={inputClass} /></div>
                  <div className="sm:col-span-2">
                    <button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Registrar</button>
                  </div>
                </form>
              </details>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
