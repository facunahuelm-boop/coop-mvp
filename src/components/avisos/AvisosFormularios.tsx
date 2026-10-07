"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import {
  enviarAvisoFormAction,
  anularAvisoFormAction,
  marcarWhatsappAbiertoAction,
  marcarAvisoLeidoAction,
  guardarPreferenciasAvisosFormAction,
  generarLinkCalendarioFormAction,
} from "@/lib/actions/avisos";

/** Fase 2F — formularios de Avisos oficiales y preferencias. */

type Opcion = { id: number | string; nombre: string };

const PLANTILLAS: { clave: string; nombre: string; titulo: string; cuerpo: string }[] = [
  { clave: "", nombre: "Escribir desde cero", titulo: "", cuerpo: "" },
  {
    clave: "jornada",
    nombre: "Jornada de trabajo",
    titulo: "Jornada de trabajo del sábado",
    cuerpo: "Les recordamos que este sábado hay jornada de trabajo en la obra.\nHora: 8:00\nTraer: ropa de trabajo y calzado de seguridad.\nAnoten sus horas en COOVA.",
  },
  {
    clave: "cuota",
    nombre: "Recordatorio de cuota",
    titulo: "Recordatorio: cuota del mes",
    cuerpo: "Les recordamos que la cuota del mes vence el día 10.\nSi tenés algún problema para pagar, hablá con Tesorería: siempre hay una solución.",
  },
  {
    clave: "asamblea",
    nombre: "Aviso de asamblea",
    titulo: "Asamblea de socios",
    cuerpo: "Les avisamos que habrá asamblea.\nFecha y hora: \nLugar: \nEl orden del día está en COOVA, en Asambleas.",
  },
  {
    clave: "urgente",
    nombre: "Aviso urgente de obra",
    titulo: "Aviso urgente",
    cuerpo: "Por un tema de la obra, les pedimos que lean este aviso:\n",
  },
];

export function NuevoAvisoForm({ comisiones, nucleos, roles }: { comisiones: Opcion[]; nucleos: Opcion[]; roles: Opcion[] }) {
  const [estado, formAction] = useActionState(enviarAvisoFormAction, ESTADO_INICIAL);
  const [tipo, setTipo] = useState("todos");
  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const router = useRouter();
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok && estado.aviso) {
      show("Aviso enviado.");
      router.push(estado.aviso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const refs = tipo === "comision" ? comisiones : tipo === "nucleo" ? nucleos : tipo === "rol" ? roles : null;

  return (
    <form action={formAction} className="space-y-4 text-[15px]" id="nuevo-aviso">
      <FormError message={estado.error} />
      <label className="block">
        <Label>Empezar con un modelo</Label>
        <select
          className={inputClass}
          onChange={(e) => {
            const p = PLANTILLAS.find((x) => x.clave === e.target.value);
            if (p && p.clave) {
              setTitulo(p.titulo);
              setCuerpo(p.cuerpo);
            }
          }}
        >
          {PLANTILLAS.map((p) => (
            <option key={p.clave} value={p.clave}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <Label required>¿A quién?</Label>
          <select name="destinatarios_tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
            <option value="todos">Todos (socios y usuarios)</option>
            <option value="socios">Todos los socios</option>
            <option value="comision">Una comisión</option>
            <option value="nucleo">Un núcleo</option>
            <option value="rol">Un rol (ej. tesorería)</option>
            <option value="morosos">Socios con cuotas atrasadas</option>
          </select>
        </label>
        {refs && (
          <label className="block">
            <Label required>{tipo === "comision" ? "¿Qué comisión?" : tipo === "nucleo" ? "¿Qué núcleo?" : "¿Qué rol?"}</Label>
            <select name="destinatario_ref" required className={inputClass} key={tipo}>
              <option value="">Elegí…</option>
              {refs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="block">
        <Label required>Título</Label>
        <input name="titulo" required maxLength={150} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <Label required>Mensaje</Label>
        <textarea name="cuerpo" required rows={6} maxLength={3000} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} className={inputClass} />
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="urgente" value="si" className="h-5 w-5" /> Es urgente
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="por_email" value="si" className="h-5 w-5" /> Mandar también por email
        </label>
      </div>
      <p className="text-sm text-ink-muted">
        Le llega a cada persona en COOVA. Después de enviarlo vas a ver la lista con quién lo recibió y quién lo leyó, y los botones para mandarlo por WhatsApp a quien lo necesite.
      </p>
      <div className="flex justify-end">
        <SubmitButton>Enviar aviso</SubmitButton>
      </div>
    </form>
  );
}

/** Abre el chat de WhatsApp con el texto listo y deja registrado que se abrió. */
export function BotonWhatsApp({ destinatarioId, link, abierto }: { destinatarioId: number; link: string; abierto: boolean }) {
  const [hecho, setHecho] = useState(abierto);
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        setHecho(true);
        marcarWhatsappAbiertoAction(destinatarioId).catch(() => {});
      }}
      className={`inline-flex items-center rounded-xl border px-3 py-1.5 text-sm font-semibold ${hecho ? "border-border text-ink-muted" : "border-[var(--color-verde)] text-[var(--color-verde)]"}`}
    >
      {hecho ? "WhatsApp abierto ✓" : "Abrir WhatsApp"}
    </a>
  );
}

/** Marca el aviso como leído cuando la persona lo abre. */
export function MarcarLeido({ avisoId }: { avisoId: number }) {
  useEffect(() => {
    marcarAvisoLeidoAction(avisoId).catch(() => {});
  }, [avisoId]);
  return null;
}

export function AnularAvisoForm({ id }: { id: number }) {
  return (
    <FormularioEnModal
      textoBoton="Anular aviso"
      titulo="Anular este aviso"
      descripcion="El aviso queda marcado como anulado (no se borra). Conviene mandar otro aviso con la corrección."
      action={anularAvisoFormAction}
      ocultos={{ id }}
      textoConfirmar="Anular"
      peligro
      mensajeExito="Aviso anulado."
    >
      <label className="block">
        <Label required>Motivo</Label>
        <input name="motivo" required maxLength={300} className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function PreferenciasForm({ telefono, avisoEmail, avisoWhatsapp, resumenSemanal }: { telefono: string | null; avisoEmail: boolean; avisoWhatsapp: boolean; resumenSemanal: boolean }) {
  const [estado, formAction] = useActionState(guardarPreferenciasAvisosFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok && estado.aviso) show(estado.aviso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="space-y-4 text-[15px]">
      <FormError message={estado.error} />
      <label className="block">
        <Label>Tu celular (para WhatsApp)</Label>
        <input name="telefono" defaultValue={telefono ?? ""} maxLength={30} placeholder="099 123 456" className={inputClass} />
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="aviso_email" value="si" defaultChecked={avisoEmail} className="mt-1 h-5 w-5" />
        <span>Quiero recibir los avisos oficiales también por email.</span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="aviso_whatsapp" value="si" defaultChecked={avisoWhatsapp} className="mt-1 h-5 w-5" />
        <span>Me pueden escribir por WhatsApp para avisos de la cooperativa.</span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="resumen_semanal" value="si" defaultChecked={resumenSemanal} className="mt-1 h-5 w-5" />
        <span>Quiero el resumen de los lunes (lo que pasó y lo que viene en la semana), si la cooperativa lo tiene prendido.</span>
      </label>
      <div className="flex justify-end">
        <SubmitButton>Guardar</SubmitButton>
      </div>
    </form>
  );
}

export function LinkCalendarioForm({ tiene }: { tiene: boolean }) {
  return (
    <FormularioEnModal
      textoBoton={tiene ? "Cambiar el link" : "Crear mi link del calendario"}
      titulo={tiene ? "Cambiar el link del calendario" : "Link del calendario"}
      descripcion={
        tiene
          ? "El link anterior va a dejar de funcionar. Vas a tener que volver a agregarlo en tu celular."
          : "Con este link personal, las fechas de la cooperativa aparecen en el calendario de tu celular (Google Calendar, iPhone). No lo compartas."
      }
      action={generarLinkCalendarioFormAction}
      textoConfirmar={tiene ? "Cambiar" : "Crear"}
    />
  );
}
