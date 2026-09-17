"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Settings, LogOut, ArrowLeft } from "lucide-react";
import { Modal } from "./ui-client";

/**
 * Única pieza interactiva de "Mi cuenta" (ver MiCuenta.tsx): abrir/cerrar el
 * modal y alternar entre la vista resumen y la vista de detalle (con sus 2
 * pestañas). Todo el contenido llega ya armado como ReactNode desde el
 * Server Component padre — no vuelve a pedir datos al abrir "Ver más
 * detalles", ya los tiene todos desde el primer render. La única función que
 * cruza el límite servidor→cliente es `logoutAction` (Server Action, mismo
 * criterio ya documentado en TopBarClient.tsx) — nunca una función común.
 */
export function MiCuentaTrigger({
  trigger,
  resumen,
  perfil,
  estadoCuenta,
  configuracionHref,
  logoutAction,
}: {
  trigger: ReactNode;
  resumen: ReactNode;
  perfil: ReactNode;
  estadoCuenta: ReactNode;
  configuracionHref: string;
  logoutAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detalle, setDetalle] = useState(false);
  const [tab, setTab] = useState<"perfil" | "cuenta">("perfil");

  const cerrar = () => {
    setOpen(false);
    // pequeño delay conceptual: no hace falta resetear detalle/tab de una,
    // el modal ya está cerrado — pero al reabrir conviene arrancar siempre
    // desde el resumen, no donde quedó la última vez.
    setDetalle(false);
    setTab("perfil");
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="rounded-full">
        {trigger}
      </button>
      <Modal
        open={open}
        onClose={cerrar}
        title={detalle ? "Mi cuenta — Detalle" : "Mi cuenta"}
        size={detalle ? "lg" : "md"}
        footer={
          <div className="flex items-center justify-between w-full text-xs">
            {detalle ? (
              <button
                type="button"
                onClick={() => setDetalle(false)}
                className="inline-flex items-center gap-1.5 font-semibold text-ink-faint hover:text-ink"
              >
                <ArrowLeft size={13} /> Volver
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-4">
              <Link
                href={configuracionHref}
                onClick={cerrar}
                className="inline-flex items-center gap-1.5 font-semibold text-ink-faint hover:text-ink"
              >
                <Settings size={13} /> Configuración
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-rojo)] hover:underline">
                  <LogOut size={13} /> Cerrar sesión
                </button>
              </form>
            </div>
          </div>
        }
      >
        {!detalle ? (
          <div>
            {resumen}
            <div className="mt-4 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setDetalle(true)}
                className="text-sm font-semibold text-[var(--color-secondary)] hover:underline underline-offset-2"
              >
                Ver más detalles →
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex gap-1 mb-4 border-b border-border">
              <button
                type="button"
                onClick={() => setTab("perfil")}
                className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  tab === "perfil" ? "border-[var(--color-secondary)] text-[var(--color-secondary)]" : "border-transparent text-ink-faint hover:text-ink"
                }`}
              >
                Perfil
              </button>
              <button
                type="button"
                onClick={() => setTab("cuenta")}
                className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  tab === "cuenta" ? "border-[var(--color-secondary)] text-[var(--color-secondary)]" : "border-transparent text-ink-faint hover:text-ink"
                }`}
              >
                Estado de cuenta
              </button>
            </div>
            {tab === "perfil" ? perfil : estadoCuenta}
          </div>
        )}
      </Modal>
    </>
  );
}
