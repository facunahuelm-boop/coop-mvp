"use client";

// Fase 4 del rediseño: el formulario "Redactar" de /mails migrado a
// `useActionState` — mismo criterio que los demás módulos. No es un botón
// "Agregar" (manda un mail, no crea algo) así que sigue con `SubmitButton`
// simple, sin `variant="add"` — ver el criterio documentado en la Fase 3.

import { useActionState, useEffect, useRef } from "react";
import { Send, Users, User } from "lucide-react";
import { enviarMailFormAction } from "@/lib/actions/mails";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";

type UsuarioOpcion = { id: number; nombre: string; email: string | null };
type ComisionOpcion = { id: number; nombre: string; con_email: string };

export function EnviarMailForm({
  usuarios,
  comisiones,
  puedeATodos,
  totalConEmail,
}: {
  usuarios: UsuarioOpcion[];
  comisiones: ComisionOpcion[];
  puedeATodos: boolean;
  totalConEmail: number;
}) {
  const [estado, formAction] = useActionState(enviarMailFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Mail enviado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className={`grid grid-cols-1 ${puedeATodos ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}>
        <div>
          <Label>
            <span className="inline-flex items-center gap-1"><User size={12} /> A un usuario</span>
          </Label>
          <select name="usuario_id" defaultValue="" className={inputClass}>
            <option value="">— Elegir —</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre}{!u.email ? " (sin email — no se le puede mandar)" : ""}</option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.usuario_id} />
        </div>
        <div>
          <Label>
            <span className="inline-flex items-center gap-1"><Users size={12} /> ...o a una comisión</span>
          </Label>
          <select name="comision_id" defaultValue="" className={inputClass}>
            <option value="">— Elegir —</option>
            {comisiones.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} ({c.con_email} con email)
              </option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.comision_id} />
        </div>
        {puedeATodos && (
          <div>
            <Label>...o a todos</Label>
            <label className="flex items-center gap-2 rounded-lg border border-ink/10 bg-surface px-3 py-2 text-sm cursor-pointer">
              <input type="checkbox" name="todos" className="h-4 w-4" />
              Todos los usuarios de la cooperativa ({totalConEmail} con email)
            </label>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-faint">Elegí una sola opción — a quien elijas le llega el mail directo a su casilla.</p>

      <div>
        <Label>Asunto</Label>
        <input name="asunto" required maxLength={200} placeholder="Ej: Reunión del sábado" className={inputClass} />
        <FieldError message={estado.fieldErrors?.asunto} />
      </div>
      <div>
        <Label>Mensaje</Label>
        <textarea name="cuerpo" required maxLength={5000} rows={6} placeholder="Escribí el mensaje acá..." className={inputClass} />
        <FieldError message={estado.fieldErrors?.cuerpo} />
      </div>

      <FormError message={estado.error} />

      <SubmitButton pendingLabel="Enviando…">
        <span className="inline-flex items-center gap-2"><Send size={15} /> Enviar mail</span>
      </SubmitButton>
    </form>
  );
}
