"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "ufama_install_hint_dismissed";

/**
 * Sugerencia (solo en celular) para agregar UFAMA a la pantalla de inicio,
 * para que se use como una app en vez de una pestaña del navegador.
 * Se oculta sola si ya está instalada, y se puede cerrar con la X (queda
 * cerrada para la próxima visita en ese mismo celular).
 */
export function InstallHint() {
  const [show, setShow] = useState(false);
  const [plataforma, setPlataforma] = useState<"ios" | "otro">("otro");

  useEffect(() => {
    try {
      const yaCerrada = localStorage.getItem(DISMISS_KEY);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone;
      if (yaCerrada || standalone) return;
      const ua = navigator.userAgent || "";
      setPlataforma(/iphone|ipad|ipod/i.test(ua) ? "ios" : "otro");
      setShow(true);
    } catch {
      // localStorage puede fallar (modo privado, etc.) — simplemente no mostramos el aviso
    }
  }, []);

  if (!show) return null;

  const cerrar = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setShow(false);
  };

  return (
    <div className="md:hidden mb-4 rounded-xl bg-[#e7eff1] px-4 py-3 text-xs text-[#1f4e5f] flex items-start gap-2">
      <span className="text-base leading-none">📲</span>
      <div className="flex-1">
        {plataforma === "ios" ? (
          <>
            Agregá UFAMA a tu pantalla de inicio: tocá el botón <b>Compartir</b> (el cuadradito con la
            flecha) y luego <b>&quot;Agregar a la pantalla de inicio&quot;</b>.
          </>
        ) : (
          <>
            Agregá UFAMA a tu pantalla de inicio: tocá el menú (⋮) del navegador y luego{" "}
            <b>&quot;Instalar app&quot;</b> o <b>&quot;Agregar a la pantalla de inicio&quot;</b>.
          </>
        )}
      </div>
      <button onClick={cerrar} className="text-[#1f4e5f]/50 hover:text-[#1f4e5f] shrink-0" aria-label="Cerrar aviso">
        ✕
      </button>
    </div>
  );
}
