import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { get, all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import { registrarMovimientoCuentaSocioAction } from "@/lib/actions/cuentaSocios";
import { actualizarSocioAction, agregarIntegranteAction, editarIntegranteAction, cambiarEstadoIntegranteAction } from "@/lib/actions/socios";
import { RELACION_INTEGRANTE, RELACION_INTEGRANTE_LABEL, TIPO_INTEGRANTE } from "@/lib/constants";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
const TIPO_INTEGRANTE_LABEL: Record<(typeof TIPO_INTEGRANTE)[number], string> = { adulto: "Adulto", menor: "Menor de edad" };

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
        subtitle={`Socio${socio.vivienda_numero ? ` · Vivienda ${socio.vivienda_numero}` : ""}${socio.nucleo_nombre ? ` · Núcleo ${socio.nucleo_nombre}` : ""}`}
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
          {socio.notas && <div className="sm:col-span-2"><span className="text-ink/50">Notas:</span> {socio.notas}</div>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-brand-800)]">Editar datos de contacto</summary>
            <form action={actualizarSocioAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="id" value={socio.id} />
              <div><Label>Documento</Label><input name="documento" defaultValue={socio.documento || ""} className={inputClass} /></div>
              <div><Label>Email</Label><input name="email" type="email" defaultValue={socio.email || ""} className={inputClass} /></div>
              <div><Label>Teléfono</Label><input name="telefono" defaultValue={socio.telefono || ""} className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" defaultValue={socio.notas || ""} className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Guardar</button>
              </div>
            </form>
          </details>
        )}
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
                    <details>
                      <summary className="cursor-pointer text-xs text-[var(--color-brand-800)] font-semibold">Editar</summary>
                      <form action={editarIntegranteAction} className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 w-64 sm:w-80">
                        <input type="hidden" name="id" value={i.id} />
                        <div><Label>Nombre</Label><input name="nombre" defaultValue={i.nombre} required className={inputClass} /></div>
                        <div><Label>Apellido</Label><input name="apellido" defaultValue={i.apellido || ""} className={inputClass} /></div>
                        <div><Label>Documento</Label><input name="documento" defaultValue={i.documento || ""} className={inputClass} /></div>
                        <div><Label>Fecha de nacimiento</Label><input type="date" name="fecha_nacimiento" defaultValue={i.fecha_nacimiento || ""} className={inputClass} /></div>
                        <div><Label>Teléfono</Label><input name="telefono" defaultValue={i.telefono || ""} className={inputClass} /></div>
                        <div><Label>Email</Label><input type="email" name="email" defaultValue={i.email || ""} className={inputClass} /></div>
                        <div>
                          <Label>Relación</Label>
                          <select name="relacion" defaultValue={i.relacion} className={inputClass}>
                            {RELACION_INTEGRANTE.map((r) => <option key={r} value={r}>{RELACION_INTEGRANTE_LABEL[r]}</option>)}
                          </select>
                        </div>
                        <div>
                          <Label>Tipo</Label>
                          <select name="tipo_integrante" defaultValue={i.tipo_integrante} className={inputClass}>
                            {TIPO_INTEGRANTE.map((t) => <option key={t} value={t}>{TIPO_INTEGRANTE_LABEL[t]}</option>)}
                          </select>
                        </div>
                        <div className="sm:col-span-2"><Label>Observaciones</Label><input name="observaciones" defaultValue={i.observaciones || ""} className={inputClass} /></div>
                        <div className="sm:col-span-2"><button className="rounded-lg bg-[var(--color-brand-800)] text-white px-3 py-1.5 text-xs font-semibold">Guardar</button></div>
                      </form>
                    </details>
                    <form action={cambiarEstadoIntegranteAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="estado" value={i.estado === "activo" ? "inactivo" : "activo"} />
                      <button className="text-xs text-ink-faint hover:text-[var(--color-rojo)] underline underline-offset-2">
                        {i.estado === "activo" ? "Dar de baja" : "Reactivar"}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          ))}
          {integrantes.length === 0 && <p className="text-xs text-ink-faint">Sin otros integrantes cargados todavía.</p>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Agregar integrante</summary>
            <form action={agregarIntegranteAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="socio_id" value={socio.id} />
              <div><Label>Nombre</Label><input name="nombre" required className={inputClass} /></div>
              <div><Label>Apellido</Label><input name="apellido" className={inputClass} /></div>
              <div><Label>Documento</Label><input name="documento" className={inputClass} /></div>
              <div><Label>Fecha de nacimiento</Label><input type="date" name="fecha_nacimiento" className={inputClass} /></div>
              <div><Label>Teléfono</Label><input name="telefono" className={inputClass} /></div>
              <div><Label>Email</Label><input type="email" name="email" className={inputClass} /></div>
              <div>
                <Label>Relación con el titular</Label>
                <select name="relacion" className={inputClass} defaultValue="pareja">
                  {RELACION_INTEGRANTE.filter((r) => r !== "titular").map((r) => <option key={r} value={r}>{RELACION_INTEGRANTE_LABEL[r]}</option>)}
                </select>
              </div>
              <div>
                <Label>Tipo de integrante</Label>
                <select name="tipo_integrante" className={inputClass} defaultValue="adulto">
                  {TIPO_INTEGRANTE.map((t) => <option key={t} value={t}>{TIPO_INTEGRANTE_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><Label>Observaciones</Label><input name="observaciones" className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Agregar integrante</button>
              </div>
            </form>
          </details>
        )}
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

            {puedeRegistrar && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Registrar cargo o pago</summary>
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
                    <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Registrar</button>
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
