"use client";

// Fase 4 ("Seguridad y permisos granulares(16) + Seguridad de cuentas/2FA/
// sesiones(17) + Eliminación segura(18)") — Sub-fase 4.1: Gestión de
// usuarios (sección 16). Mismos patrones ya usados en el resto del sistema:
// alta en Modal (como Comunicaciones/Decisiones/Reglas automáticas), select
// que se guarda solo al cambiar (evita un botón "Guardar" extra para un
// cambio de una sola cosa), y ActionForm para las acciones de un solo paso
// (activar/desactivar).

import { useActionState, useEffect, useRef, useState } from "react";
import {
  crearUsuarioFormAction,
  cambiarRolUsuarioFormAction,
  alternarActivoUsuarioFormAction,
  restablecerPasswordUsuarioFormAction,
} from "@/lib/actions/usuariosAdmin";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal, ActionForm } from "@/components/ui-client";
import { AddButton, Label, inputClass, Badge } from "@/components/ui";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/roles";

export function CrearUsuarioForm() {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(crearUsuarioFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Usuario creado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nuevo usuario</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo usuario" size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div className="sm:col-span-2">
            <Label>Nombre</Label>
            <input name="nombre" required placeholder="Nombre y apellido" className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>

          <div>
            <Label>Email</Label>
            <input name="email" type="email" required placeholder="persona@ejemplo.com" className={inputClass} />
            <FieldError message={estado.fieldErrors?.email} />
          </div>

          <div>
            <Label>Rol</Label>
            <select name="rol" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.rol} />
          </div>

          <div className="sm:col-span-2">
            <Label>Contraseña inicial</Label>
            <input name="password" type="text" required minLength={8} placeholder="Mínimo 8 caracteres" className={inputClass} />
            <p className="text-xs text-ink/40 mt-1">
              Compartísela por un medio seguro — la persona puede cambiarla después desde su propio perfil.
            </p>
            <FieldError message={estado.fieldErrors?.password} />
          </div>

          <FormError message={estado.error} />
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Creando…">Crear usuario</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function CambiarRolForm({ id, rolActual, disabled }: { id: number; rolActual: Role; disabled?: boolean }) {
  const [estado, formAction] = useActionState(cambiarRolUsuarioFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    else if (estado.ok) show("Rol actualizado.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="rol"
        defaultValue={rolActual}
        disabled={disabled}
        className={`${inputClass} !py-1 !text-xs disabled:opacity-50`}
        title={disabled ? "No podés cambiar tu propio rol" : "Cambiar rol"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
    </form>
  );
}

export function AlternarActivoButton({ id, activo, disabled }: { id: number; activo: boolean; disabled?: boolean }) {
  return (
    <ActionForm action={alternarActivoUsuarioFormAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={activo ? "false" : "true"} />
      <button
        type="submit"
        disabled={disabled}
        title={disabled ? "No podés desactivar tu propia cuenta" : undefined}
        className="text-xs underline text-[var(--color-brand-800)] disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
      >
        {activo ? "Desactivar" : "Activar"}
      </button>
    </ActionForm>
  );
}

export function EstadoUsuarioBadge({ activo }: { activo: boolean }) {
  return <Badge color={activo ? "verde" : "rojo"}>{activo ? "Activo" : "Inactivo"}</Badge>;
}

export function RestablecerPasswordForm({ id, nombre }: { id: number; nombre: string }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(restablecerPasswordUsuarioFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Contraseña restablecida.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs underline text-[var(--color-brand-800)]">
        Restablecer contraseña
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Restablecer contraseña de ${nombre}`}>
        <form ref={formRef} action={formAction} className="space-y-3 text-ink">
          <input type="hidden" name="id" value={id} />
          <div>
            <Label>Contraseña nueva</Label>
            <input name="password" type="text" required minLength={8} placeholder="Mínimo 8 caracteres" className={inputClass} />
            <p className="text-xs text-ink/40 mt-1">Compartísela por un medio seguro con {nombre}.</p>
            <FieldError message={estado.fieldErrors?.password} />
          </div>
          <FormError message={estado.error} />
          <SubmitButton pendingLabel="Guardando…">Restablecer</SubmitButton>
        </form>
      </Modal>
    </>
  );
}
