import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card, PageHeader, SectionTitle, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { hoyEnUruguay, textoDia } from "@/lib/horasObra";
import { espaciosComunes, reservasDesde, puedeAdministrarEspacios } from "@/lib/habitada";
import { reservarFormAction, cancelarReservaFormAction, decidirReservaFormAction, crearEspacioFormAction } from "@/lib/actions/habitada";

const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-5 py-3 text-[16px] font-semibold text-white min-h-[48px]";
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

/** Fase 3H — reservas de los espacios comunes (salón, parrillero…). */
export default async function ReservasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const admin = puedeAdministrarEspacios(user);
  const hoy = hoyEnUruguay();
  const [espacios, reservas] = await Promise.all([espaciosComunes(), reservasDesde(hoy)]);
  const pendientes = reservas.filter((r) => r.estado === "pendiente");
  const fechas = [...new Set(reservas.map((r) => r.fecha))];

  return (
    <div className="max-w-3xl space-y-5 text-[16px]">
      <PageHeader title="Reservas de espacios comunes" subtitle="Salón, parrillero y otros espacios de la cooperativa" />

      {espacios.length > 0 ? (
        <FormularioEnModal textoBoton="Reservar un espacio" claseBoton={botonPrincipal} titulo="Reservar un espacio" action={reservarFormAction} textoConfirmar="Reservar">
          <label className="block">
            <Label required>Espacio</Label>
            <select name="espacio_id" required defaultValue="" className={inputClass}>
              <option value="" disabled>Elegí…</option>
              {espacios.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                  {e.capacidad ? ` (hasta ${e.capacidad} personas)` : ""}
                  {e.requiere_aprobacion ? " — la confirma la administración" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label required>Día</Label>
            <input name="fecha" type="date" required min={hoy} defaultValue={hoy} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label required>Desde</Label>
              <input name="hora_inicio" type="time" required defaultValue="18:00" className={inputClass} />
            </label>
            <label className="block">
              <Label required>Hasta</Label>
              <input name="hora_fin" type="time" required defaultValue="22:00" className={inputClass} />
            </label>
          </div>
          <label className="block">
            <Label>¿Para qué?</Label>
            <input name="motivo" maxLength={300} className={inputClass} placeholder="Cumpleaños, reunión…" />
          </label>
        </FormularioEnModal>
      ) : (
        <Card>
          <EmptyState>Todavía no hay espacios para reservar.</EmptyState>
        </Card>
      )}

      {admin && pendientes.length > 0 && (
        <section>
          <SectionTitle>{`Para confirmar (${pendientes.length})`}</SectionTitle>
          <Card>
            <ul className="divide-y divide-border">
              {pendientes.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    {r.espacio} · {textoDia(r.fecha)} {r.hora_inicio}–{r.hora_fin} · {r.persona}
                    {r.motivo && <span className="block text-sm text-ink-muted">{r.motivo}</span>}
                  </span>
                  <span className="flex gap-3">
                    <FormularioEnModal textoBoton="Confirmar" claseBoton={botonLink} titulo="Confirmar la reserva" action={decidirReservaFormAction} ocultos={{ id: r.id, decision: "confirmada" }} textoConfirmar="Confirmar" />
                    <FormularioEnModal textoBoton="Rechazar" claseBoton="text-sm text-ink-muted underline underline-offset-2" titulo="Rechazar la reserva" action={decidirReservaFormAction} ocultos={{ id: r.id, decision: "rechazada" }} textoConfirmar="Rechazar" peligro />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section>
        <SectionTitle>Próximas reservas</SectionTitle>
        <Card>
          {fechas.length === 0 && <EmptyState>No hay reservas.</EmptyState>}
          <div className="space-y-3">
            {fechas.map((f) => (
              <div key={f}>
                <p className="font-semibold text-ink first-letter:uppercase">{f === hoy ? "Hoy" : textoDia(f)}</p>
                <ul className="divide-y divide-border">
                  {reservas
                    .filter((r) => r.fecha === f)
                    .map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          {r.espacio} · {r.hora_inicio}–{r.hora_fin} · {r.user_id === user.id ? "vos" : r.persona}{" "}
                          {r.estado === "pendiente" && <Badge color="amarillo">Falta confirmar</Badge>}
                        </span>
                        {(r.user_id === user.id || admin) && (
                          <FormularioEnModal textoBoton="Cancelar" claseBoton="text-sm text-ink-muted underline underline-offset-2" titulo="Cancelar la reserva" action={cancelarReservaFormAction} ocultos={{ id: r.id }} textoConfirmar="Cancelar la reserva" peligro />
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {admin && (
        <FormularioEnModal textoBoton="+ Agregar un espacio" claseBoton={botonLink} titulo="Nuevo espacio común" action={crearEspacioFormAction}>
          <label className="block">
            <Label required>Nombre</Label>
            <input name="nombre" required maxLength={100} className={inputClass} placeholder="Salón comunal" />
          </label>
          <label className="block">
            <Label>Descripción</Label>
            <input name="descripcion" maxLength={500} className={inputClass} />
          </label>
          <label className="block">
            <Label>Capacidad (personas)</Label>
            <input name="capacidad" type="number" min={1} max={5000} className={inputClass} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="requiere_aprobacion" value="1" /> Las reservas las confirma la administración
          </label>
        </FormularioEnModal>
      )}
    </div>
  );
}
