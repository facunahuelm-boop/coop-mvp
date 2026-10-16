"use client";

// Cierra los «altas en pop-up» (details con summary[data-popup], ver globals.css)
// al tocar afuera / la X (el clic cae sobre el propio <details>) o con Esc.

import { useEffect } from "react";

export function DetallesPopup() {
  useEffect(() => {
    const abiertos = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("details[open]")).filter((d) => d.querySelector(":scope > summary[data-popup]"));
    const alClic = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof HTMLDetailsElement && t.open && t.querySelector(":scope > summary[data-popup]")) t.open = false;
    };
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") abiertos().forEach((d) => (d.open = false));
    };
    document.addEventListener("click", alClic);
    document.addEventListener("keydown", alTeclado);
    return () => {
      document.removeEventListener("click", alClic);
      document.removeEventListener("keydown", alTeclado);
    };
  }, []);
  return null;
}
