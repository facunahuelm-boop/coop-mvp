import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { hoyEnUruguay, sumarDias } from "@/lib/horasObra";
import { preventivos, puedeMantenimiento } from "@/lib/habitada";
import { crearPreventivoFormAction, marcarPreventivoHechoFormAction, desactivarPreventivoFormAction } from "@/lib/actions/habitada";

const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "—");
const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-4 py-2.5 text-sm font-semibold text-white";
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

/** Fase 3H — mantenimiento preventivo: lo que hay que hacer cada tanto, y cuándo se hizo. */
export default async function MantenimientoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "reclamos")) redirect("/dashboard");
  const puede = await puedeMantenimiento(user);
  const hoy = hoyEnUruguay();
  const [lista, registros] = await Promise.all([
    preventivos(),
    all<{ id: number; titulo: string; fecha: string; notas: string | null; costo: number | null; hecho_por: string | null }>(
      `SELECT r.id, p.titulo, r.fecha, r.notas, r.costo, u.nombre AS hecho_por FROM mantenimiento_registros r JOIN mantenimiento_preventivo p ON p.id = r.preventivo_id LEFT JOIN users u ON u.id = r.hecho_por_id ORDER BY r.fecha DESC, r.id DESC LIMIT 20`
    ).catch(() => []),
  ]);
  const vencidos = lista.filter((p) => p.proxima_fecha < hoy);

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Mantenimiento preventivo" subtitle="Lo que hay que hacer cada tanto para que nada se rompa" action={<Link href="/reclamos" className="text-sm font-semibold underline underline-offset-2">Reclamos</Link>} />
      {vencidos.length > 0 && (
        <Card className="!border-[var(--color-rojo)]/30">
          <p className="text-[15px] font-semibold text-ink">Atrasado: {vencidos.map((v) => v.titulo).join(", ")}.</p>
        </Card>
      )}
      <Card>
        <ul className="divide-y divide-border">
          {lista.map((p) => {
            const atrasado = p.proxima_fecha < hoy;
            const pronto = !atrasado && p.proxima_fecha <= sumarDias(hoy, 14);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
                <span>
                  <span className="font-semibold">{p.titulo}</span> <Badge color={atrasado ? "rojo" : pronto ? "amarillo" : "verde"}>{atrasado ? "Atrasado" : pronto ? "Pronto" : "Al día"}</Badge>
                  <span className="block text-sm text-ink-muted">
                    Cada {p.frecuencia_dias} días · última vez {dmy(p.ultima_vez)} · próxima {dmy(p.proxima_fecha)}
                  </span>
                  {p.descripcion && <span className="block text-sm text-ink-muted">{p.descripcion}</span>}
                </span>
                {puede && (
                  <span className="flex items-center gap-3">
                    <FormularioEnModal textoBoton="Ya se hizo" claseBoton={botonLink} titulo={`${p.titulo}: se hizo`} action={marcarPreventivoHechoFormAction} ocultos={{ id: p.id }}>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <Label required>Fecha</Label>
                          <input name="fecha" type="date" required max={hoy} defaultValue={hoy} className={inputClass} />
                        </label>
                        <label className="block">
                          <Label>Costo ($)</Label>
                          <input name="costo" type="number" step="0.01" min={0} className={inputClass} />
                        </label>
                      </div>
                      <label className="block">
                        <Label>Notas</Label>
                        <input name="notas" maxLength={1000} className={inputClass} />
                      </label>
                    </FormularioEnModal>
                    <FormularioEnModal textoBoton="Sacar" claseBoton="text-sm text-ink-muted underline underline-offset-2" titulo={`Sacar ${p.titulo} del plan`} action={desactivarPreventivoFormAction} ocultos={{ id: p.id }} textoConfirmar="Sacar" peligro />
                  </span>
                )}
              </li>
            );
          })}
          {lista.length === 0 && <EmptyState>Todavía no hay tareas de mantenimiento preventivo.</EmptyState>}
        </ul>
      </Card>
      {puede && (
        <FormularioEnModal textoBoton="+ Agregar al plan" claseBoton={botonPrincipal} titulo="Nueva tarea de mantenimiento preventivo" action={crearPreventivoFormAction}>
          <label className="block">
            <Label required>¿Qué hay que hacer?</Label>
            <input name="titulo" required maxLength={150} className={inputClass} placeholder="Limpieza de tanques de agua" />
          </label>
          <label className="block">
            <Label>Detalle</Label>
            <textarea name="descripcion" rows={2} maxLength={1000} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label required>Cada cuántos días</Label>
              <input name="frecuencia_dias" type="number" min={1} max={3650} required className={inputClass} placeholder="180" />
            </label>
            <label className="block">
              <Label required>Próxima vez</Label>
              <input name="proxima_fecha" type="date" required defaultValue={hoy} className={inputClass} />
            </label>
          </div>
        </FormularioEnModal>
      )}
      <SectionTitle>Últimas veces que se hizo</SectionTitle>
      <Card>
        <ul className="divide-y divide-border">
          {registros.map((r) => (
            <li key={r.id} className="py-2 text-[15px]">
              {dmy(r.fecha)} · {r.titulo}
              {r.costo ? ` · $ ${Number(r.costo).toLocaleString("es-UY")}` : ""}
              <span className="block text-sm text-ink-muted">{[r.notas, r.hecho_por ? `anotó ${r.hecho_por}` : null].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
          {registros.length === 0 && <EmptyState>Sin registros todavía.</EmptyState>}
        </ul>
      </Card>
    </div>
  );
}
