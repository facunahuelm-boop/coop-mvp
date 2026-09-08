import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, Badge, EmptyState, Label, inputClass } from "@/components/ui";
import dayjs from "dayjs";
import Link from "next/link";
import { crearReunionAction } from "@/lib/actions/reuniones";

const TIPO_LABEL: Record<string, string> = {
  asamblea: "Asamblea",
  consejo_directivo: "Consejo Directivo",
  comision: "Comisión",
};

const ESTADO_COLOR: Record<string, "verde" | "amarillo" | "rojo" | "brand" | "gray"> = {
  planificada: "brand",
  realizada: "verde",
  cancelada: "gray",
};

export default async function ReunionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");

  const [proximas, pasadas, comisiones] = await Promise.all([
    all<any>(`SELECT r.*, c.nombre as comision_nombre FROM reuniones r LEFT JOIN comisiones c ON c.id = r.comision_id WHERE r.estado = 'planificada' ORDER BY r.fecha ASC`),
    all<any>(`SELECT r.*, c.nombre as comision_nombre FROM reuniones r LEFT JOIN comisiones c ON c.id = r.comision_id WHERE r.estado != 'planificada' ORDER BY r.fecha DESC LIMIT 15`),
    all<any>(`SELECT * FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
  ]);

  const Fila = ({ r }: { r: any }) => (
    <Link key={r.id} href={`/reuniones/${r.id}`}>
      <Card className="hover:shadow-md">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[var(--color-brand-900)]">{r.titulo}</p>
          <Badge color={ESTADO_COLOR[r.estado] ?? "gray"}>{r.estado}</Badge>
        </div>
        <p className="text-xs text-ink/50 mt-0.5">
          {dayjs(r.fecha).format("DD/MM/YYYY HH:mm")} · {TIPO_LABEL[r.tipo] ?? r.tipo}
          {r.comision_nombre ? ` — ${r.comision_nombre}` : ""}
          {r.lugar ? ` · ${r.lugar}` : ""}
        </p>
      </Card>
    </Link>
  );

  return (
    <div>
      <PageHeader title="Reuniones" subtitle="Agenda, asistencia y actas de asambleas y comisiones" />

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Próximas</h3>
      <div className="space-y-2 mb-6">
        {proximas.map((r) => <Fila key={r.id} r={r} />)}
        {proximas.length === 0 && <EmptyState>No hay reuniones planificadas.</EmptyState>}
      </div>

      <h3 className="text-sm font-bold text-[var(--color-brand-900)] mb-2">Historial</h3>
      <div className="space-y-2 mb-6">
        {pasadas.map((r) => <Fila key={r.id} r={r} />)}
        {pasadas.length === 0 && <EmptyState>Sin reuniones anteriores.</EmptyState>}
      </div>

      {puedeEditar && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Agendar reunión</summary>
          <Card className="mt-3">
            <form action={crearReunionAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <select name="tipo" className={inputClass} defaultValue="comision">
                  <option value="asamblea">Asamblea</option>
                  <option value="consejo_directivo">Consejo Directivo</option>
                  <option value="comision">Comisión</option>
                </select>
              </div>
              <div>
                <Label>Comisión (si corresponde)</Label>
                <select name="comision_id" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {comisiones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><Label>Título</Label><input name="titulo" required className={inputClass} /></div>
              <div><Label>Fecha y hora</Label><input type="datetime-local" name="fecha" required className={inputClass} /></div>
              <div><Label>Lugar</Label><input name="lugar" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Orden del día</Label><textarea name="orden_del_dia" className={inputClass} rows={3} placeholder={"Un punto por línea"} /></div>
              <div className="sm:col-span-2"><button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Agendar reunión</button></div>
            </form>
          </Card>
        </details>
      )}
    </div>
  );
}
