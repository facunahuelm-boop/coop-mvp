"use client";

// Fase 5, Sub-fase 5.1 ("Administrador de plataforma", sección 20). Mismos
// patrones ya usados en el resto del sistema: ActionForm para acciones de un
// solo paso (activar/desactivar, ver usuarios/UsuariosAdminFormularios.tsx),
// y details/summary con confirmación explícita para la acción irreversible
// (aplicar migraciones — mismo patrón que AnularMovimientoBoton en
// finanzas/FinanzasFormularios.tsx).

import {
  alternarActivoCooperativaFormAction,
  aplicarMigracionesPendientesFormAction,
} from "@/lib/actions/plataforma";
import { ActionForm } from "@/components/ui-client";
import { Badge } from "@/components/ui";

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
