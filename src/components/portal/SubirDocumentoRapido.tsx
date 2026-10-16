"use client";

// Inicio de la Directiva (16/10): «Subir documento» abre este pop-up — sacar
// una foto con la cámara o elegir un archivo, decir qué es y, si tiene una
// fecha importante, anotarla en el calendario. Todo en un solo pop-up.

import { useActionState, useRef, useState, type ReactNode } from "react";
import { Camera, FileText, Paperclip, RotateCcw } from "lucide-react";
import { Modal, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import { subirDocumentoRapidoFormAction } from "@/lib/actions/documentoRapido";

export function SubirDocumentoRapido({
  categorias,
  claseBoton,
  children,
}: {
  categorias: { valor: string; label: string }[];
  claseBoton: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  const limpiar = () => {
    setArchivo(null);
    setFecha("");
    setVista((v) => {
      if (v) URL.revokeObjectURL(v);
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
    formRef.current?.reset();
  };

  // Al guardar bien: cerrar, dejar el pop-up limpio para el próximo y avisar.
  const [estado, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await subirDocumentoRapidoFormAction(prev, fd);
    if (r.ok) {
      setAbierto(false);
      limpiar();
      show(r.aviso || "Documento guardado.");
    }
    return r;
  }, ESTADO_INICIAL);

  // Un solo <input name="archivo">: "Sacar foto" le pide la cámara trasera,
  // "Elegir archivo" abre la galería / los archivos del teléfono.
  const elegir = (camara: boolean) => {
    const input = inputRef.current;
    if (!input) return;
    if (camara) {
      input.setAttribute("capture", "environment");
      input.accept = "image/*";
    } else {
      input.removeAttribute("capture");
      input.accept = "image/*,application/pdf,.doc,.docx,.xls,.xlsx";
    }
    input.click();
  };

  const alElegir = (f: File | null) => {
    setArchivo(f);
    setVista((v) => {
      if (v) URL.revokeObjectURL(v);
      return f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    });
  };

  const botonGrande =
    "flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-3 py-5 text-[15px] font-semibold text-ink active:scale-[.98] hover:bg-surface-sunken";

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={claseBoton}>
        {children}
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Subir documento">
        <form ref={formRef} action={formAction} className="space-y-4 text-[15px]">
          <input ref={inputRef} type="file" name="archivo" className="hidden" onChange={(e) => alElegir(e.target.files?.[0] ?? null)} />
          <FormError message={estado.error} />

          {!archivo ? (
            <div className="flex gap-3">
              <button type="button" onClick={() => elegir(true)} className={botonGrande}>
                <Camera size={28} className="text-[var(--color-brand-800)]" aria-hidden />
                Sacar foto
              </button>
              <button type="button" onClick={() => elegir(false)} className={botonGrande}>
                <Paperclip size={28} className="text-[var(--color-brand-800)]" aria-hidden />
                Elegir archivo
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-sunken/50 p-3">
              {vista ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vista} alt="Vista previa" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-muted">
                  <FileText size={26} aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{archivo.name}</span>
              <button type="button" onClick={limpiar} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand-800)]">
                <RotateCcw size={14} aria-hidden /> Cambiar
              </button>
            </div>
          )}

          {archivo && (
            <>
              <div>
                <Label required>¿Qué es?</Label>
                <input name="nombre" required maxLength={200} className={inputClass} placeholder="Ej.: Convocatoria asamblea de noviembre" />
              </div>
              <div>
                <Label>Tipo de documento</Label>
                <select name="categoria" defaultValue="actas" className={inputClass}>
                  {categorias.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Fecha importante (opcional)</Label>
                <input name="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
                <p className="mt-1 text-xs text-ink-faint">Un vencimiento, el día de una asamblea, un plazo…</p>
              </div>
              {fecha && (
                <label className="flex items-center gap-2 text-[15px] text-ink">
                  <input type="checkbox" name="al_calendario" defaultChecked className="h-5 w-5" />
                  Anotar esa fecha en el calendario
                </label>
              )}
              <div>
                <Label>Comentario (opcional)</Label>
                <textarea name="descripcion" rows={2} maxLength={1000} className={inputClass} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
                >
                  Volver
                </button>
                <SubmitButton>Guardar documento</SubmitButton>
              </div>
            </>
          )}
        </form>
      </Modal>
    </>
  );
}
