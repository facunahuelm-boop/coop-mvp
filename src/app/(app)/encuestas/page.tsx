import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { canEdit } from "@/lib/roles";
import { Card, PageHeader, EmptyState, Badge, Label, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { crearEncuestaFormAction, responderEncuestaFormAction, cerrarEncuestaFormAction } from "@/lib/actions/seguimiento";

type Encuesta = { id: number; pregunta: string; opciones: string[]; multiple: number; anonima: number; cierra_en: string | null; estado: string; creado_en: string };
type Resp = { encuesta_id: number; user_id: number; opciones: string[]; comentario: string | null; nombre: string };

const botonPrincipal = "inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-5 py-3 text-[16px] font-semibold text-white min-h-[48px]";
const botonLink = "text-sm font-semibold text-ink-muted underline underline-offset-2";
const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");

/** Fase 3I — encuestas rápidas: una pregunta, unas opciones, una respuesta por persona. */
export default async function EncuestasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const emite = canEdit(user.rol, "socios") || canEdit(user.rol, "finanzas") || user.rol === "consejo_directivo";
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Montevideo" });
  const [encuestas, respuestas] = await Promise.all([
    all<Encuesta>(`SELECT id, pregunta, opciones, multiple, anonima, cierra_en, estado, creado_en FROM encuestas WHERE estado <> 'anulada' ORDER BY (estado = 'abierta') DESC, id DESC LIMIT 30`).catch(() => [] as Encuesta[]),
    all<Resp>(`SELECT r.encuesta_id, r.user_id, r.opciones, r.comentario, u.nombre FROM encuesta_respuestas r JOIN users u ON u.id = r.user_id`).catch(() => [] as Resp[]),
  ]);
  const abierta = (e: Encuesta) => e.estado === "abierta" && (!e.cierra_en || e.cierra_en >= hoy);

  return (
    <div className="max-w-3xl space-y-5 text-[16px]">
      <PageHeader title="Encuestas" subtitle="Preguntas rápidas para saber qué piensa la cooperativa" />
      {emite && (
        <FormularioEnModal textoBoton="+ Nueva encuesta" claseBoton={botonPrincipal} titulo="Nueva encuesta" action={crearEncuestaFormAction} textoConfirmar="Enviar a todos">
          <label className="block">
            <Label required>Pregunta</Label>
            <input name="pregunta" required maxLength={300} className={inputClass} placeholder="¿Qué día preferís para la próxima jornada?" />
          </label>
          <label className="block">
            <Label required>Opciones (una por renglón)</Label>
            <textarea name="opciones" required rows={4} maxLength={2000} className={inputClass} placeholder={"Sábado\nDomingo"} />
          </label>
          <label className="block">
            <Label>Cierra el</Label>
            <input name="cierra_en" type="date" min={hoy} className={inputClass} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="multiple" value="1" /> Se puede elegir más de una opción
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="anonima" value="0" /> Mostrar quién respondió qué (si no, es anónima)
          </label>
        </FormularioEnModal>
      )}
      {encuestas.length === 0 && (
        <Card>
          <EmptyState>No hay encuestas.</EmptyState>
        </Card>
      )}
      {encuestas.map((e) => {
        const resp = respuestas.filter((r) => r.encuesta_id === e.id);
        const mia = resp.find((r) => r.user_id === user.id);
        const conteo = e.opciones.map((o) => ({ o, n: resp.filter((r) => r.opciones.includes(o)).length }));
        const maximo = Math.max(1, ...conteo.map((c) => c.n));
        const verResultados = !!mia || !abierta(e) || emite;
        return (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-lg font-bold text-ink">{e.pregunta}</p>
                <p className="text-sm text-ink-muted">
                  {abierta(e) ? (e.cierra_en ? `Abierta hasta el ${dmy(e.cierra_en)}` : "Abierta") : "Cerrada"} · {resp.length} respuesta(s) · {e.anonima ? "anónima" : "con nombre"}
                </p>
              </div>
              <Badge color={abierta(e) ? "verde" : "gray"}>{abierta(e) ? "Abierta" : "Cerrada"}</Badge>
            </div>
            {abierta(e) && (
              <div className="mt-3">
                <FormularioEnModal textoBoton={mia ? "Cambiar mi respuesta" : "Responder"} claseBoton={mia ? botonLink : botonPrincipal} titulo={e.pregunta} action={responderEncuestaFormAction} ocultos={{ encuesta_id: e.id }} textoConfirmar="Enviar">
                  <fieldset className="space-y-2">
                    <legend className="sr-only">Opciones</legend>
                    {e.opciones.map((o) => (
                      <label key={o} className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 text-[16px]">
                        <input type={e.multiple ? "checkbox" : "radio"} name="opcion" value={o} defaultChecked={mia?.opciones.includes(o)} className="h-5 w-5" /> {o}
                      </label>
                    ))}
                  </fieldset>
                  <label className="block">
                    <Label>Comentario (opcional)</Label>
                    <input name="comentario" maxLength={500} defaultValue={mia?.comentario ?? ""} className={inputClass} />
                  </label>
                </FormularioEnModal>
                {mia && <p className="mt-1 text-sm text-ink-muted">Respondiste: {mia.opciones.join(", ")}</p>}
              </div>
            )}
            {verResultados && resp.length > 0 && (
              <ul className="mt-4 space-y-2" aria-label="Resultados">
                {conteo.map((c) => (
                  <li key={c.o}>
                    <div className="flex justify-between text-[15px]">
                      <span>{c.o}</span>
                      <span className="font-semibold">{c.n}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-surface-sunken">
                      <div className="h-2.5 rounded-full bg-[var(--color-brand-800)]" style={{ width: `${Math.round((c.n / maximo) * 100)}%` }} />
                    </div>
                    {!e.anonima && emite && <p className="text-xs text-ink-muted">{resp.filter((r) => r.opciones.includes(c.o)).map((r) => r.nombre).join(", ")}</p>}
                  </li>
                ))}
              </ul>
            )}
            {emite && abierta(e) && (
              <div className="mt-3 flex gap-4">
                <FormularioEnModal textoBoton="Cerrar la encuesta" claseBoton={botonLink} titulo="Cerrar la encuesta" action={cerrarEncuestaFormAction} ocultos={{ id: e.id, estado: "cerrada" }} textoConfirmar="Cerrar la encuesta" />
                <FormularioEnModal textoBoton="Anular" claseBoton={botonLink} titulo="Anular la encuesta" descripcion="Deja de verse. Queda en el historial." action={cerrarEncuestaFormAction} ocultos={{ id: e.id, estado: "anulada" }} textoConfirmar="Anular" peligro />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
