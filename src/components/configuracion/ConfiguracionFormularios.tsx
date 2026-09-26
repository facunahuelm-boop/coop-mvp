"use client";

// Fase 4 del rediseño: los 5 formularios de /configuracion (marca, etapa,
// módulos, configuración de email, alertas por email) migrados a
// `useActionState` — mismo criterio que los demás módulos. Ninguno es un
// botón "Agregar" (todos guardan/actualizan configuración existente), así
// que siguen con `SubmitButton` simple, sin `variant="add"`.

import { useActionState, useEffect, useRef } from "react";
import {
  actualizarBrandingFormAction,
  actualizarEtapaFormAction,
  actualizarModulosFormAction,
  guardarConfigEmailFormAction,
  actualizarAlertasEmailFormAction,
  guardarReglasCooperativaFormAction,
} from "@/lib/actions/configuracion";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";

const ETAPA_LABEL: Record<string, string> = {
  pre_obra: "Pre-obra (todavía no arrancó la construcción)",
  obra: "En obra (construcción en curso)",
  habitada: "Habitada (ya se mudaron, obra terminada)",
};

const MODULOS_LABEL: Record<string, string> = {
  obra: "Obra (cronograma y avance de la construcción)",
  trabajo: "Trabajo (jornadas de ayuda mutua)",
  seguridad: "Seguridad e higiene",
  reclamos: "Reclamos y mantenimiento (una vez habitada)",
  // Fase 5, Sub-fase 5.3 ("Planes y módulos"): estos 6 no dependen de la
  // etapa de la cooperativa (a diferencia de los 4 de arriba) — "Automático"
  // para ellos significa "visible siempre", no "según la etapa" (ver
  // MODULOS_CON_ETAPA más abajo, que ajusta el texto de la opción).
  compras: "Compras y proveedores",
  finanzas: "Finanzas",
  documentos: "Documentos",
  auditoria: "Auditoría, Panel Fiscal y Cumplimiento",
  comisiones: "Comisiones, Reuniones, Decisiones y Comunicaciones",
  socios: "Socios",
};

const MODULOS_CON_ETAPA = new Set(["obra", "trabajo", "seguridad", "reclamos"]);

type Organizacion = {
  nombre?: string | null;
  color_primario?: string | null;
  color_secundario?: string | null;
  logo_url?: string | null;
  etapa?: string | null;
  modulos_override?: Record<string, string> | null;
};

export function BrandingForm({ organizacion }: { organizacion: Organizacion | null }) {
  const [estado, formAction] = useActionState(actualizarBrandingFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Marca actualizada.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <Label>Nombre de la cooperativa</Label>
        <input type="text" name="nombre" required defaultValue={organizacion?.nombre || ""} className={inputClass} />
        <FieldError message={estado.fieldErrors?.nombre} />
      </div>
      <div>
        <Label>Color principal</Label>
        <input
          type="color"
          name="color_primario"
          defaultValue={organizacion?.color_primario || "#1e3a5f"}
          className="h-10 w-full rounded-lg border border-ink/10 cursor-pointer"
        />
        <FieldError message={estado.fieldErrors?.color_primario} />
      </div>
      <div>
        <Label>Color secundario (opcional)</Label>
        <input
          type="color"
          name="color_secundario"
          defaultValue={organizacion?.color_secundario || organizacion?.color_primario || "#0f766e"}
          className="h-10 w-full rounded-lg border border-ink/10 cursor-pointer"
        />
        <FieldError message={estado.fieldErrors?.color_secundario} />
      </div>
      <div className="sm:col-span-2">
        <Label>Logo (opcional)</Label>
        {organizacion?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={organizacion.logo_url} alt={organizacion.nombre || ""} className="h-12 w-12 rounded-full object-cover mb-2" />
        )}
        <input type="file" name="logo" accept="image/*" className="text-xs" />
      </div>
      <div className="sm:col-span-2">
        <FormError message={estado.error} />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Guardando…">Guardar marca</SubmitButton>
      </div>
    </form>
  );
}

export function EtapaForm({ etapaActual }: { etapaActual: string }) {
  const [estado, formAction] = useActionState(actualizarEtapaFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Etapa actualizada.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[260px]">
        <Label>Etapa actual: {ETAPA_LABEL[etapaActual] || etapaActual}</Label>
        <select name="etapa" defaultValue={etapaActual} className={inputClass}>
          {Object.entries(ETAPA_LABEL).map(([valor, label]) => (
            <option key={valor} value={valor}>{label}</option>
          ))}
        </select>
      </div>
      <SubmitButton pendingLabel="Guardando…">Guardar etapa</SubmitButton>
      <div className="w-full">
        <FormError message={estado.error} />
      </div>
    </form>
  );
}

export function ModulosForm({ overrides }: { overrides: Record<string, string> | null | undefined }) {
  const [estado, formAction] = useActionState(actualizarModulosFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Módulos actualizados.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(MODULOS_LABEL).map(([mod, label]) => (
        <div key={mod} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-ink">{label}</span>
          <select name={mod} defaultValue={overrides?.[mod] || "auto"} className={inputClass + " sm:w-56"}>
            <option value="auto">{MODULOS_CON_ETAPA.has(mod) ? "Automático (según la etapa)" : "Automático (visible siempre)"}</option>
            <option value="mostrar">Mostrar siempre</option>
            <option value="ocultar">Ocultar siempre</option>
          </select>
        </div>
      ))}
      <FormError message={estado.error} />
      <SubmitButton pendingLabel="Guardando…">Guardar módulos</SubmitButton>
    </form>
  );
}

type ConfigEmail = {
  smtp_host?: string;
  smtp_port?: string;
  smtp_user?: string;
  email_remitente?: string;
  email_alertas_criticas?: string;
};

export function ConfigEmailForm({ configObj }: { configObj: ConfigEmail }) {
  const [estado, formAction] = useActionState(guardarConfigEmailFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      // La contraseña nunca se precarga — se limpia el campo, no todo el
      // formulario, para no perder de vista lo que ya se acaba de guardar.
      const passwordInput = formRef.current?.elements.namedItem("smtp_password") as HTMLInputElement | null;
      if (passwordInput) passwordInput.value = "";
      show("Configuración de email guardada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Host SMTP</Label>
          <input type="text" name="smtp_host" defaultValue={configObj.smtp_host || ""} placeholder="ej: smtp.gmail.com" className={inputClass} />
          <FieldError message={estado.fieldErrors?.smtp_host} />
        </div>
        <div>
          <Label>Puerto</Label>
          <input type="number" name="smtp_port" defaultValue={configObj.smtp_port || "587"} className={inputClass} />
          <FieldError message={estado.fieldErrors?.smtp_port} />
        </div>
        <div>
          <Label>Usuario (email)</Label>
          <input type="email" name="smtp_user" defaultValue={configObj.smtp_user || ""} placeholder="tu@ejemplo.com" className={inputClass} />
          <FieldError message={estado.fieldErrors?.smtp_user} />
        </div>
        <div>
          <Label>Contraseña</Label>
          <input type="password" name="smtp_password" placeholder="Contraseña o token de app" className={inputClass} />
          <FieldError message={estado.fieldErrors?.smtp_password} />
        </div>
        <div className="sm:col-span-2">
          <Label>Remitente (nombre)</Label>
          <input type="text" name="email_remitente" defaultValue={configObj.email_remitente || "COOVA Sistema"} className={inputClass} />
          <FieldError message={estado.fieldErrors?.email_remitente} />
        </div>
        <div className="sm:col-span-2">
          <Label>Email de destino para alertas críticas</Label>
          <input
            type="email"
            name="email_alertas_criticas"
            defaultValue={configObj.email_alertas_criticas || ""}
            placeholder="admin@tucooperativa.uy"
            className={inputClass}
          />
          <FieldError message={estado.fieldErrors?.email_alertas_criticas} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel="Guardando…">Guardar configuración</SubmitButton>
        </div>
      </form>
      <div className="mt-4 p-3 bg-[var(--color-amarillo-bg)] rounded-lg border border-[var(--color-amarillo)]/20">
        <p className="text-xs text-[var(--color-amarillo)]">
          <strong>Para Gmail:</strong> Usa contraseña de aplicación (no la contraseña normal). Activa &quot;Acceso de aplicaciones menos seguras&quot; o genera una contraseña de app en tu cuenta Google.
        </p>
      </div>
    </>
  );
}

export function AlertasEmailForm() {
  const [estado, formAction] = useActionState(actualizarAlertasEmailFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Preferencias de alertas actualizadas.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" name="tarea_atrasada" defaultChecked={true} />
          Tareas atrasadas
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" name="documento_vencido" defaultChecked={true} />
          Documentos vencidos
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" name="dinero_bajo" defaultChecked={true} />
          Saldo bajo
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" name="problema_critico" defaultChecked={true} />
          Problemas críticos
        </label>
      </div>
      <FormError message={estado.error} />
      <SubmitButton pendingLabel="Guardando…">Actualizar preferencias</SubmitButton>
    </form>
  );
}

// Fase 3, Sub-fase 3.1 ("Reglas de la cooperativa"): ver migración 0034 y
// src/lib/reglas.ts. Los dos umbrales que antes estaban hardcodeados en el
// código (mismo valor en todas las cooperativas) ahora se configuran acá,
// por cooperativa.
export function ReglasCooperativaForm({
  diasAlertaVencimiento,
  porcentajeDesvioPresupuesto,
}: {
  diasAlertaVencimiento: number;
  porcentajeDesvioPresupuesto: number;
}) {
  const [estado, formAction] = useActionState(guardarReglasCooperativaFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Reglas de la cooperativa actualizadas.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Días de anticipación para &quot;por vencer&quot;</Label>
          <input
            name="dias_alerta_vencimiento"
            type="number"
            min={1}
            max={90}
            defaultValue={diasAlertaVencimiento}
            className={inputClass}
          />
          <p className="text-xs text-ink/40 mt-1">A cuántos días de vencer se marca un documento como &quot;próximo a vencer&quot;.</p>
          <FieldError message={estado.fieldErrors?.dias_alerta_vencimiento} />
        </div>
        <div>
          <Label>% de desvío de presupuesto que alerta</Label>
          <input
            name="porcentaje_desvio_presupuesto"
            type="number"
            min={1}
            max={100}
            defaultValue={porcentajeDesvioPresupuesto}
            className={inputClass}
          />
          <p className="text-xs text-ink/40 mt-1">Qué % de más entre gasto real y presupuestado dispara una alerta de desvío.</p>
          <FieldError message={estado.fieldErrors?.porcentaje_desvio_presupuesto} />
        </div>
      </div>
      <FormError message={estado.error} />
      <SubmitButton pendingLabel="Guardando…">Guardar reglas</SubmitButton>
    </form>
  );
}
