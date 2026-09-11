"use client";

import { useEffect } from "react";

// Boundary de errores de toda la app (pedido explícito de la auditoría,
// sección 18/20/21): hasta ahora, cualquier excepción no controlada en una
// pantalla o en una Server Action (un permiso denegado, un dato inválido,
// una falla de red, una columna que no existe todavía por una migración sin
// correr, etc.) mostraba la pantalla genérica de Next.js — "This page
// couldn't load / A server error occurred" con un código sin sentido para
// alguien sin conocimientos técnicos. Esto es exactamente lo que se observó
// en vivo al reproducir el error reportado en /compras.
//
// Este archivo (y global-error.tsx para el caso más raro de que el error
// ocurra en el layout raíz) reemplaza esa pantalla por un mensaje claro,
// con el mismo lenguaje simple que el resto del sistema, y un botón para
// reintentar sin perder la sesión. No oculta ni "arregla" el error real —
// solo lo comunica de forma entendible; el detalle técnico sigue yendo a la
// consola/logs del servidor para quien necesite diagnosticarlo.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-page-bg,#f7f8fa)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-surface p-6 sm:p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-rojo-bg,#fdecec)] text-[var(--color-rojo,#c0392b)] text-2xl">
          !
        </div>
        <h1 className="text-lg font-bold text-ink mb-2">Ocurrió un problema</h1>
        <p className="text-sm text-ink/60 leading-relaxed mb-1">
          Esta pantalla no pudo completarse. No se perdió ningún dato guardado anteriormente.
        </p>
        <p className="text-sm text-ink/60 leading-relaxed mb-6">
          Podés intentar de nuevo, o volver al inicio si el problema continúa.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-[var(--color-brand-800)] text-white px-5 py-2.5 text-sm font-semibold"
          >
            Reintentar
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-ink/15 text-ink px-5 py-2.5 text-sm font-semibold"
          >
            Volver al inicio
          </a>
        </div>
        {error.digest && (
          <p className="mt-5 text-[11px] text-ink/30">Código de referencia: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
