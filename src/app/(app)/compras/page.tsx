import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import Link from "next/link";
import dayjs from "dayjs";
import { crearSolicitudAction } from "@/lib/actions/compras";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";

const estadoColor: Record<string, "gray" | "amarillo" | "verde" | "brand" | "rojo"> = {
  pendiente_cotizacion: "gray", en_comparacion: "amarillo", aprobada: "brand", pedida: "amarillo", entregada: "verde", rechazada: "rojo",
};
const estadoLabel: Record<string, string> = {
  pendiente_cotizacion: "Pendiente de cotización", en_comparacion: "En comparación", aprobada: "Aprobada", pedida: "Pedida a proveedor", entregada: "Entregada", rechazada: "Rechazada",
};

export default async function ComprasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "compras")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "compras");
  const esOversightFinanzas = canEdit(user.rol, "finanzas");
  // sc.comision_id (y el JOIN a comisiones) sólo existen desde la migración
  // 0020 — si todavía no corrió en esta base, este SELECT explícito rompía
  // con "column sc.comision_id does not exist" y tumbaba TODA la pantalla de
  // Compras con un error 500 (a diferencia de un SELECT *, que simplemente no
  // trae la columna si no existe). Se intenta primero con el vínculo nuevo, y
  // si la columna no existe todavía se cae a la versión vieja (sin
  // "comision_vinculada") en vez de romper la página entera — mismo criterio
  // defensivo que ya se usa en /gastos y /socios para no depender de que la
  // migración ya haya corrido.
  const solicitudesConComisionId = `SELECT sc.*, u.nombre as solicitante_nombre, c.nombre as comision_vinculada FROM solicitudes_compra sc LEFT JOIN users u ON u.id = sc.solicitante_id LEFT JOIN comisiones c ON c.id = sc.comision_id ORDER BY CASE prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC`;
  const solicitudesSinComisionId = `SELECT sc.*, u.nombre as solicitante_nombre, NULL as comision_vinculada FROM solicitudes_compra sc LEFT JOIN users u ON u.id = sc.solicitante_id ORDER BY CASE prioridad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, sc.creado_en DESC`;
  const [solicitudes, comisionesActivas, misComisiones] = await Promise.all([
    all<any>(solicitudesConComisionId).catch(() => all<any>(solicitudesSinComisionId)),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`).catch(() => []),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]).catch(() => []),
  ]);
  // Solo se ofrecen para "vincular" las comisiones que esta persona puede
  // gestionar de verdad (integrante activo, u oversight de finanzas) — evita
  // que elija una y el servidor le rechace crearSolicitudAction por
  // puedeGestionarComision (mismo criterio que ya usa /gastos).
  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));
  const comisiones = esOversightFinanzas ? comisionesActivas : comisionesActivas.filter((c) => misComisionIds.has(c.id));

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Solicitudes y presupuestos"
        action={
          <Link href="/proveedores" className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap">
            Ver proveedores →
          </Link>
        }
      />

      <div className="space-y-2">
        {solicitudes.map((s) => (
          <Link key={s.id} href={`/compras/${s.id}`}>
            <Card className="hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-brand-900)]">{s.material} <span className="font-normal text-ink/50">({s.cantidad} {s.unidad})</span></p>
                  <p className="text-xs text-ink/50 mt-0.5">
                    {CATEGORIA_COMPRA_LABEL[s.categoria] || CATEGORIA_COMPRA_LABEL.obra} · {s.comision_vinculada || s.comision} · {s.solicitante_nombre}
                    {s.fecha_necesaria && ` · necesario para el ${dayjs(s.fecha_necesaria).format("DD/MM")}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge color={estadoColor[s.estado]}>{estadoLabel[s.estado]}</Badge>
                  {s.prioridad === "critica" && <Badge color="rojo">🔴 crítica</Badge>}
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {solicitudes.length === 0 && <EmptyState>No hay solicitudes de compra todavía.</EmptyState>}
      </div>

      {puedeEditar && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Nueva solicitud de compra</summary>
          <Card className="mt-3">
            <form action={crearSolicitudAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Categoría de la compra</Label>
                <select name="categoria" className={inputClass} defaultValue="obra">
                  {Object.entries(CATEGORIA_COMPRA_LABEL).map(([valor, label]) => (
                    <option key={valor} value={valor}>{label}</option>
                  ))}
                </select>
              </div>
              <div><Label>Comisión solicitante</Label><input name="comision" required className={inputClass} placeholder="Comisión de Obra" /></div>
              <div>
                <Label>Vincular a una comisión real (opcional)</Label>
                <select name="comision_id" className={inputClass} defaultValue="">
                  <option value="">— sin vincular —</option>
                  {comisiones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                <p className="text-[11px] text-ink-faint mt-1">Vinculada, la compra suma al gasto de esa comisión en /gastos cuando se apruebe.</p>
              </div>
              <div><Label>Material</Label><input name="material" required className={inputClass} /></div>
              <div><Label>Cantidad</Label><input name="cantidad" type="number" step="0.01" required className={inputClass} /></div>
              <div><Label>Unidad</Label><input name="unidad" required className={inputClass} placeholder="kg, unidad, m2…" /></div>
              <div className="sm:col-span-2"><Label>Especificación</Label><input name="especificacion" className={inputClass} /></div>
              <div><Label>Etapa de obra (si corresponde)</Label><input name="etapa_obra" className={inputClass} /></div>
              <div><Label>Fecha necesaria</Label><input type="date" name="fecha_necesaria" className={inputClass} /></div>
              <div>
                <Label>Prioridad</Label>
                <select name="prioridad" className={inputClass} defaultValue="media">
                  <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option>
                </select>
              </div>
              <div><Label>Presupuesto estimado</Label><input name="presupuesto_estimado" type="number" className={inputClass} /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Crear solicitud</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
