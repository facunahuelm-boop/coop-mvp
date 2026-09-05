import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState, Label, inputClass } from "@/components/ui";
import {
  crearComisionAction,
  archivarComisionAction,
  agregarMiembroAction,
  quitarMiembroAction,
} from "@/lib/actions/comisiones";

export default async function ComisionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");

  const [comisiones, miembros, usuarios] = await Promise.all([
    all<any>(`SELECT * FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    all<any>(
      `SELECT m.*, u.nombre as user_nombre FROM comision_miembros m JOIN users u ON u.id = m.user_id WHERE m.activo = 1 ORDER BY m.rol_en_comision DESC, u.nombre ASC`
    ),
    all<any>(`SELECT id, nombre, rol FROM users WHERE activo = 1 ORDER BY nombre ASC`),
  ]);

  const miembrosPorComision = (comisionId: number) => miembros.filter((m) => m.comision_id === comisionId);

  return (
    <div>
      <PageHeader title="Comisiones" subtitle="Quién integra cada comisión de la cooperativa" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {comisiones.map((c) => {
          const integrantes = miembrosPorComision(c.id);
          return (
            <Card key={c.id}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#123240]">{c.nombre}</h3>
                {puedeEditar && (
                  <form action={archivarComisionAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs text-black/40 hover:text-[var(--color-rojo)] underline underline-offset-2">Archivar</button>
                  </form>
                )}
              </div>
              {c.descripcion && <p className="text-xs text-black/50 mt-0.5">{c.descripcion}</p>}

              <div className="flex flex-wrap gap-1.5 mt-3">
                {integrantes.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 text-xs rounded-full bg-black/5 px-2.5 py-1">
                    {m.rol_en_comision === "coordinador" ? "⭐ " : ""}
                    {m.user_nombre}
                    {puedeEditar && (
                      <form action={quitarMiembroAction} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="text-black/40 hover:text-[var(--color-rojo)]" title="Quitar de la comisión">✕</button>
                      </form>
                    )}
                  </span>
                ))}
                {integrantes.length === 0 && <p className="text-xs text-black/40 italic">Sin integrantes todavía.</p>}
              </div>

              {puedeEditar && (
                <form action={agregarMiembroAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="comision_id" value={c.id} />
                  <div className="flex-1 min-w-[140px]">
                    <Label>Agregar integrante</Label>
                    <select name="user_id" required className={inputClass}>
                      {usuarios.map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Rol</Label>
                    <select name="rol_en_comision" className={inputClass} defaultValue="integrante">
                      <option value="integrante">Integrante</option>
                      <option value="coordinador">Coordinador/a</option>
                    </select>
                  </div>
                  <button className="rounded-lg bg-[#e7eff1] text-[#1f4e5f] px-3 py-2 text-xs font-semibold whitespace-nowrap">Agregar</button>
                </form>
              )}
            </Card>
          );
        })}
        {comisiones.length === 0 && <EmptyState>Todavía no hay comisiones creadas.</EmptyState>}
      </div>

      {puedeEditar && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-[#1f4e5f]">+ Crear comisión</summary>
          <Card className="mt-3">
            <form action={crearComisionAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Nombre</Label><input name="nombre" required placeholder="Ej: Comisión de Educación" className={inputClass} /></div>
              <div><Label>Descripción</Label><input name="descripcion" className={inputClass} /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold">Crear comisión</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
