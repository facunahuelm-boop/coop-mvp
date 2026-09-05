"use client";

import { useEffect, useState } from "react";

/**
 * Saludo que se ajusta a la hora del dispositivo de quien mira la pantalla
 * (no la hora del servidor, que puede estar en otro huso horario).
 * Se calcula en el cliente para evitar mostrar "Buenas noches" a las 10am.
 */
export function Saludo({ nombre }: { nombre: string }) {
  const [saludo, setSaludo] = useState("Hola");

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 6) setSaludo("Buenas noches");
    else if (h < 12) setSaludo("Buenos días");
    else if (h < 20) setSaludo("Buenas tardes");
    else setSaludo("Buenas noches");
  }, []);

  return (
    <>
      {saludo}, {nombre}
    </>
  );
}
