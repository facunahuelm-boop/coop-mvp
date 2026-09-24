"use client";

// Fase 5, Sub-fase 5.1 ("Administrador de plataforma", sección 20). Mismos
// patrones ya usados en el resto del sistema: ActionForm para acciones de un
// solo paso (activar/desactivar, ver usuarios/UsuariosAdminFormularios.tsx),
// y details/summary con confirmación explícita para la acción irreversible
// (aplicar migraciones — mismo patrón que AnularMovimientoBoton en
// finanzas/FinanzasFormularios.tsx).

import { useActionState, useEffect, useRef, useState } from "react";
import {
  alternarActivoCooperativaFormAction,
  aplicarMigracionesPendientesFormAction,
  crearCooperativaFormAction,
  cambiarPlanCooperativaFormAction,
} from "@/lib/actions/plataforma";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { ActionForm, FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButton, Label, inputClass, Badge } from "@/components/ui";
import { PLANES, PLAN_LABELS, PLAN_DESCRIPCIONES, type Plan } from "@/lib/planes";

export function AlternarActivoCooperativaButton({
  id,
  activo,
  disabled,
}: {
  id: number;
  activo: boolean;
  disabled?: boolean;
}) {
  return (
    <ActionForm action={alternarActivoCooperativaFormAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={activo ? "false" : "true"} />
      <button
        type="submit"
        disabled={disabled}
        title={disabled ? "No podés desactivar tu propia cooperativa" : undefined}
        className="text-xs underline text-[var(--color-brand-800)] disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
      >
        {activo ? "Desactivar" : "Activar"}
      </button>
    </ActionForm>
  );
}

export function EstadoCooperativaBadge({ activo }: { activo: boolean }) {
  return <Badge color={activo ? "verde" : "rojo"}>{activo ? "Activa" : "Desactivada"}</Badge>;
}

// Fase 5, Sub-fase 5.2 (Alta de cooperativas): sugiere un identificador a
// partir del nombre para no obligar a escribirlo dos veces — sigue siendo
// editable a mano (ver CrearCooperativaForm), esto es solo un punto de
// partida razonable. Nunca se manda tal cual sin pasar por la validación real
// del lado del servidor (crearCooperativaAction, misma regla ahí).
function sugerirSlug(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos (á -> a)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(?=[0-9])/, "c-") // el slug tiene que empezar con una letra
    .slice(0, 40);
}

export function CrearCooperativaForm() {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [planElegido, setPlanElegido] = useState<Plan>("trial");
  const [estado, formAction] = useActionState(crearCooperativaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      setSlug("");
      setSlugTocado(false);
      setPlanElegido("trial");
      show("Cooperativa creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nueva cooperativa</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva cooperativa" size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div className="sm:col-span-2">
            <Label>Nombre de la cooperativa</Label>
            <input
              name="nombre"
              required
              placeholder="Nombre de la cooperativa"
              className={inputClass}
              onChange={(e) => {
                if (!slugTocado) setSlug(sugerirSlug(e.target.value));
              }}
            />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>

          <div className="sm:col-span-2">
            <Label>Identificador (slug)</Label>
            <input
              name="slug"
              required
              placeholder="mi-cooperativa"
              className={inputClass}
              value={slug}
              onChange={(e) => {
                setSlugTocado(true);
                setSlug(e.target.value);
              }}
            />
            <p className="text-xs text-ink/40 mt-1">
              Solo minúsculas, números y guiones. Es lo que la persona va a escribir en &quot;¿Ingresás a otra cooperativa?&quot; al iniciar sesión, hasta que esta cooperativa tenga su propio subdominio.
            </p>
            <FieldError message={estado.fieldErrors?.slug} />
          </div>

          <div className="sm:col-span-2">
            <Label>Plan</Label>
            <select name="plan" defaultValue="trial" className={inputClass} onChange={(e) => setPlanElegido(e.target.value as Plan)}>
              {PLANES.map((p) => (
                <option key={p} value={p}>{PLAN_LABELS[p]}</option>
              ))}
            </select>
            <p className="text-xs text-ink/40 mt-1">{PLAN_DESCRIPCIONES[planElegido]}</p>
            <FieldError message={estado.fieldErrors?.plan} />
          </div>

          <div className="sm:col-span-2 pt-2 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60">Primer usuario (administrador de esta cooperativa)</p>
          </div>

          <div className="sm:col-span-2">
            <Label>Nombre</Label>
            <input name="adminNombre" required placeholder="Nombre y apellido" className={inputClass} />
            <FieldError message={estado.fieldErrors?.adminNombre} />
          </div>

          <div>
            <Label>Email</Label>
            <input name="adminEmail" type="email" required placeholder="persona@ejemplo.com" className={inputClass} />
            <FieldError message={estado.fieldErrors?.adminEmail} />
          </div>

          <div>
            <Label>Contraseña inicial</Label>
            <input name="adminPassword" type="text" required minLength={8} placeholder="Mínimo 8 caracteres" className={inputClass} />
            <FieldError message={estado.fieldErrors?.adminPassword} />
          </div>

          <p className="sm:col-span-2 text-xs text-ink/40">
            Esta persona entra como administradora de ESA cooperativa (no de la plataforma) — compartile la contraseña por un medio seguro.
          </p>

          <FormError message={estado.error} />
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Creando…">Crear cooperativa</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * Fase 5, Sub-fase 5.3 ("Planes y módulos"): a diferencia de
 * AlternarActivoCooperativaButton (un solo click, reversible con otro
 * click), cambiar el plan PISA el `modulos_override` que la cooperativa haya
 * configurado a mano (ver crearCooperativaAction/cambiarPlanCooperativaAction
 * en actions/plataforma.ts) — por eso no se autoguarda al elegir una opción
 * del select (mismo patrón que CambiarRolForm en usuarios), sino que pide un
 * click aparte en "Guardar", con el aviso siempre visible al lado.
 */
export function CambiarPlanCooperativaForm({ id, planActual }: { id: number; planActual: string }) {
  const [estado, formAction] = useActionState(cambiarPlanCooperativaFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    else if (estado.ok) show("Plan actualizado.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="plan" defaultValue={planActual} className={inputClass + " !py-1 !text-xs !w-auto"} title="Cambiar el plan reemplaza los módulos visibles por el preset del plan nuevo">
        {PLANES.map((p) => (
          <option key={p} value={p}>{PLAN_LABELS[p]}</option>
        ))}
      </select>
      <button type="submit" className="text-xs underline text-[var(--color-brand-800)] whitespace-nowrap">
        Guardar
      </button>
    </form>
  );
}

export function AplicarMigracionesBoton({ cantidad }: { cantidad: number }) {
  return (
    <details className="inline-block">
      <summary className="cursor-pointer text-xs text-[var(--color-rojo)] underline underline-offset-2">
        Aplicar {cantidad} migración{cantidad === 1 ? "" : "es"} pendiente{cantidad === 1 ? "" : "s"}
      </summary>
      <ActionForm action={aplicarMigracionesPendientesFormAction} className="mt-2 space-y-2 max-w-md">
        <p className="text-xs text-ink/60">
          Esto ejecuta SQL directo (DDL) contra la base de producción, una migración a la vez. No se puede deshacer.
          Afecta a TODAS las cooperativas, no solo a la tuya.
        </p>
        <input type="hidden" name="confirmar" value="si" />
        <button className="rounded-lg bg-[var(--color-rojo-bg)] text-[var(--color-rojo)] px-3 py-2 text-xs font-semibold whitespace-nowrap">
          Confirmar y aplicar ahora
        </button>
      </ActionForm>
    </details>
  );
}
