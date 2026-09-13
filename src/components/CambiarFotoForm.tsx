"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { cambiarFotoFormAction } from "@/lib/actions/usuarios";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FormError, SubmitButton, useToast } from "./ui-client";
import { Button } from "./ui";
import { Avatar } from "./EntidadLink";

// Límite del lado del cliente: sólo para avisar antes de subir (mejor
// experiencia — no hacer esperar el viaje al servidor para enterarse de que
// el archivo es demasiado pesado). El límite real, el que de verdad importa
// para la seguridad, es el de cambiarFotoAction (server, ver usuarios.ts) —
// éste es puramente cosmético y nunca reemplaza esa validación.
const MAX_BYTES_CLIENTE = 3 * 1024 * 1024;
const TIPOS_ACEPTADOS = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"];

/**
 * Rediseño "Color secundario + Top Bar" (punto 15): sección "Foto de perfil"
 * dentro de la ficha propia — mostrar la foto actual (o una inicial genérica
 * si no hay ninguna) + un botón "Cambiar foto" que permite elegir un archivo,
 * ver una previsualización antes de confirmar, y cancelar sin subir nada.
 * Sólo se renderiza para esPropioPerfil (ver usuarios/[id]/page.tsx) — la
 * Server Action además nunca acepta un id ajeno, así que esto es defensa en
 * profundidad, no el único control.
 */
export function CambiarFotoForm({ avatarActual, nombre }: { avatarActual: string | null; nombre: string }) {
  const [estado, formAction] = useActionState(cambiarFotoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();

  const [preview, setPreview] = useState<string | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Foto de perfil actualizada.");
      // La respuesta de la Server Action (useActionState) sólo se conoce acá
      // — no hay ningún evento síncrono al que engancharse para limpiar la
      // previsualización, por eso el setState vive en este efecto (no hay
      // forma de moverlo a un manejador de evento sin perder el caso "falló
      // el envío, mantené la previsualización para poder reintentar").
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
    // Sólo interesa reaccionar cuando cambia el resultado de un envío.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  // Limpiar el object URL de la previsualización al desmontar, para no dejar
  // memoria reservada de más.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setErrorArchivo(null);
    if (!file) return;
    if (!TIPOS_ACEPTADOS.includes(file.type)) {
      setErrorArchivo("Formato no admitido. Usá una imagen (JPG, PNG, WEBP, GIF).");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES_CLIENTE) {
      setErrorArchivo(`La imagen es demasiado pesada (máximo ${Math.round(MAX_BYTES_CLIENTE / (1024 * 1024))} MB).`);
      e.target.value = "";
      return;
    }
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function cancelar() {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setErrorArchivo(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-4">
      <Avatar url={preview ?? avatarActual} nombre={nombre} size={72} />
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          name="foto"
          accept={TIPOS_ACEPTADOS.join(",")}
          onChange={elegirArchivo}
          className="hidden"
          id="input-foto-perfil"
        />
        {preview ? (
          <div className="flex items-center gap-2">
            <SubmitButton pendingLabel="Guardando…">Guardar foto</SubmitButton>
            <Button type="button" variant="ghost" onClick={cancelar}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
            Cambiar foto
          </Button>
        )}
        {errorArchivo && <p className="text-sm font-medium text-[var(--color-rojo)]">{errorArchivo}</p>}
        <FormError message={estado.error} />
        <p className="text-xs text-ink-faint">JPG, PNG, WEBP o GIF. Máximo 3 MB.</p>
      </div>
    </form>
  );
}
